// Daily streak and rank: pure (no three.js, no storage), so check-breaker.ts can test it.
export interface Progress { streak: number; lastDay: number; bricks: number }

// Rank comes from lifetime bricks broken, so it only ever grows: visible progress between sessions.
export const RANKS = [
  { name: 'CADET', at: 0 },
  { name: 'PILOT', at: 60 },
  { name: 'ACE', at: 200 },
  { name: 'COMMANDER', at: 500 },
  { name: 'LEGEND', at: 1200 },
];

export const newProgress = (): Progress => ({ streak: 0, lastDay: 0, bricks: 0 });

// Today's wall was cleared. Returns true only the first time that day. Clearing on consecutive days
// extends the streak; missing a day starts it again at 1.
export function clearDay(p: Progress, day: number): boolean {
  if (p.lastDay === day) return false;
  p.streak = p.lastDay === day - 1 ? p.streak + 1 : 1;
  p.lastDay = day;
  return true;
}

// The streak as the player should see it today: still alive if they cleared today or yesterday.
export const liveStreak = (p: Progress, day: number): number => (p.lastDay >= day - 1 ? p.streak : 0);
export const clearedToday = (p: Progress, day: number): boolean => p.lastDay === day;

export function rankOf(bricks: number): { index: number; name: string; into: number; span: number } {
  let index = 0;
  while (index + 1 < RANKS.length && bricks >= RANKS[index + 1].at) index++;
  const next = RANKS[index + 1];
  return { index, name: RANKS[index].name, into: bricks - RANKS[index].at, span: next ? next.at - RANKS[index].at : 0 };
}
