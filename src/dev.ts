// Development helpers. Loaded only by the dev server (see main.ts): they let a test
// jump straight to a step of the game from the browser console, as `window.fo`.
import * as director from './game/director';
import * as store from './game/store';
import type { SetupChoice } from './game/store';
import { EVENTS } from './sim/events';
import { addMaterials, buildingDef, ensureOutpost } from './sim/outpost';
import type { BuildingId } from './sim/outpost';
import type { SiteId } from './sim/types';
import { lumiProbeRead } from './world/lumiprobe';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Start a mission and stop at the power plan of week one. */
async function toPlan(site: SiteId = 'mars', extra: Partial<SetupChoice> = {}): Promise<string> {
  store.profile.value = { ...store.profile.value, introSeen: ['mars', 'moon'] };
  await director.startMission({
    site,
    difficulty: 'cadet',
    weeks: 6,
    sunMode: 'featured',
    windowId: 'quiet2019',
    tutorial: false,
    ...extra,
  });
  await sleep(1200);
  director.continueBriefing();
  await sleep(250);
  const state = director.getState();
  if (store.step.value === 'event' && state?.now.eventId) {
    director.chooseEvent(EVENTS[state.now.eventId].options[0].id);
    await sleep(200);
    director.confirmEvent();
    await sleep(200);
  }
  return store.step.value;
}

/** Start a mission and step outside. */
async function toWalk(site: SiteId = 'mars', extra: Partial<SetupChoice> = {}): Promise<string> {
  await toPlan(site, extra);
  director.useSafePlan();
  director.confirmPlan();
  await sleep(500);
  if (store.step.value === 'evaIntro') director.beginWalk();
  await sleep(1200);
  return store.step.value;
}

/** Freeze the world and put the camera where a test wants it. */
async function look(x: number, z: number, distance: number, yaw: number, pitch: number, y = 0.6): Promise<void> {
  const world = director.getWorld();
  if (!world) return;
  world.paused = true;
  const rig = world.rig;
  rig.minDistance = 0.5;
  rig.maxDistance = 400;
  rig.minPitch = -0.2;
  rig.maxPitch = 1.55;
  rig.follow = () => {};
  rig.avoidBlockers = false;
  // `y` is measured from the ground under the point.
  const target = rig.target.clone().set(x, world.terrain.info.height(x, z) + y, z);
  rig.setSpot({ target, distance, yaw, pitch }, true);
  rig.idle = -1e6;
  await sleep(700);
}

/** On a walk: visit two discoveries and the two best samples, then come back. */
async function collect(): Promise<void> {
  const world = director.getWorld();
  if (!world) return;
  const points = world.eva.mapPoints();
  const finds = points.filter((point) => point.kind === 'find' && !point.done).slice(0, 2);
  const samples = points
    .filter((point) => point.kind === 'sample' && !point.done)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2);
  for (const point of [...finds, ...samples]) {
    teleport(point.x, point.z);
    await sleep(point.kind === 'find' ? 1500 : 1100);
  }
  director.recallWalk();
}

/**
 * Play a whole mission with Lumi's plan plus one more cell for the lab when there
 * is one to spare, and stop at the mission review. With `walks`, the cadet goes
 * outside every week it may and collects things; otherwise walks are skipped.
 */
async function toDebrief(site: SiteId = 'mars', extra: Partial<SetupChoice> = {}, walks = false): Promise<string> {
  await director.startMission({
    site,
    difficulty: 'cadet',
    weeks: 6,
    sunMode: 'featured',
    windowId: 'may2024',
    tutorial: false,
    ...extra,
  });
  await sleep(800);
  for (let guard = 0; guard < 400 && store.screen.value === 'game'; guard++) {
    const state = director.getState();
    switch (store.step.value) {
      case 'briefing':
        director.continueBriefing();
        break;
      case 'event':
        if (state?.now.eventId) director.chooseEvent(state.now.advice ?? EVENTS[state.now.eventId].options[0].id);
        break;
      case 'eventResult':
        director.confirmEvent();
        break;
      case 'plan':
        director.useSafePlan();
        director.changeAlloc('lab', 1);
        director.confirmPlan();
        break;
      case 'evaIntro':
        if (walks) {
          director.beginWalk();
          await sleep(1200);
          await collect();
        } else {
          director.skipWalk();
        }
        break;
      case 'evaResult':
        director.finishWalk();
        break;
      case 'report':
        director.goNextWeek();
        break;
      default:
        break; // the night runs by itself
    }
    await sleep(350);
  }
  return store.screen.value;
}

/** Give the outpost materials, and finish buildings straight away, for a test. */
function give(regolith = 20, metal = 20, built: BuildingId[] = []): void {
  const state = director.getState();
  if (!state) return;
  ensureOutpost(state);
  addMaterials(state, { regolith, metal });
  for (const id of built) {
    const site = state.buildings!.find((item) => item.id === id);
    if (site) {
      site.progress = buildingDef(id).work;
      site.done = true;
    } else state.buildings!.push({ id, progress: buildingDef(id).work, done: true });
  }
  director.devRefresh();
}

/** Move the walking cadet to a point (the camera follows). */
function teleport(x: number, z: number): void {
  const world = director.getWorld();
  if (!world) return;
  world.eva.position.set(x, world.terrain.info.height(x, z), z);
}

/** Read (and with `reset` clear) the counters of frames where Lumi touched a solid thing. See world/lumiprobe.ts. */
function lumiProbe(reset = false): unknown {
  return lumiProbeRead(reset);
}

(window as unknown as { fo: unknown }).fo = { director, store, toPlan, toWalk, toDebrief, look, teleport, sleep, give, lumiProbe };
