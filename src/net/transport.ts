/**
 * The network behind one small interface. A room uses one Transport; which one is only decided
 * where the room is made (src/net/crew.ts). Three exist:
 *   - SupabaseTransport (supabase.ts): the real one, over Supabase Realtime.
 *   - LocalTransport: two tabs of one browser (BroadcastChannel), for `?crew=local`.
 *   - MemoryTransport: for unit tests.
 * All three behave alike: no echo of your own messages, "presence" (who is here) that updates when
 * somebody comes or goes, and messages that arrive a moment later, never inside send().
 */

export interface PresenceEntry {
  key: string;
  meta: unknown;
}

export interface TransportHandlers {
  /** The list of everybody here (you included), whenever it changes. */
  presence(list: PresenceEntry[]): void;
  message(event: string, payload: unknown): void;
  /** The connection was lost or came back. */
  status(state: 'online' | 'offline'): void;
}

export interface Transport {
  /** Open the room. Resolves when it is open and your own presence is set; rejects when it cannot be reached. */
  connect(room: string, key: string, meta: unknown, handlers: TransportHandlers): Promise<void>;
  /** Change what the others see about you. */
  track(meta: unknown): void;
  send(event: string, payload: unknown): void;
  close(): void;
}

// ----- In memory (tests) ----------------------------------------------------------

interface Member {
  transport: MemoryTransport;
  key: string;
  meta: unknown;
  handlers: TransportHandlers;
}

/** A pretend network: every MemoryTransport made from one hub can talk to the others. */
export class MemoryHub {
  private rooms = new Map<string, Member[]>();
  /** Every message that went through, as the network would see it (tests read this). */
  log: { room: string; from: string; event: string; payload: unknown }[] = [];
  /** When true, new connections are refused (an offline test). */
  down = false;
  /** Return true to lose a message on its way to a player (tests). */
  lose: ((event: string, to: string) => boolean) | null = null;

  join(room: string, member: Member): void {
    const list = this.rooms.get(room) ?? [];
    list.push(member);
    this.rooms.set(room, list);
    this.syncPresence(room);
  }

  leave(room: string, transport: MemoryTransport): void {
    const list = (this.rooms.get(room) ?? []).filter((member) => member.transport !== transport);
    if (list.length) this.rooms.set(room, list);
    else this.rooms.delete(room);
    this.syncPresence(room);
  }

  members(room: string): Member[] {
    return this.rooms.get(room) ?? [];
  }

  syncPresence(room: string): void {
    const list = this.members(room);
    // A copy, as a real network would deliver.
    const entries = JSON.parse(JSON.stringify(list.map((member) => ({ key: member.key, meta: member.meta })))) as PresenceEntry[];
    for (const member of list) queueMicrotask(() => member.handlers.presence(entries.map((entry) => ({ ...entry }))));
  }

  broadcast(room: string, sender: MemoryTransport, from: string, event: string, payload: unknown): void {
    this.log.push({ room, from, event, payload });
    const copy = JSON.parse(JSON.stringify(payload)) as unknown;
    for (const member of this.members(room)) {
      if (member.transport === sender || this.lose?.(event, member.key)) continue;
      queueMicrotask(() => member.handlers.message(event, copy));
    }
  }
}

export class MemoryTransport implements Transport {
  private room = '';
  private me: Member | null = null;
  constructor(private hub: MemoryHub) {}

  connect(room: string, key: string, meta: unknown, handlers: TransportHandlers): Promise<void> {
    if (this.hub.down) return Promise.reject(new Error('offline'));
    this.room = room;
    this.me = { transport: this, key, meta: JSON.parse(JSON.stringify(meta)), handlers };
    this.hub.join(room, this.me);
    return Promise.resolve();
  }

  track(meta: unknown): void {
    if (!this.me) return;
    this.me.meta = JSON.parse(JSON.stringify(meta));
    this.hub.syncPresence(this.room);
  }

  send(event: string, payload: unknown): void {
    if (this.me) this.hub.broadcast(this.room, this, this.me.key, event, payload);
  }

  close(): void {
    if (!this.me) return;
    this.hub.leave(this.room, this);
    this.me = null;
  }

  /** The connection drops: the others see us leave, and we are told "offline". */
  cut(): void {
    if (!this.me) return;
    const handlers = this.me.handlers;
    this.hub.leave(this.room, this);
    this.me = null;
    queueMicrotask(() => handlers.status('offline'));
  }
}

// ----- Two tabs of one browser (developer flag ?crew=local) ---------------------------

type LocalFrame =
  | { t: 'p'; key: string; meta: unknown }
  | { t: 'm'; key: string; event: string; payload: unknown }
  | { t: 'bye'; key: string }
  | { t: 'ask' };

const LOCAL_BEAT_MS = 2000;
const LOCAL_EXPIRE_MS = 6500;

export class LocalTransport implements Transport {
  private channel: BroadcastChannel | null = null;
  private others = new Map<string, { meta: unknown; seen: number }>();
  private me: { key: string; meta: unknown } | null = null;
  private handlers: TransportHandlers | null = null;
  private timer = 0;

  connect(room: string, key: string, meta: unknown, handlers: TransportHandlers): Promise<void> {
    if (typeof BroadcastChannel === 'undefined') return Promise.reject(new Error('no BroadcastChannel'));
    this.channel = new BroadcastChannel(room);
    this.me = { key, meta };
    this.handlers = handlers;
    this.channel.onmessage = (event: MessageEvent) => this.receive(event.data as LocalFrame);
    this.post({ t: 'ask' });
    this.post({ t: 'p', key, meta });
    this.timer = window.setInterval(() => {
      if (!this.me) return;
      this.post({ t: 'p', key: this.me.key, meta: this.me.meta });
      const now = Date.now();
      let changed = false;
      for (const [id, other] of this.others) {
        if (now - other.seen > LOCAL_EXPIRE_MS) {
          this.others.delete(id);
          changed = true;
        }
      }
      if (changed) this.emit();
    }, LOCAL_BEAT_MS);
    // The first list arrives a moment later, like on the real network.
    queueMicrotask(() => this.emit());
    return Promise.resolve();
  }

  private post(frame: LocalFrame): void {
    try {
      this.channel?.postMessage(frame);
    } catch {
      /* a closed channel: nothing to do */
    }
  }

  private emit(): void {
    if (!this.me || !this.handlers) return;
    const list: PresenceEntry[] = [{ key: this.me.key, meta: this.me.meta }];
    for (const [id, other] of this.others) list.push({ key: id, meta: other.meta });
    this.handlers.presence(list);
  }

  private receive(frame: LocalFrame): void {
    if (!frame || typeof frame !== 'object' || !this.me) return;
    if (frame.t === 'ask') {
      this.post({ t: 'p', key: this.me.key, meta: this.me.meta });
    } else if (frame.t === 'p' && typeof frame.key === 'string' && frame.key !== this.me.key) {
      const before = JSON.stringify(this.others.get(frame.key)?.meta);
      this.others.set(frame.key, { meta: frame.meta, seen: Date.now() });
      if (before !== JSON.stringify(frame.meta)) this.emit();
    } else if (frame.t === 'bye') {
      if (this.others.delete(frame.key)) this.emit();
    } else if (frame.t === 'm' && frame.key !== this.me.key) {
      this.handlers?.message(frame.event, frame.payload);
    }
  }

  track(meta: unknown): void {
    if (!this.me) return;
    this.me.meta = meta;
    this.post({ t: 'p', key: this.me.key, meta });
    this.emit();
  }

  send(event: string, payload: unknown): void {
    if (this.me) this.post({ t: 'm', key: this.me.key, event, payload });
  }

  close(): void {
    window.clearInterval(this.timer);
    if (this.me) this.post({ t: 'bye', key: this.me.key });
    this.channel?.close();
    this.channel = null;
    this.me = null;
    this.handlers = null;
    this.others.clear();
  }
}
