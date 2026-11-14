/**
 * The wire fuzz for the signed envelope and the new presence fields (key `k`, seat keys `mk`, host signature `g`),
 * and the size rules for what signing adds. (The parsers of the co-op messages themselves are fuzzed in tests/fuzz.test.ts
 * and tests/coopwire.test.ts; the envelope is taken off before they run.) Uses the deterministic fake crypto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../src/sim/rng';
import { CREW_SUITS, PROTOCOL, parseMeta, sizeLimit, startDateOf } from '../src/net/protocol';
import type { CrewChoice, Status } from '../src/net/protocol';
import { CrewRoom } from '../src/net/room';
import { SIG_OVERHEAD } from '../src/net/sign';
import { MemoryHub, MemoryTransport } from '../src/net/transport';
import { Handmade } from './handmade';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

const tick = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

const CHOICE: CrewChoice = { site: 'mars', difficulty: 'cadet', weeks: 6, windowId: 'may2024' };
const START_DATE = startDateOf('may2024')!;
const KEY = 'K'.repeat(87);
const SIG = 'S'.repeat(86);
const status = (over: Partial<Status> = {}): Status => ({ week: 2, step: 'plan', air: 90, food: 5, dose: 10, doseLimit: 100, science: 10, stars: 0, end: null, storm: { w: 0, s: 0, k: false, a: 0 }, ...over });

describe('presence: key, seat keys and host signature', () => {
  const base = { id: 'abc123def4', n: 3, c: 2, r: true, h: false, s: false, t: 1, v: PROTOCOL, k: KEY };
  const host = { ...base, h: true, m: ['abc123def4', 'player01aa'], mk: [KEY, 'J'.repeat(87)], g: SIG };

  it('the current version must carry a key; a host must carry a signature and one seat key for each seat', () => {
    expect(parseMeta(base)).toEqual({ ...base, m: [], mk: [], g: '', p: null });
    expect(parseMeta(host)).toEqual({ ...host, p: null });
    for (const patch of [{ k: undefined }, { k: 'short' }, { k: 'K'.repeat(88) }, { k: 5 }, { k: '!'.repeat(87) }, { g: undefined }, { g: 'S'.repeat(85) }, { g: 7 }, { mk: undefined }, { mk: [KEY] }, { mk: [KEY, 'bad'] }, { mk: [KEY, 5] }, { mk: 'nope' }, { m: ['abc123def4', 'abc123def4'], mk: [KEY, KEY] }]) {
      expect(parseMeta({ ...host, ...patch }), JSON.stringify(patch)).toBeNull();
    }
    expect(parseMeta({ ...base, k: undefined })).toBeNull();
  });

  it('an older version needs none of it (it is refused by the version check, not by its shape)', () => {
    const old = { id: 'abc123def4', n: 3, c: 2, r: true, h: false, s: false, t: 1, v: 1 };
    expect(parseMeta(old)).toEqual({ ...old, m: [], mk: [], g: '', k: '', p: null });
    expect(parseMeta({ ...old, v: PROTOCOL + 1 })?.v).toBe(PROTOCOL + 1);
    // ... but what it does send is checked all the same
    expect(parseMeta({ ...old, k: 'bad' })).toBeNull();
    expect(parseMeta({ ...old, m: ['abc123def4'], mk: [] })).toBeNull();
  });

  it('random mutations of a presence entry: never a throw, and what comes out has only well-formed keys and signatures', () => {
    const rng = mulberry32(2024);
    const junk: unknown[] = [null, undefined, 0, -1, 1.5, NaN, Infinity, 'x', '', 'K'.repeat(87), 'S'.repeat(86), '$'.repeat(87), [], [KEY], {}, { k: KEY }, true, false, 'A'.repeat(100_000), ['a'.repeat(10)], [[KEY]], '__proto__'];
    const fields = ['id', 'n', 'c', 'r', 'h', 's', 't', 'v', 'k', 'mk', 'g', 'm', 'p'];
    let accepted = 0;
    for (let i = 0; i < 4000; i++) {
      const entry: Record<string, unknown> = JSON.parse(JSON.stringify(rng() < 0.5 ? host : base));
      const changes = 1 + Math.floor(rng() * 3);
      for (let c = 0; c < changes; c++) {
        const field = fields[Math.floor(rng() * fields.length)];
        const roll = rng();
        if (roll < 0.2) delete entry[field];
        else entry[field] = junk[Math.floor(rng() * junk.length)];
      }
      let result: ReturnType<typeof parseMeta>;
      expect(() => (result = parseMeta(entry))).not.toThrow();
      if (!result!) continue;
      accepted++;
      expect(result.k === '' || /^[A-Za-z0-9_-]{87}$/.test(result.k)).toBe(true);
      expect(result.g === '' || /^[A-Za-z0-9_-]{86}$/.test(result.g)).toBe(true);
      expect(result.mk.every((key) => key === '' || /^[A-Za-z0-9_-]{87}$/.test(key))).toBe(true);
      expect(result.mk.length === 0 || result.mk.length === result.m.length).toBe(true);
      if (result.v === PROTOCOL) expect(result.k).not.toBe('');
    }
    expect(accepted).toBeGreaterThan(50); // the fuzz did reach the good side too
  });
});

// ----- Through a room ------------------------------------------------------------------------------------------------------

let counter = 0;
function player(hub: MemoryHub) {
  counter++;
  const id = `wire${String(counter).padStart(5, '0')}`;
  const room = new CrewRoom(() => new MemoryTransport(hub), { me: { id, name: counter % 16, suit: counter % CREW_SUITS.length }, joinGraceMs: 50, createGraceMs: 50, hostGoneMs: 1000 });
  return { id, room };
}

async function playingWith(handId: string) {
  const hub = new MemoryHub();
  const host = player(hub);
  const made = host.room.create();
  await tick(100);
  expect(await made).toBe(true);
  const code = host.room.view.code;
  const guest = player(hub);
  const joined = guest.room.join(code);
  await tick(100);
  expect(await joined).toBe(true);
  guest.room.setReady(true);
  const hand = await Handmade.join(hub, code, { id: handId });
  await tick(100);
  expect(host.room.start(CHOICE, 7, START_DATE)).toBe(true);
  await tick(10);
  return { hub, host, guest, hand, code };
}

describe('the signed envelope: random junk and random mutations of real messages', () => {
  const weeks = (r: CrewRoom, id: string): number | undefined => r.view.players.find((p) => p.id === id)?.status?.week;

  it('random frames of any shape never throw out of the room and change nothing', async () => {
    const { guest, hand } = await playingWith('fuzzclient1');
    const room = guest.room as unknown as { takeMessage(token: number, event: string, payload: unknown): unknown; token: number };
    const rng = mulberry32(77);
    const junk: unknown[] = [null, undefined, 0, -1, 2 ** 53, 1.5, NaN, 'x', '', 'S'.repeat(86), '$'.repeat(86), [], {}, { sig: SIG }, true, 'A'.repeat(70_000), [1, 2], { a: { b: { c: {} } } }];
    const events = ['status', 'final', 'react', 'pos', 'st', 'rec', 'int', 'sync', 'start', 'chat', '__proto__', ''];
    const players = [hand.id, guest.id, 'wire00001', 'nobody0000', 5, null];
    for (let i = 0; i < 3000; i++) {
      const payload: Record<string, unknown> = { ...status(), from: players[Math.floor(rng() * players.length)], q: junk[Math.floor(rng() * junk.length)], sig: junk[Math.floor(rng() * junk.length)] };
      if (rng() < 0.3) payload.pad = junk[Math.floor(rng() * junk.length)];
      if (rng() < 0.2) delete payload[['q', 'sig', 'from'][Math.floor(rng() * 3)]];
      const event = events[Math.floor(rng() * events.length)];
      const shape = rng() < 0.2 ? junk[Math.floor(rng() * junk.length)] : payload;
      expect(() => room.takeMessage(room.token, event, shape)).not.toThrow();
    }
    // Over the network too.
    for (let i = 0; i < 300; i++) hand.raw(events[i % events.length], i % 3 === 0 ? junk[i % junk.length] : { from: hand.id, ...status({ week: 6 }), q: i + 1, sig: 'S'.repeat(86) });
    await tick(50);
    expect(weeks(guest.room, hand.id)).toBeUndefined();
    expect(guest.room.view.phase).toBe('playing');
  });

  it('every real message with one to three fields changed, added or removed is dropped', async () => {
    const { hub, host, guest, hand, code } = await playingWith('fuzzclient2');
    host.room.sendStatus(status({ week: 2 }));
    host.room.sendReaction('wow');
    host.room.sendPosition({ x: 1, z: 2, a: 0.5, m: 1 });
    await tick(700);
    const real = hub.log.filter((entry) => entry.from === host.id && ['status', 'react', 'pos'].includes(entry.event));
    expect(real.length).toBe(3);
    // Somebody else (the hand-made seat) copies them with changes, under the host id. The room code stays the same.
    const rng = mulberry32(5);
    const values: unknown[] = [0, 1, 2, 99, -5, 'x', '', null, true, [], {}, 1.5];
    const transport = hand.transport;
    for (let i = 0; i < 600; i++) {
      const entry = real[i % real.length];
      const copy = JSON.parse(JSON.stringify(entry.payload)) as Record<string, unknown>;
      const keys = Object.keys(copy);
      const changes = 1 + Math.floor(rng() * 3);
      for (let c = 0; c < changes; c++) {
        const roll = rng();
        const key = roll < 0.2 ? `extra${c}` : keys[Math.floor(rng() * keys.length)];
        if (roll < 0.4 && key in copy) delete copy[key];
        else copy[key] = values[Math.floor(rng() * values.length)];
      }
      transport.send(entry.event, copy);
    }
    await tick(100);
    // Nothing the copies said got through: the guest still shows the host real numbers, and only the one real sticker.
    expect(weeks(guest.room, host.id)).toBe(2);
    expect(guest.room.view.players.find((p) => p.id === host.id)?.finished).toBe(false);
    expect(code).toBeTruthy();
  });
});

describe('size: what signing adds', () => {
  it('SIG_OVERHEAD covers the counter and the signature of the largest counter', () => {
    const envelope = `,"q":${2 ** 40},"sig":"${SIG}"`;
    expect(envelope.length).toBeLessThanOrEqual(SIG_OVERHEAD);
    // The body limits themselves are unchanged (st 3000, rec 1200, everything else 700): they apply to the body, without the envelope.
    expect([sizeLimit('st'), sizeLimit('rec'), sizeLimit('int'), sizeLimit('status'), sizeLimit('sync')]).toEqual([3000, 1200, 700, 700, 700]);
  });
});
