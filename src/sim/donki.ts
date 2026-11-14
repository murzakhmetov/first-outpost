/**
 * NASA DONKI reducer.
 *
 * DONKI = "Space Weather Database Of Notifications, Knowledge, Information",
 * run by NASA's Community Coordinated Modeling Center (CCMC) and the
 * Moon to Mars Space Weather Analysis Office (M2M).
 * https://ccmc.gsfc.nasa.gov/tools/DONKI/
 *
 * This file turns raw DONKI records into one small record per calendar day.
 * The same code runs in two places:
 *   - scripts/fetch-donki.ts  (builds the offline archive shipped with the game)
 *   - src/game/data.ts        (reads the live API in the browser)
 *
 * It must stay dependency-free and use only erasable TypeScript syntax,
 * because Node runs it directly with type stripping.
 */

export interface RawInstrument {
  displayName?: string;
}

export interface RawFlare {
  flrID?: string;
  peakTime?: string | null;
  beginTime?: string | null;
  classType?: string | null;
  activeRegionNum?: number | null;
  link?: string | null;
}

export interface RawSep {
  sepID?: string;
  eventTime?: string | null;
  instruments?: RawInstrument[] | null;
  link?: string | null;
}

export interface RawKp {
  kpIndex?: number;
  observedTime?: string;
}

export interface RawGst {
  gstID?: string;
  startTime?: string | null;
  allKpIndex?: RawKp[] | null;
  link?: string | null;
}

export interface RawEnlilImpact {
  location?: string;
  arrivalTime?: string;
  isGlancingBlow?: boolean;
}

export interface RawEnlil {
  simulationID?: string;
  cmeInputs?: { speed?: number | null }[] | null;
  impactList?: RawEnlilImpact[] | null;
  link?: string | null;
}

export interface RawDonki {
  flr?: RawFlare[];
  sep?: RawSep[];
  gst?: RawGst[];
  enlil?: RawEnlil[];
}

/**
 * One calendar day (UTC) of space weather. Every field is optional:
 * a missing field means "nothing notable was recorded".
 */
export interface SwDay {
  /** Strongest solar flare that day, e.g. "X5.8". Only M and X class are kept. */
  f?: string;
  /** DONKI record number of that flare (for the public link). */
  fi?: number;
  /** Sunspot group (active region) number of that flare. */
  ar?: number;
  /** Number of M-class flares. */
  m?: number;
  /** Number of X-class flares. */
  x?: number;
  /**
   * Solar energetic particle (SEP) event measured near Earth and the Moon.
   * 1 = seen by SOHO/ACE particle detectors, 2 = GOES >=10 MeV proton event,
   * 3 = GOES >=100 MeV protons (very energetic, hardest to shield).
   */
  s?: number;
  /** DONKI record number of that SEP event. */
  si?: number;
  /** SEP seen by a STEREO spacecraft (elsewhere in the solar system). */
  st?: number;
  /** SEP measured at Mars (MAVEN or Curiosity RAD), when DONKI lists one. */
  ms?: number;
  /** DONKI record number of the Mars SEP event. */
  msi?: number;
  /** Highest Kp index (0-9) of a geomagnetic storm at Earth. */
  k?: number;
  /** DONKI record number of that geomagnetic storm. */
  ki?: number;
  /** NASA WSA-ENLIL model: a solar eruption (CME) reaches Mars. 2 = direct hit, 1 = glancing blow. */
  ma?: number;
  /** DONKI record number of that WSA-ENLIL simulation. */
  mi?: number;
  /** Speed of that eruption in km/s. */
  mv?: number;
}

export type SwDayMap = Record<string, SwDay>;

const FLARE_BASE: Record<string, number> = { A: 1e-8, B: 1e-7, C: 1e-6, M: 1e-5, X: 1e-4 };

/** Peak X-ray flux in W/m^2 for a flare class string such as "M3.2" or "X5.8". */
export function flareValue(cls: string | null | undefined): number {
  if (!cls) return 0;
  const match = /^([ABCMX])\s*([\d.]+)?/i.exec(cls.trim());
  if (!match) return 0;
  const base = FLARE_BASE[match[1].toUpperCase()] ?? 0;
  const mult = match[2] ? parseFloat(match[2]) : 1;
  return base * (Number.isFinite(mult) ? mult : 1);
}

/** "2024-05-10T06:27Z" -> "2024-05-10". Returns "" for bad input. */
export function dayKey(timestamp: string | null | undefined): string {
  if (!timestamp || timestamp.length < 10) return '';
  const key = timestamp.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : '';
}

/** Pulls the record number out of a DONKI link like ".../DONKI/view/FLR/30548/-1". */
export function donkiId(link: string | null | undefined): number | undefined {
  if (!link) return undefined;
  const match = /\/view\/[^/]+\/(\d+)\//.exec(link);
  return match ? parseInt(match[1], 10) : undefined;
}

/** Public web page for a DONKI record. */
export function donkiLink(kind: 'FLR' | 'SEP' | 'GST' | 'WSA-ENLIL', id: number | undefined): string {
  if (!id) return 'https://ccmc.gsfc.nasa.gov/tools/DONKI/';
  return `https://ccmc.gsfc.nasa.gov/DONKI/view/${kind}/${id}/-1`;
}

/**
 * How strong is a particle storm near Earth/Moon, judged by which instrument saw it.
 * Returns { near, stereo, mars }.
 */
export function sepStrength(instruments: RawInstrument[] | null | undefined): {
  near: number;
  stereo: number;
  mars: number;
} {
  let near = 0;
  let stereo = 0;
  let mars = 0;
  for (const inst of instruments ?? []) {
    const name = (inst.displayName ?? '').toUpperCase();
    if (!name || name.startsWith('MODEL')) continue; // forecasts are not measurements
    if (name.includes('MAVEN') || name.includes('MSL') || name.includes('MARS')) {
      mars = Math.max(mars, 2);
    } else if (name.includes('STEREO')) {
      stereo = 1;
    } else if (name.includes('GOES')) {
      near = Math.max(near, name.includes('100 MEV') ? 3 : 2);
    } else if (name.includes('SOHO') || name.includes('ACE')) {
      near = Math.max(near, 1);
    }
  }
  return { near, stereo, mars };
}

function slot(days: SwDayMap, key: string): SwDay {
  let day = days[key];
  if (!day) {
    day = {};
    days[key] = day;
  }
  return day;
}

/** Reduce raw DONKI records to a sparse map of notable days. */
export function reduceDonki(raw: RawDonki): SwDayMap {
  const days: SwDayMap = {};
  const best: Record<string, number> = {};

  for (const flare of raw.flr ?? []) {
    const key = dayKey(flare.peakTime ?? flare.beginTime);
    const value = flareValue(flare.classType);
    if (!key || value < 1e-5) continue; // keep M and X class only
    const day = slot(days, key);
    if (value >= 1e-4) day.x = (day.x ?? 0) + 1;
    else day.m = (day.m ?? 0) + 1;
    if (value > (best[key] ?? 0)) {
      best[key] = value;
      day.f = (flare.classType ?? '').trim();
      const id = donkiId(flare.link);
      if (id) day.fi = id;
      else delete day.fi;
      if (flare.activeRegionNum) day.ar = flare.activeRegionNum;
      else delete day.ar;
    }
  }

  for (const sep of raw.sep ?? []) {
    const key = dayKey(sep.eventTime);
    if (!key) continue;
    const strength = sepStrength(sep.instruments);
    if (!strength.near && !strength.stereo && !strength.mars) continue;
    const day = slot(days, key);
    const id = donkiId(sep.link);
    if (strength.near > (day.s ?? 0)) {
      day.s = strength.near;
      if (id) day.si = id;
    }
    if (strength.stereo) day.st = 1;
    if (strength.mars > (day.ms ?? 0)) {
      day.ms = strength.mars;
      if (id) day.msi = id;
    }
  }

  for (const storm of raw.gst ?? []) {
    const id = donkiId(storm.link);
    for (const kp of storm.allKpIndex ?? []) {
      const key = dayKey(kp.observedTime);
      const value = kp.kpIndex ?? 0;
      if (!key || value < 5) continue;
      const day = slot(days, key);
      const rounded = Math.round(value * 100) / 100;
      if (rounded > (day.k ?? 0)) {
        day.k = rounded;
        if (id) day.ki = id;
      }
    }
  }

  for (const sim of raw.enlil ?? []) {
    let speed = 0;
    for (const cme of sim.cmeInputs ?? []) speed = Math.max(speed, cme.speed ?? 0);
    const id = donkiId(sim.link);
    for (const impact of sim.impactList ?? []) {
      if ((impact.location ?? '').toLowerCase() !== 'mars') continue;
      const key = dayKey(impact.arrivalTime);
      if (!key) continue;
      const level = impact.isGlancingBlow ? 1 : 2;
      const day = slot(days, key);
      const better = level > (day.ma ?? 0) || (level === (day.ma ?? 0) && speed > (day.mv ?? 0));
      if (better) {
        day.ma = level;
        if (id) day.mi = id;
        // The speed belongs to the simulation that won the day; drop an older one.
        if (speed) day.mv = Math.round(speed);
        else delete day.mv;
      }
    }
  }

  return days;
}

/** Sort a day map by date so the JSON file is stable and diff-friendly. */
export function sortDays(days: SwDayMap): SwDayMap {
  const out: SwDayMap = {};
  for (const key of Object.keys(days).sort()) out[key] = days[key];
  return out;
}
