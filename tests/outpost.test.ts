/**
 * Growing the outpost: materials, the builder robot, new buildings, tools and rooms.
 */
import { describe, expect, it } from 'vitest';
import { applyEva, computeWeek, createMission, nextWeek, resolveWeek, setAlloc } from '../src/sim/mission';
import {
  BUILDINGS,
  DECOR_LIMIT,
  START_STOCK,
  addDecor,
  placeBuilding,
  removeBuilding,
  removeDecor,
  TOOLS,
  buildBlock,
  claimRoom,
  craft,
  craftBlock,
  ensureOutpost,
  isBuilt,
  robotIdle,
  roomOpen,
  roomPlayed,
  roomRewardTaken,
  startBuilding,
  underConstruction,
} from '../src/sim/outpost';
import type { MissionConfig, MissionState } from '../src/sim/types';
import { DATA } from './bots';

function mission(overrides: Partial<MissionConfig> = {}): MissionState {
  return createMission(
    {
      site: 'mars',
      difficulty: 'cadet',
      weeks: 6,
      startDate: '2019-12-01',
      seed: 11,
      tutorial: false,
      sunMode: 'featured',
      ...overrides,
    },
    DATA,
  );
}

/** Run the night with the robot on `cells` cells (as many as the plan allows). */
function week(state: MissionState, cells: number): void {
  setAlloc(state, 'shield', 0);
  setAlloc(state, 'lab', 0); // frees cells for the robot
  for (let i = 0; i < cells; i++) setAlloc(state, 'shield', state.alloc.shield + 1);
  resolveWeek(state);
  if (!state.end) nextWeek(state);
}

describe('materials', () => {
  it('a mission starts with the lander cargo: enough for the workshop', () => {
    const state = mission();
    expect(state.stock).toEqual(START_STOCK);
    expect(buildBlock(state, 'workshop')).toBeNull();
    expect(buildBlock(state, 'bunker')).toBe('materials');
  });

  it('materials from a walk go into the store, rounded and never negative', () => {
    const state = mission();
    applyEva(state, { seconds: 40, samples: 0, science: 0, chore: false, caught: false, alerted: false, materials: { regolith: 3.4, metal: -2 } });
    expect(state.stock).toEqual({ regolith: START_STOCK.regolith + 3, metal: START_STOCK.metal });
  });

  it('an old save without the outpost fields gets them', () => {
    const state = mission();
    delete state.stock;
    delete state.buildings;
    delete state.tools;
    ensureOutpost(state);
    expect(state.stock).toEqual({ regolith: 0, metal: 0 });
    expect(state.buildings).toEqual([]);
    expect(state.tools).toEqual([]);
  });
});

describe('building', () => {
  it('ordering a building pays for it at once; one building at a time', () => {
    const state = mission();
    state.stock = { regolith: 20, metal: 20 };
    expect(startBuilding(state, 'workshop')).toBe(true);
    expect(state.stock).toEqual({ regolith: 16, metal: 18 });
    expect(underConstruction(state)?.id).toBe('workshop');
    expect(buildBlock(state, 'garden')).toBe('busy');
    expect(startBuilding(state, 'garden')).toBe(false);
    expect(buildBlock(state, 'workshop')).toBe('built');
  });

  it('the robot builds with its cells instead of the wall, and the building is finished in time', () => {
    const state = mission();
    startBuilding(state, 'workshop'); // 2 cells of work
    const wallBefore = state.shield;
    setAlloc(state, 'shield', 0);
    expect(computeWeek(state).buildCells).toBe(0); // no cells, no building
    week(state, 1);
    expect(state.shield).toBe(wallBefore); // the wall waits while the robot builds
    expect(underConstruction(state)?.progress).toBe(1);
    week(state, 1);
    expect(isBuilt(state, 'workshop')).toBe(true);
    expect(underConstruction(state)).toBeNull();
    expect(state.history.at(-1)?.built).toBe('workshop');
  });

  it('a finished building helps from the next week on, for good', () => {
    const state = mission();
    state.stock = { regolith: 20, metal: 20 };
    startBuilding(state, 'observatory'); // +5 science a week, 3 cells
    for (let i = 0; i < 6 && !isBuilt(state, 'observatory'); i++) week(state, 2);
    expect(isBuilt(state, 'observatory')).toBe(true);
    expect(computeWeek(state).parts.sciBuild).toBe(5);
  });

  it('the robot rests only when the wall is done and nothing is being built', () => {
    const state = mission();
    state.shield = 1;
    expect(robotIdle(state)).toBe(true);
    startBuilding(state, 'workshop');
    expect(robotIdle(state)).toBe(false);
  });

  it('every building has a cost and takes work', () => {
    for (const def of BUILDINGS) {
      expect(def.cost.regolith + def.cost.metal).toBeGreaterThan(0);
      expect(def.work).toBeGreaterThan(0);
    }
  });
});

describe('workshop and tools', () => {
  it('tools need the workshop, are paid once and kept', () => {
    const state = mission();
    state.stock = { regolith: 30, metal: 30 };
    expect(craftBlock(state, 'drill')).toBe('workshop');
    state.buildings = [{ id: 'workshop', progress: 2, done: true }];
    for (const tool of TOOLS) expect(craft(state, tool.id)).toBe(true);
    expect(state.tools).toHaveLength(TOOLS.length);
    expect(craftBlock(state, 'drill')).toBe('made');
    expect(craft(state, 'drill')).toBe(false);
  });
});

describe('rooms', () => {
  it('room games pay one reward a week in all', () => {
    const state = mission();
    const science = state.science;
    const air = state.air;
    expect(claimRoom(state, 'lab', 'landing', true)).toBe(false); // not a game of this room
    expect(claimRoom(state, 'lab', 'spectro', true)).toBe(true);
    expect(roomRewardTaken(state)).toBe(true);
    expect(claimRoom(state, 'lab', 'signal', true)).toBe(false); // the same room: this week is paid
    expect(claimRoom(state, 'hab', 'pipes', true)).toBe(false); // another room: this week is paid too
    expect(state.science).toBe(science + 4);
    expect(state.air).toBe(air);
    resolveWeek(state);
    nextWeek(state);
    expect(roomRewardTaken(state)).toBe(false);
    expect(claimRoom(state, 'lab', 'signal', true)).toBe(true);
  });

  it('the first rooms and the lander are always open, the rest need their building', () => {
    const state = mission();
    expect(roomOpen(state, 'hab')).toBe(true);
    expect(roomOpen(state, 'farm')).toBe(true);
    expect(roomOpen(state, 'lab')).toBe(true);
    expect(roomOpen(state, 'lander')).toBe(true);
    expect(roomOpen(state, 'observatory')).toBe(false);
    state.buildings = [{ id: 'observatory', progress: 3, done: true }];
    expect(roomOpen(state, 'observatory')).toBe(true);
  });

  it('a won room game pays once a week; a lost one never', () => {
    const state = mission();
    state.air = 80;
    expect(claimRoom(state, 'hab', 'pipes', false)).toBe(false);
    expect(claimRoom(state, 'hab', 'pipes', true)).toBe(true);
    expect(state.air).toBe(84);
    expect(roomPlayed(state, 'hab')).toBe(true);
    expect(claimRoom(state, 'hab', 'pipes', true)).toBe(false);
    expect(state.air).toBe(84);
    resolveWeek(state);
    nextWeek(state);
    expect(roomPlayed(state, 'hab')).toBe(false);
  });
});

describe('creative mode', () => {
  it('starts with plenty of everything and every tool', () => {
    const state = mission({ creative: true });
    expect(state.stock!.regolith).toBeGreaterThan(100);
    expect(state.tools).toHaveLength(TOOLS.length);
  });

  it('puts a building down at once where the player chose, and can move and remove it', () => {
    const state = mission({ creative: true });
    expect(placeBuilding(state, 'observatory', 12, -20, 1)).toBe(true);
    expect(isBuilt(state, 'observatory')).toBe(true);
    expect(computeWeek(state).parts.sciBuild).toBe(5); // works the same week
    placeBuilding(state, 'observatory', -8, 25, 0);
    expect(state.buildings).toHaveLength(1);
    expect(state.buildings![0]).toMatchObject({ x: -8, z: 25 });
    expect(removeBuilding(state, 'observatory')).toBe(true);
    expect(isBuilt(state, 'observatory')).toBe(false);
    expect(computeWeek(state).parts.sciBuild ?? 0).toBe(0);
  });

  it('places decorations up to a limit, and takes them back', () => {
    const state = mission({ creative: true });
    for (let i = 0; i < DECOR_LIMIT; i++) expect(addDecor(state, 'bench', i, 10, 0)).toBe(true);
    expect(addDecor(state, 'bench', 0, 0, 0)).toBe(false);
    removeDecor(state);
    expect(state.decor).toHaveLength(DECOR_LIMIT - 1);
    removeDecor(state, true);
    expect(state.decor).toHaveLength(0);
  });

  it('cannot be lost, and is not available in a normal mission', () => {
    const state = mission({ creative: true });
    state.air = 1;
    state.food = 0;
    setAlloc(state, 'life', 0);
    resolveWeek(state);
    expect(state.end).toBeNull();
    expect(state.air).toBe(100);
    const normal = mission();
    expect(placeBuilding(normal, 'garden', 0, 20, 0)).toBe(false);
    expect(addDecor(normal, 'bench', 0, 20, 0)).toBe(false);
  });
});
