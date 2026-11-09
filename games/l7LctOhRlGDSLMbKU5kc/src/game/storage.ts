export interface ScoreEntry {
  id: string;
  name: string;
  score: number;
  combo: number;
  pizzas: number;
  level: number;
  difficulty: string;
  date: number;
}

const KEY = "bidza-highscores-v1";
const BEST_KEY = "bidza-best-v1";

export function getScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as ScoreEntry[];
    return Array.isArray(arr) ? arr.sort((a, b) => b.score - a.score).slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function saveScore(e: Omit<ScoreEntry, "id" | "date">): ScoreEntry[] {
  const entry: ScoreEntry = {
    ...e,
    id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    date: Date.now(),
  };
  const list = [...getScores(), entry].sort((a, b) => b.score - a.score).slice(0, 8);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* noop */ }
  const best = getBest();
  if (entry.score > best) {
    try { localStorage.setItem(BEST_KEY, String(entry.score)); } catch { /* noop */ }
  }
  return list;
}

export function getBest(): number {
  try {
    const v = Number(localStorage.getItem(BEST_KEY) || "0");
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
}

export function isHighScore(score: number): boolean {
  if (score <= 0) return false;
  const list = getScores();
  if (list.length < 8) return true;
  return score > list[list.length - 1].score;
}
