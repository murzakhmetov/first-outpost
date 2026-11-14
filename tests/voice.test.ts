import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, run } from '../scripts/voice/generate';
import type { RunDeps } from '../scripts/voice/generate';
import {
  cleanForSpeech,
  collectLines,
  creditsPerChar,
  emptyManifest,
  fileName,
  filmKeys,
  loadDicts,
  lineHash,
  lumiKeys,
  manifestKey,
  planLines,
  requestSpeech,
  spokenText,
  summarize,
} from '../scripts/voice/lib';
import type { Dicts, Manifest, VoiceConfig } from '../scripts/voice/lib';
import { FILMS, beatKey } from '../src/game/films';
import { decide, findEntry, parseManifest, playLine, stopLine, voiceId, voiceUrl } from '../src/game/voice';
import { en } from '../src/i18n/en';
import { filmsEn, filmsRu } from '../src/i18n/films';
import { ru } from '../src/i18n/ru';
import { voiceEn, voiceRu } from '../src/i18n/voice';

const cfg: VoiceConfig = loadConfig();
const dicts: Dicts = loadDicts();
const MODEL = cfg.model;
const PER_CHAR = creditsPerChar(cfg, MODEL) as number;
const SECRET = 'sk_test_SUPER_SECRET_KEY_0123456789';

describe('cleanForSpeech', () => {
  it('removes bold, glossary links and emoji', () => {
    expect(cleanForSpeech('A **strong** word and [[sol]] 🚀 ok ✨')).toBe('A strong word and sol ok');
  });
  it('says a glossary word by its name', () => {
    expect(cleanForSpeech('A day is a [[sol]].', (term) => (term === 'sol' ? 'sol (Mars day)' : undefined))).toBe('A day is a sol (Mars day).');
  });
  it('tidies spaces before punctuation', () => {
    expect(cleanForSpeech('Hello  , world !')).toBe('Hello, world!');
  });
});

describe('film lines with placeholders', () => {
  it('have a spoken, placeholder-free voice.* text in both languages', () => {
    const base = { en: { ...en, ...filmsEn }, ru: { ...ru, ...filmsRu } };
    const problems: string[] = [];
    for (const film of Object.values(FILMS)) {
      for (const site of ['mars', 'moon'] as const) {
        if (film.sites && !film.sites.includes(site)) continue;
        for (const beat of film.beats) {
          const key = beatKey(beat, site);
          for (const lang of ['en', 'ru'] as const) {
            if (!/\{/.test(base[lang][key] ?? '')) continue;
            const override = (lang === 'en' ? voiceEn : voiceRu)[`voice.${key}`];
            if (!override) problems.push(`${lang} ${key}: no voice.${key}`);
            else if (/[{}]/.test(override)) problems.push(`${lang} ${key}: override has a placeholder`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('say "Cadet" where the screen shows the name', () => {
    expect(voiceEn['voice.story.mars.2']).toMatch(/^Cadet,/);
    expect(voiceRu['voice.story.moon.2']).toMatch(/^Кадет,/);
  });

  it('have the same voice keys in both languages, and no override without a shown line', () => {
    expect(Object.keys(voiceRu).sort()).toEqual(Object.keys(voiceEn).sort());
    const known = new Set([...Object.keys(en), ...Object.keys(filmsEn)]);
    for (const key of Object.keys(voiceEn)) if (key.startsWith('voice.')) expect(known.has(key.slice(6)), key).toBe(true);
  });

  it('are never sent with a placeholder or a name', () => {
    const lines = collectLines(cfg, dicts, { model: MODEL });
    for (const line of lines) if (line.text !== null) expect(line.text, `${line.lang}:${line.key}`).not.toMatch(/[{}]/);
    expect(lines.filter((line) => line.kind === 'films' && line.text === null)).toEqual([]);
  });
});

describe('spokenText', () => {
  it('prefers the voice.* text', () => {
    expect(spokenText('story.mars.1', 'en', dicts).text).toBe('Mars. Nobody has ever lived here.');
  });
  it('skips a line with placeholders and no override', () => {
    const d: Dicts = { en: { 'lumi.x': 'You have {n} left' }, ru: {} };
    expect(spokenText('lumi.x', 'en', d)).toEqual({ text: null, skip: 'params' });
    expect(spokenText('lumi.nope', 'en', d)).toEqual({ text: null, skip: 'missing' });
  });
  it('cleans markup and reads glossary names', () => {
    const d: Dicts = { en: { 'lumi.y': 'A **day** is a [[sol]].', 'gloss.sol.name': 'sol' }, ru: {} };
    expect(spokenText('lumi.y', 'en', d).text).toBe('A day is a sol.');
  });
});

describe('lines and priority', () => {
  it('cover every film beat of both worlds', () => {
    const keys = new Set(filmKeys().map((line) => line.key));
    expect(keys.has('story.mars.1') && keys.has('story.moon.1')).toBe(true);
    expect(keys.has('film.dust.1')).toBe(true);
    expect(keys.has('film.task.earth.say.mars') && keys.has('film.task.earth.say.moon')).toBe(true);
    expect(filmKeys().find((line) => line.key === 'story.mars.2')?.speaker).toBe('mc');
    expect(filmKeys().find((line) => line.key === 'story.mars.1')?.speaker).toBe('caption');
  });
  it('put Lumi lines most often heard first, and leave the name label out', () => {
    const keys = lumiKeys(cfg, dicts);
    expect(keys).not.toContain('lumi.name');
    expect(keys.indexOf('lumi.plan.good')).toBeLessThan(keys.indexOf('lumi.find.sulfur'));
    expect(keys.indexOf('lumi.welcome.mars')).toBeLessThan(keys.indexOf('lumi.look.moxie'));
  });
  it('filter by --only and --lang', () => {
    expect(collectLines(cfg, dicts, { model: MODEL, only: 'films' }).every((line) => line.kind === 'films')).toBe(true);
    expect(collectLines(cfg, dicts, { model: MODEL, lang: 'ru' }).every((line) => line.lang === 'ru')).toBe(true);
  });
});

describe('hash', () => {
  const base = () => lineHash(cfg, MODEL, 'lumi', 'en', 'Hello');
  it('is stable and short', () => {
    expect(base()).toBe(base());
    expect(base()).toMatch(/^[0-9a-f]{12}$/);
  });
  it('changes with the text, language, speaker, model and voice settings', () => {
    expect(lineHash(cfg, MODEL, 'lumi', 'en', 'Hello!')).not.toBe(base());
    expect(lineHash(cfg, MODEL, 'lumi', 'ru', 'Hello')).not.toBe(base());
    expect(lineHash(cfg, MODEL, 'mc', 'en', 'Hello')).not.toBe(base());
    expect(lineHash(cfg, 'eleven_turbo_v2_5', 'lumi', 'en', 'Hello')).not.toBe(base());
    const tuned: VoiceConfig = JSON.parse(JSON.stringify(cfg));
    tuned.speakers.lumi.settings.stability = 0.9;
    expect(lineHash(tuned, MODEL, 'lumi', 'en', 'Hello')).not.toBe(base());
    const swapped: VoiceConfig = JSON.parse(JSON.stringify(cfg));
    swapped.speakers.lumi.voiceId = 'other';
    expect(lineHash(swapped, MODEL, 'lumi', 'en', 'Hello')).not.toBe(base());
  });
});

describe('plan', () => {
  const lines = collectLines(cfg, dicts, { model: MODEL });
  const never = (): boolean => false;
  /** Files that exist: the ones a manifest names. */
  const filesOf = (manifest: Manifest) => (file: string): boolean => Object.values(manifest.lines).some((entry) => entry.file === file);

  it('fits the default budget with every film line in', () => {
    const plan = planLines(lines, emptyManifest(), never, 9000, PER_CHAR);
    expect(plan.credits).toBeLessThanOrEqual(9000);
    const films = plan.lines.filter((line) => line.kind === 'films');
    expect(films.length).toBeGreaterThan(80);
    expect(films.every((line) => line.status === 'new' || line.status === 'shared')).toBe(true);
    expect(plan.lines.some((line) => line.kind === 'lumi' && line.status === 'new')).toBe(true);
  });

  it('skips unchanged lines: same hash and file on disk cost nothing', () => {
    const first = planLines(lines, emptyManifest(), never, 9000, PER_CHAR);
    const manifest: Manifest = emptyManifest();
    for (const line of first.lines) {
      if (line.status === 'new' || line.status === 'shared') manifest.lines[manifestKey(line.lang, line.key)] = { file: fileName(line.hash), hash: line.hash, chars: line.chars, speaker: line.speaker };
    }
    const again = planLines(lines, manifest, filesOf(manifest), 9000, PER_CHAR);
    expect(again.jobs).toEqual([]);
    expect(again.credits).toBe(0);
    expect(again.lines.filter((line) => line.status === 'cached').length).toBeGreaterThan(200);
    // The file is gone: it is made again.
    const missing = planLines(lines, manifest, never, 9000, PER_CHAR);
    expect(missing.jobs.length).toBe(first.jobs.length);
  });

  it('counts finished lines toward the budget, so a run right after a run spends nothing', () => {
    const first = planLines(lines, emptyManifest(), never, 9000, PER_CHAR);
    expect(first.lines.some((line) => line.status === 'over-budget')).toBe(true);
    const manifest: Manifest = emptyManifest();
    for (const line of first.lines) {
      if (line.status === 'new' || line.status === 'shared') manifest.lines[manifestKey(line.lang, line.key)] = { file: fileName(line.hash), hash: line.hash, chars: line.chars, speaker: line.speaker };
    }
    const again = planLines(lines, manifest, filesOf(manifest), 9000, PER_CHAR);
    expect(again.jobs).toEqual([]);
    expect(again.cachedCredits).toBeCloseTo(first.credits, 5);
    // A bigger budget adds more lines, and only the new ones are paid for.
    const more = planLines(lines, manifest, filesOf(manifest), 9600, PER_CHAR);
    expect(more.jobs.length).toBeGreaterThan(0);
    expect(more.credits).toBeLessThanOrEqual(9600 - first.credits + 1e-6);
  });

  it('makes again only the line whose text changed', () => {
    const first = planLines(lines, emptyManifest(), never, 9000, PER_CHAR);
    const manifest: Manifest = emptyManifest();
    for (const line of first.lines) {
      if (line.status === 'new' || line.status === 'shared') manifest.lines[manifestKey(line.lang, line.key)] = { file: fileName(line.hash), hash: line.hash, chars: line.chars, speaker: line.speaker };
    }
    const edited: Dicts = { en: { ...dicts.en, 'voice.story.mars.1': 'Mars. A brand new first line.' }, ru: dicts.ru };
    const changed = planLines(collectLines(cfg, edited, { model: MODEL }), manifest, filesOf(manifest), 9000, PER_CHAR);
    expect(changed.jobs.map((job) => job.text)).toEqual(['Mars. A brand new first line.']);
  });

  it('does not pay again for a renamed key: a file with the same hash is already there', () => {
    const d: Dicts = { en: { 'lumi.old': 'Same words.' }, ru: {} };
    const first = planLines(collectLines(cfg, d, { model: MODEL, only: 'lumi', lang: 'en' }), emptyManifest(), never, 9000, PER_CHAR);
    const hash = first.lines[0].hash;
    const renamed: Dicts = { en: { 'lumi.new': 'Same words.' }, ru: {} };
    const plan = planLines(collectLines(cfg, renamed, { model: MODEL, only: 'lumi', lang: 'en' }), emptyManifest(), (file) => file === fileName(hash), 9000, PER_CHAR);
    expect(plan.jobs).toEqual([]);
    expect(plan.lines[0].status).toBe('cached');
  });

  it('sends a text used by two keys only once', () => {
    const d: Dicts = { en: { 'lumi.a': 'Same words.', 'lumi.b': 'Same words.' }, ru: {} };
    const plan = planLines(collectLines(cfg, d, { model: MODEL, only: 'lumi', lang: 'en' }), emptyManifest(), never, 9000, PER_CHAR);
    expect(plan.jobs.length).toBe(1);
    expect(plan.lines.map((line) => line.status).sort()).toEqual(['new', 'shared']);
  });

  it('with a short budget keeps films first and both languages together', () => {
    const filmCredits = planLines(collectLines(cfg, dicts, { model: MODEL, only: 'films' }), emptyManifest(), never, 1e9, PER_CHAR).credits;
    const plan = planLines(lines, emptyManifest(), never, filmCredits + 400, PER_CHAR);
    expect(plan.credits).toBeLessThanOrEqual(filmCredits + 400);
    expect(plan.lines.filter((line) => line.kind === 'films').every((line) => line.status === 'new' || line.status === 'shared')).toBe(true);
    const lumi = plan.lines.filter((line) => line.kind === 'lumi' && line.status === 'new');
    expect(lumi.length).toBeGreaterThan(0);
    for (const line of lumi) expect(plan.lines.find((other) => other.key === line.key && other.lang !== line.lang)?.status, line.key).toBe('new');
    expect(plan.lines.some((line) => line.status === 'over-budget')).toBe(true);
    // The most heard Lumi lines come before the rare ones.
    const inKeys = lumi.map((line) => line.key);
    expect(inKeys).toContain('lumi.welcome.mars');
    expect(inKeys).not.toContain('lumi.look.moxie');
  });

  it('with no budget voices nothing new', () => {
    const plan = planLines(lines, emptyManifest(), never, 0, PER_CHAR);
    expect(plan.jobs).toEqual([]);
    expect(summarize(plan, PER_CHAR).credits).toBe(0);
  });
});

describe('manifest lookup and fallback', () => {
  const manifest = parseManifest({
    version: 1,
    lines: {
      'en:story.mars.1': { file: 'abc123.mp3', hash: 'abc123', chars: 30, speaker: 'caption' },
      'ru:bad': { file: '../evil.mp3', hash: 'x', chars: 1, speaker: 'lumi' },
      'en:worse': { file: 5 },
    },
  });
  it('finds a line by language and key', () => {
    expect(findEntry(manifest, 'en', 'story.mars.1')?.file).toBe('abc123.mp3');
    expect(findEntry(manifest, 'ru', 'story.mars.1')).toBeNull();
    expect(findEntry(null, 'en', 'story.mars.1')).toBeNull();
    expect(voiceId('ru', 'k')).toBe('ru:k');
  });
  it('ignores broken entries and things that are not manifests', () => {
    expect(Object.keys(manifest)).toEqual(['en:story.mars.1']);
    expect(parseManifest('<html>start page</html>')).toEqual({});
    expect(parseManifest(null)).toEqual({});
    expect(parseManifest({ lines: [] })).toEqual({});
  });
  it('decides: file, else the device voice only when asked, else silence', () => {
    const entry = findEntry(manifest, 'en', 'story.mars.1');
    expect(decide(entry, {})).toBe('file');
    expect(decide(null, { fallback: true, text: 'Hi' })).toBe('speech');
    expect(decide(null, { fallback: true })).toBe('none');
    expect(decide(null, { text: 'Hi' })).toBe('none');
  });
  it('builds a relative file address', () => {
    expect(voiceUrl('abc.mp3')).toMatch(/voice\/abc\.mp3$/);
  });
  it('never throws when nothing can be loaded', async () => {
    await expect(playLine('story.mars.1', 'en')).resolves.toBe(false);
    await expect(playLine('story.mars.1', 'ru', { text: 'x', fallback: true })).resolves.toBe(false);
    expect(() => stopLine()).not.toThrow();
  });
});

// ----- The API and the whole run, with a fake fetch ---------------------------------------------------

interface Call {
  url: string;
  headers: Record<string, string>;
  body: { text: string; model_id: string; language_code: string; voice_settings: Record<string, unknown> };
}

function fakeFetch(plan: (call: number, call_: Call) => { status: number; body?: string; headers?: Record<string, string> } = () => ({ status: 200 })): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const call: Call = { url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
    calls.push(call);
    const { status, body, headers } = plan(calls.length, call);
    if (status === 200) return new Response(new Uint8Array([0xff, 0xfb, 0x90, calls.length % 256]), { status });
    return new Response(body ?? '{}', { status, headers });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const noSleep = async (): Promise<void> => undefined;

describe('requestSpeech', () => {
  const args = { apiKey: SECRET, cfg, model: MODEL, speaker: 'lumi' as const, lang: 'en' as const, text: 'Hello there.', sleep: noSleep };

  it('sends the documented request', async () => {
    const { fetchFn, calls } = fakeFetch();
    const result = await requestSpeech({ ...args, fetchFn });
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('https://api.elevenlabs.io/v1/text-to-speech/cgSgspJ2msm6clMCkdW9?output_format=mp3_44100_64');
    expect(calls[0].headers['xi-api-key']).toBe(SECRET);
    expect(calls[0].body).toEqual({ text: 'Hello there.', model_id: 'eleven_v4_turbo', language_code: 'en', voice_settings: cfg.speakers.lumi.settings });
    expect(JSON.stringify(calls[0].body)).not.toContain(SECRET);
  });
  it('retries 429 and 5xx with a growing wait, then succeeds', async () => {
    const waits: number[] = [];
    const { fetchFn, calls } = fakeFetch((n) => (n === 1 ? { status: 429 } : n === 2 ? { status: 503 } : { status: 200 }));
    const result = await requestSpeech({ ...args, fetchFn, sleep: async (ms) => void waits.push(ms) });
    expect(result.ok).toBe(true);
    expect(calls.length).toBe(3);
    expect(waits).toEqual([1000, 2000]);
  });
  it('gives up after the last try without calling it fatal', async () => {
    const { fetchFn, calls } = fakeFetch(() => ({ status: 500 }));
    const result = await requestSpeech({ ...args, fetchFn, maxTries: 3 });
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect((result as { fatal?: string }).fatal).toBeUndefined();
    expect(calls.length).toBe(3);
  });
  it('stops at once on a bad key, a used-up quota and a refused model', async () => {
    const auth = fakeFetch(() => ({ status: 401, body: JSON.stringify({ detail: { status: 'invalid_api_key', message: 'bad' } }) }));
    expect(await requestSpeech({ ...args, fetchFn: auth.fetchFn })).toMatchObject({ ok: false, fatal: 'auth' });
    expect(auth.calls.length).toBe(1);
    const quota = fakeFetch(() => ({ status: 401, body: JSON.stringify({ detail: { status: 'quota_exceeded', message: 'You have 0 credits left' } }) }));
    expect(await requestSpeech({ ...args, fetchFn: quota.fetchFn })).toMatchObject({ ok: false, fatal: 'quota' });
    const model = fakeFetch(() => ({ status: 422, body: JSON.stringify({ detail: { message: 'model_not_found' } }) }));
    expect(await requestSpeech({ ...args, fetchFn: model.fetchFn })).toMatchObject({ ok: false, fatal: 'model' });
  });
  it('hides the key even if a server echoes it', async () => {
    const { fetchFn } = fakeFetch(() => ({ status: 400, body: JSON.stringify({ detail: `bad key ${SECRET}` }) }));
    const result = await requestSpeech({ ...args, fetchFn });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe('generator run', () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
  });

  function setup(fetchFn: typeof fetch, env: Record<string, string | undefined> = { ELEVENLABS_API_KEY: SECRET }, dictsOverride: Dicts = dicts): { deps: RunDeps; out: string; logs: string[] } {
    const out = mkdtempSync(join(tmpdir(), 'voice-test-'));
    dirs.push(out);
    const logs: string[] = [];
    return { out, logs, deps: { env, fetchFn, sleep: noSleep, log: (text) => logs.push(text), outDir: out, cfg, dicts: dictsOverride } };
  }

  /** Everything a run left behind: file names and contents, plus what it printed. */
  function everything(out: string, logs: string[]): string {
    const parts = [logs.join('\n')];
    for (const name of readdirSync(out)) parts.push(name, readFileSync(join(out, name)).toString('latin1'));
    return parts.join('\n');
  }

  it('dry run needs no key, sends nothing and writes nothing', async () => {
    const { fetchFn, calls } = fakeFetch();
    const { deps, out, logs } = setup(fetchFn, {});
    const result = await run(['--dry-run'], deps);
    expect(result.code).toBe(0);
    expect(calls).toEqual([]);
    expect(readdirSync(out)).toEqual([]);
    expect(logs.join('\n')).toMatch(/films: (\d+)\/\1 lines in/);
    expect(result.plan?.credits).toBeLessThanOrEqual(9000);
  });

  it('stops with a clear message when the key is missing', async () => {
    const { fetchFn, calls } = fakeFetch();
    const { deps, logs } = setup(fetchFn, {});
    const result = await run([], deps);
    expect(result.code).toBe(1);
    expect(calls).toEqual([]);
    expect(logs.join('\n')).toContain('ELEVENLABS_API_KEY is not set');
  });

  it('generates the plan, never writes or prints the key, and a second run costs nothing', async () => {
    const { fetchFn, calls } = fakeFetch();
    const { deps, out, logs } = setup(fetchFn);
    const result = await run([], deps);
    expect(result.code).toBe(0);
    expect(calls.length).toBe(result.plan?.jobs.length);
    expect(calls.length).toBeGreaterThan(150);
    for (const call of calls) {
      expect(call.body.text).not.toMatch(/[{}]/);
      expect(JSON.stringify(call.body)).not.toContain(SECRET);
    }
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.lines['en:story.mars.1']).toMatchObject({ speaker: 'caption', hash: expect.stringMatching(/^[0-9a-f]{12}$/) });
    expect(manifest.lines['ru:story.mars.2']?.speaker).toBe('mc');
    expect(existsSync(join(out, manifest.lines['en:story.mars.1'].file))).toBe(true);
    expect(everything(out, logs)).not.toContain(SECRET);
    expect(everything(out, logs)).not.toContain('xi-api-key');

    const before = calls.length;
    const again = await run([], deps);
    expect(again.generated).toBe(0);
    expect(calls.length).toBe(before);
  });

  it('after a text change makes only that line again and drops the old entry', async () => {
    const { fetchFn, calls } = fakeFetch();
    const first = setup(fetchFn);
    await run(['--only', 'films'], first.deps);
    const count = calls.length;
    const edited: Dicts = { en: { ...dicts.en, 'voice.story.mars.1': 'Mars. Changed.' }, ru: dicts.ru };
    const result = await run(['--only', 'films'], { ...first.deps, dicts: edited });
    expect(calls.length).toBe(count + 1);
    expect(calls[count].body.text).toBe('Mars. Changed.');
    expect(result.generated).toBe(1);
    const manifest = JSON.parse(readFileSync(join(first.out, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.lines['en:story.mars.1'].hash).toBe(lineHash(cfg, MODEL, 'caption', 'en', 'Mars. Changed.'));
  });

  it('keeps what it made when the quota runs out, and says so', async () => {
    const { fetchFn } = fakeFetch((n) => (n <= 5 ? { status: 200 } : { status: 401, body: JSON.stringify({ detail: { status: 'quota_exceeded', message: 'none left' } }) }));
    const { deps, out, logs } = setup(fetchFn);
    const result = await run([], deps);
    expect(result.stopped).toBe('quota');
    expect(result.generated).toBe(5);
    expect(result.code).toBe(1);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as Manifest;
    expect(Object.keys(manifest.lines).length).toBeGreaterThanOrEqual(5);
    expect(logs.join('\n')).toContain('quota is used up');
    expect(everything(out, logs)).not.toContain(SECRET);
  });

  it('respects --budget and --lang', async () => {
    const { fetchFn, calls } = fakeFetch();
    const { deps } = setup(fetchFn);
    const result = await run(['--budget', '300', '--lang', 'en', '--only', 'films'], deps);
    expect(result.plan?.credits).toBeLessThanOrEqual(300);
    expect(calls.every((call) => call.body.language_code === 'en')).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('counts finished lines of the other language toward the budget', async () => {
    const { fetchFn, calls } = fakeFetch();
    const { deps } = setup(fetchFn);
    await run([], deps);
    const before = calls.length;
    const result = await run(['--lang', 'en'], deps);
    expect(result.generated).toBe(0);
    expect(calls.length).toBe(before);
    const only = await run(['--only', 'lumi'], deps);
    expect(only.generated).toBe(0);
  });

  it('keeps the manifest when the model is refused, and does not rebuy files already made', async () => {
    const { fetchFn, calls } = fakeFetch();
    const { deps, out } = setup(fetchFn);
    await run([], deps);
    const made = calls.length;
    const refused = fakeFetch(() => ({ status: 422, body: JSON.stringify({ detail: { message: 'model_not_found' } }) }));
    const result = await run(['--model', 'eleven_turbo_v2_5'], { ...deps, fetchFn: refused.fetchFn });
    expect(result.stopped).toBe('model');
    expect(refused.calls.length).toBe(1);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as Manifest;
    expect(Object.keys(manifest.lines).length).toBeGreaterThan(made - 10);
  });

  it('treats npm eating --dry-run as a dry run, never as a paid one', async () => {
    const { fetchFn, calls } = fakeFetch();
    const { deps, out } = setup(fetchFn, { ELEVENLABS_API_KEY: SECRET, npm_config_dry_run: 'true' });
    const result = await run([], deps);
    expect(result.code).toBe(0);
    expect(calls).toEqual([]);
    expect(readdirSync(out)).toEqual([]);
  });

  it('stops on an unreadable manifest and on a model without a price', async () => {
    const { fetchFn, calls } = fakeFetch();
    const { deps, out } = setup(fetchFn);
    writeFileSync(join(out, 'manifest.json'), '{ broken');
    expect((await run([], deps)).code).toBe(1);
    expect(calls).toEqual([]);
    expect((await run(['--dry-run', '--model', 'eleven_unknown_model'], deps)).code).toBe(2);
  });

  it('survives an answer that breaks off', async () => {
    const calls: number[] = [];
    const fetchFn = (async () => {
      calls.push(1);
      return { ok: true, status: 200, arrayBuffer: async () => Promise.reject(new Error('socket hang up')), text: async () => '', headers: new Headers() } as unknown as Response;
    }) as unknown as typeof fetch;
    const { deps, logs } = setup(fetchFn);
    const result = await run(['--budget', '60', '--only', 'films'], deps);
    expect(result.failed).toBeGreaterThan(0);
    expect(logs.join(String.fromCharCode(10))).toContain('broke off');
  });

  it('refuses bad flags', async () => {
    const { fetchFn } = fakeFetch();
    const { deps } = setup(fetchFn);
    expect((await run(['--budget', 'lots', '--dry-run'], deps)).code).toBe(2);
    expect((await run(['--only', 'x', '--dry-run'], deps)).code).toBe(2);
    expect((await run(['--prune', '--lang', 'en', '--dry-run'], deps)).code).toBe(2);
  });

  it('prune removes files no line uses, and keeps the rest', async () => {
    const { fetchFn, calls } = fakeFetch();
    const { deps, out } = setup(fetchFn);
    await run([], deps);
    writeFileSync(join(out, 'deadbeef0000.mp3'), 'old');
    const before = calls.length;
    await run([], deps);
    expect(existsSync(join(out, 'deadbeef0000.mp3'))).toBe(true); // not without the flag
    await run(['--prune'], deps);
    expect(existsSync(join(out, 'deadbeef0000.mp3'))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as Manifest;
    expect(existsSync(join(out, manifest.lines['en:story.mars.1'].file))).toBe(true);
    expect(calls.length).toBe(before);
  });
});
