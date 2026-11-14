/**
 * The outpost buildings.
 *
 * Each building shows its own state so players can read the base at a glance:
 * windows and lamps dim when a module gets less power, plants grow or wilt,
 * the regolith wall rises layer by layer, battery bars fill up.
 */
import * as THREE from 'three';
import { mulberry32 } from '../sim/rng';
import { CROP_WEEKS } from '../sim/sites';
import type { SiteId } from '../sim/types';
import { disposeTree, shape } from './build';
import type { Xf } from './build';
import { GLOBALS, fogUniforms, glass, glow, lamp, toon } from './materials';
import { model, modelPart } from './models';
import type { ModelName } from './models';
import { brickTexture, emblemTexture, plazaTexture } from './textures';
import { PLAZA } from './terrain';

export interface Collider {
  x: number;
  z: number;
  r: number;
  /** Height above the ground at its middle, metres. Lumi flies over low ones; without a height a collider counts as tall. */
  h?: number;
}

export interface Spot {
  target: THREE.Vector3;
  distance: number;
  yaw: number;
  pitch: number;
}

export type SpotId = 'overview' | 'hab' | 'farm' | 'lab' | 'solar' | 'shield' | 'sky' | 'far' | 'rover' | 'airlock';

/** What the buildings should show. All power values are 0-1. */
export interface BaseView {
  life: number;
  farm: number;
  lab: number;
  shieldPower: number;
  battery: number;
  batteryCap: number;
  /** Shield wall built, 0-1. */
  shield: number;
  /** Crop growth, 0 to CROP_WEEKS. */
  crop: number;
  cropAlive: boolean;
  /** Dust on the solar panels, 0-0.4. */
  panelDust: number;
}

export const HAB = { x: 0, z: -15 };
export const FARM = { x: -19, z: -2 };
export const LAB = { x: 19, z: -3 };
export const SOLAR = { x: -15, z: 20 };
export const BATTERY = { x: -25.5, z: 12.5 };
/** Where the crew steps outside. */
export const AIRLOCK = { x: 0, z: -3.6 };

/** Walkways between buildings, as [x1, z1, x2, z2]. Used to tint the ground and place lamps. */
export const PATHS: [number, number, number, number][] = [
  [0, -1.5, 0, -4.2],
  [-2.5, -0.6, -13.5, -1.6],
  [2.5, -0.6, 14.5, -2.4],
  [-1.5, 2, -9.5, 14.5],
  [2.5, 2, 23.5, 16],
];

/** Cable colours: one per module. */
const COLORS = {
  life: '#39c2f0',
  farm: '#4fd98a',
  lab: '#a987ff',
  shield: '#ff9860',
};

export class Base {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  readonly spots: Record<SpotId, Spot>;
  /** Shared brightness values; lamps of one module read the same number. */
  readonly power = {
    life: { value: 1 },
    farm: { value: 1 },
    lab: { value: 1 },
    shield: { value: 0 },
    always: { value: 1 },
  };

  private readonly site: SiteId;
  private readonly view: BaseView = {
    life: 0.75,
    farm: 0.66,
    lab: 0.66,
    shieldPower: 0,
    battery: 2,
    batteryCap: 4,
    shield: 0,
    crop: 0,
    cropAlive: true,
    panelDust: 0,
  };
  private readonly batteryBars: { value: number }[] = [];
  private readonly cablePower: Record<'life' | 'farm' | 'lab' | 'shield', { value: number }> = {
    life: { value: 1 },
    farm: { value: 1 },
    lab: { value: 1 },
    shield: { value: 0 },
  };
  private readonly panelHeads: THREE.Object3D[] = [];
  private readonly wallLayers: THREE.Mesh[] = [];
  /** Circles along the shield wall. They stop the cadet once the wall stands. */
  private readonly wallColliders: Collider[] = [];
  private readonly ownMaterials: THREE.Material[] = [];
  private dish!: THREE.Object3D;
  private printer!: THREE.Object3D;
  private plants!: THREE.InstancedMesh;
  private plantSeeds: { x: number; z: number; size: number; turn: number }[] = [];
  private plantScale = -1;
  private plantAlive = true;
  private readonly farmGlow = { value: 0.6 };
  private printerAngle = 3.6;
  /** A new building the robot is putting up, or null (then it builds the wall). */
  private buildSite: { x: number; z: number } | null = null;
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpVec = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(site: SiteId) {
    this.site = site;
    this.group.name = 'base';
    this.spots = {
      overview: { target: new THREE.Vector3(0, 2.2, 1), distance: 72, yaw: 0.62, pitch: 0.46 },
      hab: { target: new THREE.Vector3(0, 3.2, -11), distance: 25, yaw: 0.35, pitch: 0.3 },
      farm: { target: new THREE.Vector3(FARM.x, 2.4, FARM.z), distance: 22, yaw: 0.95, pitch: 0.32 },
      lab: { target: new THREE.Vector3(LAB.x, 3.8, LAB.z), distance: 24, yaw: -0.8, pitch: 0.3 },
      solar: { target: new THREE.Vector3(SOLAR.x, 2.6, SOLAR.z), distance: 25, yaw: 0.5, pitch: 0.38 },
      shield: { target: new THREE.Vector3(HAB.x, 3.6, HAB.z), distance: 31, yaw: 2.3, pitch: 0.4 },
      sky: { target: new THREE.Vector3(0, 27, -64), distance: 72, yaw: 0.14, pitch: -0.17 },
      far: {
        target: site === 'moon' ? new THREE.Vector3(84, -1, 32) : new THREE.Vector3(62, 3, 44),
        distance: 48,
        yaw: -0.9,
        pitch: 0.3,
      },
      rover: { target: new THREE.Vector3(10, 1.4, 9), distance: 15, yaw: 0.45, pitch: 0.3 },
      airlock: { target: new THREE.Vector3(0, 1.6, -5.5), distance: 13, yaw: 0.3, pitch: 0.26 },
    };

    this.buildHab();
    this.buildFarm();
    this.buildLab();
    this.buildPower();
    this.buildShield();
    this.buildPlaza();
    this.applyPlants(true);
    this.applyWall(true);
  }

  // -------------------------------------------------------------------------
  // Materials
  // -------------------------------------------------------------------------

  private own<T extends THREE.Material>(material: T): T {
    this.ownMaterials.push(material);
    return material;
  }

  // -------------------------------------------------------------------------
  // Habitat (life support)
  // -------------------------------------------------------------------------

  /**
   * A Blender-made building with the game's materials. Colours and soft shadows are baked
   * into the model; `live` names the materials that change while playing (lamps, glass).
   */
  private dress(name: ModelName, piece: string | null, live: Record<string, THREE.Material>): THREE.Object3D {
    const paint = toon({ color: '#ffffff', rim: 0.42, vertexColors: true });
    const pick = (material: string, mesh: THREE.Mesh): THREE.Material => {
      mesh.receiveShadow = true;
      const special = live[material];
      if (!special) return paint;
      if (special.transparent) {
        mesh.renderOrder = 5;
        mesh.receiveShadow = false;
      }
      return special;
    };
    return piece ? modelPart(name, piece, pick) : model(name, pick);
  }

  private buildHab(): void {
    const warm = this.own(lamp('#ffd9a0', this.power.life, { day: 1.15, night: 3.4 }));
    const cyan = this.own(lamp('#5fe0ff', this.power.life, { day: 1.6, night: 3.6 }));
    const hab = this.dress('hab', null, {
      lamp_warm: warm,
      lamp_cyan: cyan,
      glow_red: this.own(glow('#ff5a5a', 3)),
      glass: this.own(glass('#bfe6ff', { opacity: 0.22, glow: this.power.life, glowColor: '#ffd9a0' })),
    });
    hab.position.set(HAB.x, 0, HAB.z);
    this.group.add(hab);

    this.colliders.push({ x: HAB.x, z: HAB.z, r: 7.3, h: 9 });
    this.colliders.push({ x: HAB.x, z: HAB.z + 7.6, r: 1.9, h: 3.5 });
    this.colliders.push({ x: HAB.x - 3.6, z: HAB.z + 6.5, r: 1.15, h: 3 }, { x: HAB.x + 3.6, z: HAB.z + 6.5, r: 1.15, h: 3 });
  }

  // -------------------------------------------------------------------------
  // Greenhouse (food)
  // -------------------------------------------------------------------------

  private buildFarm(): void {
    const growLight = this.own(lamp('#ff5fd2', this.power.farm, { day: 2.4, night: 4.2 }));
    const doorLamp = this.own(lamp('#9dffc4', this.power.farm, { day: 1.4, night: 3 }));
    const farm = this.dress('farm', null, {
      lamp_grow: growLight,
      lamp_door: doorLamp,
      glass: this.own(glass('#c8f2dc', { opacity: 0.13, edge: 0.6, glow: this.farmGlow, glowColor: '#ff6fd8' })),
    });

    // Plants: little leafy clumps, drawn as one batch.
    const random = mulberry32(2026);
    for (const x of [-2.1, 0, 2.1]) {
      for (let i = 0; i < 15; i++) {
        const z = -4.9 + i * 0.7;
        for (let n = 0; n < 2; n++) {
          this.plantSeeds.push({
            x: x + (random() - 0.5) * 0.7,
            z: z + (random() - 0.5) * 0.35,
            size: 0.7 + random() * 0.6,
            turn: random() * Math.PI * 2,
          });
        }
      }
    }
    const leaf = shape.ico(0.3, 1);
    leaf.scale(1, 0.8, 1);
    this.plants = new THREE.InstancedMesh(leaf, toon({ color: '#ffffff', rim: 0.55, bandSoft: 0.2 }), this.plantSeeds.length);
    this.plants.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const green = new THREE.Color();
    this.plantSeeds.forEach((_, index) => {
      green.setHSL(0.3 + random() * 0.08, 0.6, 0.42 + random() * 0.14);
      this.plants.setColorAt(index, green);
    });
    this.plants.castShadow = false;
    farm.add(this.plants);

    farm.position.set(FARM.x, 0, FARM.z);
    this.group.add(farm);
    for (const dz of [-4.4, 0, 4.4]) this.colliders.push({ x: FARM.x, z: FARM.z + dz, r: 4.5, h: 4.5 });
    this.colliders.push({ x: FARM.x - 5, z: FARM.z - 1.5, r: 1.6, h: 3 });
  }

  // -------------------------------------------------------------------------
  // Laboratory and radio dish (science)
  // -------------------------------------------------------------------------

  private buildLab(): void {
    const windowLight = this.own(lamp('#cfe6ff', this.power.lab, { day: 1.1, night: 3.4 }));
    const violet = this.own(lamp('#b79cff', this.power.lab, { day: 1.6, night: 3.6 }));
    const lab = this.dress('lab', null, { lamp_window: windowLight, lamp_violet: violet });
    // The dish is its own part, so it can turn: it is how science reaches Earth.
    const dish = lab.getObjectByName('dish');
    if (!dish) throw new Error('The lab model has no dish');
    this.dish = dish;
    lab.position.set(LAB.x, 0, LAB.z);
    this.group.add(lab);
    for (const dz of [-3.6, 0, 3.6]) this.colliders.push({ x: LAB.x, z: LAB.z + dz, r: 3.1, h: 9.5 });
    this.colliders.push({ x: LAB.x, z: LAB.z + 7.6, r: 1.3, h: 3 });
  }

  // -------------------------------------------------------------------------
  // Solar panels, battery and power cables
  // -------------------------------------------------------------------------

  private buildPower(): void {
    // Solar cells keep their own material so dust can settle on them.
    const cells = toon({ color: '#27398a', spec: 1.1, rim: 0.6, dusty: true, vertexColors: true });
    const live = { solar: cells, glow_green: this.own(glow('#9dffc4', 2.2)), glow_red: this.own(glow('#ff5a5a', 2.6)) };

    if (this.site === 'mars') {
      // Flat panels that tilt to follow the Sun.
      for (const x of [-21, -15, -9]) {
        for (const z of [17.5, 23.5]) {
          const base = this.dress('power', 'panel_base', live);
          base.position.set(x, 0, z);
          const head = this.dress('power', 'panel_head', live);
          head.position.set(x, 1.85, z);
          this.panelHeads.push(head);
          this.group.add(base, head);
          // The panel (3.7 x 2.3 m) turns with the Sun, so one circle covers every angle.
          this.colliders.push({ x, z, r: 2.0, h: 3.4 });
        }
      }
    } else {
      // Tall vertical panels: at the lunar pole the Sun sits on the horizon, so panels stand up and turn to face it.
      for (const x of [-21, -15, -9]) {
        const z = 20;
        const base = this.dress('power', 'mast_base', live);
        base.position.set(x, 0, z);
        const head = this.dress('power', 'mast_head', live);
        head.position.set(x, 2.5, z);
        this.panelHeads.push(head);
        this.group.add(base, head);
        // The tall panel (2.9 m wide) turns with the Sun.
        this.colliders.push({ x, z, r: 1.5, h: 4.6 });
      }
    }

    // Battery bank with five charge bars. Each bar is its own lamp.
    const bars: Record<string, THREE.Material> = {};
    for (let i = 0; i < 5; i++) {
      const level = { value: 0 };
      this.batteryBars.push(level);
      bars['bar' + i] = this.own(lamp('#ffd24d', level, { day: 2.0, night: 3.6 }));
    }
    const battery = this.dress('power', 'battery', { ...bars, lamp_power: this.own(lamp('#ffd24d', this.power.always, { day: 1.2, night: 3.4 })) });
    battery.position.set(BATTERY.x, 0, BATTERY.z);
    battery.rotation.y = Math.atan2(-BATTERY.x, -BATTERY.z);
    this.group.add(battery);
    this.colliders.push({ x: BATTERY.x, z: BATTERY.z, r: 2.4, h: 3.5 });

    // Cables: light pulses run along them, brighter when a module gets more power.
    const cable = (to: 'life' | 'farm' | 'lab' | 'shield', color: string, points: [number, number, number][]): void => {
      const material = this.own(
        new THREE.ShaderMaterial({
          uniforms: {
            ...fogUniforms(),
            uColor: { value: new THREE.Color(color) },
            uPower: this.cablePower[to],
            uTime: GLOBALS.time,
            uNight: GLOBALS.night,
          },
          vertexShader: /* glsl */ `
            varying vec2 vUv;
            varying float vTop;
            #include <common>
            #include <fog_pars_vertex>
            void main() {
              vUv = uv;
              vTop = normal.y;
              vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
              gl_Position = projectionMatrix * mvPosition;
              #include <fog_vertex>
            }`,
          fragmentShader: /* glsl */ `
            uniform vec3 uColor;
            uniform float uPower;
            uniform float uTime;
            uniform float uNight;
            varying vec2 vUv;
            varying float vTop;
            #include <common>
            #include <fog_pars_fragment>
            void main() {
              // Round look: dark sides, a lighter top, a thin shine along the crest.
              float shade = 0.5 + 0.5 * smoothstep( -0.3, 0.85, vTop );
              float shine = smoothstep( 0.8, 1.0, vTop );
              float wave = fract( vUv.x * 9.0 - uTime * ( 0.35 + 0.9 * uPower ) );
              float pulse = smoothstep( 0.72, 0.96, wave ) * smoothstep( 1.0, 0.96, wave );
              vec3 color = vec3( 0.09, 0.1, 0.15 ) * shade + vec3( 0.1, 0.11, 0.14 ) * shine * ( 1.0 - 0.7 * uNight );
              color += uColor * ( 0.12 + pulse * ( 1.4 + 2.2 * uNight ) ) * uPower * ( 0.55 + 0.45 * shade );
              gl_FragColor = vec4( color, 1.0 );
              #include <fog_fragment>
            }`,
          fog: true,
        }),
      );
      const mesh = new THREE.Mesh(shape.tube(points, 0.09, 40, 8), material);
      mesh.receiveShadow = false;
      this.group.add(mesh);
    };
    const y = 0.07;
    const start: [number, number, number] = [BATTERY.x + 2.2, y, BATTERY.z - 1];
    cable('farm', COLORS.farm, [start, [-21, y, 9], [-19.5, y, 5.4]]);
    cable('life', COLORS.life, [start, [-12, y, 5], [-5.5, y, -3.5], [-4.2, y, -7.6]]);
    cable('lab', COLORS.lab, [start, [-10, y, 9], [6, y, 7.5], [16.5, y, 5.2]]);
    cable('shield', COLORS.shield, [start, [-16, y, 0], [-12.5, y, -12], [-9.6, y, -17]]);

  }

  // -------------------------------------------------------------------------
  // Regolith shield wall and its printer robot
  // -------------------------------------------------------------------------

  private buildShield(): void {
    const regolith = toon({ color: '#ffffff', map: brickTexture(this.site), rim: 0.15, bandSoft: 0.12 });
    const from = (128 * Math.PI) / 180;
    const to = (412 * Math.PI) / 180;
    for (let i = 0; i < 10; i++) {
      const inner = 7.65 - i * 0.3;
      const layer = new THREE.Mesh(shape.arc(inner, inner + 1.3, 0.7, from, to, 40), regolith);
      layer.position.set(HAB.x, i * 0.7, HAB.z);
      layer.castShadow = true;
      layer.receiveShadow = true;
      layer.visible = false;
      this.wallLayers.push(layer);
      this.group.add(layer);
    }

    // The wall runs round the hab; the bottom layer lies about 8.3 m from its middle.
    const steps = 34;
    for (let i = 0; i <= steps; i++) {
      const angle = from + ((to - from) * i) / steps;
      const spot = { x: HAB.x + Math.cos(angle) * 8.3, z: HAB.z + Math.sin(angle) * 8.3, r: 0, h: 4 };
      this.wallColliders.push(spot);
      this.colliders.push(spot);
    }

    const nozzle = this.own(lamp('#ffb070', this.power.shield, { day: 2.5, night: 4 }));
    this.printer = this.dress('power', 'printer', { lamp_nozzle: nozzle });
    this.group.add(this.printer);
  }

  // -------------------------------------------------------------------------
  // Plaza
  // -------------------------------------------------------------------------

  /**
   * The plaza in front of the airlock: a low round platform of paving stones, a glowing ring
   * set into it, the mission medallion in the middle, and five crystal posts between the paths.
   */
  private buildPlaza(): void {
    const top = PLAZA.h;
    const group = new THREE.Group();
    group.position.set(PLAZA.x, 0, PLAZA.z);
    const stone = toon({ color: '#ffffff', map: plazaTexture(this.site), rim: 0.06, lift: 0.16, bandSoft: 0.18 });
    const face = new THREE.Mesh(shape.disc(PLAZA.r, 128), stone);
    face.position.y = top + 0.003;
    face.receiveShadow = true;
    group.add(face);
    // A bevelled stone rim, sunk into the ground.
    const rimColor = this.site === 'mars' ? '#c8ab8c' : '#b9bdc8';
    const profile = [
      [PLAZA.r - 0.02, top + 0.003],
      [PLAZA.r + 0.05, top - 0.015],
      [PLAZA.r + 0.13, top - 0.07],
      [PLAZA.r + 0.2, -0.06],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const rim = new THREE.Mesh(new THREE.LatheGeometry(profile, 128), toon({ color: rimColor, rim: 0.3, spec: 0.15, lift: 0.14 }));
    rim.receiveShadow = true;
    rim.castShadow = true;
    group.add(rim);
    // A ring of light set into the stone; it follows the habitat's power and glows brighter at night.
    const light = this.own(lamp('#7fe9ff', this.power.life, { day: 1.5, night: 3.6 }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(PLAZA.r * 0.7 - 0.035, PLAZA.r * 0.7 + 0.035, 160).rotateX(-Math.PI / 2), light);
    ring.position.y = top + 0.008;
    group.add(ring);
    // The mission medallion: a raised gold-rimmed coin with the patch on it.
    const gold = toon({ color: '#d8b46a', rim: 0.45, spec: 0.7, lift: 0.14 });
    const coin = new THREE.Mesh(shape.cyl(1.08, 1.13, 0.05, 64), gold);
    coin.position.y = top + 0.025;
    coin.castShadow = coin.receiveShadow = true;
    const patch = new THREE.Mesh(shape.disc(0.98, 64), toon({ color: '#ffffff', map: emblemTexture(this.site), transparent: true, rim: 0.1, lift: 0.22 }));
    patch.position.y = top + 0.052;
    patch.receiveShadow = true;
    group.add(coin, patch);
    // Five crystal posts in the gaps between the paths.
    const post = toon({ color: this.site === 'mars' ? '#e6d2b6' : '#d5d9e2', rim: 0.35, lift: 0.16, flatShading: true });
    const crystal = this.own(lamp('#9ff3ff', this.power.life, { day: 1.8, night: 3.8 }));
    this.plazaCrystals = [];
    for (const degrees of [2, 83, 172, -122, -58]) {
      const a = (degrees * Math.PI) / 180;
      const x = Math.cos(a) * (PLAZA.r - 0.3);
      const z = Math.sin(a) * (PLAZA.r - 0.3);
      const pillar = new THREE.Mesh(shape.cyl(0.16, 0.22, 0.85, 6), post);
      pillar.position.set(x, top + 0.42, z);
      pillar.castShadow = true;
      const cap = new THREE.Mesh(shape.cyl(0.24, 0.17, 0.08, 6), gold);
      cap.position.set(x, top + 0.86, z);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), crystal);
      gem.scale.set(1, 1.7, 1);
      gem.position.set(x, top + 1.2, z);
      group.add(pillar, cap, gem);
      this.plazaCrystals.push(gem);
      this.colliders.push({ x: PLAZA.x + x, z: PLAZA.z + z, r: 0.3, h: 2.4 });
    }
    this.group.add(group);
  }

  private plazaCrystals: THREE.Mesh[] = [];

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  setBuildSite(site: { x: number; z: number } | null): void {
    this.buildSite = site;
  }

  setView(view: Partial<BaseView>): void {
    Object.assign(this.view, view);
  }

  private applyPlants(force = false): void {
    const { crop, cropAlive } = this.view;
    const grown = Math.max(0, Math.min(1, crop / CROP_WEEKS));
    const scale = cropAlive ? 0.16 + 0.84 * grown : 0.12;
    if (!force && Math.abs(scale - this.plantScale) < 0.004 && cropAlive === this.plantAlive) return;
    // Grow smoothly toward the new size.
    this.plantScale = force || this.plantScale < 0 ? scale : this.plantScale + (scale - this.plantScale) * 0.08;
    this.plantAlive = cropAlive;
    this.plantSeeds.forEach((seed, index) => {
      const size = seed.size * this.plantScale;
      this.tmpMatrix.makeRotationY(seed.turn);
      this.tmpMatrix.scale(this.tmpVec.set(size, size * (0.8 + 0.5 * this.plantScale), size));
      this.tmpMatrix.setPosition(seed.x, 1.13 + size * 0.22, seed.z);
      this.plants.setMatrixAt(index, this.tmpMatrix);
    });
    this.plants.instanceMatrix.needsUpdate = true;
  }

  private applyWall(force = false): void {
    const built = this.view.shield * 10;
    const solid = built >= 1;
    for (const spot of this.wallColliders) spot.r = solid ? 0.95 : 0;
    this.wallLayers.forEach((layer, index) => {
      const amount = Math.max(0, Math.min(1, built - index));
      const current = layer.visible ? layer.scale.y : 0;
      const next = force ? amount : current + (amount - current) * 0.07;
      layer.visible = next > 0.01;
      layer.scale.y = Math.max(0.01, next);
    });
  }

  update(dt: number, time: number, sunDir: THREE.Vector3): void {
    // The plaza crystals float and turn.
    this.plazaCrystals.forEach((gem, index) => {
      gem.rotation.y = time * 0.8 + index;
      gem.position.y = PLAZA.h + 1.2 + Math.sin(time * 1.6 + index * 1.3) * 0.06;
    });
    const view = this.view;
    const ease = Math.min(1, dt * 3);
    const approach = (uniform: { value: number }, target: number): void => {
      uniform.value += (target - uniform.value) * ease;
    };
    approach(this.power.life, view.life);
    approach(this.power.farm, view.farm);
    approach(this.power.lab, view.lab);
    approach(this.power.shield, view.shieldPower);
    approach(this.cablePower.life, view.life);
    approach(this.cablePower.farm, view.farm);
    approach(this.cablePower.lab, view.lab);
    approach(this.cablePower.shield, view.shieldPower);
    approach(this.farmGlow, view.farm * 0.9);
    this.batteryBars.forEach((bar, index) => {
      const full = index < view.battery ? 1 : 0;
      const usable = index < view.batteryCap ? 1 : 0;
      approach(bar, full * usable);
    });
    GLOBALS.dust.value += (Math.min(1, view.panelDust / 0.4) - GLOBALS.dust.value) * ease;

    this.applyPlants();
    this.applyWall();

    // Solar panels follow the Sun.
    if (this.site === 'mars') {
      const aim = this.tmpVec.copy(sunDir);
      if (aim.y < 0.25) aim.y = 0.25;
      aim.normalize();
      this.tmpQuat.setFromUnitVectors(this.up, aim);
      for (const head of this.panelHeads) head.quaternion.slerp(this.tmpQuat, Math.min(1, dt * 1.5));
    } else {
      const yaw = Math.atan2(sunDir.x, sunDir.z);
      for (const head of this.panelHeads) {
        let delta = yaw - head.rotation.y;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        head.rotation.y += delta * Math.min(1, dt * 1.5);
      }
    }

    // The dish scans when the lab has power.
    this.dish.rotation.y = -0.5 + Math.sin(time * 0.25) * 0.35 * this.power.lab.value;

    // The printer robot drives slowly along the top of the wall while it is building:
    // to one end, then back again (about 1 m a second, the pace of a real building robot).
    const site = this.buildSite;
    if (site) {
      // A new building: the robot circles the site slowly, printing.
      const busy = this.power.shield.value > 0.05;
      if (busy) this.printerAngle += dt * 0.05;
      const turn = this.printerAngle * Math.PI * 2;
      this.printer.position.set(site.x + Math.cos(turn) * 5.4, 0, site.z + Math.sin(turn) * 5.4);
      this.printer.rotation.y = -turn;
      return;
    }
    const working = this.power.shield.value > 0.05 && view.shield < 1;
    if (working) this.printerAngle += dt * 0.024;
    const layerIndex = Math.min(9, Math.floor(view.shield * 10 + 0.001));
    const radius = working || view.shield > 0 ? 8.3 - layerIndex * 0.3 : 10.6;
    const height = working || view.shield > 0 ? Math.min(10, Math.ceil(view.shield * 10 - 0.001)) * 0.7 : 0;
    const phase = ((this.printerAngle % 2) + 2) % 2;
    const along = phase < 1 ? phase : 2 - phase;
    const forward = phase < 1;
    const angle = (128 * Math.PI) / 180 + (along * 0.9 + 0.05) * ((284 * Math.PI) / 180);
    const sweep = working ? angle : 3.6;
    this.printer.position.set(HAB.x + Math.cos(sweep) * radius, height, HAB.z + Math.sin(sweep) * radius);
    // Face the way it drives; turn round at each end.
    this.printer.rotation.y = working ? -sweep + (forward ? 0 : Math.PI) : -sweep + Math.PI / 2;
  }

  dispose(): void {
    disposeTree(this.group);
    for (const material of this.ownMaterials) material.dispose();
  }
}

export type { Xf };
