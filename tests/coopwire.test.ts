/**
 * Shared base, the wire: the `st`, `rec`, `int` and `sync` messages.
 *  - round trip: after every step of whole missions, encode -> JSON -> parse -> adopt equals the host (minus the plan);
 *  - fuzz: the parsers never throw, never let text or an out-of-range number through, and rebuild what they accept;
 *  - the room: who may send what, race mode ignores all of it, the host cannot start a mixed-version crew;
 *  - the real transport subscribes to every event name.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '../src/sim/ephemeris';
import { ROOMS, BUILDINGS, TOOLS } from '../src/sim/outpost';
import { EVENTS, resolveMods } from '../src/sim/events';
import { FINDS, findFlag } from '../src/sim/finds';
import { createMission } from '../src/sim/mission';
import { Rng } from '../src/sim/rng';
import { MAX_LEVEL, MODULES } from '../src/sim/types';
import type { MissionConfig, MissionState, OptionId } from '../src/sim/types';
import { coopApply, coopLeave, coopTick, createCoop, parseIntent } from '../src/sim/coop';
import type { CoopSim, Intent, IntentBody } from '../src/sim/coop';
import {
  adoptLive,
  adoptRecord,
  encodeIntent,
  encodeRecord,
  encodeSnapshot,
  encodeSync,
  liveOf,
  missingRecords,
  parseCoopMessage,
  parseRecord,
  parseSync,
} from '../src/net/coopwire';
import type { CoopSnapshot } from '../src/net/coopwire';
import { COOP_EVENT_NAMES, EVENT_NAMES, MAX_MESSAGE_SIZE, PROTOCOL, channelName, parseMessage, parseStart, sizeLimit, startDateOf } from '../src/net/protocol';
import type { CrewChoice } from '../src/net/protocol';
import { CrewRoom } from '../src/net/room';
import type { RoomView } from '../src/net/room';
import { MemoryHub, MemoryTransport } from '../src/net/transport';
import { CREW_SUITS } from '../src/net/protocol';
import { DATA } from './bots';

const SEC = 1000;
const HOST = 'seat000001';

const strip = (m: MissionState): Record<string, unknown> => {
  const o = JSON.parse(JSON.stringify(m)) as Record<string, unknown>;
  delete o.config;
  delete o.plan;
  delete o.history;
  delete o.decor;
  return o;
};

function config(seed: number, over: Partial<MissionConfig> = {}): MissionConfig {
  return { site: 'mars', difficulty: 'commander', weeks: 6, startDate: addDays('2021-03-01', seed * 9), seed, tutorial: false, sunMode: 'random', ...over };
}

// ----- A crew of random children, and a guest that mirrors the host -----------------------------

class Rig {
  co: CoopSim;
  guest: MissionState;
  t = 0;
  seats: string[];
  bodies: Record<string, unknown>[] = [];
  private counter: Record<string, number> = {};
  checks = 0;
  maxSt = 0;
  maxRec = 0;
  /** The first st this rig sent (a fresh state) and every st and rec size, for the sizes the docs quote. */
  firstSt = 0;
  sizesSt: number[] = [];
  sizesRec: number[] = [];

  constructor(
    readonly cfg: MissionConfig,
    count: number,
    private rng: Rng,
  ) {
    this.seats = Array.from({ length: count }, (_, i) => `seat${String(i + 1).padStart(6, '0')}`);
    this.co = createCoop(createMission(cfg, DATA), this.seats, 0);
    this.guest = createMission(cfg, DATA);
  }

  send(from: string, body: IntentBody): void {
    const intent = { from, n: (this.counter[from] = (this.counter[from] ?? 0) + 1), w: this.co.mission.week, s: this.co.stage, ...body } as Intent;
    const wire = JSON.parse(JSON.stringify(encodeIntent(intent))) as unknown;
    const parsed = parseCoopMessage('int', wire);
    expect(parsed).not.toBeNull();
    if (parsed?.event === 'int') coopApply(this.co, parsed.intent, this.t);
  }

  /** The mirror check: what the host holds is what a guest rebuilds. */
  check(): void {
    const { co } = this;
    const body = JSON.parse(JSON.stringify(encodeSnapshot(HOST, co, this.t))) as Record<string, unknown>;
    const size = JSON.stringify(body).length;
    this.maxSt = Math.max(this.maxSt, size);
    if (!this.sizesSt.length) this.firstSt = size;
    this.sizesSt.push(size);
    expect(size).toBeLessThanOrEqual(sizeLimit('st'));
    const parsed = parseCoopMessage('st', body);
    if (!parsed || parsed.event !== 'st') throw new Error('st did not parse: ' + JSON.stringify(body).slice(0, 400));
    expect(adoptLive(this.guest, parsed.snap.live)).toBe(true);
    expect(strip(this.guest)).toEqual(strip(co.mission));
    expect(parsed.snap.live).toEqual(liveOf(co.mission));
    expect(JSON.parse(JSON.stringify(parsed.snap.meta))).toEqual(JSON.parse(JSON.stringify(parseMetaOf(co, this.t))));
    if (co.rec) {
      const rec = JSON.parse(JSON.stringify(encodeRecord(HOST, co.rec))) as unknown;
      const size2 = JSON.stringify(rec).length;
      this.maxRec = Math.max(this.maxRec, size2);
      this.sizesRec.push(size2);
      expect(size2).toBeLessThanOrEqual(sizeLimit('rec'));
      const back = parseCoopMessage('rec', rec);
      if (!back || back.event !== 'rec') throw new Error('rec did not parse');
      expect(back.rec).toEqual(JSON.parse(JSON.stringify(co.rec)));
      expect(adoptRecord(this.guest, back.rec)).toBe(true);
    }
    if (this.bodies.length < 400 && this.rng.chance(0.15)) this.bodies.push(body);
    this.checks++;
  }

  step(): void {
    const { co, rng } = this;
    if (co.stage === 'end') return;
    const seat = rng.pick(co.seats);
      const roll = rng.next();
    if (roll < 0.12) {
      this.t += rng.int(1, 100) * SEC;
      coopTick(co, this.t);
      return;
    }
    if (roll < 0.14 && co.seats.length > 1) {
      coopLeave(co, rng.pick(co.seats.slice(1)), this.t);
      return;
    }
    if (roll < 0.2) {
      this.send(co.host, { k: 'go' });
      return;
    }
    const option = rng.pick<OptionId>(['a', 'b', 'c']);
    switch (co.stage) {
      case 'briefing':
      case 'eventResult':
      case 'report':
        this.send(seat, { k: 'ready', on: rng.chance(0.85) });
        break;
      case 'event':
        if (rng.chance(0.2)) this.send(seat, { k: 'ask' });
        else this.send(seat, { k: 'vote', o: option });
        break;
      case 'plan': {
        const r = rng.next();
        if (r < 0.3) {
          const a = { life: 0, farm: 0, lab: 0, shield: 0 };
          for (const id of MODULES) a[id] = rng.int(0, MAX_LEVEL[id]);
          this.send(seat, { k: 'alloc', a });
        } else if (r < 0.4) this.send(seat, { k: 'safe' });
        else if (r < 0.5) this.send(seat, { k: 'build', id: rng.pick(BUILDINGS).id });
        else if (r < 0.6) this.send(seat, { k: 'craft', tool: rng.pick(TOOLS).id, neat: rng.chance(0.5) });
        else if (r < 0.7) {
          const room = rng.pick(ROOMS);
          if (room.games.length) this.send(seat, { k: 'room', room: room.id, game: rng.pick(room.games).game });
        } else this.send(seat, { k: 'ready', on: rng.chance(0.8) });
        break;
      }
      case 'walk':
        if (!co.outside) this.send(seat, { k: 'walk', go: rng.chance(0.7) });
        else if (rng.chance(0.3)) this.send(seat, { k: 'find', i: rng.int(0, 3) });
        else {
          const picked = [0, 1, 2, 3, 4, 5].filter(() => rng.chance(0.4));
          this.send(seat, {
            k: 'walkEnd',
            r: {
              seconds: rng.int(10, 90),
              samples: picked.length,
              science: Math.min(17, picked.length * 3),
              chore: rng.chance(0.3),
              caught: rng.chance(0.2),
              alerted: rng.chance(0.3),
              picked,
              materials: { regolith: rng.int(0, 5), metal: rng.int(0, 5) },
            },
          });
        }
        break;
      default:
        break;
    }
  }
}

function parseMetaOf(co: CoopSim, now: number): unknown {
  const snap = JSON.parse(JSON.stringify(encodeSnapshot(HOST, co, now))) as Record<string, unknown>;
  const { s: _s, from: _from, ...meta } = snap;
  return meta;
}

let rigs: Rig[] = [];

// 72 whole missions are played once; the tests below read them.
beforeAll(() => {
  playRigs();
}, 120_000);

function playRigs(): Rig[] {
  if (rigs.length) return rigs;
  let seed = 0;
  for (const site of ['mars', 'moon'] as const) {
    for (const difficulty of ['cadet', 'commander', 'legend'] as const) {
      for (const count of [2, 3, 4]) {
        for (let k = 0; k < 4; k++) {
          seed++;
          const rng = new Rng(seed * 7919);
          const rig = new Rig(config(seed, { site, difficulty, weeks: k % 2 ? 10 : 6 }), count, rng);
          rig.check();
          for (let i = 0; i < 1500 && rig.co.stage !== 'end'; i++) {
            rig.step();
            rig.check();
          }
          rigs.push(rig);
        }
      }
    }
  }
  return rigs;
}

// ----- Round trip ---------------------------------------------------------------------------------

describe('st and rec: what the host holds is what a guest rebuilds', () => {
  it('after every step of 72 whole missions, the mirror equals the host (minus the plan)', () => {
    const all = playRigs();
    const checks = all.reduce((sum, rig) => sum + rig.checks, 0);
    const ended = all.filter((rig) => rig.co.stage === 'end').length;
    expect(checks).toBeGreaterThan(5000);
    expect(ended).toBeGreaterThan(30);
    // Mirrors that saw every record hold the very same history.
    for (const rig of all) {
      expect(rig.guest.history).toEqual(JSON.parse(JSON.stringify(rig.co.mission.history)));
    }
  });

  it('the live state fits its size cap with room to spare, a record too', () => {
    const all = playRigs();
    const st = Math.max(...all.map((rig) => rig.maxSt));
    const rec = Math.max(...all.map((rig) => rig.maxRec));
    expect(st).toBeLessThanOrEqual(2600);
    expect(rec).toBeLessThanOrEqual(1100);
    expect(sizeLimit('st')).toBe(3000);
    expect(sizeLimit('rec')).toBe(1200);
    expect(sizeLimit('int')).toBe(MAX_MESSAGE_SIZE);
    expect(sizeLimit('status')).toBe(MAX_MESSAGE_SIZE);
  });

  it('the sizes docs/MULTIPLAYER.md quotes stay in their measured ranges', () => {
    const all = playRigs();
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const sts = all.flatMap((rig) => rig.sizesSt);
    const recs = all.flatMap((rig) => rig.sizesRec);
    const firsts = all.map((rig) => rig.firstSt);
    // Docs: a fresh st is 0.88-0.92 kB, the middle one 1.1 kB, the largest 1.96 kB; a rec about 0.8 kB.
    expect(Math.min(...firsts)).toBeGreaterThanOrEqual(850);
    expect(Math.max(...firsts)).toBeLessThanOrEqual(950);
    expect(med(sts)).toBeGreaterThanOrEqual(1050);
    expect(med(sts)).toBeLessThanOrEqual(1250);
    expect(Math.max(...sts)).toBeGreaterThanOrEqual(1850);
    expect(Math.max(...sts)).toBeLessThanOrEqual(2100);
    expect(med(recs)).toBeGreaterThanOrEqual(750);
    expect(med(recs)).toBeLessThanOrEqual(900);
    expect(Math.max(...recs)).toBeGreaterThanOrEqual(780);
    expect(Math.max(...recs)).toBeLessThanOrEqual(900);
    // Docs: a power plan is about 100 characters, a walk result with every field at its largest about 275.
    const plan = JSON.stringify(encodeIntent({ from: 'seat000002', n: 1, w: 1, s: 'plan', k: 'alloc', a: { life: 1, farm: 1, lab: 1, shield: 1 } } as Intent));
    expect(plan.length).toBeGreaterThanOrEqual(90);
    expect(plan.length).toBeLessThanOrEqual(130);
    const walk = JSON.stringify(
      encodeIntent({
        from: 'seat000002', n: 12, w: 10, s: 'walk', k: 'walkEnd',
        r: { seconds: 120, samples: 6, science: 17, chore: true, caught: false, alerted: false, finds: [FINDS.mars[0].id, FINDS.mars[1].id, FINDS.mars[2].id, FINDS.mars[3].id], materials: { regolith: 12, metal: 12 }, picked: [0, 1, 2, 3, 4, 5] },
      } as Intent),
    );
    expect(walk.length).toBeGreaterThanOrEqual(260);
    expect(walk.length).toBeLessThanOrEqual(290);
    expect(walk.length).toBeLessThanOrEqual(sizeLimit('int'));
  });

  it('the plan, the history and the config never travel in st', () => {
    const rig = playRigs()[0];
    const text = JSON.stringify(encodeSnapshot(HOST, rig.co, 0));
    for (const key of ['"plan"', '"history"', '"config"', '"decor"']) expect(text).not.toContain(key);
  });

  it('adoptLive refuses a week beyond the mission and leaves the mirror alone', () => {
    const guest = createMission(config(1), DATA);
    const live = liveOf(guest);
    live.week = 7;
    const before = JSON.stringify(guest);
    expect(adoptLive(guest, live)).toBe(false);
    expect(JSON.stringify(guest)).toBe(before);
  });

  it('adoptRecord files the next week, replaces a week, and refuses a gap', () => {
    const rig = playRigs().find((r) => r.co.mission.history.length >= 3)!;
    const history = rig.co.mission.history;
    const guest = createMission(rig.cfg, DATA);
    expect(adoptRecord(guest, history[1])).toBe(false);
    expect(adoptRecord(guest, history[0])).toBe(true);
    expect(adoptRecord(guest, history[0])).toBe(true);
    expect(guest.history).toHaveLength(1);
    expect(adoptRecord(guest, history[1])).toBe(true);
    expect(adoptRecord(guest, { ...history[0], week: 99 })).toBe(false);
    expect(missingRecords(rig.co.mission, 1).map((r) => r.week)).toEqual(history.slice(1).map((r) => r.week));
    expect(missingRecords(rig.co.mission, 99)).toEqual([]);
  });

  it('intents and sync go through the wire as they are', () => {
    const intent = { from: HOST, n: 3, w: 2, s: 'plan', k: 'alloc', a: { life: 1, farm: 2, lab: 0, shield: 1 } } as Intent;
    const back = parseCoopMessage('int', JSON.parse(JSON.stringify(encodeIntent(intent))));
    expect(back).toEqual({ event: 'int', from: HOST, intent });
    expect(parseCoopMessage('sync', encodeSync(HOST, 4))).toEqual({ event: 'sync', from: HOST, have: 4 });
    expect(parseSync({ have: 100 })).toBeNull();
    expect(parseSync({ have: 1.5 })).toBeNull();
    expect(parseSync({ have: '3' })).toBeNull();
  });
});

// ----- Hand-made messages: the specific refusals ------------------------------------------------------

describe('st and rec: what is refused', () => {
  const rig = (): Rig => playRigs().find((r) => r.bodies.length > 3 && r.co.seats.length >= 3)!;
  /** A body from the middle of a mission that has a bit of everything. */
  const body = (): Record<string, any> => JSON.parse(JSON.stringify(rig().bodies.find((b) => (b.s as any).modifiers.length > 0 && (b.s as any).flags.length > 2) ?? rig().bodies[3]));
  const reads = (b: unknown): boolean => parseCoopMessage('st', b) !== null;

  it('the good body is accepted (so the refusals below mean something)', () => {
    expect(reads(body())).toBe(true);
  });

  it('numbers outside what the game can reach', () => {
    const cases: [string, (b: Record<string, any>) => void][] = [
      ['air 101', (b) => (b.s.air = 101)],
      ['air -1', (b) => (b.s.air = -1)],
      ['air as text', (b) => (b.s.air = '50')],
      ['air null', (b) => (b.s.air = null)],
      ['food huge', (b) => (b.s.food = 1e9)],
      ['week 0', (b) => ((b.s.week = 0), (b.week = 0))],
      ['week 100', (b) => ((b.s.week = 100), (b.week = 100))],
      ['week fraction', (b) => ((b.s.week = 1.5), (b.week = 1.5))],
      ['alloc over the limit', (b) => (b.s.alloc.shield = MAX_LEVEL.shield + 1)],
      ['alloc negative', (b) => (b.s.alloc.life = -1)],
      ['stars 4', (b) => (b.s.stars = 4)],
      ['shield 2', (b) => (b.s.shield = 2)],
      ['rev negative', (b) => (b.rev = -1)],
      ['left huge', (b) => (b.left = 1e6)],
      ['stock negative', (b) => (b.s.stock.metal = -1)],
      ['stock fraction', (b) => (b.s.stock.metal = 1.5)],
      ['week differs from meta', (b) => (b.week = b.s.week === 1 ? 2 : 1)],
    ];
    for (const [name, change] of cases) {
      const b = body();
      change(b);
      expect(reads(b), name).toBe(false);
    }
  });

  it('ids that are not on the lists', () => {
    const cases: [string, (b: Record<string, any>) => void][] = [
      ['stage', (b) => (b.stage = 'lobby')],
      ['phase', (b) => (b.s.phase = 'x')],
      ['end', (b) => (b.s.end = 'boredom')],
      ['event', (b) => (b.s.now.eventId = 'meteor_party')],
      ['used event', (b) => (b.s.usedEvents = ['meteor_party'])],
      ['flag', (b) => (b.s.flags = ['hello world'])],
      ['codex', (b) => (b.s.unlocked = ['<b>hi</b>'])],
      ['modifier', (b) => (b.s.modifiers = [{ id: 'free_money', weeks: 3 }])],
      ['tool', (b) => (b.s.tools = ['laser'])],
      ['building', (b) => (b.s.buildings = [{ id: 'castle', progress: 1, done: false }])],
      ['game', (b) => (b.s.now.games = ['hab:chess'])],
      ['eva block', (b) => (b.s.now.evaBlock = 'You are the best!')],
      ['option', (b) => (b.s.now.optionId = 'z')],
    ];
    for (const [name, change] of cases) {
      const b = body();
      change(b);
      expect(reads(b), name).toBe(false);
    }
  });

  it('repeats and long lists', () => {
    const a = body();
    a.s.usedEvents = Array.from({ length: 100 }, () => 'solar_storm');
    expect(reads(a)).toBe(false);
    a.s.unlocked = ['storm_shelter', 'storm_shelter'];
    a.s.usedEvents = [];
    expect(reads(a)).toBe(false);
    const b = body();
    b.s.modifiers = Array.from({ length: 30 }, () => ({ id: 'rested', weeks: 1 }));
    expect(reads(b)).toBe(false);
    const c = body();
    c.s.tools = ['tank', 'tank'];
    expect(reads(c)).toBe(false);
  });

  it('seats: the commander must be the sender and first; strangers, repeats and a fifth seat are refused', () => {
    const b = body();
    expect(parseCoopMessage('st', { ...b, from: 'otherseat01' })).toBeNull();
    const seats = b.seats as string[];
    const swapped = { ...b, seats: [...seats].reverse() };
    expect(reads(swapped)).toBe(false);
    expect(reads({ ...b, seats: [...seats, seats[0]] })).toBe(false);
    expect(reads({ ...b, seats: [...seats, 'extra00001', 'extra00002'] })).toBe(false);
    expect(reads({ ...b, ready: ['stranger001'] })).toBe(false);
    expect(reads({ ...b, votes: { stranger001: 'a' } })).toBe(false);
    expect(reads({ ...b, votes: { [seats[1]]: 'q' } })).toBe(false);
    expect(reads({ ...b, acks: { [seats[1]]: -3 } })).toBe(false);
    expect(reads({ ...b, walk: { [seats[1]]: 'yes' } })).toBe(false);
  });

  it('too big, wrong kind, no sender', () => {
    const b = body();
    expect(parseCoopMessage('st', { ...b, pad: 'x'.repeat(3000) })).toBeNull();
    expect(parseCoopMessage('rec', b)).toBeNull();
    expect(parseCoopMessage('status', b)).toBeNull();
    expect(parseCoopMessage('st', { ...b, from: undefined })).toBeNull();
    expect(parseCoopMessage('st', null)).toBeNull();
    expect(parseCoopMessage('st', [b])).toBeNull();
    expect(parseCoopMessage('st', 'st')).toBeNull();
  });

  it('extra fields never come through', () => {
    const b = body();
    b.extra = 'hello';
    b.s.extra = { a: 1 };
    b.s.now.extra = 'x';
    b.s.alloc.extra = 9;
    const out = parseCoopMessage('st', b);
    expect(out).not.toBeNull();
    expect(JSON.stringify(out)).not.toContain('extra');
    expect(JSON.stringify(out)).not.toContain('hello');
  });

  it('a record: out of range, wrong ids, not a date', () => {
    const r = rig().co.mission.history[0] ?? playRigs().find((x) => x.co.mission.history.length)!.co.mission.history[0];
    const good = () => JSON.parse(JSON.stringify(encodeRecord(HOST, r))) as Record<string, any>;
    expect(parseCoopMessage('rec', good())).not.toBeNull();
    const cases: [string, (b: Record<string, any>) => void][] = [
      ['week 0', (b) => (b.r.week = 0)],
      ['date text', (b) => (b.r.dateFrom = 'last tuesday')],
      ['air', (b) => (b.r.air = 500)],
      ['event', (b) => (b.r.eventId = 'nope')],
      ['reason', (b) => (b.r.sunReason = 'rain')],
      ['storm', (b) => (b.r.storm = 9)],
      ['parts', (b) => (b.r.parts.airLife = 'lots')],
      ['alloc', (b) => (b.r.alloc.farm = 9)],
      ['built', (b) => (b.r.built = 'castle')],
      ['missing field', (b) => delete b.r.hungry],
    ];
    for (const [name, change] of cases) {
      const b = good();
      change(b);
      expect(parseCoopMessage('rec', b), name).toBeNull();
    }
    expect(parseRecord({})).toBeNull();
    expect(parseRecord(null)).toBeNull();
  });

  it('an intent speaks for its own seat only', () => {
    const intent = { from: 'seat000002', n: 1, w: 1, s: 'briefing', k: 'ready', on: true };
    expect(parseCoopMessage('int', intent)).not.toBeNull();
    // The wire sender and the seat in the intent are one field, so they cannot differ; a bad seat id is refused.
    expect(parseCoopMessage('int', { ...intent, from: 'SEAT' })).toBeNull();
    expect(parseCoopMessage('int', { ...intent, k: 'nuke' })).toBeNull();
    expect(parseCoopMessage('int', { ...intent, n: 0 })).toBeNull();
    expect(parseCoopMessage('int', { ...intent, w: 100 })).toBeNull();
    expect(parseCoopMessage('int', { ...intent, k: 'vote', o: 'z' })).toBeNull();
    expect(parseIntent({ ...intent, from: 'a'.repeat(30) })).toBeNull();
  });
});

// ----- Fuzz ----------------------------------------------------------------------------------------------

const JUNK: unknown[] = [
  null, true, false, 0, -1, 1, 2, 99, 100, 1e9, -1e9, 1.5, 0.1, NaN, Infinity, -Infinity, '', 'x', 'a'.repeat(50), '<b>hi</b>', '__proto__', 'constructor', 'toString',
  [], {}, [1, 2, 3], { a: 1 }, [[]], [{}], { __proto__: { polluted: 1 } }, JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}}}'),
];

function paths(value: unknown, prefix: (string | number)[] = [], out: (string | number)[][] = []): (string | number)[][] {
  out.push(prefix);
  if (Array.isArray(value)) value.forEach((item, i) => paths(item, [...prefix, i], out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) paths(v, [...prefix, k], out);
  return out;
}

function setAt(root: any, path: (string | number)[], value: unknown): any {
  if (path.length === 0) return value;
  let node = root;
  for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
  const last = path[path.length - 1];
  if (value === undefined) {
    if (Array.isArray(node)) node.splice(last as number, 1);
    else delete node[last];
  } else if (last === '__proto__') Object.defineProperty(node, last, { value, enumerable: true, configurable: true, writable: true });
  else node[last] = value;
  return root;
}

const WORD = /^[a-z0-9_:.\-]{1,24}$/i;
const DATEWORD = /^\d{4}-\d{2}-\d{2}$/;

/** Every string in a parsed message is a short id or a date: no text can come through. */
function onlyIds(value: unknown, where = ''): void {
  if (typeof value === 'string') {
    if (!WORD.test(value) && !DATEWORD.test(value)) throw new Error(`text at ${where}: ${value.slice(0, 40)}`);
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`number at ${where}`);
  } else if (Array.isArray(value)) value.forEach((item, i) => onlyIds(item, `${where}[${i}]`));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (!WORD.test(k)) throw new Error(`key at ${where}: ${k}`);
      onlyIds(v, `${where}.${k}`);
    }
  }
}

function reencode(snap: CoopSnapshot): Record<string, unknown> {
  return { from: snap.meta.seats[0], ...snap.meta, s: { ...snap.live, flags: Object.keys(snap.live.flags) } };
}

describe('fuzz: the co-op parsers', () => {
  beforeEach(() => {
    delete (Object.prototype as any).polluted;
  });

  it('mutating one to three fields of real messages: never a throw, never text, idempotent, no pollution', () => {
    const all = playRigs();
    const bodies = all.flatMap((rig) => rig.bodies).slice(0, 120);
    expect(bodies.length).toBeGreaterThan(60);
    const rng = new Rng(4242);
    let accepted = 0;
    let refused = 0;
    for (let n = 0; n < 6000; n++) {
      const base = bodies[n % bodies.length];
      let msg = JSON.parse(JSON.stringify(base)) as unknown;
      const edits = rng.int(1, 3);
      for (let e = 0; e < edits; e++) {
        const where = paths(msg);
        const path = where[rng.int(0, where.length - 1)];
        const value = rng.chance(0.15) ? undefined : JUNK[rng.int(0, JUNK.length - 1)];
        // a fresh copy of the junk (objects are shared)
        const fresh = value && typeof value === 'object' && !('polluted' in (value as object)) ? JSON.parse(JSON.stringify(value)) : value;
        msg = setAt(msg, path, fresh);
      }
      let out: ReturnType<typeof parseCoopMessage>;
      try {
        out = parseCoopMessage('st', msg);
      } catch (error) {
        throw new Error('the parser threw: ' + String(error));
      }
      if (out === null) {
        refused++;
        continue;
      }
      accepted++;
      expect(out.event).toBe('st');
      if (out.event !== 'st') continue;
      onlyIds(out.snap.meta, 'meta');
      onlyIds({ ...out.snap.live, flags: Object.keys(out.snap.live.flags) }, 'live');
      expect(JSON.stringify(out)).not.toContain('polluted');
      expect(parseCoopMessage('st', JSON.parse(JSON.stringify(reencode(out.snap))))).toEqual(out);
    }
    expect(({} as any).polluted).toBeUndefined();
    expect(refused).toBeGreaterThan(1000);
    expect(accepted).toBeGreaterThan(100);
  });

  it('mutating records the same way', () => {
    const records = playRigs().flatMap((rig) => rig.co.mission.history).slice(0, 80);
    expect(records.length).toBeGreaterThan(40);
    const rng = new Rng(99);
    let refused = 0;
    for (let n = 0; n < 4000; n++) {
      let msg = JSON.parse(JSON.stringify(encodeRecord(HOST, records[n % records.length]))) as unknown;
      const where = paths(msg);
      const value = rng.chance(0.15) ? undefined : JUNK[rng.int(0, JUNK.length - 1)];
      const fresh = value && typeof value === 'object' && !('polluted' in (value as object)) ? JSON.parse(JSON.stringify(value)) : value;
      msg = setAt(msg, where[rng.int(0, where.length - 1)], fresh);
      const out = parseCoopMessage('rec', msg);
      if (out === null) {
        refused++;
        continue;
      }
      if (out.event !== 'rec') throw new Error('wrong kind');
      onlyIds(out.rec, 'rec');
      expect(parseCoopMessage('rec', JSON.parse(JSON.stringify(encodeRecord(out.from, out.rec))))).toEqual(out);
    }
    expect(refused).toBeGreaterThan(500);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('mutating intents and sync: only what parseIntent allows comes through', () => {
    const rng = new Rng(7);
    const base: Intent[] = [
      { from: HOST, n: 1, w: 1, s: 'plan', k: 'alloc', a: { life: 1, farm: 1, lab: 1, shield: 1 } },
      { from: HOST, n: 2, w: 2, s: 'event', k: 'vote', o: 'a' },
      { from: HOST, n: 3, w: 2, s: 'walk', k: 'walkEnd', r: { seconds: 30, samples: 2, science: 6, chore: true, caught: false, alerted: false, picked: [0, 4], finds: [], materials: { regolith: 1, metal: 2 } } },
      { from: HOST, n: 4, w: 2, s: 'plan', k: 'build', id: 'workshop' },
      { from: HOST, n: 5, w: 2, s: 'plan', k: 'room', room: 'hab', game: 'pipes' },
    ] as Intent[];
    for (let n = 0; n < 4000; n++) {
      let msg = JSON.parse(JSON.stringify(encodeIntent(base[n % base.length]))) as unknown;
      const where = paths(msg);
      const value = JUNK[rng.int(0, JUNK.length - 1)];
      msg = setAt(msg, where[rng.int(0, where.length - 1)], value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value);
      const out = parseCoopMessage('int', msg);
      if (out && out.event === 'int') onlyIds(out.intent, 'intent');
      const sync = parseCoopMessage('sync', { from: HOST, have: JUNK[rng.int(0, JUNK.length - 1)] });
      if (sync && sync.event === 'sync') expect(Number.isInteger(sync.have) && sync.have >= 0 && sync.have <= 99).toBe(true);
    }
    expect(({} as any).polluted).toBeUndefined();
  });

  it('random JSON of any shape is refused and never throws', () => {
    const rng = new Rng(31337);
    const random = (depth: number): unknown => {
      const r = rng.next();
      if (depth > 3 || r < 0.3) return [null, true, 0, 7, -2.5, 'abc', '', 1e12][rng.int(0, 7)];
      if (r < 0.6) return Array.from({ length: rng.int(0, 4) }, () => random(depth + 1));
      const o: Record<string, unknown> = {};
      for (let i = rng.int(0, 5); i > 0; i--) o[['from', 's', 'r', 'seats', 'stage', 'rev', 'week', 'have', 'k', 'n', 'w', 'x'][rng.int(0, 11)]] = random(depth + 1);
      return o;
    };
    for (let n = 0; n < 8000; n++) {
      for (const event of [...COOP_EVENT_NAMES, 'status', 'bogus']) {
        const out = parseCoopMessage(event, random(0));
        expect(out).toBeNull();
      }
    }
  });
});

// ----- The id lists are complete ---------------------------------------------------------------------------------------

describe('every id the game can put in the state is accepted by the parser', () => {
  const missions = (): MissionState[] => (['mars', 'moon'] as const).map((site) => createMission(config(3, { site }), DATA));
  const reads = (m: MissionState): boolean => parseCoopMessage('st', JSON.parse(JSON.stringify(encodeSnapshot(HOST, createCoop(m, [HOST], 0), 0)))) !== null;

  it('the flag of every card option, the lasting effects of every option, every codex card, every find, every building and tool', () => {
    for (const m of missions()) {
      expect(reads(m)).toBe(true);
      const before = JSON.stringify(m);
      for (const event of Object.values(EVENTS)) {
        const probe = JSON.parse(before) as MissionState;
        probe.unlocked = [event.codex];
        probe.now.eventId = event.id;
        probe.usedEvents = [event.id];
        expect(reads(probe), `event ${event.id} / codex ${event.codex}`).toBe(true);
        for (const option of event.options) {
          const state = JSON.parse(before) as MissionState;
          if (option.flag) {
            state.flags[option.flag] = true;
            expect(reads(state), `flag ${option.flag}`).toBe(true);
          }
          for (const mod of resolveMods(option, state)) {
            state.modifiers = [mod];
            expect(reads(state), `modifier ${mod.id} of ${event.id}/${option.id}`).toBe(true);
          }
        }
      }
      const all = JSON.parse(before) as MissionState;
      for (const code of ['space_farming', 'space_weather', 'dust_storm', 'polar_light']) all.unlocked.push(code);
      for (const flag of ['asked_earth', 'did_chore', 'collected_sample', 'outran_storm', 'wasted_power', 'went_hungry']) all.flags[flag] = true;
      for (const find of FINDS[all.config.site]) all.flags[findFlag(find.id)] = true;
      all.now.finds = FINDS[all.config.site].map((f) => f.id);
      all.now.evaBlock = 'eva.blockShelter';
      all.now.evaAlerted = true;
      all.tools = TOOLS.map((t) => t.id);
      all.buildings = BUILDINGS.map((b) => ({ id: b.id, progress: b.work, done: true }));
      all.modifiers = BUILDINGS.filter((b) => Object.keys(b.effect).length).map((b) => ({ id: `building:${b.id}`, weeks: 0, permanent: true, delayed: true, ...b.effect }));
      all.now.games = ROOMS.flatMap((room) => room.games.map((g) => `${room.id}:${g.game}`)).slice(0, 4);
      expect(reads(all)).toBe(true);
    }
  });

  it('adoptRecord takes dates only from the guest plan', () => {
    const rig = playRigs().find((r) => r.co.mission.history.length >= 1)!;
    const record = rig.co.mission.history[0];
    const guest = createMission(rig.cfg, DATA);
    expect(adoptRecord(guest, { ...record, dateFrom: '2000-01-01' })).toBe(false);
    expect(adoptRecord(guest, { ...record, dateTo: '2000-01-01' })).toBe(false);
    expect(guest.history).toHaveLength(0);
    expect(adoptRecord(guest, record)).toBe(true);
  });

  it('a date that is not a real day is refused on the wire', () => {
    const rig = playRigs().find((r) => r.co.mission.history.length >= 1)!;
    for (const date of ['9999-99-99', '2024-02-30', '2024-13-01', '2024-00-10']) {
      const body = JSON.parse(JSON.stringify(encodeRecord(HOST, rig.co.mission.history[0]))) as { r: { dateFrom: string } };
      body.r.dateFrom = date;
      expect(parseCoopMessage('rec', body), date).toBeNull();
    }
  });
});

// ----- Names, sizes, the start --------------------------------------------------------------------------------

describe('protocol: names, sizes and the mode in the start', () => {
  it('the new events are on the list, and the old four are still there', () => {
    expect([...EVENT_NAMES]).toEqual(['status', 'final', 'react', 'pos', 'st', 'rec', 'int', 'sync']);
    expect([...COOP_EVENT_NAMES]).toEqual(['st', 'rec', 'int', 'sync']);
  });

  it('the old messages are read as before; co-op messages are not read by parseMessage', () => {
    expect(parseMessage('react', { from: 'abc123def4', id: 'great' })).toEqual({ event: 'react', from: 'abc123def4', reaction: 'great' });
    expect(parseMessage('st', { from: 'abc123def4' })).toBeNull();
    expect(parseMessage('react', { from: 'abc123def4', id: 'great', pad: 'x'.repeat(700) })).toBeNull();
  });

  const CHOICE: CrewChoice = { site: 'mars', difficulty: 'cadet', weeks: 6, windowId: 'may2024' };
  const DATE = startDateOf('may2024')!;

  it('a start without a mode is a race, exactly as before; "coop" is kept; anything else is refused', () => {
    expect(parseStart({ choice: CHOICE, seed: 1, startDate: DATE })).toEqual({ choice: CHOICE, seed: 1, startDate: DATE });
    expect(parseStart({ mode: 'race', choice: CHOICE, seed: 1, startDate: DATE })).toEqual({ choice: CHOICE, seed: 1, startDate: DATE });
    expect(parseStart({ mode: 'coop', choice: CHOICE, seed: 1, startDate: DATE })).toEqual({ mode: 'coop', choice: CHOICE, seed: 1, startDate: DATE });
    for (const mode of ['solo', 1, null, true, {}]) expect(parseStart({ mode, choice: CHOICE, seed: 1, startDate: DATE })).toBeNull();
  });

  it('the protocol version moved on', () => {
    expect(PROTOCOL).toBe(3);
  });
});

// ----- The room -------------------------------------------------------------------------------------------------

const tick = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

let counter = 0;
function client(hub: MemoryHub) {
  counter++;
  const id = `wire${String(counter).padStart(6, '0')}`;
  const got: { event: string; from: string; body: unknown }[] = [];
  const room = new CrewRoom(() => new MemoryTransport(hub), {
    me: { id, name: 0, suit: counter % CREW_SUITS.length },
    joinGraceMs: 50,
    createGraceMs: 50,
    hostGoneMs: 1000,
  });
  room.onCoop = (incoming, from) => got.push({ event: incoming.event, from: from.id, body: incoming });
  const views: RoomView[] = [];
  room.subscribe((view) => views.push(view));
  return { id, room, got, views };
}
type Client = ReturnType<typeof client>;

async function lobby(hub: MemoryHub, guests: number): Promise<{ host: Client; guests: Client[]; code: string }> {
  const host = client(hub);
  const made = host.room.create();
  await tick(100);
  expect(await made).toBe(true);
  const code = host.room.view.code;
  const list: Client[] = [];
  for (let i = 0; i < guests; i++) {
    const guest = client(hub);
    const joined = guest.room.join(code);
    await tick(100);
    expect(await joined).toBe(true);
    guest.room.setReady(true);
    list.push(guest);
  }
  await tick(10);
  return { host, guests: list, code };
}

const CHOICE: CrewChoice = { site: 'mars', difficulty: 'cadet', weeks: 6, windowId: 'may2024' };
const START_DATE = startDateOf('may2024')!;

/** A crew that has started. The commander's seat id is the room id, so the bodies are built with it. */
async function started(hub: MemoryHub, guests: number, mode: 'race' | 'coop') {
  const crew = await lobby(hub, guests);
  expect(crew.host.room.start(CHOICE, 555, START_DATE, mode)).toBe(true);
  await tick(10);
  return crew;
}

function stBody(host: string, seats: string[]): Record<string, unknown> {
  const cfg = config(5, { weeks: 6 });
  const co = createCoop(createMission(cfg, DATA), [host, ...seats], 0);
  return encodeSnapshot(host, co, 0);
}

describe('the room passes co-op messages, in co-op mode only', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the commander sends st and rec, a guest receives them checked; a guest sends int and sync, the commander receives them', async () => {
    const hub = new MemoryHub();
    const { host, guests } = await started(hub, 2, 'coop');
    const [g1, g2] = guests;
    expect(host.room.view.start?.mode).toBe('coop');
    expect(g1.room.view.start?.mode).toBe('coop');
    const rig = playRigs()[0];

    expect(host.room.sendCoop('st', stBody(host.id, [g1.id, g2.id]))).toBe(true);
    expect(host.room.sendCoop('rec', encodeRecord(host.id, rig.co.mission.history[0] ?? playRigs().find((r) => r.co.mission.history.length)!.co.mission.history[0]))).toBe(true);
    await tick(10);
    for (const guest of [g1, g2]) {
      expect(guest.got.map((m) => m.event)).toEqual(['st', 'rec']);
      expect(guest.got[0].from).toBe(host.id);
    }
    expect(host.got).toHaveLength(0);

    const intent = { from: g1.id, n: 1, w: 1, s: 'briefing', k: 'ready', on: true } as Intent;
    expect(g1.room.sendCoop('int', encodeIntent(intent))).toBe(true);
    expect(g1.room.sendCoop('sync', encodeSync(g1.id, 0))).toBe(true);
    await tick(10);
    expect(host.got.map((m) => m.event)).toEqual(['int', 'sync']);
    expect(host.got.every((m) => m.from === g1.id)).toBe(true);
    // The other guest never hears a guest's messages.
    expect(g2.got.map((m) => m.event)).toEqual(['st', 'rec']);
  });

  it('who may send what: a guest cannot send st or rec, the commander cannot send int or sync', async () => {
    const hub = new MemoryHub();
    const { host, guests } = await started(hub, 1, 'coop');
    const [g1] = guests;
    expect(g1.room.sendCoop('st', stBody(g1.id, []))).toBe(false);
    expect(g1.room.sendCoop('rec', { r: {} })).toBe(false);
    expect(host.room.sendCoop('int', { k: 'go' })).toBe(false);
    expect(host.room.sendCoop('sync', { have: 0 })).toBe(false);
    // Too big: nothing is sent.
    expect(host.room.sendCoop('st', { pad: 'x'.repeat(3100) })).toBe(false);
    expect(g1.room.sendCoop('sync', { have: 0, pad: 'x'.repeat(800) })).toBe(false);
    await tick(10);
    expect(hub.log.filter((m) => ['st', 'rec', 'int', 'sync'].includes(m.event))).toHaveLength(0);
  });

  it('only the commander id is believed for st and rec, and only the commander takes int and sync', async () => {
    const hub = new MemoryHub();
    const { host, guests } = await started(hub, 2, 'coop');
    const [g1, g2] = guests;
    const entry = (c: Client) => c.room as unknown as { onCoopMessage(event: string, payload: unknown): void };
    const state = stBody(g1.id, [g2.id]);
    const intent = { from: g1.id, n: 1, w: 1, s: 'briefing', k: 'ready', on: true };
    // A guest's st (a guest speaking for the commander) is dropped by the other guest and by the commander.
    entry(g2).onCoopMessage('st', state);
    entry(host).onCoopMessage('st', state);
    // An int reaches only the commander; a guest ignores another guest's intent and sync.
    entry(g2).onCoopMessage('int', intent);
    entry(g2).onCoopMessage('sync', encodeSync(g1.id, 0));
    expect([host.got, g1.got, g2.got].map((list) => list.length)).toEqual([0, 0, 0]);
    // A stranger (nobody in the crew) is dropped too.
    entry(host).onCoopMessage('int', { ...intent, from: 'rogue00001' });
    entry(g2).onCoopMessage('st', stBody('rogue00001', []));
    expect([host.got, g2.got].map((list) => list.length)).toEqual([0, 0]);
    // The right sender is believed.
    entry(host).onCoopMessage('int', intent);
    entry(g2).onCoopMessage('st', stBody(host.id, [g1.id, g2.id]));
    expect(host.got.map((m) => m.event)).toEqual(['int']);
    expect(g2.got.map((m) => m.event)).toEqual(['st']);
    // The message must be well formed too: a spoofed seat in the intent, or a state whose first seat is not the sender.
    entry(host).onCoopMessage('int', { ...intent, k: 'nuke' });
    entry(g2).onCoopMessage('st', stBody(g1.id, [host.id]));
    expect(host.got).toHaveLength(1);
    expect(g2.got).toHaveLength(1);
  });

  it('a flood from one player is limited per kind', async () => {
    const hub = new MemoryHub();
    const { host, guests } = await started(hub, 1, 'coop');
    const [g1] = guests;
    const entry = host.room as unknown as { onCoopMessage(event: string, payload: unknown): void };
    for (let i = 1; i <= 80; i++) entry.onCoopMessage('int', { from: g1.id, n: i, w: 1, s: 'briefing', k: 'ready', on: true });
    for (let i = 0; i < 20; i++) entry.onCoopMessage('sync', encodeSync(g1.id, 0));
    expect(host.got.filter((m) => m.event === 'int')).toHaveLength(24);
    expect(host.got.filter((m) => m.event === 'sync')).toHaveLength(3);
    // After the window, messages flow again.
    await tick(2100);
    entry.onCoopMessage('sync', encodeSync(g1.id, 0));
    expect(host.got.filter((m) => m.event === 'sync')).toHaveLength(4);
  });

  it('race mode never looks at them: nothing is sent, and good messages that arrive on the wire are dropped', async () => {
    const hub = new MemoryHub();
    const { host, guests } = await started(hub, 2, 'race');
    expect(host.room.view.start?.mode).toBeUndefined();
    expect(host.room.sendCoop('st', stBody(host.id, guests.map((g) => g.id)))).toBe(false);
    expect(guests[0].room.sendCoop('sync', encodeSync(guests[0].id, 0))).toBe(false);
    // Well-formed, signed messages from the right senders, put on the network by their own rooms (the way a
    // modified client with its own key would): the commander's st and rec, a guest's int and sync.
    const rec = playRigs().find((r) => r.co.mission.history.length)!.co.mission.history[0];
    const wire = (c: Client) => ({ send: (event: string, body: Record<string, unknown>) => (c.room as unknown as { out(event: string, body: Record<string, unknown>): boolean }).out(event, body) });
    wire(host).send('st', stBody(host.id, guests.map((g) => g.id)));
    wire(host).send('rec', encodeRecord(host.id, rec));
    wire(guests[0]).send('int', { from: guests[0].id, n: 1, w: 1, s: 'briefing', k: 'ready', on: true });
    wire(guests[0]).send('sync', encodeSync(guests[0].id, 0));
    await tick(10);
    expect(hub.log.filter((m) => ['st', 'rec', 'int', 'sync'].includes(m.event))).toHaveLength(4);
    for (const c of [host, ...guests]) expect(c.got).toHaveLength(0);
    // Control: the very same wire messages are delivered in co-op mode.
    const hub2 = new MemoryHub();
    const coop = await started(hub2, 2, 'coop');
    wire(coop.host).send('st', stBody(coop.host.id, coop.guests.map((g) => g.id)));
    wire(coop.guests[0]).send('int', { from: coop.guests[0].id, n: 1, w: 1, s: 'briefing', k: 'ready', on: true });
    await tick(10);
    expect(coop.host.got.map((m) => m.event)).toEqual(['int']);
    expect(coop.guests[1].got.map((m) => m.event)).toEqual(['st']);
  });

  it('the old messages still flow in co-op mode', async () => {
    const hub = new MemoryHub();
    const { guests } = await started(hub, 1, 'coop');
    expect(guests[0].room.sendReaction('great')).toBe(true);
    await tick(10);
    expect(hub.log.some((m) => m.event === 'react')).toBe(true);
  });
});

describe('the host cannot start a crew that mixes protocol versions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a seat on another version blocks the start until it leaves, and the view says why', async () => {
    const hub = new MemoryHub();
    const { host } = await lobby(hub, 1);
    expect(host.room.canStart()).toBe(true);
    expect(host.room.view.versionOk).toBe(true);
    const old = new MemoryTransport(hub);
    await old.connect(channelName(host.room.view.code), 'oldclient01', { id: 'oldclient01', n: 5, c: 2, r: true, h: false, s: false, t: Date.now() + 5, v: 1 }, { presence() {}, message() {}, status() {} });
    await tick(50);
    expect(host.room.view.players).toHaveLength(3);
    expect(host.room.view.versionOk).toBe(false);
    expect(host.room.canStart()).toBe(false);
    expect(host.room.start(CHOICE, 1, START_DATE, 'coop')).toBe(false);
    expect(host.room.start(CHOICE, 1, START_DATE)).toBe(false);
    expect(host.room.view.phase).toBe('lobby');
    old.close();
    await tick(50);
    expect(host.room.view.versionOk).toBe(true);
    expect(host.room.canStart()).toBe(true);
    expect(host.room.start(CHOICE, 1, START_DATE, 'coop')).toBe(true);
  });

  it('a newer seat is also refused (the versions must be equal)', async () => {
    const hub = new MemoryHub();
    const { host } = await lobby(hub, 1);
    const newer = new MemoryTransport(hub);
    await newer.connect(channelName(host.room.view.code), 'newclient01', { id: 'newclient01', n: 6, c: 3, r: true, h: false, s: false, t: Date.now() + 5, v: PROTOCOL + 1 }, { presence() {}, message() {}, status() {} });
    await tick(50);
    expect(host.room.canStart()).toBe(false);
  });
});

// ----- The real transport ---------------------------------------------------------------------------------------------

describe('the real transport subscribes to every message name', () => {
  it('one broadcast listener per name in EVENT_NAMES', async () => {
    const events: string[] = [];
    vi.resetModules();
    vi.doMock('@supabase/realtime-js', () => {
      class FakeChannel {
        on(type: string, filter: { event?: string }) {
          if (type === 'broadcast' && filter.event) events.push(filter.event);
          return this;
        }
        subscribe(cb: (status: string) => void) {
          cb('SUBSCRIBED');
          return this;
        }
        track() {
          return Promise.resolve();
        }
        send() {
          return Promise.resolve();
        }
        presenceState() {
          return {};
        }
      }
      class RealtimeClient {
        channel() {
          return new FakeChannel();
        }
        removeChannel() {
          return Promise.resolve();
        }
        disconnect() {
          return Promise.resolve();
        }
      }
      return { RealtimeClient };
    });
    (globalThis as any).window = globalThis;
    const { SupabaseTransport: Fresh } = await import('../src/net/supabase');
    const transport = new Fresh({ url: 'https://x.invalid', key: 'k' } as any);
    await transport.connect('fo-crew-TEST22', 'me', {}, { presence() {}, message() {}, status() {} });
    transport.close();
    expect(events.sort()).toEqual([...EVENT_NAMES].sort());
    vi.doUnmock('@supabase/realtime-js');
  });
});

describe('what each seat did, for the debrief', () => {
  const crew = ['seat000001', 'seat000002', 'seat000003', 'seat000004'];
  const body = (stage: CoopSim['stage']): Record<string, unknown> => {
    const co = createCoop(createMission(config(5, { weeks: 6 }), DATA), crew, 0);
    co.stage = stage;
    co.contrib[crew[1]] = { samples: 9, finds: 2, games: 1, prints: 3, votes: 4 };
    return JSON.parse(JSON.stringify(encodeSnapshot(HOST_SEAT, co, 0))) as Record<string, unknown>;
  };
  const HOST_SEAT = crew[0];

  it('travels on the report and the end only, and reads back the same', () => {
    for (const stage of ['report', 'end'] as const) {
      const msg = parseCoopMessage('st', body(stage));
      expect(msg && msg.event === 'st' && msg.snap.meta.contrib?.[crew[1]]).toEqual({ samples: 9, finds: 2, games: 1, prints: 3, votes: 4 });
    }
    for (const stage of ['briefing', 'event', 'plan', 'walk'] as const) expect(body(stage).contrib).toBeUndefined();
  });

  it('stays inside the size limit with four seats', () => {
    expect(JSON.stringify(body('end')).length).toBeLessThanOrEqual(2600);
  });

  it('refuses numbers out of range, strangers, and more than four entries', () => {
    const bad = (patch: (contrib: Record<string, unknown>) => void): unknown => {
      const b = body('end');
      patch(b.contrib as Record<string, unknown>);
      return parseCoopMessage('st', b);
    };
    expect(bad((c) => (c[crew[1]] = { samples: -1, finds: 0, games: 0, prints: 0, votes: 0 }))).toBeNull();
    expect(bad((c) => (c[crew[1]] = { samples: 1e6, finds: 0, games: 0, prints: 0, votes: 0 }))).toBeNull();
    expect(bad((c) => (c[crew[1]] = { samples: 1 }))).toBeNull();
    expect(bad((c) => (c[crew[1]] = 'many'))).toBeNull();
    expect(bad((c) => (c['<b>x</b>'] = { samples: 1, finds: 0, games: 0, prints: 0, votes: 0 }))).toBeNull();
    expect(bad((c) => (c['seat000005'] = { samples: 1, finds: 0, games: 0, prints: 0, votes: 0 }))).toBeNull();
  });
});
