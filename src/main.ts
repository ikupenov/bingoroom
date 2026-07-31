/* ---------------------------------------------------------------------------
 * Squad Bingo — retro meeting-buzzword bingo
 * ------------------------------------------------------------------------- */
import "./style.css";

// The pool of "meeting words" we draw from. Mix of corporate speak,
// eng-standup lingo, and classic buzzword-bingo fodder.
const WORD_BANK: readonly string[] = [
  "FOLKS", "DIVIDE AND CONQUER", "SMASH IT", "FEATURE FLAG", "BIG BET",
  "MOVE FAST", "SHIP IT", "CIRCLE BACK", "SYNERGY", "LOW HANGING FRUIT",
  "MOVE THE NEEDLE", "DEEP DIVE", "BANDWIDTH", "TOUCH BASE", "LEVERAGE",
  "LET'S PIVOT", "DOUBLE CLICK", "PING ME", "TAKE IT OFFLINE", "ALIGNMENT",
  "QUICK WIN", "NORTH STAR", "PARKING LOT", "SCOPE CREEP", "ACTION ITEM",
  "TECH DEBT", "HOTFIX", "ROLLBACK", "BLOCKER", "STAND UP",
  "HAPPY PATH", "EDGE CASE", "GAME CHANGER", "SECRET SAUCE", "MOONSHOT",
  "TIGER TEAM", "WAR ROOM", "FIRE DRILL", "BOIL THE OCEAN", "PEEL THE ONION",
  "REGROUP", "LGTM", "SHIP BY FRIDAY", "GREENFIELD", "ROADMAP",
  "OKRs", "MVP", "STAKEHOLDER", "TABLE THIS", "LOOP IN",
  "SOUNDS GOOD", "PER MY LAST", "FULL SEND", "RUBBER DUCK", "YAK SHAVING",
  "BIKESHED", "DRY IT UP", "SPIN UP", "UNPACK THAT", "THOUGHT LEADER",
];

const TITLES: readonly string[] = [
  "SQUAD BINGO", "SQUAD 4 BINGO", "STANDUP BINGO", "MEETING BINGO",
  "SPRINT BINGO", "SYNC BINGO", "RETRO BINGO",
];

// Memphis-style decorations, drawn as inline SVG and dropped behind the text.
// Each returns an SVG string; placement is randomized per cell.
const PALETTE: readonly string[] = [
  "#ff2e93", "#14c4a6", "#ff8c1a", "#8a4fc7", "#3b5bdb", "#ffd23f",
];

type DecoFn = (color: string) => string;

const DECOS: readonly DecoFn[] = [
  // filled triangle
  (c) => `<svg width="46" height="46" viewBox="0 0 46 46"><path d="M23 3 L43 42 L3 42 Z" fill="${c}" stroke="#1a1714" stroke-width="2.5"/></svg>`,
  // squiggle
  (c) => `<svg width="60" height="24" viewBox="0 0 60 24"><path d="M2 12 Q10 0 18 12 T34 12 T50 12 T66 12" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/></svg>`,
  // half-circle arch
  (c) => `<svg width="46" height="26" viewBox="0 0 46 26"><path d="M3 24 A20 20 0 0 1 43 24 Z" fill="${c}" stroke="#1a1714" stroke-width="2.5"/></svg>`,
  // dots cluster
  (c) => `<svg width="40" height="40" viewBox="0 0 40 40">${[6, 20, 34].flatMap((x) => [6, 20, 34].map((y) => `<circle cx="${x}" cy="${y}" r="3.4" fill="${c}"/>`)).join("")}</svg>`,
  // plus / cross
  (c) => `<svg width="34" height="34" viewBox="0 0 34 34"><path d="M17 3 V31 M3 17 H31" stroke="${c}" stroke-width="5" stroke-linecap="round"/></svg>`,
  // zigzag bolt
  (c) => `<svg width="40" height="40" viewBox="0 0 40 40"><path d="M6 6 L18 6 L12 18 L24 18 L10 38 L16 22 L6 22 Z" fill="${c}" stroke="#1a1714" stroke-width="2"/></svg>`,
  // concentric circle
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

/* ---------- helpers ---------- */
const rand = (n: number): number => Math.floor(Math.random() * n);
const pick = <T,>(arr: readonly T[]): T => arr[rand(arr.length)]!;

function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// All winning lines on a 3x3 board (indices 0-8).
const LINES: readonly (readonly number[])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6],            // diagonals
];

/* ---------- DOM lookup ---------- */
function required<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required element: ${selector}`);
  return el;
}

const grid = required<HTMLDivElement>("#grid");
const toast = required<HTMLParagraphElement>("#toast");
const titleEl = required<HTMLHeadingElement>("#title");
const newCardBtn = required<HTMLButtonElement>("#new-card");
const resetBtn = required<HTMLButtonElement>("#reset");

/* ---------- state ---------- */
let marked = new Set<number>();
let hasWon = false;

function buildCard(): void {
  marked = new Set();
  hasWon = false;
  toast.classList.remove("show");
  titleEl.textContent = pick(TITLES);

  const words = shuffle(WORD_BANK).slice(0, 9);
  grid.innerHTML = "";

  words.forEach((word, i) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell";
    cell.dataset.index = String(i);

    const deco = pick(DECOS)(pick(PALETTE));
    const pos = pick(CORNERS);
    const translate = pos.left === "50%" ? " translateX(-50%)" : "";
    const style = `top:${pos.top};bottom:${pos.bottom};left:${pos.left};right:${pos.right};transform:rotate(${rand(60) - 30}deg)${translate};`;

    cell.innerHTML = `
      <span class="cell__badge">${i + 1}</span>
      <span class="cell__deco" style="${style}">${deco}</span>
      <span class="cell__phrase">${word}</span>
      <svg class="cell__cross" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1="14" y1="18" x2="86" y2="82" />
        <line x1="86" y1="18" x2="14" y2="82" />
      </svg>`;

    cell.addEventListener("click", () => toggle(cell, i));
    grid.appendChild(cell);
  });
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
  checkWin();
}

function checkWin(): void {
  const winningLine = LINES.find((line) => line.every((idx) => marked.has(idx)));
  if (!winningLine) return;

  hasWon = true;
  winningLine.forEach((idx) => {
    grid.querySelector<HTMLButtonElement>(`.cell[data-index="${idx}"]`)?.classList.add("win");
  });
  toast.classList.add("show");
}

function clearMarks(): void {
  marked.clear();
  hasWon = false;
  toast.classList.remove("show");
  grid.querySelectorAll(".cell").forEach((c) => c.classList.remove("marked", "win"));
}

newCardBtn.addEventListener("click", buildCard);
resetBtn.addEventListener("click", clearMarks);

buildCard();
