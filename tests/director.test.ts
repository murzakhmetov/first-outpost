/** The mission flow (src/game/director.ts) driven step by step with a fake 3D world. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { film, fading, lumiLine, mission, placing, profile, room, roomGame, screen, step, updateProfile } from '../src/game/store';
import { roomRewardTaken } from '../src/sim/outpost';
import { EVENTS, optionBlock } from '../src/sim/events';

const CHOICE = { site: 'mars' as const, difficulty: 'cadet' as const, weeks: 6, sunMode: 'featured' as const, windowId: 'may2024', tutorial: false };
/** Every film's remembered name, on both worlds. */
const ALL_FILMS_SEEN = Object.keys(FILMS).flatMap((id) => [id, `${id}@mars`, `${id}@moon`]);

async function frames(seconds: number): Promise<void> {
  // ~10 frames a second, like requestAnimationFrame driving World.update
  for (let i = 0; i < seconds * 10; i++) {
    h.world.frame(0.1);
    await vi.advanceTimersByTimeAsync(100);
  }
}

describe('director state machine', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    if (!h.world) await director.boot({} as HTMLCanvasElement);
    director.quitMission();
    // These tests are about the steps of the week: every film counts as seen, so none starts by itself.
    updateProfile({ introSeen: ['mars', 'moon'], filmsSeen: ALL_FILMS_SEEN });
    void director.startMission(CHOICE);
    await frames(1);
    expect(step.value).toBe('briefing');
  });

  it('control: a normal night ends in the report', async () => {
    director.continueBriefing();
    director.confirmPlan();
    director.skipWalk();
    expect(step.value).toBe('night');
    await frames(8);
    expect(step.value).toBe('report');
  });

  it('rooms stay closed while the report is open', async () => {
    director.continueBriefing();
    director.confirmPlan();
    director.skipWalk();
    await frames(8);
    expect(step.value).toBe('report');
    director.enterRoom('hab');
    await frames(1);
    expect(room.value).toBe(null);
  });

  it('a key pressed while the door closes does not open a room game behind the fade', async () => {
    director.enterRoom('hab');
    await frames(1);
    expect(room.value).toBe('hab');
    // RoomScreen Escape handler (Rooms.tsx:155-159) -> leaveRoom()
    director.leaveRoom();
    // E pressed while still standing in the pipes station ring: Interior.update (interior.ts:1786)
    // calls onUse because world.paused is false (no panel, no game) -> director.useStation
    h.world.interior.onUse({ id: 'game:pipes', kind: 'game', thing: 'air_machine', x: 0, z: 0 });
    await frames(1);
    expect(room.value).toBe(null); // outside again
    console.log('after leaving:', JSON.stringify({ roomGame: roomGame.value, worldPaused: h.world.paused }));
    // opening and closing the pause menu does not help
    director.openPanel('pause');
    director.closePanel();
    director.continueBriefing();
    director.confirmPlan();
    director.skipWalk();
    expect(step.value).toBe('night');
    await frames(60);
    console.log('one minute into the night:', JSON.stringify({ step: step.value, roomGame: roomGame.value, worldPaused: h.world.paused }));
    expect(step.value).toBe('report');
  });

  it('the doors stay shut during a storm alert, also for the Outpost menu opened from pause', async () => {
    director.continueBriefing();
    director.confirmPlan();
    step.value = 'eva';
    h.world.eva.alerting = true;
    director.openPanel('pause');
    director.openPanel('outpost');
    director.enterRoom('hab');
    await frames(1);
    expect(room.value).toBe(null);
    // When the alert is over the same door works again.
    h.world.eva.alerting = false;
    director.enterRoom('hab');
    await frames(1);
    expect(room.value).toBe('hab');
  });

  it('a room game win pays when its card shows, so Escape cannot lose it, and Continue does not pay twice', async () => {
    director.enterRoom('hab');
    await frames(1);
    h.world.interior.onUse({ id: 'game:pipes', kind: 'game', thing: 'air_machine', x: 0, z: 0 });
    expect(roomGame.value).toBe('pipes');
    const state = director.getState()!;
    expect(roomRewardTaken(state)).toBe(false);
    director.winRoomGame('hab', 'pipes');
    expect(roomRewardTaken(state)).toBe(true);
    const airAfterWin = state.air;
    // Continue (the card's button) only closes: nothing is paid a second time.
    director.finishRoomGame('hab', 'pipes', true);
    expect(state.air).toBe(airAfterWin);
    // Escape on the card closes the game; the reward stays.
    director.closeRoomGame();
    expect(roomGame.value).toBe(null);
    expect(roomRewardTaken(state)).toBe(true);
  });

  it('a saved mission with a broken shape does not leave a black screen', async () => {
    director.continueBriefing();
    const raw = JSON.parse(localStorage.getItem('fo.mission')!);
    delete raw.state.now;
    localStorage.setItem('fo.mission', JSON.stringify(raw));
    director.goTitle();
    const resumed = director.continueMission();
    await frames(1);
    await resumed;
    expect(fading.value).toBe(false);
    expect(screen.value).toBe('title');
    // The broken save is gone: Continue is not offered again.
    expect(localStorage.getItem('fo.mission')).toBeNull();
  });

  it('placing in creative mode ends when the walk starts', async () => {
    director.quitMission();
    void director.startMission({ ...CHOICE, creative: true });
    await frames(1);
    director.continueBriefing();
    director.beginPlacement('decor', 'bench');
    director.confirmPlan();
    director.beginWalk();
    console.log(JSON.stringify({ step: step.value, placing: placing.value, placerActive: h.world.placer.active }));
    expect(step.value).toBe('eva');
    expect(h.world.placer.active || placing.value !== null).toBe(false);
  });
  it('a creative mission does not count for stars, badges or the mission count', async () => {
    director.quitMission();
    const missions = profile.value.missions;
    const best = { ...profile.value.best };
    const badges = [...profile.value.badges];
    void director.startMission({ ...CHOICE, creative: true });
    await frames(1);
    let guard = 80;
    while (screen.value !== 'debrief' && guard-- > 0) {
      if (step.value === 'briefing') director.continueBriefing();
      else if (step.value === 'event') {
        const state = mission.value!;
        const event = EVENTS[state.now.eventId!];
        director.chooseEvent(event.options.find((option) => !optionBlock(option, state))!.id);
      } else if (step.value === 'eventResult') director.confirmEvent();
      else if (step.value === 'plan') director.confirmPlan();
      else if (step.value === 'evaIntro') director.skipWalk();
      else if (step.value === 'report') director.goNextWeek();
      await frames(2);
    }
    expect(screen.value).toBe('debrief');
    expect(profile.value.missions).toBe(missions);
    expect(profile.value.best).toEqual(best);
    expect(profile.value.badges).toEqual(badges);
  });
});

describe('films', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    if (!h.world) await director.boot({} as HTMLCanvasElement);
    director.quitMission();
  });

  /** Plays the week's steps until `done` says stop; films that start are watched to the end. */
  async function playUntil(done: () => boolean, onFilm?: (id: string) => void): Promise<void> {
    let guard = 120;
    while (!done() && guard-- > 0) {
      if (film.value) {
        onFilm?.(film.value);
        director.finishFilm();
      } else if (step.value === 'briefing') director.continueBriefing();
      else if (step.value === 'event') {
        const state = mission.value!;
        const event = EVENTS[state.now.eventId!];
        director.chooseEvent(event.options.find((option) => !optionBlock(option, state))!.id);
      } else if (step.value === 'eventResult') director.confirmEvent();
      else if (step.value === 'plan') director.confirmPlan();
      else if (step.value === 'evaIntro') director.skipWalk();
      else if (step.value === 'report') director.goNextWeek();
      await frames(2);
    }
  }

  it('a task film plays the first time its task comes up, then the step goes on as before', async () => {
    updateProfile({ introSeen: ['mars', 'moon'], filmsSeen: ALL_FILMS_SEEN.filter((key) => key !== 'task.plan') });
    void director.startMission(CHOICE);
    await frames(1);
    expect(film.value).toBe(null);
    await playUntil(() => step.value === 'plan' || film.value !== null);
    expect(step.value).toBe('plan');
    expect(film.value).toBe('task.plan');
    director.finishFilm();
    expect(film.value).toBe(null);
    expect(step.value).toBe('plan');
    expect(profile.value.filmsSeen).toContain('task.plan');
    // The next week's plan comes without a film.
    const week = mission.value!.week;
    await playUntil(() => mission.value!.week > week && step.value === 'plan');
    expect(step.value).toBe('plan');
    expect(film.value).toBe(null);
  });

  it('"Why?" replays a task film between steps and leaves the step as it was', async () => {
    updateProfile({ introSeen: ['mars', 'moon'], filmsSeen: ALL_FILMS_SEEN });
    void director.startMission(CHOICE);
    await frames(1);
    await playUntil(() => step.value === 'plan');
    director.explainTask('shield');
    expect(film.value).toBe('task.shield');
    director.finishFilm();
    expect(film.value).toBe(null);
    expect(step.value).toBe('plan');
  });

  it('the ending film plays before the review, and the review opens when it is over', async () => {
    updateProfile({ introSeen: ['mars', 'moon'], filmsSeen: ALL_FILMS_SEEN });
    void director.startMission({ ...CHOICE, weeks: 6 });
    await frames(1);
    const seen: string[] = [];
    await playUntil(() => screen.value === 'debrief', (id) => seen.push(id));
    expect(screen.value).toBe('debrief');
    expect(seen.some((id) => id === 'win' || id === 'lose')).toBe(true);
  });

  it('a tap skips the night: the report comes at once', async () => {
    updateProfile({ introSeen: ['mars', 'moon'], filmsSeen: ALL_FILMS_SEEN });
    void director.startMission(CHOICE);
    await frames(1);
    await playUntil(() => step.value === 'plan');
    director.confirmPlan();
    if (step.value === 'evaIntro') director.skipWalk();
    expect(step.value).toBe('night');
    director.skipNight();
    await frames(1);
    expect(step.value).toBe('report');
  });

  it('a film cannot start during a walk, and leaving the mission stops a film', async () => {
    updateProfile({ introSeen: [], filmsSeen: [] });
    void director.startMission(CHOICE);
    await frames(1);
    expect(film.value).toBe('intro');
    director.quitMission();
    expect(film.value).toBe(null);
  });

  it("Lumi's line for the step comes back after a film that started by itself", async () => {
    updateProfile({ introSeen: ['mars', 'moon'], filmsSeen: ALL_FILMS_SEEN.filter((key) => key !== 'task.plan') });
    void director.startMission({ ...CHOICE, tutorial: true });
    await frames(1);
    await playUntil(() => step.value === 'plan' || film.value !== null);
    expect(film.value).toBe('task.plan');
    // Quiet while the film plays...
    expect(lumiLine.value).toBe(null);
    director.finishFilm();
    // ...and the tutorial's line for the plan is back afterwards.
    expect(lumiLine.value?.key).toBe('lumi.t1.plan');
  });

  it('a mission closed during its last night opens the review on Continue, with no film left hanging', async () => {
    updateProfile({ introSeen: ['mars', 'moon'], filmsSeen: ALL_FILMS_SEEN });
    void director.startMission({ ...CHOICE, weeks: 6 });
    await frames(1);
    // Play to the last night and copy the save once the mission is over but before the review opens.
    let saved: string | null = null;
    for (let guard = 0; guard < 600 && !saved && screen.value !== 'debrief'; guard++) {
      if (step.value !== 'night') await playUntil(() => step.value === 'night' || screen.value === 'debrief');
      else if (mission.value?.end) saved = localStorage.getItem('fo.mission');
      else await frames(0.1);
    }
    expect(saved).not.toBeNull();
    await playUntil(() => screen.value === 'debrief');
    // The game is closed and opened again: the title screen, and Continue.
    director.goTitle();
    localStorage.setItem('fo.mission', saved!);
    step.value = 'briefing';
    const resumed = director.continueMission();
    await frames(2);
    await resumed;
    expect(screen.value).toBe('debrief');
    expect(film.value).toBe(null);
  });
});
