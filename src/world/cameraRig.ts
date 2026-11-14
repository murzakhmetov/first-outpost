/**
 * One camera, three jobs: a slow orbit around the outpost, a close look at one
 * building, and a third-person view that follows the astronaut.
 * Every move is eased, so cuts never jump.
 */
import * as THREE from 'three';
import type { Collider, Spot } from './base';

const TWO_PI = Math.PI * 2;

function shortestAngle(from: number, to: number): number {
  let delta = (to - from) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta < -Math.PI) delta += TWO_PI;
  return delta;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /** Smoothed values actually used for the camera. */
  readonly target = new THREE.Vector3(0, 2, 0);
  distance = 64;
  yaw = 0.62;
  pitch = 0.44;

  /** Radians per second of automatic turning (0 = off). */
  autoRotate = 0;
  minPitch = 0.06;
  maxPitch = 1.25;
  minDistance = 6;
  maxDistance = 110;
  /** How quickly the camera catches up (higher = snappier). */
  stiffness = 3.2;
  /** Ground height lookup so the camera never dips under the terrain. */
  heightAt: ((x: number, z: number) => number) | null = null;
  /** Extra distance for tall, narrow screens. */
  aspectScale = 1;
  /** Buildings and rocks the camera should not sit inside. */
  blockers: Collider[] = [];
  /** Pull the camera in when something stands between it and the target (third-person view). */
  avoidBlockers = false;
  /** No automatic turning and no shake. */
  calm = false;
  /** The camera sits at the cadet's eyes and looks where the cadet looks (first person). */
  firstPerson = false;
  /** How quickly the camera follows a moving point (null: the same as `stiffness`). */
  followStiffness: number | null = null;
  /** The distance kept clear of rocks and walls, eased so the camera never jumps. */
  private clearEased = -1;
  /** Last word on where the camera may be (inside a room: not behind its walls). */
  limit: ((camera: THREE.Vector3, target: THREE.Vector3) => void) | null = null;

  private readonly goalTarget = new THREE.Vector3(0, 2, 0);
  private goalDistance = 64;
  private goalYaw = 0.62;
  private goalPitch = 0.44;
  private shake = 0;
  private readonly offset = new THREE.Vector3();
  /** Seconds since the player last moved the view. */
  idle = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  /** Move to a prepared viewpoint. */
  setSpot(spot: Spot, instant = false): void {
    this.goalTarget.copy(spot.target);
    this.goalDistance = spot.distance;
    this.goalPitch = spot.pitch;
    // Take the short way round.
    this.goalYaw = this.goalYaw + shortestAngle(this.goalYaw, spot.yaw);
    if (instant) this.snap();
  }

  /** Follow a moving point (the astronaut). Keeps the player's chosen angle. */
  follow(point: THREE.Vector3, lift = 1.35): void {
    this.goalTarget.set(point.x, point.y + lift, point.z);
  }

  setDistance(distance: number): void {
    this.goalDistance = THREE.MathUtils.clamp(distance, this.minDistance, this.maxDistance);
  }

  setAngles(yaw: number, pitch: number): void {
    this.goalYaw = this.goalYaw + shortestAngle(this.goalYaw, yaw);
    this.goalPitch = THREE.MathUtils.clamp(pitch, this.minPitch, this.maxPitch);
  }

  /** Set the pitch at once (no easing), keeping the turn as it is. */
  setPitchNow(pitch: number): void {
    this.goalPitch = this.pitch = THREE.MathUtils.clamp(pitch, this.minPitch, this.maxPitch);
  }

  /** Bring the view inside the pitch limits (they change between first and third person). */
  clampPitch(): void {
    this.goalPitch = THREE.MathUtils.clamp(this.goalPitch, this.minPitch, this.maxPitch);
    this.pitch = THREE.MathUtils.clamp(this.pitch, this.minPitch, this.maxPitch);
  }

  /** Player drags the view. */
  rotate(deltaYaw: number, deltaPitch: number): void {
    this.goalYaw += deltaYaw;
    this.goalPitch = THREE.MathUtils.clamp(this.goalPitch + deltaPitch, this.minPitch, this.maxPitch);
    this.idle = 0;
  }

  /** Player zooms. factor > 1 moves away. */
  zoom(factor: number): void {
    this.goalDistance = THREE.MathUtils.clamp(this.goalDistance * factor, this.minDistance, this.maxDistance);
    this.idle = 0;
  }

  /** Direction the camera looks along the ground, as an angle. Used to steer the astronaut. */
  get heading(): number {
    return this.yaw;
  }

  addShake(amount: number): void {
    if (this.calm) return;
    this.shake = Math.min(1.2, this.shake + amount);
  }

  snap(): void {
    this.target.copy(this.goalTarget);
    this.distance = this.goalDistance;
    this.yaw = this.goalYaw;
    this.pitch = this.goalPitch;
    this.clearEased = -1;
    this.place(0, 0);
  }

  update(dt: number, time: number): void {
    this.idle += dt;
    // Auto-rotation pauses for a moment after the player touches the view.
    if (this.autoRotate !== 0 && this.idle > 2.5 && !this.calm) this.goalYaw += this.autoRotate * dt;

    const k = 1 - Math.exp(-this.stiffness * dt);
    // The point being followed is caught up quickly (a slow catch-up feels like dragging a weight);
    // the turning of the view stays softer, except in first person, where it must answer at once.
    const kFollow = 1 - Math.exp(-(this.followStiffness ?? this.stiffness) * dt);
    const kTurn = this.firstPerson ? 1 - Math.exp(-22 * dt) : k;
    this.target.lerp(this.goalTarget, kFollow);
    this.distance += (this.goalDistance - this.distance) * k;
    this.yaw += shortestAngle(this.yaw, this.goalYaw) * kTurn;
    this.pitch += (this.goalPitch - this.pitch) * kTurn;
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.place(time, dt);
  }

  /** Longest camera distance (up to the wanted one) that keeps the camera out of buildings. */
  private clearDistance(wanted: number): number {
    const dirX = Math.sin(this.yaw) * Math.cos(this.pitch);
    const dirY = Math.sin(this.pitch);
    const dirZ = Math.cos(this.yaw) * Math.cos(this.pitch);
    const steps = 14;
    for (let i = 3; i <= steps; i++) {
      const d = (wanted * i) / steps;
      const x = this.target.x + dirX * d;
      const y = this.target.y + dirY * d;
      const z = this.target.z + dirZ * d;
      if (y > 7.5) break; // above the roofs
      for (const blocker of this.blockers) {
        if (blocker.r < 1) continue;
        if (Math.hypot(x - blocker.x, z - blocker.z) < blocker.r + 0.3) {
          return Math.max(this.minDistance * 0.6, (wanted * (i - 1)) / steps);
        }
      }
    }
    return wanted;
  }

  private place(time: number, dt: number): void {
    if (this.firstPerson) {
      this.placeFirstPerson(time);
      return;
    }
    let distance = this.distance * this.aspectScale;
    if (this.avoidBlockers && this.blockers.length) {
      // Coming close to a rock the camera slides in quickly and eases back out slowly, never in jumps.
      const clear = this.clearDistance(distance);
      if (this.clearEased < 0) this.clearEased = clear;
      // A new obstacle is met at once (never inside it); the way back out is slow.
      if (clear < this.clearEased - 0.5) this.clearEased = clear;
      const rate = clear < this.clearEased ? 14 : 3;
      this.clearEased += (clear - this.clearEased) * (1 - Math.exp(-rate * dt));
      distance = Math.min(distance, this.clearEased);
    } else {
      this.clearEased = -1;
    }
    const flat = Math.cos(this.pitch) * distance;
    this.offset.set(Math.sin(this.yaw) * flat, Math.sin(this.pitch) * distance, Math.cos(this.yaw) * flat);
    const camera = this.camera;
    camera.position.copy(this.target).add(this.offset);
    if (this.heightAt) {
      const floor = this.heightAt(camera.position.x, camera.position.z) + 0.8;
      if (camera.position.y < floor) camera.position.y = floor;
    }
    if (this.limit) this.limit(camera.position, this.target);
    if (this.shake > 0.001) {
      const s = this.shake * 0.22;
      camera.position.x += Math.sin(time * 61) * s;
      camera.position.y += Math.sin(time * 73 + 1.3) * s;
      camera.position.z += Math.sin(time * 67 + 2.1) * s;
    }
    camera.lookAt(this.target);
  }

  /** At the eyes, looking the way the third-person camera would look past the cadet. */
  private placeFirstPerson(time: number): void {
    this.clearEased = -1; // coming back to third person starts from the wanted distance
    const camera = this.camera;
    const flat = Math.cos(this.pitch);
    const dirX = Math.sin(this.yaw) * flat;
    const dirY = Math.sin(this.pitch);
    const dirZ = Math.cos(this.yaw) * flat;
    camera.position.copy(this.target);
    if (this.shake > 0.001) {
      const s = this.shake * 0.1;
      camera.position.x += Math.sin(time * 61) * s;
      camera.position.y += Math.sin(time * 73 + 1.3) * s;
    }
    camera.lookAt(this.target.x - dirX, this.target.y - dirY, this.target.z - dirZ);
  }
}
