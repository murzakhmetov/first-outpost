/**
 * Loads the real NASA data the simulation runs on.
 *
 * Three layers, newest wins:
 *   1. the archive built into the game (2010 to the build date),
 *   2. a small "latest 90 days" file that a scheduled job can refresh daily,
 *   3. a live request to NASA DONKI from the player's browser, when online.
 * The game always says which one it is using. It never calls saved data "live".
 */
import { signal } from '@preact/signals';
import { reduceDonki } from '../sim/donki';
import type { RawDonki, SwDayMap } from '../sim/donki';
import { addDays } from '../sim/ephemeris';
import type { MarsWeatherMap, SimData } from '../sim/types';

interface ArchiveFile {
  fetchedAt: string;
  from: string;
  to: string;
  counts?: { flares: number; sepEvents: number; geomagneticStorms: number; enlilSimulations: number; notableDays: number };
  days: SwDayMap;
}

interface WeatherFile {
  fetchedAt: string;
  from: string;
  to: string;
  days: MarsWeatherMap;
}

export interface DataInfo {
  archiveFrom: string;
  /** Last date covered by the space-weather data now in memory. */
  sunTo: string;
  /** When the newest space-weather data was fetched from NASA (ISO time). */
  sunFetchedAt: string;
  /** True when that fetch happened in this session, straight from NASA. */
  live: boolean;
  counts: { flares: number; sepEvents: number; geomagneticStorms: number; enlilSimulations: number };
  marsFrom: string;
  marsTo: string;
  marsSols: number;
}

const DONKI_API = 'https://ccmc.gsfc.nasa.gov/DONKI/WS/get';
const LIVE_CACHE_KEY = 'fo.live';

let sun: SwDayMap = {};
let marsWeather: MarsWeatherMap | null = null;

export const dataInfo = signal<DataInfo>({
  archiveFrom: '2010-04-01',
  sunTo: '2026-11-11',
  sunFetchedAt: '',
  live: false,
  counts: { flares: 0, sepEvents: 0, geomagneticStorms: 0, enlilSimulations: 0 },
  marsFrom: '2012-08-16',
  marsTo: '2026-08-25',
  marsSols: 0,
});

export function simData(): SimData {
  return { sun, marsWeather };
}

/** A fetch timeout that also works where AbortSignal.timeout is missing (Safari before 16). */
function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** A data file (or a saved copy) that has the shape we need. */
function usable(file: ArchiveFile | null | undefined): file is ArchiveFile {
  return (
    !!file &&
    typeof file.from === 'string' &&
    typeof file.to === 'string' &&
    typeof file.fetchedAt === 'string' &&
    !!file.days &&
    typeof file.days === 'object' &&
    !Array.isArray(file.days)
  );
}

/** A copy fetched from DONKI in this browser less than 12 hours ago: no need to ask again yet. */
let recentCopy = false;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Days after `from` replace what we had: newer records are more complete. */
function merge(days: SwDayMap, from: string): void {
  if (!days || typeof days !== 'object' || typeof from !== 'string') return;
  for (const key of Object.keys(sun)) if (key >= from) delete sun[key];
  for (const key of Object.keys(days)) if (key >= from) sun[key] = days[key];
}

export async function loadData(): Promise<void> {
  const [archiveModule, weatherModule] = await Promise.all([
    import('../data/spaceweather.json'),
    import('../data/mars-weather.json'),
  ]);
  const archive = archiveModule.default as unknown as ArchiveFile;
  const weather = weatherModule.default as unknown as WeatherFile;
  sun = { ...archive.days };
  marsWeather = weather.days;

  let fetchedAt = archive.fetchedAt;
  let sunTo = archive.to;

  // The daily-refreshed file, if the site hosts a newer one.
  try {
    const response = await fetch('./data/spaceweather-latest.json', { cache: 'no-cache', signal: timeoutSignal(6000) });
    if (response.ok) {
      const latest = (await response.json()) as ArchiveFile;
      if (usable(latest) && latest.fetchedAt > fetchedAt) {
        merge(latest.days, latest.from);
        fetchedAt = latest.fetchedAt;
        sunTo = latest.to;
      }
    }
  } catch {
    /* offline or file missing: the built-in archive is enough */
  }

  // A copy saved earlier in this browser. It is shown with its date: "live" means fetched in this session.
  const live = false;
  try {
    const cached = JSON.parse(localStorage.getItem(LIVE_CACHE_KEY) ?? 'null') as ArchiveFile | null;
    if (usable(cached) && cached.fetchedAt > fetchedAt) {
      merge(cached.days, cached.from);
      fetchedAt = cached.fetchedAt;
      sunTo = cached.to;
      recentCopy = Date.now() - Date.parse(cached.fetchedAt) < 12 * 3600 * 1000;
    }
  } catch {
    /* ignore */
  }

  dataInfo.value = {
    archiveFrom: archive.from,
    sunTo: sunTo > today() ? today() : sunTo,
    sunFetchedAt: fetchedAt,
    live,
    counts: {
      flares: archive.counts?.flares ?? 0,
      sepEvents: archive.counts?.sepEvents ?? 0,
      geomagneticStorms: archive.counts?.geomagneticStorms ?? 0,
      enlilSimulations: archive.counts?.enlilSimulations ?? 0,
    },
    marsFrom: weather.from,
    marsTo: weather.to,
    marsSols: Object.keys(weather.days).length,
  };
}

async function fetchChunk(type: string, from: string, to: string): Promise<unknown[]> {
  const response = await fetch(`${DONKI_API}/${type}?startDate=${from}&endDate=${to}`, {
    signal: timeoutSignal(20_000),
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error(`DONKI ${type}: HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trim()) return []; // DONKI answers with an empty body when nothing happened
  const parsed: unknown = JSON.parse(text);
  // Anything but a list (an error message) is a failed request, not a quiet Sun.
  if (!Array.isArray(parsed)) throw new Error(`DONKI ${type}: not a list`);
  return parsed;
}

let liveRequest: Promise<boolean> | null = null;

/**
 * Ask NASA DONKI for the last 12 weeks. Resolves true when new data arrived.
 * The request holds only two dates and sends no referrer (like any web request, NASA's server
 * sees the network address and the browser type). Resolves false when nothing new was fetched.
 */
export function refreshLive(): Promise<boolean> {
  if (dataInfo.value.live || recentCopy) return Promise.resolve(false);
  if (liveRequest) return liveRequest;
  liveRequest = (async () => {
    try {
      const to = today();
      const from = addDays(to, -83);
      const middle = addDays(to, -42);
      const ranges: [string, string][] = [
        [from, middle],
        [addDays(middle, 1), to],
      ];
      const types = ['FLR', 'SEP', 'GST', 'WSAEnlilSimulations'] as const;
      const results = await Promise.all(
        types.map(async (type) => {
          const parts = await Promise.all(ranges.map(([a, b]) => fetchChunk(type, a, b)));
          return parts.flat();
        }),
      );
      // Twelve weeks with no record of any kind means the service failed: keep what we have.
      if (results.every((list) => list.length === 0)) return false;
      const raw: RawDonki = {
        flr: results[0] as RawDonki['flr'],
        sep: results[1] as RawDonki['sep'],
        gst: results[2] as RawDonki['gst'],
        enlil: results[3] as RawDonki['enlil'],
      };
      const days = reduceDonki(raw);
      merge(days, from);
      const fetchedAt = new Date().toISOString();
      try {
        localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify({ fetchedAt, from, to, days }));
      } catch {
        /* ignore */
      }
      dataInfo.value = { ...dataInfo.value, sunTo: to, sunFetchedAt: fetchedAt, live: true };
      return true;
    } catch {
      return false;
    } finally {
      liveRequest = null;
    }
  })();
  return liveRequest;
}

/** First day of a mission that ends on the newest day we have data for. */
export function liveStartDate(weeks: number): string {
  return addDays(dataInfo.value.sunTo, -(weeks * 7 - 1));
}
