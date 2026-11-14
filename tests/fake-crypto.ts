/**
 * A deterministic, synchronous stand-in for Web Crypto, for tests (src/net/sign.ts is the real thing).
 *
 * It is not strong, but it is not a rubber stamp either: a public key reveals nothing about its secret, a signature
 * depends on the secret and on every character of the signed text, and `verify` accepts only the signature the secret of
 * that very public key makes. A hand-made client that generates its own key pair gets its own identity and cannot sign
 * for anyone else. It is synchronous so that the tick-then-assert tests of the rig see no extra tick.
 * The real Web Crypto path is tested in tests/sign.test.ts.
 */
import type { CrewCrypto, Identity } from '../src/net/sign';

const secrets = new Map<string, string>();
let made = 0;

function lane(text: string, seed: number): number {
  let h = (0x811c9dc5 ^ Math.imul(seed + 1, 0x9e3779b1)) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return h >>> 0;
}

/** `length` bytes that depend on every character of `text`. */
function bytes(text: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (lane(text, i >> 2) >>> ((i & 3) * 8)) & 255;
  return out;
}

function base64Url(data: Uint8Array): string {
  let text = '';
  for (const byte of data) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const tag = (secret: string, data: string): string => base64Url(bytes(`${secret}|${data}`, 64));

export const fakeCrypto: CrewCrypto = {
  generate(): Identity {
    const secret = `secret-${made++}`;
    const publicKey = base64Url(bytes(`public|${secret}`, 65));
    secrets.set(publicKey, secret);
    return { publicKey, sign: (data) => tag(secret, data) };
  },
  verify(publicKey, data, signature): boolean {
    const secret = secrets.get(publicKey);
    return secret !== undefined && tag(secret, data) === signature;
  },
};
