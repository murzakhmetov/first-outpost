/**
 * Discoveries: things the cadet can find on a walk outside.
 *
 * Each one stands for a real find made by a NASA mission, and its story is told
 * on the Science log card with the same id. A discovery counts once per mission.
 */
import type { MissionState, SiteId } from './types';

export interface FindDef {
  /** Also the id of its Science log card. */
  id: string;
  /** Where it lies: metres east (x) and south (z) of the middle of the outpost. */
  x: number;
  z: number;
  /** How close the cadet must come, metres. */
  reach: number;
}

/** GAME. Science for each new discovery. */
export const FIND_SCIENCE = 3;

export const FINDS: Record<SiteId, FindDef[]> = {
  mars: [
    { id: 'sulfur', x: 84, z: -38, reach: 2.8 },
    { id: 'meteorite', x: -92, z: -14, reach: 2.8 },
    { id: 'stream_pebbles', x: 22, z: 98, reach: 3 },
    { id: 'murray_buttes', x: -61.8, z: 58.4, reach: 4.5 },
  ],
  moon: [
    { id: 'orange_soil', x: 50.7, z: -41.9, reach: 3 },
    { id: 'genesis_rock', x: -84, z: 10, reach: 2.8 },
    { id: 'shrinking_moon', x: -65.4, z: 81, reach: 4.5 },
    { id: 'new_craters', x: -57.8, z: -30.7, reach: 4 },
  ],
};

/** The mission flag that remembers a discovery. */
export function findFlag(id: string): string {
  return `found_${id}`;
}

/**
 * A discovery was just made: remember it for the mission and give its science, at once,
 * so closing the game or a storm cannot take it away. Returns false if it was already made.
 */
export function recordFind(state: MissionState, id: string): boolean {
  const flag = findFlag(id);
  if (state.flags[flag]) return false;
  state.flags[flag] = true;
  state.science += FIND_SCIENCE;
  state.now.finds = [...(state.now.finds ?? []), id];
  return true;
}

/** Ids of the discoveries already made in this mission. */
export function foundIn(state: MissionState): string[] {
  return FINDS[state.config.site].filter((find) => state.flags[findFlag(find.id)]).map((find) => find.id);
}
