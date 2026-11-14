/**
 * The network cannot tell who sent a message (docs/MULTIPLAYER.md, trust model), so a seated friend can send an `st`
 * in the commander's name with a revision far ahead. That cannot be refused, but it must not freeze a child's screen
 * for good: when only older snapshots keep coming, in order, the guest follows the commander again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMission } from '../src/sim/mission';
import { createCoop } from '../src/sim/coop';
import { COOP_NET, CoopGuest, CoopHost } from '../src/net/coop';
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

describe('a forged revision far ahead', () => {
  it('does not freeze the other guest: it follows the commander again', async () => {
    const r = await startedRooms(2);
    const host = new CoopHost(r.host.room, createCoop(createMission(config(), DATA), r.seats, r.clock.now()), { clock: r.clock });
    const guests = r.guests.map((g) => new CoopGuest(g.room, createMission(config(), DATA), { clock: r.clock }));
    await r.clock.advance(COOP_NET.tickMs * 30);
    const real = r.hub.log.filter((e) => e.event === 'st' && (e.payload as { from?: string }).from === r.host.id).pop()!;
    const forged = JSON.parse(JSON.stringify(real.payload)) as { rev: number };
    forged.rev += 1000;
    r.guests[0].transport.send('st', forged);
    await r.clock.advance(100);
    expect(guests[1].meta?.rev).toBe(forged.rev); // the forgery cannot be told from the commander: it is taken at first
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
