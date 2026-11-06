const cleanText = bytes => {
  let value;
  try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { value = new TextDecoder('latin1').decode(bytes); }
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
};


function readVar(data, state, end) {
  let value = 0;
  for (let count = 0; count < 4; count++) {
    if (state.i >= end) throw new Error('MIDI truncado dentro de um evento.');
    const byte = data[state.i++];
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  throw new Error('Valor variável MIDI inválido (mais de quatro bytes).');
}

export function parseMidi(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 14 || String.fromCharCode(...bytes.slice(0, 4)) !== 'MThd') {
    throw new Error('Cabeçalho MIDI inválido ou incompleto.');
  }

  const headerLength = view.getUint32(4);
  if (headerLength < 6 || 8 + headerLength > bytes.length) {
    throw new Error('Cabeçalho MIDI truncado.');
  }
  const trackCount = view.getUint16(10);
  const division = view.getUint16(12);
  if (!division || (division & 0x8000)) throw new Error('Divisão de tempo MIDI não suportada.');

  const metaEvents = [];
  const noteEvents = [];
  const tempos = [{ tick: 0, us: 500000 }];
  let pos = 8 + headerLength;
  let lastTick = 0;
  let parsedTracks = 0;

  while (pos < bytes.length && parsedTracks < trackCount) {
    if (pos + 8 > bytes.length) throw new Error('Cabeçalho de trilha MIDI truncado.');
    const tag = String.fromCharCode(...bytes.slice(pos, pos + 4));
    const length = view.getUint32(pos + 4);
    pos += 8;
    const end = pos + length;
    if (end > bytes.length) throw new Error('Trilha MIDI excede o tamanho do arquivo.');
    if (tag !== 'MTrk') {
      pos = end;
      continue;
    }

    parsedTracks++;
    const state = { i: pos };
    let tick = 0;
    let runningStatus = 0;

    while (state.i < end) {
      tick += readVar(bytes, state, end);
      lastTick = Math.max(lastTick, tick);
      let status = bytes[state.i];
      if (status < 0x80) {
        if (!runningStatus) throw new Error('Status contínuo MIDI sem evento anterior.');
        status = runningStatus;
      } else {
        state.i++;
      }

      if (status === 0xff) {
        if (state.i >= end) throw new Error('Evento de metadados MIDI truncado.');
        const type = bytes[state.i++];
        const size = readVar(bytes, state, end);
        if (state.i + size > end) throw new Error('Conteúdo de metadados MIDI truncado.');
        const payload = bytes.slice(state.i, state.i + size);
        state.i += size;
        if ([1, 3, 5].includes(type)) {
          const text = cleanText(payload);
          if (text) metaEvents.push({ tick, text, type });
        }
        if (type === 0x51 && size === 3) {
          tempos.push({ tick, us: (payload[0] << 16) | (payload[1] << 8) | payload[2] });
        }
        if (type === 0x2f) break;
        runningStatus = 0;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const size = readVar(bytes, state, end);
        if (state.i + size > end) throw new Error('Evento SysEx MIDI truncado.');
        state.i += size;
        runningStatus = 0;
        continue;
      }

      if (status >= 0xf0) throw new Error('Evento de sistema MIDI não suportado na trilha.');
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      if (state.i >= end) throw new Error('Evento MIDI incompleto.');
      const note = bytes[state.i++];
      const needsSecondByte = kind !== 0xc0 && kind !== 0xd0;
      if (needsSecondByte && state.i >= end) throw new Error('Evento MIDI incompleto.');
      const velocity = needsSecondByte ? bytes[state.i++] : 0;
      runningStatus = status;

      if (kind === 0x90 && velocity > 0) noteEvents.push({ tick, type: 'on', note, velocity, channel });
      else if (kind === 0x80 || (kind === 0x90 && velocity === 0)) {
        noteEvents.push({ tick, type: 'off', note, channel });
      }
    }
    pos = end;
  }

  if (parsedTracks !== trackCount) throw new Error('O arquivo MIDI não contém todas as trilhas declaradas.');
  tempos.sort((a, b) => a.tick - b.tick);
  const toSeconds = target => {
    let seconds = 0, previousTick = 0, micros = 500000;
    for (const tempo of tempos) {
      if (tempo.tick >= target) break;
      seconds += (tempo.tick - previousTick) * micros / division / 1e6;
      previousTick = tempo.tick;
      micros = tempo.us;
    }
    return seconds + (target - previousTick) * micros / division / 1e6;
  };

  const notes = noteEvents.map(event => ({ ...event, time: toSeconds(event.tick) }))
    .sort((a, b) => a.time - b.time);
  const textEvents = metaEvents.filter(event => event.type === 5);
  const source = (textEvents.length ? textEvents : metaEvents.filter(event => event.type === 1))
    .sort((a, b) => a.tick - b.tick);

  const titleMeta = metaEvents.find(event => event.type === 3)?.text.trim() || '';
  const karTitle = metaEvents.find(event => event.text.startsWith('@T'))?.text.slice(2).trim() || '';
  const karArtist = '';
  const lyrics = [];
  let line = '', lineTime = 0, lastLyricTime = 0;
  const flush = () => {
    const text = line.replace(/\s+/g, ' ').trim();
    if (text) lyrics.push({ time: lineTime, text });
    line = '';
    lastLyricTime = 0;
  };
  const append = (chunk, time) => {
    if (!chunk.trim()) {
      if (/\s/.test(chunk)) line += ' ';
      return;
    }
    if (line && (line.length + chunk.length > 72 || time - lastLyricTime > 2.8)) flush();
    if (!line) lineTime = time;
    // O hífen final em KAR indica continuação da mesma palavra/sílaba.
    line += chunk.replace(/[-_=]+$/g, '').replace(/^[-_=]+/g, '');
    lastLyricTime = time;
  };

  for (const event of source) {
    if (/^@(T|L|K|V|I|KMIDI|LEN|W)/i.test(event.text)) continue;
    const time = toSeconds(event.tick);
    for (const part of event.text.split(/([\\/\r\n]+)/)) {
      if (/^[\\/\r\n]+$/.test(part)) flush();
      else append(part, time);
    }
  }
  flush();

  return {
    title: karTitle || titleMeta,
    artist: karArtist || 'Arquivo MIDI/KAR',
    lyrics,
    notes,
    duration: toSeconds(lastTick)
  };
}
