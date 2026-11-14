/**
 * The voice-over: recorded lines (made by scripts/voice/generate.ts, see docs/VOICE.md) for the films
 * and for Lumi. `public/voice/manifest.json` says which lines have a file: "<lang>:<text key>".
 *
 * One rule for every text (Lumi's bubble, the card speaker buttons, the read-aloud texts), see `decide`:
 * - A recording plays when Voices is on, the line has a file, the file can be heard (the Sound effects slider is
 *   above 0: the recorded voices use that volume) and it loads. It goes through the audio module (music steps
 *   aside, Mission Control gets a light radio sound).
 * - Otherwise the device's own voice reads the text, when the caller says its speaking setting is on
 *   (`fallback`: "Lumi speaks by itself" for Lumi, "Read texts aloud" for the rest). With Sound effects at 0 no
 *   file is downloaded.
 * - One voice per line: a card whose file fails part-way reads only the parts not played yet.
 * - Films keep their old rule (`recordedOnly`): a line that has a recording is never read by the device's voice.
 * - Nothing here ever throws: a missing manifest or a broken file just means the device's voice (or silence).
 *
 * Nothing runs when this module is imported (the tests import it in Node).
 */
import { signal } from '@preact/signals';
import { audio, speak, stopSpeaking } from './audio';

export type VoiceSpeaker = 'lumi' | 'mc' | 'caption';

export interface VoiceEntry {
  file: string;
  hash: string;
  chars: number;
  speaker: VoiceSpeaker;
}
export type VoiceLines = Record<string, VoiceEntry>;

export interface PlayOptions {
  /** The shown text: read by the device's voice when the recording does not play and `fallback` is set. */
  text?: string;
  /** The shown text of each key of a list, in order: after a failure part-way only the parts not played yet are read. */
  parts?: string[];
  /** The speaking setting for this text is on: the device's voice may read it. */
  fallback?: boolean;
  /** The "Voices" setting (default on): off means no recording is played. */
  voices?: boolean;
  /** Films: a line that has a recording is never read by the device's voice, it plays or stays silent. */
  recordedOnly?: boolean;
  /** For the device's voice: wait for the text that is being read instead of cutting it off. */
  queue?: boolean;
}

/** The manifest of the build (null until it is loaded; an empty object when there is none). */
export const voiceLines = signal<VoiceLines | null>(null);

export const voiceId = (lang: string, key: string): string => `${lang}:${key}`;

const SPEAKERS = new Set(['lumi', 'mc', 'caption']);

/** Reads a manifest file's JSON. Anything that is not a manifest (an error page, an old format) gives no lines. */
export function parseManifest(data: unknown): VoiceLines {
  const lines: VoiceLines = {};
  const source = (data as { lines?: unknown } | null)?.lines;
  if (!source || typeof source !== 'object') return lines;
  for (const [id, raw] of Object.entries(source as Record<string, unknown>)) {
    const entry = raw as Partial<VoiceEntry> | null;
    if (!entry || typeof entry.file !== 'string' || !/^[\w.-]+\.mp3$/.test(entry.file)) continue;
    lines[id] = {
      file: entry.file,
      hash: String(entry.hash ?? ''),
      chars: Number(entry.chars ?? 0),
      speaker: SPEAKERS.has(String(entry.speaker)) ? (entry.speaker as VoiceSpeaker) : 'lumi',
    };
  }
  return lines;
}

export function findEntry(lines: VoiceLines | null, lang: string, key: string): VoiceEntry | null {
  return lines?.[voiceId(lang, key)] ?? null;
}

export interface DecideOptions extends PlayOptions {
  /** The file can be heard: the Sound effects slider is above 0 (see audio.voiceAudible). */
  audible: boolean;
}

/**
 * THE rule for what to do with a line. `entry` is its manifest entry (null: no file, or the manifest is not loaded).
 * - 'file': Voices is on, there is a file, it can be heard. (It can still fail to load: the caller then reads the
 *   text, see runLines.)
 * - 'speech': otherwise, when the speaking setting for this text is on (`fallback`) and there is a text.
 * - 'none': otherwise. Films (`recordedOnly`) stay silent instead of speech when the line has a recording.
 */
export function decide(entry: VoiceEntry | null, options: DecideOptions): 'file' | 'speech' | 'none' {
  if (entry && options.voices !== false && options.audible) return 'file';
  if (entry && options.recordedOnly) return 'none';
  return options.fallback && options.text ? 'speech' : 'none';
}

const base = (): string => (import.meta.env?.BASE_URL as string | undefined) ?? './';
export const voiceUrl = (file: string): string => `${base()}voice/${file}`;

// ----- Loading ------------------------------------------------------------------------------------

const FETCH_SECONDS = 8;
/** After a failed load, wait this long before asking again (components ask on every draw). */
const RETRY_MS = 30_000;
let manifestLoad: Promise<VoiceLines> | null = null;
let retryAt = 0;

async function fetchBytes(url: string): Promise<ArrayBuffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_SECONDS * 1000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok ? await response.arrayBuffer() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Loads the manifest once. A failed load means "no lines" for a while, then it is tried again. */
export function loadManifest(): Promise<VoiceLines> {
  if (!manifestLoad) {
    if (Date.now() < retryAt) return Promise.resolve(voiceLines.value ?? {});
    manifestLoad = (async () => {
      let lines: VoiceLines | null = null;
      try {
        const bytes = await fetchBytes(`${base()}voice/manifest.json`);
        if (bytes) lines = parseManifest(JSON.parse(new TextDecoder().decode(bytes)));
      } catch {
        /* not a manifest (an error page, or the offline start page) */
      }
      if (!lines) {
        manifestLoad = null;
        retryAt = Date.now() + RETRY_MS;
        if (voiceLines.value === null) voiceLines.value = {};
        return voiceLines.value;
      }
      voiceLines.value = lines;
      return lines;
    })();
  }
  return manifestLoad;
}

/** A file is known for this line (the manifest must be loaded: see loadManifest). Reading it in a component keeps it up to date. */
export function hasLine(key: string, lang: string): boolean {
  return findEntry(voiceLines.value, lang, key) !== null;
}

/**
 * How many lines are kept. The compressed files are small (about 50 kB); a decoded line is large
 * (about 1 MB for 6 seconds), so only the last few decoded ones stay: the one playing and the next.
 */
const MAX_BYTES = 24;
const MAX_DECODED = 4;
const bytesCache = new Map<string, Promise<ArrayBuffer | null>>();
const decoded = new Map<string, AudioBuffer>();

function remember<T>(map: Map<string, T>, key: string, value: T, max: number): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value as string);
}

function loadBytes(entry: VoiceEntry): Promise<ArrayBuffer | null> {
  let pending = bytesCache.get(entry.file);
  if (!pending) {
    pending = fetchBytes(voiceUrl(entry.file));
    remember(bytesCache, entry.file, pending, MAX_BYTES);
    // A failed load is not kept: the next try asks again.
    void pending.then((bytes) => {
      if (!bytes) bytesCache.delete(entry.file);
    });
  }
  return pending;
}

async function loadBuffer(entry: VoiceEntry): Promise<AudioBuffer | null> {
  const known = decoded.get(entry.file);
  if (known) return known;
  const bytes = await loadBytes(entry);
  if (!bytes) return null;
  const buffer = await audio.decodeVoice(bytes.slice(0));
  if (buffer) remember(decoded, entry.file, buffer, MAX_DECODED);
  return buffer;
}

/** Fetches the files of lines that are coming up (for example the next beat of a film), so they start at once. */
export async function prefetchLines(keys: string[], lang: string): Promise<void> {
  // Sound off: nothing will play, so nothing is downloaded.
  if (!audio.voiceAudible) return;
  try {
    const lines = await loadManifest();
    await Promise.all(
      keys.map((key) => {
        const entry = findEntry(lines, lang, key);
        return entry ? loadBytes(entry) : null;
      }),
    );
  } catch {
    /* nothing to prefetch */
  }
}

// ----- Playing ------------------------------------------------------------------------------------

let token = 0;
let current: { stop: () => void; ended: Promise<unknown> } | null = null;
let spoke = false;
/** The call of playLines that is loading or playing now (0 when none), and the key list it was asked for. */
let activeId = 0;
let talkingKey = '';

function endCurrent(): void {
  const line = current;
  current = null;
  line?.stop();
}

function deviceBusy(): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  return window.speechSynthesis.speaking || window.speechSynthesis.pending;
}

/** Stops the line that is playing (and a line the device's voice is reading for it). */
export function stopLine(): void {
  token += 1;
  activeId = 0;
  endCurrent();
  if (spoke) {
    spoke = false;
    stopSpeaking();
  }
}

/**
 * True while the line (or list of lines) with this id is loading, playing or being read by the device's voice, so
 * that its speaker button can stop it instead of starting it again. The id is the keys joined with "|".
 */
export function isTalking(id: string): boolean {
  if (!id || talkingKey !== id) return false;
  return activeId !== 0 || current !== null || (spoke && deviceBusy());
}

/** Reads the text with the device's voice (when there is one). Always `false`. */
function speakText(text: string | undefined, lang: string, queue?: boolean): false {
  if (text) {
    try {
      speak(text, lang, queue);
      spoke = true;
    } catch {
      /* no voice on this device */
    }
  }
  return false;
}

/** Waits (at most 20 s) until the device's voice has finished the text it is reading, or the call is replaced. */
async function deviceSpeechEnded(id: number): Promise<void> {
  for (let waited = 0; waited < 100 && id === token && deviceBusy(); waited++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
}

/** Plays one recorded segment to its end. `false` when it was stopped. */
function playSegment(handle: { stop: () => void; done: Promise<unknown> }): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const mine = {
      stop: () => {
        handle.stop();
        resolve(false);
      },
      ended: handle.done,
    };
    current = mine;
    void handle.done.then(() => {
      if (current === mine) current = null;
      resolve(true);
    });
  });
}

/**
 * Plays the lines of a list of text keys one after another (a card: its title, then its body), by the rule in
 * `decide`. When every key has a file (and Voices is on and the sound can be heard) the files play; if a file
 * cannot be loaded or started, the device's voice reads the parts not played yet (`parts`, else the whole `text`
 * when nothing has played), when `fallback` allows it: never both voices on one part. If any key has no file, the
 * whole text is read by the device's voice instead. With the Sound effects volume at 0 the manifest and the files
 * are not downloaded. Films pass `recordedOnly`: no device voice for a line that has a recording.
 * Resolves `true` when the last recorded line played to its end, and `false` otherwise (read by the device's
 * voice, nothing to play, or stopped). Never rejects. A new call stops what is playing.
 */
export async function playLines(keys: string[], lang: string, options: PlayOptions = {}): Promise<boolean> {
  const id = ++token;
  activeId = id;
  talkingKey = keys.join('|');
  try {
    return await runLines(id, keys, lang, options);
  } finally {
    if (activeId === id) activeId = 0;
  }
}

async function runLines(id: number, keys: string[], lang: string, options: PlayOptions): Promise<boolean> {
  // A line that comes while another plays waits for it when asked to (`queue`), else it replaces it.
  const waitFor = options.queue ? current : null;
  if (!waitFor) endCurrent();
  const waitDevice = !!options.queue && spoke && !waitFor;
  if (spoke && !waitDevice) {
    spoke = false;
    stopSpeaking();
  }
  const audible = audio.voiceAudible;
  /** Reads the text from part `from` on, if the caller allows it (nothing else is playing then). */
  const speakFrom = (from: number): false => {
    if (id !== token || !options.fallback) return false;
    const text = options.parts && options.parts.length === keys.length ? options.parts.slice(from).join(' ') : from === 0 ? options.text : undefined;
    return speakText(text, lang, !!options.queue && from === 0);
  };
  try {
    // Sound at 0 (or Voices off): the manifest is not downloaded either (what is already known is used).
    const lines = audible && options.voices !== false ? await loadManifest() : (voiceLines.value ?? {});
    if (id !== token) return false;
    if (waitFor) {
      await waitFor.ended;
      if (id !== token) return false;
    }
    if (waitDevice) {
      await deviceSpeechEnded(id);
      if (id !== token) return false;
      spoke = false;
    }
    const entries = keys.map((key) => findEntry(lines, lang, key));
    const whole = entries.length > 0 && entries.every((entry): entry is VoiceEntry => entry !== null);
    const mode = decide(whole ? (entries[0] as VoiceEntry) : null, { ...options, audible });
    if (mode === 'file') {
      // Start loading every part at once (the next one loads while the first plays); a failure is a null.
      const loads = (entries as VoiceEntry[]).map((entry) => loadBuffer(entry).catch(() => null));
      for (let index = 0; index < loads.length; index++) {
        const buffer = await loads[index];
        if (id !== token) return false;
        if (!buffer) return options.recordedOnly ? false : speakFrom(index); // cannot load: the device's voice reads what has not been played
        const handle = audio.playVoice(buffer, (entries[index] as VoiceEntry).speaker === 'mc');
        if (!handle) return options.recordedOnly ? false : speakFrom(index); // cannot start (tab hidden, no sound on the device)
        stopSpeaking(); // the device's voice and a recorded line must not talk at once
        if (!(await playSegment(handle))) return false;
        if (id !== token) return false;
      }
      return true;
    }
    if (mode === 'speech') return speakFrom(0);
    return false;
  } catch {
    return speakFrom(0);
  }
}

/** Plays the line for a text key (see playLines). */
export function playLine(key: string, lang: string, options: PlayOptions = {}): Promise<boolean> {
  return playLines([key], lang, options);
}

// ----- Lumi speaks by itself ------------------------------------------------------------------------

export interface AutoSpeakInput {
  /** The setting "Lumi speaks by itself". */
  autoSpeak: boolean;
  /** The setting "Voices" (recorded voices). */
  voices: boolean;
  /** The line has a recorded file. */
  hasFile: boolean;
  /** A film is playing: films speak for themselves. */
  inFilm: boolean;
  /** The Sound effects volume setting, 0 to 1 (the recorded voices use it; it is not a master volume). */
  volume: number;
}

/**
 * What happens at once when a new line appears in Lumi's bubble, by the one rule in `decide`: its recorded file
 * (Voices on, a file, volume above 0), else the device's voice reading the shown text (Voices off, no file, or
 * Sound effects at 0: Lumi is always heard), or nothing (the setting is off, or a film is playing).
 */
export function decideAutoSpeak(input: AutoSpeakInput): 'file' | 'speech' | 'none' {
  if (!input.autoSpeak || input.inFilm) return 'none';
  const entry: VoiceEntry | null = input.hasFile ? { file: 'x.mp3', hash: '', chars: 0, speaker: 'lumi' } : null;
  return decide(entry, { text: 'x', fallback: input.autoSpeak, voices: input.voices, audible: input.volume > 0 });
}

let lastAutoKey = '';
let lastAutoAt = 0;
let autoToken = -1;
/** The same key counts as a repeat only for this long: a fresh alert of the same kind is spoken again. */
const REPEAT_MS = 12_000;

/**
 * The same line is not spoken twice in a row within a few seconds (a hint that comes again on every tap of the
 * plan). The key decides, not the text: only the numbers in it change. A line that a film or a close cut off is
 * forgotten (see stopAutoLine), so that its copy after the film is heard.
 */
export function isRepeat(key: string, now: number = Date.now()): boolean {
  return lastAutoKey === key && now - lastAutoAt < REPEAT_MS;
}
export function markSpoken(key: string, now: number = Date.now()): void {
  lastAutoKey = key;
  lastAutoAt = now;
}
/** A new mission starts: the first line is spoken even if it is the one spoken last. */
export function forgetSpoken(): void {
  lastAutoKey = '';
  lastAutoAt = 0;
  autoToken = -1;
}

/**
 * Speaks a new line of Lumi by itself: its file, or the shown text with the device's voice. A new line stops the
 * old one. The line remembers that it is Lumi's own, so that a film can cut it off (see stopAutoLine).
 */
export function speakAutoLine(what: 'file' | 'speech', key: string, text: string, lang: string): void {
  markSpoken(key);
  if (isTalking(key)) return; // already playing: not restarted
  if (what === 'file') {
    void playLines([key], lang, { text, fallback: true });
  } else {
    stopLine();
    talkingKey = key;
    speakText(text, lang);
  }
  autoToken = token;
}

/**
 * A film starts: Lumi's own line stops, but only if nothing newer has started since (the first beat of the film
 * may already be playing, and must not be cut).
 */
export function stopAutoLine(): void {
  if (autoToken === token) {
    stopLine();
    lastAutoKey = ''; // it was cut off: its copy after a film is heard
  }
  autoToken = -1;
}
