/**
 * Review fixes for the signed wire: a replay after a rejoin, a flood in a friend's name, a sticker that beats the host's
 * seat list, and a final sent just before the room is left. The first block runs on the rig (fake crypto, fake timers);
 * the others run the REAL Web Crypto path with real timers (it is asynchronous, so these tests wait for results).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });
import { CREW_SUITS, startDateOf } from '../src/net/protocol';
import type { CrewChoice, Status } from '../src/net/protocol';
import { CrewRoom } from '../src/net/room';
import { Ordered, webCrypto } from '../src/net/sign';
import type { CrewCrypto, Identity } from '../src/net/sign';
import { MemoryHub, MemoryTransport } from '../src/net/transport';
import { client, ManualClock } from './coop-rig';
import { Handmade } from './handmade';

describe('a copy of an older message after the receiver left and came back', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('a copy of a friend sticker, replayed after the receiver rejoined the lobby, is refused', async () => {
    const hub = new MemoryHub();
    const clock = new ManualClock();
    const host = client(hub, clock);
    const made = host.room.create();
    await vi.advanceTimersByTimeAsync(100);
    expect(await made).toBe(true);
    const code = host.room.view.code;
    const friend = await Handmade.join(hub, code, { id: 'frnd01abcd' });
    await friend.track();
    await vi.advanceTimersByTimeAsync(20);
    const guest = client(hub, clock);
    const joined = guest.room.join(code);
    await vi.advanceTimersByTimeAsync(100);
    expect(await joined).toBe(true);
    await vi.advanceTimersByTimeAsync(20);
    const seen: string[] = [];
    const watch = (): void => {
      guest.room.onReaction = (player, reaction) => void seen.push(`${player.id}:${reaction}`);
    };
    watch();

    const sticker = await friend.send('react', { id: 'great' });
    await vi.advanceTimersByTimeAsync(20);
    expect(seen).toEqual(['frnd01abcd:great']);
    const stranger = await Handmade.join(hub, code, { id: 'strngr01' });
    stranger.raw('react', sticker);
    await vi.advanceTimersByTimeAsync(20);
    expect(seen.length).toBe(1);

    guest.room.leave();
    await vi.advanceTimersByTimeAsync(20);
    const again = guest.room.join(code);
    await vi.advanceTimersByTimeAsync(100);
    expect(await again).toBe(true);
    await vi.advanceTimersByTimeAsync(20);
    watch();
    stranger.raw('react', sticker);
    await vi.advanceTimersByTimeAsync(20);
    expect(seen.length).toBe(1);
    // A newer message of the same friend still counts.
    await friend.send('react', { id: 'wow' });
    await vi.advanceTimersByTimeAsync(20);
    expect(seen).toEqual(['frnd01abcd:great', 'frnd01abcd:wow']);
  });
});

describe('the ordered queue limits', () => {
  it('a group over its limit pushes out its own oldest waiting job, not the others, and keeps the order', async () => {
    const ran: string[] = [];
    const q = new Ordered(10);
    let open!: () => void;
    q.push(() => new Promise<void>((resolve) => (open = resolve)));
    for (let i = 0; i < 5; i++) q.push(() => void ran.push(`a${i}`), { group: 'a', groupMax: 2 });
    q.push(() => void ran.push('b'), { group: 'b', groupMax: 2 });
    open();
    await Promise.resolve();
    await Promise.resolve();
    expect(ran).toEqual(['a3', 'a4', 'b']);
    expect(q.idle).toBe(true);
  });
});

// ----- The real Web Crypto path -------------------------------------------------------

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
const STATUS = {
  week: 6, step: 'plan', air: 90, food: 5, dose: 10, doseLimit: 100, science: 10, stars: 3, end: 'complete',
  storm: { w: 0, s: 0, k: false, a: 0 },
} as unknown as Status;

let counter = 0;
function player(hub: MemoryHub, crypto: CrewCrypto = webCrypto) {
  counter++;
  const id = `rev${String(counter).padStart(5, '0')}`;
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

/** Real Web Crypto, but every verify waits `ms` first: a slow check, so the inbox stays busy. */
function slowVerify(ms: number): CrewCrypto {
  return {
    generate: () => webCrypto.generate(),
    verify: async (...args: Parameters<CrewCrypto['verify']>) => {
      await sleep(ms);
      return webCrypto.verify(...args);
    },
  };
}

/** Real Web Crypto, but every signature waits `ms` first: the host's seat list is published late. */
function slowSigner(ms: number): CrewCrypto {
  return {
    generate: async (): Promise<Identity> => {
      const real = await webCrypto.generate();
      return {
        publicKey: real.publicKey,
        sign: async (data: string) => {
          await sleep(ms);
          return real.sign(data);
        },
      };
    },
    verify: (...args: Parameters<CrewCrypto['verify']>) => webCrypto.verify(...args),
  };
}

async function lobbyWithFriend(guestCrypto: CrewCrypto = webCrypto, hostCrypto: CrewCrypto = webCrypto) {
  const hub = new MemoryHub();
  const host = player(hub, hostCrypto);
  expect(await host.room.create()).toBe(true);
  const code = host.room.view.code;
  const guest = player(hub, guestCrypto);
  expect(await guest.room.join(code)).toBe(true);
  guest.room.setReady(true);
  await until(() => host.room.canStart());
  return { hub, host, guest, code };
}

const JUNK_SIG = 'A'.repeat(86);

describe('a flood in a friend name does not push out honest traffic (real Web Crypto)', () => {
  it('control: without any flood, the seated friend sticker reaches the host', async () => {
    const { host, guest } = await lobbyWithFriend();
    expect(host.room.start(CHOICE, 7, START_DATE)).toBe(true);
    await until(() => guest.room.view.phase === 'playing');
    expect(guest.room.sendReaction('great')).toBe(true);
    await sleep(300);
    expect(host.reactions.filter((entry) => entry.id === guest.id)).toHaveLength(1);
  });

  it('an honest sticker sent right after a 300-frame forged flood in that friend name reaches the host', async () => {
    const { hub, host, guest, code } = await lobbyWithFriend();
    expect(host.room.start(CHOICE, 7, START_DATE)).toBe(true);
    await until(() => guest.room.view.phase === 'playing');
    const stranger = await Handmade.join(hub, code, { id: 'floodxxxxa', crypto: webCrypto });
    await sleep(30);
    for (let i = 0; i < 300; i++) stranger.raw('react', { from: guest.id, id: 'wow', q: i + 1, sig: JUNK_SIG });
    expect(guest.room.sendReaction('great')).toBe(true);
    await until(() => host.reactions.some((entry) => entry.id === guest.id), 10_000);
    await sleep(100);
    expect(host.reactions.filter((entry) => entry.id === guest.id)).toHaveLength(1);
  });

  it('the host start, sent right after a forged flood, reaches a guest whose inbox is busy with forged frames', async () => {
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
    const stranger = await Handmade.join(hub, code, { id: 'floodxxxxb', crypto: webCrypto });
    await sleep(30);
    for (let i = 0; i < 300; i++) stranger.raw('react', { from: friend.id, id: 'wow', q: i + 1, sig: JUNK_SIG });
    expect(host.room.start(CHOICE, 7, START_DATE)).toBe(true);
    await until(() => guest.room.view.phase === 'playing', 3000);
    expect(guest.room.view.phase).toBe('playing');
  });
});

describe('a sticker that follows its sender presence entry (real Web Crypto)', () => {
  it('arrives although the host seat list with the friend key is signed late', async () => {
    const { hub, host, guest, code } = await lobbyWithFriend(webCrypto, slowSigner(300));
    expect(host.room.canStart()).toBe(true);
    const friend = await Handmade.join(hub, code, { id: 'frndlate01', crypto: webCrypto });
    await friend.send('react', { id: 'wow' });
    await sleep(900);
    expect(guest.reactions.filter((entry) => entry.id === 'frndlate01')).toHaveLength(1);
  });

  it('a sender that never shows an entry is not held', async () => {
    const { hub, guest, code } = await lobbyWithFriend(webCrypto, slowSigner(300));
    const ghost = await Handmade.join(hub, code, { id: 'ghostxxx01', crypto: webCrypto, noKey: true });
    await ghost.send('react', { id: 'wow' });
    await sleep(900);
    expect(guest.reactions.filter((entry) => entry.id === 'ghostxxx01')).toHaveLength(0);
  });
});

describe('a final sent and then the room left at once (real Web Crypto)', () => {
  it('still reaches the friends when it waits behind status messages', async () => {
    const hub = new MemoryHub();
    const host = player(hub);
    expect(await host.room.create()).toBe(true);
    const code = host.room.view.code;
    const guest = player(hub);
    expect(await guest.room.join(code)).toBe(true);
    guest.room.setReady(true);
    await until(() => host.room.canStart());
    expect(host.room.start(CHOICE, 7, START_DATE)).toBe(true);
    await until(() => guest.room.view.phase === 'playing');
    host.room.sendStatus(STATUS);
    host.room.sendStatus(STATUS);
    host.room.sendFinal(STATUS);
    host.room.leave();
    await until(() => guest.room.view.players.find((p) => p.id === host.id)?.finished === true);
  });

  it('still reaches the friends', async () => {
    const hub = new MemoryHub();
    const host = player(hub);
    expect(await host.room.create()).toBe(true);
    const code = host.room.view.code;
    const guests = [player(hub), player(hub)];
    for (const guest of guests) {
      expect(await guest.room.join(code)).toBe(true);
      guest.room.setReady(true);
    }
    await until(() => host.room.canStart());
    expect(host.room.start(CHOICE, 7, START_DATE)).toBe(true);
    await until(() => guests.every((guest) => guest.room.view.phase === 'playing'));
    host.room.sendFinal(STATUS);
    host.room.leave();
    await until(() => guests.every((guest) => guest.room.view.players.find((p) => p.id === host.id)?.finished === true));
  });
});
