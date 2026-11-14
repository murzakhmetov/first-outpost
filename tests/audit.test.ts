/**
 * Findings of the full code audit, each pinned by a test: what a card result shows, what the radio
 * rule decides, what a damaged save does, and a few rules that earlier tests could not catch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODEX } from '../src/data/codex';
import { reduceDonki } from '../src/sim/donki';
import { EVENTS, optionBlock } from '../src/sim/events';
import { chooseOption, createMission, currentEnv, earthAnswerFor, setAlloc } from '../src/sim/mission';
import { buildBlock, placeBuilding, startBuilding } from '../src/sim/outpost';
import type { MissionConfig, MissionState } from '../src/sim/types';
import { DATA } from './bots';

function config(over: Partial<MissionConfig> = {}): MissionConfig {
  return { site: 'moon', difficulty: 'cadet', weeks: 6, startDate: '2019-12-01', seed: 1, tutorial: false, sunMode: 'random', ...over };
}

function withCard(state: MissionState, id: string): void {
  state.now.eventId = id;
  state.now.eventDone = false;
  state.now.advice = 'a';
}

describe('card results show what really changed', () => {
  it('a full tank takes no more air, and the result says so', () => {
    const state = createMission(config(), DATA);
    state.air = 95;
    withCard(state, 'resupply');
    const result = chooseOption(state, 'b');
    expect(result).not.toBeNull();
    expect(state.air).toBe(100);
    expect(result!.fx.air).toBe(5);
  });

  it('science that is not there cannot be spent, and the result says so', () => {
    const state = createMission(config(), DATA);
    state.science = 0;
    withCard(state, 'resupply');
    const result = chooseOption(state, 'a');
    expect(result!.fx.science ?? 0).toBe(0);
  });
});

describe('advice that follows the numbers', () => {
  const advice = (state: MissionState): string => {
    const pick = EVENTS.resupply.advice;
    return typeof pick === 'function' ? pick(state, currentEnv(state)) : pick;
  };

  it('resupply: air above 70 is not worth the science', () => {
    const state = createMission(config(), DATA);
    state.food = 5;
    state.air = 95;
    expect(advice(state)).toBe('c');
    state.air = 40;
    expect(advice(state)).toBe('b');
    state.food = 1;
    expect(advice(state)).toBe('a');
  });

  it('the school call is advised only when the week can spare the cell', () => {
    const state = createMission(config(), DATA);
    const pick = EVENTS.school_call.advice;
    const fn = (state: MissionState): string => (typeof pick === 'function' ? pick(state, currentEnv(state)) : pick);
    state.now.available = 5;
    expect(fn(state)).toBe('a');
    state.now.available = 3;
    expect(fn(state)).toBe('b');
  });

  it('a rest is worth more than one working week of overtime', () => {
    const rest = EVENTS.tired_crew.options.find((option) => option.id === 'a')!;
    const mods = typeof rest.mods === 'function' ? rest.mods(createMission(config(), DATA)) : (rest.mods ?? []);
    expect(mods.find((mod) => mod.id === 'rested')?.weeks).toBeGreaterThanOrEqual(2);
  });
});

describe('a price that cannot be paid is not offered', () => {
  it('cold snap: wasting the crop needs a crop to waste', () => {
    const state = createMission(config({ site: 'mars' }), DATA);
    const option = EVENTS.cold_snap.options.find((item) => item.id === 'b')!;
    state.crop = 1;
    expect(optionBlock(option, state)).not.toBeNull();
    state.crop = 2;
    expect(optionBlock(option, state)).toBeNull();
  });
});

describe('the radio rule at its edge', () => {
  it('an answer in 15 minutes round trip is in time, a minute more is late', () => {
    const state = createMission(config({ site: 'mars', sunMode: 'featured', windowId: 'may2024', startDate: '2024-05-01' }), DATA);
    withCard(state, Object.values(EVENTS).find((event) => event.urgent && event.sites.includes('mars'))!.id);
    const env = state.plan[state.week - 1];
    state.plan[state.week - 1] = { ...env, delaySeconds: 7 * 60, conjunction: false };
    expect(earthAnswerFor(state)!.tooLate).toBe(false);
    state.plan[state.week - 1] = { ...env, delaySeconds: 8 * 60, conjunction: false };
    expect(earthAnswerFor(state)!.tooLate).toBe(true);
  });
});

describe('the cell plan', () => {
  it('refuses a plan that is bigger than the cells of the week', () => {
    const state = createMission(config(), DATA);
    state.now.available = 10;
    state.alloc = { life: 4, farm: 3, lab: 3, shield: 0 };
    expect(setAlloc(state, 'shield', 1)).toBe(false);
    expect(state.alloc.shield).toBe(0);
  });
});

describe('creative mode buildings', () => {
  it('a building ordered first and then set down starts to work', () => {
    const state = createMission(config({ creative: true }), DATA);
    expect(buildBlock(state, 'oxygen')).toBeNull();
    expect(startBuilding(state, 'oxygen')).toBe(true);
    expect(placeBuilding(state, 'oxygen', 6, 6, 0)).toBe(true);
    expect(state.modifiers.some((mod) => mod.id === 'building:oxygen')).toBe(true);
    // Setting it down again does not add the effect twice.
    placeBuilding(state, 'oxygen', 8, 8, 0);
    expect(state.modifiers.filter((mod) => mod.id === 'building:oxygen')).toHaveLength(1);
  });
});

describe('NASA data reading', () => {
  it('ENLIL: a direct hit without a speed does not borrow the speed of a glancing one', () => {
    const link = (id: string): string => `https://kauai.ccmc.gsfc.nasa.gov/DONKI/view/WSA-ENLIL/${id}/-1`;
    const days = reduceDonki({
      enlil: [
        { link: link('1'), cmeInputs: [{ speed: 2000 }], impactList: [{ location: 'Mars', arrivalTime: '2020-01-05T10:00Z', isGlancingBlow: true }] },
        { link: link('2'), cmeInputs: [], impactList: [{ location: 'Mars', arrivalTime: '2020-01-05T12:00Z', isGlancingBlow: false }] },
      ],
    } as never);
    expect(days['2020-01-05'].ma).toBe(2);
    expect(days['2020-01-05'].mv).toBeUndefined();
  });
});

describe('every Science log card names its sources', () => {
  it('has at least one secure link on each card', () => {
    expect(CODEX.length).toBeGreaterThan(60);
    for (const card of CODEX) {
      expect(card.sources.length, card.id).toBeGreaterThan(0);
      for (const source of card.sources) expect(source.url, `${card.id}: ${source.title}`).toMatch(/^https:\/\//);
    }
  });
});

describe('saved data that is damaged or old', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  async function freshStore(entries: Record<string, string>) {
    vi.resetModules();
    const { shims } = await import('./harness');
    shims();
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    return import('../src/game/store');
  }

  it('a profile with fields of the wrong kind falls back to the defaults', async () => {
    const store = await freshStore({ 'fo.profile': JSON.stringify({ unlocked: null, best: 5, name: 7, suit: '#ff5fa2' }) });
    expect(Array.isArray(store.profile.value.unlocked)).toBe(true);
    expect(typeof store.profile.value.best).toBe('object');
    expect(typeof store.profile.value.name).toBe('string');
    // A field that is fine is kept.
    expect(store.profile.value.suit).toBe('#ff5fa2');
  });

  it('a saved mission of another version is not offered', async () => {
    const state = createMission(config({ site: 'mars' }), DATA);
    const store = await freshStore({ 'fo.mission': JSON.stringify({ version: 2, step: 'plan', state }) });
    expect(store.loadMissionSave()).toBeNull();
    localStorage.setItem('fo.mission', JSON.stringify({ version: 3, step: 'plan', state }));
    expect(store.loadMissionSave()?.state.config.site).toBe('mars');
  });
});
