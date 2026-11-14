/** Random play: thousands of missions with random choices never reach an impossible state. */
import { describe, expect, it } from 'vitest';
import { DATA } from './bots';
import { EVENTS, optionBlock } from '../src/sim/events';
import { addDays } from '../src/sim/ephemeris';
import { allocTotal, applyEva, askEarth, chooseOption, computeWeek, createMission, nextWeek, resolveWeek, setAlloc, suggestAlloc } from '../src/sim/mission';
import { BUILDINGS, ROOMS, TOOLS, claimRoom, craft, startBuilding, placeBuilding, removeBuilding, addDecor } from '../src/sim/outpost';
import { FINDS, recordFind } from '../src/sim/finds';
import { mulberry32 } from '../src/sim/rng';
import type { Difficulty, MissionState, ModuleId, SiteId } from '../src/sim/types';
import { MAX_LEVEL, MODULES } from '../src/sim/types';

function check(state: MissionState, where: string, bad: string[]): void {
  const nums: Record<string, number> = {
    battery: state.battery, batteryCap: state.batteryCap, air: state.air, food: state.food, dose: state.dose, science: state.science,
    shield: state.shield, crop: state.crop, available: state.now.available, solar: state.now.solar, regolith: state.stock?.regolith ?? 0, metal: state.stock?.metal ?? 0,
  };
  for (const [k, v] of Object.entries(nums)) if (!Number.isFinite(v)) bad.push(`${where}: ${k} not finite (${v})`);
  if (state.air < 0 || state.air > 100) bad.push(`${where}: air ${state.air}`);
  if (state.food < 0) bad.push(`${where}: food ${state.food}`);
  if ((state.stock?.regolith ?? 0) < 0 || (state.stock?.metal ?? 0) < 0) bad.push(`${where}: stock ${JSON.stringify(state.stock)}`);
  if (state.battery > state.batteryCap) bad.push(`${where}: battery ${state.battery} > cap ${state.batteryCap}`);
  if (allocTotal(state.alloc) > state.now.available) bad.push(`${where}: alloc ${allocTotal(state.alloc)} > available ${state.now.available}`);
  for (const m of MODULES) if (state.alloc[m] < 0 || state.alloc[m] > MAX_LEVEL[m]) bad.push(`${where}: alloc.${m}=${state.alloc[m]}`);
  if (state.week < 1 || state.week > state.config.weeks) bad.push(`${where}: week ${state.week}`);
}

describe('random play keeps the state sane', () => {
  it('3000 random missions', () => {
    const bad: string[] = [];
    let runs = 0;
    for (const site of ['mars', 'moon'] as SiteId[]) for (const difficulty of ['cadet', 'commander', 'legend'] as Difficulty[]) for (const weeks of [6, 10]) for (const creative of [false, true]) {
      for (let seed = 1; seed <= 125; seed++) {
        runs++;
        const rng = mulberry32(seed * 7919 + weeks);
        const pick = <T,>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
        const state = createMission({ site, difficulty, weeks, startDate: addDays('2013-01-01', Math.floor(rng() * 4400)), seed, tutorial: false, sunMode: 'random', creative }, DATA);
        let guard = 40;
        while (!state.end && guard-- > 0) {
          const tag = `${site}/${difficulty}/${weeks}/${creative ? 'C' : 'M'}/s${seed}/w${state.week}`;
          check(state, tag + ' begin', bad);
          if (rng() < 0.3) askEarth(state);
          if (state.now.eventId && !state.now.eventDone) {
            const event = EVENTS[state.now.eventId];
            const options = event.options.filter((o) => !optionBlock(o, state));
            chooseOption(state, pick(options).id);
          }
          check(state, tag + ' card', bad);
          if (rng() < 0.5) state.alloc = suggestAlloc(state);
          for (let i = 0; i < 6; i++) setAlloc(state, pick(MODULES as ModuleId[]), Math.floor(rng() * 5));
          check(state, tag + ' plan', bad);
          if (rng() < 0.4) startBuilding(state, pick(BUILDINGS).id);
          if (creative && rng() < 0.3) placeBuilding(state, pick(BUILDINGS).id, rng() * 40 - 20, rng() * 40 - 20, 0);
          if (creative && rng() < 0.1) removeBuilding(state, pick(BUILDINGS).id);
          if (creative && rng() < 0.3) addDecor(state, 'bench', 0, 0, 0);
          if (rng() < 0.4) craft(state, pick(TOOLS).id);
          if (rng() < 0.7) {
            const finds = rng() < 0.3 ? [pick(FINDS[site]).id] : [];
            for (const id of finds) recordFind(state, id);
            applyEva(state, { seconds: Math.floor(rng() * 120), samples: 2, science: Math.floor(rng() * 12), chore: rng() < 0.5, caught: rng() < 0.1, alerted: rng() < 0.2, finds, materials: { regolith: Math.floor(rng() * 6), metal: Math.floor(rng() * 6) } });
          }
          for (let i = 0; i < 3; i++) { const room = pick(ROOMS); if (room.games.length) claimRoom(state, room.id, pick(room.games).game, rng() < 0.7); }
          check(state, tag + ' day', bad);
          const outcome = computeWeek(state);
          if (outcome.batteryAfter > state.batteryCap) bad.push(`${tag}: batteryAfter ${outcome.batteryAfter} > cap`);
          resolveWeek(state);
          if (!state.end) { nextWeek(state); }
        }
        if (!state.end) bad.push(`${site}/${difficulty}/${weeks}/s${seed}: mission never ended`);
      }
    }
    console.log('runs', runs, 'problems', bad.length);
    const kinds = new Map<string, string>();
    for (const line of bad) { const key = line.replace(/^[^:]*: /, '').replace(/[-\d.]+/g, '#'); if (!kinds.has(key)) kinds.set(key, line); }
    console.log([...kinds.values()].slice(0, 20).join('\n'));
    expect(bad).toEqual([]);
  });
});
