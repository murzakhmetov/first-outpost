/**
 * One crew room, as a small state machine over a Transport. It knows nothing about the screen or
 * the game: src/net/crew.ts connects it to both. Time comes from the clock you give it, and the
 * network from the transport, so tests can run it with fakes.
 *
 * Rules (the network does not enforce them, so every player's copy does):
 *  - the room is made by one host; the others need the room code;
 *  - the host decides who has a seat (presence "m"): at most 4 players, a fifth one sees "room full";
 *  - nobody joins after the mission has started;
 *  - if the host leaves before the start, the room closes; after the start nothing changes;
 *  - only the host can start, and only once: the start is part of the host's own presence entry, read only
 *    from the host that was locked in when we joined. A presence key used by two connections is "contested"
 *    and believed for neither, so nobody can speak for the host (known gap, see docs/MULTIPLAYER.md: an exact
 *    copy of the host entry that outlives the host connection);
 *  - every message is checked (protocol.ts) and limited in rate before it is believed;
 *  - the host cannot start while a seat speaks another protocol version (a mixed crew would play two different games);
 *  - every message and the host's decisions are signed (sign.ts): a message counts only when it verifies against the
 *    public key pinned for the id it claims (the guest pins the host's key when it locks the host in, the host pins a
 *    player's key when it seats them, the host's signed seat list carries the seated keys to everyone). Everything
 *    that arrives, presence included, goes through ONE ordered queue, because pins come from presence and a check
 *    that finishes later must never let a later message overtake an earlier one;
 *  - the shared-base messages (coopwire.ts) are only passed through: this room checks who may send them and that they
 *    are well formed, and hands them to `onCoop`; src/net/coop.ts (the session) decides what they mean. They are
 *    read only when the host started the mission in "coop" mode, so a race-mode room never looks at them.
 */
import { isCoopEvent, parseCoopMessage, senderOf } from './coopwire';
import type { CoopIncoming } from './coopwire';
import {
  EVENT_NAMES,
  MAX_PLAYERS,
  POSITION_MIN_MS,
  PROTOCOL,
  REACTION_MIN_MS,
  STATUS_MIN_MS,
  channelName,
  freeName,
  isRecord,
  isSignature,
  normalizeCode,
  parseMessage,
  parseMeta,
  parseStart,
  playerId,
  randomCode,
  seatOrder,
  sizeLimit,
  statusToWire,
  wire,
} from './protocol';
import type { CoopEventName, CrewChoice, GameMode, Meta, Position, ReactionId, StartPayload, Status } from './protocol';
import { Ordered, SIG_OVERHEAD, canSign, getCrewCrypto, isPromise, messageText, presenceText } from './sign';
import type { CrewCrypto, Identity, Maybe } from './sign';
import type { PresenceEntry, Transport, TransportHandlers } from './transport';

type Timer = ReturnType<typeof setTimeout> | 0;

export type Phase = 'idle' | 'connecting' | 'lobby' | 'playing' | 'closed' | 'failed';
export type Failure = 'offline' | 'insecure' | 'noRoom' | 'full' | 'started' | 'hostLeft' | 'badCode';

export interface Player {
  id: string;
  /** Place in the list of preset crew names. */
  name: number;
  /** Place in the list of suit colours. */
  suit: number;
  ready: boolean;
  host: boolean;
  me: boolean;
  /** False once the player has gone (their last numbers stay for the debrief). */
  here: boolean;
  status: Status | null;
  /** The player's mission is over and their final numbers are in. */
  finished: boolean;
}

export interface RoomView {
  phase: Phase;
  code: string;
  me: string;
  hostId: string | null;
  players: Player[];
  /** False while the connection is lost. */
  online: boolean;
  failure: Failure | null;
  start: StartPayload | null;
  /** False while a seat in the room speaks another protocol version (the host cannot start then). */
  versionOk: boolean;
}

export interface RoomOptions {
  me: { id: string; name: number; suit: number };
  now?: () => number;
  random?: () => number;
  /** How long a joining player waits to see who is in the room (ms). */
  joinGraceMs?: number;
  /** How long a new room waits to check the code is free (ms). */
  createGraceMs?: number;
  /** How long the host may be out of sight before a lobby closes (ms). */
  hostGoneMs?: number;
  /** Signing and checking. Production uses Web Crypto (the default); tests pass a fake or the real thing. */
  crypto?: CrewCrypto;
}

/** Inbound limits: at most this many messages of a kind from one player in a 2 second window. */
const WINDOW_MS = 2000;
const INBOUND_LIMIT: Record<string, number> = { status: 8, final: 3, react: 3, pos: 16, st: 12, rec: 24, int: 24, sync: 3 };
/** How many inbound (or outbound) jobs may wait for a check that finishes later. A job over the limit is dropped. */
const QUEUE_MAX = 256;
/**
 * What may wait in the inbox for one claimed sender (a seated friend), for all unknown senders together, and for presence
 * lists. Over a limit the OLDEST waiting job of that group goes, so a flood of frames in a friend's name (they cost a
 * signature check each) cannot push out the friend's real message or the host's start behind it.
 */
const WAIT_PER_SENDER = 128;
const WAIT_UNKNOWN = 16;
const WAIT_PRESENCE = 64;
/** A sticker from a friend who is not on the host's list yet waits for the list (a few, a short while). */
const PARKED_PER_SENDER = 2;
const PARKED_MAX = 8;
const PARKED_MS = 10_000;
/** Counters remembered across joins: one per (room, sender, key). */
const COUNTERS_MAX = 512;
/** A message counter is a positive integer that fits a double exactly. */
const COUNTER_MAX = 2 ** 40;

/** The wire form of a presence entry: no empty signature and no empty seat keys. */
function metaOnWire(meta: Meta): Meta {
  const out = { ...meta } as Partial<Meta> & Record<string, unknown>;
  if (!out.g) delete out.g;
  if (!out.mk || out.mk.length === 0) delete out.mk;
  if (!out.k) delete out.k;
  return out as Meta;
}

export class CrewRoom {
  private transport: Transport | null = null;
  private token = 0;
  private listeners = new Set<(view: RoomView) => void>();
  private roster = new Map<string, Player>();
  /** The believed entries of the last presence list (see applyPresence), ordered. */
  private present: Meta[] = [];
  /** The parsed entries of the last presence list. */
  private entries: Meta[] = [];
  private meta: Meta;
  private phase: Phase = 'idle';
  private code = '';
  private hostId: string | null = null;
  private isHost = false;
  private admission: ((verdict: 'ok' | 'full' | 'started') => void) | null = null;
  private failure: Failure | null = null;
  private online = true;
  private startPayload: StartPayload | null = null;
  private settled = false;
  private hostGoneTimer: Timer = 0;
  private waitTimer: Timer = 0;
  /** Ends a wait early (used when the room is left while a join or create is still waiting). */
  private wake: (() => void) | null = null;

  private statusTimer: Timer = 0;
  private lastStatusAt = -Infinity;
  private lastStatusJson = '';
  private latestStatus: Status | null = null;
  private finalStatus: Status | null = null;
  private lastFinalAt = -Infinity;
  private lastReactionAt = -Infinity;
  private lastPosAt = -Infinity;
  private seen = new Map<string, number[]>();

  // Signing. The pins, the counters and the verified host entries live as long as one room; the key pair as long as this object.
  private readonly crypto: CrewCrypto;
  private identity: Identity | null = null;
  /** The public key we trust for an id: the host's from the moment we lock it in, a player's from the moment the host seats them. */
  private pins = new Map<string, string>();
  /**
   * The highest counter seen from each sender in each room under each key (only a verified message moves it): a copy of an
   * older message is dropped. It outlives a leave and a join, so a copy cannot be replayed after the receiver comes back to
   * the same lobby; a friend who comes back with a new key (a new visit) starts again at one.
   */
  private lastCounter = new Map<string, number>();
  /** Stickers from a friend whose key we do not hold yet (the host's seat list is still on its way). */
  private parked: { event: string; payload: unknown; from: string; at: number }[] = [];
  /** Our own counter. It never goes back, also when the room is left and another one is joined. */
  private counter = 0;
  /** Ids whose host entry (the one in `present`) carries a signature that checks out. */
  private verifiedHosts = new Set<string>();
  private checked = new Map<string, boolean>();
  private readonly inbox = new Ordered(QUEUE_MAX);
  private outbox = new Ordered(QUEUE_MAX);

  /** The host started the mission (also called on the host itself). */
  onStart: ((start: StartPayload) => void) | null = null;
  onReaction: ((player: Player, reaction: ReactionId) => void) | null = null;
  onPosition: ((player: Player, position: Position) => void) | null = null;
  /** A checked shared-base message (co-op mode only): the commander's `st` and `rec`, a guest's `int` and `sync`. */
  onCoop: ((incoming: CoopIncoming, from: Player) => void) | null = null;

  private readonly now: () => number;
  private readonly random: () => number;
  private readonly joinGraceMs: number;
  private readonly createGraceMs: number;
  private readonly hostGoneMs: number;

  constructor(
    private makeTransport: () => Transport,
    private options: RoomOptions,
  ) {
    this.crypto = options.crypto ?? getCrewCrypto();
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.joinGraceMs = options.joinGraceMs ?? 1500;
    this.createGraceMs = options.createGraceMs ?? 500;
    this.hostGoneMs = options.hostGoneMs ?? 3500;
    this.meta = this.freshMeta(false);
  }

  // ----- Watching ---------------------------------------------------------------

  get view(): RoomView {
    return {
      phase: this.phase,
      code: this.code,
      me: this.options.me.id,
      hostId: this.hostId,
      players: this.sortedPlayers().map((player) => ({ ...player })),
      online: this.online,
      failure: this.failure,
      start: this.startPayload,
      versionOk: this.versionsMatch(),
    };
  }

  subscribe(listener: (view: RoomView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const view = this.view;
    for (const listener of [...this.listeners]) listener(view);
  }

  private sortedPlayers(): Player[] {
    const order = new Map(this.present.map((meta, index) => [meta.id, index]));
    return [...this.roster.values()].sort((a, b) => {
      if (a.host !== b.host) return a.host ? -1 : 1;
      const ia = order.get(a.id) ?? 99;
      const ib = order.get(b.id) ?? 99;
      return ia - ib || (a.id < b.id ? -1 : 1);
    });
  }

  // ----- Opening and closing -----------------------------------------------------

  private freshMeta(host: boolean, key = ''): Meta {
    this.isHost = host;
    return {
      id: this.options.me.id,
      n: this.options.me.name,
      c: this.options.me.suit,
      r: host,
      h: host,
      m: host ? [this.options.me.id] : [],
      mk: host && key ? [key] : [],
      g: '',
      k: key,
      p: null,
      s: false,
      t: this.now(),
      v: PROTOCOL,
    };
  }

  private reset(): void {
    this.token++;
    this.cleanup();
    this.roster.clear();
    this.present = [];
    this.phase = 'idle';
    this.code = '';
    this.hostId = null;
    this.admission = null;
    this.failure = null;
    this.online = true;
    this.startPayload = null;
    this.settled = false;
    this.latestStatus = null;
    this.finalStatus = null;
    this.lastStatusAt = -Infinity;
    this.lastStatusJson = '';
    this.seen.clear();
    this.pins.clear();
    this.parked = [];
    this.verifiedHosts.clear();
    this.checked.clear();
    this.entries = [];
  }

  private cleanup(): void {
    this.inbox.clear();
    // A final that is signed or waiting still goes out (a friend sees the leaver's last numbers); the rest is forgotten.
    const outbox = this.outbox;
    outbox.clear((tag) => tag === 'final');
    this.outbox = new Ordered(QUEUE_MAX);
    clearTimeout(this.hostGoneTimer);
    clearTimeout(this.waitTimer);
    clearTimeout(this.statusTimer);
    const wake = this.wake;
    this.wake = null;
    wake?.();
    this.hostGoneTimer = 0;
    this.waitTimer = 0;
    this.statusTimer = 0;
    const transport = this.transport;
    this.transport = null;
    if (transport) {
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        try {
          transport.close();
        } catch {
          /* closing must never throw */
        }
      };
      if (outbox.idle) close();
      else {
        // Close once the last signature is done (and in any case soon).
        const late = setTimeout(close, 3000);
        outbox.whenIdle(() => {
          clearTimeout(late);
          close();
        });
      }
    }
  }

  private fail(failure: Failure): false {
    this.cleanup();
    this.phase = failure === 'hostLeft' ? 'closed' : 'failed';
    this.failure = failure;
    this.emit();
    return false;
  }

  /** Make a new room. Resolves true when the room is open. */
  async create(): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = randomCode(this.random);
      const result = await this.open(code, true);
      if (result !== 'taken') return result === 'ok';
    }
    return this.fail('offline');
  }

  /** Join a room by its code. Resolves true when you are in the lobby. */
  async join(input: string): Promise<boolean> {
    const code = normalizeCode(input);
    this.reset();
    if (!code) return this.fail('badCode');
    return (await this.open(code, false)) === 'ok';
  }

  private async open(code: string, asHost: boolean): Promise<'ok' | 'fail' | 'taken'> {
    this.reset();
    const token = this.token;
    this.code = code;
    this.phase = 'connecting';
    this.meta = this.freshMeta(asHost);
    this.hostId = asHost ? this.meta.id : null;
    this.emit();

    // This visit's key pair, and for a host its first signed entry. A device that cannot sign cannot join a crew:
    // a page without Web Crypto (http on a local network address) is told it needs a secure page ("insecure");
    // a crypto that fails for another reason is the same "offline" the player sees when the network cannot be reached.
    let first: Meta;
    try {
      const made = this.makeIdentity();
      const identity = isPromise(made) ? await made : made;
      if (token !== this.token) return 'fail';
      this.meta = { ...this.meta, k: identity.publicKey, mk: asHost ? [identity.publicKey] : [] };
      if (asHost) this.pins.set(this.meta.id, identity.publicKey);
      first = this.meta;
      if (asHost) {
        const signed = identity.sign(presenceText(code, this.meta));
        first = { ...this.meta, g: isPromise(signed) ? await signed : signed };
        if (token !== this.token) return 'fail';
      }
    } catch {
      if (token !== this.token) return 'fail';
      this.fail(canSign() ? 'offline' : 'insecure');
      return 'fail';
    }

    const transport = this.makeTransport();
    this.transport = transport;
    const handlers: TransportHandlers = {
      presence: (list) => this.onPresence(token, list),
      message: (event, payload) => this.onMessage(token, event, payload),
      status: (state) => this.onStatus(token, state),
    };
    try {
      await transport.connect(channelName(code), this.meta.id, metaOnWire(first), handlers);
    } catch {
      if (token !== this.token) return 'fail';
      this.fail('offline');
      return 'fail';
    }
    if (token !== this.token) {
      transport.close();
      return 'fail';
    }
    await new Promise<void>((resolve) => {
      this.wake = resolve;
      this.waitTimer = setTimeout(resolve, asHost ? this.createGraceMs : this.joinGraceMs);
    });
    this.wake = null;
    if (token !== this.token) return 'fail';

    const others = this.present.filter((meta) => meta.id !== this.meta.id);
    if (asHost) {
      // Somebody already hosts this code: take another one.
      if (others.some((meta) => meta.h)) {
        this.cleanup();
        return 'taken';
      }
      this.settled = true;
      this.phase = 'lobby';
      this.reconcile();
      return 'ok';
    }
    const hosts = others.filter((meta) => meta.h);
    // No host: nobody made this room. Two hosts: somebody is pretending, so we do not trust either.
    if (hosts.length !== 1) {
      this.fail('noRoom');
      return 'fail';
    }
    const host = hosts[0];
    // Only the host says whether the mission has started (a stranger's flag proves nothing).
    if (host.s) {
      this.fail('started');
      return 'fail';
    }
    // The host's key is pinned from here on. An entry whose signature does not check out (or a host of an older
    // version, which cannot sign) is not a host we can trust: there is no unsigned mode.
    if (!this.verifiedHosts.has(host.id) || !host.k) {
      this.fail('noRoom');
      return 'fail';
    }
    this.pins.set(host.id, host.k);
    this.hostId = host.id;
    // From here on the friends' keys come from the host's signed seat list (also from the list we already hold).
    this.applyPresence();
    this.settled = true;
    // The host decides who has a seat: wait until we are on its list (or told the room is full).
    const verdict = await new Promise<'ok' | 'full' | 'started' | 'timeout'>((resolve) => {
      this.wake = () => resolve('timeout');
      this.waitTimer = setTimeout(() => resolve('timeout'), 6000);
      this.admission = (result) => {
        clearTimeout(this.waitTimer);
        resolve(result);
      };
      this.reconcile();
    });
    this.wake = null;
    if (token !== this.token) return 'fail';
    this.admission = null;
    if (verdict !== 'ok') {
      this.fail(verdict === 'full' ? 'full' : verdict === 'started' ? 'started' : 'noRoom');
      return 'fail';
    }
    this.phase = 'lobby';
    this.reconcile();
    return 'ok';
  }

  /** Leave the room (also resets a failure). The game itself is not touched. */
  leave(): void {
    this.reset();
    this.emit();
  }

  // ----- Who is here -------------------------------------------------------------

  /** Everything from the network goes through the one ordered inbox, presence and messages together (pins come from presence). */
  private onPresence(token: number, list: PresenceEntry[]): void {
    this.inbox.push(() => this.takePresence(token, list), { group: '#presence', groupMax: WAIT_PRESENCE });
  }

  private onMessage(token: number, event: string, payload: unknown): void {
    const claimed = isRecord(payload) ? playerId(payload.from) : null;
    if (claimed === this.meta.id) return; // our own name: nothing we receive can be ours
    const known = claimed !== null && this.roster.get(claimed)?.here === true;
    // A friend whose key is already pinned has the signature checked while the frame waits (all in parallel); the
    // result is used when its turn comes, so a flood of forged frames costs the waiting line nothing: they leave it as
    // soon as they are found bad.
    const early: { key: string; result?: Maybe<boolean> } | null = known ? { key: this.pins.get(claimed) ?? '', result: undefined } : null;
    this.inbox.push(() => this.takeMessage(token, event, payload, early), {
      group: known ? claimed : '#unknown',
      groupMax: known ? WAIT_PER_SENDER : WAIT_UNKNOWN,
      warm:
        early && early.key
          ? () => {
              const result = this.checkSignature(event, payload, early.key);
              early.result = result;
              return result;
            }
          : undefined,
    });
  }

  /** A presence list from the network. Runs inside the ordered inbox: a signature that is checked later holds the queue. */
  private takePresence(token: number, list: PresenceEntry[]): Maybe<void> {
    if (token !== this.token) return;
    const entries: Meta[] = [];
    for (const entry of list) {
      const meta = parseMeta(entry.meta);
      // A player can only speak for themselves: the id inside must be the id of the entry.
      if (meta && meta.id === entry.key) entries.push(meta);
    }
    // The host's entry is the only one with signed decisions (the start, the seat list). Check each candidate once.
    const waits: Promise<void>[] = [];
    for (const meta of entries) {
      if (!this.needsCheck(meta)) continue;
      const result = this.checkHostEntry(meta);
      if (isPromise(result)) waits.push(result);
    }
    const apply = (): void => {
      if (token !== this.token) return;
      this.entries = entries;
      this.applyPresence();
    };
    if (waits.length) return Promise.all(waits).then(apply);
    apply();
  }

  /** A host entry we could check: current version, signed, and (once the host is locked in) the locked host's. */
  private needsCheck(meta: Meta): boolean {
    if (!meta.h || meta.id === this.meta.id || meta.v !== PROTOCOL || !meta.g || !meta.k) return false;
    return this.hostId === null || meta.id === this.hostId;
  }

  private checkKey(meta: Meta): string {
    return `${meta.k}.${meta.g}.${presenceText(this.code, meta)}`;
  }

  /** Check the host's signature over its decisions (once per distinct entry). Never rejects. */
  private checkHostEntry(meta: Meta): Maybe<void> {
    const key = this.checkKey(meta);
    if (this.checked.has(key)) return;
    const remember = (ok: boolean): void => {
      if (this.checked.size >= 64) this.checked.clear();
      this.checked.set(key, ok);
    };
    try {
      const result = this.crypto.verify(meta.k, presenceText(this.code, meta), meta.g);
      if (isPromise(result)) return result.then(remember, () => remember(false));
      remember(result);
    } catch {
      remember(false);
    }
  }

  /** The signature of this host entry has checked out (our own entry needs no check). */
  private signedOk(meta: Meta): boolean {
    return meta.id === this.meta.id || this.checked.get(this.checkKey(meta)) === true;
  }

  /**
   * Who is here, from the entries of the last list. Rules:
   *  - two different entries under one id are believed for neither (somebody speaks in another player's name);
   *  - an entry whose key is not the one pinned for its id counts the same way: a pin is never replaced;
   *  - a guest takes the other players' keys from the host's signed seat list (never from the players' own entries).
   */
  private applyPresence(): void {
    let metas = this.believed();
    if (!this.isHost && this.hostId) {
      const host = metas.find((meta) => meta.id === this.hostId);
      if (host && this.signedOk(host) && host.k === this.pins.get(host.id)) {
        let added = false;
        host.m.forEach((id, index) => {
          const key = host.mk[index];
          if (key && id !== this.meta.id && !this.pins.has(id)) {
            this.pins.set(id, key);
            added = true;
          }
        });
        if (added) metas = this.believed();
      }
    }
    this.present = metas.sort(seatOrder);
    this.verifiedHosts = new Set(this.present.filter((meta) => meta.h && this.signedOk(meta)).map((meta) => meta.id));
    if (this.settled) this.reconcile();
    this.retryParked();
  }

  /**
   * The key a held sticker of `from` must be signed with: the key of the friend's one entry. Null when the sticker cannot
   * be held at all (not the lobby, not a sticker, the host, no entry, or two different entries under that id).
   */
  private parkKey(event: string, from: string): string | null {
    if (this.phase !== 'lobby' || event !== 'react' || this.isHost || from === this.hostId) return null;
    const mine = this.entries.filter((meta) => meta.id === from);
    if (mine.length === 0 || mine.some((meta) => meta.h || meta.k !== mine[0].k || !mine[0].k)) return null;
    return mine[0].k;
  }

  /** Hold a sticker from a friend who has shown an entry but is not on the host's list yet. True when it is held. */
  private park(event: string, payload: unknown, from: string): boolean {
    if (this.parkKey(event, from) === null) return false;
    const now = this.now();
    this.parked = this.parked.filter((item) => now - item.at < PARKED_MS);
    if (this.parked.length >= PARKED_MAX || this.parked.filter((item) => item.from === from).length >= PARKED_PER_SENDER) return false;
    this.parked.push({ event, payload, from, at: now });
    return true;
  }

  /** The seat list brought keys: the held stickers of those friends take their turn again, in the order they came. */
  private retryParked(): void {
    if (this.parked.length === 0) return;
    const now = this.now();
    const ready = this.parked.filter((item) => this.pins.has(item.from) && this.roster.has(item.from));
    if (ready.length === 0) return;
    this.parked = this.parked.filter((item) => !ready.includes(item));
    for (const item of ready) if (now - item.at < PARKED_MS) this.onMessage(this.token, item.event, item.payload);
  }

  private believed(): Meta[] {
    const byKey = new Map<string, { meta: Meta; json: string }[]>();
    for (const meta of this.entries) {
      const group = byKey.get(meta.id) ?? [];
      group.push({ meta, json: JSON.stringify(meta) });
      byKey.set(meta.id, group);
    }
    const metas: Meta[] = [];
    for (const [id, group] of byKey) {
      // Two different entries under one key: somebody is speaking in another player's name. Believe neither.
      if (group.some((item) => item.json !== group[0].json)) continue;
      // The same when an entry shows another key than the one pinned for its id: a pin is never replaced, and the id is
      // believed for neither until the other entry is gone (the usual "left" for a friend, "host out of sight" for the host).
      const pin = this.pins.get(id);
      if (pin && group[0].meta.k !== pin) continue;
      metas.push(group[0].meta);
    }
    return metas;
  }

  /** The host's entry, only while its signed decisions check out. Without that it is as if the host were out of sight. */
  private hostMeta(): Meta | null {
    const meta = this.present.find((candidate) => candidate.id === this.hostId) ?? null;
    if (meta && !this.isHost && !this.verifiedHosts.has(meta.id)) return null;
    return meta;
  }

  /** The host's signed seat list gives this player a seat, under the key this device really has. */
  private listedIn(host: Meta): boolean {
    const index = host.m.indexOf(this.meta.id);
    return index >= 0 && host.mk[index] === this.meta.k;
  }

  /** Host only: seat the players who are here, at most four, in the order they came. */
  private seat(): Meta[] {
    const mine = this.meta.id;
    const here = new Set(this.present.map((meta) => meta.id));
    // Before the start a seat is kept only while its player is here; after the start the list stays as it is.
    const seats = this.meta.s ? [...this.meta.m] : this.meta.m.filter((id) => id === mine || here.has(id));
    if (!this.meta.s) {
      for (const meta of this.present) {
        if (seats.length >= MAX_PLAYERS) break;
        if (meta.id !== mine && !meta.h && !seats.includes(meta.id)) {
          seats.push(meta.id);
          // The host pins a player's key when it seats them.
          if (meta.k && !this.pins.has(meta.id)) this.pins.set(meta.id, meta.k);
        }
      }
    }
    const keys = seats.map((id) => this.pins.get(id) ?? '');
    if (seats.join() !== this.meta.m.join() || keys.join() !== this.meta.mk.join()) {
      this.meta = { ...this.meta, m: seats, mk: keys };
      this.publish();
    }
    return seats.map((id) => (id === mine ? this.meta : this.present.find((meta) => meta.id === id))).filter((meta): meta is Meta => !!meta);
  }

  private reconcile(): void {
    const mine = this.meta.id;
    // A joiner that is still waiting for its seat.
    if (this.phase === 'connecting' && this.settled && !this.isHost) {
      const host = this.hostMeta();
      if (host && this.listedIn(host)) this.admission?.('ok');
      else if (host?.s) this.admission?.('started'); // the host started without us: the seats are frozen
      else if (host && host.m.length >= MAX_PLAYERS) this.admission?.('full');
      return;
    }
    if (this.phase !== 'lobby' && this.phase !== 'playing') return;
    // The host has started the mission: that is how a friend learns of it.
    if (this.phase === 'lobby' && !this.isHost) {
      const started = this.hostMeta();
      if (started?.p && this.listedIn(started)) {
        this.startPayload = started.p;
        this.phase = 'playing';
        this.meta = { ...this.meta, s: true };
        this.publish();
        this.emit();
        this.onStart?.(started.p);
        return;
      }
    }
    const lobby = this.phase === 'lobby';
    const host = this.hostMeta();
    let admitted: Meta[] | null;
    if (!lobby) {
      // After the start only the players of the lobby are in the room; a late visitor is not added.
      admitted = this.present.filter((meta) => this.roster.has(meta.id));
    } else if (this.isHost) {
      admitted = this.seat();
    } else if (host) {
      if (!this.listedIn(host)) {
        // The host dropped us from the list (a blink, or no seat left), or started without us.
        if (host.s) this.fail('started');
        else if (host.m.length >= MAX_PLAYERS) this.fail('full');
        return;
      }
      admitted = host.m.map((id) => this.present.find((meta) => meta.id === id)).filter((meta): meta is Meta => !!meta);
    } else {
      admitted = null; // the host is out of sight: keep the list as it is
    }
    const ids = new Set((admitted ?? []).map((meta) => meta.id));
    let arrived = false;
    for (const meta of admitted ?? []) {
      const known = this.roster.get(meta.id);
      if (!known || !known.here) arrived = arrived || meta.id !== mine;
      this.roster.set(meta.id, {
        id: meta.id,
        name: meta.n,
        suit: meta.c,
        ready: meta.r,
        host: meta.id === this.hostId,
        me: meta.id === mine,
        here: true,
        status: known?.status ?? null,
        finished: known?.finished ?? false,
      });
    }
    if (admitted) {
      for (const [id, player] of [...this.roster]) {
        if (ids.has(id)) continue;
        if (lobby) this.roster.delete(id);
        else player.here = false;
      }
    }
    if (!this.roster.has(mine)) this.roster.set(mine, this.selfPlayer());

    if (lobby) {
      // Same crew name as somebody who came before: take another one.
      const index = (admitted ?? []).findIndex((meta) => meta.id === mine);
      const earlier = index > 0 ? (admitted ?? []).slice(0, index) : [];
      if (earlier.some((meta) => meta.n === this.meta.n)) {
        const taken = (admitted ?? []).filter((meta) => meta.id !== mine).map((meta) => meta.n);
        this.meta = { ...this.meta, n: freeName(taken, this.meta.n) };
        this.publish();
      }
      // The host is gone before the start: the room closes (after a short wait, in case it was a blink).
      if (this.hostId && !this.isHost && !host) {
        if (!this.hostGoneTimer) {
          this.hostGoneTimer = setTimeout(() => {
            this.hostGoneTimer = 0;
            if (this.phase === 'lobby' && !this.hostMeta()) this.fail('hostLeft');
          }, this.hostGoneMs);
        }
      } else if (this.hostGoneTimer) {
        clearTimeout(this.hostGoneTimer);
        this.hostGoneTimer = 0;
      }
    }
    if (arrived && this.phase === 'playing') this.shareAgain();
    this.emit();
  }

  private selfPlayer(): Player {
    return {
      id: this.meta.id,
      name: this.meta.n,
      suit: this.meta.c,
      ready: this.meta.r,
      host: this.meta.id === this.hostId,
      me: true,
      here: true,
      status: this.latestStatus,
      finished: this.finalStatus !== null,
    };
  }

  private onStatus(token: number, state: 'online' | 'offline'): void {
    if (token !== this.token) return;
    this.online = state === 'online';
    if (this.online && this.settled) {
      this.publish();
      if (this.phase === 'playing') this.shareAgain();
    }
    this.emit();
  }

  /** Somebody new (or back from a lost connection): tell them how we are doing (within the sending limits). */
  private shareAgain(): void {
    this.lastStatusJson = '';
    if (this.finalStatus) {
      const now = this.now();
      if (now - this.lastFinalAt >= STATUS_MIN_MS) {
        this.lastFinalAt = now;
        this.out('final', statusToWire(this.meta.id, this.finalStatus));
      }
    } else if (this.latestStatus) {
      this.queueStatus();
    }
  }

  // ----- The lobby ----------------------------------------------------------------

  setReady(ready: boolean): void {
    if (this.phase !== 'lobby' || this.meta.r === ready) return;
    this.meta = { ...this.meta, r: ready };
    this.publish();
    this.reconcile();
  }

  /** Every player here sent the same protocol version as ours. */
  private versionsMatch(): boolean {
    for (const player of this.roster.values()) {
      if (!player.here || player.me) continue;
      if (this.present.find((meta) => meta.id === player.id)?.v !== this.meta.v) return false;
    }
    return true;
  }

  /** The host can start when there are at least two players here, all ready and all on the same version. */
  canStart(): boolean {
    if (this.phase !== 'lobby' || this.meta.id !== this.hostId) return false;
    const here = [...this.roster.values()].filter((player) => player.here);
    return here.length >= 2 && here.every((player) => player.host || player.ready) && this.versionsMatch();
  }

  /** Start the mission for everybody. Only the host, only once. `mode`: each their own base, or one base together. */
  start(choice: CrewChoice, seed: number, startDate: string, mode: GameMode = 'race'): boolean {
    if (!this.canStart()) return false;
    const payload = parseStart({ mode, choice, seed, startDate });
    if (!payload) return false;
    this.startPayload = payload;
    this.phase = 'playing';
    this.meta = { ...this.meta, s: true, r: true, p: payload };
    this.publish();
    this.reconcile();
    this.onStart?.(payload);
    return true;
  }

  // ----- Sending --------------------------------------------------------------------

  /** The numbers of this outpost. At most twice a second; the newest numbers always go out in the end. */
  sendStatus(status: Status): void {
    if (this.phase !== 'playing' || this.finalStatus) return;
    this.latestStatus = status;
    const own = this.roster.get(this.meta.id);
    if (own) own.status = status;
    this.queueStatus();
    this.emit();
  }

  /** Send the newest status now if the last one is old enough, otherwise when it is. */
  private queueStatus(): void {
    const wait = this.lastStatusAt + STATUS_MIN_MS - this.now();
    if (wait <= 0) this.pushStatus();
    else if (!this.statusTimer) {
      this.statusTimer = setTimeout(() => {
        this.statusTimer = 0;
        this.pushStatus();
      }, wait);
    }
  }

  private pushStatus(): void {
    const status = this.latestStatus;
    if (!status || this.finalStatus) return;
    const json = JSON.stringify(status);
    if (json === this.lastStatusJson) return;
    this.lastStatusJson = json;
    this.lastStatusAt = this.now();
    this.out('status', statusToWire(this.meta.id, status));
  }

  /** The mission is over: send the final numbers, once. */
  sendFinal(status: Status): void {
    if (this.phase !== 'playing' || this.finalStatus) return;
    clearTimeout(this.statusTimer);
    this.statusTimer = 0;
    this.finalStatus = status;
    this.latestStatus = status;
    const own = this.roster.get(this.meta.id);
    if (own) {
      own.status = status;
      own.finished = true;
    }
    this.out('final', statusToWire(this.meta.id, status));
    this.emit();
  }

  /** Send a sticker. Returns false (and sends nothing) when the last one was less than a second ago. */
  sendReaction(reaction: ReactionId): boolean {
    if (this.phase !== 'playing' && this.phase !== 'lobby') return false;
    const now = this.now();
    if (now - this.lastReactionAt < REACTION_MIN_MS) return false;
    this.lastReactionAt = now;
    this.out('react', wire(this.meta.id, { id: reaction }));
    return true;
  }

  /** Where this player walks (at most 5 times a second). */
  sendPosition(position: Position): boolean {
    if (this.phase !== 'playing') return false;
    const now = this.now();
    if (now - this.lastPosAt < POSITION_MIN_MS - 1) return false;
    this.lastPosAt = now;
    this.out('pos', wire(this.meta.id, { ...position }));
    return true;
  }

  /**
   * Send a shared-base message. The commander sends `st` and `rec`, a guest `int` and `sync`; anything else, a message
   * that is too big, or any call outside a co-op mission sends nothing. The body is sent as it is (coopwire.ts builds it);
   * `from` is always this player. Rate limits are the session's job (src/net/coop.ts).
   */
  sendCoop(event: CoopEventName, body: Record<string, unknown>): boolean {
    if (this.phase !== 'playing' || this.startPayload?.mode !== 'coop') return false;
    if ((event === 'st' || event === 'rec') !== this.isHost) return false;
    const payload = { ...body, from: this.meta.id };
    let size: number;
    try {
      size = JSON.stringify(payload).length;
    } catch {
      return false;
    }
    if (size > sizeLimit(event)) return false;
    return this.out(event, payload);
  }

  // ----- Signing and sending -------------------------------------------------------------

  /** This visit's key pair, made once per room object (so once per visit). */
  private makeIdentity(): Maybe<Identity> {
    if (this.identity) return this.identity;
    const made = this.crypto.generate();
    if (isPromise(made)) return made.then((identity) => (this.identity = identity));
    return (this.identity = made);
  }

  /**
   * Show the others our presence entry. The host's entry carries its signature over the decisions in it (`g`); it is
   * never published without one that matches what it says. Goes through the outbox, so it keeps its place among the
   * messages while a signature is made.
   */
  private publish(): void {
    const identity = this.identity;
    if (!this.transport || !identity) return;
    const token = this.token;
    const meta = this.meta;
    this.outbox.push(() => {
      if (token !== this.token) return;
      if (!meta.h) {
        this.transport?.track(metaOnWire(meta));
        return;
      }
      const done = (g: string): void => {
        if (token === this.token) this.transport?.track(metaOnWire({ ...meta, g }));
      };
      const signed = identity.sign(presenceText(this.code, meta));
      return isPromise(signed) ? signed.then(done, () => undefined) : done(signed);
    });
  }

  /**
   * Sign one message and send it. The message gets our id and the next counter, and the signature covers the room, the
   * event and all of it. The signing may take a moment (Web Crypto); the outbox keeps the order of the calls.
   * Returns false when nothing was queued.
   */
  private out(event: string, body: Record<string, unknown>): boolean {
    const identity = this.identity;
    const token = this.token;
    const transport = this.transport;
    if (!identity || !transport) return false;
    let plain: Record<string, unknown>;
    try {
      // The same plain data the other side will read back from the network.
      plain = JSON.parse(JSON.stringify({ ...body, from: this.meta.id, q: this.counter + 1 })) as Record<string, unknown>;
    } catch {
      return false;
    }
    const text = messageText(this.code, event, plain);
    // The final numbers are the one message that still goes out when the room is left right after (cleanup keeps it).
    const lastWord = event === 'final';
    const queued = this.outbox.push(
      () => {
        if (token !== this.token && !lastWord) return;
        const send = (sig: string): void => {
          if (token === this.token || lastWord) transport.send(event, { ...plain, sig });
        };
        const signed = identity.sign(text);
        return isPromise(signed) ? signed.then(send, () => undefined) : send(signed);
      },
      { tag: lastWord ? 'final' : '' },
    );
    if (queued) this.counter++;
    return queued;
  }

  // ----- Receiving ---------------------------------------------------------------------

  private allowed(from: string, event: string): boolean {
    const now = this.now();
    const key = `${from}:${event}`;
    const recent = (this.seen.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
    if (recent.length >= (INBOUND_LIMIT[event] ?? 4)) {
      this.seen.set(key, recent);
      return false;
    }
    recent.push(now);
    this.seen.set(key, recent);
    return true;
  }

  /** Who may send this shared-base message to us: state and records only from the commander (to the guests), intents and resync requests only to the commander. */
  private mayReceive(event: string, from: string): boolean {
    if (!isCoopEvent(event)) return true;
    if (this.phase !== 'playing' || this.startPayload?.mode !== 'coop') return false;
    if (event === 'st' || event === 'rec') return !this.isHost && from === this.hostId;
    return this.isHost;
  }

  /**
   * One message from the network, inside the ordered inbox. The order of the checks matters: the cheap ones first (size,
   * who the sender is, whether we hold a key for it), then the signature, and only then the counter and the rate budget,
   * so a stranger who writes in a friend's name can neither use up the friend's budget nor push the friend's counter up.
   */
  /** Does the signature of this frame match `key`? False for anything that is not a well-formed signed frame. */
  private checkSignature(event: string, payload: unknown, key: string): Maybe<boolean> {
    if (!isRecord(payload) || !(EVENT_NAMES as readonly string[]).includes(event)) return false;
    const { sig, q, ...body } = payload;
    if (!isSignature(sig) || typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > COUNTER_MAX) return false;
    try {
      // Too big a frame is never checked (the size is looked at before the signature, as in takeMessage).
      if (JSON.stringify(payload).length > sizeLimit(event) + SIG_OVERHEAD) return false;
    } catch {
      return false;
    }
    try {
      const result = this.crypto.verify(key, messageText(this.code, event, { ...body, q }), sig);
      return isPromise(result) ? result.then((good) => good === true, () => false) : result === true;
    } catch {
      return false;
    }
  }

  private takeMessage(token: number, event: string, payload: unknown, early: { key: string; result?: Maybe<boolean> } | null = null): Maybe<void> {
    if (token !== this.token || (this.phase !== 'lobby' && this.phase !== 'playing')) return;
    if (!(EVENT_NAMES as readonly string[]).includes(event) || !isRecord(payload)) return;
    const { sig, q, ...body } = payload;
    if (!isSignature(sig) || typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > COUNTER_MAX) return;
    let size: number;
    try {
      size = JSON.stringify(payload).length;
    } catch {
      return;
    }
    if (size > sizeLimit(event) + SIG_OVERHEAD) return;
    const from = playerId(body.from);
    if (from === null || from === this.meta.id) return;
    if (!this.pins.has(from)) {
      // Not on the host's list yet: a sticker is held only when it is signed with the key from the friend's own entry.
      // Whoever writes in a friend's name cannot sign it, so a forger cannot fill the holding places.
      const own = this.parkKey(event, from);
      if (own === null) return;
      if (own !== '') {
        const parkIt = (good: boolean): void => {
          if (good && token === this.token) this.park(event, payload, from);
        };
        const checked = this.checkSignature(event, payload, own);
        if (isPromise(checked)) return checked.then(parkIt, () => undefined);
        parkIt(checked);
        return;
      }
    }
    const sender = this.roster.get(from);
    if (!sender || !sender.here || !this.mayReceive(event, from)) return;
    // No pinned key for this id: nothing it says can be believed.
    const key = this.pins.get(from);
    if (!key) return;
    const accept = (good: boolean): void => {
      if (!good || token !== this.token) return;
      const slot = `${this.code}/${from}/${key}`;
      if (q <= (this.lastCounter.get(slot) ?? 0)) return; // a copy of an older message
      this.lastCounter.delete(slot);
      this.lastCounter.set(slot, q);
      if (this.lastCounter.size > COUNTERS_MAX) this.lastCounter.delete(this.lastCounter.keys().next().value as string);
      this.deliver(event, body, from);
    };
    const result = early && early.key === key && early.result !== undefined ? early.result : this.checkSignature(event, payload, key);
    if (isPromise(result)) return result.then(accept, () => undefined);
    accept(result);
  }

  /** A checked shared-base message (signature already verified): who it is from, who may send it, the rate, then every field. */
  private onCoopMessage(event: CoopEventName, payload: unknown): void {
    if (this.phase !== 'playing' || this.startPayload?.mode !== 'coop') return;
    const from = senderOf(payload);
    if (from === null || from === this.meta.id) return;
    const sender = this.roster.get(from);
    if (!sender || !sender.here) return;
    if (!this.mayReceive(event, from)) return;
    if (!this.allowed(from, event)) return;
    const incoming = parseCoopMessage(event, payload);
    if (!incoming || incoming.from !== from) return;
    this.onCoop?.(incoming, { ...sender });
  }

  /** A message whose signature checked out, from a player we know. The body is the payload without `sig` and `q`. */
  private deliver(event: string, body: Record<string, unknown>, from: string): void {
    if (this.phase !== 'lobby' && this.phase !== 'playing') return;
    const sender = this.roster.get(from);
    if (!sender || !sender.here || !this.mayReceive(event, from)) return;
    if (isCoopEvent(event)) {
      this.onCoopMessage(event, body);
      return;
    }
    const message = parseMessage(event, body);
    if (!message || message.from !== from) return;
    if (!this.allowed(from, message.event)) return;
    switch (message.event) {
      case 'status':
        if (this.phase !== 'playing' || sender.finished) return;
        sender.status = message.status;
        this.emit();
        return;
      case 'final':
        if (this.phase !== 'playing') return;
        sender.status = message.status;
        sender.finished = true;
        this.emit();
        return;
      case 'react':
        this.onReaction?.({ ...sender }, message.reaction);
        return;
      case 'pos':
        if (this.phase === 'playing') this.onPosition?.({ ...sender }, message.pos);
        return;
    }
  }
}
