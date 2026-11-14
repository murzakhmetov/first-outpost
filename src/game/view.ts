/**
 * Turns mission data into the words and numbers the screen shows.
 */
import { fmtDate, fmtDelay, has, t } from '../i18n';
import type { Params } from '../i18n';
import { donkiLink } from '../sim/donki';
import { EVENTS, optionBlock, resolveFx, earthInTime } from '../sim/events';
import type { EventDef } from '../sim/events';
import { currentEnv } from '../sim/mission';
import type { Effects, MissionState, OptionId, WeekEnv } from '../sim/types';

/** First text key that exists among `base.variant` candidates, else `base`. */
function pick(base: string, variants: string[]): string {
  for (const variant of variants) {
    const key = `${base}.${variant}`;
    if (has(key)) return key;
  }
  return base;
}

export interface OptionView {
  id: OptionId;
  label: string;
  fx: Effects;
  /** Extra effects that are not plain numbers, already translated. */
  notes: string[];
  /** Why the option cannot be chosen, already translated, or null. */
  blocked: string | null;
}

export interface EventView {
  id: string;
  icon: string;
  notice: boolean;
  urgent: boolean;
  title: string;
  body: string;
  hint: string;
  story: string;
  sourceTitle: string;
  sourceUrl: string;
  /** Link to the NASA record behind this card, if there is one. */
  dataUrl: string | null;
  options: OptionView[];
  /** Level of a real storm, 0-3. */
  storm: number;
}

function variants(state: MissionState, env: WeekEnv): string[] {
  const list: string[] = [];
  if (state.now.eventId === 'solar_storm') {
    if (state.config.site === 'moon') list.push('moon');
    else list.push(env.storm.basis === 'cme' ? 'cme' : 'rad');
  }
  list.push(state.config.site);
  return list;
}

function eventParams(state: MissionState, env: WeekEnv): Params {
  const minutes = Math.max(1, Math.round(env.delaySeconds / 60));
  return {
    date: fmtDate(state.now.eventId === 'eclipse' && env.eclipse ? env.eclipse : env.storm.date),
    speed: env.sun.marsCme?.speed ?? 0,
    temp: env.tempMin ?? -75,
    sec: Math.round(env.delaySeconds * 10) / 10,
    min: minutes,
    round: minutes * 2,
  };
}

/** The words on a source link: DONKI records are "in NASA's database", other pages are NASA's reports. */
export function linkLabel(url: string): string {
  return url.includes('ccmc.gsfc.nasa.gov') ? t('brief.donki') : t('brief.report');
}

export function stormDataUrl(env: WeekEnv): string | null {
  const storm = env.storm;
  if (storm.strength === 0) return null;
  if (storm.url) return storm.url;
  if (storm.id && storm.kind) return donkiLink(storm.kind, storm.id);
  return null;
}

export function eventView(state: MissionState): EventView | null {
  const id = state.now.eventId;
  if (!id) return null;
  const event: EventDef = EVENTS[id];
  const env = currentEnv(state);
  const v = variants(state, env);
  const params = eventParams(state, env);
  const key = (field: string): string => pick(`ev.${id}.${field}`, v);

  const options: OptionView[] = event.options.map((option) => {
    const fx = resolveFx(option, state);
    const notes: string[] = [];
    if (option.shelter) notes.push(t('fx.shelter'));
    if (option.scienceFactor && option.scienceFactor < 1) {
      notes.push(t('fx.scienceLess', { n: Math.round((1 - option.scienceFactor) * 100) }));
    }
    if (option.noEva) notes.push(t('fx.noWalk'));
    if (option.ration) notes.push(t('fx.ration'));
    const noteKey = `ev.${id}.n${option.id}`;
    if (has(noteKey)) notes.push(t(noteKey));
    if (!notes.length && !Object.values(fx).some((value) => value)) notes.push(t('fx.free'));
    const block = optionBlock(option, state);
    return { id: option.id, label: t(key(option.id), params), fx, notes, blocked: block ? t(block) : null };
  });

  return {
    id,
    icon: event.icon,
    notice: !!event.notice,
    urgent: event.urgent,
    title: t(key('title'), params),
    body: t(key('body'), params),
    hint: has(`ev.${id}.hint`) ? t(`ev.${id}.hint`) : '',
    story: t(key('story'), params),
    sourceTitle: t(key('src')),
    sourceUrl: t(key('url')),
    dataUrl: id === 'solar_storm' ? stormDataUrl(env) : null,
    options,
    storm: id === 'solar_storm' ? env.storm.strength : 0,
  };
}

/** What happened after a choice. */
export function resultText(state: MissionState, eventId: string, optionId: OptionId): string {
  const env = currentEnv(state);
  const params = eventParams(state, env);
  // On Mars near opposition Earth's answer comes in time, and a card may say so in its own words.
  const variants = state.config.site === 'mars' && earthInTime(state) ? ['marsNear', state.config.site] : [state.config.site];
  return t(pick(`ev.${eventId}.r${optionId}`, variants), params);
}

/** Mission Control's advice in words. */
export function earthText(state: MissionState, eventId: string): string {
  const env = currentEnv(state);
  if (state.now.adviceFallback && state.now.advice) return t('earth.noPower', { label: optionLabel(state, eventId, state.now.advice) });
  if (eventId === 'solar_storm' && state.now.advice === 'b') return t('ev.solar_storm.earthWeak');
  return t(`ev.${eventId}.earth`, eventParams(state, env));
}

export function optionLabel(state: MissionState, eventId: string, optionId: OptionId): string {
  const env = currentEnv(state);
  return t(pick(`ev.${eventId}.${optionId}`, [state.config.site]), eventParams(state, env));
}

export function delayText(env: WeekEnv): string {
  return fmtDelay(env.delaySeconds);
}

/** One line about what the real Sun did this week. */
export function sunLine(env: WeekEnv): string {
  const sun = env.sun;
  if (sun.topFlare && sun.xFlares > 0) {
    return t('brief.spaceFlares', { x: sun.xFlares, m: sun.mFlares, cls: sun.topFlare.cls, date: fmtDate(sun.topFlare.date, false) });
  }
  if (sun.topFlare && sun.mFlares > 0) {
    return t('brief.spaceFlaresM', { m: sun.mFlares, cls: sun.topFlare.cls, date: fmtDate(sun.topFlare.date, false) });
  }
  return t('brief.spaceQuiet');
}

/** The storm line of the forecast, or null on a calm week. */
export function stormLine(state: MissionState, env: WeekEnv): string | null {
  const storm = env.storm;
  if (storm.strength === 0) return null;
  const date = fmtDate(storm.date, false);
  const where =
    state.config.site === 'moon'
      ? t('brief.stormMoon', { date })
      : storm.basis === 'cme'
        ? t('brief.stormMarsCme', { date })
        : storm.basis === 'sep'
          ? t('brief.stormMarsSep', { date })
          : t('brief.stormMarsRad', { date });
  return `${where} ${t('brief.stormRisk', { level: t(`brief.stormLevel${storm.strength}`) })}`;
}

/** Link to the strongest flare of the week in NASA's database. */
export function flareUrl(env: WeekEnv): string | null {
  const flare = env.sun.topFlare;
  return flare?.id ? donkiLink('FLR', flare.id) : null;
}
