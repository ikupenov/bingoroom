/* ---------------------------------------------------------------------------
 * Squad Bingo audio. One shared AudioContext so a new celebration can cut the
 * previous one (rapid lines chain into an ascending combo instead of a pile-up).
 *
 * - playMark   : quick stamp on every cross-off
 * - playCombo  : short ascending stab per completed line (stops the previous)
 * - playWin    : full triumphant fanfare, for corners / blackout payoffs
 * ------------------------------------------------------------------------- */

export const WIN_BEATS = [0, 0.2, 0.4] as const;
export const WIN_FINALE = 0.62;
// Roughly how long the full fanfare stays audible (incl. reverb tail).
export const WIN_DURATION = 2.4;

const C4 = 261.63, E4 = 329.63, G4 = 392, B4 = 493.88;
const C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5;

/* ---------- shared context ---------- */
let sharedAC: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    if (!sharedAC) {
      const Ctx =
        globalThis.AudioContext ??
        (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      sharedAC = new Ctx();
    }
    if (sharedAC.state === "suspended") void sharedAC.resume();
    return sharedAC;
  } catch {
    return null;
  }
}

// Master gain of the celebration currently sounding, so the next one can duck it.
let currentCel: GainNode | null = null;

function cutCurrent(c: AudioContext): void {
  if (!currentCel) return;
  try {
    currentCel.gain.cancelScheduledValues(c.currentTime);
    currentCel.gain.setTargetAtTime(0.0001, c.currentTime, 0.03);
  } catch {
    /* node already finished */
  }
  currentCel = null;
}

/* ---------- building blocks ---------- */
function reverb(c: AudioContext, seconds = 2.2, decay = 2.6): ConvolverNode {
  const rate = c.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = c.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  const conv = c.createConvolver();
  conv.buffer = buf;
  return conv;
}

interface Bus {
  master: AudioNode;
  rev: AudioNode;
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

function tone(c: AudioContext, b: Bus, o: ToneOpts): void {
  const osc = c.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.value = o.freq;
  osc.detune.value = o.detune ?? 0;

  const gain = c.createGain();
  let head: AudioNode = osc;
  if (o.cutoff) {
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = o.cutoff;
    osc.connect(lp);
    head = lp;
  }
  head.connect(gain);

  const t = c.currentTime + (o.start ?? 0);
  const dur = o.dur ?? 1;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(o.peak ?? 0.2, t + (o.attack ?? 0.008));
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  gain.connect(b.master);
  gain.connect(b.rev);
  osc.start(t);
  osc.stop(t + dur + 0.1);
}

function brass(c: AudioContext, b: Bus, freq: number, start: number, dur: number, peak = 0.24): void {
  tone(c, b, { freq, start, dur, peak, type: "sawtooth", detune: -6, attack: 0.012, cutoff: 3200 });
  tone(c, b, { freq, start, dur, peak: peak * 0.8, type: "sawtooth", detune: 7, attack: 0.012, cutoff: 3200 });
}

function stab(c: AudioContext, b: Bus, freqs: number[], start: number, dur: number, peak: number): void {
  for (const f of freqs) brass(c, b, f, start, dur, peak);
}

function crash(c: AudioContext, b: Bus, start: number, dur = 0.8, peak = 0.12): void {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.6);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = 5000;
  const g = c.createGain();
  g.gain.value = peak;
  src.connect(f);
  f.connect(g);
  g.connect(b.master);
  g.connect(b.rev);
  src.start(c.currentTime + start);
}

/* ---------- mark stamp ---------- */
export function playMark(): void {
  const c = ac();
  if (!c) return;
  try {
    const t = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(330, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  } catch {
    /* audio not available */
  }
}

/* ---------- combo accent (per extra line while a fanfare rings) ---------- */
// `step` (1-based) climbs a pentatonic scale, so successive lines ascend.
// Layers over the playing fanfare — it does NOT cut it.
export function playCombo(step: number): void {
  const c = ac();
  if (!c) return;
  try {
    const t = c.currentTime;

    const master = c.createGain();
    master.gain.value = 0.9;
    master.connect(c.destination);

    const rev = reverb(c, 1.3, 3);
    const rg = c.createGain();
    rg.gain.value = 0.2;
    rev.connect(rg);
    rg.connect(c.destination);

    const scale = [C5, D5, E5, G5, A5];
    const octave = Math.floor(step / scale.length);
    const freq = scale[step % scale.length]! * Math.pow(2, octave);

    // Bright bell/marimba stab: fundamental + shimmering octave.
    for (const [mult, peak, type] of [
      [1, 0.32, "triangle"],
      [2, 0.12, "sine"],
    ] as const) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      o.connect(g);
      g.connect(master);
      g.connect(rev);
      o.start(t);
      o.stop(t + 0.45);
    }
  } catch {
    /* audio not available */
  }
}

/* ---------- full fanfare (corners / blackout) ---------- */
export function playWin(): void {
  const c = ac();
  if (!c) return;
  try {
    cutCurrent(c);

    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    comp.connect(c.destination);

    const master = c.createGain();
    master.gain.value = 0.9;
    master.connect(comp);
    currentCel = master;

    const rev = reverb(c);
    const rg = c.createGain();
    rg.gain.value = 0.32;
    rev.connect(rg);
    rg.connect(comp);

    const b: Bus = { master, rev };
    stab(c, b, [C4, E4, G4], WIN_BEATS[0], 0.22, 0.2);
    stab(c, b, [E4, G4, B4], WIN_BEATS[1], 0.22, 0.2);
    stab(c, b, [G4, B4, D5], WIN_BEATS[2], 0.22, 0.2);
    stab(c, b, [C5, E5, G5, C6], WIN_FINALE, 1.4, 0.2);
    crash(c, b, WIN_FINALE, 0.8, 0.12);
  } catch {
    /* audio not available */
  }
}
