/**
 * Shared base: the joint between a session (src/net/coop.ts) and the director (src/game/director.ts).
 *
 * Call these after `startMission` has built the mission on this device (the host and every guest start the same
 * mission from the room's seed). The session works on the director's own mission object: the host's reducer changes
 * it, a guest's mirror replaces its live part in place. Every change the session reports is shown by the director
 * (`coopAdopt`), and when the session ends by itself the director goes on alone (`coopDetach`).
 */
import { coopAdopt, coopDetach, getState, setCoopPort } from '../game/director';
import { coopMeta, createCoop } from '../sim/coop';
import { CoopGuest, CoopHost, wallClock } from './coop';
import type { CoopClock, CoopSessionOptions } from './coop';
import { guestPort, hostPort } from './coopport';
import { setCoopControls, showCoop } from './coopview';
import type { SessionPort } from './coopport';
import type { CrewRoom } from './room';

export interface CoopLinkOptions {
  /** Injected clock (tests). */
  clock?: CoopClock;
}

/** The commander's device: the reducer is built on the director's mission, with the room's players as seats. */
export function startCoopHost(room: CrewRoom, seats: readonly string[], options: CoopLinkOptions = {}): CoopHost {
  const mission = getState();
  if (!mission) throw new Error('The mission must be started before the shared base');
  const clock = options.clock ?? wallClock;
  let host: CoopHost | null = null;
  const follow = (): void => {
    if (!host) return;
    const co = host.co;
    const wall = Date.now();
    showCoop(coopMeta(co, clock.now()), {
      me: room.view.me,
      hostId: co.host,
      alloc: co.mission.alloc,
      quiet: false,
      now: wall,
      capAt: co.planCap === null ? null : wall + (co.planCap - clock.now()),
    });
    coopAdopt(co.mission, co.stage, { choice: co.choice, outside: co.outside, goes: co.walk[room.view.me] });
  };
  const session: CoopSessionOptions = { clock, onChange: follow, onDetach: () => coopDetach() };
  host = new CoopHost(room, createCoop(mission, seats, clock.now()), session);
  if (!host.active) return host; // the room was already closed
  setCoopPort(hostPort(host));
  setCoopControls({ go: () => void host?.submit({ k: 'go' }), playAlone: () => {}, silentMs: () => 0 });
  follow();
  return host;
}

/** A guest's device: the session mirrors the host into the director's mission. */
export function startCoopGuest(room: CrewRoom, options: CoopLinkOptions = {}): CoopGuest {
  const mission = getState();
  if (!mission) throw new Error('The mission must be started before the shared base');
  const me = room.view.me;
  let guest: CoopGuest | null = null;
  let port: SessionPort | null = null;
  const follow = (): void => {
    const meta = guest?.meta;
    if (!guest || !meta) return;
    port?.reassert();
    // `follow` also runs without a new snapshot (quiet flips, a week's record): count the seconds from the clock, not from the old `left`.
    showCoop(
      { ...meta, left: guest.secondsLeft() },
      { me, hostId: room.view.hostId ?? meta.seats[0], alloc: guest.mission.alloc, quiet: guest.quiet, now: Date.now() },
    );
    coopAdopt(guest.mission, meta.stage, { choice: meta.choice, outside: meta.outside, goes: meta.walk[me] });
  };
  const session: CoopSessionOptions = { clock: options.clock, onChange: follow, onDetach: () => coopDetach() };
  guest = new CoopGuest(room, mission, session);
  if (!guest.active) return guest;
  port = guestPort(guest, me);
  setCoopPort(port);
  setCoopControls({ go: () => {}, playAlone: () => coopDetach(), silentMs: () => guest?.silentMs ?? 0 });
  follow();
  return guest;
}
