/**
 * Downloads the NASA photos shown in the Science log.
 *
 * Source: NASA Image and Video Library (https://images.nasa.gov).
 * The list of pictures, with NASA ids and credit lines, is in data/codex-images.json.
 *
 * Run:  node scripts/fetch-images.ts
 * Output:
 *   public/img/codex/<id>.jpg        small copies (about 640 px wide)
 *   src/data/codex-images.json       credit line and NASA page for each picture
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST = path.join(ROOT, 'data', 'codex-images.json');
const OUT_DIR = path.join(ROOT, 'public', 'img', 'codex');
const OUT_CREDITS = path.join(ROOT, 'src', 'data', 'codex-images.json');

interface Entry {
  id: string;
  nasa_id: string | null;
  title: string;
  date: string;
  credit: string;
  url_small: string;
  url_medium: string;
  page_url: string;
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main(): Promise<void> {
  const list = JSON.parse(await readFile(LIST, 'utf8')) as Entry[];
  await mkdir(OUT_DIR, { recursive: true });
  const credits: Record<string, { title: string; credit: string; page: string; date: string }> = {};
  for (const entry of list) {
    if (!entry.nasa_id) continue;
    try {
      let bytes: Buffer;
      try {
        bytes = await download(entry.url_small);
      } catch {
        bytes = await download(entry.url_medium);
      }
      await writeFile(path.join(OUT_DIR, `${entry.id}.jpg`), bytes);
      credits[entry.id] = { title: entry.title, credit: entry.credit, page: entry.page_url, date: entry.date };
      console.log(`ok   ${entry.id}  ${(bytes.length / 1024).toFixed(0)} KB  ${entry.credit}`);
    } catch (error) {
      console.log(`FAIL ${entry.id}: ${String(error)}`);
    }
  }
  await writeFile(OUT_CREDITS, JSON.stringify(credits, null, 2));
  console.log(`Wrote ${path.relative(ROOT, OUT_CREDITS)} (${Object.keys(credits).length} pictures)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
