/**
 * The crew rover. It waits by the plaza, and on a walk outside the cadet can get in and drive it:
 * faster than walking, and the cabin keeps its own air, but the battery is small and samples
 * can only be picked up on foot.
 *
 * The model comes from rover.glb (scripts/models/rover.py). Its wheels are separate nodes
 * (wheel_l0 .. wheel_r2, front to back) so they can turn and steer.
 */
import * as THREE from 'three';
import type { Collider } from './base';

/** Where the rover is parked, and the way it faces (by the plaza, nose toward the outpost). */
export const ROVER = { x: 10.5, z: 9 };
export const ROVER_HEADING = 2.2 + Math.PI / 2;

/** Three circles along the rover's length stand for its body, when it hits something. */
const PROBES = [-1.3, 0, 1.3];
const PROBE_RADIUS = 1.3;
/** Size of the circles that stop the cadet from walking through a parked rover. */
const PARKED_RADIUS = 1.5;
const WHEEL_RADIUS = 0.62;
/** Metres per second, forward. Reversing is slower. */
const TOP_SPEED = { mars: 10.5, moon: 8.5 };
/** Share of the battery used per second at full speed. Full charge lasts about half a minute. */
const DRAIN = 0.034;
/** The rover must stay inside the walking area. */
const LIMIT = 116;

export class Rover {
  /** Share of the normal battery use: the workshop's bigger battery lowers it. */
  drainScale = 1;
  x = ROVER.x;
  z = ROVER.z;
  /** Radians, 0 = toward +Z. */
  heading = ROVER_HEADING;
  /** Metres per second along the heading (negative = reversing). */
  speed = 0;
  /** Battery, 0-1. Full at the start of every walk. */
  charge = 1;
  y = 0;
  driving = false;
  readonly top: number;

  private pitch = 0;
  private roll = 0;
  private steer = 0;
  private readonly wheels: THREE.Object3D[] = [];
  private readonly colliders: Collider[];
  /** Metres rolled since the last dust puff. */
  private dustTrail = 0;

  constructor(
    private readonly group: THREE.Object3D,
    colliders: Collider[],
    private readonly height: (x: number, z: number) => number,
    site: 'mars' | 'moon',
  ) {
    this.top = TOP_SPEED[site];
    this.colliders = colliders;
    for (const name of ['wheel_l0', 'wheel_l1', 'wheel_l2', 'wheel_r0', 'wheel_r1', 'wheel_r2']) {
      const wheel = group.getObjectByName(name);
      if (!wheel) continue;
      // Turn about the axle first, then about the upright (steering).
      wheel.rotation.order = 'YXZ';
      this.wheels.push(wheel);
    }
    this.group.rotation.order = 'YXZ';
    this.park();
  }

  /** Back to the parking place by the plaza, battery full. */
  park(): void {
    this.x = ROVER.x;
    this.z = ROVER.z;
    this.heading = ROVER_HEADING;
    this.speed = 0;
    this.charge = 1;
    this.steer = 0;
    this.driving = false;
    this.pitch = this.roll = 0;
    this.place(true);
    this.syncColliders();
  }

  /** Distance from a point to the nearest part of the rover's body (to the middle of the nearest circle). */
  distanceTo(x: number, z: number): number {
    let best = Infinity;
    for (const offset of PROBES) {
      const px = this.x + Math.sin(this.heading) * offset;
      const pz = this.z + Math.cos(this.heading) * offset;
      best = Math.min(best, Math.hypot(x - px, z - pz));
    }
    return best;
  }

  /** A free spot beside the rover where the cadet can step out: the left side, the right side, then behind. */
  exitSpots(): { x: number; z: number }[] {
    const sin = Math.sin(this.heading);
    const cos = Math.cos(this.heading);
    // Local (+X, +Z) turned by the heading: the model's +X side is its left.
    const at = (lx: number, lz: number): { x: number; z: number } => ({ x: this.x + lx * cos + lz * sin, z: this.z - lx * sin + lz * cos });
    return [at(2.7, 0.4), at(-2.7, 0.4), at(2.7, -1.6), at(-2.7, -1.6), at(0, -3.9), at(0, 3.9)];
  }

  setDriving(on: boolean): void {
    this.driving = on;
    if (on) {
      // Moving circles do not block the person inside, nor the camera that follows.
      for (const collider of this.colliders) collider.r = 0;
    } else {
      this.speed = 0;
      this.syncColliders();
    }
  }

  private syncColliders(): void {
    this.colliders.forEach((collider, index) => {
      const offset = PROBES[index] ?? 0;
      collider.x = this.x + Math.sin(this.heading) * offset;
      collider.z = this.z + Math.cos(this.heading) * offset;
      collider.r = this.driving ? 0 : PARKED_RADIUS;
    });
  }

  /**
   * Drive for a moment. `throttle`: -1 (reverse) to 1 (forward). `steer`: -1 (left) to 1 (right).
   * Returns the speed at which the rover hit something this frame (0 if it did not).
   */
  update(dt: number, throttle: number, steer: number, colliders: readonly Collider[]): number {
    let want = 0;
    if (this.charge > 0.002) want = throttle > 0 ? throttle * this.top : throttle * this.top * 0.45;
    // Quick to brake, slower to pick up speed, and it rolls to a stop on its own.
    const braking = want * this.speed < 0;
    const rate = braking ? 5 : Math.abs(want) < 0.05 * this.top ? 0.9 : 1.8;
    this.speed += (want - this.speed) * (1 - Math.exp(-rate * dt));
    // Friction on top of the slow roll-out, so it does not creep along for ever.
    if (Math.abs(throttle) < 0.05 || this.charge <= 0.002) {
      const drag = Math.min(Math.abs(this.speed), 2.2 * dt);
      this.speed -= Math.sign(this.speed) * drag;
    }
    if (Math.abs(this.speed) < 0.15 && want === 0) this.speed = 0;

    // Steering bites harder the faster it rolls; it turns the right way when reversing too.
    const bite = 0.25 + 0.75 * Math.min(1, Math.abs(this.speed) / 3.5);
    const way = this.speed >= -0.2 ? 1 : -1;
    this.heading -= steer * 1.45 * bite * way * dt;
    this.steer += (steer - this.steer) * (1 - Math.exp(-9 * dt));

    if (Math.abs(throttle) > 0.05 && this.charge > 0) {
      this.charge = Math.max(0, this.charge - dt * DRAIN * this.drainScale * (0.3 + 0.7 * Math.min(1, Math.abs(this.speed) / this.top)));
    }

    const sin = Math.sin(this.heading);
    const cos = Math.cos(this.heading);
    const travelled = this.speed * dt;
    this.x += sin * travelled;
    this.z += cos * travelled;
    const hit = this.collide(colliders);

    const fromCentre = Math.hypot(this.x, this.z);
    if (fromCentre > LIMIT) {
      this.x *= LIMIT / fromCentre;
      this.z *= LIMIT / fromCentre;
      this.speed *= 0.6;
    }

    this.dustTrail += Math.abs(travelled);
    this.place(false, dt, travelled);
    this.syncColliders();
    return hit;
  }

  /** True once for every few metres rolled: time to kick up some dust. */
  takeDust(): boolean {
    if (this.dustTrail < 1.1) return false;
    this.dustTrail = 0;
    return true;
  }

  /** The point behind the left or right rear wheel, on the ground. */
  rearWheel(side: -1 | 1, out: THREE.Vector3): THREE.Vector3 {
    const sin = Math.sin(this.heading);
    const cos = Math.cos(this.heading);
    const lx = 1.22 * side;
    const lz = -1.5;
    const x = this.x + lx * cos + lz * sin;
    const z = this.z - lx * sin + lz * cos;
    return out.set(x, this.height(x, z), z);
  }

  /** Push the rover out of whatever it overlaps. Returns how fast it was going if it hit something. */
  private collide(colliders: readonly Collider[]): number {
    let hit = 0;
    for (let pass = 0; pass < 2; pass++) {
      const fx = Math.sin(this.heading);
      const fz = Math.cos(this.heading);
      for (const offset of PROBES) {
        const px = this.x + fx * offset;
        const pz = this.z + fz * offset;
        for (const c of colliders) {
          if (c.r <= 0) continue; // includes the rover's own circles while it is driven
          const dx = px - c.x;
          const dz = pz - c.z;
          const min = PROBE_RADIUS + c.r;
          const d2 = dx * dx + dz * dz;
          if (d2 >= min * min || d2 < 1e-8) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const nz = dz / d;
          this.x += nx * (min - d);
          this.z += nz * (min - d);
          const along = fx * nx + fz * nz;
          // Only the part of the speed that pointed into the obstacle is lost.
          if (this.speed * along < 0) {
            hit = Math.max(hit, Math.abs(this.speed));
            this.speed *= 1 - along * along;
          }
        }
      }
    }
    return hit;
  }

  /** Put the model on the ground: tilt it with the slope, turn the wheels. */
  private place(snap: boolean, dt = 0, travelled = 0): void {
    const sin = Math.sin(this.heading);
    const cos = Math.cos(this.heading);
    const at = (lx: number, lz: number): number => this.height(this.x + lx * cos + lz * sin, this.z - lx * sin + lz * cos);
    const frontLeft = at(1.2, 1.5);
    const frontRight = at(-1.2, 1.5);
    const backLeft = at(1.2, -1.5);
    const backRight = at(-1.2, -1.5);
    const front = (frontLeft + frontRight) / 2;
    const back = (backLeft + backRight) / 2;
    const left = (frontLeft + backLeft) / 2;
    const right = (frontRight + backRight) / 2;
    const wantedPitch = -Math.atan2(front - back, 3);
    const wantedRoll = Math.atan2(left - right, 2.4);
    const k = snap ? 1 : 1 - Math.exp(-7 * dt);
    this.pitch += (wantedPitch - this.pitch) * k;
    this.roll += (wantedRoll - this.roll) * k;
    this.y = (front + back) / 2;
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.set(this.pitch, this.heading, this.roll);

    const spin = travelled / WHEEL_RADIUS;
    this.wheels.forEach((wheel, index) => {
      wheel.rotation.x += spin;
      // The front pair steers one way, the rear pair the other, as on real six-wheeled rovers.
      const end = index % 3;
      wheel.rotation.y = end === 0 ? this.steer * -0.42 : end === 2 ? this.steer * 0.42 : 0;
    });
  }
}
