/**
 * The mission rules: one turn is one week on the outpost.
 *
 * Week order:
 *   briefing -> event card -> power plan -> walk outside (optional) -> night -> report
 *
 * The outpost has ONE currency, energy cells, and THREE things to keep alive:
 * air, food and the crew's radiation budget. Science is the reason to be there.
 * There are never enough cells for everything: that is the lesson.
 */
import {
  addDays,
  cosmicRayFactor,
  isMarsDustSeason,
  lunarPoleSunlight,
  marsGeometry,
  moonGeometry,
} from './ephemeris';
import { EVENTS, adviceFor, firstChoice, optionBlock, resolveFx, resolveMods, earthInTime } from './events';
import { FIND_SCIENCE, recordFind } from './finds';
import { CREATIVE_STOCK, START_STOCK, TOOLS, TOOL_EFFECT, addMaterials, advanceConstruction, buildingDef, hasTool, robotIdle, underConstruction } from './outpost';
import type { BuildingId } from './outpost';
import { stream } from './rng';
import {
  CAUGHT_OUTSIDE,
  CROP_WEEKS,
  DIFFICULTY,
  EVA_AIR_PER_SECOND,
  FARM_GROW,
  GLOBAL_DUST_STORM_2018,
  HARVEST_FOOD,
  LIFE_AIR,
  SCIENCE_PER_LEVEL,
  SHELTER_FACTOR,
  SHELTER_SCIENCE,
  SHIELD_PER_CELL,
  SHIELD_VS_COSMIC,
  SHIELD_VS_STORM,
  SITES,
  STAR_SCIENCE_PER_WEEK,
  TOTAL_LUNAR_ECLIPSES,
  URGENT_WAIT_SECONDS,
} from './sites';
import { stormAt, summarizeWeek } from './spaceweather';
import type {
  Alloc,
  Effects,
  EndReason,
  EvaResult,
  MissionConfig,
  MissionState,
  ModuleId,
  OptionId,
  SimData,
  WeekEnv,
  WeekNow,
  WeekOutcome,
  WeekRecord,
} from './types';
import { MAX_LEVEL, MODULES } from './types';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const round1 = (value: number): number => Math.round(value * 10) / 10;
const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Typical Gale Crater air temperatures, used when no real record exists for a date. */
const MARS_TYPICAL_TEMP = { min: -75, max: -12 };
/** Most solar-storm decision cards in one mission. Extra storms still add dose, without a card. */
const MAX_STORM_CARDS = 4;

function emptyAlloc(): Alloc {
  return { life: 0, farm: 0, lab: 0, shield: 0 };
}

function allocTotal(alloc: Alloc): number {
  return alloc.life + alloc.farm + alloc.lab + alloc.shield;
}

// ---------------------------------------------------------------------------
// Building the mission plan from real data
// ---------------------------------------------------------------------------

interface DustStorm {
  from: number;
  to: number;
  factor: number;
}

function scheduleDust(config: MissionConfig, stormWeeks: Set<number>): DustStorm | null {
  if (config.site !== 'mars') return null;
  const weeks = config.weeks;
  const missionEnd = addDays(config.startDate, weeks * 7 - 1);

  // The real 2018 global dust storm: if the mission dates overlap it, it happens.
  if (config.startDate <= GLOBAL_DUST_STORM_2018.to && missionEnd >= GLOBAL_DUST_STORM_2018.from) {
    let from = 0;
    let to = 0;
    for (let week = 1; week <= weeks; week++) {
      const weekFrom = addDays(config.startDate, (week - 1) * 7);
      const weekTo = addDays(weekFrom, 6);
      if (weekFrom <= GLOBAL_DUST_STORM_2018.to && weekTo >= GLOBAL_DUST_STORM_2018.from) {
        if (!from) from = week;
        to = week;
      }
    }
    // Keep it playable: week 1 stays clear, and the darkest part lasts at most four weeks.
    const first = Math.max(2, from);
    return { from: first, to: Math.max(first, Math.min(to, first + 3)), factor: 0.3 };
  }

  const rng = stream(config.seed, 'dust');
  const middle = addDays(config.startDate, Math.floor((weeks * 7) / 2));
  const season = isMarsDustSeason(marsGeometry(middle).ls) ? 1.4 : 0.6;
  const chance = Math.min(0.9, DIFFICULTY[config.difficulty].dustStormChance * season);
  if (weeks < 5 || !rng.chance(chance)) return null;

  const length = rng.int(2, 3);
  const latest = Math.max(3, weeks - length);
  // Start in a week whose warning week (the one before) has no solar-storm card.
  const starts: number[] = [];
  for (let week = 3; week <= latest; week++) if (!stormWeeks.has(week - 1)) starts.push(week);
  if (!starts.length) return null;
  const from = rng.pick(starts);
  return { from, to: Math.min(weeks, from + length - 1), factor: rng.pick([0.45, 0.5, 0.55]) };
}

function marsTemperatures(
  data: SimData,
  dateFrom: string,
): { min: number; max: number; real: boolean; sol: number | null } {
  let min = Infinity;
  let max = -Infinity;
  let sol: number | null = null;
  if (data.marsWeather) {
    for (let i = 0; i < 7; i++) {
      const record = data.marsWeather[addDays(dateFrom, i)];
      if (!record) continue;
      if (sol === null) sol = record[0];
      min = Math.min(min, record[1]);
      max = Math.max(max, record[2]);
    }
  }
  if (min === Infinity) return { min: MARS_TYPICAL_TEMP.min, max: MARS_TYPICAL_TEMP.max, real: false, sol: null };
  return { min, max, real: true, sol };
}

export function buildPlan(config: MissionConfig, data: SimData): WeekEnv[] {
  const site = SITES[config.site];
  const plan: WeekEnv[] = [];

  for (let week = 1; week <= config.weeks; week++) {
    const dateFrom = addDays(config.startDate, (week - 1) * 7);
    const dateTo = addDays(dateFrom, 6);
    const middle = addDays(dateFrom, 3);
    const sun = summarizeWeek(data.sun, dateFrom);
    const storm = stormAt(config.site, sun);
    const env: WeekEnv = {
      week,
      dateFrom,
      dateTo,
      sun,
      storm,
      sunlight: 1,
      reason: 'clear',
      seasonal: 1,
      tempMin: null,
      tempMax: null,
      tempReal: false,
      sol: null,
      delaySeconds: 0,
      earthDistanceKm: 0,
      ls: null,
      gcrWeek: round2(site.gcrPerDay * 7 * cosmicRayFactor(middle)),
      eclipse: null,
      conjunction: false,
      fixedEvent: null,
      autoShelter: false,
    };

    if (config.site === 'mars') {
      const geometry = marsGeometry(middle);
      const temps = marsTemperatures(data, dateFrom);
      env.delaySeconds = geometry.lightSeconds;
      env.earthDistanceKm = geometry.distanceKm;
      env.seasonal = clamp(geometry.sunlightFactor, 0.9, 1.12);
      env.ls = geometry.ls;
      env.tempMin = temps.min;
      env.tempMax = temps.max;
      env.tempReal = temps.real;
      env.sol = temps.sol;
      env.conjunction = geometry.elongationDeg < 2.5;
    } else {
      const geometry = moonGeometry(middle);
      env.delaySeconds = geometry.lightSeconds;
      env.earthDistanceKm = geometry.distanceKm;
      env.sunlight = round2(lunarPoleSunlight(dateFrom));
      env.reason = env.sunlight < 0.8 ? 'dark' : 'clear';
      env.eclipse = TOTAL_LUNAR_ECLIPSES.find((date) => date >= dateFrom && date <= dateTo) ?? null;
    }
    plan.push(env);
  }

  // Solar-storm cards: every strong storm (up to four per mission) plus the first weak one.
  // Week 1 has no cards, and after four cards the crew knows the drill: in both cases a
  // strong storm sends everyone to the shelter automatically (the standing order).
  const stormWeeks = new Set<number>();
  for (const env of plan) {
    const strong = env.storm.strength >= 2;
    if (env.week === 1 || (strong && stormWeeks.size >= MAX_STORM_CARDS)) {
      env.autoShelter = strong;
      continue;
    }
    if (strong || (env.storm.strength === 1 && stormWeeks.size === 0)) {
      env.fixedEvent = 'solar_storm';
      stormWeeks.add(env.week);
    }
  }

  const dust = scheduleDust(config, stormWeeks);
  if (dust) {
    for (const env of plan) {
      if (env.week >= dust.from && env.week <= dust.to) {
        env.sunlight = dust.factor;
        env.reason = 'dust';
      }
    }
    const warning = plan[dust.from - 2];
    if (warning && warning.week >= 2 && !warning.fixedEvent) warning.fixedEvent = 'dust_warning';
  }

  for (const env of plan) {
    if (env.eclipse && env.week >= 2 && !env.fixedEvent) env.fixedEvent = 'eclipse';
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Creating a mission and starting a week
// ---------------------------------------------------------------------------

function blankNow(): WeekNow {
  return {
    solar: 0,
    available: 0,
    eventId: null,
    optionId: null,
    advice: null,
    eventDone: true,
    askedEarth: false,
    sheltered: false,
    scienceFactor: 1,
    ration: false,
    eventFx: {},
    cleaned: false,
    eva: null,
    finds: [],
    evaAllowed: true,
    evaBlock: null,
  };
}

export function doseLimitFor(config: MissionConfig): number {
  const scale = 0.4 + 0.6 * (config.weeks / 10);
  return Math.round(SITES[config.site].doseBudget * DIFFICULTY[config.difficulty].doseFactor * scale);
}

export function createMission(config: MissionConfig, data: SimData): MissionState {
  const difficulty = DIFFICULTY[config.difficulty];
  const state: MissionState = {
    config,
    plan: buildPlan(config, data),
    week: 1,
    phase: 'briefing',
    battery: difficulty.batteryStart,
    batteryCap: difficulty.batteryCap,
    air: difficulty.airStart,
    food: round1(config.weeks * difficulty.foodFactor),
    dose: 0,
    doseLimit: doseLimitFor(config),
    science: 0,
    shield: 0,
    crop: 0,
    neglect: 0,
    hungry: 0,
    harvests: 0,
    panelDust: 0,
    alloc: emptyAlloc(),
    modifiers: [],
    usedEvents: [],
    stormCards: 0,
    flags: {},
    now: blankNow(),
    history: [],
    end: null,
    stars: 0,
    unlocked: [],
    // GAME. The lander brought enough for a first building (the workshop).
    stock: config.creative ? { regolith: CREATIVE_STOCK, metal: CREATIVE_STOCK } : { ...START_STOCK },
    buildings: [],
    tools: config.creative ? TOOLS.map((tool) => tool.id) : [],
    decor: [],
  };
  beginWeek(state);
  return state;
}

export function currentEnv(state: MissionState): WeekEnv {
  return state.plan[clamp(state.week, 1, state.plan.length) - 1];
}

/** Energy cells the solar panels deliver in a given week. */
export function solarFor(state: MissionState, env: WeekEnv): number {
  const site = SITES[state.config.site];
  const difficulty = DIFFICULTY[state.config.difficulty];
  let cells = (site.solarCells + difficulty.solarBonus) * env.sunlight * env.seasonal * (1 - state.panelDust);
  for (const mod of state.modifiers) {
    if (!mod.delayed && mod.solarFlat) cells += mod.solarFlat;
  }
  return Math.max(1, Math.round(cells));
}

/** A rough look at next week's sunlight, shown in the forecast so players can plan ahead. */
export function nextSolar(state: MissionState): number | null {
  const next = state.plan[state.week];
  return next ? solarFor(state, next) : null;
}

function pickEvent(state: MissionState, env: WeekEnv): string | null {
  const { config } = state;
  if (state.week === 1) return null; // week 1 is for learning the power plan
  if (env.fixedEvent) return env.fixedEvent;

  // Radio delay is a core lesson: make sure one card about it appears by mid-mission.
  // If that week already has a fixed card (a real storm), the next free week takes it.
  const half = Math.ceil(config.weeks / 2) + 1;
  const sawDelayCard = state.usedEvents.includes('school_call') || state.usedEvents.includes('plants_sick');
  if (state.week >= half && !sawDelayCard) return 'school_call';

  const rng = stream(config.seed, 'event', state.week);
  if (!rng.chance(DIFFICULTY[config.difficulty].eventChance)) return null;

  const candidates = Object.values(EVENTS).filter(
    (event) =>
      event.weight > 0 &&
      event.sites.includes(config.site) &&
      !state.usedEvents.includes(event.id) &&
      state.week >= (event.minWeek ?? 1) &&
      state.week <= config.weeks - (event.notInLast ?? 0) &&
      (!event.condition || event.condition(state, env)),
  );
  return rng.weighted(candidates, (event) => event.weight)?.id ?? null;
}

export function beginWeek(state: MissionState): void {
  const env = currentEnv(state);
  for (const mod of state.modifiers) mod.delayed = false; // effects ordered last week start now

  const now = blankNow();
  now.start = { air: state.air, food: state.food, science: state.science, battery: state.battery };
  now.solar = solarFor(state, env);
  now.available = now.solar + state.battery;
  state.now = now; // the card's advice below looks at this week's power, not last week's
  now.eventId = pickEvent(state, env);
  now.eventDone = now.eventId === null;
  if (now.eventId) {
    const event = EVENTS[now.eventId];
    now.advice = adviceFor(event, state, env);
    now.adviceFallback = now.advice !== firstChoice(event, state, env);
  }
  if (env.autoShelter) {
    now.sheltered = true;
    now.evaAllowed = false;
    now.evaBlock = 'eva.blockShelter';
  }
  state.phase = 'briefing';
  state.alloc = state.week === 1 ? suggestAlloc(state) : fitAlloc(state.alloc, now.available);
  if (robotIdle(state)) state.alloc.shield = 0; // wall finished and nothing else to build: the robot needs no cells
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

/** Lower power levels until the plan fits the cells we have. Science goes first, air last. */
export function fitAlloc(alloc: Alloc, available: number): Alloc {
  const next = { ...alloc };
  const order: ModuleId[] = ['lab', 'shield', 'farm', 'life'];
  let guard = 40;
  while (allocTotal(next) > available && guard-- > 0) {
    const victim = order.find((id) => next[id] > 0);
    if (!victim) break;
    next[victim] -= 1;
  }
  return next;
}

/** Set one module's power level. Returns false when there are not enough cells. */
export function setAlloc(state: MissionState, module: ModuleId, level: number): boolean {
  const wanted = clamp(Math.round(level), 0, MAX_LEVEL[module]);
  if (module === 'shield' && wanted > 0 && robotIdle(state)) return false; // nothing left to build
  const total = allocTotal(state.alloc) - state.alloc[module] + wanted;
  if (total > state.now.available) return false;
  state.alloc[module] = wanted;
  return true;
}

/**
 * A safe starting plan ("Lumi's plan"): keeps the crew alive first.
 * It is deliberately careful, so players who want more science must change it.
 */
export function suggestAlloc(state: MissionState): Alloc {
  const alloc = emptyAlloc();
  const next = state.plan[state.week];
  // Save cells only in the last bright week before a dark spell. Once the dark spell
  // has begun, the saved cells are there to be used.
  const brightNow = currentEnv(state).sunlight >= 0.7;
  const lowSunAhead = brightNow && !!next && next.sunlight < 0.7;
  const reserve = lowSunAhead ? Math.min(2, Math.max(0, state.batteryCap - 1)) : 0;
  let budget = Math.max(0, state.now.available - reserve);

  const onMoon = state.config.site === 'moon';
  const weeksLeft = state.config.weeks - state.week + 1;
  const foodShort = state.food < weeksLeft; // packed food will not last: grow more
  const steps: [ModuleId, number][] = foodShort
    ? [
        ['life', 1],
        ['life', 2],
        ['farm', 1],
        ['farm', 2],
        ['life', 3],
        ['shield', 1],
        ['lab', 1],
      ]
    : [
        ['life', 1],
        ['life', 2],
        ['farm', 1],
        ['life', 3],
        ['farm', 2],
        ['shield', 1],
        ['lab', 1],
      ];
  if (state.air < 50) steps.push(['life', 4]);
  if (onMoon && state.shield < 0.6) steps.push(['shield', 2]);
  steps.push(['lab', 2], ['farm', 3], ['shield', 2], ['lab', 3], ['life', 4]);

  for (const [module, level] of steps) {
    if (budget <= 0) break;
    if (module === 'shield' && robotIdle(state)) continue;
    if (alloc[module] === level - 1 && level <= MAX_LEVEL[module]) {
      alloc[module] = level;
      budget -= 1;
    }
  }
  return alloc;
}

function addFx(target: Effects, fx: Effects): void {
  for (const key of Object.keys(fx) as (keyof Effects)[]) {
    target[key] = (target[key] ?? 0) + (fx[key] ?? 0);
  }
}

/** Apply a card's effects. Returns what really changed: a store never goes below empty or above full. */
function applyFx(state: MissionState, fx: Effects): Effects {
  const before = { air: state.air, food: state.food, dose: state.dose, science: state.science, shield: state.shield, crop: state.crop };
  if (fx.cells) state.now.available = Math.max(0, state.now.available + fx.cells);
  if (fx.air) state.air = clamp(state.air + fx.air, 0, 100);
  if (fx.food) state.food = Math.max(0, round2(state.food + fx.food));
  if (fx.dose) state.dose = Math.max(0, round2(state.dose + fx.dose));
  if (fx.science) state.science = Math.max(0, Math.round(state.science + fx.science));
  if (fx.shield) state.shield = clamp(round2(state.shield + fx.shield), 0, 1);
  if (fx.crop) state.crop = Math.max(0, round2(state.crop + fx.crop));
  if (fx.batteryCap) {
    state.batteryCap = Math.max(1, state.batteryCap + fx.batteryCap);
    // The charge kept in a unit that was switched off is lost with it.
    const lost = Math.max(0, state.battery - state.batteryCap);
    if (lost > 0) {
      state.battery -= lost;
      state.now.available = Math.max(0, state.now.available - lost);
    }
  }
  const applied: Effects = { ...fx };
  if (fx.air) applied.air = round2(state.air - before.air);
  if (fx.food) applied.food = round2(state.food - before.food);
  if (fx.dose) applied.dose = round2(state.dose - before.dose);
  if (fx.science) applied.science = state.science - before.science;
  if (fx.shield) applied.shield = round2(state.shield - before.shield);
  if (fx.crop) applied.crop = round2(state.crop - before.crop);
  return applied;
}

export interface ChoiceResult {
  eventId: string;
  optionId: OptionId;
  fx: Effects;
  advice: OptionId | null;
}

/** Choose an option on this week's card. Returns null when the choice is not allowed. */
export function chooseOption(state: MissionState, optionId: OptionId): ChoiceResult | null {
  const { now } = state;
  if (!now.eventId || now.eventDone) return null;
  const event = EVENTS[now.eventId];
  const option = event.options.find((candidate) => candidate.id === optionId);
  if (!option || optionBlock(option, state)) return null;

  const fx = resolveFx(option, state);
  const mods = resolveMods(option, state);
  const applied = applyFx(state, fx);
  addFx(now.eventFx, applied);
  for (const mod of mods) {
    state.modifiers = state.modifiers.filter((existing) => existing.id !== mod.id);
    state.modifiers.push(mod);
  }
  if (option.shelter) now.sheltered = true;
  if (option.scienceFactor) now.scienceFactor *= option.scienceFactor;
  if (option.ration) now.ration = true;
  if (option.cleanPanels) {
    state.panelDust = 0;
    now.cleaned = true;
    // Clean panels help at once: recount this week's sunlight.
    const solar = solarFor(state, currentEnv(state));
    now.available += solar - now.solar;
    now.solar = solar;
  }
  if (option.noEva) {
    now.evaAllowed = false;
    now.evaBlock = 'eva.blockShelter';
  }
  if (option.flag) state.flags[option.flag] = true;

  now.optionId = optionId;
  now.eventDone = true;
  state.usedEvents.push(event.id);
  if (event.id === 'solar_storm') state.stormCards += 1;
  if (!state.unlocked.includes(event.codex)) state.unlocked.push(event.codex);
  state.alloc = fitAlloc(state.alloc, now.available);
  // The card shows what really changed, not the printed price (a full tank cannot take more air).
  return { eventId: event.id, optionId, fx: applied, advice: now.advice };
}

export interface EarthAnswer {
  advice: OptionId;
  /** Seconds for the question to reach Earth and the answer to come back. */
  roundTripSeconds: number;
  /** True when the answer arrives after the decision had to be made. */
  tooLate: boolean;
  /** Science lost while the crew waited for the answer. */
  scienceCost: number;
}

/**
 * Ask Mission Control on Earth. Near the Moon the answer takes under three seconds.
 * On Mars it takes many minutes: urgent problems cannot wait for it, and waiting
 * on slow problems costs working time.
 */
export function askEarth(state: MissionState): EarthAnswer | null {
  const { now } = state;
  if (now.eventDone || now.askedEarth) return null;
  const answer = earthAnswerFor(state);
  if (!answer) return null;
  now.askedEarth = true;
  if (answer.scienceCost) {
    addFx(now.eventFx, applyFx(state, { science: -answer.scienceCost }));
  }
  state.flags.asked_earth = true;
  return answer;
}

/** What Mission Control answers about this week's card. Pure: changes nothing. */
export function earthAnswerFor(state: MissionState): EarthAnswer | null {
  const { now } = state;
  if (!now.eventId || !now.advice) return null;
  const env = currentEnv(state);
  if (env.conjunction) return null;
  const event = EVENTS[now.eventId];
  const onMars = state.config.site === 'mars';
  const roundTripSeconds = env.delaySeconds * 2;
  const tooLate = onMars && !!event.urgent && !earthInTime(state);
  return {
    advice: now.advice,
    roundTripSeconds,
    tooLate,
    // Waiting for a Mars answer costs working time.
    scienceCost: onMars && !tooLate ? 3 : 0,
  };
}

/** Record a walk outside. Air and science change at once. */
export function applyEva(state: MissionState, result: EvaResult): void {
  const { now } = state;
  if (now.eva) return;
  now.eva = { ...result, vest: result.vest ?? hasTool(state, 'vest') };
  const airCost = Math.min(9, Math.round(result.seconds * EVA_AIR_PER_SECOND));
  const airHad = state.air;
  state.air = clamp(state.air - airCost, 0, 100);
  now.evaAir = airHad - state.air;
  state.science += Math.max(0, Math.round(result.science));
  if (result.chore) {
    if (state.config.site === 'mars') {
      state.panelDust = 0;
      now.cleaned = true;
    } else {
      const airBefore = state.air;
      state.air = clamp(state.air + 6, 0, 100); // ice from the dark crater becomes water and oxygen
      now.iceAir = state.air - airBefore;
    }
    state.flags.did_chore = true;
  }
  if (result.samples > 0) state.flags.collected_sample = true;
  addMaterials(state, result.materials);
  // Normally already recorded when made; recording again does nothing.
  for (const id of result.finds ?? []) recordFind(state, id);
  if (result.alerted && !result.caught) state.flags.outran_storm = true;
}

// ---------------------------------------------------------------------------
// The week's physics
// ---------------------------------------------------------------------------

/** What will this week do with the current power plan? Pure: changes nothing. */
export function computeWeek(state: MissionState): WeekOutcome {
  const site = SITES[state.config.site];
  const difficulty = DIFFICULTY[state.config.difficulty];
  const env = currentEnv(state);
  const { now, alloc } = state;

  // Energy
  const used = allocTotal(alloc);
  const leftover = Math.max(0, now.available - used);
  const batteryAfter = Math.min(state.batteryCap, leftover);
  const wasted = leftover - batteryAfter;

  // How well the crew can work
  let efficiency = now.scienceFactor;
  if (state.air < 25) efficiency *= 0.75;
  if (state.hungry > 0) efficiency *= 0.6;
  if (now.sheltered) efficiency *= SHELTER_SCIENCE;
  for (const mod of state.modifiers) {
    if (!mod.delayed && mod.scienceFactor) efficiency *= mod.scienceFactor;
  }

  // Air
  const rawAir = LIFE_AIR[alloc.life];
  const airLife = rawAir < 0 ? Math.round(rawAir * difficulty.airLoss) : rawAir;
  let airBonus = 0;
  for (const mod of state.modifiers) {
    if (!mod.delayed && mod.airPerWeek) airBonus += mod.airPerWeek;
  }
  if (state.crop >= 2 && alloc.farm > 0) airBonus += 3; // grown plants make a little oxygen
  const airAfter = clamp(state.air + airLife + airBonus, 0, 100);

  // Greenhouse
  let crop = state.crop;
  let neglect = state.neglect;
  let cropDied = false;
  if (alloc.farm === 0) {
    neglect += 1;
    if (neglect >= 2 && crop > 0) {
      crop = 0;
      cropDied = true;
    }
  } else {
    neglect = 0;
    crop += FARM_GROW[alloc.farm];
  }
  let harvested = false;
  let harvests = state.harvests;
  let foodHarvest = 0;
  if (crop >= CROP_WEEKS) {
    crop -= CROP_WEEKS;
    harvested = true;
    harvests += 1;
    foodHarvest = HARVEST_FOOD;
  }

  // Finished buildings
  let foodBuild = 0;
  let sciBuild = 0;
  let stormFactor = 1;
  for (const mod of state.modifiers) {
    if (mod.delayed) continue;
    if (mod.foodPerWeek) foodBuild += mod.foodPerWeek;
    if (mod.sciencePerWeek) sciBuild += mod.sciencePerWeek;
    if (mod.stormFactor) stormFactor *= mod.stormFactor;
  }

  // Food
  const portion = now.ration ? 0.5 : 1;
  let food = state.food + foodHarvest + foodBuild;
  let hungry = false;
  let eaten = portion;
  if (food < portion - 1e-9) {
    hungry = true;
    eaten = food;
    food = 0;
  } else {
    food -= portion;
  }
  const hungryAfter = hungry ? state.hungry + 1 : 0;

  // Radiation
  const shieldNow = state.shield;
  const doseGcr = env.gcrWeek * (1 - SHIELD_VS_COSMIC * shieldNow);
  let doseStorm = 0;
  let doseAvoided = env.gcrWeek - doseGcr;
  let doseWall = doseAvoided; // cosmic rays: only the wall helps
  if (env.storm.strength > 0) {
    const full = site.stormDose[env.storm.strength] * difficulty.stormFactor;
    const walls = 1 - SHIELD_VS_STORM * shieldNow;
    const indoor = now.sheltered ? Math.min(SHELTER_FACTOR, walls) : walls;
    // The storm bunker makes every storm gentler. Everything that did not reach the crew
    // (walls, shelter and bunker together) counts as avoided dose, once.
    doseStorm = full * indoor * stormFactor;
    doseAvoided += full - doseStorm;
    // In the shelter the credit goes to the shelter: the wall counts only for what it adds on top.
    doseWall += full * (now.sheltered ? Math.max(0, SHELTER_FACTOR - walls) : 1 - walls);
    if (now.eva?.caught) doseStorm += full * CAUGHT_OUTSIDE * ((now.eva.vest ?? hasTool(state, 'vest')) ? TOOL_EFFECT.vestFactor : 1);
  }
  const doseAfter = state.dose + doseGcr + doseStorm;

  // Science and shield
  const sciLab = Math.round(SCIENCE_PER_LEVEL * alloc.lab * efficiency);
  const scienceAfter = state.science + sciLab + sciBuild;
  // The builder robot works on one thing at a time: a new building, or else the wall.
  const construction = underConstruction(state);
  const buildCells = construction ? alloc.shield : 0;
  const buildDone: BuildingId | null =
    construction && construction.progress + buildCells >= buildingDef(construction.id).work ? construction.id : null;
  const shieldGain = construction ? 0 : Math.min(1 - state.shield, SHIELD_PER_CELL * alloc.shield);
  const shieldAfter = round2(state.shield + shieldGain);

  let end: EndReason | null = null;
  // Creative mode cannot be lost: only the last week ends it.
  const safe = !!state.config.creative;
  if (airAfter <= 0 && !safe) end = 'air';
  else if (hungryAfter >= 2 && !safe) end = 'food';
  else if (doseAfter >= state.doseLimit && !safe) end = 'radiation';
  else if (state.week >= state.config.weeks) end = 'complete';

  return {
    used,
    leftover,
    batteryAfter,
    wasted,
    efficiency: round2(efficiency),
    parts: {
      airLife,
      airBonus,
      airEvent: now.eventFx.air ?? 0,
      airEva: now.eva ? -(now.evaAir ?? Math.min(9, Math.round(now.eva.seconds * EVA_AIR_PER_SECOND))) : 0,
      doseGcr: round2(doseGcr),
      doseStorm: round2(doseStorm),
      doseEvent: now.eventFx.dose ?? 0,
      sciLab,
      sciEva: now.eva ? Math.round(now.eva.science) : 0,
      sciFinds: (now.finds?.length ?? 0) * FIND_SCIENCE,
      sciEvent: now.eventFx.science ?? 0,
      sciBuild,
      foodEaten: -round2(eaten),
      foodHarvest,
      foodBuild: round2(foodBuild),
      build: buildCells,
      foodEvent: now.eventFx.food ?? 0,
      airIce: now.iceAir ?? 0,
      airRooms: now.roomFx?.air ?? 0,
      sciRooms: now.roomFx?.science ?? 0,
      foodRooms: now.roomFx?.food ?? 0,
      shield: round2(shieldGain + (now.eventFx.shield ?? 0)),
      crop: round2(crop - state.crop),
    },
    airAfter: Math.round(airAfter),
    foodAfter: round2(food),
    doseAfter: round2(doseAfter),
    scienceAfter,
    shieldAfter,
    cropAfter: round2(crop),
    harvested,
    cropDied,
    hungry,
    neglectAfter: neglect,
    hungryAfter,
    harvestsAfter: harvests,
    doseAvoided: round2(doseAvoided),
    doseWall: round2(doseWall),
    buildCells,
    buildDone,
    end,
  };
}

export function starsFor(state: MissionState): number {
  if (state.end !== 'complete') return 0;
  const weeks = state.config.weeks;
  let stars = 1;
  if (state.science >= STAR_SCIENCE_PER_WEEK.two * weeks) stars = 2;
  if (state.science >= STAR_SCIENCE_PER_WEEK.three * weeks) stars = 3;
  return stars;
}

/** Science points needed for 2 and 3 stars in this mission. */
export function starTargets(config: MissionConfig): { two: number; three: number } {
  return { two: STAR_SCIENCE_PER_WEEK.two * config.weeks, three: STAR_SCIENCE_PER_WEEK.three * config.weeks };
}

/** Run the night: apply the week and write it into the mission log. */
export function resolveWeek(state: MissionState): WeekRecord {
  // A week runs once: a second press of the button gets the same log entry back.
  const done = state.history.find((entry) => entry.week === state.week);
  if (done) return done;
  const env = currentEnv(state);
  const site = SITES[state.config.site];
  const outcome = computeWeek(state);
  const { now } = state;

  state.battery = outcome.batteryAfter;
  state.air = outcome.airAfter;
  state.food = outcome.foodAfter;
  state.dose = outcome.doseAfter;
  state.science = outcome.scienceAfter;
  state.shield = outcome.shieldAfter;
  state.crop = outcome.cropAfter;
  state.neglect = outcome.neglectAfter;
  state.hungry = outcome.hungryAfter;
  state.harvests = outcome.harvestsAfter;
  const built = advanceConstruction(state, outcome.buildCells);

  if (outcome.harvested && !state.unlocked.includes('space_farming')) state.unlocked.push('space_farming');
  if (env.storm.strength > 0 && !state.unlocked.includes('space_weather')) state.unlocked.push('space_weather');
  if (env.reason === 'dust' && !state.unlocked.includes('dust_storm')) state.unlocked.push('dust_storm');
  if (env.reason === 'dark' && !state.unlocked.includes('polar_light')) state.unlocked.push('polar_light');
  if (outcome.wasted > 0) state.flags.wasted_power = true;
  if (outcome.hungry) state.flags.went_hungry = true;

  // Dust settles on the panels (Mars). A dust storm drops twice as much.
  if (site.dustPerWeek > 0 && !now.cleaned) {
    const rate = site.dustPerWeek * (env.reason === 'dust' ? 2 : 1);
    state.panelDust = Math.min(0.4, round2(state.panelDust + rate));
  }

  // Lasting effects count down.
  state.modifiers = state.modifiers.filter((mod) => {
    if (mod.permanent || mod.delayed) return true;
    mod.weeks -= 1;
    return mod.weeks > 0;
  });

  const record: WeekRecord = {
    week: state.week,
    dateFrom: env.dateFrom,
    dateTo: env.dateTo,
    alloc: { ...state.alloc },
    solar: now.solar,
    available: now.available,
    used: outcome.used,
    wasted: outcome.wasted,
    sunReason: env.reason,
    battery: state.battery,
    air: state.air,
    food: state.food,
    dose: state.dose,
    science: state.science,
    shield: state.shield,
    crop: state.crop,
    parts: outcome.parts,
    eventId: now.eventId,
    optionId: now.optionId,
    adviceId: now.advice,
    askedEarth: now.askedEarth,
    sheltered: now.sheltered,
    storm: env.storm.strength,
    doseAvoided: outcome.doseAvoided,
    doseWall: outcome.doseWall,
    harvested: outcome.harvested,
    cropDied: outcome.cropDied,
    hungry: outcome.hungry,
    evaSamples: now.eva?.samples ?? 0,
    evaCaught: !!now.eva?.caught,
    efficiency: outcome.efficiency,
    built,
  };
  state.history.push(record);
  if (state.config.creative) {
    // Creative: nobody runs short of anything.
    state.air = Math.max(state.air, 100);
    state.food = Math.max(state.food, 4);
    state.dose = 0;
    state.hungry = 0;
    state.stock = { regolith: CREATIVE_STOCK, metal: CREATIVE_STOCK };
  }

  if (outcome.end) {
    state.end = outcome.end;
    state.phase = 'ended';
    state.stars = starsFor(state);
  } else {
    state.phase = 'report';
  }
  return record;
}

/** Move on to the next week after the report. */
export function nextWeek(state: MissionState): void {
  if (state.end) return;
  if (!state.history.some((entry) => entry.week === state.week)) return; // this week has not been played yet
  state.week += 1;
  beginWeek(state);
}

/** Chance (0-1) that a storm alert sounds during a walk outside this week. */
export function evaStormChance(state: MissionState): number {
  const env = currentEnv(state);
  if (state.now.sheltered) return 0;
  return [0, 0.5, 0.85, 1][env.storm.strength];
}

export { MODULES, MAX_LEVEL, allocTotal, URGENT_WAIT_SECONDS };
