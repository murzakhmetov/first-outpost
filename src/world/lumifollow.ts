/**
 * How Lumi follows the cadet, as plain functions: the spring flight, the goal on foot and in the
 * rover, and the rover's body as boxes. World and Lumi use them, and the tests run the same code.
 */
import { resolveSphere } from './keepclear';
import type { SolidBox, Solids, Vec3 } from './keepclear';

/** The spring never flies faster than this, metres per second (open-ground following peaks near 7; the rover drives at up to 12). */
export const LUMI_FLIGHT_MAX = 15;
/** Lumi's drawn position must not move faster than this outside teleports (flight plus the small pushes of the hard constraint). */
export const LUMI_TOP_SPEED = 18;

export interface Flight {
  pos: Vec3;
  vel: Vec3;
}

/** One step of Lumi's springy flight toward `goal`. */
export function stepFlight(f: Flight, goal: Vec3, dt: number): void {
  const k = Math.exp(-dt * 7);
  f.vel.x = (f.vel.x + (goal.x - f.pos.x) * dt * 26) * k;
  f.vel.y = (f.vel.y + (goal.y - f.pos.y) * dt * 26) * k;
  f.vel.z = (f.vel.z + (goal.z - f.pos.z) * dt * 26) * k;
  const speed = Math.hypot(f.vel.x, f.vel.y, f.vel.z);
  if (speed > LUMI_FLIGHT_MAX) {
    const scale = LUMI_FLIGHT_MAX / speed;
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

/** On foot: beside the cadet, a little ahead, above the head. */
export function walkGoal(out: Vec3, x: number, y: number, z: number, yaw: number): Vec3 {
  out.x = x + Math.cos(yaw) * 1.1 + Math.sin(yaw) * 0.5;
  out.y = y + 2.05;
  out.z = z - Math.sin(yaw) * 1.1 + Math.cos(yaw) * 0.5;
  return out;
}

/** The top of the rover's tallest part (the mast) above its ground point, with room for the tilt on slopes. */
export const ROVER_TOP = 3.9;
/**
 * Driving: above the front half of the roof (the mast is behind it), so Lumi shows in the chase camera
 * and not behind the HUD. 4.35 m is the roof (3.2 m) plus the goal's clear distance.
 */
export const DRIVE_GOAL_HEIGHT = 4.35;
export const DRIVE_GOAL_AHEAD = 2;

export function driveGoal(out: Vec3, x: number, y: number, z: number, heading: number): Vec3 {
  out.x = x + Math.sin(heading) * DRIVE_GOAL_AHEAD;
  out.y = y + DRIVE_GOAL_HEIGHT;
  out.z = z + Math.cos(heading) * DRIVE_GOAL_AHEAD;
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
