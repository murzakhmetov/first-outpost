/**
 * The shared base seen from a guest's director (src/game/director.ts + src/net/coopglue.ts): the director mirrors a
 * real CoopHost session (no director on that side: the pure reducer of src/sim/coop.ts behind the session), scripted
 * children answer for the others. One director per test file. The 3D world is the fake one of tests/harness.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ world: null as any }));
vi.hoisted(async () => {
  const { shims } = await import('./harness');
  shims();
});

vi.mock('../src/world/world.ts', async () => {
  const { FakeWorld } = await import('./harness');
  class World extends FakeWorld {
    constructor() {
      super();
      h.world = this;
    }
  }
  return { World };
});
vi.mock('../src/world/models.ts', () => ({
  loadModels: async () => {},
  modelDetail: () => 'low',
  onLateModel: () => () => {},
  hasModel: () => false,
  modelPart: () => { throw new Error('no models'); },
  model: () => { throw new Error('no models'); },
  modelGeometry: () => { throw new Error('no models'); },
  modelUrls: () => [],
  outlineGeometry: (g: unknown) => g,
}));
vi.mock('../src/world/quality.ts', () => ({
  QUALITY: { low: { tier: 'low' }, medium: { tier: 'medium' }, high: { tier: 'high' }, ultra: { tier: 'ultra' } },
  TIERS: ['low', 'medium', 'high', 'ultra'],
  guessTier: () => 'medium',
  shiftTier: (t: string) => t,
}));
vi.mock('../src/game/audio.ts', () => {
  const noop = () => {};
  return { audio: new Proxy({}, { get: () => noop }), stopSpeaking: noop, canSpeak: () => false, speak: noop };
});
vi.mock('../src/game/data.ts', async () => {
  const { DATA } = await import('./bots');
  const { signal } = await import('@preact/signals');
  return {
    dataInfo: signal({ sunTo: '2026-11-01', archiveFrom: '2010-04-01', sunFetchedAt: '', live: false, counts: { flares: 0, sepEvents: 0, geomagneticStorms: 0, enlilSimulations: 0 }, marsFrom: '', marsTo: '', marsSols: 0 }),
    loadData: async () => {},
    simData: () => DATA,
    refreshLive: async () => false,
    liveStartDate: () => '2024-04-26',
  };
});

import { effect } from '@preact/signals';
import * as director from '../src/game/director';
import { FILMS } from '../src/game/films';
import { fading, film, loadMissionSave, room, roomGame, screen, step, updateProfile } from '../src/game/store';
import { coopMeta, createCoop } from '../src/sim/coop';
import { createMission } from '../src/sim/mission';
import { ensureOutpost } from '../src/sim/outpost';
import { MODULES } from '../src/sim/types';
import { CoopGuest, CoopHost } from '../src/net/coop';
import { startCoopGuest } from '../src/net/coopglue';
import { canPlayAlone, coopLive, coopPlayAlone, coopSilentMs, waitingForCommander } from '../src/net/coopview';
import { DATA } from './bots';
import { CHOICE as ROOM_CHOICE, SEED, START_DATE, pickOption, scriptedAct, startedRooms } from './coop-rig';
import type { Rooms } from './coop-rig';

const SETUP = { site: 'mars' as const, difficulty: 'cadet' as const, weeks: ROOM_CHOICE.weeks, sunMode: 'featured' as const, windowId: 'may2024', tutorial: false };
const ALL_FILMS_SEEN = Object.keys(FILMS).flatMap((id) => [id, `${id}@mars`, `${id}@moon`]);

interface Rig {
  rooms: Rooms;
  /** The commander: a session driven by hand, no director. */
  host: CoopHost;
  /** The seat with the director (seat 1). */
  me: CoopGuest;
  /** More guests driven by hand (seats 2 ...). */
  others: CoopGuest[];
}

/** The world's frames (a night would wait for them), the injected clock and the fake timers. */
async function pass(r: Rig, ms: number, frames = true): Promise<void> {
  for (let t = 0; t < ms; t += 100) {
    if (frames) h.world.frame(0.1);
    await r.rooms.clock.advance(100);
    await vi.advanceTimersByTimeAsync(100);
  }
}

async function until(r: Rig, done: () => boolean, ms: number, each?: () => void, frames = true): Promise<void> {
  for (let t = 0; t < ms && !done(); t += 100) {
    each?.();
    await pass(r, 100, frames);
  }
  expect(done()).toBe(true);
}

/** A crew of the commander (by hand), the director's seat and `others` more guests (by hand). */
async function rig(others: number): Promise<Rig> {
  const rooms = await startedRooms(1 + others);
  void director.startMission(SETUP, { seed: SEED, startDate: START_DATE });
  const r = { rooms, host: null as unknown as CoopHost, me: null as unknown as CoopGuest, others: [] as CoopGuest[] };
  await pass(r, 1000);
  expect(step.value).toBe('briefing');
  const config = director.getState()!.config;
  const hostMission = createMission(config, DATA);
  ensureOutpost(hostMission);
  r.host = new CoopHost(rooms.host.room, createCoop(hostMission, rooms.seats, rooms.clock.now()), { clock: rooms.clock });
  r.me = startCoopGuest(rooms.guests[0].room, { clock: rooms.clock });
  r.others = rooms.guests.slice(1).map((g) => new CoopGuest(g.room, createMission(config, DATA), { clock: rooms.clock }));
  await pass(r, 500);
  return r;
}


/** The commander and the other guests answer what the stage asks (the commander never walks). */
function othersAct(r: Rig, options: { hostReady?: boolean; walkers?: number[] } = {}): void {
  const { hostReady = true, walkers = [] } = options;
  if (hostReady) scriptedAct(r.rooms.host.id, coopMeta(r.host.co, r.rooms.clock.now()), r.host.co.mission, (b) => r.host.submit(b), { walks: false });
  r.others.forEach((g, i) => {
    if (g.pending > 0) return;
    scriptedAct(r.rooms.guests[i + 1].id, g.meta, g.mission, (b) => g.submit(b), { walks: walkers.includes(i) });
  });
}

/** What the director's seat does at each screen, once per screen. */
const done = new Set<string>();
function directorAct(walk: boolean): void {
  const s = director.getState()!;
  const key = `${s.week}:${step.value}`;
  if (done.has(key)) return;
  const mark = (): void => void done.add(key);
  switch (step.value) {
    case 'briefing':
      mark();
      director.continueBriefing();
      break;
    case 'event':
      mark();
      director.chooseEvent(pickOption(s));
      break;
    case 'eventResult':
      mark();
      director.confirmEvent();
      break;
    case 'plan':
      mark();
      director.confirmPlan();
      break;
    case 'evaIntro':
      mark();
      if (walk) director.beginWalk();
      else director.skipWalk();
      break;
    case 'report':
      mark();
      director.goNextWeek();
      break;
    default:
      break;
  }
}

/** Every value `step` took, in order. */
function watchSteps(): { seq: string[]; stop: () => void } {
  const seq: string[] = [];
  const stop = effect(() => {
    if (seq[seq.length - 1] !== step.value) seq.push(step.value);
  });
  return { seq, stop };
}

/** True when `part` appears in `seq` in that order (other values may sit between). */
function inOrder(seq: string[], part: string[]): boolean {
  let at = 0;
  for (const value of seq) if (value === part[at]) at++;
  return at === part.length;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  done.clear();
  if (!h.world) await director.boot({} as HTMLCanvasElement);
  director.quitMission();
  updateProfile({ introSeen: ['mars', 'moon'], filmsSeen: ALL_FILMS_SEEN });
});
afterEach(() => {
  director.quitMission();
  vi.useRealTimers();
});

describe('a guest\'s director in a shared base', () => {
  it('follows the host through a week without the sky clock; its walk is sent, not applied; its plan edit shows at once', async () => {
    const r = await rig(1);
    const steps = watchSteps();
    const s = director.getState()!;
    expect(r.host.co.mission).not.toBe(s);
    // Plan: the others say ready first, then this seat edits the plan.
    await until(r, () => step.value === 'plan', 60_000, () => {
      othersAct(r);
      directorAct(true);
    }, false);
    await until(r, () => r.host.co.ready.length >= 2, 10_000, () => othersAct(r), false);
    const hostSideBefore = JSON.stringify(r.host.co.mission.alloc);
    let edited = false;
    for (const module of MODULES) {
      for (const delta of [1, -1]) {
        if (edited) break;
        const before = JSON.stringify(director.getState()!.alloc);
        director.changeAlloc(module, delta);
        edited = JSON.stringify(director.getState()!.alloc) !== before;
      }
    }
    expect(edited).toBe(true);
    // At once on this device (the host has not answered yet) ...
    expect(JSON.stringify(director.getState()!.alloc)).not.toBe(hostSideBefore);
    // ... and then the host has it, and every Ready is cleared.
    await pass(r, 1500, false);
    expect(JSON.stringify(r.host.co.mission.alloc)).toBe(JSON.stringify(director.getState()!.alloc));
    expect(r.host.co.ready).toEqual([]);
    // On to the walk. This seat walks; the commander and the other guest stay.
    director.confirmPlan();
    await until(r, () => step.value === 'eva', 180_000, () => {
      othersAct(r);
      directorAct(true);
    }, false);
    expect(h.world.calls).toContain('startEva');
    expect(director.getState()!.now.eva).toBeFalsy();
    const scienceBefore = director.getState()!.science;
    h.world.eva.active = false;
    h.world.eva.onFinish({ seconds: 30, samples: 2, science: 6, chore: false, caught: false, alerted: false, finds: [], materials: { regolith: 0, metal: 0 }, picked: [0, 3] }, 'home');
    // Applied nowhere on this device: the host takes the walk (merged, once) and the state comes back.
    expect(step.value).toBe('evaResult');
    expect(director.getState()!.science).toBe(scienceBefore);
    // The sky clock never runs here (no frames): the night and the report do not wait for it.
    await until(r, () => step.value === 'report', 30_000, () => othersAct(r), false);
    const mine = director.getState()!;
    expect(mine.now.eva?.science).toBe(6);
    expect(mine.science).toBe(r.host.co.mission.science);
    expect(mine.history.length).toBe(1);
    expect(JSON.parse(JSON.stringify(mine.history))).toEqual(JSON.parse(JSON.stringify(r.host.co.mission.history)));
    expect(inOrder(steps.seq, ['briefing', 'plan', 'evaIntro', 'eva', 'evaResult', 'night', 'report'])).toBe(true);
    // The next week: ready on the report, and the host moves everyone on.
    await until(r, () => step.value === 'briefing' && director.getState()!.week === 2, 60_000, () => {
      othersAct(r);
      directorAct(true);
    }, false);
    expect(r.host.co.mission.week).toBe(2);
    steps.stop();
  });

  it('a guest in a room (with a small game open) when the walk is chosen waits there, and is brought out at night', async () => {
    const r = await rig(1);
    await until(r, () => step.value === 'plan', 60_000, () => {
      othersAct(r);
      directorAct(false);
    });
    // Back to a plan where this seat is not ready yet: walk into the farm and open a game.
    expect(r.host.co.stage).toBe('plan');
    director.enterRoom('farm');
    await pass(r, 800);
    expect(room.value).toBe('farm');
    roomGame.value = 'plants';
    const steps = watchSteps();
    // The others say ready; the countdown ends and the walk choice comes. This seat stays in the room: no change on screen.
    await until(r, () => r.host.co.stage === 'walk', 60_000, () => othersAct(r));
    expect(step.value).toBe('plan');
    expect(room.value).toBe('farm');
    // The others stay in; the crew goes to the night with them. The room is closed from outside.
    await until(r, () => r.host.co.stage === 'report', 120_000, () => othersAct(r));
    expect(room.value).toBeNull();
    expect(roomGame.value).toBeNull();
    expect(fading.value).toBe(false);
    expect(h.world.calls).toContain('leaveRoom');
    await pass(r, 4500);
    expect(step.value).toBe('report');
    expect(inOrder(steps.seq, ['plan', 'night', 'report'])).toBe(true);
    expect(director.getState()!.history.length).toBe(1);
    steps.stop();
  });

  it('a stage that comes during a film waits for the film; the screen then jumps to the latest stage', async () => {
    const r = await rig(1);
    expect(step.value).toBe('briefing');
    director.explainTask('plan');
    expect(film.value).not.toBeNull();
    const state = director.getState()!;
    const week = state.week;
    // The others are ready; the commander's "Go on" (after 5 s) moves the crew on, past the card if there is one.
    await until(r, () => r.host.co.stage === 'plan' && r.host.co.mission.week === week, 120_000, () => {
      othersAct(r);
    });
    // The film is still on: the screen has not moved, the numbers are the host's.
    expect(film.value).not.toBeNull();
    expect(step.value).toBe('briefing');
    expect(director.getState()!.week).toBe(week);
    const steps = watchSteps();
    director.finishFilm();
    expect(film.value).toBeNull();
    expect(step.value).toBe('plan');
    // The cards of the host's stages in between were skipped.
    expect(steps.seq).not.toContain('event');
    expect(steps.seq).not.toContain('eventResult');
    steps.stop();
  });

  it('shows the crew to the screen; a silent commander shows "waiting", then "play on alone" leaves the crew', async () => {
    expect(coopLive.value).toBeNull();
    const r = await rig(1);
    const live = coopLive.value!;
    expect(live.me).toBe(r.rooms.guests[0].id);
    expect(live.hostId).toBe(r.rooms.host.id);
    expect(live.seats).toEqual(r.rooms.seats);
    expect(live.stage).toBe('briefing');
    expect(waitingForCommander(live)).toBe(false);
    // This seat answers: a countdown starts, and it ends at the same moment whenever the screen is refreshed.
    director.continueBriefing();
    await pass(r, 600, false);
    const ends = coopLive.value!.endsAt;
    expect(ends).not.toBeNull();
    // The commander's device stops sending (it is still in the room): quiet from 15 s, "play on alone" from 45 s.
    r.host.dispose();
    await pass(r, 16_000, false);
    expect(waitingForCommander(coopLive.value!)).toBe(true);
    expect(coopLive.value!.endsAt).toBe(ends);
    expect(canPlayAlone(coopSilentMs())).toBe(false);
    await pass(r, 30_000, false);
    expect(canPlayAlone(coopSilentMs())).toBe(true);
    coopPlayAlone();
    expect(coopLive.value).toBeNull();
    // Solo code from here: the call is not sent anywhere, it runs.
    director.continueBriefing();
    expect(['event', 'plan']).toContain(step.value);
    director.quitMission();
    expect(coopLive.value).toBeNull();
  });

  it('plays a whole mission, ends with the debrief, ignores the host heartbeats after it, and the next mission is solo', async () => {
    const r = await rig(1);
    await until(r, () => screen.value === 'debrief', 900_000, () => {
      if (film.value !== null) director.finishFilm();
      othersAct(r);
      directorAct(false);
    }, false);
    expect(director.getState()!.history.length).toBe(ROOM_CHOICE.weeks);
    expect(r.host.co.stage).toBe('end');
    expect(loadMissionSave()).toBeNull();
    // The host sends its last state again every 4 s: the finished mission is not saved again, nor replaced.
    const finished = director.getState();
    await pass(r, 9000, false);
    expect(loadMissionSave()).toBeNull();
    expect(director.getState()).toBe(finished);
    expect(screen.value).toBe('debrief');
    void director.startMission(SETUP);
    await pass(r, 1000);
    expect(step.value).toBe('briefing');
    director.continueBriefing();
    expect(['event', 'plan']).toContain(step.value);
    expect(director.getState()).not.toBe(finished);
  });

  it('the host leaves: after the grace the guest plays on alone, and its finished walk counts', async () => {
    const r = await rig(1);
    const steps = watchSteps();
    // This seat and the other guest walk; the other guest never comes back, so the host keeps waiting.
    await until(r, () => step.value === 'eva', 240_000, () => {
      othersAct(r, { walkers: [0] });
      directorAct(true);
    }, false);
    expect(r.host.co.outside).toBe(true);
    const scienceBefore = director.getState()!.science;
    h.world.eva.active = false;
    h.world.eva.onFinish({ seconds: 35, samples: 2, science: 6, chore: false, caught: false, alerted: false, finds: [], materials: { regolith: 0, metal: 0 }, picked: [0, 3] }, 'home');
    await pass(r, 800, false);
    expect(Object.keys(r.host.co.returned)).toEqual([r.rooms.guests[0].id]);
    expect(r.host.co.mission.now.eva).toBeFalsy();
    // The commander's device goes dark.
    r.rooms.host.transport.cut();
    await pass(r, 15_000, false);
    expect(director.getState()!.now.eva).toBeFalsy();
    await pass(r, 9000, false);
    // Detached: the walk the host never merged is applied here, once.
    const alone = director.getState()!;
    expect(alone.now.eva?.science).toBe(6);
    expect(alone.now.eva).not.toHaveProperty('picked');
    expect(alone.science).toBe(scienceBefore + 6);
    expect(step.value).toBe('evaResult');
    // Solo code from here: the night is worked out on this device, the next week starts on its own.
    director.finishWalk();
    await pass(r, 6000, true);
    expect(step.value).toBe('report');
    expect(director.getState()!.history.length).toBe(1);
    expect(director.getState()!.history[0].week).toBe(1);
    director.goNextWeek();
    expect(director.getState()!.week).toBe(2);
    expect(step.value).toBe('briefing');
    director.continueBriefing();
    expect(['event', 'plan']).toContain(step.value);
    expect(inOrder(steps.seq, ['eva', 'evaResult', 'night', 'report', 'briefing'])).toBe(true);
    steps.stop();
  });
});
