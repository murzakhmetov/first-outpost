import { describe, expect, it } from 'vitest';
import { FILMS, TASKS, TOUR, beatKey, taskLine, whyKeys } from '../src/game/films';
import type { FilmId } from '../src/game/films';
import { en } from '../src/i18n/en';
import { filmsEn, filmsRu } from '../src/i18n/films';
import { minigamesEn, minigamesRu } from '../src/i18n/minigames';
import { ru } from '../src/i18n/ru';
import { readSeconds } from '../src/ui/Cutscene';

const EN = { ...en, ...minigamesEn, ...filmsEn };
const RU = { ...ru, ...minigamesRu, ...filmsRu };
const SITES = ['mars', 'moon'] as const;
/** The camera places of the outpost (World/base.ts SpotId). */
const SPOTS = ['overview', 'hab', 'farm', 'lab', 'solar', 'shield', 'sky', 'far', 'rover', 'airlock'];
const SHOTS = ['approach', 'touchdown', 'base', 'crew', 'goal', 'cheer', 'liftoff', 'storm', 'dust'];

describe('films', () => {
  it('have their texts in both languages on both worlds', () => {
    const missing: string[] = [];
    for (const film of Object.values(FILMS)) {
      for (const site of SITES) {
        if (film.sites && !film.sites.includes(site)) continue;
        for (const beat of film.beats) {
          const key = beatKey(beat, site);
          if (!(key in EN)) missing.push(`en ${key}`);
          if (!(key in RU)) missing.push(`ru ${key}`);
        }
        if (film.card === 'why' && film.task) {
          for (const key of Object.values(whyKeys(film.task, site))) {
            if (!(key in EN)) missing.push(`en ${key}`);
            if (!(key in RU)) missing.push(`ru ${key}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('use only shots the world knows', () => {
    const bad = Object.values(FILMS)
      .flatMap((film) => film.beats.map((beat) => beat.shot))
      .filter((shot) => !(SHOTS.includes(shot) || (shot.startsWith('spot:') && SPOTS.includes(shot.slice(5)))));
    expect(bad).toEqual([]);
  });

  it('give every task a film with a why card, and the intro tour shows the tasks in the order of a week', () => {
    for (const task of TASKS) {
      const film = FILMS[`task.${task}` as FilmId];
      expect(film.card).toBe('why');
      expect(film.beats[0].key).toBe(taskLine(task));
    }
    const tour = FILMS.intro.beats.filter((beat) => beat.task).map((beat) => beat.task);
    expect(tour).toEqual(TOUR);
    expect(FILMS.intro.card).toBe('goal');
    expect(FILMS.intro.landing).toBe(true);
  });

  it('have the same text keys in English and Russian, with a source for every fact', () => {
    expect(Object.keys(filmsRu).sort()).toEqual(Object.keys(filmsEn).sort());
    const facts = Object.keys(filmsEn).filter((key) => key.includes('.fact.'));
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) expect(filmsEn[fact.replace('.fact.', '.src.')]).toBeTruthy();
    // Sources are names, not translations: the same in both languages.
    for (const key of Object.keys(filmsEn).filter((name) => name.includes('.src.'))) expect(filmsRu[key]).toBe(filmsEn[key]);
  });

  it('leave a line on screen long enough to read, but not forever', () => {
    expect(readSeconds('')).toBeGreaterThanOrEqual(2);
    expect(readSeconds('x'.repeat(120))).toBeGreaterThan(readSeconds('x'.repeat(40)));
    expect(readSeconds('x'.repeat(2000))).toBeLessThanOrEqual(9);
  });
});
