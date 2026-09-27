// Spielregeln an einer Stelle: Standard-Stats, XP-Kurve, Stat-Punkte und Ränge.
// Wer die Balance ändern will, fängt hier an.

/** Stats, mit denen ein neuer Spielstand beginnt. Eigene Stats kommen im Spielstand dazu. */
export const DEFAULT_STATS = [
  { key: "str", abbr: "STR", name: "Stärke" },
  { key: "agi", abbr: "AGI", name: "Beweglichkeit" },
  { key: "vit", abbr: "VIT", name: "Ausdauer" },
  { key: "int", abbr: "INT", name: "Intelligenz" },
  { key: "per", abbr: "PER", name: "Wahrnehmung" },
];
export const START_STAT = 10;
export const POINTS_PER_LEVEL = 5;
export const XP_FIRST_LEVEL = 100; // XP von Level 1 auf 2
export const XP_STEP = 50; // jedes weitere Level braucht so viel mehr
export const RANKS = ["E", "D", "C", "B", "A", "S"];
export const LEVELS_PER_RANK = 10;
export const DEFAULT_QUEST_XP = 50;
export const MAX_ABBR = 5;

/** XP, die für den Aufstieg von `level` auf das nächste Level nötig sind. */
export function xpToNext(level) {
  return XP_FIRST_LEVEL + (level - 1) * XP_STEP;
}

/** Rang E bis S, alle LEVELS_PER_RANK Level einer höher. */
export function rank(level) {
  const i = Math.floor((level - 1) / LEVELS_PER_RANK);
  return RANKS[Math.min(Math.max(i, 0), RANKS.length - 1)];
}
