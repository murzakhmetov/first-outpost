/**
 * The rock analysis game without any screen code. The rover's laser makes a
 * tiny spark on a rock, and the spark's light, spread out into a rainbow, shows
 * coloured lines. Every element has its own pattern of lines; each rock here
 * is two elements together.
 *
 * The lines sit at their real wavelengths: the brightest visible lines of each
 * element in the NIST Atomic Spectra Database, the same kind of lines the ChemCam
 * laser on Curiosity reads. How bright each line is drawn is simplified, and the
 * screen says so.
 */
import type { Level, Site } from './score';

export type El = 'H' | 'Na' | 'Ca' | 'Fe' | 'Mg' | 'S';
export const ELEMENTS: readonly El[] = ['H', 'Na', 'Ca', 'Fe', 'Mg', 'S'];

/** A line: where it sits on the strip (0 violet end, 100 red end) and how bright it is (0 to 1). */
export type Line = readonly [number, number];

/** The strip shows visible light from 380 nm (violet) to 700 nm (red). */
export const STRIP_NM: readonly [number, number] = [380, 700];

/** Where a wavelength (nm, in air) sits on the strip. */
export function atNm(nm: number): number {
  return Math.round(((nm - STRIP_NM[0]) / (STRIP_NM[1] - STRIP_NM[0])) * 10000) / 100;
}

/**
 * Real lines, wavelengths in nm from the NIST Atomic Spectra Database
 * (https://physics.nist.gov/PhysRefData/ASD/lines_form.html). For each element the
 * game keeps a few of the brightest visible lines that are at least 3% of the strip
 * away from every other element's lines, so a child can tell them apart.
 * Brightness follows NIST's relative intensities, roughly.
 */
const NM: Record<El, readonly (readonly [number, number])[]> = {
  // Hydrogen: the Balmer lines H-gamma, H-beta, H-alpha.
  H: [
    [434.05, 0.6],
    [486.13, 0.7],
    [656.28, 1],
  ],
  // Sodium: the yellow D lines, so close together that they look like one.
  Na: [
    [589.0, 1],
    [589.59, 0.75],
  ],
  // Calcium: the violet H and K lines of the calcium ion, and the blue 422.7 nm line.
  Ca: [
    [393.37, 1],
    [396.85, 0.95],
    [422.67, 0.8],
  ],
  // Iron: hundreds of lines; four bright ones from violet to red.
  Fe: [
    [381.58, 1],
    [495.76, 0.7],
    [532.8, 1],
    [640.0, 0.8],
  ],
  // Magnesium: the green "b" triplet, and a blue line of the magnesium ion.
  Mg: [
    [448.11, 0.6],
    [516.73, 0.95],
    [517.27, 0.97],
    [518.36, 1],
  ],
  // Sulfur: green lines of the sulfur ion.
  S: [
    [545.38, 1],
    [550.97, 0.75],
    [560.62, 0.75],
  ],
};

/** The same lines as places on the strip. */
export const LINES = {} as Record<El, readonly Line[]>;
for (const el of ELEMENTS) LINES[el] = NM[el].map(([nm, strength]): Line => [atNm(nm), strength]);
export type RockLook = 'rust' | 'vein' | 'salt' | 'layers' | 'specks' | 'holes' | 'sulfur' | 'ice';

export interface Rock {
  id: string;
  els: readonly [El, El];
  color: string;
  look: RockLook;
}

export const ROCKS: Record<Site, Rock[]> = {
  mars: [
    { id: 'lava', els: ['Fe', 'Mg'], color: '#4d3d38', look: 'rust' },
    { id: 'vein', els: ['Ca', 'S'], color: '#9a4b33', look: 'vein' },
    { id: 'salt', els: ['Mg', 'S'], color: '#b98a5e', look: 'salt' },
    { id: 'clay', els: ['Fe', 'H'], color: '#a35a40', look: 'layers' },
  ],
  moon: [
    { id: 'highland', els: ['Ca', 'Na'], color: '#c4c6cf', look: 'specks' },
    { id: 'lava', els: ['Fe', 'Mg'], color: '#4c4f5c', look: 'holes' },
    { id: 'polar', els: ['Fe', 'S'], color: '#8d909c', look: 'sulfur' },
    { id: 'crater', els: ['H', 'Mg'], color: '#5b6276', look: 'ice' },
  ],
};

export interface SpectroTune {
  rounds: number;
  /** Rocks to solve for a win. */
  toWin: number;
  /** Element cards to pick from: the rock's two and the rest are decoys. */
  cards: number;
  /** The rock's lines light up as soon as a picked element matches them. */
  live: boolean;
  /** Little ticks under the rock's strip show where the picked elements' lines would be. */
  ticks: boolean;
}

export const SPECTRO_LEVELS: Record<Level, SpectroTune> = {
  1: { rounds: 3, toWin: 2, cards: 4, live: true, ticks: true },
  2: { rounds: 3, toWin: 2, cards: 5, live: false, ticks: true },
  3: { rounds: 4, toWin: 3, cards: 6, live: false, ticks: false },
};

/** Guesses for each rock: after a wrong one, the player may look again and try once more. */
export const TRIES = 2;

export interface Round {
  rock: Rock;
  /** The rock's two elements and some others, in random order. */
  cards: El[];
}

function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rand() * (i + 1)));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function makeRounds(site: Site, tune: SpectroTune, rand: () => number = Math.random): Round[] {
  const decoys = Math.max(0, Math.min(ELEMENTS.length - 2, tune.cards - 2));
  return shuffled(ROCKS[site], rand)
    .slice(0, tune.rounds)
    .map((rock) => ({
      rock,
      cards: shuffled([...rock.els, ...shuffled(ELEMENTS.filter((el) => !rock.els.includes(el)), rand).slice(0, decoys)], rand),
    }));
}

export interface RockLine {
  at: number;
  strength: number;
  el: El;
}

/** All the lines in a rock's light, from the violet end to the red end. */
export function rockLines(rock: Rock): RockLine[] {
  return rock.els.flatMap((el) => LINES[el].map(([at, strength]) => ({ at, strength, el }))).sort((a, b) => a.at - b.at);
}

/** Right when the two picked elements are exactly the rock's two. */
export function isRight(picked: readonly El[], rock: Rock): boolean {
  return picked.length === 2 && picked.every((el) => rock.els.includes(el)) && picked[0] !== picked[1];
}

/** The three star goals: enough rocks solved; at most one wrong guess; no wrong guess at all. */
export function spectroGoals(solved: number, wrong: number, tune: SpectroTune): [boolean, boolean, boolean] {
  const won = solved >= tune.toWin;
  return [won, won && wrong <= 1, won && wrong === 0];
}
