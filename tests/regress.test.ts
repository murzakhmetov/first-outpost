/**
 * Bugs found by review, kept fixed. Each test names the wrong thing a player
 * would have seen.
 */
import { describe, expect, it } from 'vitest';
import { buildInsights } from '../src/sim/debrief';
import { addDays } from '../src/sim/ephemeris';
import { EVENTS, optionBlock } from '../src/sim/events';
import {
  askEarth,
  buildPlan,
  chooseOption,
  computeWeek,
  createMission,
  earthAnswerFor,
  nextWeek,
  resolveWeek,
  setAlloc,
  suggestAlloc,
} from '../src/sim/mission';
import { FEATURED_WINDOWS } from '../src/sim/sites';
import type { Difficulty, MissionConfig, MissionState, SiteId } from '../src/sim/types';
import { DATA, carefulBot, play } from './bots';

const config = (over: Partial<MissionConfig>): MissionConfig => ({
  site: 'mars',
  difficulty: 'commander',
  weeks: 10,
  startDate: '2024-04-26',
  seed: 1,
  tutorial: false,
  sunMode: 'random',
  ...over,
});

/** Answer this week's card with the first option the crew can take. */
function answerCard(state: MissionState, preferred?: 'a' | 'b' | 'c'): void {
  if (!state.now.eventId || state.now.eventDone) return;
  const event = EVENTS[state.now.eventId];
  if (preferred && chooseOption(state, preferred)) return;
  chooseOption(state, event.options.find((option) => !optionBlock(option, state))!.id);
}

describe('review fixes', () => {
  it('Mission Control never advises an option the crew cannot take', () => {
    let cards = 0;
    const blocked: string[] = [];
    for (const site of ['mars', 'moon'] as SiteId[]) {
      for (const difficulty of ['cadet', 'commander', 'legend'] as Difficulty[]) {
        for (let seed = 1; seed <= 150; seed++) {
          const state = createMission(config({ site, difficulty, seed, startDate: addDays('2013-01-01', (seed * 37) % 4000) }), DATA);
          let guard = 30;
          while (!state.end && guard-- > 0) {
            if (state.now.eventId && !state.now.eventDone) {
              cards++;
              const event = EVENTS[state.now.eventId];
              const advised = event.options.find((option) => option.id === state.now.advice)!;
              if (optionBlock(advised, state)) blocked.push(`${site}/${difficulty}/${seed}/w${state.week} ${event.id}`);
              answerCard(state);
            }
            state.alloc = suggestAlloc(state);
            resolveWeek(state);
            if (!state.end) nextWeek(state);
          }
        }
      }
    }
    expect(cards).toBeGreaterThan(3000);
    expect(blocked).toEqual([]);
  });

  it("the card's advice looks at this week's power, not last week's", () => {
    // The air-filter card: power tools need plenty of cells, spare parts need none.
    for (const [battery, expected] of [
      [0, 'b'],
      [5, 'a'],
    ] as const) {
      const state = createMission(config({ seed: 5 }), DATA);
      state.plan[1] = { ...state.plan[1], fixedEvent: 'scrubber', sunlight: battery ? 1 : 0.3, seasonal: 1 };
      resolveWeek(state);
      state.battery = battery; // what week 1 left in the battery
      nextWeek(state);
      expect(state.week).toBe(2);
      expect(state.now.eventId).toBe('scrubber');
      expect(state.now.advice, `battery ${battery}, cells ${state.now.available}`).toBe(expected);
    }
  });

  it('the wall insight takes no credit for the storm shelter', () => {
    const window = FEATURED_WINDOWS.find((entry) => entry.id === 'may2024')!;
    const state = createMission(config({ site: 'moon', startDate: addDays(window.anchor, -14), sunMode: 'featured', seed: 3 }), DATA);
    let guard = 30;
    while (!state.end && guard-- > 0) {
      answerCard(state, state.now.eventId === 'solar_storm' ? 'a' : undefined); // shelter in every storm
      state.alloc = suggestAlloc(state);
      state.alloc.shield = state.week === 1 ? 1 : 0; // one cell of wall, once
      resolveWeek(state);
      if (!state.end) nextWeek(state);
    }
    const sheltered = state.history.filter((week) => week.sheltered && week.storm > 0);
    expect(sheltered.length).toBeGreaterThan(0);
    const kept = sheltered.reduce((sum, week) => sum + week.doseAvoided, 0);
    const walled = state.history.reduce((sum, week) => sum + (week.doseWall ?? 0), 0);
    expect(kept).toBeGreaterThan(20); // the shelter did the work
    expect(walled).toBeLessThan(5); // a one-cell wall did very little
    const insights = buildInsights(state);
    const wall = insights.find((insight) => insight.key === 'insight.wall');
    if (wall) expect(wall.params.n as number).toBeLessThan(5);
    // A crew that sheltered in every storm is never told "a shelter would have stopped it".
    expect(insights.some((insight) => insight.key === 'insight.stormHit')).toBe(false);
    expect(insights.some((insight) => insight.key === 'insight.storm')).toBe(true);
  });

  it('a wall that stops a storm by itself gets the credit', () => {
    const state = createMission(config({ site: 'moon', seed: 3 }), DATA);
    state.shield = 1;
    state.plan[0] = { ...state.plan[0], storm: { ...state.plan[0].storm, strength: 2 } };
    const outcome = computeWeek(state);
    expect(outcome.doseWall).toBeGreaterThan(10);
    expect(outcome.doseWall).toBeCloseTo(outcome.doseAvoided, 1);
  });

  it('a finished wall takes no more energy cells', () => {
    const state = createMission(config({ site: 'moon', difficulty: 'cadet', startDate: '2019-12-01', seed: 9 }), DATA);
    state.alloc = { life: 3, farm: 1, lab: 0, shield: 2 };
    let wastedOnWall = 0;
    while (!state.end) {
      answerCard(state);
      if (state.shield >= 1) {
        wastedOnWall += state.alloc.shield;
        expect(setAlloc(state, 'shield', 1)).toBe(false);
      }
      resolveWeek(state);
      if (!state.end) nextWeek(state);
    }
    expect(state.shield).toBe(1);
    expect(wastedOnWall).toBe(0);
  });

  it('a card about radio delay appears in the first free week from mid-mission', () => {
    const missed: string[] = [];
    let total = 0;
    for (const site of ['mars', 'moon'] as SiteId[]) {
      for (const window of FEATURED_WINDOWS.filter((entry) => entry.sites.includes(site))) {
        for (let seed = 1; seed <= 60; seed++) {
          for (const weeks of [6, 8, 10]) {
            const state = play(config({ site, seed, weeks, difficulty: 'cadet', sunMode: 'featured', startDate: addDays(window.anchor, -14) }), carefulBot);
            total++;
            const half = Math.ceil(weeks / 2) + 1;
            const free = state.plan.find((env) => env.week >= half && !env.fixedEvent);
            if (!free || state.history.length < free.week) continue; // no free week, or the mission ended before it
            const seen = state.history.some((week) => week.week <= free.week && (week.eventId === 'school_call' || week.eventId === 'plants_sick'));
            if (!seen) missed.push(`${site} ${window.id} seed ${seed} weeks ${weeks}`);
          }
        }
      }
    }
    expect(total).toBeGreaterThan(1000);
    expect(missed).toEqual([]);
  });

  it('a mission that starts inside the 2018 global dust storm gets the storm', () => {
    for (const startDate of ['2018-07-17', '2018-07-20']) {
      const plan = buildPlan(config({ difficulty: 'legend', weeks: 8, startDate }), DATA);
      expect(plan[0].reason, startDate).toBe('clear'); // week 1 is for learning
      expect(plan.some((env) => env.reason === 'dust'), startDate).toBe(true);
    }
  });

  it('a dark first week is judged by the battery the mission started with', () => {
    let checked = 0;
    for (let day = 1; day < 400 && checked < 3; day++) {
      const state = createMission(config({ site: 'moon', difficulty: 'legend', weeks: 6, seed: day, startDate: addDays('2020-01-01', day) }), DATA);
      if (state.plan[0].reason !== 'dark') continue;
      state.alloc = suggestAlloc(state);
      resolveWeek(state);
      const dark = buildInsights(state).find((insight) => insight.key === 'insight.dark');
      expect(dark?.params.week).toBe(1);
      expect(dark?.params.saved).toBe('insight.darkEmpty'); // legend starts with 1 cell in the battery
      expect(dark?.tone).toBe('bad');
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('a week cannot be run twice or skipped by pressing a button twice', () => {
    const state = createMission(config({ seed: 21 }), DATA);
    nextWeek(state); // week 1 has not been played: nothing happens
    expect(state.week).toBe(1);
    const first = resolveWeek(state);
    const air = state.air;
    expect(resolveWeek(state)).toBe(first); // the same log entry, not a second week
    expect(state.air).toBe(air);
    expect(state.history.length).toBe(1);
    nextWeek(state);
    nextWeek(state); // week 2 has not been played yet
    expect(state.week).toBe(2);
  });

  it("Earth's answer can be shown again after a reload without paying twice", () => {
    const state = createMission(config({ seed: 11 }), DATA);
    state.plan[1] = { ...state.plan[1], fixedEvent: 'school_call', conjunction: false };
    resolveWeek(state);
    nextWeek(state);
    expect(state.now.eventId).toBe('school_call');
    const before = state.science;
    const answer = askEarth(state);
    expect(answer).not.toBeNull();
    const paid = before - state.science;
    expect(askEarth(state)).toBeNull(); // asking twice is refused
    expect(earthAnswerFor(state)).toEqual(answer); // but the answer can be read again
    expect(before - state.science).toBe(paid);
  });
});
