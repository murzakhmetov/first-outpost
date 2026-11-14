import { describe, expect, it } from 'vitest';
import { LUMI_CLEAR, LUMI_GOAL_CLEAR, resolveSphere, sphereOverlaps } from '../src/world/keepclear';
import type { SolidBox, SolidCircle, Solids, Vec3 } from '../src/world/keepclear';
import { LUMI_TOP_SPEED, MAX_GOAL_RAISE, driveGoal, liftGoalOverPath, newRoverBoxes, pushFlight, roverBoxes, stepFlight, walkGoal } from '../src/world/lumifollow';
import type { Flight } from '../src/world/lumifollow';

const flat = (circles: SolidCircle[] = [], boxes: SolidBox[] = []): Solids => ({ circles, boxes, ground: () => 0 });
const box = (over: Partial<SolidBox> = {}): SolidBox => ({ x: 0, z: 0, hx: 1, hz: 2, yaw: 0, y0: 0, y1: 3, ...over });

describe('sphere against a circle with height', () => {
  it('leaves a sphere in the open alone', () => {
    const p = { x: 9, y: 2, z: 0 };
    expect(resolveSphere(p, 0.8, flat([{ x: 0, z: 0, r: 2, h: 3 }]))).toBe(false);
    expect(p).toEqual({ x: 9, y: 2, z: 0 });
  });

  it('pushes sideways along the shortest exit', () => {
    const p = { x: 2.5, y: 1, z: 0 };
    const solids = flat([{ x: 0, z: 0, r: 2, h: 10 }]);
    expect(resolveSphere(p, 0.8, solids)).toBe(true);
    expect(p.x).toBeCloseTo(2.8, 2);
    expect(p.y).toBe(1);
    expect(sphereOverlaps(p, 0.8 - 1e-6, solids)).toBe(false);
  });

  it('passes over a low collider without touching it', () => {
    const p = { x: 0.2, y: 2.0, z: 0 };
    expect(sphereOverlaps(p, 0.8, flat([{ x: 0, z: 0, r: 2, h: 1 }]))).toBe(false);
    expect(sphereOverlaps({ x: 0.2, y: 1.5, z: 0 }, 0.8, flat([{ x: 0, z: 0, r: 2, h: 1 }]))).toBe(true);
  });

  it('counts a collider without a height as tall and uses the ground under it', () => {
    const solids: Solids = { circles: [{ x: 0, z: 0, r: 2 }], boxes: [], ground: () => 5 };
    expect(sphereOverlaps({ x: 1, y: 14, z: 0 }, 0.8, solids)).toBe(true);
    expect(sphereOverlaps({ x: 1, y: 16.5, z: 0 }, 0.8, solids)).toBe(false);
  });

  it('ignores switched-off colliders', () => {
    expect(sphereOverlaps({ x: 0, y: 1, z: 0 }, 0.8, flat([{ x: 0, z: 0, r: 0 }]))).toBe(false);
  });

  it('steps the preferred way from the exact middle', () => {
    const p = { x: 0, y: 1, z: 0 };
    resolveSphere(p, 1, flat([{ x: 0, z: 0, r: 1, h: 9 }]), 0, -1);
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(-2, 2);
  });
});

describe('sphere against an oriented box', () => {
  it('pushes out of the side of a turned box', () => {
    const b = box({ yaw: 0.7 });
    const solids = flat([], [b]);
    // A point just inside the +X face, in the box frame, turned to the world.
    const lx = 1.2;
    const p: Vec3 = { x: lx * Math.cos(0.7), y: 1, z: -lx * Math.sin(0.7) };
    expect(sphereOverlaps(p, 0.8, solids)).toBe(true);
    resolveSphere(p, 0.8, solids);
    expect(sphereOverlaps(p, 0.8 - 1e-6, solids)).toBe(false);
    const local = p.x * Math.cos(0.7) - p.z * Math.sin(0.7);
    expect(local).toBeCloseTo(1.8, 2);
  });

  it('leaves through the nearest side from inside', () => {
    const p = { x: 0.4, y: 1, z: 0 };
    resolveSphere(p, 0.8, flat([], [box()]));
    expect(p.x).toBeCloseTo(1.8, 2);
    expect(p.z).toBeCloseTo(0, 5);
  });

  it('is clear above the roof by its radius, and touches just under that', () => {
    const solids = flat([], [box()]);
    expect(sphereOverlaps({ x: 0, y: 3.81, z: 0 }, 0.8, solids)).toBe(false);
    expect(sphereOverlaps({ x: 0, y: 3.7, z: 0 }, 0.8, solids)).toBe(true);
  });

  it('rounds a corner (distance to the corner, not to the box)', () => {
    const solids = flat([], [box()]);
    // Corner at (1, 2): a point 0.6 off in both axes is 0.85 away.
    expect(sphereOverlaps({ x: 1.6, y: 1, z: 2.6 }, 0.8, solids)).toBe(false);
    expect(sphereOverlaps({ x: 1.5, y: 1, z: 2.5 }, 0.8, solids)).toBe(true);
  });
});

describe('push-out with the lift fallback', () => {
  it('lifts above a pocket of three touching colliders, free of all of them', () => {
    // Three circles of radius 2 around the origin, each touching the other two.
    const r = 2;
    const d = (2 * r) / Math.sqrt(3);
    const circles: SolidCircle[] = [0, 1, 2].map((i) => ({ x: Math.cos((i * 2 * Math.PI) / 3) * d, z: Math.sin((i * 2 * Math.PI) / 3) * d, r, h: 4 }));
    const solids = flat(circles);
    const p = { x: 0, y: 1.5, z: 0 };
    expect(resolveSphere(p, 0.8, solids)).toBe(true);
    expect(sphereOverlaps(p, 0.8 - 1e-6, solids)).toBe(false);
    expect(p.y).toBeGreaterThanOrEqual(4 + 0.8);
  });

  it('is free after resolving, from many starting points in a pocket', () => {
    const circles: SolidCircle[] = [
      { x: -2.2, z: 0, r: 2, h: 6 },
      { x: 2.2, z: 0, r: 2, h: 3 },
      { x: 0, z: 3.4, r: 2, h: 9 },
      { x: 0, z: -3.4, r: 2 },
    ];
    const solids = flat(circles);
    for (let i = 0; i < 400; i++) {
      const p = { x: Math.sin(i * 1.7) * 4, y: 0.5 + (i % 9) * 0.5, z: Math.cos(i * 2.3) * 4 };
      resolveSphere(p, 0.8, solids);
      expect(sphereOverlaps(p, 0.8 - 1e-6, solids)).toBe(false);
    }
  });

  it('prefers going over when that is shorter than the way round', () => {
    // Deep inside a short collider: 0.3 up beats 2 m sideways.
    const p = { x: 0.1, y: 1.2, z: 0 };
    resolveSphere(p, 0.8, flat([{ x: 0, z: 0, r: 2, h: 0.7 }]));
    expect(p.x).toBeCloseTo(0.1, 5);
    expect(p.y).toBeCloseTo(1.5, 2);
  });

  it('lifts above the rover roof when squeezed between it and a building', () => {
    const solids = flat([{ x: 3.2, z: 0, r: 2, h: 10 }], [box()]);
    const p = { x: 1.7, y: 1.5, z: 0 };
    resolveSphere(p, 0.8, solids);
    expect(sphereOverlaps(p, 0.8 - 1e-6, solids)).toBe(false);
  });
});

// ----- Simulated passes: the real flight, goal and constraint code, 60 frames a second -----------------

interface Run {
  frames: number;
  overlaps: number;
  /** Fastest drawn step outside teleports, metres per second. */
  maxSpeed: number;
  minClear: number;
}

/**
 * The cadet moves along `path(t)`; Lumi follows exactly as World does (goal, constrained goal, spring
 * step, hard constraint on the drawn position) and every frame is checked against the solids.
 */
function simulate(opts: {
  solids: Solids;
  seconds: number;
  pose: (t: number) => { x: number; z: number; heading: number };
  driving: boolean;
  /** The moving rover joins the solids (it is the player's rover). */
  roverBody?: SolidBox[];
  start: Vec3;
}): Run {
  const dt = 1 / 60;
  const flight: Flight = { pos: { ...opts.start }, vel: { x: 0, y: 0, z: 0 } };
  const goal: Vec3 = { x: 0, y: 0, z: 0 };
  const boxes = opts.roverBody ? [...opts.solids.boxes, ...opts.roverBody] : opts.solids.boxes;
  const solids: Solids = { ...opts.solids, boxes };
  const run: Run = { frames: 0, overlaps: 0, maxSpeed: 0, minClear: Infinity };
  let last: Vec3 | null = null;
  for (let t = 0; t < opts.seconds; t += dt) {
    const pose = opts.pose(t);
    if (opts.roverBody) roverBoxes(opts.roverBody, pose.x, 0, pose.z, pose.heading);
    if (opts.driving) driveGoal(goal, pose.x, 0, pose.z, pose.heading);
    else walkGoal(goal, pose.x, 0, pose.z, pose.heading);
    resolveSphere(goal, LUMI_GOAL_CLEAR, solids);
    stepFlight(flight, goal, dt);
    // Same bob as Lumi's: the drawn point is not the flight point.
    const bob = Math.sin(t * 2.2) * 0.07;
    pushFlight(flight, bob, LUMI_CLEAR, solids);
    const drawn = { x: flight.pos.x, y: flight.pos.y + bob, z: flight.pos.z };
    run.frames++;
    if (sphereOverlaps(drawn, LUMI_CLEAR - 1e-3, solids)) run.overlaps++;
    if (last) run.maxSpeed = Math.max(run.maxSpeed, Math.hypot(drawn.x - last.x, drawn.y - last.y, drawn.z - last.z) / dt);
    last = drawn;
  }
  return run;
}

const parked = (x: number, z: number, heading: number): SolidBox[] => {
  const out = newRoverBoxes();
  roverBoxes(out, x, 0, z, heading);
  return out;
};

describe('simulated passes (60 fps)', () => {
  const PARK = { x: 10.5, z: 9, heading: 2.2 + Math.PI / 2 };

  it('on foot at 6.4 m/s past a parked rover, on both sides, never overlaps', () => {
    for (const side of [-1, 1]) {
      for (const lateral of [1.9, 2.4, 3.5]) {
        for (const dir of [1, -1]) {
          const cos = Math.cos(PARK.heading);
          const sin = Math.sin(PARK.heading);
          // Walk along the rover's length, on one side of it.
          const along = { x: sin * dir, z: cos * dir };
          const sideway = { x: cos * side * lateral, z: -sin * side * lateral };
          const run = simulate({
            solids: flat([], parked(PARK.x, PARK.z, PARK.heading)),
            seconds: 4,
            driving: false,
            start: { x: PARK.x + sideway.x - along.x * 12, y: 2.05, z: PARK.z + sideway.z - along.z * 12 },
            pose: (t) => ({
              x: PARK.x + sideway.x + along.x * (-12 + 6.4 * t),
              z: PARK.z + sideway.z + along.z * (-12 + 6.4 * t),
              heading: Math.atan2(along.x, along.z),
            }),
          });
          expect(run.overlaps).toBe(0);
          expect(run.maxSpeed).toBeLessThan(LUMI_TOP_SPEED);
        }
      }
    }
  });

  it('on foot walking at a parked rover from every side (the cadet is stopped by its circles), never overlaps or pops', () => {
    const solids = flat([], parked(PARK.x, PARK.z, PARK.heading));
    // The walk stops the cadet at the rover's three circles (radius 1.5 plus the cadet's 0.4).
    const stops = [-1.3, 0, 1.3].map((o) => ({ x: PARK.x + Math.sin(PARK.heading) * o, z: PARK.z + Math.cos(PARK.heading) * o }));
    for (let k = 0; k < 24; k++) {
      const angle = (k / 24) * Math.PI * 2;
      const ax = Math.cos(angle);
      const az = Math.sin(angle);
      const run = simulate({
        solids,
        seconds: 4,
        driving: false,
        start: { x: PARK.x - ax * 14, y: 2.05, z: PARK.z - az * 14 },
        pose: (t) => {
          const at = { x: PARK.x - ax * 14 + ax * 6.4 * t, z: PARK.z - az * 14 + az * 6.4 * t };
          for (let pass = 0; pass < 3; pass++) {
            for (const s of stops) {
              const d = Math.hypot(at.x - s.x, at.z - s.z);
              if (d < 1.9) {
                at.x = s.x + ((at.x - s.x) / (d || 1)) * 1.9;
                at.z = s.z + ((at.z - s.z) / (d || 1)) * 1.9;
              }
            }
          }
          return { ...at, heading: Math.atan2(ax, az) };
        },
      });
      expect(run.overlaps).toBe(0);
      expect(run.maxSpeed).toBeLessThan(LUMI_TOP_SPEED);
    }
  });

  it('by rover at 12 m/s past a parked rover and past a building, never overlaps', () => {
    const still = parked(PARK.x, PARK.z, PARK.heading);
    for (const side of [-1, 1]) {
      for (const lateral of [2.9, 3.5, 5]) {
        const run = simulate({
          solids: flat([{ x: 30, z: 0, r: 7 }], still),
          seconds: 3,
          driving: true,
          roverBody: newRoverBoxes(),
          start: { x: PARK.x + side * lateral, y: 5, z: PARK.z - 20 },
          pose: (t) => ({ x: PARK.x + side * lateral, z: PARK.z - 20 + 12 * t, heading: 0 }),
        });
        expect(run.overlaps).toBe(0);
        expect(run.maxSpeed).toBeLessThan(LUMI_TOP_SPEED);
      }
    }
  });

  it('by rover at 12 m/s and on foot at 6.4 m/s between two buildings, never overlaps', () => {
    // Two tall buildings of radius 7 with 3.4 m between their walls.
    const solids = flat([
      { x: -10.7, z: 0, r: 7 },
      { x: 10.7, z: 0, r: 7 },
    ]);
    const drive = simulate({
      solids,
      seconds: 3,
      driving: true,
      roverBody: newRoverBoxes(),
      start: { x: 0, y: 5, z: -30 },
      pose: (t) => ({ x: 0, z: -30 + 12 * t, heading: 0 }),
    });
    expect(drive.overlaps).toBe(0);
    expect(drive.maxSpeed).toBeLessThan(LUMI_TOP_SPEED);
    for (const dir of [1, -1]) {
      const walk = simulate({
        solids,
        seconds: 7,
        driving: false,
        start: { x: 0, y: 2.05, z: -30 * dir },
        pose: (t) => ({ x: 0, z: (-30 + 6.4 * t) * dir, heading: dir > 0 ? 0 : Math.PI }),
      });
      expect(walk.overlaps).toBe(0);
      expect(walk.maxSpeed).toBeLessThan(LUMI_TOP_SPEED);
    }
  });

  it('with the cadet teleported into the rover and out again, ends outside every solid', () => {
    const body = parked(PARK.x, PARK.z, PARK.heading);
    const solids = flat([{ x: 0, z: 0, r: 7 }], body);
    // Lumi was floating where the cadet's goal is, beside the rover, then the goal jumps over the roof.
    for (const p of [
      { x: PARK.x, y: 2, z: PARK.z },
      { x: PARK.x + 1, y: 3, z: PARK.z - 1 },
      { x: 0, y: 1, z: 0 },
    ]) {
      resolveSphere(p, LUMI_CLEAR, solids);
      expect(sphereOverlaps(p, LUMI_CLEAR - 1e-3, solids)).toBe(false);
    }
  });
});

describe('rover on a slope', () => {
  it('its boxes rise and sink with the lean, so the nose and the mast stay inside them', () => {
    const level = newRoverBoxes();
    const leaning = newRoverBoxes();
    roverBoxes(level, 0, 0, 0, 0);
    roverBoxes(leaning, 0, 0, 0, 0, 0.35, 0.2);
    for (let i = 0; i < level.length; i++) {
      expect(leaning[i].y1).toBeGreaterThan(level[i].y1 + 0.8);
      expect(leaning[i].y0).toBeLessThan(level[i].y0 - 0.8);
    }
    // Lumi level with the roof of a level rover touches the leaning one, which is what keeps the nose end safe.
    expect(sphereOverlaps({ x: 0, y: 3.2 + LUMI_CLEAR + 0.3, z: 2.2 }, LUMI_CLEAR, flat([], level))).toBe(false);
    expect(sphereOverlaps({ x: 0, y: 3.2 + LUMI_CLEAR + 0.3, z: 2.2 }, LUMI_CLEAR, flat([], leaning))).toBe(true);
  });
});

describe('a step between two solids', () => {
  it('steps over the low roof and away from the mast with two small moves, not one big lift', () => {
    // The rover's hull (3.2 m) with its mast box (3.9 m) at one end; Lumi rests on the roof (bobbing a hair into it) at the mast's front edge.
    const boxes = newRoverBoxes();
    roverBoxes(boxes, 0, 0, -27.8, 0, 0, 0);
    const solids = flat([], boxes);
    const p = { x: 0.79, y: 3.99, z: -26.26 };
    expect(resolveSphere(p, 0.8, solids)).toBe(true);
    expect(sphereOverlaps(p, 0.8 - 1e-6, solids)).toBe(false);
    // Moved by hundredths of a metre, not the 0.7 m of a lift over the mast.
    expect(Math.hypot(p.x - 0.79, p.y - 3.99, p.z + 26.26)).toBeLessThan(0.1);
  });
});

describe('the flight goes over what is in the way', () => {
  it('raises a low goal behind a wall of low solids so the straight way is clear', () => {
    // A 3 m high block between Lumi (up at 5 m) and a goal on the other side at 2 m.
    const solids = flat([{ x: 5, z: 0, r: 1.5, h: 3 }]);
    const goal = { x: 10, y: 2, z: 0 };
    const from = { x: 0, y: 5, z: 0 };
    liftGoalOverPath(goal, from, 0.9, solids);
    expect(goal.y).toBeGreaterThan(2);
    // The straight line from Lumi to the raised goal passes over the block, with Lumi's room to spare.
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const q = { x: from.x + (goal.x - from.x) * t, y: from.y + (goal.y - from.y) * t, z: 0 };
      if (t >= 0.15) expect(sphereOverlaps(q, 0.9 - 0.05, solids)).toBe(false);
    }
  });
  it('goes high enough over a tall building from right beside it', () => {
    // The lab: 9.5 m tall, Lumi 2 m from its wall at 2 m height, the goal beyond it.
    const solids = flat([{ x: 3, z: 0, r: 3, h: 9.5 }]);
    const goal = { x: 20, y: 2, z: 0 };
    const from = { x: -2, y: 2, z: 0 };
    liftGoalOverPath(goal, from, 0.9, solids);
    expect(goal.y).toBeGreaterThan(9.5);
    expect(goal.y).toBeLessThanOrEqual(2 + MAX_GOAL_RAISE);
  });
  it('leaves a clear way alone', () => {
    const goal = { x: 10, y: 2, z: 0 };
    liftGoalOverPath(goal, { x: 0, y: 2, z: 0 }, 0.9, flat([{ x: 5, z: 6, r: 1.5, h: 3 }]));
    expect(goal.y).toBe(2);
  });
});

describe('flying across the outpost over a tall building', () => {
  // The lab as it stands on Mars: a row of tall circles; Lumi starts on its far side, the cadet is on the other.
  const lab: SolidCircle[] = [
    { x: 19, z: -6.6, r: 3.1, h: 9.4 },
    { x: 19, z: -3, r: 3.1, h: 9.5 },
    { x: 19, z: 0.6, r: 3.1, h: 8.6 },
    { x: 19, z: 4.6, r: 1.3, h: 7.7 },
  ];
  it.each([
    { x: 43, z: 4.5 },
    { x: 40, z: -2 },
    { x: -5, z: 3 },
  ])('gets over it and arrives, never inside it (from $x,$z)', (start) => {
    const solids = flat(lab);
    const flight: Flight = { pos: { x: start.x, y: 2.1, z: start.z }, vel: { x: 0, y: 0, z: 0 } };
    const target = start.x > 19 ? { x: -5, y: 2.1, z: 3 } : { x: 43, y: 2.1, z: 4.5 };
    const goal: Vec3 = { ...target };
    const dt = 1 / 60;
    let overlaps = 0;
    let arrived = -1;
    for (let t = 0; t < 15; t += dt) {
      goal.x = target.x;
      goal.y = target.y;
      goal.z = target.z;
      resolveSphere(goal, LUMI_GOAL_CLEAR, solids);
      liftGoalOverPath(goal, flight.pos, LUMI_CLEAR + 0.1, solids);
      stepFlight(flight, goal, dt);
      pushFlight(flight, 0, LUMI_CLEAR, solids);
      if (sphereOverlaps(flight.pos, LUMI_CLEAR - 1e-3, solids)) overlaps++;
      if (arrived < 0 && Math.hypot(flight.pos.x - target.x, flight.pos.z - target.z) < 3) arrived = t;
    }
    expect(overlaps).toBe(0);
    expect(arrived).toBeGreaterThan(0);
    expect(arrived).toBeLessThan(10);
  });
});

describe('the goals', () => {
  it('the drive goal sits beside the rover, below the roof line, outside its body at any heading', () => {
    const goal = { x: 0, y: 0, z: 0 };
    for (let heading = 0; heading < 6.3; heading += 0.5) {
      const boxes = newRoverBoxes();
      roverBoxes(boxes, 5, 0, -3, heading);
      driveGoal(goal, 5, 0, -3, heading);
      expect(goal.y).toBeLessThan(3.2);
      expect(sphereOverlaps(goal, 0.3, flat([], boxes))).toBe(false); // never inside the hull; the clearance is added by the world's goal resolve
    }
  });
  it('the walk goal is beside the cadet, on the camera right when the camera is known', () => {
    const goal = { x: 0, y: 0, z: 0 };
    walkGoal(goal, 0, 0, 0, 0.3, 0, 10); // camera at +z looking toward -z: its right is +x
    expect(goal.x).toBeGreaterThan(1.2);
    expect(Math.abs(goal.z - Math.cos(0.3) * 0.5)).toBeLessThan(0.1);
  });
});
