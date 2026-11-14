/**
 * The caught share is k of N where N is the walkers who went out, not only the ones who came back
 * (docs/MULTIPLAYER.md, walk merge): a walker who never returns still counts in N.
 */
import { describe, expect, it } from 'vitest';
import { createMission } from '../src/sim/mission';
import { COOP_TIMING, LONGEST_WALK_SECONDS, coopApply, coopTick, createCoop, mergeWalks } from '../src/sim/coop';
import type { CoopSim, IntentBody } from '../src/sim/coop';
import { EVENTS, optionBlock } from '../src/sim/events';
import type { MissionConfig, OptionId } from '../src/sim/types';
import { DATA } from './bots';

const cfg: MissionConfig = { site: 'mars', difficulty: 'cadet', weeks: 6, startDate: '2024-05-01', seed: 7, tutorial: false, sunMode: 'random', windowId: 'may2024' };
const walk = (caught: boolean) => ({ seconds: 40, samples: 2, science: 4, chore: false, caught, alerted: caught, picked: [0, 1] });

describe('caught share', () => {
  it('mergeWalks divides by the walkers when it is told how many went out', () => {
    expect(mergeWalks([walk(true), walk(false)], undefined, 3)!.caughtShare).toBeCloseTo(1 / 3, 6);
    expect(mergeWalks([walk(true), walk(false)])!.caughtShare).toBe(0.5);
  });

  it('three walkers: one caught, one safe, one never back, the share is 1/3', () => {
    const seats = ['s0', 's1', 's2'];
    const co: CoopSim = createCoop(createMission(cfg, DATA), seats, 0);
    const counter: Record<string, number> = {};
    let now = 0;
    const send = (from: string, body: IntentBody): void => {
      const n = (counter[from] = (counter[from] ?? 0) + 1);
      coopApply(co, { from, n, w: co.mission.week, s: co.stage, ...body } as never, now);
    };
    const pick = (): OptionId => {
      const event = EVENTS[co.mission.now.eventId!];
      const open = event.options.filter((o) => !optionBlock(o, co.mission)).map((o) => o.id);
      const advice = co.mission.now.advice;
      return advice && open.includes(advice) ? advice : open[0];
    };
    for (let guard = 0; guard < 50 && co.stage !== 'walk'; guard++) {
      for (const s of seats) {
        if (co.stage === 'event' && !(s in co.votes)) send(s, { k: 'vote', o: pick() });
        else if (['briefing', 'eventResult', 'plan', 'report'].includes(co.stage) && !co.ready.includes(s)) send(s, { k: 'ready', on: true });
      }
    }
    expect(co.stage).toBe('walk');
    for (const s of seats) send(s, { k: 'walk', go: true });
    expect(co.outside).toBe(true);
    send('s0', { k: 'walkEnd', r: walk(false) });
    send('s2', { k: 'walkEnd', r: walk(true) });
    now = (LONGEST_WALK_SECONDS + COOP_TIMING.walkGrace) * 1000 + 1;
    coopTick(co, now);
    expect(co.mission.now.eva?.caught).toBe(true);
    expect(co.mission.now.eva?.caughtShare).toBeCloseTo(1 / 3, 6);
  });
});
