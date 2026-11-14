/**
 * Friends on a shared base ("One base together"): where each friend is drawn (pure helpers in src/net/follow.ts), and
 * the rule that the race mode's wait for the crew never interferes with the shared base's own Ready check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shims } from './harness';
import type { CrewChoice, Status } from '../src/net/protocol';

const director = vi.hoisted(() => ({ next: 0 }));
vi.mock('../src/game/director', () => ({
  getWorld: () => null,
  goNextWeek: () => {
    director.next++;
  },
  startMission: async () => {},
}));
vi.mock('../src/game/audio', () => ({ audio: { play() {} } }));

shims();
const { crewBehind, crewDontWait, crewMode, crewNextWeek, crewView, crewWaiting } = await import('../src/net/crew');
const { coopLive } = await import('../src/net/coopview');
const { coopFriendMode, coopFriendStep, raceWaitApplies } = await import('../src/net/follow');
const store = await import('../src/game/store');
const { CREW_SUITS, startDateOf } = await import('../src/net/protocol');
const { CrewRoom } = await import('../src/net/room');
const { MemoryHub, MemoryTransport } = await import('../src/net/transport');

const tick = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};
const CHOICE: CrewChoice = { site: 'mars', difficulty: 'cadet', weeks: 6, windowId: 'may2024' };
let counter = 200;

function client(hub: InstanceType<typeof MemoryHub>) {
  counter++;
  const id = `waiter${counter}`;
  const room = new CrewRoom(() => new MemoryTransport(hub), {
    me: { id, name: counter % 16, suit: counter % CREW_SUITS.length },
    joinGraceMs: 50,
    createGraceMs: 50,
    hostGoneMs: 1000,
  });
  return { id, room };
}

function state(week: number, step: Status['step']): Status {
  return { week, step, air: 90, food: 5, dose: 10, doseLimit: 100, science: 10, stars: 0, end: null, storm: { w: 0, s: 0, k: false, a: 0 } };
}

/** A host (us) and two friends in a running room; our view feeds crewView as the real screens do. */
async function crew() {
  const hub = new MemoryHub();
  const host = client(hub);
  const made = host.room.create();
  await tick(100);
  await made;
  const guests = [];
  for (let i = 0; i < 2; i++) {
    const guest = client(hub);
    const joined = guest.room.join(host.room.view.code);
    await tick(100);
    await joined;
    guest.room.setReady(true);
    guests.push(guest);
  }
  await tick(10);
  host.room.start(CHOICE, 7, startDateOf('may2024')!);
  await tick(10);
  const stop = host.room.subscribe((view) => {
    crewView.value = view;
  });
  return { host, anna: guests[0], bert: guests[1], stop };
}

function atReport(week = 2): void {
  store.mission.value = { week, config: { weeks: 6 } } as never;
  store.screen.value = 'game';
  store.step.value = 'report';
  store.panel.value = 'none';
  store.film.value = null;
  store.room.value = null;
}

const live = (stage: string, outside: boolean, walk: Record<string, boolean>, returned: string[] = []) => ({ stage, outside, walk, returned });
const friend = (id: string, step: Status['step'] | null, extra: { here?: boolean; finished?: boolean } = {}) => ({
  id,
  here: extra.here ?? true,
  finished: extra.finished ?? false,
  status: step ? state(1, step) : null,
});

describe('friends on a shared base: where they are drawn', () => {
  it('without a shared base it is the race rule', () => {
    expect(coopFriendMode(null, friend('a', 'eva'))).toBe('walk');
    expect(coopFriendMode(null, friend('a', 'plan'))).toBe('base');
    expect(coopFriendMode(null, friend('a', 'night'))).toBe('hidden');
    expect(coopFriendStep(null, friend('a', 'eva'))).toBe('eva');
  });

  it('a walker is outside only while the host says the walkers are out', () => {
    const out = live('walk', true, { a: true, b: false });
    expect(coopFriendMode(out, friend('a', 'eva'))).toBe('walk');
    expect(coopFriendStep(out, friend('a', 'eva'))).toBe('eva');
    // Chose to stay: stands at the base, and does not show the "outside" icon.
    expect(coopFriendMode(out, friend('b', 'evaIntro'))).toBe('base');
    expect(coopFriendStep(out, friend('b', 'evaIntro'))).toBe('evaResult');
    // Chose to walk but the host has not sent them out yet: at the base.
    const choosing = live('walk', false, { a: true });
    expect(coopFriendMode(choosing, friend('a', 'evaIntro'))).toBe('base');
  });

  it('a walker who is back stands at the base while the others are still out', () => {
    const out = live('walk', true, { a: true, b: true }, ['a']);
    expect(coopFriendMode(out, friend('a', 'evaResult'))).toBe('base');
    expect(coopFriendMode(out, friend('b', 'eva'))).toBe('walk');
  });

  it('a friend whose step lags behind the stage is not drawn on a finished walk', () => {
    const report = live('report', false, { a: true }, ['a']);
    expect(coopFriendMode(report, friend('a', 'eva'))).toBe('base');
    expect(coopFriendStep(report, friend('a', 'eva'))).toBe('evaResult');
  });

  it('at night and at the end everyone is indoors; a friend who left or finished is hidden', () => {
    expect(coopFriendMode(live('report', false, {}), friend('a', 'night'))).toBe('hidden');
    expect(coopFriendMode(live('end', false, {}), friend('a', 'report'))).toBe('hidden');
    expect(coopFriendMode(live('plan', false, {}), friend('a', 'plan', { here: false }))).toBe('hidden');
    expect(coopFriendMode(live('plan', false, {}), friend('a', 'plan', { finished: true }))).toBe('hidden');
    expect(coopFriendMode(live('plan', false, {}), friend('a', null))).toBe('base');
  });

  it('the race wait applies only to the race mode with no shared base running', () => {
    expect(raceWaitApplies('race', false)).toBe(true);
    expect(raceWaitApplies('coop', false)).toBe(false);
    expect(raceWaitApplies('race', true)).toBe(false);
  });
});

let stop: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  director.next = 0;
});
afterEach(async () => {
  crewDontWait();
  stop?.();
  stop = null;
  crewMode.value = 'race';
  coopLive.value = null;
  crewView.value = { phase: 'idle', code: '', me: '', hostId: null, players: [], online: true, failure: null, start: null, versionOk: true };
  store.mission.value = null;
  store.step.value = 'briefing';
  store.screen.value = 'title';
  await tick(10);
  vi.useRealTimers();
});

describe('the race wait does not touch the shared base report', () => {
  it('in a shared base a friend behind is not waited for here, and Next week goes straight to the director', async () => {
    const c = await crew();
    stop = c.stop;
    atReport();
    crewMode.value = 'coop';
    c.anna.room.sendStatus(state(2, 'plan'));
    c.bert.room.sendStatus(state(2, 'report'));
    await tick(700);
    expect(crewBehind.value).toHaveLength(0);
    crewNextWeek();
    expect(director.next).toBe(1);
    expect(crewWaiting.value).toBe(false);
  });

  it('a running shared base (live state) blocks the wait even if the mode flag is race', async () => {
    const c = await crew();
    stop = c.stop;
    atReport();
    c.anna.room.sendStatus(state(2, 'plan'));
    c.bert.room.sendStatus(state(2, 'report'));
    await tick(700);
    expect(crewBehind.value).toHaveLength(1);
    coopLive.value = { stage: 'report' } as never;
    expect(crewBehind.value).toHaveLength(0);
    crewNextWeek();
    expect(director.next).toBe(1);
    expect(crewWaiting.value).toBe(false);
  });

  it('after the shared base ends the race wait works again', async () => {
    const c = await crew();
    stop = c.stop;
    atReport();
    c.anna.room.sendStatus(state(2, 'plan'));
    c.bert.room.sendStatus(state(2, 'report'));
    await tick(700);
    crewMode.value = 'race';
    coopLive.value = null;
    expect(crewBehind.value.map((p) => p.id)).toEqual([c.anna.id]);
    crewNextWeek();
    await tick(10);
    expect(crewWaiting.value).toBe(true);
    expect(director.next).toBe(0);
  });
});
