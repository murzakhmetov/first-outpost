/**
 * The pipe puzzle without any screen code: pieces, turning, where the air
 * flows, where it leaks, a puzzle maker, a solver and the star rules. Kept
 * apart so the tests can check it.
 *
 * Directions go clockwise: 0 north (up), 1 east (right), 2 south (down), 3 west (left).
 * The open ends of a tile are a 4-bit mask: north 1, east 2, south 4, west 8.
 * Air enters the board from the tank through the west side of the first cell
 * in row `inletRow`, and must leave through the east side of the last cell in
 * row `outletRow`, into the crew room.
 */
import { Rng } from '../../sim/rng';
import type { Level } from './score';

export type PieceKind = 'straight' | 'corner' | 'tee';

export const NORTH = 0;
export const EAST = 1;
export const SOUTH = 2;
export const WEST = 3;

/** Open ends of each piece before it is turned. */
export const BASE: Record<PieceKind, number> = {
  straight: 0b0101, // north + south
  corner: 0b0011, // north + east
  tee: 0b0111, // north + east + south
};

export interface Tile {
  kind: PieceKind;
  /** Quarter turns clockwise from the base shape, 0 to 3. */
  rot: number;
}

export interface Board {
  rows: number;
  cols: number;
  /** Row by row, left to right. */
  tiles: Tile[];
  inletRow: number;
  outletRow: number;
}

export interface Puzzle {
  /** The scrambled board the player starts with. */
  board: Board;
  /** Turns for every tile that connect the tank to the room: the answer the puzzle was built from. */
  solution: number[];
  /** The fewest taps that let the air through: the yardstick for the stars. */
  par: number;
}

export interface Flow {
  /** True for every tile the air reaches from the tank. */
  wet: boolean[];
  /** The air reaches the crew room. */
  connected: boolean;
  /** The side each wet tile takes the air in by (0 north ... 3 west); -1 for dry tiles. */
  from: number[];
  /** How many tiles the air passed before it reached each wet tile (0 next to the tank); -1 for dry tiles. */
  depth: number[];
}

/** An open pipe end with air in it that meets no other pipe: the air escapes there. */
export interface Leak {
  cell: number;
  dir: number;
}

const bit = (dir: number): number => 1 << dir;
const opposite = (dir: number): number => (dir + 2) % 4;
const wrap4 = (value: number): number => ((value % 4) + 4) % 4;

/** Turn a mask of open ends clockwise by quarter turns. */
export function rotateMask(mask: number, turns: number): number {
  let out = mask & 15;
  for (let i = 0; i < wrap4(turns); i++) out = ((out << 1) | (out >> 3)) & 15;
  return out;
}

export function openings(tile: Tile): number {
  return rotateMask(BASE[tile.kind], tile.rot);
}

/** The same tile, turned a quarter turn clockwise. */
export function turn(tile: Tile): Tile {
  return { kind: tile.kind, rot: wrap4(tile.rot + 1) };
}

/** A new board with one tile turned a quarter turn clockwise. */
export function turnAt(board: Board, index: number): Board {
  return { ...board, tiles: board.tiles.map((tile, i) => (i === index ? turn(tile) : tile)) };
}

/** A new board with every tile set to the given turns. */
export function withRotations(board: Board, rotations: readonly number[]): Board {
  return { ...board, tiles: board.tiles.map((tile, i) => ({ kind: tile.kind, rot: wrap4(rotations[i] ?? tile.rot) })) };
}

export function inletCell(board: Board): number {
  return board.inletRow * board.cols;
}

export function outletCell(board: Board): number {
  return board.outletRow * board.cols + board.cols - 1;
}

/** The cell next to `cell` in direction `dir`, or -1 past the edge of the board. */
function neighbour(size: { rows: number; cols: number }, cell: number, dir: number): number {
  const row = Math.floor(cell / size.cols);
  const col = cell % size.cols;
  if (dir === NORTH) return row > 0 ? cell - size.cols : -1;
  if (dir === SOUTH) return row < size.rows - 1 ? cell + size.cols : -1;
  if (dir === EAST) return col < size.cols - 1 ? cell + 1 : -1;
  return col > 0 ? cell - 1 : -1;
}

/** The direction from cell `from` to the next-door cell `to`. */
function directionTo(cols: number, from: number, to: number): number {
  if (to === from - cols) return NORTH;
  if (to === from + cols) return SOUTH;
  if (to === from + 1) return EAST;
  return WEST;
}

/**
 * Follow the air from the tank: two tiles join when both have an open end facing the other.
 * The search goes outwards step by step, so `depth` is the shortest way along the pipes.
 */
export function flow(board: Board): Flow {
  const count = board.tiles.length;
  const wet = new Array<boolean>(count).fill(false);
  const from = new Array<number>(count).fill(-1);
  const depth = new Array<number>(count).fill(-1);
  const start = inletCell(board);
  if (!(openings(board.tiles[start]) & bit(WEST))) return { wet, connected: false, from, depth };
  wet[start] = true;
  from[start] = WEST;
  depth[start] = 0;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    const open = openings(board.tiles[cell]);
    for (let dir = 0; dir < 4; dir++) {
      if (!(open & bit(dir))) continue;
      const next = neighbour(board, cell, dir);
      if (next < 0 || wet[next]) continue;
      if (!(openings(board.tiles[next]) & bit(opposite(dir)))) continue;
      wet[next] = true;
      from[next] = opposite(dir);
      depth[next] = depth[cell] + 1;
      queue.push(next);
    }
  }
  const end = outletCell(board);
  return { wet, connected: wet[end] && (openings(board.tiles[end]) & bit(EAST)) !== 0, from, depth };
}

export function isConnected(board: Board): boolean {
  return flow(board).connected;
}

/** Every open end of a wet pipe that meets nothing: the tank and the room count as joined. */
export function leaks(board: Board, air: Flow = flow(board)): Leak[] {
  const out: Leak[] = [];
  const start = inletCell(board);
  const end = outletCell(board);
  board.tiles.forEach((tile, cell) => {
    if (!air.wet[cell]) return;
    const open = openings(tile);
    for (let dir = 0; dir < 4; dir++) {
      if (!(open & bit(dir))) continue;
      if (cell === start && dir === WEST) continue;
      if (cell === end && dir === EAST) continue;
      const next = neighbour(board, cell, dir);
      if (next >= 0 && openings(board.tiles[next]) & bit(opposite(dir))) continue;
      out.push({ cell, dir });
    }
  });
  return out;
}

/**
 * Find turns for every tile that let the air reach the room, or null if there are none.
 * Walks every route from the tank, trying each way a piece can face; tiles off the
 * route keep the turn they have now.
 */
export function solve(board: Board): number[] | null {
  const rotations = board.tiles.map((tile) => tile.rot);
  const used = board.tiles.map(() => false);
  const end = outletCell(board);
  const visit = (cell: number, from: number): boolean => {
    used[cell] = true;
    const kind = board.tiles[cell].kind;
    for (let rot = 0; rot < 4; rot++) {
      const open = rotateMask(BASE[kind], rot);
      if (!(open & bit(from))) continue;
      for (let dir = 0; dir < 4; dir++) {
        if (dir === from || !(open & bit(dir))) continue;
        if (cell === end && dir === EAST) {
          rotations[cell] = rot;
          return true;
        }
        const next = neighbour(board, cell, dir);
        if (next < 0 || used[next]) continue;
        rotations[cell] = rot;
        if (visit(next, opposite(dir))) return true;
      }
    }
    used[cell] = false;
    rotations[cell] = board.tiles[cell].rot;
    return false;
  };
  return visit(inletCell(board), WEST) ? rotations : null;
}

/** The fewest clockwise quarter turns that open `tile` towards both `a` and `b`, or -1 if it never can. */
function turnsToJoin(tile: Tile, a: number, b: number): number {
  const need = bit(a) | bit(b);
  for (let k = 0; k < 4; k++) if ((rotateMask(BASE[tile.kind], tile.rot + k) & need) === need) return k;
  return -1;
}

/**
 * The fewest taps that connect the tank to the room (a tap turns one tile a
 * quarter turn clockwise). Tries every route along the board, keeping the
 * cheapest; gives up after `budget` steps and returns the best found so far
 * (Infinity if none was found).
 */
export function minTurns(board: Board, budget = 400_000): number {
  const used = board.tiles.map(() => false);
  const end = outletCell(board);
  let best = Infinity;
  let steps = 0;
  const visit = (cell: number, from: number, spent: number): void => {
    if (spent >= best || ++steps > budget) return;
    used[cell] = true;
    const tile = board.tiles[cell];
    for (let dir = 0; dir < 4; dir++) {
      if (dir === from) continue;
      const k = turnsToJoin(tile, from, dir);
      if (k < 0 || spent + k >= best) continue;
      if (cell === end && dir === EAST) {
        best = spent + k;
        continue;
      }
      const next = neighbour(board, cell, dir);
      if (next < 0 || used[next]) continue;
      visit(next, opposite(dir), spent + k);
    }
    used[cell] = false;
  };
  visit(inletCell(board), WEST, 0);
  return best;
}

/** The cheapest way through: the cells from the tank to the room, and the taps each one needs. */
export interface Route {
  cells: number[];
  taps: number[];
}

/**
 * One of the routes that need the fewest taps (the same search as `minTurns`), with the
 * cells in order from the tank. Null if no route was found within `budget` steps.
 */
export function bestRoute(board: Board, budget = 400_000): Route | null {
  const used = board.tiles.map(() => false);
  const end = outletCell(board);
  const cells: number[] = [];
  const taps: number[] = [];
  let best = Infinity;
  let found: Route | null = null;
  let steps = 0;
  const visit = (cell: number, from: number, spent: number): void => {
    if (spent >= best || ++steps > budget) return;
    used[cell] = true;
    cells.push(cell);
    const tile = board.tiles[cell];
    for (let dir = 0; dir < 4; dir++) {
      if (dir === from) continue;
      const k = turnsToJoin(tile, from, dir);
      if (k < 0 || spent + k >= best) continue;
      taps.push(k);
      if (cell === end && dir === EAST) {
        best = spent + k;
        found = { cells: [...cells], taps: [...taps] };
      } else {
        const next = neighbour(board, cell, dir);
        if (next >= 0 && !used[next]) visit(next, opposite(dir), spent + k);
      }
      taps.pop();
    }
    cells.pop();
    used[cell] = false;
  };
  visit(inletCell(board), WEST, 0);
  return found;
}

/**
 * The pipe a first-time player is shown: on a cheapest route, the first one from the tank
 * that still needs turning. -1 when the board is already joined (or no route is known).
 */
export function hintCell(board: Board): number {
  const route = bestRoute(board);
  if (!route) return -1;
  const index = route.taps.findIndex((k) => k > 0);
  return index < 0 ? -1 : route.cells[index];
}

/** A random route of cells from `start` to `end`, between `minLength` and `maxLength` cells long. */
function randomRoute(
  rng: Rng,
  size: { rows: number; cols: number },
  start: number,
  end: number,
  minLength: number,
  maxLength: number,
): number[] | null {
  const route = [start];
  const used = new Set([start]);
  const endRow = Math.floor(end / size.cols);
  const endCol = end % size.cols;
  let budget = 20000; // search steps: plenty for a small board, and never slow
  const extend = (cell: number): boolean => {
    if (--budget < 0) return false;
    if (cell === end) return route.length >= minLength;
    const left = Math.abs(Math.floor(cell / size.cols) - endRow) + Math.abs((cell % size.cols) - endCol);
    if (route.length + left > maxLength) return false;
    for (const dir of rng.shuffle([NORTH, EAST, SOUTH, WEST])) {
      const next = neighbour(size, cell, dir);
      if (next < 0 || used.has(next)) continue;
      used.add(next);
      route.push(next);
      if (extend(next)) return true;
      used.delete(next);
      route.pop();
    }
    return false;
  };
  return extend(start) ? route : null;
}

/** Along the tank's row to the last column, then up or down to the room's row. Always works. */
function plainRoute(cols: number, inletRow: number, outletRow: number): number[] {
  const route: number[] = [];
  for (let col = 0; col < cols; col++) route.push(inletRow * cols + col);
  const step = outletRow > inletRow ? 1 : -1;
  for (let row = inletRow + step; row !== outletRow + step && inletRow !== outletRow; row += step) route.push(row * cols + cols - 1);
  return route;
}

/** How a puzzle is built: longer routes, more scrambled pieces and more tees make it harder. */
export interface PipeTune {
  /** The route is at least this many cells longer than the board is wide... */
  minExtra: number;
  /** ...and at most this many. */
  maxExtra: number;
  /** At least this many pieces on the route start turned the wrong way. */
  broken: number;
  /** Share of the route made of tees, which can turn many ways. */
  teeOnRoute: number;
  /** Weights of the pieces that fill the cells off the route. */
  fill: readonly (readonly [PieceKind, number])[];
  /** The fewest taps that solve the scrambled board stay between these (other routes may be shorter than the built one). */
  minPar: number;
  maxPar: number;
}

const FILL: readonly (readonly [PieceKind, number])[] = [
  ['straight', 0.3],
  ['corner', 0.45],
  ['tee', 0.25],
];

const DEFAULT_TUNE: PipeTune = { minExtra: 2, maxExtra: 7, broken: 4, teeOnRoute: 0.3, fill: FILL, minPar: 1, maxPar: Infinity };

/** A route with fitting pieces on it and random pieces around it, before the scramble. */
interface Build {
  route: number[];
  /** For each cell of the route, the sides the air comes in and goes out by. */
  ends: [number, number][];
  /** For each cell, the open ends the route needs there (0 off the route). */
  needs: number[];
  solution: number[];
  tiles: Tile[];
}

function build(rng: Rng, rows: number, cols: number, inletRow: number, outletRow: number, set: PipeTune): Build {
  const size = { rows, cols };
  const start = inletRow * cols;
  const end = outletRow * cols + cols - 1;
  const shortest = Math.abs(inletRow - outletRow) + cols;
  const minLength = Math.min(rows * cols, Math.max(shortest, cols + set.minExtra));
  const maxLength = Math.max(minLength, Math.min(rows * cols - 4, cols + set.maxExtra));
  const route = randomRoute(rng, size, start, end, minLength, maxLength) ?? plainRoute(cols, inletRow, outletRow);

  const count = rows * cols;
  const placed: (Tile | undefined)[] = new Array<Tile | undefined>(count).fill(undefined);
  const solution = new Array<number>(count).fill(0);
  const needs = new Array<number>(count).fill(0);
  const ends: [number, number][] = [];
  route.forEach((cell, index) => {
    const into = index === 0 ? WEST : directionTo(cols, cell, route[index - 1]);
    const out = index === route.length - 1 ? EAST : directionTo(cols, cell, route[index + 1]);
    const need = bit(into) | bit(out);
    const kind: PieceKind = rng.chance(set.teeOnRoute) ? 'tee' : into === opposite(out) ? 'straight' : 'corner';
    const fits = [0, 1, 2, 3].filter((rot) => (rotateMask(BASE[kind], rot) & need) === need);
    needs[cell] = need;
    ends.push([into, out]);
    solution[cell] = rng.pick(fits);
    placed[cell] = { kind, rot: solution[cell] };
  });
  const tiles: Tile[] = placed.map((tile, cell) => {
    if (tile) return tile;
    const kind = (rng.weighted(set.fill, (entry) => entry[1]) ?? set.fill[0])[0];
    solution[cell] = rng.int(0, 3);
    return { kind, rot: solution[cell] };
  });
  return { route, ends, needs, solution, tiles };
}

/**
 * Make a puzzle that always has an answer: lay a random route from the tank to
 * the room, put pieces on it that can carry the air along, fill the other cells
 * with random pieces, then turn every piece at random. The scramble must break
 * the route in several places, and the fewest taps that solve it (by any route)
 * must fit the level; if a route never allows that, a new route is laid.
 */
export function generate(seed: number, rows = 4, cols = 4, tune: Partial<PipeTune> = {}): Puzzle {
  const set: PipeTune = { ...DEFAULT_TUNE, ...tune };
  const rng = new Rng(seed);
  const inletRow = rng.int(0, rows - 1);
  const outletRow = rng.int(0, rows - 1);

  const parOf = (made: Build, board: Board): number => {
    // The taps the built route needs are an upper bound for the true fewest.
    const routeTaps = made.route.reduce((sum, cell, index) => sum + Math.max(0, turnsToJoin(board.tiles[cell], made.ends[index][0], made.ends[index][1])), 0);
    return Math.min(routeTaps, minTurns(board));
  };
  const fitsNeed = (made: Build, tile: Tile, cell: number): boolean => (openings(tile) & made.needs[cell]) === made.needs[cell];
  const scramble = (made: Build, attempts: number, broken: number, minPar: number, maxPar: number): Puzzle | null => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const board: Board = { rows, cols, inletRow, outletRow, tiles: made.tiles.map((tile) => ({ kind: tile.kind, rot: rng.int(0, 3) })) };
      if (made.route.filter((cell) => !fitsNeed(made, board.tiles[cell], cell)).length < broken || isConnected(board)) continue;
      const par = parOf(made, board);
      if (par >= minPar && par <= maxPar) return { board, solution: made.solution, par };
    }
    return null;
  };

  let made = build(rng, rows, cols, inletRow, outletRow, set);
  for (let tries = 0; tries < 6; tries++) {
    if (tries > 0) made = build(rng, rows, cols, inletRow, outletRow, set);
    const found = scramble(made, 120, Math.min(set.broken, made.route.length), set.minPar, set.maxPar);
    if (found) return found;
  }
  // A little easier, rather than none at all.
  const easier = scramble(made, 120, Math.min(set.broken, made.route.length, 3), Math.max(1, set.minPar - 3), Infinity);
  if (easier) return easier;

  // Practically never needed: face every piece on the route a wrong way...
  const board: Board = { rows, cols, inletRow, outletRow, tiles: made.tiles.map((tile) => ({ ...tile })) };
  for (const cell of made.route) {
    const kind = board.tiles[cell].kind;
    const wrong = [1, 2, 3].map((step) => wrap4(made.solution[cell] + step)).find((rot) => !fitsNeed(made, { kind, rot }, cell));
    board.tiles[cell] = { kind, rot: wrong ?? wrap4(made.solution[cell] + 1) };
  }
  // ...and if the air still finds another way through, turn pipes along it until it does not.
  for (let guard = 0; guard < 64 && isConnected(board); guard++) {
    const air = flow(board);
    const wetCells = board.tiles.map((_, cell) => cell).filter((cell) => air.wet[cell]);
    const cell = wetCells[guard % wetCells.length];
    board.tiles[cell] = turn(board.tiles[cell]);
  }
  return { board, solution: made.solution, par: parOf(made, board) };
}

// ----- Levels and stars ---------------------------------------------------------

export interface PipeLevel {
  rows: number;
  cols: number;
  tune: Partial<PipeTune>;
}

/**
 * Level 1 is a small, gentle board. Levels 2 and 3 have one more line of pipes:
 * one more row on upright screens, one more column on wide ones, so every pipe
 * stays big enough to tap.
 */
export function pipeLevel(level: Level, wide: boolean): PipeLevel {
  if (level === 1) {
    return {
      rows: 4,
      cols: 4,
      tune: {
        minExtra: 1,
        maxExtra: 5,
        broken: 3,
        teeOnRoute: 0.15,
        fill: [
          ['straight', 0.35],
          ['corner', 0.5],
          ['tee', 0.15],
        ],
        minPar: 4,
        maxPar: 9,
      },
    };
  }
  const size = wide ? { rows: 4, cols: 5 } : { rows: 5, cols: 4 };
  if (level === 2) return { ...size, tune: { minExtra: 3, maxExtra: 8, broken: 5, teeOnRoute: 0.3, minPar: 6, maxPar: 14 } };
  return {
    ...size,
    tune: {
      minExtra: 5,
      maxExtra: 11,
      broken: 7,
      teeOnRoute: 0.4,
      fill: [
        ['straight', 0.3],
        ['corner', 0.45],
        ['tee', 0.25],
      ],
      minPar: 8,
      maxPar: 20,
    },
  };
}

export interface PipeTargets {
  /** Most taps for three stars. */
  three: number;
  /** Most taps for two stars. */
  two: number;
}

/** Star limits: a few taps over the fewest possible for three stars, many more for two. */
export function pipeTargets(par: number, level: Level): PipeTargets {
  const spare = level === 1 ? 3 : level === 2 ? 4 : 5;
  return { three: par + spare, two: par * 2 + spare * 3 };
}

/** The three star goals: the air reaches the crew; within the two-star taps; within the three-star taps. */
export function pipeGoals(won: boolean, moves: number, targets: PipeTargets): [boolean, boolean, boolean] {
  return [won, won && moves <= targets.two, won && moves <= targets.three];
}
