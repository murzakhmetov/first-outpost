/**
 * The building mini-games: the rules of each game without the screen, and the texts.
 */
import { describe, expect, it } from 'vitest';
import { minigamesEn, minigamesRu } from '../src/i18n/minigames';
import { mulberry32 } from '../src/sim/rng';
import {
  BASE,
  bestRoute,
  flow,
  generate,
  hintCell,
  isConnected,
  leaks,
  minTurns,
  openings,
  pipeGoals,
  pipeLevel,
  pipeTargets,
  solve,
  turn,
  turnAt,
  withRotations,
} from '../src/ui/minigames/pipes';
import type { Board, PieceKind, Tile } from '../src/ui/minigames/pipes';
import { gardenWon, newGarden, plantGoals, stepGarden, tapPot } from '../src/ui/minigames/plants';
import { ELEMENTS, LINES, ROCKS, SPECTRO_LEVELS, atNm, isRight, makeRounds, rockLines, spectroGoals } from '../src/ui/minigames/spectro';
import { EARTH_GRAVITY, GRAVITY, groundAt, judgeLanding, landerGoals, landerTune, newLander, stepLander } from '../src/ui/minigames/lander';
import type { Lander, LanderInput, LanderTune } from '../src/ui/minigames/lander';
import { RHYTHM_LEVELS, judgeTap, isLost, makeChart, noteFor, sentShare, signalGoals, signalWon } from '../src/ui/minigames/rhythm';
import { levelOf, starsFor } from '../src/ui/minigames/score';
import type { Level, Site } from '../src/ui/minigames/score';

const SEEDS = Array.from({ length: 300 }, (_, i) => i * 7919 + 1);
const LEVELS: Level[] = [1, 2, 3];
const SITES: Site[] = ['mars', 'moon'];

/** The straight line along row 1 from the tank to the room, with corners everywhere else. */
function straightBoard(): Board {
  const across: Tile = { kind: 'straight', rot: 1 };
  const tiles: Tile[] = Array.from({ length: 16 }, (_, i) => (Math.floor(i / 4) === 1 ? across : { kind: 'corner', rot: 2 }));
  return { rows: 4, cols: 4, tiles, inletRow: 1, outletRow: 1 };
}

describe('pipe puzzle', () => {
  it('always makes a puzzle that can be solved, and is not solved yet', () => {
    for (const seed of SEEDS) {
      const { board } = generate(seed);
      expect(board.tiles).toHaveLength(16);
      expect(isConnected(board)).toBe(false);
      const answer = solve(board);
      expect(answer, `seed ${seed}`).not.toBeNull();
      expect(isConnected(withRotations(board, answer ?? []))).toBe(true);
    }
  });

  it('sees the answer it was built from as connected', () => {
    for (const seed of SEEDS) {
      const { board, solution } = generate(seed);
      const solved = withRotations(board, solution);
      expect(isConnected(solved)).toBe(true);
      expect(flow(solved).wet[solved.inletRow * solved.cols]).toBe(true);
    }
  });

  it('gives the same puzzle for the same seed', () => {
    expect(generate(42)).toEqual(generate(42));
  });

  it('follows the air only through ends that meet', () => {
    const board = straightBoard();
    expect(isConnected(board)).toBe(true);
    expect(flow(board).wet.filter(Boolean)).toHaveLength(4);
    expect(isConnected(turnAt(board, 6))).toBe(false);
    expect(isConnected({ ...board, outletRow: 2 })).toBe(false);
  });

  it('knows where the air comes in and how far it has gone', () => {
    const air = flow(straightBoard());
    expect(air.from.slice(4, 8)).toEqual([3, 3, 3, 3]); // every pipe in the row takes the air in from the west
    expect(air.depth.slice(4, 8)).toEqual([0, 1, 2, 3]);
    expect(air.from[0]).toBe(-1);
    expect(air.depth[0]).toBe(-1);
  });

  it('finds leaks only at open wet ends that meet nothing', () => {
    const board = straightBoard();
    expect(leaks(board)).toEqual([]);
    // Turn the third pipe of the row: the air stops at the second one and escapes there.
    expect(leaks(turnAt(board, 6))).toEqual([{ cell: 5, dir: 1 }]);
  });

  it('turns open ends clockwise, and four turns bring a tile back', () => {
    expect(openings(turn({ kind: 'corner', rot: 0 }))).toBe(0b0110); // north+east becomes east+south
    for (const kind of Object.keys(BASE) as PieceKind[]) {
      for (let rot = 0; rot < 4; rot++) {
        const start: Tile = { kind, rot };
        const back = turn(turn(turn(turn(start))));
        expect(back).toEqual(start);
        expect(openings(back)).toBe(openings(start));
      }
    }
    const { board } = generate(7);
    let turned = board;
    for (let i = 0; i < 4; i++) turned = turnAt(turned, 5);
    expect(turned).toEqual(board);
  });

  it('counts the fewest taps that let the air through', () => {
    const board = straightBoard();
    expect(minTurns(board)).toBe(0);
    expect(minTurns(turnAt(board, 6))).toBe(1); // one more quarter turn puts the pipe back across
    for (const seed of SEEDS.slice(0, 60)) {
      const { board: start, solution, par } = generate(seed);
      expect(par, `seed ${seed}`).toBeGreaterThan(0);
      expect(par).toBe(minTurns(start));
      // The built answer needs at least as many taps as the fewest.
      const taps = start.tiles.reduce((sum, tile, i) => sum + (((solution[i] - tile.rot) % 4) + 4) % 4, 0);
      expect(par).toBeLessThanOrEqual(taps);
    }
  });

  it('makes every level solvable, bigger at levels 2 and 3, and keeps stars fair', () => {
    for (const level of LEVELS) {
      for (const wide of [false, true]) {
        const spec = pipeLevel(level, wide);
        expect(spec.cols).toBeLessThanOrEqual(wide ? 5 : 4); // upright screens never get more than 4 columns, so pipes stay big
        for (const seed of SEEDS.slice(0, 40)) {
          const puzzle = generate(seed, spec.rows, spec.cols, spec.tune);
          expect(puzzle.board.tiles).toHaveLength(spec.rows * spec.cols);
          expect(isConnected(puzzle.board)).toBe(false);
          expect(isConnected(withRotations(puzzle.board, puzzle.solution))).toBe(true);
          expect(Number.isFinite(puzzle.par)).toBe(true);
          // No shortcut makes a hard board easy, and no easy board is long.
          expect(puzzle.par, `level ${level} seed ${seed}`).toBeGreaterThanOrEqual(spec.tune.minPar ?? 1);
          expect(puzzle.par, `level ${level} seed ${seed}`).toBeLessThanOrEqual(spec.tune.maxPar ?? Infinity);
          const targets = pipeTargets(puzzle.par, level);
          expect(targets.three).toBeGreaterThan(puzzle.par);
          expect(targets.two).toBeGreaterThan(targets.three);
        }
      }
    }
    expect(pipeLevel(1, true).rows * pipeLevel(1, true).cols).toBeLessThan(pipeLevel(2, true).rows * pipeLevel(2, true).cols);
  });

  it('finds a cheapest route, and shows a first-time player a pipe on it that needs turning', () => {
    expect(hintCell(straightBoard())).toBe(-1); // already joined: nothing to show
    expect(hintCell(turnAt(straightBoard(), 6))).toBe(6);
    for (const level of LEVELS) {
      const spec = pipeLevel(level, false);
      for (const seed of SEEDS.slice(0, 40)) {
        const { board, par } = generate(seed, spec.rows, spec.cols, spec.tune);
        const route = bestRoute(board);
        expect(route, `level ${level} seed ${seed}`).not.toBeNull();
        if (!route) continue;
        // The route starts at the tank, ends at the room, and costs exactly the fewest taps.
        expect(route.cells[0]).toBe(board.inletRow * board.cols);
        expect(route.cells[route.cells.length - 1]).toBe(board.outletRow * board.cols + board.cols - 1);
        expect(route.taps.reduce((sum, k) => sum + k, 0)).toBe(par);
        // Turning every pipe on it as many times as it says lets the air through.
        let fixed = board;
        route.cells.forEach((cell, i) => {
          for (let k = 0; k < route.taps[i]; k++) fixed = turnAt(fixed, cell);
        });
        expect(isConnected(fixed)).toBe(true);
        // The hand points at the first pipe from the tank that still needs a turn.
        const cell = hintCell(board);
        const first = route.taps.findIndex((k) => k > 0);
        expect(cell).toBe(route.cells[first]);
      }
    }
  });

  it('gives stars for winning in few moves', () => {
    const targets = pipeTargets(8, 2);
    expect(starsFor(pipeGoals(true, 8, targets))).toBe(3);
    expect(starsFor(pipeGoals(true, targets.three + 1, targets))).toBe(2);
    expect(starsFor(pipeGoals(true, targets.two + 1, targets))).toBe(1);
    expect(starsFor(pipeGoals(false, 3, targets))).toBe(0);
  });
});

describe('greenhouse', () => {
  /** Play with a helper that always picks the right tool and helps as soon as a plant asks. */
  function playPerfect(level: Level, seed: number): ReturnType<typeof newGarden> {
    const rand = mulberry32(seed);
    const garden = newGarden(level, rand);
    garden.phase = 'play';
    while (garden.phase === 'play') {
      stepGarden(garden, 100, rand);
      garden.pots.forEach((pot, index) => {
        if (!pot.need || garden.time - pot.needAt < 400) return; // a quick child takes a moment to react
        garden.tool = pot.need;
        tapPot(garden, index);
      });
    }
    return garden;
  }

  it('can be won with three stars at every level', () => {
    for (const level of LEVELS) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const garden = playPerfect(level, seed);
        expect(gardenWon(garden), `level ${level} seed ${seed}: helped ${garden.helped}`).toBe(true);
        expect(starsFor(plantGoals(garden))).toBe(3);
        expect(garden.time).toBe(garden.tune.gameMs);
      }
    }
  });

  it('ends early, lost, when too many plants wilt', () => {
    const rand = mulberry32(9);
    const garden = newGarden(2, rand);
    garden.phase = 'play';
    const events: string[] = [];
    while (garden.phase === 'play') events.push(...stepGarden(garden, 100, rand));
    expect(gardenWon(garden)).toBe(false);
    expect(garden.wilts).toBe(garden.tune.maxWilts + 1);
    expect(garden.time).toBeLessThan(garden.tune.gameMs);
    expect(events).toContain('wilt');
    expect(events[events.length - 1]).toBe('lost');
    expect(starsFor(plantGoals(garden))).toBe(0);
  });

  it('counts the wrong tool and no tool as mistakes, and helps with the right one', () => {
    const rand = mulberry32(3);
    const garden = newGarden(1, rand);
    garden.phase = 'play';
    while (!garden.pots.some((pot) => pot.need)) stepGarden(garden, 100, rand);
    const index = garden.pots.findIndex((pot) => pot.need);
    const need = garden.pots[index].need;
    expect(tapPot(garden, index)).toBe('noTool');
    garden.tool = need === 'water' ? 'light' : 'water';
    expect(tapPot(garden, index)).toBe('wrong');
    expect(garden.mistakes).toBe(2);
    garden.tool = need;
    expect(tapPot(garden, index)).toBe('good');
    expect(garden.helped).toBe(1);
    expect(garden.pots[index].growth).toBe(1);
    expect(tapPot(garden, index)).toBe('fine');
  });
});

describe('spectrometer', () => {
  it('keeps the line patterns easy to tell apart (3% of the strip, about 10 nm)', () => {
    const all = ELEMENTS.flatMap((el) => LINES[el].map(([at]) => ({ at, el })));
    for (const a of all) {
      for (const b of all) {
        if (a.el !== b.el) expect(Math.abs(a.at - b.at), `${a.el} ${a.at} / ${b.el} ${b.at}`).toBeGreaterThanOrEqual(2.99);
      }
    }
  });

  it('puts the lines at their real wavelengths', () => {
    // 380 nm is the violet end of the strip, 700 nm the red end.
    expect(atNm(380)).toBe(0);
    expect(atNm(700)).toBe(100);
    // H-alpha, sodium D, the calcium K line, the magnesium b triplet (NIST).
    expect(LINES.H.map(([at]) => at)).toContain(atNm(656.28));
    expect(LINES.Na.map(([at]) => at)).toContain(atNm(589.0));
    expect(LINES.Ca.map(([at]) => at)).toContain(atNm(393.37));
    expect(LINES.Mg.map(([at]) => at)).toContain(atNm(518.36));
    for (const el of ELEMENTS) for (const [at] of LINES[el]) expect(at).toBeGreaterThanOrEqual(0), expect(at).toBeLessThanOrEqual(100);
  });

  it('deals the right cards for every level', () => {
    for (const level of LEVELS) {
      const tune = SPECTRO_LEVELS[level];
      for (const site of SITES) {
        for (let seed = 1; seed < 30; seed++) {
          const rounds = makeRounds(site, tune, mulberry32(seed));
          expect(rounds).toHaveLength(tune.rounds);
          expect(new Set(rounds.map((round) => round.rock.id)).size).toBe(tune.rounds);
          for (const round of rounds) {
            expect(round.cards).toHaveLength(tune.cards);
            expect(new Set(round.cards).size).toBe(tune.cards);
            for (const el of round.rock.els) expect(round.cards).toContain(el);
          }
        }
      }
      expect(tune.toWin).toBeLessThanOrEqual(tune.rounds);
      expect(tune.rounds).toBeLessThanOrEqual(ROCKS.mars.length);
    }
  });

  it('checks a guess and gives stars for few wrong guesses', () => {
    const rock = ROCKS.mars[0];
    expect(isRight([rock.els[1], rock.els[0]], rock)).toBe(true);
    expect(isRight([rock.els[0]], rock)).toBe(false);
    expect(isRight([rock.els[0], rock.els[0]], rock)).toBe(false);
    expect(rockLines(rock)).toHaveLength(LINES[rock.els[0]].length + LINES[rock.els[1]].length);
    const tune = SPECTRO_LEVELS[1];
    expect(starsFor(spectroGoals(3, 0, tune))).toBe(3);
    expect(starsFor(spectroGoals(3, 1, tune))).toBe(2);
    expect(starsFor(spectroGoals(2, 3, tune))).toBe(1);
    expect(starsFor(spectroGoals(1, 0, tune))).toBe(0);
  });
});

describe('landing simulator', () => {
  /** A careful pilot: falls faster high up, slows down near the ground, and steers over the middle of the pad. */
  function pilot(lander: Lander): LanderInput {
    const wanted = -(1 + 0.1 * Math.max(0, lander.y));
    const drift = Math.max(-2.5, Math.min(2.5, -0.16 * lander.x));
    return {
      thrust: lander.vy < wanted,
      side: lander.vx > drift + 0.15 ? -1 : lander.vx < drift - 0.15 ? 1 : 0,
    };
  }

  function fly(tune: LanderTune, control: (lander: Lander) => LanderInput, seed = 1): Lander {
    const lander = newLander(tune, mulberry32(seed));
    for (let frame = 0; frame < 60 * 120 && !lander.landing; frame++) stepLander(lander, control(lander), 1 / 60, tune);
    return lander;
  }

  it('uses the real gravity of each world', () => {
    expect(GRAVITY.moon).toBe(1.62);
    expect(GRAVITY.mars).toBe(3.71);
    // The Moon is about one sixth of Earth's gravity, Mars about three eighths.
    expect(GRAVITY.moon / EARTH_GRAVITY).toBeCloseTo(1 / 6, 1);
    expect(GRAVITY.mars / EARTH_GRAVITY).toBeCloseTo(3 / 8, 1);
    for (const site of SITES) {
      const tune = landerTune(site, 1);
      const lander = newLander(tune, () => 0.9);
      lander.vy = 0;
      stepLander(lander, { thrust: false, side: 0 }, 1, tune);
      expect(lander.vy).toBeCloseTo(-GRAVITY[site], 6);
      expect(lander.y).toBeCloseTo(tune.startAlt - GRAVITY[site] / 2, 1);
      expect(lander.fuel).toBe(tune.fuel);
    }
  });

  it('slows down with the engine and runs out of fuel', () => {
    const tune = landerTune('moon', 1);
    const lander = newLander(tune, () => 0.9);
    lander.vy = 0;
    stepLander(lander, { thrust: true, side: 0 }, 1, tune);
    expect(lander.vy).toBeCloseTo(tune.thrust - tune.g, 6);
    expect(lander.fuel).toBeCloseTo(tune.fuel - 1, 6);
    lander.fuel = 0.5;
    stepLander(lander, { thrust: true, side: 1 }, 1, tune);
    expect(lander.fuel).toBe(0);
    expect(lander.burning).toBe(false);
  });

  it('judges a touchdown: slow on the pad wins, fast or off the pad does not', () => {
    const tune = landerTune('mars', 2);
    const at = (x: number, vx: number, vy: number): Lander => ({ ...newLander(tune, () => 0.9), x, vx, vy, y: 0 });
    expect(judgeLanding(at(0, 0, -1), tune).result).toBe('soft');
    expect(judgeLanding(at(0, 0, -(tune.safeVy + 0.1)), tune).result).toBe('hard');
    expect(judgeLanding(at(0, tune.safeVx + 0.2, -1), tune).result).toBe('slide');
    expect(judgeLanding(at(tune.padHalf + 1, 0, -1), tune).result).toBe('missed');
    expect(groundAt(0, tune.padHalf)).toBe(0);
    expect(groundAt(tune.padHalf + 6, tune.padHalf)).toBeGreaterThanOrEqual(0);
    const soft = judgeLanding(at(0.5, 0, -1), tune);
    expect(starsFor(landerGoals(soft, tune))).toBe(3);
    const firm = judgeLanding(at(tune.bullseye + 1, 0, -(tune.gentleVy + 0.3)), tune);
    expect(firm.won).toBe(true);
    expect(starsFor(landerGoals(firm, tune))).toBe(1);
    expect(starsFor(landerGoals(judgeLanding(at(0, 0, -9), tune), tune))).toBe(0);
  });

  it('crashes if nobody touches the controls', () => {
    for (const site of SITES) {
      const lander = fly(landerTune(site, 1), () => ({ thrust: false, side: 0 }));
      expect(lander.landing?.result).toBe('hard');
    }
  });

  it('can be landed with three stars at every level, in 20 to 40 seconds, with fuel to spare', () => {
    for (const site of SITES) {
      for (const level of LEVELS) {
        for (const seed of [1, 2, 3]) {
          const tune = landerTune(site, level);
          const lander = fly(tune, pilot, seed);
          const landing = lander.landing;
          expect(landing, `${site} ${level}`).not.toBeNull();
          expect(landing?.result, `${site} ${level} seed ${seed}: ${JSON.stringify(landing)}`).toBe('soft');
          expect(starsFor(landerGoals(landing, tune))).toBe(3);
          const seconds = (landing?.time ?? 0) / tune.timeScale;
          expect(seconds, `${site} ${level}`).toBeGreaterThanOrEqual(20);
          expect(seconds, `${site} ${level}`).toBeLessThanOrEqual(40);
          expect(landing?.fuelLeft ?? 0, `${site} ${level}`).toBeGreaterThan(0.12);
        }
      }
    }
  });
});

describe('radio rhythm game', () => {
  it('makes a fair chart for every level', () => {
    for (const level of LEVELS) {
      const tune = RHYTHM_LEVELS[level];
      for (let seed = 1; seed < 20; seed++) {
        const chart = makeChart(tune, seed);
        const { notes } = chart;
        expect(notes.length).toBeGreaterThan(20);
        // Every packet has time to slide the whole lane, and the song lasts about half a minute.
        expect(notes[0].t).toBeGreaterThanOrEqual(tune.approachMs);
        expect(chart.endMs / 1000).toBeGreaterThan(20);
        expect(chart.endMs / 1000).toBeLessThan(40);
        for (let i = 1; i < notes.length; i++) expect(notes[i].t).toBeGreaterThanOrEqual(notes[i - 1].t);
        for (let lane = 0; lane < 3; lane++) {
          const times = notes.filter((note) => note.lane === lane).map((note) => note.t);
          for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(chart.beatMs / 2 - 1e-6);
        }
        for (const note of notes) {
          expect(note.lane).toBeGreaterThanOrEqual(0);
          expect(note.lane).toBeLessThan(3);
          expect(note.tone).toBeGreaterThanOrEqual(0);
          expect(note.tone).toBeLessThanOrEqual(4);
        }
        if (tune.doubles === 0) expect(new Set(notes.map((note) => note.t)).size).toBe(notes.length);
      }
      expect(makeChart(tune, 5)).toEqual(makeChart(tune, 5));
    }
    // Harder levels have more packets.
    const count = (level: Level): number => makeChart(RHYTHM_LEVELS[level], 3).notes.length;
    expect(count(2)).toBeGreaterThan(count(1));
    expect(count(3)).toBeGreaterThan(count(2));
  });

  it('judges taps by how close they are to the beat', () => {
    const tune = RHYTHM_LEVELS[2];
    expect(judgeTap(0, tune)).toBe('perfect');
    expect(judgeTap(tune.perfectMs, tune)).toBe('perfect');
    expect(judgeTap(-tune.perfectMs, tune)).toBe('perfect');
    expect(judgeTap(tune.perfectMs + 1, tune)).toBe('good');
    expect(judgeTap(-tune.goodMs, tune)).toBe('good');
    expect(judgeTap(-(tune.goodMs + 1), tune)).toBe('miss'); // much too early uses the packet up
    expect(judgeTap(-(tune.earlyMs + 1), tune)).toBeNull(); // far too early: not for this packet at all
    expect(judgeTap(tune.goodMs + 1, tune)).toBeNull();
    expect(isLost(tune.goodMs, tune)).toBe(false);
    expect(isLost(tune.goodMs + 1, tune)).toBe(true);
    // Harder levels have narrower windows.
    expect(RHYTHM_LEVELS[3].goodMs).toBeLessThan(RHYTHM_LEVELS[1].goodMs);
  });

  it('matches a tap to the oldest waiting packet in its lane', () => {
    const tune = RHYTHM_LEVELS[1];
    const notes = [
      { t: 1000, lane: 0, tone: 0, kind: 0 },
      { t: 1000, lane: 1, tone: 0, kind: 0 },
      { t: 1500, lane: 0, tone: 0, kind: 0 },
    ];
    const done = [false, false, false];
    expect(noteFor(notes, done, 0, 1050, tune)).toBe(0);
    expect(noteFor(notes, done, 1, 990, tune)).toBe(1);
    expect(noteFor(notes, done, 2, 1000, tune)).toBe(-1);
    expect(noteFor(notes, done, 0, 500, tune)).toBe(-1); // far too early for anything
    done[0] = true;
    expect(noteFor(notes, done, 0, 1300, tune)).toBe(2);
    expect(noteFor(notes, done, 0, 1000 + tune.goodMs + 50, tune)).toBe(2);
  });

  it('needs 70% of the data to win, and gives stars at 70, 85 and 95%', () => {
    expect(signalWon(7, 10)).toBe(true);
    expect(signalWon(6, 10)).toBe(false);
    expect(signalWon(69, 100)).toBe(false);
    expect(signalWon(70, 100)).toBe(true);
    expect(signalWon(23, 33)).toBe(false); // 69.7%
    expect(signalWon(24, 33)).toBe(true);
    expect(signalWon(0, 0)).toBe(false);
    expect(sentShare(5, 10)).toBe(0.5);
    expect(starsFor(signalGoals(70, 100))).toBe(1);
    expect(starsFor(signalGoals(85, 100))).toBe(2);
    expect(starsFor(signalGoals(95, 100))).toBe(3);
    expect(starsFor(signalGoals(69, 100))).toBe(0);
  });
});

describe('shared rules', () => {
  it('turns any level into 1, 2 or 3', () => {
    expect(levelOf(undefined)).toBe(1);
    expect(levelOf(2)).toBe(2);
    expect(levelOf(3)).toBe(3);
    expect(levelOf(7)).toBe(1);
  });

  it('gives no stars without the first goal', () => {
    expect(starsFor([false, true, true])).toBe(0);
    expect(starsFor([true, false, true])).toBe(2);
  });
});

describe('mini-game texts', () => {
  it('have the same keys in both languages, all starting with mg.', () => {
    expect(Object.keys(minigamesRu).sort()).toEqual(Object.keys(minigamesEn).sort());
    for (const key of Object.keys(minigamesEn)) expect(key.startsWith('mg.')).toBe(true);
  });

  it('use the same placeholders in both languages', () => {
    const names = (text: string): string[] => [...new Set([...text.matchAll(/\{(\w+)/g)].map((match) => match[1]))].sort();
    for (const [key, text] of Object.entries(minigamesEn)) {
      expect(text.trim(), key).not.toBe('');
      expect(names(minigamesRu[key] ?? ''), key).toEqual(names(text));
    }
  });
});
