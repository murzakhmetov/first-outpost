/**
 * Builds the space-weather archive that ships with the game.
 *
 * Source: NASA DONKI (CCMC / Moon to Mars Space Weather Analysis Office)
 *   https://ccmc.gsfc.nasa.gov/tools/DONKI/
 *
 * Run:  node scripts/fetch-donki.ts            (Node 22.18+ or 24)
 *       node scripts/fetch-donki.ts --latest   (only refresh the last 90 days)
 *
 * Output:
 *   src/data/spaceweather.json            full archive, one record per notable day
 *   public/data/spaceweather-latest.json  last 90 days, refreshed daily by CI
 *
 * Raw API answers are cached in data/raw/donki so a re-run only downloads what is new.
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reduceDonki, sortDays } from '../src/sim/donki.ts';
import type { RawDonki, SwDayMap } from '../src/sim/donki.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw', 'donki');
const OUT_ARCHIVE = path.join(ROOT, 'src', 'data', 'spaceweather.json');
const OUT_LATEST = path.join(ROOT, 'public', 'data', 'spaceweather-latest.json');
const BASE = process.env.DONKI_BASE ?? 'https://ccmc.gsfc.nasa.gov/DONKI/WS/get';

const TYPES = ['FLR', 'SEP', 'GST', 'WSAEnlilSimulations'] as const;
type DonkiType = (typeof TYPES)[number];

const CHUNK_DAYS = 30; // the API refuses ranges longer than 60 days
const ARCHIVE_START = '2010-04-01'; // DONKI records begin in spring 2010
const LATEST_DAYS = 90;
const DAY_MS = 86_400_000;

const args = new Set(process.argv.slice(2));
const latestOnly = args.has('--latest');
const force = args.has('--force');

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number): string {
  return iso(new Date(Date.parse(`${dateIso}T00:00:00Z`) + days * DAY_MS));
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson(url: string): Promise<unknown[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`);
      if (!text.trim()) return []; // DONKI answers with an empty body when nothing happened
      const parsed: unknown = JSON.parse(text);
      // Anything but a list (an error object, a message) is a failed request, not "no events".
      if (!Array.isArray(parsed)) throw new Error(`DONKI did not send a list: ${text.slice(0, 120)}`);
      return parsed;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw new Error(`Failed after retries: ${url} (${String(lastError)})`);
}

/** Keep only the fields the reducer reads, so the raw cache stays small. */
function slim(type: DonkiType, records: unknown[]): unknown[] {
  return records.map((record) => {
    const r = record as Record<string, any>;
    switch (type) {
      case 'FLR':
        return {
          flrID: r.flrID,
          peakTime: r.peakTime,
          beginTime: r.beginTime,
          classType: r.classType,
          activeRegionNum: r.activeRegionNum,
          link: r.link,
        };
      case 'SEP':
        return { sepID: r.sepID, eventTime: r.eventTime, instruments: r.instruments, link: r.link };
      case 'GST':
        return { gstID: r.gstID, startTime: r.startTime, allKpIndex: r.allKpIndex, link: r.link };
      case 'WSAEnlilSimulations':
        return {
          simulationID: r.simulationID,
          cmeInputs: (r.cmeInputs ?? []).map((c: any) => ({ speed: c.speed })),
          impactList: r.impactList,
          link: r.link,
        };
    }
  });
}

async function loadChunk(type: DonkiType, from: string, to: string, today: string): Promise<unknown[]> {
  const file = path.join(RAW_DIR, `${type}_${from}_${to}.json`);
  // Recent records can still be revised by NASA analysts, so always refresh the last weeks.
  const settled = to < addDays(today, -21);
  if (!force && settled && (await exists(file))) {
    return JSON.parse(await readFile(file, 'utf8')) as unknown[];
  }
  const url = `${BASE}/${type}?startDate=${from}&endDate=${to}`;
  const records = slim(type, await fetchJson(url));
  await writeFile(file, JSON.stringify(records));
  await new Promise((resolve) => setTimeout(resolve, 120)); // be polite to the server
  return records;
}

function dedupe<T extends Record<string, any>>(records: T[], idField: string): T[] {
  const seen = new Map<string, T>();
  for (const record of records) {
    const id = String(record[idField] ?? JSON.stringify(record));
    seen.set(id, record);
  }
  return [...seen.values()];
}

async function collect(from: string, to: string, today: string): Promise<RawDonki> {
  const raw: Record<DonkiType, any[]> = { FLR: [], SEP: [], GST: [], WSAEnlilSimulations: [] };
  let cursor = from;
  let chunkIndex = 0;
  while (cursor <= to) {
    const end = addDays(cursor, CHUNK_DAYS - 1) > to ? to : addDays(cursor, CHUNK_DAYS - 1);
    const results = await Promise.all(TYPES.map((type) => loadChunk(type, cursor, end, today)));
    TYPES.forEach((type, index) => raw[type].push(...results[index]));
    chunkIndex++;
    if (chunkIndex % 12 === 0) {
      console.log(`  ... ${cursor} done (${raw.FLR.length} flares so far)`);
    }
    cursor = addDays(end, 1);
  }
  return {
    flr: dedupe(raw.FLR, 'flrID'),
    sep: dedupe(raw.SEP, 'sepID'),
    gst: dedupe(raw.GST, 'gstID'),
    enlil: dedupe(raw.WSAEnlilSimulations, 'simulationID'),
  };
}

function countBy<T>(items: T[], pick: (item: T) => string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) for (const key of pick(item)) out[key] = (out[key] ?? 0) + 1;
  return out;
}

function within(days: SwDayMap, from: string, to: string): SwDayMap {
  const out: SwDayMap = {};
  for (const key of Object.keys(days)) if (key >= from && key <= to) out[key] = days[key];
  return out;
}

async function main(): Promise<void> {
  const today = iso(new Date());
  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(path.dirname(OUT_ARCHIVE), { recursive: true });
  await mkdir(path.dirname(OUT_LATEST), { recursive: true });

  const latestFrom = addDays(today, -(LATEST_DAYS - 1));
  const from = latestOnly ? latestFrom : ARCHIVE_START;
  console.log(`DONKI: downloading ${from} .. ${today} from ${BASE}`);
  const raw = await collect(from, today, today);
  // The Sun is never silent for weeks: an answer with no records at all means the service failed,
  // and writing it would wipe real storms from the game. Stop without changing any file.
  if (!raw.flr?.length && !raw.sep?.length && !raw.gst?.length && !raw.enlil?.length) {
    throw new Error(`DONKI sent no records at all for ${from} .. ${today}; not writing anything.`);
  }
  const days = sortDays(reduceDonki(raw));

  const source = {
    name: 'NASA DONKI — Space Weather Database Of Notifications, Knowledge, Information',
    provider: 'NASA CCMC / Moon to Mars Space Weather Analysis Office',
    url: 'https://ccmc.gsfc.nasa.gov/tools/DONKI/',
    api: BASE,
  };

  const latest = {
    source,
    fetchedAt: new Date().toISOString(),
    from: latestFrom,
    to: today,
    days: within(days, latestFrom, today),
  };
  await writeFile(OUT_LATEST, JSON.stringify(latest));
  console.log(`Wrote ${path.relative(ROOT, OUT_LATEST)} (${Object.keys(latest.days).length} notable days)`);

  if (!latestOnly) {
    const archive = {
      source,
      fetchedAt: new Date().toISOString(),
      from,
      to: today,
      counts: {
        flares: raw.flr?.length ?? 0,
        sepEvents: raw.sep?.length ?? 0,
        geomagneticStorms: raw.gst?.length ?? 0,
        enlilSimulations: raw.enlil?.length ?? 0,
        notableDays: Object.keys(days).length,
      },
      days,
    };
    await writeFile(OUT_ARCHIVE, JSON.stringify(archive));
    console.log(`Wrote ${path.relative(ROOT, OUT_ARCHIVE)}`, archive.counts);
    console.log('SEP instruments:', countBy(raw.sep ?? [], (s) => (s.instruments ?? []).map((i) => i.displayName ?? '?')));
    console.log('ENLIL impact locations:', countBy(raw.enlil ?? [], (s) => (s.impactList ?? []).map((i) => i.location ?? '?')));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
