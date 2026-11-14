/**
 * What the screens know about a shared base (src/net/coopview.ts): who is waited for, who changed the plan, the
 * countdown, "Go on" and "Play on alone". Plain functions on plain data, no screen. The signal is null in solo play.
 */
import { describe, expect, it } from 'vitest';
import { crewEn, crewRu } from '../src/i18n/crew';
import {
  ALONE_MS,
  CHANGE_SHOW_MS,
  GO_ON_MS,
  QUIET_MS,
  answered,
  canGoOn,
  canPlayAlone,
  clearCoop,
  coopLive,
  doingKey,
  flashing,
  friendsOutside,
  iAnswered,
  makeLive,
  participants,
  planNote,
  secondsLeft,
  votersOf,
  waitingForCommander,
  waitingFor,
} from '../src/net/coopview';
import type { CoopContext } from '../src/net/coopview';
import type { CoopMeta } from '../src/sim/coop';
import type { Alloc } from '../src/sim/types';

const ALLOC: Alloc = { life: 2, farm: 1, lab: 1, shield: 0 };

function meta(patch: Partial<CoopMeta> = {}): CoopMeta {
  return {
    stage: 'briefing',
    rev: 1,
    week: 1,
    seats: ['a', 'b', 'c'],
    ready: [],
    votes: {},
    walk: {},
    outside: false,
    returned: [],
    left: null,
    acks: {},
    choice: null,
    ...patch,
  };
}

function ctx(patch: Partial<CoopContext> = {}): CoopContext {
  return { me: 'b', hostId: 'a', alloc: ALLOC, quiet: false, now: 10_000, ...patch };
}

describe('the crew view', () => {
  it('is null in solo play and after the session ends', () => {
    expect(coopLive.value).toBeNull();
    coopLive.value = makeLive(null, meta(), ctx());
    expect(coopLive.value).not.toBeNull();
    clearCoop();
    expect(coopLive.value).toBeNull();
  });

  it('copies what the host said and turns seconds left into a time on this clock', () => {
    const live = makeLive(null, meta({ ready: ['a'], left: 12 }), ctx());
    expect(live.endsAt).toBe(22_000);
    expect(live.seats).toEqual(['a', 'b', 'c']);
    expect(secondsLeft(live, 10_000)).toBe(12);
    expect(secondsLeft(live, 21_001)).toBe(1);
    expect(secondsLeft(live, 40_000)).toBe(0);
    expect(secondsLeft(makeLive(null, meta(), ctx()), 10_000)).toBeNull();
  });

  it('keeps "since" while the stage is the same and starts it again on a new stage, week or walk phase', () => {
    const first = makeLive(null, meta(), ctx({ now: 1000 }));
    const again = makeLive(first, meta({ ready: ['a'] }), ctx({ now: 4000 }));
    expect(again.sinceAt).toBe(1000);
    expect(makeLive(again, meta({ stage: 'event' }), ctx({ now: 5000 })).sinceAt).toBe(5000);
    expect(makeLive(again, meta({ week: 2 }), ctx({ now: 6000 })).sinceAt).toBe(6000);
    const walk = makeLive(null, meta({ stage: 'walk' }), ctx({ now: 7000 }));
    expect(makeLive(walk, meta({ stage: 'walk', outside: true }), ctx({ now: 8000 })).sinceAt).toBe(8000);
  });
});

describe('who is waited for', () => {
  it('counts ready, votes, walk choices and returns by stage', () => {
    expect(answered(makeLive(null, meta({ ready: ['a', 'c'] }), ctx()))).toEqual(['a', 'c']);
    const vote = makeLive(null, meta({ stage: 'event', votes: { b: 'a', c: 'b' } }), ctx());
    expect(answered(vote)).toEqual(['b', 'c']);
    expect(votersOf(vote, 'a')).toEqual(['b']);
    expect(votersOf(vote, 'c')).toEqual([]);
    const choosing = makeLive(null, meta({ stage: 'walk', walk: { a: false, b: true } }), ctx());
    expect(answered(choosing)).toEqual(['a', 'b']);
    expect(waitingFor(choosing)).toEqual(['c']);
  });

  it('outside, only the walkers count, and a walker who is back has answered', () => {
    const live = makeLive(null, meta({ stage: 'walk', outside: true, walk: { a: false, b: true, c: true }, returned: ['b'] }), ctx());
    expect(participants(live)).toEqual(['b', 'c']);
    expect(answered(live)).toEqual(['b']);
    expect(waitingFor(live)).toEqual(['c']);
    expect(iAnswered(live)).toBe(true);
    expect(friendsOutside(live)).toBe(1);
    // A seat that stays counts the walkers outside; a walker does not count itself.
    expect(friendsOutside(makeLive(null, meta({ stage: 'walk', outside: true, walk: { a: true, b: false, c: true } }), ctx()))).toBe(2);
    expect(friendsOutside(makeLive(null, meta({ stage: 'walk', outside: true, walk: { a: true, b: true, c: true } }), ctx()))).toBe(2);
    expect(friendsOutside(makeLive(null, meta({ stage: 'plan' }), ctx()))).toBe(0);
  });
});

describe('"Go on"', () => {
  const waiting = (now: number, patch: Partial<CoopMeta> = {}, over: Partial<CoopContext> = {}): boolean => {
    const first = makeLive(null, meta({ ready: ['a'], ...patch }), ctx({ now: 0, me: 'a', ...over }));
    return canGoOn(first, now);
  };

  it('is for the commander only, after 5 seconds, while somebody is still to answer', () => {
    expect(waiting(GO_ON_MS - 1)).toBe(false);
    expect(waiting(GO_ON_MS)).toBe(true);
    expect(waiting(GO_ON_MS, { ready: ['a', 'b', 'c'] })).toBe(false);
    expect(waiting(GO_ON_MS, {}, { me: 'b' })).toBe(false);
  });

  it('waits until the commander has answered too, except on a walk the commander stays out of', () => {
    expect(waiting(GO_ON_MS, { ready: ['b'] })).toBe(false);
    expect(waiting(GO_ON_MS, { stage: 'walk', ready: [], outside: true, walk: { a: false, b: true, c: true }, returned: [] })).toBe(true);
  });
});

describe('the plan', () => {
  const plan = (ready: string[], acks: Record<string, number> = {}, patch: Partial<CoopMeta> = {}): CoopMeta => meta({ stage: 'plan', ready, acks, ...patch });

  it('says who changed a row when only one seat moved, and nobody when it cannot tell', () => {
    const before = makeLive(null, plan([], { a: 1, c: 1 }), ctx({ now: 1000 }));
    const changed = makeLive(before, plan([], { a: 1, c: 2 }), ctx({ now: 2000, alloc: { ...ALLOC, lab: 2 } }));
    expect(changed.flash).toEqual({ who: 'c', modules: ['lab'], at: 2000 });
    expect(flashing(changed, 3000)?.who).toBe('c');
    expect(flashing(changed, 2000 + CHANGE_SHOW_MS + 1)).toBeNull();
    const unclear = makeLive(before, plan([], { a: 2, c: 2 }), ctx({ now: 2000, alloc: { ...ALLOC, lab: 2 } }));
    expect(unclear.flash?.who).toBeNull();
    // A row this seat changed itself does not flash on its own screen.
    const mine = makeLive(before, plan([], { a: 1, b: 1, c: 1 }), ctx({ now: 2000, alloc: { ...ALLOC, lab: 2 } }));
    expect(mine.flash?.who).toBe('b');
    expect(flashing(mine, 2500)).toBeNull();
  });

  it('shows "plan changed" to a seat whose Ready was taken back by somebody else', () => {
    const before = makeLive(null, plan(['b'], { c: 1 }), ctx({ now: 1000 }));
    const after = makeLive(before, plan([], { c: 2 }), ctx({ now: 2000, alloc: { ...ALLOC, life: 3 } }));
    expect(after.cleared).toEqual({ who: 'c', at: 2000 });
    expect(planNote(after, 2500)).not.toBeNull();
    expect(planNote(after, 2000 + CHANGE_SHOW_MS + 1)).toBeNull();
    // The seat's own edit takes its own Ready back: no note.
    const own = makeLive(before, plan([], { b: 1, c: 1 }), ctx({ now: 2000, alloc: { ...ALLOC, life: 3 } }));
    expect(planNote(own, 2500)).toBeNull();
    // Nobody had its Ready in: no note.
    expect(makeLive(makeLive(null, plan(['a']), ctx()), plan([]), ctx({ alloc: { ...ALLOC, life: 3 } })).cleared).toBeNull();
  });

  it('keeps counting to the cap of 90 s after the first Ready, even when an edit clears the countdown', () => {
    const none = makeLive(null, plan([]), ctx({ now: 0 }));
    expect(none.capAt).toBeNull();
    const first = makeLive(none, plan(['a']), ctx({ now: 5000 }));
    expect(first.capAt).toBe(95_000);
    const cleared = makeLive(first, plan([]), ctx({ now: 40_000, alloc: { ...ALLOC, life: 3 } }));
    expect(cleared.endsAt).toBeNull();
    expect(cleared.capAt).toBe(95_000);
    expect(secondsLeft(cleared, 40_000)).toBe(55);
    // The host knows it exactly.
    expect(makeLive(first, plan(['a']), ctx({ now: 6000, capAt: 90_000 })).capAt).toBe(90_000);
    // Only the plan has a cap.
    expect(makeLive(null, meta({ ready: ['a'] }), ctx({ now: 0 })).capAt).toBeNull();
  });

  it('shows the nearer of the countdown and the cap', () => {
    const live = makeLive(null, plan(['a'], {}, { left: 30 }), ctx({ now: 0, capAt: 20_000 }));
    expect(secondsLeft(live, 0)).toBe(20);
    expect(secondsLeft(makeLive(null, plan(['a'], {}, { left: 10 }), ctx({ now: 0, capAt: 20_000 })), 0)).toBe(10);
  });
});

describe('a silent commander', () => {
  it('shows "waiting" from the guest quiet flag, never on the commander own screen', () => {
    expect(waitingForCommander(makeLive(null, meta(), ctx({ quiet: true })))).toBe(true);
    expect(waitingForCommander(makeLive(null, meta(), ctx({ quiet: true, me: 'a' })))).toBe(false);
    expect(waitingForCommander(makeLive(null, meta(), ctx({ quiet: false })))).toBe(false);
  });

  it('offers "play on alone" from 45 seconds, after the 15 seconds of "waiting"', () => {
    expect(QUIET_MS).toBe(15_000);
    expect(ALONE_MS).toBe(45_000);
    expect(canPlayAlone(ALONE_MS - 1)).toBe(false);
    expect(canPlayAlone(ALONE_MS)).toBe(true);
  });
});

describe('what the crew is doing', () => {
  it('has a phrase for every stage but the night and the end, in both languages', () => {
    const stages = ['briefing', 'event', 'eventResult', 'plan', 'walk', 'report'] as const;
    for (const stage of stages) {
      const key = doingKey(makeLive(null, meta({ stage }), ctx()));
      expect(key, stage).not.toBeNull();
      expect(crewEn[`crew.co.doing.${key}`], key ?? '').toBeTruthy();
      expect(crewRu[`crew.co.doing.${key}`], key ?? '').toBeTruthy();
    }
    expect(doingKey(makeLive(null, meta({ stage: 'walk', outside: true }), ctx()))).toBe('outside');
    expect(doingKey(makeLive(null, meta({ stage: 'end' }), ctx()))).toBeNull();
    expect(doingKey(makeLive(null, meta({ stage: 'night' }), ctx()))).toBeNull();
  });

  it('the co-op texts are plain: no gendered short words about the child', () => {
    for (const [key, text] of Object.entries(crewRu)) {
      if (!key.startsWith('crew.co.')) continue;
      expect(/(?:^|[\s«])(готов|должен|один|сам)(?=[\s.,!?»]|$)/u.test(text), `${key}: ${text}`).toBe(false);
    }
  });
});
