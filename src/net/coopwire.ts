/**
 * Shared base ("One base together"): what travels on the wire, and how it is read back.
 *
 * Four messages (names in protocol.ts COOP_EVENT_NAMES):
 *   st    host -> everybody   the live state of the one mission plus the co-op meta (stage, ready, votes ...)
 *   rec   host -> everybody   one finished week (WeekRecord), at the night and for a resync
 *   int   guest -> host       one intent (sim/coop.ts Intent: ready, vote, alloc, build ...)
 *   sync  guest -> host       "I have this many weeks, send me the state and what I miss"
 *
 * Like the rest of the network code, everything here is numbers, true/false and ids from fixed lists:
 * never free text. A message that reaches the game is REBUILT field by field from checked values,
 * so extra fields do not come through, and nothing a hand-made client sends can put a string on a
 * child's screen or push a number outside what the game can reach.
 *
 * What does not travel: `config` (comes with the start), `plan` (every device builds its own from the
 * seed), `history` (comes one record at a time as `rec`), `decor` (creative mode is off in a crew).
 *
 * Pure: no network, no screen, no clock.
 */
import { EVENTS } from '../sim/events';
import { FINDS } from '../sim/finds';
import { parseIntent } from '../sim/coop';
import type { Contribution, CoopMeta, CoopStage, Intent } from '../sim/coop';
import { COOP_STAGES } from '../sim/coop';
import type { CoopSim } from '../sim/coop';
import type { ChoiceResult } from '../sim/mission';
import { BUILDINGS, ROOMS, TOOLS } from '../sim/outpost';
import type { BuildingId, Construction, ToolId } from '../sim/outpost';
import { MAX_LEVEL, MODULES } from '../sim/types';
import type {
  Alloc,
  Effects,
  EndReason,
  EvaResult,
  MissionState,
  Modifier,
  OptionId,
  Phase,
  SunReason,
  WeekNow,
  WeekParts,
  WeekRecord,
} from '../sim/types';
import { coopMeta } from '../sim/coop';
import { COOP_EVENT_NAMES, isRecord, playerId, sizeLimit } from './protocol';
import type { CoopEventName } from './protocol';

// ----- The fixed lists every id is checked against ----------------------------------

const PHASES: readonly Phase[] = ['briefing', 'event', 'plan', 'eva', 'night', 'report', 'ended'];
const ENDS: readonly EndReason[] = ['complete', 'air', 'food', 'radiation'];
const OPTIONS: readonly OptionId[] = ['a', 'b', 'c'];
const REASONS: readonly SunReason[] = ['clear', 'dust', 'dark'];
const BUILDING_IDS: readonly BuildingId[] = BUILDINGS.map((b) => b.id);
const TOOL_IDS: readonly ToolId[] = TOOLS.map((t) => t.id);
const ROOM_GAMES: readonly string[] = ROOMS.flatMap((room) => room.games.map((item) => `${room.id}:${item.game}`));
const FIND_IDS: readonly string[] = [...FINDS.mars, ...FINDS.moon].map((f) => f.id);
const EVENT_IDS: readonly string[] = Object.keys(EVENTS);
/** Codex cards: the ones a card gives, and the four the night gives (sim/mission.ts resolveWeek). */
const CODEX_IDS: readonly string[] = [...new Set([...Object.values(EVENTS).map((event) => event.codex), 'space_farming', 'space_weather', 'dust_storm', 'polar_light'])];
/** Lasting effects (sim/events.ts) and one per building (sim/outpost.ts). */
const MODIFIER_IDS: readonly string[] = ['spare_panel', 'broken_panel', 'rested', 'tired', 'weak_signal', 'ice_melter', 'oxygen_maker', ...BUILDING_IDS.map((id) => `building:${id}`)];
/** Mission flags: the ones the cards set, the ones sim/mission.ts sets, and one per discovery (sim/finds.ts). */
const FLAG_IDS: readonly string[] = [
  ...new Set(Object.values(EVENTS).flatMap((event) => event.options.flatMap((option) => (option.flag ? [option.flag] : [])))),
  'asked_earth',
  'did_chore',
  'collected_sample',
  'outran_storm',
  'wasted_power',
  'went_hungry',
  ...FIND_IDS.map((id) => `found_${id}`),
];
/** Text keys that explain why a walk is not allowed. */
const EVA_BLOCKS: readonly string[] = ['eva.blockShelter'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ----- Reading with throw-on-wrong -----------------------------------------------------

class Bad extends Error {}
const bad = (): never => {
  throw new Bad('bad message');
};

function guard<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

const has = (o: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

function obj(raw: unknown): Record<string, unknown> {
  return isRecord(raw) ? raw : bad();
}

function nint(raw: unknown, min: number, max: number): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max ? raw : bad();
}

/** A finite number inside a range. Kept exactly as it is (the host's numbers are not rounded on the way). */
function nnum(raw: unknown, min: number, max: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= min && raw <= max ? raw : bad();
}

function nbool(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : bad();
}

function nid<T extends string>(raw: unknown, list: readonly T[]): T {
  return typeof raw === 'string' && (list as readonly string[]).includes(raw) ? (raw as T) : bad();
}

function nlist(raw: unknown, max: number): unknown[] {
  return Array.isArray(raw) && raw.length <= max ? raw : bad();
}

/** A list of ids from a fixed list. No repeats, unless `repeats` (the cards used: a storm card can come twice). */
function nids<T extends string>(raw: unknown, list: readonly T[], max: number, repeats = false): T[] {
  const out: T[] = [];
  for (const item of nlist(raw, max)) {
    const id = nid(item, list);
    if (!repeats && out.includes(id)) bad();
    out.push(id);
  }
  return out;
}

/** The value of an optional field: undefined when it is missing, otherwise it must read. */
function opt<T>(o: Record<string, unknown>, key: string, read: (raw: unknown) => T): T | undefined {
  return has(o, key) && o[key] !== undefined ? read(o[key]) : undefined;
}

function seatId(raw: unknown): string {
  const id = playerId(raw);
  return id === null ? bad() : id;
}

const BIG = 99999;

function readAlloc(raw: unknown): Alloc {
  const o = obj(raw);
  const alloc: Alloc = { life: 0, farm: 0, lab: 0, shield: 0 };
  for (const id of MODULES) alloc[id] = nint(o[id], 0, MAX_LEVEL[id]);
  return alloc;
}

const EFFECT_KEYS = ['cells', 'air', 'food', 'dose', 'science', 'shield', 'crop', 'batteryCap'] as const;

function readEffects(raw: unknown): Effects {
  const o = obj(raw);
  const fx: Effects = {};
  for (const key of EFFECT_KEYS) {
    const value = opt(o, key, (v) => nnum(v, -BIG, BIG));
    if (value !== undefined) fx[key] = value;
  }
  return fx;
}

// ----- A walk, as stored in the week's state ---------------------------------------------

function readEva(raw: unknown): EvaResult {
  const o = obj(raw);
  const eva: EvaResult = {
    seconds: nnum(o.seconds, 0, 999),
    samples: nint(o.samples, 0, 6),
    science: nnum(o.science, 0, 99),
    chore: nbool(o.chore),
    caught: nbool(o.caught),
    alerted: nbool(o.alerted),
  };
  const finds = opt(o, 'finds', (v) => nids(v, FIND_IDS, 4));
  if (finds) eva.finds = finds;
  const materials = opt(o, 'materials', (v) => {
    const m = obj(v);
    return { regolith: nint(m.regolith, 0, 99), metal: nint(m.metal, 0, 99) };
  });
  if (materials) eva.materials = materials;
  const share = opt(o, 'caughtShare', (v) => nnum(v, 0, 1));
  if (share !== undefined) eva.caughtShare = share;
  const vest = opt(o, 'vest', nbool);
  if (vest !== undefined) eva.vest = vest;
  return eva;
}

// ----- The live part of the mission ("st") ------------------------------------------------

/** MissionState without the parts that never travel. */
export type LiveState = Omit<MissionState, 'config' | 'plan' | 'history' | 'decor'>;

/** Pick the live part out of a mission, as a deep copy (so a later change cannot reach a message already built). */
export function liveOf(m: MissionState): LiveState {
  return JSON.parse(JSON.stringify(livePick(m))) as LiveState;
}

function livePick(m: MissionState): LiveState {
  return {
    week: m.week,
    phase: m.phase,
    battery: m.battery,
    batteryCap: m.batteryCap,
    air: m.air,
    food: m.food,
    dose: m.dose,
    doseLimit: m.doseLimit,
    science: m.science,
    shield: m.shield,
    crop: m.crop,
    neglect: m.neglect,
    hungry: m.hungry,
    harvests: m.harvests,
    panelDust: m.panelDust,
    alloc: m.alloc,
    modifiers: m.modifiers,
    usedEvents: m.usedEvents,
    stormCards: m.stormCards,
    flags: m.flags,
    now: m.now,
    end: m.end,
    stars: m.stars,
    unlocked: m.unlocked,
    stock: m.stock,
    buildings: m.buildings,
    tools: m.tools,
  };
}

function readModifier(raw: unknown): Modifier {
  const o = obj(raw);
  const mod: Modifier = { id: nid(o.id, MODIFIER_IDS), weeks: nint(o.weeks, 0, 99) };
  const permanent = opt(o, 'permanent', nbool);
  if (permanent !== undefined) mod.permanent = permanent;
  const delayed = opt(o, 'delayed', nbool);
  if (delayed !== undefined) mod.delayed = delayed;
  for (const key of ['solarFlat', 'scienceFactor', 'airPerWeek', 'foodPerWeek', 'sciencePerWeek', 'stormFactor'] as const) {
    const value = opt(o, key, (v) => nnum(v, -99, 99));
    if (value !== undefined) mod[key] = value;
  }
  return mod;
}

function readNow(raw: unknown): WeekNow {
  const o = obj(raw);
  const eventId = o.eventId === null ? null : nid(o.eventId, EVENT_IDS);
  const optionId = o.optionId === null ? null : nid(o.optionId, OPTIONS);
  const advice = o.advice === null ? null : nid(o.advice, OPTIONS);
  const now: WeekNow = {
    solar: nnum(o.solar, -99, 99),
    available: nnum(o.available, -999, 999),
    eventId,
    optionId,
    advice,
    eventDone: nbool(o.eventDone),
    askedEarth: nbool(o.askedEarth),
    sheltered: nbool(o.sheltered),
    scienceFactor: nnum(o.scienceFactor, 0, 99),
    ration: nbool(o.ration),
    eventFx: readEffects(o.eventFx),
    cleaned: nbool(o.cleaned),
    eva: o.eva === null ? null : readEva(o.eva),
    evaAllowed: nbool(o.evaAllowed),
    evaBlock: o.evaBlock === null ? null : nid(o.evaBlock, EVA_BLOCKS),
  };
  const fallback = opt(o, 'adviceFallback', nbool);
  if (fallback !== undefined) now.adviceFallback = fallback;
  const finds = opt(o, 'finds', (v) => nids(v, FIND_IDS, 4));
  if (finds) now.finds = finds;
  const games = opt(o, 'games', (v) => nids(v, ROOM_GAMES, 4));
  if (games) now.games = games;
  const roomFx = opt(o, 'roomFx', readEffects);
  if (roomFx) now.roomFx = roomFx;
  const evaAir = opt(o, 'evaAir', (v) => nnum(v, -100, 100));
  if (evaAir !== undefined) now.evaAir = evaAir;
  const iceAir = opt(o, 'iceAir', (v) => nnum(v, -100, 100));
  if (iceAir !== undefined) now.iceAir = iceAir;
  const start = opt(o, 'start', (v) => {
    const s = obj(v);
    const out: NonNullable<WeekNow['start']> = { air: nnum(s.air, 0, 100), food: nnum(s.food, 0, 999), science: nnum(s.science, 0, BIG) };
    const battery = opt(s, 'battery', (b) => nnum(b, 0, 999));
    if (battery !== undefined) out.battery = battery;
    return out;
  });
  if (start) now.start = start;
  const alerted = opt(o, 'evaAlerted', nbool);
  if (alerted !== undefined) now.evaAlerted = alerted;
  return now;
}

function readConstruction(raw: unknown): Construction {
  const o = obj(raw);
  return { id: nid(o.id, BUILDING_IDS), progress: nnum(o.progress, 0, 99), done: nbool(o.done) };
}

function readLive(raw: unknown): LiveState {
  const o = obj(raw);
  const live: LiveState = {
    week: nint(o.week, 1, 99),
    phase: nid(o.phase, PHASES),
    battery: nnum(o.battery, 0, 999),
    batteryCap: nnum(o.batteryCap, 0, 999),
    air: nnum(o.air, 0, 100),
    food: nnum(o.food, 0, 999),
    dose: nnum(o.dose, 0, BIG),
    doseLimit: nnum(o.doseLimit, 0, BIG),
    science: nnum(o.science, 0, BIG),
    shield: nnum(o.shield, 0, 1),
    crop: nnum(o.crop, 0, 99),
    neglect: nint(o.neglect, 0, 99),
    hungry: nint(o.hungry, 0, 99),
    harvests: nint(o.harvests, 0, 99),
    panelDust: nnum(o.panelDust, 0, 1),
    alloc: readAlloc(o.alloc),
    modifiers: nlist(o.modifiers, 24).map(readModifier),
    usedEvents: nids(o.usedEvents, EVENT_IDS, 99, true),
    stormCards: nint(o.stormCards, 0, 99),
    // On the wire the flags are a list of the names that are set.
    flags: Object.fromEntries(nids(o.flags, FLAG_IDS, FLAG_IDS.length).map((id) => [id, true])),
    now: readNow(o.now),
    end: o.end === null ? null : nid(o.end, ENDS),
    stars: nint(o.stars, 0, 3),
    unlocked: nids(o.unlocked, CODEX_IDS, 99),
  };
  const stock = opt(o, 'stock', (v) => {
    const s = obj(v);
    return { regolith: nint(s.regolith, 0, 999), metal: nint(s.metal, 0, 999) };
  });
  if (stock) live.stock = stock;
  const buildings = opt(o, 'buildings', (v) => nlist(v, BUILDING_IDS.length).map(readConstruction));
  if (buildings) {
    if (new Set(buildings.map((b) => b.id)).size !== buildings.length) bad();
    live.buildings = buildings;
  }
  const tools = opt(o, 'tools', (v) => nids(v, TOOL_IDS, TOOL_IDS.length));
  if (tools) live.tools = tools;
  return live;
}

// ----- The co-op meta ("st") -----------------------------------------------------------

function readChoice(raw: unknown): ChoiceResult {
  const o = obj(raw);
  return {
    eventId: nid(o.eventId, EVENT_IDS),
    optionId: nid(o.optionId, OPTIONS),
    fx: readEffects(o.fx),
    advice: o.advice === null ? null : nid(o.advice, OPTIONS),
  };
}

/**
 * A map from seat to something. With `anyone` false only seats still in the crew are keys; with `anyone` true a
 * seat that has left may stay (its counter and its walk result do: sim/coop.ts keeps them), but there are never
 * more than four keys, and every key is a player id.
 */
function seatMap<T>(raw: unknown, seats: readonly string[], read: (value: unknown) => T, anyone = false): Record<string, T> {
  const o = obj(raw);
  const keys = Object.keys(o);
  if (keys.length > 4) bad();
  const out: Record<string, T> = {};
  for (const key of keys) {
    if (anyone ? playerId(key) === null : !seats.includes(key)) bad();
    out[key] = read(o[key]);
  }
  return out;
}

function seatList(raw: unknown, seats: readonly string[], anyone = false): string[] {
  const out: string[] = [];
  for (const item of nlist(raw, 4)) {
    const id = seatId(item);
    if ((!anyone && !seats.includes(id)) || out.includes(id)) bad();
    out.push(id);
  }
  return out;
}

function readContribution(raw: unknown): Contribution {
  const o = obj(raw);
  return { samples: nint(o.samples, 0, 999), finds: nint(o.finds, 0, 999), games: nint(o.games, 0, 999), prints: nint(o.prints, 0, 999), votes: nint(o.votes, 0, 999) };
}

function readMeta(o: Record<string, unknown>, from: string): CoopMeta {
  const seats: string[] = [];
  for (const item of nlist(o.seats, 4)) {
    const id = seatId(item);
    if (seats.includes(id)) bad();
    seats.push(id);
  }
  // The commander is the first seat, and it is the sender: nobody else can send the state.
  if (seats.length < 1 || seats[0] !== from) bad();
  const meta: CoopMeta = {
    stage: nid<CoopStage>(o.stage, COOP_STAGES),
    rev: nint(o.rev, 0, 1e9),
    week: nint(o.week, 1, 99),
    seats,
    ready: seatList(o.ready, seats),
    votes: seatMap(o.votes, seats, (v) => nid(v, OPTIONS)),
    walk: seatMap(o.walk, seats, nbool),
    outside: nbool(o.outside),
    returned: seatList(o.returned, seats, true),
    left: o.left === null ? null : nint(o.left, 0, 999),
    acks: seatMap(o.acks, seats, (v) => nint(v, 0, 1_000_000), true),
    choice: o.choice === null ? null : readChoice(o.choice),
  };
  if (o.contrib !== undefined) meta.contrib = seatMap(o.contrib, seats, readContribution, true);
  return meta;
}

/** What a guest reads from one `st`. */
export interface CoopSnapshot {
  meta: CoopMeta;
  live: LiveState;
}

/** The body of an `st` message: the co-op meta and the live state (the host's seat id goes in `from`). */
export function encodeSnapshot(from: string, co: CoopSim, now: number): Record<string, unknown> {
  const meta = coopMeta(co, now);
  const live = livePick(co.mission);
  return { from, ...meta, s: { ...live, flags: Object.keys(live.flags).filter((id) => live.flags[id]) } };
}

/** Read an `st` body. The sender is `from`. Null when anything is off. */
export function parseSnapshot(raw: unknown, from: string): CoopSnapshot | null {
  return guard(() => {
    const o = obj(raw);
    const meta = readMeta(o, from);
    const live = readLive(o.s);
    if (meta.week !== live.week) bad();
    return { meta, live };
  });
}

// ----- A finished week ("rec") ------------------------------------------------------------

const PART_KEYS = ['airLife', 'airBonus', 'airEvent', 'airEva', 'doseGcr', 'doseStorm', 'doseEvent', 'sciLab', 'sciEva', 'sciEvent', 'foodEaten', 'foodHarvest', 'foodEvent', 'shield', 'crop'] as const;
const PART_OPTIONAL = ['sciFinds', 'sciBuild', 'foodBuild', 'build', 'airIce', 'airRooms', 'sciRooms', 'foodRooms'] as const;

function readParts(raw: unknown): WeekParts {
  const o = obj(raw);
  const parts = {} as WeekParts;
  for (const key of PART_KEYS) parts[key] = nnum(o[key], -BIG, BIG);
  for (const key of PART_OPTIONAL) {
    const value = opt(o, key, (v) => nnum(v, -BIG, BIG));
    if (value !== undefined) parts[key] = value;
  }
  return parts;
}

/** A real calendar day, written YYYY-MM-DD (the guest also checks it against its own plan: adoptRecord). */
function readDate(raw: unknown): string {
  if (typeof raw !== 'string' || !DATE.test(raw)) return bad();
  const day = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== raw ? bad() : raw;
}

function readRecord(raw: unknown): WeekRecord {
  const o = obj(raw);
  const record: WeekRecord = {
    week: nint(o.week, 1, 99),
    dateFrom: readDate(o.dateFrom),
    dateTo: readDate(o.dateTo),
    alloc: readAlloc(o.alloc),
    solar: nnum(o.solar, -99, 99),
    available: nnum(o.available, -999, 999),
    used: nnum(o.used, -999, 999),
    wasted: nnum(o.wasted, -999, 999),
    sunReason: nid(o.sunReason, REASONS),
    battery: nnum(o.battery, 0, 999),
    air: nnum(o.air, 0, 100),
    food: nnum(o.food, 0, 999),
    dose: nnum(o.dose, 0, BIG),
    science: nnum(o.science, 0, BIG),
    shield: nnum(o.shield, 0, 1),
    crop: nnum(o.crop, 0, 99),
    parts: readParts(o.parts),
    eventId: o.eventId === null ? null : nid(o.eventId, EVENT_IDS),
    optionId: o.optionId === null ? null : nid(o.optionId, OPTIONS),
    adviceId: o.adviceId === null ? null : nid(o.adviceId, OPTIONS),
    askedEarth: nbool(o.askedEarth),
    sheltered: nbool(o.sheltered),
    storm: nint(o.storm, 0, 3),
    doseAvoided: nnum(o.doseAvoided, 0, BIG),
    harvested: nbool(o.harvested),
    cropDied: nbool(o.cropDied),
    hungry: nbool(o.hungry),
    evaSamples: nint(o.evaSamples, 0, 6),
    evaCaught: nbool(o.evaCaught),
    efficiency: nnum(o.efficiency, -BIG, BIG),
  };
  const wall = opt(o, 'doseWall', (v) => nnum(v, 0, BIG));
  if (wall !== undefined) record.doseWall = wall;
  if (has(o, 'built') && o.built !== undefined) record.built = o.built === null ? null : nid(o.built, BUILDING_IDS);
  return record;
}

export function encodeRecord(from: string, record: WeekRecord): Record<string, unknown> {
  return { from, r: record };
}

export function parseRecord(raw: unknown): WeekRecord | null {
  return guard(() => readRecord(obj(raw).r));
}

// ----- Intents and the resync request -------------------------------------------------------

export function encodeIntent(intent: Intent): Record<string, unknown> {
  return { ...intent };
}

export function encodeSync(from: string, have: number): Record<string, unknown> {
  return { from, have };
}

export function parseSync(raw: unknown): number | null {
  return guard(() => nint(obj(raw).have, 0, 99));
}

// ----- One message, whatever it is ------------------------------------------------------------

export type CoopIncoming =
  | { event: 'st'; from: string; snap: CoopSnapshot }
  | { event: 'rec'; from: string; rec: WeekRecord }
  | { event: 'int'; from: string; intent: Intent }
  | { event: 'sync'; from: string; have: number };

export function isCoopEvent(event: string): event is CoopEventName {
  return (COOP_EVENT_NAMES as readonly string[]).includes(event);
}

/** Who the message says it is from, without reading the rest. Null for anything that is not a message. */
export function senderOf(raw: unknown): string | null {
  return isRecord(raw) ? playerId(raw.from) : null;
}

/**
 * Check one co-op message from the network: its kind, its size, its sender and every field.
 * The result is rebuilt from the checked fields. (Whether this sender may send this kind is room.ts's rule.)
 */
export function parseCoopMessage(event: string, raw: unknown): CoopIncoming | null {
  if (!isCoopEvent(event) || !isRecord(raw)) return null;
  let size: number;
  try {
    size = JSON.stringify(raw).length;
  } catch {
    return null;
  }
  if (size > sizeLimit(event)) return null;
  const from = playerId(raw.from);
  if (from === null) return null;
  switch (event) {
    case 'st': {
      const snap = parseSnapshot(raw, from);
      return snap ? { event, from, snap } : null;
    }
    case 'rec': {
      const rec = parseRecord(raw);
      return rec ? { event, from, rec } : null;
    }
    case 'int': {
      const intent = parseIntent(raw);
      // An intent speaks for its own seat only.
      return intent && intent.from === from ? { event, from, intent } : null;
    }
    case 'sync': {
      const have = parseSync(raw);
      return have === null ? null : { event, from, have };
    }
  }
}

// ----- Taking a snapshot into a mission --------------------------------------------------------

/**
 * Put the live part of a snapshot into a guest's mission. Config, plan and history stay as they are.
 * Returns false (and changes nothing) when the week is beyond this mission's length.
 */
export function adoptLive(mission: MissionState, live: LiveState): boolean {
  if (live.week > mission.config.weeks) return false;
  mission.week = live.week;
  mission.phase = live.phase;
  mission.battery = live.battery;
  mission.batteryCap = live.batteryCap;
  mission.air = live.air;
  mission.food = live.food;
  mission.dose = live.dose;
  mission.doseLimit = live.doseLimit;
  mission.science = live.science;
  mission.shield = live.shield;
  mission.crop = live.crop;
  mission.neglect = live.neglect;
  mission.hungry = live.hungry;
  mission.harvests = live.harvests;
  mission.panelDust = live.panelDust;
  mission.alloc = live.alloc;
  mission.modifiers = live.modifiers;
  mission.usedEvents = live.usedEvents;
  mission.stormCards = live.stormCards;
  mission.flags = live.flags;
  mission.now = live.now;
  mission.end = live.end;
  mission.stars = live.stars;
  mission.unlocked = live.unlocked;
  mission.stock = live.stock;
  mission.buildings = live.buildings;
  mission.tools = live.tools;
  return true;
}

/**
 * File one week's record in a guest's history. The next week is added, a week already there is
 * replaced, a week with a gap before it is refused (ask again with `sync`). The dates must be the ones of
 * the guest's own plan for that week (both devices built the plan from the same seed), otherwise the
 * record is refused. Returns true when it was filed.
 */
export function adoptRecord(mission: MissionState, record: WeekRecord): boolean {
  if (record.week > mission.config.weeks || record.week > mission.history.length + 1) return false;
  const env = mission.plan[record.week - 1];
  if (!env || env.dateFrom !== record.dateFrom || env.dateTo !== record.dateTo) return false;
  mission.history[record.week - 1] = record;
  return true;
}

/** Weeks the host should send to a guest that has `have` weeks in its history (the records it misses). */
export function missingRecords(mission: MissionState, have: number): WeekRecord[] {
  return mission.history.slice(Math.max(0, have));
}
