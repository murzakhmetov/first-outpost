/**
 * Inside the buildings: a small 3D room for each building the cadet can walk into.
 *
 * Each room is its own scene with its own lamps. The cadet walks in it with the
 * same controls as outside, Lumi floats along, and "stations" (the air machine,
 * the plant racks, the spectrometer, the 3D printer, the way out) are marked with
 * a glowing ring on the floor: stand in it and press the use button. The room
 * shells (floor, curved walls, ribs, windows) are made here in code; furniture and
 * machines come from the Blender model "interior", with plain stand-ins until it
 * is loaded.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from '../sim/rng';
import type { RoomId } from '../sim/outpost';
import { SITES } from '../sim/sites';
import type { SiteId } from '../sim/types';
import { Astronaut, SUIT_COLORS } from './astronaut';
import type { Emote } from './astronaut';
import type { Collider } from './base';
import { Kit, disposeTree, shape } from './build';
import type { Geo } from './build';
import type { CameraRig } from './cameraRig';
import type { InputState } from './input';
import type { Lumi } from './lumi';
import { GLOBALS, canvasTexture, glow, toon } from './materials';
import { flag } from './devflags';
import { emblemTexture } from './textures';
import { hasModel, modelPart } from './models';
import type { PostFX } from './post';
import { RoomLight } from './interiorLight';

export type StationKind = 'exit' | 'game' | 'printer' | 'look';

/** A place in a room where the cadet can do something. */
export interface Station {
  /** 'exit', 'game', 'printer', or for 'look' the Science-log card it tells about. */
  id: string;
  kind: StationKind;
  /** The thing it belongs to (a prop name), for the label on screen. */
  thing: string;
  x: number;
  z: number;
}

export interface InteriorHud {
  room: RoomId;
  /** The station the cadet stands at, if any. */
  station: (Station & { done: boolean }) | null;
}

/** What a room shows of the mission. */
export interface RoomLook {
  site: SiteId;
  /** Ids of stations already used (their sign turns green). */
  done: string[];
  stock: { regolith: number; metal: number };
}

// ---------------------------------------------------------------------------
// Furniture and machines: sizes (W × D × H, metres) of the Blender props.
// ---------------------------------------------------------------------------

interface Size {
  w: number;
  d: number;
  h: number;
  /** Round things collide as one circle. */
  round?: boolean;
  /** Hung on a wall or a ceiling: nothing to bump into. */
  free?: boolean;
}

const SIZE: Record<string, Size> = {
  bunk_bed: { w: 2.11, d: 1.03, h: 1.9 },
  table_round: { w: 1.3, d: 1.3, h: 0.96, round: true },
  stool: { w: 0.42, d: 0.42, h: 0.46, round: true },
  galley: { w: 2.44, d: 0.72, h: 2.11 },
  air_machine: { w: 1.41, d: 0.89, h: 2.2 },
  water_recycler: { w: 1.01, d: 0.75, h: 1.79 },
  exercise_bike: { w: 1.07, d: 0.62, h: 1.18 },
  locker: { w: 0.71, d: 0.6, h: 2 },
  plant_rack: { w: 2.42, d: 0.82, h: 2.2 },
  pepper_plant: { w: 0.55, d: 0.48, h: 0.75, round: true },
  garden_bed: { w: 2.05, d: 1.06, h: 0.65 },
  dwarf_tree: { w: 1.17, d: 1.06, h: 1.89, round: true },
  water_tank: { w: 0.88, d: 0.88, h: 1.61, round: true },
  farm_console: { w: 0.91, d: 0.52, h: 1.3 },
  bench: { w: 1.6, d: 0.49, h: 0.5 },
  lab_bench: { w: 2.4, d: 0.81, h: 1.49 },
  sample_shelf: { w: 1.6, d: 0.41, h: 1.8 },
  spectrometer: { w: 1.21, d: 0.76, h: 1.43 },
  radio_console: { w: 2, d: 0.79, h: 1.5 },
  printer_3d: { w: 1.82, d: 1.42, h: 2.2 },
  workbench: { w: 2.2, d: 0.91, h: 1.44 },
  tool_wall: { w: 2.4, d: 0.15, h: 2.5, free: true },
  crate_regolith: { w: 0.81, d: 0.82, h: 0.71 },
  metal_rack: { w: 1.4, d: 0.6, h: 1.2 },
  robot_arm: { w: 0.8, d: 0.8, h: 1.73, round: true },
  telescope: { w: 1.6, d: 1.6, h: 3.2, round: true },
  star_console: { w: 1.6, d: 0.87, h: 1.3 },
  airlock_door: { w: 1.8, d: 0.46, h: 2.5, free: true },
  ceiling_light: { w: 0.9, d: 0.9, h: 0.15, free: true },
  crate_small: { w: 0.6, d: 0.5, h: 0.45 },
  floor_hatch: { w: 1.2, d: 1.2, h: 0.05, free: true },
  pilot_seat: { w: 0.76, d: 0.91, h: 1.3 },
  cockpit_console: { w: 2.6, d: 0.82, h: 1.39 },
  supply_rack: { w: 1.2, d: 0.5, h: 2 },
  hatch_ladder: { w: 0.9, d: 0.9, h: 2.4, round: true },
  window: { w: 0.1, d: 0.1, h: 2.2, free: true },
};

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

type Shell =
  | { kind: 'dome'; r: number; h: number; roof?: 'glass' | 'slit' }
  | { kind: 'hall'; w: number; l: number; wall: number; rise: number; roof?: 'glass' };

interface Placed {
  name: string;
  x: number;
  z: number;
  /** Turn: the prop's front (+Z) is turned to face (sin rot, cos rot). */
  rot: number;
  y?: number;
  scale?: number;
}

interface Tone {
  wall: string;
  seam: string;
  floor: string;
  floorLine: string;
  rib: string;
  accent: string;
  /** Background seen nowhere but in gaps: the room is closed. */
  dark: string;
  key: string;
  keyPower: number;
  sky: string;
  ground: string;
  hemi: number;
  rim: string;
  lamps: { color: string; x: number; y: number; z: number; power: number; reach: number }[];
  grade: { exposure: number; saturation: number; contrast: number; tint: [number, number, number]; bloom: number; vignette: number };
}

interface Plan {
  /** How far in from the door the cadet starts, in metres (default 2.3). */
  spawnIn?: number;
  shell: Shell;
  props: Placed[];
  stations: Station[];
  /** Round windows: centre and the way they face (toward the room). */
  windows: { x: number; y: number; z: number; r: number }[];
  tone: Tone;
  /** Pictures and screens on the walls, and a globe. Domes give an angle (0° = door) and a height; halls a point on a wall. */
  decor?: Decor[];
  /** Crewmates at work in the room: where they stand and the way they face. */
  mates?: { x: number; z: number; rot: number }[];
  /** Light strips along the walls or the roof. */
  strips: { from: [number, number, number]; to: [number, number, number]; color: string; width?: number }[];
}

type Art = 'earth' | 'status' | 'periodic' | 'blueprint' | 'stars' | 'plants' | 'emblem';

type Decor =
  | { kind: 'picture'; art: Art; w: number; h: number; angle?: number; y: number; x?: number; z?: number; side?: -1 | 0 | 1 }
  | { kind: 'globe'; x: number; y: number; z: number; r: number; /** On a tall stand on the floor, not on a table. */ floor?: boolean };

const DEG = Math.PI / 180;

/** Height of the inside of a dome at a distance from its middle. */
function domeRadiusAt(shell: { r: number; h: number }, y: number): number {
  return shell.r * Math.sqrt(Math.max(0, 1 - (y / shell.h) ** 2));
}

/** Half the width of a hall at a height. */
function hallHalfAt(shell: { w: number; wall: number; rise: number }, y: number): number {
  if (y <= shell.wall) return shell.w / 2;
  return (shell.w / 2) * Math.sqrt(Math.max(0, 1 - ((y - shell.wall) / shell.rise) ** 2));
}

/** A prop standing against the wall of a dome, facing the middle. Angle 0° is the door (+Z), 90° is +X. */
function domeWall(shell: { r: number; h: number }, name: string, angle: number, gap = 0.14): Placed {
  const size = SIZE[name];
  const a = angle * DEG;
  const reach = domeRadiusAt(shell, Math.min(size.h, shell.h * 0.96)) - gap;
  const distance = Math.sqrt(Math.max(0, reach * reach - (size.w / 2) ** 2)) - size.d / 2;
  return { name, x: Math.sin(a) * distance, z: Math.cos(a) * distance, rot: a + Math.PI };
}

/** A prop against a side wall of a hall (side -1 = left, facing +X), or the back wall (side 0, facing +Z). */
function hallWall(shell: { w: number; l: number; wall: number; rise: number }, name: string, side: -1 | 0 | 1, along: number, gap = 0.14): Placed {
  const size = SIZE[name];
  if (side === 0) return { name, x: along, z: -(shell.l / 2 - gap - size.d / 2), rot: 0 };
  const x = hallHalfAt(shell, Math.min(size.h, shell.wall + shell.rise * 0.9)) - gap - size.d / 2;
  return { name, x: side * x, z: along, rot: side === -1 ? Math.PI / 2 : -Math.PI / 2 };
}

/** The station in front of a placed prop. */
function before(prop: Placed, kind: StationKind, id: string, extra = 0.75): Station {
  const size = SIZE[prop.name];
  const out = size.d / 2 + extra;
  return { id, kind, thing: prop.name, x: prop.x + Math.sin(prop.rot) * out, z: prop.z + Math.cos(prop.rot) * out };
}

function door(z: number): { prop: Placed; station: Station } {
  const prop: Placed = { name: 'airlock_door', x: 0, z, rot: Math.PI };
  return { prop, station: { id: 'exit', kind: 'exit', thing: 'airlock_door', x: 0, z: z - 1.05 } };
}

const WHITE_GRADE = { exposure: 1.02, saturation: 1.1, contrast: 1.05, tint: [1, 0.985, 0.96] as [number, number, number], bloom: 0.62, vignette: 0.42 };

function habPlan(): Plan {
  const shell = { kind: 'dome' as const, r: 8.6, h: 6.2 };
  const exit = door(shell.r - 0.3);
  const air = domeWall(shell, 'air_machine', 180);
  const water = domeWall(shell, 'water_recycler', 146);
  const galley = domeWall(shell, 'galley', 214);
  const bike = domeWall(shell, 'exercise_bike', 300);
  const props: Placed[] = [
    exit.prop,
    air,
    water,
    galley,
    bike,
    domeWall(shell, 'bunk_bed', 96),
    domeWall(shell, 'bunk_bed', 262),
    domeWall(shell, 'locker', 58),
    domeWall(shell, 'locker', 66),
    domeWall(shell, 'crate_small', 124),
    { name: 'table_round', x: 0, z: -0.6, rot: 0 },
    ...[45, 135, 225, 315].map((a) => ({ name: 'stool', x: Math.sin(a * DEG) * 1.12, z: -0.6 + Math.cos(a * DEG) * 1.12, rot: a * DEG + Math.PI })),
    { name: 'ceiling_light', x: 0, z: 0, rot: 0, y: shell.h - 0.02 },
  ];
  return {
    shell,
    props,
    stations: [exit.station, before(air, 'game', 'game:pipes'), before(water, 'look', 'water_recycling'), before(galley, 'look', 'daily_needs'), before(bike, 'look', 'crew_rest')],
    mates: [{ x: galley.x * 0.78, z: galley.z * 0.78, rot: galley.rot + Math.PI }],
    decor: [
      { kind: 'picture', art: 'emblem', w: 1.3, h: 1.3, angle: 180, y: 3.35 },
      { kind: 'picture', art: 'earth', w: 1.2, h: 0.85, angle: 282, y: 2.45 },
      { kind: 'picture', art: 'status', w: 1.1, h: 0.7, angle: 78, y: 2.45 },
    ],
    windows: [32, 328, 120, 240].map((a) => {
      const y = 2.55;
      const r = domeRadiusAt(shell, y) - 0.05;
      return { x: Math.sin(a * DEG) * r, y, z: Math.cos(a * DEG) * r, r: 0.62 };
    }),
    strips: [],
    tone: {
      wall: '#efe8dc',
      seam: '#d3c9b8',
      floor: '#4d5577',
      floorLine: '#3b4263',
      rib: '#c8cfdc',
      accent: '#39c2f0',
      dark: '#141826',
      key: '#fff1dc',
      keyPower: 1.55,
      sky: '#fff5e8',
      ground: '#6a5f88',
      hemi: 1.05,
      rim: '#fff0d8',
      lamps: [
        { color: '#ffd59a', x: 0, y: 4.2, z: 0, power: 14, reach: 13 },
        { color: '#5fd0ff', x: air.x * 0.7, y: 1.6, z: air.z * 0.7, power: 3.5, reach: 5 },
      ],
      grade: WHITE_GRADE,
    },
  };
}

function farmPlan(look: RoomLook, garden: boolean): Plan {
  if (garden) return gardenPlan(look);
  const shell = { kind: 'hall' as const, w: 7.8, l: 14, wall: 1.7, rise: 3.6, roof: 'glass' as const };
  const exit = door(shell.l / 2 - 0.3);
  const consolePlace = hallWall(shell, 'farm_console', 0, 0);
  const racks = [-4.4, -1.4, 1.6].flatMap((z) => [hallWall(shell, 'plant_rack', -1, z), hallWall(shell, 'plant_rack', 1, z)]);
  const props: Placed[] = [
    exit.prop,
    consolePlace,
    ...racks,
    hallWall(shell, 'water_tank', 0, 2.4),
    hallWall(shell, 'pepper_plant', 0, -2.0),
    hallWall(shell, 'pepper_plant', 0, -2.7),
    { name: 'crate_small', x: 2.7, z: 4.9, rot: -0.3 },
    { name: 'crate_small', x: -2.75, z: 5.0, rot: 0.2 },
  ];
  const top = shell.wall + shell.rise;
  return {
    shell,
    props,
    stations: [exit.station, before(consolePlace, 'game', 'game:plants'), before(racks[2], 'look', 'space_farming', 0.7)],
    mates: [{ x: 1.3, z: 1.6, rot: -Math.PI / 2 }],
    decor: [{ kind: 'picture', art: 'plants', w: 1.5, h: 1.0, x: 2.2, y: 2.4, side: 0 }],
    windows: [{ x: 0, y: 2.9, z: -shell.l / 2 + 0.06, r: 0.75 }],
    strips: [-1.25, 1.25].map((x) => ({ from: [x, top - 0.18, -shell.l / 2 + 0.6] as [number, number, number], to: [x, top - 0.18, shell.l / 2 - 0.6] as [number, number, number], color: '#ff6fcf', width: 0.07 })),
    tone: {
      wall: '#e6efe7',
      seam: '#c7d5ca',
      floor: '#4a5a62',
      floorLine: '#3a4950',
      rib: '#d2dbe0',
      accent: '#ff6fcf',
      dark: '#101c1a',
      key: '#fff4fb',
      keyPower: 1.35,
      sky: '#ffe9f6',
      ground: '#4f6a5c',
      hemi: 1.1,
      rim: '#ffd9f1',
      lamps: [
        { color: '#ff7bd5', x: 0, y: 3.2, z: -2, power: 10, reach: 10 },
        { color: '#ff9ee0', x: 0, y: 3.2, z: 3, power: 8, reach: 9 },
      ],
      grade: { exposure: 1.03, saturation: 1.14, contrast: 1.05, tint: [1.02, 0.97, 1.02], bloom: 0.7, vignette: 0.4 },
    },
  };
}

function gardenPlan(_look: RoomLook): Plan {
  const shell = { kind: 'dome' as const, r: 9.4, h: 7.0, roof: 'glass' as const };
  const exit = door(shell.r - 0.3);
  const consolePlace = domeWall(shell, 'farm_console', 180);
  const beds = [50, 130, 230, 310].map((a) => ({ name: 'garden_bed', x: Math.sin(a * DEG) * 3.2, z: -0.4 + Math.cos(a * DEG) * 3.2, rot: a * DEG + Math.PI / 2 }));
  const peppers = [150, 158, 202, 210].map((a) => domeWall(shell, 'pepper_plant', a));
  const props: Placed[] = [
    exit.prop,
    consolePlace,
    { name: 'dwarf_tree', x: 0, z: -0.4, rot: 0.4 },
    ...beds,
    ...peppers,
    domeWall(shell, 'plant_rack', 104),
    domeWall(shell, 'plant_rack', 256),
    domeWall(shell, 'bench', 62),
    domeWall(shell, 'bench', 298),
    domeWall(shell, 'water_tank', 226),
  ];
  return {
    shell,
    props,
    stations: [exit.station, before(consolePlace, 'game', 'game:plants'), before(peppers[0], 'look', 'space_peppers', 0.6), before(beds[0], 'look', 'zinnias', 0.6)],
    windows: [],
    strips: [],
    tone: {
      wall: '#e5f1e8',
      seam: '#c4d6c9',
      floor: '#55604f',
      floorLine: '#454f40',
      rib: '#dfe6e2',
      accent: '#4fd98a',
      dark: '#0f1c16',
      key: '#fff6e2',
      keyPower: 1.7,
      sky: '#f6fff0',
      ground: '#4f6a52',
      hemi: 1.15,
      rim: '#fff6dc',
      lamps: [{ color: '#fff2c8', x: 0, y: 5, z: 0, power: 12, reach: 16 }],
      grade: { exposure: 1.04, saturation: 1.16, contrast: 1.04, tint: [1, 1.01, 0.97], bloom: 0.55, vignette: 0.38 },
    },
  };
}

function labPlan(): Plan {
  const shell = { kind: 'hall' as const, w: 7.4, l: 13, wall: 2.0, rise: 3.0 };
  const exit = door(shell.l / 2 - 0.3);
  const spectro = hallWall(shell, 'spectrometer', 0, 0);
  const shelf = hallWall(shell, 'sample_shelf', 1, -2.7);
  const radio = hallWall(shell, 'radio_console', 1, 1.2);
  const props: Placed[] = [
    exit.prop,
    spectro,
    shelf,
    radio,
    hallWall(shell, 'lab_bench', -1, -2.6),
    hallWall(shell, 'lab_bench', -1, 0.6),
    { name: 'stool', x: -1.95, z: -1.3, rot: 0 },
    { name: 'stool', x: -1.95, z: 1.75, rot: 0 },
    hallWall(shell, 'crate_small', 0, -2.4),
    { name: 'ceiling_light', x: 0, z: -2.5, rot: 0, y: shell.wall + shell.rise - 0.02 },
    { name: 'ceiling_light', x: 0, z: 2.5, rot: 0, y: shell.wall + shell.rise - 0.02 },
  ];
  return {
    shell,
    props,
    stations: [exit.station, before(spectro, 'game', 'game:spectro'), before(shelf, 'look', 'samples', 0.7), before(radio, 'game', 'game:signal', 0.7), before(props[5], 'look', 'laser_spectrometer', 0.7)],
    mates: [{ x: -1.75, z: -2.6, rot: -Math.PI / 2 }],
    decor: [
      { kind: 'picture', art: 'periodic', w: 1.5, h: 1.0, x: -2.3, y: 2.35, side: 0 },
      { kind: 'picture', art: 'status', w: 1.2, h: 0.75, x: 2.3, y: 2.35, side: 0 },
      { kind: 'globe', x: -2.9, y: 1.3, z: 0.95, r: 0.3 },
    ],
    windows: [{ x: 0, y: 2.75, z: -shell.l / 2 + 0.06, r: 0.7 }],
    strips: [-1, 1].map((side) => ({
      from: [side * (shell.w / 2 - 0.08), shell.wall - 0.1, -shell.l / 2 + 0.5] as [number, number, number],
      to: [side * (shell.w / 2 - 0.08), shell.wall - 0.1, shell.l / 2 - 0.5] as [number, number, number],
      color: '#8f7bff',
      width: 0.05,
    })),
    tone: {
      wall: '#ebe8f3',
      seam: '#cdc8de',
      floor: '#47486a',
      floorLine: '#393a58',
      rib: '#cfd2e2',
      accent: '#8f7bff',
      dark: '#13122a',
      key: '#eef2ff',
      keyPower: 1.45,
      sky: '#f2f0ff',
      ground: '#5a5486',
      hemi: 1.05,
      rim: '#e6e0ff',
      lamps: [
        { color: '#b8a8ff', x: 0, y: 3.4, z: -2, power: 9, reach: 10 },
        { color: '#7fe0ff', x: 0, y: 1.8, z: -4.3, power: 6, reach: 6 },
      ],
      grade: { exposure: 1.02, saturation: 1.1, contrast: 1.06, tint: [0.98, 0.98, 1.03], bloom: 0.66, vignette: 0.42 },
    },
  };
}

function workshopPlan(look: RoomLook): Plan {
  const shell = { kind: 'hall' as const, w: 10.6, l: 13, wall: 3, rise: 2.8 };
  const exit = door(shell.l / 2 - 0.3);
  const printer = hallWall(shell, 'printer_3d', 0, 0, 0.5);
  const tools: Placed = { ...hallWall(shell, 'tool_wall', -1, -0.9, 0.04) };
  // One crate for every few sacks of regolith in store, and the metal rack.
  const crates = Math.max(1, Math.min(4, Math.ceil(look.stock.regolith / 4)));
  const props: Placed[] = [
    exit.prop,
    printer,
    tools,
    hallWall(shell, 'workbench', -1, -0.9, 0.25),
    { name: 'robot_arm', x: 2.6, z: -4.2, rot: -0.7 },
    ...Array.from({ length: crates }, (_, index) => hallWall(shell, 'crate_regolith', 1, -2.2 + index * 1.0)),
    hallWall(shell, 'metal_rack', 1, 2.4),
    { name: 'crate_small', x: -3.9, z: 4.4, rot: 0.3 },
    { name: 'crate_small', x: -3.3, z: 4.9, rot: -0.2 },
    { name: 'floor_hatch', x: 0, z: 0.6, rot: 0 },
    { name: 'ceiling_light', x: -2.2, z: -1, rot: 0, y: shell.wall + shell.rise - 0.02 },
    { name: 'ceiling_light', x: 2.2, z: -1, rot: 0, y: shell.wall + shell.rise - 0.02 },
  ];
  return {
    shell,
    props,
    stations: [exit.station, before(printer, 'printer', 'printer', 0.8), before(props[5], 'look', 'regolith_shield', 0.7), before(props[3], 'look', 'space_printer', 0.7)],
    mates: [{ x: -3.3, z: -0.4, rot: -Math.PI / 2 }],
    decor: [{ kind: 'picture', art: 'blueprint', w: 1.8, h: 1.2, x: 2.8, y: 2.6, side: 0 }],
    windows: [-3, 3].map((x) => ({ x, y: 3.9, z: -shell.l / 2 + 0.06, r: 0.62 })),
    strips: [],
    tone: {
      wall: '#ebe4d7',
      seam: '#d1c6b1',
      floor: '#525064',
      floorLine: '#423f52',
      rib: '#cfd3db',
      accent: '#ff8a3d',
      dark: '#1b1620',
      key: '#ffe9c8',
      keyPower: 1.55,
      sky: '#fff2df',
      ground: '#6b5a62',
      hemi: 1.05,
      rim: '#ffe7c4',
      lamps: [
        { color: '#ffb36b', x: 0, y: 2.6, z: -3.6, power: 9, reach: 8 },
        { color: '#ffd9a0', x: 0, y: 4.5, z: 1.5, power: 10, reach: 14 },
      ],
      grade: { exposure: 1.02, saturation: 1.1, contrast: 1.06, tint: [1.02, 0.99, 0.95], bloom: 0.62, vignette: 0.42 },
    },
  };
}

function observatoryPlan(look: RoomLook): Plan {
  const shell = { kind: 'dome' as const, r: 7.6, h: 6.0, roof: 'slit' as const };
  const exit = door(shell.r - 0.3);
  const desk = domeWall(shell, 'star_console', 118);
  const props: Placed[] = [
    exit.prop,
    { name: 'telescope', x: 0, z: -0.8, rot: Math.PI },
    desk,
    domeWall(shell, 'crate_small', 232),
    domeWall(shell, 'locker', 250),
  ];
  const globeAngle = 140 * DEG;
  return {
    shell,
    props,
    stations: [exit.station, before(desk, 'game', 'game:spectro', 0.85), { id: look.site === 'moon' ? 'moon_telescope' : 'phobos_eclipse', kind: 'look', thing: 'telescope', x: 1.6, z: 0.6 }],
    decor: [
      { kind: 'picture', art: 'stars', w: 1.4, h: 1.0, angle: 64, y: 2.2 },
      { kind: 'picture', art: 'stars', w: 1.4, h: 1.0, angle: 296, y: 2.2 },
      { kind: 'globe', x: Math.sin(globeAngle) * (shell.r - 1.15), y: 1.05, z: Math.cos(globeAngle) * (shell.r - 1.15), r: 0.3, floor: true },
    ],
    windows: [],
    strips: [],
    tone: {
      wall: '#3e4470',
      seam: '#30355a',
      floor: '#262942',
      floorLine: '#1d2036',
      rib: '#5a6196',
      accent: '#b79cff',
      dark: '#05060f',
      key: '#9fb2ff',
      keyPower: 0.85,
      sky: '#6f7cc8',
      ground: '#2a1c2e',
      hemi: 0.75,
      rim: '#b9c6ff',
      lamps: [
        // Astronomers use dim red light: it does not spoil eyes used to the dark.
        { color: '#ff3b3b', x: 3, y: 0.6, z: 3, power: 5, reach: 7 },
        { color: '#ff3b3b', x: -3, y: 0.6, z: 3, power: 5, reach: 7 },
        { color: '#8fa2ff', x: 0, y: 4.6, z: -1, power: 6, reach: 10 },
      ],
      grade: { exposure: 1.0, saturation: 1.12, contrast: 1.08, tint: [0.96, 0.98, 1.08], bloom: 0.8, vignette: 0.5 },
    },
  };
}

function oxygenPlan(look: RoomLook): Plan {
  const shell = { kind: 'hall' as const, w: 8.4, l: 11, wall: 2.6, rise: 2.4 };
  const exit = door(shell.l / 2 - 0.3);
  const unit = hallWall(shell, 'air_machine', 0, -1.4);
  const second = hallWall(shell, 'air_machine', 0, 1.4);
  const tanks = [-2.6, -0.8, 1.0].map((z) => hallWall(shell, 'water_tank', 1, z));
  const props: Placed[] = [
    exit.prop,
    unit,
    second,
    ...tanks,
    hallWall(shell, 'locker', -1, -2.6),
    hallWall(shell, 'crate_small', -1, 1.6),
    { name: 'floor_hatch', x: 0, z: 0.4, rot: 0 },
    { name: 'ceiling_light', x: 0, z: -1.5, rot: 0, y: shell.wall + shell.rise - 0.02 },
    { name: 'ceiling_light', x: 0, z: 2.5, rot: 0, y: shell.wall + shell.rise - 0.02 },
  ];
  return {
    shell,
    props,
    stations: [exit.station, before(unit, 'game', 'game:pipes'), before(tanks[1], 'look', look.site === 'mars' ? 'moxie' : 'isru', 0.7)],
    mates: [{ x: 1.6, z: -3.2, rot: Math.PI }],
    windows: [{ x: -2.4, y: 3.2, z: -shell.l / 2 + 0.06, r: 0.6 }],
    strips: [-1, 1].map((side) => ({
      from: [side * (shell.w / 2 - 0.08), shell.wall - 0.1, -shell.l / 2 + 0.5] as [number, number, number],
      to: [side * (shell.w / 2 - 0.08), shell.wall - 0.1, shell.l / 2 - 0.5] as [number, number, number],
      color: '#5fd0ff',
      width: 0.05,
    })),
    tone: {
      wall: '#d6e2e8',
      seam: '#b6c6ce',
      floor: '#41506a',
      floorLine: '#334058',
      rib: '#c9d6de',
      accent: '#39c2f0',
      dark: '#0f1a24',
      key: '#eef8ff',
      keyPower: 1.25,
      sky: '#e2f2fa',
      ground: '#4e6276',
      hemi: 1.05,
      rim: '#e2f6ff',
      lamps: [
        { color: '#7fe0ff', x: 0, y: 2.6, z: -3.4, power: 9, reach: 8 },
        { color: '#dff4ff', x: 0, y: 4.2, z: 1.5, power: 9, reach: 12 },
      ],
      grade: { exposure: 1.02, saturation: 1.1, contrast: 1.06, tint: [0.98, 1.0, 1.03], bloom: 0.62, vignette: 0.42 },
    },
  };
}

function bunkerPlan(): Plan {
  const shell = { kind: 'hall' as const, w: 7.6, l: 9.6, wall: 2.3, rise: 1.0 };
  const exit = door(shell.l / 2 - 0.3);
  const beds = [-2.6, 0.2].flatMap((z) => [hallWall(shell, 'bunk_bed', -1, z), hallWall(shell, 'bunk_bed', 1, z)]);
  const props: Placed[] = [
    exit.prop,
    ...beds,
    hallWall(shell, 'water_tank', 0, -2.4),
    hallWall(shell, 'water_tank', 0, -1.4),
    hallWall(shell, 'locker', 0, 1.9),
    hallWall(shell, 'crate_small', 0, 0.6),
    { name: 'table_round', x: 0, z: -0.4, rot: 0 },
    { name: 'stool', x: -0.95, z: -0.4, rot: Math.PI / 2 },
    { name: 'stool', x: 0.95, z: -0.4, rot: -Math.PI / 2 },
    { name: 'ceiling_light', x: 0, z: -1.5, rot: 0, y: shell.wall + shell.rise - 0.02 },
    { name: 'ceiling_light', x: 0, z: 2.0, rot: 0, y: shell.wall + shell.rise - 0.02 },
  ];
  return {
    shell,
    props,
    stations: [exit.station, before(beds[0], 'look', 'storm_shelter', 0.7), before(props[7], 'look', 'astrorad', 0.6)],
    mates: [],
    windows: [],
    strips: [{ from: [0, shell.wall + shell.rise - 0.06, -shell.l / 2 + 0.6], to: [0, shell.wall + shell.rise - 0.06, shell.l / 2 - 0.6], color: '#ffb347', width: 0.045 }],
    tone: {
      wall: '#e6dccb',
      seam: '#c9bba4',
      floor: '#4e4a58',
      floorLine: '#3e3a47',
      rib: '#cfc6b6',
      accent: '#ffb347',
      dark: '#16121a',
      key: '#ffe6c4',
      keyPower: 1.25,
      sky: '#fff0dc',
      ground: '#5a4a52',
      hemi: 1.0,
      rim: '#ffe2bd',
      lamps: [
        { color: '#ffc27a', x: 0, y: 2.6, z: -1.5, power: 8, reach: 9 },
        { color: '#ff7a5a', x: 0, y: 2.6, z: 2.4, power: 5, reach: 7 },
      ],
      grade: { exposure: 1.0, saturation: 1.08, contrast: 1.06, tint: [1.03, 0.99, 0.95], bloom: 0.6, vignette: 0.5 },
    },
  };
}

function landerPlan(look: RoomLook): Plan {
  const shell = { kind: 'hall' as const, w: 7.6, l: 10.4, wall: 2.3, rise: 1.9 };
  const exit = door(shell.l / 2 - 0.3);
  const cockpit = hallWall(shell, 'cockpit_console', 0, 0);
  const radio = hallWall(shell, 'radio_console', 1, 0.4);
  const supplies = hallWall(shell, 'supply_rack', -1, 0.2);
  const props: Placed[] = [
    exit.prop,
    cockpit,
    radio,
    supplies,
    hallWall(shell, 'supply_rack', -1, 1.6),
    { name: 'pilot_seat', x: -0.85, z: -shell.l / 2 + 2.0, rot: Math.PI },
    { name: 'pilot_seat', x: 0.85, z: -shell.l / 2 + 2.0, rot: Math.PI },
    { name: 'crate_small', x: 2.5, z: 3.2, rot: -0.2 },
    { name: 'crate_small', x: 2.75, z: 2.45, rot: 0.35 },
    { name: 'ceiling_light', x: 0, z: -1.6, rot: 0, y: shell.wall + shell.rise - 0.02 },
    { name: 'ceiling_light', x: 0, z: 2.2, rot: 0, y: shell.wall + shell.rise - 0.02 },
  ];
  return {
    shell,
    spawnIn: 3.6,
    props,
    stations: [
      exit.station,
      before(cockpit, 'game', 'game:landing', 0.55),
      before(radio, 'game', 'game:signal', 0.7),
      before(supplies, 'look', look.site === 'mars' ? 'launch_windows' : 'three_days', 0.7),
      { id: look.site === 'mars' ? 'mars_sunset' : 'earth_from_moon', kind: 'look', thing: 'window', x: 1.5, z: -shell.l / 2 + 1.3 },
    ],
    windows: [
      { x: -1.3, y: 2.35, z: -shell.l / 2 + 0.06, r: 0.62 },
      { x: 1.3, y: 2.35, z: -shell.l / 2 + 0.06, r: 0.62 },
    ],
    decor: [{ kind: 'picture', art: 'emblem', w: 0.9, h: 0.9, x: 0, y: 2.75, side: 0 }],
    strips: [-1, 1].map((side) => ({
      from: [side * (shell.w / 2 - 0.08), shell.wall - 0.1, -shell.l / 2 + 0.5] as [number, number, number],
      to: [side * (shell.w / 2 - 0.08), shell.wall - 0.1, shell.l / 2 - 0.5] as [number, number, number],
      color: '#ffb347',
      width: 0.04,
    })),
    tone: {
      wall: '#e9e3d6',
      seam: '#cbc1ad',
      floor: '#3d4462',
      floorLine: '#2f3550',
      rib: '#cdd3de',
      accent: '#ffb347',
      dark: '#11131f',
      key: '#fff0d8',
      keyPower: 1.35,
      sky: '#fff4e4',
      ground: '#5b5470',
      hemi: 1.0,
      rim: '#ffe9c8',
      lamps: [
        { color: '#7fe0ff', x: 0, y: 1.6, z: -2.6, power: 7, reach: 6 },
        { color: '#ffd59a', x: 0, y: 3.2, z: 1.2, power: 8, reach: 9 },
      ],
      grade: { exposure: 1.02, saturation: 1.1, contrast: 1.06, tint: [1.02, 0.99, 0.96], bloom: 0.66, vignette: 0.48 },
    },
  };
}

function planFor(room: RoomId, look: RoomLook): Plan {
  switch (room) {
    case 'hab':
      return habPlan();
    case 'farm':
      return farmPlan(look, false);
    case 'garden':
      return farmPlan(look, true);
    case 'lab':
      return labPlan();
    case 'workshop':
      return workshopPlan(look);
    case 'observatory':
      return observatoryPlan(look);
    case 'oxygen':
      return oxygenPlan(look);
    case 'bunker':
      return bunkerPlan();
    case 'lander':
      return landerPlan(look);
  }
}

// ---------------------------------------------------------------------------
// Textures painted at start-up
// ---------------------------------------------------------------------------

const textureCache = new Map<string, THREE.Texture>();
function cachedTexture(key: string, make: () => THREE.Texture): THREE.Texture {
  let texture = textureCache.get(key);
  if (!texture) {
    texture = make();
    textureCache.set(key, texture);
  }
  return texture;
}

/** Wall panels: rounded plates with seams, rivets, and now and then a vent or a label. One tile is 1.6 m. */
function panelTexture(base: string, seam: string, accent: string): THREE.Texture {
  return cachedTexture(`panel-${base}-${seam}-${accent}`, () =>
    canvasTexture(
      256,
      256,
      (ctx, w, h) => {
        const random = mulberry32(17);
        ctx.fillStyle = seam;
        ctx.fillRect(0, 0, w, h);
        const cell = w / 2;
        for (let row = 0; row < 2; row++) {
          for (let col = 0; col < 2; col++) {
            const x = col * cell + 4;
            const y = row * cell + 4;
            const size = cell - 8;
            const gradient = ctx.createLinearGradient(0, y, 0, y + size);
            gradient.addColorStop(0, base);
            gradient.addColorStop(1, shade(base, -0.06));
            ctx.fillStyle = gradient;
            roundRect(ctx, x, y, size, size, 10);
            ctx.fill();
            // Rivets in the corners.
            ctx.fillStyle = shade(seam, -0.12);
            for (const [px, py] of [
              [x + 9, y + 9],
              [x + size - 9, y + 9],
              [x + 9, y + size - 9],
              [x + size - 9, y + size - 9],
            ]) {
              ctx.beginPath();
              ctx.arc(px, py, 2.6, 0, Math.PI * 2);
              ctx.fill();
            }
            const pick = random();
            if (pick < 0.22) {
              // A vent.
              ctx.fillStyle = shade(base, -0.2);
              for (let i = 0; i < 5; i++) {
                roundRect(ctx, x + size * 0.25, y + size * 0.3 + i * 11, size * 0.5, 5, 2.5);
                ctx.fill();
              }
            } else if (pick < 0.4) {
              // A coloured label strip.
              ctx.fillStyle = accent;
              roundRect(ctx, x + 14, y + size - 30, size * 0.42, 9, 4);
              ctx.fill();
            }
          }
        }
      },
      { repeat: true },
    ),
  );
}

/** Floor plates with a fine grip pattern. One tile is 1.6 m. */
function floorTexture(base: string, line: string): THREE.Texture {
  return cachedTexture(`floor-${base}-${line}`, () =>
    canvasTexture(
      256,
      256,
      (ctx, w, h) => {
        ctx.fillStyle = line;
        ctx.fillRect(0, 0, w, h);
        const cell = w / 2;
        for (let row = 0; row < 2; row++) {
          for (let col = 0; col < 2; col++) {
            const x = col * cell + 3;
            const y = row * cell + 3;
            ctx.fillStyle = base;
            roundRect(ctx, x, y, cell - 6, cell - 6, 6);
            ctx.fill();
            ctx.fillStyle = shade(base, 0.08);
            for (let i = 0; i < 6; i++) {
              for (let j = 0; j < 6; j++) {
                if ((i + j) % 2) continue;
                roundRect(ctx, x + 10 + i * 19, y + 10 + j * 19, 10, 4, 2);
                ctx.fill();
              }
            }
          }
        }
      },
      { repeat: true },
    ),
  );
}

/** The view out of a window: the plain, the hills and the sky of the world outside. */
function viewTexture(site: SiteId): THREE.Texture {
  return cachedTexture(`view-${site}`, () =>
    canvasTexture(512, 512, (ctx, w, h) => {
      const random = mulberry32(site === 'mars' ? 3 : 4);
      const mars = site === 'mars';
      const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
      if (mars) {
        sky.addColorStop(0, '#b7774f');
        sky.addColorStop(1, '#f1c79c');
      } else {
        sky.addColorStop(0, '#020309');
        sky.addColorStop(1, '#0b0f1e');
      }
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      if (!mars) {
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 90; i++) {
          ctx.globalAlpha = 0.4 + random() * 0.6;
          ctx.fillRect(random() * w, random() * h * 0.55, 1.6, 1.6);
        }
        ctx.globalAlpha = 1;
        // Earth, half lit.
        const ex = w * 0.68;
        const ey = h * 0.22;
        const er = w * 0.07;
        ctx.fillStyle = '#2e6fd8';
        ctx.beginPath();
        ctx.arc(ex, ey, er, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#7fd08a';
        ctx.beginPath();
        ctx.ellipse(ex - er * 0.2, ey - er * 0.1, er * 0.45, er * 0.3, 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.ellipse(ex + er * 0.25, ey + er * 0.35, er * 0.5, er * 0.14, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(2,3,9,0.78)';
        ctx.beginPath();
        ctx.arc(ex + er * 0.55, ey, er * 1.02, -Math.PI / 2, Math.PI / 2);
        ctx.fill();
      } else {
        const glowSun = ctx.createRadialGradient(w * 0.3, h * 0.24, 2, w * 0.3, h * 0.24, w * 0.22);
        glowSun.addColorStop(0, 'rgba(255,250,235,1)');
        glowSun.addColorStop(0.08, 'rgba(255,240,215,0.9)');
        glowSun.addColorStop(1, 'rgba(255,230,200,0)');
        ctx.fillStyle = glowSun;
        ctx.fillRect(0, 0, w, h);
      }
      // Far hills, near hills, ground.
      const layers = mars ? ['#c98a68', '#b1623f', '#94462b'] : ['#7f838f', '#6a6e7a', '#575a64'];
      layers.forEach((color, index) => {
        const base = h * (0.52 + index * 0.08);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(0, base);
        for (let x = 0; x <= w; x += 16) {
          const y = base - Math.sin(x * 0.011 + index * 2) * h * (0.05 - index * 0.012) - random() * 4;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      });
      // Rocks and craters near the window.
      for (let i = 0; i < 26; i++) {
        const x = random() * w;
        const y = h * (0.72 + random() * 0.26);
        const r = 2 + random() * 9;
        ctx.fillStyle = mars ? 'rgba(70, 28, 16, 0.55)' : 'rgba(40, 42, 50, 0.5)';
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.6, r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }),
  );
}

/** The sky seen through a glass roof. */
function skyTexture(site: SiteId): THREE.Texture {
  return cachedTexture(`sky-${site}`, () =>
    canvasTexture(256, 256, (ctx, w, h) => {
      const random = mulberry32(site === 'mars' ? 8 : 9);
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      if (site === 'mars') {
        gradient.addColorStop(0, '#a46a48');
        gradient.addColorStop(1, '#f0c59b');
      } else {
        gradient.addColorStop(0, '#010207');
        gradient.addColorStop(1, '#070b18');
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      if (site === 'moon') {
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 120; i++) {
          ctx.globalAlpha = 0.35 + random() * 0.65;
          ctx.fillRect(random() * w, random() * h, 1.2, 1.2);
        }
        ctx.globalAlpha = 1;
      }
    }),
  );
}

/** Deep sky with many stars, for the observatory's open slit. */
function starTexture(): THREE.Texture {
  return cachedTexture('stars', () =>
    canvasTexture(
      256,
      512,
      (ctx, w, h) => {
        const random = mulberry32(21);
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, '#0a0d24');
        gradient.addColorStop(1, '#1a1440');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 420; i++) {
          const big = random() < 0.06;
          ctx.globalAlpha = 0.4 + random() * 0.6;
          ctx.fillStyle = random() < 0.2 ? '#ffd9b0' : random() < 0.2 ? '#b9d4ff' : '#ffffff';
          const s = big ? 2.4 : 1.2;
          ctx.fillRect(random() * w, random() * h, s, s);
        }
        ctx.globalAlpha = 1;
      },
      { repeat: true },
    ),
  );
}

function mix(a: string, b: string, share: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), share).getHexString()}`;
}

function shade(hex: string, amount: number): string {
  const color = new THREE.Color(hex);
  if (amount >= 0) color.lerp(new THREE.Color('#ffffff'), amount);
  else color.lerp(new THREE.Color('#000000'), -amount);
  return `#${color.getHexString()}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Painted pictures for the walls. */
function artTexture(art: Art, site: SiteId): THREE.Texture {
  if (art === 'emblem') return emblemTexture(site);
  return cachedTexture(`art-${art}-${site}`, () =>
    canvasTexture(384, 256, (ctx, w, h) => {
      const random = mulberry32(art.length * 31 + (site === 'mars' ? 1 : 2));
      switch (art) {
        case 'earth': {
          ctx.fillStyle = '#0a0f26';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#ffffff';
          for (let i = 0; i < 60; i++) ctx.fillRect(random() * w, random() * h, 1.5, 1.5);
          const cx = w / 2;
          const cy = h / 2;
          const r = h * 0.38;
          const sea = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
          sea.addColorStop(0, '#5fb8ff');
          sea.addColorStop(1, '#1d4fb8');
          ctx.fillStyle = sea;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#6fd08a';
          for (const [dx, dy, rx, ry] of [
            [-0.3, -0.2, 0.32, 0.22],
            [0.25, 0.1, 0.22, 0.3],
            [-0.1, 0.45, 0.2, 0.12],
          ]) {
            ctx.beginPath();
            ctx.ellipse(cx + dx * r, cy + dy * r, rx * r, ry * r, 0.4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 6;
          ctx.lineCap = 'round';
          for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.arc(cx + (random() - 0.5) * r, cy + (random() - 0.5) * r, r * (0.3 + random() * 0.3), random() * 3, random() * 3 + 1);
            ctx.stroke();
          }
          break;
        }
        case 'status': {
          ctx.fillStyle = '#0d1430';
          ctx.fillRect(0, 0, w, h);
          const bars = ['#5fd0ff', '#5fe39a', '#ffd166', '#ff7ab8'];
          bars.forEach((color, index) => {
            const y = 36 + index * 52;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(40, y + 10, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            roundRect(ctx, 66, y, w - 100, 20, 10);
            ctx.fill();
            ctx.fillStyle = color;
            roundRect(ctx, 66, y, (w - 100) * (0.45 + random() * 0.5), 20, 10);
            ctx.fill();
          });
          break;
        }
        case 'periodic': {
          ctx.fillStyle = '#f4efe4';
          ctx.fillRect(0, 0, w, h);
          const tints = ['#ff9b8a', '#ffd166', '#8fd8ff', '#9fe6a8', '#c9a8ff'];
          const symbols = ['H', 'He', 'C', 'N', 'O', 'Na', 'Mg', 'Al', 'Si', 'S', 'K', 'Ca', 'Ti', 'Fe', 'Ni', 'Cu'];
          for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 8; col++) {
              if (row === 0 && col > 0 && col < 7) continue;
              const x = 18 + col * 44;
              const y = 20 + row * 56;
              ctx.fillStyle = tints[(row + col) % tints.length];
              roundRect(ctx, x, y, 38, 48, 6);
              ctx.fill();
              ctx.fillStyle = '#2f3658';
              ctx.font = 'bold 18px sans-serif';
              ctx.textAlign = 'center';
              ctx.fillText(symbols[(row * 8 + col) % symbols.length], x + 19, y + 31);
            }
          }
          break;
        }
        case 'blueprint': {
          ctx.fillStyle = '#1d4a9a';
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.lineWidth = 1;
          for (let x = 0; x < w; x += 24) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
          }
          for (let y = 0; y < h; y += 24) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          }
          // A rover, drawn in white lines.
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 4;
          roundRect(ctx, 90, 90, 200, 70, 16);
          ctx.stroke();
          for (const x of [120, 190, 260]) {
            ctx.beginPath();
            ctx.arc(x, 180, 22, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.moveTo(240, 90);
          ctx.lineTo(260, 50);
          ctx.lineTo(300, 50);
          ctx.stroke();
          break;
        }
        case 'stars': {
          ctx.fillStyle = '#070a1e';
          ctx.fillRect(0, 0, w, h);
          const points: [number, number][] = [];
          for (let i = 0; i < 7; i++) points.push([40 + random() * (w - 80), 30 + random() * (h - 60)]);
          ctx.strokeStyle = 'rgba(183, 156, 255, 0.8)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          for (const [x, y] of points) {
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
          }
          for (let i = 0; i < 80; i++) ctx.fillRect(random() * w, random() * h, 1.4, 1.4);
          break;
        }
        case 'plants': {
          ctx.fillStyle = '#f2f7ee';
          ctx.fillRect(0, 0, w, h);
          [0.4, 0.7, 1].forEach((size, index) => {
            const x = 70 + index * 120;
            ctx.fillStyle = '#c98a5a';
            roundRect(ctx, x - 30, 190, 60, 40, 8);
            ctx.fill();
            ctx.strokeStyle = '#3fae6a';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(x, 190);
            ctx.lineTo(x, 190 - 120 * size);
            ctx.stroke();
            ctx.fillStyle = '#4fd98a';
            for (let leaf = 0; leaf < 1 + index * 2; leaf++) {
              const ly = 180 - leaf * 28 * size - 20;
              ctx.beginPath();
              ctx.ellipse(x + (leaf % 2 ? 18 : -18), ly, 18 * size + 6, 8, leaf % 2 ? 0.5 : -0.5, 0, Math.PI * 2);
              ctx.fill();
            }
          });
          ctx.fillStyle = '#2f3658';
          for (let i = 0; i < 2; i++) {
            ctx.beginPath();
            ctx.moveTo(122 + i * 120, 120);
            ctx.lineTo(138 + i * 120, 128);
            ctx.lineTo(122 + i * 120, 136);
            ctx.fill();
          }
          break;
        }
        default:
          break;
      }
    }),
  );
}

/** A small map of a world, for a globe. */
function planetTexture(site: SiteId): THREE.Texture {
  return cachedTexture(`planet-${site}`, () =>
    canvasTexture(256, 128, (ctx, w, h) => {
      const random = mulberry32(site === 'mars' ? 12 : 13);
      ctx.fillStyle = site === 'mars' ? '#c9673d' : '#a9acb4';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = site === 'mars' ? (random() < 0.5 ? '#8a3f24' : '#e08a5a') : random() < 0.5 ? '#7c7f88' : '#d3d5db';
        ctx.beginPath();
        ctx.ellipse(random() * w, random() * h, 4 + random() * 18, 3 + random() * 10, random() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (site === 'mars') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, 7);
        ctx.fillRect(0, h - 6, w, 6);
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Stand-ins: plain shapes in the right size and colours, until the models load
// ---------------------------------------------------------------------------

const box = (w: number, h: number, d: number, radius = 0.05): Geo => new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2));

interface Paints {
  body: THREE.Material;
  trim: THREE.Material;
  metal: THREE.Material;
  soft: THREE.Material;
  leaf: THREE.Material;
  leaf2: THREE.Material;
  soil: THREE.Material;
  pot: THREE.Material;
  red: THREE.Material;
  yellow: THREE.Material;
  teal: THREE.Material;
  orange: THREE.Material;
  violet: THREE.Material;
  glass: THREE.Material;
  screenCyan: THREE.Material;
  screenGreen: THREE.Material;
  screenAmber: THREE.Material;
  glowWhite: THREE.Material;
  glowPink: THREE.Material;
  glowCyan: THREE.Material;
  glowGreen: THREE.Material;
  glowAmber: THREE.Material;
}

function makePaints(): Paints {
  return {
    body: toon({ color: '#f1ece2', rim: 0.25, lift: 0.14 }),
    trim: toon({ color: '#2f3658', rim: 0.25, lift: 0.1 }),
    metal: toon({ color: '#b9c1cd', rim: 0.35, spec: 0.5, lift: 0.12 }),
    soft: toon({ color: '#7fa8e8', rim: 0.2, lift: 0.16 }),
    leaf: toon({ color: '#49b863', rim: 0.3, lift: 0.18 }),
    leaf2: toon({ color: '#7ddc7a', rim: 0.3, lift: 0.18 }),
    soil: toon({ color: '#5a3d2c', rim: 0.1, lift: 0.1 }),
    pot: toon({ color: '#d98a5a', rim: 0.25, lift: 0.14 }),
    red: toon({ color: '#ff4f4f', rim: 0.3, spec: 0.6, lift: 0.16 }),
    yellow: toon({ color: '#ffd166', rim: 0.3, spec: 0.5, lift: 0.16 }),
    teal: toon({ color: '#39c2f0', rim: 0.3, lift: 0.14 }),
    orange: toon({ color: '#ff8a3d', rim: 0.3, lift: 0.14 }),
    violet: toon({ color: '#8f7bff', rim: 0.3, lift: 0.14 }),
    glass: toon({ color: '#bfe6ff', rim: 0.7, transparent: true, opacity: 0.32, spec: 0.8 }),
    screenCyan: glow('#5fd0ff', 1.25),
    screenGreen: glow('#5fe39a', 1.2),
    screenAmber: glow('#ffb347', 1.25),
    glowWhite: glow('#fff6e6', 2.4),
    glowPink: glow('#ff6fcf', 2.6),
    glowCyan: glow('#5fd0ff', 2.4),
    glowGreen: glow('#5fff9a', 2.4),
    glowAmber: glow('#ffb347', 2.4),
  };
}

/** A simple version of a prop, made of rounded boxes and cylinders. Front faces +Z. */
function standIn(name: string, p: Paints): THREE.Group {
  const kit = new Kit();
  const s = SIZE[name];
  switch (name) {
    case 'bunk_bed':
      for (const x of [-1, 1]) for (const z of [-1, 1]) kit.add(p.metal, shape.cyl(0.04, 0.04, 1.9, 8), { p: [x * 1.0, 0.95, z * 0.45] });
      for (const y of [0.32, 1.32]) {
        kit.add(p.trim, box(2.1, 0.12, 1.0, 0.04), { p: [0, y, 0] });
        kit.add(p.soft, box(1.95, 0.16, 0.86, 0.06), { p: [0, y + 0.13, 0] });
        kit.add(p.body, box(0.42, 0.12, 0.6, 0.05), { p: [-0.72, y + 0.27, 0] });
        kit.add(y < 1 ? p.orange : p.teal, box(1.2, 0.06, 0.88, 0.03), { p: [0.35, y + 0.23, 0.01] });
      }
      for (let i = 0; i < 4; i++) kit.add(p.metal, shape.cyl(0.025, 0.025, 0.5, 6), { p: [0.98, 0.55 + i * 0.32, 0.52], r: [0, 0, Math.PI / 2] });
      kit.add(p.glowAmber, shape.sphere(0.05, 8), { p: [-0.95, 1.7, 0.3] });
      break;
    case 'table_round':
      kit.add(p.body, shape.cyl(0.65, 0.65, 0.06, 32), { p: [0, 0.72, 0] });
      kit.add(p.metal, shape.cyl(0.07, 0.07, 0.7, 12), { p: [0, 0.36, 0] });
      kit.add(p.trim, shape.cyl(0.32, 0.36, 0.04, 24), { p: [0, 0.02, 0] });
      kit.add(p.teal, box(0.36, 0.03, 0.26, 0.012), { p: [0.2, 0.765, 0.1] });
      kit.add(p.orange, box(0.36, 0.03, 0.26, 0.012), { p: [-0.25, 0.765, -0.12] });
      break;
    case 'stool':
      kit.add(p.orange, shape.cyl(0.21, 0.21, 0.07, 20), { p: [0, 0.43, 0] });
      kit.add(p.metal, shape.cyl(0.04, 0.04, 0.42, 8), { p: [0, 0.21, 0] });
      kit.add(p.trim, shape.cyl(0.16, 0.18, 0.03, 16), { p: [0, 0.015, 0] });
      break;
    case 'galley':
      kit.add(p.body, box(2.4, 0.9, 0.7, 0.05), { p: [0, 0.45, 0] });
      kit.add(p.trim, box(2.44, 0.05, 0.74, 0.02), { p: [0, 0.92, 0] });
      kit.add(p.body, box(2.4, 0.6, 0.4, 0.05), { p: [0, 1.75, -0.15] });
      for (let i = 0; i < 4; i++) kit.add(p.metal, box(0.04, 0.2, 0.03, 0.01), { p: [-0.9 + i * 0.6, 0.6, 0.36] });
      kit.add(p.screenGreen, box(0.42, 0.26, 0.02, 0.01), { p: [0.6, 1.25, -0.24] });
      kit.add(p.teal, box(0.3, 0.42, 0.3, 0.05), { p: [-0.8, 1.16, -0.1] });
      break;
    case 'air_machine':
      kit.add(p.body, box(1.4, 2.2, 0.9, 0.08), { p: [0, 1.1, 0] });
      for (const y of [0.55, 1.2]) {
        kit.add(p.trim, shape.cyl(0.3, 0.3, 0.05, 28), { p: [-0.32, y, 0.46], r: [Math.PI / 2, 0, 0] });
        kit.add(p.metal, box(0.5, 0.05, 0.03, 0.01), { p: [-0.32, y, 0.5], r: [0, 0, 0.6] });
        kit.add(p.metal, box(0.5, 0.05, 0.03, 0.01), { p: [-0.32, y, 0.5], r: [0, 0, -0.6] });
      }
      kit.add(p.screenCyan, box(0.46, 0.34, 0.02, 0.01), { p: [0.36, 1.45, 0.46] });
      kit.add(p.glowGreen, shape.sphere(0.035, 8), { p: [0.24, 1.15, 0.46] });
      kit.add(p.glowAmber, shape.sphere(0.035, 8), { p: [0.36, 1.15, 0.46] });
      kit.add(p.teal, shape.tube([[0.4, 2.2, 0], [0.4, 2.45, 0], [0.4, 2.6, -0.4]], 0.09, 12, 10));
      kit.add(p.teal, shape.tube([[-0.4, 2.2, 0], [-0.4, 2.5, 0.1], [-0.6, 2.62, -0.4]], 0.09, 12, 10));
      kit.add(p.orange, shape.torus(0.13, 0.03, 20, 6), { p: [0.4, 2.42, 0.1], r: [Math.PI / 2, 0, 0] });
      kit.add(p.orange, shape.torus(0.13, 0.03, 20, 6), { p: [0.72, 0.9, 0], r: [0, Math.PI / 2, 0] });
      kit.add(p.teal, shape.cyl(0.08, 0.08, 0.3, 10), { p: [0.72, 0.9, 0], r: [0, 0, Math.PI / 2] });
      break;
    case 'water_recycler':
      kit.add(p.body, box(1.0, 0.5, 0.8, 0.06), { p: [0, 0.25, 0] });
      for (const x of [-0.24, 0.24]) {
        kit.add(p.metal, shape.cyl(0.24, 0.24, 1.2, 20), { p: [x, 1.1, -0.05] });
        kit.add(p.metal, shape.sphere(0.24, 16), { p: [x, 1.7, -0.05], s: [1, 0.4, 1] });
      }
      kit.add(p.glass, box(0.08, 0.8, 0.04, 0.02), { p: [0.24, 1.1, 0.2] });
      kit.add(p.screenGreen, box(0.3, 0.2, 0.02, 0.01), { p: [-0.2, 0.3, 0.41] });
      kit.add(p.teal, shape.tube([[-0.24, 1.75, -0.05], [0, 1.82, -0.05], [0.24, 1.75, -0.05]], 0.05, 10, 8));
      break;
    case 'exercise_bike':
      kit.add(p.trim, box(1.1, 0.08, 0.5, 0.03), { p: [0, 0.04, 0] });
      kit.add(p.metal, shape.torus(0.28, 0.05, 24, 8), { p: [0.25, 0.36, 0], r: [0, 0, 0] });
      kit.add(p.metal, shape.cyl(0.04, 0.04, 0.7, 8), { p: [-0.25, 0.42, 0], r: [0, 0, 0.3] });
      kit.add(p.orange, box(0.3, 0.07, 0.2, 0.03), { p: [-0.35, 0.8, 0] });
      kit.add(p.metal, shape.cyl(0.035, 0.035, 0.75, 8), { p: [0.35, 0.65, 0], r: [0, 0, -0.25] });
      kit.add(p.trim, box(0.08, 0.06, 0.5, 0.02), { p: [0.45, 1.02, 0] });
      kit.add(p.screenCyan, box(0.2, 0.14, 0.02, 0.01), { p: [0.47, 1.1, 0.0], r: [0, Math.PI / 2, 0] });
      break;
    case 'locker':
      kit.add(p.body, box(0.7, 2.0, 0.55, 0.05), { p: [0, 1.0, 0] });
      kit.add(p.trim, box(0.02, 1.8, 0.02, 0.01), { p: [0, 1.0, 0.28] });
      kit.add(p.metal, box(0.03, 0.22, 0.03, 0.01), { p: [0.12, 1.1, 0.29] });
      kit.add(p.teal, box(0.5, 0.06, 0.02, 0.01), { p: [0, 1.75, 0.28] });
      break;
    case 'plant_rack':
      for (const x of [-1.15, 1.15]) for (const z of [-0.35, 0.35]) kit.add(p.metal, shape.cyl(0.03, 0.03, 2.2, 8), { p: [x, 1.1, z] });
      for (const y of [0.35, 1.05, 1.75]) {
        kit.add(p.body, box(2.4, 0.06, 0.8, 0.02), { p: [0, y, 0] });
        kit.add(p.trim, box(2.2, 0.1, 0.62, 0.03), { p: [0, y + 0.08, 0] });
        kit.add(p.glowPink, box(2.0, 0.03, 0.08, 0.01), { p: [0, y + 0.58, 0] });
        for (let i = 0; i < 6; i++) kit.add(i % 2 ? p.leaf : p.leaf2, shape.sphere(0.14, 10), { p: [-0.9 + i * 0.36, y + 0.2, (i % 2) * 0.18 - 0.08], s: [1.2, 0.7, 1.2] });
      }
      break;
    case 'pepper_plant':
      kit.add(p.pot, shape.cyl(0.2, 0.15, 0.3, 18), { p: [0, 0.15, 0] });
      kit.add(p.soil, shape.cyl(0.18, 0.18, 0.02, 18), { p: [0, 0.3, 0] });
      kit.add(p.leaf, shape.sphere(0.22, 12), { p: [0, 0.55, 0], s: [1, 0.85, 1] });
      kit.add(p.leaf2, shape.sphere(0.14, 10), { p: [0.1, 0.72, 0.05] });
      kit.add(p.red, shape.sphere(0.045, 8), { p: [0.16, 0.48, 0.12], s: [0.8, 1.6, 0.8] });
      kit.add(p.yellow, shape.sphere(0.045, 8), { p: [-0.14, 0.52, 0.14], s: [0.8, 1.6, 0.8] });
      kit.add(p.red, shape.sphere(0.045, 8), { p: [0.02, 0.44, -0.18], s: [0.8, 1.6, 0.8] });
      break;
    case 'garden_bed':
      kit.add(p.body, box(2.0, 0.5, 1.0, 0.06), { p: [0, 0.25, 0] });
      kit.add(p.soil, box(1.86, 0.06, 0.86, 0.02), { p: [0, 0.5, 0] });
      for (let i = 0; i < 7; i++) for (let j = 0; j < 2; j++) kit.add((i + j) % 2 ? p.leaf : p.leaf2, shape.sphere(0.11, 8), { p: [-0.78 + i * 0.26, 0.6, -0.2 + j * 0.4], s: [1, 0.8, 1] });
      kit.add(p.teal, box(0.16, 0.12, 0.02, 0.01), { p: [0.8, 0.42, 0.51] });
      break;
    case 'dwarf_tree':
      kit.add(p.pot, shape.cyl(0.55, 0.45, 0.6, 24), { p: [0, 0.3, 0] });
      kit.add(p.soil, shape.cyl(0.52, 0.52, 0.03, 24), { p: [0, 0.6, 0] });
      kit.add(p.soil, shape.cyl(0.07, 0.1, 0.7, 10), { p: [0, 0.95, 0] });
      kit.add(p.leaf, shape.sphere(0.5, 14), { p: [0, 1.5, 0] });
      kit.add(p.leaf2, shape.sphere(0.36, 12), { p: [0.32, 1.42, 0.2] });
      kit.add(p.leaf, shape.sphere(0.34, 12), { p: [-0.3, 1.46, -0.16] });
      for (const [x, y, z] of [
        [0.3, 1.3, 0.38],
        [-0.36, 1.52, 0.22],
        [0.12, 1.75, -0.3],
        [0.46, 1.6, -0.08],
      ])
        kit.add(p.orange, shape.sphere(0.06, 8), { p: [x, y, z] });
      break;
    case 'water_tank':
      kit.add(p.metal, shape.cyl(0.45, 0.45, 1.3, 24), { p: [0, 0.65, 0] });
      kit.add(p.metal, shape.sphere(0.45, 20), { p: [0, 1.3, 0], s: [1, 0.5, 1] });
      kit.add(p.glass, box(0.1, 0.9, 0.03, 0.02), { p: [0, 0.7, 0.45] });
      kit.add(p.teal, shape.torus(0.46, 0.03, 32, 6), { p: [0, 0.3, 0], r: [Math.PI / 2, 0, 0] });
      break;
    case 'farm_console':
      kit.add(p.body, box(0.7, 0.9, 0.45, 0.06), { p: [0, 0.45, -0.05] });
      kit.add(p.trim, box(0.9, 0.08, 0.6, 0.03), { p: [0, 1.0, 0], r: [-0.45, 0, 0] });
      kit.add(p.screenGreen, box(0.6, 0.02, 0.36, 0.01), { p: [0, 1.04, 0.02], r: [-0.45, 0, 0] });
      kit.add(p.orange, shape.cyl(0.045, 0.045, 0.04, 12), { p: [-0.32, 0.98, 0.22], r: [-0.45, 0, 0] });
      kit.add(p.teal, shape.cyl(0.045, 0.045, 0.04, 12), { p: [0.32, 0.98, 0.22], r: [-0.45, 0, 0] });
      break;
    case 'bench':
      kit.add(p.teal, box(1.6, 0.08, 0.5, 0.04), { p: [0, 0.46, 0] });
      for (const x of [-0.65, 0.65]) kit.add(p.metal, box(0.08, 0.42, 0.4, 0.02), { p: [x, 0.21, 0] });
      break;
    case 'lab_bench':
      kit.add(p.body, box(2.4, 0.86, 0.8, 0.05), { p: [0, 0.43, 0] });
      kit.add(p.trim, box(2.44, 0.06, 0.84, 0.02), { p: [0, 0.89, 0] });
      for (let i = 0; i < 3; i++) kit.add(p.metal, box(0.3, 0.03, 0.02, 0.01), { p: [-0.8 + i * 0.8, 0.7, 0.41] });
      kit.add(p.trim, box(0.25, 0.05, 0.3, 0.02), { p: [0.6, 0.945, 0] });
      kit.add(p.metal, shape.cyl(0.04, 0.04, 0.42, 10), { p: [0.6, 1.15, -0.06], r: [0.25, 0, 0] });
      kit.add(p.violet, shape.cyl(0.05, 0.05, 0.16, 10), { p: [0.6, 1.36, 0.02] });
      for (let i = 0; i < 5; i++) kit.add(i % 2 ? p.teal : p.glass, shape.cyl(0.025, 0.025, 0.18, 8), { p: [-0.9 + i * 0.07, 1.01, 0.1] });
      break;
    case 'sample_shelf':
      for (const x of [-0.78, 0.78]) kit.add(p.body, box(0.05, 1.8, 0.4, 0.02), { p: [x, 0.9, 0] });
      for (const y of [0.3, 0.8, 1.3, 1.78]) kit.add(p.body, box(1.6, 0.04, 0.4, 0.015), { p: [0, y, 0] });
      [0.3, 0.8, 1.3].forEach((y, row) => {
        for (let i = 0; i < 6; i++) {
          kit.add(p.glass, shape.cyl(0.07, 0.07, 0.2, 12), { p: [-0.62 + i * 0.25, y + 0.12, 0.02] });
          kit.add([p.red, p.metal, p.orange, p.body, p.soil, p.yellow][(i + row) % 6], shape.cyl(0.06, 0.06, 0.1, 12), { p: [-0.62 + i * 0.25, y + 0.07, 0.02] });
        }
      });
      break;
    case 'spectrometer':
      kit.add(p.body, box(1.2, 0.9, 0.8, 0.07), { p: [0, 0.45, 0] });
      kit.add(p.glass, box(0.5, 0.36, 0.4, 0.03), { p: [-0.25, 1.1, 0.05] });
      kit.add(p.soil, shape.ico(0.1, 1), { p: [-0.25, 0.98, 0.05] });
      kit.add(p.metal, shape.cyl(0.07, 0.09, 0.32, 14), { p: [-0.25, 1.38, 0.05] });
      kit.add(p.glowCyan, shape.sphere(0.035, 8), { p: [-0.25, 1.22, 0.05] });
      kit.add(p.trim, box(0.56, 0.42, 0.06, 0.03), { p: [0.3, 1.18, 0.0], r: [-0.15, 0, 0] });
      kit.add(p.screenCyan, box(0.5, 0.36, 0.02, 0.01), { p: [0.3, 1.18, 0.035], r: [-0.15, 0, 0] });
      break;
    case 'radio_console':
      kit.add(p.body, box(2.0, 0.78, 0.8, 0.05), { p: [0, 0.39, 0] });
      kit.add(p.trim, box(2.04, 0.05, 0.84, 0.02), { p: [0, 0.8, 0] });
      for (const x of [-0.65, 0, 0.65]) {
        kit.add(p.trim, box(0.56, 0.4, 0.05, 0.02), { p: [x, 1.15, -0.25] });
        kit.add(p.screenCyan, box(0.5, 0.34, 0.02, 0.01), { p: [x, 1.15, -0.22] });
      }
      kit.add(p.metal, shape.cyl(0.015, 0.015, 0.25, 6), { p: [0.4, 0.95, 0.15] });
      kit.add(p.trim, shape.sphere(0.04, 8), { p: [0.4, 1.08, 0.15] });
      break;
    case 'printer_3d':
      for (const x of [-0.85, 0.85]) for (const z of [-0.65, 0.65]) kit.add(p.metal, box(0.08, 2.2, 0.08, 0.02), { p: [x, 1.1, z] });
      for (const z of [-0.65, 0.65]) kit.add(p.metal, box(1.78, 0.08, 0.08, 0.02), { p: [0, 2.16, z] });
      kit.add(p.trim, box(1.8, 0.25, 1.4, 0.04), { p: [0, 0.125, 0] });
      kit.add(p.body, box(1.4, 0.05, 1.1, 0.02), { p: [0, 0.42, 0] });
      kit.add(p.orange, box(1.7, 0.07, 0.1, 0.02), { p: [0, 1.4, 0] });
      kit.add(p.body, box(0.28, 0.22, 0.24, 0.04), { p: [0.15, 1.3, 0] });
      kit.add(p.glowAmber, shape.cyl(0.02, 0.005, 0.1, 8), { p: [0.15, 1.15, 0] });
      kit.add(p.body, box(0.42, 0.5, 0.34, 0.03), { p: [0.15, 0.7, 0] });
      kit.add(p.screenAmber, box(0.5, 0.3, 0.02, 0.01), { p: [-0.55, 1.0, 0.71] });
      kit.add(p.teal, shape.cyl(0.18, 0.18, 0.12, 16), { p: [-0.6, 2.32, 0], r: [Math.PI / 2, 0, 0] });
      break;
    case 'workbench':
      kit.add(p.body, box(2.2, 0.08, 0.9, 0.03), { p: [0, 0.9, 0] });
      for (const x of [-1, 1]) for (const z of [-0.38, 0.38]) kit.add(p.metal, box(0.07, 0.86, 0.07, 0.02), { p: [x, 0.43, z] });
      kit.add(p.trim, box(2.0, 0.05, 0.75, 0.02), { p: [0, 0.25, 0] });
      kit.add(p.metal, box(0.28, 0.18, 0.2, 0.03), { p: [0.75, 1.03, 0.2] });
      kit.add(p.orange, box(0.5, 0.22, 0.26, 0.04), { p: [-0.6, 1.05, -0.1] });
      break;
    case 'tool_wall':
      kit.add(p.trim, box(2.4, 1.6, 0.06, 0.03), { p: [0, 1.7, -0.04] });
      for (let i = 0; i < 6; i++) {
        kit.add(i % 2 ? p.metal : p.orange, box(0.08, 0.4 + (i % 3) * 0.12, 0.04, 0.02), { p: [-0.95 + i * 0.38, 1.85, 0.01] });
      }
      kit.add(p.teal, box(0.36, 0.2, 0.08, 0.04), { p: [0.6, 1.25, 0.02] });
      break;
    case 'crate_regolith':
      kit.add(p.body, box(0.8, 0.5, 0.8, 0.04), { p: [0, 0.25, 0] });
      kit.add(p.orange, box(0.82, 0.06, 0.82, 0.02), { p: [0, 0.48, 0] });
      for (const [x, z] of [
        [-0.18, -0.15],
        [0.18, -0.12],
        [0, 0.18],
      ])
        kit.add(p.soil, shape.sphere(0.24, 10), { p: [x, 0.55, z], s: [1, 0.6, 1] });
      break;
    case 'metal_rack':
      kit.add(p.trim, box(1.4, 0.06, 0.6, 0.02), { p: [0, 0.05, 0] });
      for (const x of [-0.66, 0.66]) kit.add(p.metal, box(0.06, 1.2, 0.6, 0.02), { p: [x, 0.6, 0] });
      for (let i = 0; i < 4; i++) kit.add(p.metal, box(1.2, 0.08, 0.14, 0.02), { p: [0, 0.3 + i * 0.25, -0.15 + (i % 2) * 0.25] });
      break;
    case 'robot_arm':
      kit.add(p.trim, shape.cyl(0.35, 0.4, 0.3, 20), { p: [0, 0.15, 0] });
      kit.add(p.orange, box(0.2, 0.8, 0.2, 0.06), { p: [0, 0.7, 0], r: [0, 0, 0.15] });
      kit.add(p.orange, box(0.18, 0.7, 0.18, 0.06), { p: [0.25, 1.3, 0.1], r: [0.4, 0, -0.8] });
      kit.add(p.glowCyan, shape.sphere(0.07, 10), { p: [0.05, 1.1, 0.0] });
      kit.add(p.metal, box(0.12, 0.2, 0.12, 0.03), { p: [0.55, 1.6, 0.25] });
      break;
    case 'telescope':
      kit.add(p.trim, shape.cyl(0.32, 0.42, 1.2, 20), { p: [0, 0.6, 0] });
      kit.add(p.metal, box(1.0, 0.12, 0.3, 0.04), { p: [0, 1.28, 0] });
      for (const x of [-0.45, 0.45]) kit.add(p.metal, box(0.1, 0.7, 0.24, 0.03), { p: [x, 1.62, 0] });
      kit.add(p.body, shape.cyl(0.35, 0.35, 3.0, 28), { p: [0, 1.95, 0.4], r: [Math.PI / 2 - 0.7, 0, 0] });
      kit.add(p.violet, shape.torus(0.36, 0.05, 28, 8), { p: [0, 2.9, 1.5], r: [-0.7 + Math.PI / 2 + Math.PI / 2, 0, 0] });
      kit.add(p.metal, shape.cyl(0.06, 0.06, 0.8, 10), { p: [0.4, 2.1, 0.5], r: [Math.PI / 2 - 0.7, 0, 0] });
      break;
    case 'star_console':
      kit.add(p.body, box(1.6, 0.76, 0.8, 0.05), { p: [0, 0.38, 0] });
      kit.add(p.trim, box(1.64, 0.05, 0.84, 0.02), { p: [0, 0.78, 0] });
      for (const x of [-0.42, 0.42]) {
        kit.add(p.trim, box(0.7, 0.44, 0.05, 0.02), { p: [x, 1.08, -0.22], r: [-0.12, 0, 0] });
        kit.add(p.screenCyan, box(0.64, 0.38, 0.02, 0.01), { p: [x, 1.08, -0.19], r: [-0.12, 0, 0] });
      }
      break;
    case 'airlock_door':
      kit.add(p.metal, box(1.8, 2.5, 0.3, 0.12), { p: [0, 1.25, -0.1] });
      kit.add(p.body, box(1.3, 2.2, 0.12, 0.08), { p: [0, 1.1, 0.06] });
      kit.add(p.trim, shape.torus(0.24, 0.05, 28, 8), { p: [0, 1.55, 0.14] });
      kit.add(p.glass, shape.cyl(0.22, 0.22, 0.03, 24), { p: [0, 1.55, 0.13], r: [Math.PI / 2, 0, 0] });
      kit.add(p.orange, shape.torus(0.2, 0.035, 24, 6), { p: [0, 0.95, 0.18] });
      for (let i = 0; i < 5; i++) kit.add(i % 2 ? p.trim : p.yellow, box(0.22, 0.12, 0.02, 0.01), { p: [-0.44 + i * 0.22, 0.12, 0.16] });
      kit.add(p.glowGreen, box(1.2, 0.06, 0.04, 0.02), { p: [0, 2.42, 0.08] });
      break;
    case 'ceiling_light':
      kit.add(p.metal, shape.cyl(0.45, 0.45, 0.1, 28), { p: [0, -0.05, 0] });
      kit.add(p.glowWhite, shape.cyl(0.38, 0.38, 0.02, 28), { p: [0, -0.11, 0] });
      break;
    case 'crate_small':
      kit.add(p.body, box(0.6, 0.45, 0.5, 0.05), { p: [0, 0.225, 0] });
      kit.add(p.teal, box(0.62, 0.06, 0.52, 0.02), { p: [0, 0.32, 0] });
      kit.add(p.trim, box(0.2, 0.05, 0.02, 0.01), { p: [0, 0.2, 0.26] });
      break;
    case 'pilot_seat':
      kit.add(p.trim, box(0.7, 0.12, 0.7, 0.05), { p: [0, 0.45, 0] });
      kit.add(p.orange, box(0.62, 0.14, 0.62, 0.06), { p: [0, 0.56, 0.02] });
      kit.add(p.orange, box(0.62, 0.8, 0.14, 0.06), { p: [0, 0.98, -0.3], r: [-0.12, 0, 0] });
      kit.add(p.body, box(0.36, 0.2, 0.12, 0.05), { p: [0, 1.42, -0.36] });
      for (const x of [-0.36, 0.36]) kit.add(p.metal, box(0.06, 0.06, 0.5, 0.02), { p: [x, 0.72, 0.02] });
      kit.add(p.metal, shape.cyl(0.06, 0.08, 0.42, 10), { p: [0, 0.21, 0] });
      break;
    case 'cockpit_console':
      kit.add(p.body, box(2.6, 0.85, 0.9, 0.07), { p: [0, 0.42, 0] });
      kit.add(p.trim, box(2.5, 0.08, 0.7, 0.03), { p: [0, 0.9, 0.05], r: [-0.35, 0, 0] });
      for (const [x, screen] of [
        [-0.82, p.screenCyan],
        [0, p.screenAmber],
        [0.82, p.screenCyan],
      ] as const) {
        kit.add(p.trim, box(0.72, 0.48, 0.06, 0.03), { p: [x, 1.18, -0.28], r: [-0.18, 0, 0] });
        kit.add(screen, box(0.64, 0.4, 0.02, 0.01), { p: [x, 1.18, -0.245], r: [-0.18, 0, 0] });
      }
      for (let i = 0; i < 10; i++) kit.add(i % 3 ? p.glowGreen : p.glowAmber, shape.sphere(0.025, 6), { p: [-1.0 + i * 0.22, 0.95, 0.22] });
      for (const x of [-0.45, 0.45]) {
        kit.add(p.metal, shape.cyl(0.025, 0.03, 0.2, 8), { p: [x, 1.0, 0.3] });
        kit.add(p.orange, shape.sphere(0.05, 10), { p: [x, 1.12, 0.3] });
      }
      break;
    case 'supply_rack':
      for (const x of [-0.56, 0.56]) kit.add(p.metal, box(0.05, 2.0, 0.5, 0.02), { p: [x, 1.0, 0] });
      for (const y of [0.1, 0.75, 1.4, 1.98]) kit.add(p.body, box(1.2, 0.04, 0.5, 0.015), { p: [0, y, 0] });
      [0.1, 0.75, 1.4].forEach((y, row) => {
        for (let i = 0; i < 3; i++) kit.add([p.orange, p.teal, p.body][(i + row) % 3], box(0.32, 0.4, 0.36, 0.08), { p: [-0.36 + i * 0.36, y + 0.22, 0.02] });
      });
      break;
    case 'hatch_ladder':
      kit.add(p.trim, shape.cyl(0.45, 0.45, 0.04, 28), { p: [0, 0.02, 0] });
      kit.add(p.glowGreen, shape.torus(0.42, 0.02, 32, 6), { p: [0, 0.05, 0], r: [Math.PI / 2, 0, 0] });
      for (const x of [-0.2, 0.2]) kit.add(p.metal, shape.cyl(0.025, 0.025, 2.4, 8), { p: [x, 1.2, 0] });
      for (let i = 0; i < 6; i++) kit.add(p.metal, shape.cyl(0.018, 0.018, 0.4, 6), { p: [0, 0.3 + i * 0.36, 0], r: [0, 0, Math.PI / 2] });
      break;
    case 'window':
      break;
    case 'floor_hatch':
      kit.add(p.trim, box(1.2, 0.03, 1.2, 0.01), { p: [0, 0.015, 0] });
      for (let i = 0; i < 5; i++) kit.add(p.metal, box(1.0, 0.035, 0.05, 0.01), { p: [0, 0.02, -0.4 + i * 0.2] });
      break;
    default:
      kit.add(p.body, box(s?.w ?? 0.5, s?.h ?? 0.5, s?.d ?? 0.5), { p: [0, (s?.h ?? 0.5) / 2, 0] });
  }
  return kit.build({ cast: true, receive: true, name });
}

// ---------------------------------------------------------------------------
// Props outside (creative-mode decorations)
// ---------------------------------------------------------------------------

let outdoorPaints: Paints | null = null;

/** Game materials for the props model, by the names set in Blender. */
function propMaterial(paints: Paints): (name: string) => THREE.Material | null {
  const plain = toon({ color: '#ffffff', vertexColors: true, rim: 0.22, lift: 0.15 });
  return (name: string) => {
    if (name === 'glass') return paints.glass;
    if (name === 'screen_cyan') return paints.screenCyan;
    if (name === 'screen_green') return paints.screenGreen;
    if (name === 'screen_amber') return paints.screenAmber;
    if (name === 'glow_white') return paints.glowWhite;
    if (name === 'glow_pink') return paints.glowPink;
    if (name === 'glow_cyan') return paints.glowCyan;
    if (name === 'glow_amber') return paints.glowAmber;
    if (name === 'glow_green') return paints.glowGreen;
    return plain;
  };
}

/** One piece of furniture or a machine, from the model when it is loaded (else a stand-in). Front faces +Z. */
export function makeProp(name: string): THREE.Object3D {
  outdoorPaints ??= makePaints();
  let object: THREE.Object3D;
  try {
    object = hasModel('interior') ? modelPart('interior', name, propMaterial(outdoorPaints)) : standIn(name, outdoorPaints);
  } catch {
    object = standIn(name, outdoorPaints);
  }
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = !(mesh.material as THREE.Material).transparent;
      mesh.receiveShadow = true;
    }
  });
  return object;
}

/** How far a prop reaches from its middle, for keeping things apart. */
export function propRadius(name: string): number {
  const size = SIZE[name];
  return size ? Math.max(size.w, size.d) / 2 + 0.15 : 0.6;
}

// ---------------------------------------------------------------------------
// The interior
// ---------------------------------------------------------------------------

interface LiveStation extends Station {
  done: boolean;
  ring: THREE.Mesh;
  gem: THREE.Mesh;
  gemY: number;
  ringMaterial: THREE.MeshBasicMaterial;
  gemMaterial: THREE.MeshBasicMaterial;
}

interface RigState {
  target: THREE.Vector3;
  distance: number;
  yaw: number;
  pitch: number;
  minDistance: number;
  maxDistance: number;
  minPitch: number;
  maxPitch: number;
  autoRotate: number;
  heightAt: CameraRig['heightAt'];
  blockers: Collider[];
  avoidBlockers: boolean;
}

const SIGN: Record<StationKind, string> = { game: '#ffd166', printer: '#ffb347', look: '#7fe0ff', exit: '#7dffb0' };
// A game already won this week fades to a calm grey-blue: green is the way out.
const DONE = '#8fa0c8';
const CADET_RADIUS = 0.36;
const WALK = 3.1;
const RUN = 4.9;
const JUMP_SPEED = 3.13;

export class Interior {
  /** The room's own scene: drawn instead of the outside while the cadet is inside. */
  readonly scene = new THREE.Scene();
  active = false;
  room: RoomId | null = null;
  onHud: ((hud: InteriorHud) => void) | null = null;
  /** The use button was pressed at a station. */
  onUse: ((station: Station) => void) | null = null;
  /** Footsteps, jumps and landings, for sounds. */
  onStep: ((kind: 'step' | 'jump' | 'land') => void) | null = null;

  private readonly root = new THREE.Group();
  private plan: Plan | null = null;
  private site: SiteId = 'mars';
  private stations: LiveStation[] = [];
  private colliders: Collider[] = [];
  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  /** Seconds the cadet has stood still. */
  private still = 0;
  private heading = Math.PI;
  private grounded = true;
  private near: LiveStation | null = null;
  private hudTimer = 0;
  private saved: RigState | null = null;
  private key: THREE.DirectionalLight | null = null;
  private readonly materials: THREE.Material[] = [];
  /** G13: fake light (pools, gradient, shafts, contact shadows), high and ultra only. */
  private fx: RoomLight | null = null;
  private lumiShadow = true;
  private readonly wallMeshes: THREE.Mesh[] = [];
  private paints: Paints | null = null;
  private globe: THREE.Mesh | null = null;
  private mates: { figure: Astronaut; x: number; z: number; rot: number; heading: number; waved: number; mode: Emote }[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly astronaut: Astronaut,
    private readonly lumi: Lumi,
    private readonly rig: CameraRig,
    private readonly options: { shadows: boolean; shadowSize: number; shadowRadius?: number; pointLights: boolean; outlines: boolean; roomLight?: boolean; suit?: () => string },
  ) {
    this.scene.add(this.root);
    this.scene.name = 'interior';
  }

  /** Go inside: build the room and put the cadet (and Lumi) at its door. */
  open(room: RoomId, look: RoomLook): void {
    this.clearRoom();
    this.site = look.site;
    const plan = planFor(room, look);
    this.plan = plan;
    this.room = room;
    this.active = true;
    this.paints ??= makePaints();
    this.scene.background = new THREE.Color(plan.tone.dark);

    this.buildShell(plan);
    this.buildProps(plan);
    this.buildStations(plan, look.done);
    this.buildLights(plan);
    this.buildDecor(plan);
    if (this.options.roomLight) this.buildRoomLight(plan);
    // Crewmates, each in a suit colour that is not the cadet's.
    const mine = this.options.suit?.() ?? '';
    const colours = SUIT_COLORS.filter((colour) => colour !== mine);
    (plan.mates ?? []).forEach((spot, index) => {
      const figure = new Astronaut(colours[(index + room.length) % colours.length], this.options.outlines);
      figure.group.position.set(spot.x, 0, spot.z);
      figure.group.rotation.y = spot.rot;
      this.root.add(figure.group);
      figure.play('drill');
      this.mates.push({ figure, ...spot, heading: spot.rot, waved: -99, mode: 'drill' });
      this.colliders.push({ x: spot.x, z: spot.z, r: 0.45 });
    });

    // In through the door, facing into the room.
    const exit = plan.stations.find((station) => station.kind === 'exit');
    this.position.set(0, 0, (exit?.z ?? 0) - (plan.spawnIn ?? 2.3));
    this.velocity.set(0, 0, 0);
    this.heading = Math.PI;
    this.grounded = true;
    this.scene.add(this.astronaut.group, this.lumi.group);
    this.astronaut.group.visible = true;
    this.astronaut.play('none');
    this.astronaut.setAltitude(0);
    this.syncCadet();

    if (!this.saved) this.saveRig();
    const rig = this.rig;
    rig.heightAt = () => 0;
    rig.blockers = [];
    rig.avoidBlockers = false;
    rig.autoRotate = 0;
    rig.minDistance = 1.8;
    rig.maxDistance = 7.5;
    rig.minPitch = 0.02;
    rig.maxPitch = 1.2;
    rig.limit = this.limitCamera;
    rig.follow(this.position, 1.25);
    rig.setAngles(0, 0.4);
    rig.setDistance(4.3);
    rig.snap();

    this.lumi.goal.set(this.position.x + 0.9, 2.1, this.position.z - 0.6);
    this.lumi.snap();
    // Rooms are bright and close: a softer ring and halo keep Lumi from washing out.
    this.lumi.bright = 0.45;
    this.still = 0;
    this.near = null;
    this.pushHud(true);
  }

  /** Come out: the room is taken down and the camera gets its old settings back. */
  close(): void {
    if (!this.active) return;
    this.active = false;
    this.room = null;
    this.pinned = false;
    this.restoreRig();
    this.astronaut.group.visible = true;
    this.scene.remove(this.astronaut.group, this.lumi.group);
    this.setLumiShadow(true);
    this.lumi.bright = 1;
    this.clearRoom();
  }

  /** Mark stations as used (the sign above them turns green). */
  setDone(ids: string[]): void {
    for (const station of this.stations) {
      const done = ids.includes(station.id);
      if (done === station.done) continue;
      station.done = done;
      const color = new THREE.Color(done ? DONE : SIGN[station.kind]);
      station.ringMaterial.color.copy(color).multiplyScalar(1.8);
      station.gemMaterial.color.copy(color).multiplyScalar(2.4);
    }
    this.pushHud(true);
  }

  update(dt: number, time: number, input: InputState, paused: boolean): void {
    if (!this.active || !this.plan) return;
    if (!paused) this.walk(dt, input);
    else this.astronaut.update(dt, { speed: 0, grounded: true, vy: 0, floaty: this.site === 'moon' });
    // A wall pins the camera and hides the cadet: once the cadet stands still (and the player is not turning
    // the view) the camera swings round to the side that faces the middle of the room. Never while walking,
    // because the controls steer by the camera.
    const still = Math.abs(input.moveX) < 0.1 && Math.abs(input.moveY) < 0.1;
    if (this.pinned && !paused && still && this.rig.idle > 1.2 && Math.hypot(this.position.x, this.position.z) > 0.8) {
      const wanted = Math.atan2(-this.position.x, -this.position.z);
      const delta = Math.atan2(Math.sin(wanted - this.rig.yaw), Math.cos(wanted - this.rig.yaw));
      this.rig.setAngles(this.rig.yaw + delta * Math.min(1, dt * 1.6), this.rig.pitch);
    }

    // Crewmates work; when the cadet comes close they turn round and wave.
    for (const mate of this.mates) {
      const away = Math.hypot(this.position.x - mate.x, this.position.z - mate.z);
      const close = away < 3.2;
      const goal = close ? Math.atan2(this.position.x - mate.x, this.position.z - mate.z) : mate.rot;
      const delta = Math.atan2(Math.sin(goal - mate.heading), Math.cos(goal - mate.heading));
      mate.heading += delta * Math.min(1, dt * 5);
      mate.figure.group.rotation.y = mate.heading;
      const waving = time - mate.waved < 2.3;
      if (close && !waving && time - mate.waved > 12) {
        mate.waved = time;
        mate.mode = 'wave';
        mate.figure.play('wave');
      } else if (!waving && mate.mode !== (close ? 'none' : 'drill')) {
        // Back to work when the cadet walks on; just standing while the cadet is there.
        mate.mode = close ? 'none' : 'drill';
        mate.figure.play(mate.mode);
      }
      mate.figure.update(dt, { speed: 0, grounded: true, vy: 0, floaty: this.site === 'moon' });
    }

    // Signs bob and turn; the one the cadet stands at grows.
    let nearest: LiveStation | null = null;
    let best = Infinity;
    for (const station of this.stations) {
      const distance = Math.hypot(this.position.x - station.x, this.position.z - station.z);
      const reach = station.kind === 'exit' ? 1.15 : 1.0;
      if (distance < reach && distance < best) {
        best = distance;
        nearest = station;
      }
      station.gem.rotation.y = time * 1.4;
      station.gem.position.y = station.gemY + Math.sin(time * 2.2 + station.x) * 0.08;
      const pulse = 1 + Math.sin(time * 3 + station.z) * 0.07 + (station === this.near ? 0.18 : 0);
      station.ring.scale.set(pulse, pulse, 1);
    }
    this.near = nearest;
    if (!paused && input.interact && nearest) this.onUse?.(nearest);

    if (this.globe) this.globe.rotation.y = time * 0.25;

    // Lumi floats beside the cadet, a little ahead.
    const yaw = this.astronaut.group.rotation.y;
    const p = this.position;
    this.lumi.goal.set(p.x + Math.cos(yaw) * 1.25 + Math.sin(yaw) * 0.7, p.y + 2.25, p.z - Math.sin(yaw) * 1.25 + Math.cos(yaw) * 0.7);
    // Standing still for a moment, Lumi turns round and looks at the player.
    this.still = Math.hypot(this.velocity.x, this.velocity.z) < 0.35 ? this.still + dt : 0;
    if (this.still > 1.2) this.lumi.lookTarget.copy(this.rig.camera.position);
    else this.lumi.lookTarget.set(p.x + Math.sin(yaw) * 5, p.y + 1.3, p.z + Math.cos(yaw) * 5);
    this.lumi.update(dt, 0.1);

    this.rig.follow(this.position, 1.25);
    this.pushHud(false, dt);
  }

  /** After the camera has moved: the light direction and colour mood the cel shading uses. */
  applyLook(camera: THREE.Camera, post: PostFX): void {
    if (!this.plan || !this.key) return;
    const tone = this.plan.tone;
    this.tmp.copy(this.key.position).sub(this.key.target.position).normalize();
    GLOBALS.sunDirView.value.copy(this.tmp).transformDirection(camera.matrixWorldInverse);
    GLOBALS.rimColor.value.set(tone.rim).multiplyScalar(0.8);
    GLOBALS.skyColor.value.set(tone.sky);
    GLOBALS.night.value = 0.65;
    GLOBALS.dust.value = 0;
    this.setRoomBounce(tone);
    const grade = tone.grade;
    post.grade.exposure = grade.exposure;
    post.grade.saturation = grade.saturation;
    post.grade.contrast = grade.contrast;
    post.grade.tint.setRGB(grade.tint[0], grade.tint[1], grade.tint[2]);
    post.grade.bloom = grade.bloom;
    post.grade.vignette = grade.vignette;
    post.specks = 0;
    if (this.fx) {
      this.fx.group.visible = flag('G13');
      this.setLumiShadow(!flag('G13'));
      this.fx.setCadet(this.position.x, this.position.y, this.position.z);
    }
  }

  /** Where the cadet stands in the room (for tests). */
  get cadet(): { x: number; z: number } {
    return { x: this.position.x, z: this.position.z };
  }

  /** Put the cadet somewhere in the room (tests). */
  teleport(x: number, z: number): void {
    this.position.set(x, 0, z);
    this.syncCadet();
  }

  /** Where the room's stations are (tests). */
  stationPoints(): readonly Station[] {
    return this.stations;
  }

  dispose(): void {
    this.close();
    this.clearRoom();
  }

  // ----- Walking -------------------------------------------------------------

  private walk(dt: number, input: InputState): void {
    const moon = this.site === 'moon';
    const gravity = SITES[this.site].gravity;
    const top = input.sprint ? RUN : WALK;
    const yaw = this.rig.yaw;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const wishX = (forwardX * input.moveY + rightX * input.moveX) * top;
    const wishZ = (forwardZ * input.moveY + rightZ * input.moveX) * top;
    const grip = this.grounded ? 12 : moon ? 1.4 : 2.6;
    const k = Math.min(1, dt * grip);
    this.velocity.x += (wishX - this.velocity.x) * k;
    this.velocity.z += (wishZ - this.velocity.z) * k;
    if (input.jump && this.grounded) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
      this.onStep?.('jump');
    }
    if (!this.grounded) this.velocity.y -= gravity * dt;
    this.position.addScaledVector(this.velocity, dt);

    // Furniture pushes the cadet out.
    for (const c of this.colliders) {
      const dx = this.position.x - c.x;
      const dz = this.position.z - c.z;
      const distance = Math.hypot(dx, dz);
      const min = c.r + CADET_RADIUS;
      if (distance < min && distance > 1e-4) {
        const nx = dx / distance;
        const nz = dz / distance;
        this.position.x = c.x + nx * min;
        this.position.z = c.z + nz * min;
        const into = this.velocity.x * nx + this.velocity.z * nz;
        if (into < 0) {
          this.velocity.x -= into * nx;
          this.velocity.z -= into * nz;
        }
      }
    }
    // The walls.
    const shell = this.plan!.shell;
    if (shell.kind === 'dome') {
      const max = shell.r - 0.55;
      const distance = Math.hypot(this.position.x, this.position.z);
      if (distance > max) {
        this.position.x *= max / distance;
        this.position.z *= max / distance;
      }
    } else {
      const halfX = shell.w / 2 - 0.55;
      const halfZ = shell.l / 2 - 0.55;
      this.position.x = THREE.MathUtils.clamp(this.position.x, -halfX, halfX);
      this.position.z = THREE.MathUtils.clamp(this.position.z, -halfZ, halfZ);
    }
    // The ceiling stops a jump, the floor ends it.
    const ceiling = (shell.kind === 'dome' ? shell.h : shell.wall + shell.rise) - 2.1;
    if (this.position.y > ceiling) {
      this.position.y = ceiling;
      this.velocity.y = Math.min(0, this.velocity.y);
    }
    if (!this.grounded && this.position.y <= 0) {
      this.position.y = 0;
      this.velocity.y = 0;
      this.grounded = true;
      this.onStep?.('land');
    }
    if (this.grounded) this.position.y = 0;

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed > 0.3) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      const delta = Math.atan2(Math.sin(target - this.heading), Math.cos(target - this.heading));
      this.heading += delta * Math.min(1, dt * 12);
    }
    this.astronaut.update(dt, { speed: Math.min(1.25, speed / 4.4), grounded: this.grounded, vy: this.velocity.y, floaty: moon });
    if (this.astronaut.footstep.left || this.astronaut.footstep.right) this.onStep?.('step');
    this.syncCadet();
  }

  private syncCadet(): void {
    this.astronaut.group.position.copy(this.position);
    this.astronaut.group.rotation.y = this.heading;
    this.astronaut.setAltitude(Math.max(0, this.position.y));
  }

  // ----- Camera ----------------------------------------------------------------

  /**
   * Keep the camera inside the room. When a wall would push it into the cadet's helmet,
   * it rises step by step and looks over the cadet's shoulder instead.
   */
  private readonly limitCamera = (camera: THREE.Vector3, target: THREE.Vector3): void => {
    const dx = camera.x - target.x;
    const dy = camera.y - target.y;
    const dz = camera.z - target.z;
    const full = Math.hypot(dx, dy, dz);
    const flat = Math.hypot(dx, dz);
    if (full < 1e-6) return;
    // Closer than this, the camera would be inside the cadet's head.
    const near = Math.min(full, 2.2);
    const start = Math.atan2(dy, flat);
    let first: { x: number; y: number; z: number; reach: number } | null = null;
    let found: { x: number; y: number; z: number; reach: number } | null = null;
    for (let pitch = start; pitch <= Math.max(start, 1.3) + 1e-6 && !found; pitch += 0.08) {
      const ux = flat > 1e-6 ? (dx / flat) * Math.cos(pitch) : 0;
      const uz = flat > 1e-6 ? (dz / flat) * Math.cos(pitch) : 0;
      const uy = Math.sin(pitch);
      let reach = full;
      for (let i = 0; i < 18 && !this.inside(target.x + ux * reach, target.y + uy * reach, target.z + uz * reach, 0.32); i++) reach *= 0.86;
      const spot = { x: ux * reach, y: uy * reach, z: uz * reach, reach };
      first ??= spot;
      if (reach >= near) found = spot;
    }
    // Right against a curved wall no height helps: the camera keeps its angle and the cadet steps
    // out of the picture for a moment (as in most third-person games), so the view is never the
    // inside of the helmet.
    const best = found ?? first!;
    camera.set(target.x + best.x, target.y + best.y, target.z + best.z);
    this.astronaut.group.visible = best.reach > 1.2;
    // A wall is pinning the camera close to the cadet: it will swing toward the middle of the room.
    this.pinned = best.reach < full * 0.6;
  };

  private inside(x: number, y: number, z: number, margin: number): boolean {
    const shell = this.plan?.shell;
    if (!shell) return true;
    if (shell.kind === 'dome') {
      if (y > shell.h - margin) return false;
      const reach = domeRadiusAt(shell, Math.max(0, y)) - margin;
      return x * x + z * z < reach * reach;
    }
    if (y > shell.wall + shell.rise - margin) return false;
    const half = hallHalfAt(shell, Math.max(0, y)) - margin;
    return Math.abs(x) < half && Math.abs(z) < shell.l / 2 - margin;
  }

  /** The camera is pushed close to the cadet by a wall (see `limitCamera`). */
  private pinned = false;

  private saveRig(): void {
    const rig = this.rig;
    this.saved = {
      target: rig.target.clone(),
      distance: rig.distance,
      yaw: rig.yaw,
      pitch: rig.pitch,
      minDistance: rig.minDistance,
      maxDistance: rig.maxDistance,
      minPitch: rig.minPitch,
      maxPitch: rig.maxPitch,
      autoRotate: rig.autoRotate,
      heightAt: rig.heightAt,
      blockers: rig.blockers,
      avoidBlockers: rig.avoidBlockers,
    };
  }

  private restoreRig(): void {
    const saved = this.saved;
    if (!saved) return;
    const rig = this.rig;
    rig.limit = null;
    rig.minDistance = saved.minDistance;
    rig.maxDistance = saved.maxDistance;
    rig.minPitch = saved.minPitch;
    rig.maxPitch = saved.maxPitch;
    rig.autoRotate = saved.autoRotate;
    rig.heightAt = saved.heightAt;
    rig.blockers = saved.blockers;
    rig.avoidBlockers = saved.avoidBlockers;
    rig.setSpot({ target: saved.target, distance: saved.distance, yaw: saved.yaw, pitch: saved.pitch }, true);
    this.saved = null;
  }

  // ----- Building the room -----------------------------------------------------

  private own<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  private buildShell(plan: Plan): void {
    const tone = plan.tone;
    const shell = plan.shell;
    // Walls in the same cel shading as everything else, lifted a little so the room never goes dark.
    const panels = panelTexture(tone.wall, tone.seam, tone.accent);
    const wallToon = toon({ color: '#ffffff', map: panels, rim: 0.08, lift: 0.22 });
    const wallInside = toon({ color: '#ffffff', map: panels, rim: 0.08, lift: 0.22, side: THREE.BackSide });
    const floor = toon({ color: '#ffffff', map: floorTexture(tone.floor, tone.floorLine), rim: 0.05, lift: 0.18 });
    const rib = toon({ color: tone.rib, rim: 0.3, spec: 0.3, lift: 0.14 });
    const accent = glow(tone.accent, 1.9);
    this.own(accent);

    const group = new THREE.Group();
    group.name = 'shell';
    if (shell.kind === 'dome') {
      const scaleY = shell.h / shell.r;
      // A glass dome is solid up to 62% of its height; the rest shows the sky. Angles count from the top.
      const cut = shell.roof === 'glass' ? Math.acos(0.62) : 0;
      const wallGeo = new THREE.SphereGeometry(shell.r, 64, 22, 0, Math.PI * 2, cut, Math.PI / 2 - cut);
      wallGeo.scale(1, scaleY, 1);
      remapUv(wallGeo, (2 * Math.PI * shell.r) / 1.6, (shell.r * 1.5) / 1.6);
      const wallMesh = new THREE.Mesh(wallGeo, wallInside);
      wallMesh.receiveShadow = true;
      group.add(wallMesh);
      this.wallMeshes.push(wallMesh);
      if (shell.roof === 'glass') {
        const cap = new THREE.SphereGeometry(shell.r - 0.02, 64, 14, 0, Math.PI * 2, 0, cut);
        cap.scale(1, scaleY, 1);
        const skyMaterial = this.own(new THREE.MeshBasicMaterial({ map: skyTexture(this.site), side: THREE.BackSide, toneMapped: false }));
        skyMaterial.color.setScalar(1.05);
        group.add(new THREE.Mesh(cap, skyMaterial));
        // Glass frame: rings and ribs.
        for (const share of [0.62, 0.8, 0.93]) {
          const y = shell.h * share;
          const ring = new THREE.Mesh(shape.torus(domeRadiusAt(shell, y) - 0.04, 0.05, 72, 6), rib);
          ring.rotation.x = Math.PI / 2;
          ring.position.y = y;
          group.add(ring);
        }
      }
      if (shell.roof === 'slit') {
        // The observatory's open slit: a band of starry sky over the top, toward the telescope.
        const stars = this.own(new THREE.MeshBasicMaterial({ map: starTexture(), side: THREE.DoubleSide, toneMapped: false }));
        group.add(new THREE.Mesh(slitBand(shell, 1.5, 48, 0.985), stars));
        for (const side of [-1, 1]) {
          const rail: [number, number, number][] = [];
          for (let i = 0; i <= 30; i++) {
            const point = onDome(shell, side * 0.82, 0.16 + (i / 30) * (Math.PI / 2 - 0.16), 0.975);
            rail.push([point.x, point.y, point.z]);
          }
          group.add(new THREE.Mesh(shape.tube(rail, 0.07, 48, 6), rib));
        }
      }
      // Ribs from the floor to the top.
      const ribKit = new Kit();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + Math.PI / 10;
        if (shell.roof === 'slit' && Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) < 0.2) continue;
        const points: [number, number, number][] = [];
        for (let j = 0; j <= 16; j++) {
          const phi = (j / 16) * (Math.PI / 2) * 0.97;
          const r = Math.cos(phi) * (shell.r - 0.06);
          points.push([Math.sin(a) * r, Math.sin(phi) * (shell.h - 0.06), Math.cos(a) * r]);
        }
        ribKit.add(rib, shape.tube(points, 0.075, 32, 6));
      }
      // Skirting at the floor and a ring of light.
      ribKit.add(rib, shape.torus(shell.r - 0.14, 0.14, 96, 6), { p: [0, 0.16, 0], r: [Math.PI / 2, 0, 0] });
      group.add(ribKit.build({ cast: false, receive: true }));
      const stripY = Math.min(2.9, shell.h * 0.5);
      const strip = new THREE.Mesh(shape.torus(domeRadiusAt(shell, stripY) - 0.06, 0.035, 120, 6), accent);
      strip.rotation.x = Math.PI / 2;
      strip.position.y = stripY;
      group.add(strip);
      // Floor and a round rug in the middle.
      const floorGeo = new THREE.CircleGeometry(shell.r, 72).rotateX(-Math.PI / 2);
      remapUvPlanar(floorGeo, 1.6);
      const floorMesh = new THREE.Mesh(floorGeo, floor);
      floorMesh.receiveShadow = true;
      group.add(floorMesh);
      const rug = new THREE.Mesh(new THREE.CircleGeometry(2.4, 48).rotateX(-Math.PI / 2), toon({ color: mix(tone.floor, tone.accent, 0.35), rim: 0, lift: 0.2 }));
      rug.position.y = 0.012;
      rug.receiveShadow = true;
      group.add(rug);
    } else {
      const hall = shell;
      const profile = hallProfile(hall, 40);
      const surface = sweep(profile, hall.l, 26);
      const wallMesh = new THREE.Mesh(surface, wallToon);
      wallMesh.receiveShadow = true;
      group.add(wallMesh);
      this.wallMeshes.push(wallMesh);
      if (hall.roof === 'glass') {
        // Glass panels between the ribs: the roof shows the sky.
        const roofProfile = profile.filter((point) => point.y >= hall.wall + hall.rise * 0.35);
        const roof = sweep(roofProfile.map((point) => point.clone().multiplyScalar(0.995)), hall.l, 26);
        const skyMaterial = this.own(new THREE.MeshBasicMaterial({ map: skyTexture(this.site), toneMapped: false }));
        group.add(new THREE.Mesh(roof, skyMaterial));
      }
      // End walls.
      for (const end of [-1, 1]) {
        const outline = new THREE.Shape(profile.map((point) => new THREE.Vector2(point.x, point.y)));
        const cap = new THREE.ShapeGeometry(outline, 24);
        remapUvPlanarXY(cap, 1.6);
        const capMesh = new THREE.Mesh(cap, wallToon);
        capMesh.position.z = (end * hall.l) / 2;
        if (end === 1) capMesh.rotation.y = Math.PI;
        capMesh.receiveShadow = true;
        group.add(capMesh);
        this.wallMeshes.push(capMesh);
      }
      // Ribs across, skirting along the floor.
      const ribKit = new Kit();
      const ribs = Math.max(3, Math.round(hall.l / 2.2));
      for (let i = 0; i <= ribs; i++) {
        const z = -hall.l / 2 + 0.2 + (i / ribs) * (hall.l - 0.4);
        const points = profile.map((point) => [point.x * 0.985, Math.min(point.y, hall.wall + hall.rise - 0.05), z] as [number, number, number]);
        ribKit.add(rib, shape.tube(points, 0.07, 48, 6));
      }
      for (const side of [-1, 1]) ribKit.add(rib, shape.cyl(0.12, 0.12, hall.l, 8), { p: [side * (hall.w / 2 - 0.1), 0.14, 0], r: [Math.PI / 2, 0, 0] });
      group.add(ribKit.build({ cast: false, receive: true }));
      const floorGeo = new THREE.PlaneGeometry(hall.w, hall.l).rotateX(-Math.PI / 2);
      remapUvPlanar(floorGeo, 1.6);
      const floorMesh = new THREE.Mesh(floorGeo, floor);
      floorMesh.receiveShadow = true;
      group.add(floorMesh);
      const walkway = new THREE.Mesh(new THREE.PlaneGeometry(1.4, hall.l - 1).rotateX(-Math.PI / 2), toon({ color: mix(tone.floor, tone.accent, 0.3), rim: 0, lift: 0.2 }));
      walkway.position.y = 0.012;
      walkway.receiveShadow = true;
      group.add(walkway);
    }

    // Light strips.
    for (const strip of plan.strips) {
      const from = new THREE.Vector3(...strip.from);
      const to = new THREE.Vector3(...strip.to);
      const length = from.distanceTo(to);
      const material = this.own(glow(strip.color, 2.4));
      const bar = new THREE.Mesh(shape.cyl(strip.width ?? 0.05, strip.width ?? 0.05, length, 8), material);
      bar.position.copy(from).add(to).multiplyScalar(0.5);
      bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      group.add(bar);
    }

    // Windows: the world outside, in a round frame.
    if (plan.windows.length) {
      const view = this.own(new THREE.MeshBasicMaterial({ map: viewTexture(this.site), toneMapped: false }));
      view.color.setScalar(1.08);
      for (const window of plan.windows) {
        // Lie flat against the wall: on a dome the wall leans in, so follow its slope.
        const outward =
          shell.kind === 'dome'
            ? new THREE.Vector3(window.x / shell.r ** 2, window.y / shell.h ** 2, window.z / shell.r ** 2).normalize()
            : new THREE.Vector3(0, 0, window.z < 0 ? -1 : 1);
        const holder = new THREE.Group();
        holder.position.set(window.x, window.y, window.z).addScaledVector(outward, -0.07);
        holder.lookAt(holder.position.clone().sub(outward));
        const pane = new THREE.Mesh(new THREE.CircleGeometry(window.r, 40), view);
        pane.position.z = 0.01;
        const frame = new THREE.Mesh(shape.torus(window.r + 0.04, 0.08, 48, 10), rib);
        frame.position.z = 0.03;
        holder.add(pane, frame);
        group.add(holder);
      }
    }
    this.root.add(group);
  }

  private buildProps(plan: Plan): void {
    const paints = this.paints!;
    const fromModel = hasModel('interior');
    const pick = this.pickMaterial(paints);
    this.colliders = [];
    for (const placed of plan.props) {
      const size = SIZE[placed.name];
      let object: THREE.Object3D;
      try {
        object = fromModel ? modelPart('interior', placed.name, pick) : standIn(placed.name, paints);
      } catch {
        object = standIn(placed.name, paints);
      }
      object.position.set(placed.x, placed.y ?? 0, placed.z);
      object.rotation.y = placed.rot;
      if (placed.scale) object.scale.setScalar(placed.scale);
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = !(mesh.material as THREE.Material).transparent;
          mesh.receiveShadow = true;
        }
      });
      this.root.add(object);
      if (!size || size.free) continue;
      if (size.round) {
        this.colliders.push({ x: placed.x, z: placed.z, r: size.w / 2 + 0.04 });
        continue;
      }
      // Long things collide as a row of circles.
      const count = Math.max(1, Math.round(size.w / size.d));
      const r = size.d / 2 + 0.06;
      for (let i = 0; i < count; i++) {
        const offset = count === 1 ? 0 : -size.w / 2 + r + ((size.w - 2 * r) * i) / (count - 1);
        this.colliders.push({ x: placed.x + Math.cos(placed.rot) * offset, z: placed.z - Math.sin(placed.rot) * offset, r });
      }
    }
  }

  /** Pictures on the walls and a globe that turns. */
  private buildDecor(plan: Plan): void {
    const shell = plan.shell;
    const frame = toon({ color: '#2f3658', rim: 0.3, lift: 0.1 });
    this.globe = null;
    for (const item of plan.decor ?? []) {
      if (item.kind === 'globe') {
        const holder = new THREE.Group();
        holder.position.set(item.x, item.y, item.z);
        const map = item.r > 0.25 ? planetTexture(this.site) : planetTexture(this.site === 'mars' ? 'moon' : 'mars');
        const ball = new THREE.Mesh(new THREE.SphereGeometry(item.r, 32, 20), toon({ color: '#ffffff', map, rim: 0.35, spec: 0.3, lift: 0.16 }));
        ball.rotation.z = 0.41; // tilted, like a real globe
        ball.castShadow = true;
        const ring = new THREE.Mesh(shape.torus(item.r + 0.04, 0.012, 48, 6, Math.PI * 1.2), toon({ color: '#c9a45c', rim: 0.4, spec: 0.6 }));
        ring.rotation.set(0, Math.PI / 2, 0.41 - Math.PI / 2);
        // A table globe has a short foot; a floor globe a tall post on a wide base.
        const tall = item.floor ? item.y - item.r * 0.7 : item.r + 0.1;
        const brass = toon({ color: '#c9a45c', rim: 0.4, spec: 0.6 });
        const stand = new THREE.Mesh(shape.cyl(item.floor ? 0.025 : 0.03, item.floor ? 0.05 : 0.09, tall, 12), brass);
        stand.position.y = item.floor ? -item.y + tall / 2 : -(item.r + 0.05);
        holder.add(ball, ring, stand);
        if (item.floor) {
          const base = new THREE.Mesh(shape.cyl(0.24, 0.28, 0.06, 20), brass);
          base.position.y = -item.y + 0.03;
          holder.add(base);
          this.colliders.push({ x: item.x, z: item.z, r: item.r + 0.12 });
        }
        this.root.add(holder);
        this.globe = ball;
        continue;
      }
      // A picture or a screen, flat against the wall.
      let position: THREE.Vector3;
      let outward: THREE.Vector3;
      if (shell.kind === 'dome') {
        const a = (item.angle ?? 0) * DEG;
        const reach = domeRadiusAt(shell, item.y) - 0.06;
        position = new THREE.Vector3(Math.sin(a) * reach, item.y, Math.cos(a) * reach);
        outward = new THREE.Vector3(position.x / shell.r ** 2, position.y / shell.h ** 2, position.z / shell.r ** 2).normalize();
      } else if ((item.side ?? 0) === 0) {
        position = new THREE.Vector3(item.x ?? 0, item.y, -shell.l / 2 + 0.04);
        outward = new THREE.Vector3(0, 0, -1);
      } else {
        const side = item.side ?? 1;
        position = new THREE.Vector3(side * (hallHalfAt(shell, item.y) - 0.04), item.y, item.z ?? 0);
        outward = new THREE.Vector3(side, 0, 0);
      }
      const holder = new THREE.Group();
      holder.position.copy(position).addScaledVector(outward, -0.05);
      holder.lookAt(holder.position.clone().sub(outward));
      const glowing = item.art === 'status' || item.art === 'stars';
      const texture = artTexture(item.art, this.site);
      const face = glowing
        ? this.own(new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }))
        : toon({ color: '#ffffff', map: texture, rim: 0.1, lift: 0.25 });
      if (glowing) (face as THREE.MeshBasicMaterial).color.setScalar(1.25);
      const picture = new THREE.Mesh(item.art === 'emblem' ? new THREE.CircleGeometry(item.w / 2, 48) : new THREE.PlaneGeometry(item.w, item.h), face);
      picture.position.z = 0.03;
      if (item.art === 'emblem') (face as THREE.Material).transparent = true;
      if (item.art !== 'emblem') {
        const border = new THREE.Mesh(new RoundedBoxGeometry(item.w + 0.12, item.h + 0.12, 0.05, 2, 0.03), frame);
        holder.add(border);
      }
      holder.add(picture);
      this.root.add(holder);
    }
  }

  /** Game materials for the Blender model's material names. */
  private pickMaterial(paints: Paints): (name: string) => THREE.Material | null {
    const plain = toon({ color: '#ffffff', vertexColors: true, rim: 0.22, lift: 0.15 });
    return (name: string) => {
      if (name === 'glass') return paints.glass;
      if (name === 'screen_cyan') return paints.screenCyan;
      if (name === 'screen_green') return paints.screenGreen;
      if (name === 'screen_amber') return paints.screenAmber;
      if (name === 'glow_white') return paints.glowWhite;
      if (name === 'glow_pink') return paints.glowPink;
      if (name === 'glow_cyan') return paints.glowCyan;
      if (name === 'glow_amber') return paints.glowAmber;
      if (name === 'glow_green') return paints.glowGreen;
      return plain;
    };
  }

  private buildStations(plan: Plan, done: string[]): void {
    this.stations = [];
    for (const station of plan.stations) {
      const isDone = done.includes(station.id);
      const color = new THREE.Color(isDone ? DONE : SIGN[station.kind]);
      const ringMaterial = this.own(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
      ringMaterial.color.multiplyScalar(1.8);
      const gemMaterial = this.own(new THREE.MeshBasicMaterial({ color: color.clone(), toneMapped: false }));
      gemMaterial.color.multiplyScalar(2.4);
      // Game rings are bigger and thicker, so a child sees at once which ring is the game.
      const isGame = station.kind === 'game' || station.kind === 'printer';
      const ring = new THREE.Mesh(isGame ? shape.torus(0.72, 0.06, 48, 6) : shape.torus(0.62, 0.035, 48, 6), ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(station.x, 0.04, station.z);
      const prop = plan.props.find((placed) => placed.name === station.thing && Math.hypot(placed.x - station.x, placed.z - station.z) < 3);
      const height = prop ? (SIZE[prop.name]?.h ?? 1.6) + (prop.y ?? 0) : 1.8;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(isGame ? 0.23 : 0.15, 0), gemMaterial);
      const gemX = station.kind === 'exit' ? 0 : prop ? prop.x : station.x;
      const gemZ = station.kind === 'exit' ? station.z + 0.6 : prop ? prop.z : station.z;
      const gemY = Math.min(height + 0.45, this.ceilingAt(gemX, gemZ) - 0.4);
      gem.position.set(gemX, gemY, gemZ);
      this.root.add(ring, gem);
      this.stations.push({ ...station, done: isDone, ring, gem, gemY, ringMaterial, gemMaterial });
    }
  }

  private ceilingAt(x: number, z: number): number {
    const shell = this.plan!.shell;
    if (shell.kind === 'dome') {
      const d = Math.min(shell.r * 0.999, Math.hypot(x, z));
      return shell.h * Math.sqrt(1 - (d / shell.r) ** 2);
    }
    const half = shell.w / 2;
    const share = Math.min(1, Math.abs(x) / half);
    return shell.wall + shell.rise * Math.sqrt(1 - share * share);
  }

  /** Bounce light (G3): the room's sky tone above, its ground tone below, the mean at the sides; no shadow tint. */
  private setRoomBounce(tone: Tone): void {
    GLOBALS.bounce.value = flag('G3') ? 1 : 0;
    GLOBALS.ambSky.value.set(tone.sky).multiplyScalar(tone.hemi);
    GLOBALS.ambGround.value.set(tone.ground).multiplyScalar(tone.hemi);
    GLOBALS.ambSide.value.copy(GLOBALS.ambSky.value).add(GLOBALS.ambGround.value).multiplyScalar(0.5);
    GLOBALS.shadowTint.value.setRGB(1, 1, 1);
  }

  private buildLights(plan: Plan): void {
    const tone = plan.tone;
    const hemi = new THREE.HemisphereLight(tone.sky, tone.ground, tone.hemi);
    const key = new THREE.DirectionalLight(tone.key, tone.keyPower);
    const shell = plan.shell;
    const height = shell.kind === 'dome' ? shell.h : shell.wall + shell.rise;
    key.position.set(1.8, height + 2, 3.2);
    key.target.position.set(0, 0, -0.5);
    if (this.options.shadows) {
      key.castShadow = true;
      const reach = shell.kind === 'dome' ? shell.r : Math.max(shell.w, shell.l) / 2;
      const camera = key.shadow.camera;
      camera.left = -reach;
      camera.right = reach;
      camera.top = reach;
      camera.bottom = -reach;
      camera.near = 0.5;
      camera.far = height + 12;
      key.shadow.mapSize.setScalar(Math.min(2048, this.options.shadowSize));
      key.shadow.radius = this.options.shadowRadius ?? 1;
      key.shadow.bias = -0.0006;
      key.shadow.normalBias = 0.02;
    }
    this.key = key;
    this.root.add(hemi, key, key.target);
    if (this.options.pointLights) {
      for (const lamp of tone.lamps) {
        const light = new THREE.PointLight(lamp.color, lamp.power, lamp.reach, 1.6);
        light.position.set(lamp.x, lamp.y, lamp.z);
        this.root.add(light);
      }
    } else {
      // Without point lights, a little more of the sky light.
      hemi.intensity *= 1.15;
    }
  }

  /**
   * Lumi floats 2 m up, so its key-light shadow lands on the floor as a big dark blob far from it that reads as a stray stain.
   * With the room light (G13, high and ultra) it casts none inside; outdoors and on low and medium it keeps it.
   */
  private setLumiShadow(on: boolean): void {
    if (on === this.lumiShadow) return;
    this.lumiShadow = on;
    this.lumi.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.userData.castShadowKept ??= object.castShadow;
      object.castShadow = on && object.userData.castShadowKept === true;
    });
  }

  /** G13: floor pools under the lamps, wall gradient, window shafts and contact shadows. */
  private buildRoomLight(plan: Plan): void {
    const shell = plan.shell;
    const tone = plan.tone;
    const height = shell.kind === 'dome' ? shell.h : shell.wall + shell.rise;
    const lampAt = (x: number, z: number): string => {
      let best = tone.lamps[0]?.color ?? tone.key;
      let near = Infinity;
      for (const lamp of tone.lamps) {
        const d = Math.hypot(lamp.x - x, lamp.z - z);
        if (lamp.y > 2.4 && d < near) {
          near = d;
          best = lamp.color;
        }
      }
      return best;
    };
    // One pool under every ceiling light, and under any high lamp that has none close by.
    const pools: { x: number; z: number; r: number; color: string }[] = [];
    for (const prop of plan.props) if (prop.name === 'ceiling_light') pools.push({ x: prop.x, z: prop.z, r: 3.2, color: lampAt(prop.x, prop.z) });
    for (const lamp of tone.lamps) {
      if (lamp.y <= 2.4 || pools.some((pool) => Math.hypot(pool.x - lamp.x, pool.z - lamp.z) < 1.4)) continue;
      pools.push({ x: lamp.x, z: lamp.z, r: Math.min(3.2, 1.6 + lamp.reach * 0.12), color: lamp.color });
    }
    const windows = plan.windows.map((window) => ({
      ...window,
      out:
        shell.kind === 'dome'
          ? new THREE.Vector3(window.x / shell.r ** 2, window.y / shell.h ** 2, window.z / shell.r ** 2).normalize()
          : new THREE.Vector3(0, 0, window.z < 0 ? -1 : 1),
    }));
    const props = plan.props.flatMap((placed) => {
      const size = SIZE[placed.name];
      if (!size || size.free || placed.y) return [];
      return [{ x: placed.x, z: placed.z, rot: placed.rot, w: size.w, d: size.d, h: size.h, round: !!size.round }];
    });
    this.fx = new RoomLight({
      height,
      daylight: this.site === 'mars' ? '#ffc58a' : '#cfe0ff',
      pools,
      windows,
      walls: this.wallMeshes,
      props,
      mates: (plan.mates ?? []).map((mate) => ({ x: mate.x, z: mate.z })),
      wallDark: mix(tone.dark, '#3a2420', 0.6),
      wallWarm: mix(tone.key, '#ffb070', 0.5),
      shadow: mix(tone.dark, '#6a5a78', 0.55),
    });
    for (const material of this.fx.materials) this.own(material);
    this.root.add(this.fx.group);
  }

  private clearRoom(): void {
    for (const child of [...this.root.children]) {
      const light = child as THREE.Light;
      if (light.isLight) {
        const shadow = (light as THREE.DirectionalLight).shadow;
        shadow?.map?.dispose();
      }
    }
    for (const mate of this.mates) {
      this.root.remove(mate.figure.group);
      mate.figure.dispose();
    }
    this.mates = [];
    disposeTree(this.root);
    this.root.clear();
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    this.stations = [];
    this.colliders = [];
    this.fx = null;
    this.wallMeshes.length = 0;
    this.plan = null;
    this.key = null;
    this.near = null;
  }

  private pushHud(force: boolean, dt = 0): void {
    this.hudTimer -= dt;
    if (!force && this.hudTimer > 0) return;
    this.hudTimer = 0.1;
    if (!this.onHud || !this.room) return;
    const near = this.near;
    this.onHud({
      room: this.room,
      station: near ? { id: near.id, kind: near.kind, thing: near.thing, x: near.x, z: near.z, done: near.done } : null,
    });
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Scale the UVs of a geometry (so a texture tile is about 1.6 m). */
function remapUv(geometry: THREE.BufferGeometry, u: number, v: number): void {
  const uv = geometry.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  uv.needsUpdate = true;
}

/** UVs from the X and Z of each point, in tiles of `tile` metres (floors). */
function remapUvPlanar(geometry: THREE.BufferGeometry, tile: number): void {
  const position = geometry.attributes.position;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i) / tile;
    uv[i * 2 + 1] = position.getZ(i) / tile;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** UVs from the X and Y of each point (upright walls). */
function remapUvPlanarXY(geometry: THREE.BufferGeometry, tile: number): void {
  const position = geometry.attributes.position;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i) / tile;
    uv[i * 2 + 1] = position.getY(i) / tile;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** The cross-section of a hall: up the left wall, over the curved roof, down the right wall. */
function hallProfile(hall: { w: number; wall: number; rise: number }, segments: number): THREE.Vector2[] {
  const half = hall.w / 2;
  const points: THREE.Vector2[] = [new THREE.Vector2(-half, 0), new THREE.Vector2(-half, hall.wall)];
  for (let i = 1; i < segments; i++) {
    const angle = Math.PI - (i / segments) * Math.PI;
    points.push(new THREE.Vector2(Math.cos(angle) * half, hall.wall + Math.sin(angle) * hall.rise));
  }
  points.push(new THREE.Vector2(half, hall.wall), new THREE.Vector2(half, 0));
  return points;
}

/** Sweep a cross-section along Z into a surface that faces inward. UVs in 1.6 m tiles. */
function sweep(profile: THREE.Vector2[], length: number, rows: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const along: number[] = [0];
  for (let i = 1; i < profile.length; i++) along.push(along[i - 1] + profile[i].distanceTo(profile[i - 1]));
  for (let j = 0; j <= rows; j++) {
    const z = -length / 2 + (j / rows) * length;
    for (let i = 0; i < profile.length; i++) {
      positions.push(profile[i].x, profile[i].y, z);
      uvs.push(along[i] / 1.6, (z + length / 2) / 1.6);
    }
  }
  const width = profile.length;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < width - 1; i++) {
      const a = j * width + i;
      const b = a + 1;
      const c = a + width;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Make sure the surface faces the middle of the hall; flip it if not.
  const normal = geometry.attributes.normal;
  const mid = Math.floor(width / 2);
  const ny = normal.getY(mid);
  if (ny > 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const swap = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = swap;
    }
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
  }
  return geometry;
}

/** A point on the inside of a dome: sideways offset x, angle up from the floor toward -Z, pulled in by `inset`. */
function onDome(shell: { r: number; h: number }, x: number, phi: number, inset: number): THREE.Vector3 {
  const k = Math.sqrt(Math.max(0, 1 - (x / shell.r) ** 2));
  return new THREE.Vector3(x, Math.sin(phi) * shell.h * k, -Math.cos(phi) * shell.r * k).multiplyScalar(inset);
}

/** The observatory's slit: a band over the dome from low on the -Z side to the top. */
function slitBand(shell: { r: number; h: number }, width: number, segments: number, inset: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const phi = 0.16 + t * (Math.PI / 2 - 0.16);
    for (const side of [-1, 1]) {
      const point = onDome(shell, (side * width) / 2, phi, inset);
      positions.push(point.x, point.y, point.z);
      uvs.push(side < 0 ? 0 : 1, t * 3);
    }
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
