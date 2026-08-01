import { describe, expect, it } from "vitest";
import {
  buildCard,
  completedLineCells,
  completeLines,
  cornerIndices,
  findWin,
  freeIndex,
  lineLabel,
  oneAwayCells,
  PACK_TITLES,
  poolFor,
  transcriptMatches,
  winLines,
  type CardConfig,
  type DecoCounts,
} from "./game";

const COUNTS: DecoCounts = { shapes: 7, colors: 6, corners: 4 };

describe("winLines", () => {
  it("produces rows, cols, and both diagonals for 3x3", () => {
    const lines = winLines(3);
    expect(lines).toHaveLength(8); // 3 rows + 3 cols + 2 diagonals
    expect(lines).toContainEqual([0, 1, 2]);
    expect(lines).toContainEqual([0, 3, 6]);
    expect(lines).toContainEqual([0, 4, 8]);
    expect(lines).toContainEqual([2, 4, 6]);
  });

  it("produces 12 lines for 5x5", () => {
    expect(winLines(5)).toHaveLength(12); // 5 + 5 + 2
    expect(winLines(5)).toContainEqual([0, 6, 12, 18, 24]);
  });
});

describe("findWin", () => {
  it("returns null when no line is complete", () => {
    expect(findWin(new Set([0, 1, 3]), 3)).toBeNull();
  });

  it("detects a completed row", () => {
    expect(findWin(new Set([3, 4, 5]), 3)).toEqual([3, 4, 5]);
  });

  it("detects a completed diagonal", () => {
    expect(findWin(new Set([0, 4, 8]), 3)).toEqual([0, 4, 8]);
  });

  it("uses the free center toward a win on 5x5", () => {
    // middle column with the free center (12) already marked
    expect(findWin(new Set([2, 7, 12, 17, 22]), 5)).toEqual([2, 7, 12, 17, 22]);
  });
});

describe("freeIndex", () => {
  it("has no free space on a 3x3 board", () => {
    expect(freeIndex(3)).toBe(-1);
  });
  it("puts the free space in the center of a 5x5 board", () => {
    expect(freeIndex(5)).toBe(12);
  });
});

describe("buildCard", () => {
  const cfg: CardConfig = { seed: "abc123", pack: "standup", size: 3 };

  it("is deterministic for a given seed", () => {
    const a = buildCard(cfg, COUNTS);
    const b = buildCard(cfg, COUNTS);
    expect(a.cells).toEqual(b.cells);
    expect(a.decos).toEqual(b.decos);
    expect(a.title).toEqual(b.title);
  });

  it("changes with a different seed", () => {
    const a = buildCard(cfg, COUNTS);
    const b = buildCard({ ...cfg, seed: "different" }, COUNTS);
    expect(a.cells).not.toEqual(b.cells);
  });

  it("titles the card after the pack, not the seed", () => {
    expect(buildCard({ ...cfg, pack: "sales" }, COUNTS).title).toBe(PACK_TITLES.sales);
    // Same pack, different seed -> same title.
    expect(buildCard({ ...cfg, pack: "sales", seed: "zzz" }, COUNTS).title).toBe(PACK_TITLES.sales);
  });

  it("fills every cell and marks a FREE center on 5x5", () => {
    const card = buildCard({ ...cfg, size: 5 }, COUNTS);
    expect(card.cells).toHaveLength(25);
    expect(card.free).toBe(12);
    expect(card.cells[12]).toBe("FREE");
    expect(card.cells.every((c) => c.length > 0)).toBe(true);
  });

  it("keeps decoration indices inside the renderer's ranges", () => {
    const card = buildCard({ ...cfg, size: 5 }, COUNTS);
    for (const d of card.decos) {
      expect(d.shape).toBeGreaterThanOrEqual(0);
      expect(d.shape).toBeLessThan(COUNTS.shapes);
      expect(d.color).toBeLessThan(COUNTS.colors);
      expect(d.corner).toBeLessThan(COUNTS.corners);
    }
  });
});

describe("poolFor", () => {
  it("every built-in pack can fill a 5x5 board", () => {
    for (const pack of ["standup", "sales", "allhands"] as const) {
      expect(poolFor(pack).length).toBeGreaterThanOrEqual(25);
    }
  });
});

describe("lines & goals", () => {
  it("cornerIndices are the four board corners", () => {
    expect(cornerIndices(3)).toEqual([0, 2, 6, 8]);
    expect(cornerIndices(5)).toEqual([0, 4, 20, 24]);
  });

  it("completeLines counts each finished line (fixes 3rd-line-on-5x5)", () => {
    expect(completeLines(new Set([0, 1, 2]), 3)).toHaveLength(1);
    // top row + left column = two lines
    expect(completeLines(new Set([0, 1, 2, 3, 6]), 3)).toHaveLength(2);
    // top row of a 5x5
    expect(completeLines(new Set([0, 1, 2, 3, 4]), 5)).toHaveLength(1);
  });

  it("completedLineCells is the union of finished lines", () => {
    expect(completedLineCells(new Set([3, 4, 5]), 3).sort((a, b) => a - b)).toEqual([3, 4, 5]);
    expect(completedLineCells(new Set([0]), 3)).toEqual([]);
  });

  it("lineLabel escalates with count", () => {
    expect(lineLabel(1)).toBe("BINGO!");
    expect(lineLabel(2)).toBe("DOUBLE BINGO!");
    expect(lineLabel(3)).toBe("TRIPLE BINGO!");
    expect(lineLabel(6)).toBe("6× BINGO!");
  });
});

describe("transcriptMatches", () => {
  it("matches a phrase spoken in a sentence", () => {
    expect(transcriptMatches("ok let's circle back on that", "CIRCLE BACK")).toBe(true);
    expect(transcriptMatches("that's real synergy right there", "SYNERGY")).toBe(true);
  });

  it("tolerates plurals / trailing s", () => {
    expect(transcriptMatches("we have a few blockers", "BLOCKER")).toBe(true);
    expect(transcriptMatches("check the feature flags", "FEATURE FLAG")).toBe(true);
  });

  it("respects word boundaries (no false positives)", () => {
    expect(transcriptMatches("relationship issues", "SHIP IT")).toBe(false);
    expect(transcriptMatches("the mvps of the team", "MVP")).toBe(true); // mvps -> mvp
  });

  it("does not match when absent", () => {
    expect(transcriptMatches("nothing relevant here", "MOONSHOT")).toBe(false);
  });

  it("handles punctuation and casing from the recognizer", () => {
    expect(transcriptMatches("Let's ship it!", "SHIP IT")).toBe(true);
  });
});

describe("oneAwayCells", () => {
  it("finds the single square that completes a line", () => {
    // top row missing index 2
    expect(oneAwayCells(new Set([0, 1]), 3)).toEqual(new Set([2]));
  });
  it("is empty when no line is one away", () => {
    expect(oneAwayCells(new Set([0]), 3).size).toBe(0);
  });
  it("does not flag an already-complete line", () => {
    expect(oneAwayCells(new Set([0, 1, 2]), 3).has(2)).toBe(false);
  });
});
