/**
 * Live crew avatars: the pure rules (smoothing, staleness, base slots, who the week waits for, when a
 * position is sent) and the same rules through a CrewRoom on the in-memory network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crewEn, crewRu } from '../src/i18n/crew';
import {
  BASE_SLOTS,
  KEEPALIVE_MS,
  PositionSender,
  SNAP_METRES,
  STALE_SECONDS,
  approach,
  assignSlots,
  doingOf,
  emoteFor,
  friendMode,
  isStale,
  positionSample,
  smoothAngle,
  smoothTowards,
  whoIsBehind,
  wrapAngle,
} from '../src/net/follow';
import { CREW_SUITS, POSITION_MIN_MS, channelName, parseMessage, startDateOf } from '../src/net/protocol';
import type { CrewChoice, Position, Status } from '../src/net/protocol';
import { CrewRoom } from '../src/net/room';
import type { Player } from '../src/net/room';
import { MemoryHub, MemoryTransport } from '../src/net/transport';

const tick = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

const mate = (week: number, step: Status['step'], over: Partial<{ here: boolean; finished: boolean; me: boolean }> = {}) => ({
  id: `p${week}${step}`,
  me: false,
  here: true,
  finished: false,
  status: { week, step } as Status,
  ...over,
});

describe('smoothing and staleness', () => {
  it('a friend is stale only after the limit', () => {
    expect(isStale(10, 10 + STALE_SECONDS)).toBe(false);
    expect(isStale(10, 10 + STALE_SECONDS + 0.01)).toBe(true);
  });

  it('slides toward a near target and never overshoots', () => {
    let at = { x: 0, z: 0 };
    for (let i = 0; i < 120; i++) {
      const next = smoothTowards(at, { x: 4, z: 3 }, 1 / 60);
      expect(next.snapped).toBe(false);
      expect(next.x).toBeLessThanOrEqual(4);
      expect(next.z).toBeLessThanOrEqual(3);
      at = next;
    }
    expect(Math.hypot(4 - at.x, 3 - at.z)).toBeLessThan(0.01);
  });

  it('snaps when more than 8 metres off', () => {
    const far = smoothTowards({ x: 0, z: 0 }, { x: SNAP_METRES + 0.5, z: 0 }, 1 / 60);
    expect(far).toMatchObject({ x: SNAP_METRES + 0.5, z: 0, snapped: true });
    expect(smoothTowards({ x: 0, z: 0 }, { x: SNAP_METRES - 0.5, z: 0 }, 1 / 60).snapped).toBe(false);
  });

  it('turns the short way round', () => {
    // From just under +PI to just over -PI is a small turn the positive way.
    const turned = smoothAngle(3.1, -3.1, 0.05);
    expect(turned).toBeGreaterThan(3.1);
    expect(smoothAngle(1, 1, 0.1)).toBeCloseTo(1);
  });

  it('wraps headings for the wire (the rover heading keeps counting)', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(7)).toBeCloseTo(7 - 2 * Math.PI);
    expect(wrapAngle(-25)).toBeGreaterThanOrEqual(-Math.PI);
    expect(wrapAngle(NaN)).toBe(0);
    const sample = positionSample(12.3456, -7.891, 40, true, false);
    expect(sample).toEqual({ x: 12.35, z: -7.89, a: Math.round(wrapAngle(40) * 100) / 100, m: 1 });
    expect(Math.abs(sample.a)).toBeLessThanOrEqual(Math.PI);
    expect(positionSample(0, 0, 0, true, true).m).toBe(2);
    expect(positionSample(0, 0, 0, false, false).m).toBe(0);
    expect(positionSample(9999, -9999, 0, false, false)).toMatchObject({ x: 500, z: -500 });
  });

  it('approaches a place at a steady speed and stops there', () => {
    let at = { x: 0, z: 0 };
    let arrived = false;
    for (let i = 0; i < 100 && !arrived; i++) {
      const next = approach(at, { x: 3, z: 4 }, 2, 0.5);
      expect(next.moved).toBeLessThanOrEqual(1.0001);
      at = next;
      arrived = next.arrived;
    }
    expect(at).toMatchObject({ x: 3, z: 4 });
  });
});

describe('base slots, what a friend is doing', () => {
  it('gives every friend a slot, the same every time, whatever the order', () => {
    const a = assignSlots(['carl', 'anna', 'bert']);
    const b = assignSlots(['bert', 'carl', 'anna']);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
    expect(new Set(a.values()).size).toBe(3);
    for (const slot of a.values()) expect(slot).toBeLessThan(BASE_SLOTS.length);
  });

  it('slots are clear of the habitat (at least 4 m from the middle) and apart from each other', () => {
    for (const slot of BASE_SLOTS) expect(Math.hypot(slot.x, slot.z)).toBeGreaterThan(4);
    for (let i = 0; i < BASE_SLOTS.length; i++)
      for (let j = i + 1; j < BASE_SLOTS.length; j++) expect(Math.hypot(BASE_SLOTS[i].x - BASE_SLOTS[j].x, BASE_SLOTS[i].z - BASE_SLOTS[j].z)).toBeGreaterThan(3);
  });

  it('picks walk, base or hidden from the status', () => {
    const base = { here: true, finished: false };
    expect(friendMode({ ...base, status: { step: 'eva' } as Status })).toBe('walk');
    expect(friendMode({ ...base, status: { step: 'plan' } as Status })).toBe('base');
    expect(friendMode({ ...base, status: null })).toBe('base');
    expect(friendMode({ ...base, status: { step: 'night' } as Status })).toBe('hidden');
    expect(friendMode({ ...base, status: { step: 'eva', end: 'air' } as Status })).toBe('hidden');
    expect(friendMode({ ...base, finished: true, status: { step: 'eva' } as Status })).toBe('hidden');
    expect(friendMode({ ...base, here: false, status: { step: 'eva' } as Status })).toBe('hidden');
  });

  it('has an emote and an icon for every step', () => {
    expect(emoteFor('plan')).toBe('drill');
    expect(emoteFor('report')).toBe('wave');
    expect(emoteFor('briefing')).toBe('none');
    expect(doingOf('eva')).toBe('outside');
    expect(doingOf('report')).toBe('report');
    expect(doingOf('plan')).toBe('plan');
    expect(doingOf(null)).toBe('plan');
  });
});

describe('who the next week waits for', () => {
  const me = { week: 3, step: 'report' as const };

  it('waits for an earlier week or an earlier step of this week', () => {
    const list = [mate(2, 'report'), mate(3, 'plan'), mate(3, 'eva'), mate(3, 'night')];
    expect(whoIsBehind(me, list)).toHaveLength(4);
  });

  it('does not wait for a friend at the report or ahead', () => {
    expect(whoIsBehind(me, [mate(3, 'report'), mate(4, 'briefing'), mate(5, 'plan')])).toHaveLength(0);
  });

  it('never waits for a friend who left, finished, lost the connection or ended the mission', () => {
    const list = [
      mate(1, 'plan', { here: false }),
      mate(2, 'plan', { finished: true }),
      { ...mate(2, 'eva'), status: { week: 2, step: 'eva', end: 'air' } as Status },
      mate(2, 'plan', { me: true }),
    ];
    expect(whoIsBehind(me, list)).toHaveLength(0);
  });

  it('a friend with no news yet is at the start of week 1', () => {
    const quiet = { id: 'q', me: false, here: true, finished: false, status: null };
    expect(whoIsBehind({ week: 1, step: 'report' }, [quiet])).toHaveLength(1);
    expect(whoIsBehind({ week: 2, step: 'report' }, [quiet])).toHaveLength(1);
  });
});

describe('sending our position', () => {
  const at = (x: number, a = 0, m = 1): Position => ({ x, z: 0, a, m });

  it('sends nothing when not on a walk, and a new walk starts with a send at once', () => {
    const sender = new PositionSender();
    expect(sender.next(0, null)).toBeNull();
    expect(sender.next(1000, at(1))).toEqual(at(1));
    expect(sender.next(1100, null)).toBeNull();
    expect(sender.next(1150, at(1))).toEqual(at(1));
  });

  it('at most 5 a second', () => {
    const sender = new PositionSender();
    let sent = 0;
    for (let ms = 0; ms < 2000; ms += 20) if (sender.next(ms, at(ms / 100))) sent++;
    expect(sent).toBeLessThanOrEqual(10);
    expect(sent).toBeGreaterThanOrEqual(9);
    expect(POSITION_MIN_MS).toBe(200);
  });

  it('only when it changed, with a keepalive once a second', () => {
    const sender = new PositionSender();
    expect(sender.next(0, at(5))).not.toBeNull();
    for (let ms = 100; ms < KEEPALIVE_MS; ms += 100) expect(sender.next(ms, at(5))).toBeNull();
    expect(sender.next(KEEPALIVE_MS, at(5))).not.toBeNull();
    expect(sender.next(KEEPALIVE_MS + 300, at(5))).toBeNull();
  });

  it('a turn on the spot, or a change of speed, counts as a change', () => {
    const sender = new PositionSender();
    sender.next(0, at(5));
    expect(sender.next(300, at(5, 0.5))).not.toBeNull();
    expect(sender.next(600, at(5, 0.5, 0))).not.toBeNull();
    expect(sender.next(900, at(5.001, 0.5, 0))).toBeNull();
  });
});

// ----- Through a room -------------------------------------------------------------------------

const CHOICE: CrewChoice = { site: 'mars', difficulty: 'cadet', weeks: 6, windowId: 'may2024' };
let counter = 100;

function client(hub: MemoryHub) {
  counter++;
  const id = `walker${counter}`;
  const room = new CrewRoom(() => new MemoryTransport(hub), {
    me: { id, name: counter % 16, suit: counter % CREW_SUITS.length },
    joinGraceMs: 50,
    createGraceMs: 50,
    hostGoneMs: 1000,
  });
  const positions: { player: Player; position: Position }[] = [];
  room.onPosition = (player, position) => positions.push({ player, position });
  return { id, room, positions };
}

function state(week: number, step: Status['step'], over: Partial<Status> = {}): Status {
  return { week, step, air: 90, food: 5, dose: 10, doseLimit: 100, science: 10, stars: 0, end: null, storm: { w: 0, s: 0, k: false, a: 0 }, ...over };
}

async function playing(guests = 1) {
  const hub = new MemoryHub();
  const host = client(hub);
  const made = host.room.create();
  await tick(100);
  await made;
  const code = host.room.view.code;
  const others = [];
  for (let i = 0; i < guests; i++) {
    const guest = client(hub);
    const joined = guest.room.join(code);
    await tick(100);
    await joined;
    guest.room.setReady(true);
    others.push(guest);
  }
  await tick(10);
  host.room.start(CHOICE, 7, startDateOf('may2024')!);
  await tick(10);
  return { hub, host, guests: others, code };
}

describe('through a room', () => {
  it('a position goes from one friend to the other, in metres, as numbers', async () => {
    const { host, guests } = await playing();
    expect(host.room.sendPosition({ x: 12.5, z: -3.25, a: 1.5, m: 1 })).toBe(true);
    await tick(10);
    expect(guests[0].positions).toHaveLength(1);
    expect(guests[0].positions[0].player.id).toBe(host.id);
    expect(guests[0].positions[0].position).toEqual({ x: 12.5, z: -3.25, a: 1.5, m: 1 });
  });

  it('the room sends at most 5 a second', async () => {
    const { host, guests } = await playing();
    for (let i = 0; i < 20; i++) {
      host.room.sendPosition({ x: i, z: 0, a: 0, m: 1 });
      await tick(50);
    }
    await tick(10);
    expect(guests[0].positions.length).toBeLessThanOrEqual(6);
    expect(guests[0].positions.length).toBeGreaterThanOrEqual(4);
  });

  it('bad positions are dropped (words, huge numbers, a wrong speed code)', async () => {
    const { hub, host, guests, code } = await playing();
    const rogue = new MemoryTransport(hub);
    await rogue.connect(channelName(code), 'rogue00001', { id: 'rogue00001', n: 0, c: 0, r: false, h: false, s: false, t: 1, v: 1 }, { presence() {}, message() {}, status() {} });
    rogue.send('pos', { from: host.id, x: 1, z: 2, a: 0, m: 3 });
    rogue.send('pos', { from: host.id, x: 1, z: 2, a: 99, m: 1 });
    rogue.send('pos', { from: host.id, x: 'far', z: 2, a: 0, m: 1 });
    rogue.send('pos', { from: host.id, x: 9e9, z: 2, a: 0, m: 1 });
    await tick(10);
    expect(guests[0].positions).toHaveLength(0);
    // The same road does carry a good one (so the zero above means "dropped", not "never arrived").
    rogue.send('pos', { from: host.id, x: 4, z: 2, a: 0.5, m: 1 });
    await tick(10);
    expect(guests[0].positions).toHaveLength(1);
    expect(guests[0].positions[0].position).toEqual({ x: 4, z: 2, a: 0.5, m: 1 });
    expect(parseMessage('pos', { from: host.id, x: 1, z: 2, a: 0, m: 2 })).not.toBeNull();
  });

  it('the week waits for friends who are behind, and lets go when they arrive or leave', async () => {
    const { host, guests } = await playing(2);
    const [anna, bert] = guests;
    host.room.sendStatus(state(2, 'report'));
    anna.room.sendStatus(state(2, 'plan'));
    bert.room.sendStatus(state(2, 'report'));
    await tick(700);
    const behind = () => whoIsBehind({ week: 2, step: 'report' }, host.room.view.players);
    expect(behind().map((p) => p.id)).toEqual([anna.id]);

    anna.room.sendStatus(state(2, 'report'));
    await tick(700);
    expect(behind()).toHaveLength(0);

    bert.room.sendStatus(state(1, 'eva'));
    await tick(700);
    expect(behind().map((p) => p.id)).toEqual([bert.id]);
    bert.room.leave();
    await tick(1500);
    expect(behind()).toHaveLength(0);
  });

  it('a friend who finished is never waited for', async () => {
    const { host, guests } = await playing();
    host.room.sendStatus(state(3, 'report'));
    guests[0].room.sendStatus(state(2, 'plan'));
    await tick(700);
    expect(whoIsBehind({ week: 3, step: 'report' }, host.room.view.players)).toHaveLength(1);
    guests[0].room.sendFinal(state(6, 'report', { end: 'complete' }));
    await tick(10);
    expect(whoIsBehind({ week: 3, step: 'report' }, host.room.view.players)).toHaveLength(0);
  });
});

describe('texts', () => {
  it('the new keys exist in both languages', () => {
    for (const key of ['crew.waitCrew', 'crew.dontWait', 'crew.tag', 'crew.doing.plan', 'crew.doing.outside', 'crew.doing.report']) {
      expect(crewEn[key], key).toBeTruthy();
      expect(crewRu[key], key).toBeTruthy();
    }
    expect(crewEn['crew.waitCrew']).toContain('{names}');
    expect(crewRu['crew.waitCrew']).toContain('{names}');
  });
});
