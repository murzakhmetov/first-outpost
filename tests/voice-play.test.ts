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

/** Each "file" holds its own url and decodes to a buffer that remembers it; playing it ends at once. */
function fakeSound(sound: typeof audio): void {
  vi.spyOn(sound, 'decodeVoice').mockImplementation(async (data) => ({ id: new TextDecoder().decode(data) }) as unknown as AudioBuffer);
  vi.spyOn(sound, 'playVoice').mockImplementation((buffer) => {
    played.push((buffer as unknown as { id: string }).id.split('/').pop() as string);
    return { done: Promise.resolve(), stop: () => undefined };
  });
}

/** A fresh copy of the voice and audio modules: no manifest and no file is remembered from an earlier test. */
async function fresh(): Promise<{ voice: typeof import('../src/game/voice'); sound: typeof import('../src/game/audio') }> {
  vi.resetModules();
  const sound = await import('../src/game/audio');
  const voice = await import('../src/game/voice');
  fakeSound(sound.audio);
  return { voice, sound };
}

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
  fakeSound(audio);
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

  it('reads the text with the device voice when a file that exists cannot be decoded', async () => {
    vi.spyOn(audio, 'decodeVoice').mockResolvedValue(null);
    await expect(playLines(['ev.e.title', 'ev.e.body'], 'en', { text: 'Title. Body.', fallback: true })).resolves.toBe(false);
    expect(played).toEqual([]);
    expect(spoken).toEqual(['Title. Body.']);
  });

  it('stays silent when a file cannot be decoded and the speaking setting is off', async () => {
    vi.spyOn(audio, 'decodeVoice').mockResolvedValue(null);
    await playLines(['ev.e.title', 'ev.e.body'], 'en', { text: 'Title. Body.', fallback: false });
    expect(played).toEqual([]);
    expect(spoken).toEqual([]);
  });

  it('reads only the second part with the device voice when the file of the second part fails to load', async () => {
    const { voice } = await fresh();
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      const address = String(url);
      fetched.push(address);
      if (address.endsWith('manifest.json')) return new Response(JSON.stringify(MANIFEST), { status: 200 });
      if (address.endsWith('ffffffffffff.mp3')) return new Response('no', { status: 404 });
      return new Response(new TextEncoder().encode(address), { status: 200 });
    });
    await expect(voice.playLines(['ev.e.title', 'ev.e.body'], 'en', { text: 'Title. Body.', parts: ['Title.', 'Body.'], fallback: true })).resolves.toBe(false);
    expect(played).toEqual(['eeeeeeeeeeee.mp3']);
    expect(spoken).toEqual(['Body.']);
  });

  it('reads only the parts not played yet when the second part cannot start', async () => {
    let calls = 0;
    vi.spyOn(audio, 'playVoice').mockImplementation(() => {
      calls++;
      return calls === 1 ? { done: Promise.resolve(), stop: () => undefined } : null;
    });
    await expect(playLines(['ev.a.title', 'ev.a.body'], 'en', { text: 'Title. Body.', parts: ['Title.', 'Body.'], fallback: true })).resolves.toBe(false);
    expect(calls).toBe(2);
    expect(spoken).toEqual(['Body.']);
  });

  it('reads nothing when the second part fails and the speaking setting is off', async () => {
    let calls = 0;
    vi.spyOn(audio, 'playVoice').mockImplementation(() => {
      calls++;
      return calls === 1 ? { done: Promise.resolve(), stop: () => undefined } : null;
    });
    await playLines(['ev.a.title', 'ev.a.body'], 'en', { text: 'Title. Body.', parts: ['Title.', 'Body.'], fallback: false });
    expect(spoken).toEqual([]);
  });

  it('a stopped sequence reads nothing (never a recording and the device voice together)', async () => {
    vi.spyOn(audio, 'playVoice').mockImplementation(() => ({ done: new Promise(() => undefined), stop: () => undefined }));
    const run = playLines(['ev.a.title', 'ev.a.body'], 'en', { text: 'Title. Body.', parts: ['Title.', 'Body.'], fallback: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    stopLine();
    await expect(run).resolves.toBe(false);
    expect(spoken).toEqual([]);
  });

  it('reads the text with the device voice when Voices is off, and downloads nothing', async () => {
    await playLines(['ev.a.title'], 'en', { text: 'Title.', fallback: true, voices: false });
    expect(played).toEqual([]);
    expect(fetched).toEqual([]);
    expect(spoken).toEqual(['Title.']);
  });

  it('a film line (recordedOnly) stays silent when the sound is off or its file fails', async () => {
    audio.setVolumes(0, 0.5);
    await playLines(['ev.a.title'], 'en', { text: 'Title.', fallback: true, recordedOnly: true });
    audio.setVolumes(0.8, 0.5);
    vi.spyOn(audio, 'decodeVoice').mockResolvedValue(null);
    await playLines(['ev.c.title'], 'en', { text: 'Title.', fallback: true, recordedOnly: true });
    expect(spoken).toEqual([]);
  });

  it('reads the text with the device voice when the manifest cannot be loaded (fresh module: not loaded yet)', async () => {
    const { voice } = await fresh();
    vi.mocked(fetch).mockImplementation(async () => {
      throw new Error('offline');
    });
    await expect(voice.playLines(['ev.a.title'], 'en', { text: 'Title.', fallback: true })).resolves.toBe(false);
    expect(played).toEqual([]);
    expect(spoken).toEqual(['Title.']);
  });

  it('with Sound effects at 0 reads the text with the device voice and downloads no manifest and no file (fresh module)', async () => {
    const { voice, sound } = await fresh();
    sound.audio.setVolumes(0, 0.5);
    await voice.playLines(['ev.a.title'], 'en', { text: 'Title.', fallback: true });
    expect(fetched).toEqual([]);
    expect(played).toEqual([]);
    expect(spoken).toEqual(['Title.']);
    // the speaking setting off: silent, and still nothing downloaded
    spoken.length = 0;
    await voice.playLines(['ev.a.title'], 'en', { text: 'Title.', fallback: false });
    expect(fetched).toEqual([]);
    expect(spoken).toEqual([]);
  });

  it('with Sound effects back above 0 the same line plays its recording (fresh module)', async () => {
    const { voice, sound } = await fresh();
    sound.audio.setVolumes(0.5, 0.5);
    await expect(voice.playLines(['ev.a.title'], 'en', { text: 'Title.', fallback: true })).resolves.toBe(true);
    expect(played).toEqual(['aaaaaaaaaaaa.mp3']);
    expect(spoken).toEqual([]);
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
