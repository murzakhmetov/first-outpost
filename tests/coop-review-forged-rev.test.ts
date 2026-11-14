/**
 * The second line of defence behind the signatures (docs/MULTIPLAYER.md, "Signed messages" and "Honest limits of the shared base").
 * A seated friend can no longer send an `st` in the commander's name (tests/signed-forgery.test.ts proves it is refused). Should a
 * snapshot with a revision far ahead still be taken (a commander with a bug, a modified commander), it must not freeze a child's
 * screen for good: when only older snapshots keep coming, in order, for a while, the guest follows the commander again.
 * The high snapshot is put into the guest directly here, because no forged one can reach it any more.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMission } from '../src/sim/mission';
import { createCoop } from '../src/sim/coop';
import { COOP_NET, CoopGuest, CoopHost } from '../src/net/coop';
import { liveOf } from '../src/net/coopwire';
import type { CoopMeta } from '../src/sim/coop';
import type { MissionConfig } from '../src/sim/types';
import { CHOICE, SEED, START_DATE, startedRooms } from './coop-rig';
import { DATA } from './bots';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const config = (): MissionConfig => ({ site: CHOICE.site, difficulty: CHOICE.difficulty, weeks: CHOICE.weeks, startDate: START_DATE, seed: SEED, tutorial: false, sunMode: 'random', windowId: CHOICE.windowId });

describe('a revision far ahead that was taken', () => {
  it('does not freeze the guest: it follows the commander again', async () => {
    const r = await startedRooms(2);
    const host = new CoopHost(r.host.room, createCoop(createMission(config(), DATA), r.seats, r.clock.now()), { clock: r.clock });
    const guests = r.guests.map((g) => new CoopGuest(g.room, createMission(config(), DATA), { clock: r.clock }));
    await r.clock.advance(COOP_NET.tickMs * 30);
    const meta = guests[1].meta!;
    const far = meta.rev + 1000;
    (guests[1] as unknown as { take(meta: CoopMeta, live: unknown): void }).take({ ...meta, rev: far }, liveOf(host.co.mission));
    expect(guests[1].meta?.rev).toBe(far); // taken at first
    // The commander goes on (a real change) and keeps its heartbeat.
    host.submit({ k: 'ready', on: true });
    await r.clock.advance(COOP_NET.heartbeatMs * 6);
    expect(guests[1].meta?.rev).toBe(host.co.rev);
    expect(guests[1].meta?.ready).toEqual(host.co.ready);
  });

  it('a reordered old snapshot alone does not move the guest back', async () => {
    const r = await startedRooms(1);
    const host = new CoopHost(r.host.room, createCoop(createMission(config(), DATA), r.seats, r.clock.now()), { clock: r.clock });
    const guest = new CoopGuest(r.guests[0].room, createMission(config(), DATA), { clock: r.clock });
    await r.clock.advance(500);
    host.submit({ k: 'ready', on: true });
    await r.clock.advance(500);
    const rev = guest.meta!.rev;
    const old = r.hub.log.filter((e) => e.event === 'st' && (e.payload as { from?: string }).from === r.host.id)[0].payload as { rev: number };
    expect(old.rev).toBeLessThan(rev);
    r.host.transport.send('st', old);
    await r.clock.advance(200);
    expect(guest.meta?.rev).toBe(rev);
  });
});
