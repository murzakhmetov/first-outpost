/**
 * Shared types for the mission simulation.
 *
 * The simulation is plain data plus pure functions. It knows nothing about
 * graphics, sound or the screen, so it can be unit-tested and balance-tested
 * in Node.
 */
import type { SwDayMap } from './donki';

export type SiteId = 'mars' | 'moon';
export type ModuleId = 'life' | 'farm' | 'lab' | 'shield';
export type Difficulty = 'cadet' | 'commander' | 'legend';
export type OptionId = 'a' | 'b' | 'c';
export type EndReason = 'complete' | 'air' | 'food' | 'radiation';
export type Phase = 'briefing' | 'event' | 'plan' | 'eva' | 'night' | 'report' | 'ended';
export type SunMode = 'random' | 'featured' | 'live';

export const MODULES: readonly ModuleId[] = ['life', 'farm', 'lab', 'shield'];

/** Highest power level each module accepts. One level costs one energy cell per week. */
export const MAX_LEVEL: Record<ModuleId, number> = { life: 4, farm: 3, lab: 3, shield: 2 };

export type Alloc = Record<ModuleId, number>;

/** Mars weather archive: date -> [sol, minAirTempC, maxAirTempC, pressurePa, solarLongitudeDeg]. */
export type MarsWeatherMap = Record<string, number[]>;

/** Real data handed to the simulation. */
export interface SimData {
  sun: SwDayMap;
  marsWeather: MarsWeatherMap | null;
}

export interface MissionConfig {
  site: SiteId;
  difficulty: Difficulty;
  /** Number of turns. One turn is one week. */
  weeks: number;
  /** First day of the mission (UTC, YYYY-MM-DD). Space weather is replayed from this real date. */
  startDate: string;
  seed: number;
  tutorial: boolean;
  sunMode: SunMode;
  /** Id of a featured real-history window, when one was picked. */
  windowId?: string;
  /** Creative mode: build anything anywhere, with no limits and no way to lose. */
  creative?: boolean;
}

/** What the real Sun did during one week (from NASA DONKI). */
export interface WeekSun {
  dateFrom: string;
  dateTo: string;
  mFlares: number;
  xFlares: number;
  topFlare: { cls: string; date: string; id?: number; region?: number } | null;
  /** Particle storm measured near Earth and the Moon. */
  nearSep: { strength: number; date: string; id?: number } | null;
  /** Particle storm measured at Mars. */
  marsSep: { strength: number; date: string; id?: number } | null;
  /** NASA WSA-ENLIL model: solar eruption arriving at Mars. */
  marsCme: { level: number; date: string; id?: number; speed?: number } | null;
  /** Strongest geomagnetic storm at Earth (Kp index). */
  kp: { value: number; date: string; id?: number } | null;
  /** 0 quiet, 1 active, 2 stormy, 3 extreme. */
  activity: 0 | 1 | 2 | 3;
}

export type StormBasis = 'none' | 'sep' | 'rad' | 'cme';

export interface StormInfo {
  /** 0 none, 1 minor, 2 strong, 3 extreme. */
  strength: 0 | 1 | 2 | 3;
  basis: StormBasis;
  date: string;
  /** DONKI record number, when the storm comes from a DONKI record. */
  id?: number;
  /** Which DONKI record type the id refers to. */
  kind?: 'SEP' | 'WSA-ENLIL';
  /** Source page for curated (non-DONKI) events. */
  url?: string;
}

export type SunReason = 'clear' | 'dust' | 'dark';

/** Fixed facts about one week, known when the mission is created. */
export interface WeekEnv {
  week: number;
  dateFrom: string;
  dateTo: string;
  sun: WeekSun;
  storm: StormInfo;
  /** Fraction of normal sunlight reaching the solar panels (dust storm or darkness). */
  sunlight: number;
  reason: SunReason;
  /** Mars only: sunlight change from the planet's distance to the Sun (1 = average). */
  seasonal: number;
  tempMin: number | null;
  tempMax: number | null;
  /** True when the temperatures are a real Curiosity REMS record for these dates. */
  tempReal: boolean;
  /** Mars sol number of the first day, when known. */
  sol: number | null;
  /** One-way radio delay to Earth, seconds. */
  delaySeconds: number;
  earthDistanceKm: number;
  /** Mars season angle in degrees, or null on the Moon. */
  ls: number | null;
  /** Cosmic-ray dose this week with no shielding, mSv. */
  gcrWeek: number;
  /** Date of a real total lunar eclipse inside this week (Moon only). */
  eclipse: string | null;
  /** Mars only: the Sun sits between Earth and Mars, radio contact is cut. */
  conjunction: boolean;
  /** An event that must happen this week (storm, dust warning, eclipse). */
  fixedEvent: string | null;
  /** A strong storm with no decision card: the crew follows the standing order and shelters. */
  autoShelter: boolean;
}

/** A change to the outpost. Positive numbers add, negative numbers take away. */
export interface Effects {
  /** Energy cells. Negative = the choice costs cells from this week's supply. */
  cells?: number;
  air?: number;
  /** Weeks of food. */
  food?: number;
  /** Radiation dose in mSv. */
  dose?: number;
  science?: number;
  /** Shield level, 0-1. */
  shield?: number;
  /** Crop growth progress in weeks. */
  crop?: number;
  batteryCap?: number;
}

/** A lasting effect that runs for several weeks. */
export interface Modifier {
  id: string;
  /** Weeks still to run, counting the current one. Ignored when permanent. */
  weeks: number;
  permanent?: boolean;
  /** Added to solar cells each week. */
  solarFlat?: number;
  /** Multiplies science each week. */
  scienceFactor?: number;
  /** Added to air each week. */
  airPerWeek?: number;
  /** Added to food each week (weeks of food). */
  foodPerWeek?: number;
  /** Added to science each week. */
  sciencePerWeek?: number;
  /** Multiplies the dose of solar storms. */
  stormFactor?: number;
  /** Starts the week after it was created. */
  delayed?: boolean;
}

export interface EvaResult {
  /** Real seconds spent outside. */
  seconds: number;
  samples: number;
  /** Science earned from samples. Discoveries give theirs the moment they are made (sim/finds.ts). */
  science: number;
  /** Ids of the discoveries made on this walk (see sim/finds.ts). */
  finds?: string[];
  /** Materials brought back (see sim/outpost.ts). */
  materials?: { regolith: number; metal: number };
  /** The weekly chore was done (clean panels on Mars, fetch ice on the Moon). */
  chore: boolean;
  /** A particle storm caught the crew outdoors. */
  caught: boolean;
  /** A storm alert sounded during the walk. */
  alerted: boolean;
  /** The radiation vest was worn on this walk (filled in when the walk is recorded). */
  vest?: boolean;
}

/** Live values for the week being played. */
export interface WeekNow {
  solar: number;
  /** Cells that can still be spent this week: solar + battery - event costs. */
  available: number;
  eventId: string | null;
  optionId: OptionId | null;
  /** What Mission Control would choose for this week's card. */
  advice: OptionId | null;
  /** Mission Control's first choice needs more power than the crew has, so the advice is the next best option. */
  adviceFallback?: boolean;
  eventDone: boolean;
  askedEarth: boolean;
  sheltered: boolean;
  /** Extra science multiplier from this week's choices. */
  scienceFactor: number;
  /** Half food portions this week. */
  ration: boolean;
  /** Changes already applied by this week's card. */
  eventFx: Effects;
  /** Solar panels were cleaned this week. */
  cleaned: boolean;
  eva: EvaResult | null;
  /** Discoveries made this week (their science is already counted). */
  finds?: string[];
  /** Rooms whose game was won this week (sim/outpost.ts). */
  games?: string[];
  /** What the room game paid this week, as it really changed the stores (sim/outpost.ts). */
  roomFx?: Effects;
  /** Air the walk really cost (the tank cannot go below empty). */
  evaAir?: number;
  /** Air from the ice of the dark crater, brought in on this week's walk (Moon). */
  iceAir?: number;
  /** Air, food and science when the week began (the weekly report measures from here). */
  start?: { air: number; food: number; science: number; battery?: number };
  /** A storm alert sounded during this week's walk (saved, so reloading cannot dodge the storm). */
  evaAlerted?: boolean;
  evaAllowed: boolean;
  /** Text key that explains why the walk is not allowed. */
  evaBlock: string | null;
}

export interface WeekParts {
  airLife: number;
  airBonus: number;
  airEvent: number;
  airEva: number;
  doseGcr: number;
  doseStorm: number;
  doseEvent: number;
  sciLab: number;
  sciEva: number;
  /** Science from discoveries (missing in saves made before discoveries existed). */
  sciFinds?: number;
  /** Science from finished buildings (the observatory). */
  sciBuild?: number;
  /** Food from finished buildings (the garden). */
  foodBuild?: number;
  /** Cells of builder-robot work that went into a new building instead of the wall. */
  build?: number;
  sciEvent: number;
  foodEaten: number;
  foodHarvest: number;
  foodEvent: number;
  /** Air from crater ice and what the room game paid (missing in older saves). */
  airIce?: number;
  airRooms?: number;
  sciRooms?: number;
  foodRooms?: number;
  shield: number;
  crop: number;
}

/** Everything that happened in one finished week. */
export interface WeekRecord {
  week: number;
  dateFrom: string;
  dateTo: string;
  alloc: Alloc;
  solar: number;
  available: number;
  used: number;
  wasted: number;
  sunReason: SunReason;
  /** Values at the end of the week. */
  battery: number;
  air: number;
  food: number;
  dose: number;
  science: number;
  shield: number;
  crop: number;
  parts: WeekParts;
  eventId: string | null;
  optionId: OptionId | null;
  adviceId: OptionId | null;
  askedEarth: boolean;
  sheltered: boolean;
  storm: number;
  /** Dose that shielding or sheltering kept away, mSv. */
  doseAvoided: number;
  /** The part of that dose the regolith wall stopped by itself, mSv. */
  doseWall?: number;
  harvested: boolean;
  cropDied: boolean;
  hungry: boolean;
  evaSamples: number;
  evaCaught: boolean;
  efficiency: number;
  /** A new building the robot finished tonight. */
  built?: import('./outpost').BuildingId | null;
}

export interface MissionState {
  config: MissionConfig;
  plan: WeekEnv[];
  /** Current week, starting at 1. */
  week: number;
  phase: Phase;
  battery: number;
  batteryCap: number;
  air: number;
  food: number;
  dose: number;
  doseLimit: number;
  science: number;
  shield: number;
  /** Crop growth progress in weeks; harvest at CROP_WEEKS. */
  crop: number;
  /** Weeks in a row with an unpowered greenhouse. */
  neglect: number;
  /** Weeks in a row without enough food. */
  hungry: number;
  harvests: number;
  /** Fraction of solar power lost to dust on the panels (Mars). */
  panelDust: number;
  alloc: Alloc;
  modifiers: Modifier[];
  usedEvents: string[];
  stormCards: number;
  flags: Record<string, boolean>;
  now: WeekNow;
  history: WeekRecord[];
  end: EndReason | null;
  stars: number;
  /** Codex cards earned during this mission. */
  unlocked: string[];
  /** Materials in store (sim/outpost.ts). Missing in older saves. */
  stock?: { regolith: number; metal: number };
  /** New buildings, finished or being built. */
  buildings?: import('./outpost').Construction[];
  /** Tools made in the workshop. */
  tools?: import('./outpost').ToolId[];
  /** Creative mode: decorations placed around the outpost. */
  decor?: import('./outpost').DecorItem[];
}

/** Prediction for the current week, used by the planning screen. */
export interface WeekOutcome {
  used: number;
  leftover: number;
  batteryAfter: number;
  wasted: number;
  efficiency: number;
  parts: WeekParts;
  airAfter: number;
  foodAfter: number;
  doseAfter: number;
  scienceAfter: number;
  shieldAfter: number;
  cropAfter: number;
  harvested: boolean;
  cropDied: boolean;
  hungry: boolean;
  neglectAfter: number;
  hungryAfter: number;
  harvestsAfter: number;
  doseAvoided: number;
  doseWall: number;
  /** Cells of builder-robot work going into a new building this week. */
  buildCells: number;
  /** The building that will be finished tonight, if any. */
  buildDone: import('./outpost').BuildingId | null;
  end: EndReason | null;
}
