/**
 * Turns the daily NASA DONKI records into "what did the Sun do this week?"
 * and "how strong was the particle storm at our outpost?".
 */
import type { SwDayMap } from './donki';
import { flareValue } from './donki';
import { addDays } from './ephemeris';
import { MARS_RAD_EVENTS } from './sites';
import type { SiteId, StormInfo, WeekSun } from './types';

export function summarizeWeek(days: SwDayMap, dateFrom: string, length = 7): WeekSun {
  const sun: WeekSun = {
    dateFrom,
    dateTo: addDays(dateFrom, length - 1),
    mFlares: 0,
    xFlares: 0,
    topFlare: null,
    nearSep: null,
    marsSep: null,
    marsCme: null,
    kp: null,
    activity: 0,
  };
  let topValue = 0;

  for (let i = 0; i < length; i++) {
    const date = addDays(dateFrom, i);
    const day = days[date];
    if (!day) continue;
    sun.mFlares += day.m ?? 0;
    sun.xFlares += day.x ?? 0;
    if (day.f) {
      const value = flareValue(day.f);
      if (value > topValue) {
        topValue = value;
        sun.topFlare = { cls: day.f, date, id: day.fi, region: day.ar };
      }
    }
    if (day.s && day.s > (sun.nearSep?.strength ?? 0)) {
      sun.nearSep = { strength: day.s, date, id: day.si };
    }
    if (day.ms && day.ms > (sun.marsSep?.strength ?? 0)) {
      sun.marsSep = { strength: day.ms, date, id: day.msi };
    }
    if (day.ma) {
      const better =
        !sun.marsCme || day.ma > sun.marsCme.level || (day.ma === sun.marsCme.level && (day.mv ?? 0) > (sun.marsCme.speed ?? 0));
      if (better) sun.marsCme = { level: day.ma, date, id: day.mi, speed: day.mv };
    }
    if (day.k && day.k > (sun.kp?.value ?? 0)) {
      sun.kp = { value: day.k, date, id: day.ki };
    }
  }

  const sep = sun.nearSep?.strength ?? 0;
  if (sep >= 3 || sun.xFlares >= 3 || (sun.kp?.value ?? 0) >= 8.5) sun.activity = 3;
  else if (sep >= 1 || sun.xFlares >= 1 || (sun.kp?.value ?? 0) >= 7) sun.activity = 2;
  else if (sun.mFlares >= 3 || (sun.kp?.value ?? 0) >= 5) sun.activity = 1;
  return sun;
}

/** Speed (km/s) above which a solar eruption aimed at Mars counts as a storm risk. */
export const MARS_CME_FAST = 900;
/** Speed (km/s) above which that risk is rated strong. */
export const MARS_CME_VERY_FAST = 1500;

function clampStrength(value: number): 0 | 1 | 2 | 3 {
  return Math.max(0, Math.min(3, Math.round(value))) as 0 | 1 | 2 | 3;
}

/**
 * How strong was the particle storm at the outpost this week?
 *
 * Moon: the Moon sits next to Earth, so particle storms measured by the GOES and
 * SOHO spacecraft near Earth are the storms the Moon gets.
 *
 * Mars: Mars sees a different side of the Sun. We use (1) storms that Curiosity's
 * RAD instrument measured on the surface, (2) DONKI particle events measured at Mars,
 * and (3) NASA's WSA-ENLIL model runs that predict a solar eruption reaching Mars.
 */
export function stormAt(site: SiteId, sun: WeekSun): StormInfo {
  if (site === 'moon') {
    if (sun.nearSep) {
      return {
        strength: clampStrength(sun.nearSep.strength),
        basis: 'sep',
        date: sun.nearSep.date,
        id: sun.nearSep.id,
        kind: 'SEP',
      };
    }
    return { strength: 0, basis: 'none', date: sun.dateFrom };
  }

  for (const event of MARS_RAD_EVENTS) {
    if (event.date >= sun.dateFrom && event.date <= sun.dateTo) {
      return { strength: event.strength, basis: 'rad', date: event.date, url: event.url };
    }
  }
  if (sun.marsSep) {
    return { strength: 2, basis: 'sep', date: sun.marsSep.date, id: sun.marsSep.id, kind: 'SEP' };
  }
  if (sun.marsCme && sun.marsCme.level >= 2) {
    // Only direct hits by fast eruptions count: a fast eruption drives a shock wave
    // that can speed up particles. Slow or glancing eruptions are ignored.
    const speed = sun.marsCme.speed ?? 0;
    if (speed >= MARS_CME_FAST) {
      return {
        strength: speed >= MARS_CME_VERY_FAST ? 2 : 1,
        basis: 'cme',
        date: sun.marsCme.date,
        id: sun.marsCme.id,
        kind: 'WSA-ENLIL',
      };
    }
  }
  return { strength: 0, basis: 'none', date: sun.dateFrom };
}

