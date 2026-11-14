/**
 * Pictures for the landing simulator, drawn on a canvas: the sky (butterscotch
 * on Mars, black with the Earth from the Moon), hills, rocky ground, the pad
 * with its target and lights, the lander, its flame, and the dust it blows.
 *
 * Dust follows each world's truth: on the airless Moon it flies in long, clean
 * arcs and drops; in Mars's thin air it billows, drifts and hangs a while.
 * Everything that does not move is painted once into a picture kept aside.
 */
import { mulberry32 } from '../../sim/rng';
import { groundAt, gustAt } from './lander';
import type { Lander, LanderTune } from './lander';

/** The view shows this far either side of the pad, m. */
export const VIEW_HALF = 48;

/** Lander drawing units: feet at 0, antenna tip at -112. */
const LANDER_UNITS = 112;

/** The outline colour of every drawing in the game. */
const INK = '#2b2440';

export interface View {
  w: number;
  h: number;
  /** Screen y of the pad's surface. */
  gy: number;
  /** Pixels per metre, across and up. */
  sx: number;
  sy: number;
  /** The lander's height on screen, px. */
  size: number;
}

export function makeView(w: number, h: number, tune: LanderTune): View {
  const gy = Math.round(h * 0.8);
  const size = Math.max(28, Math.min(60, h * 0.13));
  // At the start the whole lander is below the instrument chips at the top (about 52 px).
  const top = 58 + size;
  return {
    w,
    h,
    gy,
    sx: w / (2 * VIEW_HALF),
    sy: Math.max(0.5, (gy - top) / tune.startAlt),
    size,
  };
}

const px = (v: View, x: number): number => v.w / 2 + x * v.sx;
const py = (v: View, y: number): number => v.gy - y * v.sy;

type PartKind = 'dust' | 'ember' | 'puff' | 'spark';

interface Part {
  kind: PartKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  /** Size on screen, px. */
  r: number;
}

export interface Scene {
  view: View;
  dpr: number;
  bg: HTMLCanvasElement | null;
  parts: Part[];
  /** Fractions of a particle still owed by each emitter. */
  owe: { dust: number; ember: number; puff: number };
  shake: number;
  tip: number;
  tipGoal: number;
  /** 0 to 1 while the lander bounces after a hard touchdown. */
  hop: number;
  /** 1 right after a soft touchdown, falling to 0: the legs give a little. */
  squash: number;
  flick: number;
  time: number;
  calm: boolean;
  seed: number;
}

export function newScene(tune: LanderTune, calm: boolean): Scene {
  return {
    view: makeView(320, 320, tune),
    dpr: 1,
    bg: null,
    parts: [],
    owe: { dust: 0, ember: 0, puff: 0 },
    shake: 0,
    tip: 0,
    tipGoal: 0,
    hop: 0,
    squash: 0,
    flick: 1,
    time: 0,
    calm,
    seed: Math.floor(Math.random() * 1e6),
  };
}

// ----- The still picture: sky, hills, ground, pad ----------------------------------------

function drawEarth(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const glow = ctx.createRadialGradient(x, y, r * 0.85, x, y, r * 1.7);
  glow.addColorStop(0, 'rgba(120, 180, 255, 0.4)');
  glow.addColorStop(1, 'rgba(120, 180, 255, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  const sea = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  sea.addColorStop(0, '#6fb2ff');
  sea.addColorStop(1, '#1c4fae');
  ctx.fillStyle = sea;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.fillStyle = '#62b35e';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.28, y - r * 0.12, r * 0.34, r * 0.22, 0.6, 0, Math.PI * 2);
  ctx.ellipse(x + r * 0.22, y + r * 0.34, r * 0.22, r * 0.36, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d6bd7f';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.2, y - r * 0.02, r * 0.14, r * 0.09, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, r * 0.13);
  ctx.beginPath();
  ctx.arc(x - r * 0.1, y - r * 0.55, r * 0.5, 0.3, 1.5);
  ctx.moveTo(x + r * 0.62, y - r * 0.05);
  ctx.arc(x + r * 0.2, y + r * 0.1, r * 0.45, -0.3, 0.9);
  ctx.stroke();
  // The night side: from the Moon the Earth shows phases, as the Moon does from the Earth.
  ctx.fillStyle = 'rgba(3, 5, 18, 0.66)';
  ctx.beginPath();
  ctx.arc(x + r * 1.3, y + r * 0.15, r * 1.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Two bands of far hills along the horizon. */
function drawHills(ctx: CanvasRenderingContext2D, v: View, rand: () => number, colours: [string, string]): void {
  colours.forEach((colour, layer) => {
    const base = v.gy - v.h * (layer === 0 ? 0.12 : 0.06);
    const amp = v.h * (layer === 0 ? 0.07 : 0.045);
    const a = rand() * 6;
    const b = rand() * 6;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(0, v.gy + 4);
    for (let x = 0; x <= v.w + 4; x += 4) {
      const k = x / v.w;
      const y = base - amp * (0.55 + 0.3 * Math.sin(k * 7.3 + a) + 0.25 * Math.sin(k * 15.1 + b) + 0.12 * Math.sin(k * 31 + a));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(v.w, v.gy + 4);
    ctx.closePath();
    ctx.fill();
  });
}

/** Paint the parts of the scene that never move into a picture kept aside. */
export function paintBackground(scene: Scene, tune: LanderTune): void {
  const v = scene.view;
  const canvas = scene.bg ?? document.createElement('canvas');
  scene.bg = canvas;
  canvas.width = Math.max(1, Math.round(v.w * scene.dpr));
  canvas.height = Math.max(1, Math.round(v.h * scene.dpr));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0);
  const rand = mulberry32(scene.seed);
  const mars = tune.site === 'mars';

  // Sky.
  const sky = ctx.createLinearGradient(0, 0, 0, v.gy);
  if (mars) {
    sky.addColorStop(0, '#b0703c');
    sky.addColorStop(0.55, '#d9a066');
    sky.addColorStop(1, '#f0cd98');
  } else {
    sky.addColorStop(0, '#020309');
    sky.addColorStop(1, '#0b0f20');
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, v.w, v.h);

  if (mars) {
    // A small, pale Sun with a wide glow in the dusty air.
    const sunX = v.w * 0.2;
    const sunY = v.h * 0.15;
    const halo = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, v.h * 0.22);
    halo.addColorStop(0, 'rgba(255, 250, 235, 0.75)');
    halo.addColorStop(1, 'rgba(255, 240, 210, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, v.w, v.h);
    ctx.fillStyle = '#fffdf6';
    ctx.beginPath();
    ctx.arc(sunX, sunY, Math.max(3, v.h * 0.018), 0, Math.PI * 2);
    ctx.fill();
  } else {
    for (let i = 0; i < 90; i++) {
      const x = rand() * v.w;
      const y = rand() * v.gy * 0.85;
      ctx.fillStyle = `rgba(255, 255, 255, ${0.35 + rand() * 0.65})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.5 + rand() * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    drawEarth(ctx, v.w * 0.8, v.h * 0.15, Math.max(9, Math.min(v.w, v.h) * 0.065));
  }

  drawHills(ctx, v, rand, mars ? ['rgba(196, 118, 70, 0.75)', '#a4522c'] : ['#2f3340', '#474b58']);

  // Ground, with its bumps and far hills.
  const ground = ctx.createLinearGradient(0, v.gy - 10, 0, v.h);
  if (mars) {
    ground.addColorStop(0, '#c4673a');
    ground.addColorStop(1, '#6e2d15');
  } else {
    ground.addColorStop(0, '#9b9ea8');
    ground.addColorStop(1, '#474a54');
  }
  const surface = (): void => {
    ctx.moveTo(0, py(v, groundAt(-v.w / 2 / v.sx, tune.padHalf)));
    for (let x = 0; x <= v.w + 3; x += 3) ctx.lineTo(x, py(v, groundAt((x - v.w / 2) / v.sx, tune.padHalf)));
  };
  ctx.fillStyle = ground;
  ctx.beginPath();
  surface();
  ctx.lineTo(v.w, v.h);
  ctx.lineTo(0, v.h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = mars ? '#e49563' : '#cfd2da';
  ctx.lineWidth = 2;
  ctx.beginPath();
  surface();
  ctx.stroke();

  // Craters on the Moon, pebbles and streaks on Mars, in the ground in front.
  const band = v.h - v.gy;
  for (let i = 0; i < (mars ? 26 : 9); i++) {
    const x = rand() * v.w;
    const y = v.gy + 8 + rand() * Math.max(4, band - 12);
    if (mars) {
      ctx.fillStyle = rand() < 0.5 ? 'rgba(80, 30, 12, 0.35)' : 'rgba(240, 170, 120, 0.3)';
      ctx.beginPath();
      ctx.ellipse(x, y, 1.5 + rand() * 4, 1 + rand() * 1.8, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const r = 4 + rand() * 12;
      ctx.fillStyle = 'rgba(30, 32, 40, 0.35)';
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(235, 238, 245, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(x, y + 0.6, r, r * 0.3, 0, 0.1, Math.PI - 0.1);
      ctx.stroke();
    }
  }
  // Boulders on the surface, away from the pad.
  for (let i = 0; i < 16; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (tune.padHalf + 3 + rand() * (VIEW_HALF - tune.padHalf - 3));
    const r = 2 + rand() * 5;
    const sx = px(v, x);
    const sy = py(v, groundAt(x, tune.padHalf));
    ctx.fillStyle = mars ? '#7c3a1d' : '#6c6f7a';
    ctx.beginPath();
    ctx.ellipse(sx, sy - r * 0.45, r, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = mars ? 'rgba(255, 190, 140, 0.45)' : 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.ellipse(sx - r * 0.3, sy - r * 0.75, r * 0.45, r * 0.22, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // The pad: a smooth slab with an outline, warning stripes at both ends, a gold target
  // in the middle and a post at each end.
  const left = px(v, -tune.padHalf);
  const right = px(v, tune.padHalf);
  ctx.fillStyle = mars ? '#e9d8bc' : '#dcd9d0';
  ctx.fillRect(left, v.gy, right - left, 5);
  ctx.fillStyle = mars ? '#9c7f62' : '#8f8c84';
  ctx.fillRect(left, v.gy + 5, right - left, 3);
  // Black and yellow stripes on the front of each end.
  const stripe = Math.min(16, (right - left) * 0.16);
  for (const start of [left, right - stripe]) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(start, v.gy + 5, stripe, 3);
    ctx.clip();
    for (let x = start - 6; x < start + stripe + 6; x += 6) {
      ctx.fillStyle = '#ffc93d';
      ctx.beginPath();
      ctx.moveTo(x, v.gy + 8);
      ctx.lineTo(x + 3, v.gy + 5);
      ctx.lineTo(x + 6, v.gy + 5);
      ctx.lineTo(x + 3, v.gy + 8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(40, 32, 20, 0.5)';
  ctx.lineWidth = 1;
  for (let x = left + 10; x < right - 4; x += 12) {
    ctx.beginPath();
    ctx.moveTo(x, v.gy + 0.5);
    ctx.lineTo(x, v.gy + 5);
    ctx.stroke();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(left, v.gy, right - left, 8);
  const mid = px(v, 0);
  const ring = Math.max(6, tune.bullseye * v.sx);
  ctx.fillStyle = 'rgba(245, 197, 66, 0.28)';
  ctx.beginPath();
  ctx.ellipse(mid, v.gy + 2.4, ring, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f5c542';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(mid, v.gy + 2.4, ring, 2.4, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f5c542';
  ctx.beginPath();
  ctx.ellipse(mid, v.gy + 2.4, 3.2, 1.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.fillRect(left - 1.5, v.gy - 8, 3.5, 9);
  ctx.fillRect(right - 2, v.gy - 8, 3.5, 9);
}

// ----- Moving parts ---------------------------------------------------------------------------

/** Where the engine's mouth is, in metres from the lander's feet. */
function nozzle(v: View): { up: number } {
  return { up: ((20 / LANDER_UNITS) * v.size) / v.sy };
}

function spawn(scene: Scene, part: Omit<Part, 'age'>): void {
  if (scene.parts.length > (scene.calm ? 70 : 260)) return;
  scene.parts.push({ ...part, age: 0 });
}

/** Move the dust and sparks on, and make new ones where the engine and jets fire. */
export function updateScene(scene: Scene, lander: Lander, tune: LanderTune, dt: number): void {
  const v = scene.view;
  const mars = tune.site === 'mars';
  scene.time += dt;
  scene.flick = scene.calm ? 1 : 0.86 + Math.random() * 0.28;
  scene.shake *= Math.exp(-7 * dt);
  scene.tip += (scene.tipGoal - scene.tip) * Math.min(1, dt * 5);
  if (scene.hop > 0) scene.hop = Math.max(0, scene.hop - dt * 2);
  if (scene.squash > 0) scene.squash = Math.max(0, scene.squash - dt * 3);

  const height = lander.y - groundAt(lander.x, tune.padHalf);
  if (lander.burning) {
    // Dust blown from the ground when the engine is close to it.
    const near = Math.max(0, 1 - height / 26);
    scene.owe.dust += dt * 230 * near ** 1.2 * (scene.calm ? 0.3 : 1);
    while (scene.owe.dust >= 1) {
      scene.owe.dust -= 1;
      const dir = Math.random() < 0.5 ? -1 : 1;
      const speed = (5 + Math.random() * 11) * (0.5 + near * 0.6);
      const x = lander.x + (Math.random() - 0.5) * 1.6;
      spawn(scene, {
        kind: 'dust',
        x,
        y: groundAt(x, tune.padHalf) + 0.15,
        vx: dir * speed,
        vy: mars ? 0.6 + Math.random() * 1.6 : 1 + Math.random() * 3,
        life: mars ? 1.8 + Math.random() * 1.4 : 2.6,
        r: mars ? 2.5 + Math.random() * 3 : 1 + Math.random() * 1.2,
      });
    }
    // Sparks of hot gas from the flame.
    scene.owe.ember += dt * (scene.calm ? 0 : 36);
    while (scene.owe.ember >= 1) {
      scene.owe.ember -= 1;
      spawn(scene, {
        kind: 'ember',
        x: lander.x + (Math.random() - 0.5) * 0.8,
        y: lander.y + nozzle(v).up,
        vx: lander.vx + (Math.random() - 0.5) * 3,
        vy: lander.vy - (9 + Math.random() * 9),
        life: 0.25 + Math.random() * 0.25,
        r: 1.2 + Math.random() * 1.4,
      });
    }
  }
  if (lander.jet !== 0) {
    scene.owe.puff += dt * (scene.calm ? 10 : 30);
    while (scene.owe.puff >= 1) {
      scene.owe.puff -= 1;
      // The jet on the far side fires: pushing right blows a puff out to the left.
      const side = -lander.jet;
      spawn(scene, {
        kind: 'puff',
        x: lander.x + (side * (30 / LANDER_UNITS) * v.size) / v.sx,
        y: lander.y + ((80 / LANDER_UNITS) * v.size) / v.sy,
        vx: lander.vx + side * (4 + Math.random() * 3),
        vy: lander.vy + (Math.random() - 0.5) * 1.5,
        life: 0.35,
        r: 2 + Math.random() * 2,
      });
    }
  }

  const keep: Part[] = [];
  for (const part of scene.parts) {
    part.age += dt;
    if (part.age >= part.life) continue;
    if (part.kind === 'dust') {
      if (mars) {
        // Thin air still slows the dust down; it drifts with the wind and settles slowly.
        const drag = Math.exp(-1.7 * dt);
        part.vx = part.vx * drag + (tune.wind ? gustAt(lander.t, lander.seed) * 0.8 * dt : 0);
        part.vy = part.vy * drag - 0.35 * dt;
      } else {
        // No air on the Moon: each grain flies in a clean arc and drops.
        part.vy -= tune.g * dt;
      }
    } else if (part.kind === 'spark') {
      part.vy -= tune.g * 1.5 * dt;
    } else if (part.kind === 'puff') {
      const drag = Math.exp(-4 * dt);
      part.vx *= drag;
      part.vy *= drag;
    }
    part.x += part.vx * dt;
    part.y += part.vy * dt;
    if ((part.kind === 'dust' || part.kind === 'spark') && part.y < groundAt(part.x, tune.padHalf) && part.vy < 0) {
      if (!mars || part.kind === 'spark') continue;
      part.y = groundAt(part.x, tune.padHalf);
      part.vy = 0;
    }
    keep.push(part);
  }
  scene.parts = keep;
}

/** The moment of touchdown: a ring of dust, and for a bad landing a bump, sparks and a tip-over. */
export function touchdownFx(scene: Scene, lander: Lander, tune: LanderTune): void {
  const landing = lander.landing;
  if (!landing) return;
  const mars = tune.site === 'mars';
  const rough = landing.result === 'hard' || landing.result === 'slide';
  const count = scene.calm ? 14 : rough ? 70 : 44;
  for (let i = 0; i < count; i++) {
    const dir = i % 2 ? -1 : 1;
    spawn(scene, {
      kind: 'dust',
      x: lander.x + (Math.random() - 0.5),
      y: lander.y + 0.2,
      vx: dir * (2 + Math.random() * (rough ? 10 : 7)),
      vy: mars ? 0.4 + Math.random() * 1.5 : 0.8 + Math.random() * 2.6,
      life: mars ? 2.4 : 2,
      r: mars ? 3 + Math.random() * 3 : 1 + Math.random() * 1.3,
    });
  }
  if (rough) {
    for (let i = 0; i < (scene.calm ? 6 : 22); i++) {
      spawn(scene, {
        kind: 'spark',
        x: lander.x,
        y: lander.y + 0.6,
        vx: (Math.random() - 0.5) * 12,
        vy: 2 + Math.random() * 6,
        life: 0.7 + Math.random() * 0.4,
        r: 1.2 + Math.random() * 1.2,
      });
    }
    const way = Math.abs(lander.vx) > 0.2 ? Math.sign(lander.vx) : Math.random() < 0.5 ? -1 : 1;
    scene.tipGoal = way * 1.25;
    scene.hop = 1;
    scene.shake = scene.calm ? 0 : 1;
  } else if (landing.result === 'missed') {
    scene.tipGoal = (lander.x > 0 ? 1 : -1) * 0.2;
  } else {
    scene.squash = 1;
  }
}

// ----- Drawing a frame ------------------------------------------------------------------------

function drawLander(ctx: CanvasRenderingContext2D, scene: Scene, x: number, y: number, lander: Lander, happy: boolean): void {
  const k = scene.view.size / LANDER_UNITS;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(scene.tip + (lander.landing ? 0 : lander.jet * 0.07));
  const squash = scene.squash > 0 ? Math.sin(scene.squash * Math.PI) * 0.09 : 0;
  ctx.scale(k * (1 + squash * 0.6), k * (1 - squash));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const ink = INK;

  // Flame under the engine.
  if (lander.burning) {
    const len = 62 * scene.flick;
    const glow = ctx.createRadialGradient(0, -14 + len * 0.35, 2, 0, -14 + len * 0.35, len * 0.9);
    glow.addColorStop(0, 'rgba(255, 210, 120, 0.55)');
    glow.addColorStop(1, 'rgba(255, 140, 60, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -14 + len * 0.35, len * 0.9, 0, Math.PI * 2);
    ctx.fill();
    const fire = ctx.createLinearGradient(0, -20, 0, -20 + len);
    fire.addColorStop(0, '#fffbe8');
    fire.addColorStop(0.25, '#ffe27a');
    fire.addColorStop(0.65, '#ff9440');
    fire.addColorStop(1, 'rgba(255, 80, 40, 0)');
    ctx.fillStyle = fire;
    ctx.beginPath();
    ctx.moveTo(-13, -20);
    ctx.quadraticCurveTo(-10, -20 + len * 0.55, 0, -20 + len);
    ctx.quadraticCurveTo(10, -20 + len * 0.55, 13, -20);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(235, 250, 255, 0.9)';
    ctx.beginPath();
    ctx.moveTo(-6, -20);
    ctx.quadraticCurveTo(-4, -20 + len * 0.3, 0, -20 + len * 0.45);
    ctx.quadraticCurveTo(4, -20 + len * 0.3, 6, -20);
    ctx.closePath();
    ctx.fill();
  }

  // Legs and feet.
  const legs = (): void => {
    ctx.beginPath();
    ctx.moveTo(-30, -40);
    ctx.lineTo(-47, -3);
    ctx.moveTo(30, -40);
    ctx.lineTo(47, -3);
    ctx.moveTo(-22, -32);
    ctx.lineTo(-40, -16);
    ctx.moveTo(22, -32);
    ctx.lineTo(40, -16);
    ctx.stroke();
  };
  ctx.strokeStyle = ink;
  ctx.lineWidth = 8;
  legs();
  ctx.strokeStyle = '#c9cfdc';
  ctx.lineWidth = 4;
  legs();
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#a3abbf';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(side * 47, -3, 11, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Engine bell.
  const bell = ctx.createLinearGradient(-15, 0, 15, 0);
  bell.addColorStop(0, '#5f6780');
  bell.addColorStop(0.45, '#c2c8d8');
  bell.addColorStop(1, '#5f6780');
  ctx.fillStyle = bell;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-10, -34);
  ctx.lineTo(10, -34);
  ctx.lineTo(15, -19);
  ctx.lineTo(-15, -19);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // The lower stage, wrapped in gold foil.
  const foil = ctx.createLinearGradient(0, -62, 0, -30);
  foil.addColorStop(0, '#f8dc86');
  foil.addColorStop(0.5, '#e4b347');
  foil.addColorStop(1, '#bf8a2a');
  ctx.fillStyle = foil;
  ctx.beginPath();
  ctx.moveTo(-36, -63);
  ctx.lineTo(36, -63);
  ctx.lineTo(41, -55);
  ctx.lineTo(41, -37);
  ctx.lineTo(36, -30);
  ctx.lineTo(-36, -30);
  ctx.lineTo(-41, -37);
  ctx.lineTo(-41, -55);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(150, 100, 30, 0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const x of [-22, -6, 10, 26]) {
    ctx.moveTo(x, -60);
    ctx.lineTo(x + 3, -33);
  }
  ctx.stroke();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-36, -63);
  ctx.lineTo(36, -63);
  ctx.lineTo(41, -55);
  ctx.lineTo(41, -37);
  ctx.lineTo(36, -30);
  ctx.lineTo(-36, -30);
  ctx.lineTo(-41, -37);
  ctx.lineTo(-41, -55);
  ctx.closePath();
  ctx.stroke();

  // Side jet pods.
  ctx.fillStyle = '#d9dce6';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.rect(side > 0 ? 24 : -33, -86, 9, 9);
    ctx.fill();
    ctx.stroke();
  }

  // The crew cabin.
  const shell = ctx.createLinearGradient(-26, 0, 26, 0);
  shell.addColorStop(0, '#ffffff');
  shell.addColorStop(0.7, '#eceef4');
  shell.addColorStop(1, '#c9cdd9');
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.moveTo(-26, -62);
  ctx.lineTo(-26, -82);
  ctx.quadraticCurveTo(-26, -98, -10, -98);
  ctx.lineTo(10, -98);
  ctx.quadraticCurveTo(26, -98, 26, -82);
  ctx.lineTo(26, -62);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Antenna.
  ctx.beginPath();
  ctx.moveTo(14, -98);
  ctx.lineTo(19, -108);
  ctx.stroke();
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.arc(19.5, -109, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Window: cool glass in flight, warm and bright after a good landing.
  const glass = ctx.createRadialGradient(-3, -81, 1, 0, -78, 11);
  if (happy) {
    glass.addColorStop(0, '#fff6d8');
    glass.addColorStop(1, '#ffb84d');
  } else {
    glass.addColorStop(0, '#d3fbff');
    glass.addColorStop(1, '#2a86b8');
  }
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.arc(0, -78, 10.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(0, -78, 6.5, 3.6, 4.6);
  ctx.stroke();
  ctx.restore();
}

/** Draw one frame: the still picture, then the pad lights, dust, the lander and its flame. */
export function paintFrame(ctx: CanvasRenderingContext2D, scene: Scene, lander: Lander, tune: LanderTune): void {
  const v = scene.view;
  const mars = tune.site === 'mars';
  ctx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0);
  ctx.clearRect(0, 0, v.w, v.h);
  ctx.save();
  if (scene.shake > 0.02) ctx.translate((Math.random() - 0.5) * 10 * scene.shake, (Math.random() - 0.5) * 8 * scene.shake);
  if (scene.bg) ctx.drawImage(scene.bg, 0, 0, v.w, v.h);

  const landing = lander.landing;
  const mid = px(v, 0);
  // A soft beam of light over the middle of the pad: aim for it.
  const beamWidth = Math.max(8, tune.bullseye * 2 * v.sx);
  const beam = ctx.createLinearGradient(0, v.gy, 0, v.gy - v.h * 0.55);
  const tint = landing ? (landing.won ? '125, 255, 176' : '255, 123, 134') : '255, 214, 120';
  const pulse = scene.calm ? 1 : 0.75 + 0.25 * Math.sin(scene.time * 3);
  beam.addColorStop(0, `rgba(${tint}, ${0.22 * pulse})`);
  beam.addColorStop(1, `rgba(${tint}, 0)`);
  ctx.fillStyle = beam;
  ctx.fillRect(mid - beamWidth / 2, v.gy - v.h * 0.55, beamWidth, v.h * 0.55);

  // Lights on the pad's posts: blinking while you fly, green after a good landing.
  const blink = scene.calm || Math.floor(scene.time * 2.2) % 2 === 0;
  const light = landing ? (landing.won ? '#7dffb0' : '#ff7b86') : blink ? '#ffcf5a' : '#6b5a2a';
  for (const x of [px(v, -tune.padHalf) + 0.5, px(v, tune.padHalf) - 0.5]) {
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.arc(x, v.gy - 8, 2.6, 0, Math.PI * 2);
    ctx.fill();
    if (landing || blink) {
      const halo = ctx.createRadialGradient(x, v.gy - 8, 0, x, v.gy - 8, 9);
      halo.addColorStop(0, light);
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, v.gy - 8, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Dust and puffs.
  for (const part of scene.parts) {
    const fade = 1 - part.age / part.life;
    const x = px(v, part.x);
    const y = py(v, part.y);
    if (part.kind === 'dust') {
      const grow = mars ? 1 + part.age * 1.6 : 1;
      ctx.fillStyle = mars ? `rgba(222, 150, 98, ${0.5 * fade})` : `rgba(222, 224, 232, ${0.85 * fade})`;
      ctx.beginPath();
      ctx.arc(x, y, part.r * grow, 0, Math.PI * 2);
      ctx.fill();
    } else if (part.kind === 'puff') {
      ctx.fillStyle = `rgba(245, 250, 255, ${0.7 * fade})`;
      ctx.beginPath();
      ctx.arc(x, y, part.r * (1 + part.age * 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The lander's shadow, sharper as it gets close to the ground.
  const ground = groundAt(lander.x, tune.padHalf);
  const height = Math.max(0, lander.y - ground);
  const near = Math.max(0, 1 - height / 60);
  if (near > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${0.35 * near})`;
    ctx.beginPath();
    ctx.ellipse(px(v, lander.x), py(v, ground) + 1.5, v.size * (0.25 + 0.3 * near), 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const hop = scene.hop > 0 ? Math.sin((1 - scene.hop) * Math.PI) * 1.4 : 0;
  const landerX = px(v, lander.x);
  const landerY = py(v, lander.y + hop);
  drawLander(ctx, scene, landerX, landerY, lander, !!landing?.won);

  // Sparks of hot gas and from a hard bump, glowing.
  ctx.globalCompositeOperation = 'lighter';
  for (const part of scene.parts) {
    if (part.kind !== 'ember' && part.kind !== 'spark') continue;
    const fade = 1 - part.age / part.life;
    ctx.fillStyle = part.kind === 'ember' ? `rgba(255, 190, 110, ${fade})` : `rgba(255, 220, 140, ${fade})`;
    ctx.beginPath();
    ctx.arc(px(v, part.x), py(v, part.y), part.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Above the top of the view: a little arrow shows where the lander is.
  if (landerY - v.size < 0) {
    ctx.fillStyle = '#ffd166';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(landerX, 4);
    ctx.lineTo(landerX - 8, 16);
    ctx.lineTo(landerX + 8, 16);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
