/**
 * Builds the Mars weather archive that ships with the game.
 *
 * Source: REMS (Rover Environmental Monitoring Station) on NASA's Curiosity rover,
 * Gale Crater, Mars. Instrument provided by Centro de Astrobiologia (CSIC-INTA), Spain.
 * Public feed: https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json
 *
 * Run:  node scripts/fetch-rems.ts
 * Output: src/data/mars-weather.json
 *   days["YYYY-MM-DD"] = [sol, minAirTempC, maxAirTempC, pressurePa, solarLongitudeDeg]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'data', 'mars-weather.json');
const FEED = 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json';

function num(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

async function main(): Promise<void> {
  console.log(`REMS: downloading ${FEED}`);
  const response = await fetch(FEED, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const feed = (await response.json()) as { soles?: Record<string, unknown>[] };
  const sols = feed.soles ?? [];

  const days: Record<string, number[]> = {};
  let skipped = 0;
  for (const record of sols) {
    const date = String(record.terrestrial_date ?? '');
    const sol = num(record.sol);
    const min = num(record.min_temp);
    const max = num(record.max_temp);
    const pressure = num(record.pressure);
    const ls = num(record.ls);
    // Keep only physically sensible air temperatures; the feed has a few glitched rows.
    const ok =
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      sol !== null &&
      min !== null &&
      max !== null &&
      min > -140 &&
      min < 20 &&
      max > -110 &&
      max < 40 &&
      max >= min;
    if (!ok) {
      skipped++;
      continue;
    }
    days[date] = [sol!, Math.round(min!), Math.round(max!), pressure !== null ? Math.round(pressure) : 0, ls !== null ? Math.round(ls) : -1];
  }

  const sorted: Record<string, number[]> = {};
  for (const key of Object.keys(days).sort()) sorted[key] = days[key];
  const keys = Object.keys(sorted);
  // An empty or cut-off answer must not overwrite a good archive.
  if (keys.length < 1000) throw new Error(`REMS: only ${keys.length} sols in the feed, not writing the archive`);

  const out = {
    source: {
      name: 'REMS weather reports, NASA Curiosity rover (Mars Science Laboratory), Gale Crater',
      provider: 'NASA/JPL-Caltech and Centro de Astrobiologia (CSIC-INTA)',
      url: 'https://mars.nasa.gov/msl/weather/',
      api: FEED,
    },
    fetchedAt: new Date().toISOString(),
    from: keys[0],
    to: keys[keys.length - 1],
    fields: ['sol', 'minAirTempC', 'maxAirTempC', 'pressurePa', 'solarLongitudeDeg'],
    days: sorted,
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  console.log(`Wrote ${path.relative(ROOT, OUT)}: ${keys.length} sols (${out.from} .. ${out.to}), skipped ${skipped}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
