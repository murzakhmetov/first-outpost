/**
 * Playing a list of voice keys one after another (the event card: title, then body), with a fake
 * network and a fake sound. This file has its own module copy, so the manifest it loads is its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spoken: string[] = [];
vi.mock('../src/game/audio', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/game/audio')>();
  return { ...original, speak: (text: string) => void spoken.push(text), stopSpeaking: () => undefined };
});

import { audio } from '../src/game/audio';
import { playLine, playLines, stopLine } from '../src/game/voice';

const MANIFEST = {
  version: 1,
  lines: {
    'en:ev.a.title': { file: 'aaaaaaaaaaaa.mp3', hash: 'a', chars: 5, speaker: 'caption' },
    'en:ev.a.body': { file: 'bbbbbbbbbbbb.mp3', hash: 'b', chars: 5, speaker: 'caption' },
    'en:ev.c.title': { file: 'cccccccccccc.mp3', hash: 'c', chars: 5, speaker: 'caption' },
    'en:ev.e.title': { file: 'eeeeeeeeeeee.mp3', hash: 'e', chars: 5, speaker: 'caption' },
    'en:ev.e.body': { file: 'ffffffffffff.mp3', hash: 'f', chars: 5, speaker: 'caption' },
    'en:ev.d.title': { file: 'dddddddddddd.mp3', hash: 'd', chars: 5, speaker: 'caption' },
  },
};

const fetched: string[] = [];
const played: string[] = [];

beforeEach(() => {
  spoken.length = 0;
  fetched.length = 0;
  played.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(String(url));
      if (String(url).endsWith('manifest.json')) return new Response(JSON.stringify(MANIFEST), { status: 200 });
      return new Response(new TextEncoder().encode(String(url)), { status: 200 });
    }),
  );
  // Each "file" holds its own url and decodes to a buffer that remembers it; playing it ends at once.
  vi.spyOn(audio, 'decodeVoice').mockImplementation(async (data) => ({ id: new TextDecoder().decode(data) }) as unknown as AudioBuffer);
  vi.spyOn(audio, 'playVoice').mockImplementation((buffer) => {
    played.push((buffer as unknown as { id: string }).id.split('/').pop() as string);
    return { done: Promise.resolve(), stop: () => undefined };
  });
});

afterEach(() => {
  stopLine();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('playLines', () => {
  it('plays every file in reading order when each key has one', async () => {
    await expect(playLines(['ev.a.title', 'ev.a.body'], 'en', { text: 'Title. Body.', fallback: true })).resolves.toBe(true);
    expect(played).toEqual(['aaaaaaaaaaaa.mp3', 'bbbbbbbbbbbb.mp3']);
    expect(spoken).toEqual([]);
  });

  it('falls back to the whole text with the device voice when one key has no file', async () => {
    await expect(playLines(['ev.a.title', 'ev.missing.body'], 'en', { text: 'Title. Body.', fallback: true })).resolves.toBe(false);
    expect(played).toEqual([]);
    expect(spoken).toEqual(['Title. Body.']);
  });

  it('stays silent, with no fallback asked for, when a key has no file', async () => {
    await expect(playLines(['ev.a.title', 'ev.missing.body'], 'en', { text: 'Title. Body.' })).resolves.toBe(false);
    expect(played).toEqual([]);
    expect(spoken).toEqual([]);
  });

  it('falls back to the whole text when the language has no files at all', async () => {
    await expect(playLines(['ev.a.title', 'ev.a.body'], 'ru', { text: 'Заголовок. Текст.', fallback: true })).resolves.toBe(false);
    expect(played).toEqual([]);
    expect(spoken).toEqual(['Заголовок. Текст.']);
  });

  it('stays silent (no device voice) when a file that exists cannot be decoded', async () => {
    vi.spyOn(audio, 'decodeVoice').mockResolvedValue(null);
    await expect(playLines(['ev.e.title', 'ev.e.body'], 'en', { text: 'Title. Body.', fallback: true })).resolves.toBe(false);
    expect(played).toEqual([]);
    expect(spoken).toEqual([]);
  });

  it('does not read the title again with the device voice when a later segment cannot start', async () => {
    let calls = 0;
    vi.spyOn(audio, 'playVoice').mockImplementation(() => {
      calls++;
      return calls === 1 ? { done: Promise.resolve(), stop: () => undefined } : null;
    });
    await expect(playLines(['ev.a.title', 'ev.a.body'], 'en', { text: 'Title. Body.', fallback: true })).resolves.toBe(false);
    expect(calls).toBe(2);
    expect(spoken).toEqual([]);
  });

  it('downloads no manifest, no file and no device voice for a recorded line when the sound volume is 0', async () => {
    audio.setVolumes(0, 0.5);
    await playLines(['ev.a.title'], 'en', { text: 'Title.', fallback: true });
    audio.setVolumes(0.8, 0.5);
    expect(fetched).toEqual([]);
    expect(spoken).toEqual([]);
  });

  it('downloads no file and plays nothing from the recorded voices when the sound volume is 0', async () => {
    audio.setVolumes(0, 0.5);
    await playLines(['ev.d.title'], 'en', { text: 'Only text.', fallback: true });
    audio.setVolumes(0.8, 0.5);
    expect(fetched.filter((url) => url.endsWith('.mp3'))).toEqual([]);
    expect(played).toEqual([]);
  });

  it('a single key still works as before', async () => {
    await expect(playLine('ev.c.title', 'en')).resolves.toBe(true);
    expect(played).toEqual(['cccccccccccc.mp3']);
  });

  it('an empty list does nothing and never throws', async () => {
    await expect(playLines([], 'en', { text: 'x' })).resolves.toBe(false);
    expect(played).toEqual([]);
  });
});
