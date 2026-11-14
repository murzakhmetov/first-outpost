/**
 * Shared base, pure part: the host's reducer, the vote, the countdowns, the walk merge.
 * A host and 2-4 simulated guests play whole missions with the robot decisions from bots.ts,
 * and a crew of four walkers must not beat what one careful-and-greedy player can do alone.
 */
import { describe, expect, it } from 'vitest';
import { addDays } from '../src/sim/ephemeris';
import { EVENTS, optionBlock } from '../src/sim/events';
import { createMission, evaStormChance } from '../src/sim/mission';
import { Rng } from '../src/sim/rng';
import type { EvaResult, MissionConfig, MissionState, OptionId } from '../src/sim/types';
import {
  COOP_TIMING,
  LONGEST_WALK_SECONDS,
  SAMPLE_SLOT_VALUES,
  WALK_SCIENCE_CAP,
  coopApply,
  coopLeave,
  coopMeta,
  coopTick,
  createCoop,
  mergeWalks,
  parseIntent,
  tally,
} from '../src/sim/coop';
import type { CoopSim, CoopStage, Intent, IntentBody, Verdict, WalkResult } from '../src/sim/coop';
import { applyEva, computeWeek, nextWeek, resolveWeek } from '../src/sim/mission';
import { MAX_LEVEL } from '../src/sim/types';
import { BOTS, DATA, play, smartBot } from './bots';
import type { Bot } from './bots';

const SEC = 1000;

function config(seed: number, over: Partial<MissionConfig> = {}): MissionConfig {
  return { site: 'mars', difficulty: 'commander', weeks: 10, startDate: addDays('2021-03-01', 0), seed, tutorial: false, sunMode: 'random', ...over };
}

// ----- A little driver: seats that send intents like a network would -----------------------

class Crew {
  co: CoopSim;
  t = 0;
  seats: string[];
  private counter: Record<string, number> = {};

  constructor(cfg: MissionConfig, count: number) {
    this.seats = Array.from({ length: count }, (_, i) => `s${i}`);
    this.co = createCoop(createMission(cfg, DATA), this.seats, 0);
  }

  /** Send one intent as `from`. It goes through JSON and parseIntent, like a message would. */
  send(from: string, body: IntentBody, over: Partial<{ n: number; w: number; s: CoopStage }> = {}): Verdict {
    const n = over.n ?? (this.counter[from] = (this.counter[from] ?? 0) + 1);
    const raw: Intent = { from, n, w: over.w ?? this.co.mission.week, s: over.s ?? this.co.stage, ...body } as Intent;
    const parsed = parseIntent(JSON.parse(JSON.stringify(raw)));
    expect(parsed).not.toBeNull();
    return coopApply(this.co, parsed!, this.t);
  }

  at(seconds: number): void {
    this.t += seconds * SEC;
    coopTick(this.co, this.t);
  }

  /** Move everybody on until the stage is `stage` (readying, voting the advice, never walking). */
  goTo(stage: CoopStage): void {
    for (let guard = 0; guard < 400 && this.co.stage !== stage; guard++) {
      if (this.co.stage === 'end') throw new Error(`mission ended before ${stage}`);
      this.everybody();
    }
    if (this.co.stage !== stage) throw new Error(`could not reach ${stage}`);
  }

  private everybody(): void {
    const { co } = this;
    for (const id of this.seats) {
      if (!co.seats.includes(id)) continue;
      if (co.stage === 'event') this.send(id, { k: 'vote', o: advised(co.mission) });
      else if (co.stage === 'walk') this.send(id, { k: 'walk', go: false });
      else this.send(id, { k: 'ready', on: true });
    }
  }
}

function advised(state: MissionState): OptionId {
  const event = EVENTS[state.now.eventId!];
  const options = event.options.filter((o) => !optionBlock(o, state)).map((o) => o.id);
  return state.now.advice && options.includes(state.now.advice) ? state.now.advice : options[0];
}

/** Everything a client could rebuild from a snapshot: the state without the plan, and the meta. */
function snapshotOf(co: CoopSim): { mission: Omit<MissionState, 'plan'>; meta: ReturnType<typeof coopMeta> } {
  const { plan: _plan, ...rest } = co.mission;
  return { mission: rest, meta: coopMeta(co, 0) };
}

const snapshot = (co: CoopSim): string => JSON.stringify(snapshotOf(co));

/** JSON writes -0 as 0 and that is fine; everything else must come back as it went in. */
function noNegativeZero<T>(value: T): T {
  if (Object.is(value, -0)) return 0 as T;
  if (Array.isArray(value)) return value.map(noNegativeZero) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, noNegativeZero(v)])) as T;
  }
  return value;
}

// ----- Whole missions ---------------------------------------------------------------------

type WalkPlan = (seat: number, count: number, state: MissionState, rng: Rng) => WalkResult | null;

/** Walkers split the six samples between them (every sample is picked by somebody). */
function slotsFor(seat: number, count: number): number[] {
  const slots: number[] = [];
  for (let slot = 0; slot < SAMPLE_SLOT_VALUES.length; slot++) if (slot % count === seat) slots.push(slot);
  return slots;
}

/** One walker the way tests/bots.ts `play` rolls it: the bot's walk, then the storm alert, then whether it was caught. */
function soloWalk(bot: Bot, state: MissionState, rng: Rng): WalkResult | null {
  const base = bot.eva(state, rng);
  if (!base) return null;
  const alerted = rng.chance(evaStormChance(state));
  return { ...base, alerted, caught: alerted && rng.chance(0.5) };
}

/** A walker who picks only their share of the six samples (so the crew's picks add up to all six). */
function sharedWalk(bot: Bot, seat: number, count: number, state: MissionState, rng: Rng): WalkResult | null {
  const base = soloWalk(bot, state, rng);
  if (!base) return null;
  const picked = slotsFor(seat, count);
  const science = picked.reduce((sum, slot) => sum + SAMPLE_SLOT_VALUES[slot], 0);
  return { ...base, samples: picked.length, science, picked };
}

/**
 * Play one whole mission with `count` seats. Every seat decides like `bot`, in the same order of
 * random draws as tests/bots.ts `play`, so a crew of one must equal a solo player.
 */
function playCrew(cfg: MissionConfig, bot: Bot, count: number, walkPlan: WalkPlan = (_seat, _n, state, rng) => soloWalk(bot, state, rng), snapshots = false): { crew: Crew; rounds: number } {
  const crew = new Crew(cfg, count);
  const rng = new Rng(cfg.seed ^ 0x9e3779b9);
  let rounds = 0;
  let sawStages = 0;
  let walks: (WalkResult | null)[] = [];
  for (let guard = 0; guard < 600 && crew.co.stage !== 'end'; guard++) {
    const { co } = crew;
    const { mission } = co;
    const before = co.rev;
    const wasStage = co.stage;
    switch (co.stage) {
      case 'briefing':
      case 'eventResult':
      case 'report':
        for (const id of crew.seats) crew.send(id, { k: 'ready', on: true });
        break;
      case 'event': {
        const choice = bot.choose(mission, rng);
        for (const id of crew.seats) crew.send(id, { k: 'vote', o: choice });
        break;
      }
      case 'plan': {
        crew.send('s0', { k: 'alloc', a: bot.plan(mission, rng) });
        for (const id of crew.seats) crew.send(id, { k: 'ready', on: true });
        break;
      }
      case 'walk': {
        if (!co.outside) {
          // Each seat decides; the results wait until the walkers are outside.
          walks = crew.seats.map((_, i) => walkPlan(i, count, mission, rng));
          crew.seats.forEach((id, i) => crew.send(id, { k: 'walk', go: walks[i] !== null }));
        } else {
          crew.seats.forEach((id, i) => {
            if (walks[i]) crew.send(id, { k: 'walkEnd', r: walks[i]! });
          });
        }
        break;
      }
    }
    if (snapshots) {
      // A snapshot must survive the wire: what JSON gives back equals the live state. This fails for
      // a Map or Set (they turn into {}), a NaN or Infinity (they turn into null) and a function.
      const live = noNegativeZero(snapshotOf(crew.co));
      expect(JSON.parse(snapshot(crew.co))).toEqual(live);
    }
    if (crew.co.stage !== wasStage) sawStages++;
    rounds++;
    expect(crew.co.rev).toBeGreaterThan(before);
  }
  expect(crew.co.stage).toBe('end');
  expect(sawStages).toBeGreaterThan(cfg.weeks);
  return { crew, rounds };
}

function final(state: MissionState) {
  return { end: state.end, week: state.week, stars: state.stars, science: state.science, air: state.air, food: state.food, dose: Math.round(state.dose * 1000) };
}

describe('whole missions with a crew', () => {
  it('a crew of one plays exactly like one player alone', () => {
    // (Not the random bot: it sets power on a robot that has nothing to build, which setAlloc refuses on purpose.)
    for (const bot of BOTS.filter((b) => b.name !== 'random')) {
      for (let seed = 1; seed <= 12; seed++) {
        const cfg = config(seed, { site: seed % 2 ? 'mars' : 'moon' });
        const solo = play(cfg, bot);
        const { crew } = playCrew(cfg, bot, 1);
        expect(final(crew.co.mission), `${bot.name} seed ${seed}`).toEqual(final(solo));
      }
    }
  });

  it('two to four seats finish whole missions, and every snapshot survives the wire', () => {
    for (const count of [2, 3, 4]) {
      for (const bot of [smartBot, ...BOTS.filter((b) => b.name === 'random')]) {
        for (let seed = 20; seed < 24; seed++) {
          const { crew } = playCrew(config(seed, { weeks: 6, difficulty: 'cadet' }), bot, count, (seat, n, state, rng) => sharedWalk(bot, seat, n, state, rng), true);
          expect(crew.co.mission.end).not.toBeNull();
          expect(crew.co.mission.history.length).toBeGreaterThan(0);
          expect(Object.keys(crew.co.acks)).toHaveLength(count);
        }
      }
    }
  });

  it('applyEva runs once a week however many walk', () => {
    const crew = new Crew(config(5), 4);
    crew.goTo('walk');
    for (const id of crew.seats) crew.send(id, { k: 'walk', go: true });
    expect(crew.co.outside).toBe(true);
    // The same week by hand: the one merged walk (all six samples, the cap) and then the night.
    const mirror = structuredClone(crew.co.mission);
    applyEva(mirror, { seconds: 40, samples: 6, science: WALK_SCIENCE_CAP, chore: false, caught: false, alerted: false, finds: [], materials: { regolith: 0, metal: 0 } });
    resolveWeek(mirror);
    crew.seats.forEach((id, i) => {
      const picked = slotsFor(i, 4);
      crew.send(id, { k: 'walkEnd', r: { seconds: 40, samples: picked.length, science: picked.reduce((s, x) => s + SAMPLE_SLOT_VALUES[x], 0), chore: false, caught: false, alerted: false, picked } });
    });
    expect(crew.co.stage).toBe('report');
    expect(crew.co.mission.science).toBe(mirror.science);
    expect(crew.co.mission.history[crew.co.mission.history.length - 1].week).toBe(1);
    // The walk result counted once: the walk's cap (17), not 4 x something.
    expect(crew.co.mission.now.eva?.science).toBe(WALK_SCIENCE_CAP);
  });
});

// ----- Intents: copies, old messages, strangers ---------------------------------------------

describe('intents', () => {
  it('a copy of an intent changes nothing', () => {
    const crew = new Crew(config(1), 3);
    expect(crew.send('s1', { k: 'ready', on: true }, { n: 1 })).toBe('ok');
    const rev = crew.co.rev;
    expect(crew.send('s1', { k: 'ready', on: true }, { n: 1 })).toBe('dup');
    expect(crew.send('s1', { k: 'ready', on: false }, { n: 1 })).toBe('dup');
    expect(crew.co.rev).toBe(rev);
    expect(crew.co.ready).toEqual(['s1']);
  });

  it('an older message that arrives late is ignored', () => {
    const crew = new Crew(config(1), 2);
    expect(crew.send('s1', { k: 'ready', on: true }, { n: 5 })).toBe('ok');
    expect(crew.send('s1', { k: 'ready', on: false }, { n: 4 })).toBe('dup');
    expect(crew.co.ready).toEqual(['s1']);
  });

  it('a message for another week or stage is stale', () => {
    const crew = new Crew(config(1), 2);
    expect(crew.send('s1', { k: 'ready', on: true }, { s: 'plan' })).toBe('stale');
    expect(crew.send('s1', { k: 'ready', on: true }, { w: 2 })).toBe('stale');
    expect(crew.send('s1', { k: 'vote', o: 'a' })).toBe('stale');
    expect(crew.co.ready).toEqual([]);
  });

  it('a stranger is not in the crew', () => {
    const crew = new Crew(config(1), 2);
    expect(crew.send('zz', { k: 'ready', on: true })).toBe('unknown');
    expect(crew.co.ready).toEqual([]);
  });

  it('building, crafting and room wins wait for the day: never at night or on the report', () => {
    const crew = new Crew(config(2), 2);
    crew.goTo('report');
    expect(crew.send('s1', { k: 'build', id: 'bunker' })).toBe('denied');
    expect(crew.send('s1', { k: 'craft', tool: 'vest', neat: true })).toBe('denied');
    expect(crew.send('s1', { k: 'room', room: 'lab', game: 'spectro' })).toBe('denied');
  });

  it('only the host can say "Go on", and only after 5 seconds', () => {
    const crew = new Crew(config(3), 3);
    crew.send('s0', { k: 'ready', on: true });
    crew.at(2);
    expect(crew.send('s0', { k: 'go' })).toBe('denied');
    crew.at(4);
    expect(crew.send('s1', { k: 'go' })).toBe('denied');
    expect(crew.co.stage).toBe('briefing');
    expect(crew.send('s0', { k: 'go' })).toBe('ok');
    expect(crew.co.stage).not.toBe('briefing');
  });

  it('a walker result from a seat that stayed in, or a second one, is refused', () => {
    const crew = new Crew(config(4), 3);
    crew.goTo('walk');
    crew.send('s0', { k: 'walk', go: true });
    crew.send('s1', { k: 'walk', go: false });
    crew.send('s2', { k: 'walk', go: false });
    expect(crew.co.outside).toBe(true);
    const r: WalkResult = { seconds: 30, samples: 1, science: 2, chore: false, caught: false, alerted: false, picked: [0] };
    expect(crew.send('s1', { k: 'walkEnd', r })).toBe('denied');
    expect(crew.send('s0', { k: 'walkEnd', r })).toBe('ok');
    expect(crew.co.stage).toBe('report');
  });

  it('parseIntent refuses bad numbers, unknown ids and free text', () => {
    const base = { from: 's1', n: 1, w: 1, s: 'plan' };
    const bad: unknown[] = [
      null, 5, 'x', [], {},
      { ...base, k: 'nope' },
      { ...base, from: '' },
      { ...base, from: 'x'.repeat(40), k: 'ask' },
      { ...base, n: 0, k: 'ask' },
      { ...base, n: 1.5, k: 'ask' },
      { ...base, w: 100, k: 'ask' },
      { ...base, s: 'lobby', k: 'ask' },
      { ...base, k: 'vote', o: 'z' },
      { ...base, k: 'vote', o: 'Hello friends' },
      { ...base, k: 'alloc', a: { life: 9, farm: 0, lab: 0, shield: 0 } },
      { ...base, k: 'alloc', a: { life: 1, farm: 1, lab: 1 } },
      { ...base, k: 'alloc', a: { life: -1, farm: 0, lab: 0, shield: 0 } },
      { ...base, k: 'build', id: 'castle' },
      { ...base, k: 'craft', tool: 'vest', neat: 'yes' },
      { ...base, k: 'room', room: 'lab', game: 'chess' },
      { ...base, k: 'find', i: 9 },
      { ...base, k: 'walk', go: 1 },
      { ...base, k: 'walkEnd', r: { seconds: 9999, samples: 1, science: 2, chore: false, caught: false, alerted: false } },
      { ...base, k: 'walkEnd', r: { seconds: 30, samples: 99, science: 2, chore: false, caught: false, alerted: false } },
      { ...base, k: 'walkEnd', r: { seconds: 30, samples: 1, science: 2, chore: false, caught: false, alerted: false, finds: ['say hi'] } },
      { ...base, k: 'walkEnd', r: { seconds: 30, samples: 1, science: 2, chore: false, caught: false, alerted: false, picked: [7] } },
      { ...base, k: 'walkEnd', r: { seconds: 30, samples: 1, science: NaN, chore: false, caught: false, alerted: false } },
    ];
    for (const raw of bad) expect(parseIntent(raw), JSON.stringify(raw)).toBeNull();
    expect(parseIntent({ ...base, k: 'ready', on: true })).not.toBeNull();
  });

  it('a walk result is refused whole above the limits in the docs (120 s, 12 of a material), not trimmed', () => {
    const ok = { seconds: 120, samples: 6, science: 17, chore: false, caught: false, alerted: false, materials: { regolith: 12, metal: 12 } };
    const send = (r: object) => parseIntent({ from: 's0', n: 1, w: 1, s: 'walk', k: 'walkEnd', r });
    expect(send(ok)).not.toBeNull();
    expect(send({ ...ok, seconds: 121 })).toBeNull();
    expect(send({ ...ok, materials: { regolith: 13, metal: 0 } })).toBeNull();
    expect(send({ ...ok, materials: { regolith: 0, metal: 13 } })).toBeNull();
  });

  it('a walk that claims more science than the crew cap is refused, and so is a merge above it', () => {
    const big = { seconds: 30, samples: 6, science: 24, chore: false, caught: false, alerted: false, picked: [0, 1, 2, 3, 4, 5] };
    expect(parseIntent({ from: 's0', n: 1, w: 1, s: 'walk', k: 'walkEnd', r: big })).toBeNull();
    expect(parseIntent({ from: 's0', n: 1, w: 1, s: 'walk', k: 'walkEnd', r: { ...big, science: WALK_SCIENCE_CAP } })).not.toBeNull();
    expect(parseIntent({ from: 's0', n: 1, w: 1, s: 'walk', k: 'walkEnd', r: { ...big, science: WALK_SCIENCE_CAP + 1 } })).toBeNull();
    // mergeWalks does not trust its input either: one walker, six samples, 24 science.
    expect(mergeWalks([big])!.science).toBe(WALK_SCIENCE_CAP);
    expect(mergeWalks([{ ...big, picked: undefined }])!.science).toBe(WALK_SCIENCE_CAP);
    expect(mergeWalks([big], 10)!.science).toBe(10);
  });

  it('a seat id is short letters, digits, dash and underscore', () => {
    const ok = { n: 1, w: 1, s: 'briefing', k: 'ready', on: true };
    expect(parseIntent({ ...ok, from: 's0' })).not.toBeNull();
    expect(parseIntent({ ...ok, from: 'p_3-b' })).not.toBeNull();
    for (const from of ['a b', 'x<y>', 'hi!', '__proto__ ', 'é', 'a'.repeat(17)]) expect(parseIntent({ ...ok, from }), from).toBeNull();
  });

  it('build, craft and room wins carry the stage they were sent in', () => {
    const crew = new Crew(config(2), 2);
    crew.goTo('plan');
    expect(crew.send('s1', { k: 'build', id: 'bunker' }, { s: 'briefing' })).toBe('stale');
    expect(crew.send('s1', { k: 'craft', tool: 'vest', neat: true }, { s: 'walk' })).toBe('stale');
    expect(crew.send('s1', { k: 'room', room: 'lab', game: 'spectro' }, { s: 'event' })).toBe('stale');
    expect(crew.send('s1', { k: 'build', id: 'bunker' }, { s: 'plan' })).not.toBe('stale');
  });

  it('parseIntent survives random junk', () => {
    const rng = new Rng(7);
    const junk = (depth = 0): unknown => {
      const pick = depth > 3 ? rng.int(0, 3) : rng.int(0, 6);
      if (pick === 0) return rng.int(-5, 100);
      if (pick === 1) return rng.chance(0.5);
      if (pick === 2) return 'abc'.repeat(rng.int(0, 20));
      if (pick === 3) return null;
      if (pick === 4) return [junk(depth + 1), junk(depth + 1)];
      const j = () => junk(depth + 1);
      return { from: j(), n: j(), w: j(), s: j(), k: j(), o: j(), a: j(), r: j(), id: j(), i: j() };
    };
    for (let i = 0; i < 3000; i++) expect(() => parseIntent(junk())).not.toThrow();
  });
});

// ----- The vote -------------------------------------------------------------------------

describe('the vote', () => {
  const all: OptionId[] = ['a', 'b', 'c'];

  it('most votes win', () => {
    expect(tally({ s0: 'a', s1: 'b', s2: 'b' }, 's0', 'a', all)).toBe('b');
  });

  it('a tie goes to the host', () => {
    expect(tally({ s0: 'b', s1: 'a', s2: 'a', s3: 'b' }, 's0', 'a', all)).toBe('b');
    expect(tally({ s0: 'a', s1: 'b' }, 's0', 'b', all)).toBe('a');
  });

  it('a tie that does not include the host goes to the advice, then to the first option', () => {
    expect(tally({ s0: 'c', s1: 'a', s2: 'b' }, 's0', 'b', all)).toBe('c'); // a three-way tie that has the host in it: the host
    expect(tally({ s1: 'a', s2: 'b' }, 's0', 'b', all)).toBe('b'); // the host did not vote: advice
    expect(tally({ s0: 'c', s1: 'a', s2: 'b', s3: 'a', s4: 'b' }, 's0', 'b', all)).toBe('b'); // host voted c (1), a and b tie at 2: advice
    expect(tally({ s1: 'a', s2: 'b' }, 's0', 'c', all)).toBe('a'); // advice not in the tie: first
  });

  it('with no votes the advice wins', () => {
    expect(tally({}, 's0', 'b', all)).toBe('b');
    expect(tally({}, 's0', null, all)).toBe('a');
  });

  it('blocked options never count', () => {
    expect(tally({ s0: 'a', s1: 'a', s2: 'b' }, 's0', 'b', ['b', 'c'])).toBe('b');
    expect(tally({ s0: 'a' }, 's0', 'a', ['b', 'c'])).toBe('b');
    expect(tally({ s0: 'a' }, 's0', 'a', [])).toBeNull();
  });

  /** A crew standing at the first event card. */
  function atEvent(seats: number, seed = 1): Crew {
    for (let s = seed; s < seed + 60; s++) {
      const crew = new Crew(config(s), seats);
      try {
        crew.goTo('event');
        const event = EVENTS[crew.co.mission.now.eventId!];
        if (event.options.filter((o) => !optionBlock(o, crew.co.mission)).length >= 2) return crew;
      } catch {
        // no card in this mission: try the next seed
      }
    }
    throw new Error('no event card found');
  }

  it('the reducer: a 2-2 tie is broken by the host vote', () => {
    const crew = atEvent(4);
    const allowed = EVENTS[crew.co.mission.now.eventId!].options.filter((o) => !optionBlock(o, crew.co.mission)).map((o) => o.id);
    const [x, y] = allowed;
    crew.send('s0', { k: 'vote', o: y });
    crew.send('s1', { k: 'vote', o: x });
    crew.send('s2', { k: 'vote', o: x });
    expect(crew.co.stage).toBe('event');
    crew.send('s3', { k: 'vote', o: y });
    expect(crew.co.stage).toBe('eventResult');
    expect(crew.co.choice?.optionId).toBe(y);
    expect(crew.co.mission.now.eventDone).toBe(true);
    expect(crew.co.contrib.s1.votes).toBe(1);
  });

  it('a vote for a blocked option is refused', () => {
    const crew = atEvent(2, 1);
    const event = EVENTS[crew.co.mission.now.eventId!];
    const blocked = event.options.find((o) => optionBlock(o, crew.co.mission));
    if (blocked) expect(crew.send('s1', { k: 'vote', o: blocked.id })).toBe('denied');
    expect(crew.co.stage).toBe('event');
  });

  it('nobody votes: no countdown runs, and the host\'s Go on ends it with Mission Control\'s advice', () => {
    const crew = atEvent(3);
    const want = advised(crew.co.mission);
    // Nobody answered, so no countdown runs: only a vote starts it. Ask Earth is not a vote.
    crew.at(100);
    expect(crew.co.stage).toBe('event');
    crew.send('s1', { k: 'ask' });
    expect(crew.co.deadline).toBeNull();
    crew.at(COOP_TIMING.vote + 1);
    expect(crew.co.stage).toBe('event');
    // The host's Go on, after 5 s, ends it with nobody voting.
    expect(crew.send('s0', { k: 'go' })).toBe('ok');
    expect(crew.co.stage).toBe('eventResult');
    expect(crew.co.choice?.optionId).toBe(want);
  });

  it('one vote and then silence: the countdown ends the vote with that vote', () => {
    const crew = atEvent(3);
    const allowed = EVENTS[crew.co.mission.now.eventId!].options.filter((o) => !optionBlock(o, crew.co.mission)).map((o) => o.id);
    const pick = allowed[allowed.length - 1];
    crew.send('s2', { k: 'vote', o: pick });
    crew.at(COOP_TIMING.vote - 1);
    expect(crew.co.stage).toBe('event');
    crew.at(2);
    expect(crew.co.stage).toBe('eventResult');
    expect(crew.co.choice?.optionId).toBe(pick);
  });

  it('a voter who leaves does not hold up the vote', () => {
    const crew = atEvent(3);
    const allowed = EVENTS[crew.co.mission.now.eventId!].options.filter((o) => !optionBlock(o, crew.co.mission)).map((o) => o.id);
    const pick = allowed[allowed.length - 1];
    crew.send('s0', { k: 'vote', o: pick });
    crew.send('s1', { k: 'vote', o: pick });
    expect(crew.co.stage).toBe('event');
    expect(coopLeave(crew.co, 's2', crew.t)).toBe(true);
    expect(crew.co.stage).toBe('eventResult');
    expect(crew.co.choice?.optionId).toBe(pick);
  });

  it('a changed vote counts once, the last one', () => {
    const crew = atEvent(2);
    const allowed = EVENTS[crew.co.mission.now.eventId!].options.filter((o) => !optionBlock(o, crew.co.mission)).map((o) => o.id);
    crew.send('s1', { k: 'vote', o: allowed[0] });
    crew.send('s1', { k: 'vote', o: allowed[1] });
    expect(crew.co.votes.s1).toBe(allowed[1]);
    crew.send('s0', { k: 'vote', o: allowed[1] });
    expect(crew.co.choice?.optionId).toBe(allowed[1]);
  });
});

// ----- Countdowns, leavers -------------------------------------------------------------------

describe('ready sets and deadlines', () => {
  it('nobody is hurried until somebody answers', () => {
    const crew = new Crew(config(1), 3);
    crew.at(600);
    expect(crew.co.stage).toBe('briefing');
    expect(crew.co.deadline).toBeNull();
    expect(coopMeta(crew.co, crew.t).left).toBeNull();
  });

  it('the countdown starts at the first answer and moves on with those who answered', () => {
    const crew = new Crew(config(1), 3);
    crew.at(7);
    crew.send('s1', { k: 'ready', on: true });
    expect(coopMeta(crew.co, crew.t).left).toBe(COOP_TIMING.ready);
    crew.at(COOP_TIMING.ready - 1);
    expect(crew.co.stage).toBe('briefing');
    expect(coopMeta(crew.co, crew.t).left).toBe(1);
    crew.at(1);
    expect(crew.co.stage).not.toBe('briefing');
    expect(crew.co.ready).toEqual([]);
  });

  it('un-ready keeps the countdown, everybody ready moves on at once', () => {
    const crew = new Crew(config(1), 2);
    crew.send('s1', { k: 'ready', on: true });
    crew.send('s1', { k: 'ready', on: false });
    expect(crew.co.deadline).not.toBeNull();
    crew.send('s0', { k: 'ready', on: true });
    expect(crew.co.stage).toBe('briefing');
    crew.send('s1', { k: 'ready', on: true });
    expect(crew.co.stage).not.toBe('briefing');
  });

  it('a plan that needs more power than there is is denied and leaves the plan as it was', () => {
    const crew = new Crew(config(1), 2);
    crew.goTo('plan');
    const before = { ...crew.co.mission.alloc };
    const rev = crew.co.rev;
    const verdict = crew.send('s0', { k: 'alloc', a: { ...MAX_LEVEL } });
    expect(verdict).toBe('denied');
    expect(crew.co.mission.alloc).toEqual(before);
    expect(crew.co.rev).toBe(rev);
  });

  it('a plan edit clears every Ready, and the plan still ends 90 seconds after the first Ready', () => {
    const crew = new Crew(config(1), 3);
    crew.goTo('plan');
    const t0 = crew.t;
    crew.send('s1', { k: 'ready', on: true });
    crew.send('s2', { k: 'ready', on: true });
    expect(crew.co.ready).toHaveLength(2);
    const alloc = { ...crew.co.mission.alloc };
    const other = alloc.life > 0 ? { ...alloc, life: alloc.life - 1 } : { ...alloc, life: 1 };
    crew.send('s0', { k: 'alloc', a: other });
    expect(crew.co.ready).toEqual([]);
    expect(crew.co.deadline).toBeNull();
    // Keep editing and re-readying: the cap does not move.
    for (let i = 0; i < 4; i++) {
      crew.at(20);
      crew.send('s1', { k: 'ready', on: true });
      crew.send('s0', { k: 'alloc', a: i % 2 ? other : alloc });
    }
    expect(crew.co.stage).toBe('plan');
    crew.t = t0 + COOP_TIMING.planCap * SEC - 1;
    expect(coopTick(crew.co, crew.t)).toBe(false);
    crew.t += 2;
    expect(coopTick(crew.co, crew.t)).toBe(true);
    expect(crew.co.stage).not.toBe('plan');
  });

  it('a leaver is dropped from the sets, and the crew goes on', () => {
    const crew = new Crew(config(1), 3);
    crew.send('s0', { k: 'ready', on: true });
    crew.send('s1', { k: 'ready', on: true });
    expect(crew.co.stage).toBe('briefing');
    expect(coopLeave(crew.co, 's2', crew.t)).toBe(true);
    expect(crew.co.seats).toEqual(['s0', 's1']);
    expect(crew.co.stage).not.toBe('briefing');
    // A late message from the leaver is not from the crew any more.
    expect(crew.send('s2', { k: 'ready', on: true })).toBe('unknown');
  });

  it('the host cannot leave; a stranger leaving does nothing', () => {
    const crew = new Crew(config(1), 2);
    const rev = crew.co.rev;
    expect(coopLeave(crew.co, 's0', 0)).toBe(false);
    expect(coopLeave(crew.co, 'zz', 0)).toBe(false);
    expect(crew.co.rev).toBe(rev);
  });

  it('a leaver who held up the walk choice no longer does', () => {
    const crew = new Crew(config(6), 3);
    crew.goTo('walk');
    crew.send('s0', { k: 'walk', go: true });
    crew.send('s1', { k: 'walk', go: false });
    expect(crew.co.outside).toBe(false);
    coopLeave(crew.co, 's2', crew.t);
    expect(crew.co.outside).toBe(true);
    // The one walker (the host) is outside and finishes alone.
    const r: WalkResult = { seconds: 20, samples: 1, science: 4, chore: false, caught: false, alerted: false, picked: [2] };
    crew.send('s0', { k: 'walkEnd', r });
    expect(crew.co.stage).toBe('report');
  });

  it('a walker who leaves outside does not hold the crew: the merge uses who came back', () => {
    const crew = new Crew(config(6), 3);
    crew.goTo('walk');
    crew.send('s0', { k: 'walk', go: true });
    crew.send('s1', { k: 'walk', go: true });
    crew.send('s2', { k: 'walk', go: false });
    expect(crew.co.outside).toBe(true);
    const r: WalkResult = { seconds: 20, samples: 1, science: 4, chore: false, caught: false, alerted: false, picked: [2] };
    crew.send('s0', { k: 'walkEnd', r });
    expect(crew.co.stage).toBe('walk');
    coopLeave(crew.co, 's1', crew.t);
    expect(crew.co.stage).toBe('report');
    expect(crew.co.mission.now.eva?.science).toBe(4);
  });

  it('a walker who never comes back is waited for only until the walk limit plus a minute', () => {
    const crew = new Crew(config(6), 2);
    crew.goTo('walk');
    crew.send('s0', { k: 'walk', go: true });
    crew.send('s1', { k: 'walk', go: true });
    const r: WalkResult = { seconds: 20, samples: 1, science: 4, chore: false, caught: false, alerted: false, picked: [2] };
    crew.send('s0', { k: 'walkEnd', r });
    crew.at(LONGEST_WALK_SECONDS + COOP_TIMING.walkGrace - 1);
    expect(crew.co.stage).toBe('walk');
    crew.at(2);
    expect(crew.co.stage).toBe('report');
    expect(crew.co.mission.now.eva?.science).toBe(4);
  });

  it('a long walk (commander tank 90 s, cadet with tank 110 s) is accepted, a longer one is not', () => {
    const base = { n: 1, w: 1, s: 'walk', k: 'walkEnd' };
    const r = (seconds: number) => ({ seconds, samples: 0, science: 0, chore: false, caught: false, alerted: false });
    expect(parseIntent({ from: 's0', ...base, r: r(85) })).not.toBeNull();
    expect(parseIntent({ from: 's0', ...base, r: r(90) })).not.toBeNull();
    expect(parseIntent({ from: 's0', ...base, r: r(110) })).not.toBeNull();
    expect(parseIntent({ from: 's0', ...base, r: r(LONGEST_WALK_SECONDS + 11) })).toBeNull();
  });

  it('a walker on a cadet tank walk (110 s) is still waited for', () => {
    const crew = new Crew(config(6), 2);
    crew.goTo('walk');
    crew.send('s0', { k: 'walk', go: true });
    crew.send('s1', { k: 'walk', go: true });
    crew.at(LONGEST_WALK_SECONDS - 1);
    crew.send('s0', { k: 'walkEnd', r: { seconds: 110, samples: 1, science: 4, chore: false, caught: false, alerted: false, picked: [2] } });
    crew.send('s1', { k: 'walkEnd', r: { seconds: 110, samples: 1, science: 2, chore: false, caught: false, alerted: false, picked: [0] } });
    expect(crew.co.stage).toBe('report');
    expect(crew.co.mission.now.eva?.science).toBe(6);
  });

  it('nobody walks: no walk is recorded and the night runs', () => {
    const crew = new Crew(config(6), 2);
    crew.goTo('walk');
    crew.send('s0', { k: 'walk', go: false });
    crew.send('s1', { k: 'walk', go: false });
    expect(crew.co.stage).toBe('report');
    expect(crew.co.mission.now.eva).toBeFalsy();
  });

  it('shared work: one print and one room win a week, whoever does it', () => {
    const crew = new Crew(config(8), 3);
    crew.goTo('plan');
    expect(crew.send('s1', { k: 'room', room: 'lab', game: 'spectro' })).toBe('ok');
    expect(crew.send('s2', { k: 'room', room: 'lab', game: 'spectro' })).toBe('denied');
  });
});

// ----- mergeWalks -----------------------------------------------------------------------------

describe('mergeWalks', () => {
  const walk = (over: Partial<WalkResult> = {}): WalkResult => ({ seconds: 30, samples: 0, science: 0, chore: false, caught: false, alerted: false, ...over });

  it('nobody walked: nothing', () => {
    expect(mergeWalks([])).toBeNull();
  });

  it('one walker: the result is theirs, untouched', () => {
    const r = walk({ seconds: 44, samples: 3, science: 9, chore: true, alerted: true, finds: ['x'].slice(1), materials: { regolith: 2, metal: 1 }, picked: [0, 2, 4] });
    const m = mergeWalks([r])!;
    expect(m).toMatchObject({ seconds: 44, samples: 3, science: 12, chore: true, alerted: true, caught: false, materials: { regolith: 2, metal: 1 } });
    expect(m.caughtShare).toBeUndefined();
  });

  it('science is the union of the samples picked: the same sample counts once', () => {
    const a = walk({ samples: 2, science: 6, picked: [0, 2] }); // 2 + 4
    const b = walk({ samples: 2, science: 6, picked: [0, 2] });
    expect(mergeWalks([a, b])!.science).toBe(6);
    const c = walk({ samples: 2, science: 8, picked: [1, 3] }); // 2 + 4
    const m = mergeWalks([a, c])!;
    expect(m.science).toBe(12);
    expect(m.samples).toBe(4);
  });

  it('the crew total is capped at what one walker can do', () => {
    const a = walk({ samples: 3, science: 12, picked: [0, 2, 4] });
    const b = walk({ samples: 3, science: 12, picked: [1, 3, 5] });
    expect(mergeWalks([a, b])!.science).toBe(WALK_SCIENCE_CAP);
    expect(mergeWalks([a, b], 20)!.science).toBe(20);
  });

  it('it is never lower than the best single walker', () => {
    const a = walk({ samples: 3, science: 12, picked: [0, 2, 4] });
    const b = walk({ samples: 0, science: 0, picked: [] });
    expect(mergeWalks([a, b])!.science).toBe(12);
  });

  it('without `picked` the best single walker is used', () => {
    const a = walk({ samples: 3, science: 9 });
    const b = walk({ samples: 4, science: 13, picked: [0, 1, 2, 3] });
    const m = mergeWalks([a, b])!;
    expect(m.science).toBe(13);
    expect(m.samples).toBe(4);
  });

  it('finds are a union, chore is any, seconds the longest, materials the most per kind', () => {
    const a = walk({ seconds: 20, finds: ['f1', 'f2'], materials: { regolith: 3, metal: 0 }, chore: true });
    const b = walk({ seconds: 55, finds: ['f2', 'f3'], materials: { regolith: 1, metal: 2 } });
    const m = mergeWalks([a, b])!;
    expect(m.finds).toEqual(['f1', 'f2', 'f3']);
    expect(m.chore).toBe(true);
    expect(m.seconds).toBe(55);
    expect(m.materials).toEqual({ regolith: 3, metal: 2 });
  });

  it('caught: the share of walkers who were caught', () => {
    const ok = walk({ alerted: true });
    const bad = walk({ alerted: true, caught: true });
    expect(mergeWalks([ok, ok])!.caught).toBe(false);
    expect(mergeWalks([ok, ok])!.caughtShare).toBeUndefined();
    const m = mergeWalks([bad, ok, ok, ok])!;
    expect(m.caught).toBe(true);
    expect(m.caughtShare).toBe(0.25);
    expect(m.alerted).toBe(true);
    expect(mergeWalks([bad, bad])!.caughtShare).toBe(1);
  });

  it('caughtShare scales the storm dose, and a walk without it is as before', () => {
    let tested = 0;
    for (let seed = 1; seed <= 60 && tested < 3; seed++) {
      // The Moon in spring 2023: a solar storm every other week.
      const base = createMission(config(seed, { site: 'moon', startDate: addDays('2023-03-01', 0) }), DATA);
      for (let guard = 0; guard < 10 && !base.end && !(base.now.evaAllowed && evaStormChance(base) > 0); guard++) {
        resolveWeek(base);
        nextWeek(base);
      }
      if (!(base.now.evaAllowed && evaStormChance(base) > 0)) continue;
      const doseAfter = (share: number | undefined): number => {
        const s = structuredClone(base);
        const walk: EvaResult = { seconds: 30, samples: 0, science: 0, chore: false, caught: true, alerted: true };
        if (share !== undefined) walk.caughtShare = share;
        applyEva(s, walk);
        return computeWeek(s).doseAfter;
      };
      const none = doseAfter(undefined);
      const full = doseAfter(1);
      const half = doseAfter(0.5);
      const zero = doseAfter(0);
      expect(full).toBe(none);
      expect(half).toBeLessThan(full);
      expect(zero).toBeLessThan(half);
      tested++;
    }
    expect(tested).toBeGreaterThan(0);
  });
});

// ----- Balance ----------------------------------------------------------------------------------

describe('balance: a crew of four does not beat the solo envelope', () => {
  const RUNS = 120;

  function randomStart(rng: Rng, weeks: number): string {
    const first = Date.UTC(2012, 8, 1);
    const last = Date.UTC(2026, 7, 1) - weeks * 7 * 86_400_000;
    return addDays(new Date(first + rng.next() * (last - first)).toISOString().slice(0, 10), 0);
  }

  /** The greedy walker: always out, takes everything (17 science, all six samples, no cost to chance). */
  const bold: Bot = { ...smartBot, name: 'smart+bold', eva: () => ({ seconds: 60, samples: 5, science: 17, chore: false }) };

  function mean(site: 'mars' | 'moon', run: (cfg: MissionConfig) => MissionState): { stars: number; science: number; three: number } {
    const rng = new Rng(4242);
    let stars = 0;
    let science = 0;
    let three = 0;
    for (let i = 0; i < RUNS; i++) {
      const s = run({ site, difficulty: 'commander', weeks: 10, startDate: randomStart(rng, 10), seed: 500 + i, tutorial: false, sunMode: 'random' });
      stars += s.stars;
      science += s.science;
      if (s.stars === 3) three++;
    }
    return { stars: stars / RUNS, science: science / RUNS, three: (100 * three) / RUNS };
  }

  for (const site of ['mars', 'moon'] as const) {
    it(`${site}: crews of 2, 3 and 4 walkers stay inside the best solo walker's results`, () => {
      // The envelope: the best of every solo style, and the bold walker with the same decisions.
      const solo = [...BOTS, bold].map((bot) => ({ bot: bot.name, ...mean(site, (cfg) => play(cfg, bot)) }));
      const envelope = {
        stars: Math.max(...solo.map((r) => r.stars)),
        science: Math.max(...solo.map((r) => r.science)),
        three: Math.max(...solo.map((r) => r.three)),
      };
      // Tolerance: a crew can come out a little above the best solo walker. The only difference
      // left between a crew and the bold walker is caughtShare (a crew where few were caught takes
      // less storm dose); the test below proves that with caughtShare out of the picture.
      const rows = [2, 3, 4].map((count) => ({
        crew: count,
        ...mean(site, (cfg) => playCrew(cfg, bold, count, (seat, n, state, rng) => sharedWalk(bold, seat, n, state, rng)).crew.co.mission),
      }));
      console.table([...solo, ...rows.map((r) => ({ bot: `crew of ${r.crew}`, stars: r.stars, science: r.science, three: r.three }))]); // same style as balance.test.ts
      for (const row of rows) {
        expect(row.science, `crew of ${row.crew}`).toBeLessThanOrEqual(envelope.science * 1.02);
        expect(row.stars, `crew of ${row.crew}`).toBeLessThanOrEqual(envelope.stars + 0.05);
        expect(row.three, `crew of ${row.crew}`).toBeLessThanOrEqual(envelope.three + 5);
      }
      // About 1,700 whole missions: a few seconds alone, more on a busy machine.
    }, 60_000);
  }

  it('four bold walkers bring home exactly what one bold walker does, never more from one walk', () => {
    // Nobody is ever alerted or caught, so caughtShare is out of the picture: the crew must equal a crew of one.
    const quiet = (seat: number, n: number, state: MissionState, rng: Rng) => {
      const walk = sharedWalk(bold, seat, n, state, rng);
      return walk ? { ...walk, alerted: false, caught: false } : null;
    };
    const one = (_seat: number, _n: number, state: MissionState, rng: Rng): WalkResult | null => {
      const walk = bold.eva(state, rng);
      return walk ? { ...walk, samples: 6, science: WALK_SCIENCE_CAP, alerted: false, caught: false, picked: [0, 1, 2, 3, 4, 5] } : null;
    };
    for (let seed = 1; seed <= 40; seed++) {
      const cfg = config(seed);
      const solo = playCrew(cfg, bold, 1, one).crew.co.mission;
      const four = playCrew(cfg, bold, 4, quiet).crew.co.mission;
      expect(four.science, `seed ${seed}`).toBe(solo.science);
      expect(four.stars, `seed ${seed}`).toBe(solo.stars);
    }
  });
});
