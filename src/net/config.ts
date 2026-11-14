/**
 * Where crew mode talks. The address and the public key come from the build settings
 * (VITE_MP_URL, VITE_MP_KEY); the defaults point to the project's Supabase Realtime.
 * The key is a "publishable" key: it is made to be public and can only open a broadcast channel.
 * An empty value switches crew mode off (the button disappears).
 */
const DEFAULT_URL = 'wss://wvhdhfddtusppjmsgmvn.supabase.co/realtime/v1';
const DEFAULT_KEY = 'sb_publishable_rHDFfoFz_v9zDNKk9o64Gw_Pc-eZvln';

export interface NetConfig {
  url: string;
  key: string;
}

type Env = Record<string, string | undefined>;

/** Settings of the network, or null when crew mode is switched off. */
export function netConfig(env: Env = (import.meta as unknown as { env?: Env }).env ?? {}): NetConfig | null {
  // "??" and not "||": an empty string is a deliberate "off".
  const url = (env.VITE_MP_URL ?? DEFAULT_URL).trim();
  const key = (env.VITE_MP_KEY ?? DEFAULT_KEY).trim();
  if (!url || !key) return null;
  return { url, key };
}

export type TransportKind = 'supabase' | 'local';

/** The flag `?crew=local` (for developers): two tabs of one browser play together, with no network. */
export function transportKind(search: string = typeof location === 'undefined' ? '' : location.search): TransportKind | null {
  if (/[?&]crew=local(&|$)/.test(search)) return 'local';
  return netConfig() ? 'supabase' : null;
}

/**
 * Kill switch of the shared base ("One base together"). The lobby shows the choice only when this is true:
 * `?coop=1` in the address, the build setting VITE_COOP=1, or this constant. It is false until the real-device pass is done.
 */
export const COOP_DEFAULT_VISIBLE = false;

export function coopVisible(
  search: string = typeof location === 'undefined' ? '' : location.search,
  env: Env = (import.meta as unknown as { env?: Env }).env ?? {},
): boolean {
  if (COOP_DEFAULT_VISIBLE) return true;
  if (env.VITE_COOP === '1') return true;
  return /[?&]coop=1(&|$)/.test(search);
}
