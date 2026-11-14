/**
 * Crew mode: the message rules, the room, and the promise that friends fly the very same mission.
 * Rooms run on the in-memory network, with fake timers.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crewEn, crewRu } from '../src/i18n/crew';
import { netConfig, transportKind } from '../src/net/config';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  CREW_NAME_COUNT,
  CREW_SUITS,
  MAX_MESSAGE_SIZE,
  REACTIONS,
  awards,
  channelName,
  freeName,
  highlightOf,
  newPlayerId,
  normalizeCode,
  parseMessage,
  parseMeta,
  parseStart,
  randomCode,
  startDateOf,
  statusOf,
} from '../src/net/protocol';
import type { CrewChoice, Status } from '../src/net/protocol';
import { CrewRoom } from '../src/net/room';
import type { Player, RoomView } from '../src/net/room';
import { MemoryHub, MemoryTransport } from '../src/net/transport';
import { createMission } from '../src/sim/mission';
import type { MissionConfig } from '../src/sim/types';
import { DATA, BOTS, play } from './bots';
import { Handmade } from './handmade';

// ----- Helpers -------------------------------------------------------------------

const tick = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

const CHOICE: CrewChoice = { site: 'mars', difficulty: 'cadet', weeks: 6, windowId: 'may2024' };
const START_DATE = startDateOf('may2024')!;

function status(over: Partial<Status> = {}): Status {
  return {
    week: 2,
    step: 'plan',
    air: 90,
    food: 5.5,
    dose: 12.3,
    doseLimit: 100,
    science: 20,
    stars: 0,
    end: null,
    storm: { w: 0, s: 0, k: false, a: 0 },
    ...over,
  };
}

let counter = 0;
function client(hub: MemoryHub, wish = 0) {
  counter++;
  const id = `player${String(counter).padStart(2, '0')}`;
  const starts: unknown[] = [];
  const reactions: { player: Player; reaction: string }[] = [];
  const room = new CrewRoom(() => new MemoryTransport(hub), {
    me: { id, name: wish, suit: counter % CREW_SUITS.length },
    joinGraceMs: 50,
    createGraceMs: 50,
    hostGoneMs: 1000,
  });
  room.onStart = (start) => starts.push(start);
  room.onReaction = (player, reaction) => reactions.push({ player, reaction });
  const views: RoomView[] = [];
  room.subscribe((view) => views.push(view));
  return { id, room, starts, reactions, views };
}
type Client = ReturnType<typeof client>;

/** Host makes a room and `n` guests join it. Everybody presses Ready. */
async function lobby(hub: MemoryHub, guests: number): Promise<{ host: Client; guests: Client[]; code: string }> {
  const host = client(hub, 0);
  const made = host.room.create();
  await tick(100);
  expect(await made).toBe(true);
  const code = host.room.view.code;
  const list: Client[] = [];
  for (let i = 0; i < guests; i++) {
    const guest = client(hub, 0);
    const joined = guest.room.join(code);
    await tick(100);
    expect(await joined).toBe(true);
    guest.room.setReady(true);
    list.push(guest);
  }
  await tick(10);
  return { host, guests: list, code };
}

/** A pretend friend that sends anything it likes into a room (for malformed-message tests). */
async function intruder(hub: MemoryHub, code: string, id = 'intruder01') {
  const transport = new MemoryTransport(hub);
  await transport.connect(channelName(code), id, { id, n: 0, c: 0, r: false, h: false, s: false, t: Date.now(), v: 1 }, { presence() {}, message() {}, status() {} });
  return transport;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

// ----- Codes, names, texts -------------------------------------------------------------

describe('room codes', () => {
  it('have 6 characters from an alphabet without look-alikes', () => {
    expect(CODE_ALPHABET.length).toBe(31);
    for (const bad of ['I', 'L', 'O', '0', '1']) expect(CODE_ALPHABET).not.toContain(bad);
    for (let i = 0; i < 200; i++) {
      const code = randomCode();
      expect(code).toHaveLength(CODE_LENGTH);
      for (const letter of code) expect(CODE_ALPHABET).toContain(letter);
    }
  });

  it('are read forgivingly, and refused when they cannot be a code', () => {
    expect(normalizeCode('k7m 2qx')).toBe('K7M2QX');
    expect(normalizeCode('k7m-2qx')).toBe('K7M2QX');
    expect(normalizeCode('K7M2Q')).toBeNull();
    expect(normalizeCode('K7M2QXX')).toBeNull();
    expect(normalizeCode('K7M2O1')).toBeNull();
    expect(normalizeCode('')).toBeNull();
  });

  it('player ids are new each time and pass the id check', () => {
    const a = newPlayerId();
    expect(a).toMatch(/^[a-z0-9]{10}$/);
    expect(newPlayerId()).not.toBe(a);
  });
});

describe('texts', () => {
  it('English and Russian have exactly the same keys, all under crew.', () => {
    expect(Object.keys(crewRu).sort()).toEqual(Object.keys(crewEn).sort());
    for (const key of Object.keys(crewEn)) expect(key.startsWith('crew.')).toBe(true);
    for (const value of [...Object.values(crewEn), ...Object.values(crewRu)]) expect(value.trim().length).toBeGreaterThan(0);
  });

  it('every crew name and sticker has a text in both languages', () => {
    for (let i = 0; i < CREW_NAME_COUNT; i++) {
      expect(crewEn[`crew.name.${i}`]).toBeTruthy();
      expect(crewRu[`crew.name.${i}`]).toBeTruthy();
    }
    expect(crewEn[`crew.name.${CREW_NAME_COUNT}`]).toBeUndefined();
    for (const id of REACTIONS) {
      expect(crewEn[`crew.r.${id}`]).toBeTruthy();
      expect(crewRu[`crew.r.${id}`]).toBeTruthy();
    }
    expect(REACTIONS.length).toBeGreaterThanOrEqual(6);
    expect(REACTIONS.length).toBeLessThanOrEqual(8);
  });

  it('the same placeholders appear in both languages', () => {
    const holes = (text: string): string[] => [...text.matchAll(/\{(\w+)/g)].map((match) => match[1]).sort();
    for (const key of Object.keys(crewEn)) expect(holes(crewRu[key]), key).toEqual(holes(crewEn[key]));
  });

  it('the suit list is the game suit list', () => {
    const source = readFileSync('src/world/astronaut.ts', 'utf8');
    const listed = /SUIT_COLORS = \[([^\]]+)\]/.exec(source)![1].match(/#[0-9a-f]{6}/gi);
    expect(listed).toEqual([...CREW_SUITS]);
  });
});

describe('settings', () => {
  it('an empty address or key switches crew mode off; defaults are on', () => {
    expect(netConfig({})).not.toBeNull();
    expect(netConfig({ VITE_MP_URL: '' })).toBeNull();
    expect(netConfig({ VITE_MP_KEY: '' })).toBeNull();
    expect(netConfig({ VITE_MP_URL: 'wss://x.example/realtime/v1', VITE_MP_KEY: 'k' })).toEqual({ url: 'wss://x.example/realtime/v1', key: 'k' });
  });

  it('?crew=local turns the two-tab mode on', () => {
    expect(transportKind('?crew=local')).toBe('local');
    expect(transportKind('?a=1&crew=local')).toBe('local');
    expect(transportKind('?crew=locale')).not.toBe('local');
  });

  it('the default address is the project one and the CSP allows it', () => {
    const config = netConfig({})!;
    expect(config.url).toBe('wss://wvhdhfddtusppjmsgmvn.supabase.co/realtime/v1');
    expect(config.key.startsWith('sb_publishable_')).toBe(true);
    const csp = JSON.parse(readFileSync('vercel.json', 'utf8')).headers[0].headers[0].value as string;
    expect(csp).toContain('https://wvhdhfddtusppjmsgmvn.supabase.co');
    expect(csp).toContain('wss://wvhdhfddtusppjmsgmvn.supabase.co');
  });
});

// ----- Checking messages ---------------------------------------------------------------

const FROM = 'player99aa';
const goodStatus = (over: Record<string, unknown> = {}) => ({ from: FROM, ...status(), ...over });

describe('message validation', () => {
  it('accepts a good status and rebuilds it (no extra fields)', () => {
    const message = parseMessage('status', { ...goodStatus(), evil: '<script>alert(1)</script>' });
    expect(message).not.toBeNull();
    expect(message).toEqual({ event: 'status', from: FROM, status: status() });
    expect(JSON.stringify(message)).not.toContain('script');
  });

  it('refuses unknown events, non-objects and a missing sender', () => {
    expect(parseMessage('chat', { from: FROM, text: 'hi' })).toBeNull();
    expect(parseMessage('status', null)).toBeNull();
    expect(parseMessage('status', 'x')).toBeNull();
    expect(parseMessage('status', [1, 2])).toBeNull();
    expect(parseMessage('status', { ...status() })).toBeNull();
    expect(parseMessage('status', goodStatus({ from: 'Hi there!' }))).toBeNull();
    expect(parseMessage('status', goodStatus({ from: 42 }))).toBeNull();
  });

  it('refuses numbers that are not numbers or out of range', () => {
    for (const bad of [
      { air: NaN },
      { air: Infinity },
      { air: '90' },
      { air: 101 },
      { air: -1 },
      { week: 2.5 },
      { week: 0 },
      { week: 100 },
      { stars: 4 },
      { science: 1e9 },
      { step: 'hack' },
      { step: 7 },
      { end: 'lava' },
      { end: undefined },
      { storm: null },
      { storm: { w: 0, s: 9, k: false, a: 0 } },
      { storm: { w: 0, s: 0, k: 'yes', a: 0 } },
    ]) {
      expect(parseMessage('status', goodStatus(bad)), JSON.stringify(bad)).toBeNull();
    }
  });

  it('refuses oversized messages', () => {
    const padded = goodStatus({ note: 'x'.repeat(MAX_MESSAGE_SIZE) });
    expect(parseMessage('status', padded)).toBeNull();
    expect(parseMessage('react', { from: FROM, id: 'great', pad: 'y'.repeat(MAX_MESSAGE_SIZE) })).toBeNull();
  });

  it('a sticker must be one of the preset ids', () => {
    for (const id of REACTIONS) expect(parseMessage('react', { from: FROM, id })).toEqual({ event: 'react', from: FROM, reaction: id });
    for (const bad of ['hello', '', '<b>x</b>', 3, null, { id: 'great' }, 'GREAT']) expect(parseMessage('react', { from: FROM, id: bad })).toBeNull();
  });

  it('a mission to start must be a real one: known world, level, length and window, and the date that window gives', () => {
    const start = { choice: CHOICE, seed: 12345, startDate: START_DATE };
    expect(parseStart(start)).toEqual(start);
    const bad: Record<string, unknown>[] = [
      { seed: 1.5 },
      { seed: -1 },
      { seed: 2 ** 31 },
      { seed: '5' },
      { startDate: '2024-05-11' },
      { startDate: 'tomorrow' },
      { choice: { ...CHOICE, site: 'venus' } },
      { choice: { ...CHOICE, difficulty: 'god' } },
      { choice: { ...CHOICE, weeks: 7 } },
      { choice: { ...CHOICE, weeks: 1e6 } },
      { choice: { ...CHOICE, windowId: 'nope' } },
      // the 2018 dust-storm window exists only on Mars
      { choice: { ...CHOICE, site: 'moon', windowId: 'dust2018' }, startDate: startDateOf('dust2018') },
      { choice: null },
    ];
    for (const patch of bad) expect(parseStart({ ...start, ...patch }), JSON.stringify(patch)).toBeNull();
  });

  it('the choice that comes out can never be creative mode or a live-data mission', () => {
    const start = parseStart({ choice: { ...CHOICE, creative: true, sunMode: 'live', tutorial: true }, seed: 1, startDate: START_DATE });
    expect(start).not.toBeNull();
    expect(Object.keys(start!.choice).sort()).toEqual(['difficulty', 'site', 'weeks', 'windowId']);
  });

  it('the start is not a message any more: it only exists inside the host presence', () => {
    expect(parseMessage('start', { from: FROM, choice: CHOICE, seed: 1, startDate: START_DATE })).toBeNull();
  });

  it('presence must say who it is, with numbers only', () => {
    const meta = { id: 'abc123def4', n: 3, c: 2, r: true, h: false, s: false, t: 1, v: 1 };
    expect(parseMeta(meta)).toEqual({ ...meta, m: [], p: null, k: '', mk: [], g: '' });
    const mission = { choice: CHOICE, seed: 5, startDate: START_DATE };
    const host = { ...meta, h: true, s: true, m: ['abc123def4', 'player01aa'], p: mission };
    expect(parseMeta(host)).toEqual({ ...host, k: '', mk: [], g: '' });
    const badPatches: Record<string, unknown>[] = [
      { p: { ...mission, seed: 1.5 } },
      { p: 'go' },
      { m: 'abc123def4' },
      { m: ['Bob'] },
      { m: ['aaaaaa01', 'aaaaaa02', 'aaaaaa03', 'aaaaaa04', 'aaaaaa05'] },
      { n: 16 },
      { n: -1 },
      { n: 'Cadet Comet' },
      { c: 6 },
      { r: 'yes' },
      { id: 'Bob' },
      { id: 'a b c d e f' },
      { t: 'now' },
    ];
    for (const patch of badPatches) expect(parseMeta({ ...meta, ...patch }), JSON.stringify(patch)).toBeNull();
  });

  it('position messages are checked too', () => {
    expect(parseMessage('pos', { from: FROM, x: 1.5, z: -3, a: 0.2, m: 1 })).not.toBeNull();
    expect(parseMessage('pos', { from: FROM, x: 1e6, z: 0, a: 0, m: 0 })).toBeNull();
    expect(parseMessage('pos', { from: FROM, x: 'a', z: 0, a: 0, m: 0 })).toBeNull();
  });
});

describe('small helpers', () => {
  it('a free crew name is found even when the wish is taken', () => {
    expect(freeName([], 3)).toBe(3);
    expect(freeName([3], 3)).toBe(4);
    expect(freeName([15, 0], 15)).toBe(1);
    expect(freeName(Array.from({ length: CREW_NAME_COUNT }, (_, i) => i), 2)).toBe(2);
  });

  it('highlights, prizes', () => {
    expect(highlightOf(status())).toEqual({ key: 'crew.line.calm', week: 0 });
    expect(highlightOf(status({ storm: { w: 4, s: 2, k: true, a: 3 } }))).toEqual({ key: 'crew.line.shelter', week: 4 });
    expect(highlightOf(status({ storm: { w: 4, s: 2, k: false, a: 3 } }))).toEqual({ key: 'crew.line.shield', week: 4 });
    expect(highlightOf(status({ storm: { w: 4, s: 3, k: false, a: 0 } }))).toEqual({ key: 'crew.line.storm', week: 4 });
    const prizes = awards([
      { id: 'a', status: status({ end: 'complete', dose: 50, science: 10, stars: 1 }) },
      { id: 'b', status: status({ end: 'complete', dose: 20, science: 30, stars: 3 }) },
      { id: 'c', status: status({ end: 'air', dose: 1, science: 5, stars: 0 }) },
    ]);
    expect(prizes).toEqual({ safest: 'b', science: 'b', stars: 'b' });
    expect(awards([{ id: 'c', status: status({ end: 'air', stars: 0 }) }]).safest).toBeNull();
  });
});

// ----- Same mission for everybody ----------------------------------------------------------

describe('the same seed gives the same mission', () => {
  const config = (over: Partial<MissionConfig> = {}): MissionConfig => ({
    site: 'mars',
    difficulty: 'cadet',
    weeks: 6,
    startDate: START_DATE,
    seed: 424242,
    tutorial: false,
    sunMode: 'featured',
    windowId: 'may2024',
    creative: false,
    ...over,
  });

  it('two missions made from one config are identical, week by week', () => {
    const a = createMission(config(), DATA);
    const b = createMission(config(), DATA);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(b.plan.map((week) => [week.week, week.sunlight, week.storm.strength, week.reason, week.dateFrom])).toEqual(
      a.plan.map((week) => [week.week, week.sunlight, week.storm.strength, week.reason, week.dateFrom]),
    );
    expect(a.now.eventId).toBe(b.now.eventId);
  });

  it('the plan comes from real dates: the same start date means the same sun, whatever the seed', () => {
    const a = createMission(config({ seed: 1 }), DATA);
    const b = createMission(config({ seed: 999 }), DATA);
    expect(b.plan.map((week) => week.sun)).toEqual(a.plan.map((week) => week.sun));
    expect(b.plan.map((week) => week.storm.strength)).toEqual(a.plan.map((week) => week.storm.strength));
  });

  it.each(['mars', 'moon'] as const)('and so do whole missions played by the same player (%s)', (site) => {
    for (const bot of BOTS) {
      const cfg = config({ site, seed: 77 });
      const one = play({ ...cfg }, bot);
      const two = play({ ...cfg }, bot);
      expect(JSON.stringify(two.history), bot.name).toBe(JSON.stringify(one.history));
      expect(two.science).toBe(one.science);
      expect(two.end).toBe(one.end);
      expect(statusOf(two, 'report')).toEqual(statusOf(one, 'report'));
    }
  });

  it('a different seed changes the cards (so the seed really is shared state)', () => {
    const cards = (seed: number): string => JSON.stringify(play(config({ seed }), BOTS[0]).history.map((week) => week.eventId));
    expect(new Set([1, 2, 3, 4, 5, 6].map(cards)).size).toBeGreaterThan(1);
  });

  it('statusOf only carries numbers, and the strongest storm so far', () => {
    const done = play(config({ seed: 5 }), BOTS[0]);
    const s = statusOf(done, 'report');
    for (const value of Object.values(s)) expect(['number', 'string', 'object']).toContain(typeof value);
    expect(parseMessage('status', { from: FROM, ...s })).not.toBeNull();
    const stormy = done.plan.filter((week) => week.storm.strength > 0).length;
    expect(s.storm.s > 0).toBe(stormy > 0 && done.history.some((record) => (done.plan[record.week - 1]?.storm.strength ?? 0) > 0));
  });
});

// ----- The room ---------------------------------------------------------------------------

describe('making and joining a room', () => {
  it('a host makes a room; friends join with the code and see each other', async () => {
    const hub = new MemoryHub();
    const { host, guests, code } = await lobby(hub, 2);
    expect(code).toHaveLength(CODE_LENGTH);
    for (const c of [host, ...guests]) {
      expect(c.room.view.phase).toBe('lobby');
      expect(c.room.view.players).toHaveLength(3);
      expect(c.room.view.hostId).toBe(host.id);
    }
    expect(host.room.view.players[0].host).toBe(true);
    expect(guests[0].room.view.players.find((p) => p.me)!.id).toBe(guests[0].id);
  });

  it('crew names are never the same inside a room, even if everyone wishes for the same one', async () => {
    const hub = new MemoryHub();
    const { host, guests } = await lobby(hub, 3);
    await tick(100);
    const names = host.room.view.players.map((p) => p.name);
    expect(new Set(names).size).toBe(4);
    for (const c of guests) expect(c.room.view.players.map((p) => p.name).sort()).toEqual([...names].sort());
  });

  it('the lobby shows who is ready', async () => {
    const hub = new MemoryHub();
    const { host, guests } = await lobby(hub, 1);
    expect(host.room.view.players.find((p) => p.id === guests[0].id)!.ready).toBe(true);
    guests[0].room.setReady(false);
    await tick(10);
    expect(host.room.view.players.find((p) => p.id === guests[0].id)!.ready).toBe(false);
  });

  it('a code nobody made says "no room"', async () => {
    const hub = new MemoryHub();
    const guest = client(hub);
    const joined = guest.room.join('ABCDEF');
    await tick(100);
    expect(await joined).toBe(false);
    expect(guest.room.view.phase).toBe('failed');
    expect(guest.room.view.failure).toBe('noRoom');
  });

  it('a bad code says so at once, without touching the network', async () => {
    const hub = new MemoryHub();
    const guest = client(hub);
    expect(await guest.room.join('abc')).toBe(false);
    expect(guest.room.view.failure).toBe('badCode');
    expect(hub.log).toHaveLength(0);
  });

  it('a room holds 4 players; the fifth is told it is full and leaves', async () => {
    const hub = new MemoryHub();
    const { host, guests, code } = await lobby(hub, 3);
    const fifth = client(hub);
    const joined = fifth.room.join(code);
    await tick(100);
    expect(await joined).toBe(false);
    expect(fifth.room.view.failure).toBe('full');
    await tick(100);
    expect(host.room.view.players).toHaveLength(4);
    expect(hub.members(channelName(code))).toHaveLength(4);
    for (const c of guests) expect(c.room.view.phase).toBe('lobby');
  });

  it('five players who arrive at the very same moment: only four stay', async () => {
    const hub = new MemoryHub();
    const { code } = await lobby(hub, 2);
    const late = [client(hub), client(hub), client(hub)];
    const results = late.map((c) => c.room.join(code));
    await tick(100);
    const done = await Promise.all(results);
    expect(done.filter(Boolean)).toHaveLength(1);
    await tick(100);
    expect(hub.members(channelName(code))).toHaveLength(4);
  });

  it('nobody can join after the mission started', async () => {
    const hub = new MemoryHub();
    const { host, code } = await lobby(hub, 1);
    expect(host.room.start(CHOICE, 7, START_DATE)).toBe(true);
    await tick(10);
    const late = client(hub);
    const joined = late.room.join(code);
    await tick(100);
    expect(await joined).toBe(false);
    expect(late.room.view.failure).toBe('started');
  });

  it('no network: the room says "offline" and nothing else happens', async () => {
    const hub = new MemoryHub();
    hub.down = true;
    const host = client(hub);
    const made = host.room.create();
    await tick(100);
    expect(await made).toBe(false);
    expect(host.room.view.phase).toBe('failed');
    expect(host.room.view.failure).toBe('offline');
    host.room.leave();
    expect(host.room.view.phase).toBe('idle');
  });
});

describe('starting the mission', () => {
  it('the host starts it, and every friend gets the very same seed and date', async () => {
    const hub = new MemoryHub();
    const { host, guests } = await lobby(hub, 2);
    expect(host.room.canStart()).toBe(true);
    expect(host.room.start(CHOICE, 987654, START_DATE)).toBe(true);
    await tick(10);
    const expected = { choice: CHOICE, seed: 987654, startDate: START_DATE };
    expect(host.starts).toEqual([expected]);
    for (const guest of guests) {
      expect(guest.starts).toEqual([expected]);
      expect(guest.room.view.phase).toBe('playing');
    }
    expect(host.room.view.phase).toBe('playing');
  });

  it('the host cannot start alone, or before everybody is ready', async () => {
    const hub = new MemoryHub();
    const host = client(hub);
    const made = host.room.create();
    await tick(100);
    await made;
    expect(host.room.canStart()).toBe(false);
    expect(host.room.start(CHOICE, 1, START_DATE)).toBe(false);
    const guest = client(hub);
    const joined = guest.room.join(host.room.view.code);
    await tick(100);
    await joined;
    await tick(10);
    expect(host.room.canStart()).toBe(false); // the friend is not ready
    guest.room.setReady(true);
    await tick(10);
    expect(host.room.canStart()).toBe(true);
  });

  it('a guest cannot start; a wrong mission cannot be started', async () => {
    const hub = new MemoryHub();
    const { host, guests } = await lobby(hub, 1);
    expect(guests[0].room.start(CHOICE, 1, START_DATE)).toBe(false);
    expect(host.room.start({ ...CHOICE, weeks: 7 }, 1, START_DATE)).toBe(false);
    expect(host.room.start(CHOICE, 1.5, START_DATE)).toBe(false);
    expect(host.room.start(CHOICE, 1, '2020-01-01')).toBe(false);
    expect(host.room.view.phase).toBe('lobby');
    expect(hub.log.filter((entry) => entry.event === 'start')).toHaveLength(0);
  });

  it('the start travels in the host presence, not in a message', async () => {
    const hub = new MemoryHub();
    const { host, guests, code } = await lobby(hub, 1);
    host.room.start(CHOICE, 5, START_DATE);
    await tick(10);
    expect(hub.log.filter((entry) => entry.event === 'start')).toHaveLength(0);
    const hostMeta = hub.members(channelName(code)).find((m) => m.key === host.id)!.meta as { s: boolean; p: { seed: number } };
    expect(hostMeta.s).toBe(true);
    expect(hostMeta.p.seed).toBe(5);
    expect(guests[0].starts).toHaveLength(1);
  });

  it('a friend who was busy when the host started still learns of it (it is a fact, not an event)', async () => {
    const hub = new MemoryHub();
    const { host, guests } = await lobby(hub, 2);
    // The first friend does not hear anything for a while.
    const slow = hub.members(channelName(host.room.view.code)).find((m) => m.key === guests[0].id)!;
    const heard = slow.handlers.presence;
    slow.handlers.presence = () => undefined;
    host.room.start(CHOICE, 5, START_DATE);
    await tick(2000);
    expect(guests[0].starts).toHaveLength(0);
    expect(guests[1].starts).toHaveLength(1);
    slow.handlers.presence = heard;
    hub.syncPresence(channelName(host.room.view.code));
    await tick(10);
    expect(guests[0].starts).toHaveLength(1);
    expect(guests[0].room.view.phase).toBe('playing');
  });

  it('a hacked guest cannot start the mission: its own presence says "started", nobody listens', async () => {
    const hub = new MemoryHub();
    const { host, guests, code } = await lobby(hub, 2);
    const forger = guests[0];
    const mission = { choice: CHOICE, seed: 666, startDate: START_DATE };
    const rogue = hub.members(channelName(code)).find((m) => m.key === forger.id)!;
    rogue.transport.track({ ...(rogue.meta as object), s: true, p: mission, h: false });
    await tick(10);
    expect(guests[1].starts).toHaveLength(0);
    expect(guests[1].room.view.phase).toBe('lobby');
    expect(host.room.view.phase).toBe('lobby');
    // The real start comes once and only the host's numbers count.
    host.room.start(CHOICE, 111, START_DATE);
    await tick(10);
    expect((guests[1].starts[0] as { seed: number }).seed).toBe(111);
    expect(guests[1].starts).toHaveLength(1);
  });
});

describe('who is the host, and who has a seat', () => {
  it('a second player who claims to be the host is not trusted: a joiner who sees two hosts is refused', async () => {
    const hub = new MemoryHub();
    const host = client(hub);
    const made = host.room.create();
    await tick(100);
    await made;
    const code = host.room.view.code;
    const fake = new MemoryTransport(hub);
    await fake.connect(channelName(code), 'fakehost01', { id: 'fakehost01', n: 1, c: 1, r: true, h: true, m: ['fakehost01'], s: false, t: 0, v: 1 }, { presence() {}, message() {}, status() {} });
    const guest = client(hub);
    const joined = guest.room.join(code);
    await tick(200);
    expect(await joined).toBe(false);
    expect(guest.room.view.failure).toBe('noRoom');
  });

  it('a fake host who comes after the lobby formed cannot start the mission for the guests', async () => {
    const hub = new MemoryHub();
    const { host, guests, code } = await lobby(hub, 2);
    const fake = new MemoryTransport(hub);
    const mission = { choice: CHOICE, seed: 4242, startDate: START_DATE };
    await fake.connect(channelName(code), 'fakehost01', { id: 'fakehost01', n: 1, c: 1, r: true, h: true, m: ['fakehost01', guests[0].id], s: true, p: mission, t: 0, v: 1 }, { presence() {}, message() {}, status() {} });
    await tick(10);
    for (const guest of guests) {
      expect(guest.room.view.phase).toBe('lobby');
      expect(guest.room.view.hostId).toBe(host.id);
      expect(guest.starts).toHaveLength(0);
      expect(guest.room.view.players).toHaveLength(3);
    }
  });

  it('nobody can speak under the host id: two entries under one key are believed for neither', async () => {
    const hub = new MemoryHub();
    const { host, guests, code } = await lobby(hub, 2);
    const mission = { choice: CHOICE, seed: 4242, startDate: START_DATE };
    // The attacker joins with the very same presence key as the host (the network lets a client pick its key).
    const hostMeta = hub.members(channelName(code)).find((m) => m.key === host.id)!.meta as object;
    const fake = new MemoryTransport(hub);
    await fake.connect(channelName(code), host.id, { ...hostMeta, s: true, p: mission }, { presence() {}, message() {}, status() {} });
    await tick(10);
    for (const guest of guests) expect(guest.starts).toHaveLength(0);
    // A joiner who comes now finds no trustworthy host.
    const late = client(hub);
    const joined = late.room.join(code);
    await tick(200);
    expect(await joined).toBe(false);
    expect(late.room.view.failure).toBe('noRoom');
    // The guests do not start; their lobby closes after the usual wait, because the host cannot be told from the fake.
    await tick(5000);
    for (const guest of guests) {
      expect(guest.starts).toHaveLength(0);
      expect(guest.room.view.phase).not.toBe('playing');
    }
  });

  it('a friend the host started without is told "already started", not left waiting', async () => {
    const hub = new MemoryHub();
    const { host, guests, code } = await lobby(hub, 2);
    const channel = channelName(code);
    // The second friend drops out of sight for a moment: the host takes the seat back.
    const member = hub.members(channel).find((m) => m.key === guests[1].id)!;
    hub.leave(channel, member.transport);
    await tick(10);
    expect(host.room.view.players).toHaveLength(2);
    expect(host.room.start(CHOICE, 8, START_DATE)).toBe(true);
    await tick(10);
    // ... and comes back after the start.
    hub.join(channel, member);
    await tick(10);
    expect(guests[1].room.view.phase).toBe('failed');
    expect(guests[1].room.view.failure).toBe('started');
    expect(guests[1].starts).toHaveLength(0);
    expect(guests[0].starts).toHaveLength(1);
  });

  it('a joiner who is still waiting for a seat when the host starts is told "already started"', async () => {
    const hub = new MemoryHub();
    const { host, code } = await lobby(hub, 1);
    const channel = channelName(code);
    const hostMember = hub.members(channel).find((m) => m.key === host.id)!;
    const hear = hostMember.handlers.presence;
    hostMember.handlers.presence = () => undefined; // the host does not see the newcomer
    const late = client(hub);
    const joined = late.room.join(code);
    await tick(100);
    expect(host.room.start(CHOICE, 8, START_DATE)).toBe(true);
    hostMember.handlers.presence = hear;
    hub.syncPresence(channel);
    await tick(200);
    expect(await joined).toBe(false);
    expect(late.room.view.failure).toBe('started');
  });

  it('a stranger who sets the "started" flag cannot lock friends out', async () => {
    const hub = new MemoryHub();
    const { code } = await lobby(hub, 1);
    const stranger = new MemoryTransport(hub);
    await stranger.connect(channelName(code), 'stranger02', { id: 'stranger02', n: 1, c: 1, r: false, h: false, m: [], s: true, t: 0, v: 1 }, { presence() {}, message() {}, status() {} });
    const friend = client(hub);
    const joined = friend.room.join(code);
    await tick(200);
    expect(await joined).toBe(true);
  });

  it('only the host gives out seats: a fifth player who claims an early arrival time still gets none', async () => {
    const hub = new MemoryHub();
    const { host, guests, code } = await lobby(hub, 3);
    const rogue = new MemoryTransport(hub);
    await rogue.connect(channelName(code), 'rogue00002', { id: 'rogue00002', n: 3, c: 0, r: true, h: false, m: [], s: false, t: 0, v: 1 }, { presence() {}, message() {}, status() {} });
    await tick(100);
    expect(host.room.view.players).toHaveLength(4);
    expect(host.room.view.players.map((p) => p.id)).not.toContain('rogue00002');
    for (const guest of guests) expect(guest.room.view.players.map((p) => p.id)).not.toContain('rogue00002');
    expect(host.room.canStart()).toBe(true);
    host.room.start(CHOICE, 9, START_DATE);
    await tick(10);
    // nothing the stranger says counts
    rogue.send('status', { from: 'rogue00002', ...status({ week: 3 }) });
    rogue.send('react', { from: 'rogue00002', id: 'wow' });
    rogue.send('final', { from: 'rogue00002', ...status({ stars: 3, end: 'complete' }) });
    await tick(10);
    expect(host.room.view.players).toHaveLength(4);
    expect(host.reactions).toHaveLength(0);
    for (const guest of guests) expect(guest.room.view.players).toHaveLength(4);
  });

  it('a seat that is freed goes to the next friend who joins', async () => {
    const hub = new MemoryHub();
    const { host, guests, code } = await lobby(hub, 3);
    const late = client(hub);
    const refused = late.room.join(code);
    await tick(7000);
    expect(await refused).toBe(false);
    expect(late.room.view.failure).toBe('full');
    guests[0].room.leave();
    await tick(10);
    const next = client(hub);
    const joined = next.room.join(code);
    await tick(200);
    expect(await joined).toBe(true);
    expect(host.room.view.players).toHaveLength(4);
    expect(next.room.view.players).toHaveLength(4);
  });

  it('coming back after a lost connection does not get around the sending limit', async () => {
    const hub = new MemoryHub();
    const { host } = await lobby(hub, 1);
    host.room.start(CHOICE, 3, START_DATE);
    await tick(10);
    host.room.sendStatus(status({ week: 3 }));
    await tick(700);
    const mine = hub.members(channelName(host.room.view.code)).find((m) => m.key === host.id)!;
    const before = hub.log.filter((entry) => entry.event === 'status').length;
    for (let i = 0; i < 20; i++) {
      mine.handlers.status('online');
      await tick(20);
    }
    await tick(600);
    expect(hub.log.filter((entry) => entry.event === 'status').length - before).toBeLessThanOrEqual(2);
  });
});

describe('numbers and stickers in the game', () => {
  async function playing(count = 1) {
    const hub = new MemoryHub();
    const set = await lobby(hub, count);
    set.host.room.start(CHOICE, 31337, START_DATE);
    await tick(10);
    return { hub, ...set };
  }

  it('each outpost status reaches the friends', async () => {
    const { host, guests } = await playing(2);
    host.room.sendStatus(status({ week: 3, science: 41.26 }));
    await tick(10);
    for (const guest of guests) {
      const seen = guest.room.view.players.find((p) => p.id === host.id)!;
      expect(seen.status).toEqual(status({ week: 3, science: 41.3 }));
      expect(seen.finished).toBe(false);
    }
  });

  it('status is sent at most twice a second, and the newest numbers always arrive', async () => {
    const { hub, host, guests } = await playing(1);
    const before = hub.log.filter((entry) => entry.event === 'status').length;
    host.room.sendStatus(status({ week: 1 }));
    host.room.sendStatus(status({ week: 2 }));
    host.room.sendStatus(status({ week: 3 }));
    host.room.sendStatus(status({ week: 4 }));
    await tick(10);
    expect(hub.log.filter((entry) => entry.event === 'status').length - before).toBe(1);
    expect(guests[0].room.view.players.find((p) => p.id === host.id)!.status!.week).toBe(1);
    await tick(600);
    expect(hub.log.filter((entry) => entry.event === 'status').length - before).toBe(2);
    expect(guests[0].room.view.players.find((p) => p.id === host.id)!.status!.week).toBe(4);
    // Over one 10-second stretch of sending every 50 ms, at most about 2 per second go out.
    const start = hub.log.filter((entry) => entry.event === 'status').length;
    for (let i = 0; i < 200; i++) {
      host.room.sendStatus(status({ week: 1 + (i % 5), air: 50 + (i % 40) }));
      await tick(50);
    }
    await tick(600);
    const sent = hub.log.filter((entry) => entry.event === 'status').length - start;
    expect(sent).toBeLessThanOrEqual(22);
    expect(sent).toBeGreaterThan(5);
  });

  it('an unchanged status is not sent again', async () => {
    const { hub, host } = await playing(1);
    const before = hub.log.filter((entry) => entry.event === 'status').length;
    host.room.sendStatus(status());
    await tick(700);
    host.room.sendStatus(status());
    await tick(700);
    expect(hub.log.filter((entry) => entry.event === 'status').length - before).toBe(1);
  });

  it('stickers: at most one a second; friends see them', async () => {
    const { hub, host, guests } = await playing(2);
    expect(host.room.sendReaction('hooray')).toBe(true);
    expect(host.room.sendReaction('wow')).toBe(false);
    await tick(500);
    expect(host.room.sendReaction('wow')).toBe(false);
    await tick(600);
    expect(host.room.sendReaction('wow')).toBe(true);
    await tick(10);
    expect(hub.log.filter((entry) => entry.event === 'react')).toHaveLength(2);
    for (const guest of guests) {
      expect(guest.reactions.map((r) => r.reaction)).toEqual(['hooray', 'wow']);
      expect(guest.reactions[0].player.id).toBe(host.id);
    }
    expect(host.reactions).toHaveLength(0); // no echo
  });

  it('final results arrive once, mark the friend as finished, and stop their status', async () => {
    const { host, guests } = await playing(1);
    host.room.sendFinal(status({ week: 6, step: 'report', end: 'complete', stars: 3, science: 120 }));
    host.room.sendStatus(status({ week: 1 }));
    host.room.sendFinal(status({ stars: 1 }));
    await tick(10);
    const seen = guests[0].room.view.players.find((p) => p.id === host.id)!;
    expect(seen.finished).toBe(true);
    expect(seen.status!.stars).toBe(3);
    expect(seen.status!.end).toBe('complete');
  });

  it('after a lost connection comes back, our numbers are sent again', async () => {
    const { hub, host, guests } = await playing(1);
    host.room.sendStatus(status({ week: 3 }));
    await tick(700);
    const count = () => hub.log.filter((entry) => entry.event === 'status').length;
    const before = count();
    const mine = hub.members(channelName(host.room.view.code)).find((m) => m.key === host.id)!;
    mine.handlers.status('offline');
    expect(host.room.view.online).toBe(false);
    mine.handlers.status('online');
    await tick(700);
    expect(host.room.view.online).toBe(true);
    expect(count()).toBe(before + 1);
    expect(guests[0].room.view.players.find((p) => p.id === host.id)!.status!.week).toBe(3);
  });
});

describe('bad and abusive messages', () => {
  /** A started crew of two. With `hand`, a hand-made client with a seat and a key of its own too (it signs for itself, so only the message rules are tested). */
  async function playing(hand = false) {
    const hub = new MemoryHub();
    const set = await lobby(hub, 1);
    const maker = hand ? await Handmade.join(hub, set.code, { id: 'handmade01' }) : null;
    await tick(100);
    set.host.room.start(CHOICE, 9, START_DATE);
    await tick(10);
    host_status(set.host);
    await tick(10);
    if (maker) {
      await maker.send('status', status({ week: 2 }));
      await tick(10);
    }
    return { hub, hand: maker!, ...set };
  }
  function host_status(c: Client): void {
    c.room.sendStatus(status({ week: 2 }));
  }

  it('malformed messages change nothing and break nothing', async () => {
    const { host, guests, hand } = await playing(true);
    const guest = guests[0];
    // A seated client with a key of its own, signing everything it sends: the rules for the content still apply.
    const junk: [string, Record<string, unknown>][] = [
      ['status', { week: 'ten' }],
      ['status', { ...status(), air: 'lots' }],
      ['status', { ...status(), step: 'hack' }],
      ['status', { ...status(), air: 1e12 }],
      ['final', {}],
      ['react', { id: 'Hello friend, what is your name?' }],
      ['chat', { text: 'hi' }],
      ['pos', { x: 'far' }],
      ['start', { choice: 7, seed: 1, startDate: 'x' }],
      // Signed with its own key, but in the host name: the host key is the one pinned for that id.
      ['status', { ...status({ week: 6 }), from: host.id }],
      ['react', { id: 'wow', from: host.id }],
    ];
    for (const [event, body] of junk) await hand.send(event, body);
    // Things that are no message at all.
    hand.raw('status', null);
    hand.raw('status', 'hello');
    hand.raw('status', { from: hand.id, ...status() }); // not signed
    await tick(10);
    const seen = guest.room.view.players.find((p) => p.id === hand.id)!;
    expect(seen.status!.week).toBe(2);
    expect(seen.finished).toBe(false);
    expect(guest.room.view.players.find((p) => p.id === host.id)!.status!.week).toBe(2);
    expect(guest.reactions).toHaveLength(0);
    expect(guest.room.view.phase).toBe('playing');
    // The same road does carry a good one (so the zero above means "dropped", not "never arrived").
    await hand.send('status', status({ week: 3 }));
    await hand.send('react', { id: 'wow' });
    await tick(10);
    expect(guest.room.view.players.find((p) => p.id === hand.id)!.status!.week).toBe(3);
    expect(guest.reactions).toHaveLength(1);
  });

  it('an oversized message is dropped', async () => {
    const { guests, hand } = await playing(true);
    await hand.send('status', { ...status({ week: 5 }), pad: 'z'.repeat(5000) });
    await hand.send('status', { ...status({ week: 4 }), pad: 'z'.repeat(40) }); // a little extra is not a field: rebuilt and taken without it
    await tick(10);
    expect(guests[0].room.view.players.find((p) => p.id === hand.id)!.status!.week).toBe(4);
  });

  it('messages from somebody who is not in the room are ignored', async () => {
    const { hub, guests, code } = await playing();
    const stranger = await intruder(hub, code, 'stranger01');
    stranger.send('react', { from: 'stranger01', id: 'great' });
    stranger.send('status', { from: 'stranger01', ...status() });
    stranger.send('react', { from: 'nobody0000', id: 'great' });
    await tick(10);
    expect(guests[0].reactions).toHaveLength(0);
    expect(guests[0].room.view.players).toHaveLength(2);
  });

  it('a flood of messages is cut off', async () => {
    const { guests, hand } = await playing(true);
    for (let i = 0; i < 100; i++) await hand.send('react', { id: 'wow' });
    await tick(10);
    expect(guests[0].reactions.length).toBeLessThanOrEqual(3);
    for (let i = 0; i < 100; i++) await hand.send('status', status({ week: 1 + (i % 5) }));
    await tick(10);
    expect(guests[0].room.view.phase).toBe('playing');
  });

  it('the identity inside presence must match the player', async () => {
    const hub = new MemoryHub();
    const { guests, code } = await lobby(hub, 1);
    const liar = new MemoryTransport(hub);
    await liar.connect(channelName(code), 'liar000001', { id: guests[0].id, n: 1, c: 1, r: true, h: false, s: false, t: Date.now(), v: 1 }, { presence() {}, message() {}, status() {} });
    await tick(10);
    expect(guests[0].room.view.players).toHaveLength(2);
  });
});

describe('leaving and losing the connection', () => {
  it('the host leaves before the start: the lobby closes with a message', async () => {
    const hub = new MemoryHub();
    const { host, guests } = await lobby(hub, 2);
    host.room.leave();
    await tick(500);
    expect(guests[0].room.view.phase).toBe('lobby'); // a blink is forgiven
    await tick(1500);
    for (const guest of guests) {
      expect(guest.room.view.phase).toBe('closed');
      expect(guest.room.view.failure).toBe('hostLeft');
    }
  });

  it('a friend leaves the lobby: the others see the seat free', async () => {
    const hub = new MemoryHub();
    const { host, guests } = await lobby(hub, 2);
    guests[0].room.leave();
    await tick(10);
    expect(host.room.view.players).toHaveLength(2);
    expect(guests[0].room.view.phase).toBe('idle');
  });

  it('the host leaves during the mission: the others play on, with the host marked as gone', async () => {
    const hub = new MemoryHub();
    const { host, guests } = await lobby(hub, 2);
    host.room.start(CHOICE, 3, START_DATE);
    await tick(10);
    host.room.sendStatus(status({ week: 4 }));
    await tick(10);
    host.room.leave();
    await tick(5000);
    for (const guest of guests) {
      expect(guest.room.view.phase).toBe('playing');
      const gone = guest.room.view.players.find((p) => p.id === host.id)!;
      expect(gone.here).toBe(false);
      expect(gone.status!.week).toBe(4); // the last numbers stay for the debrief
    }
    guests[0].room.sendStatus(status({ week: 5 }));
    await tick(10);
    expect(guests[1].room.view.players.find((p) => p.id === guests[0].id)!.status!.week).toBe(5);
  });

  it('a lost connection is shown as "left" to the others, and as "offline" to the player', async () => {
    const hub = new MemoryHub();
    const { host, guests } = await lobby(hub, 1);
    host.room.start(CHOICE, 3, START_DATE);
    await tick(10);
    const member = hub.members(channelName(host.room.view.code)).find((m) => m.key === guests[0].id)!;
    member.transport.cut();
    await tick(10);
    expect(host.room.view.players.find((p) => p.id === guests[0].id)!.here).toBe(false);
    expect(guests[0].room.view.online).toBe(false);
    expect(host.room.view.phase).toBe('playing');
    expect(guests[0].room.view.phase).toBe('playing'); // the player's own game is not stopped
  });

  it('leaving never throws, can be done twice, and sends nothing afterwards', async () => {
    const hub = new MemoryHub();
    const { host } = await lobby(hub, 1);
    host.room.leave();
    host.room.leave();
    const before = hub.log.length;
    expect(host.room.sendReaction('wow')).toBe(false);
    host.room.sendStatus(status());
    host.room.sendFinal(status());
    await tick(2000);
    expect(hub.log.length).toBe(before);
  });

  it('leaving while a join or a create is still waiting ends the wait at once', async () => {
    const hub = new MemoryHub();
    const { code } = await lobby(hub, 1);
    const joiner = client(hub);
    let settled = 0;
    const joining = joiner.room.join(code).then(() => settled++);
    await tick(10);
    joiner.room.leave();
    const maker = client(hub);
    const making = maker.room.create().then(() => settled++);
    await tick(10);
    maker.room.leave();
    await tick(1);
    await Promise.all([joining, making]);
    expect(settled).toBe(2);
    expect(joiner.room.view.phase).toBe('idle');
  });

  it('leaving while still connecting leaves nothing behind', async () => {
    const hub = new MemoryHub();
    const host = client(hub);
    const made = host.room.create();
    host.room.leave();
    await tick(500);
    expect(await made).toBe(false);
    expect(hub.members(channelName(host.room.view.code || 'x'))).toHaveLength(0);
    expect(host.room.view.phase).toBe('idle');
  });
});
