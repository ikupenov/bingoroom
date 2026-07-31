/* ---------------------------------------------------------------------------
 * Win jingle — "triumphant stabs": three major chords climbing, landing on a
 * high ringing chord. Beat timings are exported so the fireworks + toast can
 * sync to the audio.
 * ------------------------------------------------------------------------- */

// Onset (seconds) of each climbing stab, and of the final chord.
export const WIN_BEATS = [0, 0.2, 0.4] as const;
export const WIN_FINALE = 0.62;

const C4 = 261.63, E4 = 329.63, G4 = 392, B4 = 493.88, D5 = 587.33;
const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;

interface Bus {
  master: AudioNode;
  rev: AudioNode;
}

function reverb(ac: AudioContext, seconds = 2.2, decay = 2.6): ConvolverNode {
  const rate = ac.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ac.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  const conv = ac.createConvolver();
  conv.buffer = buf;
  return conv;
}

function makeBus(ac: AudioContext, wet = 0.32): Bus {
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.ratio.value = 8;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  comp.connect(ac.destination);

  const master = ac.createGain();
  master.gain.value = 0.9;
  master.connect(comp);

  const rev = reverb(ac);
  const rg = ac.createGain();
  rg.gain.value = wet;
  rev.connect(rg);
  rg.connect(comp);

  return { master, rev };
}

interface ToneOpts {
  freq: number;
  start?: number;
  dur?: number;
  peak?: number;
  type?: OscillatorType;
  detune?: number;
  attack?: number;
  cutoff?: number;
}

function tone(ac: AudioContext, b: Bus, o: ToneOpts): void {
  const osc = ac.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.value = o.freq;
  osc.detune.value = o.detune ?? 0;

  const gain = ac.createGain();
  let head: AudioNode = osc;
  if (o.cutoff) {
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = o.cutoff;
    osc.connect(lp);
    head = lp;
  }
  head.connect(gain);

  const t = ac.currentTime + (o.start ?? 0);
  const dur = o.dur ?? 1;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(o.peak ?? 0.2, t + (o.attack ?? 0.008));
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  gain.connect(b.master);
  gain.connect(b.rev);
  osc.start(t);
  osc.stop(t + dur + 0.1);
}

// Two slightly-detuned saws through a lowpass = a bright brass stab.
function brass(ac: AudioContext, b: Bus, freq: number, start: number, dur: number, peak = 0.24): void {
  tone(ac, b, { freq, start, dur, peak, type: "sawtooth", detune: -6, attack: 0.012, cutoff: 3200 });
  tone(ac, b, { freq, start, dur, peak: peak * 0.8, type: "sawtooth", detune: 7, attack: 0.012, cutoff: 3200 });
}

function stab(ac: AudioContext, b: Bus, freqs: number[], start: number, dur: number, peak: number): void {
  for (const f of freqs) brass(ac, b, f, start, dur, peak);
}

// Filtered noise burst = cymbal / crash.
function crash(ac: AudioContext, b: Bus, start: number, dur = 0.8, peak = 0.12): void {
  const len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.6);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = 5000;
  const g = ac.createGain();
  g.gain.value = peak;
  src.connect(f);
  f.connect(g);
  g.connect(b.master);
  g.connect(b.rev);
  src.start(ac.currentTime + start);
}

function audioContext(): AudioContext | null {
  const Ctx =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctx ? new Ctx() : null;
}

// Quick "stamp / pop" for crossing off a square: a downward pitch blip + tick.
export function playMark(): void {
  try {
    const ac = audioContext();
    if (!ac) return;
    const t = ac.currentTime;

    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(330, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.15);

    const len = Math.floor(ac.sampleRate * 0.05);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2000;
    const ng = ac.createGain();
    ng.gain.value = 0.12;
    src.connect(hp);
    hp.connect(ng);
    ng.connect(ac.destination);
    src.start(t);

    setTimeout(() => void ac.close(), 300);
  } catch {
    /* audio not available */
  }
}

export function playWin(): void {
  try {
    const Ctx =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ac = new Ctx();
    const b = makeBus(ac);

    stab(ac, b, [C4, E4, G4], WIN_BEATS[0], 0.22, 0.2);
    stab(ac, b, [E4, G4, B4], WIN_BEATS[1], 0.22, 0.2);
    stab(ac, b, [G4, B4, D5], WIN_BEATS[2], 0.22, 0.2);
    stab(ac, b, [C5, E5, G5, C6], WIN_FINALE, 1.4, 0.2);
    crash(ac, b, WIN_FINALE, 0.8, 0.12);

    setTimeout(() => void ac.close(), 2600);
  } catch {
    /* audio not available */
  }
}
