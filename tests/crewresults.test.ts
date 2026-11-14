/**
 * The debrief of a crew: a shared base shows one result and what each friend did; the race mode keeps its comparison.
 * No DOM here: the component tree is walked as plain data and its text is collected.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shims } from './harness';
import { DATA } from './bots';
import type { Contribution, CoopMeta } from '../src/sim/coop';
import type { RoomView } from '../src/net/room';

vi.mock('../src/game/director', () => ({ getWorld: () => null, goNextWeek() {}, startMission: async () => {}, coopDetach() {} }));
// The button uses hooks, which need a renderer: here it is only its label.
vi.mock('../src/ui/common', () => ({ Btn: (props: { children?: unknown }) => props.children }));
vi.mock('../src/game/audio', () => ({ audio: { play() {} } }));

shims();
const { CrewResults } = await import('../src/ui/CrewResults');
const { crewView } = await import('../src/net/crew');
const { coopLive, makeLive, contribRows } = await import('../src/net/coopview');
const store = await import('../src/game/store');
const { createMission } = await import('../src/sim/mission');
const { setLang } = await import('../src/i18n');
const { addDays } = await import('../src/sim/ephemeris');

type Node = { type: unknown; props: Record<string, unknown> } | string | number | boolean | null | undefined | Node[];

/** The text of a component tree: function components are called, elements are opened. */
function text(node: Node): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  const props = node.props ?? {};
  if (typeof node.type === 'function') return text((node.type as (p: unknown) => Node)(props));
  return text(props.children as Node);
}

const SEATS = ['seatAAAAA1', 'seatBBBBB2', 'seatCCCCC3', 'seatDDDDD4'];

function view(count: number): RoomView {
  return {
    phase: 'playing',
    code: 'ABCD',
    me: SEATS[1],
    hostId: SEATS[0],
    online: true,
    failure: null,
    start: null,
    versionOk: true,
    players: SEATS.slice(0, count).map((id, index) => ({
      id,
      name: index,
      suit: index,
      ready: true,
      host: index === 0,
      me: id === SEATS[1],
      here: true,
      status: null,
      finished: false,
    })),
  };
}

function meta(count: number, contrib?: Record<string, Contribution>): CoopMeta {
  return { stage: 'end', rev: 9, week: 6, seats: SEATS.slice(0, count), ready: [], votes: {}, walk: {}, outside: false, returned: [], left: null, acks: {}, choice: null, ...(contrib ? { contrib } : {}) };
}

const config = { site: 'mars', difficulty: 'commander', weeks: 6, startDate: addDays('2021-03-01', 9), seed: 1, tutorial: false, sunMode: 'random' } as const;

beforeEach(() => {
  setLang('en');
  coopLive.value = null;
  crewView.value = view(2);
  const m = createMission(config, DATA);
  m.end = 'complete';
  m.stars = 2;
  m.science = 41;
  store.mission.value = m;
});

describe('the debrief of a crew', () => {
  it('shows one result and every friend with their numbers, for 2, 3 and 4 players', () => {
    for (const count of [2, 3, 4]) {
      crewView.value = view(count);
      const contrib = Object.fromEntries(SEATS.slice(0, count).map((id, index) => [id, { samples: index + 3, finds: index, games: 1, prints: 2, votes: 5 + index }]));
      coopLive.value = makeLive(null, meta(count, contrib), { me: SEATS[1], hostId: SEATS[0], alloc: { life: 1, farm: 1, lab: 1, shield: 1 }, quiet: false, now: 0 });
      const out = text(CrewResults());
      expect(out).toContain('One crew, one result');
      expect(out).toContain('Mission complete');
      expect(out).toContain('41 science');
      expect(out).not.toContain('How the crews did');
      expect(out.match(/Samples: \d+/g)).toHaveLength(count);
      expect(out).toContain('Samples: 3');
      expect(out).toContain(`Votes: ${5 + count - 1}`);
      expect(out).toContain('you');
    }
  });

  it('shows zeros when the numbers are not known yet, and marks a friend who left', () => {
    crewView.value = view(3);
    const live = makeLive(null, meta(3), { me: SEATS[1], hostId: SEATS[0], alloc: { life: 1, farm: 1, lab: 1, shield: 1 }, quiet: false, now: 0 });
    live.seats = SEATS.slice(0, 2);
    live.contrib = { [SEATS[2]]: { samples: 4, finds: 1, games: 0, prints: 0, votes: 2 } };
    coopLive.value = live;
    const out = text(CrewResults());
    expect(out.match(/Samples: \d+/g)).toHaveLength(3);
    expect(out).toContain('Samples: 4');
    expect(out).toContain('Left early');
  });

  it('is in Russian too, with the same numbers', () => {
    setLang('ru');
    crewView.value = view(2);
    coopLive.value = makeLive(null, meta(2, { [SEATS[0]]: { samples: 7, finds: 0, games: 0, prints: 0, votes: 1 } }), { me: SEATS[1], hostId: SEATS[0], alloc: { life: 1, farm: 1, lab: 1, shield: 1 }, quiet: false, now: 0 });
    const out = text(CrewResults());
    expect(out).toContain('Общий результат экипажа');
    expect(out).toContain('Образцы: 7');
    expect(out).not.toContain('crew.co.');
  });

  it('keeps the race comparison when no shared base runs', () => {
    crewView.value = view(3);
    const out = text(CrewResults());
    expect(out).toContain('How the crews did');
    expect(out).not.toContain('One crew, one result');
  });

  it('draws nothing alone', () => {
    crewView.value = { ...view(1), phase: 'idle' };
    expect(CrewResults()).toBeNull();
  });

  it('orders the rows by the room and puts friends who left last', () => {
    const live = makeLive(null, meta(3, { [SEATS[3]]: { samples: 1, finds: 0, games: 0, prints: 0, votes: 0 } }), { me: SEATS[0], hostId: SEATS[0], alloc: { life: 1, farm: 1, lab: 1, shield: 1 }, quiet: false, now: 0 });
    const rows = contribRows(live, [SEATS[2], SEATS[0], SEATS[1]]);
    expect(rows.map((row) => row.id)).toEqual([SEATS[2], SEATS[0], SEATS[1], SEATS[3]]);
    expect(rows.map((row) => row.left)).toEqual([false, false, false, true]);
  });

  it('keeps the last known numbers when a later snapshot carries none', () => {
    const first = makeLive(null, meta(2, { [SEATS[0]]: { samples: 2, finds: 0, games: 0, prints: 0, votes: 0 } }), { me: SEATS[1], hostId: SEATS[0], alloc: { life: 1, farm: 1, lab: 1, shield: 1 }, quiet: false, now: 0 });
    const next = makeLive(first, meta(2), { me: SEATS[1], hostId: SEATS[0], alloc: { life: 1, farm: 1, lab: 1, shield: 1 }, quiet: true, now: 1 });
    expect(next.contrib[SEATS[0]].samples).toBe(2);
  });
});
