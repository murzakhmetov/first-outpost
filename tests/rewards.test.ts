/** Suit colours as rewards: what opens them, and that every colour in the game has a rule. */
import { describe, expect, it } from 'vitest';
import { SUIT_REWARDS, newlyUnlockedSuits, rankOf, suitRule, unlockedSuits } from '../src/game/rewards';
import { SUIT_COLORS } from '../src/world/astronaut';

describe('suit rewards', () => {
  it('has a rule for every suit colour of the game, in the same order', () => {
    expect(SUIT_REWARDS.map((item) => item.color)).toEqual([...SUIT_COLORS]);
  });

  it('opens two colours for a new player and the rest with finished missions', () => {
    expect(unlockedSuits({})).toEqual(['#ff8a3d', '#39c2f0']);
    // A lost mission has 0 stars: it opens nothing.
    expect(unlockedSuits({ 'mars.cadet': 0 })).toEqual(['#ff8a3d', '#39c2f0']);
    expect(unlockedSuits({ 'mars.cadet': 1 })).toContain('#ff5fa2');
    expect(unlockedSuits({ 'mars.cadet': 1 })).not.toContain('#8f7bff');
    expect(unlockedSuits({ 'mars.cadet': 2 })).toContain('#8f7bff');
    expect(unlockedSuits({ 'mars.legend': 3 })).toContain('#ffd166');
  });

  it('opens the green suit only with a finished Moon mission', () => {
    expect(unlockedSuits({ 'mars.legend': 3 })).not.toContain('#4fd98a');
    expect(unlockedSuits({ 'moon.cadet': 1 })).toContain('#4fd98a');
  });

  it('names what a finished mission newly opened', () => {
    expect(newlyUnlockedSuits({}, { 'mars.cadet': 2 }).sort()).toEqual(['#8f7bff', '#ff5fa2']);
    expect(newlyUnlockedSuits({ 'mars.cadet': 2 }, { 'mars.cadet': 2 })).toEqual([]);
    expect(newlyUnlockedSuits({ 'mars.cadet': 1 }, { 'mars.cadet': 3, 'moon.cadet': 1 }).sort()).toEqual(['#4fd98a', '#8f7bff', '#ffd166']);
  });

  it('every colour has a hint text in both languages', async () => {
    const { en } = await import('../src/i18n/en');
    const { ru } = await import('../src/i18n/ru');
    for (const item of SUIT_REWARDS) {
      if (item.rule === 'free') continue;
      expect(en[`suit.lock.${suitRule(item.color)}`], item.color).toBeTruthy();
      expect(ru[`suit.lock.${suitRule(item.color)}`], item.color).toBeTruthy();
    }
  });

  it('ranks follow the best stars of any finished mission', () => {
    expect(rankOf({})).toBe('cadet');
    expect(rankOf({ 'mars.cadet': 0 })).toBe('cadet');
    expect(rankOf({ 'mars.cadet': 1 })).toBe('explorer');
    expect(rankOf({ 'mars.cadet': 1, 'moon.cadet': 2 })).toBe('pilot');
    expect(rankOf({ 'moon.legend': 3 })).toBe('commander');
  });
});
