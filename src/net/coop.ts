/**
 * Shared base ("One base together"): the session. One class for the commander (CoopHost), one for a guest (CoopGuest),
 * both over a CrewRoom that was started in "coop" mode. There is no director here: the host drives the pure reducer
 * of src/sim/coop.ts, a guest keeps a mirror of what the host says.
 *
 * What travels (the codec and the checks are in coopwire.ts, the room only passes the messages through):
 *   host -> all    `st`   the live state and the co-op meta (stage, rev, ready, votes ... and `acks`). Latest wins.
 *   host -> all    `rec`  one finished week, sent the moment it exists and again for a guest that asks.
 *   guest -> host  `int`  one intent with its own counter `n`.
 *   guest -> host  `sync` "I have `have` weeks of history; send me the state and what I miss".
 *
 * How a lost message is made up for (the network may lose any of them):
 *  - Intents go one at a time. A guest sends the next one only when an `st` has acknowledged the last (`acks[me] >= n`),
 *    and sends the last again every 1.5 s until then. This is needed because the reducer treats a counter that is not
 *    higher than the last one it saw as a copy: a lost n=1 could never be repeated after n=2 was applied.
 *    A copy that reaches the host makes it send the state again, so the acknowledgement is not lost for long.
 *  - `st` is a snapshot, a lost one is harmless: every change sends a new one (at most 5 a second), and the host sends
 *    the last one again every 4 s (the heartbeat). A guest ignores a snapshot older than the one it has.
 *  - `rec` is filed in order; a guest that sees it has fewer weeks than the stage says sends `sync` (at most once a
 *    second) until it has them all. `sync` is also sent at the start (until the first `st` arrives) and when the
 *    connection comes back.
 *
 *  - An intent is never given up on by time: a walk result or a room win is worth keeping through a bad minute. It leaves the
 *    queue when the host acknowledges it, when its week or stage has passed, or when the session ends (a host that is gone
 *    for good ends in a detach). A guest checks an intent with the same reader the host uses before it queues it.
 *
 * Time: every deadline and timeout reads an injected clock (CoopClock), so a test runs a mission in a blink.
 *  - the host: a seat whose player has been out of the room for 5 s leaves the crew (sim/coop.ts coopLeave);
 *  - a guest: the host out of the room for 20 s means the guest detaches (the director then plays on alone, see
 *    docs/MULTIPLAYER.md); no snapshot for 15 s means `quiet` (the screen says "waiting for the commander").
 *
 * The network carries numbers and preset ids only; everything that arrives was rebuilt by coopwire.ts.
 */
import { coopApply, coopLeave, coopTick, parseIntent } from '../sim/coop';
import type { CoopMeta, CoopSim, CoopStage, Intent, IntentBody, Verdict } from '../sim/coop';
import type { MissionState } from '../sim/types';
import { adoptLive, adoptRecord, encodeIntent, encodeRecord, encodeSnapshot, encodeSync, missingRecords } from './coopwire';
import type { CoopIncoming } from './coopwire';
import type { CrewRoom, RoomView } from './room';

// ----- Numbers (GAME / network) ------------------------------------------------------------

export const COOP_NET = {
  /** How often the session looks at the clock. */
  tickMs: 100,
  /** The host sends the last state again after this long without sending one. */
  heartbeatMs: 4000,
  /** This many old snapshots in a row, over two heartbeats, and the guest follows the commander's numbers again. */
  behindCount: 3,
  /** The least time between two `st` (the receiving room takes 12 in 2 s). */
  stMinMs: 200,
  /** A guest sends an intent that is not acknowledged again after this long, then after 2x, 3x, 4x (the most). */
  retryMs: 1500,
  /** The least time between two `sync` from one guest (the receiving room takes 3 in 2 s). */
  syncMs: 1000,
  /** Weeks of history sent in one go. */
  recBatch: 6,
  /** Intents a guest may hold at once. */
  queueMax: 16,
  /** The host drops a seat this long after its player left the room. */
  guestGoneMs: 5000,
  /** A guest detaches this long after the commander left the room. */
  hostGraceMs: 20000,
  /** A guest says "waiting for the commander" after this long without a snapshot. */
  quietMs: 15000,
} as const;

// ----- The clock -------------------------------------------------------------------------

export interface CoopClock {
  /** Milliseconds, any origin, never goes back. */
  now(): number;
  /** Call `fn` every `ms`. Returns the way to stop. */
  every(ms: number, fn: () => void): () => void;
}

export const wallClock: CoopClock = {
  now: () => Date.now(),
  every(ms, fn) {
    const timer = setInterval(fn, ms);
    return () => clearInterval(timer);
  },
};

export type DetachReason = 'hostGone' | 'removed' | 'closed';

export interface CoopSessionOptions {
  clock?: CoopClock;
  /** The shared state or the meta changed (the director presents it). */
  onChange?: () => void;
  /** The session ended by itself. After this the session is disposed. */
  onDetach?: (reason: DetachReason) => void;
}

// ----- What both sides share -----------------------------------------------------------------

abstract class Session {
  protected readonly me: string;
  protected readonly clock: CoopClock;
  protected view: RoomView;
  protected online = true;
  protected closed = false;
  private cleanups: (() => void)[] = [];
  private readonly hook: (incoming: CoopIncoming) => void;

  constructor(
    protected readonly room: CrewRoom,
    protected readonly options: CoopSessionOptions,
  ) {
    this.me = room.view.me;
    this.view = room.view;
    this.clock = options.clock ?? wallClock;
    this.hook = (incoming) => {
      if (!this.closed) this.receive(incoming);
    };
  }

  /** Called by the subclass when its own fields are ready. */
  protected attach(): void {
    this.room.onCoop = this.hook;
    this.cleanups.push(this.room.subscribe((view) => this.watch(view)));
    this.cleanups.push(this.clock.every(COOP_NET.tickMs, () => !this.closed && this.step()));
    this.watch(this.room.view);
  }

  private watch(view: RoomView): void {
    if (this.closed) return;
    const wasOnline = this.online;
    this.view = view;
    this.online = view.online;
    if (view.phase !== 'playing') {
      this.detach('closed');
      return;
    }
    this.seen(view, wasOnline);
  }

  protected changed(): void {
    this.options.onChange?.();
  }

  /** End the session by itself: stop everything, then tell the director once. */
  protected detach(reason: DetachReason): void {
    if (this.closed) return;
    this.dispose();
    this.options.onDetach?.(reason);
  }

  /** Stop the clock, the room hooks and the sending. Safe to call twice. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const stop of this.cleanups.splice(0)) stop();
    if (this.room.onCoop === this.hook) this.room.onCoop = null;
  }

  get active(): boolean {
    return !this.closed;
  }

  protected player(id: string | null): { here: boolean } | null {
    return this.view.players.find((player) => player.id === id) ?? null;
  }

  protected abstract receive(incoming: CoopIncoming): void;
  protected abstract step(): void;
  protected abstract seen(view: RoomView, wasOnline: boolean): void;
}

// ----- The commander ----------------------------------------------------------------------

export interface HostStats {
  /** What became of the intents that reached the host (and its own). */
  verdicts: Record<Verdict, number>;
  st: number;
  rec: number;
  syncs: number;
  beats: number;
  left: string[];
}

export class CoopHost extends Session {
  readonly stats: HostStats = { verdicts: { ok: 0, dup: 0, stale: 0, denied: 0, unknown: 0 }, st: 0, rec: 0, syncs: 0, beats: 0, left: [] };
  private n = 0;
  /** Weeks of history already sent as `rec`. */
  private sentRecs = 0;
  private lastSt = -Infinity;
  private lastBeat: number;
  private dirty = true;
  private away = new Map<string, number>();
  private lastSync = new Map<string, number>();

  constructor(
    room: CrewRoom,
    readonly co: CoopSim,
    options: CoopSessionOptions = {},
  ) {
    super(room, options);
    if (co.host !== this.me) throw new Error('The commander seat is not this player');
    this.lastBeat = this.clock.now();
    this.attach();
    this.flush();
  }

  /** The commander's own intent (a button on the host's screen). Same rules as a guest's. Null when the session is over. */
  submit(body: IntentBody): Verdict | null {
    if (this.closed) return null;
    const intent = { from: this.me, n: ++this.n, w: this.co.mission.week, s: this.co.stage, ...body } as Intent;
    return this.apply(intent);
  }

  /** Seconds until the countdown of this stage ends, or null while nobody has answered. */
  secondsLeft(): number | null {
    return this.co.deadline === null ? null : Math.max(0, Math.ceil((this.co.deadline - this.clock.now()) / 1000));
  }

  private apply(intent: Intent): Verdict {
    const verdict = coopApply(this.co, intent, this.clock.now());
    this.stats.verdicts[verdict]++;
    // Any answer, a copy included, is worth a new state: the guest learns its intent was taken (`acks`).
    if (verdict !== 'unknown') this.touched(verdict === 'ok');
    return verdict;
  }

  private touched(real: boolean): void {
    this.dirty = true;
    this.flush();
    if (real) this.changed();
  }

  protected receive(incoming: CoopIncoming): void {
    if (incoming.event === 'int') {
      this.apply(incoming.intent);
    } else if (incoming.event === 'sync') {
      this.answerSync(incoming.from, incoming.have);
    }
  }

  private answerSync(from: string, have: number): void {
    if (!this.co.seats.includes(from)) return;
    const now = this.clock.now();
    if (now - (this.lastSync.get(from) ?? -Infinity) < COOP_NET.syncMs / 2) return;
    this.lastSync.set(from, now);
    this.stats.syncs++;
    const missing = missingRecords(this.co.mission, have).slice(0, COOP_NET.recBatch);
    for (const record of missing) {
      if (this.room.sendCoop('rec', encodeRecord(this.me, record))) this.stats.rec++;
    }
    this.dirty = true;
    this.flush();
  }

  /** Send what is due: new weeks first, then the state (at most one every stMinMs). */
  private flush(): void {
    const history = this.co.mission.history;
    let sent = 0;
    while (this.sentRecs < history.length && sent < COOP_NET.recBatch) {
      if (!this.room.sendCoop('rec', encodeRecord(this.me, history[this.sentRecs]))) break;
      this.sentRecs++;
      sent++;
      this.stats.rec++;
    }
    if (!this.dirty) return;
    const now = this.clock.now();
    if (now - this.lastSt < COOP_NET.stMinMs) return;
    if (this.room.sendCoop('st', encodeSnapshot(this.me, this.co, now))) {
      this.lastSt = now;
      this.lastBeat = now;
      this.dirty = false;
      this.stats.st++;
    }
  }

  protected step(): void {
    const now = this.clock.now();
    if (coopTick(this.co, now)) {
      this.dirty = true;
      this.changed();
    }
    for (const [id, since] of [...this.away]) {
      if (now - since < COOP_NET.guestGoneMs) continue;
      this.away.delete(id);
      if (coopLeave(this.co, id, now)) {
        this.stats.left.push(id);
        this.dirty = true;
        this.changed();
      }
    }
    if (now - this.lastBeat >= COOP_NET.heartbeatMs) {
      this.dirty = true;
      this.stats.beats++;
    }
    this.flush();
  }

  protected seen(view: RoomView, wasOnline: boolean): void {
    const now = this.clock.now();
    // While our own connection is down we cannot see anybody: nobody has left, and the 5 s start again once we are back.
    if (!view.online) {
      this.away.clear();
      return;
    }
    for (const id of this.co.seats) {
      if (id === this.me) continue;
      const here = this.player(id)?.here ?? false;
      if (here) this.away.delete(id);
      else if (!this.away.has(id)) this.away.set(id, now);
    }
    // Back after a lost connection: say where we are at once.
    if (view.online && !wasOnline) {
      this.dirty = true;
      this.lastSt = -Infinity;
      this.flush();
    }
  }
}

// ----- A guest ------------------------------------------------------------------------------

interface Pending {
  intent: Intent;
  /** When it was last sent; null while it waits for the one before it. */
  last: number | null;
  /** How many times it was sent again. */
  tries: number;
}

export interface GuestStats {
  adopted: number;
  /** Snapshots that were older than the one the guest had. */
  old: number;
  /** Snapshots the checks let through but the mission could not take. */
  refused: number;
  recs: number;
  syncs: number;
  sent: number;
  retries: number;
  dropped: number;
}

/** Kinds where a newer one replaces an older one that has not left yet. */
const REPLACES: readonly string[] = ['ready', 'vote', 'walk', 'alloc', 'safe'];
/** Kinds the host takes in any work stage (sim/coop.ts), by day only. */
const FREE_KINDS: readonly string[] = ['build', 'craft', 'room'];
const WORK_STAGES: readonly CoopStage[] = ['briefing', 'event', 'eventResult', 'plan', 'walk'];

export class CoopGuest extends Session {
  readonly stats: GuestStats = { adopted: 0, old: 0, refused: 0, recs: 0, syncs: 0, sent: 0, retries: 0, dropped: 0 };
  /** What the host last said about the crew. Null until the first snapshot. */
  meta: CoopMeta | null = null;
  private rev = -1;
  private at = 0;
  private lastSt: number;
  private counter = 0;
  private queue: Pending[] = [];
  private lastSync = -Infinity;
  private hostAway: number | null = null;
  private wasQuiet = false;
  /** A run of snapshots that are all older than the one held (see `take`). */
  private behind: { since: number; last: number; count: number } | null = null;

  constructor(
    room: CrewRoom,
    /** This device's own mission. Its config and plan are its own; the live part is replaced by the host's. */
    readonly mission: MissionState,
    options: CoopSessionOptions = {},
  ) {
    super(room, options);
    this.lastSt = this.clock.now();
    this.attach();
    this.askSync();
  }

  /** The host's snapshot is old: nothing has come for a while ("Waiting for the commander"). */
  get quiet(): boolean {
    return this.meta !== null && this.clock.now() - this.lastSt >= COOP_NET.quietMs;
  }

  /** How long nothing has come from the host (ms); 0 before the first state. The screen offers "play on alone" from 45 s. */
  get silentMs(): number {
    return this.meta === null ? 0 : this.clock.now() - this.lastSt;
  }

  /** Seconds until the countdown ends, counted down from the moment the snapshot came. Null while nobody has answered. */
  secondsLeft(): number | null {
    if (!this.meta || this.meta.left === null) return null;
    return Math.max(0, Math.ceil(this.meta.left - (this.clock.now() - this.at) / 1000));
  }

  /** Intents on their way (sent and not yet acknowledged, or waiting). */
  get pending(): number {
    return this.queue.length;
  }

  /** Weeks of history this device lacks. */
  get missing(): number {
    return this.meta ? Math.max(0, expectedWeeks(this.meta) - this.mission.history.length) : 0;
  }

  /**
   * Send an intent, stamped with the week and stage this device is showing. Returns its counter,
   * or null when nothing can be sent (no state from the host yet, session over, queue full).
   */
  submit(body: IntentBody): number | null {
    if (this.closed || !this.meta) return null;
    if (REPLACES.includes(body.k)) {
      // A waiting one of the same kind is replaced; one that is already on its way stays.
      this.queue = this.queue.filter((entry) => entry.last !== null || entry.intent.k !== body.k);
    }
    if (this.queue.length >= COOP_NET.queueMax) return null;
    const intent = { from: this.me, n: this.counter + 1, w: this.meta.week, s: this.meta.stage, ...body } as Intent;
    // A Ready on the plan says which plan it was made on, so the commander can refuse it after the plan changed.
    if (intent.k === 'ready' && intent.on && intent.s === 'plan' && !intent.a) intent.a = { ...this.mission.alloc };
    // Only what the host's reader accepts goes into the queue (one it refuses would never be acknowledged).
    if (parseIntent(JSON.parse(JSON.stringify(encodeIntent(intent)))) === null) return null;
    this.counter++;
    this.queue.push({ intent, last: null, tries: 0 });
    this.pump();
    return intent.n;
  }

  protected receive(incoming: CoopIncoming): void {
    if (incoming.event === 'st') this.take(incoming.snap.meta, incoming.snap.live);
    else if (incoming.event === 'rec') {
      if (adoptRecord(this.mission, incoming.rec)) {
        this.stats.recs++;
        this.changed();
      }
    }
  }

  private take(meta: CoopMeta, live: Parameters<typeof adoptLive>[1]): void {
    if (meta.rev < this.rev) {
      this.stats.old++;
      // A reordered or late snapshot is a single old one. When only old ones keep coming, in order, for a while, the
      // revision we hold was not the commander's (a forged number far ahead would freeze this child's screen for good).
      const now = this.clock.now();
      const run = this.behind;
      if (!run || meta.rev < run.last) this.behind = { since: now, last: meta.rev, count: 1 };
      else {
        run.last = meta.rev;
        run.count++;
      }
      const held = this.behind!;
      if (held.count < COOP_NET.behindCount || now - held.since < COOP_NET.heartbeatMs * 2) return;
    }
    this.behind = null;
    if (!meta.seats.includes(this.me)) {
      // The host no longer counts us in (it let us go after a silence).
      this.detach('removed');
      return;
    }
    if (!adoptLive(this.mission, live)) {
      this.stats.refused++;
      return;
    }
    const now = this.clock.now();
    this.meta = meta;
    this.rev = meta.rev;
    this.at = now;
    this.lastSt = now;
    this.stats.adopted++;
    this.settleQueue();
    this.changed();
    if (this.missing > 0) this.askSync();
  }

  /** Forget intents the host has acknowledged and intents meant for a stage that has passed; send the next one. */
  private settleQueue(): void {
    const meta = this.meta;
    if (!meta) return;
    const acked = meta.acks[this.me] ?? 0;
    const kept = this.queue.filter((entry) => {
      const { intent } = entry;
      if (intent.n <= acked || intent.w !== meta.week) return false;
      if (FREE_KINDS.includes(intent.k)) {
        // Build, craft and a room win are good in any work stage: stamp them with the stage they go out in.
        if (!WORK_STAGES.includes(meta.stage)) return false;
        intent.s = meta.stage;
        return true;
      }
      return intent.s === meta.stage;
    });
    this.stats.dropped += this.queue.filter((entry) => entry.intent.n > acked).length - kept.length;
    this.queue = kept;
    this.pump();
  }

  /** Send the first intent in the queue if it has not been sent yet. One at a time (see the top of this file). */
  private pump(): void {
    const head = this.queue[0];
    if (!head || head.last !== null) return;
    this.sendHead(head);
  }

  private sendHead(head: Pending): void {
    if (!this.room.sendCoop('int', encodeIntent(head.intent))) return;
    const now = this.clock.now();
    head.last = now;
    this.stats.sent++;
  }

  private askSync(): void {
    const now = this.clock.now();
    if (now - this.lastSync < COOP_NET.syncMs) return;
    if (this.room.sendCoop('sync', encodeSync(this.me, this.mission.history.length))) {
      this.lastSync = now;
      this.stats.syncs++;
    }
  }

  protected step(): void {
    const now = this.clock.now();
    const head = this.queue[0];
    if (head && head.last !== null) {
      if (now - head.last >= COOP_NET.retryMs * Math.min(1 + head.tries, 4)) {
        head.tries++;
        this.stats.retries++;
        this.sendHead(head);
      }
    } else if (head) {
      this.pump();
    }
    if (this.meta === null || this.missing > 0) this.askSync();
    if (this.hostAway !== null && now - this.hostAway >= COOP_NET.hostGraceMs) {
      this.detach('hostGone');
      return;
    }
    const quiet = this.quiet;
    if (quiet !== this.wasQuiet) {
      this.wasQuiet = quiet;
      this.changed();
    }
  }

  protected seen(view: RoomView, wasOnline: boolean): void {
    // We cannot see anybody while our own connection is down, so a silent host proves nothing then.
    const host = this.player(view.hostId);
    const gone = view.online && (!host || !host.here);
    if (!gone) this.hostAway = null;
    else if (this.hostAway === null) this.hostAway = this.clock.now();
    if (view.online && !wasOnline) {
      // Back after a lost connection: ask for the state and for what we missed.
      this.lastSync = -Infinity;
      this.askSync();
      const head = this.queue[0];
      if (head && head.last !== null) this.sendHead(head);
    }
  }
}

/** Weeks of history a device must have for this state: the week's own record exists from the night on. */
export function expectedWeeks(meta: CoopMeta): number {
  return meta.stage === 'report' || meta.stage === 'end' ? meta.week : meta.week - 1;
}
