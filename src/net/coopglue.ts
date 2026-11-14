/**
 * Shared base: the joint between a session (src/net/coop.ts) and the director (src/game/director.ts).
 *
 * Call these after `startMission` has built the mission on this device (the host and every guest start the same
 * mission from the room's seed). The session works on the director's own mission object: the host's reducer changes
 * it, a guest's mirror replaces its live part in place. Every change the session reports is shown by the director
 * (`coopAdopt`), and when the session ends by itself the director goes on alone (`coopDetach`).
 */
import { coopAdopt, coopDetach, getState, setCoopPort } from '../game/director';
import { createCoop } from '../sim/coop';
import { CoopGuest, CoopHost, wallClock } from './coop';
import type { CoopClock, CoopSessionOptions } from './coop';
import { guestPort, hostPort } from './coopport';
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
    coopAdopt(co.mission, co.stage, { choice: co.choice, outside: co.outside, goes: co.walk[room.view.me] });
  };
  const session: CoopSessionOptions = { clock, onChange: follow, onDetach: () => coopDetach() };
  host = new CoopHost(room, createCoop(mission, seats, clock.now()), session);
  if (!host.active) return host; // the room was already closed
  setCoopPort(hostPort(host));
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
    coopAdopt(guest.mission, meta.stage, { choice: meta.choice, outside: meta.outside, goes: meta.walk[me] });
  };
  const session: CoopSessionOptions = { clock: options.clock, onChange: follow, onDetach: () => coopDetach() };
  guest = new CoopGuest(room, mission, session);
  if (!guest.active) return guest;
  port = guestPort(guest, me);
  setCoopPort(port);
  follow();
  return guest;
}
