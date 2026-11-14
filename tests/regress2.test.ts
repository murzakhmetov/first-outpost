/**
 * Bugs found by the second review, kept fixed. Each test names what a player
 * would have seen.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EVENTS, optionBlock } from '../src/sim/events';
import { applyEva, chooseOption, computeWeek, createMission, nextWeek, resolveWeek, setAlloc } from '../src/sim/mission';
import { claimRoom, craft } from '../src/sim/outpost';
import { DIFFICULTY, SITES } from '../src/sim/sites';
import type { MissionConfig, MissionState } from '../src/sim/types';
import { Astronaut } from '../src/world/astronaut';
import { DATA } from './bots';

const config = (over: Partial<MissionConfig> = {}): MissionConfig => ({
  site: 'moon',
  difficulty: 'commander',
  weeks: 6,
  startDate: '2024-04-26',
  seed: 7,
  tutorial: false,
  sunMode: 'random',
  ...over,
});

function answer(state: MissionState): void {
  if (!state.now.eventId || state.now.eventDone) return;
  const event = EVENTS[state.now.eventId];
  chooseOption(state, event.options.find((option) => !optionBlock(option, state))!.id);
}

/** A strong storm this week, with the crew not in the shelter. */
function stormWeek(state: MissionState): void {
  const env = state.plan[0];
  state.plan[0] = { ...env, storm: { ...env.storm, strength: 2 } };
  state.now.sheltered = false;
}

describe('second review fixes', () => {
  it('a radiation vest printed after a walk does not protect that walk', () => {
    const state = createMission(config(), DATA);
    stormWeek(state);
    applyEva(state, { seconds: 40, samples: 0, science: 0, chore: false, caught: true, alerted: true });
    const withoutVest = computeWeek(state).doseAfter;
    state.buildings = [{ id: 'workshop', progress: 2, done: true }];
    state.stock = { regolith: 10, metal: 10 };
    expect(craft(state, 'vest')).toBe(true);
    expect(computeWeek(state).doseAfter).toBe(withoutVest);
  });

  it('a radiation vest worn on the walk halves the dose of being caught outside', () => {
    const bare = createMission(config(), DATA);
    stormWeek(bare);
    applyEva(bare, { seconds: 40, samples: 0, science: 0, chore: false, caught: true, alerted: true });
    const worn = createMission(config(), DATA);
    stormWeek(worn);
    worn.buildings = [{ id: 'workshop', progress: 2, done: true }];
    worn.stock = { regolith: 10, metal: 10 };
    expect(craft(worn, 'vest')).toBe(true);
    applyEva(worn, { seconds: 40, samples: 0, science: 0, chore: false, caught: true, alerted: true });
    expect(worn.now.eva?.vest).toBe(true);
    expect(computeWeek(worn).doseAfter).toBeLessThan(computeWeek(bare).doseAfter);
  });

  it('unplugging a battery unit for good never leaves more charge than the battery holds', () => {
    const state = createMission(config({ site: 'mars', difficulty: 'cadet', seed: 3 }), DATA);
    state.plan[2] = { ...state.plan[2], fixedEvent: 'battery_hot' };
    for (let week = 0; week < 2; week++) {
      state.alloc = { life: 0, farm: 0, lab: 0, shield: 0 };
      resolveWeek(state);
      nextWeek(state);
    }
    expect(state.now.eventId).toBe('battery_hot');
    expect(chooseOption(state, 'a')).toBeTruthy();
    expect(state.battery).toBeLessThanOrEqual(state.batteryCap);
    expect(state.now.available).toBeGreaterThanOrEqual(0);
  });

  it('the weekly report names every change: crater ice and the room game have their own rows', () => {
    const state = createMission(config(), DATA);
    answer(state);
    resolveWeek(state);
    nextWeek(state); // week 2: on the Moon the ice chore is on the walk
    state.air = 60; // far from the 0 and 100 limits
    state.now.start = { air: 60, food: state.food, science: state.science };
    answer(state);
    for (const module of ['life', 'farm', 'lab', 'shield'] as const) setAlloc(state, module, 0);
    setAlloc(state, 'life', 3);
    applyEva(state, { seconds: 40, samples: 0, science: 0, chore: true, caught: false, alerted: false }); // +6 ice
    expect(claimRoom(state, 'hab', 'pipes', true)).toBe(true); // +4 air
    const record = resolveWeek(state);
    const p = record.parts;
    expect(p.airIce).toBe(6);
    expect(p.airRooms).toBe(4);
    // The rows add up to the change shown at the top of the report.
    expect(p.airLife + p.airBonus + p.airEvent + p.airEva + (p.airIce ?? 0) + (p.airRooms ?? 0)).toBe(record.air - 60);
  });

  it('the report counts the air a walk really cost when the tank runs nearly empty', () => {
    const state = createMission(config(), DATA);
    state.air = 5;
    for (const module of ['life', 'farm', 'lab', 'shield'] as const) setAlloc(state, module, 0);
    applyEva(state, { seconds: 72, samples: 0, science: 0, chore: false, caught: false, alerted: false }); // would cost 9
    expect(state.air).toBe(0);
    const record = resolveWeek(state);
    expect(record.parts.airEva).toBe(-5);
  });

  it('each week remembers what it started with, for the report', () => {
    const state = createMission(config(), DATA);
    expect(state.now.start).toEqual({ air: state.air, food: state.food, science: state.science, battery: state.battery });
    resolveWeek(state);
    nextWeek(state);
    expect(state.now.start?.battery).toBe(state.battery);
  });

  it('a card is recorded as it really changed the stores (science never goes below zero)', () => {
    const state = createMission(config({ site: 'mars', seed: 3 }), DATA);
    // Find a card option that costs science, and play it with almost no science in store.
    const pair = Object.values(EVENTS).flatMap((event) => event.options.map((option) => ({ event, option }))).find(({ event, option }) => event.sites.includes('mars') && typeof option.fx === 'object' && (option.fx.science ?? 0) <= -3 && !option.blocked);
    expect(pair).toBeTruthy();
    state.now.eventId = pair!.event.id;
    state.now.eventDone = false;
    state.science = 2;
    chooseOption(state, pair!.option.id);
    expect(state.science).toBe(0);
    expect(state.now.eventFx.science).toBe(-2);
  });

  it('asking Earth about sick plants saves them when Mars is close, and costs a plant when it is far', () => {
    const play = (delaySeconds: number): number => {
      const state = createMission(config({ site: 'mars', seed: 5 }), DATA);
      state.plan[0] = { ...state.plan[0], delaySeconds, conjunction: false };
      state.now.eventId = 'plants_sick';
      state.now.eventDone = false;
      state.crop = 1.5;
      chooseOption(state, 'a');
      return state.crop;
    };
    expect(play(4 * 60)).toBe(1.5); // round trip 8 minutes: the answer comes in time
    expect(play(20 * 60)).toBe(0.5); // round trip 40 minutes: too late for one plant
  });
  it('the storm bunker\'s protection is counted once in "kept out"', () => {
    const state = createMission(config({ site: 'moon', startDate: '2019-12-01', seed: 3, weeks: 10 }), DATA);
    stormWeek(state);
    state.shield = 0;
    state.modifiers.push({ id: 'building:bunker', weeks: 0, permanent: true, stormFactor: 0.6 });
    const outcome = computeWeek(state);
    const full = SITES.moon.stormDose[2] * DIFFICULTY.commander.stormFactor;
    const cosmicKept = state.plan[0].gcrWeek - outcome.parts.doseGcr;
    expect(outcome.doseAvoided).toBeCloseTo(full - outcome.parts.doseStorm + cosmicKept, 5);
  });

  it('a wave ends by itself, so the cadet never walks off waving', () => {
    // A real Astronaut without its model: only the fields update() reads.
    const cadet = Object.create(Astronaut.prototype) as Astronaut;
    const fields = cadet as unknown as Record<string, unknown>;
    const part = (): THREE.Object3D => new THREE.Object3D();
    Object.assign(fields, {
      time: 0, emote: 'none', emoteTime: 0, blend: 0, phase: 0, lastSin: 0, footstep: { left: false, right: false },
      squash: 0, squashSpeed: 0, wasGrounded: true, group: new THREE.Group(),
      torso: part(), head: part(), armL: part(), armR: part(), foreL: part(), foreR: part(), legL: part(), legR: part(), shinL: part(), shinR: part(),
      torsoY: 1, blinkIn: 1e9, blinkFor: 0, faceKind: 'normal', face: { map: null },
    });
    cadet.play('wave');
    for (let frame = 0; frame < 30 * 4; frame++) cadet.update(1 / 30, { speed: 1, grounded: true, vy: 0, floaty: false });
    expect(fields.emote).toBe('none');
  });
});
