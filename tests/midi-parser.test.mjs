import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi } from '../midi-parser.js';

const variable = value => {
  const bytes = [value & 0x7f];
  while ((value >>= 7)) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
};
const meta = (type, text) => {
  const data = [...new TextEncoder().encode(text)];
  return [0xff, type, ...variable(data.length), ...data];
};
const track = events => {
  const body = Uint8Array.from(events.flat());
  const header = [0x4d,0x54,0x72,0x6b, body.length>>>24,(body.length>>>16)&255,(body.length>>>8)&255,body.length&255];
  return [...header, ...body];
};
const midi = tracks => {
  const header = [0x4d,0x54,0x68,0x64,0,0,0,6,0,1,0,tracks.length,1,0xe0];
  return Uint8Array.from([...header, ...tracks.flat()]);
};

test('lê notas, duração e tempo padrão', () => {
  const bytes = midi([track([[0,0x90,60,100],[0x83,0x60,0x80,60,0],[0,0xff,0x2f,0]])]);
  const parsed = parseMidi(bytes.buffer);
  assert.equal(parsed.notes.filter(n => n.type === 'on').length, 1);
  assert.equal(parsed.duration, 0.5);
});

test('lê título KAR e preserva separação explícita entre palavras', () => {
  const bytes = midi([track([
    [0,...meta(1,'@TMinha canção')],
    [0,...meta(5,'Minha ')],
    [0x83,0x60,...meta(5,'canção')],
    [0,0x90,60,90],
    [0x83,0x60,0x80,60,0],
    [0,0xff,0x2f,0]
  ])]);
  const parsed = parseMidi(bytes.buffer);
  assert.equal(parsed.title, 'Minha canção');
  assert.equal(parsed.lyrics[0].text, 'Minha canção');
});

test('rejeita trilha truncada sem ler bytes de outra região', () => {
  const bytes = midi([track([[0,0x90,60,100],[0,0xff,0x2f,0]])]).slice(0, 25);
  assert.throws(() => parseMidi(bytes.buffer), /truncad|excede/i);
});

test('rejeita arquivo sem cabeçalho MIDI', () => {
  assert.throws(() => parseMidi(new Uint8Array([1,2,3]).buffer), /cabeçalho/i);
});
