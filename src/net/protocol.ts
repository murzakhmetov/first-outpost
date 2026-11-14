/**
 * Crew mode: the messages friends send each other, and the rules for reading them.
 *
 * Everything here is pure (no network, no screen). Nothing a friend sends is ever shown as text:
 * names are numbers (a place in a list of preset crew names), suits are numbers, reactions are
 * ids from a fixed list. A hand-made client cannot put words on another child's screen.
 */
import { addDays } from '../sim/ephemeris';
import { FEATURED_WINDOWS } from '../sim/sites';
import type { Difficulty, EndReason, MissionState, SiteId } from '../sim/types';
import type { Step } from '../game/store';

export const PROTOCOL = 1;
export const MAX_PLAYERS = 4;

/** Room codes: 31 letters and digits, no I, L, O, 0 or 1 (they look alike). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

/** How many preset crew names there are (crew.name.0 ... in src/i18n/crew.ts). */
export const CREW_NAME_COUNT = 16;

/** The suit colours a friend can wear (the same list as SUIT_COLORS in world/astronaut.ts; a test keeps them equal). */
export const CREW_SUITS = ['#ff8a3d', '#39c2f0', '#ff5fa2', '#8f7bff', '#4fd98a', '#ffd166'] as const;

/** The only things a friend can say. */
export const REACTIONS = ['great', 'hooray', 'shield', 'plants', 'power', 'wow', 'thanks', 'oops'] as const;
export type ReactionId = (typeof REACTIONS)[number];
export const REACTION_ICON: Record<ReactionId, string> = {
  great: '👍',
  hooray: '🎉',
  shield: '🛡️',
  plants: '🌱',
  power: '⚡',
  wow: '😮',
  thanks: '🙏',
  oops: '😬',
};

/** Largest message accepted, in characters of JSON. Real messages are under 300. */
export const MAX_MESSAGE_SIZE = 700;

/** Sending limits. */
export const STATUS_MIN_MS = 500;
export const REACTION_MIN_MS = 1000;
export const POSITION_MIN_MS = 200; // at most 5 a second

export const STEPS: readonly Step[] = ['briefing', 'event', 'eventResult', 'plan', 'evaIntro', 'eva', 'evaResult', 'night', 'report'];
const ENDS: readonly EndReason[] = ['complete', 'air', 'food', 'radiation'];
const SITES: readonly SiteId[] = ['mars', 'moon'];
const LEVELS: readonly Difficulty[] = ['cadet', 'commander', 'legend'];
/** Mission lengths the host can pick. */
export const CREW_WEEKS: readonly number[] = [6, 10];

// ----- Room codes -----------------------------------------------------------

export function randomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return code;
}

/** A code typed by a child: capitals, spaces and dashes forgiven. Null when it cannot be a code. */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  for (const letter of code) if (!CODE_ALPHABET.includes(letter)) return null;
  return code;
}

/** The channel a room talks on. */
export function channelName(code: string): string {
  return `fo-crew-${code}`;
}

/** A random id for this visit only. It is never saved, so nobody can follow a player from day to day. */
export function newPlayerId(random: () => number = Math.random): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 10; i++) id += letters[Math.floor(random() * letters.length) % letters.length];
  return id;
}

// ----- Small checks ---------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function int(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** A finite number inside a range, rounded to one decimal. */
function amount(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return null;
  return Math.round(value * 10) / 10;
}

function flag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

const ID_PATTERN = /^[a-z0-9]{6,16}$/;

function playerId(value: unknown): string | null {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : null;
}

function oneOf<T extends string>(value: unknown, list: readonly T[]): T | null {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : null;
}

// ----- Who is in the room (shared as "presence") ---------------------------------

export interface Meta {
  /** Random id of this visit. */
  id: string;
  /** Crew name: a place in the list of preset names. */
  n: number;
  /** Suit colour: a place in CREW_SUITS. */
  c: number;
  /** Ready to start. */
  r: boolean;
  /** Made the room (the host). */
  h: boolean;
  /** Host only: the players who have a seat (at most 4). The host decides who is in the room. */
  m: string[];
  /**
   * Host only: the mission, once the host has started it. The start is a fact of the host's presence (not a
   * message), so a friend who was late or lost the connection for a moment still gets it, and nobody can
   * replay or change it: it lives and dies with the host's own entry.
   */
  p: StartPayload | null;
  /** The mission has started for this player. */
  s: boolean;
  /** When this player came in (ms). Decides who gets a seat when a fifth one tries to join. */
  t: number;
  v: number;
}

export function parseMeta(raw: unknown): Meta | null {
  if (!isRecord(raw)) return null;
  const id = playerId(raw.id);
  const n = int(raw.n, 0, CREW_NAME_COUNT - 1);
  const c = int(raw.c, 0, CREW_SUITS.length - 1);
  const r = flag(raw.r);
  const h = flag(raw.h);
  const s = flag(raw.s);
  const t = int(raw.t, 0, 4e12);
  const v = int(raw.v, 0, 1000);
  if (id === null || n === null || c === null || r === null || h === null || s === null || t === null || v === null) return null;
  let p: StartPayload | null = null;
  if (raw.p !== undefined && raw.p !== null) {
    p = parseStart(raw.p);
    if (p === null) return null;
  }
  let m: string[] = [];
  if (raw.m !== undefined) {
    if (!Array.isArray(raw.m) || raw.m.length > MAX_PLAYERS) return null;
    for (const entry of raw.m) {
      const seat = playerId(entry);
      if (seat === null) return null;
      m.push(seat);
    }
  }
  m = [...new Set(m)];
  return { id, n, c, r, h, s, t, v, m, p };
}

/** The order players are looked at in: the host first, then by arrival, then by id. */
export function seatOrder(a: Meta, b: Meta): number {
  if (a.h !== b.h) return a.h ? -1 : 1;
  if (a.t !== b.t) return a.t - b.t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A crew name nobody in the room has, starting from a wish. */
export function freeName(taken: Iterable<number>, wish: number): number {
  const used = new Set(taken);
  for (let i = 0; i < CREW_NAME_COUNT; i++) {
    const candidate = (wish + i) % CREW_NAME_COUNT;
    if (!used.has(candidate)) return candidate;
  }
  return wish;
}

export function suitIndex(color: string): number {
  const index = (CREW_SUITS as readonly string[]).indexOf(color);
  return index < 0 ? 0 : index;
}

// ----- Messages -------------------------------------------------------------

/** How one friend's outpost is doing. Sent every time it changes (at most twice a second). */
export interface Status {
  week: number;
  step: Step;
  air: number;
  food: number;
  dose: number;
  doseLimit: number;
  science: number;
  stars: number;
  end: EndReason | null;
  /** The strongest solar storm so far: its week (0 = none yet), strength 1-3, whether the crew took cover, dose the shield kept away. */
  storm: { w: number; s: number; k: boolean; a: number };
}

export interface CrewChoice {
  site: SiteId;
  difficulty: Difficulty;
  weeks: number;
  windowId: string;
}

export interface StartPayload {
  choice: CrewChoice;
  seed: number;
  startDate: string;
}

/** Where a friend is while walking outside, in game metres (sent only during a walk). */
export interface Position {
  x: number;
  z: number;
  /** Heading, radians. */
  a: number;
  /** 0 standing, 1 walking, 2 driving the rover. */
  m: number;
}

export type Incoming =
  | { event: 'status'; from: string; status: Status }
  | { event: 'final'; from: string; status: Status }
  | { event: 'react'; from: string; reaction: ReactionId }
  | { event: 'pos'; from: string; pos: Position };

export const EVENT_NAMES = ['status', 'final', 'react', 'pos'] as const;

/** The start date a featured window gives (the same rule as the Setup screen). */
export function startDateOf(windowId: string): string | null {
  const window = FEATURED_WINDOWS.find((candidate) => candidate.id === windowId);
  return window ? addDays(window.anchor, -14) : null;
}

export function parseChoice(raw: unknown): CrewChoice | null {
  if (!isRecord(raw)) return null;
  const site = oneOf(raw.site, SITES);
  const difficulty = oneOf(raw.difficulty, LEVELS);
  const weeks = int(raw.weeks, 1, 99);
  if (site === null || difficulty === null || weeks === null || !CREW_WEEKS.includes(weeks)) return null;
  const id = typeof raw.windowId === 'string' ? raw.windowId : '';
  const window = FEATURED_WINDOWS.find((candidate) => candidate.id === id);
  if (!window || !window.sites.includes(site)) return null;
  return { site, difficulty, weeks, windowId: window.id };
}

export function parseStart(raw: unknown): StartPayload | null {
  if (!isRecord(raw)) return null;
  const choice = parseChoice(raw.choice);
  const seed = int(raw.seed, 0, 2 ** 31 - 1);
  if (choice === null || seed === null || typeof raw.startDate !== 'string') return null;
  // The start date is not free: it is the one the chosen real-history window gives.
  if (raw.startDate !== startDateOf(choice.windowId)) return null;
  return { choice, seed, startDate: raw.startDate };
}

export function parseStatus(raw: unknown): Status | null {
  if (!isRecord(raw)) return null;
  const step = oneOf(raw.step, STEPS);
  const week = int(raw.week, 1, 99);
  const air = amount(raw.air, 0, 100);
  const food = amount(raw.food, 0, 999);
  const dose = amount(raw.dose, 0, 99999);
  const doseLimit = amount(raw.doseLimit, 0, 99999);
  const science = amount(raw.science, 0, 99999);
  const stars = int(raw.stars, 0, 3);
  const end = raw.end === null ? null : oneOf(raw.end, ENDS);
  if (raw.end !== null && end === null) return null;
  if (!isRecord(raw.storm)) return null;
  const w = int(raw.storm.w, 0, 99);
  const s = int(raw.storm.s, 0, 3);
  const k = flag(raw.storm.k);
  const a = amount(raw.storm.a, 0, 99999);
  if (step === null || week === null || air === null || food === null || dose === null || doseLimit === null || science === null) return null;
  if (stars === null || w === null || s === null || k === null || a === null) return null;
  return { week, step, air, food, dose, doseLimit, science, stars, end, storm: { w, s, k, a } };
}

function parsePosition(raw: unknown): Position | null {
  if (!isRecord(raw)) return null;
  const fine = (value: unknown, min: number, max: number): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return null;
    return Math.round(value * 100) / 100;
  };
  const x = fine(raw.x, -500, 500);
  const z = fine(raw.z, -500, 500);
  const a = fine(raw.a, -10, 10);
  const m = int(raw.m, 0, 2);
  if (x === null || z === null || a === null || m === null) return null;
  return { x, z, a, m };
}

/**
 * Check one message from the network. Returns null for anything unknown, too big or not shaped
 * exactly right. The result is rebuilt from the checked fields, so nothing extra comes through.
 */
export function parseMessage(event: string, raw: unknown): Incoming | null {
  if (!(EVENT_NAMES as readonly string[]).includes(event)) return null;
  if (!isRecord(raw)) return null;
  let size: number;
  try {
    size = JSON.stringify(raw).length;
  } catch {
    return null;
  }
  if (size > MAX_MESSAGE_SIZE) return null;
  const from = playerId(raw.from);
  if (from === null) return null;
  switch (event) {
    case 'status':
    case 'final': {
      const status = parseStatus(raw);
      return status ? { event, from, status } : null;
    }
    case 'react': {
      const reaction = oneOf(raw.id, REACTIONS);
      return reaction ? { event, from, reaction } : null;
    }
    case 'pos': {
      const pos = parsePosition(raw);
      return pos ? { event, from, pos } : null;
    }
    default:
      return null;
  }
}

// ----- Building what we send ---------------------------------------------------

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** The numbers a friend sees about this outpost. Only numbers: nothing about the player. */
export function statusOf(m: MissionState, step: Step): Status {
  let storm = { w: 0, s: 0, k: false, a: 0 };
  for (const record of m.history) {
    const strength = m.plan[record.week - 1]?.storm.strength ?? 0;
    if (strength > storm.s) storm = { w: record.week, s: strength, k: !!record.sheltered, a: round1(record.doseAvoided ?? 0) };
  }
  return {
    week: Math.max(1, Math.min(99, m.week)),
    step,
    air: round1(m.air),
    food: round1(m.food),
    dose: round1(m.dose),
    doseLimit: round1(m.doseLimit),
    science: round1(m.science),
    stars: Math.max(0, Math.min(3, m.stars)),
    end: m.end,
    storm,
  };
}

/** Wire form of a message to send. */
export function wire(from: string, body: Record<string, unknown>): Record<string, unknown> {
  return { from, ...body };
}

export function statusToWire(from: string, status: Status): Record<string, unknown> {
  return wire(from, { ...status });
}

// ----- Comparing players (the debrief) --------------------------------------

/** What fraction of the radiation limit the crew used. */
export function doseShare(status: Status): number {
  return status.doseLimit > 0 ? status.dose / status.doseLimit : 0;
}

/** One line about a friend's biggest choice: which text and what it needs. */
export function highlightOf(status: Status): { key: 'crew.line.shelter' | 'crew.line.shield' | 'crew.line.storm' | 'crew.line.calm'; week: number } {
  const storm = status.storm;
  if (storm.s === 0) return { key: 'crew.line.calm', week: 0 };
  if (storm.k) return { key: 'crew.line.shelter', week: storm.w };
  if (storm.a > 0) return { key: 'crew.line.shield', week: storm.w };
  return { key: 'crew.line.storm', week: storm.w };
}

export interface Award {
  safest: string | null;
  science: string | null;
  stars: string | null;
}

/** Who won each prize. Only players who finished take part; ties go to the first. */
export function awards(finished: { id: string; status: Status }[]): Award {
  let safest: { id: string; share: number } | null = null;
  let science: { id: string; value: number } | null = null;
  let stars: { id: string; value: number } | null = null;
  for (const entry of finished) {
    const status = entry.status;
    if (status.end === 'complete') {
      const share = doseShare(status);
      if (!safest || share < safest.share) safest = { id: entry.id, share };
    }
    if (!science || status.science > science.value) science = { id: entry.id, value: status.science };
    if (!stars || status.stars > stars.value) stars = { id: entry.id, value: status.stars };
  }
  return { safest: safest?.id ?? null, science: science?.id ?? null, stars: stars && stars.value > 0 ? stars.id : null };
}
