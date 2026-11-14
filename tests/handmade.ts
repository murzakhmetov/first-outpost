/**
 * A hand-made client for tests: somebody who talks to the channel directly, not through a CrewRoom. It has a key pair of its
 * own (so it can sign for itself and for nobody else), and it can send any text it likes, signed or not, under any
 * counter, in any room. This is what a modified copy of the game, or a stranger who knows the room code, can do.
 */
import { PROTOCOL, channelName } from '../src/net/protocol';
import { getCrewCrypto, messageText, presenceText } from '../src/net/sign';
import type { CrewCrypto, Identity } from '../src/net/sign';
import { MemoryTransport } from '../src/net/transport';
import type { MemoryHub, PresenceEntry } from '../src/net/transport';

export interface HandmadeOptions {
  /** The presence key (and id). A client may choose any key on the real network. */
  id: string;
  crypto?: CrewCrypto;
  /** Use this key pair (the same client in two rooms, to see whether a message can be moved from one to the other). */
  identity?: Identity;
  /** Give the presence entry no public key at all (an older copy of the game). */
  noKey?: boolean;
  ready?: boolean;
  /** Fields of the presence entry to overwrite. */
  meta?: Record<string, unknown>;
}

export class Handmade {
  readonly id: string;
  readonly transport: MemoryTransport;
  identity!: Identity;
  /** The counter of the last message sent with `send`. */
  q = 0;
  /** The presence lists this client has been shown. */
  lists: PresenceEntry[][] = [];
  received: { event: string; payload: unknown }[] = [];
  private constructor(
    readonly hub: MemoryHub,
    readonly code: string,
    private readonly options: HandmadeOptions,
  ) {
    this.id = options.id;
    this.transport = new MemoryTransport(hub);
  }

  /** Join the channel of `code` (after `await tick()`, a host sees the entry and may seat it). */
  static async join(hub: MemoryHub, code: string, options: HandmadeOptions): Promise<Handmade> {
    const client = new Handmade(hub, code, options);
    const crypto = options.crypto ?? getCrewCrypto();
    client.identity = options.identity ?? (await crypto.generate());
    await client.transport.connect(channelName(code), client.id, client.presence(), {
      presence: (list) => client.lists.push(list),
      message: (event, payload) => client.received.push({ event, payload }),
      status: () => undefined,
    });
    return client;
  }

  /** The presence entry of a player: a friend who is ready. */
  presence(over: Record<string, unknown> = {}): Record<string, unknown> {
    const meta: Record<string, unknown> = {
      id: this.id,
      n: 7,
      c: 3,
      r: this.options.ready ?? true,
      h: false,
      s: false,
      t: Date.now() + 5,
      v: PROTOCOL,
      ...(this.options.noKey ? {} : { k: this.identity.publicKey }),
      ...this.options.meta,
      ...over,
    };
    return meta;
  }

  /** Show the others this presence entry. */
  async track(over: Record<string, unknown> = {}): Promise<void> {
    this.transport.track(this.presence(over));
  }

  /** The presence entry of a host, with its decisions signed under this client's own key (a fake host that signs for itself). */
  async trackAsHost(over: { m?: string[]; mk?: string[]; s?: boolean; p?: unknown } = {}): Promise<Record<string, unknown>> {
    const base = this.presence({ h: true, r: true, s: over.s ?? false, p: over.p ?? null, m: over.m ?? [this.id], mk: over.mk ?? [this.identity.publicKey] });
    const g = await this.identity.sign(presenceText(this.code, { id: this.id, v: PROTOCOL, k: this.identity.publicKey, s: base.s as boolean, p: base.p, m: base.m as string[], mk: base.mk as string[] }));
    const meta = { ...base, g };
    this.transport.track(meta);
    return meta;
  }

  /** A message exactly as a real copy sends it: the body plus `from` (this client's id), the next counter and the signature. */
  async frame(event: string, body: object, over: { q?: number; code?: string; from?: string } = {}): Promise<Record<string, unknown>> {
    const q = over.q ?? ++this.q;
    const payload = JSON.parse(JSON.stringify({ from: over.from ?? this.id, ...body, q })) as Record<string, unknown>;
    const sig = await this.identity.sign(messageText(over.code ?? this.code, event, payload));
    return { ...payload, sig };
  }

  /** Send a signed message. `from` may be set to somebody else's id: it is still signed with this client's own key. */
  async send(event: string, body: object, over: { q?: number; code?: string; from?: string } = {}): Promise<Record<string, unknown>> {
    const frame = await this.frame(event, body, over);
    this.transport.send(event, frame);
    return frame;
  }

  /** Put anything on the channel, as it is. */
  raw(event: string, payload: unknown): void {
    this.transport.send(event, payload);
  }

  close(): void {
    this.transport.close();
  }
}

/** What a seated player (a real room) could do with its own key: sign any text, in any name. Reads the room's own key pair, which only that player has. */
export async function signedBy(room: object, code: string, event: string, body: object, q: number): Promise<Record<string, unknown>> {
  const identity = (room as unknown as { identity: Identity }).identity;
  const payload = JSON.parse(JSON.stringify({ ...body, q })) as Record<string, unknown>;
  const sig = await identity.sign(messageText(code, event, payload));
  return { ...payload, sig };
}
