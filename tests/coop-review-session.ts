/** A commander and one guest over a started co-op room (for the review tests): sessions driven by hand, no director. */
import { vi } from 'vitest';
import { createMission } from '../src/sim/mission';
import { createCoop } from '../src/sim/coop';
import { CoopGuest, CoopHost } from '../src/net/coop';
import type { MissionConfig } from '../src/sim/types';
import { CHOICE, SEED, START_DATE, startedRooms } from './coop-rig';
import { DATA } from './bots';

const config = (): MissionConfig => ({ site: CHOICE.site, difficulty: CHOICE.difficulty, weeks: CHOICE.weeks, startDate: START_DATE, seed: SEED, tutorial: false, sunMode: 'random', windowId: CHOICE.windowId });

export async function commanderAndGuest() {
  const r = await startedRooms(1);
  const host = new CoopHost(r.host.room, createCoop(createMission(config(), DATA), r.seats, r.clock.now()), { clock: r.clock });
  const guest = new CoopGuest(r.guests[0].room, createMission(config(), DATA), { clock: r.clock });
  await vi.advanceTimersByTimeAsync(10);
  return { hub: r.hub, clock: r.clock, host, guest, hostId: r.host.id, guestId: r.guests[0].id };
}
