/**
 * Shared by the two co-op director tests (tests/director-coop-host.test.ts and tests/director-coop-guest.test.ts):
 * a started co-op room on the in-memory network and a clock the tests move by hand.
 * (No director here: the director is a module singleton, each test file mocks the 3D world and owns one.)
 */
import { expect, vi } from 'vitest';
import { EVENTS, optionBlock } from '../src/sim/events';
import type { CoopMeta, IntentBody } from '../src/sim/coop';
import type { MissionState, OptionId } from '../src/sim/types';
import type { CoopClock } from '../src/net/coop';
import { CREW_SUITS, startDateOf } from '../src/net/protocol';
import type { CrewChoice } from '../src/net/protocol';
import { CrewRoom } from '../src/net/room';
import { MemoryHub, MemoryTransport } from '../src/net/transport';

export class ManualClock implements CoopClock {
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

export const CHOICE: CrewChoice = { site: 'mars', difficulty: 'cadet', weeks: 6, windowId: 'may2024' };
export const START_DATE = startDateOf('may2024')!;
export const SEED = 7;

let counter = 0;
export interface Client {
  id: string;
  room: CrewRoom;
  transport: MemoryTransport;
}

export function client(hub: MemoryHub, clock: ManualClock): Client {
  counter++;
  const id = `dir${String(counter).padStart(6, '0')}`;
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

export interface Rooms {
  hub: MemoryHub;
  clock: ManualClock;
  host: Client;
  guests: Client[];
  /** The commander first. */
  seats: string[];
}

/** A co-op room that has started, with the commander and `guestCount` guests. */
export async function startedRooms(guestCount: number): Promise<Rooms> {
  const hub = new MemoryHub();
  const clock = new ManualClock();
  const host = client(hub, clock);
  const made = host.room.create();
  await vi.advanceTimersByTimeAsync(100);
  expect(await made).toBe(true);
  const guests: Client[] = [];
  for (let i = 0; i < guestCount; i++) {
    const guest = client(hub, clock);
    const joined = guest.room.join(host.room.view.code);
    await vi.advanceTimersByTimeAsync(100);
    expect(await joined).toBe(true);
    guest.room.setReady(true);
    guests.push(guest);
  }
  await vi.advanceTimersByTimeAsync(10);
  expect(host.room.start(CHOICE, SEED, START_DATE, 'coop')).toBe(true);
  await vi.advanceTimersByTimeAsync(10);
  return { hub, clock, host, guests, seats: [host.id, ...guests.map((g) => g.id)] };
}

/** The option a child would pick: the advice, else the first one that is not blocked. */
export function pickOption(state: MissionState): OptionId {
  const event = EVENTS[state.now.eventId!];
  const open = event.options.filter((o) => !optionBlock(o, state)).map((o) => o.id);
  return state.now.advice && open.includes(state.now.advice) ? state.now.advice : open[0];
}

/** One look of a scripted child (a session driven by hand, no director) at its own screen. */
export function scriptedAct(
  me: string,
  meta: CoopMeta | null,
  mission: MissionState,
  submit: (body: IntentBody) => unknown,
  options: { walks?: boolean; walkResult?: IntentBody & { k: 'walkEnd' } } = {},
): void {
  if (!meta) return;
  switch (meta.stage) {
    case 'briefing':
    case 'eventResult':
    case 'plan':
    case 'report':
      if (!meta.ready.includes(me)) submit({ k: 'ready', on: true });
      break;
    case 'event':
      if (!(me in meta.votes) && mission.now.eventId) submit({ k: 'vote', o: pickOption(mission) });
      break;
    case 'walk':
      if (!meta.outside) {
        if (!(me in meta.walk)) submit({ k: 'walk', go: !!options.walks });
      } else if (meta.walk[me] && !meta.returned.includes(me) && options.walkResult) {
        submit(options.walkResult);
      }
      break;
    default:
      break;
  }
}
