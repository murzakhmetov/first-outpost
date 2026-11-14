/**
 * Crew mode, as the screens see it: signals to draw from, and a few functions to call.
 * This is the only file that connects the room (room.ts) to the game: it reads the mission signals
 * to send our numbers, and calls startMission when the host starts. It never changes the game's
 * own files, and nothing here runs until a player opens crew mode.
 */
import { computed, effect, signal } from '@preact/signals';
import { audio } from '../game/audio';
import { coopDetach, getWorld, goNextWeek, startMission } from '../game/director';
import { film, mission, panel, profile, room as insideRoom, screen, step, updateProfile } from '../game/store';
import type { SetupChoice } from '../game/store';
import { FEATURED_WINDOWS } from '../sim/sites';
import { netConfig, transportKind } from './config';
import { startCoopGuest, startCoopHost } from './coopglue';
import { PositionSender, assignSlots, coopFriendMode, coopFriendStep, positionSample, raceWaitApplies, whoIsBehind } from './follow';
import { coopLive } from './coopview';
import { CREW_NAME_COUNT, CREW_SUITS, REACTIONS, REACTION_ICON, REACTION_MIN_MS, newPlayerId, startDateOf, statusOf, suitIndex } from './protocol';
import type { CrewChoice, GameMode, ReactionId, StartPayload } from './protocol';
import { CrewRoom } from './room';
import type { Player, RoomView } from './room';
import type { CoopLive } from './coopview';
import type { FriendSpec } from '../world/friends';
import { SupabaseTransport } from './supabase';
import { LocalTransport } from './transport';
import type { Transport } from './transport';

const IDLE: RoomView = { phase: 'idle', code: '', me: '', hostId: null, players: [], online: true, failure: null, start: null, versionOk: true };

/** Everything the screens draw from. */
export const crewView = signal<RoomView>(IDLE);
/** The lobby screen is open (on the title screen). */
export const crewLobbyOpen = signal(false);
/** True for a second after a sticker was sent (the buttons rest). */
export const crewCooling = signal(false);

export interface CrewToast {
  id: number;
  name: number;
  suit: number;
  icon: string;
  reaction: ReactionId;
}
export const crewToasts = signal<CrewToast[]>([]);

/** A sticker above a friend's head for a few seconds, by player id. */
export interface CrewBubble {
  key: number;
  icon: string;
  reaction: ReactionId;
}
export const crewBubbles = signal<Record<string, CrewBubble>>({});
/** The report's "Next week" is waiting for friends who are still behind. */
export const crewWaiting = signal(false);

/** How the running crew mission is played: "race" = each their own base, "coop" = one base together. */
export const crewMode = signal<GameMode>('race');

/** The friends who are still behind this week's report (race mode). Empty in solo play, in a shared base, or when we are offline. */
export const crewBehind = computed<Player[]>(() => {
  const view = crewView.value;
  const m = mission.value;
  if (view.phase !== 'playing' || !view.online || !m || !raceWaitApplies(crewMode.value, coopLive.value !== null)) return [];
  return whoIsBehind({ week: m.week, step: 'report' }, view.players);
});

let room: CrewRoom | null = null;
let friendsOn = false;
/** The shared-base session of this device (host or guest), while a co-op mission runs. */
let coopSession: { dispose(): void } | null = null;
let waitStop: (() => void) | null = null;
const bubbleTimers = new Map<string, number>();
let unsubscribe: (() => void) | null = null;
let stopWatching: (() => void) | null = null;
let stopCoopWatch: (() => void) | null = null;
let toastId = 0;
let coolTimer = 0;

/** Crew mode can be used: a network is set up (or the developer flag is on). */
export function crewAvailable(): boolean {
  return transportKind() !== null;
}

export function crewIsLocal(): boolean {
  return transportKind() === 'local';
}

function makeTransport(): Transport {
  const config = netConfig();
  if (transportKind() === 'local' || !config) return new LocalTransport();
  return new SupabaseTransport(config);
}

function fresh(): CrewRoom {
  leaveRoom();
  const local = crewIsLocal();
  const next = new CrewRoom(makeTransport, {
    me: { id: newPlayerId(), name: Math.floor(Math.random() * CREW_NAME_COUNT), suit: suitIndex(profile.value.suit) },
    joinGraceMs: local ? 900 : 1500,
    createGraceMs: local ? 400 : 500,
  });
  room = next;
  unsubscribe = next.subscribe((view) => {
    crewView.value = view;
    syncFriends(view);
  });
  next.onStart = (start) => void runStart(start);
  next.onReaction = (player, reaction) => showReaction(player, reaction);
  next.onPosition = (player, position) => getWorld()?.setFriendPosition(player.id, position);
  crewView.value = next.view;
  return next;
}

export async function createRoom(): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false && !crewIsLocal()) {
    fresh();
    room?.leave();
    crewView.value = { ...IDLE, phase: 'failed', failure: 'offline' };
    return;
  }
  await fresh().create();
}

export async function joinRoom(code: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false && !crewIsLocal()) {
    fresh();
    room?.leave();
    crewView.value = { ...IDLE, phase: 'failed', failure: 'offline' };
    return;
  }
  await fresh().join(code);
}

/** Leave the room. The single-player game is never touched. */
export function leaveRoom(): void {
  endWait();
  if (coopSession) {
    // The shared base ends here: this device goes on alone, as in solo play.
    coopSession.dispose();
    coopSession = null;
    coopDetach();
  }
  crewMode.value = 'race';
  stopCoopWatch?.();
  stopCoopWatch = null;
  stopWatching?.();
  stopWatching = null;
  unsubscribe?.();
  unsubscribe = null;
  room?.leave();
  room = null;
  crewView.value = IDLE;
  crewToasts.value = [];
  for (const timer of bubbleTimers.values()) window.clearTimeout(timer);
  bubbleTimers.clear();
  crewBubbles.value = {};
  friendsOn = false;
  // The two NPC cadets come back.
  getWorld()?.setFriends(null);
}

export function openCrewLobby(): void {
  audio.play('click');
  crewLobbyOpen.value = true;
}

export function closeCrewLobby(): void {
  audio.play('click');
  leaveRoom();
  crewLobbyOpen.value = false;
}

export function setReady(ready: boolean): void {
  room?.setReady(ready);
}

export function canStart(): boolean {
  return !!room && room.canStart();
}

/** Host: pick a real-history window for the world, and start for everybody. Returns false if it could not start. */
export function hostStart(
  pick: { site: SetupChoice['site']; difficulty: SetupChoice['difficulty']; weeks: number },
  mode: GameMode = 'race',
): boolean {
  if (!room || !getWorld()) return false;
  const windows = FEATURED_WINDOWS.filter((window) => window.sites.includes(pick.site));
  const window = windows[Math.floor(Math.random() * windows.length)];
  const choice: CrewChoice = { site: pick.site, difficulty: pick.difficulty, weeks: pick.weeks, windowId: window.id };
  const startDate = startDateOf(window.id);
  if (!startDate) return false;
  return room.start(choice, Math.floor(Math.random() * 2 ** 31), startDate, mode);
}

/** Send a sticker. */
export function react(reaction: ReactionId): void {
  if (!room || !(REACTIONS as readonly string[]).includes(reaction)) return;
  if (!room.sendReaction(reaction)) return;
  audio.play('click');
  crewCooling.value = true;
  window.clearTimeout(coolTimer);
  coolTimer = window.setTimeout(() => {
    crewCooling.value = false;
  }, REACTION_MIN_MS);
}

function showReaction(player: Player, reaction: ReactionId): void {
  const id = ++toastId;
  crewToasts.value = [...crewToasts.value, { id, name: player.name, suit: player.suit, icon: REACTION_ICON[reaction], reaction }].slice(-3);
  audio.play('pop');
  window.setTimeout(() => {
    crewToasts.value = crewToasts.value.filter((toast) => toast.id !== id);
  }, 4000);
  // The same sticker over the friend's head for 3 seconds.
  window.clearTimeout(bubbleTimers.get(player.id));
  crewBubbles.value = { ...crewBubbles.value, [player.id]: { key: id, icon: REACTION_ICON[reaction], reaction } };
  bubbleTimers.set(
    player.id,
    window.setTimeout(() => {
      bubbleTimers.delete(player.id);
      const { [player.id]: _gone, ...rest } = crewBubbles.value;
      crewBubbles.value = rest;
    }, 3000),
  );
}

// ----- Friends in the 3D world ----------------------------------------------------------

/** Give the world the friends to draw (in a crew mission), in the suit colour and place each one has. */
function syncFriends(view: RoomView, live: CoopLive | null = coopLive.peek()): void {
  if (!friendsOn || view.phase !== 'playing') return;
  const others = view.players.filter((player) => !player.me);
  // Alone in the room: the two helper cadets keep the outpost lived in, as in solo play.
  if (!others.length) {
    getWorld()?.setFriends(null);
    return;
  }
  // Slots go by every friend in the room (also those who left), so nobody's place jumps when somebody goes.
  const slots = assignSlots(others.map((player) => player.id));
  const list: FriendSpec[] = others.map((player) => ({
    id: player.id,
    color: CREW_SUITS[player.suit] ?? CREW_SUITS[0],
    // On a shared base the host's stage says who is outside; after it ends (live = null) the race rule applies.
    mode: coopFriendMode(live, player),
    slot: slots.get(player.id) ?? 0,
    step: coopFriendStep(live, player),
  }));
  getWorld()?.setFriends(list);
}

// ----- Weeks go on together --------------------------------------------------------------

function endWait(): void {
  waitStop?.();
  waitStop = null;
  crewWaiting.value = false;
}

/**
 * The report's "Next week". Solo play (and the last week) goes on at once. In a crew mission it waits for
 * friends who are still behind, then goes on by itself; "Don't wait" goes on now.
 */
export function crewNextWeek(): void {
  const m = mission.peek();
  // A shared base: the director turns this into the crew's Ready (no race-mode wait here).
  if (!raceWaitApplies(crewMode.peek(), coopLive.peek() !== null)) {
    goNextWeek();
    return;
  }
  if (!m || waitStop || m.week >= m.config.weeks || crewBehind.peek().length === 0) {
    if (!waitStop) goNextWeek();
    return;
  }
  audio.play('click');
  crewWaiting.value = true;
  let fired = false;
  waitStop = effect(() => {
    if (step.value !== 'report' || screen.value !== 'game') {
      queueMicrotask(endWait);
      return;
    }
    // Nobody behind any more, and nothing open on top (a menu, a film, a building): go on, once.
    if (crewBehind.value.length > 0 || panel.value !== 'none' || film.value !== null || insideRoom.value !== null) return;
    if (fired) return;
    fired = true;
    queueMicrotask(() => {
      endWait();
      goNextWeek();
    });
  });
}

/** "Don't wait": go on to the next week now. */
export function crewDontWait(): void {
  if (!waitStop) return;
  endWait();
  goNextWeek();
}

// ----- The mission ---------------------------------------------------------------------

/** The game is built a moment after the page opens: wait for it (at most 15 seconds). */
async function whenWorld(): Promise<boolean> {
  for (let i = 0; i < 75; i++) {
    if (getWorld()) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 200));
  }
  return false;
}

async function runStart(start: StartPayload): Promise<void> {
  const active = room;
  crewLobbyOpen.value = false;
  if (!(await whenWorld())) {
    leaveRoom();
    return;
  }
  // The player may have left the room while the game was still loading.
  if (!active || room !== active || active.view.phase !== 'playing') return;
  const choice: SetupChoice = {
    site: start.choice.site,
    difficulty: start.choice.difficulty,
    weeks: start.choice.weeks,
    // Only the bundled history is used, so that every friend's game has exactly the same data.
    sunMode: 'featured',
    windowId: start.choice.windowId,
    tutorial: false,
    creative: false,
  };
  const before = profile.value.setup;
  const shared = start.mode === 'coop';
  crewMode.value = shared ? 'coop' : 'race';
  // In both modes the friends are drawn: at the outpost while they plan, and live on their walks.
  // (On a shared base they stand on the very same ground, so a walk outside is a walk together.)
  friendsOn = true;
  syncFriends(active.view);
  watchMission(start);
  try {
    await startMission(choice, { seed: start.seed, startDate: start.startDate });
  } finally {
    // The crew's mission must not change the player's own setup for the next solo game.
    updateProfile({ setup: before });
  }
  if (!shared || room !== active || active.view.phase !== 'playing') return;
  // One base together: the host's device runs the rules, every other device mirrors it.
  const view = active.view;
  try {
    coopSession =
      view.me === view.hostId
        ? startCoopHost(
            active,
            view.players.map((player) => player.id),
          )
        : startCoopGuest(active);
  } catch {
    // The shared base could not start: this device plays on alone.
    coopSession = null;
    crewMode.value = 'race';
    return;
  }
  watchCoopFriends(active);
}

/**
 * Keep the friends in step with the shared base (who is outside comes from the host's stage). When the base ends
 * by itself (the host left, or this device plays on alone) this device goes on in its own base: the friends are
 * drawn by their own numbers again, and the race mode's wait for the crew works as it always did.
 */
function watchCoopFriends(active: CrewRoom): void {
  stopCoopWatch?.();
  let seen = false;
  stopCoopWatch = effect(() => {
    const live = coopLive.value;
    if (room !== active) return;
    if (live) {
      seen = true;
      syncFriends(active.view, live);
    } else if (seen) {
      seen = false;
      queueMicrotask(() => {
        if (room !== active || coopLive.peek() !== null) return;
        crewMode.value = 'race';
        syncFriends(active.view, null);
      });
    }
  });
}

/** While the crew's mission runs, send our numbers. A different mission, or the title screen, ends the crew. */
function watchMission(start: StartPayload): void {
  stopWatching?.();
  let seen = false;
  // Our walk, as numbers: at most 5 a second, only on a walk, only when it changed, and once a second so friends know we are here.
  const sender = new PositionSender();
  const timer = window.setInterval(() => {
    const active = room;
    const world = getWorld();
    if (!active || active.view.phase !== 'playing' || !world || !world.ready) return;
    const walking = step.peek() === 'eva' && world.eva.active && !world.interior.active;
    const sample = walking
      ? positionSample(world.eva.position.x, world.eva.position.z, world.eva.facing, world.eva.speed > 0.3, world.rover.driving)
      : null;
    const out = sender.next(Date.now(), sample);
    if (out) active.sendPosition(out);
  }, 100);
  const stopEffect = effect(() => {
    const m = mission.value;
    const current = step.value;
    const where = screen.value;
    const active = room;
    if (!active || active.view.phase !== 'playing') return;
    const mine = !!m && m.config.seed === start.seed && m.config.startDate === start.startDate;
    if (mine && (where === 'game' || where === 'debrief')) seen = true;
    if (seen && (where === 'title' || where === 'setup' || (m && !mine))) {
      // Left to the menu, or began another mission: the crew is over for this player.
      queueMicrotask(leaveRoom);
      return;
    }
    if (!mine || !m) return;
    const status = statusOf(m, current);
    if (m.end !== null && where === 'debrief') active.sendFinal(status);
    else if (seen) active.sendStatus(status);
  });
  stopWatching = () => {
    window.clearInterval(timer);
    stopEffect();
  };
}
