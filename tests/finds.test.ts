/**
 * Discoveries on walks outside, and the texts that go with them.
 */
import { describe, expect, it } from 'vitest';
import { CODEX } from '../src/data/codex';
import { en } from '../src/i18n/en';
import { ru } from '../src/i18n/ru';
import { earnedBadges } from '../src/sim/debrief';
import { FINDS, FIND_SCIENCE, findFlag, foundIn, recordFind } from '../src/sim/finds';
import { applyEva, computeWeek, createMission } from '../src/sim/mission';
import type { EvaResult, MissionConfig, SiteId } from '../src/sim/types';
import { DATA } from './bots';

/** Same limits as the 3D world (src/world/terrain.ts): flat building ground and the edge of the walk. */
const BASE_RADIUS = 44;
const WALK_RADIUS = 118;

const config = (site: SiteId): MissionConfig => ({
  site,
  difficulty: 'cadet',
  weeks: 6,
  startDate: '2019-12-01',
  seed: 3,
  tutorial: false,
  sunMode: 'random',
});

const walk = (over: Partial<EvaResult>): EvaResult => ({
  seconds: 40,
  samples: 0,
  science: 0,
  chore: false,
  caught: false,
  alerted: false,
  ...over,
});

describe('discoveries', () => {
  it('lie out in the wild ground, inside the area a cadet may walk', () => {
    for (const site of ['mars', 'moon'] as SiteId[]) {
      for (const find of FINDS[site]) {
        const distance = Math.hypot(find.x, find.z);
        expect(distance, find.id).toBeGreaterThan(BASE_RADIUS);
        expect(distance + find.reach, find.id).toBeLessThan(WALK_RADIUS);
      }
    }
  });

  it('each have a Science log card in both languages, with a source', () => {
    for (const find of [...FINDS.mars, ...FINDS.moon]) {
      const card = CODEX.find((item) => item.id === find.id);
      expect(card, find.id).toBeDefined();
      expect(card!.en.title.length, find.id).toBeGreaterThan(0);
      expect(card!.ru.title.length, find.id).toBeGreaterThan(0);
      expect(card!.en.body.length, find.id).toBeGreaterThan(80);
      expect(card!.ru.body.length, find.id).toBeGreaterThan(80);
      expect(card!.en.numbers.length, find.id).toBe(card!.ru.numbers.length);
      expect(card!.sources.length, find.id).toBeGreaterThan(0);
      for (const source of card!.sources) expect(source.url, find.id).toMatch(/^https:\/\//);
    }
  });

  it('each have a line for Lumi in both languages', () => {
    for (const find of [...FINDS.mars, ...FINDS.moon]) {
      expect(en[`lumi.find.${find.id}`], find.id).toBeTruthy();
      expect(ru[`lumi.find.${find.id}`], find.id).toBeTruthy();
    }
  });

  it('count the moment they are made, once per mission, and toward the Explorer badge', () => {
    const state = createMission(config('mars'), DATA);
    expect(foundIn(state)).toEqual([]);
    const [first, second, third] = FINDS.mars;
    expect(recordFind(state, first.id)).toBe(true);
    expect(recordFind(state, first.id)).toBe(false);
    expect(state.flags[findFlag(first.id)]).toBe(true);
    expect(state.science).toBe(FIND_SCIENCE);
    // The weekly report shows it on its own line.
    expect(computeWeek(state).parts.sciFinds).toBe(FIND_SCIENCE);

    // The walk result lists the same find again: nothing is counted twice.
    applyEva(state, walk({ samples: 1, science: 2, finds: [first.id] }));
    expect(state.science).toBe(FIND_SCIENCE + 2);

    // A find that only the walk result knows about (a walk from an older version) still counts, once.
    state.now.eva = null;
    applyEva(state, walk({ finds: [second.id] }));
    expect(foundIn(state)).toEqual([first.id, second.id]);
    expect(state.science).toBe(FIND_SCIENCE * 2 + 2);
    expect(earnedBadges(state)).not.toContain('explorer');

    recordFind(state, third.id);
    expect(earnedBadges(state)).toContain('explorer');
  });

  it('are kept when the game was closed during a storm alert and the walk ends as caught', () => {
    const state = createMission(config('moon'), DATA);
    recordFind(state, FINDS.moon[0].id);
    // What the game records in that case: a caught walk with no list of finds.
    applyEva(state, { seconds: 30, samples: 0, science: 0, chore: false, caught: true, alerted: true });
    expect(foundIn(state)).toEqual([FINDS.moon[0].id]);
    expect(state.science).toBe(FIND_SCIENCE);
  });

  it('do not change an old walk result that has no discoveries in it', () => {
    const state = createMission(config('moon'), DATA);
    applyEva(state, walk({ samples: 2, science: 6 }));
    expect(foundIn(state)).toEqual([]);
    expect(state.science).toBe(6);
  });
});

describe('texts', () => {
  it('have the same keys in English and Russian', () => {
    const missingInRu = Object.keys(en).filter((key) => !(key in ru));
    const missingInEn = Object.keys(ru).filter((key) => !(key in en));
    expect(missingInRu).toEqual([]);
    expect(missingInEn).toEqual([]);
  });
});
