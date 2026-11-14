/**
 * Shared base: the director's port. It turns the director's calls ("the child pressed Start the week", "the walk ended")
 * into intents (sim/coop.ts) and hands them to the session: the host's own go through the same rules as a guest's.
 *
 * It knows nothing about the screen. It never lets a call fall through to the solo code: every call is taken, also when
 * nothing can be sent (no state from the host yet, the session is over).
 *
 * A guest edits the power plan at once on its own mirror, and keeps the edit until the host has taken it (an `st`
 * that acknowledges the intent's counter), so a quick second tap builds on the first and the plan does not jump back.
 */
import type { CoopCall, CoopPort } from '../game/director';
import { LONGEST_WALK_SECONDS, SAMPLE_SLOT_VALUES, WALK_SCIENCE_CAP } from '../sim/coop';
import type { IntentBody, WalkResult } from '../sim/coop';
import { suggestAlloc } from '../sim/mission';
import type { BuildingId, GameId, RoomId, ToolId } from '../sim/outpost';
import type { Alloc, EvaResult, MissionState, OptionId } from '../sim/types';
import type { CoopGuest, CoopHost } from './coop';

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));
const whole = (n: unknown, min: number, max: number): number => (typeof n === 'number' && Number.isFinite(n) ? Math.round(clamp(n, min, max)) : min);

/**
 * A walk result as the network may carry it: every number inside what a real walk can reach (the reader on the other
 * side refuses anything else, and a walk that is refused would be lost).
 */
export function walkResultOf(raw: EvaResult & { picked?: number[] }): WalkResult {
  const result: WalkResult = {
    seconds: whole(raw.seconds, 0, LONGEST_WALK_SECONDS + 10),
    samples: whole(raw.samples, 0, SAMPLE_SLOT_VALUES.length),
    science: whole(raw.science, 0, WALK_SCIENCE_CAP),
    chore: raw.chore === true,
    caught: raw.caught === true,
    alerted: raw.alerted === true,
  };
  if (Array.isArray(raw.finds)) result.finds = [...new Set(raw.finds)].slice(0, 4);
  if (raw.materials) result.materials = { regolith: whole(raw.materials.regolith, 0, 12), metal: whole(raw.materials.metal, 0, 12) };
  if (Array.isArray(raw.picked)) {
    result.picked = [...new Set(raw.picked.filter((slot) => Number.isInteger(slot) && slot >= 0 && slot < SAMPLE_SLOT_VALUES.length))];
  }
  return result;
}

/** What the director's call means as an intent; null when it is nothing to send. */
export function intentOf(call: CoopCall, args: readonly unknown[]): IntentBody | null {
  switch (call) {
    case 'continueBriefing':
    case 'confirmEvent':
    case 'confirmPlan':
    case 'goNextWeek':
      return { k: 'ready', on: true };
    case 'chooseEvent':
      return { k: 'vote', o: args[0] as OptionId };
    case 'askMissionControl':
      return { k: 'ask' };
    case 'changeAlloc':
      return { k: 'alloc', a: { ...(args[0] as Alloc) } };
    case 'useSafePlan':
      return { k: 'safe' };
    case 'beginWalk':
      return { k: 'walk', go: true };
    case 'skipWalk':
      return { k: 'walk', go: false };
    case 'walkEnd':
      return { k: 'walkEnd', r: walkResultOf(args[0] as EvaResult) };
    case 'find':
      return { k: 'find', i: args[0] as number };
    case 'orderBuilding':
      return { k: 'build', id: args[0] as BuildingId };
    case 'finishPrint':
      return { k: 'craft', tool: args[0] as ToolId, neat: args[1] === true };
    case 'finishRoomGame':
      return args[2] === false ? null : { k: 'room', room: args[0] as RoomId, game: args[1] as GameId };
    default:
      return null;
  }
}

export interface SessionPort extends CoopPort {
  /** A guest: put the own plan edit back after the host's snapshot was adopted (until the host has acknowledged it). */
  reassert(): void;
}

/** The port for the commander's device: its own intents go straight to the reducer. */
export function hostPort(host: CoopHost): SessionPort {
  return {
    take(call, args) {
      const body = intentOf(call, args);
      if (body) host.submit(body);
      return true;
    },
    reassert() {},
    close() {
      host.dispose();
    },
  };
}

/** The port for a guest's device: intents are queued for the host; the plan edits show at once. */
export function guestPort(guest: CoopGuest, me: string): SessionPort {
  const mission: MissionState = guest.mission;
  let edit: { n: number; alloc: Alloc } | null = null;
  return {
    take(call, args) {
      const body = intentOf(call, args);
      if (!body) return true;
      const n = guest.submit(body);
      if (n !== null && (body.k === 'alloc' || body.k === 'safe')) {
        const alloc = body.k === 'alloc' ? { ...body.a } : suggestAlloc(mission);
        mission.alloc = { ...alloc };
        edit = { n, alloc };
      }
      return true;
    },
    reassert() {
      if (!edit) return;
      const meta = guest.meta;
      if (!meta || meta.stage !== 'plan' || (meta.acks[me] ?? 0) >= edit.n) {
        edit = null;
        return;
      }
      mission.alloc = { ...edit.alloc };
    },
    close() {
      guest.dispose();
    },
  };
}
