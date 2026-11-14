/**
 * The walk outside (EVA = extravehicular activity).
 *
 * The player runs and jumps in real Mars or Moon gravity, picks up rock
 * samples for science, does one useful chore, and must be back in the airlock
 * before the suit runs low or a solar storm arrives.
 *
 * Trade-offs made physical: far samples are worth more but cost more air and
 * leave you far from shelter.
 */
import * as THREE from 'three';
import { FINDS, FIND_SCIENCE } from '../sim/finds';
import { TOOL_EFFECT } from '../sim/outpost';
import type { FindDef } from '../sim/finds';
import { stream } from '../sim/rng';
import { EVA_AIR_PER_SECOND, EVA_MAX_SECONDS, SITES } from '../sim/sites';
import type { EvaResult, SiteId } from '../sim/types';
import type { Astronaut } from './astronaut';
import { PLOTS } from './annex';
import { AIRLOCK, SOLAR } from './base';
import type { Collider } from './base';
import { shape } from './build';
import type { CameraRig } from './cameraRig';
import type { Puffs, Tracks } from './fx';
import type { Rover } from './rover';
import type { InputState } from './input';
import { toon } from './materials';
import { modelPart } from './models';
import { dotTexture } from './textures';
import { WALK_RADIUS } from './terrain';

export interface EvaConfig {
  site: SiteId;
  seed: number;
  week: number;
  /** Chance (0-1) that a storm alert sounds during the walk. */
  stormChance: number;
  /** Seconds to reach the airlock after the alert. */
  alertSeconds: number;
  choreAvailable: boolean;
  /** Discoveries already made in this mission (ids from sim/finds.ts). */
  found: string[];
  /** Tools made in the workshop (ids from sim/outpost.ts). */
  tools: string[];
  /** Buildings the cadet can walk into from outside: the room and the spot in front of its door. */
  doors: { room: string; x: number; z: number }[];
  /** Other places that are safe in a storm alert (the storm bunker's door). */
  shelters?: { x: number; z: number }[];
  /** Creative mode: the suit lasts a very long time. */
  unlimited?: boolean;
  /** More suit time, in seconds: the first level gives young players time to learn the controls. */
  extraSeconds?: number;
}

export type PromptKind = 'sample' | 'chore' | 'find' | 'airlock' | 'regolith' | 'metal';
export type EvaEvent =
  | 'drive'
  | 'park'
  | 'bump'
  | 'roverEmpty'
  | 'sample'
  | 'chore'
  | 'find'
  | 'regolith'
  | 'metal'
  | 'perfect'
  | 'miss'
  | 'door'
  | 'alert'
  | 'jump'
  | 'land'
  | 'step'
  | 'safe'
  | 'caught'
  | 'timeout'
  | 'edge'
  | 'run';

export interface EvaHud {
  timeLeft: number;
  total: number;
  samples: number;
  samplesTotal: number;
  science: number;
  choreAvailable: boolean;
  choreDone: boolean;
  /** What the cadet is doing at a marker. Digging also shows the timing bar: a cursor (0-1) and the gold zone. */
  prompt: {
    kind: PromptKind;
    progress: number;
    sweep?: number;
    zone?: [number, number];
    tried?: boolean;
    /** Metal veins: the marker the player holds up, and the wandering zone to keep it in (0-1). */
    tension?: { cursor: number; zone: number; width: number; inside: boolean };
  } | null;
  /** Standing at a door: the room behind it. */
  door: string | null;
  /** Materials dug on this walk. */
  materials: { regolith: number; metal: number };
  /** The scanner shows every material on the map. */
  scanner: boolean;
  /** Seconds left on the storm alert, or null. */
  alert: number | null;
  /** Metres to the airlock. */
  home: number;
  /** Direction to the airlock on screen: 0 = straight ahead, positive = to the right (radians). */
  homeBearing: number;
  /** Direction and distance to the nearest sample still out there. */
  nextBearing: number | null;
  nextDistance: number | null;
  airUsed: number;
  /** Jump height reached on the last jump, metres. */
  lastJump: number;
  /** Science from samples picked up on this walk (the game adds it when the walk ends). */
  sampleScience: number;
  /** The cadet is running (suit air goes faster). */
  running: boolean;
  /** Discoveries made in this mission so far, and how many this world has. */
  finds: number;
  findsTotal: number;
  /** The cadet stands next to the rover and may get in. */
  canDrive: boolean;
  /** The cadet is driving. */
  driving: boolean;
  /** Rover battery, 0-1. */
  charge: number;
  /** Rover speed, metres per second (0 when not driving). */
  driveSpeed: number;
  /** Motor sound level, 0-1. */
  motor: number;
}

interface Marker {
  kind: 'sample' | 'chore' | 'find' | 'regolith' | 'metal';
  /** Digging: the use button was pressed once already (one try for the bonus). */
  tried?: boolean;
  /** Discoveries only: the id from sim/finds.ts. */
  id?: string;
  /** How close the cadet must come, metres. */
  reach: number;
  x: number;
  z: number;
  value: number;
  group: THREE.Group;
  gem: THREE.Mesh;
  ring: THREE.Mesh;
  done: boolean;
  progress: number;
  /** Materials made for this marker only, freed with it. */
  materials: THREE.Material[];
}

/** How far behind the cadet the camera stands on a walk (closer than before, so the cadet feels like you). */
const WALK_DISTANCE = 6.2;
/** Eye height above the cadet's feet, in first person. */
const EYE_HEIGHT = 1.55;
const PLAYER_RADIUS = 0.42;
const SAMPLE_COLORS = ['#6fe3ff', '#c8a2ff', '#ffd166'];
const SAMPLE_VALUES = [2, 4, 6];
const SAMPLE_RINGS: [number, number][] = [
  [27, 45],
  [50, 72],
  [78, 106],
];
/** Jump take-off speed in m/s: the same legs on every world. On Earth this gives a 0.5 m hop. */
const JUMP_SPEED = 3.13;
/** Running adds this share of speed, and this share of extra suit-air use. */
const RUN_SPEED = 0.55;
const RUN_AIR = 0.6;
/** Inside the rover, suit time runs at this share of the normal rate: the cabin has its own air. */
const ROVER_TIME = 0.55;
/** Metres between boot prints. */
const STRIDE = 0.6;
/** GAME. Materials: how many piles and rocks a walk has, and what each gives. */
const REGOLITH_PILES = 4;
const METAL_ROCKS = 3;
const REGOLITH_EACH = 2;
const METAL_EACH = 2;
/** Seconds of digging (half with the drill). */
const DIG_TIME = { regolith: 1.9, metal: 2.5 };
/** The gold zone of the timing bar: hit it for one more. */
const GOLD: [number, number] = [0.4, 0.6];
const MATERIAL_COLOR = { regolith: '#e8c08a', metal: '#9fd8ff' };

interface Door {
  room: string;
  x: number;
  z: number;
  group: THREE.Group;
  ring: THREE.Mesh;
  gem: THREE.Mesh;
  materials: THREE.Material[];
}

export class Eva {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3(AIRLOCK.x, 0, AIRLOCK.z + 1.4);
  active = false;
  onHud: ((hud: EvaHud) => void) | null = null;
  onEvent: ((event: EvaEvent, value?: number) => void) | null = null;
  onFinish: ((result: EvaResult, reason: 'home' | 'timeout' | 'caught' | 'recall') => void) | null = null;

  private readonly velocity = new THREE.Vector3();
  /** The stick or keys, eased, so pressing and letting go never snaps the cadet. */
  private readonly moveEased = { x: 0, y: 0 };
  /** First person: the camera sits at the cadet's eyes (the player's choice, kept in the settings). */
  firstPerson = false;
  /** The model is hidden because of the first-person view. */
  private hidByView = false;
  /** Called when the player switches the view, so the choice is remembered. */
  onView: ((firstPerson: boolean) => void) | null = null;
  /** Called with the field-of-view factor the current view wants. */
  onFov: ((scale: number) => void) | null = null;
  private heading = 0;
  private grounded = true;
  private elapsed = 0;
  /** Science from samples (handed over when the walk ends). */
  private science = 0;
  /** Science from discoveries (already counted by the game when made; shown on screen). */
  private findScience = 0;
  private samples = 0;
  private choreDone = false;
  /** Discoveries made on this walk. */
  private finds: string[] = [];
  private leftBase = false;
  private alertAt = -1;
  private alertLeft = -1;
  private alerted = false;
  private markers: Marker[] = [];
  private config: EvaConfig | null = null;
  private hudTimer = 0;
  private jumpPeak = 0;
  private jumpBase = 0;
  private lastJump = 0;
  private edgeWarned = 0;
  /** 0 = walking, 1 = running; eased so the change of pace is smooth. */
  private pace = 0;
  private ranOnce = false;
  /** The cadet is in the rover. */
  private driving = false;
  private emptyWarned = false;
  private lastBump = 0;
  private dustSide: -1 | 1 = 1;
  /** Seconds left of the camera move that shows a discovery (0 = none). */
  private cinema = 0;
  private cinemaYaw = 0;
  private readonly cinemaTarget = new THREE.Vector3();
  private cinemaRestore = { distance: 8.5, pitch: 0.21 };
  /** Metres walked since the last boot print. */
  private trail = 0;
  private leftFoot = false;
  /** Materials dug on this walk. */
  private materials = { regolith: 0, metal: 0 };
  private doors: Door[] = [];
  /** Storm shelters besides the airlock, with their beams (shown during an alert). */
  private shelters: { x: number; z: number; beam: THREE.Mesh; ring: THREE.Mesh }[] = [];
  private doorNear = -1;
  /** Suit seconds on this walk (more with the bigger tank). */
  private maxSeconds = EVA_MAX_SECONDS;
  private jumpSpeed = JUMP_SPEED;
  private drill = false;
  /** Metal veins: the hold-and-release game. */
  private tension = { marker: null as Marker | null, cursor: 0.15, speed: 0, zone: 0.5, clock: 0, outside: 0, inside: false };
  private useHeld = false;
  private scanner = false;
  private readonly airlockRing: THREE.Mesh;
  private readonly airlockBeam: THREE.Mesh;
  private readonly ownMaterials: THREE.Material[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly astronaut: Astronaut,
    private readonly rig: CameraRig,
    private readonly puffs: Puffs,
    private readonly height: (x: number, z: number) => number,
    private readonly colliders: Collider[],
    private readonly icePoint: { x: number; z: number } | null,
    private readonly tracks: Tracks | null = null,
    private readonly rover: Rover | null = null,
  ) {
    this.group.name = 'eva';
    const ringMaterial = new THREE.MeshBasicMaterial({ color: '#7dffb0', transparent: true, opacity: 0.9, depthWrite: false });
    ringMaterial.color.multiplyScalar(2);
    this.airlockRing = new THREE.Mesh(shape.torus(2.3, 0.07, 48, 6), ringMaterial);
    this.airlockRing.rotation.x = Math.PI / 2;
    this.airlockRing.position.set(AIRLOCK.x, 0.08, AIRLOCK.z);
    const beamMaterial = this.beamMaterial('#7dffb0');
    this.airlockBeam = new THREE.Mesh(shape.cyl(0.5, 1.6, 26, 16, true), beamMaterial);
    this.airlockBeam.position.set(AIRLOCK.x, 13, AIRLOCK.z);
    this.airlockBeam.visible = false;
    this.airlockRing.visible = false;
    this.ownMaterials.push(ringMaterial, beamMaterial);
    this.group.add(this.airlockRing, this.airlockBeam);
    this.placeAtAirlock();
  }

  private beamMaterial(color: string): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    return material;
  }

  placeAtAirlock(): void {
    this.position.set(AIRLOCK.x, this.height(AIRLOCK.x, AIRLOCK.z + 1.4), AIRLOCK.z + 1.4);
    this.velocity.set(0, 0, 0);
    this.moveEased.x = this.moveEased.y = 0;
    this.heading = -0.6;
    this.grounded = true;
    this.syncAstronaut(0, 0);
  }

  /** Put the astronaut model back where the walk left it (it was used inside a building). */
  resync(): void {
    this.astronaut.group.visible = !this.driving;
    this.velocity.set(0, 0, 0);
    this.moveEased.x = this.moveEased.y = 0;
    this.syncAstronaut(0, 0);
    this.rig.follow(this.position);
    this.rig.setAngles(this.heading + Math.PI, 0.24);
    this.rig.setDistance(WALK_DISTANCE);
    this.rig.snap();
  }

  /** Put the astronaut somewhere for a posed shot (title screen). */
  pose(x: number, z: number, heading: number): void {
    this.position.set(x, this.height(x, z), z);
    this.heading = heading;
    this.syncAstronaut(0, 0);
  }

  private clearMarkers(): void {
    for (const marker of this.markers) {
      this.group.remove(marker.group);
      marker.group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        // Sample rocks are copies of a loaded model: their shape is shared and stays.
        if (mesh.isMesh && !mesh.geometry.userData.shared) mesh.geometry.dispose();
      });
      for (const material of marker.materials) material.dispose();
    }
    this.markers = [];
    for (const door of this.doors) {
      this.group.remove(door.group);
      door.ring.geometry.dispose();
      door.gem.geometry.dispose();
      for (const material of door.materials) material.dispose();
    }
    this.doors = [];
    this.doorNear = -1;
    for (const shelter of this.shelters) {
      this.group.remove(shelter.beam, shelter.ring);
      shelter.beam.geometry.dispose();
      shelter.ring.geometry.dispose();
      (shelter.beam.material as THREE.Material).dispose();
      (shelter.ring.material as THREE.Material).dispose();
    }
    this.shelters = [];
  }

  /** Where to run: the airlock, or during an alert the nearest shelter. */
  private safePlace(): { x: number; z: number } {
    let best: { x: number; z: number } = AIRLOCK;
    if (this.alertLeft < 0) return best;
    let distance = Math.hypot(this.position.x - AIRLOCK.x, this.position.z - AIRLOCK.z);
    for (const shelter of this.shelters) {
      const d = Math.hypot(this.position.x - shelter.x, this.position.z - shelter.z);
      if (d < distance) {
        distance = d;
        best = shelter;
      }
    }
    return best;
  }

  /** Regolith (a heap of loose soil) or a rock with metal in it, to dig for the builder robot. */
  private addResource(kind: 'regolith' | 'metal', x: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, this.height(x, z), z);
    const color = MATERIAL_COLOR[kind];
    const bright = new THREE.MeshBasicMaterial({ color });
    bright.color.multiplyScalar(2.2);
    const soft = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false });
    soft.color.multiplyScalar(1.7);
    const ring = new THREE.Mesh(shape.torus(1.55, 0.045, 40, 6), soft);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.09;
    const mars = this.config?.site === 'mars';
    const owned: THREE.Material[] = [bright, soft];
    let gem: THREE.Mesh;
    if (kind === 'regolith') {
      // A low heap with a few stones on it.
      const dirt = toon({ color: mars ? '#b9734a' : '#a4a6ae', rim: 0.25, lift: 0.1 });
      const heap = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), dirt);
      heap.scale.set(1.25, 0.55, 1.05);
      heap.castShadow = heap.receiveShadow = true;
      group.add(heap);
      const stone = toon({ color: mars ? '#8a4a2e' : '#7c7f88', rim: 0.25, lift: 0.1, flatShading: true });
      for (let i = 0; i < 4; i++) {
        const pebble = new THREE.Mesh(shape.ico(0.16 + (i % 2) * 0.07, 0), stone);
        const a = i * 1.7 + x;
        pebble.position.set(Math.cos(a) * 0.6, 0.38 - (i % 2) * 0.12, Math.sin(a) * 0.5);
        pebble.rotation.set(a, a * 2, 0);
        pebble.castShadow = true;
        group.add(pebble);
      }
      gem = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), bright);
    } else {
      // A dark rock with bright metal veins.
      const rockMaterial = toon({ color: mars ? '#5b3a30' : '#55585f', rim: 0.3, vertexColors: true, lift: 0.08 });
      const vein = new THREE.MeshBasicMaterial({ color: '#cfeeff' });
      vein.color.multiplyScalar(1.9);
      owned.push(vein);
      const rock = modelPart('scenery', x > 0 ? 'sample_a' : 'sample_b', (name) => (name === 'crystal' ? vein : rockMaterial));
      rock.scale.setScalar(1.7);
      rock.rotation.y = z * 0.9;
      group.add(rock);
      gem = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 6), bright);
      gem.rotation.x = Math.PI / 2;
    }
    gem.position.y = 1.9;
    const pillar = new THREE.Mesh(shape.cyl(0.1, 0.4, 10, 12, true), this.beamMaterial(color));
    (pillar.material as THREE.MeshBasicMaterial).opacity = 0.09;
    owned.push(pillar.material as THREE.Material);
    pillar.position.y = 7.4;
    group.add(ring, gem, pillar);
    this.group.add(group);
    const value = kind === 'regolith' ? REGOLITH_EACH : METAL_EACH;
    this.markers.push({ kind, reach: 2.1, x, z, value, group, gem, ring, done: false, progress: 0, materials: owned });
  }

  /** A glowing ring at a building door: stand in it and press the use button to go inside. */
  private addDoor(door: { room: string; x: number; z: number }): void {
    const group = new THREE.Group();
    group.position.set(door.x, this.height(door.x, door.z), door.z);
    const soft = new THREE.MeshBasicMaterial({ color: '#7fe0ff', transparent: true, opacity: 0.85, depthWrite: false });
    soft.color.multiplyScalar(1.8);
    const bright = new THREE.MeshBasicMaterial({ color: '#c9f6ff' });
    bright.color.multiplyScalar(2.1);
    const ring = new THREE.Mesh(shape.torus(1.2, 0.05, 40, 6), soft);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    // A little door: a rounded slab with a round window.
    const gem = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.52, 0.06), bright);
    gem.position.y = 2.3;
    group.add(ring, gem);
    this.group.add(group);
    this.doors.push({ ...door, group, ring, gem, materials: [soft, bright] });
  }

  /** Doors the cadet can walk into, for the map. */
  doorPoints(): readonly { room: string; x: number; z: number }[] {
    return this.doors;
  }

  /** The scanner shows every material on the map, not only the near ones. */
  get hasScanner(): boolean {
    return this.scanner;
  }

  private free(x: number, z: number, margin: number): boolean {
    for (const c of this.colliders) {
      if (Math.hypot(x - c.x, z - c.z) < c.r + margin) return false;
    }
    return true;
  }

  private addMarker(kind: 'sample' | 'chore', x: number, z: number, value: number, color: string): void {
    const group = new THREE.Group();
    const y = this.height(x, z);
    group.position.set(x, y, z);
    const bright = new THREE.MeshBasicMaterial({ color });
    bright.color.multiplyScalar(2.4);
    const soft = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false });
    soft.color.multiplyScalar(1.8);
    const beam = this.beamMaterial(color);

    const ring = new THREE.Mesh(shape.torus(kind === 'chore' ? 2.4 : 1.25, 0.05, 40, 6), soft);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.09;
    const gem = new THREE.Mesh(kind === 'chore' ? shape.ico(0.4, 0) : new THREE.OctahedronGeometry(0.3, 0), bright);
    gem.position.y = 1.7;
    const pillar = new THREE.Mesh(shape.cyl(0.14, 0.55, 14, 12, true), beam);
    pillar.position.y = 9.4; // starts above the gem, so the rock keeps its own colours
    group.add(ring, gem, pillar);
    if (kind === 'sample') {
      // A rock with crystals in it; the crystals glow in the colour of what the sample is worth.
      const stone = toon({ color: this.config?.site === 'mars' ? '#a5633f' : '#9a9da6', rim: 0.3, vertexColors: true });
      const nth = this.markers.filter((marker) => marker.kind === 'sample').length;
      const rock = modelPart('scenery', nth % 2 === 0 ? 'sample_a' : 'sample_b', (name) => (name === 'crystal' ? bright : stone));
      rock.scale.setScalar(1.25);
      rock.rotation.y = x * 0.7;
      group.add(rock);
    }
    this.group.add(group);
    this.markers.push({ kind, reach: kind === 'chore' ? 3.2 : 1.9, x, z, value, group, gem, ring, done: false, progress: 0, materials: [bright, soft, beam] });
  }

  /** A discovery waiting to be made: a gold star turns above it, and a faint beam shows from afar. */
  private addFind(find: FindDef): void {
    const group = new THREE.Group();
    group.position.set(find.x, this.height(find.x, find.z), find.z);
    const gold = new THREE.MeshBasicMaterial({ color: '#ffe08a' });
    gold.color.multiplyScalar(2.3);
    const soft = new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.75, depthWrite: false });
    soft.color.multiplyScalar(1.6);
    const beam = this.beamMaterial('#ffd166');
    beam.opacity = 0.1;

    const ring = new THREE.Mesh(shape.torus(find.reach * 0.82, 0.045, 48, 6), soft);
    ring.rotation.x = Math.PI / 2;
    // On uneven ground (a crater, a slope) the ring rises to the highest point under it, so none of it is buried.
    const base = this.height(find.x, find.z);
    let lift = 0;
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const r = find.reach * 0.82;
      lift = Math.max(lift, this.height(find.x + Math.cos(angle) * r, find.z + Math.sin(angle) * r) - base);
    }
    ring.position.y = 0.1 + lift;
    // A four-pointed star, the same sign as on the map.
    const outline = new THREE.Shape();
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const radius = i % 2 === 0 ? 0.52 : 0.17;
      if (i === 0) outline.moveTo(Math.sin(angle) * radius, Math.cos(angle) * radius);
      else outline.lineTo(Math.sin(angle) * radius, Math.cos(angle) * radius);
    }
    const star = new THREE.ExtrudeGeometry(outline, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 1 });
    star.center();
    const gem = new THREE.Mesh(star, gold);
    gem.position.y = 2.7;
    // The beam starts above the star, so the find itself keeps its own colours.
    const pillar = new THREE.Mesh(shape.cyl(0.1, 0.42, 16, 12, true), beam);
    pillar.position.y = 11.6;
    group.add(ring, gem, pillar);
    this.group.add(group);
    this.markers.push({ kind: 'find', id: find.id, reach: find.reach, x: find.x, z: find.z, value: FIND_SCIENCE, group, gem, ring, done: false, progress: 0, materials: [gold, soft, beam] });
  }

  start(config: EvaConfig): void {
    this.config = config;
    this.endCinema(); // a finding's close-up that was cut short must not frame the new walk
    this.clearMarkers();
    this.elapsed = 0;
    this.science = 0;
    this.findScience = 0;
    this.samples = 0;
    this.choreDone = false;
    this.finds = [];
    this.emptyWarned = false;
    this.stopDriving();
    this.leftBase = false;
    this.alerted = false;
    this.alertLeft = -1;
    this.lastJump = 0;
    this.edgeWarned = 0;
    this.pace = 0;
    this.ranOnce = false;
    this.materials = { regolith: 0, metal: 0 };
    // The workshop's tools.
    const tools = config.tools ?? [];
    this.maxSeconds = config.unlimited ? 900 : EVA_MAX_SECONDS + (config.extraSeconds ?? 0) + (tools.includes('tank') ? TOOL_EFFECT.tankSeconds : 0);
    this.jumpSpeed = JUMP_SPEED * (tools.includes('boots') ? Math.sqrt(TOOL_EFFECT.bootsJump) : 1);
    this.drill = tools.includes('drill');
    this.scanner = tools.includes('scanner');
    if (this.rover) this.rover.drainScale = tools.includes('battery') ? 1 / TOOL_EFFECT.batteryFactor : 1;

    const rng = stream(config.seed, 'eva', config.week);
    this.alertAt = rng.chance(config.stormChance) ? rng.range(14, 30) : -1;

    // Discoveries not yet made in this mission. Placed first, so samples keep away from them.
    for (const find of FINDS[config.site]) {
      if (!config.found.includes(find.id)) this.addFind(find);
    }

    // Two samples in each ring: near (small reward), middle, far (big reward).
    SAMPLE_RINGS.forEach(([min, max], ringIndex) => {
      for (let n = 0; n < 2; n++) {
        for (let attempt = 0; attempt < 40; attempt++) {
          const radius = rng.range(min, max);
          // Keep samples in the southern half-circle, in front of the airlock, where the camera starts.
          const angle = rng.range(-0.25, 1.25) * Math.PI;
          const x = Math.cos(angle) * radius;
          const z = Math.sin(angle) * radius * 0.92 + 6;
          if (!this.free(x, z, 3)) continue;
          if (this.markers.some((m) => Math.hypot(m.x - x, m.z - z) < 12)) continue;
          // Found discoveries are no longer markers, but their rocks are still there.
          if (FINDS[config.site].some((find) => Math.hypot(find.x - x, find.z - z) < 12)) continue;
          this.addMarker('sample', x, z, SAMPLE_VALUES[ringIndex], SAMPLE_COLORS[ringIndex]);
          break;
        }
      }
    });

    // Materials for the builder robot: heaps of regolith near the outpost, metal farther out.
    const spot = (min: number, max: number): { x: number; z: number } | null => {
      for (let attempt = 0; attempt < 50; attempt++) {
        const radius = rng.range(min, max);
        const angle = rng.range(0, Math.PI * 2);
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        if (!this.free(x, z, 3.2)) continue;
        if (this.markers.some((m) => Math.hypot(m.x - x, m.z - z) < 9)) continue;
        if (FINDS[config.site].some((find) => Math.hypot(find.x - x, find.z - z) < 10)) continue;
        if (Object.values(PLOTS).some((plot) => Math.hypot(plot.x - x, plot.z - z) < 8)) continue;
        if (Math.hypot(x - AIRLOCK.x, z - AIRLOCK.z) < 14) continue;
        return { x, z };
      }
      return null;
    };
    for (let n = 0; n < REGOLITH_PILES; n++) {
      const at = spot(15, 52);
      if (at) this.addResource('regolith', at.x, at.z);
    }
    for (let n = 0; n < METAL_ROCKS; n++) {
      const at = spot(34, 90);
      if (at) this.addResource('metal', at.x, at.z);
    }
    for (const door of config.doors ?? []) this.addDoor(door);
    for (const spot of config.shelters ?? []) {
      const beam = new THREE.Mesh(shape.cyl(0.5, 1.6, 26, 16, true), this.beamMaterial('#7dffb0'));
      beam.position.set(spot.x, this.height(spot.x, spot.z) + 13, spot.z);
      beam.visible = false;
      const ringMaterial = new THREE.MeshBasicMaterial({ color: '#7dffb0', transparent: true, opacity: 0.9, depthWrite: false });
      ringMaterial.color.multiplyScalar(2);
      const ring = new THREE.Mesh(shape.torus(2.1, 0.07, 48, 6), ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(spot.x, this.height(spot.x, spot.z) + 0.1, spot.z);
      ring.visible = false;
      this.group.add(beam, ring);
      this.shelters.push({ ...spot, beam, ring });
    }

    if (config.choreAvailable) {
      if (config.site === 'mars') this.addMarker('chore', SOLAR.x, SOLAR.z - 5.2, 0, '#ffd166');
      else if (this.icePoint) this.addMarker('chore', this.icePoint.x, this.icePoint.z, 0, '#8fd8ff');
    }

    this.placeAtAirlock();
    this.airlockRing.visible = true;
    this.airlockBeam.visible = false;
    this.rig.setAngles(this.openYaw(2.2), 0.25);
    this.rig.setDistance(WALK_DISTANCE);
    this.active = true;
    this.pushHud(true);
  }

  /** Things to find on this walk, for the map in the corner of the screen. */
  mapPoints(): readonly { kind: 'sample' | 'chore' | 'find' | 'regolith' | 'metal'; x: number; z: number; value: number; done: boolean }[] {
    return this.markers;
  }

  /** How fast the cadet walks, in m/s. */
  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** The way the cadet faces, in radians (0 = toward +Z). */
  get facing(): number {
    return this.heading;
  }

  /** A storm alert is running: the doors stay shut until it is over. */
  get alerting(): boolean {
    return this.active && this.alertLeft >= 0;
  }

  /** End the walk early (the "back to base" button). Not allowed during a storm alert. */
  recall(): boolean {
    if (!this.active || this.alertLeft >= 0) return false;
    this.finish('recall');
    return true;
  }

  /** The player is leaving in the middle of the walk. What they collected so far still counts. */
  leave(): void {
    this.finish(this.alertLeft >= 0 ? 'caught' : 'recall');
  }

  /** Stop the walk with no result (the mission itself was dropped). */
  abort(): void {
    if (!this.active) return;
    this.active = false;
    this.alertLeft = -1;
    this.endCinema();
    this.stopDriving();
    this.airlockRing.visible = false;
    this.airlockBeam.visible = false;
    this.clearMarkers();
    this.placeAtAirlock();
  }

  private finish(reason: 'home' | 'timeout' | 'caught' | 'recall'): void {
    if (!this.active) return;
    this.active = false;
    this.alertLeft = -1;
    this.endCinema();
    this.stopDriving();
    this.airlockRing.visible = false;
    this.airlockBeam.visible = false;
    const result: EvaResult = {
      seconds: Math.round(this.elapsed),
      samples: this.samples,
      science: this.science,
      chore: this.choreDone,
      finds: [...this.finds],
      materials: { ...this.materials },
      caught: reason === 'caught',
      alerted: this.alerted,
    };
    const brought = this.samples > 0 || this.finds.length > 0 || this.materials.regolith + this.materials.metal > 0;
    this.astronaut.play(reason === 'caught' ? 'alarm' : brought ? 'cheer' : 'none');
    this.clearMarkers();
    this.placeAtAirlock();
    this.onFinish?.(result, reason);
  }

  private syncAstronaut(speed: number, vy: number): void {
    const ground = this.height(this.position.x, this.position.z);
    this.astronaut.group.position.copy(this.position);
    this.astronaut.group.rotation.y = this.heading;
    this.astronaut.setAltitude(Math.max(0, this.position.y - ground));
    void speed;
    void vy;
  }

  /**
   * Swing the camera to the side so the cadet and the find are both in view. Not
   * during a storm alert, and not for players who asked for less motion.
   */
  private startCinema(marker: Marker): void {
    if (this.alertLeft >= 0 || this.rig.calm) return;
    const toCadet = Math.atan2(this.position.x - marker.x, this.position.z - marker.z);
    // Of the two side views, take the one closer to where the camera already is.
    const left = toCadet + Math.PI / 2;
    const right = toCadet - Math.PI / 2;
    const gap = (a: number): number => Math.abs(Math.atan2(Math.sin(a - this.rig.yaw), Math.cos(a - this.rig.yaw)));
    this.cinemaYaw = gap(left) < gap(right) ? left : right;
    this.cinemaTarget.set((this.position.x + marker.x) / 2, 0, (this.position.z + marker.z) / 2);
    this.cinemaTarget.y = this.height(this.cinemaTarget.x, this.cinemaTarget.z);
    if (this.cinema <= 0) this.cinemaRestore = { distance: this.rig.distance, pitch: this.rig.pitch };
    this.cinema = 2.6;
    // The cadet turns to the find.
    this.heading = Math.atan2(marker.x - this.position.x, marker.z - this.position.z);
    this.velocity.set(0, this.velocity.y, 0);
  }

  private endCinema(): void {
    if (this.cinema <= 0) return;
    this.cinema = 0;
    this.rig.setDistance(this.cinemaRestore.distance);
    this.rig.setAngles(this.rig.yaw, this.cinemaRestore.pitch);
  }

  /** Seconds of the world clock at the last frame (for the digging cursor). */
  private clock = 0;

  update(dt: number, input: InputState, time: number): void {
    this.clock = time;
    const config = this.config;
    const site = config ? SITES[config.site] : SITES.mars;
    const moon = config?.site === 'moon';

    if (this.active && config) {
      // The use button: dig for the bonus, else go through a door, else the rover.
      this.useHeld = input.use;
      if (input.view && !this.driving) {
        this.firstPerson = !this.firstPerson;
        this.onView?.(this.firstPerson);
      }
      if (input.interact) {
        const digging = this.promptMarker;
        // At a metal vein the key is held, not pressed: nothing else happens.
        if (digging && digging.kind === 'metal' && !this.driving) {
          /* the hold-and-release game reads the held key */
        } else if (digging && !this.driving && digging.kind === 'regolith' && !digging.tried) this.tryDig(digging, time);
        else if (this.doorNear >= 0 && !this.driving) this.onEvent?.('door', this.doorNear);
        else this.toggleRover();
      }
      if (this.driving) this.driveStep(dt, input, time);
      else this.walkStep(dt, input, time, site.gravity, moon);

      this.updateMarkers(dt, time);
      this.updateDoors(time);
      this.updateAlert(dt, time);

      const home = Math.hypot(this.position.x - AIRLOCK.x, this.position.z - AIRLOCK.z);
      if (home > 9) this.leftBase = true;
      const sheltered = this.alertLeft >= 0 && !this.driving && this.grounded && this.shelters.some((s) => Math.hypot(this.position.x - s.x, this.position.z - s.z) < 2.6);
      if (this.active && sheltered) {
        // Safe in the storm bunker.
        this.onEvent?.('safe');
        this.finish('home');
      } else if (this.active && this.leftBase && home < (this.driving ? 3.6 : 2.5) && this.grounded) {
        if (this.alertLeft >= 0) this.onEvent?.('safe');
        this.finish('home');
      } else if (this.active && this.elapsed >= this.maxSeconds) {
        this.onEvent?.('timeout');
        this.finish('timeout');
      }
      this.pushHud(false, dt);
    } else {
      // Standing by: breathe, look around.
      this.astronaut.update(dt, { speed: 0, grounded: true, vy: 0, floaty: !!moon });
      this.syncAstronaut(0, 0);
    }

    // The airlock ring breathes so it is easy to find.
    if (this.airlockRing.visible) {
      const pulse = 1 + Math.sin(time * 3) * 0.06;
      this.airlockRing.scale.set(pulse, pulse, 1);
    }
  }

  /**
   * Switch the camera between the cadet's eyes and the usual view behind the cadet. In first person the
   * model is hidden (the camera would sit inside the helmet) and the view is wider.
   */
  private applyView(firstPerson: boolean, keepHidden = false): void {
    const rig = this.rig;
    if (rig.firstPerson !== firstPerson) {
      rig.firstPerson = firstPerson;
      if (!firstPerson) {
        rig.minPitch = 0.08;
        // Looking down (or up) in first person must not leave the camera straight above the cadet or at
        // ground level. Getting into the rover keeps the turn that was just set for it.
        if (keepHidden) rig.clampPitch();
        else rig.setPitchNow(0.24);
      }
      this.onFov?.(firstPerson ? 1.3 : 1);
    }
    rig.followStiffness = firstPerson ? 18 : 7;
    if (firstPerson) {
      rig.minPitch = -1.0;
      rig.maxPitch = 1.15;
      this.astronaut.group.visible = false;
      this.hidByView = true;
    } else {
      rig.minPitch = 0.08;
      rig.maxPitch = 1.15;
      if (this.hidByView && !keepHidden) this.astronaut.group.visible = true;
      this.hidByView = keepHidden ? this.hidByView : false;
    }
  }

  /**
   * The direction (as a camera angle) with the most free room behind the cadet, close to `preferred`.
   * A walk starts at the airlock, among posts and rails: this picks the side where the camera sees the cadet.
   */
  private openYaw(preferred: number): number {
    let best = preferred;
    let bestScore = -Infinity;
    for (let i = 0; i < 24; i++) {
      const yaw = preferred + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12);
      let clear = 99;
      for (let d = 0.8; d <= WALK_DISTANCE; d += 0.6) {
        const x = this.position.x + Math.sin(yaw) * d;
        const z = this.position.z + Math.cos(yaw) * d;
        for (const c of this.colliders) clear = Math.min(clear, Math.hypot(x - c.x, z - c.z) - c.r);
      }
      // Free room matters most; the preferred direction wins a tie.
      const score = Math.min(clear, 1.5) * 10 - Math.abs(yaw - preferred);
      if (score > bestScore) {
        bestScore = score;
        best = yaw;
      }
    }
    return best;
  }

  /** Leave the walk's views (the walk ended, or the camera goes to another job). */
  endView(): void {
    this.applyView(false);
    this.rig.followStiffness = null;
  }

  /** One frame of the cadet on foot. */
  private walkStep(dt: number, input: InputState, time: number, gravity: number, moon: boolean): void {
    // Running: half as fast again, but the body works harder and the suit air goes faster.
    const wantsRun = input.sprint && this.grounded && Math.hypot(input.moveX, input.moveY) > 0.2;
    this.pace += ((wantsRun ? 1 : 0) - this.pace) * Math.min(1, dt * 7);
    if (wantsRun && !this.ranOnce) {
      this.ranOnce = true;
      this.onEvent?.('run');
    }
    // While the camera shows a discovery, the cadet stands still and the suit timer waits.
    const watching = this.cinema > 0;
    if (watching) {
      this.cinema -= dt;
      if (this.cinema <= 0) {
        this.cinema = 0.0001;
        this.endCinema();
      }
    } else {
      this.elapsed += dt * (1 + RUN_AIR * this.pace);
    }
    const walkSpeed = moon ? 5.4 : 6.4;
    const topSpeed = walkSpeed * (1 + RUN_SPEED * this.pace);

    // Steer relative to the camera.
    const yaw = this.rig.yaw;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    // Keys are on or off: easing them (about a tenth of a second) removes the jerk of starting and stopping.
    const ease = Math.min(1, dt * 22);
    this.moveEased.x += ((watching ? 0 : input.moveX) - this.moveEased.x) * ease;
    this.moveEased.y += ((watching ? 0 : input.moveY) - this.moveEased.y) * ease;
    const moveX = Math.abs(this.moveEased.x) < 0.01 ? 0 : this.moveEased.x;
    const moveY = Math.abs(this.moveEased.y) < 0.01 ? 0 : this.moveEased.y;
    const wishX = (forwardX * moveY + rightX * moveX) * topSpeed;
    const wishZ = (forwardZ * moveY + rightZ * moveX) * topSpeed;
    // Less grip in the air; on the Moon you keep drifting.
    const grip = this.grounded ? 12 : moon ? 1.2 : 2.5;
    const k = Math.min(1, dt * grip);
    this.velocity.x += (wishX - this.velocity.x) * k;
    this.velocity.z += (wishZ - this.velocity.z) * k;

    if (input.jump && this.grounded && !watching) {
      this.velocity.y = this.jumpSpeed;
      this.grounded = false;
      this.jumpBase = this.position.y;
      this.jumpPeak = this.position.y;
      this.onEvent?.('jump');
    }
    if (!this.grounded) this.velocity.y -= gravity * dt;

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;

    // Buildings and big rocks push the player out.
    for (const c of this.colliders) {
      const dx = this.position.x - c.x;
      const dz = this.position.z - c.z;
      const dist = Math.hypot(dx, dz);
      const min = c.r + PLAYER_RADIUS;
      if (dist < min && dist > 1e-4) {
        const nx = dx / dist;
        const nz = dz / dist;
        this.position.x = c.x + nx * min;
        this.position.z = c.z + nz * min;
        const into = this.velocity.x * nx + this.velocity.z * nz;
        if (into < 0) {
          this.velocity.x -= into * nx;
          this.velocity.z -= into * nz;
        }
      }
    }
    // The edge of the safe walking area.
    const fromCentre = Math.hypot(this.position.x, this.position.z);
    if (fromCentre > WALK_RADIUS) {
      const scale = WALK_RADIUS / fromCentre;
      this.position.x *= scale;
      this.position.z *= scale;
      if (time - this.edgeWarned > 4) {
        this.edgeWarned = time;
        this.onEvent?.('edge');
      }
    }

    const ground = this.height(this.position.x, this.position.z);
    if (!this.grounded) {
      this.jumpPeak = Math.max(this.jumpPeak, this.position.y);
      if (this.position.y <= ground) {
        this.position.y = ground;
        this.velocity.y = 0;
        this.grounded = true;
        this.lastJump = Math.max(0, this.jumpPeak - this.jumpBase);
        this.onEvent?.('land', this.lastJump);
      }
    } else {
      // Walking off a ledge.
      if (this.position.y - ground > 0.5) this.grounded = false;
      else this.position.y = ground;
    }

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed > 0.4) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      let delta = target - this.heading;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.heading += delta * Math.min(1, dt * 9);
    }
    this.astronaut.update(dt, { speed: Math.min(1.35, speed / walkSpeed), grounded: this.grounded, vy: this.velocity.y, floaty: moon });
    if (this.astronaut.footstep.left || this.astronaut.footstep.right) {
      this.puffs.step(this.position);
      this.onEvent?.('step');
    }
    // Boot prints: one for every stride of ground covered, left and right in turn.
    if (this.grounded && this.tracks) {
      this.trail += speed * dt;
      if (this.trail >= STRIDE) {
        this.trail = 0;
        this.leftFoot = !this.leftFoot;
        this.tracks.add(this.position.x, this.position.y, this.position.z, this.heading, this.leftFoot);
      }
    }
    this.syncAstronaut(speed, this.velocity.y);
    if (this.cinema > 0) {
      // A slow half-turn around the cadet and the find.
      const spent = 2.6 - this.cinema;
      this.applyView(false); // the camera circles cadet and find: it needs the usual view
      this.rig.follow(this.cinemaTarget, 1.1);
      this.rig.setAngles(this.cinemaYaw + spent * 0.16, 0.17);
      this.rig.setDistance(7);
    } else {
      this.applyView(this.firstPerson);
      this.rig.follow(this.position, this.firstPerson ? EYE_HEIGHT : 1.35);
    }

  }

  /** Can the cadet get into the rover now? Standing next to it, on foot, with some battery left. */
  private canDrive(): boolean {
    const rover = this.rover;
    return !!rover && this.active && !this.driving && this.grounded && this.cinema <= 0 && rover.charge > 0.04 && rover.distanceTo(this.position.x, this.position.z) < 3.4;
  }

  /** The "interact" button: get into the rover, or out of it. */
  private toggleRover(): void {
    const rover = this.rover;
    if (!rover || this.cinema > 0) return;
    if (!this.driving) {
      if (!this.canDrive()) return;
      this.driving = true;
      rover.setDriving(true);
      this.astronaut.group.visible = false;
      this.velocity.set(0, 0, 0);
    this.moveEased.x = this.moveEased.y = 0;
      this.pace = 0;
      this.rig.setDistance(11);
      this.rig.setAngles(rover.heading + Math.PI, 0.3);
      this.onEvent?.('drive');
      return;
    }
    // Getting out takes a stop: not at speed.
    if (Math.abs(rover.speed) > 2.5) return;
    const spots = rover.exitSpots();
    const spot = spots.find((point) => this.free(point.x, point.z, 0.5) && Math.hypot(point.x, point.z) < WALK_RADIUS - 1) ?? spots[0];
    this.driving = false;
    rover.setDriving(false);
    this.position.set(spot.x, this.height(spot.x, spot.z), spot.z);
    this.heading = rover.heading;
    this.velocity.set(0, 0, 0);
    this.moveEased.x = this.moveEased.y = 0;
    this.grounded = true;
    this.astronaut.group.visible = true;
    this.astronaut.play('none');
    this.syncAstronaut(0, 0);
    this.rig.setDistance(WALK_DISTANCE);
    this.onEvent?.('park');
  }

  /** Back on foot at once, with the rover sent home (the walk ends, or is given up). */
  private stopDriving(): void {
    if (this.driving) this.onEvent?.('park');
    this.driving = false;
    this.astronaut.group.visible = true;
    this.rover?.park();
  }

  /** One frame inside the rover. Suit time runs slower: the cabin has its own air. */
  private driveStep(dt: number, input: InputState, time: number): void {
    const rover = this.rover;
    if (!rover) return;
    if (this.rig.firstPerson) this.applyView(false, true);
    this.elapsed += dt * ROVER_TIME;
    const hit = rover.update(dt, input.moveY, input.moveX, this.colliders);
    this.position.set(rover.x, rover.y, rover.z);
    this.heading = rover.heading;
    this.velocity.set(Math.sin(rover.heading) * rover.speed, 0, Math.cos(rover.heading) * rover.speed);
    this.grounded = true;

    if (hit > 3.5 && time - this.lastBump > 0.5) {
      this.lastBump = time;
      this.rig.addShake(Math.min(0.45, hit * 0.045));
      this.onEvent?.('bump', hit);
    }
    if (rover.takeDust()) {
      this.dustSide = this.dustSide === 1 ? -1 : 1;
      this.puffs.step(rover.rearWheel(this.dustSide, this.tmp));
    }
    if (rover.charge <= 0.002 && !this.emptyWarned) {
      this.emptyWarned = true;
      this.onEvent?.('roverEmpty');
    }
    if (Math.hypot(rover.x, rover.z) > WALK_RADIUS - 4 && time - this.edgeWarned > 4) {
      this.edgeWarned = time;
      this.onEvent?.('edge');
    }

    // The camera follows from behind, and settles there when the player stops moving it.
    this.rig.follow(this.position, 1.7);
    if (this.rig.idle > 1.2 && !this.rig.calm) this.rig.setAngles(rover.heading + Math.PI, 0.3);
  }

  private updateMarkers(dt: number, time: number): void {
    let prompt: Marker | null = null;
    for (const marker of this.markers) {
      if (marker.done) continue;
      marker.gem.rotation.y = time * 1.6;
      marker.gem.position.y = (marker.kind === 'find' ? 2.7 : 1.7) + Math.sin(time * 2.4 + marker.x) * 0.16;
      if (marker.kind === 'find') {
        // The star guides from afar; up close it shrinks out of the way of the find itself.
        const away = Math.hypot(this.position.x - marker.x, this.position.z - marker.z);
        const t = Math.min(1, Math.max(0, (away - 4) / 12));
        marker.gem.scale.setScalar(0.3 + 0.7 * t * t * (3 - 2 * t));
      }
      const pulse = 1 + Math.sin(time * 3.2 + marker.z) * 0.08;
      marker.ring.scale.set(pulse, pulse, 1);

      const near = Math.hypot(this.position.x - marker.x, this.position.z - marker.z) < marker.reach && this.grounded && !this.driving;
      if (near) {
        // Stand close and the work happens by itself: no button needed for small hands.
        const base = marker.kind === 'chore' ? 2.2 : marker.kind === 'find' ? 1.1 : marker.kind === 'regolith' ? DIG_TIME.regolith : marker.kind === 'metal' ? DIG_TIME.metal : 0.7;
        const duration = base * (this.drill && marker.kind !== 'find' && marker.kind !== 'chore' ? TOOL_EFFECT.drillTime : 1);
        if (marker.kind === 'metal') {
          // Hold to lift the marker, let go to let it sink; the vein's zone wanders. Inside it, the cutting goes on.
          const game = this.tension;
          if (game.marker !== marker) Object.assign(game, { marker, cursor: 0.15, speed: 0, clock: 0, outside: 0 });
          game.clock += dt;
          game.zone = 0.5 + Math.sin(game.clock * 0.85 + marker.x) * 0.27 + Math.sin(game.clock * 2.1 + marker.z) * 0.08;
          game.speed += (this.useHeld ? 2.4 : -2.2) * dt;
          game.speed *= Math.exp(-dt * 0.9);
          game.cursor += game.speed * dt;
          if (game.cursor < 0) {
            game.cursor = 0;
            game.speed = Math.max(0, game.speed) * 0.3;
          } else if (game.cursor > 1) {
            game.cursor = 1;
            game.speed = Math.min(0, game.speed) * 0.3;
          }
          const width = this.drill ? 0.3 : 0.22;
          game.inside = Math.abs(game.cursor - game.zone) < width / 2;
          if (game.inside) marker.progress += dt / duration;
          else {
            marker.progress = Math.max(0, marker.progress - dt * 0.1);
            game.outside += dt;
          }
          if (marker.progress >= 1) {
            const clean = game.outside < 0.9;
            if (clean) this.onEvent?.('perfect');
            this.collect(marker, clean);
            game.marker = null;
            prompt = null;
            continue;
          }
        } else {
          marker.progress += dt / duration;
        }
        prompt = marker;
        this.astronaut.play('drill');
        if (marker.progress >= 1) {
          marker.done = true;
          marker.group.visible = false;
          this.astronaut.play('cheer');
          this.tmp.set(marker.x, this.height(marker.x, marker.z) + 1, marker.z);
          if (marker.kind === 'sample') {
            this.samples += 1;
            this.science += marker.value;
            this.puffs.burst(this.tmp, SAMPLE_COLORS[SAMPLE_VALUES.indexOf(marker.value)] ?? '#ffffff');
            this.onEvent?.('sample', marker.value);
          } else if (marker.kind === 'regolith' || marker.kind === 'metal') {
            this.collect(marker, false);
          } else if (marker.kind === 'find' && marker.id) {
            // The find itself stays where it is; only the gold star goes.
            const id = marker.id;
            this.finds.push(id);
            this.findScience += marker.value;
            this.puffs.burst(this.tmp, '#ffd166', 20);
            this.onEvent?.('find', FINDS[this.config?.site ?? 'mars'].findIndex((find) => find.id === id));
            this.startCinema(marker);
          } else {
            this.choreDone = true;
            this.puffs.burst(this.tmp, '#ffd166', 16);
            this.onEvent?.('chore');
          }
        }
      } else if (marker.progress > 0) {
        marker.progress = Math.max(0, marker.progress - dt * 2);
        if (marker.progress === 0) this.astronaut.play('none');
      }
    }
    this.promptMarker = prompt;
  }

  private promptMarker: Marker | null = null;

  /** Where the cursor of the digging timing bar is now, 0-1 and back. */
  private sweepAt(time: number): number {
    const phase = (time * 1.25) % 2;
    return phase < 1 ? phase : 2 - phase;
  }

  /** One press while digging: in the gold zone the heap is done at once, with one more. */
  private tryDig(marker: Marker, time: number): void {
    marker.tried = true;
    const sweep = this.sweepAt(time);
    if (sweep >= GOLD[0] && sweep <= GOLD[1]) {
      this.onEvent?.('perfect');
      this.collect(marker, true);
    } else {
      this.onEvent?.('miss');
      this.rig.addShake(0.12);
    }
  }

  /** A heap or a metal rock is dug out: the material goes into the pack. */
  private collect(marker: Marker, bonus: boolean): void {
    const kind = marker.kind as 'regolith' | 'metal';
    marker.done = true;
    marker.group.visible = false;
    const amount = marker.value + (bonus ? 1 : 0) + (this.drill ? TOOL_EFFECT.drillBonus : 0);
    this.materials[kind] += amount;
    this.astronaut.play('cheer');
    this.tmp.set(marker.x, this.height(marker.x, marker.z) + 0.8, marker.z);
    this.puffs.burst(this.tmp, MATERIAL_COLOR[kind], bonus ? 22 : 14);
    this.onEvent?.(kind, amount);
  }

  private updateDoors(time: number): void {
    this.doorNear = -1;
    this.doors.forEach((door, index) => {
      door.gem.rotation.y = time * 1.3;
      door.gem.position.y = 2.3 + Math.sin(time * 2.1 + door.x) * 0.1;
      const near = !this.driving && this.grounded && this.alertLeft < 0 && Math.hypot(this.position.x - door.x, this.position.z - door.z) < 1.8;
      if (near) this.doorNear = index;
      const pulse = 1 + Math.sin(time * 3 + door.z) * 0.06 + (near ? 0.16 : 0);
      door.ring.scale.set(pulse, pulse, 1);
    });
  }

  private updateAlert(dt: number, time: number): void {
    const config = this.config!;
    if (this.alertAt >= 0 && this.alertLeft < 0 && !this.alerted && this.elapsed >= this.alertAt) {
      this.alerted = true;
      this.alertLeft = config.alertSeconds;
      this.airlockBeam.visible = true;
      for (const shelter of this.shelters) {
        shelter.beam.visible = true;
        shelter.ring.visible = true;
      }
      this.astronaut.play('alarm');
      this.rig.addShake(0.6);
      this.onEvent?.('alert');
    }
    if (this.alertLeft >= 0) {
      this.alertLeft -= dt;
      (this.airlockBeam.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.12 * Math.sin(time * 9);
      if (this.alertLeft <= 0) {
        this.alertLeft = -1;
        this.rig.addShake(1);
        this.onEvent?.('caught');
        this.finish('caught');
      }
    }
  }

  /** Storm alert progress 0-1 (0 = none), for sky and screen effects. */
  get alertLevel(): number {
    if (!this.active || this.alertLeft < 0 || !this.config) return 0;
    return 0.35 + 0.65 * (1 - this.alertLeft / this.config.alertSeconds);
  }

  private bearingTo(x: number, z: number): number {
    // Angle between the camera's forward direction and the direction to the point.
    const yaw = this.rig.yaw;
    const forward = Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
    const to = Math.atan2(x - this.position.x, z - this.position.z);
    let delta = forward - to;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    return delta;
  }

  private pushHud(force: boolean, dt = 0): void {
    this.hudTimer -= dt;
    // While digging the timing cursor moves every frame, so the screen hears about it every frame.
    const busy = this.promptMarker && (this.promptMarker.kind === 'regolith' || this.promptMarker.kind === 'metal');
    if (!force && this.hudTimer > 0 && !busy) return;
    this.hudTimer = 0.08;
    if (!this.onHud || !this.config) return;
    let nearest: Marker | null = null;
    let nearestDistance = Infinity;
    for (const marker of this.markers) {
      if (marker.done || marker.kind !== 'sample') continue;
      const d = Math.hypot(marker.x - this.position.x, marker.z - this.position.z);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearest = marker;
      }
    }
    const prompt = this.promptMarker;
    const digging = !!prompt && (prompt.kind === 'regolith' || prompt.kind === 'metal');
    this.onHud({
      timeLeft: Math.max(0, this.maxSeconds - this.elapsed),
      total: this.maxSeconds,
      samples: this.samples,
      samplesTotal: this.markers.filter((m) => m.kind === 'sample').length,
      science: this.science + this.findScience,
      sampleScience: this.science,
      choreAvailable: this.config.choreAvailable,
      choreDone: this.choreDone,
      prompt:
        prompt && !prompt.done
          ? {
              kind: prompt.kind,
              progress: Math.min(1, prompt.progress),
              ...(digging && prompt.kind === 'regolith' ? { sweep: this.sweepAt(this.clock), zone: GOLD, tried: !!prompt.tried } : {}),
              ...(prompt.kind === 'metal'
                ? { tension: { cursor: this.tension.cursor, zone: this.tension.zone, width: this.drill ? 0.3 : 0.22, inside: this.tension.inside } }
                : {}),
            }
          : null,
      door: this.doorNear >= 0 ? this.doors[this.doorNear].room : null,
      materials: { ...this.materials },
      scanner: this.scanner,
      alert: this.alertLeft >= 0 ? this.alertLeft : null,
      home: Math.hypot(this.position.x - this.safePlace().x, this.position.z - this.safePlace().z),
      homeBearing: this.bearingTo(this.safePlace().x, this.safePlace().z),
      nextBearing: nearest ? this.bearingTo(nearest.x, nearest.z) : null,
      nextDistance: nearest ? nearestDistance : null,
      airUsed: Math.min(9, Math.round(this.elapsed * EVA_AIR_PER_SECOND)),
      lastJump: this.lastJump,
      running: this.pace > 0.5,
      finds: this.config.found.length + this.finds.length,
      findsTotal: FINDS[this.config.site].length,
      canDrive: this.canDrive(),
      driving: this.driving,
      charge: this.rover ? this.rover.charge : 0,
      driveSpeed: this.driving && this.rover ? Math.abs(this.rover.speed) : 0,
      motor: this.driving && this.rover ? Math.min(1, Math.abs(this.rover.speed) / this.rover.top) : 0,
    });
  }

  dispose(): void {
    this.clearMarkers();
    this.airlockRing.geometry.dispose();
    this.airlockBeam.geometry.dispose();
    for (const material of this.ownMaterials) material.dispose();
    void dotTexture;
  }
}
