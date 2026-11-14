/**
 * The two outpost sites and the difficulty levels.
 *
 * Numbers marked REAL come from NASA measurements (see docs/NASA_DATA.md for sources).
 * Numbers marked GAME are tuning values chosen so that a 10-week mission is fair and fun.
 */
import type { Difficulty, SiteId } from './types';

export interface SiteDef {
  id: SiteId;
  /** REAL. Surface gravity, m/s^2. */
  gravity: number;
  /** REAL. Length of one day-night cycle, in Earth hours. */
  dayHours: number;
  /** REAL. Galactic cosmic ray dose with no shelter, mSv per day. */
  gcrPerDay: number;
  /** GAME (scaled from real events). Dose of a particle storm with no shelter, by strength 0-3, mSv. */
  stormDose: [number, number, number, number];
  /** GAME. Energy cells from the solar panels in a normal week. */
  solarCells: number;
  /** GAME. Radiation budget for the surface stay, mSv (commander level, 10 weeks). */
  doseBudget: number;
  /** GAME. Fraction of solar power lost each week as dust settles on the panels. */
  dustPerWeek: number;
}

export const SITES: Record<SiteId, SiteDef> = {
  mars: {
    id: 'mars',
    gravity: 3.71,
    dayHours: 24.6597,
    // Curiosity RAD, Gale Crater: 0.67 mSv per day, measured in 2012-2013 near solar maximum.
    // The mid-cycle value used here gives 0.67 at solar maximum and about 1.07 at solar minimum.
    gcrPerDay: 0.84,
    // The thin Mars air blocks most storm particles. The biggest surge Curiosity
    // has measured (20 May 2024) was about 8 mGy.
    stormDose: [0, 1.5, 4, 9],
    solarCells: 7,
    // The trip to Mars and back already uses most of a crew's radiation allowance,
    // so the budget for the surface stay is small.
    doseBudget: 72,
    dustPerWeek: 0.05,
  },
  moon: {
    id: 'moon',
    gravity: 1.62,
    dayHours: 708.7,
    // Lunar surface: 1.37 mSv per day, measured by the Chang'E-4 lander in 2019 at solar minimum
    // (Zhang et al. 2020, Science Advances). The mid-cycle value used here gives 1.37 at solar minimum.
    gcrPerDay: 1.07,
    // No air and no magnetic field: storm particles hit the surface directly.
    stormDose: [0, 5, 24, 60],
    solarCells: 8,
    doseBudget: 86,
    dustPerWeek: 0,
  },
};

export interface DifficultyDef {
  id: Difficulty;
  solarBonus: number;
  batteryCap: number;
  batteryStart: number;
  airStart: number;
  /** Starting food as a fraction of the mission length. */
  foodFactor: number;
  doseFactor: number;
  stormFactor: number;
  eventChance: number;
  dustStormChance: number;
  /** Multiplier for air lost when life support is under-powered. */
  airLoss: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  cadet: {
    id: 'cadet',
    solarBonus: 1,
    batteryCap: 5,
    batteryStart: 2,
    airStart: 100,
    foodFactor: 0.75,
    doseFactor: 1.2,
    stormFactor: 0.8,
    eventChance: 0.75,
    dustStormChance: 0.3,
    airLoss: 0.75,
  },
  commander: {
    id: 'commander',
    solarBonus: 0,
    batteryCap: 4,
    batteryStart: 2,
    airStart: 82,
    foodFactor: 0.65,
    doseFactor: 1,
    stormFactor: 1,
    eventChance: 0.85,
    dustStormChance: 0.45,
    airLoss: 1,
  },
  legend: {
    id: 'legend',
    solarBonus: 0,
    batteryCap: 3,
    batteryStart: 1,
    airStart: 74,
    foodFactor: 0.56,
    doseFactor: 0.88,
    stormFactor: 1.25,
    eventChance: 0.95,
    dustStormChance: 0.65,
    airLoss: 1.12,
  },
};

/** Air change per week for life-support power levels 0-4. */
export const LIFE_AIR = [-38, -24, -11, 0, 10] as const;
/** Crop growth per week for greenhouse power levels 0-3. */
export const FARM_GROW = [0, 0.5, 1, 1.5] as const;
/** Weeks of growth before harvest. Radishes took 27 days on the ISS, lettuce about 33. */
export const CROP_WEEKS = 4;
/** Weeks of food from one harvest. */
export const HARVEST_FOOD = 1.5;
/** Science points per lab power level per week. */
export const SCIENCE_PER_LEVEL = 5;
/** Shield built per cell of power. Ten cells finish the shield. */
export const SHIELD_PER_CELL = 0.1;
/** A full regolith shield cuts cosmic-ray dose by this fraction. Cosmic rays are hard to stop. */
export const SHIELD_VS_COSMIC = 0.35;
/** A full regolith shield cuts particle-storm dose by this fraction. */
export const SHIELD_VS_STORM = 0.85;
/** The storm shelter cuts particle-storm dose to this fraction. */
export const SHELTER_FACTOR = 0.1;
/** Extra storm dose, as a fraction of the full dose, when caught outdoors. */
export const CAUGHT_OUTSIDE = 0.8;
/** Science multiplier in a week spent partly in the storm shelter. */
export const SHELTER_SCIENCE = 0.6;
/** Air used per second of walking outside (airlock losses, suit oxygen, cooling water). */
export const EVA_AIR_PER_SECOND = 1 / 8;
/**
 * How long an urgent card can wait for Earth's answer, in seconds (a game number). The radio
 * round trip to Mars is the real one for the week: about 6 to 15 minutes in the months around
 * opposition, when Earth's advice comes in time, and longer the rest of the time, when the crew
 * must decide alone.
 */
export const URGENT_WAIT_SECONDS = 15 * 60;

/** Longest walk, in real seconds. Stands for one working day in a suit. */
export const EVA_MAX_SECONDS = 70;
/** Science stars: points needed per mission week for 2 and 3 stars. */
export const STAR_SCIENCE_PER_WEEK = { two: 10, three: 16 } as const;

/** Real solar events that Curiosity's RAD instrument measured on the Mars surface. */
export const MARS_RAD_EVENTS: { date: string; strength: 2 | 3; url: string }[] = [
  {
    date: '2017-09-11',
    strength: 2,
    url: 'https://www.jpl.nasa.gov/news/large-solar-storm-sparks-global-aurora-and-doubles-radiation-levels-on-the-martian-surface/',
  },
  {
    date: '2021-10-28',
    strength: 2,
    url: 'https://www.jpl.nasa.gov/news/how-nasas-curiosity-rover-is-making-mars-safer-for-astronauts/',
  },
  {
    date: '2024-05-20',
    strength: 3,
    url: 'https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/',
  },
];

/** The 2018 global dust storm that ended the Opportunity rover's mission. */
export const GLOBAL_DUST_STORM_2018 = { from: '2018-06-04', to: '2018-07-22' };

/** Total lunar eclipses: seen from the Moon, Earth blocks the Sun. (NASA eclipse pages.) */
export const TOTAL_LUNAR_ECLIPSES = [
  '2010-12-21',
  '2011-06-15',
  '2011-12-10',
  '2014-04-15',
  '2014-10-08',
  '2015-04-04',
  '2015-09-28',
  '2018-01-31',
  '2018-07-27',
  '2019-01-21',
  '2021-05-26',
  '2022-05-16',
  '2022-11-08',
  '2025-03-14',
  '2025-09-07',
  '2026-03-03',
];

export interface FeaturedWindow {
  id: string;
  /** The famous day. The mission starts two weeks earlier, so it lands in week 3. */
  anchor: string;
  sites: SiteId[];
}

/** Famous stretches of real space weather that players can pick. */
export const FEATURED_WINDOWS: FeaturedWindow[] = [
  { id: 'may2024', anchor: '2024-05-10', sites: ['moon', 'mars'] },
  { id: 'oct2024', anchor: '2024-10-03', sites: ['moon', 'mars'] },
  { id: 'sep2017', anchor: '2017-09-10', sites: ['moon', 'mars'] },
  { id: 'oct2021', anchor: '2021-10-28', sites: ['moon', 'mars'] },
  { id: 'dust2018', anchor: '2018-06-10', sites: ['mars'] },
  { id: 'quiet2019', anchor: '2019-12-15', sites: ['moon', 'mars'] },
];
