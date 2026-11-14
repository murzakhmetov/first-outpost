/**
 * The game's shared state: what screen is showing, the mission, settings,
 * and the player's progress (kept on this device only).
 */
import { signal } from '@preact/signals';
import type { Params } from '../i18n';
import type { ChoiceResult, EarthAnswer } from '../sim/mission';
import type { GameId, RoomId, ToolId } from '../sim/outpost';
import type { InteriorHud } from '../world/interior';
import type { Difficulty, EvaResult, MissionState, SiteId, SunMode, WeekRecord } from '../sim/types';
import type { EvaHud } from '../world/eva';
import type { Mood } from '../world/lumi';
import type { QualityChoice, QualityTier } from '../world/quality';

export type Screen = 'title' | 'setup' | 'game' | 'debrief';
export type Panel = 'none' | 'codex' | 'settings' | 'about' | 'help' | 'pause' | 'outpost';
export type Step = 'briefing' | 'event' | 'eventResult' | 'plan' | 'evaIntro' | 'eva' | 'evaResult' | 'night' | 'report';
export type OutpostTab = 'build' | 'workshop' | 'rooms' | 'decor';

export interface Settings {
  quality: QualityChoice;
  fpsLimit: number;
  showFps: boolean;
  volume: number;
  music: number;
  textScale: number;
  speak: boolean;
  lessMotion: boolean;
  patterns: boolean;
  leftHand: boolean;
  /** Walks are seen through the cadet's eyes. */
  firstPerson: boolean;
}

export interface SetupChoice {
  site: SiteId;
  difficulty: Difficulty;
  weeks: number;
  sunMode: SunMode;
  windowId: string;
  tutorial: boolean;
  /** Creative mode: build freely, no limits, no losing. */
  creative?: boolean;
}

export interface Profile {
  /** Suit colours worn before they became rewards (they stay open). */
  ownedSuits?: string[];
  name: string;
  suit: string;
  /** Science log cards found. */
  unlocked: string[];
  /** Cards the player has opened. */
  read: string[];
  badges: string[];
  missions: number;
  /** Best star rating per world. */
  best: Record<string, number>;
  setup: SetupChoice;
  /** Worlds whose intro film the player has seen (it plays by itself only the first time). */
  introSeen?: string[];
}

export interface LumiLine {
  key: string;
  params?: Params;
  mood: Mood;
  /** Changes with every new line, so the bubble can animate. */
  id: number;
}

export interface Toast {
  key: string;
  params?: Params;
  id: number;
  tone: 'good' | 'info' | 'warn';
}

const DEFAULT_SETTINGS: Settings = {
  quality: 'auto',
  fpsLimit: 60,
  showFps: false,
  volume: 0.8,
  music: 0.5,
  textScale: 1,
  speak: false,
  lessMotion: false,
  patterns: false,
  leftHand: false,
  firstPerson: false,
};

const DEFAULT_PROFILE: Profile = {
  name: '',
  suit: '#ff8a3d',
  unlocked: [],
  read: [],
  badges: [],
  missions: 0,
  best: {},
  setup: { site: 'mars', difficulty: 'cadet', weeks: 6, sunMode: 'featured', windowId: 'may2024', tutorial: true },
};

function sameKind(value: unknown, sample: unknown): boolean {
  if (Array.isArray(sample)) return Array.isArray(value);
  if (sample !== null && typeof sample === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === typeof sample;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const stored = JSON.parse(raw) as Record<string, unknown>;
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return fallback;
    // A field that has the wrong kind of value (a hand-edited or damaged save) falls back to the default.
    const merged: Record<string, unknown> = { ...(fallback as Record<string, unknown>) };
    for (const [name, value] of Object.entries(stored)) {
      const sample = (fallback as Record<string, unknown>)[name];
      if (sample !== undefined && !sameKind(value, sample)) continue;
      merged[name] = value;
    }
    return merged as T;
  } catch {
    return fallback;
  }
}

/** Returns false when the browser would not store it (full or blocked): the game still works, it just forgets. */
function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const screen = signal<Screen>('title');
export const panel = signal<Panel>('none');
export const step = signal<Step>('briefing');
export const loading = signal(true);
export const fading = signal(false);

export const settings = signal<Settings>(load('fo.settings', DEFAULT_SETTINGS));
export const profile = signal<Profile>(load('fo.profile', DEFAULT_PROFILE));
/** A copy of the mission, replaced after every change so the screen updates. */
export const mission = signal<MissionState | null>(null);
export const lumiLine = signal<LumiLine | null>(null);
export const toast = signal<Toast | null>(null);
export const evaHud = signal<EvaHud | null>(null);
export const eventResult = signal<ChoiceResult | null>(null);
export const earthAnswer = signal<EarthAnswer | null>(null);
export const evaResult = signal<{ result: EvaResult; reason: 'home' | 'timeout' | 'caught' | 'recall' } | null>(null);
export const lastRecord = signal<WeekRecord | null>(null);
/** Cards unlocked during the mission that just ended. */
export const newCards = signal<string[]>([]);
export const newBadges = signal<string[]>([]);
/** Suit colours opened by the mission that just ended. */
export const newSuits = signal<string[]>([]);
/** A room game whose win card is on screen (the reward is paid then, not when the card is closed). */
export const roomWon = signal<string | null>(null);
/** The rank reached by the mission that just ended (null when it did not change). */
export const newRank = signal<string | null>(null);
/** Which quality level Auto has settled on. */
export const autoTier = signal<QualityTier>('medium');
export const fps = signal(60);
/** True when a saved mission can be continued. */
export const hasSave = signal(false);
/** Card to open in the science log. */
export const codexFocus = signal<string | null>(null);
/** A discovery just made outside: shown as a banner for a few seconds. */
/** Which tab of the Outpost menu is showing. */
export const outpostTab = signal<OutpostTab>('build');
/** The building the cadet is inside, or null when outside or in the overview. */
export const room = signal<RoomId | null>(null);
/** Inside: the station the cadet stands at. */
export const interiorHud = signal<InteriorHud | null>(null);
/** Inside: the small game being played at a station, or null. */
export const roomGame = signal<GameId | null>(null);
/** The workshop printer game: the tool being printed, or null. */
export const printing = signal<ToolId | null>(null);
/** The intro film is playing. */
export const cutscene = signal(false);
/** Creative mode: the thing being put on the ground, and whether the spot under the pointer is free. */
export const placing = signal<{ kind: 'building' | 'decor'; id: string; valid: boolean } | null>(null);
export const discovery = signal<{ id: string; science: number; fresh: boolean; key: number; kind: 'find' | 'building' } | null>(null);

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
  save('fo.settings', settings.value);
}

export function updateProfile(patch: Partial<Profile>): void {
  profile.value = { ...profile.value, ...patch };
  save('fo.profile', profile.value);
}

export function resetProgress(): void {
  profile.value = { ...DEFAULT_PROFILE, name: profile.value.name, suit: profile.value.suit, ownedSuits: [profile.value.suit] };
  save('fo.profile', profile.value);
  clearMissionSave();
}

let lineId = 0;
let lineTimer = 0;
/** Lumi says something. With `seconds`, the bubble closes by itself (used while walking outside). */
export function say(key: string, params?: Params, mood: Mood = 'calm', seconds = 0): void {
  window.clearTimeout(lineTimer);
  const id = ++lineId;
  lumiLine.value = { key, params, mood, id };
  if (seconds > 0) {
    lineTimer = window.setTimeout(() => {
      if (lumiLine.value?.id === id) lumiLine.value = null;
    }, seconds * 1000);
  }
}

export function hush(): void {
  window.clearTimeout(lineTimer);
  lumiLine.value = null;
}

/** One line in the list of things picked up on a walk. */
export interface Pickup {
  id: number;
  kind: 'sample' | 'chore' | 'find' | 'material';
  key: string;
  params?: Params;
  /** What it gives (0 = nothing to show). */
  value: number;
  unit: 'science' | 'air' | 'regolith' | 'metal';
}

export const pickups = signal<Pickup[]>([]);
let pickupId = 0;
/** Add a line to the pickup list. Each line leaves by itself; at most four show at once. */
export function pickup(item: Omit<Pickup, 'id'>): void {
  const id = ++pickupId;
  pickups.value = [...pickups.value, { ...item, id }].slice(-4);
  window.setTimeout(() => {
    pickups.value = pickups.value.filter((line) => line.id !== id);
  }, 3800);
}

let discoveryKey = 0;
let discoveryTimer = 0;
/** Show the discovery banner. */
export function announce(id: string, science: number, fresh: boolean, kind: 'find' | 'building' = 'find'): void {
  discovery.value = { id, science, fresh, key: ++discoveryKey, kind };
  window.clearTimeout(discoveryTimer);
  discoveryTimer = window.setTimeout(() => {
    discovery.value = null;
  }, 4600);
}

let toastId = 0;
let toastTimer = 0;
export function notify(key: string, params?: Params, tone: Toast['tone'] = 'info', seconds = 3.2): void {
  toast.value = { key, params, tone, id: ++toastId };
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = null;
  }, seconds * 1000);
}

// ----- Saved mission --------------------------------------------------------

const SAVE_KEY = 'fo.mission';
const SAVE_VERSION = 3;

let saveWarned = false;

export function saveMission(state: MissionState, currentStep: Step): void {
  if (save(SAVE_KEY, { version: SAVE_VERSION, step: currentStep, state })) {
    hasSave.value = true;
    saveWarned = false;
  } else if (!saveWarned) {
    // Full or blocked storage: the mission goes on, but Continue would bring back an older week.
    saveWarned = true;
    notify('toast.saveFailed', undefined, 'warn', 6);
  }
}

export function loadMissionSave(): { state: MissionState; step: Step } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version: number; step: Step; state: MissionState };
    // A finished mission is kept too: its review may not have been shown yet.
    if (parsed.version !== SAVE_VERSION || !parsed.state?.plan?.length) return null;
    return { state: parsed.state, step: parsed.step };
  } catch {
    return null;
  }
}

export function clearMissionSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
  hasSave.value = false;
}

hasSave.value = loadMissionSave() !== null;
