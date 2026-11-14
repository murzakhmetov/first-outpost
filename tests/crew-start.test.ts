/**
 * Starting a crew mission in both modes (src/net/crew.ts): "Each their own base" (race) and "One base together" (coop).
 * Two devices are two copies of crew.ts on one in-memory network. The director and the shared-base glue are replaced
 * by recorders, so the test sees exactly who starts a host session, who starts a guest session, and when it ends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeCrypto } from './fake-crypto';
import { shims } from './harness';

const rec = vi.hoisted(() => ({
  hub: null as unknown,
  started: [] as string[],
  hostSeats: [] as string[][],
  disposed: 0,
  detached: 0,
  missions: 0,
}));

vi.mock('../src/game/director', () => ({
  getWorld: () => ({ setFriends() {}, setFriendPosition() {}, ready: false }),
  goNextWeek: () => {},
  startMission: async () => {
    rec.missions++;
  },
  coopDetach: () => {
    rec.detached++;
  },
}));
vi.mock('../src/game/audio', () => ({ audio: { play() {} } }));
vi.mock('../src/net/coopglue', () => ({
  startCoopHost: (_room: unknown, seats: string[]) => {
    rec.started.push('host');
    rec.hostSeats.push([...seats]);
    return {
      dispose: () => {
        rec.disposed++;
      },
    };
  },
  startCoopGuest: () => {
    rec.started.push('guest');
    return {
      dispose: () => {
        rec.disposed++;
      },
    };
  },
}));
vi.mock('../src/net/supabase', async () => {
  const { MemoryTransport } = await import('../src/net/transport');
  return {
    SupabaseTransport: class extends MemoryTransport {
      constructor() {
        super(rec.hub as never);
      }
    },
  };
});

shims();
const { MemoryHub } = await import('../src/net/transport');

type Crew = typeof import('../src/net/crew');
const tick = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

/** One device: its own copy of crew.ts. */
async function device(): Promise<Crew> {
  vi.resetModules();
  // A fresh module registry has a fresh default crypto: give this device the deterministic fake again.
  (await import('../src/net/sign')).setCrewCrypto(fakeCrypto);
  return (await import('../src/net/crew')) as Crew;
}

/** A host and a friend in a lobby, the friend ready. */
async function lobby() {
  rec.hub = new MemoryHub();
  const host = await device();
  const made = host.createRoom();
  await tick(600);
  await made;
  const guest = await device();
  const joined = guest.joinRoom(host.crewView.value.code);
  await tick(1600);
  await joined;
  guest.setReady(true);
  await tick(50);
  return { host, guest };
}

const PICK = { site: 'mars', difficulty: 'cadet', weeks: 6 } as const;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  rec.started = [];
  rec.hostSeats = [];
  rec.disposed = 0;
  rec.detached = 0;
  rec.missions = 0;
});
afterEach(async () => {
  await tick(10);
  vi.useRealTimers();
});

describe('starting a crew mission', () => {
  it('one base together: the host runs the rules, the friend mirrors, both start the mission', async () => {
    const { host, guest } = await lobby();
    expect(host.canStart()).toBe(true);
    expect(host.hostStart(PICK, 'coop')).toBe(true);
    await tick(300);
    expect(host.crewView.value.start?.mode).toBe('coop');
    expect(guest.crewView.value.start?.mode).toBe('coop');
    expect(rec.missions).toBe(2);
    expect(rec.started.slice().sort()).toEqual(['guest', 'host']);
    // Seats: both players, by id.
    expect(rec.hostSeats).toHaveLength(1);
    expect(rec.hostSeats[0]).toHaveLength(2);
    expect(rec.hostSeats[0]).toContain(host.crewView.value.me);
    expect(rec.hostSeats[0]).toContain(guest.crewView.value.me);
    expect(host.crewMode.value).toBe('coop');
    expect(guest.crewMode.value).toBe('coop');
  });

  it('leaving the room ends the shared base on this device only', async () => {
    const { host, guest } = await lobby();
    host.hostStart(PICK, 'coop');
    await tick(300);
    guest.leaveRoom();
    expect(rec.disposed).toBe(1);
    expect(rec.detached).toBe(1);
    expect(guest.crewMode.value).toBe('race');
    host.leaveRoom();
    expect(rec.disposed).toBe(2);
    expect(rec.detached).toBe(2);
  });

  it('each their own base: no shared base on any device, and nothing to dispose', async () => {
    const { host, guest } = await lobby();
    expect(host.hostStart(PICK, 'race')).toBe(true);
    await tick(300);
    expect(rec.missions).toBe(2);
    expect(rec.started).toEqual([]);
    expect(host.crewView.value.start?.mode).toBeUndefined();
    expect(host.crewMode.value).toBe('race');
    expect(guest.crewMode.value).toBe('race');
    guest.leaveRoom();
    host.leaveRoom();
    expect(rec.disposed).toBe(0);
    expect(rec.detached).toBe(0);
  });

  it('the old call without a mode is still race mode', async () => {
    const { host } = await lobby();
    expect(host.hostStart(PICK)).toBe(true);
    await tick(300);
    expect(rec.started).toEqual([]);
    expect(host.crewView.value.start?.mode).toBeUndefined();
  });
});

describe('the kill switch', () => {
  it('shows the choice to everyone now that the shared base is on', async () => {
    const { coopVisible, COOP_DEFAULT_VISIBLE } = await import('../src/net/config');
    expect(COOP_DEFAULT_VISIBLE).toBe(true);
    expect(coopVisible('', {})).toBe(true);
    expect(coopVisible('?crew=local', {})).toBe(true);
    expect(coopVisible('?coop=1', {})).toBe(true);
    expect(coopVisible('', { VITE_COOP: '0' })).toBe(true);
  });
});
