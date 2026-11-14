/**
 * Signed crew messages: who sent it (docs/MULTIPLAYER.md, "Signed messages: who sent it").
 *
 * The channel has no accounts, so every message and every decision in a presence entry carries a signature.
 * This file holds the pieces that do not depend on a room:
 *  - the `CrewCrypto` interface a room is given (production: Web Crypto, ECDSA P-256; tests: a deterministic fake);
 *  - the exact text that is signed (a sorted-key serialisation, so key order and extra fields cannot matter);
 *  - `Ordered`, the queue that keeps arrival order while a check may finish later (it runs inline when the
 *    check is synchronous).
 * Nothing here knows about the network or the screen.
 */
import { PROTOCOL } from './protocol';

export type Maybe<T> = T | Promise<T>;

export function isPromise<T>(value: Maybe<T>): value is Promise<T> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

/** This visit's key pair, as the room sees it: the public half as text, and a way to sign. The private half is never visible. */
export interface Identity {
  /** The public key: the 65 bytes of the uncompressed P-256 point, base64url (87 characters). */
  publicKey: string;
  /** A signature over `data`: 64 bytes (r then s), base64url (86 characters). */
  sign(data: string): Maybe<string>;
}

export interface CrewCrypto {
  /** A new key pair for this visit. Rejects (or throws) when the device cannot sign: the crew cannot connect then. */
  generate(): Maybe<Identity>;
  /** True when `signature` is `publicKey`'s signature over `data`. Never rejects: bad input is simply false. */
  verify(publicKey: string, data: string, signature: string): Maybe<boolean>;
}

// ----- What is signed -------------------------------------------------------------------

/** A serialisation that does not depend on key order: keys sorted, undefined left out, non-finite numbers as null. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

/**
 * What a message signature covers: the wire version, the room code, the event, and the whole payload except the
 * signature (so the sender's id, its counter `q` and every field of the message). Moving a message to another room,
 * another event, another sender, another counter or other content changes this text.
 */
export function messageText(code: string, event: string, payload: Record<string, unknown>): string {
  return `fo-crew/${PROTOCOL}/${code}/${event}/${canonical(payload)}`;
}

/** The decisions of the host's presence entry: the start (`s`, `p`) and the seat list with each seated player's key. */
export interface PresenceDecision {
  id: string;
  v: number;
  k: string;
  s: boolean;
  p: unknown;
  m: readonly string[];
  mk: readonly string[];
}

export function presenceText(code: string, meta: PresenceDecision): string {
  const { id, v, k, s, p, m, mk } = meta;
  return `fo-crew/${PROTOCOL}/${code}/presence/${canonical({ id, h: true, v, k, s, p: p ?? null, m, mk })}`;
}

/** Extra characters a signed message has over its body: the counter `q` and the signature `sig`. */
export const SIG_OVERHEAD = 120;

// ----- Ordered work ------------------------------------------------------------------------

/** What a queued job may say about itself: the group it counts against, and a tag that survives a `clear`. */
export interface JobOptions {
  /** Jobs of one group wait at most `groupMax` at a time: a new one pushes out the oldest waiting job of its group. */
  group?: string;
  groupMax?: number;
  tag?: string;
  /**
   * Starts the job's check early, while it still waits its turn. It answers whether the job is worth running: a job that
   * is found bad leaves the queue at once (it frees its place); the order of the good ones does not change.
   */
  warm?: () => Maybe<boolean>;
}

interface Job {
  run: () => unknown;
  group: string;
  tag: string;
}

/**
 * A first-in, first-out queue of jobs. A job may finish later (it returns a promise); the next one starts only after it
 * has finished, so a slow check can never let a later message overtake an earlier one. A synchronous job (the test fake)
 * runs inline inside `push`, with no extra tick. A job that throws or rejects is skipped. At most `max` jobs wait. A group
 * has its own limit, so one noisy sender (or a forger writing in its name) cannot use up the room of everybody else.
 */
export class Ordered {
  private queue: Job[] = [];
  private busy = false;
  private warming = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly max: number) {}

  /** False when the queue is full (the job is dropped). Over a group limit the oldest waiting job of that group goes instead. */
  push(job: () => unknown, options: JobOptions = {}): boolean {
    const group = options.group ?? '';
    if (options.groupMax !== undefined) {
      let count = 0;
      for (const waiting of this.queue) if (waiting.group === group) count++;
      if (count >= options.groupMax) {
        const oldest = this.queue.findIndex((waiting) => waiting.group === group);
        if (oldest >= 0) this.queue.splice(oldest, 1);
      }
    }
    if (this.queue.length >= this.max) return false;
    const entry: Job = { run: job, group, tag: options.tag ?? '' };
    this.queue.push(entry);
    if (options.warm) this.warmUp(entry, options.warm);
    if (!this.busy) this.run();
    return true;
  }

  /**
   * At most this many early checks run at once. It is as big as the room's queue cap, so every waiting frame is checked
   * early: a flood of forged frames then drops out together, and cannot make the honest message behind it wait in line.
   */
  private static readonly WARM_MAX = 256;

  private warmUp(entry: Job, warm: () => Maybe<boolean>): void {
    if (this.warming >= Ordered.WARM_MAX) return;
    const drop = (): void => {
      const at = this.queue.indexOf(entry);
      if (at >= 0) this.queue.splice(at, 1);
    };
    let result: Maybe<boolean>;
    try {
      result = warm();
    } catch {
      return;
    }
    if (!isPromise(result)) {
      if (!result) drop();
      return;
    }
    this.warming++;
    result.then(
      (good) => {
        this.warming--;
        if (!good) drop();
      },
      () => {
        this.warming--;
      },
    );
  }

  /** Forget the jobs that have not started (except the ones `keep` says yes to, by tag). */
  clear(keep?: (tag: string) => boolean): void {
    this.queue = keep ? this.queue.filter((job) => keep(job.tag)) : [];
  }

  /** Nothing is running and nothing waits. */
  get idle(): boolean {
    return !this.busy && this.queue.length === 0;
  }

  /** Call `done` once the queue is idle (at once when it is). */
  whenIdle(done: () => void): void {
    if (this.idle) done();
    else this.idleWaiters.push(done);
  }

  private run(): void {
    this.busy = true;
    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      let result: unknown;
      try {
        result = job.run();
      } catch {
        continue;
      }
      if (isPromise(result as Maybe<unknown>)) {
        const resume = (): void => this.run();
        (result as Promise<unknown>).then(resume, resume);
        return;
      }
    }
    this.busy = false;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const done of waiters) done();
  }
}

// ----- Web Crypto (production) ---------------------------------------------------------------

const KEY_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_ALGORITHM = { name: 'ECDSA', hash: 'SHA-256' } as const;

function toBase64Url(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const plain = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(plain + '='.repeat((4 - (plain.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const utf8 = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

function subtleCrypto(): SubtleCrypto | null {
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  return crypto && crypto.subtle ? crypto.subtle : null;
}

/** True when this page can sign (Web Crypto is only there on https pages and on localhost). */
export function canSign(): boolean {
  return subtleCrypto() !== null;
}

const importedKeys = new Map<string, Promise<CryptoKey>>();

function importKey(subtle: SubtleCrypto, publicKey: string): Promise<CryptoKey> {
  let key = importedKeys.get(publicKey);
  if (!key) {
    if (importedKeys.size >= 64) importedKeys.clear();
    key = subtle.importKey('raw', fromBase64Url(publicKey), KEY_ALGORITHM, false, ['verify']);
    importedKeys.set(publicKey, key);
    // A key that cannot be read is not kept.
    key.catch(() => importedKeys.delete(publicKey));
  }
  return key;
}

/** The real thing: a key pair per visit, the private half not extractable. */
export const webCrypto: CrewCrypto = {
  async generate(): Promise<Identity> {
    const subtle = subtleCrypto();
    if (!subtle) throw new Error('no Web Crypto');
    const pair = await subtle.generateKey(KEY_ALGORITHM, false, ['sign', 'verify']);
    const publicKey = toBase64Url(new Uint8Array(await subtle.exportKey('raw', pair.publicKey)));
    return {
      publicKey,
      sign: async (data) => toBase64Url(new Uint8Array(await subtle.sign(SIGN_ALGORITHM, pair.privateKey, utf8(data)))),
    };
  },
  async verify(publicKey, data, signature): Promise<boolean> {
    try {
      const subtle = subtleCrypto();
      if (!subtle) return false;
      const key = await importKey(subtle, publicKey);
      return await subtle.verify(SIGN_ALGORITHM, key, fromBase64Url(signature), utf8(data));
    } catch {
      return false;
    }
  },
};

/**
 * The crypto a new room uses when it is not given one. Production never changes it. The tests' setup file puts a
 * deterministic synchronous fake here (tests/setup-crypto.ts), so a test that wants the real thing passes `webCrypto`.
 */
let defaultCrypto: CrewCrypto = webCrypto;

export function getCrewCrypto(): CrewCrypto {
  return defaultCrypto;
}

export function setCrewCrypto(next: CrewCrypto): void {
  defaultCrypto = next;
}
