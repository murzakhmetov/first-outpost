/**
 * Dev only (loaded by dev.ts, which main.ts imports only under import.meta.env.DEV): the Lumi route
 * runner, `fo.lumiRoutes()`. It drives the REAL world with a fixed time step and no
 * requestAnimationFrame: each frame it fills in the input the player's controls would give (walk
 * stick, interact, throttle and steering), then calls the same per-frame update the game loop calls
 * (World.update). Lumi's drawn position is then judged by the same probe as in play
 * (world/lumiprobe.ts). Buildings, the lander and the rover come from the scene, not from numbers
 * typed here. Marker for the production-bundle check: LUMI-ROUTES-DEV-ONLY.
 */
import * as THREE from 'three';
import * as director from './game/director';
import { PLOTS } from './world/annex';
import { BATTERY, FARM, HAB, LAB, SOLAR } from './world/base';
import { solidGap } from './world/keepclear';
import type { SolidCircle, Solids } from './world/keepclear';
import { lumiProbeRead } from './world/lumiprobe';
import { hasModel } from './world/models';
import { LANDER } from './world/props';
import type { World } from './world/world';
import type { InputState } from './world/input';
import type { BuildingId } from './sim/outpost';
import type { SiteId } from './sim/types';

export const LUMI_ROUTES_MARK = 'LUMI-ROUTES-DEV-ONLY';

export interface RouteRow {
  world: SiteId;
  route: string;
  frames: number;
  overlaps: number;
  bodyOverlaps: number;
  teleports: number;
  fast: number;
  maxSpeed: number;
  /** Smallest gap between Lumi's bare body (radius 0.45 m) and any solid, metres; below 0 the body was inside one. */
  minClear: number;
  /** Smallest gap between the rover's middle and the route's building colliders while driven; the rover's side probes touch at 1.3 and its nose probe at 2.6, so above 2.7 it never touched. NaN when it never drove. */
  roverGap: number;
  /** Fastest the rover went while driven, metres per second (0 when it never drove). */
  roverMax: number;
  /** Seconds of simulated time. */
  seconds: number;
  /** Phases that ran out of time, and other oddities (empty when the manoeuvre went as scripted). */
  notes: string[];
  /** Where the last fast frame jumped from and to (when `fast` is above 0). */
  lastFast?: unknown;
  /** The rover's track: [seconds, x, z, speed, heading] every half second (with the `trace` option). */
  track?: number[][];
}

export interface RouteOptions {
  world?: SiteId;
  routes?: string[];
  dt?: number;
  /** Keep a sample of the rover's track (every half second) in each row. */
  trace?: boolean;
}

export interface RouteDeps {
  toWalk: (site: SiteId) => Promise<string>;
}

// ---------------------------------------------------------------------------------------------
// What the runner reaches into (private fields of the real objects; dev only).
// ---------------------------------------------------------------------------------------------

interface WorldInner {
  update(dt: number, time: number): void;
  lumiTeleport: boolean;
  lumiSolids: Solids;
  input: { read: (dt?: number) => InputState };
}
interface EvaInner {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  elapsed: number;
  leftBase: boolean;
  alertAt: number;
  alertLeft: number;
  doorNear: number;
  promptMarker: unknown;
  grounded: boolean;
  driving: boolean;
  active: boolean;
  heading: number;
  onEvent: unknown;
  stopDriving(): void;
  clearMarkers(): void;
}
interface RoverInner {
  x: number;
  z: number;
  y: number;
  heading: number;
  speed: number;
  charge: number;
  top: number;
  driving: boolean;
  place(snap: boolean): void;
  syncColliders(): void;
  park(): void;
  boxes: { x: number; z: number }[];
}
interface LumiInner {
  spot: THREE.Vector3;
  velocity: THREE.Vector3;
  goal: THREE.Vector3;
  keepOut: unknown;
  snap(): void;
}

interface Ctx {
  w: World;
  wi: WorldInner;
  eva: EvaInner;
  rover: RoverInner;
  lumi: LumiInner;
  dt: number;
  input: InputState;
  ground: (x: number, z: number) => number;
  /** Walking speed with the stick fully pushed, metres per second. */
  walkSpeed: number;
  /** Oddities of the running route (a drive or walk that gave up, a phase that timed out). */
  notes: string[];
  trace: boolean;
}

/** One step of a manoeuvre: sets the input for this frame, returns true when it is finished. */
type Phase = (c: Ctx) => boolean;
type Pt = readonly [number, number];

interface Route {
  name: string;
  /** Put the cadet and the rover where the manoeuvre starts. */
  setup: (c: Ctx) => void;
  phases: (c: Ctx) => Phase[];
  /** Per-frame hook before the update (the control routes push Lumi around here). */
  each?: (c: Ctx) => void;
  /** The colliders the route is about: roverGap is measured to these (else to every collider). */
  target?: readonly SolidCircle[];
  ruleOff?: boolean;
  /** Needs the rover at full stress speed. */
  fast?: boolean;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------------------------
// Controls the way a player would use them.
// ---------------------------------------------------------------------------------------------

/** Push the walk stick toward a point (the stick is relative to the camera, so turn the wish by the camera's yaw). */
function stickToward(c: Ctx, x: number, z: number, amount: number): void {
  const p = c.eva.position;
  const dx = x - p.x;
  const dz = z - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return;
  const yaw = c.w.rig.yaw;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  c.input.moveY = ((dx * fx + dz * fz) / d) * amount;
  c.input.moveX = ((dx * rx + dz * rz) / d) * amount;
}

/** A phase made when it first runs (its points depend on where the rover is by then). */
const lazy = (make: (c: Ctx) => Phase): Phase => {
  let phase: Phase | null = null;
  return (c) => (phase ??= make(c))(c);
};

const wait = (seconds: number): Phase => {
  let t = 0;
  return (c) => (t += c.dt) >= seconds;
};

/** Walk through points at a share of full speed (1 = the 6.4 m/s Mars walk), or running. */
function walkPath(points: readonly Pt[], amount = 1, sprint = false): Phase {
  let i = 0;
  let there = 0;
  return (c) => {
    while (i < points.length && Math.hypot(points[i][0] - c.eva.position.x, points[i][1] - c.eva.position.z) < 0.9) {
      i++;
      there = 0;
    }
    if (i >= points.length) return true;
    // Held up by a collider (the rover, a wall): give that point up after a while, as a player would.
    if ((there += c.dt) > 8) {
      c.notes.push('walk point skipped');
      i++;
      there = 0;
      if (i >= points.length) return true;
    }
    stickToward(c, points[i][0], points[i][1], amount);
    c.input.sprint = sprint;
    return false;
  };
}

/** Drive through points at full throttle with the steering a player would use (pure pursuit); done within `tol` m of the last. */
function driveAlong(points: readonly Pt[], throttle = 1, tol = 4): Phase {
  let i = 0;
  let stuck = 0;
  return (c) => {
    const r = c.rover;
    // Wedged against something at full throttle: the player would give up and brake.
    stuck = Math.abs(r.speed) < 0.8 ? stuck + c.dt : 0;
    if (stuck > 3) {
      c.notes.push(`drive wedged at ${r.x.toFixed(1)},${r.z.toFixed(1)}`);
      return true;
    }
    // A point counts as reached when the rover is near it or has gone by it (its turning circle is wider than the tolerance).
    const passed = (q: Pt): boolean => {
      const dx = q[0] - r.x;
      const dz = q[1] - r.z;
      const d = Math.hypot(dx, dz);
      return d < tol || (d < 16 && dx * Math.sin(r.heading) + dz * Math.cos(r.heading) < 0);
    };
    while (i < points.length - 1 && passed(points[i])) i++;
    if (i >= points.length - 1 && passed(points[points.length - 1])) return true;
    const [tx, tz] = points[i];
    // Heading decreases with positive steer (see Rover.update).
    c.input.moveX = clamp(wrap(r.heading - Math.atan2(tx - r.x, tz - r.z)) * 2.5, -1, 1);
    c.input.moveY = throttle;
    return false;
  };
}

/** Drive for a time, aiming at a point (or straight, with `aim` null). */
function driveFor(seconds: number, aim: Pt | null, throttle: number): Phase {
  let t = 0;
  return (c) => {
    t += c.dt;
    const r = c.rover;
    if (aim) {
      const want = wrap(r.heading - Math.atan2(aim[0] - r.x, aim[1] - r.z));
      // Reversing turns the other way round.
      c.input.moveX = clamp(want * 2.5, -1, 1) * (throttle < 0 ? -1 : 1);
    }
    c.input.moveY = throttle;
    return t >= seconds;
  };
}

/** Full lock for a time: a tight circle. */
function circleFor(seconds: number, steer: number): Phase {
  let t = 0;
  return (c) => {
    t += c.dt;
    c.input.moveX = steer;
    c.input.moveY = 1;
    return t >= seconds;
  };
}

/** Brake to a stop the way a player would (reverse throttle against the motion). */
const stopRover: Phase = (c) => {
  const s = c.rover.speed;
  if (Math.abs(s) < 1.2) return true;
  c.input.moveY = s > 0 ? -1 : 1;
  return false;
};

const pressInteract = (done: (c: Ctx) => boolean): Phase => {
  let n = 0;
  return (c) => {
    if (done(c)) return true;
    if (n === 90) {
      const e = c.eva as unknown as { cinema: number };
      c.notes.push(`interact has no effect: cadet ${c.eva.position.x.toFixed(1)},${c.eva.position.z.toFixed(1)} rover ${c.rover.x.toFixed(1)},${c.rover.z.toFixed(1)} grounded ${c.eva.grounded} cinema ${e.cinema} driving ${c.eva.driving}`);
    }
    // One press every tenth of a second, until it takes (leaving needs a stop; boarding needs to be near).
    if (n++ % 6 === 0) c.input.interact = true;
    return false;
  };
};
const board = (): Phase => pressInteract((c) => c.eva.driving);
const leave = (): Phase => pressInteract((c) => !c.eva.driving);

// ---------------------------------------------------------------------------------------------
// Scene helpers.
// ---------------------------------------------------------------------------------------------

/** The rover's local frame: x across (left +), z along (nose +); to the world. */
const localToWorld = (r: RoverInner, lx: number, lz: number): Pt => {
  const sin = Math.sin(r.heading);
  const cos = Math.cos(r.heading);
  return [r.x + lx * cos + lz * sin, r.z - lx * sin + lz * cos];
};

function putCadet(c: Ctx, x: number, z: number): void {
  c.eva.position.set(x, c.ground(x, z), z);
  c.eva.velocity.set(0, 0, 0);
  c.eva.grounded = true;
}

function putRover(c: Ctx, x: number, z: number, heading: number): void {
  const r = c.rover;
  r.x = x;
  r.z = z;
  r.heading = heading;
  r.speed = 0;
  r.charge = 1;
  r.place(true);
  r.syncColliders();
}

/** Everything back to the start of a walk: the rover parked, the cadet beside it, Lumi at the cadet. */
function reset(c: Ctx): void {
  if (c.eva.driving) c.eva.stopDriving();
  c.rover.park();
  c.rover.charge = 1;
  c.eva.alertLeft = -1;
  c.eva.alertAt = -1;
  c.eva.clearMarkers();
  c.eva.leftBase = false;
  c.eva.elapsed = 0;
}

function placeLumiAtCadet(c: Ctx): void {
  const p = c.eva.position;
  c.lumi.goal.set(p.x + 1.1, p.y + 2.05, p.z + 0.5);
  c.wi.lumiTeleport = true;
  c.lumi.snap();
}

interface Building {
  id: string;
  x: number;
  z: number;
  /** How far the colliders reach from (x, z). */
  ext: number;
  circles: SolidCircle[];
}

/** The outpost's buildings, with the extent of their real colliders. */
function findBuildings(w: World): Building[] {
  const solids = (w as unknown as WorldInner).lumiSolids;
  const anchors: { id: string; x: number; z: number; reach: number }[] = [
    { id: 'hab', ...HAB, reach: 11 },
    { id: 'farm', ...FARM, reach: 11 },
    { id: 'lab', ...LAB, reach: 11 },
    { id: 'solar', ...SOLAR, reach: 10 },
    { id: 'battery', ...BATTERY, reach: 4 },
    { id: 'lander', ...LANDER, reach: 5 },
  ];
  for (const id of Object.keys(PLOTS) as BuildingId[]) anchors.push({ id, x: PLOTS[id].x, z: PLOTS[id].z, reach: 6 });
  const found = anchors.map((a) => ({ id: a.id, x: a.x, z: a.z, ext: 0, circles: [] as SolidCircle[] }));
  for (const circle of solids.circles) {
    if (circle.r < 1) continue;
    let best = -1;
    let bestD = Infinity;
    anchors.forEach((a, index) => {
      const d = Math.hypot(circle.x - a.x, circle.z - a.z);
      if (d <= a.reach && d < bestD) {
        best = index;
        bestD = d;
      }
    });
    if (best < 0) continue;
    found[best].circles.push(circle);
    found[best].ext = Math.max(found[best].ext, bestD + circle.r);
  }
  return found.filter((b) => b.circles.length > 0);
}

// ---------------------------------------------------------------------------------------------
// The routes.
// ---------------------------------------------------------------------------------------------

const PLAZA_POINT: Pt = [0, 0.7];

/** Tangent and outward normal of a building as seen from the plaza. */
function frameOf(b: Building): { t: Pt; n: Pt; inward: Pt } {
  const dx = b.x - PLAZA_POINT[0];
  const dz = b.z - PLAZA_POINT[1];
  const d = Math.hypot(dx, dz) || 1;
  const n: Pt = [dx / d, dz / d];
  return { n, t: [-n[1], n[0]], inward: [-n[0], -n[1]] };
}

const at = (b: Building, f: { t: Pt; n: Pt }, along: number, out: number): Pt => [b.x + f.t[0] * along + f.n[0] * out, b.z + f.t[1] * along + f.n[1] * out];

/** The rover starts at `from` facing `to`, the cadet beside it; the route boards. */
function driveStart(from: Pt, to: Pt, heading = Math.atan2(to[0] - from[0], to[1] - from[1])): Route['setup'] {
  return (c) => {
    reset(c);
    const [x, z] = from;
    putRover(c, x, z, heading);
    const spot = cadetSpot(c);
    putCadet(c, spot[0], spot[1]);
    placeLumiAtCadet(c);
  };
}

/** Beside the rover on the first side that is open (boarding needs the cadet within 3.4 m of it, and a collider would push him away). */
function cadetSpot(c: Ctx): Pt {
  const solids = c.wi.lumiSolids.circles.filter((q) => q.r > 0);
  const options: Pt[] = [[2.7, 0.4], [-2.7, 0.4], [2.7, -1.5], [-2.7, -1.5], [0, -3.8], [0, 3.8]];
  for (const [lx, lz] of options) {
    const w = localToWorld(c.rover, lx, lz);
    if (solids.every((q) => Math.hypot(q.x - w[0], q.z - w[1]) > q.r + 1.2)) return w;
  }
  return localToWorld(c.rover, 2.7, 0.4);
}

/** The heading nearest `want` whose straight line of `len` metres from (x, z) stays off every collider by the rover's width. */
function openLine(c: Ctx, x: number, z: number, want: number, len: number): number {
  const solids = c.wi.lumiSolids.circles.filter((q) => q.r > 0);
  const clear = (h: number): boolean => {
    for (let t = 3; t <= len; t += 1.5) {
      const px = x + Math.sin(h) * t;
      const pz = z + Math.cos(h) * t;
      if (!solids.every((q) => Math.hypot(q.x - px, q.z - pz) > q.r + 2.8)) return false;
    }
    return true;
  };
  for (let k = 0; k < 18; k++) {
    const h = want + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.3;
    if (clear(h)) return h;
  }
  return want;
}

function buildRoutes(c: Ctx, all: Building[], skipped: string[]): Route[] {
  const routes: Route[] = [];

  // ---- on foot, by the parked rover (its pose at the start of a walk) -----------------
  const parkedRover = (): RoverInner => c.rover;
  /** A walk beside the parked rover, along its length at a lateral offset (local x), in one direction. */
  const walkBy = (name: string, side: 1 | -1, back: boolean, amount: number, sprint: boolean): void => {
    routes.push({
      name,
      setup: (k) => {
        reset(k);
        const r = parkedRover();
        const z0 = back ? 10 : -10;
        const s = localToWorld(r, side * 2.55, z0);
        putCadet(k, s[0], s[1]);
        placeLumiAtCadet(k);
      },
      phases: () => {
        const r = parkedRover();
        const z1 = back ? -10 : 10;
        return [wait(0.8), walkPath([localToWorld(r, side * 2.55, back ? 5 : -5), localToWorld(r, side * 2.55, z1)], amount, sprint), wait(0.8)];
      },
    });
  };
  walkBy('passLeft', 1, false, 1, false);
  walkBy('passLeftBack', 1, true, 1, false);
  walkBy('passRight', -1, false, 1, false);
  walkBy('passRightBack', -1, true, 1, false);
  walkBy('sprintLeft', 1, true, 1, true);
  walkBy('sprintRight', -1, true, 1, true);

  // Slowly all the way round the rover, close to its sides, both ways.
  const hug = (name: string, flip: 1 | -1): void => {
    routes.push({
      name,
      setup: (k) => {
        reset(k);
        const s = localToWorld(parkedRover(), 2.5, -1);
        putCadet(k, s[0], s[1]);
        placeLumiAtCadet(k);
      },
      phases: () => {
        const r = parkedRover();
        const hx = 1.65 + 0.85;
        const hz = 2.45 + 0.85;
        const loop: Pt[] = [
          [hx, -1],
          [hx, hz],
          [-hx, hz],
          [-hx, -hz],
          [hx, -hz],
          [hx, 0],
        ];
        const order = flip === 1 ? loop : [...loop].reverse();
        return [wait(0.8), walkPath(order.map(([lx, lz]) => localToWorld(r, lx, lz)), 0.3), wait(0.8)];
      },
    });
  };
  hug('hugLeftFirst', 1);
  hug('hugRightFirst', -1);

  // Boarding from the left and from the right, then a short drive and out again.
  const boardFrom = (name: string, side: 1 | -1): void => {
    routes.push({
      name,
      fast: true,
      setup: (k) => {
        reset(k);
        const s = localToWorld(parkedRover(), side * 2.7, 0.4);
        putCadet(k, s[0], s[1]);
        placeLumiAtCadet(k);
      },
      phases: (k) => {
        const r = k.rover;
        // Out of the parking spot along the first heading that is clear of rocks and buildings.
        const open = openLine(k, r.x, r.z, r.heading, 22);
        const ahead: Pt = [r.x + Math.sin(open) * 14, r.z + Math.cos(open) * 14];
        const further: Pt = [r.x + Math.sin(open) * 22, r.z + Math.cos(open) * 22];
        return [wait(1), board(), wait(1), driveAlong([ahead, further], 1, 3), stopRover, wait(0.5), leave(), wait(1.5), walkPath([localToWorld(r, side * 4, 0)], 1), wait(0.5)];
      },
    });
  };
  boardFrom('boardLeft', 1);
  boardFrom('boardRight', -1);

  // Tight circle in the open, at full lock, both ways.
  const circle = (name: string, steer: number): void => {
    routes.push({
      name,
      fast: true,
      setup: (k) => {
        reset(k);
        const s = localToWorld(parkedRover(), 2.7, 0.4);
        putCadet(k, s[0], s[1]);
        placeLumiAtCadet(k);
      },
      phases: () => [wait(0.5), board(), wait(0.5), circleFor(14, steer), stopRover, wait(0.5)],
    });
  };
  circle('circleLeft', -1);
  circle('circleRight', 1);

  // ---- driving at the buildings ---------------------------------------------------------------
  /**
   * A start for a straight run at a building: `dist` metres beyond its extent, on the side `first` points to, or (when the run
   * would cross another building) on the first side round it that is clear.
   */
  const approach = (b: Building, dist: number, first: Pt): Pt => {
    const own = new Set<SolidCircle>(b.circles);
    const others = c.wi.lumiSolids.circles.filter((q) => q.r > 0 && !own.has(q));
    // Big things (other buildings) keep 3.2 m off the line; small ones (rocks) just the rover's own width.
    const room = (x: number, z: number, big: number, small: number): boolean => others.every((q) => Math.hypot(q.x - x, q.z - z) > q.r + (q.r >= 1 ? big : small));
    const base = Math.atan2(first[1], first[0]);
    for (const rocks of [2.2, 1.4]) {
      for (let k = 0; k < 19; k++) {
        const turn = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.35;
        const dx = Math.cos(base + turn);
        const dz = Math.sin(base + turn);
        // Shorter and shorter runs, the longest that fits first.
        for (let d = dist; d >= Math.min(dist, 10); d -= 3) {
          let clear = true;
          for (let t = b.ext + 3; t <= b.ext + d + 5 && clear; t += 1.5) clear = room(b.x + dx * t, b.z + dz * t, 4.4, rocks);
          if (clear) return [b.x + dx * (b.ext + d), b.z + dz * (b.ext + d)];
        }
      }
    }
    return [b.x + first[0] * (b.ext + dist), b.z + first[1] * (b.ext + dist)];
  };
  for (const b of all) {
    const f = frameOf(b);
    const stand = b.ext + 2.0;
    for (const [label, side] of [
      ['out', 1],
      ['in', -1],
    ] as const) {
      let extra = 0;
      const lane = (along: number): Pt => at(b, f, along, side * (stand + extra));
      // The lane runs along the wall as far as it stays clear (the rover's width off every other building and rock) around its middle.
      const own = new Set<SolidCircle>(b.circles);
      const others = c.wi.lumiSolids.circles.filter((q) => q.r > 0 && !own.has(q));
      const free = (along: number): boolean => {
        const [x, z] = lane(along);
        return others.every((q) => Math.hypot(q.x - x, q.z - z) > q.r + (q.r >= 1 ? 3.6 : 1.9));
      };
      // The wall's middle may be crowded (the plaza): move the lane further out until a long enough stretch is clear, else keep the longest.
      let from = 0;
      let to = 0;
      let best = -1;
      let bestExtra = 0;
      for (let e = 0; e <= 7 && best < 18; e++) {
        extra = e;
        let lo = 0;
        let hi = 0;
        if (free(0)) {
          while (lo > -26 && free(lo - 1)) lo -= 1;
          while (hi < 16 && free(hi + 1)) hi += 1;
        }
        if (hi - lo > best) {
          best = hi - lo;
          bestExtra = e;
          from = lo;
          to = hi;
        }
      }
      extra = bestExtra;
      // A side with no room for a run (a neighbour right there): no route, said so in `skipped`.
      if (best < 10) {
        skipped.push(`past:${b.id}:${label} (clear lane ${best} m)`);
        continue;
      }
      routes.push({
        name: `past:${b.id}:${label}`,
        fast: true,
        target: b.circles,
        setup: driveStart(lane(from), lane(to)),
        phases: () => [wait(0.5), board(), wait(0.5), driveAlong([lane(from / 2), lane(0), lane(to)], 1, 3), stopRover, wait(0.5)],
      });
    }
    // Head-on at the middle, then grind along the wall.
    routes.push({
      name: `ram:${b.id}`,
      fast: true,
      target: b.circles,
      setup: driveStart(approach(b, 40, f.inward), [b.x, b.z]),
      phases: () => [wait(0.5), board(), wait(0.5), driveFor(12, [b.x, b.z], 1), stopRover, wait(0.5)],
    });
    // Reverse into the side.
    routes.push({
      name: `reverse:${b.id}`,
      fast: true,
      target: b.circles,
      setup: (k) => {
        const start = approach(b, 16, f.n);
        // Facing away from the building (its back toward it).
        driveStart(start, [b.x, b.z], Math.atan2(start[0] - b.x, start[1] - b.z))(k);
      },
      phases: () => [wait(0.5), board(), wait(0.5), driveFor(11, null, -1), stopRover, wait(0.5)],
    });
    // Park beside the building, get out, walk along the wall, get back in.
    // Stops with its side to the wall when it can: the spot is on the line from the start to the building, just off its edge.
    const startAt = approach(b, 22, f.n);
    const toward = Math.hypot(startAt[0] - b.x, startAt[1] - b.z) || 1;
    const spot: Pt = [b.x + ((startAt[0] - b.x) / toward) * (b.ext + 3.2), b.z + ((startAt[1] - b.z) / toward) * (b.ext + 3.2)];
    routes.push({
      name: `park:${b.id}`,
      fast: true,
      target: b.circles,
      setup: driveStart(approach(b, 22, f.n), [b.x, b.z]),
      phases: () => [
        wait(0.5),
        board(),
        wait(0.5),
        driveAlong([spot], 1, 1.5),
        stopRover,
        wait(0.5),
        leave(),
        wait(1),
        // Along the wall from where the rover stands (round the building, on the side that is open), then back to the rover.
        lazy((q) => {
          const theta = Math.atan2(q.rover.z - b.z, q.rover.x - b.x);
          const ring = (d: number, r: number): Pt => [b.x + Math.cos(theta + d) * r, b.z + Math.sin(theta + d) * r];
          const solids = q.wi.lumiSolids.circles.filter((o) => o.r > 0 && !b.circles.includes(o));
          const open = (d: number): boolean => [0.15, 0.3, 0.45, 0.6].every((k) => ((pt) => solids.every((o) => Math.hypot(o.x - pt[0], o.z - pt[1]) > o.r + 1))(ring((d * k) / 0.6, b.ext + 2.4)));
          const d = [0.6, -0.6, 0.4, -0.4, 0.25, -0.25].find(open) ?? 0;
          if (d === 0) return walkPath([], 1);
          return walkPath([ring(d * 0.5, b.ext + 2.4), ring(d, b.ext + 2.4), ring(d, b.ext + 5), ring(d * 0.5, b.ext + 5)], 1);
        }),
        lazy((q) => walkPath([localToWorld(q.rover, 2.7, 0.4)], 1)),
        wait(0.5),
        board(),
        wait(1),
      ],
    });
  }

  // Between two buildings, at the narrowest gaps that a rover fits through.
  const gaps: { a: Building; b: Building; gap: number }[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      const gap = Math.hypot(a.x - b.x, a.z - b.z) - a.ext - b.ext;
      if (gap >= 5.8 && gap <= 24) gaps.push({ a, b, gap });
    }
  }
  gaps.sort((p, q) => p.gap - q.gap);
  for (const { a, b } of gaps.slice(0, 5)) {
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const ax = (b.x - a.x) / Math.hypot(b.x - a.x, b.z - a.z);
    const az = (b.z - a.z) / Math.hypot(b.x - a.x, b.z - a.z);
    // Through the middle of the gap, at right angles to the line joining the two, as far either way as it stays clear of everything else.
    const pair = new Set<SolidCircle>([...a.circles, ...b.circles]);
    const rest = c.wi.lumiSolids.circles.filter((q) => q.r > 0 && !pair.has(q));
    const freeAt = (t: number): boolean => rest.every((q) => Math.hypot(q.x - (mx - az * t), q.z - (mz + ax * t)) > q.r + (q.r >= 1 ? 3.6 : 2.4));
    let tFrom = 0;
    while (tFrom < 26 && freeAt(tFrom + 1)) tFrom++;
    let tTo = 0;
    while (tTo < 24 && freeAt(-tTo - 1)) tTo++;
    if (tFrom + tTo < 14) {
      skipped.push(`between:${a.id}-${b.id} (clear run ${tFrom + tTo} m)`);
      continue;
    }
    const pointAt = (t: number): Pt => [mx - az * t, mz + ax * t];
    // The run goes from t = +tFrom to t = -tTo.
    const from = pointAt(tFrom);
    const to = pointAt(-tTo);
    routes.push({
      name: `between:${a.id}-${b.id}`,
      fast: true,
      target: [...a.circles, ...b.circles],
      setup: driveStart(from, to),
      phases: () => [wait(0.5), board(), wait(0.5), driveAlong([pointAt(tFrom / 2), [mx, mz], to], 1, 3), stopRover, wait(0.5)],
    });
  }

  // ---- negative controls: the hard rule off (or Lumi forced into a solid) must be seen by the counters ---------------
  const intoRover = (k: Ctx): void => {
    const box = k.rover.boxes[0];
    k.lumi.spot.set(box.x, k.ground(box.x, box.z) + 1.2, box.z);
    k.lumi.velocity.set(0, 0, 0);
    k.wi.lumiTeleport = true;
  };
  const standBy: Route['setup'] = (k) => {
    reset(k);
    const s = localToWorld(parkedRover(), 2.55, -6);
    putCadet(k, s[0], s[1]);
    placeLumiAtCadet(k);
  };
  const standPhases = (k: Ctx): Phase[] => [wait(0.8), walkPath([localToWorld(k.rover, 2.55, 6)], 0.3), wait(0.8)];
  routes.push({ name: 'control', ruleOff: true, setup: standBy, phases: standPhases, each: intoRover });
  routes.push({ name: 'forced', setup: standBy, phases: standPhases, each: intoRover });
  const hab = all.find((b) => b.id === 'hab') ?? all[0];
  routes.push({
    name: 'controlBuilding',
    ruleOff: true,
    setup: standBy,
    phases: standPhases,
    each: (k) => {
      const circle = hab.circles[0];
      k.lumi.spot.set(circle.x, k.ground(circle.x, circle.z) + 1.5, circle.z);
      k.lumi.velocity.set(0, 0, 0);
      k.wi.lumiTeleport = true;
    },
  });
  return routes;
}

// ---------------------------------------------------------------------------------------------
// The runner.
// ---------------------------------------------------------------------------------------------

const noInput = (): InputState => ({ moveX: 0, moveY: 0, jump: false, interact: false, sprint: false, use: false, view: false });

/** Run one route to its end (or the time limit) and read the probe. */
function runRoute(c: Ctx, route: Route, clock: { t: number }): RouteRow {
  const rover = c.rover;
  const keep = c.lumi.keepOut;
  const topWas = rover.top;
  if (route.fast) rover.top = Math.max(rover.top, 12);
  if (route.ruleOff) c.lumi.keepOut = null;
  const notes = c.notes;
  notes.length = 0;
  route.setup(c);
  const idle = (frames: number): void => {
    c.input = noInput();
    for (let i = 0; i < frames; i++) {
      c.eva.elapsed = 0;
      c.eva.doorNear = -1;
      route.each?.(c);
      c.wi.update(c.dt, (clock.t += c.dt));
    }
  };
  // Let the scene and Lumi settle for a moment, then count only the manoeuvre.
  idle(40);
  lumiProbeRead(true);
  const phases = route.phases(c);
  let index = 0;
  let inPhase = 0;
  let frames = 0;
  let roverGap = Infinity;
  let roverMax = 0;
  const track: number[][] = [];
  const buildingsOnly: Solids = { circles: route.target ?? c.wi.lumiSolids.circles, boxes: [], ground: c.ground };
  const limit = Math.round(150 / c.dt);
  while (index < phases.length && frames < limit) {
    c.input = noInput();
    c.eva.elapsed = 0;
    c.eva.leftBase = false;
    c.eva.alertLeft = -1;
    c.eva.alertAt = -1;
    c.eva.doorNear = -1;
    c.eva.promptMarker = null;
    c.rover.charge = 1;
    if (!c.eva.active) {
      notes.push('the walk ended');
      break;
    }
    route.each?.(c);
    const done = phases[index](c);
    inPhase += c.dt;
    if (done) {
      index++;
      inPhase = 0;
    } else if (inPhase > 40) {
      notes.push(`phase ${index} timed out`);
      index++;
      inPhase = 0;
    }
    c.wi.update(c.dt, (clock.t += c.dt));
    frames++;
    if (c.trace && frames % 30 === 0) track.push([Math.round(frames * c.dt * 10) / 10, Math.round(rover.x * 10) / 10, Math.round(rover.z * 10) / 10, Math.round(rover.speed * 10) / 10, Math.round(rover.heading * 100) / 100]);
    if (c.eva.driving) roverMax = Math.max(roverMax, Math.abs(rover.speed));
    if (c.eva.driving) roverGap = Math.min(roverGap, solidGap({ x: rover.x, y: c.ground(rover.x, rover.z) + 1, z: rover.z }, buildingsOnly));
  }
  if (frames >= limit) notes.push('route hit the time limit');
  const p = lumiProbeRead(true);
  c.lumi.keepOut = keep;
  rover.top = topWas;
  if (c.eva.driving) c.eva.stopDriving();
  return {
    world: c.w.site,
    route: route.name,
    frames: p.frames,
    overlaps: p.overlaps,
    bodyOverlaps: p.bodyOverlaps,
    teleports: p.teleports,
    fast: p.fast,
    maxSpeed: Math.round(p.maxSpeed * 10) / 10,
    minClear: p.minClear === Infinity ? NaN : Math.round(p.minClear * 1000) / 1000,
    roverGap: roverGap === Infinity ? NaN : Math.round(roverGap * 100) / 100,
    roverMax: Math.round(roverMax * 10) / 10,
    seconds: Math.round(frames * c.dt * 10) / 10,
    notes: [...notes],
    ...(p.fast ? { lastFast: p.lastFast } : {}),
    ...(c.trace ? { track } : {}),
  };
}

/** The table as text (one line per route). */
export function routeTable(rows: readonly RouteRow[]): string {
  const head = ['world', 'route', 'frames', 'overlaps', 'bodyOverlaps', 'teleports', 'fast', 'maxSpeed', 'minClear', 'roverGap', 'roverMax', 'seconds', 'notes'];
  const lines = rows.map((r) => [r.world, r.route, r.frames, r.overlaps, r.bodyOverlaps, r.teleports, r.fast, r.maxSpeed, r.minClear, r.roverGap, r.roverMax, r.seconds, r.notes.join('; ')].join(' | '));
  return [head.join(' | '), ...lines].join('\n');
}

/**
 * Run the routes on a world with a fixed time step. `routes` filters by name (a name matches itself
 * and everything that starts with it plus ":"; with no filter, all). Returns one row per route.
 */
export async function lumiRoutes(options: RouteOptions, deps: RouteDeps): Promise<{ rows: RouteRow[]; table: string; buildings: unknown[]; skipped: string[] }> {
  const site = options.world ?? 'mars';
  const dt = options.dt ?? 1 / 60;
  let w = director.getWorld();
  if (!w || w.site !== site || !w.eva.active) {
    await deps.toWalk(site);
    w = director.getWorld();
  }
  if (!w || !w.eva.active) throw new Error('No walk is running on ' + site);
  // The new buildings need their model (it arrives after the start); then every one of them stands on its plot.
  for (let i = 0; i < 200 && !hasModel('annex'); i++) await new Promise((resolve) => setTimeout(resolve, 100));
  w.setOutpost((Object.keys(PLOTS) as BuildingId[]).map((id) => ({ id, state: 'done' as const, progress: 1 })));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const wi = w as unknown as WorldInner;
  const c: Ctx = {
    w,
    wi,
    eva: w.eva as unknown as EvaInner,
    rover: w.rover as unknown as RoverInner,
    lumi: w.lumi as unknown as LumiInner,
    dt,
    input: noInput(),
    ground: w.terrain.info.height,
    walkSpeed: site === 'moon' ? 5.4 : 6.4,
    notes: [],
    trace: options.trace === true,
  };
  const all = findBuildings(w);
  const skipped: string[] = [];
  const wanted = options.routes;
  const routes = buildRoutes(c, all, skipped).filter((r) => !wanted || wanted.some((name) => r.name === name || r.name.startsWith(name + ':')));

  // From here on it is all synchronous: the game's own loop is stopped, and the input is ours.
  w.engine.stop();
  wi.input.read = () => c.input;
  const events = c.eva.onEvent;
  c.eva.onEvent = () => {};
  const wasPaused = w.paused;
  const keepOut0 = c.lumi.keepOut;
  const top0 = c.rover.top;
  w.paused = false;
  const rows: RouteRow[] = [];
  const clock = { t: 1000 };
  try {
    for (const route of routes) rows.push(runRoute(c, route, clock));
  } finally {
    // The scripted reader was an own property; the real one comes from the class again.
    delete (wi.input as { read?: unknown }).read;
    c.eva.onEvent = events;
    // A route that threw must not leave the hard rule off or the rover's top speed raised.
    c.lumi.keepOut = keepOut0;
    c.rover.top = top0;
    w.paused = wasPaused;
    reset(c);
    w.engine.start();
  }
  const buildings = all.map((b) => ({ id: b.id, x: Math.round(b.x * 10) / 10, z: Math.round(b.z * 10) / 10, ext: Math.round(b.ext * 10) / 10, circles: b.circles.map((q) => [q.x, q.z, q.r].map((v) => Math.round(v * 10) / 10)) }));
  return { rows, table: routeTable(rows), buildings, skipped };
}
