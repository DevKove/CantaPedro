import { Sequencer, WorkletSynthesizer } from "spessasynth_lib";

export async function createMidiEngine(initialVolume = 0.8) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Este sistema não oferece suporte ao áudio WebAudio.");

  const context = new AudioContextClass({ latencyHint: "playback" });
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
    await synth.soundBankManager.addSoundBank(soundBank, "main");

    const sequencer = new Sequencer(synth);
    let testTimer;

    return {
      get currentTime() { return sequencer.currentTime || 0; },
      get duration() { return sequencer.duration || 0; },
      get isFinished() { return sequencer.isFinished; },
      get paused() { return sequencer.paused; },
      async play(binary, shouldPlay = () => true) {
        await context.resume();
        if (!shouldPlay()) return false;
        sequencer.pause();
        synth.stopAll();
        sequencer.loadNewSongList([{ binary }]);
        if (!shouldPlay()) {
          sequencer.pause();
          synth.stopAll();
          return false;
        }
        sequencer.play();
        return true;
      },
      async resume() {
        await context.resume();
        sequencer.play();
      },
      pause() {
        sequencer.pause();
      },
      seek(seconds) {
        sequencer.currentTime = Math.max(0, Math.min(sequencer.duration, seconds));
      },
      stop() {
        sequencer.pause();
        synth.stopAll();
        if (sequencer.duration) sequencer.currentTime = 0;
      },
      setVolume(value) {
        output.gain.setTargetAtTime(Math.max(0, Math.min(1, Number(value))) * 0.62, context.currentTime, 0.035);
      },
      async testTone() {
        await context.resume();
        clearTimeout(testTimer);
        synth.noteOn(0, 69, 100);
        testTimer = setTimeout(() => synth.noteOff(0, 69), 650);
      },
      async destroy() {
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
