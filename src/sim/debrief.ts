/**
 * After the mission: explain what happened and why.
 *
 * The goal of the game is that a player can say afterwards
 * "this went wrong because of that choice". These functions find those links
 * in the mission log.
 */
import { foundIn } from './finds';
import { DIFFICULTY } from './sites';
import type { MissionState, WeekRecord } from './types';

export interface Insight {
  key: string;
  params: Record<string, string | number>;
  tone: 'good' | 'bad' | 'info';
  /** A date the text key should show (formatted by the screen layer). */
  date?: string;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function buildInsights(state: MissionState): Insight[] {
  const log = state.history;
  const insights: Insight[] = [];
  if (!log.length) return insights;
  const add = (insight: Insight): void => {
    insights.push(insight);
  };

  // Air
  let worstAir: WeekRecord | null = null;
  for (const week of log) {
    if (week.parts.airLife < 0 && (!worstAir || week.parts.airLife < worstAir.parts.airLife)) worstAir = week;
  }
  const lowestAir = Math.min(...log.map((week) => week.air));
  if (worstAir && (state.end === 'air' || lowestAir < 35)) {
    add({ key: 'insight.airDrop', params: { week: worstAir.week, n: -worstAir.parts.airLife, level: worstAir.alloc.life }, tone: 'bad' });
  } else if (lowestAir >= 50) {
    add({ key: 'insight.airSteady', params: {}, tone: 'good' });
  }

  // Food
  const hungryWeek = log.find((week) => week.hungry);
  const harvests = log.filter((week) => week.harvested).length;
  if (hungryWeek) add({ key: 'insight.hungry', params: { week: hungryWeek.week }, tone: 'bad' });
  else if (harvests > 0) add({ key: 'insight.harvest', params: { n: harvests }, tone: 'good' });
  else if (log.length >= 4) add({ key: 'insight.noHarvest', params: {}, tone: 'info' });

  // Solar storms (real ones)
  const caught = log.find((week) => week.evaCaught);
  if (caught) add({ key: 'insight.caught', params: { week: caught.week }, tone: 'bad' });
  const stormWeeks = log.filter((week) => week.storm > 0);
  const worstStorm = [...stormWeeks].sort((a, b) => b.parts.doseStorm - a.parts.doseStorm)[0];
  const bestSave = [...stormWeeks].sort((a, b) => b.doseAvoided - a.doseAvoided)[0];
  const stormDate = (week: WeekRecord): string => state.plan[week.week - 1]?.storm.date ?? week.dateFrom;
  // On Mars most storms come from NASA's model runs: those are called forecasts, not measured storms.
  const modelled = (week: WeekRecord): boolean => state.plan[week.week - 1]?.storm.basis === 'cme';
  // A crew that took shelter did the right thing: do not tell them to take shelter.
  if (worstStorm && worstStorm.parts.doseStorm >= 4 && !worstStorm.evaCaught && !worstStorm.sheltered) {
    add({ key: modelled(worstStorm) ? 'insight.stormHitModel' : 'insight.stormHit', params: { week: worstStorm.week, n: round1(worstStorm.parts.doseStorm) }, tone: 'bad', date: stormDate(worstStorm) });
  } else if (bestSave && bestSave.doseAvoided >= 2) {
    add({ key: modelled(bestSave) ? 'insight.stormModel' : 'insight.storm', params: { week: bestSave.week, n: round1(bestSave.doseAvoided) }, tone: 'good', date: stormDate(bestSave) });
  }

  // Shield wall
  // Only what the wall stopped by itself: the storm shelter gets no credit here.
  const walled = log.reduce((sum, week) => sum + (week.doseWall ?? 0), 0);
  const wallCells = log.reduce((sum, week) => sum + week.alloc.shield - (week.parts?.build ?? 0), 0);
  if (state.shield > 0 && walled >= 3) {
    add({ key: 'insight.wall', params: { n: round1(walled), cells: wallCells }, tone: 'good' });
  } else if (state.shield === 0 && state.dose > state.doseLimit * 0.6) {
    add({ key: 'insight.noWall', params: {}, tone: 'bad' });
  }

  // Power
  const wasted = log.reduce((sum, week) => sum + week.wasted, 0);
  if (wasted >= 2) add({ key: 'insight.wasted', params: { n: wasted }, tone: 'info' });
  const darkWeek = log.find((week) => week.sunReason !== 'clear');
  if (darkWeek) {
    const before = log[darkWeek.week - 2];
    // Week 1 has no week before it: the battery held what the mission started with.
    const hadBattery = (before?.battery ?? DIFFICULTY[state.config.difficulty].batteryStart) >= 2;
    add({
      key: 'insight.dark',
      params: { week: darkWeek.week, n: darkWeek.solar, saved: hadBattery ? 'insight.darkSaved' : 'insight.darkEmpty' },
      tone: hadBattery ? 'good' : 'bad',
    });
  }

  // Deciding alone on Mars
  const cards = log.filter((week) => week.eventId).length;
  if (state.config.site === 'mars' && cards >= 2 && !state.flags.asked_earth) {
    add({ key: 'insight.earthSelf', params: {}, tone: 'good' });
  }

  // Where the science came from
  const lab = log.reduce((sum, week) => sum + week.parts.sciLab, 0);
  const eva = log.reduce((sum, week) => sum + week.parts.sciEva, 0);
  const event = log.reduce((sum, week) => sum + week.parts.sciEvent, 0);
  const finds = log.reduce((sum, week) => sum + (week.parts.sciFinds ?? 0), 0);
  if (finds > 0) add({ key: 'insight.scienceFinds', params: { lab, eva, finds, event }, tone: 'info' });
  else add({ key: 'insight.science', params: { lab, eva, event }, tone: 'info' });

  // Bad news first, then good news, at most five lines.
  const order = { bad: 0, good: 1, info: 2 };
  return insights.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, 5);
}

export function earnedBadges(state: MissionState): string[] {
  const log = state.history;
  const complete = state.end === 'complete';
  const badges: string[] = [];
  if (state.harvests >= 2) badges.push('greenThumb');
  if (log.some((week) => week.storm >= 2 && week.sheltered && week.eventId === 'solar_storm' && week.optionId === 'a')) badges.push('stormSmart');
  if (state.flags.outran_storm) badges.push('runner');
  if (complete && !state.flags.wasted_power) badges.push('saver');
  if (state.shield >= 1) badges.push('builder');
  if (state.flags.isru) badges.push('landLiver');
  if (complete && state.config.site === 'mars' && !state.flags.asked_earth) badges.push('selfReliant');
  if (log.reduce((sum, week) => sum + week.evaSamples, 0) >= 10) badges.push('collector');
  if (complete && !state.flags.went_hungry) badges.push('wellFed');
  if (foundIn(state).length >= 3) badges.push('explorer');
  return badges;
}
