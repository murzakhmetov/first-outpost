/**
 * Balance check: thousands of simulated missions with different robot players.
 * Run with `npm test`. The printed table shows how each play style does.
 */
import { describe, expect, it } from 'vitest';
import { addDays } from '../src/sim/ephemeris';
import { Rng } from '../src/sim/rng';
import type { Difficulty, MissionConfig, SiteId } from '../src/sim/types';
import { BOTS, DATA, play } from './bots';
import type { Bot } from './bots';

const RUNS = 300;

function randomStart(rng: Rng, weeks: number): string {
  // Any real date from the Curiosity era to 2026, so both data sets apply.
  const first = Date.UTC(2012, 8, 1);
  const last = Date.UTC(2026, 7, 1) - weeks * 7 * 86_400_000;
  return addDays(new Date(first + rng.next() * (last - first)).toISOString().slice(0, 10), 0);
}

interface Row {
  site: SiteId;
  difficulty: Difficulty;
  weeks: number;
  bot: string;
  survive: number;
  stars: number;
  science: number;
  air: number;
  food: number;
  radiation: number;
  dosePct: number;
  /** Missions with three stars, %. */
  three: number;
}

function run(site: SiteId, difficulty: Difficulty, weeks: number, bot: Bot, roomGames = false): Row {
  const rng = new Rng(12345);
  const ends = { complete: 0, air: 0, food: 0, radiation: 0 };
  let stars = 0;
  let science = 0;
  let dosePct = 0;
  let three = 0;
  for (let i = 0; i < RUNS; i++) {
    const config: MissionConfig = {
      site,
      difficulty,
      weeks,
      startDate: randomStart(rng, weeks),
      seed: 1000 + i,
      tutorial: false,
      sunMode: 'random',
    };
    const state = play(config, bot, DATA, roomGames);
    if (state.stars === 3) three += 1;
    ends[state.end ?? 'complete'] += 1;
    stars += state.stars;
    science += state.science;
    dosePct += state.dose / state.doseLimit;
  }
  const pct = (n: number) => Math.round((100 * n) / RUNS);
  return {
    site,
    difficulty,
    weeks,
    bot: roomGames ? `${bot.name}+rooms` : bot.name,
    survive: pct(ends.complete),
    stars: Math.round((stars / RUNS) * 100) / 100,
    science: Math.round(science / RUNS),
    air: pct(ends.air),
    food: pct(ends.food),
    radiation: pct(ends.radiation),
    dosePct: Math.round((100 * dosePct) / RUNS),
    three: pct(three),
  };
}

describe('balance', () => {
  const rows: Row[] = [];
  const sites: SiteId[] = ['mars', 'moon'];
  const setups: [Difficulty, number][] = [
    ['cadet', 6],
    ['commander', 10],
    ['legend', 10],
  ];
  for (const site of sites) {
    for (const [difficulty, weeks] of setups) {
      for (const bot of BOTS) rows.push(run(site, difficulty, weeks, bot));
    }
    // The careful player who also wins a room game every week.
    rows.push(run(site, 'commander', 10, BOTS.find((bot) => bot.name === 'careful')!, true));
  }
  console.table(rows);
  const find = (site: SiteId, difficulty: Difficulty, bot: string) =>
    rows.find((row) => row.site === site && row.difficulty === difficulty && row.bot === bot)!;

  it('careful play survives the standard mission on both worlds', () => {
    for (const site of sites) {
      expect(find(site, 'commander', 'careful').survive).toBeGreaterThanOrEqual(85);
      expect(find(site, 'commander', 'smart').survive).toBeGreaterThanOrEqual(80);
    }
  });

  it('the first mission is forgiving', () => {
    for (const site of sites) {
      expect(find(site, 'cadet', 'careful').survive).toBeGreaterThanOrEqual(95);
      expect(find(site, 'cadet', 'random').survive).toBeGreaterThanOrEqual(35);
    }
  });

  it('chasing only science is punished', () => {
    for (const site of sites) {
      expect(find(site, 'commander', 'greedy').survive).toBeLessThan(find(site, 'commander', 'smart').survive);
    }
  });

  it('hiding in the base earns no science stars', () => {
    for (const site of sites) {
      const turtle = find(site, 'commander', 'turtle');
      expect(turtle.stars).toBeLessThanOrEqual(1.05);
      expect(find(site, 'commander', 'smart').stars).toBeGreaterThan(turtle.stars);
    }
  });

  it('room games help a little, but stars still come from the power plan', () => {
    for (const site of sites) {
      const plain = find(site, 'commander', 'careful');
      const rooms = find(site, 'commander', 'careful+rooms');
      expect(rooms.stars).toBeGreaterThan(plain.stars);
      expect(rooms.stars - plain.stars).toBeLessThan(1);
      expect(rooms.three).toBeLessThan(40);
    }
  });

  it('careless play fails often enough to teach', () => {
    for (const site of sites) {
      expect(find(site, 'commander', 'random').survive).toBeLessThanOrEqual(75);
    }
  });
});
