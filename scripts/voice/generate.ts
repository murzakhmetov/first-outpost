/**
 * Makes the game's voice-over: turns film lines and Lumi's lines into MP3 files with the ElevenLabs API.
 *
 *   npm run voice -- --dry-run     (plan only: no network, no key needed; note the `--` before the flags)
 *   npm run voice                  (generate what is new or changed; needs ELEVENLABS_API_KEY in the environment)
 *
 * Put the key in the shell's environment without typing it into the command line (it would stay in the shell
 * history): in Git Bash `read -rs ELEVENLABS_API_KEY && export ELEVENLABS_API_KEY`, in PowerShell
 * `$env:ELEVENLABS_API_KEY = Read-Host`. See docs/VOICE.md.
 *
 * Flags: --dry-run  --budget <credits> (default 30000)  --only films|lumi|cards  --lang en|ru
 *        --model <id> (e.g. eleven_turbo_v2_5)  --prune (drop files no line uses)
 *
 * The key is read ONLY from the process environment. It is never written to a file or printed.
 * Voices and their settings are in voices.json. See docs/VOICE.md.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  collectLines,
  creditsPerChar,
  emptyManifest,
  fileName,
  loadDicts,
  manifestKey,
  planLines,
  redact,
  requestSpeech,
  summarize,
  summarizeCategories,
} from './lib.ts';
import type { Dicts, Lang, LineKind, Manifest, Plan, VoiceConfig } from './lib.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(HERE, '../../public/voice');

export interface RunDeps {
  env: Record<string, string | undefined>;
  fetchFn: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  log: (text: string) => void;
  outDir: string;
  cfg: VoiceConfig;
  dicts: Dicts;
}

export interface RunResult {
  code: number;
  generated: number;
  failed: number;
  stopped?: 'auth' | 'quota' | 'model';
  plan?: Plan;
}

/** No file yet: an empty manifest. A file that cannot be read stops the run (it would be paid for again). */
function readManifest(path: string): Manifest {
  if (!existsSync(path)) return emptyManifest();
  const data = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
  if (!data || data.version !== 1 || !data.lines || typeof data.lines !== 'object') throw new Error('not a voice manifest');
  return data;
}

function writeManifest(path: string, manifest: Manifest): void {
  const lines: Manifest['lines'] = {};
  for (const key of Object.keys(manifest.lines).sort()) lines[key] = manifest.lines[key];
  writeFileSync(path, `${JSON.stringify({ version: 1, lines }, null, 1)}\n`);
}

const pad = (text: string | number, width: number): string => String(text).padEnd(width);

function printPlan(plan: Plan, perChar: number, log: (text: string) => void, verbose: boolean): void {
  const counts: Record<string, number> = {};
  for (const line of plan.lines) counts[line.status] = (counts[line.status] ?? 0) + 1;
  log(`Lines: ${plan.lines.length}  (${Object.entries(counts).map(([status, n]) => `${n} ${status}`).join(', ')})`);
  const summary = summarize(plan, perChar);
  log('To generate now:');
  log(`  ${pad('lang', 5)}${pad('speaker', 9)}${pad('lines', 7)}${pad('chars', 8)}credits`);
  for (const row of summary.rows) log(`  ${pad(row.lang, 5)}${pad(row.speaker, 9)}${pad(row.lines, 7)}${pad(row.chars, 8)}${row.credits}`);
  log(`  ${pad('total', 14)}${pad(summary.lines, 7)}${pad(summary.chars, 8)}${summary.credits}  (unique texts sent: ${plan.jobs.length})`);
  log(`Budget ${plan.budget} credits for the whole voiced set: ${plan.cachedCredits} already made + ${plan.credits} new = ${plan.cachedCredits + plan.credits}.`);
  log('Per category (planned lines, in priority order; a text shared by two keys counts once):');
  log(`  ${pad('category', 16)}${pad('lines', 12)}${pad('chars', 8)}credits`);
  for (const row of summarizeCategories(plan, perChar)) {
    const name = row.part ? `  cards: ${row.part}` : row.kind;
    log(`  ${pad(name, 16)}${pad(`${row.planned}/${row.total}`, 12)}${pad(row.chars, 8)}${row.credits}`);
  }
  const whole = summarizeCategories(plan, perChar).filter((row) => !row.part);
  log(`  ${pad('total', 16)}${pad(`${whole.reduce((sum, row) => sum + row.planned, 0)}/${whole.reduce((sum, row) => sum + row.total, 0)}`, 12)}${pad(whole.reduce((sum, row) => sum + row.chars, 0), 8)}${whole.reduce((sum, row) => sum + row.credits, 0)}`);
  const out = plan.lines.filter((line) => line.status === 'over-budget' || line.status.startsWith('skipped'));
  if (out.length) {
    // One row per key, with its languages.
    const rows = new Map<string, string[]>();
    for (const line of out) {
      const why = line.status === 'over-budget' ? 'over budget' : `skipped, ${line.status.replace('skipped-', '')}`;
      const id = `${why}: ${line.key}`;
      rows.set(id, [...(rows.get(id) ?? []), line.lang]);
    }
    log(`Left out (${rows.size} lines):`);
    for (const [id, langs] of rows) log(`  ${id} [${langs.join(',')}]`);
  }
  if (verbose) {
    log('Lines in:');
    for (const line of plan.lines) if (line.text !== null && !['over-budget'].includes(line.status)) log(`  [${line.status}] ${line.lang}:${line.key} (${line.speaker}, ${line.chars}) ${line.text}`);
  }
}

export async function run(argv: string[], deps: RunDeps): Promise<RunResult> {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      budget: { type: 'string', default: '30000' },
      only: { type: 'string' },
      lang: { type: 'string' },
      model: { type: 'string' },
      prune: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
    },
  });
  const { log, cfg } = deps;
  const budget = Number(values.budget);
  if (!Number.isFinite(budget) || budget < 0) {
    log('--budget needs a number of credits, for example --budget 30000');
    return { code: 2, generated: 0, failed: 0 };
  }
  if (values.only !== undefined && values.only !== 'films' && values.only !== 'lumi' && values.only !== 'cards') {
    log('--only is films, lumi or cards');
    return { code: 2, generated: 0, failed: 0 };
  }
  if (values.lang !== undefined && values.lang !== 'en' && values.lang !== 'ru') {
    log('--lang is en or ru');
    return { code: 2, generated: 0, failed: 0 };
  }
  if (values.prune && (values.only || values.lang)) {
    log('--prune needs the whole plan: leave out --only and --lang');
    return { code: 2, generated: 0, failed: 0 };
  }
  const only = values.only as LineKind | undefined;
  const lang = values.lang as Lang | undefined;
  const model = values.model ?? cfg.model;
  const perChar = creditsPerChar(cfg, model);
  if (perChar === undefined) {
    log(`The model "${model}" has no price in voices.json (models). Add it with its creditsPerChar so the budget is right.`);
    return { code: 2, generated: 0, failed: 0 };
  }
  // `npm run voice --dry-run` (no `--`) makes npm eat the flag: treat that as a dry run, never as a paid one.
  const dryRun = !!values['dry-run'] || deps.env.npm_config_dry_run === 'true';
  const apiKey = (deps.env.ELEVENLABS_API_KEY ?? '').trim();
  if (!dryRun && !apiKey) {
    log('ELEVENLABS_API_KEY is not set. Put it in the shell environment for this one command (never in a file), or use --dry-run.');
    return { code: 1, generated: 0, failed: 0 };
  }

  const manifestPath = join(deps.outDir, 'manifest.json');
  let manifest: Manifest;
  try {
    manifest = readManifest(manifestPath);
  } catch (error) {
    log(`${manifestPath} cannot be read (${(error as Error).message}). Fix or delete it first; nothing was sent.`);
    return { code: 1, generated: 0, failed: 0 };
  }
  const lines = collectLines(cfg, deps.dicts, { only, lang, model });
  // Made lines outside this run (the other language, or the other kind) still count toward the budget.
  const inScope = new Set(lines.map((line) => manifestKey(line.lang, line.key)));
  const outside = new Map<string, number>();
  for (const [id, entry] of Object.entries(manifest.lines)) if (!inScope.has(id)) outside.set(entry.file, entry.chars);
  const reserved = [...outside.values()].reduce((sum, count) => sum + count * perChar, 0);
  const plan = planLines(lines, manifest, (file) => existsSync(join(deps.outDir, file)), budget, perChar, reserved);
  log(`Model ${model}, ${perChar} credit per character.`);
  printPlan(plan, perChar, log, !!values.verbose);
  if (dryRun) {
    log('Dry run: nothing was sent and nothing was written.');
    return { code: 0, generated: 0, failed: 0, plan };
  }

  mkdirSync(deps.outDir, { recursive: true });
  const entriesFor = new Map<string, typeof plan.lines>();
  for (const line of plan.lines) {
    if (line.status !== 'new' && line.status !== 'shared') continue;
    const list = entriesFor.get(line.hash) ?? [];
    list.push(line);
    entriesFor.set(line.hash, list);
  }
  for (const line of plan.lines) {
    if (line.status === 'cached') manifest.lines[manifestKey(line.lang, line.key)] = { file: fileName(line.hash), hash: line.hash, chars: line.chars, speaker: line.speaker };
  }

  let generated = 0;
  let failed = 0;
  let spent = 0;
  let stopped: RunResult['stopped'];
  try {
    for (const job of plan.jobs) {
      const result = await requestSpeech({ fetchFn: deps.fetchFn, apiKey, cfg, model, speaker: job.speaker, lang: job.lang, text: job.text, sleep: deps.sleep });
      if (!result.ok) {
        const message = redact(result.message, apiKey);
        if (result.fatal) {
          stopped = result.fatal;
          log(`Stopped (${result.fatal}): HTTP ${result.status} ${message}`);
          break;
        }
        failed += 1;
        log(`Failed ${job.lang}/${job.speaker} "${job.text.slice(0, 40)}": HTTP ${result.status} ${message}`);
        continue;
      }
      writeFileSync(join(deps.outDir, fileName(job.hash)), result.data);
      for (const line of entriesFor.get(job.hash) ?? []) {
        manifest.lines[manifestKey(line.lang, line.key)] = { file: fileName(job.hash), hash: job.hash, chars: line.chars, speaker: line.speaker };
      }
      generated += 1;
      spent += job.chars * perChar;
      writeManifest(manifestPath, manifest);
      log(`  ok ${job.lang}/${job.speaker} ${job.chars} chars  (${generated}/${plan.jobs.length})`);
    }
  } finally {
    // A key whose text changed must not keep playing the old text. Old entries stay while the run was cut short
    // (an old voice is better than none), and go once the run has finished.
    if (!stopped) {
      for (const line of plan.lines) {
        const id = manifestKey(line.lang, line.key);
        if (manifest.lines[id] && manifest.lines[id].hash !== line.hash) delete manifest.lines[id];
      }
    }
    // The manifest always says what exists, even after a stop.
    for (const [hash, list] of entriesFor) {
      if (!existsSync(join(deps.outDir, fileName(hash)))) continue;
      for (const line of list) manifest.lines[manifestKey(line.lang, line.key)] ??= { file: fileName(hash), hash, chars: line.chars, speaker: line.speaker };
    }
    if (values.prune && !stopped) {
      const wanted = new Set(plan.lines.filter((line) => line.text !== null).map((line) => manifestKey(line.lang, line.key)));
      for (const id of Object.keys(manifest.lines)) if (!wanted.has(id)) delete manifest.lines[id];
      const used = new Set(Object.values(manifest.lines).map((entry) => entry.file));
      for (const name of readdirSync(deps.outDir)) if (name.endsWith('.mp3') && !used.has(name)) rmSync(join(deps.outDir, name));
    }
    writeManifest(manifestPath, manifest);
  }

  const missing = plan.lines.filter((line) => line.text !== null && !manifest.lines[manifestKey(line.lang, line.key)]);
  log('');
  log(`Done: ${generated} files generated, ${failed} failed, about ${spent} credits spent.`);
  log(`Manifest: ${Object.keys(manifest.lines).length} lines voiced; ${missing.length} planned lines still have no file.`);
  if (stopped === 'quota') log('The quota is used up. Run again after it resets (or on another plan): finished lines are kept.');
  if (stopped === 'auth') log('The key was refused. Check ELEVENLABS_API_KEY.');
  if (stopped === 'model') log(`The model "${model}" was refused. Try: npm run voice -- --model ${cfg.fallbackModel ?? 'eleven_turbo_v2_5'}`);
  return { code: stopped || failed ? 1 : 0, generated, failed, stopped, plan };
}

export function loadConfig(): VoiceConfig {
  return JSON.parse(readFileSync(join(HERE, 'voices.json'), 'utf8')) as VoiceConfig;
}

// Run only when started from the command line, not when the tests import this file.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await run(process.argv.slice(2), {
    env: process.env,
    fetchFn: fetch,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    log: (text) => console.log(text),
    outDir: DEFAULT_OUT,
    cfg: loadConfig(),
    dicts: loadDicts(),
  });
  process.exitCode = result.code;
}
