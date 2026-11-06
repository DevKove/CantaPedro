import { Sequencer, WorkletSynthesizer } from "spessasynth_lib";

export async function createMidiEngine(initialVolume = 0.8) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Este sistema não oferece suporte ao áudio WebAudio.");

  const context = new AudioContextClass({ latencyHint: "playback" });

  // Solicita a ativação do dispositivo imediatamente, ainda no gesto do usuário.
  const activationPromise = context.resume().catch(error => {
    console.warn("A ativação inicial do áudio será repetida ao iniciar a música.", error);
  });

  const ensureAudioRunning = async () => {
    await activationPromise;
    if (context.state !== "running") await context.resume();
    if (context.state !== "running") {
      throw new Error("O dispositivo de áudio permaneceu suspenso. Clique em Reproduzir novamente e confira a saída de som do Windows.");
    }
  };

  try {
    await context.audioWorklet.addModule("./vendor/spessasynth_processor.min.js");

    const synth = new WorkletSynthesizer(context);
    await synth.isReady;

    const output = context.createGain();
    output.gain.value = Math.max(0, Math.min(1, initialVolume)) * 0.62;
    synth.connect(output);
    output.connect(context.destination);

    const soundBankResponse = await fetch("./assets/GeneralUser-GS.sf2");
    if (!soundBankResponse.ok) throw new Error("Não foi possível carregar o banco de instrumentos offline.");
    const soundBank = await soundBankResponse.arrayBuffer();
    if (soundBank.byteLength < 1024) throw new Error("O banco de instrumentos está vazio ou corrompido.");
    await synth.soundBankManager.addSoundBank(soundBank, "main");

    const sequencer = new Sequencer(synth);
    let testTimer;
    let loadSequence = 0;
    let loadChain = Promise.resolve();

    const waitForSong = sequence => new Promise((resolve, reject) => {
      const eventId = "cantapedro-song-load-" + sequence;
      const errorId = "cantapedro-midi-error-" + sequence;
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("O MIDI demorou demais para ser preparado pelo sintetizador."));
      }, 20000);
      const cleanup = () => {
        clearTimeout(timer);
        sequencer.eventHandler.removeEvent("songChange", eventId);
        sequencer.eventHandler.removeEvent("midiError", errorId);
      };
      sequencer.eventHandler.addEvent("songChange", eventId, () => {
        cleanup();
        resolve(sequence);
      });
      sequencer.eventHandler.addEvent("midiError", errorId, error => {
        cleanup();
        reject(error instanceof Error ? error : new Error("O sintetizador não conseguiu interpretar este MIDI."));
      });
    });

    return {
      get currentTime() { return sequencer.currentHighResolutionTime || sequencer.currentTime || 0; },
      get duration() { return sequencer.duration || 0; },
      get isFinished() { return sequencer.isFinished; },
      get paused() { return sequencer.paused; },
      play(binary, shouldPlay = () => true) {
        const task = loadChain.catch(() => false).then(async () => {
          if (!shouldPlay()) return false;
          await ensureAudioRunning();

          clearTimeout(testTimer);
          synth.noteOff(0, 69);
          sequencer.pause();
          synth.stopAll();

          const sequence = ++loadSequence;
          const loaded = waitForSong(sequence);
          sequencer.loadNewSongList([{ binary }]);
          await loaded;

          if (sequence !== loadSequence || !shouldPlay()) {
            sequencer.pause();
            synth.stopAll();
            return false;
          }

          await ensureAudioRunning();
          sequencer.play();
          return true;
        });
        loadChain = task.catch(() => false);
        return task;
      },
      async resume() {
        await ensureAudioRunning();
        sequencer.play();
      },
      pause() {
        sequencer.pause();
      },
      seek(seconds) {
        if (!Number.isFinite(seconds) || !sequencer.duration) return;
        sequencer.currentTime = Math.max(0, Math.min(sequencer.duration, seconds));
      },
      stop() {
        loadSequence++;
        clearTimeout(testTimer);
        synth.noteOff(0, 69);
        sequencer.pause();
        synth.stopAll();
        if (sequencer.duration) sequencer.currentTime = 0;
      },
      setVolume(value) {
        const volume = Number(value);
        if (!Number.isFinite(volume)) return;
        output.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)) * 0.62, context.currentTime, 0.035);
      },
      async testTone() {
        await ensureAudioRunning();
        clearTimeout(testTimer);
        synth.noteOff(0, 69);
        synth.noteOn(0, 69, 100);
        testTimer = setTimeout(() => synth.noteOff(0, 69), 650);
      },
      async destroy() {
        loadSequence++;
        clearTimeout(testTimer);
        sequencer.pause();
        synth.stopAll();
        synth.destroy();
        await context.close();
      }
    };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}
