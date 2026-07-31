/* ---------------------------------------------------------------------------
 * Squad Bingo — pure game logic (no DOM).
 * Deterministic from a seed so cards are shareable + reproducible.
 * ------------------------------------------------------------------------- */

export type PackId = "standup" | "sales" | "allhands" | "custom";

export interface Pack {
  label: string;
  words: readonly string[];
}

// Each built-in pack has >= 25 words so it can fill a 5x5 board.
export const PACKS: Record<Exclude<PackId, "custom">, Pack> = {
  standup: {
    label: "Standup",
    words: [
      "FOLKS", "SHIP IT", "FEATURE FLAG", "MOVE FAST", "BLOCKER",
      "STAND UP", "TECH DEBT", "HOTFIX", "ROLLBACK", "HAPPY PATH",
      "EDGE CASE", "SCOPE CREEP", "LGTM", "GREENFIELD", "ROADMAP",
      "MVP", "SPIN UP", "RUBBER DUCK", "YAK SHAVING", "BIKESHED",
      "DRY IT UP", "REGROUP", "QUICK WIN", "DEEP DIVE", "PING ME",
      "DOUBLE CLICK", "SHIP BY FRIDAY", "SPRINT", "BACKLOG", "MERGE CONFLICT",
    ],
  },
  sales: {
    label: "Sales",
    words: [
      "BIG BET", "MOVE THE NEEDLE", "LOW HANGING FRUIT", "TOUCH BASE",
      "CIRCLE BACK", "LEVERAGE", "SYNERGY", "BANDWIDTH", "ALIGNMENT",
      "NORTH STAR", "STAKEHOLDER", "LOOP IN", "VALUE ADD", "GAME CHANGER",
      "SECRET SAUCE", "THOUGHT LEADER", "FULL SEND", "LET'S PIVOT",
      "TABLE THIS", "PER MY LAST", "SOUNDS GOOD", "TAKE IT OFFLINE",
      "PARKING LOT", "ACTION ITEM", "BOIL THE OCEAN", "PEEL THE ONION",
      "DRILL DOWN", "WHEELHOUSE", "LAND AND EXPAND", "MOVING FORWARD",
    ],
  },
  allhands: {
    label: "All-Hands",
    words: [
      "MISSION CRITICAL", "TIGER TEAM", "WAR ROOM", "FIRE DRILL", "ALL HANDS",
      "HEADCOUNT", "RUNWAY", "BURN RATE", "DISRUPT", "MOONSHOT",
      "DOUBLE DOWN", "10X", "SYNERGIES", "REORG", "OKRs",
      "KPIs", "GROWTH MINDSET", "CUSTOMER OBSESSED", "RAISE THE BAR",
      "THINK BIG", "NORTH STAR", "RIGHT SIZE", "TENFOLD", "BEST IN CLASS",
      "PARADIGM SHIFT", "CORE COMPETENCY", "VALUE PROP", "MOVE UPMARKET",
      "STRATEGIC", "TAILWINDS",
    ],
  },
};

export interface CardConfig {
  seed: string;
  pack: PackId;
  size: number;
}

export interface CellDeco {
  shape: number;
  color: number;
  corner: number;
  /** degrees, roughly -30..30 */
  rotate: number;
}

export interface Card {
  cells: string[];
  decos: CellDeco[];
  /** index of the auto-marked FREE space, or -1 when there is none */
  free: number;
  title: string;
}

/** Number of decoration variants + palette + corner slots the renderer offers. */
export interface DecoCounts {
  shapes: number;
  colors: number;
  corners: number;
}

// Card title reflects the chosen pack.
export const PACK_TITLES: Record<PackId, string> = {
  standup: "STANDUP BINGO",
  sales: "SALES BINGO",
  allhands: "ALL-HANDS BINGO",
  custom: "SQUAD BINGO",
};

/* ---------- seeded RNG (xmur3 hash -> mulberry32) ---------- */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 0..1 generator built from an arbitrary string seed. */
export function makeRng(seed: string): () => number {
  const next = xmur3(seed);
  return mulberry32(next());
}

function seededShuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/* ---------- word pools ---------- */
function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const CUSTOM_KEY = "bingo:customWords";

export function getCustomWords(): string[] {
  const raw = safeStorage()?.getItem(CUSTOM_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((w): w is string => typeof w === "string") : [];
  } catch {
    return [];
  }
}

export function setCustomWords(words: string[]): void {
  safeStorage()?.setItem(CUSTOM_KEY, JSON.stringify(words));
}

/** Raw word list for a pack (custom pulls from storage). May be short. */
export function poolFor(pack: PackId): string[] {
  return pack === "custom" ? getCustomWords() : [...PACKS[pack].words];
}

/**
 * Ensure there are at least `need` words by topping up (deterministically, from
 * the built-in packs) so a short custom list can never break a bigger board.
 * Words already present are used first, so a user's own words always appear.
 */
function ensureEnough(base: readonly string[], need: number): string[] {
  const seen = new Set(base.map((w) => w.toUpperCase()));
  const out = base.slice();
  for (const p of Object.values(PACKS)) {
    if (out.length >= need) break;
    for (const w of p.words) {
      const key = w.toUpperCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(w);
      }
    }
  }
  return out;
}

/** Center index that should be a FREE space (odd boards >= 5 only). */
export function freeIndex(size: number): number {
  return size % 2 === 1 && size >= 5 ? Math.floor((size * size) / 2) : -1;
}

/** Build a full, render-ready card. Same config -> byte-identical card. */
export function buildCard(cfg: CardConfig, counts: DecoCounts): Card {
  const rng = makeRng(`${cfg.pack}|${cfg.size}|${cfg.seed}`);
  const total = cfg.size * cfg.size;

  const title = PACK_TITLES[cfg.pack];
  const pool = ensureEnough(poolFor(cfg.pack), total);
  const cells = seededShuffle(pool, rng).slice(0, total);

  const free = freeIndex(cfg.size);
  if (free >= 0) cells[free] = "FREE";

  const decos: CellDeco[] = cells.map(() => ({
    shape: Math.floor(rng() * counts.shapes),
    color: Math.floor(rng() * counts.colors),
    corner: Math.floor(rng() * counts.corners),
    rotate: Math.floor(rng() * 60) - 30,
  }));

  return { cells, decos, free, title };
}

/* ---------- win detection ---------- */
export function winLines(size: number): number[][] {
  const lines: number[][] = [];
  for (let r = 0; r < size; r++) {
    lines.push(Array.from({ length: size }, (_, c) => r * size + c));
  }
  for (let c = 0; c < size; c++) {
    lines.push(Array.from({ length: size }, (_, r) => r * size + c));
  }
  lines.push(Array.from({ length: size }, (_, i) => i * size + i));
  lines.push(Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)));
  return lines;
}

/** First fully-marked line, or null. */
export function findWin(marked: ReadonlySet<number>, size: number): number[] | null {
  return winLines(size).find((line) => line.every((i) => marked.has(i))) ?? null;
}

/* ---------- lines, corners, one-away ---------- */
export function completeLines(marked: ReadonlySet<number>, size: number): number[][] {
  return winLines(size).filter((line) => line.every((i) => marked.has(i)));
}

/** Union of all cells belonging to a completed line. */
export function completedLineCells(marked: ReadonlySet<number>, size: number): number[] {
  const cells = new Set<number>();
  for (const line of completeLines(marked, size)) for (const i of line) cells.add(i);
  return [...cells];
}

export function cornerIndices(size: number): number[] {
  const last = size - 1;
  return [0, last, size * last, size * size - 1];
}

/** Label for the Nth simultaneous / cumulative completed line. */
export function lineLabel(count: number): string {
  const names = ["BINGO!", "DOUBLE BINGO!", "TRIPLE BINGO!", "QUAD BINGO!"];
  return names[count - 1] ?? `${count}× BINGO!`;
}

/** Unmarked cells that would each complete a line (you're "one away"). */
export function oneAwayCells(marked: ReadonlySet<number>, size: number): Set<number> {
  const hot = new Set<number>();
  for (const line of winLines(size)) {
    let missing = -1;
    let count = 0;
    for (const i of line) {
      if (marked.has(i)) count++;
      else missing = i;
    }
    if (count === size - 1 && missing >= 0) hot.add(missing);
  }
  return hot;
}

/* ---------- persistence ---------- */
export function cardKey(cfg: CardConfig): string {
  return `${cfg.pack}:${cfg.size}:${cfg.seed}`;
}

export function loadMarks(cfg: CardConfig): Set<number> {
  const raw = safeStorage()?.getItem(`bingo:marks:${cardKey(cfg)}`);
  const marks = new Set<number>();
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const n of parsed) if (typeof n === "number") marks.add(n);
      }
    } catch {
      /* ignore corrupt state */
    }
  }
  const free = freeIndex(cfg.size);
  if (free >= 0) marks.add(free);
  return marks;
}

export function saveMarks(cfg: CardConfig, marks: ReadonlySet<number>): void {
  safeStorage()?.setItem(`bingo:marks:${cardKey(cfg)}`, JSON.stringify([...marks]));
}

/* ---------- misc ---------- */
export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function isPackId(value: string): value is PackId {
  return value === "standup" || value === "sales" || value === "allhands" || value === "custom";
}
