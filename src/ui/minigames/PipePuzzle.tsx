/**
 * Life support repair, inside the habitat. Tap the pipe pieces to turn them
 * until oxygen flows from the tank on the left to the crew room on the right.
 * Every puzzle is built around a real route, so it can always be solved.
 *
 * The pipes are metal tubes with a glass channel down the middle: dark while
 * empty, glowing blue with bubbles running along wherever the air reaches,
 * from the tank onwards. Where a pipe with air in it ends in nothing, puffs
 * show the leak. The first round ever shows a hand tapping the next pipe to turn.
 * Stars: few taps compared with the fewest possible.
 */
import type { JSX } from 'preact';
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { audio } from '../../game/audio';
import { t } from '../../i18n';
import { Icon } from '../icons';
import type { MinigameProps } from './index';
import {
  Briefing,
  Burst,
  calmMotion,
  clockText,
  GoalLine,
  HintHand,
  isWide,
  leaveBriefing,
  levelOf,
  Panel,
  Result,
  StarCount,
  starsFor,
  StarTrack,
  tapRing,
  useFinish,
  useFirstHint,
  useLater,
  useOneOf,
} from './kit';
import type { GoalState } from './kit';
import { flow, generate, hintCell, isConnected, leaks, pipeGoals, pipeLevel, pipeTargets, turnAt } from './pipes';
import type { Board, PieceKind } from './pipes';

/** Each piece drawn in its base shape on a 100 x 100 tile; the tile turns the whole drawing. */
const PIPE_PATH: Record<PieceKind, string> = {
  straight: 'M50 0V100',
  corner: 'M50 0A50 50 0 0 0 100 50',
  tee: 'M50 0V100M50 50H100',
};

/** A white shine along one side of the tube, and a dot of light further on. */
const SHINE_PATH: Record<PieceKind, string> = {
  straight: 'M42 19V62',
  corner: 'M44.9 18A58 58 0 0 0 66.7 47.5',
  tee: 'M42 18V27M74 42H83',
};

const SHINE_DOT: Partial<Record<PieceKind, [number, number]>> = {
  straight: [42, 71],
  corner: [78.3, 53.8],
};

/** Open ends of each base shape (0 north, 1 east, 2 south), where the joints sit. */
const PIPE_ENDS: Record<PieceKind, number[]> = {
  straight: [0, 2],
  corner: [0, 1],
  tee: [0, 1, 2],
};

/** The middle of the corner's arc: each half of the bend carries the air one way. */
const BEND_MID = '64.645 35.355';
const EDGE = ['50 0', '100 50', '50 100', '0 50'];

/**
 * The path the bubbles follow on one arm of a piece (base shape): in from the
 * edge to the middle on the arm the air enters by, out from the middle on the others.
 */
function armPath(kind: PieceKind, end: number, incoming: boolean): string {
  if (kind === 'corner') {
    if (end === 0) return incoming ? `M50 0A50 50 0 0 0 ${BEND_MID}` : `M${BEND_MID}A50 50 0 0 1 50 0`;
    return incoming ? `M100 50A50 50 0 0 1 ${BEND_MID}` : `M${BEND_MID}A50 50 0 0 0 100 50`;
  }
  return incoming ? `M${EDGE[end]}L50 50` : `M50 50L${EDGE[end]}`;
}

/** A bolted collar where a pipe meets the edge of its plate (drawn at the top, then turned). */
function Flange({ dir }: { dir: number }): JSX.Element {
  return (
    <g transform={`rotate(${dir * 90} 50 50)`}>
      <rect class="mg-flange" x="25" y="1.5" width="50" height="14" rx="3.5" />
      <rect class="mg-flange-shade" x="27" y="10.6" width="46" height="3.4" rx="1.4" />
      <circle class="mg-bolt" cx="32.5" cy="7.6" r="3" />
      <circle class="mg-bolt" cx="67.5" cy="7.6" r="3" />
      <circle class="mg-bolt-shine" cx="31.6" cy="6.7" r="1" />
      <circle class="mg-bolt-shine" cx="66.6" cy="6.7" r="1" />
    </g>
  );
}

function PipeArt({ kind }: { kind: PieceKind }): JSX.Element {
  const d = PIPE_PATH[kind];
  const dot = SHINE_DOT[kind];
  return (
    <>
      <path class="mg-pipe-edge" d={d} />
      <path class="mg-pipe-shade" d={d} />
      <path class="mg-pipe-body" d={d} />
      {kind === 'corner' && (
        <>
          <path class="mg-collar-edge" d="M50.5 49.5 78.8 21.2" />
          <path class="mg-collar" d="M50.5 49.5 78.8 21.2" />
        </>
      )}
      {kind === 'tee' && (
        <>
          <circle class="mg-hub-shade" cx="50" cy="50" r="22" />
          <circle class="mg-hub" cx="47.6" cy="47.6" r="18.6" />
          <circle class="mg-hub-edge" cx="50" cy="50" r="22" />
        </>
      )}
      <path class="mg-pipe-glow" d={d} />
      <path class="mg-pipe-core" d={d} />
      <path class="mg-pipe-shine" d={SHINE_PATH[kind]} />
      {dot && <circle class="mg-pipe-dot" cx={dot[0]} cy={dot[1]} r="1.9" />}
      {kind === 'tee' &&
        [
          [60.6, 60.6],
          [39.4, 60.6],
          [39.4, 39.4],
          [60.6, 39.4],
        ].map(([x, y]) => <circle key={`${x}-${y}`} class="mg-bolt" cx={x} cy={y} r="2.6" />)}
      {PIPE_ENDS[kind].map((dir) => (
        <Flange key={dir} dir={dir} />
      ))}
    </>
  );
}

/** Bubbles running through a wet piece. `entry` is the side (in the base shape) the air comes in by. */
function Bubbles({ kind, entry }: { kind: PieceKind; entry: number }): JSX.Element {
  return (
    <g class="mg-bubbles">
      {PIPE_ENDS[kind].map((end) => (
        <path key={end} d={armPath(kind, end, end === entry)} pathLength={50} />
      ))}
    </g>
  );
}

/** A short pipe from the tank, or into the room, the same size as the pipes on the tiles. */
function Stub({ side, flowing }: { side: 'out' | 'in'; flowing: boolean }): JSX.Element {
  return (
    <svg
      class={`mg-stub mg-stub-${side} ${flowing ? 'is-wet' : ''}`}
      viewBox="0 0 100 100"
      preserveAspectRatio={side === 'out' ? 'xMaxYMid slice' : 'xMinYMid slice'}
      aria-hidden="true"
      focusable="false"
    >
      <path class="mg-pipe-edge" d="M0 50H100" />
      <path class="mg-pipe-shade" d="M0 50H100" />
      <path class="mg-pipe-body" d="M0 50H100" />
      <path class="mg-pipe-glow" d="M0 50H100" />
      <path class="mg-pipe-core" d="M0 50H100" />
      <path class="mg-pipe-shine" d="M8 42H70" />
      {flowing && (
        <g class="mg-bubbles">
          <path d="M0 50H100" pathLength={50} />
        </g>
      )}
      <g transform={side === 'out' ? 'rotate(90 50 50)' : 'rotate(-90 50 50)'}>
        <rect class="mg-flange" x="25" y="1.5" width="50" height="14" rx="3.5" />
        <rect class="mg-flange-shade" x="27" y="10.6" width="46" height="3.4" rx="1.4" />
        <circle class="mg-bolt" cx="32.5" cy="7.6" r="3" />
        <circle class="mg-bolt" cx="67.5" cy="7.6" r="3" />
      </g>
    </svg>
  );
}

/** The tank's pressure dial: the needle swings up when the air starts flowing. */
function TankGauge(): JSX.Element {
  return (
    <svg class="mg-tank-gauge" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle cx="20" cy="20" r="17" fill="#fffaf0" stroke="#2b2440" stroke-width="3" />
      <path d="M8.5 26A13 13 0 0 1 9.6 11.6" fill="none" stroke="#ff7b86" stroke-width="3.4" />
      <path d="M30.4 11.6A13 13 0 0 1 31.5 26" fill="none" stroke="#5fd99a" stroke-width="3.4" />
      <path d="M20 6.5v3M11 20H8M32 20h-3" stroke="#2b2440" stroke-width="2" stroke-linecap="round" />
      <path class="mg-tank-needle" d="M18.6 20.5 20 8.5l1.4 12Z" fill="#e0473c" stroke="#2b2440" stroke-width="1.2" stroke-linejoin="round" />
      <circle cx="20" cy="20" r="3" fill="#2b2440" />
    </svg>
  );
}

/**
 * Someone from the crew, looking out of the room's round window: worried without
 * air, beaming with it.
 */
function Porthole({ happy }: { happy: boolean }): JSX.Element {
  const ink = '#2b2440';
  const clip = useId();
  return (
    <svg class="mg-porthole" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}>
          <circle cx="32" cy="32" r="21" />
        </clipPath>
      </defs>
      <circle cx="32" cy="32" r="30" fill="#c4cfe8" stroke={ink} stroke-width="2.6" />
      <path d="M53.2 10.8A30 30 0 0 1 10.8 53.2 27 27 0 0 0 53.2 10.8Z" fill="#7f8db5" />
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <circle key={angle} cx={32 + 26.5 * Math.cos((angle * Math.PI) / 180)} cy={32 + 26.5 * Math.sin((angle * Math.PI) / 180)} r="1.7" fill="#5c6a94" stroke={ink} stroke-width="1" />
      ))}
      <circle class="mg-porthole-glass" cx="32" cy="32" r="22" stroke={ink} stroke-width="2.4" />
      <g clip-path={`url(#${clip})`}>
        {/* The suit collar and the face. */}
        <path d="M14 58c2-9 9-13 18-13s16 4 18 13Z" fill="#f4f1ea" stroke={ink} stroke-width="2" />
        <path d="M26 45.5 32 51l6-5.5" fill="none" stroke="#f2c46d" stroke-width="2.4" stroke-linejoin="round" />
        <circle cx="32" cy="33" r="11.5" fill="#ffe0c4" stroke={ink} stroke-width="2" />
        <path d="M20.6 31c-.4-8 5-12.6 11.4-12.6S43.8 23 43.4 31c-2.6-3.6-6.6-5.6-11.4-5.6S23.2 27.4 20.6 31Z" fill="#6b4630" stroke={ink} stroke-width="1.8" stroke-linejoin="round" />
        <path d="M27 21.6c2.4-1 5.4-1.2 8 0" fill="none" stroke="#9a6a4a" stroke-width="1.6" stroke-linecap="round" />
        {happy ? (
          <>
            <path d="M24.6 33.2q2.4-3 4.8 0M34.6 33.2q2.4-3 4.8 0" fill="none" stroke={ink} stroke-width="1.9" stroke-linecap="round" />
            <path d="M27.4 37.2q4.6 5.4 9.2 0Z" fill="#c2404f" stroke={ink} stroke-width="1.6" stroke-linejoin="round" />
            <circle cx="23.6" cy="37" r="2" fill="#ff8f9a" opacity="0.75" />
            <circle cx="40.4" cy="37" r="2" fill="#ff8f9a" opacity="0.75" />
          </>
        ) : (
          <>
            <ellipse cx="27.2" cy="33.4" rx="2" ry="2.5" fill={ink} />
            <ellipse cx="36.8" cy="33.4" rx="2" ry="2.5" fill={ink} />
            <circle cx="27.8" cy="32.5" r="0.8" fill="#fff" />
            <circle cx="37.4" cy="32.5" r="0.8" fill="#fff" />
            <path d="M24 29.4 29 30.6M40 29.4l-5 1.2" stroke={ink} stroke-width="1.5" stroke-linecap="round" />
            <path d="M28.6 39.6q1.7-1.4 3.4 0t3.4 0" fill="none" stroke={ink} stroke-width="1.6" stroke-linecap="round" />
            <path d="M42.6 26.4q1.4 2.6 0 3.6-1.4-1 0-3.6Z" fill="#8fd8ff" stroke={ink} stroke-width="1" />
          </>
        )}
      </g>
      <path d="M17.5 24A16 16 0 0 1 26 14.6" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" opacity="0.85" />
      <circle cx="18.6" cy="29" r="1.4" fill="#ffffff" opacity="0.85" />
    </svg>
  );
}

interface PipeGame {
  board: Board;
  /** Quarter turns each tile has made on screen. Only ever grows, so pieces always spin clockwise. */
  turns: number[];
  moves: number;
}

type Phase = 'brief' | 'play' | 'flow' | 'done';

const FACTS: Record<MinigameProps['site'], string[]> = {
  mars: ['mg.pipes.fact.need', 'mg.pipes.fact.moxie'],
  moon: ['mg.pipes.fact.need', 'mg.pipes.fact.recycle'],
};

/** The hand shows the way for this many taps of a first-ever round. */
const HINT_TAPS = 3;

const wrap4 = (value: number): number => ((value % 4) + 4) % 4;

export function PipePuzzle({ site, level: askedLevel, onFinish }: MinigameProps): JSX.Element {
  const level = levelOf(askedLevel);
  const { finish } = useFinish(onFinish);
  const later = useLater();
  const fact = useOneOf(FACTS[site]);
  const hint = useFirstHint('pipes');
  const [setup] = useState(() => {
    const spec = pipeLevel(level, isWide());
    const puzzle = generate(Math.floor(Math.random() * 0x7fffffff), spec.rows, spec.cols, spec.tune);
    return { puzzle, targets: pipeTargets(puzzle.par, level) };
  });
  const [game, setGame] = useState<PipeGame>(() => ({
    board: setup.puzzle.board,
    turns: setup.puzzle.board.tiles.map((tile) => tile.rot),
    moves: 0,
  }));
  const [phase, setPhase] = useState<Phase>('brief');
  const [leaving, setLeaving] = useState(false);
  const [times, setTimes] = useState({ start: 0, end: 0 });
  const [kick, setKick] = useState({ index: -1, at: 0 });

  const { board, turns, moves } = game;
  const targets = setup.targets;
  const air = useMemo(() => flow(board), [board]);
  const holes = useMemo(() => leaks(board, air), [board, air]);
  const connected = air.connected;
  const goals = pipeGoals(connected, moves, targets);
  const showHint = hint.on && phase === 'play' && moves < HINT_TAPS && !connected;
  const hintAt = useMemo(() => (showHint ? hintCell(board) : -1), [board, showHint]);

  // When each tile last filled with air, so a tile flashes once as the air arrives.
  const wetSince = useRef<number[]>([]);
  const filled = useMemo(() => {
    const now = performance.now();
    const next = air.wet.map((wet, i) => (wet ? (wetSince.current[i] ?? -1) >= 0 ? wetSince.current[i] : now : -1));
    wetSince.current = next;
    return next;
  }, [air]);

  // A bubbly note when the air reaches further than before.
  const reach = useRef(0);
  useEffect(() => {
    const count = air.wet.filter(Boolean).length;
    if (phase === 'play' && count > reach.current && !connected) audio.play('pop', Math.min(5, count));
    reach.current = count;
  }, [air]);

  useEffect(() => {
    if (!connected || phase !== 'play') return;
    setPhase('flow');
    setTimes((now) => ({ ...now, end: performance.now() }));
    if (hint.on) hint.done();
    audio.play('whoosh');
    later(() => audio.play('win'), 260);
    later(() => setPhase('done'), calmMotion() ? 400 : 1900);
  }, [connected]);

  useEffect(() => {
    if (hint.on && moves >= HINT_TAPS) hint.done();
  }, [moves]);

  const start = (): void => {
    if (phase !== 'brief' || leaving) return;
    audio.play('confirm');
    const go = (): void => {
      setLeaving(false);
      setPhase('play');
      setTimes({ start: performance.now(), end: 0 });
    };
    if (calmMotion()) go();
    else {
      setLeaving(true);
      later(go, 240);
    }
  };

  const rotate = (index: number): void => {
    if (phase !== 'play') return;
    audio.play('ratchet');
    setKick({ index, at: performance.now() });
    setGame((now) =>
      isConnected(now.board)
        ? now
        : {
            board: turnAt(now.board, index),
            turns: now.turns.map((value, i) => (i === index ? value + 1 : value)),
            moves: now.moves + 1,
          },
    );
  };

  const leakAt = new Map<number, number[]>();
  for (const hole of holes) leakAt.set(hole.cell, [...(leakAt.get(hole.cell) ?? []), hole.dir]);

  // The best number of stars still possible, and the taps left for it.
  const reachable = moves <= targets.three ? 3 : moves <= targets.two ? 2 : 1;
  const tapsLeft = reachable === 3 ? targets.three - moves : reachable === 2 ? targets.two - moves : 0;
  const goalState = (met: boolean, limit: number): GoalState => (met ? 'met' : moves > limit ? 'lost' : 'open');

  const vars = {
    '--rows': board.rows,
    '--cols': board.cols,
    '--in': board.inletRow,
    '--out': board.outletRow,
    '--ratio': (board.cols + 1.6) / board.rows,
  };

  const starGoals = [t('mg.pipes.star1'), t('mg.pipes.starMoves', { n: targets.two }), t('mg.pipes.starMoves', { n: targets.three })];
  const seconds = (times.end - times.start) / 1000;
  const wetCount = air.wet.filter(Boolean).length;

  const over =
    phase === 'brief' ? (
      <Briefing
        icon="air"
        art={<Porthole happy />}
        title={t('mg.pipes.title')}
        intro={t('mg.pipes.intro')}
        how={t('mg.pipes.how')}
        goals={starGoals}
        onStart={start}
        onLeave={leaveBriefing}
        leaving={leaving}
      />
    ) : phase === 'done' ? (
      <Result
        won
        game="pipes"
        stars={starsFor(goals)}
        title={t('mg.pipes.win')}
        goals={starGoals.map((text, index) => ({ text, met: goals[index] }))}
        stats={[
          { icon: 'gear', text: t('mg.pipes.statMoves', { n: moves }) },
          { icon: 'clock', text: clockText(seconds) },
        ]}
        fact={t(fact)}
        onContinue={() => finish(true)}
      />
    ) : null;

  return (
    <Panel game="pipes" site={site} level={level} icon="air" title={t('mg.pipes.title')} onLeave={phase === 'play' ? () => finish(false) : null} over={over}>
      <GoalLine text={t('mg.pipes.goal')}>
        {phase !== 'done' && (
          <span class={`mg-target is-${reachable}`} title={t('mg.pipes.target', { stars: reachable, n: reachable === 3 ? targets.three : targets.two })}>
            <StarCount n={reachable} />
            {reachable > 1 && <b>{t('mg.pipes.left', { n: Math.max(0, tapsLeft) })}</b>}
          </span>
        )}
      </GoalLine>
      <StarTrack
        goals={[
          { text: starGoals[0], state: connected ? 'met' : 'open' },
          { text: starGoals[1], state: goalState(goals[1], targets.two) },
          { text: starGoals[2], state: goalState(goals[2], targets.three) },
        ]}
      />

      <div class="mg-play">
        <div class={`mg-board ${connected ? 'is-done' : ''}`} role="group" aria-label={t('mg.pipes.board')} style={vars}>
          <div class={`mg-end mg-end-tank ${wetCount > 0 ? 'is-open' : ''}`} role="img" aria-label={t('mg.pipes.tank')}>
            <span class="mg-end-label" aria-hidden="true">
              {t('mg.pipes.tankShort')}
            </span>
            <Stub side="out" flowing />
            <span class="mg-tank" aria-hidden="true">
              <svg class="mg-tank-valve" viewBox="0 0 40 20" focusable="false">
                <rect x="15" y="9" width="10" height="11" fill="#b4c0db" stroke="#2b2440" stroke-width="2" />
                <ellipse cx="20" cy="8" rx="16" ry="5.6" fill="#f2c46d" stroke="#2b2440" stroke-width="2" />
                <path d="M6 8h28M20 3v10" stroke="#c9973f" stroke-width="2" />
                <ellipse cx="20" cy="8" rx="4" ry="2" fill="#fff6d8" stroke="#2b2440" stroke-width="1.6" />
              </svg>
              <span class="mg-tank-label">O₂</span>
              <span class="mg-tank-band" />
              <TankGauge />
            </span>
          </div>

          {board.tiles.map((tile, index) => {
            const row = Math.floor(index / board.cols);
            const col = index % board.cols;
            const wet = air.wet[index];
            const leaking = leakAt.get(index) ?? [];
            const label = wet
              ? leaking.length
                ? t('mg.pipes.tileLeak', { row: row + 1, col: col + 1 })
                : t('mg.pipes.tileWet', { row: row + 1, col: col + 1 })
              : t('mg.pipes.tile', { row: row + 1, col: col + 1 });
            return (
              <button
                key={index}
                type="button"
                class={`mg-tile ${wet ? 'is-wet' : ''} ${leaking.length ? 'is-leaking' : ''} ${hintAt === index ? 'is-hint' : ''}`}
                style={{ gridRow: row + 1, gridColumn: col + 2, '--d': Math.max(0, air.depth[index]) }}
                aria-label={label}
                disabled={phase !== 'play'}
                onPointerDown={(event) => tapRing(event)}
                onClick={() => rotate(index)}
              >
                <svg class="mg-pipe" viewBox="0 0 100 100" style={{ transform: `rotate(${turns[index] * 90}deg)` }} aria-hidden="true" focusable="false">
                  <PipeArt kind={tile.kind} />
                  {wet && <Bubbles kind={tile.kind} entry={wrap4(air.from[index] - tile.rot)} />}
                </svg>
                {wet && <span key={`fill-${filled[index]}`} class="mg-tile-fill" aria-hidden="true" />}
                {kick.index === index && <span key={`kick-${kick.at}`} class="mg-tile-kick" aria-hidden="true" />}
                {leaking.map((dir) => (
                  <span key={`leak-${dir}`} class="mg-leak" style={{ '--dir': dir }} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                ))}
                {hintAt === index && <HintHand x="50%" y="50%" label={t('mg.hint.tap')} />}
              </button>
            );
          })}

          <div class={`mg-end mg-end-room ${connected ? 'is-on' : ''}`} role="img" aria-label={t('mg.pipes.room')}>
            <span class="mg-end-label" aria-hidden="true">
              {t('mg.pipes.roomShort')}
            </span>
            <Stub side="in" flowing={connected} />
            <span class="mg-room" aria-hidden="true">
              <span class="mg-room-lamp" />
              <span class="mg-room-window">
                <Porthole happy={connected} />
              </span>
              <span class="mg-room-vent">
                <i />
                <i />
                <i />
              </span>
            </span>
            {connected && <Burst count={12} class="mg-room-burst" />}
          </div>

          {phase === 'flow' && (
            <div class="mg-stamp" role="status">
              <Icon name="air" size={20} />
              {t('mg.pipes.flowing')}
            </div>
          )}
        </div>
      </div>

      <div class="mg-foot">
        <div class="mg-status">
          <span class="mg-chip">
            <Icon name="gear" size={16} />
            {t('mg.pipes.moves', { n: moves })}
          </span>
          {holes.length > 0 && !connected && (
            <span class="mg-chip mg-chip-leak">
              <Icon name="leak" size={16} />
              {t('mg.pipes.leaks', { n: holes.length })}
            </span>
          )}
          <span class="mg-hint">{t('mg.pipes.hint')}</span>
        </div>
      </div>
    </Panel>
  );
}
