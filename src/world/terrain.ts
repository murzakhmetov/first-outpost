/**
 * The ground: a height function per world, a mesh built from it,
 * and a ring of distant mountains.
 */
import * as THREE from 'three';
import type { SiteId } from '../sim/types';
import { ground } from './materials';
import { Noise2D, clamp01, lerp, smoothstep } from './noise';
import { flag } from './devflags';
import { mulberry32 } from '../sim/rng';

/** Flat building ground around the centre of the outpost, metres. */
export const BASE_RADIUS = 44;
/** The paved plaza in front of the airlock: a low round platform. */
export const PLAZA = { x: 0, z: 0.7, r: 4.1, h: 0.16 };

/** Height of the plaza at a point: full on top, then a short slope at its rim. */
export function plazaLift(x: number, z: number): number {
  const d = Math.hypot(x - PLAZA.x, z - PLAZA.z);
  if (d <= PLAZA.r) return PLAZA.h;
  if (d >= PLAZA.r + 0.3) return 0;
  return PLAZA.h * (1 - (d - PLAZA.r) / 0.3);
}

/** How far the player may walk from the centre, metres. */
export const WALK_RADIUS = 118;
const TERRAIN_SIZE = 1500;

interface Crater {
  x: number;
  z: number;
  r: number;
  depth: number;
}

export interface TerrainInfo {
  /** Ground height at a point, metres. */
  height(x: number, z: number): number;
  /** The permanently shadowed crater with ice (Moon only). */
  iceCrater: Crater | null;
}

const MOON_CRATERS: Crater[] = [
  { x: 96, z: 34, r: 34, depth: 11 }, // the dark, icy one
  { x: -78, z: -92, r: 22, depth: 6 },
  { x: -105, z: 48, r: 15, depth: 4 },
  { x: 40, z: -104, r: 12, depth: 3.5 },
  { x: 70, z: 100, r: 18, depth: 5 },
  { x: -52, z: 78, r: 8, depth: 2.2 },
  { x: 118, z: -62, r: 26, depth: 7 },
  { x: -150, z: -10, r: 30, depth: 8 },
  { x: 10, z: 150, r: 24, depth: 6 },
  { x: -64, z: -34, r: 5, depth: 1.4 },
  { x: 58, z: -48, r: 6, depth: 1.6 },
  { x: -30, z: 62, r: 4.5, depth: 1.2 },
];

/**
 * A fault scarp on the Moon: a long step in the ground where the crust broke as the
 * Moon cooled and shrank. The far side stands a few metres higher than the near side.
 */
export const SCARP = { ax: -104, az: 66, bx: -34, bz: 108, height: 4.2 };

function scarpHeight(x: number, z: number): number {
  const dx = SCARP.bx - SCARP.ax;
  const dz = SCARP.bz - SCARP.az;
  const length = Math.hypot(dx, dz);
  const tx = dx / length;
  const tz = dz / length;
  // "Across" grows away from the outpost.
  const along = ((x - SCARP.ax) * tx + (z - SCARP.az) * tz) / length;
  const across = (x - SCARP.ax) * -tz + (z - SCARP.az) * tx;
  if (across < -6 || across > 72 || along < -0.1 || along > 1.1) return 0;
  const ends = smoothstep(-0.08, 0.22, along) * (1 - smoothstep(0.78, 1.08, along));
  return SCARP.height * smoothstep(-5, 5, across) * (1 - smoothstep(26, 70, across)) * ends;
}

function craterHeight(crater: Crater, x: number, z: number): number {
  const d = Math.hypot(x - crater.x, z - crater.z) / crater.r;
  if (d > 1.8) return 0;
  const bowl = d < 1 ? -crater.depth * (1 - d * d) ** 1.4 : 0;
  const rim = crater.depth * 0.28 * Math.exp(-(((d - 1) / 0.22) ** 2));
  return bowl + rim;
}

export function makeHeightFunction(site: SiteId): TerrainInfo {
  const noise = new Noise2D(site === 'mars' ? 4201 : 1969);

  const height = (x: number, z: number): number => {
    const dist = Math.hypot(x, z);
    // Building ground is flat; the wild ground fades in around it.
    const wild = smoothstep(BASE_RADIUS, BASE_RADIUS + 34, dist);
    let h = 0;

    if (site === 'mars') {
      h += noise.fbm(x * 0.006, z * 0.006, 4) * 9;
      // Dunes marching across the plain.
      const dune = noise.ridged(x * 0.012 + z * 0.004, z * 0.02, 2);
      h += dune * 2.6 * smoothstep(55, 120, dist);
      // A low mesa to the south-west and a rise to the north.
      h += 14 * smoothstep(60, 20, Math.hypot(x + 150, z - 120)) * (0.7 + 0.3 * noise.get(x * 0.03, z * 0.03));
      h += 9 * smoothstep(210, 120, Math.hypot(x - 40, z + 260));
      h += noise.get(x * 0.07, z * 0.07) * 0.35;
    } else {
      h += noise.fbm(x * 0.007, z * 0.007, 4) * 7;
      h += noise.get(x * 0.05, z * 0.05) * 0.4;
      for (const crater of MOON_CRATERS) h += craterHeight(crater, x, z);
      h += scarpHeight(x, z);
    }

    h *= wild;
    if (dist < 12) h += plazaLift(x, z);
    // The ground curves away so the horizon is close, as on a small world.
    const far = Math.max(0, dist - 170);
    h -= (far * far) / 5200;
    return h;
  };

  return { height, iceCrater: site === 'moon' ? MOON_CRATERS[0] : null };
}

/** A soft path worn into the ground between two points: returns 0-1 closeness. */
function pathMask(x: number, z: number, paths: [number, number, number, number][]): number {
  let best = 0;
  for (const [ax, az, bx, bz] of paths) {
    const dx = bx - ax;
    const dz = bz - az;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    best = Math.max(best, 1 - smoothstep(0.9, 2.3, d));
  }
  return best;
}


/** Seed for the colour-only ground detail (own stream: nothing else draws from it). */
const DETAIL_SEED = 60731;
const ICE = new THREE.Color('#1a2233');

interface Stain {
  x: number;
  z: number;
  /** Half length along the wind and half width across it, metres. */
  along: number;
  across: number;
  /** -1 darker dust patch, +1 lighter drift. */
  sign: number;
}

/** About eight wide, soft stains on Mars, long axis along the ripple wind (0.82, 0.57). */
function marsStains(): Stain[] {
  const random = mulberry32(DETAIL_SEED);
  const list: Stain[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = random() * Math.PI * 2;
    const dist = 38 + random() * 130;
    const sign = i % 2 === 0 ? -1 : 1;
    const across = 16 + random() * 22;
    list.push({ x: Math.cos(angle) * dist, z: Math.sin(angle) * dist, along: across * (sign < 0 ? 1.6 : 3.2), across, sign });
  }
  return list;
}

/** Angular ray pattern for the freshest Moon craters, 0-1. */
function rayPattern(noise: Noise2D, angle: number, seed: number): number {
  const n = noise.get(Math.cos(angle) * 3.2 + seed, Math.sin(angle) * 3.2 - seed) * 0.5 + 0.5;
  const fine = noise.get(Math.cos(angle) * 9 - seed, Math.sin(angle) * 9 + seed) * 0.5 + 0.5;
  return smoothstep(0.55, 0.8, n * 0.7 + fine * 0.3);
}

/**
 * Colour-only detail on top of the plain ground colour: crater bowls, bright rims and rays on the
 * Moon, soft wide stains on Mars. It never touches the height function.
 */
function groundDetailColor(
  mars: boolean,
  noise: Noise2D,
  stains: Stain[],
  freshest: Set<Crater>,
  x: number,
  z: number,
  color: THREE.Color,
  high: THREE.Color,
  dark: THREE.Color,
): void {
  if (mars) {
    const wx = 0.82;
    const wz = 0.57;
    for (const s of stains) {
      const dx = x - s.x;
      const dz = z - s.z;
      const a = (dx * wx + dz * wz) / s.along;
      const b = (-dx * wz + dz * wx) / s.across;
      const w = Math.exp(-(a * a + b * b) * 1.4);
      if (w < 0.01) continue;
      color.lerp(s.sign < 0 ? dark : high, w * 0.3);
    }
    return;
  }
  for (const crater of MOON_CRATERS) {
    const dx = x - crater.x;
    const dz = z - crater.z;
    const d = Math.hypot(dx, dz) / crater.r;
    if (d > 3.4) continue;
    if (d < 1) {
      color.multiplyScalar(1 - 0.3 * (1 - smoothstep(0.25, 1, d)));
    } else {
      const rim = Math.exp(-(((d - 1.05) / 0.16) ** 2));
      color.lerp(high, rim * 0.65);
      if (freshest.has(crater) && d < 3.2) {
        const ray = rayPattern(noise, Math.atan2(dz, dx), crater.r);
        const fade = smoothstep(1.05, 1.4, d) * (1 - smoothstep(1.8, 3.2, d));
        color.lerp(high, ray * fade * 0.95);
      }
    }
  }
}

export interface TerrainBuild {
  mesh: THREE.Mesh;
  mountains: THREE.Group;
  info: TerrainInfo;
  dispose(): void;
}

export function buildTerrain(
  site: SiteId,
  segments: number,
  paths: [number, number, number, number][],
  groundDetail = false,
): TerrainBuild {
  const info = makeHeightFunction(site);
  const noise = new Noise2D(site === 'mars' ? 77 : 78);
  const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const detailColors = groundDetail ? new Float32Array(position.count * 3) : null;
  const detailNoise = groundDetail ? new Noise2D(DETAIL_SEED) : null;
  const stains = groundDetail && site === 'mars' ? marsStains() : [];
  const freshest = new Set<Crater>(groundDetail && site === 'moon' ? [...MOON_CRATERS].sort((a, b) => a.r - b.r).slice(0, 3) : []);

  const mars = site === 'mars';
  const palette = mars
    ? {
        low: new THREE.Color('#8a4a36'),
        mid: new THREE.Color('#bf7a50'),
        high: new THREE.Color('#e6b486'),
        dark: new THREE.Color('#5f3626'),
        path: new THREE.Color('#a85c36'),
        pad: new THREE.Color('#b96e42'),
      }
    : {
        low: new THREE.Color('#6d7078'),
        mid: new THREE.Color('#9a9da6'),
        high: new THREE.Color('#c9ccd3'),
        dark: new THREE.Color('#33363f'),
        path: new THREE.Color('#7a7d86'),
        pad: new THREE.Color('#a6a9b1'),
      };

  const color = new THREE.Color();
  const half = TERRAIN_SIZE / 2;
  for (let i = 0; i < position.count; i++) {
    // Squeeze the grid toward the centre: fine detail near the outpost, coarse far away.
    const u = position.getX(i) / half;
    const v = position.getZ(i) / half;
    const x = Math.sign(u) * Math.abs(u) ** 1.9 * half;
    const z = Math.sign(v) * Math.abs(v) ** 1.9 * half;
    const y = info.height(x, z);
    position.setXYZ(i, x, y, z);

    const dist = Math.hypot(x, z);
    const patch = noise.fbm(x * 0.02, z * 0.02, 3) * 0.5 + 0.5;
    const fine = noise.get(x * 0.35, z * 0.35) * 0.5 + 0.5;
    color.copy(palette.low).lerp(palette.mid, smoothstep(0.25, 0.7, patch));
    color.lerp(palette.high, smoothstep(0.62, 0.95, patch) * 0.8);
    color.lerp(palette.dark, smoothstep(0.7, 1, fine) * 0.22);
    const finish = (target: Float32Array) => {
      if (dist < BASE_RADIUS + 20) {
        color.lerp(palette.pad, (1 - smoothstep(BASE_RADIUS - 6, BASE_RADIUS + 20, dist)) * 0.5);
        color.lerp(palette.path, pathMask(x, z, paths) * 0.75);
      }
      if (info.iceCrater) {
        // The deep crater never sees the Sun: very dark, with a blue hint of ice.
        const c = info.iceCrater;
        const inside = 1 - smoothstep(0.55, 1.0, Math.hypot(x - c.x, z - c.z) / c.r);
        color.lerp(ICE, inside * 0.82);
      }
      target[i * 3] = color.r;
      target[i * 3 + 1] = color.g;
      target[i * 3 + 2] = color.b;
    };
    if (detailColors && detailNoise) {
      const base = color.clone();
      groundDetailColor(mars, detailNoise, stains, freshest, x, z, color, palette.high, palette.dark);
      finish(detailColors);
      color.copy(base);
    }
    finish(colors);
  }
  const colorAttr = new THREE.BufferAttribute(detailColors ? detailColors.slice() : colors, 3);
  geometry.setAttribute('color', colorAttr);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = ground({
    ...(mars
      ? { speck: '#56322a', light: '#f3c892', bandEdge: 0.02, bandSoft: 0.16, ripples: true }
      : { speck: '#34373f', light: '#e6e8ee', bandEdge: 0.075, bandSoft: 0.06, ripples: false }),
    relief: groundDetail,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  if (detailColors) {
    // Dev A/B: both colour sets are baked once; the dev flag only picks which copy is on the GPU.
    let showing = true;
    mesh.onBeforeRender = () => {
      const want = flag('G4');
      if (want === showing) return;
      showing = want;
      (colorAttr.array as Float32Array).set(want ? detailColors : colors);
      colorAttr.needsUpdate = true;
    };
  }

  const mountains = buildMountains(site);
  return {
    mesh,
    mountains,
    info,
    dispose() {
      geometry.dispose();
      mountains.traverse((child) => {
        const m = child as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
    },
  };
}

/**
 * Far mountains as layered silhouettes. Each layer is a ring of triangles whose
 * top edge follows a noise curve. Vertex colours fade toward the bottom so the
 * layers melt into the haze.
 */
function buildMountains(site: SiteId): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mountains';
  const noise = new Noise2D(site === 'mars' ? 311 : 312);
  const mars = site === 'mars';
  // Heights are chosen so the ranges sit low on the horizon (about 5-12 degrees up),
  // the way far mountains really look. Each has one bigger peak as a landmark.
  const layers = mars
    ? [
        { radius: 620, base: -70, height: 95, color: '#a0603f', top: '#d8905a', rough: 1.5, peak: { at: 2.45, width: 0.5, add: 115 } },
        { radius: 780, base: -95, height: 125, color: '#b97a55', top: '#e2a674', rough: 1.1, peak: { at: 2.75, width: 0.75, add: 170 } },
        { radius: 940, base: -120, height: 150, color: '#c9936f', top: '#eab98c', rough: 0.8, peak: null },
      ]
    : [
        { radius: 560, base: -65, height: 85, color: '#70737c', top: '#d6d9df', rough: 1.6, peak: { at: 5.4, width: 0.45, add: 95 } },
        { radius: 720, base: -90, height: 115, color: '#5c5f68', top: '#c3c6cd', rough: 1.2, peak: { at: 4.2, width: 0.6, add: 150 } },
        { radius: 880, base: -115, height: 140, color: '#4b4e57', top: '#aeb1b9', rough: 0.9, peak: null },
      ];

  layers.forEach((layer, index) => {
    const steps = 300;
    const positions: number[] = [];
    const colors: number[] = [];
    const bottom = new THREE.Color(layer.color);
    const top = new THREE.Color(layer.top);
    const ridge = (angle: number): number => {
      const nx = Math.cos(angle) * layer.rough;
      const nz = Math.sin(angle) * layer.rough;
      let h = 0.45 + 0.55 * (noise.fbm(nx + index * 9.7, nz - index * 4.1, 4) * 0.5 + 0.5);
      h = h * h * layer.height;
      if (layer.peak) {
        let delta = Math.abs(angle - layer.peak.at);
        delta = Math.min(delta, Math.PI * 2 - delta);
        h += layer.peak.add * Math.exp(-((delta / layer.peak.width) ** 2)) * (0.8 + 0.2 * noise.get(nx * 3, nz * 3));
      }
      return h;
    };
    for (let i = 0; i < steps; i++) {
      const a0 = (i / steps) * Math.PI * 2;
      const a1 = ((i + 1) / steps) * Math.PI * 2;
      const h0 = ridge(a0);
      const h1 = ridge(a1);
      const x0 = Math.cos(a0) * layer.radius;
      const z0 = Math.sin(a0) * layer.radius;
      const x1 = Math.cos(a1) * layer.radius;
      const z1 = Math.sin(a1) * layer.radius;
      // Two triangles facing the centre.
      positions.push(x0, layer.base, z0, x1, layer.base, z1, x1, layer.base + h1, z1);
      positions.push(x0, layer.base, z0, x1, layer.base + h1, z1, x0, layer.base + h0, z0);
      const shade0 = lerp(0.82, 1.1, noise.get(a0 * 9, index) * 0.5 + 0.5);
      const shade1 = lerp(0.82, 1.1, noise.get(a1 * 9, index) * 0.5 + 0.5);
      const push = (c: THREE.Color, shade: number) => colors.push(c.r * shade, c.g * shade, c.b * shade);
      push(bottom, 1);
      push(bottom, 1);
      push(top, shade1);
      push(bottom, 1);
      push(top, shade1);
      push(top, shade0);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: mars });
    material.userData.mountain = true;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -50 + index * -1;
    group.add(mesh);
  });
  return group;
}
