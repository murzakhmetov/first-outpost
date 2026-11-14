import { useEffect, useState } from 'preact/hooks';

/** How many times a part of the game is downloaded again before the caller is told it failed. */
const TRIES = 3;

/**
 * Load a part of the game (the room games, the printer) only when it is first needed, so the first
 * start downloads less. Returns null until it has arrived. A failed download is tried again after a
 * moment (a weak connection often succeeds the second time); after the last try `onFail` lets the
 * caller let go, so the next time loads again from the start.
 * Offline, the service worker already holds every file, so the load is instant.
 * `token` changes (a new request for the part) give it a fresh set of tries.
 */
export function useLoaded<T>(load: () => Promise<T>, needed: boolean, onFail?: () => void, token?: unknown): T | null {
  const [loaded, setLoaded] = useState<T | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Fresh tries for a new request, or after the part was not needed for a while.
  useEffect(() => setAttempt(0), [needed, token]);
  useEffect(() => {
    if (!needed || loaded) return undefined;
    let alive = true;
    let timer = 0;
    load().then(
      // (wrapped in a function: a component is itself a function, and the setter would call it)
      (value) => alive && setLoaded(() => value),
      (error: unknown) => {
        console.warn('First Outpost: a part of the game could not be loaded.', error);
        if (!alive) return;
        if (attempt + 1 < TRIES) timer = window.setTimeout(() => setAttempt(attempt + 1), 2500);
        else onFail?.(); // (no new try until `needed` or `token` changes)
      },
    );
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [needed, loaded, attempt]);
  return loaded;
}
