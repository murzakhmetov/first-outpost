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

/**
 * A first-in, first-out queue of jobs. A job may finish later (it returns a promise); the next one starts only after it
 * has finished, so a slow check can never let a later message overtake an earlier one. A synchronous job (the test fake)
 * runs inline inside `push`, with no extra tick. A job that throws or rejects is skipped. At most `max` jobs wait.
 */
export class Ordered {
  private queue: (() => unknown)[] = [];
  private busy = false;

  constructor(private readonly max: number) {}

  /** False when the queue is full (the job is dropped). */
  push(job: () => unknown): boolean {
    if (this.queue.length >= this.max) return false;
    this.queue.push(job);
    if (!this.busy) this.run();
    return true;
  }

  /** Forget the jobs that have not started. */
  clear(): void {
    this.queue.length = 0;
  }

  private run(): void {
    this.busy = true;
    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      let result: unknown;
      try {
        result = job();
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
