/**
 * Heights of solid things, taken from the placed models themselves (no hand-written estimates),
 * so Lumi's keep-clear rule (see keepclear.ts) flies over a collider exactly as high as the
 * thing is. Plain three.js maths: it needs a scene object, not a renderer.
 *
 * A collider is a vertical circle. `colliderHeight` gives its `h`: the top of the model inside
 * the circle, above the ground at the middle. When there is nothing to measure it returns
 * undefined, and the collider stays "tall" (see TALL in keepclear.ts).
 */
import * as THREE from 'three';
import { TALL } from './keepclear';

/** The smallest height a collider gets, so a flat thing still counts as a solid. */
export const MIN_COLLIDER_HEIGHT = 0.2;

export interface Footprint {
  x: number;
  z: number;
  r: number;
}

const box = new THREE.Box3();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();

/** Highest world y of a whole object: its Box3 (what a collider the size of the object needs). */
export function topOf(object: THREE.Object3D): number | undefined {
  object.updateWorldMatrix(true, true);
  box.setFromObject(object);
  return box.isEmpty() ? undefined : box.max.y;
}

/** Highest world y of a mesh-less box (a rock instance: its geometry bounds under its matrix). */
export function boundsTop(bounds: THREE.Box3, matrix: THREE.Matrix4): number {
  return box.copy(bounds).applyMatrix4(matrix).max.y;
}

/** Distance from (px, pz) to the triangle a, b, c seen from above; 0 when inside. */
function triangleDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  const side = (x1: number, z1: number, x2: number, z2: number): number => (x2 - x1) * (pz - z1) - (z2 - z1) * (px - x1);
  const s1 = side(ax, az, bx, bz);
  const s2 = side(bx, bz, cx, cz);
  const s3 = side(cx, cz, ax, az);
  if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return 0;
  const edge = (x1: number, z1: number, x2: number, z2: number): number => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / len2)) : 0;
    return Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t));
  };
  return Math.min(edge(ax, az, bx, bz), edge(bx, bz, cx, cz), edge(cx, cz, ax, az));
}

/**
 * Highest world y of the visible meshes of `object` inside a footprint circle: every triangle that
 * touches the circle counts with its highest corner (so the result is never below the real top).
 * Undefined when no mesh reaches into the circle.
 */
export function topWithin(object: THREE.Object3D, footprint: Footprint): number | undefined {
  object.updateWorldMatrix(true, true);
  let top = -Infinity;
  const mesh = new THREE.Box3();
  object.traverse((child) => {
    const m = child as THREE.Mesh;
    if (!m.isMesh || !m.visible || (m as THREE.InstancedMesh).isInstancedMesh) return;
    const geometry = m.geometry as THREE.BufferGeometry;
    const position = geometry.getAttribute('position');
    if (!position) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    mesh.copy(geometry.boundingBox!).applyMatrix4(m.matrixWorld);
    if (mesh.max.x < footprint.x - footprint.r || mesh.min.x > footprint.x + footprint.r) return;
    if (mesh.max.z < footprint.z - footprint.r || mesh.min.z > footprint.z + footprint.r) return;
    if (mesh.max.y <= top) return;
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(m.matrixWorld);
      const high = Math.max(a.y, b.y, c.y);
      if (high <= top) continue;
      if (triangleDistance(footprint.x, footprint.z, a.x, a.z, b.x, b.z, c.x, c.z) <= footprint.r) top = high;
    }
  });
  return top === -Infinity ? undefined : top;
}

/**
 * Highest world y a turning part can reach, whatever its angle: its pivot (the object's origin)
 * plus the farthest corner of its geometry. For a solar panel head that turns with the Sun.
 */
export function sweptTop(object: THREE.Object3D): number | undefined {
  object.updateWorldMatrix(true, true);
  const pivot = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
  const scale = new THREE.Vector3().setFromMatrixScale(object.matrixWorld);
  const grow = Math.max(scale.x, scale.y, scale.z);
  let far = -1;
  object.traverse((child) => {
    const m = child as THREE.Mesh;
    if (!m.isMesh) return;
    const geometry = m.geometry as THREE.BufferGeometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    // The farthest corner of the geometry box from the object's origin (in the mesh's own frame, then scaled).
    const local = new THREE.Matrix4().copy(object.matrixWorld).invert().multiply(m.matrixWorld);
    for (let i = 0; i < 8; i++) {
      a.set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z).applyMatrix4(local);
      far = Math.max(far, a.length() * grow);
    }
  });
  return far < 0 ? undefined : pivot.y + far;
}

export interface Overhang {
  x: number;
  z: number;
  r: number;
  /** World y of the highest point it covers. */
  top: number;
}

/**
 * Parts of a model that stick out of the given circle colliders at a height Lumi can fly at: a canopy,
 * a tunnel, a flag cloth. A vertex is covered when it is below a collider's top and within `margin`
 * (what the body has to spare) of its edge. The rest are grouped in `cell`-metre squares, each given a
 * circle round its points. Returns nothing when the colliders already cover the model.
 */
export function overhangs(
  object: THREE.Object3D,
  covered: readonly { x: number; z: number; r: number; h?: number }[],
  ground: (x: number, z: number) => number,
  margin: number,
  minHeight = 1.2,
  cell = 1.5,
): Overhang[] {
  object.updateWorldMatrix(true, true);
  const groups = new Map<string, { x0: number; x1: number; z0: number; z1: number; top: number }>();
  const p = new THREE.Vector3();
  object.traverse((child) => {
    const m = child as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;
    for (let q: THREE.Object3D | null = m; q; q = q.parent) if (!q.visible) return;
    const position = (m.geometry as THREE.BufferGeometry).getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(m.matrixWorld);
      if (p.y < ground(p.x, p.z) + minHeight) continue;
      let safe = false;
      for (const c of covered) {
        if (c.r <= 0 || ground(c.x, c.z) + (c.h ?? TALL) < p.y) continue;
        if (Math.hypot(p.x - c.x, p.z - c.z) - c.r <= margin) {
          safe = true;
          break;
        }
      }
      if (safe) continue;
      const key = Math.floor(p.x / cell) + ',' + Math.floor(p.z / cell);
      const g = groups.get(key);
      if (g) {
        g.x0 = Math.min(g.x0, p.x);
        g.x1 = Math.max(g.x1, p.x);
        g.z0 = Math.min(g.z0, p.z);
        g.z1 = Math.max(g.z1, p.z);
        g.top = Math.max(g.top, p.y);
      } else groups.set(key, { x0: p.x, x1: p.x, z0: p.z, z1: p.z, top: p.y });
    }
  });
  return [...groups.values()].map((g) => ({ x: (g.x0 + g.x1) / 2, z: (g.z0 + g.z1) / 2, r: Math.max(0.2, Math.hypot(g.x1 - g.x0, g.z1 - g.z0) / 2), top: g.top }));
}

/** A collider's `h`: the model's top above the ground at the collider's middle, or undefined (then the collider stays tall). */
export function colliderHeight(top: number | undefined, ground: number): number | undefined {
  if (top === undefined || !Number.isFinite(top)) return undefined;
  return Math.max(MIN_COLLIDER_HEIGHT, top - ground);
}
