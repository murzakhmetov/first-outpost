/**
 * Keeping Lumi (a floating sphere) out of solid things.
 *
 * Solids are vertical circles (the colliders the walk already uses; `h` is the height above the
 * ground, and a collider without one counts as tall) and oriented boxes (the rover at its
 * current pose). `resolveSphere` moves a sphere out of all of them: it pushes sideways along the
 * shortest exit, and when that does not settle (a pocket between colliders) or going over is
 * shorter, it lifts the sphere above the tallest solid it touches. The result never overlaps.
 * Everything here is plain numbers, so it can be tested without a scene.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SolidCircle {
  x: number;
  z: number;
  /** Radius; 0 or less means the collider is switched off. */
  r: number;
  /** Height above the ground at its middle, metres. Without one the collider counts as tall. */
  h?: number;
}

/** A box turned about the vertical axis. `x`,`z` is its middle; the local frame is the rover's (see `pushBox`). */
export interface SolidBox {
  x: number;
  z: number;
  hx: number;
  hz: number;
  yaw: number;
  y0: number;
  y1: number;
}

export interface Solids {
  circles: readonly SolidCircle[];
  boxes: readonly SolidBox[];
  ground: (x: number, z: number) => number;
}

/** What "tall" means for a collider with no height, metres. */
export const TALL = 10;
/** Lumi's body is about this big (the ring is the widest part), metres. */
export const LUMI_RADIUS = 0.45;
/** Air kept between Lumi and any solid, metres. */
export const LUMI_MARGIN = 0.35;
/** Lumi must stay this far from every solid (radius plus margin). */
export const LUMI_CLEAR = LUMI_RADIUS + LUMI_MARGIN;
/** The goal keeps a little more room, so the flight to it rarely touches anything. */
export const LUMI_GOAL_CLEAR = LUMI_CLEAR + 0.25;

const EPS = 0.002;

const vertGap = (y: number, y0: number, y1: number): number => (y > y1 ? y - y1 : y < y0 ? y0 - y : 0);

/** Push `p` out of a circle solid. With `apply` false it only tells whether they overlap. */
function pushCircle(p: Vec3, c: SolidCircle, R: number, ground: Solids['ground'], apply: boolean, prefX: number, prefZ: number): boolean {
  if (c.r <= 0) return false;
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const reach = c.r + R;
  const d2 = dx * dx + dz * dz;
  if (d2 >= reach * reach) return false;
  const gap = Math.max(0, p.y - (ground(c.x, c.z) + (c.h ?? TALL)));
  if (gap >= R) return false;
  const need = c.r + Math.sqrt(R * R - gap * gap);
  if (d2 >= need * need) return false;
  if (apply) {
    const to = need + EPS;
    if (d2 < 1e-10) {
      const len = Math.hypot(prefX, prefZ) || 1;
      p.x = c.x + (prefX / len) * to;
      p.z = c.z + (prefZ / len) * to;
    } else {
      const d = Math.sqrt(d2);
      p.x = c.x + (dx / d) * to;
      p.z = c.z + (dz / d) * to;
    }
  }
  return true;
}

/** Push `p` out of a box solid (see `pushCircle`). The local frame is the one of `Rover.exitSpots`. */
function pushBox(p: Vec3, b: SolidBox, R: number, apply: boolean): boolean {
  const gap = vertGap(p.y, b.y0, b.y1);
  if (gap >= R) return false;
  const need = Math.sqrt(R * R - gap * gap);
  const cos = Math.cos(b.yaw);
  const sin = Math.sin(b.yaw);
  const dx = p.x - b.x;
  const dz = p.z - b.z;
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  const qx = Math.max(-b.hx, Math.min(b.hx, lx));
  const qz = Math.max(-b.hz, Math.min(b.hz, lz));
  const ex = lx - qx;
  const ez = lz - qz;
  const dist = Math.hypot(ex, ez);
  if (dist >= need) return false;
  if (!apply) return true;
  const to = need + EPS;
  let nx: number;
  let nz: number;
  if (dist > 1e-9) {
    nx = qx + (ex / dist) * to;
    nz = qz + (ez / dist) * to;
  } else if (b.hx - Math.abs(lx) <= b.hz - Math.abs(lz)) {
    // Inside: leave through the nearest side.
    nx = (lx >= 0 ? 1 : -1) * (b.hx + to);
    nz = lz;
  } else {
    nx = lx;
    nz = (lz >= 0 ? 1 : -1) * (b.hz + to);
  }
  p.x = b.x + nx * cos + nz * sin;
  p.z = b.z - nx * sin + nz * cos;
  return true;
}

/** True when a sphere of radius `R` at `p` touches any solid. */
export function sphereOverlaps(p: Vec3, R: number, solids: Solids): boolean {
  for (const c of solids.circles) if (pushCircle(p, c, R, solids.ground, false, 0, 0)) return true;
  for (const b of solids.boxes) if (pushBox(p, b, R, false)) return true;
  return false;
}

/** Lift `p` straight up until the sphere is above every solid it touches. */
function liftAbove(p: Vec3, R: number, solids: Solids): void {
  const limit = solids.circles.length + solids.boxes.length + 2;
  for (let pass = 0; pass < limit; pass++) {
    let top = -Infinity;
    for (const c of solids.circles) {
      if (pushCircle(p, c, R, solids.ground, false, 0, 0)) top = Math.max(top, solids.ground(c.x, c.z) + (c.h ?? TALL));
    }
    for (const b of solids.boxes) if (pushBox(p, b, R, false)) top = Math.max(top, b.y1);
    if (top === -Infinity) return;
    p.y = top + R + EPS;
  }
}

/**
 * Move the sphere centre `p` (radius `R`) out of every solid, in place. Returns true when it had to
 * move. Pushes sideways (the shortest way out); lifts instead when the pushes do not settle or the
 * lift is shorter. `prefX`/`prefZ` is the way to step from the exact middle of a circle.
 */
export function resolveSphere(p: Vec3, R: number, solids: Solids, prefX = 1, prefZ = 0): boolean {
  if (!sphereOverlaps(p, R, solids)) return false;
  const x0 = p.x;
  const y0 = p.y;
  const z0 = p.z;
  let settled = false;
  for (let pass = 0; pass < 8 && !settled; pass++) {
    settled = true;
    for (const c of solids.circles) if (pushCircle(p, c, R, solids.ground, true, prefX, prefZ)) settled = false;
    for (const b of solids.boxes) if (pushBox(p, b, R, true)) settled = false;
  }
  const clear = settled || !sphereOverlaps(p, R, solids);
  const pushed = Math.hypot(p.x - x0, p.z - z0);
  const sx = p.x;
  const sz = p.z;
  p.x = x0;
  p.y = y0;
  p.z = z0;
  liftAbove(p, R, solids);
  const lifted = p.y - y0;
  if (clear && pushed <= lifted) {
    p.x = sx;
    p.y = y0;
    p.z = sz;
  }
  return true;
}
