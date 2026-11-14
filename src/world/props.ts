/**
 * Everything around the buildings: rocks, the lander, the rover, the flag,
 * path lamps, crates and soft ground shadows.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FINDS } from '../sim/finds';
import { mulberry32 } from '../sim/rng';
import type { SiteId } from '../sim/types';
import { BATTERY, FARM, HAB, LAB, PATHS, SOLAR } from './base';
import type { Collider } from './base';
import { Kit, disposeTree, shape } from './build';
import { GLOBALS, canvasTexture, glass, glow, lamp, toon } from './materials';
import { model, modelGeometry, modelPart } from './models';
import { ROVER, ROVER_HEADING } from './rover';
import { dotTexture, padTexture } from './textures';
import { BASE_RADIUS, PLAZA } from './terrain';

export const LANDER = { x: 31, z: 21 };
export { ROVER, ROVER_HEADING };
export const FLAG = { x: -5.6, z: 4.4 };

const always = { value: 1 };

let bannerTexture: THREE.CanvasTexture | null = null;

export class Props {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  /** The rover model, parked by the plaza. The world hands it to the Rover that drives it. */
  rover!: THREE.Object3D;
  /** The lander, and the engine flame under it (shown while it comes down in the intro film). */
  lander!: THREE.Object3D;
  landerFlame!: THREE.Object3D;
  /** The circles that stop the cadet from walking through the rover (they move with it). */
  readonly roverColliders: Collider[] = [];
  private readonly own: THREE.Material[] = [];
  private flag: THREE.Mesh | null = null;
  private readonly site: SiteId;

  constructor(site: SiteId, height: (x: number, z: number) => number, rockFactor: number, softShadows: boolean) {
    this.site = site;
    this.group.name = 'props';
    this.buildBlobs(softShadows);
    this.buildRocks(height, rockFactor);
    this.buildPathLights();
    this.buildLander();
    this.buildRover();
    this.buildFlag();
    this.buildCrates();
  }

  private keep<T extends THREE.Material>(material: T): T {
    this.own.push(material);
    return material;
  }

  /** Soft dark patches under buildings. They ground the buildings even when real shadows are off. */
  private buildBlobs(realShadows: boolean): void {
    const spots: [number, number, number, number][] = [
      [HAB.x, HAB.z, 9.5, 9.5],
      [HAB.x, HAB.z + 8.5, 3.4, 4],
      [FARM.x, FARM.z, 6.6, 9.4],
      [LAB.x, LAB.z, 4.6, 8.4],
      [BATTERY.x, BATTERY.z, 3.4, 3.4],
      [LANDER.x, LANDER.z, 5.5, 5.5],
      [ROVER.x, ROVER.z, 3.2, 2.6],
    ];
    if (this.site === 'mars') {
      for (const x of [-21, -15, -9]) for (const z of [17.5, 23.5]) spots.push([x, z, 2.5, 1.9]);
    } else {
      for (const x of [-21, -15, -9]) spots.push([x, 20, 1.6, 1.6]);
    }
    const parts = spots.map(([x, z, rx, rz]) => {
      const geometry = new THREE.PlaneGeometry(rx * 2, rz * 2);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(x, 0.045, z);
      return geometry;
    });
    const merged = mergeGeometries(parts, false)!;
    for (const part of parts) part.dispose();
    const material = this.keep(
      new THREE.MeshBasicMaterial({
        color: 0x1a1024,
        map: dotTexture(),
        transparent: true,
        opacity: realShadows ? 0.3 : 0.5,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    const mesh = new THREE.Mesh(merged, material);
    mesh.renderOrder = 2;
    this.group.add(mesh);
  }

  private buildRocks(height: (x: number, z: number) => number, factor: number): void {
    const random = mulberry32(this.site === 'mars' ? 8801 : 8802);
    const mars = this.site === 'mars';
    const palette = mars ? ['#7a4634', '#99583a', '#5c3a34', '#b0704a'] : ['#7d808a', '#9a9da6', '#5d6069', '#b4b7bf'];

    // Four rock shapes made in Blender, shared by all rocks. Each copy gets its own tint.
    const shapes = ['rock_a', 'rock_b', 'rock_c', 'rock_d'].map((piece) => modelGeometry('props', piece));

    const total = Math.round(330 * factor);
    const perShape = Math.ceil(total / shapes.length);
    const material = toon({ color: '#ffffff', rim: 0.26, bandSoft: 0.05, vertexColors: true });
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const color = new THREE.Color();

    const blocked = (x: number, z: number, margin: number): boolean => {
      if (Math.hypot(x - LANDER.x, z - LANDER.z) < 9 + margin) return true;
      for (const [ax, az, bx, bz] of PATHS) {
        const dx = bx - ax;
        const dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < 2.6 + margin) return true;
      }
      return false;
    };

    // Rocks stop the cadet by their real size, from about knee height up. Smaller ones are walked over.
    const finds = [...FINDS.mars, ...FINDS.moon];
    shapes.forEach((geometry) => {
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox!;
      const halfX = (bounds.max.x - bounds.min.x) / 2;
      const halfZ = (bounds.max.z - bounds.min.z) / 2;
      const mesh = new THREE.InstancedMesh(geometry, material, perShape);
      let placed = 0;
      let guard = perShape * 12;
      while (placed < perShape && guard-- > 0) {
        // More rocks near the outpost (where players look), fewer far away.
        const radius = BASE_RADIUS - 14 + (random() ** 1.6) * 240;
        const angle = random() * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const roll = random();
        const size = roll < 0.7 ? 0.14 + random() * 0.4 : roll < 0.95 ? 0.6 + random() * 0.8 : 1.6 + random() * 1.8;
        const inBase = radius < BASE_RADIUS;
        if (inBase && (size > 0.45 || Math.hypot(x, z) < 12)) continue;
        if (blocked(x, z, size)) continue;
        if (Math.hypot(x - HAB.x, z - HAB.z) < 12 + size) continue;
        if (Math.hypot(x - FARM.x, z - FARM.z) < 10 + size) continue;
        if (Math.hypot(x - LAB.x, z - LAB.z) < 9 + size) continue;
        if (Math.hypot(x - SOLAR.x, z - SOLAR.z) < 12 + size) continue;
        if (Math.hypot(x - BATTERY.x, z - BATTERY.z) < 5 + size) continue;

        position.set(x, height(x, z) - size * 0.12, z); // sunk a little into the soil
        euler.set((random() - 0.5) * 0.3, random() * Math.PI * 2, (random() - 0.5) * 0.3);
        quaternion.setFromEuler(euler);
        scale.set(size * 1.7 * (0.8 + random() * 0.5), size * 1.7 * (0.75 + random() * 0.6), size * 1.7 * (0.8 + random() * 0.5));
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(placed, matrix);
        color.set(palette[Math.floor(random() * palette.length)]).multiplyScalar(0.85 + random() * 0.3);
        mesh.setColorAt(placed, color);
        const reach = ((halfX * scale.x + halfZ * scale.z) / 2) * 0.92;
        // A rock never blocks the way to a discovery, and the far ones are out of the walking area.
        const onFind = finds.some((find) => Math.hypot(find.x - x, find.z - z) < find.reach + reach + 0.5);
        if (reach >= 0.5 && radius < 125 && !onFind) this.colliders.push({ x, z, r: reach });
        placed++;
      }
      mesh.count = placed;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    });
  }

  /** Little lamps along the walkways. One batch for posts, one for bulbs. */
  private buildPathLights(): void {
    const places: [number, number][] = [];
    for (const [ax, az, bx, bz] of PATHS) {
      const length = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / length;
      const nz = (bx - ax) / length;
      const count = Math.max(2, Math.floor(length / 3.4));
      for (let i = 0; i <= count; i++) {
        const t = i / count;
        const side = i % 2 === 0 ? 1 : -1;
        const x = ax + (bx - ax) * t + nx * 1.5 * side;
        const z = az + (bz - az) * t + nz * 1.5 * side;
        // The plaza has its own crystal posts.
        if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 0.6) continue;
        places.push([x, z]);
      }
    }
    const posts = new THREE.InstancedMesh(shape.cyl(0.045, 0.06, 0.6, 6), toon({ color: '#3a4260', rim: 0.2 }), places.length);
    const bulbs = new THREE.InstancedMesh(
      shape.sphere(0.12, 8),
      this.keep(lamp('#ffe2a6', always, { day: 1.0, night: 4.2 })),
      places.length,
    );
    const matrix = new THREE.Matrix4();
    places.forEach(([x, z], index) => {
      posts.setMatrixAt(index, matrix.makeTranslation(x, 0.3, z));
      bulbs.setMatrixAt(index, matrix.makeTranslation(x, 0.66, z));
    });
    posts.instanceMatrix.needsUpdate = true;
    bulbs.instanceMatrix.needsUpdate = true;
    this.group.add(posts, bulbs);
  }

  /** Game materials for the Blender-made props. Lamps come from the caller. */
  private dress(name: 'rover' | 'lander', lamps: Record<string, THREE.Material>): THREE.Object3D {
    const paint = toon({ color: '#ffffff', rim: 0.42, vertexColors: true });
    const gold = toon({ color: '#e6ad42', rim: 0.7, spec: 1.3, vertexColors: true });
    const window = toon({ color: '#1d2a52', rim: 0.7, rimWidth: 0.55, spec: 1.6, vertexColors: true });
    const prop = model(name, (material, mesh) => {
      mesh.receiveShadow = true;
      switch (material) {
        case 'paint':
          return paint;
        case 'gold':
          return gold;
        case 'window':
          return window;
        case 'glass':
          mesh.renderOrder = 5;
          mesh.receiveShadow = false;
          return this.keep(glass('#ffe6bf', { opacity: 0.1, edge: 0.5 }));
        case 'glow_red':
          return this.keep(glow('#ff5a5a', 2.6));
        case 'glow_green':
          return this.keep(glow('#5fff9a', 2.6));
        case 'glow_cyan':
          return this.keep(glow('#5fe0ff', 2.2));
        default:
          return lamps[material] ?? paint;
      }
    });
    prop.name = name;
    return prop;
  }

  private buildLander(): void {
    // The painted landing pad stays a flat disc; the lander itself is a Blender model.
    const pad = new THREE.Mesh(shape.disc(7.4, 48), toon({ color: '#ffffff', map: padTexture(), rim: 0, bandSoft: 0.3 }));
    pad.position.set(LANDER.x, 0.04, LANDER.z);
    pad.receiveShadow = true;
    this.group.add(pad);
    const lander = this.dress('lander', { lamp_hatch: this.keep(lamp('#ffd9a0', always, { day: 1.1, night: 3.4 })) });
    lander.position.set(LANDER.x, 0, LANDER.z);
    lander.rotation.y = -Math.PI / 2; // the hatch faces the outpost
    this.group.add(lander);
    this.lander = lander;
    // The engine flame: a hot core inside a wider glow, pointing down from the engine bell.
    const flame = new THREE.Group();
    const outer = new THREE.Mesh(shape.cyl(0.62, 0.08, 3.6, 18, true), this.keep(glow('#ff9a3d', 2.4)));
    const inner = new THREE.Mesh(shape.cyl(0.34, 0.04, 2.6, 14, true), this.keep(glow('#fff1c2', 3.2)));
    for (const mesh of [outer, inner]) {
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.transparent = true;
      material.opacity = 0.85;
      material.depthWrite = false;
      material.blending = THREE.AdditiveBlending;
      material.side = THREE.DoubleSide;
      mesh.userData.noOutline = true;
      mesh.castShadow = false;
    }
    outer.position.y = -1.0;
    inner.position.y = -0.55;
    flame.add(outer, inner);
    flame.position.y = 0.85;
    flame.visible = false;
    lander.add(flame);
    this.landerFlame = flame;
    this.colliders.push({ x: LANDER.x, z: LANDER.z, r: 3.6 });
  }

  private buildRover(): void {
    const rover = this.dress('rover', { lamp_head: this.keep(lamp('#fff3c8', always, { day: 0.9, night: 4 })) });
    rover.position.set(ROVER.x, 0, ROVER.z);
    rover.rotation.y = ROVER_HEADING;
    this.group.add(rover);
    this.rover = rover;
    // Three circles along its length; the Rover moves them when it is driven.
    for (let i = 0; i < 3; i++) this.roverColliders.push({ x: ROVER.x, z: ROVER.z, r: 1.5 });
    this.colliders.push(...this.roverColliders);
  }

  /** Mission flag. It waves on Mars. On the Moon there is no wind, so a rod holds it out. */
  private buildFlag(): void {
    const grey = toon({ color: '#aeb6c6', rim: 0.25 });
    const pole = new Kit()
      .add(grey, shape.cyl(0.05, 0.065, 5.2, 8), { p: [0, 2.6, 0] })
      .add(grey, shape.cyl(0.028, 0.028, 1.75, 6), { p: [0.87, 5.05, 0], r: [0, 0, Math.PI / 2] })
      .add(grey, shape.sphere(0.1, 8), { p: [0, 5.25, 0] })
      .build({ name: 'flag-pole' });
    // One picture for every rebuild: a new texture each time would also make a new cached material, for good.
    bannerTexture ??= canvasTexture(256, 160, (ctx, w, h) => {
      const gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, '#1f2d6b');
      gradient.addColorStop(1, '#3b2a78');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(0, h - 26, w, 10);
      ctx.fillStyle = '#39c2f0';
      ctx.fillRect(0, h - 12, w, 12);
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const radius = i % 2 === 0 ? 44 : 12;
        const angle = (i * Math.PI) / 4 - Math.PI / 2;
        ctx.lineTo(w / 2 + Math.cos(angle) * radius, 66 + Math.sin(angle) * radius);
      }
      ctx.closePath();
      ctx.fill();
    });
    const banner = bannerTexture;
    const cloth = new THREE.PlaneGeometry(1.7, 1.08, 12, 6);
    cloth.translate(0.87, 0, 0);
    const wave = this.site === 'mars' ? 1 : 0;
    const material = toon({ color: '#ffffff', map: banner, side: THREE.DoubleSide, rim: 0.2, bandSoft: 0.3 });
    this.flag = new THREE.Mesh(cloth, material);
    this.flag.position.set(0, 4.46, 0);
    this.flag.userData.wave = wave;
    this.flag.userData.base = (cloth.attributes.position as THREE.BufferAttribute).array.slice();
    pole.add(this.flag);
    pole.position.set(FLAG.x, 0, FLAG.z);
    pole.rotation.y = -0.5;
    this.group.add(pole);
    this.colliders.push({ x: FLAG.x, z: FLAG.z, r: 0.35 });
  }

  private buildCrates(): void {
    const paint = toon({ color: '#ffffff', rim: 0.42, vertexColors: true });
    const led = this.keep(glow('#9dffc4', 2.2));
    const kinds = ['crate_a', 'crate_b', 'crate_c'];
    const crates: [number, number, number, number, number][] = [
      [6.2, -6.4, 1.1, 0.4, 0],
      [7.5, -5.7, 0.85, 1.1, 1],
      [6.8, -5.3, 0.7, 2.0, 0],
      [13.2, 4.6, 1.0, 0.2, 2],
      [14.3, 5.4, 0.8, 0.9, 2],
      [-11.6, 4.2, 0.9, 0.5, 1],
      [-12.4, 5.2, 0.7, 1.4, 1],
    ];
    for (const [x, z, size, turn, band] of crates) {
      const crate = modelPart('props', kinds[band], (name, mesh) => {
        mesh.receiveShadow = true;
        return name === 'glow_green' ? led : paint;
      });
      crate.position.set(x, 0, z);
      crate.rotation.y = turn;
      crate.scale.setScalar(size);
      this.group.add(crate);
      this.colliders.push({ x, z, r: size * 0.75 });
    }
  }

  update(time: number): void {
    const flag = this.flag;
    if (!flag || !flag.userData.wave) return;
    const position = flag.geometry.attributes.position as THREE.BufferAttribute;
    const base = flag.userData.base as Float32Array;
    for (let i = 0; i < position.count; i++) {
      const x = base[i * 3];
      const y = base[i * 3 + 1];
      // The thin Mars air moves the cloth gently; the far edge moves most.
      const sway = Math.sin(x * 3.2 - time * 2.2 + y * 1.5) * 0.09 * (x / 1.7);
      position.setZ(i, sway);
    }
    position.needsUpdate = true;
    flag.geometry.computeVertexNormals();
  }

  dispose(): void {
    disposeTree(this.group);
    for (const material of this.own) material.dispose();
  }
}

export { GLOBALS };
