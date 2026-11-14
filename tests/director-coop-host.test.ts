/**
 * The shared base seen from the commander's director (src/game/director.ts + src/net/coopglue.ts): the director drives
 * the real session (CoopHost over the in-memory network), scripted guests send intents. One director per test file.
 * The 3D world is the fake one of tests/harness.ts. The clock is injected, the fake timers run the director's waits.
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

import * as director from '../src/game/director';
import { FILMS } from '../src/game/films';
import { evaResult, film, loadMissionSave, panel, screen, step, updateProfile } from '../src/game/store';
import { createMission } from '../src/sim/mission';
import { CoopGuest } from '../src/net/coop';
import type { CoopHost } from '../src/net/coop';
import { startCoopHost } from '../src/net/coopglue';
import { answered, canGoOn, coopGo, coopLive, waitingFor } from '../src/net/coopview';
import { DATA } from './bots';
import { CHOICE as ROOM_CHOICE, SEED, START_DATE, pickOption, scriptedAct, startedRooms } from './coop-rig';
import type { Rooms } from './coop-rig';

const SETUP = { site: 'mars' as const, difficulty: 'cadet' as const, weeks: ROOM_CHOICE.weeks, sunMode: 'featured' as const, windowId: 'may2024', tutorial: false };
const ALL_FILMS_SEEN = Object.keys(FILMS).flatMap((id) => [id, `${id}@mars`, `${id}@moon`]);

interface Rig {
  rooms: Rooms;
  host: CoopHost;
  guests: CoopGuest[];
}

/** Everything moves: the world's frames, the injected clock and the fake timers (the director's waits). */
async function pass(r: Rig, ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 100) {
    h.world.frame(0.1);
    await r.rooms.clock.advance(100);
    await vi.advanceTimersByTimeAsync(100);
  }
}

async function until(r: Rig, done: () => boolean, ms = 120_000, each?: () => void): Promise<void> {
  for (let t = 0; t < ms && !done(); t += 100) {
    each?.();
    await pass(r, 100);
  }
  expect(done()).toBe(true);
}

/** The director's mission with the commander in the room and `guestCount` scripted guests. */
async function rig(guestCount: number): Promise<Rig> {
  const rooms = await startedRooms(guestCount);
  void director.startMission(SETUP, { seed: SEED, startDate: START_DATE });
  const r = { rooms, host: null as unknown as CoopHost, guests: [] as CoopGuest[] };
  await pass(r, 1000);
  expect(step.value).toBe('briefing');
  r.host = startCoopHost(rooms.host.room, rooms.seats, { clock: rooms.clock });
  const config = director.getState()!.config;
  r.guests = rooms.guests.map((g) => new CoopGuest(g.room, createMission(config, DATA), { clock: rooms.clock }));
  await pass(r, 500);
  return r;
}

/** What the host's director does at each screen, once per screen. */
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
    case 'event': {
      mark();
      director.chooseEvent(pickOption(s));
      break;
    }
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

/** A guest session that is scripted from the outside: guests[i] answers what the stage asks. */
function guestsAct(r: Rig, walkers: number[], result?: NonNullable<Parameters<typeof scriptedAct>[4]>['walkResult']): void {
  r.guests.forEach((g, i) => {
    if (g.pending > 0) return;
    scriptedAct(r.rooms.guests[i].id, g.meta, g.mission, (body) => g.submit(body), { walks: walkers.includes(i), walkResult: result });
  });
}

const WALK = (picked: number[], science: number) =>
  ({ k: 'walkEnd', r: { seconds: 40, samples: picked.length, science, chore: false, caught: false, alerted: false, picked } }) as const;

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

describe('the commander\'s director in a shared base', () => {
  it('shows the crew to the screen, offers "Go on" after 5 s, and "Go on" moves the crew on with those who answered', async () => {
    expect(coopLive.value).toBeNull();
    const r = await rig(2);
    const first = coopLive.value!;
    expect(first.me).toBe(r.rooms.host.id);
    expect(first.hostId).toBe(r.rooms.host.id);
    expect(first.stage).toBe('briefing');
    director.continueBriefing();
    await pass(r, 300);
    expect(answered(coopLive.value!)).toEqual([r.rooms.host.id]);
    expect(waitingFor(coopLive.value!)).toHaveLength(2);
    expect(canGoOn(coopLive.value!, Date.now())).toBe(false);
    await pass(r, 5200);
    expect(canGoOn(coopLive.value!, Date.now())).toBe(true);
    coopGo();
    await pass(r, 300);
    expect(['event', 'plan']).toContain(coopLive.value!.stage);
    director.quitMission();
    expect(coopLive.value).toBeNull();
  });

  it('runs a whole week: guests vote and walk, the merged walk is applied once, the night is worked out once', async () => {
    const r = await rig(2);
    const s = director.getState()!;
    expect(s.now.evaAllowed).toBe(true);
    const scienceBefore = s.science;
    // Guest 0 walks and brings two samples (slots 0 and 2); guest 1 stays; the commander stays too.
    const result = WALK([0, 2], 6);
    await until(r, () => step.value === 'report', 180_000, () => {
      directorAct(false);
      guestsAct(r, [0], result);
    });
    const after = director.getState()!;
    expect(after.week).toBe(1);
    expect(after.history.length).toBe(1);
    expect(after.history[0].week).toBe(1);
    // The merged walk was applied once (applyEva refuses a second one) and it is guest 0's walk.
    expect(after.now.eva?.science).toBe(6);
    expect(after.now.eva?.samples).toBe(2);
    expect(after.science).toBeGreaterThanOrEqual(scienceBefore + 6);
    // The commander did not walk: no walk on its own world.
    expect(h.world.calls).not.toContain('startEva');
    expect(r.host.co.mission).toBe(after);
    expect(r.host.co.stage).toBe('report');
    // Everybody says ready: the next week begins on every device.
    await until(r, () => director.getState()!.week === 2 && step.value === 'briefing', 60_000, () => {
      directorAct(false);
      guestsAct(r, [0]);
    });
    await pass(r, 4500);
    for (const g of r.guests) {
      expect(g.mission.week).toBe(2);
      expect(g.mission.history.length).toBe(1);
      expect(JSON.parse(JSON.stringify(g.mission.history))).toEqual(JSON.parse(JSON.stringify(after.history)));
    }
    expect(director.getState()!.history.length).toBe(1);
  });

  it('the commander walks too: its result is held for the merge and the crew gets the union of the samples', async () => {
    const r = await rig(2);
    const scienceBefore = director.getState()!.science;
    const guestWalk = WALK([0, 2], 6);
    // Get to the walk choice. The commander and guest 0 go out, guest 1 stays.
    await until(r, () => step.value === 'eva', 120_000, () => {
      directorAct(true);
      guestsAct(r, [0]);
    });
    expect(h.world.calls).toContain('startEva');
    // The commander is back first, with slots 1 and 2: nothing is applied yet.
    h.world.eva.active = false;
    h.world.eva.onFinish({ seconds: 30, samples: 2, science: 6, chore: true, caught: false, alerted: false, finds: [], materials: { regolith: 0, metal: 0 }, picked: [1, 2] }, 'home');
    expect(step.value).toBe('evaResult');
    expect(evaResult.value?.result.science).toBe(6);
    expect(director.getState()!.now.eva).toBeFalsy();
    expect(director.getState()!.science).toBe(scienceBefore);
    // Guest 0 comes back with slots 0 and 2: the host merges once. Slots 0, 1, 2 are worth 2 + 2 + 4.
    await until(r, () => step.value === 'report', 60_000, () => guestsAct(r, [0], guestWalk));
    const after = director.getState()!;
    expect(after.now.eva?.science).toBe(8);
    expect(after.now.eva?.samples).toBe(3);
    expect(after.now.eva?.chore).toBe(true);
    expect(after.science).toBeGreaterThanOrEqual(scienceBefore + 8);
    expect(after.history.length).toBe(1);
  });

  it('the commander is the last walker back: the night starts at once, with no dead result card', async () => {
    const r = await rig(1);
    await until(r, () => step.value === 'eva', 120_000, () => {
      directorAct(true);
      guestsAct(r, [0]);
    });
    // The guest comes back first and the host keeps its walk.
    await until(r, () => Object.keys(r.host.co.returned).length === 1, 10_000, () => guestsAct(r, [0], WALK([0, 3], 6)));
    expect(step.value).toBe('eva');
    h.world.eva.active = false;
    h.world.eva.onFinish({ seconds: 30, samples: 1, science: 2, chore: false, caught: false, alerted: false, finds: [], materials: { regolith: 0, metal: 0 }, picked: [1] }, 'home');
    // The merge, the night and the report's record all ran inside that call: the screen is the night.
    expect(step.value).toBe('night');
    expect(evaResult.value).toBeNull();
    expect(director.getState()!.now.eva?.science).toBe(8);
    await pass(r, 4500);
    expect(step.value).toBe('report');
  });

  it('plays a whole mission, ends with the debrief, and the next mission is solo again', async () => {
    const r = await rig(1);
    await until(r, () => screen.value === 'debrief', 900_000, () => {
      if (film.value !== null) director.finishFilm();
      directorAct(false);
      guestsAct(r, []);
    });
    expect(director.getState()!.history.length).toBe(ROOM_CHOICE.weeks);
    expect(r.host.co.stage).toBe('end');
    // A later heartbeat does not save the finished mission again.
    expect(loadMissionSave()).toBeNull();
    await pass(r, 9000);
    expect(loadMissionSave()).toBeNull();
    // Another mission: the port was dropped, a button works on its own.
    void director.startMission(SETUP);
    await pass(r, 1000);
    expect(step.value).toBe('briefing');
    director.continueBriefing();
    expect(['event', 'plan']).toContain(step.value);
  });

  it('the host\'s pause menu during the night does not hold the report (the sky clock stops, the night does not wait for it)', async () => {
    const r = await rig(1);
    // Plan: everyone ready, no walk: the night comes at once.
    await until(r, () => step.value === 'plan', 60_000, () => {
      directorAct(false);
      guestsAct(r, []);
    });
    // A walk is allowed in week 1: both stay.
    await until(r, () => step.value === 'evaIntro', 60_000, () => {
      directorAct(false);
      guestsAct(r, []);
    });
    await until(r, () => step.value === 'night', 60_000, () => {
      directorAct(false);
      guestsAct(r, []);
    });
    // The host is already in the report; this device plays the night. Open the pause menu now.
    expect(r.host.co.stage).toBe('report');
    director.openPanel('pause');
    expect(panel.value).toBe('pause');
    expect(h.world.paused).toBe(true);
    const clockBefore = h.world.getClock();
    await pass(r, 1000);
    expect(h.world.getClock()).toBe(clockBefore); // the clock is stopped by the menu
    expect(step.value).toBe('night');
    await pass(r, 4000);
    // The clock never ran (a menu is open), and the report is there all the same.
    expect(step.value).toBe('report');
    expect(h.world.getClock()).toBeCloseTo(0.38, 5);
    expect(panel.value).toBe('pause');
    // The guest was never held either: it can say ready on the report while the host's menu is open.
    guestsAct(r, []);
    await pass(r, 1500);
    expect(r.host.co.ready.length).toBe(1);
    director.closePanel();
    expect(h.world.paused).toBe(false);
  });

  it('solo behaviour is back when the session ends: the port is dropped and the director plays on alone', async () => {
    const r = await rig(1);
    await until(r, () => step.value === 'plan', 60_000, () => {
      directorAct(false);
      guestsAct(r, []);
    });
    r.rooms.host.room.leave();
    await pass(r, 500);
    expect(r.host.active).toBe(false);
    // Solo: Start the plan works on its own (no ready check, no guest needed).
    director.confirmPlan();
    await pass(r, 6000);
    expect(['evaIntro', 'night', 'report']).toContain(step.value);
  });
});
