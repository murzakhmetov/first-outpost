/**
 * The landscape beyond the outpost: layered buttes on the Mars skyline, and the
 * things a cadet can discover on a walk (see sim/finds.ts). The models come from
 * scenery.glb (scripts/models/scenery.py).
 */
import * as THREE from 'three';
import { FINDS } from '../sim/finds';
import { mulberry32 } from '../sim/rng';
import type { SiteId } from '../sim/types';
import type { Collider } from './base';
import { disposeTree } from './build';
import { toon } from './materials';
import { modelGeometry, modelPart } from './models';
import { SCARP } from './terrain';

/**
 * Where the buttes stand: [piece, x, z, size, turn]. The first is inside the walking
 * area; the others stand on the skyline, where the haze turns them pale.
 */
const BUTTES: [string, number, number, number, number][] = [
  ['butte_a', -72, 68, 0.65, 0.4], // about 15 m tall, like the real Murray Buttes
  ['butte_c', 122, 98, 1.25, 2.1],
  ['butte_b', -168, 118, 1.5, 0.9],
  ['butte_b', 152, -112, 1.2, 2.0],
  ['butte_a', 42, -192, 1.8, 1.2],
  ['butte_c', -192, -72, 1.5, 3.0],
  ['butte_a', 216, 22, 1.4, 5.1],
  ['butte_c', -42, 236, 1.6, 4.2],
];

/** The model that lies at each discovery, and how big to show it. Others are part of the land itself. */
const FIND_MODELS: Record<string, { piece: string; size: number; radius: number }> = {
  sulfur: { piece: 'find_sulfur', size: 1.5, radius: 0.75 },
  meteorite: { piece: 'find_meteorite', size: 1.7, radius: 0.8 },
  stream_pebbles: { piece: 'find_pebbles', size: 1.35, radius: 1.1 },
  orange_soil: { piece: 'find_beads', size: 1.5, radius: 0 },
  genesis_rock: { piece: 'find_white', size: 1.5, radius: 0.85 },
};

/** The small crater whose bright, fresh rocks are a discovery on the Moon. */
const FRESH_CRATER = { x: -64, z: -34, r: 5 };

export class Scenery {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];

  constructor(
    private readonly site: SiteId,
    private readonly height: (x: number, z: number) => number,
  ) {
    this.group.name = 'scenery';
    if (site === 'mars') this.buildButtes();
    else this.buildMoonRocks();
    this.buildFinds();
  }

  private buildButtes(): void {
    const rock = toon({ color: '#ffffff', rim: 0.22, bandSoft: 0.06, vertexColors: true });
    BUTTES.forEach(([piece, x, z, size, turn], index) => {
      const butte = modelPart('scenery', piece, () => rock);
      // Stand on the lowest ground under the foot, so no side hangs in the air.
      let ground = this.height(x, z);
      const reach = 14 * size;
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        ground = Math.min(ground, this.height(x + Math.cos(angle) * reach, z + Math.sin(angle) * reach));
      }
      butte.position.set(x, ground - 0.2, z);
      butte.rotation.y = turn;
      butte.scale.setScalar(size);
      butte.traverse((child) => {
        child.userData.noOutline = true;
        // Set after modelPart, which turns shadows on meshes off. Ledges shade the layers under them.
        (child as THREE.Mesh).receiveShadow = true;
      });
      this.group.add(butte);
      // Only the near one can be reached: the cadet stops at the foot of its slope.
      // The foot of its slope of fallen rock reaches about 16 m (at size 1) from the middle.
      if (index === 0) this.colliders.push({ x, z, r: 16 * size });
    });
  }

  /** Moon: boulders along the foot of the fault scarp, and bright fresh rocks around the young crater. */
  private buildMoonRocks(): void {
    const random = mulberry32(5150);
    const shapes = ['rock_a', 'rock_b', 'rock_c', 'rock_d'].map((piece) => modelGeometry('props', piece));
    const material = toon({ color: '#ffffff', rim: 0.26, bandSoft: 0.05, vertexColors: true });
    const places: { x: number; z: number; size: number; color: string }[] = [];

    const dx = SCARP.bx - SCARP.ax;
    const dz = SCARP.bz - SCARP.az;
    const length = Math.hypot(dx, dz);
    for (let i = 0; i < 22; i++) {
      const along = 0.12 + random() * 0.76;
      const across = -3.5 + random() * 5;
      const x = SCARP.ax + dx * along + (-dz / length) * across;
      const z = SCARP.az + dz * along + (dx / length) * across;
      const size = random() < 0.75 ? 0.3 + random() * 0.5 : 0.9 + random() * 0.9;
      places.push({ x, z, size, color: random() < 0.5 ? '#8a8d96' : '#6c6f78' });
    }
    for (let i = 0; i < 26; i++) {
      // Rays of thrown-out rock: denser near the rim.
      const angle = random() * Math.PI * 2;
      const distance = FRESH_CRATER.r * (1.05 + random() ** 1.6 * 1.9);
      places.push({
        x: FRESH_CRATER.x + Math.cos(angle) * distance,
        z: FRESH_CRATER.z + Math.sin(angle) * distance,
        size: 0.14 + random() * 0.34,
        color: random() < 0.7 ? '#eef0f6' : '#d5d8e0',
      });
    }

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const color = new THREE.Color();
    shapes.forEach((geometry, shapeIndex) => {
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox!;
      const halfX = (bounds.max.x - bounds.min.x) / 2;
      const halfZ = (bounds.max.z - bounds.min.z) / 2;
      const mine = places.filter((_, index) => index % shapes.length === shapeIndex);
      const mesh = new THREE.InstancedMesh(geometry, material, mine.length);
      mine.forEach((place, index) => {
        position.set(place.x, this.height(place.x, place.z) - place.size * 0.12, place.z);
        euler.set((random() - 0.5) * 0.3, random() * Math.PI * 2, (random() - 0.5) * 0.3);
        quaternion.setFromEuler(euler);
        scale.setScalar(place.size * 1.7).multiply(this.tmpScale.set(0.85 + random() * 0.4, 0.8 + random() * 0.5, 0.85 + random() * 0.4));
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
        mesh.setColorAt(index, color.set(place.color));
        const reach = ((halfX * scale.x + halfZ * scale.z) / 2) * 0.92;
        if (reach >= 0.5) this.colliders.push({ x: place.x, z: place.z, r: reach });
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
    });
  }

  private readonly tmpScale = new THREE.Vector3();

  private buildFinds(): void {
    const mars = this.site === 'mars';
    const paint = toon({ color: '#ffffff', rim: 0.34, vertexColors: true });
    // Each special material is named in the Blender file.
    const special: Record<string, THREE.Material> = {
      crystal: toon({ color: '#ffd93b', emissive: '#8a6a00', emissiveIntensity: 0.7, spec: 1.6, rim: 0.9, flatShading: true }),
      iron: toon({ color: '#5a5f76', spec: 2, rim: 0.9, rimWidth: 0.5, vertexColors: true }),
      bead: toon({ color: '#ff8a2a', emissive: '#7a2c00', emissiveIntensity: 0.55, spec: 1.8, rim: 0.7 }),
      bead_dark: toon({ color: '#3a221c', spec: 1.8, rim: 0.6 }),
      white: toon({ color: '#f6f7fb', emissive: '#565c68', emissiveIntensity: 0.4, spec: 1.4, rim: 0.8, flatShading: true }),
    };
    FINDS[this.site].forEach((find, index) => {
      const shown = FIND_MODELS[find.id];
      if (!shown) return;
      const model = modelPart('scenery', shown.piece, (name) => special[name] ?? paint);
      model.traverse((child) => {
        (child as THREE.Mesh).receiveShadow = true;
      });
      model.position.set(find.x, this.height(find.x, find.z) + (mars ? 0 : 0.01), find.z);
      model.rotation.y = index * 1.7 + 0.6;
      model.scale.setScalar(shown.size);
      this.group.add(model);
      if (shown.radius > 0) this.colliders.push({ x: find.x, z: find.z, r: shown.radius });
    });
  }

  dispose(): void {
    disposeTree(this.group);
  }
}
