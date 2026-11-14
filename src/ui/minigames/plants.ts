/**
 * The greenhouse game without any screen code. For about half a minute the
 * plants ask for water, light or nutrients. Pick the right tool and tap the
 * plant before its timer runs out, or it wilts for a while.
 *
 * `rand` is passed in so the tests can replay a game exactly.
 */
import type { Level } from './score';

export type Need = 'water' | 'light' | 'food';
export const NEEDS: readonly Need[] = ['water', 'light', 'food'];

export type PlantKind = 'lettuce' | 'tomato' | 'radish' | 'pepper' | 'wheat' | 'strawberry';
export const PLANTS: readonly PlantKind[] = ['lettuce', 'tomato', 'radish', 'pepper', 'wheat', 'strawberry'];

export interface PlantTune {
  gameMs: number;
  /** Plants to help for a win. */
  goal: number;
  /** How long a plant waits for help before it wilts. */
  needMs: number;
  /** How long a wilted plant rests before it can ask again. */
  wiltMs: number;
  /** A plant that was just helped waits this long before it asks again. */
  restMs: number;
  /** More wilted plants than this ends the game. */
  maxWilts: number;
  /** Most plants asking at the same time: before `rushMs`, and after. */
  most: readonly [number, number];
  rushMs: number;
  /** Time between two requests: at the start of the game, and at the end. */
  gap: readonly [number, number];
}

export const PLANT_LEVELS: Record<Level, PlantTune> = {
  1: { gameMs: 30_000, goal: 6, needMs: 6_500, wiltMs: 3_500, restMs: 1_200, maxWilts: 3, most: [1, 2], rushMs: 8_000, gap: [2_600, 1_900] },
  2: { gameMs: 30_000, goal: 8, needMs: 5_500, wiltMs: 4_000, restMs: 1_200, maxWilts: 2, most: [2, 3], rushMs: 8_000, gap: [2_300, 1_500] },
  3: { gameMs: 36_000, goal: 12, needMs: 4_800, wiltMs: 4_000, restMs: 1_000, maxWilts: 2, most: [2, 3], rushMs: 5_000, gap: [1_900, 1_150] },
};

/** No new requests in the last moments, so every request can still be answered. */
const QUIET_END_MS = 2_000;

export interface Pot {
  plant: PlantKind;
  need: Need | null;
  /** Game time (ms) when the current request started. */
  needAt: number;
  wiltUntil: number;
  /** No new request before this time. */
  readyAt: number;
  happyAt: number;
  /** What the plant got the last time it was helped: the picture shows it arriving. */
  got: Need | null;
  shakeAt: number;
  /** One step for every time the plant was helped: it grows a little each time. */
  growth: number;
}

export type GardenPhase = 'ready' | 'play' | 'over';

export interface Garden {
  tune: PlantTune;
  phase: GardenPhase;
  /** The tool in the player's hand. */
  tool: Need | null;
  /** Game time in ms: only runs while playing and while the page is visible. */
  time: number;
  nextAsk: number;
  lastNeed: Need | null;
  helped: number;
  wilts: number;
  /** Taps with no tool or the wrong tool. */
  mistakes: number;
  /** Plants helped in a row, without a mistake or a wilted plant in between. */
  streak: number;
  bestStreak: number;
  pots: Pot[];
  /** A short message under the garden, with the game time it was said. */
  note: { key: string; at: number; n?: number } | null;
}

export type GardenEvent = 'wilt' | 'won' | 'lost';
export type TapResult = 'resting' | 'fine' | 'noTool' | 'wrong' | 'good';

const pick = (count: number, rand: () => number): number => Math.min(count - 1, Math.floor(rand() * count));

function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = pick(i + 1, rand);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function newGarden(level: Level, rand: () => number = Math.random): Garden {
  return {
    tune: PLANT_LEVELS[level],
    phase: 'ready',
    tool: null,
    time: 0,
    nextAsk: 600,
    lastNeed: null,
    helped: 0,
    wilts: 0,
    mistakes: 0,
    streak: 0,
    bestStreak: 0,
    pots: shuffled(PLANTS, rand).map((plant) => ({
      plant,
      need: null,
      needAt: 0,
      wiltUntil: -1,
      readyAt: 0,
      happyAt: -Infinity,
      got: null,
      shakeAt: -Infinity,
      growth: 0,
    })),
    note: null,
  };
}

export const gardenWon = (garden: Garden): boolean => garden.helped >= garden.tune.goal && garden.wilts <= garden.tune.maxWilts;

/** One plant that is free starts asking for something. Requests come faster as time runs out. */
function ask(garden: Garden, rand: () => number): void {
  const tune = garden.tune;
  const waiting = garden.pots.filter((pot) => pot.need).length;
  const most = garden.time < tune.rushMs ? tune.most[0] : tune.most[1];
  const free = garden.pots.filter((pot) => !pot.need && pot.wiltUntil <= garden.time && pot.readyAt <= garden.time);
  if (waiting >= most || free.length === 0) {
    garden.nextAsk = garden.time + 300;
    return;
  }
  const pot = free[pick(free.length, rand)];
  // Mostly a different need from the last one, so the tools keep changing.
  const others = NEEDS.filter((need) => need !== garden.lastNeed);
  const need = garden.lastNeed && rand() < 0.2 ? garden.lastNeed : others[pick(others.length, rand)];
  pot.need = need;
  pot.needAt = garden.time;
  garden.lastNeed = need;
  const pace = garden.time / tune.gameMs;
  garden.nextAsk = garden.time + tune.gap[0] + (tune.gap[1] - tune.gap[0]) * pace + (rand() - 0.5) * 600;
}

/** Move the game on by `dt` ms. Returns what happened, so the screen can play sounds. */
export function stepGarden(garden: Garden, dt: number, rand: () => number = Math.random): GardenEvent[] {
  if (garden.phase !== 'play') return [];
  const tune = garden.tune;
  const events: GardenEvent[] = [];
  garden.time = Math.min(tune.gameMs, garden.time + dt);
  for (const pot of garden.pots) {
    if (pot.need && garden.time - pot.needAt >= tune.needMs) {
      pot.need = null;
      pot.wiltUntil = garden.time + tune.wiltMs;
      pot.readyAt = pot.wiltUntil + 600;
      garden.wilts += 1;
      garden.streak = 0;
      garden.note = { key: 'mg.plants.wiltNote', at: garden.time };
      events.push('wilt');
    }
  }
  // The end: time is up, or so many plants wilted that the game cannot be won any more.
  if (garden.time >= tune.gameMs || garden.wilts > tune.maxWilts) {
    garden.phase = 'over';
    garden.note = null;
    for (const pot of garden.pots) pot.need = null;
    events.push(gardenWon(garden) ? 'won' : 'lost');
    return events;
  }
  if (garden.time >= garden.nextAsk && garden.time < tune.gameMs - QUIET_END_MS) ask(garden, rand);
  return events;
}

/** The player taps a plant with the tool in hand. */
export function tapPot(garden: Garden, index: number): TapResult | null {
  if (garden.phase !== 'play') return null;
  const pot = garden.pots[index];
  if (!pot) return null;
  const say = (key: string, n?: number): void => {
    garden.note = { key, at: garden.time, n };
  };
  if (pot.wiltUntil > garden.time) {
    say('mg.plants.resting');
    return 'resting';
  }
  if (!pot.need) {
    say('mg.plants.fine');
    return 'fine';
  }
  if (!garden.tool || garden.tool !== pot.need) {
    pot.shakeAt = garden.time;
    garden.mistakes += 1;
    garden.streak = 0;
    say(garden.tool ? `mg.plants.wants.${pot.need}` : 'mg.plants.pickTool');
    return garden.tool ? 'wrong' : 'noTool';
  }
  pot.got = pot.need;
  pot.need = null;
  pot.happyAt = garden.time;
  pot.readyAt = garden.time + garden.tune.restMs;
  pot.growth += 1;
  garden.helped += 1;
  garden.streak += 1;
  garden.bestStreak = Math.max(garden.bestStreak, garden.streak);
  if (garden.streak >= 3) say('mg.plants.streak', garden.streak);
  else say('mg.plants.good');
  return 'good';
}

/** The three star goals: win; at most one plant wilted; no plant wilted and at most one wrong tap. */
export function plantGoals(garden: Garden): [boolean, boolean, boolean] {
  const won = gardenWon(garden);
  return [won, won && garden.wilts <= 1, won && garden.wilts === 0 && garden.mistakes <= 1];
}
