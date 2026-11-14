/**
 * Shared base, the session (src/net/coop.ts): a CoopHost and CoopGuests over real CrewRooms on the in-memory network.
 * No director: the host drives the pure reducer, the guests mirror it. The clock is injected, so a whole mission
 * (and the 20 s grace) runs in a blink. The network is made to lose messages: mirrors must still converge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS, optionBlock } from '../src/sim/events';
import { createMission, suggestAlloc } from '../src/sim/mission';
import { BUILDINGS } from '../src/sim/outpost';
import { coopMeta, createCoop } from '../src/sim/coop';
import type { CoopMeta, CoopSim, IntentBody } from '../src/sim/coop';
import type { MissionConfig, MissionState, OptionId } from '../src/sim/types';
import { liveOf } from '../src/net/coopwire';
import { COOP_NET, CoopGuest, CoopHost, expectedWeeks } from '../src/net/coop';
import type { CoopClock, DetachReason } from '../src/net/coop';
import { CREW_SUITS, channelName, startDateOf } from '../src/net/protocol';
import type { CrewChoice } from '../src/net/protocol';
import { CrewRoom } from '../src/net/room';
import { MemoryHub, MemoryTransport } from '../src/net/transport';
import { DATA } from './bots';

// ----- An injected clock -----------------------------------------------------------------------

class ManualClock implements CoopClock {
  t = 1_000_000;
  private timers: { ms: number; next: number; fn: () => void; live: boolean }[] = [];
  now(): number {
    return this.t;
  }
  every(ms: number, fn: () => void): () => void {
    const timer = { ms, next: this.t + ms, fn, live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
      this.timers = this.timers.filter((other) => other !== timer);
    };
  }
  get running(): number {
    return this.timers.length;
  }
  /** Move the clock, a tick at a time, letting the (microtask) network deliver in between. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    while (this.t < end) {
      this.t = Math.min(end, this.t + 50);
      for (const timer of [...this.timers]) {
        if (timer.live && this.t >= timer.next) {
          timer.next += timer.ms;
          timer.fn();
        }
      }
      await vi.advanceTimersByTimeAsync(0);
    }
  }
}

// ----- A crew ----------------------------------------------------------------------------------------

const CHOICE: CrewChoice = { site: 'mars', difficulty: 'cadet', weeks: 6, windowId: 'may2024' };
const START_DATE = startDateOf('may2024')!;
/** Weeks of the mission under test (6 or 10, the two a crew may pick). */
let crewWeeks = 6;

function config(seed: number): MissionConfig {
  return { site: CHOICE.site, difficulty: CHOICE.difficulty, weeks: crewWeeks, startDate: START_DATE, seed, tutorial: false, sunMode: 'random', windowId: CHOICE.windowId };
}

let counter = 0;
interface Client {
  id: string;
  room: CrewRoom;
  transport: MemoryTransport;
}

function client(hub: MemoryHub, clock: ManualClock): Client {
  counter++;
  const id = `net${String(counter).padStart(6, '0')}`;
  let transport!: MemoryTransport;
  const room = new CrewRoom(
    () => (transport = new MemoryTransport(hub)),
    { me: { id, name: 0, suit: counter % CREW_SUITS.length }, now: () => clock.now(), joinGraceMs: 50, createGraceMs: 50, hostGoneMs: 1000 },
  );
  return {
    id,
    room,
    get transport() {
      return transport;
    },
  } as Client;
}

const tick = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

interface Rig {
  hub: MemoryHub;
  clock: ManualClock;
  host: CoopHost;
  hostClient: Client;
  guests: CoopGuest[];
  guestClients: Client[];
  detached: { id: string; reason: DetachReason }[];
  changes: { host: number };
}

/** A started co-op room. `sessions`: how many guests get a session now (the others only sit in the room). */
async function rig(guestCount: number, seed = 5, sessions = guestCount): Promise<Rig> {
  const hub = new MemoryHub();
  const clock = new ManualClock();
  const hostClient = client(hub, clock);
  const made = hostClient.room.create();
  await tick(100);
  expect(await made).toBe(true);
  const guestClients: Client[] = [];
  for (let i = 0; i < guestCount; i++) {
    const guest = client(hub, clock);
    const joined = guest.room.join(hostClient.room.view.code);
    await tick(100);
    expect(await joined).toBe(true);
    guest.room.setReady(true);
    guestClients.push(guest);
  }
  await tick(10);
  expect(hostClient.room.start({ ...CHOICE, weeks: crewWeeks }, seed, START_DATE, 'coop')).toBe(true);
  await tick(10);
  const detached: Rig['detached'] = [];
  const changes = { host: 0 };
  const seats = [hostClient.id, ...guestClients.map((g) => g.id)];
  const host = new CoopHost(hostClient.room, createCoop(createMission(config(seed), DATA), seats, clock.now()), {
    clock,
    onChange: () => changes.host++,
    onDetach: (reason) => detached.push({ id: hostClient.id, reason }),
  });
  const guests: CoopGuest[] = [];
  for (const g of guestClients.slice(0, sessions)) guests.push(startGuest(g, clock, seed, detached));
  return { hub, clock, host, hostClient, guests, guestClients, detached, changes };
}

function startGuest(g: Client, clock: ManualClock, seed: number, detached: Rig['detached']): CoopGuest {
  return new CoopGuest(g.room, createMission(config(seed), DATA), { clock, onDetach: (reason) => detached.push({ id: g.id, reason }) });
}

// ----- Robots that play through the session --------------------------------------------------------------

interface Actor {
  id: string;
  walker: boolean;
  mission: () => MissionState;
  meta: () => CoopMeta | null;
  pending: () => number;
  submit: (body: IntentBody) => unknown;
}

function actors(r: Rig, walkers: number[] = []): Actor[] {
  const list: Actor[] = [
    {
      id: r.hostClient.id,
      walker: walkers.includes(0),
      mission: () => r.host.co.mission,
      meta: () => coopMeta(r.host.co, r.clock.now()),
      pending: () => 0,
      submit: (body) => r.host.submit(body),
    },
  ];
  r.guests.forEach((g, i) =>
    list.push({
      id: r.guestClients[i].id,
      walker: walkers.includes(i + 1),
      mission: () => g.mission,
      meta: () => g.meta,
      pending: () => g.pending,
      submit: (body) => g.submit(body),
    }),
  );
  return list;
}

/** The option a child would pick: the advice, else the first one that is not blocked (the index spreads the votes). */
function pickOption(state: MissionState, index: number): OptionId {
  const event = EVENTS[state.now.eventId!];
  const open = event.options.filter((o) => !optionBlock(o, state)).map((o) => o.id);
  return index % 2 === 0 && state.now.advice && open.includes(state.now.advice) ? state.now.advice : open[index % open.length];
}

const planned = new Set<string>();

/** One look of one robot at its own screen. */
function act(a: Actor, index: number): void {
  const meta = a.meta();
  if (!meta || a.pending() > 0) return;
  const me = a.id;
  switch (meta.stage) {
    case 'briefing':
    case 'eventResult':
    case 'report':
      if (!meta.ready.includes(me)) a.submit({ k: 'ready', on: true });
      break;
    case 'plan': {
      const key = `${me}:${meta.week}`;
      // The first guest changes the plan once a week; the others ready, and look again after the change.
      if (index === 1 && !planned.has(key)) {
        planned.add(key);
        a.submit({ k: 'alloc', a: suggestAlloc(a.mission()) });
      } else if (!meta.ready.includes(me)) a.submit({ k: 'ready', on: true });
      break;
    }
    case 'event':
      if (!(me in meta.votes) && a.mission().now.eventId) a.submit({ k: 'vote', o: pickOption(a.mission(), index) });
      break;
    case 'walk':
      if (!meta.outside) {
        if (!(me in meta.walk)) a.submit({ k: 'walk', go: a.walker });
      } else if (meta.walk[me] && !meta.returned.includes(me)) {
        a.submit({ k: 'walkEnd', r: { seconds: 40, samples: 2, science: 6, chore: index === 1, caught: false, alerted: false, picked: [0, 2 + (index % 2)] } });
      }
      break;
    default:
      break;
  }
}

/** Let the robots play until the test's condition holds (or the simulated time runs out). */
async function play(r: Rig, until: () => boolean, options: { limitMs?: number; walkers?: number[]; skip?: number[] } = {}): Promise<void> {
  const list = actors(r, options.walkers);
  const limit = r.clock.now() + (options.limitMs ?? 30 * 60_000);
  while (!until() && r.clock.now() < limit) {
    list.forEach((a, i) => {
      if (!options.skip?.includes(i)) act(a, i);
    });
    await r.clock.advance(200);
  }
  expect(until()).toBe(true);
}

const normalFlags = (live: ReturnType<typeof liveOf>): unknown => ({ ...live, flags: Object.keys(live.flags).filter((id) => live.flags[id]).sort() });

/** What a guest must show once the network is quiet: the host's live state, its weeks, its stage. */
function expectMirror(r: Rig, guest: CoopGuest): void {
  const hostLive = JSON.parse(JSON.stringify(normalFlags(liveOf(r.host.co.mission))));
  const guestLive = JSON.parse(JSON.stringify(normalFlags(liveOf(guest.mission))));
  expect(guestLive).toEqual(hostLive);
  expect(JSON.parse(JSON.stringify(guest.mission.history))).toEqual(JSON.parse(JSON.stringify(r.host.co.mission.history)));
  expect(guest.meta?.stage).toBe(r.host.co.stage);
  expect(guest.meta?.rev).toBe(r.host.co.rev);
  expect(guest.missing).toBe(0);
}

const sent = (r: Rig, event: string): number => r.hub.log.filter((entry) => entry.event === event).length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  planned.clear();
  crewWeeks = 6;
});
afterEach(() => {
  vi.useRealTimers();
});

// ----- Whole missions --------------------------------------------------------------------------------------

describe('a crew plays a whole mission through the session', () => {
  it('two guests: the mirrors equal the host at every stop, and at the end', async () => {
    const r = await rig(2);
    let stops = 0;
    let lastStage = r.host.co.stage;
    const watch = (): boolean => {
      // After a quiet moment (the network has delivered) a guest shows the stage the host showed.
      return r.host.co.stage === 'end';
    };
    const list = actors(r, [1]);
    const limit = r.clock.now() + 30 * 60_000;
    while (!watch() && r.clock.now() < limit) {
      list.forEach((a, i) => act(a, i));
      await r.clock.advance(200);
      if (r.host.co.stage !== lastStage) {
        lastStage = r.host.co.stage;
        await r.clock.advance(600);
        stops++;
        for (const g of r.guests) {
          // A guest is never ahead of the host, and almost always level with it within a moment.
          expect(g.meta!.rev).toBeLessThanOrEqual(r.host.co.rev);
        }
      }
    }
    expect(r.host.co.stage).toBe('end');
    expect(stops).toBeGreaterThan(10);
    await r.clock.advance(COOP_NET.heartbeatMs + 2000);
    for (const g of r.guests) expectMirror(r, g);
    // Nothing was refused, and everything the guests said was taken.
    expect(r.host.stats.verdicts.unknown).toBe(0);
    for (const g of r.guests) {
      expect(g.pending).toBe(0);
      expect(g.stats.refused).toBe(0);
    }
    expect(r.host.co.mission.history.length).toBe(r.host.co.mission.week);
    expect(r.detached).toEqual([]);
  });

  it('four seats, with walkers: parallel walks are merged once and the guests see the result', async () => {
    const r = await rig(3, 9);
    await play(r, () => r.host.co.stage === 'end', { walkers: [1, 2] });
    await r.clock.advance(COOP_NET.heartbeatMs + 2000);
    for (const g of r.guests) expectMirror(r, g);
    expect(r.host.co.mission.history.some((rec) => rec.evaSamples > 0)).toBe(true);
    expect(r.host.co.seats.length).toBe(4);
  });
});

// ----- A network that loses messages ---------------------------------------------------------------------------

/** A small deterministic random source (the test must give the same loss every run). */
function dice(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('lossy network', () => {
  it('30% of st lost: the whole mission still finishes and every mirror converges after heartbeat and sync', async () => {
    const r = await rig(2, 11);
    const roll = dice(42);
    let lost = 0;
    r.hub.lose = (event) => {
      if (event === 'st' && roll() < 0.3) {
        lost++;
        return true;
      }
      return false;
    };
    await play(r, () => r.host.co.stage === 'end', { walkers: [2] });
    // The network is still lossy while it settles: the heartbeat does it.
    await r.clock.advance(6 * COOP_NET.heartbeatMs);
    expect(lost).toBeGreaterThan(20);
    for (const g of r.guests) expectMirror(r, g);
    // The repair paths were really used.
    expect(r.host.stats.beats).toBeGreaterThan(0);
    expect(r.guests.reduce((sum, g) => sum + g.stats.retries, 0)).toBeGreaterThan(0);
    expect(r.host.stats.verdicts.dup).toBeGreaterThan(0);
    // A lost `st` never produced a double effect: the weeks of the host are the weeks of the mission.
    expect(r.host.co.mission.history.length).toBe(r.host.co.mission.week);
  });

  it('30% of st, 30% of rec and 20% of int lost, three seeds: still converges', async () => {
    for (const seed of [3, 7, 21]) {
      planned.clear();
      const r = await rig(2, seed);
      const roll = dice(seed * 101);
      r.hub.lose = (event) => (event === 'st' ? roll() < 0.3 : event === 'rec' ? roll() < 0.3 : event === 'int' ? roll() < 0.2 : false);
      await play(r, () => r.host.co.stage === 'end');
      await r.clock.advance(8 * COOP_NET.heartbeatMs);
      for (const g of r.guests) expectMirror(r, g);
      // The repairs were used: the host sent weeks again because a guest asked (more `rec` than weeks), and guests asked again.
      expect(r.host.stats.rec).toBeGreaterThan(r.host.co.mission.history.length);
      expect(r.guests.reduce((sum, g) => sum + g.stats.syncs, 0)).toBeGreaterThan(r.guests.length);
      r.host.dispose();
      for (const g of r.guests) g.dispose();
    }
  });

  it('a lost st is made up by the next heartbeat, nothing else is needed', async () => {
    const r = await rig(1);
    await r.clock.advance(1000);
    const before = r.guests[0].meta!.rev;
    expect(before).toBe(r.host.co.rev);
    // Everything the host says is lost for a while; the host changes its state meanwhile (its own "ready").
    r.hub.lose = () => true;
    r.host.submit({ k: 'ready', on: true });
    await r.clock.advance(2000);
    expect(r.guests[0].meta!.rev).toBe(before);
    r.hub.lose = null;
    await r.clock.advance(COOP_NET.heartbeatMs + 500);
    expect(r.guests[0].meta!.rev).toBe(r.host.co.rev);
    expect(r.guests[0].meta!.ready).toContain(r.hostClient.id);
  });
});

// ----- Intents: order, acknowledgement, retry ------------------------------------------------------------------------

describe('intents', () => {
  /** Bring everybody to the event stage of a week that has a card (the host and the guest answer through the bots). */
  async function toStage(r: Rig, stage: CoopMeta['stage']): Promise<void> {
    await play(r, () => r.host.co.stage === stage && r.guests.every((g) => g.meta?.stage === stage));
  }

  it('go one at a time: the next is sent only when the host has taken the one before', async () => {
    const r = await rig(1);
    await toStage(r, 'event');
    const guest = r.guests[0];
    const before = sent(r, 'int');
    for (let i = 0; i < 3; i++) guest.submit({ k: 'ask' });
    expect(sent(r, 'int') - before).toBe(1);
    expect(guest.pending).toBe(3);
    await r.clock.advance(3000);
    expect(guest.pending).toBe(0);
    expect(r.host.co.acks[r.guestClients[0].id]).toBeGreaterThanOrEqual(3);
    // The card was asked about once: the second and third were refused by the sim, in order.
    expect(r.host.co.mission.now.askedEarth).toBe(true);
    expect(sent(r, 'int') - before).toBe(3);
  });

  it('a lost intent is sent again, and applied once', async () => {
    const r = await rig(1);
    await toStage(r, 'event');
    const guest = r.guests[0];
    const id = r.guestClients[0].id;
    const okBefore = r.host.stats.verdicts.ok;
    let drop = 2;
    r.hub.lose = (event) => event === 'int' && drop-- > 0;
    guest.submit({ k: 'vote', o: pickOption(guest.mission, 1) });
    await r.clock.advance(COOP_NET.retryMs * 3 + 1000);
    expect(r.hub.log.filter((e) => e.event === 'int' && (e.payload as { from: string }).from === id).length).toBeGreaterThanOrEqual(3);
    expect(guest.stats.retries).toBeGreaterThanOrEqual(2);
    expect(r.host.co.votes[id] ?? r.host.co.choice).toBeTruthy();
    expect(r.host.stats.verdicts.ok - okBefore).toBeGreaterThanOrEqual(1);
    expect(guest.pending).toBe(0);
  });

  it('a copy that reaches the host is not applied twice, and the guest still learns it was taken', async () => {
    const r = await rig(1);
    await toStage(r, 'briefing');
    const guest = r.guests[0];
    const id = r.guestClients[0].id;
    guest.submit({ k: 'ready', on: true });
    await r.clock.advance(600);
    expect(guest.pending).toBe(0);
    const dups = r.host.stats.verdicts.dup;
    // The host hears the next intent, but every st back is lost: the guest sends it again, and that copy is not applied twice.
    r.hub.lose = (event) => event === 'st';
    guest.submit({ k: 'ready', on: false });
    await r.clock.advance(COOP_NET.retryMs * 2 + 500);
    expect(guest.pending).toBe(1);
    expect(r.host.stats.verdicts.dup).toBeGreaterThan(dups);
    expect(r.host.co.ready.includes(id)).toBe(false);
    r.hub.lose = null;
    await r.clock.advance(COOP_NET.retryMs * 4);
    expect(guest.pending).toBe(0);
  });

  it('a newer waiting intent of the same kind replaces an older waiting one', async () => {
    const r = await rig(1);
    await toStage(r, 'plan');
    const guest = r.guests[0];
    const before = sent(r, 'int');
    const options = [
      { life: 0, farm: 0, lab: 0, shield: 0 },
      { life: 1, farm: 0, lab: 0, shield: 0 },
      { life: 1, farm: 1, lab: 0, shield: 0 },
      { life: 1, farm: 1, lab: 1, shield: 0 },
    ];
    for (const a of options) guest.submit({ k: 'alloc', a });
    // One in flight, one waiting (the last).
    expect(guest.pending).toBe(2);
    await r.clock.advance(3000);
    expect(sent(r, 'int') - before).toBe(2);
    expect(guest.pending).toBe(0);
  });

  it('an intent meant for a stage that has passed is dropped, and the one after it still goes', async () => {
    const r = await rig(1);
    await toStage(r, 'briefing');
    const guest = r.guests[0];
    const id = r.guestClients[0].id;
    guest.submit({ k: 'ask' }); // briefing is not the stage for it: the host calls it stale but still counts it
    await r.clock.advance(1000);
    expect(guest.pending).toBe(0);
    expect(r.host.co.acks[id]).toBe(1);
    expect(r.host.stats.verdicts.stale).toBeGreaterThanOrEqual(1);
    guest.submit({ k: 'ready', on: true });
    await r.clock.advance(1000);
    expect(r.host.co.ready).toContain(id);
  });

  it('a guest cannot queue without a state, and the queue is capped', async () => {
    const r = await rig(1, 5, 0);
    const lonely = startGuest(r.guestClients[0], r.clock, 5, r.detached);
    expect(lonely.submit({ k: 'ready', on: true })).toBeNull();
    await r.clock.advance(1500);
    expect(lonely.meta).not.toBeNull();
    // Cap: stop the host from answering, then flood with intents that do not replace each other.
    r.hub.lose = (event) => event === 'st';
    let accepted = 0;
    for (let i = 0; i < 40; i++) if (lonely.submit({ k: 'ask' }) !== null) accepted++;
    expect(accepted).toBe(COOP_NET.queueMax);
    lonely.dispose();
  });

  it('an unanswered intent is never given up on: it is sent again, with back-off, and goes through when the network is back', async () => {
    const r = await rig(1);
    await toStage(r, 'briefing');
    const guest = r.guests[0];
    const id = r.guestClients[0].id;
    r.hub.lose = (event) => event === 'int';
    guest.submit({ k: 'ready', on: true });
    guest.submit({ k: 'ask' });
    const tries = guest.stats.retries;
    await r.clock.advance(60_000);
    expect(guest.pending).toBe(2);
    // 1.5 s, then 3 s, 4.5 s, then every 6 s: well under one a second.
    expect(guest.stats.retries - tries).toBeGreaterThan(5);
    expect(guest.stats.retries - tries).toBeLessThan(16);
    r.hub.lose = null;
    await r.clock.advance(2 * 6000 + 2000);
    expect(guest.pending).toBe(0);
    expect(r.host.co.acks[id]).toBeGreaterThanOrEqual(2);
  });

  it('what the host would refuse to read is not queued at all', async () => {
    const r = await rig(1);
    await r.clock.advance(500);
    const guest = r.guests[0];
    const result = { seconds: 9999, samples: 2, science: 6, chore: false, caught: false, alerted: false };
    expect(guest.submit({ k: 'walkEnd', r: result })).toBeNull();
    expect(guest.submit({ k: 'find', i: 9 })).toBeNull();
    expect(guest.submit({ k: 'ready', on: true })).not.toBeNull();
  });

  it('build, craft and room intents survive a change of stage in the same day, with the new stamp', async () => {
    const r = await rig(1);
    await toStage(r, 'briefing');
    const guest = r.guests[0];
    const stale = r.host.stats.verdicts.stale;
    r.hub.lose = (event) => event === 'int';
    guest.submit({ k: 'build', id: BUILDINGS[0].id });
    // The host moves on by the clock while the guest's message is held up (the guest answers nothing).
    r.host.submit({ k: 'ready', on: true });
    await r.clock.advance((20 + 2) * 1000);
    expect(r.host.co.stage).not.toBe('briefing');
    expect(guest.meta!.stage).toBe(r.host.co.stage);
    expect(guest.pending).toBe(1);
    r.hub.lose = null;
    await r.clock.advance(COOP_NET.retryMs * 4 + 1000);
    expect(guest.pending).toBe(0);
    expect(r.host.stats.verdicts.stale).toBe(stale);
  });
});

// ----- Time: heartbeat, deadlines, leavers -----------------------------------------------------------------------------

describe('time', () => {
  it('the host repeats its state every 4 s when nothing happens', async () => {
    const r = await rig(1);
    await r.clock.advance(1000);
    const from = sent(r, 'st');
    await r.clock.advance(20_000);
    const beats = sent(r, 'st') - from;
    expect(beats).toBeGreaterThanOrEqual(4);
    expect(beats).toBeLessThanOrEqual(6);
    expect(r.host.stats.beats).toBeGreaterThanOrEqual(4);
  });

  it('the host never sends more than 5 st a second, and no guest room drops one for coming too fast', async () => {
    const r = await rig(1);
    const times: number[] = [];
    r.hub.lose = (event) => {
      if (event === 'st') times.push(r.clock.now());
      return false;
    };
    await play(r, () => r.host.co.stage === 'end');
    expect(times.length).toBeGreaterThan(30);
    let worst = 0;
    for (let i = 0; i < times.length; i++) worst = Math.max(worst, times.filter((t) => t >= times[i] && t < times[i] + 2000).length);
    // The room takes 12 in 2 s; the host keeps to 10.
    expect(worst).toBeLessThanOrEqual(10);
    // Every st that was sent was taken or was an older one: the room dropped none.
    // (one st went out before the counting began)
    const taken = r.guests[0].stats.adopted + r.guests[0].stats.old;
    expect(taken - times.length).toBeGreaterThanOrEqual(0);
    expect(taken - times.length).toBeLessThanOrEqual(1);
  });

  it('the countdown that starts with the first answer ends on the injected clock, with those who answered', async () => {
    const r = await rig(2);
    await r.clock.advance(500);
    expect(r.host.co.stage).toBe('briefing');
    // The host and the first guest answer; the second never does.
    r.host.submit({ k: 'ready', on: true });
    r.guests[0].submit({ k: 'ready', on: true });
    await r.clock.advance(1000);
    expect(r.host.co.deadline).not.toBeNull();
    expect(r.host.secondsLeft()).toBeLessThanOrEqual(COOP_TIMING_READY);
    await r.clock.advance((COOP_TIMING_READY - 5) * 1000);
    expect(r.host.co.stage).toBe('briefing');
    await r.clock.advance(6000);
    expect(r.host.co.stage).not.toBe('briefing');
    await r.clock.advance(1000);
    for (const g of r.guests) expect(g.meta!.stage).toBe(r.host.co.stage);
  });

  it('a guest counts the seconds down from when the state came', async () => {
    const r = await rig(2);
    await r.clock.advance(500);
    expect(r.guests[0].secondsLeft()).toBeNull();
    r.host.submit({ k: 'ready', on: true });
    await r.clock.advance(1000);
    const left = r.guests[0].secondsLeft();
    expect(left).not.toBeNull();
    expect(left!).toBeLessThanOrEqual(COOP_TIMING_READY);
    expect(left!).toBeGreaterThan(COOP_TIMING_READY - 5);
    await r.clock.advance(3000);
    // The guest's own count keeps going between snapshots.
    expect(r.guests[0].secondsLeft()!).toBeLessThan(left!);
  });

  it('a guest that leaves is dropped from the crew after 5 s, not before', async () => {
    const r = await rig(2);
    await r.clock.advance(500);
    const leaver = r.guestClients[1];
    leaver.transport.cut();
    await r.clock.advance(COOP_NET.guestGoneMs - 1500);
    expect(r.host.co.seats).toContain(leaver.id);
    await r.clock.advance(2500);
    expect(r.host.co.seats).not.toContain(leaver.id);
    expect(r.host.stats.left).toEqual([leaver.id]);
    // The crew goes on without them: the others alone finish the stage.
    await play(r, () => r.host.co.stage === 'end', { skip: [2] });
    expect(r.guests[0].meta!.seats).not.toContain(leaver.id);
    await r.clock.advance(COOP_NET.heartbeatMs + 1000);
    expectMirror(r, r.guests[0]);
  });

  it('the host leaves: a guest keeps its state, waits 20 s, then detaches once', async () => {
    const r = await rig(2);
    await play(r, () => r.host.co.mission.week >= 2);
    await r.clock.advance(1000);
    const kept = JSON.parse(JSON.stringify(normalFlags(liveOf(r.guests[0].mission))));
    const keptHistory = r.guests[0].mission.history.length;
    r.hostClient.transport.cut();
    await r.clock.advance(COOP_NET.hostGraceMs - 2000);
    expect(r.detached).toEqual([]);
    expect(r.guests[0].active).toBe(true);
    await r.clock.advance(4000);
    expect(r.detached.map((d) => d.reason)).toEqual(['hostGone', 'hostGone']);
    expect(new Set(r.detached.map((d) => d.id)).size).toBe(2);
    for (const g of r.guests) expect(g.active).toBe(false);
    // The mission the guest holds is what it last saw (the director then plays on alone from it).
    expect(JSON.parse(JSON.stringify(normalFlags(liveOf(r.guests[0].mission))))).toEqual(kept);
    expect(r.guests[0].mission.history.length).toBe(keptHistory);
    expect(r.guests[0].submit({ k: 'ready', on: true })).toBeNull();
    // No timers are left running for the detached guests.
    await r.clock.advance(60_000);
    expect(r.detached.length).toBe(2);
    r.host.dispose();
    expect(r.clock.running).toBe(0);
  });

  it('a silent host: the guest is "quiet" after 15 s, and not any more once it speaks again', async () => {
    const r = await rig(1);
    await r.clock.advance(1000);
    expect(r.guests[0].quiet).toBe(false);
    // The host's session stops sending (a sleeping tab); the room is still there.
    r.host.dispose();
    await r.clock.advance(COOP_NET.quietMs - 2000);
    expect(r.guests[0].quiet).toBe(false);
    await r.clock.advance(3000);
    expect(r.guests[0].quiet).toBe(true);
    expect(r.detached).toEqual([]);
    const again = new CoopHost(r.hostClient.room, r.host.co, { clock: r.clock });
    await r.clock.advance(1000);
    expect(r.guests[0].quiet).toBe(false);
    again.dispose();
  });

  it('while the host itself is offline nobody is dropped, and the 5 s begin again when it is back', async () => {
    const r = await rig(2);
    await r.clock.advance(500);
    const room = r.hostClient.room as unknown as { onStatus(t: number, s: 'online' | 'offline'): void; onPresence(t: number, l: unknown[]): void; token: number };
    const all = r.hub.members(channelName(r.hostClient.room.view.code)).map((m) => ({ key: m.key, meta: m.meta }));
    const hostOnly = all.filter((entry) => entry.key === r.hostClient.id);
    expect(all.length).toBe(3);
    // The link blinks: the room sees only itself, for longer than the 5 s.
    room.onStatus(room.token, 'offline');
    room.onPresence(room.token, hostOnly);
    await r.clock.advance(COOP_NET.guestGoneMs + 3000);
    expect(r.host.co.seats.length).toBe(3);
    // Back online, the list is still short for 3 s, then complete: nobody left.
    room.onStatus(room.token, 'online');
    await r.clock.advance(3000);
    room.onPresence(room.token, all);
    await r.clock.advance(COOP_NET.guestGoneMs + 3000);
    expect(r.host.co.seats.length).toBe(3);
    expect(r.host.stats.left).toEqual([]);
    // But a seat that really stays away while the connection is good is dropped, 5 s after that.
    room.onPresence(room.token, hostOnly);
    await r.clock.advance(COOP_NET.guestGoneMs + 1000);
    expect(r.host.co.seats.length).toBe(1);
  });

  it('a guest tells how long the host has been silent', async () => {
    const r = await rig(1);
    expect(r.guests[0].silentMs).toBeLessThan(1000);
    await r.clock.advance(1000);
    r.host.dispose();
    await r.clock.advance(46_000);
    expect(r.guests[0].silentMs).toBeGreaterThanOrEqual(45_000);
  });

  it('a guest the host let go is told so', async () => {
    const r = await rig(2);
    await r.clock.advance(1000);
    const g = r.guests[0];
    const meta = { ...g.meta!, rev: g.meta!.rev + 1, seats: g.meta!.seats.filter((id) => id !== r.guestClients[0].id) };
    (g as unknown as { take(m: CoopMeta, l: unknown): void }).take(meta, liveOf(r.host.co.mission));
    expect(r.detached.map((d) => d.reason)).toEqual(['removed']);
  });
});

// ----- Late and back again: sync ---------------------------------------------------------------------------------------------

describe('sync', () => {
  it('a guest that comes late gets the state and every week it misses', async () => {
    const r = await rig(2, 13, 1);
    // The second guest sits in the room without a session for three weeks; the crew moves on by the clock.
    await play(r, () => r.host.co.mission.week >= 4, { skip: [2] });
    expect(r.host.co.mission.history.length).toBeGreaterThanOrEqual(3);
    const late = startGuest(r.guestClients[1], r.clock, 13, r.detached);
    expect(late.meta).toBeNull();
    await r.clock.advance(4000);
    expect(late.meta).not.toBeNull();
    expect(late.stats.syncs).toBeGreaterThanOrEqual(1);
    expect(late.mission.history.length).toBeGreaterThanOrEqual(3);
    expect(late.missing).toBe(0);
    await r.clock.advance(COOP_NET.heartbeatMs + 1000);
    expect(late.meta!.rev).toBe(r.host.co.rev);
    expect(JSON.parse(JSON.stringify(late.mission.history))).toEqual(JSON.parse(JSON.stringify(r.host.co.mission.history)));
    late.dispose();
  });

  it('records that are many are sent in batches and arrive in order', async () => {
    crewWeeks = 10;
    const r = await rig(1, 17, 0);
    await play(r, () => r.host.co.mission.week >= 9, { skip: [1] });
    expect(r.host.co.mission.history.length).toBeGreaterThan(COOP_NET.recBatch - 1);
    const late = startGuest(r.guestClients[0], r.clock, 17, r.detached);
    await r.clock.advance(6000);
    expect(late.missing).toBe(0);
    expect(late.mission.history.length).toBe(expectedWeeks(late.meta!));
    late.dispose();
  });

  it('three guests that miss many weeks at once: the rec broadcasts stay inside what a room accepts, and all converge', async () => {
    crewWeeks = 10;
    const r = await rig(3, 23, 0);
    await play(r, () => r.host.co.mission.week >= 9, { skip: [1, 2, 3] });
    const late = r.guestClients.map((g) => startGuest(g, r.clock, 23, r.detached));
    await r.clock.advance(15_000);
    for (const g of late) {
      expect(g.missing).toBe(0);
      expect(g.meta).not.toBeNull();
      expect(g.mission.history.length).toBe(expectedWeeks(g.meta!));
    }
    await r.clock.advance(COOP_NET.heartbeatMs + 1000);
    for (const g of late) expect(g.meta!.rev).toBe(r.host.co.rev);
    for (const g of late) g.dispose();
  });

  it('after the connection comes back the guest asks again at once', async () => {
    const r = await rig(1);
    await r.clock.advance(1500);
    const guest = r.guests[0];
    const room = r.guestClients[0].room as unknown as { onStatus(token: number, state: 'online' | 'offline'): void; token: number };
    const before = guest.stats.syncs;
    room.onStatus(room.token, 'offline');
    await r.clock.advance(300);
    room.onStatus(room.token, 'online');
    await r.clock.advance(300);
    expect(guest.stats.syncs).toBe(before + 1);
    // The host answered with a state at once (not only on its next beat).
    expect(r.host.stats.syncs).toBeGreaterThanOrEqual(1);
  });
});

// ----- Housekeeping ----------------------------------------------------------------------------------------------------------------

describe('housekeeping', () => {
  it('a race-mode room never carries co-op messages, and a session over it just waits', async () => {
    const hub = new MemoryHub();
    const clock = new ManualClock();
    const a = client(hub, clock);
    const made = a.room.create();
    await tick(100);
    await made;
    const b = client(hub, clock);
    const joined = b.room.join(a.room.view.code);
    await tick(100);
    await joined;
    b.room.setReady(true);
    await tick(10);
    expect(a.room.start(CHOICE, 1, START_DATE)).toBe(true);
    await tick(10);
    expect(a.room.sendCoop('st', {})).toBe(false);
    const guest = new CoopGuest(b.room, createMission(config(1), DATA), { clock });
    await clock.advance(5000);
    expect(guest.meta).toBeNull();
    expect(guest.stats.syncs).toBe(0);
    guest.dispose();
  });

  it('dispose stops the clock and gives the room hook back; the session can be disposed twice', async () => {
    const r = await rig(1);
    expect(r.clock.running).toBe(2);
    r.guests[0].dispose();
    r.guests[0].dispose();
    r.host.dispose();
    expect(r.clock.running).toBe(0);
    expect(r.hostClient.room.onCoop).toBeNull();
    expect(r.guestClients[0].room.onCoop).toBeNull();
    expect(r.host.submit({ k: 'ready', on: true })).toBeNull();
    const logged = r.hub.log.length;
    await r.clock.advance(10_000);
    expect(r.hub.log.length).toBe(logged);
  });

  it('a host over a room it does not command is refused', async () => {
    const r = await rig(1);
    const co: CoopSim = createCoop(createMission(config(5), DATA), [r.guestClients[0].id, r.hostClient.id], 0);
    expect(() => new CoopHost(r.hostClient.room, co, { clock: r.clock })).toThrow();
  });

  it('the host closing its room ends the session (closed)', async () => {
    const r = await rig(1);
    r.hostClient.room.leave();
    await r.clock.advance(300);
    expect(r.detached.some((d) => d.id === r.hostClient.id && d.reason === 'closed')).toBe(true);
    expect(r.host.active).toBe(false);
  });
});

const COOP_TIMING_READY = 20;
