/**
 * Robot players used to check that the game is fair:
 * careful play should survive, greedy or careless play should get into trouble,
 * and no single "always do X" plan should win everything.
 */
import { ROOMS, claimRoom } from '../src/sim/outpost';
import archive from '../src/data/spaceweather.json';
import marsWeather from '../src/data/mars-weather.json';
import type { SwDayMap } from '../src/sim/donki';
import { EVENTS, optionBlock, resolveFx } from '../src/sim/events';
import {
  applyEva,
  chooseOption,
  createMission,
  currentEnv,
  evaStormChance,
  nextWeek,
  resolveWeek,
  suggestAlloc,
} from '../src/sim/mission';
import { Rng } from '../src/sim/rng';
import type { Alloc, MissionConfig, MissionState, ModuleId, OptionId, SimData } from '../src/sim/types';
import { MAX_LEVEL } from '../src/sim/types';

export const DATA: SimData = {
  sun: (archive as unknown as { days: SwDayMap }).days,
  marsWeather: (marsWeather as unknown as { days: Record<string, number[]> }).days,
};

export interface Bot {
  name: string;
  choose(state: MissionState, rng: Rng): OptionId;
  plan(state: MissionState, rng: Rng): Alloc;
  /** Seconds outside and samples collected; null = stay inside. */
  eva(state: MissionState, rng: Rng): { seconds: number; samples: number; science: number; chore: boolean } | null;
}

function firstAllowed(state: MissionState, preferred: OptionId[]): OptionId {
  const event = EVENTS[state.now.eventId!];
  for (const id of preferred) {
    const option = event.options.find((candidate) => candidate.id === id);
    if (option && !optionBlock(option, state)) return id;
  }
  return event.options[event.options.length - 1].id;
}

function fill(state: MissionState, order: [ModuleId, number][], reserve = 0): Alloc {
  const alloc: Alloc = { life: 0, farm: 0, lab: 0, shield: 0 };
  let budget = Math.max(0, state.now.available - reserve);
  for (const [module, level] of order) {
    if (budget <= 0) break;
    if (module === 'shield' && state.shield >= 1) continue;
    const target = Math.min(level, MAX_LEVEL[module]);
    while (alloc[module] < target && budget > 0) {
      alloc[module] += 1;
      budget -= 1;
    }
  }
  return alloc;
}

/** Follows Mission Control and Lumi's safe plan. Walks outside on calm weeks only. */
export const carefulBot: Bot = {
  name: 'careful',
  choose: (state) => firstAllowed(state, [state.now.advice ?? 'a', 'a', 'b', 'c']),
  plan: (state) => suggestAlloc(state),
  eva: (state) =>
    evaStormChance(state) > 0 ? null : { seconds: 35, samples: 3, science: 9, chore: state.week % 3 === 0 },
};

/** A thoughtful player: keeps the crew safe but pushes spare cells into science. */
export const smartBot: Bot = {
  name: 'smart',
  choose: (state) => firstAllowed(state, [state.now.advice ?? 'a', 'a', 'b', 'c']),
  plan: (state) => {
    const next = state.plan[state.week];
    const reserve = next && next.sunlight < 0.7 ? 2 : 0;
    const moon = state.config.site === 'moon';
    const lifeLevel = state.air < 45 ? 4 : state.air > 85 ? 2 : 3;
    const weeksLeft = state.config.weeks - state.week + 1;
    const farmLevel = state.food < weeksLeft ? (state.food < weeksLeft - 2 ? 3 : 2) : 1;
    const shieldLevel = state.shield >= 1 ? 0 : moon ? 2 : state.shield < 0.5 ? 1 : 0;
    return fill(
      state,
      [
        ['life', Math.min(lifeLevel, 2)],
        ['farm', 1],
        ['life', lifeLevel],
        ['farm', farmLevel],
        ['shield', shieldLevel],
        ['lab', 3],
        ['life', 4],
      ],
      reserve,
    );
  },
  eva: (state) =>
    evaStormChance(state) >= 0.8 ? null : { seconds: 45, samples: 4, science: 13, chore: state.week % 3 === 0 },
};

/** Science first, everything else later. */
export const greedyBot: Bot = {
  name: 'greedy',
  choose: (state) => {
    const event = EVENTS[state.now.eventId!];
    let best: OptionId = event.options[0].id;
    let bestScience = -Infinity;
    for (const option of event.options) {
      if (optionBlock(option, state)) continue;
      const science = resolveFx(option, state).science ?? 0;
      if (science > bestScience) {
        bestScience = science;
        best = option.id;
      }
    }
    return best;
  },
  plan: (state) =>
    fill(state, [
      ['lab', 3],
      ['life', 2],
      ['farm', 1],
      ['life', 3],
      ['shield', 2],
    ]),
  eva: () => ({ seconds: 60, samples: 5, science: 17, chore: false }),
};

/** Hides in the base: maximum safety, no science. */
export const turtleBot: Bot = {
  name: 'turtle',
  choose: (state) => firstAllowed(state, [state.now.advice ?? 'a', 'a', 'b', 'c']),
  plan: (state) =>
    fill(state, [
      ['life', 4],
      ['farm', 3],
      ['shield', 2],
    ]),
  eva: () => null,
};

/** Presses buttons at random, like a very young first-time player. */
export const randomBot: Bot = {
  name: 'random',
  choose: (state, rng) => {
    const event = EVENTS[state.now.eventId!];
    const allowed = event.options.filter((option) => !optionBlock(option, state));
    return (allowed.length ? rng.pick(allowed) : event.options[0]).id;
  },
  plan: (state, rng) => {
    const alloc: Alloc = { life: 0, farm: 0, lab: 0, shield: 0 };
    const modules: ModuleId[] = ['life', 'farm', 'lab', 'shield'];
    let budget = state.now.available - rng.int(0, 1);
    let guard = 60;
    while (budget > 0 && guard-- > 0) {
      const module = rng.pick(modules);
      if (alloc[module] < MAX_LEVEL[module]) {
        alloc[module] += 1;
        budget -= 1;
      }
    }
    return alloc;
  },
  eva: (_state, rng) =>
    rng.chance(0.6)
      ? { seconds: rng.int(20, 60), samples: rng.int(1, 4), science: rng.int(3, 12), chore: rng.chance(0.25) }
      : null,
};

export const BOTS: Bot[] = [carefulBot, smartBot, greedyBot, turtleBot, randomBot];

/**
 * Play one mission. With `roomGames`, the player also wins one room game a week, choosing the one
 * that pays the most science (the hardest case for the star balance).
 */
export function play(config: MissionConfig, bot: Bot, data: SimData = DATA, roomGames = false): MissionState {
  const state = createMission(config, data);
  const rng = new Rng(config.seed ^ 0x9e3779b9);
  let guard = 200;
  while (!state.end && guard-- > 0) {
    if (state.now.eventId && !state.now.eventDone) {
      const choice = bot.choose(state, rng);
      if (!chooseOption(state, choice)) {
        // The bot picked something not allowed: take the first allowed option instead.
        const event = EVENTS[state.now.eventId];
        const fallback = event.options.find((option) => !optionBlock(option, state)) ?? event.options[0];
        chooseOption(state, fallback.id);
      }
    }
    state.alloc = bot.plan(state, rng);
    if (state.now.evaAllowed) {
      const walk = bot.eva(state, rng);
      if (walk) {
        const alert = rng.chance(evaStormChance(state));
        // A bot caught by an alert makes it back in time half of the time.
        const caught = alert && rng.chance(0.5);
        applyEva(state, { ...walk, alerted: alert, caught });
      }
    }
    if (roomGames) {
      const games = ROOMS.flatMap((room) => room.games.map((item) => ({ room: room.id, game: item.game, science: item.reward.science ?? 0 })));
      games.sort((a, b) => b.science - a.science);
      for (const item of games) if (claimRoom(state, item.room, item.game, true)) break;
    }
    resolveWeek(state);
    if (!state.end) nextWeek(state);
  }
  return state;
}

export function envOf(state: MissionState) {
  return currentEnv(state);
}
