/**
 * Tiny modelling kit for the small things still made in code: lamps, markers,
 * the flag pole, the shield wall, soft ground shadows. Buildings and characters
 * are Blender models (see models.ts). Shapes are merged so a group of them
 * needs only a handful of draw calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type Geo = THREE.BufferGeometry;
type V3 = [number, number, number];

export interface Xf {
  /** Position. */
  p?: V3;
  /** Rotation in radians, applied in X, Y, Z order. */
  r?: V3;
  /** Scale: one number or per axis. */
  s?: number | V3;
  /** Rotation order. Use 'YXZ' to tilt a part first and then turn it around the vertical axis. */
  o?: THREE.EulerOrder;
}

const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const euler = new THREE.Euler();
const scale = new THREE.Vector3();
const position = new THREE.Vector3();

export function xfMatrix(xf: Xf, out = matrix): THREE.Matrix4 {
  const p = xf.p ?? [0, 0, 0];
  const r = xf.r ?? [0, 0, 0];
  const s = xf.s ?? 1;
  position.set(p[0], p[1], p[2]);
  euler.set(r[0], r[1], r[2], xf.o ?? 'XYZ');
  quaternion.setFromEuler(euler);
  if (typeof s === 'number') scale.set(s, s, s);
  else scale.set(s[0], s[1], s[2]);
  return out.compose(position, quaternion, scale);
}

/** Geometry shortcuts. All sizes in metres. */
export const shape = {
  cyl: (rTop: number, rBottom: number, h: number, seg = 20, open = false): Geo =>
    new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open),
  sphere: (r: number, seg = 20): Geo => new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.7))),
  torus: (R: number, r: number, seg = 32, tube = 8, arc = Math.PI * 2): Geo => new THREE.TorusGeometry(R, r, tube, seg, arc),
  /** Flat disc lying on the ground. */
  disc: (r: number, seg = 32): Geo => new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2),
  ico: (r: number, detail = 1): Geo => new THREE.IcosahedronGeometry(r, detail),
  /** Pipe along a smooth path. */
  tube: (points: V3[], r: number, seg = 24, radial = 6): Geo =>
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), seg, r, radial, false),
  /** A curved wall block: part of a thick ring. Angles in radians, measured from +X toward +Z. */
  arc: (rInner: number, rOuter: number, height: number, from: number, to: number, seg = 24): Geo => {
    const outline = new THREE.Shape();
    outline.absarc(0, 0, rOuter, from, to, false);
    outline.absarc(0, 0, rInner, to, from, true);
    outline.closePath();
    const geometry = new THREE.ExtrudeGeometry(outline, { depth: height, bevelEnabled: false, curveSegments: seg });
    // Extrusion runs along +Z; stand it up so height runs along +Y.
    return geometry.rotateX(Math.PI / 2).translate(0, height, 0);
  },
};

/** Collects shapes by material and merges them into one mesh per material. */
export class Kit {
  private readonly parts = new Map<THREE.Material, Geo[]>();

  add(material: THREE.Material, geometry: Geo, xf?: Xf): this {
    let geo = geometry.index ? geometry.toNonIndexed() : geometry;
    if (geo !== geometry) geometry.dispose();
    if (!geo.attributes.uv) {
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    // Keep only the attributes every shape has, so shapes can be merged.
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    geo.clearGroups();
    if (xf) geo.applyMatrix4(xfMatrix(xf));
    let list = this.parts.get(material);
    if (!list) {
      list = [];
      this.parts.set(material, list);
    }
    list.push(geo);
    return this;
  }

  /** Add the same shape at several places. */
  addMany(material: THREE.Material, make: () => Geo, places: Xf[]): this {
    for (const place of places) this.add(material, make(), place);
    return this;
  }

  build(options: { cast?: boolean; receive?: boolean; name?: string } = {}): THREE.Group {
    const group = new THREE.Group();
    if (options.name) group.name = options.name;
    for (const [material, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      for (const geo of list) geo.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      const seeThrough = material.transparent;
      mesh.castShadow = (options.cast ?? true) && !seeThrough;
      mesh.receiveShadow = (options.receive ?? true) && !seeThrough;
      if (seeThrough) mesh.renderOrder = 5;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

/** Free every geometry under an object (materials are shared and freed elsewhere). */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    // Geometry of loaded models is shared between scenes and stays in memory.
    if ((mesh.isMesh || (child as THREE.Points).isPoints) && !mesh.userData.isOutline && !mesh.geometry?.userData.shared) {
      mesh.geometry?.dispose();
    }
  });
}
