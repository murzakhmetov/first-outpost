/**
 * Small rules every room game shares, without any screen code.
 */

/** 1 = easy (the first weeks), 2 = middle, 3 = harder. */
export type Level = 1 | 2 | 3;
export type Site = 'mars' | 'moon';

/** Any value from the host becomes a level; a missing or odd one means the easiest. */
export function levelOf(level: unknown): Level {
  return level === 2 || level === 3 ? level : 1;
}

/**
 * Stars for three goals. The first goal is winning: without it there are no
 * stars; with it, one star for every goal met.
 */
export function starsFor(goals: readonly boolean[]): number {
  return goals[0] ? goals.filter(Boolean).length : 0;
}
