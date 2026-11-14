/**
 * The landing simulator without any screen code. A lander falls towards a pad
 * under the real gravity of Mars (3.71 m/s²) or the Moon (1.62 m/s²). The main
 * engine pushes up while it is held; small side jets push left or right. Both
 * use fuel. Touch down slowly enough, on the pad, to win.
 *
 * Units are metres and seconds. The time runs at the real rate: the descent
 * starts low (100-180 m, like the last part of a real landing), which makes a
 * round last about 20 to 40 seconds. On the Moon things fall more slowly, so
 * the Moon round starts lower than the Mars one.
 */
import type { Level, Site } from './score';

/** Real surface gravity, m/s². */
export const GRAVITY: Record<Site, number> = { mars: 3.71, moon: 1.62 };
export const EARTH_GRAVITY = 9.81;

/** The lander cannot fly past this far from the middle of the pad (m): the map ends there. */
export const WORLD_HALF = 46;

export interface LanderTune {
  site: Site;
  level: Level;
  /** Gravity, m/s². */
  g: number;
  /** Push of the main engine at full power, m/s²: a bit more than twice the gravity, so it can slow the fall. */
  thrust: number;
  /** Push of the side jets, m/s². */
  side: number;
  startAlt: number;
  /** Speed at the start, m/s; below zero is down. */
  startVy: number;
  /** Distance from the middle of the pad at the start, m. The side is picked at random. */
  startX: number;
  /** Sideways drift at the start, away from the pad, m/s. */
  startVx: number;
  /** Fuel, in seconds of main engine at full power. */
  fuel: number;
  /** Fuel the side jets use, in the same seconds, per second of use. */
  sideFuel: number;
  /** Half the width of the landing pad, m. */
  padHalf: number;
  /** Fastest safe touchdown, m/s down. */
  safeVy: number;
  /** A gentle touchdown, m/s down: one of the star goals. */
  gentleVy: number;
  /** Fastest safe sideways speed at touchdown, m/s. */
  safeVx: number;
  /** Close to the middle of the pad, m: one of the star goals. */
  bullseye: number;
  /** Strongest gust of wind, m/s² sideways. Only Mars has air to blow. */
  wind: number;
  /** Game seconds per real second. */
  timeScale: number;
}

interface LevelSet {
  alt: Record<Site, number>;
  vy: number;
  x: number;
  vx: number;
  fuel: number;
  padHalf: number;
  safeVy: number;
  gentleVy: number;
  safeVx: number;
  bullseye: number;
  marsWind: number;
}

const LEVELS: Record<Level, LevelSet> = {
  1: { alt: { moon: 100, mars: 150 }, vy: -2, x: 0, vx: 0, fuel: 32, padHalf: 11, safeVy: 3.5, gentleVy: 1.8, safeVx: 2, bullseye: 3.5, marsWind: 0 },
  2: { alt: { moon: 110, mars: 165 }, vy: -3, x: 13, vx: 0.5, fuel: 25, padHalf: 8, safeVy: 3, gentleVy: 1.5, safeVx: 1.6, bullseye: 2.5, marsWind: 0.12 },
  3: { alt: { moon: 120, mars: 180 }, vy: -4, x: 22, vx: 0.9, fuel: 20, padHalf: 6, safeVy: 2.5, gentleVy: 1.2, safeVx: 1.3, bullseye: 1.8, marsWind: 0.3 },
};

export function landerTune(site: Site, level: Level): LanderTune {
  const set = LEVELS[level];
  const g = GRAVITY[site];
  return {
    site,
    level,
    g,
    thrust: g * 2.3,
    side: site === 'mars' ? 1.2 : 0.8,
    startAlt: set.alt[site],
    startVy: set.vy,
    startX: set.x,
    startVx: set.vx,
    fuel: set.fuel,
    sideFuel: 0.3,
    padHalf: set.padHalf,
    safeVy: set.safeVy,
    gentleVy: set.gentleVy,
    safeVx: set.safeVx,
    bullseye: set.bullseye,
    wind: site === 'mars' ? set.marsWind : 0,
    timeScale: 1,
  };
}

export interface LanderInput {
  thrust: boolean;
  /** -1 pushes left, 1 pushes right. */
  side: -1 | 0 | 1;
}

export type LandingResult = 'soft' | 'hard' | 'slide' | 'missed';

export interface Landing {
  won: boolean;
  result: LandingResult;
  /** Speed down at touchdown, m/s. */
  speed: number;
  /** Sideways speed at touchdown, m/s. */
  drift: number;
  /** Distance from the middle of the pad, m. */
  off: number;
  /** Share of the fuel left, 0 to 1. */
  fuelLeft: number;
  /** Game seconds from the start. */
  time: number;
}

export interface Lander {
  t: number;
  /** Metres from the middle of the pad; right is positive. */
  x: number;
  /** Height of the lander's feet above the pad, m. */
  y: number;
  vx: number;
  vy: number;
  fuel: number;
  /** The main engine is firing right now (held, and fuel left). */
  burning: boolean;
  /** The side jets are pushing: -1 left, 1 right. */
  jet: -1 | 0 | 1;
  /** The wind's push right now, m/s². */
  gust: number;
  /** Picks the wind's rhythm. */
  seed: number;
  landing: Landing | null;
}

export function newLander(tune: LanderTune, rand: () => number = Math.random): Lander {
  const side = rand() < 0.5 ? -1 : 1;
  return {
    t: 0,
    x: side * tune.startX,
    y: tune.startAlt,
    vx: side * tune.startVx,
    vy: tune.startVy,
    fuel: tune.fuel,
    burning: false,
    jet: 0,
    gust: 0,
    seed: Math.floor(rand() * 1000),
    landing: null,
  };
}

const smooth = (edge0: number, edge1: number, value: number): number => {
  const k = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return k * k * (3 - 2 * k);
};

/** Height of the ground (m) at `x`: flat on the pad, bumpy rock around it, rising into low hills far away. */
export function groundAt(x: number, padHalf: number): number {
  const away = Math.abs(x);
  const rough = 0.7 + 0.55 * Math.sin(0.37 * x + 1.3) + 0.35 * Math.sin(1.1 * x + 0.4) + 0.25 * Math.abs(Math.sin(2.3 * x));
  const hills = 7 * smooth(padHalf + 8, WORLD_HALF + 4, away) * (0.75 + 0.25 * Math.sin(0.21 * x + 0.6));
  return (Math.max(0, rough) + hills) * smooth(padHalf + 0.4, padHalf + 2.2, away);
}

/** The wind's push from -1 to 1: it swells and fades slowly, as gusts do. */
export function gustAt(t: number, seed: number): number {
  return Math.sin(0.33 * t + seed) * (0.65 + 0.35 * Math.sin(0.83 * t + seed * 0.37));
}

/** What a touchdown means: too fast down, too fast sideways, off the pad, or a good landing. */
export function judgeLanding(lander: Lander, tune: LanderTune): Landing {
  const speed = Math.max(0, -lander.vy);
  const drift = Math.abs(lander.vx);
  const off = Math.abs(lander.x);
  const result: LandingResult = speed > tune.safeVy ? 'hard' : drift > tune.safeVx ? 'slide' : off > tune.padHalf ? 'missed' : 'soft';
  return { won: result === 'soft', result, speed, drift, off, fuelLeft: tune.fuel > 0 ? lander.fuel / tune.fuel : 0, time: lander.t };
}

const SUB_STEP = 1 / 120;

/** Move the lander on by `dt` real seconds, in small even steps so every screen gives the same flight. */
export function stepLander(lander: Lander, input: LanderInput, dt: number, tune: LanderTune): Lander {
  let left = Math.max(0, dt) * tune.timeScale;
  while (left > 1e-9 && !lander.landing) {
    const step = Math.min(SUB_STEP, left);
    left -= step;
    const burning = input.thrust && lander.fuel > 0;
    const jet = lander.fuel > 0 ? input.side : 0;
    lander.burning = burning;
    lander.jet = jet;
    lander.gust = tune.wind ? tune.wind * gustAt(lander.t, lander.seed) : 0;
    lander.vy += ((burning ? tune.thrust : 0) - tune.g) * step;
    lander.vx += (jet * tune.side + lander.gust) * step;
    lander.x += lander.vx * step;
    lander.y += lander.vy * step;
    lander.t += step;
    lander.fuel = Math.max(0, lander.fuel - ((burning ? 1 : 0) + (jet ? tune.sideFuel : 0)) * step);
    if (Math.abs(lander.x) > WORLD_HALF) {
      lander.x = Math.sign(lander.x) * WORLD_HALF;
      lander.vx = 0;
    }
    const ceiling = tune.startAlt * 1.2;
    if (lander.y > ceiling) {
      lander.y = ceiling;
      lander.vy = Math.min(0, lander.vy);
    }
    const ground = groundAt(lander.x, tune.padHalf);
    if (lander.y <= ground) {
      lander.landing = judgeLanding(lander, tune);
      lander.y = ground;
      lander.burning = false;
      lander.jet = 0;
    }
  }
  return lander;
}

/** The three star goals: land safely on the pad; touch down gently; land in the middle. */
export function landerGoals(landing: Landing | null, tune: LanderTune): [boolean, boolean, boolean] {
  const won = !!landing?.won;
  return [won, won && (landing?.speed ?? 99) <= tune.gentleVy, won && (landing?.off ?? 99) <= tune.bullseye];
}
