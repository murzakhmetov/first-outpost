// Graphics lab (development only; main.ts imports it only when import.meta.env.DEV).
// `window.gfxlab` lets an agent or a developer measure graphics the same way every time:
//   await gfxlab.tier('ultra'); await gfxlab.scene('mars-overview');
//   await gfxlab.shot('name');           // 1920x1080 JPEG (q 0.95) saved by scripts/dev/shot-saver.mjs
//   gfxlab.frameMs();                    // {median, min, max, drawCalls, triangles}
//   await gfxlab.ab('name', 'flagId');   // name_off and name_on of the SAME frame
//   gfxlab.diff('flagId');               // {different, maxDelta}: pixels that change with the flag, no files
//   gfxlab.shot('n', 1920, 1080, {png: true}) for an exact PNG
// Details: docs/GRAPHICS.md, "How to measure".
import * as THREE from 'three';
import * as director from '../game/director';
import * as store from '../game/store';
import { EVENTS } from '../sim/events';
import { addMaterials, buildingDef, ensureOutpost } from '../sim/outpost';
import type { BuildingId } from '../sim/outpost';
import type { SetupChoice } from '../game/store';
import type { SiteId } from '../sim/types';
import { devFlags, knownFlags } from '../world/devflags';
import { TIERS } from '../world/quality';
import type { QualityTier } from '../world/quality';
import type { Engine } from '../world/engine';
import type { World } from '../world/world';

const SAVER = 'http://localhost:5199';
/** The game clock is frozen at this value for every picture, so clouds and the title sway match. */
const FIXED_TIME = 100;
const MISSION_SEED = 20240511;

export const SCENES = ['mars-overview', 'mars-lowsun', 'mars-walk', 'moon-overview', 'moon-walk', 'title', 'interior'] as const;
export type SceneName = (typeof SCENES)[number];

/** The private parts of the engine that the lab needs (it sizes the picture itself). */
interface EngineInternals {
  width: number;
  height: number;
  needsResize: boolean;
  dynamicScale: number;
  updateFov(): void;
  applyShift(): void;
  resize(): void;
}

/** Private parts of the world that the lab reads. */
interface WorldInternals {
  rebuildWaiting: boolean;
  waveTimer: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function world(): World {
  const w = director.getWorld();
  if (!w) throw new Error('gfxlab: the game is not loaded yet');
  return w;
}

const internals = (engine: Engine): EngineInternals => engine as unknown as EngineInternals;

/** A small seeded random generator: blinks and puffs then match from one run to the next. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const realRandom = Math.random;

let lastScene: SceneName | null = null;
let busy = false;

function stepFrames(engine: Engine, frames: number, dt = 1 / 60): void {
  for (let i = 0; i < frames; i++) engine.step(dt);
}

/** Mission set-up helpers (the same route as src/dev.ts, but with a fixed seed). */
async function startMission(site: SiteId): Promise<void> {
  store.profile.value = { ...store.profile.value, introSeen: ['mars', 'moon'] };
  const choice: SetupChoice = { site, difficulty: 'cadet', weeks: 6, sunMode: 'featured', windowId: 'quiet2019', tutorial: false };
  await director.startMission(choice, { seed: MISSION_SEED, startDate: director.startDateFor(choice) });
  await sleep(300);
  director.continueBriefing();
  await sleep(150);
  const state = director.getState();
  if (store.step.value === 'event' && state?.now.eventId) {
    director.chooseEvent(EVENTS[state.now.eventId].options[0].id);
    await sleep(100);
    director.confirmEvent();
    await sleep(100);
  }
}

function giveBuilt(ids: BuildingId[]): void {
  const state = director.getState();
  if (!state) return;
  ensureOutpost(state);
  addMaterials(state, { regolith: 20, metal: 20 });
  for (const id of ids) {
    const site = state.buildings!.find((item) => item.id === id);
    if (site) {
      site.progress = buildingDef(id).work;
      site.done = true;
    } else state.buildings!.push({ id, progress: buildingDef(id).work, done: true });
  }
  director.devRefresh();
}

/** Stop the real-time loop: from now on only the lab draws frames, so nothing else moves the scene. */
function takeOver(): Engine {
  const engine = world().engine;
  engine.stop();
  Math.random = seeded(MISSION_SEED);
  return engine;
}

/** Put the game in a fixed, reproducible view. Time is frozen, the clock is fixed, the random generator is seeded. */
async function scene(name: SceneName): Promise<string> {
  if (!SCENES.includes(name)) throw new Error(`gfxlab: unknown scene "${name}". One of: ${SCENES.join(', ')}`);
  if (busy) throw new Error('gfxlab: another scene() is still running');
  busy = true;
  try {
    const engine = takeOver();
    const w = world();
    const wi = w as unknown as WorldInternals;
    store.updateSettings({ firstPerson: false });
    // Leave anything left from an earlier scene: a room, a walk, a film.
    if (store.room.value !== null) w.leaveRoom();
    store.room.value = null;
    store.panel.value = 'none';
    w.paused = false;
    director.goTitle();
    stepFrames(engine, 3);
    if (name === 'title') {
      // goTitle() already set the Mars sunset clock (0.742) and the title camera.
      if (w.site !== 'mars') director.previewSite('mars');
      director.goTitle();
      wi.waveTimer = 1e9;
      w.astronaut.play('none');
    } else {
      const site: SiteId = name.startsWith('moon') ? 'moon' : 'mars';
      await startMission(site);
      // A quality change that waited for the end of a walk happens now.
      stepFrames(engine, 4);
      if (name === 'interior') {
        giveBuilt(['workshop']);
        director.enterRoom('workshop');
        await sleep(900);
      } else if (name.endsWith('walk')) {
        director.useSafePlan();
        director.confirmPlan();
        await sleep(300);
        if (store.step.value === 'evaIntro') director.beginWalk();
        await sleep(300);
      } else {
        w.lookAt('overview', true);
        w.setClock(name === 'mars-lowsun' ? 0.7 : site === 'mars' ? 0.4 : 0.12);
      }
    }
    w.rig.autoRotate = 0;
    w.rig.idle = -1e6;
    stepFrames(engine, 45);
    w.paused = true;
    engine.time = FIXED_TIME;
    engine.step(0);
    lastScene = name;
    return `${name} on ${engine.quality.tier}`;
  } finally {
    busy = false;
  }
}

/** Switch the quality tier and wait until it is applied; the current scene is set up again. */
async function tier(name: QualityTier): Promise<string> {
  if (!TIERS.includes(name)) throw new Error(`gfxlab: unknown tier "${name}". One of: ${TIERS.join(', ')}`);
  const w = world();
  store.updateSettings({ quality: name });
  for (let i = 0; i < 400 && w.engine.quality.tier !== name; i++) await sleep(50);
  if (w.engine.quality.tier !== name) throw new Error(`gfxlab: tier ${name} was not applied in 20 s`);
  w.engine.stop();
  stepFrames(w.engine, 3);
  if (lastScene) await scene(lastScene);
  return `${name} (${lastScene ?? 'no scene yet'})`;
}

/** Run `fn` with the picture sized w x h pixels (pixel ratio 1), then restore the page size. */
function withSize<T>(width: number, height: number, fn: (engine: Engine) => T): T {
  const w = world();
  const engine = w.engine;
  const e = internals(engine);
  engine.stop();
  const keep = { width: e.width, height: e.height };
  const scale = engine.quality.renderScale;
  e.dynamicScale = 1;
  engine.renderer.setPixelRatio(1);
  engine.renderer.setSize(width, height, false);
  engine.post.resize(width * scale, height * scale);
  e.width = width;
  e.height = height;
  engine.camera.aspect = width / height;
  e.updateFov();
  e.applyShift();
  e.needsResize = false;
  try {
    return fn(engine);
  } finally {
    e.width = keep.width;
    e.height = keep.height;
    e.needsResize = true;
    e.resize();
  }
}

/** Draw the frozen frame once (same time every call) and read the screen pixels. Must run inside withSize. */
function grab(engine: Engine, width: number, height: number): ImageData {
  engine.time = FIXED_TIME;
  engine.step(0);
  const gl = engine.renderer.getContext();
  engine.renderer.setRenderTarget(null);
  const raw = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  const image = new ImageData(width, height);
  const row = width * 4;
  for (let y = 0; y < height; y++) image.data.set(raw.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
  return image;
}

interface ShotOptions {
  /** Save a lossless PNG (only when exact pixels matter). Default: JPEG, quality 0.95. */
  png?: boolean;
  quality?: number;
}

function encode(image: ImageData, options: ShotOptions = {}): Promise<Blob> {
  const sheet = new OffscreenCanvas(image.width, image.height);
  sheet.getContext('2d')!.putImageData(image, 0, 0);
  return options.png ? sheet.convertToBlob({ type: 'image/png' }) : sheet.convertToBlob({ type: 'image/jpeg', quality: options.quality ?? 0.95 });
}

async function save(name: string, blob: Blob): Promise<string> {
  const ext = blob.type === 'image/png' ? 'png' : 'jpg';
  try {
    const response = await fetch(`${SAVER}/save?name=${encodeURIComponent(name)}&ext=${ext}`, { method: 'POST', body: blob });
    const text = await response.text();
    return response.ok ? text : `error: saver answered ${response.status} ${text}`;
  } catch (error) {
    return `error: the shot saver is not reachable at ${SAVER} (node scripts/dev/shot-saver.mjs): ${String(error)}`;
  }
}

async function shot(name: string, width = 1920, height = 1080, options: ShotOptions = {}): Promise<string> {
  const image = withSize(width, height, (engine) => grab(engine, width, height));
  return save(name, await encode(image, options));
}

/** Render the frame with the flag off and on; returns both pictures. */
function renderPair(flagId: string, width: number, height: number): { off: ImageData; on: ImageData } {
  const before = devFlags[flagId];
  try {
    return withSize(width, height, (engine) => {
      devFlags[flagId] = false;
      const off = grab(engine, width, height);
      devFlags[flagId] = true;
      const on = grab(engine, width, height);
      return { off, on };
    });
  } finally {
    if (before === undefined) delete devFlags[flagId];
    else devFlags[flagId] = before;
  }
}

/** The same frame with the flag off and on: `<name>_off` and `<name>_on` (JPEG, or PNG with {png: true}). */
async function ab(name: string, flagId: string, width = 1920, height = 1080, options: ShotOptions = {}): Promise<string[]> {
  const pair = renderPair(flagId, width, height);
  return [await save(`${name}_off`, await encode(pair.off, options)), await save(`${name}_on`, await encode(pair.on, options))];
}

/**
 * Orbit the camera in small yaw steps and compare each frame with the one before, with the flag off and on.
 * Extra frame-to-frame change with the flag on (more pixels, or bigger changes) means shadow swim or pop.
 * Returns, per step, the changed-pixel count of both runs and how many pixels changed by more than 24 levels.
 */
function sweep(flagId: string, steps = 12, dyaw = 0.004, axis: 'yaw' | 'distance' = 'yaw', width = 1920, height = 1080): { off: number[]; on: number[]; offBig: number[]; onBig: number[]; range: number[] } {
  const w = world();
  const rig = w.rig as unknown as { yaw: number; goalYaw: number; distance: number; goalDistance: number };
  const before = devFlags[flagId];
  const startYaw = rig.yaw;
  const startDistance = rig.distance;
  const result = { off: [] as number[], on: [] as number[], offBig: [] as number[], onBig: [] as number[], range: [] as number[] };
  try {
    withSize(width, height, (engine) => {
      for (const on of [false, true]) {
        devFlags[flagId] = on;
        let last: ImageData | null = null;
        for (let i = 0; i <= steps; i++) {
          if (axis === 'yaw') rig.yaw = rig.goalYaw = startYaw + i * dyaw;
          else rig.distance = rig.goalDistance = startDistance + i * dyaw;
          const image = grab(engine, width, height);
          if (last) {
            let changed = 0;
            let big = 0;
            for (let p = 0; p < image.data.length; p += 4) {
              const d = Math.max(Math.abs(image.data[p] - last.data[p]), Math.abs(image.data[p + 1] - last.data[p + 1]), Math.abs(image.data[p + 2] - last.data[p + 2]));
              if (d > 0) changed++;
              if (d > 24) big++;
            }
            (on ? result.on : result.off).push(changed);
            (on ? result.onBig : result.offBig).push(big);
          }
          if (on) result.range.push((w.daylight as unknown as { shadowRange: number }).shadowRange);
          last = image;
        }
      }
    });
  } finally {
    rig.yaw = rig.goalYaw = startYaw;
    rig.distance = rig.goalDistance = startDistance;
    if (before === undefined) delete devFlags[flagId];
    else devFlags[flagId] = before;
  }
  return result;
}

/** Count the pixels that differ between the frame with the flag off and on. No files are saved. */
function diff(flagId: string, width = 1920, height = 1080): { different: number; maxDelta: number; total: number } {
  const { off, on } = renderPair(flagId, width, height);
  let different = 0;
  let maxDelta = 0;
  for (let i = 0; i < off.data.length; i += 4) {
    const d = Math.max(Math.abs(off.data[i] - on.data[i]), Math.abs(off.data[i + 1] - on.data[i + 1]), Math.abs(off.data[i + 2] - on.data[i + 2]));
    if (d > 0) {
      different++;
      if (d > maxDelta) maxDelta = d;
    }
  }
  return { different, maxDelta, total: width * height };
}

interface FrameStats {
  median: number;
  min: number;
  max: number;
  drawCalls: number;
  triangles: number;
  batches: number[];
  size: string;
  tier: string;
  scene: string | null;
}

/** Draw `frames` frames per batch, wait for the GPU after each batch, and report ms per frame. */
function frameMs(frames = 60, batches = 7, width = 1920, height = 1080): FrameStats {
  return withSize(width, height, (engine) => {
    const gl = engine.renderer.getContext();
    const pixel = new Uint8Array(4);
    const sync = (): void => {
      engine.renderer.setRenderTarget(null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    };
    const keepTime = engine.time;
    // Warm-up for at least 2.5 s: shaders, targets, and the GPU clock that ramps up under load.
    for (const start = performance.now(); performance.now() - start < 2500; ) {
      stepFrames(engine, 10);
      sync();
    }
    const times: number[] = [];
    for (let b = 0; b < batches; b++) {
      const t0 = performance.now();
      stepFrames(engine, frames);
      sync();
      times.push((performance.now() - t0) / frames);
    }
    const info = engine.renderer.info.render;
    engine.time = keepTime;
    const sorted = [...times].sort((a, b) => a - b);
    const round = (n: number): number => Math.round(n * 100) / 100;
    return {
      median: round(sorted[Math.floor(sorted.length / 2)]),
      min: round(sorted[0]),
      max: round(sorted[sorted.length - 1]),
      drawCalls: info.calls,
      triangles: info.triangles,
      batches: times.map(round),
      size: `${width}x${height}`,
      tier: engine.quality.tier,
      scene: lastScene,
    };
  });
}

/** Give the game its own loop and random generator back. */
function live(): void {
  Math.random = realRandom;
  const w = world();
  w.paused = false;
  w.engine.start();
}

const gfxlab = {
  shot,
  frameMs,
  ab,
  diff,
  sweep,
  world,
  scene,
  tier,
  live,
  scenes: (): readonly string[] => SCENES,
  set(id: string, on: boolean): void {
    devFlags[id] = on;
  },
  flags(): Record<string, boolean> {
    const all: Record<string, boolean> = {};
    for (const id of knownFlags) all[id] = devFlags[id] !== false;
    for (const id of Object.keys(devFlags)) all[id] = devFlags[id] !== false;
    return all;
  },
  three: THREE.REVISION,
};

(window as unknown as { gfxlab: typeof gfxlab }).gfxlab = gfxlab;
