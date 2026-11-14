/**
 * Growing the outpost: materials gathered on walks outside, new buildings that the
 * builder robot puts up with them, and tools made in the workshop.
 *
 * Every building is built from local material (regolith: the loose rock and dust of
 * the ground) and metal, as NASA plans for real outposts ("living off the land").
 * The builder robot is the same one that builds the shield wall: in a week it works
 * on one thing, so a new building costs wall progress, and energy cells to run it.
 */
import type { Effects, MissionState, Modifier } from './types';

export interface Stock {
  regolith: number;
  metal: number;
}

export type BuildingId = 'workshop' | 'oxygen' | 'solar_array' | 'observatory' | 'garden' | 'bunker';
export type ToolId = 'tank' | 'drill' | 'battery' | 'scanner' | 'boots' | 'vest';

/** Effects a finished building keeps giving, every week. */
export type BuildingEffect = Pick<Modifier, 'airPerWeek' | 'solarFlat' | 'sciencePerWeek' | 'foodPerWeek' | 'stormFactor'>;

export interface BuildingDef {
  id: BuildingId;
  /** GAME. Materials, paid when building starts. */
  cost: Stock;
  /** GAME. Energy cells of robot work needed (one cell of the builder robot = one unit). */
  work: number;
  effect: BuildingEffect;
}

/** GAME. Materials the lander brought: enough for the workshop. */
export const START_STOCK: Stock = { regolith: 4, metal: 2 };

/** GAME. Numbers tuned so that a 6-week mission can finish two or three buildings. */
export const BUILDINGS: BuildingDef[] = [
  { id: 'workshop', cost: { regolith: 4, metal: 2 }, work: 2, effect: {} },
  { id: 'oxygen', cost: { regolith: 3, metal: 4 }, work: 3, effect: { airPerWeek: 5 } },
  { id: 'solar_array', cost: { regolith: 2, metal: 5 }, work: 3, effect: { solarFlat: 2 } },
  { id: 'garden', cost: { regolith: 5, metal: 2 }, work: 3, effect: { foodPerWeek: 0.5 } },
  { id: 'observatory', cost: { regolith: 3, metal: 4 }, work: 3, effect: { sciencePerWeek: 5 } },
  { id: 'bunker', cost: { regolith: 8, metal: 2 }, work: 4, effect: { stormFactor: 0.6 } },
];

export interface ToolDef {
  id: ToolId;
  /** GAME. Materials, paid when the tool is made. */
  cost: Stock;
}

/** GAME. Tools are made in the workshop and last for the rest of the mission. */
export const TOOLS: ToolDef[] = [
  { id: 'tank', cost: { regolith: 2, metal: 3 } },
  { id: 'drill', cost: { regolith: 1, metal: 3 } },
  { id: 'battery', cost: { regolith: 1, metal: 4 } },
  { id: 'scanner', cost: { regolith: 2, metal: 2 } },
  { id: 'boots', cost: { regolith: 2, metal: 1 } },
  { id: 'vest', cost: { regolith: 3, metal: 2 } },
];

/** GAME. What the tools do on a walk outside (read by the 3D walk). */
export const TOOL_EFFECT = {
  /** Extra seconds of suit air. */
  tankSeconds: 20,
  /** Picking up samples and materials takes this share of the time. */
  drillTime: 0.5,
  /** Extra material from each pile with the drill. */
  drillBonus: 1,
  /** The rover battery lasts this many times longer. */
  batteryFactor: 1.6,
  /** Jumps reach this many times higher. */
  bootsJump: 1.35,
  /** Share of the storm dose that still gets through the vest when caught outside. */
  vestFactor: 0.5,
};

/** One building on the outpost, finished or being built. */
export interface Construction {
  id: BuildingId;
  /** Robot work done so far, in cells. */
  progress: number;
  done: boolean;
  /** Creative mode: where the player put it (otherwise it stands on its own plot). */
  x?: number;
  z?: number;
  heading?: number;
}

/** Decorations for creative mode: furniture and plants set out around the outpost. */
export type DecorId = 'dwarf_tree' | 'garden_bed' | 'pepper_plant' | 'bench' | 'crate_small' | 'water_tank' | 'telescope' | 'robot_arm';
export const DECOR: DecorId[] = ['dwarf_tree', 'garden_bed', 'pepper_plant', 'bench', 'crate_small', 'water_tank', 'telescope', 'robot_arm'];

export interface DecorItem {
  id: DecorId;
  x: number;
  z: number;
  heading: number;
}

/** At most this many decorations (they all need drawing). */
export const DECOR_LIMIT = 60;

/** Creative mode is on for this mission. */
export function isCreative(state: MissionState): boolean {
  return !!state.config.creative;
}

/** What creative mode shows for materials: plenty. */
export const CREATIVE_STOCK = 999;

export function buildingDef(id: BuildingId): BuildingDef {
  const def = BUILDINGS.find((item) => item.id === id);
  if (!def) throw new Error('Unknown building ' + id);
  return def;
}

export function toolDef(id: ToolId): ToolDef {
  const def = TOOLS.find((item) => item.id === id);
  if (!def) throw new Error('Unknown tool ' + id);
  return def;
}

/** Fill in the outpost fields of a mission saved before they existed. */
export function ensureOutpost(state: MissionState): void {
  state.stock ??= { regolith: 0, metal: 0 };
  state.buildings ??= [];
  state.tools ??= [];
}

export function stockOf(state: MissionState): Stock {
  return state.stock ?? { regolith: 0, metal: 0 };
}

export function canAfford(stock: Stock, cost: Stock): boolean {
  return stock.regolith >= cost.regolith && stock.metal >= cost.metal;
}

/** Materials brought back from outside. */
export function addMaterials(state: MissionState, gained: Partial<Stock> | undefined): void {
  if (!gained) return;
  ensureOutpost(state);
  state.stock!.regolith += Math.max(0, Math.round(gained.regolith ?? 0));
  state.stock!.metal += Math.max(0, Math.round(gained.metal ?? 0));
}

export function isBuilt(state: MissionState, id: BuildingId): boolean {
  return !!state.buildings?.some((item) => item.id === id && item.done);
}

/** The building the robot is working on, if any. */
export function underConstruction(state: MissionState): Construction | null {
  return state.buildings?.find((item) => !item.done) ?? null;
}

/** The builder robot has nothing to do: the wall is finished and no building is waiting. */
export function robotIdle(state: MissionState): boolean {
  return state.shield >= 1 && !underConstruction(state);
}

/** Why a building cannot be started now, or null if it can. */
export function buildBlock(state: MissionState, id: BuildingId): 'built' | 'busy' | 'materials' | null {
  if (state.buildings?.some((item) => item.id === id)) return 'built';
  if (isCreative(state)) return null;
  if (underConstruction(state)) return 'busy';
  if (!canAfford(stockOf(state), buildingDef(id).cost)) return 'materials';
  return null;
}

/** Creative mode: put a building somewhere (or move it there). It stands at once and works from now on. */
export function placeBuilding(state: MissionState, id: BuildingId, x: number, z: number, heading: number): boolean {
  if (!isCreative(state)) return false;
  ensureOutpost(state);
  const def = buildingDef(id);
  const site = state.buildings!.find((item) => item.id === id);
  if (site) {
    Object.assign(site, { x, z, heading, done: true, progress: def.work });
    // A building ordered in creative mode (startBuilding) has no modifier yet: it starts to work now.
    const key = `building:${id}`;
    if (Object.keys(def.effect).length > 0 && !state.modifiers.some((mod) => mod.id === key)) {
      state.modifiers.push({ id: key, weeks: 0, permanent: true, ...def.effect });
    }
    return true;
  }
  state.buildings!.push({ id, progress: def.work, done: true, x, z, heading });
  if (Object.keys(def.effect).length > 0) state.modifiers.push({ id: `building:${id}`, weeks: 0, permanent: true, ...def.effect });
  return true;
}

/** Creative mode: take a building away again. */
export function removeBuilding(state: MissionState, id: BuildingId): boolean {
  if (!isCreative(state) || !state.buildings?.some((item) => item.id === id)) return false;
  state.buildings = state.buildings.filter((item) => item.id !== id);
  state.modifiers = state.modifiers.filter((mod) => mod.id !== `building:${id}`);
  return true;
}

/** Creative mode: set out a decoration. */
export function addDecor(state: MissionState, id: DecorId, x: number, z: number, heading: number): boolean {
  if (!isCreative(state)) return false;
  state.decor ??= [];
  if (state.decor.length >= DECOR_LIMIT) return false;
  state.decor.push({ id, x, z, heading });
  return true;
}

/** Creative mode: take away the last decoration, or all of them. */
export function removeDecor(state: MissionState, all = false): boolean {
  if (!isCreative(state) || !state.decor?.length) return false;
  if (all) state.decor = [];
  else state.decor.pop();
  return true;
}

/** Order a new building: the materials are used at once, the robot builds it over the next weeks. */
export function startBuilding(state: MissionState, id: BuildingId): boolean {
  if (buildBlock(state, id)) return false;
  ensureOutpost(state);
  const cost = buildingDef(id).cost;
  state.stock!.regolith -= cost.regolith;
  state.stock!.metal -= cost.metal;
  state.buildings!.push({ id, progress: 0, done: false });
  return true;
}

/**
 * The night's robot work. Returns the building that was finished, if one was.
 * A finished building starts giving its effect the next week, for the rest of the mission.
 */
export function advanceConstruction(state: MissionState, cells: number): BuildingId | null {
  const site = underConstruction(state);
  if (!site || cells <= 0) return null;
  site.progress += cells;
  const def = buildingDef(site.id);
  if (site.progress < def.work) return null;
  site.progress = def.work;
  site.done = true;
  const effect = def.effect;
  if (Object.keys(effect).length > 0) {
    state.modifiers.push({ id: `building:${site.id}`, weeks: 0, permanent: true, delayed: true, ...effect });
  }
  return site.id;
}

export function hasTool(state: MissionState, id: ToolId): boolean {
  return !!state.tools?.includes(id);
}

/** Why a tool cannot be made now, or null if it can. */
export function craftBlock(state: MissionState, id: ToolId): 'workshop' | 'made' | 'materials' | null {
  if (hasTool(state, id)) return 'made';
  if (isCreative(state)) return null;
  if (!isBuilt(state, 'workshop')) return 'workshop';
  if (!canAfford(stockOf(state), toolDef(id).cost)) return 'materials';
  return null;
}

/** Make a tool in the workshop. */
export function craft(state: MissionState, id: ToolId): boolean {
  if (craftBlock(state, id)) return false;
  ensureOutpost(state);
  if (!isCreative(state)) {
    const cost = toolDef(id).cost;
    state.stock!.regolith -= cost.regolith;
    state.stock!.metal -= cost.metal;
  }
  state.tools!.push(id);
  return true;
}

// ---------------------------------------------------------------------------
// Rooms: going inside a building. Each room has a small game; winning it helps
// the outpost, once a week per room.
// ---------------------------------------------------------------------------

export type RoomId = 'hab' | 'farm' | 'lab' | 'workshop' | 'garden' | 'observatory' | 'oxygen' | 'bunker' | 'lander';
export type GameId = 'pipes' | 'plants' | 'spectro' | 'landing' | 'signal';

/** GAME. What winning a room game gives. */
export interface Reward {
  air?: number;
  crop?: number;
  science?: number;
  food?: number;
}

export interface RoomGame {
  game: GameId;
  reward: Reward;
}

export interface RoomDef {
  id: RoomId;
  /** The small games played at the room's stations. A win pays its reward; one reward a week in all. */
  games: RoomGame[];
  /** The room exists only once this building is finished. */
  needs?: BuildingId;
}

export const ROOMS: RoomDef[] = [
  { id: 'hab', games: [{ game: 'pipes', reward: { air: 4 } }] },
  { id: 'farm', games: [{ game: 'plants', reward: { crop: 0.5 } }] },
  {
    id: 'lab',
    games: [
      { game: 'spectro', reward: { science: 4 } },
      { game: 'signal', reward: { science: 3 } },
    ],
  },
  {
    id: 'lander',
    games: [
      { game: 'landing', reward: { science: 3 } },
      { game: 'signal', reward: { science: 2 } },
    ],
  },
  { id: 'workshop', games: [], needs: 'workshop' },
  { id: 'garden', games: [{ game: 'plants', reward: { food: 0.3 } }], needs: 'garden' },
  { id: 'observatory', games: [{ game: 'spectro', reward: { science: 3 } }], needs: 'observatory' },
  { id: 'oxygen', games: [{ game: 'pipes', reward: { air: 3 } }], needs: 'oxygen' },
  { id: 'bunker', games: [], needs: 'bunker' },
];

export function roomDef(id: RoomId): RoomDef {
  const def = ROOMS.find((item) => item.id === id);
  if (!def) throw new Error('Unknown room ' + id);
  return def;
}

export function roomOpen(state: MissionState, id: RoomId): boolean {
  const needs = roomDef(id).needs;
  return !needs || isBuilt(state, needs);
}

/**
 * A room game paid its reward this week (with no game: one of the room's games did; only one
 * room game pays each week, so a room with two games is done when either one paid).
 */
export function roomPlayed(state: MissionState, id: RoomId, game?: GameId): boolean {
  const played = state.now.games ?? [];
  if (game) return played.includes(`${id}:${game}`);
  return roomDef(id).games.some((item) => played.includes(`${id}:${item.game}`));
}

/**
 * This week's room reward is collected. The games are free to play, so they pay one reward a
 * week in all: the cadet chooses which job helps the outpost most (air, crops or science),
 * and the weekly power plan stays the main way to earn.
 */
export function roomRewardTaken(state: MissionState): boolean {
  return (state.now.games ?? []).length > 0;
}

/** A room game ended. A win pays its reward if no room game has paid this week. Returns true if it paid. */
export function claimRoom(state: MissionState, id: RoomId, game: GameId, won: boolean): boolean {
  const entry = roomDef(id).games.find((item) => item.game === game);
  if (!entry || !won || !roomOpen(state, id) || roomRewardTaken(state)) return false;
  const reward = entry.reward;
  state.now.games = [...(state.now.games ?? []), `${id}:${game}`];
  // What really changed, for the weekly report (air never goes above full).
  const paid: Effects = {};
  if (reward.air) {
    const before = state.air;
    state.air = Math.min(100, state.air + reward.air);
    paid.air = state.air - before;
  }
  if (reward.crop) state.crop = Math.round((state.crop + reward.crop) * 100) / 100;
  if (reward.science) {
    state.science += reward.science;
    paid.science = reward.science;
  }
  if (reward.food) {
    state.food = Math.round((state.food + reward.food) * 100) / 100;
    paid.food = reward.food;
  }
  state.now.roomFx = paid;
  return true;
}
