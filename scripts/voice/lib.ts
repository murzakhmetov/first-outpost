/**
 * Voice generator, pure part: which lines are spoken, what they say, what they cost, and
 * the calls to the ElevenLabs API. Nothing here reads the environment or the disk by itself
 * (the CLI in generate.ts passes those in), so the tests can run it with a fake `fetch`.
 *
 * Runs under plain Node (`node scripts/voice/generate.ts`): explicit `.ts` imports, no enums.
 */
import { createHash } from 'node:crypto';
import { FILMS, beatKey } from '../../src/game/films.ts';
import type { FilmSpeaker } from '../../src/game/films.ts';
import { en } from '../../src/i18n/en.ts';
import { filmsEn, filmsRu } from '../../src/i18n/films.ts';
import { ru } from '../../src/i18n/ru.ts';
import { voiceEn, voiceRu } from '../../src/i18n/voice.ts';

export type Lang = 'en' | 'ru';
export const LANGS: Lang[] = ['en', 'ru'];
export type Speaker = FilmSpeaker;
export type LineKind = 'films' | 'lumi' | 'cards';
/** Which text of an event card a line is. The order is the priority: stories first, titles and bodies last. */
export type CardPart = 'story' | 'result' | 'title' | 'body';
export const CARD_PARTS: CardPart[] = ['story', 'result', 'title', 'body'];
export const KINDS: LineKind[] = ['films', 'lumi', 'cards'];

export interface SpeakerConfig {
  name?: string;
  voiceId: string;
  settings: { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean };
}

export interface VoiceConfig {
  model: string;
  fallbackModel?: string;
  models: Record<string, { creditsPerChar: number }>;
  outputFormat: string;
  speakers: Record<Speaker, SpeakerConfig>;
  lumiPriority: string[];
  /** Keys outside `lumi.*` that Lumi's bubble also says (for example `eva.edge`). */
  lumiExtra?: string[];
  /** Keys Lumi can say that are left out on purpose: key -> why. The tests insist that nothing else is unplanned. */
  lumiSkip?: Record<string, string>;
}

export interface ManifestEntry {
  file: string;
  hash: string;
  chars: number;
  speaker: Speaker;
}
export interface Manifest {
  version: 1;
  lines: Record<string, ManifestEntry>;
}
export const emptyManifest = (): Manifest => ({ version: 1, lines: {} });

/** One line to speak, in one language. */
export interface VoiceLine {
  /** The text key the game uses (`story.mars.1`), also the manifest key after `<lang>:`. */
  key: string;
  lang: Lang;
  speaker: Speaker;
  kind: LineKind;
  /** For the event-card lines: which text of the card it is. */
  part?: CardPart;
  /** Lower is more important. Both languages of a line share it. */
  order: number;
  /** The text to send, clean; null when the line cannot be voiced (the reason is in `skip`). */
  text: string | null;
  skip?: 'params' | 'missing' | 'listed';
  hash: string;
  chars: number;
}

export const manifestKey = (lang: Lang, key: string): string => `${lang}:${key}`;

// ----- Text -------------------------------------------------------------------------------------

const EMOJI = /[\p{Extended_Pictographic}‍️⃣]/gu;

/** Markup of the game's texts turned into plain speech: no **bold**, no [[glossary]] links, no emoji. */
export function cleanForSpeech(text: string, gloss: (term: string) => string | undefined = () => undefined): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\[\[(\w+)\]\]/g, (_match, term: string) => gloss(term) ?? term)
    .replace(EMOJI, '')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export interface Dicts {
  en: Record<string, string>;
  ru: Record<string, string>;
}

/** The texts of the game as the voice sees them (the base texts, the films and the voice overrides). */
export function loadDicts(): Dicts {
  return {
    en: { ...en, ...filmsEn, ...voiceEn },
    ru: { ...ru, ...filmsRu, ...voiceRu },
  };
}

/** What a line says: the `voice.<key>` text when there is one, else the shown text. Null when it cannot be voiced. */
export function spokenText(key: string, lang: Lang, dicts: Dicts): { text: string | null; skip?: 'params' | 'missing' | 'listed' } {
  const dict = dicts[lang];
  const raw = dict[`voice.${key}`] ?? dict[key];
  if (raw === undefined) return { text: null, skip: 'missing' };
  const clean = cleanForSpeech(raw, (term) => dict[`gloss.${term}.name`]);
  // A {placeholder} would be read as it is, or leak a name: such a line needs a voice.<key> text.
  if (clean.includes('{') || clean.includes('}') || !clean) return { text: null, skip: 'params' };
  return { text: clean };
}

// ----- Hash and cost ----------------------------------------------------------------------------

/** A short name for a file: changes when the model, the voice, its settings, the language or the text changes. */
export function lineHash(cfg: VoiceConfig, model: string, speaker: Speaker, lang: Lang, text: string): string {
  const voice = cfg.speakers[speaker];
  const payload = JSON.stringify([model, voice.voiceId, voice.settings, cfg.outputFormat, lang, text]);
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

export const fileName = (hash: string): string => `${hash}.mp3`;

/** Credits per character of a model; undefined for a model that is not in voices.json (its price is not known). */
export function creditsPerChar(cfg: VoiceConfig, model: string): number | undefined {
  return cfg.models[model]?.creditsPerChar;
}

// ----- Which lines --------------------------------------------------------------------------------

/** Every film beat of every film on both worlds, in play order (intro, task films, event films). */
export function filmKeys(): { key: string; speaker: Speaker }[] {
  const seen = new Map<string, Speaker>();
  for (const film of Object.values(FILMS)) {
    for (const site of ['mars', 'moon'] as const) {
      if (film.sites && !film.sites.includes(site)) continue;
      for (const beat of film.beats) {
        const key = beatKey(beat, site);
        if (!seen.has(key)) seen.set(key, beat.speaker);
      }
    }
  }
  return [...seen].map(([key, speaker]) => ({ key, speaker }));
}

/** The keys of Lumi's bubble lines, most often heard first (the order of `lumiPriority`, then the order of en.ts). */
export function lumiKeys(cfg: VoiceConfig, dicts: Dicts): string[] {
  const rank = (key: string): number => {
    const index = cfg.lumiPriority.findIndex((prefix) => key.startsWith(prefix));
    return index < 0 ? cfg.lumiPriority.length : index;
  };
  const keys = Object.keys(dicts.en).filter((key) => key.startsWith('lumi.') && key !== 'lumi.name');
  for (const extra of cfg.lumiExtra ?? []) if (!keys.includes(extra)) keys.push(extra);
  return keys
    .map((key, position) => ({ key, position, rank: rank(key) }))
    .sort((a, b) => a.rank - b.rank || a.position - b.position)
    .map((item) => item.key);
}

const CARD_KEY = /^ev\.[a-z0-9_]+\.(title|body|story|r[abc])(?:\.[A-Za-z]+)?$/;

/**
 * The texts the speaker buttons of the event card (title, body) and of the result card (result, story) read, on
 * both worlds: every variant (`.mars`, `.moon`, `.cme`, `.rad`, `.marsNear`). Stories first, then results, then
 * titles and bodies; inside a part, the order of en.ts.
 */
export function cardKeys(dicts: Dicts): { key: string; part: CardPart }[] {
  const found: { key: string; part: CardPart }[] = [];
  for (const key of Object.keys(dicts.en)) {
    const match = CARD_KEY.exec(key);
    if (!match) continue;
    const word = match[1];
    found.push({ key, part: word === 'story' ? 'story' : word === 'title' ? 'title' : word === 'body' ? 'body' : 'result' });
  }
  return CARD_PARTS.flatMap((part) => found.filter((item) => item.part === part));
}

export interface CollectOptions {
  only?: LineKind;
  lang?: Lang;
  model: string;
}

/** All lines to voice, with their text, hash and size. Sorted by priority (films, then Lumi, then the event cards). */
export function collectLines(cfg: VoiceConfig, dicts: Dicts, options: CollectOptions): VoiceLine[] {
  const sources: { key: string; speaker: Speaker; kind: LineKind; part?: CardPart }[] = [];
  const taken = new Set<string>();
  const add = (source: { key: string; speaker: Speaker; kind: LineKind; part?: CardPart }): void => {
    if (taken.has(source.key)) return;
    taken.add(source.key);
    sources.push(source);
  };
  const wants = (kind: LineKind): boolean => !options.only || options.only === kind;
  if (wants('films')) for (const { key, speaker } of filmKeys()) add({ key, speaker, kind: 'films' });
  if (wants('lumi')) for (const key of lumiKeys(cfg, dicts)) add({ key, speaker: 'lumi', kind: 'lumi' });
  if (wants('cards')) for (const { key, part } of cardKeys(dicts)) add({ key, speaker: 'caption', kind: 'cards', part });
  const langs = options.lang ? [options.lang] : LANGS;
  const lines: VoiceLine[] = [];
  sources.forEach((source, order) => {
    for (const lang of langs) {
      const listed = source.kind === 'lumi' && cfg.lumiSkip?.[source.key] !== undefined;
      const { text, skip } = listed ? { text: null, skip: 'listed' as const } : spokenText(source.key, lang, dicts);
      lines.push({
        ...source,
        lang,
        order,
        text,
        skip,
        hash: text === null ? '' : lineHash(cfg, options.model, source.speaker, lang, text),
        chars: text === null ? 0 : text.length,
      });
    }
  });
  return lines;
}

// ----- The plan -----------------------------------------------------------------------------------

export type Status = 'cached' | 'new' | 'shared' | 'over-budget' | 'skipped-params' | 'skipped-missing' | 'skipped-listed';

export interface PlannedLine extends VoiceLine {
  status: Status;
}

export interface Plan {
  lines: PlannedLine[];
  /** Unique texts to send, in priority order (a text used by two keys is sent once). */
  jobs: { hash: string; text: string; lang: Lang; speaker: Speaker; chars: number }[];
  chars: number;
  /** Credits of the texts sent in this run. */
  credits: number;
  /** Credits of the texts that are already made (they cost nothing now, but they count toward the budget). */
  cachedCredits: number;
  budget: number;
}

/**
 * Decide which lines are voiced in this run. A line already in the manifest with the same hash (and a file on
 * disk) costs nothing now, but its credits count toward the budget: the budget is the size of the whole voiced
 * set, so running again right after a run never spends more. A new line is taken when it still fits: both
 * languages of a line go in together or not at all, so English and Russian always cover the same lines.
 */
export function planLines(
  lines: VoiceLine[],
  manifest: Manifest,
  fileExists: (file: string) => boolean,
  budget: number,
  perChar: number,
  /** Credits of already made lines that are outside this run (another language or kind): they count too. */
  reservedCredits = 0,
): Plan {
  const planned = new Map<VoiceLine, Status>();
  const paid = new Set<string>(); // hashes already sent or already on disk
  const jobs: Plan['jobs'] = [];
  let chars = 0;

  // Made already: the manifest says so for this key, or a file with this very hash is on disk (the hash covers the
  // model, voice, settings, language and text, so the file is the right one even if the key is new).
  const isCached = (line: VoiceLine): boolean => {
    const entry = manifest.lines[manifestKey(line.lang, line.key)];
    if (entry && entry.hash === line.hash && fileExists(entry.file)) return true;
    return fileExists(fileName(line.hash));
  };

  const cachedHashes = new Map<string, number>();
  for (const line of lines) if (line.text !== null && isCached(line)) cachedHashes.set(line.hash, line.chars);
  const cachedCredits = [...cachedHashes.values()].reduce((sum, count) => sum + count * perChar, 0) + reservedCredits;

  const groups = new Map<number, VoiceLine[]>();
  for (const line of lines) {
    if (line.text === null) {
      planned.set(line, line.skip === 'missing' ? 'skipped-missing' : line.skip === 'listed' ? 'skipped-listed' : 'skipped-params');
      continue;
    }
    const group = groups.get(line.order);
    if (group) group.push(line);
    else groups.set(line.order, [line]);
  }
  for (const group of [...groups].sort((a, b) => a[0] - b[0]).map((entry) => entry[1])) {
    for (const line of group) if (isCached(line)) paid.add(line.hash);
    let cost = 0;
    const seen = new Set<string>();
    for (const line of group) {
      if (isCached(line) || paid.has(line.hash) || seen.has(line.hash)) continue;
      seen.add(line.hash);
      cost += line.chars * perChar;
    }
    const fits = cachedCredits + chars * perChar + cost <= budget + 1e-9;
    for (const line of group) {
      if (isCached(line)) {
        planned.set(line, 'cached');
      } else if (paid.has(line.hash)) {
        planned.set(line, 'shared');
      } else if (!fits) {
        planned.set(line, 'over-budget');
      } else {
        planned.set(line, 'new');
        paid.add(line.hash);
        chars += line.chars;
        jobs.push({ hash: line.hash, text: line.text as string, lang: line.lang, speaker: line.speaker, chars: line.chars });
      }
    }
  }
  return {
    lines: lines.map((line) => ({ ...line, status: planned.get(line) as Status })),
    jobs,
    chars,
    credits: chars * perChar,
    cachedCredits,
    budget,
  };
}

export interface Summary {
  rows: { lang: Lang; speaker: Speaker; lines: number; chars: number; credits: number }[];
  lines: number;
  chars: number;
  credits: number;
}

/** Totals of the lines that would be sent (status "new") per language and speaker. */
export function summarize(plan: Plan, perChar: number, statuses: Status[] = ['new']): Summary {
  const map = new Map<string, Summary['rows'][number]>();
  for (const line of plan.lines) {
    if (!statuses.includes(line.status)) continue;
    const id = `${line.lang}/${line.speaker}`;
    const row = map.get(id) ?? { lang: line.lang, speaker: line.speaker, lines: 0, chars: 0, credits: 0 };
    row.lines += 1;
    row.chars += line.chars;
    row.credits += line.chars * perChar;
    map.set(id, row);
  }
  const rows = [...map.values()].sort((a, b) => a.lang.localeCompare(b.lang) || a.speaker.localeCompare(b.speaker));
  return {
    rows,
    lines: rows.reduce((sum, row) => sum + row.lines, 0),
    chars: rows.reduce((sum, row) => sum + row.chars, 0),
    credits: rows.reduce((sum, row) => sum + row.credits, 0),
  };
}

export interface CategoryRow {
  kind: LineKind;
  /** For the event cards: the part of the card; absent for the whole category. */
  part?: CardPart;
  /** Lines of the category (a line is a text key in one language). */
  total: number;
  /** Lines that are planned: made already, new, or sharing a file. */
  planned: number;
  /** Characters and credits of the planned lines (a text shared by two keys counts once). */
  chars: number;
  credits: number;
}

/** What the plan holds per category (films, Lumi, cards and the four parts of the cards), in priority order. */
export function summarizeCategories(plan: Plan, perChar: number): CategoryRow[] {
  const rows: CategoryRow[] = [];
  const rowFor = (kind: LineKind, part?: CardPart): CategoryRow => {
    const row: CategoryRow = { kind, part, total: 0, planned: 0, chars: 0, credits: 0 };
    const seen = new Set<string>();
    for (const line of plan.lines) {
      if (line.kind !== kind || (part && line.part !== part)) continue;
      row.total += 1;
      if (line.text === null || line.status === 'over-budget' || line.status.startsWith('skipped')) continue;
      row.planned += 1;
      if (seen.has(line.hash)) continue;
      seen.add(line.hash);
      row.chars += line.chars;
      row.credits += line.chars * perChar;
    }
    return row;
  };
  for (const kind of KINDS) {
    const whole = rowFor(kind);
    if (whole.total === 0) continue;
    rows.push(whole);
    if (kind === 'cards') for (const part of CARD_PARTS) rows.push(rowFor(kind, part));
  }
  return rows;
}

// ----- The API ----------------------------------------------------------------------------------

export type Fatal = 'auth' | 'quota' | 'model';

export type SpeechResult =
  | { ok: true; data: Uint8Array }
  | { ok: false; status: number; message: string; fatal?: Fatal };

export interface SpeechRequest {
  fetchFn: typeof fetch;
  apiKey: string;
  cfg: VoiceConfig;
  model: string;
  speaker: Speaker;
  lang: Lang;
  text: string;
  sleep: (ms: number) => Promise<void>;
  maxTries?: number;
}

/** Never let the key reach a log, even if a server echoes it. */
export function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join('***') : text;
}

function detailOf(body: string): string {
  try {
    const json = JSON.parse(body) as { detail?: unknown };
    const detail = json.detail;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const { status, message } = detail as { status?: string; message?: string };
      const said = [status, message].filter(Boolean).join(': ');
      if (said) return said;
    }
    return JSON.stringify(detail ?? body).slice(0, 200);
  } catch {
    /* not JSON */
  }
  return body.slice(0, 200);
}

/** One line of speech from the API. Retries 429 and 5xx with a growing wait; says plainly when to stop for good. */
export async function requestSpeech(req: SpeechRequest): Promise<SpeechResult> {
  const voice = req.cfg.speakers[req.speaker];
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice.voiceId}?output_format=${req.cfg.outputFormat}`;
  const body = JSON.stringify({
    text: req.text,
    model_id: req.model,
    language_code: req.lang,
    voice_settings: voice.settings,
  });
  const tries = req.maxTries ?? 5;
  let last: SpeechResult = { ok: false, status: 0, message: 'no answer' };
  for (let attempt = 1; attempt <= tries; attempt++) {
    let response: Response;
    try {
      response = await req.fetchFn(url, {
        method: 'POST',
        headers: { 'xi-api-key': req.apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body,
      });
    } catch (error) {
      last = { ok: false, status: 0, message: redact(`network error: ${(error as Error).message}`, req.apiKey) };
      if (attempt < tries) await req.sleep(1000 * 2 ** (attempt - 1));
      continue;
    }
    if (response.ok) {
      try {
        return { ok: true, data: new Uint8Array(await response.arrayBuffer()) };
      } catch (error) {
        last = { ok: false, status: response.status, message: redact(`the answer broke off: ${(error as Error).message}`, req.apiKey) };
        if (attempt < tries) await req.sleep(1000 * 2 ** (attempt - 1));
        continue;
      }
    }
    const raw = redact(await response.text().catch(() => ''), req.apiKey);
    const message = detailOf(raw);
    const status = response.status;
    last = { ok: false, status, message };
    if (/quota/i.test(raw) || status === 402) return { ok: false, status, message, fatal: 'quota' };
    if (status === 401 || status === 403) return { ok: false, status, message, fatal: 'auth' };
    if (/model/i.test(raw) && (status === 400 || status === 404 || status === 422)) return { ok: false, status, message, fatal: 'model' };
    if (status === 429 || status >= 500) {
      if (attempt < tries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await req.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 1000 * 2 ** (attempt - 1));
      }
      continue;
    }
    return last; // another 4xx: this text will not work, the next ones may
  }
  return last;
}
