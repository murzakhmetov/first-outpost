/**
 * Shared base ("One base together"): the host's rules, as plain data plus pure functions.
 *
 * 2-4 players share ONE mission. Guests send intents (small numbers and preset ids, never text);
 * the host runs them through this reducer, which changes the one real MissionState, and then
 * shows everybody the result. This file knows nothing about the network, the screen or timers:
 * the clock is a number the caller passes in (milliseconds), so tests can run a whole mission
 * in a blink and the session can use any clock it likes.
 *
 * What it decides:
 *  - Stage: briefing, event, eventResult, plan, walk, report, end. (The night is not a place to
 *    wait in: the host runs it at once and the stage jumps from plan/walk to report or end.)
 *  - Ready sets: a stage moves on when everybody answered, or when the countdown that started
 *    with the first answer runs out (then it moves on with those who answered).
 *  - The vote on the event card: most votes win; a tie goes to the host's vote; with no useful
 *    vote Mission Control's advice wins.
 *  - Walks: every walker plays their own walk; mergeWalks makes ONE result for applyEva.
 *  - Everything else a child can do (ask Earth, set power, build, print, win a room game).
 *
 * Solo play and the "each their own base" crew mode never touch this file.
 */
import { EVENTS, optionBlock } from './events';
import { FINDS, recordFind } from './finds';
import { applyEva, askEarth, chooseOption, nextWeek, resolveWeek, setAlloc, suggestAlloc } from './mission';
import type { ChoiceResult } from './mission';
import { BUILDINGS, ROOMS, TOOLS, TOOL_EFFECT, addMaterials, craft, isCreative, startBuilding, claimRoom } from './outpost';
import type { BuildingId, GameId, RoomId, ToolId } from './outpost';
import { EVA_MAX_SECONDS } from './sites';
import { MAX_LEVEL, MODULES } from './types';
import type { Alloc, EvaResult, MissionState, OptionId } from './types';

// ----- Numbers (GAME) ---------------------------------------------------------------

export const COOP_TIMING = {
  /** Seconds from the first answer to the end of a ready check (briefing, result, walk choice, report). */
  ready: 20,
  /** The vote on the event card. */
  vote: 30,
  /** The plan: seconds after the first Ready. */
  plan: 30,
  /** The plan, in all: edits clear every Ready, but the plan ends this long after the first Ready. */
  planCap: 90,
  /** Seconds added to the walk limit before the host stops waiting for a walker. */
  walkGrace: 60,
  /** The host's "Go on" button works after this many seconds on a stage. */
  goAfter: 5,
} as const;

/** Most science the crew can bring home from one walk: what the best single walker can do (the greedy robot's 17). */
export const WALK_SCIENCE_CAP = 17;

/**
 * The longest walk the game can give: the base seconds, the cadet's 20 extra (director.ts) and the
 * workshop tank (world/eva.ts maxSeconds). Both the result bound and the walk deadline use it.
 */
export const LONGEST_WALK_SECONDS = EVA_MAX_SECONDS + 20 + TOOL_EFFECT.tankSeconds;

/**
 * What the six seeded samples are worth, by slot: two near (2), two middle (4), two far (6).
 * The slot is ring * 2 + the sample's number in its ring. world/eva.ts has one value per ring
 * (SAMPLE_VALUES = [2, 4, 6], two samples in each ring), so these equal SAMPLE_VALUES[ring] with
 * slot = ring * 2 + index. The walk (step 5) must number its samples that way.
 */
export const SAMPLE_SLOT_VALUES: readonly number[] = [2, 2, 4, 4, 6, 6];

export const COOP_STAGES = ['briefing', 'event', 'eventResult', 'plan', 'walk', 'night', 'report', 'end'] as const;
export type CoopStage = (typeof COOP_STAGES)[number];

// ----- Intents ----------------------------------------------------------------------

/** One walk, as the guest's device saw it. `picked` lists the sample slots it picked up (0-5). */
export interface WalkResult extends EvaResult {
  picked?: number[];
}

export interface Stamp {
  /** Who sent it (a seat id). */
  from: string;
  /** The sender's own counter, 1, 2, 3 ... A number that is not higher than the last one seen is a copy. */
  n: number;
  /** The week it was meant for. */
  w: number;
  /** The stage it was meant for. */
  s: CoopStage;
}

export type IntentBody =
  | { k: 'ready'; on: boolean }
  | { k: 'vote'; o: OptionId }
  | { k: 'ask' }
  | { k: 'alloc'; a: Alloc }
  | { k: 'safe' }
  | { k: 'walk'; go: boolean }
  | { k: 'walkEnd'; r: WalkResult }
  | { k: 'find'; i: number }
  | { k: 'build'; id: BuildingId }
  | { k: 'craft'; tool: ToolId; neat: boolean }
  | { k: 'room'; room: RoomId; game: GameId }
  /** The host's "Go on": move on now with those who answered. */
  | { k: 'go' };

export type Intent = Stamp & IntentBody;
export type IntentKind = IntentBody['k'];

export type Verdict = 'ok' | 'dup' | 'stale' | 'denied' | 'unknown';

const BUILDING_IDS: readonly string[] = BUILDINGS.map((b) => b.id);
const TOOL_IDS: readonly string[] = TOOLS.map((t) => t.id);
const ROOM_IDS: readonly string[] = ROOMS.map((r) => r.id);
const GAME_IDS: readonly string[] = ['pipes', 'plants', 'spectro', 'landing', 'signal'];
const FIND_IDS: readonly string[] = [...FINDS.mars, ...FINDS.moon].map((f) => f.id);
const OPTIONS: readonly string[] = ['a', 'b', 'c'];
/** A seat id: short, letters, digits, dash and underscore. (The host hands them out; this only keeps junk out.) */
const SEAT_ID = /^[A-Za-z0-9_-]{1,16}$/;

function int(raw: unknown, min: number, max: number): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max ? raw : null;
}

function num(raw: unknown, min: number, max: number): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= min && raw <= max ? raw : null;
}

/** A walk result from the network: a number above what a real walk can reach refuses the whole result (nothing is trimmed); no free text. */
export function parseWalkResult(raw: unknown): WalkResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const seconds = num(o.seconds, 0, LONGEST_WALK_SECONDS + 10);
  const samples = int(o.samples, 0, SAMPLE_SLOT_VALUES.length);
  const science = num(o.science, 0, WALK_SCIENCE_CAP);
  if (seconds === null || samples === null || science === null) return null;
  if (typeof o.chore !== 'boolean' || typeof o.caught !== 'boolean' || typeof o.alerted !== 'boolean') return null;
  const result: WalkResult = { seconds: Math.round(seconds), samples, science: Math.round(science), chore: o.chore, caught: o.caught, alerted: o.alerted };
  if (o.finds !== undefined) {
    if (!Array.isArray(o.finds) || o.finds.length > 4) return null;
    const finds: string[] = [];
    for (const id of o.finds) {
      if (typeof id !== 'string' || !FIND_IDS.includes(id)) return null;
      if (!finds.includes(id)) finds.push(id);
    }
    result.finds = finds;
  }
  if (o.materials !== undefined) {
    if (!o.materials || typeof o.materials !== 'object') return null;
    const m = o.materials as Record<string, unknown>;
    const regolith = int(m.regolith, 0, 12);
    const metal = int(m.metal, 0, 12);
    if (regolith === null || metal === null) return null;
    result.materials = { regolith, metal };
  }
  if (o.picked !== undefined) {
    if (!Array.isArray(o.picked) || o.picked.length > SAMPLE_SLOT_VALUES.length) return null;
    const picked: number[] = [];
    for (const slot of o.picked) {
      const i = int(slot, 0, SAMPLE_SLOT_VALUES.length - 1);
      if (i === null) return null;
      if (!picked.includes(i)) picked.push(i);
    }
    result.picked = picked;
  }
  return result;
}

/** Read one intent from the network. Null when anything is off: wrong type, out of range, unknown id. */
export function parseIntent(raw: unknown): Intent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.from !== 'string' || !SEAT_ID.test(o.from)) return null;
  const n = int(o.n, 1, 1_000_000);
  const w = int(o.w, 1, 99);
  if (n === null || w === null) return null;
  if (typeof o.s !== 'string' || !(COOP_STAGES as readonly string[]).includes(o.s)) return null;
  const stamp: Stamp = { from: o.from, n, w, s: o.s as CoopStage };
  switch (o.k) {
    case 'ready':
      return typeof o.on === 'boolean' ? { ...stamp, k: 'ready', on: o.on } : null;
    case 'vote':
      return typeof o.o === 'string' && OPTIONS.includes(o.o) ? { ...stamp, k: 'vote', o: o.o as OptionId } : null;
    case 'ask':
    case 'safe':
    case 'go':
      return { ...stamp, k: o.k };
    case 'alloc': {
      if (!o.a || typeof o.a !== 'object') return null;
      const a = o.a as Record<string, unknown>;
      const alloc: Alloc = { life: 0, farm: 0, lab: 0, shield: 0 };
      for (const id of MODULES) {
        const level = int(a[id], 0, MAX_LEVEL[id]);
        if (level === null) return null;
        alloc[id] = level;
      }
      return { ...stamp, k: 'alloc', a: alloc };
    }
    case 'walk':
      return typeof o.go === 'boolean' ? { ...stamp, k: 'walk', go: o.go } : null;
    case 'walkEnd': {
      const r = parseWalkResult(o.r);
      return r ? { ...stamp, k: 'walkEnd', r } : null;
    }
    case 'find': {
      const i = int(o.i, 0, 3);
      return i === null ? null : { ...stamp, k: 'find', i };
    }
    case 'build':
      return typeof o.id === 'string' && BUILDING_IDS.includes(o.id) ? { ...stamp, k: 'build', id: o.id as BuildingId } : null;
    case 'craft':
      return typeof o.tool === 'string' && TOOL_IDS.includes(o.tool) && typeof o.neat === 'boolean'
        ? { ...stamp, k: 'craft', tool: o.tool as ToolId, neat: o.neat }
        : null;
    case 'room':
      return typeof o.room === 'string' && ROOM_IDS.includes(o.room) && typeof o.game === 'string' && GAME_IDS.includes(o.game)
        ? { ...stamp, k: 'room', room: o.room as RoomId, game: o.game as GameId }
        : null;
    default:
      return null;
  }
}

// ----- The vote ---------------------------------------------------------------------

/**
 * Who wins the vote. `votes` maps a seat to an option; only allowed options count.
 * Most votes win. A tie goes to the host's vote if it is one of the tied options, then to Mission
 * Control's advice if it is one of them, then to the first option in order (a, b, c).
 * With no vote at all, the advice wins (or the first allowed option when the advice is blocked).
 */
export function tally(votes: Record<string, OptionId>, host: string, advice: OptionId | null, allowed: readonly OptionId[]): OptionId | null {
  if (allowed.length === 0) return null;
  const sorted = [...allowed].sort();
  const counts = new Map<OptionId, number>();
  for (const option of Object.values(votes)) {
    if (sorted.includes(option)) counts.set(option, (counts.get(option) ?? 0) + 1);
  }
  if (counts.size === 0) return advice && sorted.includes(advice) ? advice : sorted[0];
  const top = Math.max(...counts.values());
  const tied = sorted.filter((option) => counts.get(option) === top);
  if (tied.length === 1) return tied[0];
  const hostVote = votes[host];
  if (hostVote && tied.includes(hostVote)) return hostVote;
  if (advice && tied.includes(advice)) return advice;
  return tied[0];
}

// ----- Merging the walks --------------------------------------------------------------

/**
 * One result for the whole crew's walk, for applyEva (which allows one walk a week).
 *  - Science: every walker sees the same six samples, so the crew's science is the UNION of the
 *    samples picked, capped at what one walker can do (WALK_SCIENCE_CAP). When a walker did not say
 *    which samples (no `picked`), the best single walker's science is used instead. It is never
 *    lower than the best single walker, and never above the cap.
 *  - Finds: union (recordFind counts each once). Chore: done by any. Seconds: the longest walk.
 *  - Materials: the most any walker brought, per kind.
 *  - Caught: caught when anyone was, and `caughtShare` is the share of walkers who were
 *    (k of N). mission.ts computeWeek reads it where the caught dose is applied; applyEva keeps it
 *    because it stores the whole result. Alerted: any.
 * Returns null when nobody walked.
 */
export function mergeWalks(results: readonly WalkResult[], cap: number = WALK_SCIENCE_CAP): EvaResult | null {
  if (results.length === 0) return null;
  const best = results.reduce((a, b) => (b.science > a.science ? b : a));
  let science = Math.min(best.science, cap);
  let samples = best.samples;
  if (results.every((r) => r.picked)) {
    const union = new Set<number>();
    for (const r of results) for (const slot of r.picked!) union.add(slot);
    let sum = 0;
    for (const slot of union) sum += SAMPLE_SLOT_VALUES[slot] ?? 0;
    science = Math.max(science, Math.min(sum, cap));
    samples = Math.max(best.samples, union.size);
  }
  const finds = [...new Set(results.flatMap((r) => r.finds ?? []))];
  const caughtCount = results.filter((r) => r.caught).length;
  const merged: EvaResult = {
    seconds: Math.max(...results.map((r) => r.seconds)),
    samples,
    science,
    finds,
    materials: {
      regolith: Math.max(...results.map((r) => r.materials?.regolith ?? 0)),
      metal: Math.max(...results.map((r) => r.materials?.metal ?? 0)),
    },
    chore: results.some((r) => r.chore),
    caught: caughtCount > 0,
    alerted: results.some((r) => r.alerted),
  };
  if (caughtCount > 0) merged.caughtShare = caughtCount / results.length;
  return merged;
}

// ----- The shared state -----------------------------------------------------------------

/** What each child did for the crew (for the debrief). */
export interface Contribution {
  samples: number;
  finds: number;
  games: number;
  prints: number;
  votes: number;
}

export interface CoopSim {
  /** The one real mission. Only the host changes it, and only through the functions below. */
  mission: MissionState;
  stage: CoopStage;
  /** Goes up by one at every change, so a guest can tell a new snapshot from an old one. */
  rev: number;
  /** The commander's seat id. */
  host: string;
  /** Seats still in the game, the host first. */
  seats: string[];
  ready: string[];
  votes: Record<string, OptionId>;
  /** Walk stage: each seat's choice, true = walks, false = stays. */
  walk: Record<string, boolean>;
  /** Walk stage: the walkers are outside. */
  outside: boolean;
  /** Walk results that came in (held until the merge). */
  returned: Record<string, WalkResult>;
  /** The card's result, while the stage is eventResult. */
  choice: ChoiceResult | null;
  /** The week's record, from the night until the next week begins. */
  rec: ReturnType<typeof resolveWeek> | null;
  /** When the stage began (ms, the caller's clock). */
  since: number;
  /** When the countdown ends, or null while nobody has answered yet. */
  deadline: number | null;
  /** The plan stage ends at this time whatever happens (first Ready + 90 s). */
  planCap: number | null;
  /** The highest counter seen from each seat. */
  acks: Record<string, number>;
  contrib: Record<string, Contribution>;
}

const blankContribution = (): Contribution => ({ samples: 0, finds: 0, games: 0, prints: 0, votes: 0 });

export function createCoop(mission: MissionState, seats: readonly string[], now: number): CoopSim {
  if (seats.length < 1) throw new Error('A crew needs at least one seat');
  const co: CoopSim = {
    mission,
    stage: 'briefing',
    rev: 0,
    host: seats[0],
    seats: [...seats],
    ready: [],
    votes: {},
    walk: {},
    outside: false,
    returned: {},
    choice: null,
    rec: null,
    since: now,
    deadline: null,
    planCap: null,
    acks: {},
    contrib: Object.fromEntries(seats.map((id) => [id, blankContribution()])),
  };
  return co;
}

function enter(co: CoopSim, stage: CoopStage, now: number): void {
  co.stage = stage;
  co.since = now;
  co.ready = [];
  co.votes = {};
  co.walk = {};
  co.outside = false;
  co.returned = {};
  co.deadline = null;
  co.planCap = null;
  if (stage !== 'eventResult') co.choice = null;
  if (stage !== 'report' && stage !== 'end') co.rec = null;
  co.rev += 1;
}

function startCountdown(co: CoopSim, now: number, seconds: number): void {
  if (co.deadline !== null) return;
  co.deadline = now + seconds * 1000;
  if (co.planCap !== null) co.deadline = Math.min(co.deadline, co.planCap);
}

/** Has everybody who is still here answered? */
function complete(co: CoopSim): boolean {
  switch (co.stage) {
    case 'briefing':
    case 'eventResult':
    case 'plan':
    case 'report':
      return co.seats.every((id) => co.ready.includes(id));
    case 'event':
      return co.seats.every((id) => id in co.votes);
    case 'walk':
      if (co.outside) return walkers(co).every((id) => id in co.returned);
      return co.seats.every((id) => id in co.walk);
    default:
      return false;
  }
}

function walkers(co: CoopSim): string[] {
  return co.seats.filter((id) => co.walk[id] === true);
}

/** Run the night at once and land on the report (or the end). */
function night(co: CoopSim, now: number): void {
  co.rec = resolveWeek(co.mission);
  enter(co, co.mission.end ? 'end' : 'report', now);
}

function resolveVote(co: CoopSim): void {
  const { mission } = co;
  const now = mission.now;
  if (!now.eventId || now.eventDone) return;
  const event = EVENTS[now.eventId];
  const allowed = event.options.filter((o) => !optionBlock(o, mission)).map((o) => o.id);
  const votes: Record<string, OptionId> = {};
  for (const id of co.seats) if (co.votes[id]) votes[id] = co.votes[id];
  const winner = tally(votes, co.host, now.advice, allowed);
  const result = winner ? chooseOption(mission, winner) : null;
  co.choice = result;
  if (result) {
    for (const id of Object.keys(votes)) co.contrib[id].votes += 1;
  }
}

/** Move to the next stage with whoever answered. */
function advance(co: CoopSim, now: number): void {
  const { mission } = co;
  switch (co.stage) {
    case 'briefing':
      enter(co, mission.now.eventId && !mission.now.eventDone ? 'event' : 'plan', now);
      break;
    case 'event':
      resolveVote(co);
      enter(co, 'eventResult', now);
      break;
    case 'eventResult':
      enter(co, 'plan', now);
      break;
    case 'plan':
      if (mission.now.evaAllowed && !mission.now.eva) enter(co, 'walk', now);
      else night(co, now);
      break;
    case 'walk':
      if (!co.outside) {
        if (walkers(co).length === 0) {
          night(co, now);
        } else {
          co.outside = true;
          co.deadline = now + (LONGEST_WALK_SECONDS + COOP_TIMING.walkGrace) * 1000;
          co.rev += 1;
        }
      } else {
        const merged = mergeWalks(Object.values(co.returned));
        if (merged) applyEva(mission, merged);
        night(co, now);
      }
      break;
    case 'report':
      nextWeek(mission);
      enter(co, 'briefing', now);
      break;
    default:
      break;
  }
}

function settle(co: CoopSim, now: number, force: boolean): void {
  if (co.stage === 'end' || co.stage === 'night') return;
  if (force || complete(co)) advance(co, now);
}

// ----- Applying intents -----------------------------------------------------------------

const STAGE_OF: Partial<Record<IntentKind, readonly CoopStage[]>> = {
  ready: ['briefing', 'eventResult', 'plan', 'report'],
  vote: ['event'],
  ask: ['event'],
  alloc: ['plan'],
  safe: ['plan'],
  walk: ['walk'],
  walkEnd: ['walk'],
  find: ['walk'],
  go: ['briefing', 'event', 'eventResult', 'plan', 'walk', 'report'],
};

/** Build, craft and room wins are not allowed at night or on the report (the same rule as one player's). */
const WORK_STAGES: readonly CoopStage[] = ['briefing', 'event', 'eventResult', 'plan', 'walk'];

const lower = (a: Alloc): string => JSON.stringify(a);

/**
 * Apply one intent from a seat. Returns what happened to it:
 *  ok      it changed (or confirmed) the shared state
 *  dup     a copy or an older message from the same seat: ignored
 *  stale   meant for another week or stage: ignored
 *  denied  not allowed now (a blocked option, no materials, wrong seat ...)
 *  unknown the sender is not in the crew
 */
export function coopApply(co: CoopSim, intent: Intent, now: number): Verdict {
  if (!co.seats.includes(intent.from)) return 'unknown';
  if (intent.n <= (co.acks[intent.from] ?? 0)) return 'dup';
  co.acks[intent.from] = intent.n;
  if (co.stage === 'end' || co.stage === 'night') return 'stale';
  if (intent.w !== co.mission.week) return 'stale';
  const stages = STAGE_OF[intent.k];
  if (stages) {
    if (!stages.includes(co.stage) || intent.s !== co.stage) return 'stale';
  } else {
    // Build, craft and room wins: allowed by day only, and the stamp must name the stage they were sent in.
    if (!WORK_STAGES.includes(co.stage)) return 'denied';
    if (intent.s !== co.stage) return 'stale';
  }

  const { mission } = co;
  const before = lower(mission.alloc);
  const verdict = run(co, intent, now);
  if (verdict !== 'ok') return verdict;

  // Any change to the power plan makes everybody look again.
  if (co.stage === 'plan' && lower(mission.alloc) !== before && co.ready.length > 0) {
    co.ready = [];
    co.deadline = null;
  }
  co.rev += 1;
  settle(co, now, intent.k === 'go');
  return 'ok';
}

function run(co: CoopSim, intent: Intent, now: number): Verdict {
  const { mission } = co;
  const from = intent.from;
  switch (intent.k) {
    case 'ready': {
      if (intent.on) {
        if (!co.ready.includes(from)) co.ready.push(from);
        if (co.stage === 'plan' && co.planCap === null) co.planCap = now + COOP_TIMING.planCap * 1000;
        startCountdown(co, now, co.stage === 'plan' ? COOP_TIMING.plan : COOP_TIMING.ready);
      } else {
        co.ready = co.ready.filter((id) => id !== from);
      }
      return 'ok';
    }
    case 'vote': {
      const { now: wk } = mission;
      if (!wk.eventId || wk.eventDone) return 'denied';
      const option = EVENTS[wk.eventId].options.find((o) => o.id === intent.o);
      if (!option || optionBlock(option, mission)) return 'denied';
      co.votes[from] = intent.o;
      startCountdown(co, now, COOP_TIMING.vote);
      return 'ok';
    }
    case 'ask':
      return askEarth(mission) ? 'ok' : 'denied';
    case 'alloc': {
      // Lower first, so a raise that needs the freed cells fits.
      const order = [...MODULES].sort((a, b) => intent.a[a] - mission.alloc[a] - (intent.a[b] - mission.alloc[b]));
      const before = { ...mission.alloc };
      for (const id of order) {
        if (intent.a[id] === mission.alloc[id]) continue;
        if (!setAlloc(mission, id, intent.a[id])) {
          // A refused edit must not leave half a plan: put the old plan back.
          mission.alloc = before;
          return 'denied';
        }
      }
      return 'ok';
    }
    case 'safe':
      mission.alloc = suggestAlloc(mission);
      return 'ok';
    case 'walk': {
      if (co.outside || !mission.now.evaAllowed || mission.now.eva) return 'denied';
      co.walk[from] = intent.go;
      startCountdown(co, now, COOP_TIMING.ready);
      return 'ok';
    }
    case 'walkEnd': {
      if (!co.outside || co.walk[from] !== true || from in co.returned) return 'denied';
      co.returned[from] = intent.r;
      co.contrib[from].samples += intent.r.picked?.length ?? intent.r.samples;
      return 'ok';
    }
    case 'find': {
      if (!co.outside || co.walk[from] !== true) return 'denied';
      const find = FINDS[mission.config.site][intent.i];
      if (!find) return 'denied';
      if (recordFind(mission, find.id)) co.contrib[from].finds += 1;
      return 'ok';
    }
    case 'build': {
      if (!startBuilding(mission, intent.id)) return 'denied';
      // The robot needs at least one cell: put one in the plan if there is a spare one.
      if (co.stage === 'plan' && mission.alloc.shield === 0) setAlloc(mission, 'shield', 1);
      return 'ok';
    }
    case 'craft': {
      if (!craft(mission, intent.tool)) return 'denied';
      co.contrib[from].prints += 1;
      if (intent.neat && !isCreative(mission)) addMaterials(mission, { metal: 1 });
      return 'ok';
    }
    case 'room': {
      if (!claimRoom(mission, intent.room, intent.game, true)) return 'denied';
      co.contrib[from].games += 1;
      return 'ok';
    }
    case 'go': {
      if (from !== co.host) return 'denied';
      if (now - co.since < COOP_TIMING.goAfter * 1000) return 'denied';
      return 'ok';
    }
  }
}

/**
 * The clock moved. When a countdown ran out, move on with those who answered.
 * Returns true when anything changed. Call it often; it is cheap.
 */
export function coopTick(co: CoopSim, now: number): boolean {
  if (co.stage === 'end' || co.stage === 'night') return false;
  const due = (co.deadline !== null && now >= co.deadline) || (co.planCap !== null && co.stage === 'plan' && now >= co.planCap);
  if (!due) return false;
  advance(co, now);
  return true;
}

/** A child left (closed the window, lost the connection for good). The crew goes on without them. Never the host. */
export function coopLeave(co: CoopSim, id: string, now: number): boolean {
  if (id === co.host || !co.seats.includes(id)) return false;
  co.seats = co.seats.filter((seat) => seat !== id);
  co.ready = co.ready.filter((seat) => seat !== id);
  delete co.votes[id];
  delete co.walk[id];
  co.rev += 1;
  settle(co, now, false);
  return true;
}

// ----- What the guests are shown ------------------------------------------------------------

/** The co-op part of a snapshot: small, numbers and preset ids only. `left` is seconds until the countdown ends. */
export interface CoopMeta {
  stage: CoopStage;
  rev: number;
  week: number;
  seats: string[];
  ready: string[];
  votes: Record<string, OptionId>;
  walk: Record<string, boolean>;
  outside: boolean;
  returned: string[];
  left: number | null;
  acks: Record<string, number>;
  choice: ChoiceResult | null;
  /** What each seat did for the crew. Sent only on the report and the end (the debrief), to keep the other messages small. */
  contrib?: Record<string, Contribution>;
}

export function coopMeta(co: CoopSim, now: number): CoopMeta {
  const meta: CoopMeta = {
    stage: co.stage,
    rev: co.rev,
    week: co.mission.week,
    seats: [...co.seats],
    ready: [...co.ready],
    votes: { ...co.votes },
    walk: { ...co.walk },
    outside: co.outside,
    returned: Object.keys(co.returned),
    left: co.deadline === null ? null : Math.max(0, Math.ceil((co.deadline - now) / 1000)),
    acks: { ...co.acks },
    choice: co.choice,
  };
  if (co.stage === 'report' || co.stage === 'end') meta.contrib = Object.fromEntries(Object.entries(co.contrib).map(([id, c]) => [id, { ...c }]));
  return meta;
}
