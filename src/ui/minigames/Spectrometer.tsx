/**
 * Rock analysis in the lab. The rover's laser makes a tiny spark on a rock, and
 * the spark's light, spread out into a rainbow, shows coloured lines. Every
 * element has its own pattern of lines; each rock here is two elements together.
 *
 * Pick two element cards and press Check: a scan runs along the rock's light and
 * every line the picked elements explain lights up in their colour. A wrong
 * guess may be tried once more. On level 1 the lines light up as soon as a card
 * is picked; on level 3 there are no helper ticks at all.
 *
 * The line patterns are made up for the game (spectro.ts). They are not real
 * wavelengths, and the screen says so.
 */
import type { JSX } from 'preact';
import { useId, useState } from 'preact/hooks';
import { audio } from '../../game/audio';
import { t } from '../../i18n';
import { Btn } from '../common';
import { Icon } from '../icons';
import type { MinigameProps } from './index';
import {
  Briefing,
  Burst,
  calmMotion,
  GoalLine,
  HintHand,
  leaveBriefing,
  levelOf,
  Panel,
  Result,
  starsFor,
  StarTrack,
  tapRing,
  useFinish,
  useFirstHint,
  useLater,
  useOneOf,
} from './kit';
import type { GoalState } from './kit';
import { atNm, isRight, LINES, makeRounds, rockLines, SPECTRO_LEVELS, spectroGoals, TRIES } from './spectro';
import type { El, Line, Rock, RockLook, Round } from './spectro';

// ----- The rainbow strip ---------------------------------------------------------

const STOPS: readonly [number, readonly [number, number, number]][] = [
  [0, [138, 76, 255]],
  [18, [70, 104, 255]],
  [32, [32, 196, 255]],
  [48, [52, 226, 124]],
  [62, [255, 226, 76]],
  [78, [255, 156, 48]],
  [100, [255, 62, 62]],
];

/** The rainbow colour at a place on the strip, so each line glows in the colour it sits on. */
function colourAt(at: number): string {
  for (let i = 1; i < STOPS.length; i++) {
    const [to, high] = STOPS[i];
    if (at <= to || i === STOPS.length - 1) {
      const [from, low] = STOPS[i - 1];
      const share = Math.max(0, Math.min(1, (at - from) / (to - from)));
      const mix = low.map((value, k) => Math.round(value + (high[k] - value) * share));
      return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
    }
  }
  return 'rgb(255, 255, 255)';
}

type LineState = '' | 'lit' | 'miss';

interface StripLine {
  at: number;
  strength: number;
  /** Card slot of the element the line belongs to: its colour when lit. */
  slot?: number;
  state?: LineState;
}

function Strip({ lines, big }: { lines: readonly StripLine[]; big?: boolean }): JSX.Element {
  const width = big ? 1 : 1.6;
  return (
    <span class={`mg-strip ${big ? 'mg-strip-big' : ''}`}>
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {lines.map(({ at, strength, slot, state }) => {
          const height = 3 + 7 * strength;
          const top = (10 - height) / 2;
          const colour = colourAt(at);
          return (
            <g key={at} class={`mg-line ${state ? `is-${state}` : ''} ${slot !== undefined ? `mg-slot-${slot}` : ''}`} style={{ '--x': at }}>
              {big && <rect class="mg-line-halo" x={at - 3.2} y="0" width="6.4" height="10" />}
              <rect x={at - width * 1.4} y={top - 0.5} width={width * 2.8} height={height + 1} fill={colour} opacity="0.35" />
              <rect x={at - width / 2} y={top} width={width} height={height} fill={colour} />
              <rect class="mg-line-core" x={at - width / 5} y={top + 0.4} width={width / 2.5} height={height - 0.8} />
            </g>
          );
        })}
      </svg>
    </span>
  );
}

/** Wavelength marks under the rock's strip: the lines sit at their real wavelengths. */
function Axis(): JSX.Element {
  return (
    <span class="mg-axis" aria-hidden="true">
      {[400, 500, 600].map((nm) => (
        <span key={nm} style={{ left: `${atNm(nm)}%` }}>
          {nm}
        </span>
      ))}
      <span class="mg-axis-unit">{t('mg.spectro.nm')}</span>
    </span>
  );
}

/** Little ticks under the rock's strip: where the lines of the picked elements would be. */
function Marks({ picks }: { picks: { el: El; slot: number }[] }): JSX.Element {
  return (
    <span class="mg-marks" aria-hidden="true">
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" focusable="false">
        {picks.flatMap(({ el, slot }) =>
          LINES[el].map(([at]) => <rect key={`${el}-${at}`} class={`mg-mark mg-slot-${slot}`} x={at - 0.45} y="0" width="0.9" height="10" />),
        )}
      </svg>
    </span>
  );
}

// ----- The rock and the laser --------------------------------------------------------

const INK = '#2b2440';

/** A colour mixed towards white (k > 0) or black (k < 0), for the lit and shaded faces of a rock. */
function tint(hex: string, k: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const to = k >= 0 ? 255 : 0;
  const amount = Math.abs(k);
  const mix = (value: number): number => Math.round(value + (to - value) * amount);
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

/** The rock's outline, and its faces: one lit from above-left, two in shadow. */
const ROCK_SHAPE = 'M38 71 34 58 42 45 56 36 73 32 90 37 101 50 102 63 95 73 74 77 52 77Z';
const ROCK_LIGHT = 'M42 45 56 36 73 32 70 46 54 52Z';
const ROCK_SHADE = 'M90 37 101 50 102 63 95 73 84 64 86 50Z';
const ROCK_LOW = 'M52 77 74 77 95 73 84 64 66 67Z';
const ROCK_EDGES = 'M54 52 70 46 86 50 84 64 66 67 54 52M70 46 73 32M86 50 90 37M66 67 52 77M54 52 42 45';
/** Where the laser touches the rock. */
const SPARK: [number, number] = [60, 43];

function RockLooks({ look }: { look: RockLook }): JSX.Element {
  switch (look) {
    case 'rust':
      return (
        <g fill="#c8653f" stroke={INK} stroke-width="0.8">
          <ellipse cx="50" cy="60" rx="7" ry="3.2" />
          <ellipse cx="80" cy="44" rx="6" ry="2.8" />
          <ellipse cx="78" cy="66" rx="6.5" ry="2.8" />
          <ellipse cx="62" cy="55" rx="3.6" ry="1.8" />
        </g>
      );
    case 'vein':
      return (
        <>
          <path d="M36 64C48 56 58 62 68 52C76 45 88 49 101 42" stroke={INK} stroke-width="6.4" fill="none" stroke-linecap="round" />
          <path d="M36 64C48 56 58 62 68 52C76 45 88 49 101 42" stroke="#f4efe4" stroke-width="4" fill="none" stroke-linecap="round" />
          <path d="M40 61.6C48 57 54 59 62 55" stroke="#ffffff" stroke-width="1.3" fill="none" stroke-linecap="round" />
        </>
      );
    case 'salt':
      return (
        <g fill="#f6f2ea" stroke={INK} stroke-width="0.9">
          <ellipse cx="62" cy="36.5" rx="9" ry="3" />
          <ellipse cx="82" cy="39" rx="6" ry="2.4" />
          <ellipse cx="47" cy="45" rx="4.6" ry="2.2" />
          <circle cx="70" cy="55" r="1.8" />
          <circle cx="88" cy="58" r="1.5" />
          <circle cx="55" cy="66" r="1.4" />
        </g>
      );
    case 'layers':
      return (
        <g stroke={INK} stroke-width="1.6" fill="none" stroke-linecap="round" opacity="0.7">
          <path d="M40 54C58 50 76 56 100 50" />
          <path d="M37 62C58 58 78 64 101 58" />
          <path d="M42 70C60 67 78 71 98 67" />
        </g>
      );
    case 'specks':
      return (
        <g fill="#ffffff" stroke={INK} stroke-width="0.6">
          <circle cx="48" cy="58" r="1.8" />
          <circle cx="64" cy="51" r="1.4" />
          <circle cx="76" cy="60" r="2" />
          <circle cx="86" cy="46" r="1.5" />
          <circle cx="90" cy="64" r="1.7" />
          <circle cx="58" cy="70" r="1.4" />
          <circle cx="70" cy="40" r="1.2" />
        </g>
      );
    case 'holes':
      return (
        <g fill="#1d1f29">
          <circle cx="48" cy="59" r="2.4" />
          <circle cx="66" cy="52" r="1.8" />
          <circle cx="78" cy="63" r="2.6" />
          <circle cx="88" cy="48" r="1.6" />
          <circle cx="58" cy="70" r="1.8" />
          <circle cx="93" cy="62" r="2" />
        </g>
      );
    case 'sulfur':
      return (
        <g fill="#f2d84e" stroke={INK} stroke-width="0.8">
          <circle cx="50" cy="58" r="2.4" />
          <circle cx="72" cy="49" r="1.8" />
          <circle cx="80" cy="64" r="2.6" />
          <circle cx="60" cy="69" r="1.6" />
          <circle cx="92" cy="54" r="1.8" />
        </g>
      );
    case 'ice':
      return (
        <g fill="#d4f6ff" stroke={INK} stroke-width="0.8">
          <path d="M50 54l2.4 3.2-2.4 3.2-2.4-3.2Z" />
          <path d="M74 46l2 2.8-2 2.8-2-2.8Z" />
          <path d="M82 62l2.6 3.4-2.6 3.4-2.6-3.4Z" />
          <path d="M62 66l1.8 2.4-1.8 2.4-1.8-2.4Z" />
          <path d="M93 52l1.6 2.2-1.6 2.2-1.6-2.2Z" />
        </g>
      );
  }
}

/**
 * The rover's laser head on the left, its beam, and the rock with a bright spark where the
 * beam touches it. The light of the spark heads off to the right, to the rainbow strip.
 */
function RockScene({ rock, zap }: { rock: Rock; zap: number }): JSX.Element {
  const clip = useId();
  const [sx, sy] = SPARK;
  return (
    <svg class="mg-rock-art" viewBox="0 0 120 84" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}>
          <path d={ROCK_SHAPE} />
        </clipPath>
      </defs>
      {/* The light of the spark, spread out on its way to the strip. */}
      <g class="mg-rays-out" stroke-width="1.6" stroke-linecap="round" opacity="0.75">
        <path d={`M${sx} ${sy}L120 30`} stroke="#8a4cff" />
        <path d={`M${sx} ${sy}L120 36`} stroke="#34e27c" />
        <path d={`M${sx} ${sy}L120 42`} stroke="#ffe24c" />
        <path d={`M${sx} ${sy}L120 48`} stroke="#ff3e3e" />
      </g>
      <ellipse cx="70" cy="78" rx="38" ry="4.5" fill="rgba(0, 0, 0, 0.4)" />
      <path d={ROCK_SHAPE} fill={rock.color} />
      <path d={ROCK_LIGHT} fill={tint(rock.color, 0.22)} />
      <path d={ROCK_SHADE} fill={tint(rock.color, -0.32)} />
      <path d={ROCK_LOW} fill={tint(rock.color, -0.42)} />
      <g clip-path={`url(#${clip})`}>
        <RockLooks look={rock.look} />
      </g>
      <path d={ROCK_EDGES} fill="none" stroke={INK} stroke-width="1.1" stroke-linejoin="round" opacity="0.45" />
      <path d="M46 46.5 55 40.5M58 37.6l6-1.6" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" opacity="0.85" />
      <path d={ROCK_SHAPE} fill="none" stroke={INK} stroke-width="2.2" stroke-linejoin="round" />

      {/* The laser head on the rover's mast. */}
      <path d="M2 2 9 12" stroke={INK} stroke-width="5" stroke-linecap="round" />
      <path d="M2 2 9 12" stroke="#b6c1dc" stroke-width="2.6" stroke-linecap="round" />
      <rect x="4" y="9" width="24" height="16" rx="3.5" fill="#b6c1dc" />
      <rect x="4" y="9" width="24" height="11" rx="3.5" fill="#eef2fa" />
      <rect x="4" y="9" width="24" height="16" rx="3.5" fill="none" stroke={INK} stroke-width="2" />
      <rect x="8" y="13" width="7" height="3" rx="1.5" fill="#2b2440" />
      <circle cx="10" cy="21" r="1.4" fill="#ff5d6c" />
      <circle cx="29" cy="17" r="5.2" fill="#2b2440" />
      <circle cx="29" cy="17" r="3.2" fill="#ff5d7a" />
      <circle cx="28" cy="16" r="1.1" fill="#ffffff" />

      <path class="mg-beam-glow" d={`M31 18.4 ${sx} ${sy}`} />
      <path class="mg-beam" d={`M31 18.4 ${sx} ${sy}`} />
      <g transform={`translate(${sx} ${sy})`}>
        <g key={zap} class={`mg-spark ${zap ? 'is-zap' : ''}`}>
          <circle r="11" fill="rgba(255, 120, 160, 0.22)" />
          <circle r="6.5" fill="rgba(255, 236, 200, 0.6)" />
          <path d="M0-10 2-2 10 0 2 2 0 10-2 2-10 0-2-2Z" fill="#ffffff" stroke="#ffd6e4" stroke-width="0.6" />
          <circle r="2.2" fill="#ffffff" />
        </g>
        {zap > 0 && (
          <g key={`bits-${zap}`} class="mg-spark-bits">
            <path d="M3-3 9-9M-3-4-8-11M5 2 12 4M-5 2-12 1M1 5 3 12" stroke="#fff2c4" stroke-width="1.4" stroke-linecap="round" />
          </g>
        )}
      </g>
    </svg>
  );
}

// ----- The game ---------------------------------------------------------------------

type Verdict = null | 'right' | 'retry' | 'fail';
type Stage = 'brief' | 'play' | 'result';

const FACTS: Record<MinigameProps['site'], string[]> = {
  mars: ['mg.spectro.fact.colours', 'mg.spectro.fact.chemcam', 'mg.spectro.fact.million'],
  moon: ['mg.spectro.fact.colours', 'mg.spectro.fact.chemcam'],
};

interface RoundProps extends MinigameProps {
  again: boolean;
  onRetry: () => void;
}

export function Spectrometer(props: MinigameProps): JSX.Element {
  const [round, setRound] = useState(0);
  return <SpectroRound key={round} {...props} again={round > 0} onRetry={() => setRound((n) => n + 1)} />;
}

function SpectroRound({ site, level: askedLevel, onFinish, again, onRetry }: RoundProps): JSX.Element {
  const level = levelOf(askedLevel);
  const tune = SPECTRO_LEVELS[level];
  const { finish } = useFinish(onFinish);
  const later = useLater();
  const fact = useOneOf(FACTS[site]);
  const [rounds] = useState<Round[]>(() => makeRounds(site, tune));
  const [stage, setStage] = useState<Stage>(again ? 'play' : 'brief');
  const [leaving, setLeaving] = useState(false);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<El[]>([]);
  const [tries, setTries] = useState(0);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [results, setResults] = useState<boolean[]>([]);
  const [wrong, setWrong] = useState(0);
  const [zap, setZap] = useState(0);
  /** Elements of this rock already shown to be right by a wrong guess: their lines stay lit. */
  const [known, setKnown] = useState<El[]>([]);
  const hint = useFirstHint('spectro');

  const round = rounds[index];
  const rock = round.rock;
  const solved = results.filter(Boolean).length;
  const goals = spectroGoals(solved, wrong, tune);
  const won = goals[0];
  const checked = verdict !== null;
  const nameOf = (el: El): string => t(`mg.el.${el}`);
  const slotOf = (el: El): number => round.cards.indexOf(el);

  // Which of the rock's lines glow: on a check, every line a picked element explains (and the
  // missing ones blink); before it, on level 1 only, the lines of the picked elements.
  const showMatch = checked || tune.live;
  const lines: StripLine[] = rockLines(rock).map((line) => {
    const lit = (showMatch && picked.includes(line.el)) || known.includes(line.el);
    const missing = verdict === 'retry' && !picked.includes(line.el);
    const revealed = verdict === 'fail';
    return {
      at: line.at,
      strength: line.strength,
      slot: slotOf(line.el),
      state: lit || revealed ? 'lit' : missing ? 'miss' : '',
    };
  });
  const matches = picked.filter((el) => rock.els.includes(el)).length;

  const start = (): void => {
    if (stage !== 'brief' || leaving) return;
    audio.play('confirm');
    const go = (): void => {
      setLeaving(false);
      setStage('play');
      setZap((n) => n + 1);
      audio.play('zap');
    };
    if (calmMotion()) go();
    else {
      setLeaving(true);
      later(go, 240);
    }
  };

  const toggle = (el: El): void => {
    if (checked || stage !== 'play') return;
    const adding = !picked.includes(el);
    // On level 1 a right element lights its lines at once: a happy pop says so.
    if (adding && tune.live && rock.els.includes(el)) audio.play('pop', 3);
    else audio.play('click');
    // Two at most: a third pick replaces the oldest one.
    setPicked((now) => (now.includes(el) ? now.filter((item) => item !== el) : now.length >= 2 ? [now[1], el] : [...now, el]));
  };

  const check = (): void => {
    if (picked.length !== 2 || checked || stage !== 'play') return;
    const right = isRight(picked, rock);
    const used = tries + 1;
    setTries(used);
    setZap((n) => n + 1);
    audio.play('zap');
    if (hint.on) hint.done();
    if (right) {
      setVerdict('right');
      setResults((now) => [...now, true]);
      audio.play('discover');
      return;
    }
    setWrong((n) => n + 1);
    if (used < TRIES) {
      setVerdict('retry');
      setKnown(picked.filter((el) => rock.els.includes(el)));
      audio.play('bad');
    } else {
      setVerdict('fail');
      setResults((now) => [...now, false]);
      audio.play('bad');
    }
  };

  /** After a wrong first guess: keep the right card, let the wrong one go, and look again. */
  const tryAgain = (): void => {
    if (verdict !== 'retry') return;
    audio.play('click');
    setPicked((now) => now.filter((el) => rock.els.includes(el)));
    setVerdict(null);
  };

  const next = (): void => {
    if (verdict !== 'right' && verdict !== 'fail') return;
    if (index + 1 >= rounds.length) {
      audio.play(won ? 'win' : 'lose');
      setStage('result');
      return;
    }
    setIndex(index + 1);
    setPicked([]);
    setKnown([]);
    setTries(0);
    setVerdict(null);
    setZap((n) => n + 1);
    audio.play('card');
  };

  const hintText =
    picked.length === 0
      ? t('mg.spectro.task')
      : picked.length === 1
        ? t('mg.spectro.pickOne')
        : tune.live
          ? t('mg.spectro.liveCount', { n: lines.filter((line) => line.state === 'lit').length, total: lines.length })
          : t('mg.spectro.ready');

  // A first-time player is shown one card that belongs to the rock, then the Check button.
  const showHand = hint.on && stage === 'play' && !checked;
  const handCard = showHand && picked.length < 2 ? (round.cards.find((el) => rock.els.includes(el) && !picked.includes(el)) ?? null) : null;
  const handCheck = showHand && picked.length === 2;

  const starGoals = [t('mg.spectro.star1', { n: tune.toWin, total: tune.rounds }), t('mg.spectro.star2'), t('mg.spectro.star3')];
  // While playing, a goal shows as met only once nothing can undo it.
  const allChecked = results.length >= rounds.length;
  const goalState = (goalIndex: number): GoalState => {
    if (goalIndex === 0) return goals[0] ? 'met' : results.filter((item) => !item).length > tune.rounds - tune.toWin ? 'lost' : 'open';
    if (goalIndex === 1) return wrong > 1 ? 'lost' : allChecked && goals[1] ? 'met' : 'open';
    return wrong > 0 ? 'lost' : allChecked && goals[2] ? 'met' : 'open';
  };

  const over =
    stage === 'brief' ? (
      <Briefing
        icon="sample"
        art={<RockScene rock={rounds[0].rock} zap={1} />}
        title={t('mg.spectro.title')}
        intro={t('mg.spectro.intro')}
        how={t(tune.live ? 'mg.spectro.howLive' : tune.ticks ? 'mg.spectro.how' : 'mg.spectro.howPro')}
        goals={starGoals}
        onStart={start}
        onLeave={leaveBriefing}
        leaving={leaving}
      />
    ) : stage === 'result' ? (
      <Result
        won={won}
        game="spectro"
        stars={starsFor(goals)}
        title={t(won ? 'mg.spectro.win' : 'mg.spectro.lose', { n: solved, total: rounds.length })}
        goals={starGoals.map((text, goalIndex) => ({ text, met: goals[goalIndex] }))}
        stats={[
          { icon: 'sample', text: t('mg.spectro.statSolved', { n: solved, total: rounds.length }) },
          { icon: 'close', text: t('mg.spectro.statWrong', { n: wrong }) },
        ]}
        fact={t(fact)}
        onContinue={() => finish(won)}
        onRetry={won ? undefined : onRetry}
      />
    ) : null;

  const dots = (
    <ol class="mg-dots">
      {rounds.map((_, i) => {
        const result = results[i];
        const key = result === undefined ? 'mg.spectro.dotLater' : result ? 'mg.spectro.dotRight' : 'mg.spectro.dotWrong';
        return (
          <li key={i} class={result === undefined ? (i === index ? 'is-now' : '') : result ? 'is-right' : 'is-wrong'}>
            {result !== undefined && <Icon name={result ? 'check' : 'close'} size={13} />}
            <span class="mg-sr">{t(key, { n: i + 1 })}</span>
          </li>
        );
      })}
    </ol>
  );

  return (
    <Panel game="spectro" site={site} level={level} icon="sample" title={t('mg.spectro.title')} onLeave={stage === 'play' ? () => finish(false) : null} over={over}>
      <GoalLine text={t('mg.spectro.goal')}>{dots}</GoalLine>
      <StarTrack goals={starGoals.map((text, goalIndex) => ({ text, state: goalState(goalIndex) }))} />

      <div class={`mg-play cards-${round.cards.length}`}>
        <div key={`rock-${index}`} class={`mg-rock ${verdict === 'right' ? 'is-right' : verdict ? 'is-wrong' : ''}`}>
          <RockScene rock={rock} zap={zap} />
          <div class="mg-rock-info">
            <span class="mg-rock-top">
              <span class="mg-rock-name">{t(`mg.rock.${site}.${rock.id}.name`)}</span>
              <span class="mg-round">{t('mg.spectro.round', { n: index + 1, total: rounds.length })}</span>
            </span>
            <span class="mg-label">{t('mg.spectro.light')}</span>
            <span class={`mg-scan-wrap ${checked ? 'is-scan' : ''}`}>
              <Strip lines={lines} big />
              {checked && <span key={`scan-${zap}`} class="mg-scan" aria-hidden="true" />}
            </span>
            {tune.ticks && <Marks picks={picked.map((el) => ({ el, slot: slotOf(el) }))} />}
            <Axis />
          </div>
          {verdict === 'right' && <Burst count={10} class="mg-rock-burst" />}
        </div>

        <div class="mg-els" role="group" aria-label={t('mg.spectro.elements')}>
          {round.cards.map((el, slot) => {
            const isPicked = picked.includes(el);
            const inRock = rock.els.includes(el);
            const final = verdict === 'right' || verdict === 'fail';
            const mark = verdict === 'retry' ? (isPicked ? (inRock ? 'is-right' : 'is-wrong') : '') : final ? (inRock ? 'is-right' : isPicked ? 'is-wrong' : 'is-dim') : '';
            const glow = isPicked && tune.live && inRock && !checked ? 'is-match' : '';
            return (
              <button
                key={`${index}-${el}`}
                type="button"
                class={`mg-el mg-slot-${slot} ${isPicked ? 'is-picked' : ''} ${mark} ${glow}`}
                aria-pressed={isPicked}
                disabled={checked || stage !== 'play'}
                onPointerDown={(event) => tapRing(event)}
                onClick={() => toggle(el)}
              >
                <span class="mg-el-head">
                  <b class="mg-el-sym" aria-hidden="true">
                    {el}
                  </b>
                  <span class="mg-el-name">{nameOf(el)}</span>
                  {mark && mark !== 'is-dim' && (
                    <span class="mg-el-verdict" aria-hidden="true">
                      <Icon name={mark === 'is-right' ? 'check' : 'close'} size={16} />
                    </span>
                  )}
                </span>
                <Strip lines={LINES[el].map(([at, strength]: Line) => ({ at, strength }))} />
                {handCard === el && <HintHand x="72%" y="40%" label={t('mg.hint.tap')} class={slot % 2 === 1 ? 'mg-hand-left' : undefined} />}
              </button>
            );
          })}
        </div>
        <p class="mg-small">{t('mg.spectro.note')}</p>
      </div>

      <div class="mg-foot">
        {verdict === 'right' || verdict === 'fail' ? (
          <div class={`mg-verdict ${verdict === 'right' ? 'is-right' : 'is-wrong'}`}>
            <p role="status">
              <b>{t(verdict === 'right' ? 'mg.spectro.right' : 'mg.spectro.wrong', { a: nameOf(rock.els[0]), b: nameOf(rock.els[1]) })}</b>{' '}
              {t(`mg.rock.${site}.${rock.id}.fact`)}
            </p>
            <Btn kind="primary" iconRight="next" autoFocus onClick={next}>
              {t(index + 1 >= rounds.length ? 'mg.spectro.results' : 'mg.spectro.next')}
            </Btn>
          </div>
        ) : verdict === 'retry' ? (
          <div class="mg-verdict is-retry">
            <p role="status">
              <b>{t('mg.spectro.again')}</b> {t(matches === 1 ? 'mg.spectro.againOne' : 'mg.spectro.againNone')}
            </p>
            <Btn kind="primary" icon="back" autoFocus onClick={tryAgain}>
              {t('mg.spectro.tryAgain')}
            </Btn>
          </div>
        ) : (
          <div class="mg-ask">
            <p class="mg-hint">{hintText}</p>
            <span class="mg-hand-anchor">
              <Btn kind="primary" icon="check" disabled={picked.length !== 2 || stage !== 'play'} onClick={check}>
                {t('mg.spectro.check')}
              </Btn>
              {handCheck && <HintHand x="62%" y="55%" label={t('mg.hint.tap')} />}
            </span>
          </div>
        )}
      </div>
    </Panel>
  );
}
