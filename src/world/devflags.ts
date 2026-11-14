/**
 * Dev A/B switches for graphics effects. In production the object stays empty, so every flag is
 * true. In development `window.gfxlab.set(id, false)` turns an effect off, and the effect reads
 * `flag(id)` while drawing, so a shot with the effect off and one with it on show the SAME frame.
 */
export const devFlags: Record<string, boolean> = {};

/** Ids that were asked for so far (development only: lets `gfxlab.flags()` list the switches). */
export const knownFlags = new Set<string>();

/** True unless a dev tool switched this effect off. Cheap enough to call every frame. */
export function flag(id: string): boolean {
  if (import.meta.env.DEV) knownFlags.add(id);
  return devFlags[id] !== false;
}
