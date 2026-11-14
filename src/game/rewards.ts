/**
 * Rewards a player keeps: suit colours that open up as missions are finished.
 * Pure rules (no screens), so they are easy to test. A colour's rule looks only at the best stars
 * the profile has for each world and level (`profile.best`, keyed "mars.cadet", "moon.legend", ...).
 */
export type SuitRule = 'free' | 'win' | 'stars2' | 'moon' | 'stars3';

/** Every suit colour (the same list as the cadet's choices) and what it takes to wear it. */
export const SUIT_REWARDS: readonly { color: string; rule: SuitRule }[] = [
  { color: '#ff8a3d', rule: 'free' }, // orange
  { color: '#39c2f0', rule: 'free' }, // sky blue
  { color: '#ff5fa2', rule: 'win' }, // pink: finish any mission
  { color: '#8f7bff', rule: 'stars2' }, // violet: two stars in one mission
  { color: '#4fd98a', rule: 'moon' }, // green: finish a mission on the Moon
  { color: '#ffd166', rule: 'stars3' }, // gold: three stars in one mission
];

export type BestStars = Record<string, number>;

function ruleMet(rule: SuitRule, best: BestStars): boolean {
  const entries = Object.entries(best);
  switch (rule) {
    case 'free':
      return true;
    case 'win':
      return entries.some(([, stars]) => stars >= 1);
    case 'stars2':
      return entries.some(([, stars]) => stars >= 2);
    case 'stars3':
      return entries.some(([, stars]) => stars >= 3);
    case 'moon':
      return entries.some(([key, stars]) => key.startsWith('moon.') && stars >= 1);
  }
}

/** The suit colours that are open for these results. */
export function unlockedSuits(best: BestStars): string[] {
  return SUIT_REWARDS.filter((item) => ruleMet(item.rule, best)).map((item) => item.color);
}

export function suitRule(color: string): SuitRule {
  return SUIT_REWARDS.find((item) => item.color === color)?.rule ?? 'free';
}

/** Colours that open because of a finished mission (open with the new results, closed with the old). */
export function newlyUnlockedSuits(before: BestStars, after: BestStars): string[] {
  const was = new Set(unlockedSuits(before));
  return unlockedSuits(after).filter((color) => !was.has(color));
}

/** The cadet's rank, from the best stars of any finished mission. */
export type Rank = 'cadet' | 'explorer' | 'pilot' | 'commander';

export function rankOf(best: BestStars): Rank {
  const top = Math.max(0, ...Object.values(best));
  return top >= 3 ? 'commander' : top >= 2 ? 'pilot' : top >= 1 ? 'explorer' : 'cadet';
}
