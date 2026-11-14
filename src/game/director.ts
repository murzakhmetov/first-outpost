/**
 * The director runs the show: it moves the game from step to step,
 * keeps the 3D world, the sounds and the screen in step with the mission,
 * and decides what Lumi says.
 *
 * Week order:  forecast -> card -> power plan -> walk outside -> night -> report
 */
import { effect } from '@preact/signals';
import { lang, t } from '../i18n';
import { buildInsights, earnedBadges } from '../sim/debrief';
import type { Insight } from '../sim/debrief';
import { addDays, moonGeometry } from '../sim/ephemeris';
import { EVENTS } from '../sim/events';
import {
  applyEva,
  askEarth,
  chooseOption,
  computeWeek,
  createMission,
  currentEnv,
  earthAnswerFor,
  evaStormChance,
  nextWeek,
  resolveWeek,
  setAlloc,
  suggestAlloc,
} from '../sim/mission';
import { FINDS, FIND_SCIENCE, foundIn, recordFind } from '../sim/finds';
import {
  BUILDINGS,
  addDecor,
  buildingDef,
  addMaterials,
  buildBlock,
  claimRoom,
  craft,
  craftBlock,
  ensureOutpost,
  isBuilt,
  isCreative,
  placeBuilding,
  removeBuilding,
  removeDecor,
  robotIdle,
  roomDef,
  roomOpen,
  roomPlayed,
  startBuilding,
} from '../sim/outpost';
import type { BuildingId, DecorId, GameId, RoomId, ToolId } from '../sim/outpost';
import { PRINT } from '../sim/print';
import { FEATURED_WINDOWS } from '../sim/sites';
import type { ChoiceResult } from '../sim/mission';
import type { CoopStage } from '../sim/coop';
import type { EvaResult, MissionConfig, MissionState, ModuleId, OptionId, WeekEnv, WeekRecord } from '../sim/types';
import { MAX_LEVEL } from '../sim/types';
import { FARM, LAB } from '../world/base';
import { LANDER } from '../world/props';
import type { SpotId } from '../world/base';
import { doorOf } from '../world/annex';
import { propRadius } from '../world/interior';
import type { EvaEvent } from '../world/eva';
import type { RoomLook, Station } from '../world/interior';
import type { CineShot } from '../world/world';
import { loadModels, modelDetail, onLateModel } from '../world/models';
import { QUALITY, guessTier, shiftTier } from '../world/quality';
import { World } from '../world/world';
import { audio, stopSpeaking } from './audio';
import { forgetSpoken } from './voice';
import { SITE_CARDS, STARTER_CARDS, WINDOW_CARDS, cardById, unlockCards } from './codex';
import { FILMS, seenKey } from './films';
import type { EventFilmId, FilmId, TaskId } from './films';
import { dataInfo, liveStartDate, loadData, refreshLive, simData } from './data';
import {
  announce,
  pickup,
  autoTier,
  clearMissionSave,
  earthAnswer,
  evaHud,
  evaResult,
  eventResult,
  fading,
  fps,
  hush,
  lastRecord,
  loadMissionSave,
  loading,
  lumiLine,
  mission,
  newBadges,
  newRank,
  newSuits,
  newCards,
  notify,
  interiorHud,
  outpostTab,
  panel,
  placing,
  printing,
  cutscene,
  discovery,
  film,
  profile,
  room,
  roomGame,
  roomWon,
  saveMission,
  say,
  screen,
  settings,
  step,
  updateProfile,
  updateSettings,
} from './store';
import { newlyUnlockedSuits, rankOf } from './rewards';
import type { Panel, SetupChoice, Step } from './store';

let world: World | null = null;
let state: MissionState | null = null;
let planTouched = false;
let cardsThisMission: string[] = [];
let slowSeconds = 0;
let stepsThisWalk = 0;
let saidOnce = new Set<string>();
/** Samples picked up quickly one after another on a walk (only for a cheer: it changes no score). */
let sampleStreak = 0;
let lastSampleAt = 0;

/**
 * The co-op seam ("One base together", src/net/coop.ts, joined to the session by src/net/coopglue.ts).
 * While a port is set, every mutating export below hands its call to the port (`take`): a guest sends an intent, the
 * host applies it through the sim, and the local code does not run. A port takes every call (it never lets one fall
 * through to the solo code). With no port (solo play and the "each their own base" crew mode) nothing changes.
 *
 * Two layers (docs/MULTIPLAYER.md): the STAGE belongs to the host and arrives with `coopAdopt`; the ACTIVITY (a film,
 * a room, a room game, a print, the own walk) is local. A stage that arrives during an activity waits in `pending`
 * and is shown when the activity closes (`flushStage`). The night is the exception: it throws every activity out.
 */
export type CoopCall =
  | 'orderBuilding'
  | 'finishRoomGame'
  | 'finishPrint'
  | 'continueBriefing'
  | 'chooseEvent'
  | 'askMissionControl'
  | 'confirmEvent'
  | 'changeAlloc'
  | 'useSafePlan'
  | 'confirmPlan'
  | 'beginWalk'
  | 'skipWalk'
  | 'goNextWeek'
  | 'walkEnd'
  | 'find';

export interface CoopPort {
  /**
   * Handle a call. Arguments: changeAlloc [the new absolute Alloc], chooseEvent [option], finishPrint [tool, neat],
   * finishRoomGame [room, game, won], orderBuilding [building], find [index], walkEnd [result, reason].
   */
  take(call: CoopCall, args: readonly unknown[]): boolean;
  /** The director is leaving the mission: end the session. Safe to call twice. */
  close?(): void;
}

/** What the host says besides the stage: the walk's phase and this seat's choice, and the card's result. */
export interface CoopView {
  /** The result of the event card, while the stage is eventResult. */
  choice?: ChoiceResult | null;
  /** The walk stage: the walkers are outside. */
  outside?: boolean;
  /** The walk stage: this seat walks (true), stays (false) or has not said (undefined). */
  goes?: boolean;
}

let coop: CoopPort | null = null;
/** The stage, week and walk phase the screen shows for a co-op mirror (null: nothing shown yet). */
let shown: { stage: CoopStage; week: number; key: string } | null = null;
/** The newest stage the host reported. */
let latest: { stage: CoopStage; view: CoopView } | null = null;
/** A stage that arrived during an activity and is shown when it closes. Kept after a detach, until it is shown. */
let pending: { stage: CoopStage; view: CoopView } | null = null;
/** This seat's own finished walk, kept until the host's merged walk has been taken (see coopDetach). */
let ownWalk: { week: number; result: EvaResult } | null = null;
/** The week whose walk this seat has started (it never starts a second one). */
let myWalkWeek = 0;
/** Counts the co-op nights, so a night that was overtaken by a newer stage does not finish. */
let nightToken = 0;

const viewKey = (stage: CoopStage, week: number, view: CoopView): string =>
  `${stage}:${week}:${view.outside ? 1 : 0}:${view.goes === undefined ? '-' : view.goes ? 1 : 0}`;

/** Connect or disconnect the co-op session. Null = solo behaviour. */
export function setCoopPort(port: CoopPort | null): void {
  coop = port;
  latest = null;
  pending = null;
  ownWalk = null;
  myWalkWeek = 0;
  nightToken++;
  // A mission that has just started already shows its first briefing: the first state must not start the week again.
  shown =
    port && state && screen.value === 'game' && step.value === 'briefing'
      ? { stage: 'briefing', week: state.week, key: viewKey('briefing', state.week, {}) }
      : null;
}

/** Is a film, a room, a room game, a print or the own walk open? (The host's stage then waits.) */
function activityOpen(): boolean {
  return film.value !== null || room.value !== null || doorBusy || roomGame.value !== null || printing.value !== null || step.value === 'eva';
}

/** The week's record, once it is in the history. */
function recordOf(s: MissionState): WeekRecord | undefined {
  return s.history.find((item) => item.week === s.week);
}

/** The week's work is done: the host has worked the night out and the report (or the end) is there. */
const isNight = (stage: CoopStage): boolean => stage === 'report' || stage === 'end';

/**
 * Co-op: take the host's shared state and show it. `stage` is the host's stage. The state replaces ours at once (the
 * host decides). The screen follows when the stage, the week or the walk's phase changed; a stage that arrives during
 * an activity waits for it to close. Does nothing without a port.
 */
export function coopAdopt(next: MissionState, stage: CoopStage, view: CoopView = {}): void {
  if (!coop || !world) return;
  const first = state === null;
  state = next;
  if (first) ensureOutpost(state);
  latest = { stage, view };
  const key = viewKey(stage, next.week, view);
  if (shown !== null && shown.key === key) {
    refreshShown(stage);
    return;
  }
  // The report needs the week's record, which may come after the state (the night's record is its own message).
  if (isNight(stage) && !recordOf(next)) {
    publish();
    return;
  }
  if (activityOpen() && !isNight(stage)) {
    pending = { stage, view };
    publish();
    return;
  }
  showStage(stage, view);
}

/** The same stage again: only what the other children changed is shown. */
function refreshShown(stage: CoopStage): void {
  // The mission is over: the debrief is on screen and its save is gone; the host's heartbeats change nothing now.
  if (!state || stage === 'end') return;
  if (stage === 'event' && state.now.askedEarth && !earthAnswer.value) earthAnswer.value = earthAnswerFor(state);
  if (room.value !== null && world) world.interior.setDone(roomLook(room.value).done);
  publish();
}

/** Show the stage now (no activity is open, or the night threw them out). */
function showStage(stage: CoopStage, view: CoopView): void {
  if (!world || !state) return;
  const s = state;
  const before = shown;
  shown = { stage, week: s.week, key: viewKey(stage, s.week, view) };
  pending = null;
  nightToken++; // a night that is still playing is over: the host has moved on
  if (!isNight(stage)) {
    // Leaving the event card: what the card put on screen goes, as solo's "Continue" does.
    const cardStages: CoopStage[] = ['event', 'eventResult'];
    if (before && cardStages.includes(before.stage) && !cardStages.includes(stage)) {
      eventResult.value = null;
      earthAnswer.value = null;
      world.setWeather({ storm: 0 });
    }
    presentStage(stage, view);
    return;
  }
  forceIndoors();
  const record = recordOf(s);
  if (!record) return;
  const workedToday = before !== null && before.week === s.week && !isNight(before.stage);
  if (workedToday) {
    coopNight(s, record);
  } else {
    // Joined late or came back: no night to play, only the result.
    nightResolve(s, record, true);
    nightEnd(s, record);
  }
}

/**
 * Show a stage the host is in: the screen, the camera and Lumi, from the state alone. Modelled on resumeSaved, but
 * it also knows the walk. Needs `state` to be set.
 */
function presentStage(stage: CoopStage, view: CoopView): void {
  if (!world || !state) return;
  const s = state;
  switch (stage) {
    case 'briefing':
      startWeek();
      break;
    case 'event':
      enterEvent();
      break;
    case 'eventResult': {
      const choice = view.choice ?? null;
      if (!choice) {
        goPlan();
        break;
      }
      unlockMission([EVENTS[choice.eventId].codex]);
      audio.play('confirm');
      eventResult.value = choice;
      step.value = 'eventResult';
      world.setMood(choice.optionId === choice.advice ? 'happy' : 'think');
      hush();
      publish();
      break;
    }
    case 'plan':
      goPlan();
      break;
    case 'walk':
      if (coop && view.outside && view.goes) coopStartWalk();
      else if (step.value === 'evaIntro') publish();
      else enterEvaIntro();
      break;
    case 'night':
      void nightBegin(s);
      break;
    case 'report':
    case 'end': {
      const record = recordOf(s);
      if (!record) break;
      nightResolve(s, record, true);
      nightEnd(s, record);
      break;
    }
  }
}

/** This seat's own walk starts: the host said the walkers are outside, and this seat walks. */
function coopStartWalk(): void {
  if (!state || !world || myWalkWeek === state.week) return;
  myWalkWeek = state.week;
  startOwnWalk();
}

/**
 * The night (shown on every device; the host has already worked the week out). Everything that was open is closed, the
 * Sun crosses the sky for a moment, then the report. It never waits for the sky clock: a menu stops that clock on the
 * host's device, and the others must not wait for it. A tap hurries it (skipNight).
 */
function coopNight(s: MissionState, record: WeekRecord): void {
  const token = ++nightToken;
  const { seconds } = nightBegin(s);
  void Promise.race([wait(seconds), new Promise<void>((resolve) => (hurryNight = resolve))]).then(() => {
    hurryNight = null;
    if (token !== nightToken || state !== s) return; // a newer stage came, or the player left the mission
    nightResolve(s, record, true);
    nightEnd(s, record);
  });
}

/** The night throws everything out: the film, the room, the room game (unpaid), the print and the walk still running. */
function forceIndoors(): void {
  if (!world) return;
  stopPlacement();
  stopFilm();
  evaResult.value = null;
  printing.value = null;
  roomGame.value = null;
  roomWon.value = null;
  roomWinPaid = false;
  if (room.value !== null) {
    world.leaveRoom();
    room.value = null;
    interiorHud.value = null;
    doorBusy = false;
    fading.value = false;
  }
  if (step.value === 'eva' || world.eva.active) {
    world.eva.abort();
    audio.setAlarm(false);
    audio.setMotor(0, false);
    evaHud.value = null;
    world.setWeather({ storm: 0 });
  }
  hush();
  setAmbience();
}

/** An activity closed: show the stage that waited for it. Does nothing when no stage waits. */
function flushStage(): void {
  if (!pending || activityOpen()) return;
  const next = pending;
  pending = null;
  showStage(next.stage, next.view);
}

/** A button of a stage-bound call counts only while the screen shows the stage the host is in. */
function coopSynced(): boolean {
  return !!coop && !!state && shown !== null && latest !== null && shown.stage === latest.stage && shown.week === state.week;
}

/** Co-op: hand a stage-bound button to the port (with the click). Nothing is sent from a screen that is out of date. */
function coopSend(call: CoopCall, args: readonly unknown[] = []): void {
  if (!coop || !coopSynced()) return;
  audio.play('click');
  coop.take(call, args);
}

/**
 * Co-op ended for this device (the session is over: the host left, this seat was let go, the room closed, or the
 * child chose to play on alone). The mission stays as it is and goes on in this device's own base, like the "each
 * their own base" mode. A walk that was finished but not yet taken into the mission is applied now.
 */
export function coopDetach(): void {
  const port = coop;
  if (!port) return;
  coop = null;
  port.close?.();
  latest = null;
  shown = null;
  if (!state) return;
  const walk = ownWalk;
  ownWalk = null;
  if (walk && walk.week === state.week && !state.now.eva) applyEva(state, plain(walk.result));
  if (activityOpen()) {
    // The stage that waits is shown when the activity closes.
    publish();
    return;
  }
  const next = pending;
  pending = null;
  if (next && !isNight(next.stage)) presentStage(next.stage, next.view);
  else publish();
}

/** A walk result without the co-op's sample slots (a solo walk is saved as it always was). */
function plain(result: EvaResult): EvaResult {
  const { picked: _picked, ...rest } = result as EvaResult & { picked?: number[] };
  return rest;
}

/** Leave co-op without a trace (the mission is over or abandoned). */
function dropCoop(): void {
  const port = coop;
  coop = null;
  latest = null;
  shown = null;
  pending = null;
  ownWalk = null;
  nightToken++;
  port?.close?.();
}

const wait = (seconds: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, seconds * 1000));

export function getWorld(): World | null {
  return world;
}

export function getState(): MissionState | null {
  return state;
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

export async function boot(canvas: HTMLCanvasElement, onProgress?: (share: number) => void): Promise<void> {
  const chosen = settings.value.quality;
  // "Auto" always means the level guessed for this device, even if a fixed level was chosen before.
  autoTier.value = guessTier();
  const tier = chosen === 'auto' ? autoTier.value : chosen;
  world = new World(canvas, QUALITY[tier]);
  // The colour a player already wears stays theirs when colours become rewards.
  if (!profile.value.ownedSuits) updateProfile({ ownedSuits: [profile.value.suit] });
  let unlocked = false;
  const unlockAudio = (): void => {
    if (unlocked) return;
    unlocked = true;
    audio.unlock();
    audio.setVolumes(settings.value.volume, settings.value.music);
    audio.setMusic(true);
  };
  world.input.onFirstGesture = unlockAudio;
  // A player who only taps the menu buttons never touches the canvas: any first press opens the sound.
  // (pointerup, not pointerdown: on a touch screen only the release counts as a gesture that may start sound)
  window.addEventListener('pointerup', unlockAudio, { capture: true, once: true });

  await Promise.all([loadData(), loadModels(modelDetail(tier), onProgress)]);
  unlockCards(STARTER_CARDS);
  world.build(profile.value.setup.site);
  bindWorld();
  enterTitle(true);
  world.start();
  loading.value = false;
  // Some models come after the start: what was drawn with stand-ins before they arrived is redrawn with them.
  onLateModel(() => {
    world?.refreshModels();
    syncWorld();
  });

  // Keep the world in step with the settings.
  effect(() => {
    const s = settings.value;
    if (!world) return;
    world.engine.maxFps = s.fpsLimit;
    world.calm = s.lessMotion;
    world.eva.firstPerson = s.firstPerson;
    audio.setVolumes(s.volume, s.music);
    document.documentElement.style.setProperty('--text-scale', String(s.textScale));
    document.body.classList.toggle('patterns', s.patterns);
    document.body.classList.toggle('left-hand', s.leftHand);
    document.body.classList.toggle('less-motion', s.lessMotion);
    const wanted = s.quality === 'auto' ? autoTier.value : s.quality;
    if (world.engine.quality.tier !== wanted) {
      // The lighter or fuller 3D models may have to be downloaded first.
      void loadModels(modelDetail(wanted)).then(() => {
        const now = settings.peek().quality === 'auto' ? autoTier.peek() : settings.peek().quality;
        if (!world || now !== wanted || world.engine.quality.tier === wanted) return;
        stopPlacement();
        world.setQuality(QUALITY[wanted]);
        bindWorld();
        syncWorld();
      });
    }
  });
  effect(() => {
    document.documentElement.lang = lang.value;
  });
  // Opening a menu freezes the walk outside, so the suit timer is fair.
  effect(() => {
    // Inside a building the room keeps going; a menu or a small game stops it.
    const away = panel.value !== 'none' || roomGame.value !== null;
    if (world) world.paused = away;
    if (away) audio.setMotor(0, false);
  });

  // The first touch reveals the on-screen stick, even on laptops with a touch screen.
  window.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });

  // Slide the 3D picture away from whatever panel is on screen.
  effect(() => {
    updateViewShift(screen.value, step.value, room.value !== null);
  });
  window.addEventListener('resize', () => updateViewShift(screen.peek(), step.peek(), room.peek() !== null));

  window.setInterval(watchPerformance, 1000);
}

const DOCKED: Step[] = ['briefing', 'event', 'eventResult', 'plan', 'evaIntro', 'evaResult', 'report'];

function updateViewShift(currentScreen: string, currentStep: Step, inside = false): void {
  if (!world) return;
  if (inside) {
    world.engine.setViewShift(0, 0);
    return;
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  const upright = width <= 760 || width / height < 0.8;
  let x = 0;
  let y = 0;
  if (currentScreen === 'title') {
    // Menu on the left (wide screens) or at the bottom (upright phones).
    if (upright) y = -0.04;
    else x = 0.17;
  } else if (currentScreen === 'game' && DOCKED.includes(currentStep)) {
    if (upright) y = -0.22;
    else x = -Math.min(0.23, 230 / width + 0.02);
  }
  world.engine.setViewShift(x, y);
}

/** The world rebuilds its parts when the site or quality changes: hook them up again. */
function bindWorld(): void {
  if (world) world.onCine = (what) => audio.play(what === 'liftoff' ? 'whoosh' : 'land');
  if (!world) return;
  world.setSuitColor(profile.value.suit);
  world.eva.firstPerson = settings.value.firstPerson;
  world.eva.onHud = (hud) => {
    evaHud.value = hud;
    audio.setMotor(hud.motor, hud.driving);
  };
  world.eva.onEvent = onEvaEvent;
  world.eva.onView = (firstPerson) => updateSettings({ firstPerson });
  world.eva.firstPerson = settings.peek().firstPerson;
  world.interior.onHud = (hud) => {
    interiorHud.value = hud;
  };
  world.interior.onUse = useStation;
  world.interior.onStep = (kind) => {
    const moon = world?.site === 'moon';
    if (kind === 'step') audio.play('step', moon ? 1 : 0);
    else audio.play(kind);
  };
  world.onSight = (what) => {
    // A word about the dust devil, once a mission, if Lumi is not already talking.
    if (what === 'devil' && step.value === 'eva' && !lumiLine.peek() && once('devil')) say('lumi.eva.dustDevil', undefined, 'happy', 9);
  };
  world.eva.onFinish = (result, reason) => {
    if (!state || !world) return;
    audio.setAlarm(false);
    audio.setMotor(0, false);
    if (coop) {
      // Shared base: the host applies the merged walk once. This seat sends its result and shows its own card.
      ownWalk = { week: state.week, result };
      coop.take('walkEnd', [result, reason]);
      if (result.samples > 0) unlockMission(['samples']);
      // The commander's own walk may have been the last one: the merge and the night already ran inside `take`.
      if (step.value !== 'eva') return;
    } else {
      applyEva(state, plain(result));
    }
    if (result.samples > 0) unlockMission(['samples']);
    evaResult.value = { result, reason };
    step.value = 'evaResult';
    world.setMode('overview');
    world.setWeather({ storm: 0 });
    setAmbience();
    audio.play(reason === 'caught' ? 'bad' : result.samples > 0 || result.chore || (result.finds?.length ?? 0) > 0 ? 'good' : 'click');
    world.setMood(reason === 'caught' ? 'sad' : 'happy');
    hush();
    publish();
    flushStage();
  };
}

/** If Auto quality cannot hold a smooth frame rate, step down one level. */
function watchPerformance(): void {
  if (!world) return;
  const current = world.stats();
  fps.value = current.fps;
  // (Rebuilding the scene during the film would lose its camera and hidden crew.)
  if (settings.value.quality !== 'auto' || document.hidden || step.value === 'night' || loading.value || cutscene.value) {
    slowSeconds = 0;
    return;
  }
  const struggling = current.fps < 34 && current.scale <= 0.62;
  slowSeconds = struggling ? slowSeconds + 1 : 0;
  if (slowSeconds >= 5 && autoTier.value !== 'low') {
    slowSeconds = 0;
    autoTier.value = shiftTier(autoTier.value, -1); // the settings effect applies it
    notify('toast.quality', { tier: t(`set.${autoTier.value}`) }, 'info');
  }
}

function setAmbience(): void {
  if (!world) return;
  if (screen.value === 'title' || screen.value === 'setup') {
    audio.setAmbience(world.site === 'mars' ? 'mars' : 'none');
    return;
  }
  const env = state ? currentEnv(state) : null;
  if (step.value === 'eva') audio.setAmbience(world.site === 'mars' ? (env?.reason === 'dust' ? 'storm' : 'mars') : 'moonSuit');
  else audio.setAmbience(env?.reason === 'dust' ? 'storm' : 'base');
}

// ---------------------------------------------------------------------------
// Title and menus
// ---------------------------------------------------------------------------

function enterTitle(instant = false): void {
  if (!world) return;
  stopPlacement();
  screen.value = 'title';
  panel.value = 'none';
  if (room.value !== null) world.leaveRoom();
  room.value = null;
  roomGame.value = null;
  hush();
  world.eva.abort();
  world.setCrewOutside(true);
  world.setWeather({ dust: 0, storm: 0, sunHidden: 0 }, instant);
  // Mars: just before sunset, when the sky near the Sun glows blue.
  world.setClock(world.site === 'mars' ? 0.742 : 0.12);
  world.setView({ life: 1, farm: 1, lab: 1, shieldPower: 0, battery: 3, batteryCap: 4, shield: 0.4, crop: 3.2, cropAlive: true, panelDust: 0 });
  world.setMode('title', undefined, instant);
  world.setMood('happy');
  setAmbience();
}

export function goTitle(): void {
  dropCoop();
  stopSpeaking();
  audio.setAlarm(false);
  enterTitle();
}

export function openSetup(): void {
  audio.play('click');
  screen.value = 'setup';
  void refreshLive().then((ok) => {
    if (ok && screen.value === 'setup') notify('toast.live', undefined, 'good');
  });
}

/** A menu opened from the pause menu goes back to the pause menu when it closes. */
let backToPause = false;

/** A touch screen (phone, tablet): hints name the on-screen buttons, not keys. */
function touchScreen(): boolean {
  return typeof matchMedia === 'function' && (matchMedia('(pointer: coarse)').matches || document.body.classList.contains('touch'));
}

export function openPanel(next: Panel): void {
  audio.play('click');
  backToPause = panel.value === 'pause' && next !== 'pause' && next !== 'none';
  panel.value = next;
}

export function closePanel(): void {
  audio.play('click');
  stopSpeaking();
  panel.value = backToPause ? 'pause' : 'none';
  backToPause = false;
}

/** Show the chosen world behind the setup screen. */
export function previewSite(site: 'mars' | 'moon'): void {
  if (!world || world.site === site) return;
  world.build(site);
  bindWorld();
  enterTitleScene();
}

function enterTitleScene(): void {
  if (!world) return;
  world.setClock(world.site === 'mars' ? 0.742 : 0.12);
  world.setView({ life: 1, farm: 1, lab: 1, shieldPower: 0, battery: 3, batteryCap: 4, shield: 0.4, crop: 3.2, cropAlive: true, panelDust: 0 });
  world.setMode('title', undefined, true);
  setAmbience();
}

// ---------------------------------------------------------------------------
// Starting a mission
// ---------------------------------------------------------------------------

export function startDateFor(choice: SetupChoice): string {
  const days = choice.weeks * 7;
  if (choice.sunMode === 'featured') {
    const window = FEATURED_WINDOWS.find((w) => w.id === choice.windowId && w.sites.includes(choice.site)) ?? FEATURED_WINDOWS[0];
    return addDays(window.anchor, -14);
  }
  if (choice.sunMode === 'live') return liveStartDate(choice.weeks);
  // Any real date since Curiosity's weather station started, up to the newest data.
  const first = Date.parse('2012-09-01T00:00:00Z');
  const last = Date.parse(`${dataInfo.value.sunTo}T00:00:00Z`) - days * 86_400_000;
  return new Date(first + Math.random() * Math.max(0, last - first)).toISOString().slice(0, 10);
}

/**
 * Start a mission. Crew mode (src/net) passes the seed and the start date, so that every
 * friend in the room plays the very same mission.
 */
export async function startMission(choice: SetupChoice, same?: { seed: number; startDate: string }): Promise<void> {
  if (!world) return;
  dropCoop(); // a finished shared base must not follow into the next mission
  audio.play('confirm');
  updateProfile({ setup: choice });
  fading.value = true;
  await wait(0.5);

  if (world.site !== choice.site) world.build(choice.site);
  bindWorld();
  const config: MissionConfig = {
    site: choice.site,
    difficulty: choice.difficulty,
    weeks: choice.weeks,
    startDate: same?.startDate ?? startDateFor(choice),
    seed: same?.seed ?? Math.floor(Math.random() * 2 ** 31),
    tutorial: choice.tutorial,
    sunMode: choice.sunMode,
    windowId: choice.sunMode === 'featured' ? choice.windowId : undefined,
    creative: !!choice.creative,
  };
  state = createMission(config, simData());
  cardsThisMission = [];
  saidOnce = new Set();
  forgetSpoken();
  resetStepSignals();
  unlockMission(SITE_CARDS[choice.site]);
  if (config.windowId) unlockMission(WINDOW_CARDS[config.windowId] ?? []);
  if (choice.sunMode === 'live') unlockMission(['solar_cycle']);

  screen.value = 'game';
  panel.value = 'none';
  startWeek(true);
  // The first mission on a world opens with the intro film.
  if (!config.creative && !(profile.value.introSeen ?? []).includes(config.site)) playIntro();
  await wait(0.15);
  fading.value = false;
}

export async function continueMission(): Promise<void> {
  const saved = loadMissionSave();
  if (!saved || !world) return;
  dropCoop(); // continuing always plays alone
  audio.play('confirm');
  fading.value = true;
  await wait(0.5);
  try {
    await resumeSaved(saved);
  } catch (error) {
    // A save of the right version but a wrong shape: do not leave a black screen, and do not offer it again.
    console.error('Saved mission could not be opened', error);
    clearMissionSave();
    state = null;
    fading.value = false;
    enterTitle(true);
    notify('toast.saveBroken', undefined, 'warn', 5);
  }
}

async function resumeSaved(saved: NonNullable<ReturnType<typeof loadMissionSave>>): Promise<void> {
  if (!world) return;
  state = saved.state;
  ensureOutpost(state);
  if (world.site !== state.config.site) world.build(state.config.site);
  bindWorld();
  cardsThisMission = [];
  saidOnce = new Set();
  forgetSpoken();
  resetStepSignals();
  world.eva.abort();
  panel.value = 'none';

  const env = currentEnv(state);
  applyWeather(env, true);
  setWeekClock(env);
  world.setCrewOutside(crewCanWork(env));
  if (state.end) {
    // The game was closed after the last night but before the review: show the review now.
    lastRecord.value = state.history[state.history.length - 1] ?? null;
    finishMission();
    await wait(0.15);
    fading.value = false;
    return;
  }
  screen.value = 'game';
  world.setMode('overview', undefined, true);
  const done = state.history.some((record) => record.week === state!.week);
  if (done) {
    lastRecord.value = state.history[state.history.length - 1];
    step.value = 'report';
  } else if (state.now.eva) {
    step.value = 'plan';
    void runNight();
  } else if (saved.step === 'eva' && state.now.evaAlerted) {
    // The game was closed while a storm alert was sounding. The storm still arrived.
    const result: EvaResult = { seconds: 30, samples: 0, science: 0, chore: false, caught: true, alerted: true };
    applyEva(state, result);
    evaResult.value = { result, reason: 'caught' };
    step.value = 'evaResult';
    world.setMood('sad');
  } else if (saved.step === 'event' && !state.now.eventDone) {
    enterEvent();
  } else if (saved.step === 'briefing') {
    step.value = 'briefing';
  } else {
    goPlan();
  }
  setAmbience();
  publish();
  await wait(0.15);
  fading.value = false;
}

function resetStepSignals(): void {
  myWalkWeek = 0;
  stopFilm();
  stopPlacement();
  if (room.value !== null) world?.leaveRoom();
  room.value = null;
  roomGame.value = null;
  interiorHud.value = null;
  eventResult.value = null;
  earthAnswer.value = null;
  evaResult.value = null;
  evaHud.value = null;
  lastRecord.value = null;
  newCards.value = [];
  newBadges.value = [];
}

function unlockMission(ids: string[]): string[] {
  const fresh = unlockCards(ids);
  for (const id of fresh) if (!cardsThisMission.includes(id)) cardsThisMission.push(id);
  return fresh;
}

/** Tell the screen and the 3D world about the latest mission state, and save it. */
function publish(): void {
  if (!state) return;
  mission.value = structuredClone(state);
  saveMission(state, step.value);
  syncWorld();
}

function syncWorld(): void {
  if (!world || !state) return;
  const s = state;
  const planning = step.value === 'plan';
  world.setView({
    life: s.alloc.life / MAX_LEVEL.life,
    farm: s.alloc.farm / MAX_LEVEL.farm,
    lab: s.alloc.lab / MAX_LEVEL.lab,
    shieldPower: robotIdle(s) ? 0 : s.alloc.shield / MAX_LEVEL.shield,
    // While planning, the battery bars show what will be left over.
    battery: planning ? computeWeek(s).batteryAfter : s.battery,
    batteryCap: s.batteryCap,
    shield: s.shield,
    crop: s.crop,
    cropAlive: s.crop > 0 || s.neglect < 2,
    panelDust: s.panelDust,
  });
  // The new buildings: empty plot, being built, finished.
  const free = isCreative(s);
  world.setOutpost(
    BUILDINGS.map((def) => {
      const site = s.buildings?.find((item) => item.id === def.id);
      return {
        id: def.id,
        state: site ? (site.done ? 'done' : 'building') : 'empty',
        progress: site ? site.progress / def.work : 0,
        x: site?.x,
        z: site?.z,
        heading: site?.heading,
        free,
      };
    }),
  );
  world.setDecor(s.decor ?? []);
}

/** For tests in the browser console (dev.ts): show the latest state everywhere. */
export function devRefresh(): void {
  publish();
}

/** Order a new building. The builder robot puts it up with the cells given to it in the power plan. */
export function orderBuilding(id: BuildingId): boolean {
  if (coop) {
    // The host works the order out (no building at night or on the report); this device only says what it can see.
    if (!state || step.value === 'night' || step.value === 'report') return false;
    if (buildBlock(state, id)) {
      audio.play('deny');
      return false;
    }
    coop.take('orderBuilding', [id]);
    audio.play('confirm');
    say('lumi.build.ordered', { building: t(`bld.${id}.name`), n: buildingDef(id).work }, 'happy', 8);
    unlockMission(['printed_habitats']);
    return true;
  }
  if (!state || step.value === 'night') return false;
  if (!startBuilding(state, id)) {
    audio.play('deny');
    return false;
  }
  audio.play('confirm');
  // The robot needs at least one cell: put one in the plan if there is a spare one.
  if (step.value === 'plan' && state.alloc.shield === 0) setAlloc(state, 'shield', 1);
  // Not {name}: in Lumi's lines that is the cadet's name.
  say('lumi.build.ordered', { building: t(`bld.${id}.name`), n: buildingDef(id).work }, 'happy', 8);
  unlockMission(['printed_habitats']);
  publish();
  return true;
}

/** What a room should show: which stations are already used, and what is in store. */
function roomLook(id: RoomId): RoomLook {
  const s = state!;
  const done = [...profile.value.unlocked, ...roomDef(id).games.filter((item) => roomPlayed(s, id, item.game)).map((item) => `game:${item.game}`)];
  return { site: s.config.site, done, stock: { regolith: s.stock?.regolith ?? 0, metal: s.stock?.metal ?? 0 } };
}

let doorBusy = false;
/** The reward of the room game on screen was paid when its win card appeared. */
let roomWinPaid = false;
/** Doors the cadet can walk through on this walk, in the order the walk knows them. */
let walkDoors: { room: RoomId; x: number; z: number }[] = [];

/** Where the player put a building in creative mode (else it stands on its plot). */
function placeOf(s: MissionState, id: BuildingId): { x: number; z: number; heading: number } | undefined {
  const site = s.buildings?.find((item) => item.id === id);
  return site && site.x !== undefined && site.z !== undefined ? { x: site.x, z: site.z, heading: site.heading ?? 0 } : undefined;
}

/** The buildings with a door to walk into from outside (the habitat's door is the airlock: it ends the walk). */
function doorsFor(s: MissionState): { room: RoomId; x: number; z: number }[] {
  const doors: { room: RoomId; x: number; z: number }[] = [
    { room: 'farm', x: FARM.x, z: FARM.z + 9.4 },
    { room: 'lab', x: LAB.x, z: LAB.z + 9.6 },
    // The lander's hatch faces the outpost.
    { room: 'lander', x: LANDER.x - 4.9, z: LANDER.z },
  ];
  for (const id of ['workshop', 'garden', 'observatory', 'oxygen', 'bunker'] as const) {
    if (!isBuilt(s, id)) continue;
    const door = doorOf(id, placeOf(s, id));
    doors.push({ room: id, x: door.x, z: door.z });
  }
  return doors;
}

/** Go inside a building. The screen fades, the room is built, and the cadet walks in. Outside, everything waits. */
export function enterRoom(id: RoomId): void {
  // The doors are shut during a storm alert, also for the Outpost menu that the pause menu opens.
  if (!state || !world || !roomOpen(state, id) || step.value === 'night' || step.value === 'report' || doorBusy || (step.value === 'eva' && world.eva.alerting)) {
    audio.play('deny');
    // A reward won now would belong to a week whose report is already written.
    if (step.value === 'report') notify('room.reportWait', undefined, 'info', 3.4);
    return;
  }
  audio.play('confirm');
  panel.value = 'none';
  backToPause = false;
  stopPlacement();
  doorBusy = true;
  fading.value = true;
  hush();
  void wait(0.35).then(() => {
    doorBusy = false;
    // Shared base: the night came while the door was opening; nobody goes in then.
    if (!state || !world || (coop && (step.value === 'night' || step.value === 'report'))) {
      fading.value = false;
      return;
    }
    roomGame.value = null;
    interiorHud.value = null;
    world.enterRoom(id, roomLook(id));
    room.value = id;
    audio.setAmbience('base');
    void wait(0.12).then(() => {
      fading.value = false;
      if (once(`room:${id}`)) say(`lumi.room.${id}`, undefined, 'happy', 9);
    });
  });
}

/** Come out of the room. With "workshop", the workshop menu opens straight away. */
export function leaveRoom(next?: 'workshop'): void {
  if (!world || doorBusy || room.value === null) return;
  audio.play('click');
  roomGame.value = null;
  doorBusy = true;
  fading.value = true;
  hush();
  void wait(0.3).then(() => {
    doorBusy = false;
    world?.leaveRoom();
    room.value = null;
    interiorHud.value = null;
    setAmbience();
    if (next === 'workshop') {
      outpostTab.value = 'workshop';
      panel.value = 'outpost';
    }
    void wait(0.12).then(() => {
      fading.value = false;
    });
    flushStage();
  });
}

/** The use button at a station inside a building. */
function useStation(station: Station): void {
  const id = room.value;
  // While the door is opening or closing nothing in the room can be used (a game would stay open behind the fade).
  if (!state || !world || !id || doorBusy || roomGame.value || panel.value !== 'none') return;
  switch (station.kind) {
    case 'exit':
      leaveRoom();
      break;
    case 'game': {
      const game = station.id.replace('game:', '') as GameId;
      if (!roomDef(id).games.some((item) => item.game === game)) break;
      audio.play('confirm');
      hush();
      roomWinPaid = false;
      roomWon.value = null;
      roomGame.value = game;
      break;
    }
    case 'printer':
      outpostTab.value = 'workshop';
      openPanel('outpost');
      break;
    case 'look': {
      const card = cardById(station.id);
      if (!card) break;
      audio.play('signal');
      const fresh = unlockMission([station.id]);
      say(`lumi.look.${station.id}`, undefined, 'happy', 12);
      if (fresh.length) notify('toast.unlocked', { title: card[lang.value].title }, 'good');
      world.interior.setDone(roomLook(id).done);
      break;
    }
  }
}

/** The win card of a room game is on screen: pay now (see `finishRoomGame`, which then only closes). */
export function winRoomGame(id: RoomId, game: GameId): void {
  if (!state || roomWinPaid) return;
  finishRoomGame(id, game, true);
  roomWinPaid = true;
}

/** A room game ended. A win helps the outpost, once a week per room. */
export function finishRoomGame(id: RoomId, game: GameId, won: boolean): void {
  if (!state) return;
  if (won && roomWinPaid) {
    // Paid when the win card appeared.
    roomWinPaid = false;
    return;
  }
  if (coop) {
    coopRoomGame(id, game, won);
    return;
  }
  const paid = claimRoom(state, id, game, won);
  if (game === 'spectro') unlockMission(['laser_spectrometer']);
  if (game === 'plants') unlockMission(['space_farming']);
  if (game === 'signal') unlockMission(['comm_delay']);
  if (game === 'landing') unlockMission(['gravity']);
  audio.play(won ? 'good' : 'bad');
  if (paid) {
    // The garden's plant game gives food now, not a sooner harvest.
    const what = id === 'garden' ? 'garden' : game;
    say(`lumi.won.${what}`, undefined, 'happy', 8);
    notify(`won.${what}`, rewardParams(roomDef(id).games.find((item) => item.game === game)?.reward), 'good', 3.6);
  } else if (won) {
    notify('room.wonAgain', undefined, 'info', 3.6);
  }
  world?.interior.setDone(roomLook(id).done);
  publish();
}

/** Shared base: a room game ended. A win goes to the host, who pays it once a week for the whole crew. */
function coopRoomGame(id: RoomId, game: GameId, won: boolean): void {
  if (!state || !coop) return;
  // Would the host pay it? (The same rule on a copy: the real state changes when the host's answer comes.)
  const paid = won && claimRoom(structuredClone(state), id, game, true);
  if (won) coop.take('finishRoomGame', [id, game, true]);
  if (game === 'spectro') unlockMission(['laser_spectrometer']);
  if (game === 'plants') unlockMission(['space_farming']);
  if (game === 'signal') unlockMission(['comm_delay']);
  if (game === 'landing') unlockMission(['gravity']);
  audio.play(won ? 'good' : 'bad');
  if (paid) {
    const what = id === 'garden' ? 'garden' : game;
    say(`lumi.won.${what}`, undefined, 'happy', 8);
    notify(`won.${what}`, rewardParams(roomDef(id).games.find((item) => item.game === game)?.reward), 'good', 3.6);
  } else if (won) {
    notify('room.wonAgain', undefined, 'info', 3.6);
  }
}

/** Numbers for the reward notice. */
function rewardParams(reward: { air?: number; crop?: number; science?: number; food?: number } | undefined): Record<string, number> {
  return { air: reward?.air ?? 0, science: reward?.science ?? 0, food: reward?.food ?? 0 };
}

/** Close the small game and walk on. */
export function closeRoomGame(): void {
  audio.play('click');
  roomGame.value = null;
  roomWon.value = null;
  roomWinPaid = false;
  flushStage();
}

/** Creative mode: pick something to put on the ground. A see-through copy follows the pointer; a click puts it there. */
export function beginPlacement(kind: 'building' | 'decor', id: string): void {
  if (!state || !world || !isCreative(state) || step.value === 'night' || step.value === 'eva' || room.value !== null) {
    audio.play('deny');
    return;
  }
  audio.play('click');
  panel.value = 'none';
  backToPause = false;
  if (world.mode !== 'overview') world.setMode('overview');
  const ghost = world.annex.ghost(kind, id);
  const radius = kind === 'building' ? 4.4 : propRadius(id);
  const ignore = kind === 'building' ? world.annex.colliderOf(id as BuildingId) : null;
  placing.value = { kind, id, valid: false };
  world.placer.onChange = (valid) => {
    if (placing.value) placing.value = { ...placing.value, valid };
  };
  world.placer.onPlace = (x, z, heading) => {
    if (!state) return;
    if (kind === 'building') {
      placeBuilding(state, id as BuildingId, x, z, heading);
      audio.play('discover');
      announce(id, 0, true, 'building');
      stopPlacement();
    } else if (addDecor(state, id as DecorId, x, z, heading)) {
      audio.play('collect', 2);
    } else {
      audio.play('deny');
      notify('creative.full', undefined, 'info');
    }
    publish();
  };
  world.placer.start(ghost, radius, Math.PI, ignore);
  if (once('creativePlace')) say('lumi.creative.place', undefined, 'happy', 9);
}

/** Stop putting things down. */
export function stopPlacement(): void {
  world?.placer.stop();
  placing.value = null;
}

/** Turn the thing being placed by an eighth of a turn. */
export function rotatePlacement(): void {
  if (!world?.placer.active) return;
  audio.play('click');
  world.placer.rotate();
}

/** Put it down where the see-through copy is (the button on touch screens). */
export function confirmPlacement(): void {
  if (!world?.placer.confirm()) audio.play('deny');
}

/** Creative mode: take a building away, or the last decoration, or all decorations. */
export function removePlaced(kind: 'building' | 'decor', id?: string, all = false): void {
  if (!state) return;
  const done = kind === 'building' ? removeBuilding(state, id as BuildingId) : removeDecor(state, all);
  audio.play(done ? 'down' : 'deny');
  if (done) publish();
}

// ---------------------------------------------------------------------------
// Films (see films.ts and ui/Cutscene)
// ---------------------------------------------------------------------------

/** Runs when the film that is playing is over (the ending films open the debrief). */
let afterFilm: (() => void) | null = null;
/**
 * What Lumi was saying and the banner that was up when a film started. A film often starts right
 * after a step's line (a task film the first time, an event film), so both come back after it.
 */
let lineBeforeFilm: typeof lumiLine.value = null;
let bannerBeforeFilm: typeof discovery.value = null;

function filmSeen(id: FilmId): boolean {
  if (!state) return true;
  return (profile.value.filmsSeen ?? []).includes(seenKey(id, state.config.site));
}

/** Remember a film (or a task shown in the intro tour) as seen. */
export function markFilmSeen(id: FilmId): void {
  if (!state) return;
  const key = seenKey(id, state.config.site);
  const seen = profile.value.filmsSeen ?? [];
  if (!seen.includes(key)) updateProfile({ filmsSeen: [...seen, key] });
}

/** Play a film. `then` runs when it is over. False when a film cannot start now. */
export function playFilm(id: FilmId, then?: () => void): boolean {
  const ending = id === 'win' || id === 'lose';
  if (!state || !world || film.value !== null || room.value !== null || printing.value || step.value === 'eva') return false;
  // The film player is part of the game screen: on the title screen (a mission resumed after its
  // last night goes straight to the review) a film would never show and never end.
  if (screen.value !== 'game') return false;
  // While the week runs at night only the ending films may start.
  if (step.value === 'night' && !ending) return false;
  const data = FILMS[id];
  if (!data || (data.sites && !data.sites.includes(state.config.site))) return false;
  panel.value = 'none';
  backToPause = false;
  stopPlacement();
  lineBeforeFilm = ending ? null : lumiLine.peek();
  bannerBeforeFilm = ending ? null : discovery.peek();
  hush();
  afterFilm = then ?? null;
  world.startCinema(!!data.landing);
  film.value = id;
  return true;
}

/** The intro film: why the crew is here, what the tasks are and why they matter. */
export function playIntro(): boolean {
  return playFilm('intro');
}

/** One shot of the film. */
export function filmShot(shot: CineShot): void {
  world?.cinematic(shot);
}

/** The film is over (or skipped from its last card): back to the week. */
export function finishFilm(): void {
  const id = film.value;
  if (!id) return;
  film.value = null;
  world?.endCinematic();
  // A film may have been played in the middle of a step: show what this step was showing.
  if (world && state) {
    if ((step.value === 'event' || step.value === 'eventResult') && state.now.eventId) world.lookAt(EVENTS[state.now.eventId].camera as SpotId);
    else if (step.value === 'evaIntro') world.lookAt('airlock');
  }
  audio.play('confirm');
  if (state) {
    markFilmSeen(id);
    if (id === 'intro') {
      const seen = profile.value.introSeen ?? [];
      if (!seen.includes(state.config.site)) updateProfile({ introSeen: [...seen, state.config.site] });
    }
  }
  // Lumi's line for this step and the banner of a new building come back (unless something newer is up).
  const line = lineBeforeFilm;
  const banner = bannerBeforeFilm;
  lineBeforeFilm = null;
  bannerBeforeFilm = null;
  if (line && lumiLine.peek() === null) say(line.key, line.params, line.mood);
  if (banner && discovery.peek() === null) announce(banner.id, banner.science, banner.fresh, banner.kind);
  const then = afterFilm;
  afterFilm = null;
  then?.();
  // Shared base: the stage that came during the film. (Not after the ending films: the debrief is next.)
  if (id !== 'win' && id !== 'lose') flushStage();
}

/** The old names, kept for the menu and the tests. */
export const introShot = filmShot;
export const finishIntro = finishFilm;

/** A task's film plays by itself the first time the task comes up, unless the intro tour showed it. */
function taskFilm(task: TaskId): void {
  if (!state || isCreative(state) || filmSeen(`task.${task}`)) return;
  playFilm(`task.${task}`);
}

/** Big moments get their film once (storms and harvests once per world). */
function eventFilm(id: EventFilmId): void {
  if (!state || isCreative(state) || filmSeen(id)) return;
  playFilm(id);
}

/** The "Why?" buttons: replay a task's film any time between steps. */
export function explainTask(task: TaskId): void {
  if (!playFilm(`task.${task}`)) audio.play('deny');
}

/** A film is cut short because the mission ends or the player leaves. */
function stopFilm(): void {
  if (film.value === null) return;
  film.value = null;
  afterFilm = null;
  lineBeforeFilm = null;
  bannerBeforeFilm = null;
  world?.endCinematic(false);
}

/** Print a tool: the printer game opens, and the tool is made when the print is finished. */
export function startPrint(id: ToolId): void {
  // Between the confirmed plan and the report nothing is built: the week is already running.
  if (!state || step.value === 'night' || craftBlock(state, id) || printing.value) {
    audio.play('deny');
    return;
  }
  audio.play('confirm');
  hush();
  printing.value = id;
}

/** Stop printing before the end: nothing is used up. */
export function cancelPrint(): void {
  if (!printing.value) return;
  printing.value = null;
  audio.play('click');
  flushStage();
}

/** The print is finished: the tool is made, and a neat print saves one metal. */
export function finishPrint(accuracy: number): void {
  const id = printing.value;
  printing.value = null;
  if (coop) {
    if (id && state) coopCraft(id, accuracy >= PRINT.saving && !isCreative(state));
    flushStage();
    return;
  }
  if (!id || !state || !craftTool(id)) return;
  unlockMission(['space_printer']);
  if (accuracy >= PRINT.saving && !isCreative(state)) {
    addMaterials(state, { metal: 1 });
    notify('print.saved', undefined, 'good', 3.6);
    publish();
  }
}

/** Shared base: a print is finished. The host makes the tool and takes the metal a neat print saves. */
function coopCraft(id: ToolId, neat: boolean): void {
  if (!state || !coop) return;
  if (craftBlock(state, id) || step.value === 'night' || step.value === 'report') {
    audio.play('deny');
    return;
  }
  coop.take('finishPrint', [id, neat]);
  audio.play('discover');
  say(`lumi.tool.${id}`, undefined, 'happy', 8);
  const toolCard: Partial<Record<ToolId, string>> = { tank: 'suit_oxygen', drill: 'lunar_drill', vest: 'astrorad' };
  if (toolCard[id]) unlockMission([toolCard[id]!]);
  unlockMission(['space_printer']);
  if (neat) notify('print.saved', undefined, 'good', 3.6);
}

/** Make a tool in the workshop. */
export function craftTool(id: ToolId): boolean {
  if (coop) return false; // a shared base crafts through finishPrint
  if (!state || !craft(state, id)) {
    audio.play('deny');
    return false;
  }
  audio.play('discover');
  say(`lumi.tool.${id}`, undefined, 'happy', 8);
  const toolCard: Partial<Record<ToolId, string>> = { tank: 'suit_oxygen', drill: 'lunar_drill', vest: 'astrorad' };
  if (toolCard[id]) unlockMission([toolCard[id]!]);
  publish();
  return true;
}

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------

function applyWeather(env: WeekEnv, instant = false): void {
  if (!world) return;
  const dust = env.reason === 'dust' ? (env.sunlight <= 0.35 ? 1 : 0.62) : 0;
  world.setWeather({ dust, sunHidden: env.reason === 'dark' ? 1 : 0, storm: 0 }, instant);
}

/** The rest of the crew works outside only in calm weeks: no solar storm, no dust storm. */
function crewCanWork(env: WeekEnv): boolean {
  return env.storm.strength === 0 && env.reason !== 'dust';
}

/** Mars: mid-morning. Moon: put the Sun where the real lunar calendar has it. */
function setWeekClock(env: WeekEnv): void {
  if (!world) return;
  if (world.site === 'mars') world.setClock(0.38);
  else world.setClock(((moonGeometry(env.dateFrom).elongationDeg + 38) % 360) / 360);
}

function once(key: string): boolean {
  if (saidOnce.has(key)) return false;
  saidOnce.add(key);
  return true;
}

function startWeek(first = false): void {
  if (!world || !state) return;
  const env = currentEnv(state);
  planTouched = false;
  step.value = 'briefing';
  applyWeather(env, first);
  setWeekClock(env);
  world.setCrewOutside(crewCanWork(env));
  world.setMode('overview', undefined, first);
  world.setMood('calm');
  setAmbience();

  const site = state.config.site;
  const cadet = profile.value.name.trim();
  if (first && state.config.creative) {
    say('lumi.creative.welcome', undefined, 'happy');
  } else if (first) {
    say(`lumi.welcome.${site}`, { name: cadet || '' }, 'happy');
  } else if (env.storm.strength > 0 && once('storm')) {
    say(`lumi.storm.${site}`, undefined, 'alert');
  } else if (env.reason === 'dust' && once('dust')) {
    say('lumi.dust', undefined, 'think');
  } else if (env.reason === 'dark' && once('dark')) {
    say('lumi.dark', undefined, 'think');
  } else if (!state.config.tutorial && state.week === 2 && !state.buildings?.length && once('outpostTip')) {
    say('lumi.outpost.tip', undefined, 'happy');
  } else if (state.config.tutorial && state.week === 2) {
    say('lumi.t2.farm', undefined, 'calm');
  } else if (state.config.tutorial && state.week === 3) {
    say('lumi.t3.shield', undefined, 'calm');
  } else if (state.config.tutorial && state.week === 4) {
    say('lumi.t4.battery', undefined, 'calm');
  } else {
    hush();
  }
  if (env.storm.strength > 0) unlockMission(['space_weather']);
  publish();
  // A solar storm week: the camera looks up at the sky for a moment.
  if (!first && env.storm.strength > 0) glanceAtSky();
  // The first time the Sun blocks the radio to Earth (Mars solar conjunction) gets its film.
  if (!first && env.conjunction) eventFilm('conjunction');
  // The first dust storm gets its film (on the first week the intro plays instead).
  if (!first && env.reason === 'dust') eventFilm('dust');
}

/** A quick look up at the sky, then back to the outpost (not in calm mode). */
function glanceAtSky(): void {
  if (!world || settings.value.lessMotion) return;
  world.lookAt('sky');
  window.setTimeout(() => {
    if (world && state && step.value === 'briefing' && film.value === null && room.value === null) world.setMode('overview');
  }, 2600);
}

/** Player pressed "Start the week" on the forecast. */
export function continueBriefing(): void {
  if (coop) return coopSend('continueBriefing');
  if (!state) return;
  audio.play('click');
  if (state.now.eventId && !state.now.eventDone) enterEvent();
  else goPlan();
}

function enterEvent(): void {
  if (!world || !state || !state.now.eventId) return;
  const event = EVENTS[state.now.eventId];
  const env = currentEnv(state);
  step.value = 'event';
  eventResult.value = null;
  earthAnswer.value = state.now.askedEarth ? earthAnswerFor(state) : null; // already paid for
  audio.play('card');
  world.lookAt(event.camera as SpotId);
  if (event.id === 'dust_devil') world.dustDevilAcrossPanels();
  if (event.id === 'solar_storm') {
    world.setWeather({ storm: 0.4 + 0.2 * env.storm.strength });
    world.setMood('alert');
    audio.play('alarm');
    say(state.config.site === 'mars' ? 'lumi.aurora' : 'lumi.specks', undefined, 'alert');
  } else if (state.config.tutorial && once('firstCard')) {
    say('lumi.t3.event', undefined, 'think');
  } else if (state.config.tutorial && once('askEarth')) {
    say('lumi.t4.earth', undefined, 'think');
  } else {
    hush();
  }
  publish();
  // The first solar storm on a world gets its film; the first card explains choices.
  if (event.id === 'solar_storm') eventFilm('storm');
  else if (event.id === 'eclipse') eventFilm('eclipse');
  else taskFilm('event');
}

export function chooseEvent(optionId: OptionId): void {
  if (coop) return coopSend('chooseEvent', [optionId]);
  if (!state) return;
  const result = chooseOption(state, optionId);
  if (!result) {
    audio.play('deny');
    return;
  }
  audio.play('confirm');
  unlockMission([EVENTS[result.eventId].codex]);
  eventResult.value = result;
  step.value = 'eventResult';
  world?.setMood(result.optionId === result.advice ? 'happy' : 'think');
  hush();
  publish();
}

export function askMissionControl(): void {
  if (coop) {
    if (state && !state.now.askedEarth) coopSend('askMissionControl');
    else audio.play('deny');
    return;
  }
  if (!state) return;
  const answer = askEarth(state);
  if (!answer) {
    audio.play('deny');
    return;
  }
  audio.play('signal');
  earthAnswer.value = answer;
  publish();
}

export function confirmEvent(): void {
  if (coop) return coopSend('confirmEvent');
  audio.play('click');
  eventResult.value = null;
  earthAnswer.value = null;
  world?.setWeather({ storm: 0 });
  goPlan();
}

function goPlan(): void {
  if (!world || !state) return;
  step.value = 'plan';
  world.setMode('overview');
  world.setMood('calm');
  if (state.config.tutorial && state.week === 1 && !planTouched) say('lumi.t1.plan', undefined, 'happy');
  else advise();
  publish();
  taskFilm('plan');
}

/** Lumi looks at the plan and says the most useful thing about it. */
function advise(): void {
  if (!state) return;
  const s = state;
  const outcome = computeWeek(s);
  const next = s.plan[s.week];
  if (outcome.airAfter <= 0) say('lumi.plan.airOut', undefined, 'alert');
  else if (outcome.hungry) say('lumi.plan.foodLow', { n: Math.max(0, Math.floor(s.food)) }, 'alert');
  else if (s.alloc.farm === 0 && (s.crop > 0 || s.week <= s.config.weeks - 4)) say('lumi.plan.farmOff', undefined, 'sad');
  else if (outcome.parts.airLife < 0 && outcome.airAfter < 45) say('lumi.plan.airLow', { n: -outcome.parts.airLife }, 'alert');
  else if (outcome.wasted > 0) say('lumi.plan.waste', { n: outcome.wasted }, 'think');
  else if (next && next.sunlight < 0.7 && outcome.batteryAfter < 2) say('lumi.plan.darkAhead', undefined, 'think');
  else if (outcome.doseAfter > s.doseLimit * 0.7 && s.shield < 1 && s.alloc.shield === 0) say('lumi.plan.doseHigh', undefined, 'alert');
  else if (s.alloc.lab === 0) say('lumi.plan.noScience', undefined, 'think');
  else if (s.config.tutorial && s.week === 1) say('lumi.t1.go', undefined, 'happy');
  else say('lumi.plan.good', undefined, 'happy');
}

export function changeAlloc(module: ModuleId, delta: number): void {
  if (!state || step.value !== 'plan') return;
  const before = state.alloc[module];
  const wanted = before + delta;
  if (wanted < 0 || wanted > MAX_LEVEL[module]) {
    audio.play('deny');
    return;
  }
  if (coop) {
    if (!coopSynced()) return;
    // The new plan is worked out on a copy and sent as absolute levels; the host's answer is the truth.
    const trial = { ...state, alloc: { ...state.alloc } };
    if (!setAlloc(trial, module, wanted)) {
      audio.play('deny');
      say('lumi.plan.over', undefined, 'think');
      return;
    }
    audio.play(delta > 0 ? 'up' : 'down', wanted);
    coop.take('changeAlloc', [trial.alloc]);
    advise();
    publish();
    return;
  }
  if (!setAlloc(state, module, wanted)) {
    audio.play('deny');
    say('lumi.plan.over', undefined, 'think');
    return;
  }
  planTouched = true;
  audio.play(delta > 0 ? 'up' : 'down', wanted);
  advise();
  publish();
}

/** Tap on a building label: one more cell, or back to zero when it cannot take more. */
export function cycleAlloc(module: ModuleId): void {
  if (!state || step.value !== 'plan') return;
  const level = state.alloc[module];
  const full = level >= MAX_LEVEL[module] || (module === 'shield' && robotIdle(state));
  const spare = computeWeek(state).leftover > 0;
  if (!full && spare) changeAlloc(module, 1);
  else if (level > 0) changeAlloc(module, -level);
  else changeAlloc(module, 1);
}

export function useSafePlan(): void {
  if (!state || step.value !== 'plan') return;
  if (coop) {
    if (!coopSynced()) return;
    audio.play('good');
    coop.take('useSafePlan', []);
    advise();
    publish();
    return;
  }
  state.alloc = suggestAlloc(state);
  planTouched = true;
  audio.play('good');
  advise();
  publish();
}

export function confirmPlan(): void {
  if (coop) return coopSend('confirmPlan');
  if (!world || !state) return;
  audio.play('confirm');
  if (state.now.evaAllowed) enterEvaIntro();
  else void runNight();
}

/** The walk's first screen: who goes out, and the camera at the airlock. */
function enterEvaIntro(): void {
  if (!world || !state) return;
  step.value = 'evaIntro';
  world.lookAt('airlock');
  if (state.config.tutorial && once('evaIntro')) say('lumi.t2.eva', undefined, 'happy');
  else hush();
  publish();
  taskFilm('walk');
}

export function beginWalk(): void {
  if (coop) return coopSend('beginWalk');
  startOwnWalk();
}

/** This device's walk starts: solo at once, a shared base when the host says the walkers go out. */
function startOwnWalk(): void {
  if (!world || !state) return;
  stopPlacement();
  const level = state.config.difficulty;
  step.value = 'eva';
  stepsThisWalk = 0;
  sampleStreak = 0;
  evaHud.value = null;
  if (world.site === 'mars') world.setClock(0.47);
  world.startEva({
    site: state.config.site,
    seed: state.config.seed,
    week: state.week,
    stormChance: isCreative(state) ? 0 : evaStormChance(state),
    alertSeconds: level === 'cadet' ? 20 : level === 'commander' ? 16 : 13,
    choreAvailable: state.config.site === 'mars' ? state.panelDust >= 0.1 : state.week % 2 === 0,
    found: foundIn(state),
    tools: [...(state.tools ?? [])],
    doors: (walkDoors = doorsFor(state)),
    shelters: isBuilt(state, 'bunker') ? [doorOf('bunker', placeOf(state, 'bunker'))] : [],
    unlimited: isCreative(state),
    // Cadet missions are the first ones: 20 more seconds to learn walking, digging and doors.
    // The walk's air cost is capped (sim/mission.ts), so the outpost's air is not hurt by it.
    extraSeconds: level === 'cadet' ? 20 : 0,
  });
  world.setMood('happy');
  audio.play('confirm');
  setAmbience();
  say('lumi.eva.start', undefined, 'happy', 6);
  publish();
}

function onEvaEvent(event: EvaEvent, value = 0): void {
  if (!world || !state) return;
  const moon = state.config.site === 'moon';
  switch (event) {
    case 'sample': {
      audio.play('collect', value);
      pickup({ kind: 'sample', key: `pickup.sample.${value}`, value, unit: 'science' });
      // Quick hands: three or more samples in a row get a cheer.
      const now = performance.now();
      sampleStreak = now - lastSampleAt < 7000 ? sampleStreak + 1 : 1;
      lastSampleAt = now;
      if (sampleStreak >= 3) {
        notify('eva.streak', { n: sampleStreak }, 'good', 1.8);
        audio.play('star', Math.min(3, sampleStreak - 2));
      }
      if (value >= 6 && once('farSample')) say('lumi.eva.far', undefined, 'think', 5);
      break;
    }
    case 'chore':
      audio.play('chore');
      pickup({ kind: 'chore', key: `pickup.chore.${state.config.site}`, value: moon ? 6 : 0, unit: 'air' });
      break;
    case 'find': {
      // A discovery: its story goes into the Science log, and Lumi tells the short version.
      const find = FINDS[state.config.site][value];
      if (!find) break;
      // Shared base: the host records it (once for the crew); the banner and Lumi's line are this child's own.
      if (coop) coop.take('find', [value]);
      else if (!recordFind(state, find.id)) break;
      audio.play('discover');
      announce(find.id, FIND_SCIENCE, unlockMission([find.id]).length > 0);
      pickup({ kind: 'find', key: 'pickup.find', params: { title: cardById(find.id)?.[lang.value].title ?? '' }, value: FIND_SCIENCE, unit: 'science' });
      say(`lumi.find.${find.id}`, undefined, 'happy', 10);
      if (!coop) publish(); // saved now: closing the game cannot take the discovery away
      break;
    }
    case 'door': {
      const door = walkDoors[value];
      if (door) enterRoom(door.room);
      break;
    }
    case 'regolith':
    case 'metal':
      audio.play('collect', 2);
      pickup({ kind: 'material', key: `pickup.${event}`, value, unit: event });
      if (once(`material:${event}`)) say(event === 'metal' ? `lumi.eva.metal.${state.config.site}` : 'lumi.eva.regolith', undefined, 'happy', 9);
      unlockMission([event === 'metal' ? 'moon_metal' : 'isru']);
      break;
    case 'perfect':
      audio.play('good');
      notify('eva.perfect', undefined, 'good', 1.6);
      break;
    case 'miss':
      audio.play('deny');
      break;
    case 'alert':
      world.setCrewOutside(false);
      audio.setAlarm(true);
      world.shake(0.45);
      world.setMood('alert');
      say(isBuilt(state, 'bunker') ? 'lumi.eva.alertBunker' : 'lumi.eva.alert', undefined, 'alert', 5);
      state.now.evaAlerted = true; // saved: closing the game does not cancel the storm
      publish();
      break;
    case 'drive':
      audio.play('confirm');
      unlockMission(['rovers']);
      if (once('rover')) say(touchScreen() ? 'lumi.eva.roverTouch' : 'lumi.eva.rover', undefined, 'happy', 9);
      break;
    case 'park':
      audio.play('click');
      audio.setMotor(0, false);
      break;
    case 'bump':
      audio.play('land');
      break;
    case 'roverEmpty':
      audio.play('deny');
      say('lumi.eva.roverEmpty', undefined, 'think', 7);
      break;
    case 'jump':
      audio.play('jump');
      break;
    case 'land':
      audio.play('land');
      if (moon && value > 1.5 && once('moonJump')) say('lumi.eva.moonJump', undefined, 'happy', 4);
      else if (once('sound')) say(moon ? 'lumi.eva.noSound.moon' : 'lumi.eva.sound.mars', undefined, 'think', 6);
      break;
    case 'step':
      audio.play('step', moon ? 1 : 0);
      stepsThisWalk += 1;
      if (stepsThisWalk === 16 && once('footprints')) say(`lumi.eva.footprints.${state.config.site}`, undefined, 'happy', 6);
      break;
    case 'edge':
      say('eva.edge', undefined, 'think', 4);
      break;
    case 'run':
      if (once('run')) notify('toast.run', undefined, 'info', 3.2);
      break;
    default:
      break;
  }
}

export function recallWalk(): void {
  if (!world?.eva.recall()) audio.play('deny');
}

export function skipWalk(): void {
  if (coop) return coopSend('skipWalk');
  audio.play('click');
  void runNight();
}

export function finishWalk(): void {
  if (coop) {
    // The walk's result is already with the host; the stage moves on when the crew is back.
    audio.play('click');
    flushStage();
    return;
  }
  audio.play('click');
  evaResult.value = null;
  void runNight();
}

/** Ends the first half of the night early (the week is worked out at once). */
let hurryNight: (() => void) | null = null;

/** The player taps during the night: the clock hurries and the report comes at once. */
export function skipNight(): void {
  if (step.value !== 'night' || !world) return;
  world.hurryClock();
  hurryNight?.();
}

/** The week runs: the Sun crosses the sky, the meters move, the log is written. Solo plays the three parts in a row. */
async function runNight(): Promise<void> {
  if (!world || !state) return;
  const s = state;
  const { clock, seconds } = nightBegin(s);
  // A tap skips the rest of the night (see skipNight).
  await Promise.race([wait(seconds * 0.5), new Promise<void>((resolve) => (hurryNight = resolve))]);
  hurryNight = null;
  if (state !== s) return; // the player left the mission meanwhile

  const record = nightResolve(s);
  await clock;
  if (state !== s) return;
  nightEnd(s, record);
}

/** Night, part 1 (shown on every device): the screen goes dark and the Sun starts to cross the sky. */
function nightBegin(s: MissionState): { clock: Promise<void>; seconds: number } {
  const w = world!;
  stopPlacement();
  step.value = 'night';
  w.setCrewOutside(false); // everyone sleeps indoors
  w.setMode('overview');
  audio.play('night');
  setAmbience();
  const site = s.config.site;
  if (once('nightFact')) say(`lumi.night.${site}`, undefined, 'calm');
  else if (site === 'mars' && once('sunset')) say('lumi.sunset.mars', undefined, 'happy');
  else if (site === 'moon' && once('earth')) say('lumi.earth.moon', undefined, 'happy');
  else hush();
  publish();

  const from = w.getClock();
  // Mars: one full sol stands for the week. Moon: the Sun moves a week along the horizon.
  const to = site === 'mars' ? from + 1 : from + (7 * 12.19074912) / 360;
  const seconds = settings.value.lessMotion ? 2.4 : 3.6;
  return { clock: w.runClock(to, seconds), seconds };
}

/**
 * Night, part 2: the week is worked out (only where the mission is run: solo and the co-op host) and its record is
 * shown. A co-op guest passes the record it received instead of working it out.
 */
function nightResolve(s: MissionState, given?: WeekRecord, shared = false): WeekRecord {
  // `shared`: a co-op device never works the week out: the host did, and `given` is its record.
  if (shared && !given) throw new Error("A shared base needs the host's record");
  const record = given ?? resolveWeek(s);
  lastRecord.value = record;
  if (record.harvested) {
    audio.play('harvest');
    unlockMission(['space_farming']);
  }
  publish();
  return record;
}

/** Night, part 3 (shown on every device): the sky is back, then the report, or the end of the mission. */
function nightEnd(s: MissionState, record: WeekRecord): void {
  const w = world;
  if (!w) return;
  if (s.config.site === 'mars') w.setClock(0.38);

  if (s.end) {
    finishMission();
    return;
  }
  step.value = 'report';
  const rough = record.hungry || record.cropDied || record.evaCaught || record.air < 30;
  w.setMood(rough ? 'sad' : 'happy');
  if (record.built) {
    // A new building stands: a banner, and Lumi says what it does.
    announce(record.built, 0, true, 'building');
    unlockMission(['regolith_bricks', ...(record.built === 'solar_array' ? ['vertical_solar'] : []), ...(record.built === 'workshop' ? ['space_printer'] : [])]);
    say(`lumi.built.${record.built}`, undefined, 'happy');
    audio.play('discover');
  } else {
    // The line fits the week: a storm survived, a slow week, a good one, a hard one.
    const line = rough ? 'lumi.report.bad' : record.storm >= 2 ? 'lumi.report.storm' : record.efficiency < 0.8 ? 'lumi.report.slow' : 'lumi.report.good';
    say(line, undefined, rough ? 'sad' : 'happy');
    audio.play(rough ? 'bad' : 'good');
  }
  publish();
  // A first new building or a first harvest gets its film; otherwise the report gets explained once.
  if (record.built) eventFilm('built');
  else if (record.harvested) eventFilm('harvest');
  else taskFilm('night');
}

export function goNextWeek(): void {
  if (coop) return coopSend('goNextWeek');
  if (!state) return;
  audio.play('click');
  nextWeek(state);
  startWeek();
}

// ---------------------------------------------------------------------------
// The end
// ---------------------------------------------------------------------------

export function missionInsights(): Insight[] {
  return state ? buildInsights(state) : [];
}

function finishMission(): void {
  if (!world || !state) return;
  const s = state;
  const won = s.end === 'complete';
  const badges = earnedBadges(s);
  const fresh = badges.filter((badge) => !profile.value.badges.includes(badge));

  const creative = isCreative(s);
  const bestBefore = { ...profile.value.best };
  unlockMission(['dose_limits']);
  // Cards for winning and for stars come from real missions only (creative mode cannot be lost).
  if (won && !creative) unlockMission(['crew_rest', s.config.site === 'mars' ? 'launch_windows' : 'artemis_radiation']);
  if (s.shield >= 1) unlockMission(['regolith_shield']);
  if (s.stars >= 2 && !creative) unlockMission(['osdr']);
  if (s.stars >= 3 && !creative) unlockMission(['twins_study']);
  if (s.config.site === 'mars') unlockMission(['conjunction']);
  if (s.history.some((record) => record.sunReason === 'dark')) unlockMission(['fission_power']);

  const bestKey = `${s.config.site}.${s.config.difficulty}`;
  if (!creative) {
    updateProfile({
      missions: profile.value.missions + 1,
      badges: [...profile.value.badges, ...fresh],
      best: { ...profile.value.best, [bestKey]: Math.max(profile.value.best[bestKey] ?? 0, s.stars) },
    });
  }
  newBadges.value = creative ? [] : badges;
  newSuits.value = creative ? [] : newlyUnlockedSuits(bestBefore, profile.value.best).filter((color) => !(profile.value.ownedSuits ?? []).includes(color));
  newRank.value = !creative && rankOf(profile.value.best) !== rankOf(bestBefore) ? rankOf(profile.value.best) : null;
  newCards.value = [...cardsThisMission];
  mission.value = structuredClone(s);
  clearMissionSave();

  // The ending film (the lander flies home), then the review. Creative mode has no ending.
  if (!creative && playFilm(won ? 'win' : 'lose', () => showDebrief(won))) return;
  showDebrief(won);
}

function showDebrief(won: boolean): void {
  if (!world) return;
  screen.value = 'debrief';
  hush();
  audio.setAlarm(false);
  audio.play(won ? 'win' : 'lose');
  world.setWeather({ storm: 0 });
  world.setMode('title');
  world.setMood(won ? 'happy' : 'sad');
  world.astronaut.play(won ? 'cheer' : 'none');
  if (world.site === 'mars') world.setClock(won ? 0.742 : 0.8);
}

export function quitMission(): void {
  dropCoop();
  stopFilm();
  world?.eva.abort();
  state = null;
  mission.value = null;
  clearMissionSave();
  goTitle();
}

/** Leave to the menu but keep the mission saved. */
export function leaveToMenu(): void {
  stopFilm();
  // A walk ends first. What was collected counts; during a storm alert the storm counts too.
  if (state && step.value === 'eva') world?.eva.leave();
  dropCoop();
  state = null;
  goTitle();
}

/** Wear a suit colour: kept in the profile and shown on the cadet at once. */
export function wearSuit(color: string): void {
  updateProfile({ suit: color });
  world?.setSuitColor(color);
}

export function playAgain(): void {
  void startMission(profile.value.setup);
}

export function currentStep(): Step {
  return step.value;
}

