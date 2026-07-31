/* ---------------------------------------------------------------------------
 * Squad Bingo — DOM wiring, rendering, sound, sharing.
 * ------------------------------------------------------------------------- */
import "./style.css";
import { burstConfetti } from "./confetti";
import {
  buildCard,
  cardKey,
  findWin,
  freeIndex,
  getCustomWords,
  isPackId,
  loadMarks,
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

const grid = required<HTMLDivElement>("#grid");
const toast = required<HTMLParagraphElement>("#toast");
const titleEl = required<HTMLHeadingElement>("#title");
const packSelect = required<HTMLSelectElement>("#pack");
const sizeSelect = required<HTMLSelectElement>("#size");
const hint = required<HTMLParagraphElement>("#hint");
const muteBtn = required<HTMLButtonElement>("#mute");
const wordsDialog = required<HTMLDialogElement>("#words-dialog");
const wordsForm = required<HTMLFormElement>("#words-form");
const wordsArea = required<HTMLTextAreaElement>("#words-area");

/* ---------- state ---------- */
let cfg: CardConfig = initialConfig();
let marked = loadMarks(cfg);
let hasWon = false;
let muted = safeGet("bingo:muted") === "1";

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
  hasWon = false;
  toast.classList.remove("show");
  titleEl.textContent = "…";

  const card = buildCard(cfg, DECO_COUNTS);
  titleEl.textContent = card.title;

  grid.style.setProperty("--size", String(cfg.size));
  grid.classList.toggle("grid--lg", cfg.size >= 5);
  grid.innerHTML = "";

  card.cells.forEach((word, i) => {
    const isFree = i === card.free;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell" + (isFree ? " cell--free" : "");
    cell.dataset.index = String(i);
    cell.setAttribute("aria-pressed", String(marked.has(i)));
    if (marked.has(i)) cell.classList.add("marked");

    const d = card.decos[i]!;
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

    if (!isFree) cell.addEventListener("click", () => toggle(cell, i));
    grid.appendChild(cell);
  });

  // A FREE center counts as already marked — it can complete a line on its own.
  checkWin(false);
  syncControls();
  updateHint();
}

function toggle(cell: HTMLButtonElement, i: number): void {
  if (hasWon) return;
  if (marked.has(i)) {
    marked.delete(i);
    cell.classList.remove("marked");
  } else {
    marked.add(i);
    cell.classList.add("marked");
  }
  cell.setAttribute("aria-pressed", String(marked.has(i)));
  saveMarks(cfg, marked);
  checkWin(true);
}

function checkWin(celebrate: boolean): void {
  const line = findWin(marked, cfg.size);
  if (!line) return;

  hasWon = true;
  for (const idx of line) {
    grid.querySelector<HTMLButtonElement>(`.cell[data-index="${idx}"]`)?.classList.add("win");
  }
  toast.classList.add("show");
  if (celebrate) {
    burstConfetti();
    playWinChime();
  }
}

/* ---------- sound ---------- */
function playWinChime(): void {
  if (muted) return;
  try {
    const Ctx = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ac = new Ctx();
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const t = ac.currentTime + i * 0.11;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.34);
    });
    setTimeout(() => void ac.close(), 900);
  } catch {
    /* audio not available */
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
  hintTimer = setTimeout(() => hint.classList.remove("hint--flash"), 1600);
}

function updateHint(): void {
  if (hint.classList.contains("hint--flash")) return;
  if (cfg.pack === "custom" && getCustomWords().length === 0) {
    hint.textContent = "Custom pack is empty — hit Edit Words to add your own.";
  } else {
    hint.textContent = "Same link, same card — share it with the squad.";
  }
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
