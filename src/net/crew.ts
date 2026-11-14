/**
 * Crew mode, as the screens see it: signals to draw from, and a few functions to call.
 * This is the only file that connects the room (room.ts) to the game: it reads the mission signals
 * to send our numbers, and calls startMission when the host starts. It never changes the game's
 * own files, and nothing here runs until a player opens crew mode.
 */
import { effect, signal } from '@preact/signals';
import { audio } from '../game/audio';
import { getWorld, startMission } from '../game/director';
import { mission, profile, screen, step, updateProfile } from '../game/store';
import type { SetupChoice } from '../game/store';
import { FEATURED_WINDOWS } from '../sim/sites';
import { netConfig, transportKind } from './config';
import { CREW_NAME_COUNT, REACTIONS, REACTION_ICON, REACTION_MIN_MS, newPlayerId, startDateOf, statusOf, suitIndex } from './protocol';
import type { CrewChoice, ReactionId, StartPayload } from './protocol';
import { CrewRoom } from './room';
import type { Player, RoomView } from './room';
import { SupabaseTransport } from './supabase';
import { LocalTransport } from './transport';
import type { Transport } from './transport';

const IDLE: RoomView = { phase: 'idle', code: '', me: '', hostId: null, players: [], online: true, failure: null, start: null };

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

let room: CrewRoom | null = null;
let unsubscribe: (() => void) | null = null;
let stopWatching: (() => void) | null = null;
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
  });
  next.onStart = (start) => void runStart(start);
  next.onReaction = (player, reaction) => showReaction(player, reaction);
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
  stopWatching?.();
  stopWatching = null;
  unsubscribe?.();
  unsubscribe = null;
  room?.leave();
  room = null;
  crewView.value = IDLE;
  crewToasts.value = [];
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
export function hostStart(pick: { site: SetupChoice['site']; difficulty: SetupChoice['difficulty']; weeks: number }): boolean {
  if (!room || !getWorld()) return false;
  const windows = FEATURED_WINDOWS.filter((window) => window.sites.includes(pick.site));
  const window = windows[Math.floor(Math.random() * windows.length)];
  const choice: CrewChoice = { site: pick.site, difficulty: pick.difficulty, weeks: pick.weeks, windowId: window.id };
  const startDate = startDateOf(window.id);
  if (!startDate) return false;
  return room.start(choice, Math.floor(Math.random() * 2 ** 31), startDate);
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
  watchMission(start);
  try {
    await startMission(choice, { seed: start.seed, startDate: start.startDate });
  } finally {
    // The crew's mission must not change the player's own setup for the next solo game.
    updateProfile({ setup: before });
  }
}

/** While the crew's mission runs, send our numbers. A different mission, or the title screen, ends the crew. */
function watchMission(start: StartPayload): void {
  stopWatching?.();
  let seen = false;
  stopWatching = effect(() => {
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
}
