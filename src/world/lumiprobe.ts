/**
 * Dev only: counts the frames where the drawn Lumi touches a solid thing, so a test can drive
 * around and read the counters (`fo.lumiProbe()`). World calls it behind `import.meta.env.DEV`,
 * so production builds drop this file. The state lives here, not in World, for the same reason.
 */
import { LUMI_CLEAR, LUMI_RADIUS, sphereOverlaps } from './keepclear';
import type { Solids, Vec3 } from './keepclear';
import { LUMI_TOP_SPEED } from './lumifollow';

export interface LumiProbe {
  /** Frames counted (walk mode only). */
  frames: number;
  /** Frames where the sphere with its margin touched a solid. */
  overlaps: number;
  /** Frames where the bare body (no margin) touched a solid. */
  bodyOverlaps: number;
  /** Frames the scene teleported the cadet (not counted for speed). */
  teleports: number;
  /** Non-teleport frames where the drawn position moved faster than LUMI_TOP_SPEED. */
  fast: number;
  /** Fastest drawn speed on non-teleport frames, metres per second. */
  maxSpeed: number;
  /** The last overlapping position. */
  last: null | { x: number; y: number; z: number; teleport: boolean };
}

const fresh = (): LumiProbe => ({ frames: 0, overlaps: 0, bodyOverlaps: 0, teleports: 0, fast: 0, maxSpeed: 0, last: null });
const probe = fresh();
const prev = { x: 0, y: 0, z: 0, has: false };

/** One frame: `pos` is where Lumi is drawn, `counting` says whether the hard rule applies (a walk outside). */
export function lumiProbeStep(pos: Vec3, dt: number, teleport: boolean, counting: boolean, solids: Solids): void {
  if (counting && dt > 0) {
    probe.frames++;
    if (sphereOverlaps(pos, LUMI_CLEAR - 0.005, solids)) {
      probe.overlaps++;
      probe.last = { x: pos.x, y: pos.y, z: pos.z, teleport };
    }
    if (sphereOverlaps(pos, LUMI_RADIUS, solids)) probe.bodyOverlaps++;
    if (teleport) probe.teleports++;
    else if (prev.has) {
      const speed = Math.hypot(pos.x - prev.x, pos.y - prev.y, pos.z - prev.z) / dt;
      probe.maxSpeed = Math.max(probe.maxSpeed, speed);
      if (speed > LUMI_TOP_SPEED) probe.fast++;
    }
  }
  prev.x = pos.x;
  prev.y = pos.y;
  prev.z = pos.z;
  prev.has = true;
}

/** A copy of the counters; with `reset`, they start again from zero. */
export function lumiProbeRead(reset = false): LumiProbe {
  const copy = { ...probe, last: probe.last && { ...probe.last } };
  if (reset) Object.assign(probe, fresh());
  return copy;
}
