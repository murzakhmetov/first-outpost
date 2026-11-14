/**
 * The radio rhythm game without any screen code. Data packets slide along three
 * lanes towards the antenna; the player taps a lane when its packet reaches the
 * line. A tap close to the beat is "perfect", a bit off is "good", and a packet
 * that is tapped much too early, or not at all, is lost. Send 70% or more to win.
 */
import { Rng } from '../../sim/rng';
import type { Level } from './score';

export const LANES = 3;

export interface RhythmTune {
  bpm: number;
  /** Bars of four beats with packets in them. */
  bars: number;
  /** Time a packet takes to slide from the start of its lane to the line, ms. */
  approachMs: number;
  /** A tap this close to the packet's time (either way) is perfect... */
  perfectMs: number;
  /** ...and this close is good. */
  goodMs: number;
  /** A tap this early still uses the packet up, as a miss, so tapping all the time does not pay. */
  earlyMs: number;
  /** Rhythms the bars are made of: beats from the start of the bar. */
  patterns: readonly (readonly number[])[];
  /** Chance that a packet on a beat comes with a second one in another lane. */
  doubles: number;
}

export const RHYTHM_LEVELS: Record<Level, RhythmTune> = {
  1: {
    bpm: 92,
    bars: 10,
    approachMs: 2_200,
    perfectMs: 85,
    goodMs: 170,
    earlyMs: 280,
    patterns: [[0, 2], [0, 1, 2], [0, 2, 3], [0, 1, 2, 3], [0, 1, 3]],
    doubles: 0,
  },
  2: {
    bpm: 104,
    bars: 12,
    approachMs: 1_900,
    perfectMs: 70,
    goodMs: 145,
    earlyMs: 250,
    patterns: [[0, 1, 2, 3], [0, 1, 2, 2.5, 3], [0, 2, 3], [0, 1, 1.5, 2, 3], [0, 1, 2]],
    doubles: 0,
  },
  3: {
    bpm: 112,
    bars: 12,
    approachMs: 1_650,
    perfectMs: 60,
    goodMs: 125,
    earlyMs: 230,
    patterns: [[0, 1, 2, 2.5, 3], [0, 0.5, 1, 2, 3], [0, 1, 2, 3], [0, 1, 1.5, 2, 3], [0, 2, 2.5, 3]],
    doubles: 0.15,
  },
};

export interface Note {
  /** When the packet reaches the line, ms of song time. */
  t: number;
  lane: number;
  /** A step of the little tune the hits play, 0 to 4. */
  tone: number;
  /** Which picture the packet carries. */
  kind: number;
}

export interface Chart {
  notes: Note[];
  beatMs: number;
  /** Song time of the first beat of the first bar with packets. */
  startMs: number;
  /** Song time when the last packet is done and the results can show. */
  endMs: number;
}

export const beatMs = (tune: RhythmTune): number => 60_000 / tune.bpm;

/** A seeded chart: bars of simple rhythms, never the same lane three times in a row. */
export function makeChart(tune: RhythmTune, seed: number): Chart {
  const rng = new Rng(seed);
  const beat = beatMs(tune);
  // Wait long enough before the first packet reaches the line for it to slide the whole lane.
  const leadBeats = Math.max(4, Math.ceil((tune.approachMs + 500) / beat));
  const notes: Note[] = [];
  let lastLane = -1;
  let sameRun = 0;
  let tone = 2;
  const laneAfter = (): number => {
    const choices = [0, 1, 2].filter((lane) => !(lane === lastLane && sameRun >= 2));
    const lane = rng.pick(choices);
    sameRun = lane === lastLane ? sameRun + 1 : 1;
    lastLane = lane;
    return lane;
  };
  for (let bar = 0; bar < tune.bars; bar++) {
    // The last bar is calm: one packet on each of the first beats, then rest.
    const rhythm = bar === tune.bars - 1 ? [0, 1, 2] : rng.pick(tune.patterns);
    for (const at of rhythm) {
      const t = (leadBeats + bar * 4 + at) * beat;
      tone = Math.max(0, Math.min(4, tone + rng.pick([-1, -1, 0, 1, 1, 2, -2])));
      const lane = laneAfter();
      notes.push({ t, lane, tone, kind: rng.int(0, 5) });
      if (tune.doubles > 0 && Number.isInteger(at) && rng.chance(tune.doubles)) {
        const other = rng.pick([0, 1, 2].filter((item) => item !== lane));
        notes.push({ t, lane: other, tone: (tone + 2) % 5, kind: rng.int(0, 5) });
      }
    }
  }
  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  const last = notes.length ? notes[notes.length - 1].t : leadBeats * beat;
  return { notes, beatMs: beat, startMs: leadBeats * beat, endMs: last + tune.goodMs + 700 };
}

export type Judgement = 'perfect' | 'good' | 'miss';

/**
 * A tap `delta` ms after a packet's time (below zero: before it). Returns null
 * when the tap is too far from this packet to count for it at all.
 */
export function judgeTap(delta: number, tune: RhythmTune): Judgement | null {
  const size = Math.abs(delta);
  if (size <= tune.perfectMs) return 'perfect';
  if (size <= tune.goodMs) return 'good';
  if (delta < 0 && size <= tune.earlyMs) return 'miss';
  return null;
}

/** A packet nobody tapped is lost once it is this late. */
export function isLost(delta: number, tune: RhythmTune): boolean {
  return delta > tune.goodMs;
}

/** The packet a tap in `lane` at song time `time` is for: the oldest one still waiting nearby, or -1. */
export function noteFor(notes: readonly Note[], done: readonly boolean[], lane: number, time: number, tune: RhythmTune): number {
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const delta = time - note.t;
    if (delta < -tune.earlyMs) break; // this one and all after it are still far away
    if (done[i] || note.lane !== lane || isLost(delta, tune)) continue;
    return i;
  }
  return -1;
}

/** Packets sent at least this share of all of them wins. */
export const WIN_SHARE = 0.7;

export function sentShare(hits: number, total: number): number {
  return total > 0 ? hits / total : 0;
}

export function signalWon(hits: number, total: number): boolean {
  return total > 0 && hits >= Math.ceil(WIN_SHARE * total - 1e-9);
}

/** The three star goals: 70% of the data sent, 85%, 95%. */
export function signalGoals(hits: number, total: number): [boolean, boolean, boolean] {
  const won = signalWon(hits, total);
  const share = sentShare(hits, total);
  return [won, won && share >= 0.85 - 1e-9, won && share >= 0.95 - 1e-9];
}
