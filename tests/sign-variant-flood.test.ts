/**
 * Ordering review proofs (lens: async verify pipeline with real Web Crypto, floods, bursts).
 * Flood: a stranger fills the ordered inbox (cap 256) with frames in a seated friend's name; the rate budget and the
 * counter run only after a verify, so the honest traffic behind the flood is dropped by `push() === false`.
 */
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 20_000 });
import { CREW_SUITS, startDateOf } from '../src/net/protocol';
import type { CrewChoice } from '../src/net/protocol';
import { CrewRoom } from '../src/net/room';
import { webCrypto } from '../src/net/sign';
import type { CrewCrypto } from '../src/net/sign';
import { MemoryHub, MemoryTransport } from '../src/net/transport';
import { Handmade } from './handmade';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await sleep(3);
  }
}

const CHOICE: CrewChoice = { site: 'mars', difficulty: 'cadet', weeks: 6, windowId: 'may2024' };
const START_DATE = startDateOf('may2024')!;

let counter = 0;
function player(hub: MemoryHub, crypto: CrewCrypto = webCrypto) {
  counter++;
  const id = `ord${String(counter).padStart(5, '0')}`;
  const reactions: { id: string; reaction: string }[] = [];
  const room = new CrewRoom(() => new MemoryTransport(hub), {
    me: { id, name: counter % 16, suit: counter % CREW_SUITS.length },
    crypto,
    joinGraceMs: 300,
    createGraceMs: 300,
    hostGoneMs: 1500,
  });
  room.onReaction = (who, reaction) => reactions.push({ id: who.id, reaction });
  return { id, room, reactions };
}

/** Real Web Crypto, but every verify waits `ms` first: a slow check, so the inbox stays busy while the flood sits in it. */
function slowVerify(ms: number): CrewCrypto {
  return {
    generate: () => webCrypto.generate(),
    verify: async (...args: Parameters<CrewCrypto['verify']>) => {
      await sleep(ms);
      return webCrypto.verify(...args);
    },
  };
}

async function lobbyWithFriend(guestCrypto: CrewCrypto = webCrypto) {
  const hub = new MemoryHub();
  const host = player(hub);
  expect(await host.room.create()).toBe(true);
  const code = host.room.view.code;
  const guest = player(hub, guestCrypto);
  expect(await guest.room.join(code)).toBe(true);
  guest.room.setReady(true);
  await until(() => host.room.canStart());
  return { hub, host, guest, code };
}

const JUNK_SIG = 'A'.repeat(86);

describe('flood fills the ordered inbox with real Web Crypto', () => {
  it('CONTROL: without any flood, the seated friend sticker reaches the host', async () => {
    const { host, guest } = await lobbyWithFriend();
    expect(host.room.start(CHOICE, 7, START_DATE)).toBe(true);
    await until(() => guest.room.view.phase === 'playing');
    expect(guest.room.sendReaction('great')).toBe(true);
    await sleep(300);
    expect(host.reactions.filter((entry) => entry.id === guest.id)).toHaveLength(1);
  });

});
describe('VARIANT: flood after the honest frame', () => {
  it('V1: honest sticker, then 40 more forged frames in the friend name at once: does the honest one survive?', async () => {
    const { hub, host, guest, code } = await lobbyWithFriend();
    expect(host.room.start(CHOICE, 7, START_DATE)).toBe(true);
    await until(() => guest.room.view.phase === 'playing');
    const stranger = await Handmade.join(hub, code, { id: 'floodxxxxv', crypto: webCrypto });
    await sleep(30);
    for (let i = 0; i < 300; i++) stranger.raw('react', { from: guest.id, id: 'wow', q: i + 1, sig: JUNK_SIG });
    expect(guest.room.sendReaction('great')).toBe(true);
    await sleep(15);
    for (let i = 0; i < 40; i++) stranger.raw('react', { from: guest.id, id: 'wow', q: 400 + i, sig: JUNK_SIG });
    await until(() => host.reactions.some((entry) => entry.id === guest.id), 8000);
    await sleep(200);
    expect(host.reactions.filter((entry) => entry.id === guest.id)).toHaveLength(1);
  });

  it('V2: host start, then 70 presence lists from a stranger right after it: does the start still reach a slow guest?', async () => {
    const hub = new MemoryHub();
    const host = player(hub);
    expect(await host.room.create()).toBe(true);
    const code = host.room.view.code;
    const friend = player(hub);
    expect(await friend.room.join(code)).toBe(true);
    friend.room.setReady(true);
    await until(() => host.room.canStart());
    const guest = player(hub, slowVerify(20));
    expect(await guest.room.join(code)).toBe(true);
    guest.room.setReady(true);
    await until(() => host.room.canStart());
    const stranger = await Handmade.join(hub, code, { id: 'floodxxxxw', crypto: webCrypto });
    await sleep(30);
    expect(host.room.start(CHOICE, 7, START_DATE)).toBe(true);
    await sleep(60);
    for (let i = 0; i < 70; i++) stranger.track({ x: i });
    await sleep(2500);
    expect(guest.room.view.phase).toBe('playing');
  });
});

describe('VARIANT 2: slow host, honest frame waits, forged burst right behind it', () => {
  it('V1c: host verifies at 10 ms; honest sticker queued; 40 forged frames in the friend name right after it', async () => {
    const hub = new MemoryHub();
    const host = player(hub, slowVerify(10));
    expect(await host.room.create()).toBe(true);
    const code = host.room.view.code;
    const guest = player(hub);
    expect(await guest.room.join(code)).toBe(true);
    guest.room.setReady(true);
    await until(() => host.room.canStart());
    expect(host.room.start(CHOICE, 7, START_DATE)).toBe(true);
    await until(() => guest.room.view.phase === 'playing');
    const stranger = await Handmade.join(hub, code, { id: 'floodxxxxr', crypto: webCrypto });
    await sleep(30);
    for (let i = 0; i < 300; i++) stranger.raw('react', { from: guest.id, id: 'wow', q: i + 1, sig: JUNK_SIG });
    expect(guest.room.sendReaction('great')).toBe(true);
    await sleep(40);
    for (let i = 0; i < 40; i++) stranger.raw('react', { from: guest.id, id: 'wow', q: 400 + i, sig: JUNK_SIG });
    await sleep(5000);
    expect(host.reactions.filter((entry) => entry.id === guest.id)).toHaveLength(1);
  });
});

describe('VARIANT 3: start behind a running job, then a presence burst', () => {
  it('V2b: guest verifies at 200 ms; host start waits; 70 stranger presence lists right behind it', async () => {
    const hub = new MemoryHub();
    const host = player(hub);
    expect(await host.room.create()).toBe(true);
    const code = host.room.view.code;
    const friend = player(hub);
    expect(await friend.room.join(code)).toBe(true);
    friend.room.setReady(true);
    await until(() => host.room.canStart());
    const guest = player(hub, slowVerify(200));
    expect(await guest.room.join(code)).toBe(true);
    guest.room.setReady(true);
    await until(() => host.room.canStart());
    const stranger = await Handmade.join(hub, code, { id: 'floodxxxxq', crypto: webCrypto });
    stranger.track({ x: 0 });
    expect(host.room.start(CHOICE, 7, START_DATE)).toBe(true);
    await sleep(40);
    for (let i = 0; i < 70; i++) stranger.track({ x: i + 1 });
    await sleep(15000);
    expect(guest.room.view.phase).toBe('playing');
  });
});
