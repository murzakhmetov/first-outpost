/**
 * The decision cards.
 *
 * Every card is based on something that really happened to a NASA mission.
 * Every option costs something: there is no free, safe choice.
 * Texts live in src/i18n (keys "ev.<id>.*"); this file holds only the rules.
 */
import { URGENT_WAIT_SECONDS } from './sites';
import type { Effects, MissionState, Modifier, OptionId, SiteId, WeekEnv } from './types';

/** Mission Control's answer to an urgent question reaches the crew in time this week (always near the Moon;
    on Mars only while the real radio round trip is short, in the months around opposition). */
export function earthInTime(state: MissionState): boolean {
  if (state.config.site !== 'mars') return true;
  const env = state.plan[Math.min(Math.max(state.week, 1), state.plan.length) - 1];
  return !!env && !env.conjunction && env.delaySeconds * 2 <= URGENT_WAIT_SECONDS;
}

export type CameraSpot = 'hab' | 'farm' | 'lab' | 'solar' | 'sky' | 'far' | 'rover' | 'shield';

export interface OptionDef {
  id: OptionId;
  /** Immediate changes. May depend on the site and the state of the outpost. */
  fx?: Effects | ((state: MissionState) => Effects);
  /** Lasting effects started by this choice. */
  mods?: Modifier[] | ((state: MissionState) => Modifier[]);
  /** The crew spends the storm in the shelter. */
  shelter?: boolean;
  /** Science multiplier for this week only. */
  scienceFactor?: number;
  /** Half food portions this week. */
  ration?: boolean;
  cleanPanels?: boolean;
  /** The crew is too busy for a walk outside this week. */
  noEva?: boolean;
  /** Extra condition. Return a text key to disable the option with that reason. */
  blocked?: (state: MissionState) => string | null;
  flag?: string;
}

export interface EventDef {
  id: string;
  sites: SiteId[];
  /** How often the card comes up compared with others. 0 = never drawn at random. */
  weight: number;
  minWeek?: number;
  /** Latest week, counted from the end: 2 means "not in the last 2 weeks". */
  notInLast?: number;
  condition?: (state: MissionState, env: WeekEnv) => boolean;
  /** On Mars, Earth's answer would arrive too late. */
  urgent: boolean;
  /** What Mission Control would choose. */
  advice: OptionId | ((state: MissionState, env: WeekEnv) => OptionId);
  options: OptionDef[];
  icon: string;
  camera: CameraSpot;
  /** Codex card unlocked when the card is resolved. */
  codex: string;
  /** Good news with a single "OK" button. */
  notice?: boolean;
}

export const EVENTS: Record<string, EventDef> = {
  // ----- Real space weather (NASA DONKI) -----------------------------------
  solar_storm: {
    id: 'solar_storm',
    sites: ['mars', 'moon'],
    weight: 0,
    urgent: true,
    advice: (_state, env) => (env.storm.strength >= 2 ? 'a' : 'b'),
    icon: 'storm',
    camera: 'sky',
    codex: 'storm_shelter',
    options: [
      { id: 'a', shelter: true, fx: { crop: -0.25 }, noEva: true, flag: 'sheltered' },
      { id: 'b', flag: 'worked_in_storm' },
      {
        id: 'c',
        fx: { cells: -2, shield: 0.2 },
        blocked: (state) => (state.shield >= 1 ? 'block.shieldFull' : null),
        flag: 'rushed_shield',
      },
    ],
  },

  // ----- Life support --------------------------------------------------------
  scrubber: {
    id: 'scrubber',
    sites: ['mars', 'moon'],
    weight: 10,
    minWeek: 2,
    urgent: true,
    // With power to spare, repair it. In a dark week, do what Apollo 13 did.
    advice: (state) => (state.now.available >= 6 ? 'a' : 'b'),
    icon: 'air',
    camera: 'hab',
    codex: 'apollo13',
    options: [
      { id: 'a', fx: { cells: -2 } },
      { id: 'b', fx: { science: -7 } },
      { id: 'c', fx: { air: -18 } },
    ],
  },
  leak: {
    id: 'leak',
    sites: ['mars', 'moon'],
    weight: 9,
    minWeek: 2,
    urgent: true,
    advice: 'a',
    icon: 'leak',
    camera: 'hab',
    codex: 'iss_leak',
    options: [
      { id: 'a', fx: { science: -6 } },
      { id: 'b', fx: { air: -14 } },
    ],
  },
  water_pump: {
    id: 'water_pump',
    sites: ['mars', 'moon'],
    weight: 8,
    minWeek: 3,
    urgent: false,
    advice: 'a',
    icon: 'water',
    camera: 'hab',
    codex: 'water_recycling',
    options: [
      { id: 'a', fx: { cells: -1, science: -4 } },
      { id: 'b', fx: { air: -6 }, scienceFactor: 0.75 },
    ],
  },
  quake: {
    id: 'quake',
    sites: ['mars', 'moon'],
    weight: 7,
    minWeek: 2,
    urgent: false,
    advice: 'a',
    icon: 'quake',
    camera: 'hab',
    codex: 'quakes',
    options: [
      { id: 'a', fx: { science: -6 } },
      { id: 'b', fx: { air: -10 } },
    ],
  },

  // ----- Food ---------------------------------------------------------------
  plants_sick: {
    id: 'plants_sick',
    sites: ['mars', 'moon'],
    weight: 10,
    minWeek: 2,
    condition: (state) => state.crop >= 1,
    urgent: true,
    advice: 'b',
    icon: 'plant',
    camera: 'farm',
    codex: 'zinnias',
    options: [
      {
        // Ask Earth. Near the Moon the answer comes in seconds. On Mars it comes in time only in the
        // months around opposition; the rest of the time it comes too late for one plant.
        id: 'a',
        fx: (state) => (earthInTime(state) ? { cells: -1 } : { cells: -1, crop: -1 }),
        flag: 'asked_plant_doctor',
      },
      { id: 'b', fx: { cells: -1 }, flag: 'autonomous_gardener' },
      { id: 'c', fx: { crop: -2 } },
    ],
  },
  ration: {
    id: 'ration',
    sites: ['mars', 'moon'],
    weight: 14,
    minWeek: 3,
    notInLast: 1,
    condition: (state) => state.food <= 2.6 && state.food > 0,
    urgent: false,
    advice: 'a',
    icon: 'food',
    camera: 'farm',
    codex: 'launch_windows',
    options: [
      { id: 'a', ration: true, scienceFactor: 0.7 },
      { id: 'b' },
    ],
  },
  resupply: {
    id: 'resupply',
    sites: ['moon'],
    weight: 9,
    minWeek: 3,
    notInLast: 1,
    urgent: false,
    // Air above 70 cannot take the +30 (it is capped at 100), so the air offer is worth it only when the tank is low.
    advice: (state) => (state.food < 2 ? 'a' : state.air <= 70 ? 'b' : 'c'),
    icon: 'rocket',
    camera: 'far',
    codex: 'three_days',
    options: [
      { id: 'a', fx: { food: 2, science: -12 } },
      { id: 'b', fx: { air: 30, science: -12 } },
      { id: 'c' },
    ],
  },

  // ----- Power --------------------------------------------------------------
  cold_snap: {
    id: 'cold_snap',
    sites: ['mars', 'moon'],
    weight: 9,
    minWeek: 2,
    condition: (state, env) =>
      state.config.site === 'mars' ? (env.tempMin ?? -70) <= -78 : env.reason === 'dark',
    urgent: false,
    advice: 'a',
    icon: 'cold',
    camera: 'farm',
    codex: 'cold',
    options: [
      { id: 'a', fx: { cells: -2 } },
      { id: 'b', fx: { crop: -1.5 }, blocked: (state) => (state.crop >= 1.5 ? null : state.crop > 0 ? 'block.fewCrop' : 'block.noCrop') },
      { id: 'c', fx: { air: -5 }, scienceFactor: 0.8 },
    ],
  },
  battery_hot: {
    id: 'battery_hot',
    sites: ['mars', 'moon'],
    weight: 6,
    minWeek: 3,
    condition: (state) => state.batteryCap > 2,
    urgent: true,
    advice: 'b',
    icon: 'battery',
    camera: 'solar',
    codex: 'batteries',
    options: [
      { id: 'a', fx: { batteryCap: -1 } },
      { id: 'b', fx: { cells: -2 } },
    ],
  },
  dust_warning: {
    id: 'dust_warning',
    sites: ['mars'],
    weight: 0,
    urgent: false,
    advice: 'a',
    icon: 'dust',
    camera: 'sky',
    codex: 'dust_storm',
    options: [
      { id: 'a', fx: { cells: 2 }, scienceFactor: 0.5, flag: 'saved_for_storm' },
      {
        id: 'b',
        fx: { cells: -2 },
        mods: [{ id: 'spare_panel', weeks: 5, solarFlat: 1, delayed: true }],
      },
      { id: 'c' },
    ],
  },
  dust_devil: {
    id: 'dust_devil',
    sites: ['mars'],
    weight: 7,
    minWeek: 3,
    condition: (state) => state.panelDust >= 0.09,
    urgent: false,
    advice: 'a',
    icon: 'wind',
    camera: 'solar',
    codex: 'cleaning_events',
    notice: true,
    options: [{ id: 'a', cleanPanels: true }],
  },
  micrometeoroid: {
    id: 'micrometeoroid',
    sites: ['moon'],
    weight: 8,
    minWeek: 2,
    notInLast: 1,
    urgent: false,
    advice: 'a',
    icon: 'meteor',
    camera: 'solar',
    codex: 'micrometeoroids',
    options: [
      { id: 'a', fx: { air: -4, dose: 1.5 } },
      { id: 'b', mods: [{ id: 'broken_panel', weeks: 4, solarFlat: -1, delayed: true }] },
    ],
  },
  eclipse: {
    id: 'eclipse',
    sites: ['moon'],
    weight: 0,
    urgent: false,
    advice: 'a',
    icon: 'eclipse',
    camera: 'sky',
    codex: 'eclipse',
    options: [{ id: 'a', fx: { cells: -1, science: 10 } }, { id: 'b' }],
  },

  // ----- Science and crew ---------------------------------------------------
  far_rock: {
    id: 'far_rock',
    sites: ['mars', 'moon'],
    weight: 11,
    minWeek: 2,
    urgent: false,
    // The robot is the careful choice, unless power is too short even for that.
    advice: (state) => (state.now.available >= 5 ? 'b' : 'c'),
    icon: 'rover',
    camera: 'rover',
    codex: 'samples',
    options: [
      { id: 'a', fx: { cells: -1, air: -9, science: 16 } },
      { id: 'b', fx: { cells: -1, science: 6 } },
      { id: 'c' },
    ],
  },
  tired_crew: {
    id: 'tired_crew',
    sites: ['mars', 'moon'],
    weight: 9,
    minWeek: 3,
    notInLast: 1,
    urgent: false,
    advice: 'a',
    icon: 'sleep',
    camera: 'hab',
    codex: 'crew_rest',
    options: [
      { id: 'a', fx: { science: -5 }, mods: [{ id: 'rested', weeks: 2, scienceFactor: 1.25, delayed: true }] },
      { id: 'b', fx: { science: 4 }, mods: [{ id: 'tired', weeks: 1, scienceFactor: 0.7, delayed: true }] },
    ],
  },
  school_call: {
    id: 'school_call',
    sites: ['mars', 'moon'],
    weight: 8,
    minWeek: 2,
    urgent: false,
    advice: (state) => (state.now.available >= 5 ? 'a' : 'b'),
    icon: 'antenna',
    camera: 'lab',
    codex: 'comm_delay',
    options: [{ id: 'a', fx: { cells: -1, science: 8 } }, { id: 'b' }],
  },
  antenna: {
    id: 'antenna',
    sites: ['mars', 'moon'],
    weight: 7,
    minWeek: 2,
    notInLast: 2,
    urgent: false,
    advice: 'a',
    icon: 'antenna',
    camera: 'lab',
    codex: 'deep_space_network',
    options: [
      { id: 'a', fx: (state) => ({ air: -4, dose: state.config.site === 'moon' ? 1 : 0.3 }) },
      { id: 'b', mods: [{ id: 'weak_signal', weeks: 2, scienceFactor: 0.75 }] },
    ],
  },

  // ----- Living off the land -------------------------------------------------
  ice_found: {
    id: 'ice_found',
    sites: ['moon'],
    weight: 10,
    minWeek: 2,
    notInLast: 3,
    urgent: false,
    advice: 'a',
    icon: 'ice',
    camera: 'far',
    codex: 'lunar_ice',
    options: [
      { id: 'a', fx: { cells: -3 }, mods: [{ id: 'ice_melter', weeks: 0, permanent: true, airPerWeek: 8, delayed: true }], flag: 'isru' },
      { id: 'b', fx: { cells: -1, science: 6 } },
      { id: 'c' },
    ],
  },
  moxie: {
    id: 'moxie',
    sites: ['mars'],
    weight: 10,
    minWeek: 2,
    notInLast: 3,
    urgent: false,
    advice: 'a',
    icon: 'air',
    camera: 'hab',
    codex: 'moxie',
    options: [
      { id: 'a', fx: { cells: -3 }, mods: [{ id: 'oxygen_maker', weeks: 0, permanent: true, airPerWeek: 8, delayed: true }], flag: 'isru' },
      { id: 'b', fx: { cells: -1, science: 6 } },
      { id: 'c' },
    ],
  },
};

export function resolveFx(option: OptionDef, state: MissionState): Effects {
  if (!option.fx) return {};
  return typeof option.fx === 'function' ? option.fx(state) : option.fx;
}

export function resolveMods(option: OptionDef, state: MissionState): Modifier[] {
  if (!option.mods) return [];
  const mods = typeof option.mods === 'function' ? option.mods(state) : option.mods;
  return mods.map((mod) => ({ ...mod }));
}

/** The option Mission Control likes best, whether or not the crew can do it. */
export function firstChoice(event: EventDef, state: MissionState, env: WeekEnv): OptionId {
  return typeof event.advice === 'function' ? event.advice(state, env) : event.advice;
}

/** Mission Control's advice: its first choice, or the first option the crew can actually take. */
export function adviceFor(event: EventDef, state: MissionState, env: WeekEnv): OptionId {
  const wanted = firstChoice(event, state, env);
  const open = (option: OptionDef | undefined): boolean => !!option && !optionBlock(option, state);
  if (open(event.options.find((option) => option.id === wanted))) return wanted;
  return event.options.find(open)?.id ?? wanted;
}

/** Why an option cannot be chosen right now, as a text key. Null means it can. */
export function optionBlock(option: OptionDef, state: MissionState): string | null {
  const fx = resolveFx(option, state);
  const cost = fx.cells && fx.cells < 0 ? -fx.cells : 0;
  if (cost > state.now.available) return 'block.noPower';
  return option.blocked ? option.blocked(state) : null;
}
