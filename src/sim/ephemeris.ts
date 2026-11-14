/**
 * Where are Earth, Mars and the Moon on a given date?
 *
 * The game uses this to turn a real calendar date into:
 *   - the real Earth-Mars distance and radio delay,
 *   - how strong sunlight is at Mars that week,
 *   - the Mars season (solar longitude, Ls),
 *   - the Moon's phase (which sets where the Sun sits on the lunar horizon).
 *
 * Planet positions use NASA JPL's "Approximate Positions of the Planets"
 * (Keplerian elements valid 1800-2050, E. M. Standish):
 *   https://ssd.jpl.nasa.gov/planets/approx_pos.html
 * Mars solar longitude uses the Mars24 algorithm (Allison & McEwen 2000):
 *   https://www.giss.nasa.gov/tools/mars24/help/algorithm.html
 */

const DEG = Math.PI / 180;
export const AU_KM = 149_597_870.7;
/** Light travel time for one astronomical unit, in seconds. */
export const AU_LIGHT_SECONDS = 499.004784;
export const LIGHT_SPEED_KM_S = 299_792.458;
const DAY_MS = 86_400_000;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

interface Elements {
  a: [number, number];
  e: [number, number];
  inc: [number, number];
  L: [number, number];
  peri: [number, number];
  node: [number, number];
}

// [value at J2000, change per Julian century]
const EARTH_MOON_BARYCENTER: Elements = {
  a: [1.00000261, 0.00000562],
  e: [0.01671123, -0.00004392],
  inc: [-0.00001531, -0.01294668],
  L: [100.46457166, 35999.37244981],
  peri: [102.93768193, 0.32327364],
  node: [0, 0],
};

const MARS: Elements = {
  a: [1.52371034, 0.00001847],
  e: [0.0933941, 0.00007882],
  inc: [1.84969142, -0.00813131],
  L: [-4.55343205, 19140.30268499],
  peri: [-23.94362959, 0.44441088],
  node: [49.55953891, -0.29257343],
};

export type Vec3 = [number, number, number];

export function parseDate(dateIso: string): number {
  return Date.parse(dateIso.length <= 10 ? `${dateIso}T12:00:00Z` : dateIso);
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(dateIso: string, days: number): string {
  return toIso(Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`) + days * DAY_MS);
}

/** Days since the J2000 epoch (2000-01-01 12:00). */
export function daysSinceJ2000(ms: number): number {
  return (ms - J2000_MS) / DAY_MS;
}

function wrap180(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function wrap360(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** Heliocentric position in the J2000 ecliptic plane, in astronomical units. */
export function heliocentric(elements: Elements, ms: number): Vec3 {
  const T = daysSinceJ2000(ms) / 36525;
  const a = elements.a[0] + elements.a[1] * T;
  const e = elements.e[0] + elements.e[1] * T;
  const inc = (elements.inc[0] + elements.inc[1] * T) * DEG;
  const L = elements.L[0] + elements.L[1] * T;
  const peri = elements.peri[0] + elements.peri[1] * T;
  const node = elements.node[0] + elements.node[1] * T;

  const argPeri = (peri - node) * DEG;
  const nodeRad = node * DEG;
  const M = wrap180(L - peri) * DEG;

  // Solve Kepler's equation E - e sin E = M.
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) {
    const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-10) break;
  }

  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cw = Math.cos(argPeri);
  const sw = Math.sin(argPeri);
  const co = Math.cos(nodeRad);
  const so = Math.sin(nodeRad);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);

  return [
    (cw * co - sw * so * ci) * xp + (-sw * co - cw * so * ci) * yp,
    (cw * so + sw * co * ci) * xp + (-sw * so + cw * co * ci) * yp,
    sw * si * xp + cw * si * yp,
  ];
}

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export interface MarsGeometry {
  /** Earth-Mars distance in astronomical units. */
  distanceAu: number;
  distanceKm: number;
  /** One-way radio travel time in seconds. */
  lightSeconds: number;
  /** Mars-Sun distance in astronomical units. */
  sunAu: number;
  /** Sunlight power at Mars compared with the average at Mars (1 = average). */
  sunlightFactor: number;
  /** Sunlight power above the atmosphere, W/m^2. */
  solarConstant: number;
  /** Angle between the Sun and Mars as seen from Earth, degrees. Small = solar conjunction. */
  elongationDeg: number;
  /** Mars solar longitude Ls, degrees (0 = northern spring equinox). */
  ls: number;
}

const MARS_MEAN_SUN_AU = 1.5237;
const SOLAR_CONSTANT_EARTH = 1361; // W/m^2 at 1 AU

export function marsGeometry(dateIso: string): MarsGeometry {
  const ms = parseDate(dateIso);
  const earth = heliocentric(EARTH_MOON_BARYCENTER, ms);
  const mars = heliocentric(MARS, ms);
  const toMars: Vec3 = [mars[0] - earth[0], mars[1] - earth[1], mars[2] - earth[2]];
  const distanceAu = length(toMars);
  const sunAu = length(mars);
  const earthSun = length(earth);
  // Angle at Earth between the direction to the Sun (-earth) and to Mars.
  const dot = -(earth[0] * toMars[0] + earth[1] * toMars[1] + earth[2] * toMars[2]);
  const elongationDeg = Math.acos(Math.max(-1, Math.min(1, dot / (earthSun * distanceAu)))) / DEG;
  return {
    distanceAu,
    distanceKm: distanceAu * AU_KM,
    lightSeconds: distanceAu * AU_LIGHT_SECONDS,
    sunAu,
    sunlightFactor: (MARS_MEAN_SUN_AU / sunAu) ** 2,
    solarConstant: SOLAR_CONSTANT_EARTH / sunAu ** 2,
    elongationDeg,
    ls: marsSolarLongitude(ms),
  };
}

/** Mars season angle Ls in degrees, Mars24 algorithm. */
export function marsSolarLongitude(ms: number): number {
  const d = daysSinceJ2000(ms);
  const M = (19.3871 + 0.52402073 * d) * DEG;
  const alphaFms = 270.3871 + 0.524038496 * d;
  const equationOfCenter =
    (10.691 + 3.0e-7 * d) * Math.sin(M) +
    0.623 * Math.sin(2 * M) +
    0.05 * Math.sin(3 * M) +
    0.005 * Math.sin(4 * M) +
    0.0005 * Math.sin(5 * M);
  return wrap360(alphaFms + equationOfCenter);
}

/** Dusty season on Mars: southern spring and summer, Ls 180-360 degrees. */
export function isMarsDustSeason(ls: number): boolean {
  return ls >= 180 && ls < 360;
}

export interface MoonGeometry {
  distanceKm: number;
  /** One-way radio travel time in seconds. */
  lightSeconds: number;
  /** 0 = new moon, 0.5 = full moon, as seen from Earth. */
  phase: number;
  /** Mean elongation of the Moon from the Sun, degrees 0-360. */
  elongationDeg: number;
}

export function moonGeometry(dateIso: string): MoonGeometry {
  const d = daysSinceJ2000(parseDate(dateIso));
  const elongationDeg = wrap360(297.8502 + 12.19074912 * d); // mean elongation D
  const anomaly = wrap360(134.9634 + 13.06499295 * d) * DEG; // Moon's mean anomaly M'
  const distanceKm = 385_000.56 - 20_905.355 * Math.cos(anomaly);
  return {
    distanceKm,
    lightSeconds: distanceKm / LIGHT_SPEED_KM_S,
    phase: elongationDeg / 360,
    elongationDeg,
  };
}

/**
 * Galactic cosmic rays get weaker when the Sun is active and stronger when it is quiet.
 * Curiosity RAD measured about 0.21 mGy/day on Mars near solar maximum and about
 * 0.32 mGy/day in the deep solar minimum of 2019-2020: a ratio of about 1.5.
 * This returns a simple multiplier (about 0.8 at solar maximum, 1.28 at solar minimum),
 * built from the date of the last solar minimum (December 2019) and the ~11-year cycle.
 * It is a simplified model, not a measurement.
 */
export function cosmicRayFactor(dateIso: string): number {
  const year = 1970 + parseDate(dateIso) / (365.2425 * DAY_MS);
  const peakOfCosmicRays = 2020.5; // cosmic rays peak a few months after solar minimum
  return 1.04 + 0.24 * Math.cos((2 * Math.PI * (year - peakOfCosmicRays)) / 11);
}

/**
 * Lunar south pole sunlight model.
 *
 * At the pole the Sun never climbs high: it circles the horizon once per lunar month.
 * Mountains block it for part of each month. LRO studies found ridge sites near
 * Shackleton crater that are sunlit most of the time, with dark spells of a few days.
 * We model the horizon with two blocked sectors (one long, one short).
 * Returns the fraction of the given days that are sunlit (0-1).
 */
export function lunarPoleSunlight(dateIso: string, days = 7): number {
  const start = daysSinceJ2000(Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`));
  const steps = days * 8;
  let lit = 0;
  for (let i = 0; i < steps; i++) {
    const d = start + (i + 0.5) / 8;
    const azimuth = wrap360(297.8502 + 12.19074912 * d + 38); // Sun's compass direction at the pole
    const blocked = (azimuth >= 100 && azimuth < 150) || (azimuth >= 285 && azimuth < 300);
    if (!blocked) lit++;
  }
  return lit / steps;
}
