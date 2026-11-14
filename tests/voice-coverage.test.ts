/**
 * Everything Lumi can say is voiced (on both worlds), the event cards are voiced in priority order,
 * and "Lumi speaks by itself" decides what to play. See docs/VOICE.md.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../scripts/voice/generate';
import { cardKeys, collectLines, creditsPerChar, emptyManifest, loadDicts, lumiKeys, planLines, spokenText, summarizeCategories } from '../scripts/voice/lib';
import type { Dicts, VoiceConfig } from '../scripts/voice/lib';
import { cardVoiceKeys } from '../src/game/view';
import { decideAutoSpeak, forgetSpoken, isRepeat, markSpoken } from '../src/game/voice';
import { voiceEn, voiceRu } from '../src/i18n/voice';
import { EVENTS } from '../src/sim/events';
import { FINDS } from '../src/sim/finds';
import { createMission } from '../src/sim/mission';
import { BUILDINGS, ROOMS, TOOLS } from '../src/sim/outpost';
import type { MissionConfig, SiteId } from '../src/sim/types';
import { DATA } from './bots';

const cfg: VoiceConfig = loadConfig();
const dicts: Dicts = loadDicts();
const MODEL = cfg.model;
const PER_CHAR = creditsPerChar(cfg, MODEL) as number;
const SITES: SiteId[] = ['mars', 'moon'];
const ROOT = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** The text up to the first comma that is not inside brackets or quotes: the first argument of a call. */
function firstArgument(code: string, from: number): string {
  let depth = 0;
  let quote = '';
  for (let i = from; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return code.slice(from, i);
      depth -= 1;
    } else if (ch === ',' && depth === 0) return code.slice(from, i);
  }
  return code.slice(from);
}

const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** The Science-log cards Lumi tells about in the rooms (the 'look' stations of the interior). */
function lookIds(): string[] {
  const code = readFileSync(join(ROOT, 'src/world/interior.ts'), 'utf8');
  const ids = new Set<string>();
  for (const match of code.matchAll(/'look',\s*'([a-z_0-9]+)'/g)) ids.add(match[1]);
  // `{ id: look.site === 'moon' ? 'moon_telescope' : 'phobos_eclipse', kind: 'look', ... }`
  for (const match of code.matchAll(/id:\s*[^,]*?\?\s*'([a-z_0-9]+)'\s*:\s*'([a-z_0-9]+)',\s*kind: 'look'/g)) {
    ids.add(match[1]);
    ids.add(match[2]);
  }
  return [...ids];
}

/** What each template key of the game can be (the part in `${...}`). A new template key must be added here. */
const EXPANSIONS: Record<string, string[]> = {
  'lumi.welcome.': SITES,
  'lumi.storm.': SITES,
  'lumi.night.': SITES,
  'lumi.eva.footprints.': SITES,
  'lumi.eva.metal.': SITES,
  'lumi.room.': ROOMS.map((room) => room.id),
  'lumi.look.': lookIds(),
  'lumi.won.': [...new Set([...ROOMS.flatMap((room) => room.games.map((game) => game.game)), 'garden'])],
  'lumi.tool.': TOOLS.map((tool) => tool.id),
  'lumi.built.': BUILDINGS.map((building) => building.id),
  'lumi.find.': [...FINDS.mars, ...FINDS.moon].map((find) => find.id),
};

/** Every key the game can pass to say(), found in the source: literal keys and the expansion of template keys. */
function keysLumiCanSay(): { keys: Set<string>; unknownTemplates: string[] } {
  const keys = new Set<string>();
  const unknownTemplates: string[] = [];
  const found = new Set<string>();
  const files = ['src/game', 'src/net', 'src/ui'].flatMap((dir) => sourceFiles(join(ROOT, dir)));
  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    // A file with its own local say() (the plant game's hint line) is not Lumi; store.ts only defines it.
    const local = /(?:const|function)\s+say\b/.test(code);
    if (!local) {
      for (const call of code.matchAll(/(?<![\w.])say\(/g)) {
        const arg = firstArgument(code, (call.index ?? 0) + call[0].length);
        // Keys are dotted: a bare word in a condition ('metal', 'bunker') is not a key.
        for (const literal of arg.matchAll(LITERAL)) if (literal[2].includes('.')) found.add(literal[2]);
      }
    }
    // Keys kept in variables before they reach say() (the weekly report line).
    for (const literal of code.matchAll(/(['"`])(lumi\.[^'"`]*)\1/g)) found.add(literal[2]);
  }
  for (const key of found) {
    if (key === 'lumi.name') continue; // the label of the bubble, not a line
    if (!key.includes('${')) {
      keys.add(key);
      continue;
    }
    const prefix = key.slice(0, key.indexOf('${'));
    const ids = EXPANSIONS[prefix];
    if (!ids || !key.endsWith('}')) unknownTemplates.push(key);
    else for (const id of ids) keys.add(prefix + id);
  }
  return { keys, unknownTemplates };
}

const everything = planLines(collectLines(cfg, dicts, { model: MODEL }), emptyManifest(), () => false, 1e9, PER_CHAR);
const planned = (lang: 'en' | 'ru'): Set<string> =>
  new Set(everything.lines.filter((line) => line.lang === lang && line.text !== null && line.status !== 'over-budget').map((line) => line.key));

describe('every line Lumi can say is voiced', () => {
  it('finds the keys in the source (the scan itself works)', () => {
    const { keys, unknownTemplates } = keysLumiCanSay();
    expect(unknownTemplates, 'a template key with no list of ids: add it to EXPANSIONS').toEqual([]);
    expect(keys.size).toBeGreaterThan(80);
    for (const key of [
      'lumi.welcome.moon',
      'lumi.storm.moon',
      'lumi.find.orange_soil',
      'lumi.find.new_craters',
      'lumi.built.bunker',
      'lumi.tool.vest',
      'lumi.eva.moonJump',
      'lumi.eva.noSound.moon',
      'lumi.report.bad',
      'lumi.look.moon_telescope',
      'lumi.won.landing',
      'lumi.room.lander',
      'eva.edge',
    ]) {
      expect(keys.has(key), key).toBe(true);
    }
    expect(keys.has('mg.plants.fine')).toBe(false);
  });

  it('plans each of them in both languages, or lists it as skipped with a reason', () => {
    const { keys } = keysLumiCanSay();
    const skipped = cfg.lumiSkip ?? {};
    for (const [key, why] of Object.entries(skipped)) expect(why.length, `skip reason of ${key}`).toBeGreaterThan(10);
    const unplanned: string[] = [];
    for (const key of keys) {
      if (skipped[key] !== undefined) continue;
      for (const lang of ['en', 'ru'] as const) if (!planned(lang).has(key)) unplanned.push(`${lang}:${key}`);
    }
    expect(unplanned, 'Lumi can say these but the voice does not plan them').toEqual([]);
  });

  it('gives every Lumi line with {params} a spoken version without them (or skips it on purpose)', () => {
    const problems: string[] = [];
    for (const key of lumiKeys(cfg, dicts)) {
      if (cfg.lumiSkip?.[key] !== undefined) continue;
      for (const lang of ['en', 'ru'] as const) {
        const shown = dicts[lang][key] ?? '';
        const spoken = spokenText(key, lang, dicts);
        if (spoken.text === null) problems.push(`${lang}:${key} ${spoken.skip}`);
        else if (/\{/.test(shown) && !dicts[lang][`voice.${key}`]) problems.push(`${lang}:${key} no voice text`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('plans the twin of every planned .mars / .moon line when the twin exists', () => {
    const problems: string[] = [];
    for (const lang of ['en', 'ru'] as const) {
      const have = planned(lang);
      for (const key of have) {
        const other = key.endsWith('.mars') ? key.replace(/\.mars$/, '.moon') : key.endsWith('.moon') ? key.replace(/\.moon$/, '.mars') : null;
        if (other && dicts[lang][other] !== undefined && !have.has(other)) problems.push(`${lang}:${key} -> ${other}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('plans the same keys in English and Russian', () => {
    expect([...planned('en')].filter((key) => !planned('ru').has(key))).toEqual([]);
    expect([...planned('ru')].filter((key) => !planned('en').has(key))).toEqual([]);
  });

  it('the scan catches a key that is missing from the plan', () => {
    const thin: Dicts = { en: { ...dicts.en }, ru: { ...dicts.ru } };
    delete thin.en['lumi.find.orange_soil'];
    const plan = planLines(collectLines(cfg, thin, { model: MODEL }), emptyManifest(), () => false, 1e9, PER_CHAR);
    const have = new Set(plan.lines.filter((line) => line.lang === 'en' && line.text !== null).map((line) => line.key));
    expect(keysLumiCanSay().keys.has('lumi.find.orange_soil')).toBe(true);
    expect(have.has('lumi.find.orange_soil')).toBe(false);
  });
});

describe('card lines', () => {
  const plan = (budget: number) => planLines(collectLines(cfg, dicts, { model: MODEL }), emptyManifest(), () => false, budget, PER_CHAR);

  it('plan the texts of every event on both worlds', () => {
    const keys = new Set(cardKeys(dicts).map((card) => card.key));
    expect(keys.has('ev.quake.title.moon') && keys.has('ev.quake.title.mars')).toBe(true);
    expect(keys.has('ev.solar_storm.body.cme') && keys.has('ev.plants_sick.ra.marsNear')).toBe(true);
    const unplanned = everything.lines.filter((line) => line.kind === 'cards' && (line.text === null || line.status === 'over-budget')).map((line) => `${line.lang}:${line.key}`);
    expect(unplanned, 'a card text with {params} needs a voice.<key> text').toEqual([]);
  });

  it('give the keys the cards really read (event card and result card), on both worlds', () => {
    const have = new Set(everything.lines.filter((line) => line.kind === 'cards' && line.text !== null).map((line) => `${line.lang}:${line.key}`));
    const base: Omit<MissionConfig, 'site'> = { difficulty: 'commander', weeks: 10, startDate: '2024-04-26', seed: 1, tutorial: false, sunMode: 'random' };
    let checked = 0;
    const missing: string[] = [];
    for (const site of SITES) {
      for (const event of Object.values(EVENTS)) {
        if (!event.sites.includes(site)) continue;
        // The storm card changes with the kind of storm on Mars; the result changes when Earth's answer comes in time.
        const kinds = event.id === 'solar_storm' && site === 'mars' ? ['cme', 'sep'] : [undefined];
        for (const basis of kinds) {
          for (const near of site === 'mars' ? [true, false] : [false]) {
            const state = createMission({ ...base, site }, DATA);
            state.now.eventId = event.id;
            const env = state.plan[0];
            if (basis) env.storm = { ...env.storm, basis: basis as typeof env.storm.basis };
            env.conjunction = false;
            env.delaySeconds = near ? 60 : 1e6;
            const lists = [cardVoiceKeys(state, event.id), ...event.options.map((option) => cardVoiceKeys(state, event.id, option.id))];
            for (const list of lists) {
              expect(list.length).toBe(2);
              for (const key of list) {
                checked += 1;
                for (const lang of ['en', 'ru'] as const) if (!have.has(`${lang}:${key}`)) missing.push(`${site}/${lang}:${key}`);
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('are in priority order: stories, then results, then titles and bodies', () => {
    const rows = summarizeCategories(everything, PER_CHAR);
    const credits = (kind: string, part?: string): number => rows.find((row) => row.kind === kind && row.part === part)?.credits ?? 0;
    const beforeCards = credits('films') + credits('lumi');
    const only = (budget: number): Record<string, number> => {
      const counts: Record<string, number> = {};
      for (const line of plan(budget).lines) {
        const name = line.kind === 'cards' ? `cards:${line.part}` : line.kind;
        if (line.status !== 'over-budget' && line.text !== null) counts[name] = (counts[name] ?? 0) + 1;
      }
      return counts;
    };
    // Only films and Lumi fit: no card at all.
    expect(only(beforeCards + 1)['cards:story'] ?? 0).toBe(0);
    // Films, Lumi and the stories fit: no result, title or body yet.
    const withStories = only(beforeCards + credits('cards', 'story'));
    expect(withStories['cards:story']).toBe(rows.find((row) => row.part === 'story')?.planned);
    expect(withStories['cards:result'] ?? 0).toBe(0);
    expect(withStories['cards:title'] ?? 0).toBe(0);
    // Then the results; the titles and bodies come last.
    const withResults = only(beforeCards + credits('cards', 'story') + credits('cards', 'result'));
    expect(withResults['cards:result']).toBe(rows.find((row) => row.part === 'result')?.planned);
    expect(withResults['cards:title'] ?? 0).toBe(0);
    expect(withResults['cards:body'] ?? 0).toBe(0);
    expect(only(1e9)['cards:body']).toBeGreaterThan(0);
  });

  it('keep all 96 film lines and all of Lumi ahead of any card', () => {
    const rows = summarizeCategories(everything, PER_CHAR);
    const films = rows.find((row) => row.kind === 'films' && !row.part);
    expect(films?.planned).toBe(96);
    expect(films?.total).toBe(96);
    const lumi = rows.find((row) => row.kind === 'lumi');
    expect(lumi?.planned).toBe(lumi?.total);
    const budget = (films?.credits ?? 0) + (lumi?.credits ?? 0);
    expect(plan(budget).lines.filter((line) => line.kind === 'cards' && line.status !== 'over-budget').length).toBe(0);
  });

  it('count the whole set per category', () => {
    const rows = summarizeCategories(everything, PER_CHAR);
    expect(rows.map((row) => (row.part ? `cards:${row.part}` : row.kind))).toEqual(['films', 'lumi', 'cards', 'cards:story', 'cards:result', 'cards:title', 'cards:body']);
    const whole = rows.filter((row) => !row.part);
    expect(whole.reduce((sum, row) => sum + row.credits, 0)).toBeCloseTo(everything.credits, 5);
  });
});

describe('decideAutoSpeak', () => {
  const on = { autoSpeak: true, voices: true, hasFile: true, inFilm: false, volume: 0.8 };
  const both = [true, false];
  it('plays the recorded file when voices are on and the line has one', () => {
    expect(decideAutoSpeak(on)).toBe('file');
  });
  it('reads the shown text with the device voice when voices are off or the line has no file', () => {
    expect(decideAutoSpeak({ ...on, voices: false })).toBe('speech');
    expect(decideAutoSpeak({ ...on, voices: false, hasFile: false })).toBe('speech');
    expect(decideAutoSpeak({ ...on, hasFile: false })).toBe('speech');
  });
  it('plays nothing when the setting is off, whatever else is true', () => {
    for (const voices of both) for (const hasFile of both) expect(decideAutoSpeak({ ...on, autoSpeak: false, voices, hasFile })).toBe('none');
  });
  it('never speaks over a film', () => {
    for (const voices of both) for (const hasFile of both) expect(decideAutoSpeak({ ...on, inFilm: true, voices, hasFile })).toBe('none');
  });
  it('is silent, and downloads nothing, when the sound volume is 0', () => {
    for (const voices of both) for (const hasFile of both) expect(decideAutoSpeak({ ...on, volume: 0, voices, hasFile })).toBe('none');
    expect(decideAutoSpeak({ ...on, volume: 0.05 })).toBe('file');
  });
  it('does not repeat the same line twice in a row, whatever numbers it shows', () => {
    forgetSpoken();
    expect(isRepeat('lumi.plan.foodLow')).toBe(false);
    markSpoken('lumi.plan.foodLow');
    expect(isRepeat('lumi.plan.foodLow')).toBe(true);
    expect(isRepeat('lumi.plan.over')).toBe(false);
    markSpoken('lumi.plan.over');
    expect(isRepeat('lumi.plan.foodLow')).toBe(false);
    forgetSpoken();
    expect(isRepeat('lumi.plan.over')).toBe(false);
  });
  it('speaks the same alert again after a few seconds', () => {
    forgetSpoken();
    markSpoken('lumi.eva.alert', 1000);
    expect(isRepeat('lumi.eva.alert', 2000)).toBe(true);
    expect(isRepeat('lumi.eva.alert', 14000)).toBe(false);
  });
});

describe('the new setting', () => {
  it('is on by default and has its texts in both languages', async () => {
    const store = await import('../src/game/store');
    expect(store.settings.value.autoSpeak).toBe(true);
    expect(voiceEn['set.autoSpeak']).toBe('Lumi speaks by itself');
    expect(voiceEn['set.autoSpeakHint']).toBe('Off: Lumi speaks only when you tap the speaker.');
    expect(voiceRu['set.autoSpeak']).toBe('Люми говорит без нажатия');
    expect(voiceRu['set.autoSpeakHint']).toBe('Выключено: Люми говорит, только когда нажмёшь на динамик.');
  });
  it('old saves get the default through the merge of load()', async () => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'fo.settings' ? JSON.stringify({ volume: 0.3, voice: false }) : null), setItem: () => undefined });
    vi.resetModules();
    const store = await import('../src/game/store');
    vi.unstubAllGlobals();
    expect(store.settings.value.volume).toBe(0.3);
    expect(store.settings.value.voice).toBe(false);
    expect(store.settings.value.autoSpeak).toBe(true);
  });
});
