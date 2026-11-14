/**
 * The voice-over: recorded lines (made by scripts/voice/generate.ts, see docs/VOICE.md) for the films
 * and for Lumi. `public/voice/manifest.json` says which lines have a file: "<lang>:<text key>".
 *
 * - A line with a file plays through the audio module (volume setting, music steps aside, Mission Control
 *   gets a light radio sound).
 * - A line without a file does nothing here, or is read by the device's own voice when the caller asks for
 *   that (`fallback`, used for the "read texts aloud" setting).
 * - Nothing here ever throws: a missing manifest, a missing file or a broken file just means "no voice".
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
  /** The shown text: read by the device's voice when there is no file and `fallback` is set. */
  text?: string;
  fallback?: boolean;
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

/** What to do with a line: play its file, read it with the device's voice, or stay silent. */
export function decide(entry: VoiceEntry | null, options: PlayOptions): 'file' | 'speech' | 'none' {
  if (entry) return 'file';
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

function endCurrent(): void {
  const line = current;
  current = null;
  line?.stop();
}

/** Stops the line that is playing (and a line the device's voice is reading for it). */
export function stopLine(): void {
  token += 1;
  endCurrent();
  if (spoke) {
    spoke = false;
    stopSpeaking();
  }
}

function fallbackSpeech(options: PlayOptions, lang: string): false {
  if (decide(null, options) === 'speech') {
    try {
      speak(options.text as string, lang, options.queue);
      spoke = true;
    } catch {
      /* no voice on this device */
    }
  }
  return false;
}

/**
 * Plays the line for a text key. Resolves `true` when a recorded line played to its end, and `false` when
 * there was no file, it could not be played, or it was stopped. Never rejects.
 * A new call stops the line that is playing.
 */
export async function playLine(key: string, lang: string, options: PlayOptions = {}): Promise<boolean> {
  const id = ++token;
  // A line that comes while another plays waits for it when asked to (`queue`), else it replaces it.
  const waitFor = options.queue ? current : null;
  if (!waitFor) endCurrent();
  if (spoke) {
    spoke = false;
    if (!options.queue) stopSpeaking();
  }
  try {
    const lines = await loadManifest();
    if (id !== token) return false;
    if (waitFor) {
      await waitFor.ended;
      if (id !== token) return false;
    }
    const entry = findEntry(lines, lang, key);
    // With the sound volume at 0 the file would be silent: it is not downloaded (the device's voice may still read it).
    if (decide(entry, options) === 'file' && entry && audio.voiceAudible) {
      const buffer = await loadBuffer(entry);
      if (id !== token) return false;
      const handle = buffer ? audio.playVoice(buffer, entry.speaker === 'mc') : null;
      if (handle) {
        stopSpeaking(); // the device's voice and a recorded line must not talk at once
        return await new Promise<boolean>((resolve) => {
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
    }
  } catch {
    /* fall back below */
  }
  return id === token ? fallbackSpeech(options, lang) : false;
}
