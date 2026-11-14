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
import { fading, mission, placing, profile, room, roomGame, screen, step, updateProfile } from '../src/game/store';
import { roomRewardTaken } from '../src/sim/outpost';
import { EVENTS, optionBlock } from '../src/sim/events';

const CHOICE = { site: 'mars' as const, difficulty: 'cadet' as const, weeks: 6, sunMode: 'featured' as const, windowId: 'may2024', tutorial: false };

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
    updateProfile({ introSeen: ['mars', 'moon'] });
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
