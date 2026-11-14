/**
 * Shared base: what the screens may know about the crew.
 *
 * `coopLive` is null in solo play and in the "each their own base" crew mode, so every co-op piece of the screen
 * is drawn only when it holds something. The session glue (coopglue.ts) fills it after every change and clears it
 * when the session ends (coopport.ts close). All the rules of the screens (who is waited for, who changed the plan,
 * how many seconds are left, when "Go on" and "Play on alone" are offered) are plain functions here, so they can be
 * tested without a screen.
 *
 * It holds numbers and seat ids only. Names and suit colours come from the room (crew.ts), as in the dock.
 */
import { signal } from '@preact/signals';
import { COOP_TIMING } from '../sim/coop';
import type { CoopMeta, CoopStage } from '../sim/coop';
import type { Alloc, ModuleId, OptionId } from '../sim/types';
import { MODULES } from '../sim/types';

/** The commander's "Go on" shows after this long on a stage (the host's own rule is the same number). */
export const GO_ON_MS = COOP_TIMING.goAfter * 1000;
/** A guest sees "Waiting for the commander" after this long without news (src/net/coop.ts COOP_NET.quietMs). */
export const QUIET_MS = 15_000;
/** A guest is offered "Play on alone" after this long without news. */
export const ALONE_MS = 45_000;
/** The "plan changed" note and the colour flash on a changed row stay this long. */
export const CHANGE_SHOW_MS = 4_000;

/** Which module rows changed, and who changed them (null when the snapshot cannot tell). */
export interface CoopFlash {
  who: string | null;
  modules: ModuleId[];
  at: number;
}

/** This seat's Ready was cleared by a change of the plan, and who changed it (null when unknown). */
export interface CoopCleared {
  who: string | null;
  at: number;
}

export interface CoopLive {
  me: string;
  hostId: string;
  stage: CoopStage;
  week: number;
  seats: string[];
  ready: string[];
  votes: Record<string, OptionId>;
  walk: Record<string, boolean>;
  outside: boolean;
  returned: string[];
  acks: Record<string, number>;
  /** When the countdown ends (ms, this device's clock), or null while nobody has answered. */
  endsAt: number | null;
  /** The plan ends then whatever happens (the first Ready + 90 s), or null. */
  capAt: number | null;
  /** When this device first saw this stage (ms). */
  sinceAt: number;
  /** The commander has been silent for a while (a guest only). */
  quiet: boolean;
  /** A copy of the power plan, to see what changed. */
  alloc: Alloc;
  flash: CoopFlash | null;
  cleared: CoopCleared | null;
  /** The same stage, week and walk phase: a new one starts a new "since". */
  key: string;
}

export interface CoopContext {
  me: string;
  hostId: string;
  /** The mission's plan right now. */
  alloc: Alloc;
  quiet: boolean;
  /** Milliseconds on this device's clock. */
  now: number;
  /** The host knows when the plan ends exactly; a guest estimates it (leave undefined). */
  capAt?: number | null;
}

const keyOf = (meta: CoopMeta): string => `${meta.stage}:${meta.week}:${meta.outside ? 1 : 0}`;

/** The seat whose counter went up since the last snapshot, when it is only one. */
function soleActor(before: Record<string, number>, after: Record<string, number>): string | null {
  const moved = Object.keys(after).filter((seat) => after[seat] > (before[seat] ?? 0));
  return moved.length === 1 ? moved[0] : null;
}

/** A new snapshot of the crew from the last one and what the host said. Pure. */
export function makeLive(prev: CoopLive | null, meta: CoopMeta, ctx: CoopContext): CoopLive {
  const key = keyOf(meta);
  const same = prev !== null && prev.key === key && prev.me === ctx.me;
  let capAt: number | null = null;
  if (meta.stage === 'plan') {
    if (ctx.capAt !== undefined) capAt = ctx.capAt;
    else if (same && prev.capAt !== null) capAt = prev.capAt;
    else if (meta.ready.length > 0) capAt = ctx.now + COOP_TIMING.planCap * 1000;
  }
  let flash = same ? prev.flash : null;
  let cleared = same ? prev.cleared : null;
  if (same && meta.stage === 'plan') {
    const modules = MODULES.filter((id) => prev.alloc[id] !== ctx.alloc[id]);
    const who = soleActor(prev.acks, meta.acks);
    if (modules.length > 0) flash = { who, modules, at: ctx.now };
    if (prev.ready.includes(ctx.me) && !meta.ready.includes(ctx.me)) cleared = { who, at: ctx.now };
  }
  return {
    me: ctx.me,
    hostId: ctx.hostId,
    stage: meta.stage,
    week: meta.week,
    seats: [...meta.seats],
    ready: [...meta.ready],
    votes: { ...meta.votes },
    walk: { ...meta.walk },
    outside: meta.outside,
    returned: [...meta.returned],
    acks: { ...meta.acks },
    endsAt: meta.left === null ? null : ctx.now + meta.left * 1000,
    capAt,
    sinceAt: same ? prev.sinceAt : ctx.now,
    quiet: ctx.quiet,
    alloc: { ...ctx.alloc },
    flash,
    cleared,
    key,
  };
}

// ----- Who is waited for ----------------------------------------------------------------

/** The seats whose answer counts on this stage: everybody, or only the walkers while they are outside. */
export function participants(live: CoopLive): string[] {
  if (live.stage === 'walk' && live.outside) return live.seats.filter((seat) => live.walk[seat] === true);
  return [...live.seats];
}

/** Who has answered on this stage: ready, voted, chose to walk or stay, or is back from the walk. */
export function answered(live: CoopLive): string[] {
  switch (live.stage) {
    case 'event':
      return live.seats.filter((seat) => seat in live.votes);
    case 'walk':
      return live.outside ? live.returned.filter((seat) => live.walk[seat] === true) : live.seats.filter((seat) => seat in live.walk);
    default:
      return live.seats.filter((seat) => live.ready.includes(seat));
  }
}

/** The seats that are still to answer. */
export function waitingFor(live: CoopLive): string[] {
  const done = answered(live);
  return participants(live).filter((seat) => !done.includes(seat));
}

/** Walkers who are still outside, not counting this seat. */
export function friendsOutside(live: CoopLive): number {
  if (live.stage !== 'walk' || !live.outside) return 0;
  return live.seats.filter((seat) => seat !== live.me && live.walk[seat] === true && !live.returned.includes(seat)).length;
}

/** Whole seconds until the stage ends by itself (the nearer of the countdown and the plan's cap), or null. */
export function secondsLeft(live: CoopLive, now: number): number | null {
  const ends = [live.endsAt, live.capAt].filter((at): at is number => at !== null);
  if (ends.length === 0) return null;
  return Math.max(0, Math.ceil((Math.min(...ends) - now) / 1000));
}

/** Does this seat have its answer in? */
export function iAnswered(live: CoopLive): boolean {
  return answered(live).includes(live.me);
}

/**
 * The commander's "Go on": on after 5 s, only for the commander, only while somebody is still to answer, and only once
 * the commander has answered too (a walk the commander stays out of does not hold the button back).
 */
export function canGoOn(live: CoopLive, now: number): boolean {
  if (live.me !== live.hostId || now - live.sinceAt < GO_ON_MS) return false;
  if (waitingFor(live).length === 0) return false;
  return !participants(live).includes(live.me) || iAnswered(live);
}

/** The seats that voted for an option. */
export function votersOf(live: CoopLive, option: OptionId): string[] {
  return live.seats.filter((seat) => live.votes[seat] === option);
}

/** The "plan changed" note: shown for a few seconds to the seat whose Ready was cleared by someone else. */
export function planNote(live: CoopLive, now: number): CoopCleared | null {
  const note = live.cleared;
  if (!note || now - note.at > CHANGE_SHOW_MS || note.who === live.me) return null;
  return note;
}

/** The module rows that flash (changed by somebody else just now). */
export function flashing(live: CoopLive, now: number): CoopFlash | null {
  const flash = live.flash;
  if (!flash || now - flash.at > CHANGE_SHOW_MS || flash.who === live.me) return null;
  return flash;
}

/** "Waiting for the commander": shown from 15 s without news. */
export function waitingForCommander(live: CoopLive): boolean {
  return live.quiet && live.me !== live.hostId;
}

/** "Play on alone" is offered from 45 s without news. */
export function canPlayAlone(silentMs: number): boolean {
  return silentMs >= ALONE_MS;
}

/** What the crew is doing now, as the key of a short phrase (the chip in the rooms). Null at night and at the end. */
export function doingKey(live: CoopLive): string | null {
  switch (live.stage) {
    case 'briefing':
    case 'event':
    case 'eventResult':
    case 'plan':
    case 'report':
      return live.stage;
    case 'walk':
      return live.outside ? 'outside' : 'walk';
    default:
      return null;
  }
}

// ----- The signal and the controls -------------------------------------------------------------

/** Null unless a shared base is running on this device. */
export const coopLive = signal<CoopLive | null>(null);

export interface CoopControls {
  /** The commander's "Go on". */
  go(): void;
  /** Leave the shared base and go on alone (a guest). */
  playAlone(): void;
  /** Milliseconds since the commander was last heard (0 for the commander). */
  silentMs(): number;
}

let controls: CoopControls | null = null;

export function setCoopControls(next: CoopControls | null): void {
  controls = next;
}

/** The glue: a new snapshot of the crew. */
export function showCoop(meta: CoopMeta, ctx: CoopContext): void {
  coopLive.value = makeLive(coopLive.peek(), meta, ctx);
}

/** The session is over (or never was): the screens go back to solo. */
export function clearCoop(): void {
  controls = null;
  coopLive.value = null;
}

export const coopGo = (): void => controls?.go();
export const coopPlayAlone = (): void => controls?.playAlone();
export const coopSilentMs = (): number => controls?.silentMs() ?? 0;
