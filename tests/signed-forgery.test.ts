/**
 * Signed messages: who sent it (docs/MULTIPLAYER.md, "Signed messages: who sent it").
 *
 * The forgeries below were all possible before the messages were signed: the channel has no accounts, so a seated friend
 * or a stranger who knows the room code could send the commander's state, another seat's Ready or vote, a friend's
 * race numbers or sticker, or take over the host's presence entry. Each one is tried here the way a modified client would
 * (unsigned; signed with its own key but in somebody else's name; a copy of a real message with one field changed) and must
 * change nothing, while the real traffic goes on beside it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoop, coopMeta } from '../src/sim/coop';
import { createMission } from '../src/sim/mission';
import { COOP_NET, CoopGuest, CoopHost } from '../src/net/coop';
import { CREW_SUITS, startDateOf } from '../src/net/protocol';
import type { CrewChoice, Status } from '../src/net/protocol';
import { CrewRoom } from '../src/net/room';
import { MemoryHub, MemoryTransport } from '../src/net/transport';
import type { MissionConfig } from '../src/sim/types';
import { DATA } from './bots';
import { CHOICE, SEED, START_DATE, pickOption, scriptedAct, startedRooms } from './coop-rig';
import { Handmade, signedBy } from './handmade';

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

const config = (): MissionConfig => ({ site: CHOICE.site, difficulty: CHOICE.difficulty, weeks: CHOICE.weeks, startDate: START_DATE, seed: SEED, tutorial: false, sunMode: 'random', windowId: CHOICE.windowId });

/** A started co-op room with the commander's and the guests' sessions on it. */
async function coopRig(guestCount: number) {
  const r = await startedRooms(guestCount);
  const host = new CoopHost(r.host.room, createCoop(createMission(config(), DATA), r.seats, r.clock.now()), { clock: r.clock });
  const guests = r.guests.map((g) => new CoopGuest(g.room, createMission(config(), DATA), { clock: r.clock }));
  await r.clock.advance(COOP_NET.tickMs * 3);
  const code = r.host.room.view.code;
  return { ...r, host, hostClient: r.host, guests, guestClients: r.guests, code };
}

/** The newest real `st` the commander sent, as a plain copy (anybody on the channel can copy it). */
function lastHostSt(hub: MemoryHub, hostId: string): Record<string, unknown> {
  const sent = hub.log.filter((entry) => entry.event === 'st' && (entry.payload as { from?: string }).from === hostId);
  expect(sent.length).toBeGreaterThan(0);
  return JSON.parse(JSON.stringify(sent[sent.length - 1].payload)) as Record<string, unknown>;
}

describe('a forged commander state (st) is refused', () => {
  it('a seated guest sends an st in the commander name: raw, signed with its own key, or a real one with the revision raised', async () => {
    const r = await coopRig(2);
    const hostId = r.hostClient.id;
    const real = lastHostSt(r.hub, hostId);
    const realRev = real.rev as number;
    const victim = r.guests[1];
    const adoptedBefore = victim.stats.adopted;
    const high = realRev + 1000;
    const attacker = r.guestClients[0];
    // 1. the payload with the commander id, the revision raised, sent raw (no signature at all)
    const unsigned: Record<string, unknown> = { ...real, rev: high, from: hostId };
    delete unsigned['sig'];
    delete unsigned['q'];
    attacker.transport.send('st', unsigned);
    // 2. the same, signed with the attacker own key (a seated friend has a key and a pin of its own)
    attacker.transport.send('st', await signedBy(attacker.room, r.code, 'st', { ...unsigned }, 999_999));
    // 3. the real signed message with the revision changed (the signature no longer fits)
    attacker.transport.send('st', { ...real, rev: high });
    await tick(50);
    expect(victim.meta?.rev).not.toBe(high);
    expect(victim.stats.adopted).toBe(adoptedBefore);
    // The real commander goes on and the victim follows it.
    r.host.submit({ k: 'ready', on: true });
    await r.clock.advance(COOP_NET.heartbeatMs * 2);
    expect(victim.meta?.rev).toBe(r.host.co.rev);
    expect(victim.meta?.ready).toEqual(r.host.co.ready);
    expect(victim.stats.old).toBe(0);
  });

  it('a stranger who is not seated, with the room code, sends an st in the commander name', async () => {
    const r = await coopRig(1);
    const hostId = r.hostClient.id;
    const real = lastHostSt(r.hub, hostId);
    const stranger = await Handmade.join(r.hub, r.code, { id: 'strangerkey' });
    await tick(20);
    const adoptedBefore = r.guests[0].stats.adopted;
    const forged: Record<string, unknown> = { ...real, rev: (real.rev as number) + 1000, from: hostId };
    delete forged['sig'];
    delete forged['q'];
    stranger.raw('st', forged); // unsigned
    await stranger.send('st', forged, { from: hostId }); // signed with the stranger own key
    await stranger.send('st', forged); // signed and honest about who it is: not a seat
    await tick(50);
    expect(r.guests[0].meta?.rev).not.toBe(forged.rev);
    expect(r.guests[0].stats.adopted).toBe(adoptedBefore);
    expect(r.host.co.rev).toBeLessThan(forged.rev as number);
  });

  it('a forged high revision does not strand the guest: the real commander, still moving, is still followed (the "stuck" proof, with a working clock)', async () => {
    const r = await coopRig(2);
    const hostId = r.hostClient.id;
    const real = lastHostSt(r.hub, hostId);
    const victim = r.guests[1];
    const high = (real.rev as number) + 1000;
    r.guestClients[0].transport.send('st', { ...real, rev: high, from: hostId });
    await r.clock.advance(20);
    r.host.submit({ k: 'ready', on: true });
    const oldBefore = victim.stats.old;
    const stCount = () => r.hub.log.filter((e) => e.event === 'st' && (e.payload as { from?: string }).from === hostId).length;
    const stBefore = stCount();
    await r.clock.advance(COOP_NET.heartbeatMs * 3);
    expect(stCount() - stBefore).toBeGreaterThan(0);
    // The real commander's states are not "old" for the victim, because the forged revision was never taken.
    expect(victim.stats.old - oldBefore).toBe(0);
    expect(victim.meta?.rev).toBe(r.host.co.rev);
    expect(victim.meta?.rev).toBeLessThan(high);
  });

  it('an exact copy of a real st, sent again by anybody, is a copy: the counter is old, nothing changes', async () => {
    const r = await coopRig(2);
    const real = lastHostSt(r.hub, r.hostClient.id);
    const victim = r.guests[1];
    const adoptedBefore = victim.stats.adopted;
    r.guestClients[0].transport.send('st', real); // the commander own, signed message, replayed by a guest
    await tick(50);
    expect(victim.stats.adopted).toBe(adoptedBefore);
  });
});

describe('an intent in another seat name is refused', () => {
  it('a seated guest sends Ready in another seat name (raw, signed with its own key, a real one with the seat changed)', async () => {
    const r = await coopRig(2);
    const victimId = r.guestClients[1].id;
    expect(coopMeta(r.host.co, r.clock.now()).ready).not.toContain(victimId);
    const attacker = r.guestClients[0];
    const meta = r.guests[0].meta!;
    const intent = { n: 1, w: meta.week, s: meta.stage, k: 'ready', on: true };
    attacker.transport.send('int', { ...intent, from: victimId });
    attacker.transport.send('int', await signedBy(attacker.room, r.code, 'int', { ...intent, from: victimId }, 999_999));
    // A real Ready of the attacker, copied with the seat changed
    r.guests[0].submit({ k: 'ready', on: true });
    await tick(50);
    const real = r.hub.log.filter((e) => e.event === 'int' && (e.payload as { from?: string }).from === attacker.id).pop()!;
    attacker.transport.send('int', { ...(real.payload as object), from: victimId });
    await tick(50);
    const ready = coopMeta(r.host.co, r.clock.now()).ready;
    expect(ready).not.toContain(victimId);
    expect(ready).toContain(attacker.id); // its own Ready, signed as itself, does count
  });

  it('a seated guest sends a vote in another seat name', async () => {
    const r = await coopRig(2);
    // Play on (everybody ready, nobody walks) until a week with an event card.
    for (let i = 0; i < 4000 && r.host.co.stage !== 'event'; i++) {
      const now = r.clock.now();
      scriptedAct(r.hostClient.id, coopMeta(r.host.co, now), r.host.co.mission, (body) => r.host.submit(body));
      r.guests.forEach((guest, index) => scriptedAct(r.guestClients[index].id, guest.meta, guest.mission, (body) => guest.submit(body)));
      await r.clock.advance(200);
    }
    expect(r.host.co.stage).toBe('event');
    const victimId = r.guestClients[1].id;
    const attacker = r.guestClients[0];
    const option = pickOption(r.host.co.mission);
    // A counter far above anything the victim sent, so only the missing signature can refuse it.
    const intent = { n: 100_000, w: r.host.co.mission.week, s: 'event', k: 'vote', o: option };
    attacker.transport.send('int', { ...intent, from: victimId });
    attacker.transport.send('int', await signedBy(attacker.room, r.code, 'int', { ...intent, from: victimId }, 999_999));
    await tick(50);
    expect(Object.keys(r.host.co.votes)).not.toContain(victimId);
    // The attacker own vote, as itself, does count (the control: the road is open)
    r.guests[0].submit({ k: 'vote', o: option });
    await r.clock.advance(300);
    expect(Object.keys(r.host.co.votes)).toContain(attacker.id);
    expect(Object.keys(r.host.co.votes)).not.toContain(victimId);
  });

  it('a stranger who is not seated sends a Ready for a seat, and it is not counted', async () => {
    const r = await coopRig(1);
    const victimId = r.guestClients[0].id;
    const stranger = await Handmade.join(r.hub, r.code, { id: 'strangerkey2' });
    await tick(20);
    const meta = r.guests[0].meta!;
    const intent = { n: 1, w: meta.week, s: meta.stage, k: 'ready', on: true };
    stranger.raw('int', { ...intent, from: victimId });
    await stranger.send('int', intent, { from: victimId });
    await stranger.send('int', intent);
    await tick(50);
    expect(coopMeta(r.host.co, r.clock.now()).ready).not.toContain(victimId);
    expect(coopMeta(r.host.co, r.clock.now()).ready).not.toContain(stranger.id);
  });
});

// ----- Race mode: numbers and stickers under a friend id ---------------------------------------------------------

const RACE: CrewChoice = { site: 'mars', difficulty: 'cadet', weeks: 6, windowId: 'may2024' };
let counter = 0;

function player(hub: MemoryHub) {
  counter++;
  const id = `forge${String(counter).padStart(4, '0')}`;
  const reactions: { id: string; reaction: string }[] = [];
  const room = new CrewRoom(() => new MemoryTransport(hub), { me: { id, name: counter % 16, suit: counter % CREW_SUITS.length }, joinGraceMs: 50, createGraceMs: 50, hostGoneMs: 1000 });
  room.onReaction = (who, reaction) => reactions.push({ id: who.id, reaction });
  return { id, room, reactions };
}

const status = (over: Partial<Status> = {}): Status => ({ week: 2, step: 'plan', air: 90, food: 5, dose: 10, doseLimit: 100, science: 10, stars: 0, end: null, storm: { w: 0, s: 0, k: false, a: 0 }, ...over });

async function raceRoom() {
  const hub = new MemoryHub();
  const host = player(hub);
  const made = host.room.create();
  await tick(100);
  expect(await made).toBe(true);
  const code = host.room.view.code;
  const friends = [player(hub), player(hub)];
  for (const friend of friends) {
    const joined = friend.room.join(code);
    await tick(100);
    expect(await joined).toBe(true);
    friend.room.setReady(true);
  }
  await tick(10);
  expect(host.room.start(RACE, 5, startDateOf('may2024')!)).toBe(true);
  await tick(10);
  return { hub, host, friends, code };
}

describe('race numbers and stickers under a friend id are refused', () => {
  it('a seated friend sends status, final and a sticker in another friend name', async () => {
    const { hub, host, friends, code } = await raceRoom();
    const [attacker, victim] = friends;
    victim.room.sendStatus(status({ week: 2 }));
    await tick(700);
    const seen = () => host.room.view.players.find((p) => p.id === victim.id)!;
    expect(seen().status?.week).toBe(2);
    const fake = { ...status({ week: 6, stars: 3, end: 'complete' }), from: victim.id };
    const transport = hub.members(`fo-crew-${code}`).find((m) => m.key === attacker.id)!.transport;
    // raw (unsigned) copies
    transport.send('status', fake);
    transport.send('final', fake);
    transport.send('react', { from: victim.id, id: 'oops' });
    // signed with the attacker own key, in the victim name
    transport.send('status', await signedBy(attacker.room, code, 'status', fake, 999_999));
    transport.send('final', await signedBy(attacker.room, code, 'final', fake, 1_000_000));
    transport.send('react', await signedBy(attacker.room, code, 'react', { from: victim.id, id: 'oops' }, 1_000_001));
    await tick(50);
    expect(seen().status?.week).toBe(2);
    expect(seen().status?.stars).toBe(0);
    expect(seen().finished).toBe(false);
    expect(host.reactions.filter((r) => r.id === victim.id)).toHaveLength(0);
    // The victim real numbers and stickers still arrive.
    victim.room.sendStatus(status({ week: 3 }));
    victim.room.sendReaction('great');
    await tick(700);
    expect(seen().status?.week).toBe(3);
    expect(host.reactions.filter((r) => r.id === victim.id).map((r) => r.reaction)).toEqual(['great']);
  });

  it('a stranger with the room code sends numbers, a final and a sticker as a friend', async () => {
    const { host, friends, code, hub } = await raceRoom();
    const victim = friends[0];
    const stranger = await Handmade.join(hub, code, { id: 'strangerkey3' });
    await tick(50);
    const fake = status({ week: 6, stars: 3, end: 'complete' });
    stranger.raw('final', { ...fake, from: victim.id });
    await stranger.send('final', fake, { from: victim.id });
    await stranger.send('react', { id: 'wow' }, { from: victim.id });
    await stranger.send('final', fake); // as itself: not a seat
    await tick(50);
    const seen = host.room.view.players.find((p) => p.id === victim.id)!;
    expect(seen.finished).toBe(false);
    expect(seen.status).toBeNull();
    expect(host.reactions).toHaveLength(0);
    expect(host.room.view.players.map((p) => p.id)).not.toContain(stranger.id);
  });
});

// ----- The host presence entry ------------------------------------------------------------------------------------

describe('a copied host presence entry cannot start a mission', () => {
  it('an exact copy under the host key, the real connection drops, and the copy adds the start', async () => {
    const hub = new MemoryHub();
    const host = player(hub);
    const made = host.room.create();
    await tick(100);
    expect(await made).toBe(true);
    const code = host.room.view.code;
    const friend = player(hub);
    const starts: unknown[] = [];
    friend.room.onStart = (start) => starts.push(start);
    const joined = friend.room.join(code);
    await tick(100);
    expect(await joined).toBe(true);
    friend.room.setReady(true);
    await tick(10);
    // The stranger connects under the host id with an exact copy of the host entry. Identical entries are one entry.
    const channel = `fo-crew-${code}`;
    const hostMember = hub.members(channel).find((m) => m.key === host.id)!;
    const copy = JSON.parse(JSON.stringify(hostMember.meta)) as Record<string, unknown>;
    const stranger = new MemoryTransport(hub);
    await stranger.connect(channel, host.id, copy, { presence() {}, message() {}, status() {} });
    await tick(20);
    expect(friend.room.view.phase).toBe('lobby');
    expect(friend.room.view.hostId).toBe(host.id);
    // The real host connection drops for a moment ...
    hostMember.transport.cut();
    await tick(20);
    // ... and the copy adds the start: the host key and signature, copied, but a mission the host never signed.
    const mission = { choice: RACE, seed: 4242, startDate: startDateOf('may2024')! };
    const keys = copy.mk as string[];
    stranger.track({ ...copy, s: true, p: mission, m: [host.id, friend.id], mk: [keys[0], keys[0]] });
    await tick(20);
    expect(starts).toHaveLength(0);
    expect(friend.room.view.phase).not.toBe('playing');
    await tick(5000);
    expect(starts).toHaveLength(0);
    expect(friend.room.view.phase).not.toBe('playing');
  });

  it('a stranger who claims the host id with its own key and its own valid signature is not the host either', async () => {
    const hub = new MemoryHub();
    const host = player(hub);
    const made = host.room.create();
    await tick(100);
    await made;
    const code = host.room.view.code;
    const friend = player(hub);
    const starts: unknown[] = [];
    friend.room.onStart = (start) => starts.push(start);
    const joined = friend.room.join(code);
    await tick(100);
    await joined;
    friend.room.setReady(true);
    await tick(10);
    const impostor = await Handmade.join(hub, code, { id: host.id });
    await impostor.trackAsHost({ s: true, p: { choice: RACE, seed: 7, startDate: startDateOf('may2024')! }, m: [host.id, friend.id], mk: [impostor.identity.publicKey, impostor.identity.publicKey] });
    await tick(5000);
    expect(starts).toHaveLength(0);
    // The host id now has two different entries under two keys: neither is believed, and the lobby ends with the usual "host left".
    expect(friend.room.view.phase).toBe('closed');
    expect(friend.room.view.failure).toBe('hostLeft');
  });
});
