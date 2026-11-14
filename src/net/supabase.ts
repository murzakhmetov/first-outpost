/**
 * The real network: Supabase Realtime "broadcast" (messages) and "presence" (who is here), with the
 * project's public key. It is loaded only when a room is opened (dynamic import), so the game and
 * the tests never load it otherwise.
 */
import type { NetConfig } from './config';
import { EVENT_NAMES } from './protocol';
import type { Transport, TransportHandlers } from './transport';

/** How long to wait for the connection before saying "offline". */
const CONNECT_TIMEOUT_MS = 9000;

interface ChannelLike {
  on(type: string, filter: Record<string, unknown>, callback: (payload: any) => void): ChannelLike;
  subscribe(callback: (status: string) => void): ChannelLike;
  track(meta: unknown): Promise<unknown>;
  send(message: { type: 'broadcast'; event: string; payload: unknown }): Promise<unknown>;
  presenceState(): Record<string, unknown[]>;
}

interface ClientLike {
  channel(name: string, options: Record<string, unknown>): ChannelLike;
  removeChannel(channel: ChannelLike): Promise<unknown>;
  disconnect(): Promise<unknown> | void;
}

export class SupabaseTransport implements Transport {
  private client: ClientLike | null = null;
  private channel: ChannelLike | null = null;
  private meta: unknown = null;
  private closed = false;

  constructor(private config: NetConfig) {}

  async connect(room: string, key: string, meta: unknown, handlers: TransportHandlers): Promise<void> {
    this.meta = meta;
    const { RealtimeClient } = await import('@supabase/realtime-js');
    if (this.closed) throw new Error('closed');
    const client = new RealtimeClient(this.config.url, { params: { apikey: this.config.key } }) as unknown as ClientLike;
    this.client = client;
    const channel = client.channel(room, { config: { broadcast: { self: false }, presence: { key } } });
    this.channel = channel;

    channel.on('presence', { event: 'sync' }, () => {
      // Every entry is passed on, also when two connections use one key: the room treats such a key as contested.
      const state = channel.presenceState();
      handlers.presence(Object.entries(state).flatMap(([id, entries]) => entries.map((meta) => ({ key: id, meta }))));
    });
    for (const event of EVENT_NAMES) {
      channel.on('broadcast', { event }, (message: { payload?: unknown }) => handlers.message(event, message?.payload));
    }

    await new Promise<void>((resolve, reject) => {
      let first = true;
      const timer = window.setTimeout(() => reject(new Error('timeout')), CONNECT_TIMEOUT_MS);
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          // After a lost connection the library joins again by itself: say who we are again.
          void channel.track(this.meta).catch(() => undefined);
          handlers.status('online');
          if (first) {
            first = false;
            window.clearTimeout(timer);
            resolve();
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (first) {
            window.clearTimeout(timer);
            reject(new Error(status));
          } else if (!this.closed) {
            handlers.status('offline');
          }
        }
      });
    });
  }

  track(meta: unknown): void {
    this.meta = meta;
    void this.channel?.track(meta).catch(() => undefined);
  }

  send(event: string, payload: unknown): void {
    void this.channel?.send({ type: 'broadcast', event, payload }).catch(() => undefined);
  }

  close(): void {
    this.closed = true;
    const { client, channel } = this;
    this.channel = null;
    this.client = null;
    if (!client) return;
    try {
      if (channel) void Promise.resolve(client.removeChannel(channel)).catch(() => undefined);
      void Promise.resolve(client.disconnect()).catch(() => undefined);
    } catch {
      /* closing must never throw */
    }
  }
}
