/**
 * Signed messages with the REAL Web Crypto (ECDSA P-256 from Node's globalThis.crypto.subtle), through rooms on the
 * in-memory network and on the `?crew=local` transport. Everything else in the suite uses the deterministic synchronous
 * fake (tests/fake-crypto.ts); here the checks finish later, so these tests use real timers and wait for the outcome.
 * They cover: keys and signatures, what is signed, pinning, replays, unsigned and mixed-version refusals, the ordered
 * pipeline (a slow check must never let a later message overtake an earlier one), no Web Crypto, and a whole co-op session.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COOP_NET, CoopGuest, CoopHost, wallClock } from '../src/net/coop';
import { createCoop, coopMeta } from '../src/sim/coop';
import { createMission } from '../src/sim/mission';
import { CREW_SUITS, PROTOCOL, sizeLimit, startDateOf } from '../src/net/protocol';
import type { CrewChoice, Position, Status } from '../src/net/protocol';
import { CrewRoom } from '../src/net/room';
import type { Player } from '../src/net/room';
import { Ordered, SIG_OVERHEAD, canSign, canonical, messageText, presenceText, webCrypto } from '../src/net/sign';
import type { CrewCrypto, Identity } from '../src/net/sign';
import { LocalTransport, MemoryHub, MemoryTransport } from '../src/net/transport';
import type { Transport, TransportHandlers } from '../src/net/transport';
import type { MissionConfig } from '../src/sim/types';
import { DATA } from './bots';
import { Handmade, signedBy } from './handmade';

// Real Web Crypto and real timers: a loaded machine (the whole suite runs in parallel) needs more than the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  vi.unstubAllGlobals();
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait (real time) until `condition` holds. A short wait to be sure that something did NOT happen is `await sleep(...)`. */
async function until(condition: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await sleep(3);
  }
}

const CHOICE: CrewChoice = { site: 'mars', difficulty: 'cadet', weeks: 6, windowId: 'may2024' };
const START_DATE = startDateOf('may2024')!;

const status = (over: Partial<Status> = {}): Status => ({ week: 2, step: 'plan', air: 90, food: 5, dose: 10, doseLimit: 100, science: 10, stars: 0, end: null, storm: { w: 0, s: 0, k: false, a: 0 }, ...over });

let counter = 0;

interface Options {
  crypto?: CrewCrypto;
  transport?: () => Transport;
  now?: () => number;
  /** How long a join or a create waits (ms). The real checks take a few milliseconds, a loaded machine many more. */
  grace?: number;
}

function player(hub: MemoryHub | null, options: Options = {}) {
  counter++;
  const id = `real${String(counter).padStart(5, '0')}`;
  const positions: { player: Player; position: Position }[] = [];
  const reactions: { id: string; reaction: string }[] = [];
  const starts: unknown[] = [];
  const room = new CrewRoom(options.transport ?? (() => new MemoryTransport(hub!)), {
    me: { id, name: counter % 16, suit: counter % CREW_SUITS.length },
    crypto: options.crypto ?? webCrypto,
    now: options.now,
    joinGraceMs: options.grace ?? 300,
    createGraceMs: options.grace ?? 300,
    hostGoneMs: 1500,
  });
  room.onPosition = (who, position) => positions.push({ player: who, position });
  room.onReaction = (who, reaction) => reactions.push({ id: who.id, reaction });
  room.onStart = (start) => starts.push(start);
  return { id, room, positions, reactions, starts };
}
type TestPlayer = ReturnType<typeof player>;

async function lobby(options: Options = {}, guestCount = 1) {
  const hub = new MemoryHub();
  const host = player(hub, options);
  expect(await host.room.create()).toBe(true);
  const code = host.room.view.code;
  const guests: TestPlayer[] = [];
  for (let i = 0; i < guestCount; i++) {
    const guest = player(hub, options);
    expect(await guest.room.join(code)).toBe(true);
    guest.room.setReady(true);
    guests.push(guest);
  }
  await until(() => host.room.canStart());
  return { hub, host, guests, code };
}

async function playing(options: Options = {}, guestCount = 1, mode: 'race' | 'coop' = 'race') {
  const set = await lobby(options, guestCount);
  expect(set.host.room.start(CHOICE, 7, START_DATE, mode)).toBe(true);
  await until(() => set.guests.every((guest) => guest.room.view.phase === 'playing'));
  return set;
}

// ----- Keys and signatures ----------------------------------------------------------------------------------

describe('Web Crypto keys and signatures', () => {
  it('there is Web Crypto here, and a key pair gives a 65 byte public key and 64 byte signatures as base64url', async () => {
    expect(canSign()).toBe(true);
    const identity = await webCrypto.generate();
    expect(identity.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    const sig = await identity.sign('hello');
    expect(sig).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(await webCrypto.verify(identity.publicKey, 'hello', sig)).toBe(true);
  });

  it('a different text, a different key, a changed signature and garbage are all refused, and never throw', async () => {
    const a = await webCrypto.generate();
    const b = await webCrypto.generate();
    const sig = await a.sign('the text');
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(await webCrypto.verify(a.publicKey, 'the texT', sig)).toBe(false);
    expect(await webCrypto.verify(b.publicKey, 'the text', sig)).toBe(false);
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(await webCrypto.verify(a.publicKey, 'the text', flipped)).toBe(false);
    for (const junk of ['', 'x', '!!!', 'A'.repeat(86), '$'.repeat(86), 'A'.repeat(500)]) expect(await webCrypto.verify(a.publicKey, 'the text', junk)).toBe(false);
    for (const junk of ['', 'x', 'A'.repeat(87), '$'.repeat(87), 'A'.repeat(500)]) expect(await webCrypto.verify(junk, 'the text', sig)).toBe(false);
  });

  it('the private half is not extractable, and the identity shows only the public key and a way to sign', async () => {
    const generate = vi.spyOn(globalThis.crypto.subtle, 'generateKey');
    const identity = await webCrypto.generate();
    expect(Object.keys(identity).sort()).toEqual(['publicKey', 'sign']);
    expect(generate).toHaveBeenCalledTimes(1);
    const [algorithm, extractable] = generate.mock.calls[0];
    expect(algorithm).toMatchObject({ name: 'ECDSA', namedCurve: 'P-256' });
    expect(extractable).toBe(false);
    const pair = (await generate.mock.results[0].value) as CryptoKeyPair;
    expect(pair.privateKey.extractable).toBe(false);
    await expect(globalThis.crypto.subtle.exportKey('pkcs8', pair.privateKey)).rejects.toThrow();
    await expect(globalThis.crypto.subtle.exportKey('jwk', pair.privateKey)).rejects.toThrow();
    generate.mockRestore();
  });

  it('what is signed: the sorted-key text of everything but the signature, in this room, for this event', () => {
    const body = { from: 'abcdef1234', q: 5, rev: 3, seats: ['a1b2c3d4e5', 'f6g7h8j9k2'], nested: { z: 1, a: [1, { y: 2, b: 3 }] } };
    const shuffled = { nested: { a: [1, { b: 3, y: 2 }], z: 1 }, seats: ['a1b2c3d4e5', 'f6g7h8j9k2'], rev: 3, q: 5, from: 'abcdef1234' };
    expect(messageText('K7M2QX', 'st', body)).toBe(messageText('K7M2QX', 'st', shuffled));
    expect(canonical({ b: 1, a: undefined, c: NaN })).toBe('{"b":1,"c":null}');
    const base = messageText('K7M2QX', 'st', body);
    expect(messageText('K7M2QY', 'st', body)).not.toBe(base); // another room
    expect(messageText('K7M2QX', 'rec', body)).not.toBe(base); // another event
    expect(messageText('K7M2QX', 'st', { ...body, q: 6 })).not.toBe(base); // another counter
    expect(messageText('K7M2QX', 'st', { ...body, from: 'abcdef1235' })).not.toBe(base); // another sender
    expect(messageText('K7M2QX', 'st', { ...body, rev: 4 })).not.toBe(base); // other content
    expect(messageText('K7M2QX', 'st', { ...body, extra: 1 })).not.toBe(base); // an added field
    expect(base).toContain(`/${PROTOCOL}/`); // the wire version
    const meta = { id: 'abcdef1234', v: PROTOCOL, k: 'K'.repeat(87), s: false, p: null, m: ['abcdef1234'], mk: ['K'.repeat(87)] };
    expect(presenceText('K7M2QX', meta)).not.toBe(presenceText('K7M2QX', { ...meta, s: true }));
    expect(presenceText('K7M2QX', meta)).not.toBe(presenceText('K7M2QY', meta));
    expect(presenceText('K7M2QX', meta)).not.toBe(presenceText('K7M2QX', { ...meta, mk: ['J'.repeat(87)] }));
  });
});

// ----- Rooms with the real thing ---------------------------------------------------------------------------------------

describe('rooms signing with Web Crypto', () => {
  it('a lobby forms, the host start is signed, and status, sticker and position reach the friend', async () => {
    const { hub, host, guests } = await playing();
    const guest = guests[0];
    expect(guest.room.view.start?.seed).toBe(7);
    host.room.sendStatus(status({ week: 3 }));
    expect(host.room.sendReaction('great')).toBe(true);
    host.room.sendPosition({ x: 1, z: 2, a: 0, m: 1 });
    guest.room.sendStatus(status({ week: 4 }));
    await until(() => guest.room.view.players.find((p) => p.id === host.id)?.status?.week === 3 && guest.reactions.length === 1 && guest.positions.length === 1);
    await until(() => host.room.view.players.find((p) => p.id === guest.id)?.status?.week === 4);
    // What went over the network: every message carries a counter and a signature; the host presence carries its decisions signed.
    const frames = hub.log.filter((entry) => ['status', 'react', 'pos'].includes(entry.event));
    expect(frames.length).toBeGreaterThanOrEqual(4);
    for (const entry of frames) {
      const payload = entry.payload as { from: string; q: number; sig: string };
      expect(payload.sig).toMatch(/^[A-Za-z0-9_-]{86}$/);
      expect(Number.isInteger(payload.q) && payload.q > 0).toBe(true);
      expect(payload.from).toBe(entry.from);
    }
    const hostEntry = hub.members(`fo-crew-${host.room.view.code}`).find((m) => m.key === host.id)!.meta as { g: string; k: string; mk: string[]; m: string[] };
    expect(hostEntry.g).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(hostEntry.k).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(hostEntry.m).toEqual([host.id, guest.id]);
    expect(hostEntry.mk).toHaveLength(2);
    expect(hostEntry.mk[0]).toBe(hostEntry.k);
    // The counter of one sender only goes up.
    const qs = frames.filter((entry) => entry.from === host.id).map((entry) => (entry.payload as { q: number }).q);
    expect(qs).toEqual([...qs].sort((x, y) => x - y));
    expect(new Set(qs).size).toBe(qs.length);
  });

  it('presence entries and messages that come back with their keys shuffled and an extra field (presence_ref) still check out', async () => {
    const shuffle = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(shuffle);
      if (value === null || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value as object).reverse().map(([key, inner]) => [key, shuffle(inner)]));
    };
    class Noisy extends MemoryTransport {
      override connect(room: string, key: string, meta: unknown, handlers: TransportHandlers): Promise<void> {
        return super.connect(room, key, meta, {
          presence: (list) => handlers.presence(list.map((entry, index) => ({ key: entry.key, meta: { ...(shuffle(entry.meta) as object), presence_ref: `ref${index}` } }))),
          message: (event, payload) => handlers.message(event, shuffle(payload)),
          status: handlers.status,
        });
      }
    }
    const hub = new MemoryHub();
    const host = player(hub, { transport: () => new Noisy(hub) });
    expect(await host.room.create()).toBe(true);
    const guest = player(hub, { transport: () => new Noisy(hub) });
    expect(await guest.room.join(host.room.view.code)).toBe(true);
    guest.room.setReady(true);
    await until(() => host.room.canStart());
    expect(host.room.start(CHOICE, 9, START_DATE)).toBe(true);
    await until(() => guest.room.view.phase === 'playing');
    host.room.sendStatus(status({ week: 5 }));
    await until(() => guest.room.view.players.find((p) => p.id === host.id)?.status?.week === 5);
  });

  it('a whole shared-base session over the real thing: st, rec, int and sync all cross, signed', async () => {
    const { hub, host, guests, code } = await playing({}, 1, 'coop');
    const cfg: MissionConfig = { site: CHOICE.site, difficulty: CHOICE.difficulty, weeks: CHOICE.weeks, startDate: START_DATE, seed: 7, tutorial: false, sunMode: 'random', windowId: CHOICE.windowId };
    const seats = [host.id, guests[0].id];
    const commander = new CoopHost(host.room, createCoop(createMission(cfg, DATA), seats, wallClock.now()), {});
    const friend = new CoopGuest(guests[0].room, createMission(cfg, DATA), {});
    try {
      await until(() => friend.meta !== null);
      expect(friend.meta?.seats).toEqual(seats);
      const number = friend.submit({ k: 'ready', on: true });
      expect(number).toBe(1);
      await until(() => coopMeta(commander.co, wallClock.now()).ready.includes(guests[0].id));
      await until(() => friend.pending === 0);
      // The commander moves on; the friend follows the new revision, every message verified in order.
      const before = friend.meta!.rev;
      expect(commander.submit({ k: 'ready', on: true })).toBe('ok');
      // Both are ready: the commander goes on to the next stage, and the friend shows the same.
      await until(() => friend.meta!.rev > before && friend.meta!.stage === commander.co.stage);
      expect(commander.co.stage).not.toBe('briefing');
      for (const event of ['st', 'int', 'sync']) expect(hub.log.some((entry) => entry.event === event && typeof (entry.payload as { sig?: unknown }).sig === 'string')).toBe(true);
      // A stranger with the room code, and a forged st in the commander name, change nothing.
      const stranger = await Handmade.join(hub, code, { id: 'strangerreal', crypto: webCrypto });
      await sleep(30);
      const real = hub.log.filter((entry) => entry.event === 'st').pop()!.payload as Record<string, unknown>;
      const rev = friend.meta!.rev;
      await stranger.send('st', { ...real, rev: rev + 1000, sig: undefined }, { from: host.id });
      await sleep(60);
      expect(friend.meta!.rev).toBeLessThan(rev + 1000);
      expect(friend.stats.old).toBe(0);
      expect(COOP_NET.heartbeatMs).toBeGreaterThan(0);
    } finally {
      commander.dispose();
      friend.dispose();
    }
  });
});

// ----- Pinning ---------------------------------------------------------------------------------------------------------

describe('pinning (real keys)', () => {
  it('a message counts only if it verifies against the pinned key of the id it claims', async () => {
    const { hub, host, guests, code } = await playing({}, 2);
    const [victim, other] = guests;
    const stranger = await Handmade.join(hub, code, { id: 'strangerpin', crypto: webCrypto });
    await sleep(40);
    victim.room.sendStatus(status({ week: 2 }));
    await until(() => host.room.view.players.find((p) => p.id === victim.id)?.status?.week === 2);
    // A seated friend signs in the victim name with its own key (the pin is the victim key): refused everywhere.
    const attacker = other.room;
    const hostMember = hub.members(`fo-crew-${code}`).find((m) => m.key === other.id)!;
    hostMember.transport.send('status', await signedBy(attacker, code, 'status', { ...status({ week: 6 }), from: victim.id }, 500));
    hostMember.transport.send('react', await signedBy(attacker, code, 'react', { id: 'oops', from: victim.id }, 501));
    // A stranger does the same; signed as itself it is not a seat.
    await stranger.send('status', status({ week: 6 }), { from: victim.id });
    await stranger.send('status', status({ week: 6 }));
    await sleep(80);
    for (const watcher of [host, other]) {
      expect(watcher.room.view.players.find((p) => p.id === victim.id)?.status?.week).toBe(2);
      expect(watcher.reactions.filter((r) => r.id === victim.id)).toHaveLength(0);
    }
    expect(host.room.view.players.map((p) => p.id)).not.toContain(stranger.id);
    // The victim own message, signed with the pinned key, counts.
    victim.room.sendStatus(status({ week: 3 }));
    await until(() => other.room.view.players.find((p) => p.id === victim.id)?.status?.week === 3);
  });

  it('a different key for a pinned friend never replaces the pin: that id is believed for neither, and the pin is in force again when the other entry leaves', async () => {
    const { hub, host, guests, code } = await lobby({}, 2);
    const [friend, watcher] = guests;
    await sleep(60); // everybody has the seat list, so everybody holds the pins
    expect(host.room.start(CHOICE, 3, START_DATE)).toBe(true);
    await until(() => watcher.room.view.phase === 'playing' && friend.room.view.phase === 'playing');
    const here = (room: CrewRoom): boolean | undefined => room.view.players.find((p) => p.id === friend.id)?.here;
    expect(here(watcher.room)).toBe(true);
    // Somebody else shows up under the friend id with a key of its own.
    const twin = await Handmade.join(hub, code, { id: friend.id, crypto: webCrypto });
    await until(() => here(watcher.room) === false && here(host.room) === false);
    // Its messages, signed with its own key, are not the friend; the friend own messages wait while the id is contested.
    await twin.send('status', status({ week: 6, stars: 3, end: 'complete' }));
    await twin.send('final', status({ week: 6, stars: 3, end: 'complete' }));
    friend.room.sendStatus(status({ week: 3 }));
    await sleep(100);
    expect(watcher.room.view.players.find((p) => p.id === friend.id)?.finished).toBe(false);
    expect(watcher.room.view.players.find((p) => p.id === friend.id)?.status?.week).not.toBe(6);
    expect(watcher.room.view.players.find((p) => p.id === friend.id)?.status?.week).not.toBe(3);
    // The twin leaves: the id is the friend again, under the key that was pinned first, and its messages count.
    twin.close();
    await until(() => here(watcher.room) === true && here(host.room) === true);
    await sleep(600);
    friend.room.sendStatus(status({ week: 4 }));
    await until(() => watcher.room.view.players.find((p) => p.id === friend.id)?.status?.week === 4);
  });

  it('a different key for the pinned host: the guests no longer see the host (the lobby closes with "host left"), and a start signed by the other key is not taken', async () => {
    const { hub, host, guests, code } = await lobby({}, 1);
    await sleep(60);
    const [friend] = guests;
    const twin = await Handmade.join(hub, code, { id: host.id, crypto: webCrypto });
    await twin.trackAsHost({ s: true, p: { choice: CHOICE, seed: 5, startDate: START_DATE }, m: [host.id, friend.id], mk: [twin.identity.publicKey, twin.identity.publicKey] });
    await until(() => friend.room.view.phase === 'closed', 5000);
    expect(friend.room.view.failure).toBe('hostLeft');
    expect(friend.starts).toHaveLength(0);
  });

  it('the host seat list carries the keys: a guest that never saw a friend own entry still knows its key', async () => {
    const hub = new MemoryHub();
    const host = player(hub);
    expect(await host.room.create()).toBe(true);
    const code = host.room.view.code;
    const first = player(hub);
    expect(await first.room.join(code)).toBe(true);
    first.room.setReady(true);
    await until(() => host.room.canStart());
    // The second friend joins; the first one hears the second one only through the host list (its own entry is hidden from it).
    const second = player(hub);
    const member = hub.members(`fo-crew-${code}`).find((m) => m.key === first.id)!;
    const heard = member.handlers.presence;
    member.handlers.presence = (list) => heard(list.filter((entry) => entry.key !== second.id));
    expect(await second.room.join(code)).toBe(true);
    second.room.setReady(true);
    await until(() => host.room.view.players.length === 3);
    expect(host.room.start(CHOICE, 5, START_DATE)).toBe(true);
    await until(() => first.room.view.phase === 'playing' && second.room.view.phase === 'playing');
    member.handlers.presence = heard;
    second.room.sendStatus(status({ week: 2 }));
    await sleep(60);
    // The first friend does not see the second one in presence, so it cannot show the second as here; but the key is pinned from the list.
    const pins = (first.room as unknown as { pins: Map<string, string> }).pins;
    const hostPins = (host.room as unknown as { pins: Map<string, string> }).pins;
    expect(pins.get(second.id)).toBe(hostPins.get(second.id));
    expect(pins.get(second.id)).toMatch(/^[A-Za-z0-9_-]{87}$/);
  });
});

// ----- Replays, unsigned, versions -----------------------------------------------------------------------------------

describe('replays, unsigned messages and mixed versions (real keys)', () => {
  it('a copy of a message in another room, with another counter, or sent twice, is refused', async () => {
    // One hand-made client with ONE key pair in both rooms, seated in both lobbies.
    const identity = await webCrypto.generate();
    const roomA = await lobby({}, 1);
    const roomB = await lobby({}, 1);
    const inA = await Handmade.join(roomA.hub, roomA.code, { id: 'twinclient', identity });
    const inB = await Handmade.join(roomB.hub, roomB.code, { id: 'twinclient', identity });
    await until(() => roomA.host.room.view.players.length === 3 && roomB.host.room.view.players.length === 3);
    expect(roomA.host.room.start(CHOICE, 2, START_DATE)).toBe(true);
    expect(roomB.host.room.start(CHOICE, 2, START_DATE)).toBe(true);
    await until(() => roomA.guests[0].room.view.phase === 'playing' && roomB.guests[0].room.view.phase === 'playing');
    const seen = (room: typeof roomA) => room.guests[0].room.view.players.find((p) => p.id === 'twinclient')?.status?.week;

    const frame = await inA.frame('status', status({ week: 2 }), { q: 10 });
    // the same frame into room B: the room code is part of what was signed
    inB.raw('status', frame);
    await sleep(60);
    expect(seen(roomB)).toBeUndefined();
    inA.raw('status', frame);
    await until(() => seen(roomA) === 2);
    // the same message again (a copy): the counter has been seen
    inA.raw('status', await inA.frame('status', status({ week: 3 }), { q: 10 }));
    // a signature moved to another counter
    inA.raw('status', { ...frame, q: 11, from: 'twinclient' });
    // an older counter, properly signed
    inA.raw('status', await inA.frame('status', status({ week: 4 }), { q: 9 }));
    await sleep(80);
    expect(seen(roomA)).toBe(2);
    // a higher counter, properly signed, goes through
    inA.raw('status', await inA.frame('status', status({ week: 5 }), { q: 11 }));
    await until(() => seen(roomA) === 5);
    // the same frame, once more, is a copy
    inA.raw('status', await inA.frame('status', status({ week: 6 }), { q: 11 }));
    await sleep(60);
    expect(seen(roomA)).toBe(5);
  });

  it('an unsigned message, a message with a broken signature and one with a field added after signing are dropped', async () => {
    // A seated, hand-made client with a key of its own, so that only the signature is in question.
    const set = await lobby({}, 1);
    const hand = await Handmade.join(set.hub, set.code, { id: 'handclient1', crypto: webCrypto });
    await until(() => set.host.room.view.players.length === 3);
    expect(set.host.room.start(CHOICE, 4, START_DATE)).toBe(true);
    await until(() => set.guests[0].room.view.phase === 'playing');
    const week = () => set.guests[0].room.view.players.find((p) => p.id === hand.id)?.status?.week;
    hand.raw('status', { from: hand.id, ...status({ week: 3 }) }); // unsigned
    hand.raw('status', { from: hand.id, ...status({ week: 3 }), q: 1 }); // a counter, no signature
    const good = await hand.frame('status', status({ week: 4 }));
    hand.raw('status', { ...good, sig: (good.sig as string).replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) }); // a broken signature
    hand.raw('status', { ...good, week: 5 }); // changed after signing
    hand.raw('status', { ...good, extra: 1 }); // a field added after signing
    hand.raw('status', { ...good, sig: 42 });
    hand.raw('status', { ...good, q: 'one' });
    hand.raw('status', { ...good, q: 2 ** 41 });
    hand.raw('status', { ...good, q: -1 });
    hand.raw('status', { ...good, q: 1.5 });
    await sleep(100);
    expect(week()).toBeUndefined();
    hand.raw('status', good); // the real one
    await until(() => week() === 4);
  });

  it('mixed versions are refused: an older seat blocks the start, an older host is not joined, and an old-style message is dropped', async () => {
    const { hub, host, code } = await lobby({}, 1);
    expect(host.room.view.versionOk).toBe(true);
    const old = new MemoryTransport(hub);
    await old.connect(`fo-crew-${code}`, 'oldversion1', { id: 'oldversion1', n: 5, c: 2, r: true, h: false, s: false, t: Date.now() + 5, v: PROTOCOL - 1 }, { presence() {}, message() {}, status() {} });
    await until(() => host.room.view.players.length === 3);
    expect(host.room.view.versionOk).toBe(false);
    expect(host.room.canStart()).toBe(false);
    expect(host.room.start(CHOICE, 1, START_DATE)).toBe(false);
    old.close();
    await until(() => host.room.canStart());
    // An older host (it cannot sign): a joiner does not take it for a host it can trust.
    const hub2 = new MemoryHub();
    const oldHost = new MemoryTransport(hub2);
    await oldHost.connect('fo-crew-ABCDEF', 'oldhost0001', { id: 'oldhost0001', n: 1, c: 1, r: true, h: true, m: ['oldhost0001'], s: false, t: 1, v: PROTOCOL - 1 }, { presence() {}, message() {}, status() {} });
    const joiner = player(hub2);
    expect(await joiner.room.join('ABCDEF')).toBe(false);
    expect(joiner.room.view.failure).toBe('noRoom');
    // The current version without a key or without a signature is not a valid presence entry at all.
    const bad = new MemoryTransport(hub2);
    await bad.connect('fo-crew-ABCDEF', 'nokeyhost01', { id: 'nokeyhost01', n: 1, c: 1, r: true, h: true, m: ['nokeyhost01'], s: false, t: 1, v: PROTOCOL }, { presence() {}, message() {}, status() {} });
    const joiner2 = player(hub2);
    expect(await joiner2.room.join('ABCDEF')).toBe(false);
  });
});

// ----- The ordered pipeline -----------------------------------------------------------------------------------------

describe('the ordered pipeline', () => {
  it('Ordered runs a synchronous job inline, keeps the order of jobs that finish later, skips a job that throws, and holds at most max', async () => {
    const out: string[] = [];
    const queue = new Ordered(3);
    queue.push(() => out.push('sync'));
    expect(out).toEqual(['sync']); // inline, no tick
    queue.push(async () => {
      await sleep(30);
      out.push('slow');
    });
    queue.push(() => out.push('fast')); // waits for the slow one
    queue.push(() => {
      throw new Error('boom');
    });
    queue.push(() => out.push('after the throw'));
    expect(queue.push(() => out.push('over the limit'))).toBe(false);
    expect(out).toEqual(['sync']);
    await until(() => out.length === 4);
    expect(out).toEqual(['sync', 'slow', 'fast', 'after the throw']);
    const cleared: string[] = [];
    const again = new Ordered(5);
    again.push(async () => {
      await sleep(10);
    });
    again.push(() => cleared.push('x'));
    again.clear();
    await sleep(30);
    expect(cleared).toEqual([]);
  });

  /** The real thing, but each check takes a different time: the earlier a message is, the longer it takes. */
  function slowed(base: CrewCrypto, label: string, log: string[]): CrewCrypto {
    let calls = 0;
    return {
      generate: async (): Promise<Identity> => {
        const identity = await base.generate();
        return {
          publicKey: identity.publicKey,
          sign: async (data) => {
            await sleep(Math.max(0, 36 - 3 * calls++));
            return identity.sign(data);
          },
        };
      },
      verify: async (key, data, signature) => {
        await sleep(Math.max(0, 36 - 3 * calls++));
        log.push(label);
        return base.verify(key, data, signature);
      },
    };
  }

  it('under a slow check that finishes the earlier messages LAST, every sender message arrives in the order it was sent', async () => {
    const log: string[] = [];
    let t = 1_000_000;
    const hub = new MemoryHub();
    const host = player(hub, { crypto: slowed(webCrypto, 'host', log), now: () => (t += 400), grace: 400 });
    expect(await host.room.create()).toBe(true);
    const guest = player(hub, { crypto: slowed(webCrypto, 'guest', log), grace: 400 });
    expect(await guest.room.join(host.room.view.code)).toBe(true);
    guest.room.setReady(true);
    await until(() => host.room.canStart());
    expect(host.room.start(CHOICE, 7, START_DATE)).toBe(true);
    await until(() => guest.room.view.phase === 'playing');
    const count = 12;
    for (let i = 0; i < count; i++) expect(host.room.sendPosition({ x: i, z: 0, a: 0, m: 1 })).toBe(true);
    await until(() => guest.positions.length === count);
    expect(guest.positions.map((entry) => entry.position.x)).toEqual(Array.from({ length: count }, (_, i) => i));
    // And on the wire: in the order of the calls, with the counter going up (the slow signature of the first did not let the second pass it).
    const sent = hub.log.filter((entry) => entry.event === 'pos' && entry.from === host.id).map((entry) => entry.payload as { x: number; q: number });
    expect(sent.map((payload) => payload.x)).toEqual(Array.from({ length: count }, (_, i) => i));
    expect(sent.map((payload) => payload.q)).toEqual([...sent.map((payload) => payload.q)].sort((a, b) => a - b));
    expect(log.filter((label) => label === 'guest').length).toBeGreaterThanOrEqual(count);
  });

  it('a message that follows its own presence entry at once is not lost to the pin that the entry brings', async () => {
    const log: string[] = [];
    const hub = new MemoryHub();
    const host = player(hub, { crypto: slowed(webCrypto, 'host', log), grace: 400 });
    expect(await host.room.create()).toBe(true);
    const code = host.room.view.code;
    const guest = player(hub, { crypto: slowed(webCrypto, 'guest', log), grace: 400 });
    expect(await guest.room.join(code)).toBe(true);
    guest.room.setReady(true);
    await until(() => host.room.canStart());
    expect(host.room.start(CHOICE, 7, START_DATE)).toBe(true);
    await until(() => guest.room.view.phase === 'playing');
    // The host says something at once, in a burst with a sticker; the order is kept and nothing is lost.
    host.room.sendStatus(status({ week: 2 }));
    host.room.sendReaction('hooray');
    host.room.sendPosition({ x: 3, z: 4, a: 0, m: 0 });
    await until(() => guest.reactions.length === 1 && guest.positions.length === 1 && guest.room.view.players.find((p) => p.id === host.id)?.status?.week === 2);
  });

  it('forged messages in a friend name use up neither the friend counter nor its rate budget', async () => {
    const { hub, guests, code } = await playing({}, 2);
    const [friend, watcher] = guests;
    const stranger = await Handmade.join(hub, code, { id: 'floodingxx', crypto: webCrypto });
    await sleep(30);
    // A high counter and a flood of stickers, all in the friend name, all with a signature that is not the friend.
    for (let i = 0; i < 40; i++) {
      stranger.raw('react', await stranger.frame('react', { id: 'wow' }, { from: friend.id, q: 2 ** 40 - i }));
      stranger.raw('react', { from: friend.id, id: 'wow', q: 2 ** 40 - 100 - i, sig: 'A'.repeat(86) });
    }
    await sleep(100);
    expect(watcher.reactions).toHaveLength(0);
    // The friend real stickers (counter 1, 2, ...) and the real budget are intact.
    expect(friend.room.sendReaction('great')).toBe(true);
    await until(() => watcher.reactions.length === 1);
    expect(watcher.reactions[0].id).toBe(friend.id);
  });

  it('size: the signature adds less than SIG_OVERHEAD; a message over its limit never reaches the check; the biggest allowed one does', async () => {
    const calls: number[] = [];
    const counting: CrewCrypto = { generate: () => webCrypto.generate(), verify: (key, data, sig) => (calls.push(data.length), webCrypto.verify(key, data, sig)) };
    const set = await lobby({ crypto: counting }, 1);
    const hand = await Handmade.join(set.hub, set.code, { id: 'bigclient01', crypto: webCrypto });
    await until(() => set.host.room.view.players.length === 3);
    expect(set.host.room.start(CHOICE, 4, START_DATE)).toBe(true);
    await until(() => set.guests[0].room.view.phase === 'playing');
    await sleep(50);
    const before = calls.length;
    const big = { ...status(), pad: 'z'.repeat(sizeLimit('status')) };
    const frame = await hand.frame('status', big);
    expect(JSON.stringify(frame).length).toBeGreaterThan(sizeLimit('status') + SIG_OVERHEAD);
    hand.raw('status', frame);
    await sleep(80);
    expect(calls.length).toBe(before); // dropped on its size, before any signature check
    // The envelope of the largest allowed co-op message fits in what is added.
    const envelope = (await hand.frame('st', {}, { q: 2 ** 40 })).sig as string;
    expect(`,"q":${2 ** 40},"sig":"${envelope}"`.length).toBeLessThanOrEqual(SIG_OVERHEAD);
  });
});

// ----- No Web Crypto, and the local transport ----------------------------------------------------------------------------

describe('no Web Crypto: the crew cannot connect, through the usual error', () => {
  it('a device without crypto.subtle fails to create or join a room as "offline"', async () => {
    const hub = new MemoryHub();
    const host = player(hub);
    expect(await host.room.create()).toBe(true);
    const code = host.room.view.code;
    vi.stubGlobal('crypto', undefined);
    expect(canSign()).toBe(false);
    const made = player(hub);
    expect(await made.room.create()).toBe(false);
    expect(made.room.view.phase).toBe('failed');
    expect(made.room.view.failure).toBe('offline');
    const joiner = player(hub);
    expect(await joiner.room.join(code)).toBe(false);
    expect(joiner.room.view.failure).toBe('offline');
    // Nothing of it reached the channel.
    expect(hub.members(`fo-crew-${code}`).map((m) => m.key)).toEqual([host.id]);
    vi.unstubAllGlobals();
    // A page with crypto but no subtle (an insecure page): the same.
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const insecure = player(hub);
    expect(await insecure.room.create()).toBe(false);
    expect(insecure.room.view.failure).toBe('offline');
  });

  it('a crypto that throws while it makes the key is the same "offline"', async () => {
    const hub = new MemoryHub();
    const sync = player(hub, {
      crypto: {
        generate: () => {
          throw new Error('nope');
        },
        verify: () => false,
      },
    });
    expect(await sync.room.create()).toBe(false);
    expect(sync.room.view.failure).toBe('offline');
  });
});

describe('the local transport (?crew=local) goes through the same signing', () => {
  it('two rooms over LocalTransport (BroadcastChannel) sign, verify and start together', async () => {
    vi.stubGlobal('window', globalThis);
    const hub = null;
    const make = () => ({ transport: () => new LocalTransport() as Transport });
    const host = player(hub, make());
    expect(await host.room.create()).toBe(true);
    const code = host.room.view.code;
    // A bystander on the same channel sees the frames the way any other tab would.
    const spy = new BroadcastChannel(`fo-crew-${code}`);
    const frames: { t: string; event?: string; payload?: Record<string, unknown>; meta?: Record<string, unknown> }[] = [];
    spy.onmessage = (event: MessageEvent) => frames.push(event.data);
    const guest = player(hub, make());
    expect(await guest.room.join(code)).toBe(true);
    guest.room.setReady(true);
    await until(() => host.room.canStart(), 6000);
    expect(host.room.start(CHOICE, 11, START_DATE)).toBe(true);
    await until(() => guest.room.view.phase === 'playing', 6000);
    host.room.sendStatus(status({ week: 3 }));
    guest.room.sendStatus(status({ week: 4 }));
    await until(() => guest.room.view.players.find((p) => p.id === host.id)?.status?.week === 3 && host.room.view.players.find((p) => p.id === guest.id)?.status?.week === 4, 6000);
    const messages = frames.filter((frame) => frame.t === 'm');
    expect(messages.length).toBeGreaterThanOrEqual(2);
    for (const frame of messages) expect(frame.payload?.sig).toMatch(/^[A-Za-z0-9_-]{86}$/);
    const presence = frames.filter((frame) => frame.t === 'p' && (frame.meta as { h?: boolean } | undefined)?.h);
    expect(presence.length).toBeGreaterThan(0);
    expect((presence[presence.length - 1].meta as { g?: string }).g).toMatch(/^[A-Za-z0-9_-]{86}$/);
    // An unsigned frame put on the channel by a tab that is not signing is ignored.
    spy.postMessage({ t: 'm', key: host.id, event: 'status', payload: { from: host.id, ...status({ week: 9 }) } });
    await sleep(100);
    expect(guest.room.view.players.find((p) => p.id === host.id)?.status?.week).toBe(3);
    spy.close();
    host.room.leave();
    guest.room.leave();
  });
});
