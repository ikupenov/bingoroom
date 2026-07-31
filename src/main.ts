/* ---------------------------------------------------------------------------
 * Squad Bingo — DOM wiring, rendering, sound, sharing, Meeting Mode.
 * ------------------------------------------------------------------------- */
import "./style.css";
import { finaleFireworks, firework } from "./fireworks";
import { playCombo, playMark, playWin, WIN_BEATS, WIN_FINALE } from "./sound";
import { createVoiceListener } from "./voice";
import {
  buildCard,
  cardKey,
  completedLineCells,
  completeLines,
  cornerIndices,
  freeIndex,
  getCustomWords,
  isPackId,
  lineLabel,
  loadMarks,
  oneAwayCells,
  randomSeed,
  saveMarks,
  setCustomWords,
  type CardConfig,
  type DecoCounts,
  type PackId,
} from "./game";

/* ---------- decorations (Memphis SVG) ---------- */
const PALETTE = ["#ff2e93", "#14c4a6", "#ff8c1a", "#8a4fc7", "#3b5bdb", "#ffd23f"] as const;

type DecoFn = (color: string) => string;
const DECOS: readonly DecoFn[] = [
  (c) => `<svg width="46" height="46" viewBox="0 0 46 46"><path d="M23 3 L43 42 L3 42 Z" fill="${c}" stroke="#1a1714" stroke-width="2.5"/></svg>`,
  (c) => `<svg width="60" height="24" viewBox="0 0 60 24"><path d="M2 12 Q10 0 18 12 T34 12 T50 12 T66 12" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/></svg>`,
  (c) => `<svg width="46" height="26" viewBox="0 0 46 26"><path d="M3 24 A20 20 0 0 1 43 24 Z" fill="${c}" stroke="#1a1714" stroke-width="2.5"/></svg>`,
  (c) => `<svg width="40" height="40" viewBox="0 0 40 40">${[6, 20, 34].flatMap((x) => [6, 20, 34].map((y) => `<circle cx="${x}" cy="${y}" r="3.4" fill="${c}"/>`)).join("")}</svg>`,
  (c) => `<svg width="34" height="34" viewBox="0 0 34 34"><path d="M17 3 V31 M3 17 H31" stroke="${c}" stroke-width="5" stroke-linecap="round"/></svg>`,
  (c) => `<svg width="40" height="40" viewBox="0 0 40 40"><path d="M6 6 L18 6 L12 18 L24 18 L10 38 L16 22 L6 22 Z" fill="${c}" stroke="#1a1714" stroke-width="2"/></svg>`,
  (c) => `<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="none" stroke="${c}" stroke-width="4"/><circle cx="20" cy="20" r="6" fill="${c}"/></svg>`,
];

interface Corner {
  top: string;
  bottom: string;
  left: string;
  right: string;
}
const CORNERS: readonly Corner[] = [
  { top: "auto", bottom: "6px", left: "8px", right: "auto" },
  { top: "auto", bottom: "8px", left: "auto", right: "8px" },
  { top: "28px", bottom: "auto", left: "auto", right: "6px" },
  { top: "auto", bottom: "6px", left: "50%", right: "auto" },
];

const DECO_COUNTS: DecoCounts = {
  shapes: DECOS.length,
  colors: PALETTE.length,
  corners: CORNERS.length,
};

/* ---------- DOM ---------- */
function required<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required element: ${selector}`);
  return el;
}

const cardEl = required<HTMLElement>("#card");
const grid = required<HTMLDivElement>("#grid");
const toast = required<HTMLParagraphElement>("#toast");
const titleEl = required<HTMLHeadingElement>("#title");
const packSelect = required<HTMLSelectElement>("#pack");
const sizeSelect = required<HTMLSelectElement>("#size");
const hint = required<HTMLParagraphElement>("#hint");
const muteBtn = required<HTMLButtonElement>("#mute");
const meetingBtn = required<HTMLButtonElement>("#meeting");
const wordsDialog = required<HTMLDialogElement>("#words-dialog");
const wordsForm = required<HTMLFormElement>("#words-form");
const wordsArea = required<HTMLTextAreaElement>("#words-area");

/* ---------- state ---------- */
let cfg: CardConfig = initialConfig();
let marked = loadMarks(cfg);
let muted = safeGet("bingo:muted") === "1";
let hotCells = new Set<number>();
let currentCells: readonly string[] = [];
let currentFree = -1;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let showTimer: ReturnType<typeof setTimeout> | undefined;

// Progress trackers so we only celebrate newly-reached milestones.
let lineCount = 0;
let cornersDone = false;
let blackoutDone = false;

// Combo: lines completed in quick succession climb an ascending run.
let comboStep = 0;
let lastCelebrateAt = -Infinity;
const COMBO_WINDOW = 1600;
const now = (): number => (globalThis.performance?.now() ?? 0);

function syncProgress(): void {
  lineCount = completeLines(marked, cfg.size).length;
  cornersDone = cornerIndices(cfg.size).every((i) => marked.has(i));
  blackoutDone = marked.size >= cfg.size * cfg.size;
  comboStep = 0;
  lastCelebrateAt = -Infinity;
}

function initialConfig(): CardConfig {
  const params = new URLSearchParams(location.search);
  const prefs = readPrefs();

  const packRaw = params.get("pack") ?? prefs.pack;
  const pack: PackId = isPackId(packRaw) ? packRaw : "standup";

  const sizeRaw = Number(params.get("size") ?? prefs.size);
  const size = sizeRaw === 5 ? 5 : 3;

  const seed = params.get("seed") ?? randomSeed();
  return { seed, pack, size };
}

interface Prefs {
  pack: string;
  size: string;
}
function readPrefs(): Prefs {
  return {
    pack: safeGet("bingo:pack") ?? "standup",
    size: safeGet("bingo:size") ?? "3",
  };
}

/* ---------- rendering ---------- */
function render(): void {
  clearTimeout(toastTimer);
  toast.classList.remove("show");
  titleEl.textContent = "…";

  const built = buildCard(cfg, DECO_COUNTS);
  titleEl.textContent = built.title;
  currentCells = built.cells;
  currentFree = built.free;

  grid.style.setProperty("--size", String(cfg.size));
  grid.classList.toggle("grid--lg", cfg.size >= 5);
  grid.innerHTML = "";

  built.cells.forEach((word, i) => {
    const isFree = i === built.free;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell" + (isFree ? " cell--free" : "");
    cell.dataset.index = String(i);
    cell.setAttribute("aria-pressed", String(marked.has(i)));
    if (marked.has(i)) cell.classList.add("marked");

    const d = built.decos[i]!;
    const deco = DECOS[d.shape]!(PALETTE[d.color]!);
    const pos = CORNERS[d.corner]!;
    const translate = pos.left === "50%" ? " translateX(-50%)" : "";
    const style = `top:${pos.top};bottom:${pos.bottom};left:${pos.left};right:${pos.right};transform:rotate(${d.rotate}deg)${translate};`;

    cell.innerHTML = `
      <span class="cell__badge">${isFree ? "★" : i + 1}</span>
      <span class="cell__deco" style="${style}">${deco}</span>
      <span class="cell__phrase">${word}</span>
      <svg class="cell__cross" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1="14" y1="18" x2="86" y2="82" />
        <line x1="86" y1="18" x2="14" y2="82" />
      </svg>`;

    if (!isFree) cell.addEventListener("click", () => toggleCell(i));
    grid.appendChild(cell);
  });

  // Restore silently — reflect any already-won lines without replaying the show.
  syncProgress();
  refreshWinHighlight();
  refreshHot();
  syncControls();
}

/* ---------- marking ---------- */
function dismissToast(): void {
  clearTimeout(toastTimer);
  clearTimeout(showTimer);
  toast.classList.remove("show");
}

function toggleCell(i: number): void {
  // A manual tap clears any lingering celebration banner right away.
  dismissToast();
  setMarked(i, !marked.has(i));
}

function setMarked(i: number, on: boolean): void {
  if (on === marked.has(i)) return;
  const cell = grid.querySelector<HTMLElement>(`.cell[data-index="${i}"]`);
  if (on) {
    marked.add(i);
    cell?.classList.add("marked");
    if (!muted) playMark();
    haptic(15);
  } else {
    marked.delete(i);
    cell?.classList.remove("marked");
  }
  cell?.setAttribute("aria-pressed", String(on));
  saveMarks(cfg, marked);
  afterChange();
}

function afterChange(): void {
  refreshWinHighlight();
  refreshHot();
  checkGoals();
}

function haptic(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no vibration API */
  }
}

/* ---------- goals ---------- */
// Fire on every newly-completed line (BINGO -> DOUBLE -> ...), plus the two
// special goals. Lines chain as an ascending combo; corners/blackout get the
// full fanfare payoff.
function checkGoals(): void {
  const lines = completeLines(marked, cfg.size).length;
  const corners = cornerIndices(cfg.size).every((i) => marked.has(i));
  const blackout = marked.size >= cfg.size * cfg.size;

  const gotLine = lines > lineCount;
  const gotCorners = corners && !cornersDone;
  const gotBlackout = blackout && !blackoutDone;

  lineCount = lines;
  cornersDone = corners;
  blackoutDone = blackout;

  if (gotBlackout) {
    comboStep = 0;
    celebrateBig("BLACKOUT!", allCells(), 3600);
  } else if (gotCorners) {
    comboStep = 0;
    celebrateBig("FOUR CORNERS!", cornerIndices(cfg.size), 2000);
  } else if (gotLine) {
    const t = now();
    const chaining = t - lastCelebrateAt < COMBO_WINDOW;
    comboStep = chaining ? comboStep + 1 : 0;
    lastCelebrateAt = t;

    const label = lineLabel(lines);
    const cells = completedLineCells(marked, cfg.size);
    // Isolated line: full satisfying fanfare. Rapid follow-ups: light combo stab.
    if (comboStep === 0) celebrateBig(label, cells, 1600);
    else celebrateLine(label, cells, comboStep);
  }
}

function allCells(): number[] {
  return Array.from({ length: cfg.size * cfg.size }, (_, i) => i);
}

function refreshWinHighlight(): void {
  const winners = new Set<number>();
  for (const line of completeLines(marked, cfg.size)) for (const i of line) winners.add(i);
  grid.querySelectorAll<HTMLElement>(".cell").forEach((el) => {
    el.classList.toggle("win", winners.has(Number(el.dataset.index)));
  });
}

function refreshHot(): void {
  hotCells = oneAwayCells(marked, cfg.size);
  grid.querySelectorAll<HTMLElement>(".cell").forEach((el) => {
    el.classList.toggle("cell--hot", hotCells.has(Number(el.dataset.index)));
  });
  updateHint();
}

/* ---------- celebration (audio + visuals synced) ---------- */
function prefersReducedMotion(): boolean {
  return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function pulseCells(cells: readonly number[]): void {
  if (prefersReducedMotion()) return;
  for (const idx of cells) {
    grid.querySelector<HTMLElement>(`.cell[data-index="${idx}"]`)?.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.09)" }, { transform: "scale(1)" }],
      { duration: 200, easing: "ease-out" },
    );
  }
}

function showToastFor(ms: number): void {
  clearTimeout(showTimer);
  clearTimeout(toastTimer);
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), ms);
}

// A single completed line: instant snappy banner + combo stab + one small burst.
// Reuses `step` so a fast streak reads as one rising chain rather than a pile-up.
function celebrateLine(label: string, cells: readonly number[], step: number): void {
  toast.textContent = label;
  if (!muted) playCombo(step);
  showToastFor(1400);
  if (prefersReducedMotion()) return;

  pulseCells(cells);
  const r = cardEl.getBoundingClientRect();
  firework(r.left + r.width / 2, r.top + r.height * 0.32, 26 + step * 8, 7);
}

// Corners / blackout: full fanfare choreographed to the jingle's beats.
function celebrateBig(label: string, cells: readonly number[], holdMs: number): void {
  toast.textContent = label;
  if (!muted) playWin();
  clearTimeout(toastTimer);
  clearTimeout(showTimer);

  if (prefersReducedMotion()) {
    showToastFor(holdMs);
    return;
  }

  const r = cardEl.getBoundingClientRect();
  const spots: Array<[number, number]> = [
    [r.left + r.width * 0.22, r.top + r.height * 0.8],
    [r.right - r.width * 0.22, r.top + r.height * 0.8],
    [r.left + r.width * 0.5, r.top + r.height * 0.16],
  ];

  WIN_BEATS.forEach((t, i) => {
    setTimeout(() => {
      pulseCells(cells);
      const spot = spots[i];
      if (spot) firework(spot[0], spot[1], 45, 7);
    }, t * 1000);
  });

  // Banner slams in on the finale beat, then holds.
  showTimer = setTimeout(() => {
    toast.classList.add("show");
    pulseCells(cells);
    finaleFireworks();
  }, WIN_FINALE * 1000);
  toastTimer = setTimeout(() => toast.classList.remove("show"), WIN_FINALE * 1000 + holdMs);
}

/* ---------- Meeting Mode (voice) ---------- */
const voice = createVoiceListener({
  onTranscript: autoMark,
  onState: (listening) => {
    meetingBtn.classList.toggle("listening", listening);
    meetingBtn.setAttribute("aria-pressed", String(listening));
    meetingBtn.textContent = listening ? "🔴 Listening…" : "🎙️ Meeting Mode";
    if (listening) flashHint("Meeting Mode on — say the words, I'll cross them off.");
  },
  onError: (e) =>
    flashHint(e === "not-allowed" ? "Mic blocked — allow microphone access." : `Voice error: ${e}`),
});

function normalize(s: string): string {
  return " " + s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim() + " ";
}

// Cross off any unmarked square whose phrase appears in the latest transcript.
function autoMark(text: string): void {
  const hay = normalize(text);
  for (let i = 0; i < currentCells.length; i++) {
    if (i === currentFree || marked.has(i)) continue;
    if (hay.includes(normalize(currentCells[i]!))) setMarked(i, true);
  }
}

/* ---------- card lifecycle ---------- */
function applyConfig(next: CardConfig, opts: { newMarks: boolean }): void {
  cfg = next;
  marked = opts.newMarks ? freshMarks(next) : loadMarks(next);
  writeUrl();
  savePrefs();
  render();
}

function freshMarks(c: CardConfig): Set<number> {
  const marks = new Set<number>();
  const free = freeIndex(c.size);
  if (free >= 0) marks.add(free);
  saveMarks(c, marks);
  return marks;
}

function newCard(): void {
  applyConfig({ ...cfg, seed: randomSeed() }, { newMarks: true });
}

function clearMarks(): void {
  marked = freshMarks(cfg);
  render();
}

function writeUrl(): void {
  const params = new URLSearchParams({ pack: cfg.pack, size: String(cfg.size), seed: cfg.seed });
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
}

/* ---------- controls ---------- */
function syncControls(): void {
  packSelect.value = cfg.pack;
  sizeSelect.value = String(cfg.size);
  muteBtn.textContent = muted ? "🔇" : "🔊";
  muteBtn.setAttribute("aria-pressed", String(muted));
}

let hintTimer: ReturnType<typeof setTimeout> | undefined;
function flashHint(msg: string): void {
  clearTimeout(hintTimer);
  hint.textContent = msg;
  hint.classList.add("hint--flash");
  hintTimer = setTimeout(() => {
    hint.classList.remove("hint--flash");
    updateHint();
  }, 2200);
}

function updateHint(): void {
  if (hint.classList.contains("hint--flash")) return;
  hint.textContent = currentHintText();
}

function currentHintText(): string {
  if (hotCells.size > 0) return "🔥 ONE AWAY!";
  if (cfg.pack === "custom" && getCustomWords().length === 0) {
    return "Custom pack is empty — hit Edit Words to add your own.";
  }
  return "Same link, same card — share it with the squad.";
}

async function share(): Promise<void> {
  const url = location.href;
  try {
    if (navigator.share) {
      await navigator.share({ title: "Squad Bingo", url });
      return;
    }
    await navigator.clipboard.writeText(url);
    flashHint("Link copied! Everyone who opens it gets this exact card.");
  } catch {
    flashHint(url);
  }
}

/* ---------- custom words dialog ---------- */
function openWordsDialog(): void {
  wordsArea.value = getCustomWords().join("\n");
  wordsDialog.showModal();
}

function saveWordsDialog(): void {
  const words = wordsArea.value
    .split("\n")
    .map((w) => w.trim())
    .filter(Boolean);
  setCustomWords(words);
  if (words.length > 0) {
    applyConfig({ ...cfg, pack: "custom", seed: randomSeed() }, { newMarks: true });
  } else {
    updateHint();
  }
}

/* ---------- storage helpers ---------- */
function safeGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}
function savePrefs(): void {
  safeSet("bingo:pack", cfg.pack);
  safeSet("bingo:size", String(cfg.size));
}

/* ---------- events ---------- */
required<HTMLButtonElement>("#new-card").addEventListener("click", newCard);
required<HTMLButtonElement>("#reset").addEventListener("click", clearMarks);
required<HTMLButtonElement>("#share").addEventListener("click", () => void share());
required<HTMLButtonElement>("#edit-words").addEventListener("click", openWordsDialog);

muteBtn.addEventListener("click", () => {
  muted = !muted;
  safeSet("bingo:muted", muted ? "1" : "0");
  syncControls();
});

if (!voice.supported) {
  meetingBtn.disabled = true;
  meetingBtn.title = "Meeting Mode needs Chrome or Edge";
  meetingBtn.textContent = "🎙️ Meeting Mode (Chrome)";
} else {
  meetingBtn.addEventListener("click", () => {
    if (voice.listening()) voice.stop();
    else voice.start();
  });
}

packSelect.addEventListener("change", () => {
  const pack: PackId = isPackId(packSelect.value) ? packSelect.value : "standup";
  applyConfig({ ...cfg, pack, seed: randomSeed() }, { newMarks: true });
});

sizeSelect.addEventListener("change", () => {
  const size = Number(sizeSelect.value) === 5 ? 5 : 3;
  applyConfig({ ...cfg, size, seed: randomSeed() }, { newMarks: true });
});

// `submit` fires with a reliable `submitter`; the dialog still closes natively.
wordsForm.addEventListener("submit", (event) => {
  const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
  if (submitter?.value === "save") saveWordsDialog();
});

/* ---------- boot ---------- */
writeUrl();
savePrefs();
console.info(`Squad Bingo card ${cardKey(cfg)}`);
render();
