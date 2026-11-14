/**
 * How Lumi follows the cadet, as plain functions: the spring flight, the goal on foot and in the
 * rover, and the rover's body as boxes. World and Lumi use them, and the tests run the same code.
 */
import { heightToClear, resolveSphere, sphereOverlaps } from './keepclear';
import type { SolidBox, Solids, Vec3 } from './keepclear';

/** The spring never flies faster than this, metres per second (open-ground following peaks near 7; the rover drives at up to 12). */
export const LUMI_FLIGHT_MAX = 15;
/** Lumi's drawn position must not move faster than this outside teleports (flight plus the small pushes of the hard constraint). */
export const LUMI_TOP_SPEED = 18;

export interface Flight {
  pos: Vec3;
  vel: Vec3;
}

/** The spring's strength, its damping and its top speed (metres per second). */
export interface FlightTune {
  stiff: number;
  damp: number;
  max: number;
}
export const WALK_FLIGHT: FlightTune = { stiff: 26, damp: 7, max: LUMI_FLIGHT_MAX };
/** While driving Lumi keeps up: a stiffer spring and a top speed at least this much above the rover's speed. */
export const DRIVE_FLIGHT_MARGIN = 3;
export function driveFlight(out: FlightTune, roverSpeed: number): FlightTune {
  out.stiff = 70;
  out.damp = 12;
  out.max = Math.max(LUMI_FLIGHT_MAX, Math.abs(roverSpeed) + DRIVE_FLIGHT_MARGIN);
  return out;
}

/** One step of Lumi's springy flight toward `goal`. */
export function stepFlight(f: Flight, goal: Vec3, dt: number, tune: FlightTune = WALK_FLIGHT): void {
  const k = Math.exp(-dt * tune.damp);
  f.vel.x = (f.vel.x + (goal.x - f.pos.x) * dt * tune.stiff) * k;
  f.vel.y = (f.vel.y + (goal.y - f.pos.y) * dt * tune.stiff) * k;
  f.vel.z = (f.vel.z + (goal.z - f.pos.z) * dt * tune.stiff) * k;
  const speed = Math.hypot(f.vel.x, f.vel.y, f.vel.z);
  if (speed > tune.max) {
    const scale = tune.max / speed;
    f.vel.x *= scale;
    f.vel.y *= scale;
    f.vel.z *= scale;
  }
  f.pos.x += f.vel.x * dt;
  f.pos.y += f.vel.y * dt;
  f.pos.z += f.vel.z * dt;
}

const scratch: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The hard constraint: the DRAWN position (flight point plus bob) must be outside every solid.
 * Moves the flight point by what it takes and drops the part of the velocity that pointed into the
 * solid, so the spring does not push on. Returns true when it had to move.
 */
export function pushFlight(f: Flight, bob: number, R: number, solids: Solids): boolean {
  scratch.x = f.pos.x;
  scratch.y = f.pos.y + bob;
  scratch.z = f.pos.z;
  if (!resolveSphere(scratch, R, solids)) return false;
  const dx = scratch.x - f.pos.x;
  const dy = scratch.y - bob - f.pos.y;
  const dz = scratch.z - f.pos.z;
  f.pos.x += dx;
  f.pos.y += dy;
  f.pos.z += dz;
  const len = Math.hypot(dx, dy, dz);
  if (len > 1e-9) {
    const into = (f.vel.x * dx + f.vel.y * dy + f.vel.z * dz) / len;
    if (into < 0) {
      f.vel.x -= (dx / len) * into;
      f.vel.y -= (dy / len) * into;
      f.vel.z -= (dz / len) * into;
    }
  }
  return true;
}

const spot: Vec3 = { x: 0, y: 0, z: 0 };

/** The most the goal is raised over what is in the way, metres: enough to clear the tallest building (the lab is 9.5 m) from beside it. */
export const MAX_GOAL_RAISE = 11;

/**
 * Raise the goal so the straight flight from `from` to it does not cut through a solid thing at the height it would be
 * flying at: Lumi then goes up first and over, instead of sinking into a gap (between a parked rover and a wall) and being
 * lifted out of it in one jump. Only the part of the way that is not right at Lumi counts, and the raise is limited (MAX_GOAL_RAISE).
 */
export function liftGoalOverPath(goal: Vec3, from: Vec3, R: number, solids: Solids, steps = 24): void {
  const base = goal.y;
  const len = Math.hypot(goal.x - from.x, goal.z - from.z);
  if (len < 1e-6) return;
  // Samples every few metres from just ahead of Lumi to the goal (a wall a metre or two ahead counts too: Lumi could not get up in time).
  const first = 1.2;
  const last = len * 0.95;
  if (last < first) return;
  let climb = 0;
  for (let i = 0; i < steps; i++) {
    const s = first + ((last - first) * i) / Math.max(1, steps - 1);
    const t = s / len;
    spot.x = from.x + (goal.x - from.x) * t;
    spot.z = from.z + (goal.z - from.z) * t;
    spot.y = from.y + (goal.y - from.y) * t;
    if (!sphereOverlaps(spot, R, solids)) continue;
    const need = heightToClear(spot, R, solids) + 0.08;
    const wanted = from.y + (need - from.y) / t;
    // A slope of about 1 : 1 is all Lumi can fly; steeper than that, it first climbs on the spot.
    if (wanted > base + MAX_GOAL_RAISE || need - from.y > s) climb = Math.max(climb, need);
    else goal.y = Math.max(goal.y, wanted);
  }
  if (climb > 0) {
    // Straight up (a little toward the goal) until the way over is open; the goal is worked out again every frame.
    goal.x = from.x + (goal.x - from.x) * 0.02;
    goal.z = from.z + (goal.z - from.z) * 0.02;
    goal.y = Math.max(goal.y, climb);
  }
}

/** On foot: Lumi floats beside the cadet (not over the head), at about shoulder height. */
export const WALK_GOAL_SIDE = 1.7;
export const WALK_GOAL_HEIGHT = 1.75;
/** On foot: beside the cadet, a little ahead. */
export function walkGoal(out: Vec3, x: number, y: number, z: number, yaw: number, camX?: number, camZ?: number): Vec3 {
  // The side is the camera's right when the camera is known (so Lumi never hides behind the head, whichever way the cadet faces).
  let sx = Math.cos(yaw);
  let sz = -Math.sin(yaw);
  if (camX !== undefined && camZ !== undefined) {
    const dx = x - camX;
    const dz = z - camZ;
    const len = Math.hypot(dx, dz);
    if (len > 0.5) {
      sx = -dz / len;
      sz = dx / len;
    }
  }
  out.x = x + sx * WALK_GOAL_SIDE + Math.sin(yaw) * 0.5;
  out.y = y + WALK_GOAL_HEIGHT;
  out.z = z + sz * WALK_GOAL_SIDE + Math.cos(yaw) * 0.5;
  return out;
}

/** The top of the rover's tallest part (the mast) above its ground point, with room for the tilt on slopes. */
export const ROVER_TOP = 3.9;
/**
 * Driving: beside the roof, lower than it, so Lumi shows in the chase camera in the middle of the upper half
 * of the screen: below the top HUD band, not hidden by the rover. The side distance is the hull's half width
 * (1.65 m, a little more on a slope) plus the goal's clear distance.
 */
export const DRIVE_GOAL_HEIGHT = 2.5;
export const DRIVE_GOAL_AHEAD = 0;
/** Metres to the side of the rover's middle line (negative: its right). */
export const DRIVE_GOAL_SIDE = -2.6;
/** While driving, the goal keeps this much more room from buildings than the hard rule asks, metres. */
export const DRIVE_LOOKAHEAD = 3;
/** The look-ahead only applies above this rover speed, metres per second (a rover crawling or stopped at a wall needs no run-up). */
export const DRIVE_LOOKAHEAD_SPEED = 2.5;

export function driveGoal(out: Vec3, x: number, y: number, z: number, heading: number): Vec3 {
  out.x = x + Math.sin(heading) * DRIVE_GOAL_AHEAD + Math.cos(heading) * DRIVE_GOAL_SIDE;
  out.y = y + DRIVE_GOAL_HEIGHT;
  out.z = z + Math.cos(heading) * DRIVE_GOAL_AHEAD - Math.sin(heading) * DRIVE_GOAL_SIDE;
  return out;
}

const blank = (): SolidBox => ({ x: 0, z: 0, hx: 1, hz: 1, yaw: 0, y0: 0, y1: 1 });
/** The pool of boxes for the rover's body (so the rover does not allocate every frame). */
export const newRoverBoxes = (): SolidBox[] => [blank(), blank()];

/** Local boxes of the rover model: x across (left +), z along (nose +): centre x, centre z, half x, half z, top. */
const PARTS: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0.125, 1.65, 2.325, 3.2], // hull, wheels and the roof deck (a little extra for the tilt on a slope)
  // Everything above 2.85 m (measured on the model): the radio mast with its dish, the camera head, the light bar.
  [-0.125, -0.675, 1.175, 1.425, ROVER_TOP],
];

/** The rover's body at its current pose, written into `out` (the boxes from `newRoverBoxes`). */
export function roverBoxes(out: SolidBox[], x: number, y: number, z: number, heading: number, pitch = 0, roll = 0): void {
  // On a slope the body leans: its ends and sides rise and sink by about half its length and width times the angle.
  const lean = 2.45 * Math.abs(Math.sin(pitch)) + 1.65 * Math.abs(Math.sin(roll));
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  PARTS.forEach(([cx, cz, hx, hz, top], index) => {
    const box = out[index];
    if (!box) return;
    box.x = x + cx * cos + cz * sin;
    box.z = z - cx * sin + cz * cos;
    box.hx = hx;
    box.hz = hz;
    box.yaw = heading;
    box.y0 = y - 0.5 - lean;
    box.y1 = y + top + lean;
  });
}
