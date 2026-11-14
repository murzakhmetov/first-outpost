/**
 * The report's "Next week" in a crew mission (src/net/crew.ts): it waits for friends who are behind, goes on by
 * itself when nobody is, "Don't wait" goes on now, and it holds while a menu, a film or a building is open.
 * The friends are real CrewRooms on the in-memory network; the director is replaced by a counter.
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
const { crewBehind, crewDontWait, crewNextWeek, crewView, crewWaiting } = await import('../src/net/crew');
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
  crewView.value = host.room.view;
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
  crewView.value = { phase: 'idle', code: '', me: '', hostId: null, players: [], online: true, failure: null, start: null };
  store.mission.value = null;
  store.step.value = 'briefing';
  store.screen.value = 'title';
  await tick(10);
  vi.useRealTimers();
});

describe('Next week in a crew mission', () => {
  it('goes on at once when nobody is behind', async () => {
    const c = await crew();
    stop = c.stop;
    atReport();
    c.host.room.sendStatus(state(2, 'report'));
    c.anna.room.sendStatus(state(2, 'report'));
    c.bert.room.sendStatus(state(3, 'plan'));
    await tick(700);
    expect(crewBehind.value).toHaveLength(0);
    crewNextWeek();
    expect(director.next).toBe(1);
    expect(crewWaiting.value).toBe(false);
  });

  it('waits for a friend who is behind, then goes on by itself, once', async () => {
    const c = await crew();
    stop = c.stop;
    atReport();
    c.anna.room.sendStatus(state(2, 'plan'));
    c.bert.room.sendStatus(state(2, 'report'));
    await tick(700);
    expect(crewBehind.value.map((p) => p.id)).toEqual([c.anna.id]);
    crewNextWeek();
    await tick(10);
    expect(crewWaiting.value).toBe(true);
    expect(director.next).toBe(0);
    c.anna.room.sendStatus(state(2, 'report'));
    await tick(700);
    expect(director.next).toBe(1);
    expect(crewWaiting.value).toBe(false);
    await tick(2000);
    expect(director.next).toBe(1);
  });

  it("'Don't wait' goes on now, and a late friend does not make it go twice", async () => {
    const c = await crew();
    stop = c.stop;
    atReport();
    c.anna.room.sendStatus(state(1, 'eva'));
    c.bert.room.sendStatus(state(2, 'report'));
    await tick(700);
    crewNextWeek();
    expect(crewWaiting.value).toBe(true);
    crewDontWait();
    expect(director.next).toBe(1);
    expect(crewWaiting.value).toBe(false);
    c.anna.room.sendStatus(state(2, 'report'));
    await tick(700);
    expect(director.next).toBe(1);
    // With no wait running, "Don't wait" does nothing.
    crewDontWait();
    expect(director.next).toBe(1);
  });

  it('holds while a menu, a film or a building is open, and goes on when it closes', async () => {
    const c = await crew();
    stop = c.stop;
    atReport();
    c.anna.room.sendStatus(state(2, 'plan'));
    c.bert.room.sendStatus(state(2, 'report'));
    await tick(700);
    crewNextWeek();
    store.panel.value = 'outpost';
    c.anna.room.sendStatus(state(2, 'report'));
    await tick(700);
    expect(crewBehind.value).toHaveLength(0);
    expect(director.next).toBe(0);
    expect(crewWaiting.value).toBe(true);
    // One thing closes as the next opens: it never goes on in between.
    store.film.value = 'landing' as never;
    store.panel.value = 'none';
    await tick(10);
    expect(director.next).toBe(0);
    store.room.value = 'greenhouse' as never;
    store.film.value = null;
    await tick(10);
    expect(director.next).toBe(0);
    store.room.value = null;
    await tick(10);
    expect(director.next).toBe(1);
    expect(crewWaiting.value).toBe(false);
  });

  it('lets go when the friend leaves or finishes', async () => {
    const c = await crew();
    stop = c.stop;
    atReport();
    c.anna.room.sendStatus(state(2, 'eva'));
    c.bert.room.sendStatus(state(1, 'plan'));
    await tick(700);
    expect(crewBehind.value).toHaveLength(2);
    crewNextWeek();
    await tick(10);
    c.anna.room.leave();
    await tick(1500);
    expect(crewBehind.value.map((p) => p.id)).toEqual([c.bert.id]);
    expect(director.next).toBe(0);
    c.bert.room.sendFinal({ ...state(6, 'report'), end: 'complete' });
    await tick(700);
    expect(director.next).toBe(1);
  });

  it('stops waiting without going on when the player leaves the report', async () => {
    const c = await crew();
    stop = c.stop;
    atReport();
    c.anna.room.sendStatus(state(2, 'plan'));
    await tick(700);
    crewNextWeek();
    await tick(10);
    expect(crewWaiting.value).toBe(true);
    store.screen.value = 'title';
    await tick(10);
    expect(crewWaiting.value).toBe(false);
    expect(director.next).toBe(0);
  });

  it('the last week never waits', async () => {
    const c = await crew();
    stop = c.stop;
    atReport(6);
    c.anna.room.sendStatus(state(1, 'plan'));
    await tick(700);
    crewNextWeek();
    expect(director.next).toBe(1);
    expect(crewWaiting.value).toBe(false);
  });
});
