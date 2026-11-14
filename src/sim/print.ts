/**
 * The workshop's printer game: a tool is printed one layer at a time.
 *
 * Each new layer slides back and forth over the one below. When the player lays it,
 * whatever sticks out over the edge is cut off (a printer cannot print in thin air), so
 * the print gets narrower with every sloppy layer. A layer laid almost exactly on the one
 * below snaps into place and keeps its full width. A layer that misses completely is
 * simply tried again: a print never fails, it is only neater or less neat.
 *
 * Widths and positions are shares of the build plate (0 = left edge, 1 = right edge).
 */

/** One printed layer. */
export interface Layer {
  left: number;
  width: number;
}

/** GAME. The rules of the printer game. */
export const PRINT = {
  /** Layers laid by the player on top of the first one. */
  layers: 7,
  /** The first layer, printed by the machine. */
  base: { left: 0.22, width: 0.56 } as Layer,
  /** Laid within this distance of the layer below, a layer snaps into place. */
  perfect: 0.03,
  /** Overlaps thinner than this count as a miss. */
  thinnest: 0.02,
  /** A print kept at least this wide (share of the first layer) saves one metal: the printer recycles the scraps. */
  saving: 0.85,
} as const;

/** How fast layer `index` (0 = the first one the player lays) sweeps, in plate widths per second. */
export function layerSpeed(index: number): number {
  return 0.36 + 0.06 * index;
}

export type Drop =
  | { kind: 'perfect'; layer: Layer }
  | { kind: 'trim'; layer: Layer; cut: Layer }
  | { kind: 'miss' };

/** Lay a moving layer on the one below: a near-perfect drop snaps into place, an overhang is cut off. */
export function dropLayer(below: Layer, moving: Layer, perfect: number = PRINT.perfect): Drop {
  if (Math.abs(moving.left - below.left) <= perfect && Math.abs(moving.width - below.width) <= perfect) {
    return { kind: 'perfect', layer: { left: below.left, width: below.width } };
  }
  const left = Math.max(below.left, moving.left);
  const right = Math.min(below.left + below.width, moving.left + moving.width);
  if (right - left < PRINT.thinnest) return { kind: 'miss' };
  const layer = { left, width: right - left };
  const cut =
    moving.left < below.left
      ? { left: moving.left, width: Math.min(moving.width, below.left - moving.left) }
      : { left: right, width: moving.left + moving.width - right };
  return { kind: 'trim', layer, cut };
}

/**
 * The screen draws the tool itself in the layers: each layer shows its own band of the
 * tool's picture. The moving layer carries its band with it, so the band lands wherever
 * the layer is laid: a neat print makes a straight tool, a sloppy one a wobbly tool.
 *
 * `belowArt` is where the picture's left edge is in the layer below (a share of the plate,
 * like `left`); this returns where it is in the layer just laid (or in a piece that fell).
 * A layer that snaps into place keeps the picture straight.
 */
export function artAfterDrop(below: Layer, belowArt: number, drop: Drop, movingLeft: number): number {
  return drop.kind === 'perfect' ? belowArt : belowArt + (movingLeft - below.left);
}

/** Where a moving layer's left edge is after `seconds`: it sweeps from one side of the plate to the other and back. */
export function sweep(seconds: number, width: number, speed: number, fromRight: boolean): number {
  const span = Math.max(0.001, 1 - width);
  const travelled = (Math.max(0, seconds) * speed) % (2 * span);
  const x = travelled <= span ? travelled : 2 * span - travelled;
  return fromRight ? span - x : x;
}

/** How neat a finished print is: the top layer's width as a share of the first layer's. */
export function printAccuracy(top: Layer): number {
  return Math.max(0, Math.min(1, top.width / PRINT.base.width));
}

/** Stars for a finished print. */
export function printStars(accuracy: number): 1 | 2 | 3 {
  if (accuracy >= PRINT.saving) return 3;
  return accuracy >= 0.55 ? 2 : 1;
}
