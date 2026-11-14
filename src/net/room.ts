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
 *  - the shared-base messages (coopwire.ts) are only passed through: this room checks who may send them and that they
 *    are well formed, and hands them to `onCoop`; src/net/coop.ts (the session) decides what they mean. They are
 *    read only when the host started the mission in "coop" mode, so a race-mode room never looks at them.
 */
import { isCoopEvent, parseCoopMessage, senderOf } from './coopwire';
import type { CoopIncoming } from './coopwire';
import {
  MAX_PLAYERS,
  POSITION_MIN_MS,
  PROTOCOL,
  REACTION_MIN_MS,
  STATUS_MIN_MS,
  channelName,
  freeName,
  normalizeCode,
  parseMessage,
  parseMeta,
  parseStart,
  randomCode,
  seatOrder,
  sizeLimit,
  statusToWire,
  wire,
} from './protocol';
import type { CoopEventName, CrewChoice, GameMode, Meta, Position, ReactionId, StartPayload, Status } from './protocol';
import type { PresenceEntry, Transport, TransportHandlers } from './transport';

type Timer = ReturnType<typeof setTimeout> | 0;

export type Phase = 'idle' | 'connecting' | 'lobby' | 'playing' | 'closed' | 'failed';
export type Failure = 'offline' | 'noRoom' | 'full' | 'started' | 'hostLeft' | 'badCode';

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
}

/** Inbound limits: at most this many messages of a kind from one player in a 2 second window. */
const WINDOW_MS = 2000;
const INBOUND_LIMIT: Record<string, number> = { status: 8, final: 3, react: 3, pos: 16, st: 12, rec: 24, int: 24, sync: 3 };

export class CrewRoom {
  private transport: Transport | null = null;
  private token = 0;
  private listeners = new Set<(view: RoomView) => void>();
  private roster = new Map<string, Player>();
  private present: Meta[] = [];
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

  private freshMeta(host: boolean): Meta {
    this.isHost = host;
    return {
      id: this.options.me.id,
      n: this.options.me.name,
      c: this.options.me.suit,
      r: host,
      h: host,
      m: host ? [this.options.me.id] : [],
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
  }

  private cleanup(): void {
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
      try {
        transport.close();
      } catch {
        /* closing must never throw */
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

    const transport = this.makeTransport();
    this.transport = transport;
    const handlers: TransportHandlers = {
      presence: (list) => this.onPresence(token, list),
      message: (event, payload) => this.onMessage(token, event, payload),
      status: (state) => this.onStatus(token, state),
    };
    try {
      await transport.connect(channelName(code), this.meta.id, this.meta, handlers);
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
    this.hostId = host.id;
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

  private onPresence(token: number, list: PresenceEntry[]): void {
    if (token !== this.token) return;
    const byKey = new Map<string, { meta: Meta; json: string }[]>();
    for (const entry of list) {
      const meta = parseMeta(entry.meta);
      // A player can only speak for themselves: the id inside must be the id of the entry.
      if (!meta || meta.id !== entry.key) continue;
      const group = byKey.get(entry.key) ?? [];
      group.push({ meta, json: JSON.stringify(meta) });
      byKey.set(entry.key, group);
    }
    const metas: Meta[] = [];
    for (const group of byKey.values()) {
      // Two different entries under one key: somebody is speaking in another player's name. Believe neither.
      if (group.some((item) => item.json !== group[0].json)) continue;
      metas.push(group[0].meta);
    }
    this.present = metas.sort(seatOrder);
    if (this.settled) this.reconcile();
  }

  private hostMeta(): Meta | null {
    return this.present.find((meta) => meta.id === this.hostId) ?? null;
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
        if (meta.id !== mine && !meta.h && !seats.includes(meta.id)) seats.push(meta.id);
      }
    }
    if (seats.join() !== this.meta.m.join()) {
      this.meta = { ...this.meta, m: seats };
      this.transport?.track(this.meta);
    }
    return seats.map((id) => (id === mine ? this.meta : this.present.find((meta) => meta.id === id))).filter((meta): meta is Meta => !!meta);
  }

  private reconcile(): void {
    const mine = this.meta.id;
    // A joiner that is still waiting for its seat.
    if (this.phase === 'connecting' && this.settled && !this.isHost) {
      const host = this.hostMeta();
      if (host && host.m.includes(mine)) this.admission?.('ok');
      else if (host?.s) this.admission?.('started'); // the host started without us: the seats are frozen
      else if (host && host.m.length >= MAX_PLAYERS) this.admission?.('full');
      return;
    }
    if (this.phase !== 'lobby' && this.phase !== 'playing') return;
    // The host has started the mission: that is how a friend learns of it.
    if (this.phase === 'lobby' && !this.isHost) {
      const started = this.hostMeta();
      if (started?.p && started.m.includes(mine)) {
        this.startPayload = started.p;
        this.phase = 'playing';
        this.meta = { ...this.meta, s: true };
        this.transport?.track(this.meta);
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
      if (!host.m.includes(mine)) {
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
        this.transport?.track(this.meta);
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
      this.transport?.track(this.meta);
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
        this.transport?.send('final', statusToWire(this.meta.id, this.finalStatus));
      }
    } else if (this.latestStatus) {
      this.queueStatus();
    }
  }

  // ----- The lobby ----------------------------------------------------------------

  setReady(ready: boolean): void {
    if (this.phase !== 'lobby' || this.meta.r === ready) return;
    this.meta = { ...this.meta, r: ready };
    this.transport?.track(this.meta);
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
    this.transport?.track(this.meta);
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
    this.transport?.send('status', statusToWire(this.meta.id, status));
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
    this.transport?.send('final', statusToWire(this.meta.id, status));
    this.emit();
  }

  /** Send a sticker. Returns false (and sends nothing) when the last one was less than a second ago. */
  sendReaction(reaction: ReactionId): boolean {
    if (this.phase !== 'playing' && this.phase !== 'lobby') return false;
    const now = this.now();
    if (now - this.lastReactionAt < REACTION_MIN_MS) return false;
    this.lastReactionAt = now;
    this.transport?.send('react', wire(this.meta.id, { id: reaction }));
    return true;
  }

  /** Where this player walks (at most 5 times a second). */
  sendPosition(position: Position): boolean {
    if (this.phase !== 'playing') return false;
    const now = this.now();
    if (now - this.lastPosAt < POSITION_MIN_MS - 1) return false;
    this.lastPosAt = now;
    this.transport?.send('pos', wire(this.meta.id, { ...position }));
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
    this.transport?.send(event, payload);
    return true;
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

  private onCoopMessage(event: CoopEventName, payload: unknown): void {
    if (this.phase !== 'playing' || this.startPayload?.mode !== 'coop') return;
    const from = senderOf(payload);
    if (from === null || from === this.meta.id) return;
    const sender = this.roster.get(from);
    if (!sender || !sender.here) return;
    // State and records only from the commander (to the guests); intents and resync requests only to the commander.
    if (event === 'st' || event === 'rec') {
      if (this.isHost || from !== this.hostId) return;
    } else if (!this.isHost) {
      return;
    }
    if (!this.allowed(from, event)) return;
    const incoming = parseCoopMessage(event, payload);
    if (!incoming || incoming.from !== from) return;
    this.onCoop?.(incoming, { ...sender });
  }

  private onMessage(token: number, event: string, payload: unknown): void {
    if (token !== this.token || (this.phase !== 'lobby' && this.phase !== 'playing')) return;
    if (isCoopEvent(event)) {
      this.onCoopMessage(event, payload);
      return;
    }
    const message = parseMessage(event, payload);
    if (!message || message.from === this.meta.id) return;
    const sender = this.roster.get(message.from);
    if (!sender || !sender.here) return;
    if (!this.allowed(message.from, message.event)) return;
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

