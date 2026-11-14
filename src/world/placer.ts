/**
 * Creative mode: putting a building or a decoration on the ground. A see-through copy
 * follows the pointer over the flat ground of the outpost, a ring under it turns green
 * where it fits and red where it would bump into something, and a click puts it down.
 */
import * as THREE from 'three';
import type { Collider } from './base';
import { shape } from './build';
import { LANDER } from './props';
import { BASE_RADIUS, PLAZA } from './terrain';

export class Placer {
  active = false;
  valid = false;
  heading = 0;
  readonly group = new THREE.Group();
  /** Called with the spot when the player clicks a free place. */
  onPlace: ((x: number, z: number, heading: number) => void) | null = null;
  /** Called when the spot under the pointer becomes free or blocked. */
  onChange: ((valid: boolean) => void) | null = null;

  private ghost: THREE.Object3D | null = null;
  private radius = 4;
  private ignore: Collider | null = null;
  private readonly ring: THREE.Mesh;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly point = new THREE.Vector3(0, 0, 12);
  private readonly pointer = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private down: { x: number; y: number } | null = null;
  private seen = false;

  constructor(
    private readonly camera: THREE.Camera,
    private readonly canvas: HTMLCanvasElement,
    private readonly colliders: Collider[],
    private readonly height: (x: number, z: number) => number,
  ) {
    this.group.name = 'placer';
    this.ringMaterial = new THREE.MeshBasicMaterial({ color: '#5fff9a', transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
    this.ring = new THREE.Mesh(shape.torus(1, 0.05, 64, 6), this.ringMaterial);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  /** Start placing: `ghost` follows the pointer; `radius` is how much room it needs. */
  start(ghost: THREE.Object3D, radius: number, heading: number, ignore: Collider | null): void {
    this.stop();
    this.active = true;
    this.ghost = ghost;
    this.radius = radius;
    this.heading = heading;
    this.ignore = ignore;
    this.seen = false;
    this.group.add(ghost);
    this.ring.visible = true;
    this.ring.scale.set(radius, radius, 1);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.check();
  }

  stop(): void {
    if (this.ghost) {
      this.group.remove(this.ghost);
      this.ghost.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && !mesh.geometry.userData.shared) mesh.geometry.dispose();
      });
    }
    this.ghost = null;
    this.ring.visible = false;
    this.active = false;
    this.down = null;
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointerup', this.onUp);
  }

  rotate(step = Math.PI / 4): void {
    this.heading += step;
  }

  /** Put the thing down where the ghost is now (for the button on touch screens). */
  confirm(): boolean {
    if (!this.active || !this.valid) return false;
    this.onPlace?.(this.point.x, this.point.z, this.heading);
    return true;
  }

  private readonly onMove = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3());
    if (!hit) return;
    // Snap to half a metre: rows of things line up neatly.
    this.point.set(Math.round(hit.x * 2) / 2, 0, Math.round(hit.z * 2) / 2);
    this.seen = true;
    this.check();
  };

  private readonly onDown = (event: PointerEvent): void => {
    this.down = { x: event.clientX, y: event.clientY };
  };

  private readonly onUp = (event: PointerEvent): void => {
    const down = this.down;
    this.down = null;
    if (!down || event.button !== 0) return;
    // A drag turns the camera; only a click (or a tap) places.
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 8) return;
    this.onMove(event);
    if (this.valid) this.onPlace?.(this.point.x, this.point.z, this.heading);
  };

  /** Is there room here? Inside the flat ground, off the plaza and the landing pad, clear of everything else. */
  private check(): void {
    const { x, z } = this.point;
    const r = this.radius;
    let valid = this.seen && Math.hypot(x, z) + r < BASE_RADIUS - 2;
    if (valid && Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + r + 0.4) valid = false;
    if (valid && Math.hypot(x - LANDER.x, z - LANDER.z) < 7.6 + r) valid = false;
    if (valid) {
      for (const c of this.colliders) {
        if (c === this.ignore || c.r < 0.2) continue;
        if (Math.hypot(x - c.x, z - c.z) < c.r + r - 0.2) {
          valid = false;
          break;
        }
      }
    }
    if (valid !== this.valid) {
      this.valid = valid;
      this.onChange?.(valid);
    }
    this.ringMaterial.color.set(valid ? '#5fff9a' : '#ff5a5a');
  }

  update(time: number): void {
    if (!this.active || !this.ghost) return;
    const y = this.height(this.point.x, this.point.z);
    this.ghost.position.set(this.point.x, y, this.point.z);
    this.ghost.rotation.y = this.heading;
    this.ghost.visible = this.seen;
    this.ring.position.set(this.point.x, y + 0.08, this.point.z);
    this.ring.visible = this.seen;
    const pulse = 1 + Math.sin(time * 4) * 0.03;
    this.ring.scale.set(this.radius * pulse, this.radius * pulse, 1);
  }

  dispose(): void {
    this.stop();
    this.ring.geometry.dispose();
    this.ringMaterial.dispose();
  }
}
