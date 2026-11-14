/**
 * Ordering review proofs, second file: a message that follows its sender's presence entry while the host's seat list
 * (which carries that sender's pinned key) is still being signed. Also a burst from one sender and a cost measurement.
 */
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 20_000 });
import { CREW_SUITS } from '../src/net/protocol';
import { CrewRoom } from '../src/net/room';
import { webCrypto } from '../src/net/sign';
import type { CrewCrypto, Identity } from '../src/net/sign';
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


let counter = 0;
function player(hub: MemoryHub, crypto: CrewCrypto = webCrypto) {
  counter++;
  const id = `lob${String(counter).padStart(5, '0')}`;
  const reactions: { id: string; reaction: string }[] = [];
  const positions: { id: string; x: number }[] = [];
  const room = new CrewRoom(() => new MemoryTransport(hub), {
    me: { id, name: counter % 16, suit: counter % CREW_SUITS.length },
    crypto,
    joinGraceMs: 300,
    createGraceMs: 300,
    hostGoneMs: 1500,
  });
  room.onReaction = (who, reaction) => reactions.push({ id: who.id, reaction });
  room.onPosition = (who, position) => positions.push({ id: who.id, x: position.x });
  return { id, room, reactions, positions };
}

/** Real Web Crypto, but every signature by this identity waits `ms` first: the host's seat list is published late. */
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

describe('VARIANT: forged reacts in the friend name before the seat list', () => {
  it('V3: two forged reacts, then the honest sticker, before the late seat list: is the honest one kept?', async () => {
    const hub = new MemoryHub();
    const host = player(hub, slowSigner(300));
    expect(await host.room.create()).toBe(true);
    const code = host.room.view.code;
    const guest = player(hub);
    expect(await guest.room.join(code)).toBe(true);
    guest.room.setReady(true);
    await until(() => host.room.canStart());
    const friend = await Handmade.join(hub, code, { id: 'frndvar001', crypto: webCrypto });
    const stranger = await Handmade.join(hub, code, { id: 'strangerv1', crypto: webCrypto });
    stranger.raw('react', { from: 'frndvar001', id: 'wow', q: 1, sig: 'A'.repeat(86) });
    stranger.raw('react', { from: 'frndvar001', id: 'wow', q: 2, sig: 'A'.repeat(86) });
    await friend.send('react', { id: 'wow' });
    await sleep(1200);
    expect(guest.reactions.filter((entry) => entry.id === 'frndvar001')).toHaveLength(1);
  });
});
