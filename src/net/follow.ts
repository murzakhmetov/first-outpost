/**
 * The rules of "play together", as pure functions: where a friend's astronaut stands and how it moves,
 * when a position is sent, and who the week waits for. The 3D drawing (world/friends.ts) and the
 * screens only call these.
 */
import type { Step } from '../game/store';
import { POSITION_MIN_MS } from './protocol';
import type { Position, Status } from './protocol';

// ----- Seeing friends walk -------------------------------------------------------------

/**
 * A walking friend we have heard nothing from for this long (seconds) is taken to be indoors (a building sends no
 * position; a bad connection looks the same): the astronaut is hidden with a shrink and the name tag goes.
 */
export const STALE_SECONDS = 3;
/** A friend further than this (metres) from where we draw them is moved there at once instead of sliding. */
export const SNAP_METRES = 8;
/** Walking speed of an astronaut crossing the base to a slot (metres per second). */
export const BASE_WALK = 3;
/** Names are hidden further than this from what the player looks at (metres): the walking cadet, or the outpost in the overview. */
export const TAG_RANGE = 60;

export function isStale(lastAt: number, now: number, limit = STALE_SECONDS): boolean {
  return now - lastAt > limit;
}

export interface Point2 {
  x: number;
  z: number;
}

/** Slide toward a target (exponential smoothing); a target far away is taken at once. */
export function smoothTowards(cur: Point2, target: Point2, dt: number, rate = 10, snap = SNAP_METRES): Point2 & { snapped: boolean } {
  const dx = target.x - cur.x;
  const dz = target.z - cur.z;
  if (Math.hypot(dx, dz) > snap) return { x: target.x, z: target.z, snapped: true };
  const k = Math.min(1, Math.max(0, dt) * rate);
  return { x: cur.x + dx * k, z: cur.z + dz * k, snapped: false };
}

/** Turn toward an angle by the short way round. */
export function smoothAngle(cur: number, target: number, dt: number, rate = 8): number {
  const turn = Math.atan2(Math.sin(target - cur), Math.cos(target - cur));
  return cur + turn * Math.min(1, Math.max(0, dt) * rate);
}

/** Move toward a target at a steady speed. */
export function approach(cur: Point2, target: Point2, speed: number, dt: number): Point2 & { arrived: boolean; moved: number } {
  const dx = target.x - cur.x;
  const dz = target.z - cur.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.05) return { x: target.x, z: target.z, arrived: true, moved: 0 };
  const step = Math.min(distance, speed * Math.max(0, dt));
  return { x: cur.x + (dx / distance) * step, z: cur.z + (dz / distance) * step, arrived: step >= distance, moved: step };
}

// ----- Where friends stand at the outpost ----------------------------------------------------

/**
 * Places just outside the plaza (centre 0, 0.7; radius 4.1), clear of the buildings, the rover, the flag and
 * the base rocks (none are placed within 12 m of the origin). The two left ones are spots of the NPC crew
 * (src/world/crew.ts); the right one mirrors the left. They face the airlock.
 */
export const BASE_SLOTS: readonly Point2[] = [
  { x: -4.6, z: 1.4 },
  { x: 4.6, z: 1.4 },
  { x: -11.5, z: 2.6 },
];
export const AIRLOCK_FACING: Point2 = { x: 0, z: -3.6 };

/** One slot for each friend, the same every time for the same ids (ids are sorted, so the order never jumps). */
export function assignSlots(ids: readonly string[]): Map<string, number> {
  const slots = new Map<string, number>();
  [...ids].sort().forEach((id, index) => slots.set(id, index % BASE_SLOTS.length));
  return slots;
}

export type Emote = 'none' | 'wave' | 'cheer' | 'drill' | 'alarm';

/** What a friend does at the outpost, from what they are doing in the game. */
export function emoteFor(step: Step | null): Emote {
  switch (step) {
    case 'plan':
      return 'drill';
    case 'evaIntro':
    case 'evaResult':
    case 'report':
      return 'wave';
    default:
      return 'none';
  }
}

export type Doing = 'plan' | 'outside' | 'report';

/** The small icon over a friend's head: planning, outside, or reading the report. */
export function doingOf(step: Step | null): Doing {
  if (step === 'eva' || step === 'evaIntro') return 'outside';
  if (step === 'report' || step === 'evaResult' || step === 'night') return 'report';
  return 'plan';
}

export type FriendMode = 'walk' | 'base' | 'hidden';

export interface FriendLike {
  here: boolean;
  finished: boolean;
  status: Status | null;
}

/** Walking outside, standing at the base, or not shown (night, finished, gone). */
export function friendMode(friend: FriendLike): FriendMode {
  if (!friend.here || friend.finished || friend.status?.end) return 'hidden';
  const step = friend.status?.step ?? null;
  if (step === 'night') return 'hidden';
  return step === 'eva' ? 'walk' : 'base';
}

// ----- Sending our position ---------------------------------------------------------------------

/** A position goes out at most every POSITION_MIN_MS (5 a second) and at least once a second while on a walk. */
export const KEEPALIVE_MS = 1000;

/** Heading to the range -PI..PI (the rover's heading keeps counting up; the wire accepts at most +-10). */
export function wrapAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** The numbers of one position message: metres to centimetres, heading wrapped. m: 0 standing, 1 walking, 2 driving the rover. */
export function positionSample(x: number, z: number, heading: number, moving: boolean, driving: boolean): Position {
  const cm = (value: number): number => Math.round(Math.max(-500, Math.min(500, value)) * 100) / 100;
  return { x: cm(x), z: cm(z), a: Math.round(wrapAngle(heading) * 100) / 100, m: driving ? 2 : moving ? 1 : 0 };
}

/**
 * Decides when our position goes out: only during a walk (sample = null otherwise), at most 5 a second,
 * only when it changed, and once a second even if it did not (so friends know we are still there).
 */
export class PositionSender {
  private last: Position | null = null;
  private lastAt = -Infinity;

  /** Give the newest sample (or null when not on a walk). Returns what to send now, if anything. */
  next(nowMs: number, sample: Position | null): Position | null {
    if (!sample) {
      this.last = null;
      this.lastAt = -Infinity;
      return null;
    }
    const wait = nowMs - this.lastAt;
    if (wait < POSITION_MIN_MS) return null;
    const last = this.last;
    const changed = !last || Math.hypot(sample.x - last.x, sample.z - last.z) > 0.05 || Math.abs(sample.a - last.a) > 0.03 || sample.m !== last.m;
    if (!changed && wait < KEEPALIVE_MS) return null;
    this.last = sample;
    this.lastAt = nowMs;
    return sample;
  }
}

// ----- Weeks go on together ----------------------------------------------------------------------

const ORDER: Record<Step, number> = { briefing: 0, event: 1, eventResult: 2, plan: 3, evaIntro: 4, eva: 5, evaResult: 6, night: 7, report: 8 };

export interface MateLike extends FriendLike {
  id: string;
  me: boolean;
}

/**
 * The friends the next week should wait for: connected, not finished, and in an earlier week or at an
 * earlier step of this week than the report. A friend who left, finished or lost the connection is
 * never waited for.
 */
export function whoIsBehind<T extends MateLike>(me: { week: number; step: Step }, players: readonly T[]): T[] {
  return players.filter((friend) => {
    if (friend.me || !friend.here || friend.finished || friend.status?.end) return false;
    // No news yet: they are at the start of week 1.
    const week = friend.status?.week ?? 1;
    const step = friend.status?.step ?? 'briefing';
    if (week !== me.week) return week < me.week;
    return ORDER[step] < ORDER[me.step];
  });
}
