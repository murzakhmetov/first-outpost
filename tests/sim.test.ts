import { describe, expect, it } from 'vitest';
import archive from '../src/data/spaceweather.json';
import { donkiId, flareValue, reduceDonki, sepStrength } from '../src/sim/donki';
import type { SwDayMap } from '../src/sim/donki';
import {
  addDays,
  cosmicRayFactor,
  lunarPoleSunlight,
  marsGeometry,
  moonGeometry,
} from '../src/sim/ephemeris';
import { EVENTS } from '../src/sim/events';
import type { OptionDef } from '../src/sim/events';
import {
  applyEva,
  askEarth,
  chooseOption,
  computeWeek,
  createMission,
  currentEnv,
  earthAnswerFor,
  nextWeek,
  resolveWeek,
  setAlloc,
  URGENT_WAIT_SECONDS,
} from '../src/sim/mission';
import { Rng } from '../src/sim/rng';
import { FEATURED_WINDOWS } from '../src/sim/sites';
import { stormAt, summarizeWeek } from '../src/sim/spaceweather';
import type { MissionConfig, MissionState, Modifier, SiteId } from '../src/sim/types';
import { DATA, carefulBot, play } from './bots';

const days = (archive as unknown as { days: SwDayMap }).days;

/** An option that only gains (now or in lasting effects) and costs nothing: a "free lunch". */
function freeLunch(option: OptionDef, state: MissionState): boolean {
  const fx = typeof option.fx === 'function' ? option.fx(state) : (option.fx ?? {});
  const mods = typeof option.mods === 'function' ? option.mods(state) : (option.mods ?? []);
  const entries = Object.entries(fx) as [string, number | undefined][];
  // Dose is the one number where more is worse.
  const worse = (key: string, value: number): boolean => (key === 'dose' ? value > 0 : value < 0);
  const better = (key: string, value: number): boolean => (key === 'dose' ? value < 0 : value > 0);
  const modGain = (mod: Modifier): boolean =>
    (mod.solarFlat ?? 0) > 0 || (mod.scienceFactor ?? 1) > 1 || (mod.airPerWeek ?? 0) > 0 || (mod.foodPerWeek ?? 0) > 0 || (mod.sciencePerWeek ?? 0) > 0 || (mod.stormFactor ?? 1) < 1;
  const modCost = (mod: Modifier): boolean =>
    (mod.solarFlat ?? 0) < 0 || (mod.scienceFactor ?? 1) < 1 || (mod.airPerWeek ?? 0) < 0 || (mod.foodPerWeek ?? 0) < 0 || (mod.sciencePerWeek ?? 0) < 0 || (mod.stormFactor ?? 1) > 1;
  // Sheltering, half rations and a week without a walk cost work, food or science.
  const cost =
    entries.some(([key, value]) => worse(key, value ?? 0)) || (option.scienceFactor ?? 1) < 1 || !!option.shelter || !!option.ration || !!option.noEva || mods.some(modCost);
  const gain = entries.some(([key, value]) => better(key, value ?? 0)) || (option.scienceFactor ?? 1) > 1 || !!option.cleanPanels || mods.some(modGain);
  return gain && !cost;
}

function config(overrides: Partial<MissionConfig> = {}): MissionConfig {
  return {
    site: 'mars',
    difficulty: 'commander',
    weeks: 10,
    startDate: '2024-04-26',
    seed: 7,
    tutorial: false,
    sunMode: 'featured',
    ...overrides,
  };
}

describe('planet geometry (JPL approximate elements)', () => {
  it('matches known close approaches of Mars', () => {
    expect(marsGeometry('2018-07-31').distanceAu).toBeCloseTo(0.385, 2);
    expect(marsGeometry('2020-10-06').distanceAu).toBeCloseTo(0.415, 2);
    expect(marsGeometry('2003-08-27').distanceAu).toBeCloseTo(0.373, 2);
  });

  it('gives a radio delay between about 3 and 22.5 minutes', () => {
    let min = Infinity;
    let max = 0;
    for (let i = 0; i < 6000; i += 5) {
      const seconds = marsGeometry(addDays('2010-01-01', i)).lightSeconds;
      min = Math.min(min, seconds);
      max = Math.max(max, seconds);
    }
    expect(min / 60).toBeGreaterThan(3);
    expect(min / 60).toBeLessThan(5.5);
    expect(max / 60).toBeGreaterThan(20);
    expect(max / 60).toBeLessThan(22.6);
  });

  it('finds the real solar conjunctions', () => {
    expect(marsGeometry('2023-11-18').elongationDeg).toBeLessThan(1.5);
    expect(marsGeometry('2021-10-08').elongationDeg).toBeLessThan(1.5);
    expect(marsGeometry('2024-05-20').elongationDeg).toBeGreaterThan(20);
  });

  it('agrees with the Mars season angle reported by Curiosity REMS', () => {
    const weather = DATA.marsWeather!;
    for (const date of ['2012-08-16', '2018-06-10', '2024-05-20', '2026-08-25']) {
      const reported = weather[date][4];
      const computed = marsGeometry(date).ls;
      const diff = Math.abs(((computed - reported + 540) % 360) - 180);
      expect(diff).toBeLessThan(1.5);
    }
  });

  it('keeps the Moon at a realistic distance', () => {
    for (let i = 0; i < 400; i += 3) {
      const moon = moonGeometry(addDays('2024-01-01', i));
      expect(moon.distanceKm).toBeGreaterThan(355_000);
      expect(moon.distanceKm).toBeLessThan(407_500);
      expect(moon.lightSeconds).toBeGreaterThan(1.18);
      expect(moon.lightSeconds).toBeLessThan(1.37);
    }
  });

  it('models polar sunlight as mostly lit with short dark spells', () => {
    let total = 0;
    let darkWeeks = 0;
    const weeks = 520;
    for (let i = 0; i < weeks; i++) {
      const lit = lunarPoleSunlight(addDays('2015-01-01', i * 7));
      total += lit;
      if (lit < 0.8) darkWeeks++;
    }
    expect(total / weeks).toBeGreaterThan(0.78);
    expect(total / weeks).toBeLessThan(0.9);
    expect(darkWeeks / weeks).toBeGreaterThan(0.15);
  });

  it('makes cosmic rays stronger at solar minimum than at solar maximum', () => {
    expect(cosmicRayFactor('2020-06-01')).toBeGreaterThan(1.15);
    expect(cosmicRayFactor("2014-12-01")).toBeLessThan(0.9);
    expect(cosmicRayFactor('2025-12-01')).toBeLessThan(0.9);
  });
});

describe('NASA DONKI reducer', () => {
  it('reads flare classes', () => {
    expect(flareValue('X5.8')).toBeCloseTo(5.8e-4);
    expect(flareValue('M1.0')).toBeCloseTo(1e-5);
    expect(flareValue('C9.9')).toBeLessThan(flareValue('M1.0'));
    expect(flareValue(null)).toBe(0);
  });

  it('ranks particle storms by the instrument that saw them', () => {
    expect(sepStrength([{ displayName: 'GOES-P: SEISS >100 MeV' }]).near).toBe(3);
    expect(sepStrength([{ displayName: 'GOES13: SEM/EPS >10 MeV' }]).near).toBe(2);
    expect(sepStrength([{ displayName: 'SOHO: COSTEP 15.8-39.8 MeV' }]).near).toBe(1);
    expect(sepStrength([{ displayName: 'STEREO A: IMPACT 13-100 MeV' }])).toEqual({ near: 0, stereo: 1, mars: 0 });
    expect(sepStrength([{ displayName: 'MODEL: REleASE:ACE/EPAM 15.8-39.8 MeV' }]).near).toBe(0);
  });

  it('reduces raw records to days', () => {
    const map = reduceDonki({
      flr: [
        { peakTime: '2024-05-11T01:23Z', classType: 'X5.8', activeRegionNum: 13664, link: 'https://ccmc.gsfc.nasa.gov/DONKI/view/FLR/30711/-1' },
        { peakTime: '2024-05-11T11:44Z', classType: 'X1.5', link: 'https://ccmc.gsfc.nasa.gov/DONKI/view/FLR/30720/-1' },
        { peakTime: '2024-05-11T15:00Z', classType: 'C4.0' },
      ],
      sep: [{ eventTime: '2024-05-11T02:10Z', instruments: [{ displayName: 'GOES-P: SEISS >100 MeV' }], link: 'https://ccmc.gsfc.nasa.gov/DONKI/view/SEP/30714/-1' }],
      gst: [{ allKpIndex: [{ kpIndex: 9, observedTime: '2024-05-11T00:00Z' }], link: 'https://ccmc.gsfc.nasa.gov/DONKI/view/GST/30693/-1' }],
      enlil: [
        {
          cmeInputs: [{ speed: 1927 }],
          impactList: [{ location: 'Mars', arrivalTime: '2024-05-22T06:00Z', isGlancingBlow: false }],
          link: 'https://ccmc.gsfc.nasa.gov/DONKI/view/WSA-ENLIL/31038/-1',
        },
      ],
    });
    expect(map['2024-05-11']).toMatchObject({ f: 'X5.8', fi: 30711, ar: 13664, x: 2, s: 3, si: 30714, k: 9, ki: 30693 });
    expect(map['2024-05-11'].m).toBeUndefined();
    expect(map['2024-05-22']).toMatchObject({ ma: 2, mi: 31038, mv: 1927 });
    expect(donkiId('https://ccmc.gsfc.nasa.gov/DONKI/view/SEP/30714/-1')).toBe(30714);
  });

  it('ships an archive that contains the famous storms', () => {
    expect(days['2024-05-11']).toMatchObject({ f: 'X5.8', s: 3, k: 9 });
    expect(days['2024-10-03'].f).toBe('X9.0');
    expect(days['2017-09-10']).toMatchObject({ f: 'X8.2', s: 3 });
    expect(days['2021-10-28']).toMatchObject({ f: 'X1.0', s: 3 });
    expect(Object.keys(days).length).toBeGreaterThan(1500);
  });
});

describe('space weather at the outpost', () => {
  it('gives the Moon the May 2024 proton storm', () => {
    const sun = summarizeWeek(days, '2024-05-06');
    expect(sun.xFlares).toBeGreaterThanOrEqual(5);
    expect(sun.topFlare?.cls).toBe('X5.8');
    const storm = stormAt('moon', sun);
    expect(storm.strength).toBe(3);
    expect(storm.basis).toBe('sep');
    expect(storm.id).toBeGreaterThan(0);
  });

  it('gives Mars the 20 May 2024 storm that Curiosity measured', () => {
    const storm = stormAt('mars', summarizeWeek(days, '2024-05-20'));
    expect(storm.strength).toBe(3);
    expect(storm.basis).toBe('rad');
  });

  it('finds a quiet Sun at solar minimum', () => {
    const sun = summarizeWeek(days, '2019-12-09');
    expect(sun.activity).toBe(0);
    expect(stormAt('moon', sun).strength).toBe(0);
  });

  it('reports how often each world gets storms', () => {
    const rng = new Rng(99);
    const stats: Record<SiteId, number[]> = { mars: [0, 0, 0, 0], moon: [0, 0, 0, 0] };
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const date = addDays('2012-09-01', rng.int(0, 5000));
      const sun = summarizeWeek(days, date);
      stats.mars[stormAt('mars', sun).strength]++;
      stats.moon[stormAt('moon', sun).strength]++;
    }
    const pct = (list: number[]) => list.map((count) => `${((100 * count) / n).toFixed(1)}%`).join('  ');
    console.log(`storm weeks by strength 0/1/2/3  mars: ${pct(stats.mars)}   moon: ${pct(stats.moon)}`);
    expect(stats.moon[0] / n).toBeGreaterThan(0.75);
    expect(stats.mars[0] / n).toBeGreaterThan(0.7);
  });
});

describe('mission rules', () => {
  it('replays exactly from the same seed', () => {
    const a = play(config(), carefulBot);
    const b = play(config(), carefulBot);
    expect(a.history).toEqual(b.history);
    expect(a.end).toBe(b.end);
  });

  it('starts with no decision card in week 1 and a safe plan', () => {
    const state = createMission(config(), DATA);
    expect(state.now.eventId).toBeNull();
    expect(state.alloc.life).toBeGreaterThanOrEqual(2);
    expect(state.now.available).toBe(state.now.solar + state.battery);
  });

  it('never lets a plan use more cells than there are', () => {
    const state = createMission(config(), DATA);
    state.alloc = { life: 0, farm: 0, lab: 0, shield: 0 };
    expect(setAlloc(state, 'life', 4)).toBe(true);
    expect(setAlloc(state, 'farm', 3)).toBe(true);
    const left = state.now.available - 7;
    expect(setAlloc(state, 'lab', left + 1)).toBe(left + 1 > 3 ? true : false);
    const total = state.alloc.life + state.alloc.farm + state.alloc.lab + state.alloc.shield;
    expect(total).toBeLessThanOrEqual(state.now.available);
  });

  it('predicts the week without changing it', () => {
    const state = createMission(config(), DATA);
    const before = JSON.stringify(state);
    const outcome = computeWeek(state);
    expect(JSON.stringify(state)).toBe(before);
    const record = resolveWeek(state);
    expect(record.air).toBe(outcome.airAfter);
    expect(record.dose).toBe(outcome.doseAfter);
    expect(record.battery).toBe(outcome.batteryAfter);
  });

  it('makes every unspent cell either charge the battery or go to waste', () => {
    const state = createMission(config(), DATA);
    state.alloc = { life: 1, farm: 0, lab: 0, shield: 0 };
    const outcome = computeWeek(state);
    expect(outcome.batteryAfter).toBe(state.batteryCap);
    expect(outcome.wasted).toBe(state.now.available - 1 - state.batteryCap);
  });

  it('ends the mission when the air runs out, without crashing', () => {
    const state = createMission(config({ startDate: '2019-12-01' }), DATA);
    let guard = 30;
    while (!state.end && guard-- > 0) {
      if (state.now.eventId && !state.now.eventDone) chooseOption(state, EVENTS[state.now.eventId].options.slice(-1)[0].id);
      state.alloc = { life: 0, farm: 0, lab: 0, shield: 0 };
      resolveWeek(state);
      if (!state.end) nextWeek(state);
    }
    expect(state.end).toBe('air');
    expect(state.stars).toBe(0);
    expect(state.history.length).toBeLessThan(5);
  });

  it('makes the storm shelter cut the dose and cost science', () => {
    const make = () => {
      const state = createMission(config({ site: 'moon', startDate: '2024-04-26' }), DATA);
      // Play to the first solar-storm card.
      let guard = 20;
      while (state.now.eventId !== 'solar_storm' && guard-- > 0) {
        if (state.now.eventId && !state.now.eventDone) chooseOption(state, state.now.advice ?? 'a');
        resolveWeek(state);
        nextWeek(state);
      }
      return state;
    };
    const sheltered = make();
    const working = make();
    expect(sheltered.now.eventId).toBe('solar_storm');
    expect(currentEnv(sheltered).storm.strength).toBeGreaterThanOrEqual(2);
    chooseOption(sheltered, 'a');
    chooseOption(working, 'b');
    sheltered.alloc = { ...working.alloc };
    const a = computeWeek(sheltered);
    const b = computeWeek(working);
    expect(a.parts.doseStorm).toBeLessThan(b.parts.doseStorm * 0.5);
    expect(a.parts.sciLab).toBeLessThanOrEqual(b.parts.sciLab);
    expect(sheltered.now.evaAllowed).toBe(false);
  });

  it('answers from Earth at once near the Moon; on Mars the real delay decides', () => {
    const find = (site: SiteId) => {
      for (let seed = 1; seed < 200; seed++) {
        const state = createMission(config({ site, seed, startDate: '2016-03-01' }), DATA);
        let guard = 12;
        while (!state.end && guard-- > 0) {
          const id = state.now.eventId;
          if (id && !state.now.eventDone && EVENTS[id].urgent) return state;
          if (id && !state.now.eventDone) chooseOption(state, state.now.advice ?? 'a');
          resolveWeek(state);
          if (!state.end) nextWeek(state);
        }
      }
      throw new Error('no urgent card found');
    };
    const moon = askEarth(find('moon'))!;
    expect(moon.tooLate).toBe(false);
    expect(moon.roundTripSeconds).toBeLessThan(3);
    // On Mars the real round trip of the week decides: far away the answer comes too late,
    // near opposition (one way about 4 minutes) it comes in time.
    const mars = find('mars');
    const env = mars.plan[mars.week - 1];
    mars.plan[mars.week - 1] = { ...env, delaySeconds: 20 * 60, conjunction: false };
    expect(earthAnswerFor(mars)!.tooLate).toBe(true);
    expect(earthAnswerFor(mars)!.scienceCost).toBe(0);
    mars.plan[mars.week - 1] = { ...env, delaySeconds: 4 * 60, conjunction: false };
    expect(earthAnswerFor(mars)!.tooLate).toBe(false);
    expect(earthAnswerFor(mars)!.scienceCost).toBeGreaterThan(0);
    expect(earthAnswerFor(mars)!.roundTripSeconds).toBeLessThan(URGENT_WAIT_SECONDS);
  });

  it('charges air for a walk outside and rewards samples', () => {
    const state = createMission(config(), DATA);
    const air = state.air;
    applyEva(state, { seconds: 40, samples: 3, science: 9, chore: false, caught: false, alerted: false });
    expect(state.air).toBe(air - 5);
    expect(state.science).toBe(9);
  });

  it('gives every option of every card a cost or a missed reward', () => {
    for (const event of Object.values(EVENTS)) {
      if (event.notice) continue;
      for (const site of event.sites) {
        const state = createMission(config({ site }), DATA);
        const free = event.options.filter((option) => freeLunch(option, state)).map((option) => option.id);
        expect(free, `card ${event.id} (${site}) has a free-lunch option`).toEqual([]);
      }
      expect(event.options.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('the free-lunch check sees gains hidden in lasting effects', () => {
    const state = createMission(config(), DATA);
    expect(freeLunch({ id: 'a', fx: { science: 20 }, scienceFactor: 1.5 }, state)).toBe(true);
    expect(freeLunch({ id: 'a', mods: [{ id: 'x', weeks: 2, solarFlat: 2 }] }, state)).toBe(true);
    expect(freeLunch({ id: 'a', fx: { air: 30 }, mods: [] }, state)).toBe(true);
    expect(freeLunch({ id: 'a', fx: { air: 30, cells: -2 } }, state)).toBe(false);
    expect(freeLunch({ id: 'a', fx: { dose: -3 }, shelter: true }, state)).toBe(false);
  });

  it('places each famous window so its big day lands in week 3', () => {
    for (const window of FEATURED_WINDOWS) {
      const start = addDays(window.anchor, -14);
      const state = createMission(config({ site: window.sites[0], startDate: start }), DATA);
      const env = state.plan[2];
      expect(window.anchor >= env.dateFrom && window.anchor <= env.dateTo).toBe(true);
    }
  });
});
