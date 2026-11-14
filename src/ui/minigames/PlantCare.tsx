/**
 * Plant care, inside the greenhouse. For about half a minute the plants ask for
 * water, light or nutrients. Pick the right tool and tap the plant before its
 * timer runs out, or it wilts for a while. The clock stops while the game is hidden.
 *
 * Every help shows the tool arriving (drops, a warm glow, sparkles of food),
 * the plant perks up, sparkles and grows a little. Rules: plants.ts.
 */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { audio } from '../../game/audio';
import { t } from '../../i18n';
import { Icon } from '../icons';
import type { IconName } from '../icons';
import type { MinigameProps } from './index';
import {
  Briefing,
  Burst,
  calmMotion,
  ClockIcon,
  Countdown,
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
import { NEEDS, gardenWon, newGarden, plantGoals, stepGarden, tapPot } from './plants';
import type { Garden, Need, PlantKind } from './plants';

const TICK_MS = 100;
const NOTE_MS = 2_200;
/** How long the pictures of a help (drops, glow, sparkles) last. */
const HAPPY_MS = 900;
/** Length of the timer ring around a request (2πr, r = 21). */
const RING = 131.95;

const NEED_ICON: Record<Need, IconName> = { water: 'water', light: 'sun', food: 'food' };
const FACTS = ['mg.plants.fact.lettuce', 'mg.plants.fact.radish'];

// ----- Pictures --------------------------------------------------------------
// Drawn like the rest of the game: a dark outline, a lit side and a hard shadow side,
// and small white highlights.

const INK = '#2b2440';

/** A leaf growing from (x, y), `len` long and `w` wide, leaning `angle` degrees: light on the left, shaded on the right. */
function Leaf({ x, y, len, w, angle, light, dark }: { x: number; y: number; len: number; w: number; angle: number; light: string; dark: string }): JSX.Element {
  const h = w / 2;
  const shape = `M0 0C${h * 1.3} ${-len * 0.18} ${h * 1.1} ${-len * 0.72} 0 ${-len}C${-h * 1.1} ${-len * 0.72} ${-h * 1.3} ${-len * 0.18} 0 0Z`;
  const shade = `M0 0C${h * 1.3} ${-len * 0.18} ${h * 1.1} ${-len * 0.72} 0 ${-len}C${h * 0.32} ${-len * 0.62} ${h * 0.26} ${-len * 0.28} 0 0Z`;
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <path d={shape} fill={light} />
      <path d={shade} fill={dark} />
      <path d={`M0 ${-len * 0.08}Q${h * 0.14} ${-len * 0.5} 0 ${-len * 0.84}`} stroke={dark} stroke-width="1.5" fill="none" stroke-linecap="round" />
      <path d={`M${-h * 0.5} ${-len * 0.3}Q${-h * 0.62} ${-len * 0.5} ${-h * 0.42} ${-len * 0.66}`} stroke="#ffffff" stroke-width="1.6" fill="none" stroke-linecap="round" opacity="0.7" />
      <path d={shape} fill="none" stroke={INK} stroke-width="2" stroke-linejoin="round" />
    </g>
  );
}

/** A stalk: a dark outline with a green line inside. */
function Stalk({ d, width = 4, colour = '#4c9a3c' }: { d: string; width?: number; colour?: string }): JSX.Element {
  return (
    <>
      <path d={d} stroke={INK} stroke-width={width + 3} fill="none" stroke-linecap="round" stroke-linejoin="round" />
      <path d={d} stroke={colour} stroke-width={width} fill="none" stroke-linecap="round" stroke-linejoin="round" />
    </>
  );
}

/** A round fruit: the shadow colour underneath, the lit colour pushed up and left, an outline and a shine. */
function Fruit({ cx, cy, r, light, dark }: { cx: number; cy: number; r: number; light: string; dark: string }): JSX.Element {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill={dark} />
      <circle cx={cx - r * 0.14} cy={cy - r * 0.14} r={r * 0.82} fill={light} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={INK} stroke-width="2" />
      <ellipse cx={cx - r * 0.42} cy={cy - r * 0.38} rx={r * 0.24} ry={r * 0.16} transform={`rotate(-35 ${cx - r * 0.42} ${cy - r * 0.38})`} fill="#ffffff" opacity="0.9" />
    </>
  );
}

/** A tomato's little green star of leaves on top. */
function Calyx({ x, y, size = 1 }: { x: number; y: number; size?: number }): JSX.Element {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${size})`}
      d="M0-2.6 1.6-6 2.4-1.8 6.4-1.4 2.8 1 3.4 4.6 0 2.4-3.4 4.6-2.8 1-6.4-1.4-2.4-1.8-1.6-6Z"
      fill="#5cb846"
      stroke={INK}
      stroke-width="1.2"
      stroke-linejoin="round"
    />
  );
}

/** A pepper hanging from a stalk at (x, y). */
function Pepper({ x, y, tilt, light, dark }: { x: number; y: number; tilt: number; light: string; dark: string }): JSX.Element {
  const shape = 'M0 0C6.5 1 9 9 8 19C7 28 2.5 33 0 36C-2.6 31-7.4 24-7.4 15C-7.4 7-5.6 1 0 0Z';
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt})`}>
      <path d={shape} fill={dark} />
      <path d={shape} transform="translate(-1.4 0) scale(0.72 0.95)" fill={light} />
      <path d="M-3.6 7C-4.6 13-4 20-2 25" stroke="#ffffff" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.8" />
      <path d={shape} fill="none" stroke={INK} stroke-width="2" stroke-linejoin="round" />
      <path d="M-5 1.2C-3 -2 3-2 5 1.2" stroke={INK} stroke-width="5" fill="none" stroke-linecap="round" />
      <path d="M-5 1.2C-3 -2 3-2 5 1.2" stroke="#4c9a3c" stroke-width="2.6" fill="none" stroke-linecap="round" />
    </g>
  );
}

/** A strawberry hanging at (x, y), with seeds and a green cap. */
function Berry({ x, y, tilt }: { x: number; y: number; tilt: number }): JSX.Element {
  const shape = 'M0 0C7.6-1 11 4 10 11C9 18 3.6 23 0 25C-3.6 23-9 18-10 11C-11 4-7.6-1 0 0Z';
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt})`}>
      <path d={shape} fill="#c8243f" />
      <path d={shape} transform="translate(-1.2 -0.4) scale(0.8 0.92)" fill="#ff4d6a" />
      <g fill="#ffe28a" stroke={INK} stroke-width="0.5">
        <ellipse cx="-4.6" cy="7" rx="0.9" ry="1.3" />
        <ellipse cx="1" cy="6" rx="0.9" ry="1.3" />
        <ellipse cx="5.4" cy="9.6" rx="0.9" ry="1.3" />
        <ellipse cx="-2" cy="13" rx="0.9" ry="1.3" />
        <ellipse cx="3.6" cy="15.4" rx="0.9" ry="1.3" />
        <ellipse cx="-0.6" cy="19.4" rx="0.9" ry="1.3" />
      </g>
      <path d={shape} fill="none" stroke={INK} stroke-width="2" stroke-linejoin="round" />
      <path d="M-8 1.6 -4 -2.4 0 1 4 -2.4 8 1.6 3 3.2 0 1.6-3 3.2Z" fill="#5cb846" stroke={INK} stroke-width="1.4" stroke-linejoin="round" />
    </g>
  );
}

/** Wheat ears: grains in pairs up a stalk tip. */
function Ear({ x, y, tilt }: { x: number; y: number; tilt: number }): JSX.Element {
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt})`} stroke={INK} stroke-width="1.3">
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <ellipse cx="-3.4" cy={-i * 5.6} rx="3" ry="4.8" transform={`rotate(-24 -3.4 ${-i * 5.6})`} fill="#f7d466" />
          <ellipse cx="3.4" cy={-i * 5.6 - 2.6} rx="3" ry="4.8" transform={`rotate(24 3.4 ${-i * 5.6 - 2.6})`} fill="#d9a93a" />
        </g>
      ))}
      <ellipse cx="0" cy="-23.4" rx="2.6" ry="4.6" fill="#f7d466" />
      <path d="M0-27V-36M-3-24-6-32M3-24 6-32" fill="none" stroke-width="1.1" stroke-linecap="round" />
    </g>
  );
}

/** Each plant drawn on a 100 x 100 box, growing up from the middle of the bottom edge. */
const PLANT_ART: Record<PlantKind, () => JSX.Element> = {
  lettuce: () => (
    <>
      <Leaf x={50} y={98} len={42} w={30} angle={-70} light="#6cc94c" dark="#3f9a37" />
      <Leaf x={50} y={98} len={42} w={30} angle={70} light="#6cc94c" dark="#3f9a37" />
      <Leaf x={50} y={98} len={52} w={34} angle={-38} light="#7fd65a" dark="#4ea83c" />
      <Leaf x={50} y={98} len={52} w={34} angle={38} light="#7fd65a" dark="#4ea83c" />
      <Leaf x={50} y={98} len={60} w={36} angle={-11} light="#97e46c" dark="#5cb846" />
      <Leaf x={50} y={98} len={56} w={34} angle={13} light="#aaef7e" dark="#62bf4b" />
    </>
  ),
  tomato: () => (
    <>
      <Stalk d="M50 100C50 78 46 56 52 22" width={4} />
      <Stalk d="M49 66C42 62 38 64 34 70M51 54C58 52 64 54 68 60" width={2.6} />
      <Leaf x={50} y={80} len={28} w={16} angle={-64} light="#6cc94c" dark="#3f9a37" />
      <Leaf x={50} y={60} len={26} w={15} angle={60} light="#6cc94c" dark="#3f9a37" />
      <Leaf x={51} y={42} len={22} w={13} angle={-52} light="#7fd65a" dark="#4ea83c" />
      <Leaf x={52} y={28} len={18} w={11} angle={34} light="#7fd65a" dark="#4ea83c" />
      <Fruit cx={33} cy={80} r={10.5} light="#ff5d4b" dark="#cc3026" />
      <Calyx x={34} y={70} />
      <Fruit cx={68} cy={70} r={11} light="#ff5d4b" dark="#cc3026" />
      <Calyx x={68} y={59.5} />
      <Fruit cx={44} cy={50} r={7.5} light="#ff8a52" dark="#d65a2a" />
      <Calyx x={44} y={43} size={0.8} />
    </>
  ),
  radish: () => (
    <>
      <Leaf x={50} y={84} len={46} w={22} angle={-40} light="#69ca5c" dark="#3f9a3c" />
      <Leaf x={50} y={84} len={46} w={22} angle={40} light="#69ca5c" dark="#3f9a3c" />
      <Leaf x={50} y={84} len={58} w={24} angle={-2} light="#82da6c" dark="#4caf50" />
      <path d="M50 101Q48.6 106 51 110" stroke={INK} stroke-width="2" fill="none" stroke-linecap="round" />
      <ellipse cx="50" cy="91" rx="14.5" ry="11.5" fill="#bf2b56" />
      <ellipse cx="48" cy="89.4" rx="12" ry="9.6" fill="#ee4f78" />
      <ellipse cx="50" cy="91" rx="14.5" ry="11.5" fill="none" stroke={INK} stroke-width="2" />
      <ellipse cx="43.4" cy="86.6" rx="3.6" ry="2.2" transform="rotate(-25 43.4 86.6)" fill="#ffffff" opacity="0.85" />
      <path d="M45 80.6C47 82 53 82 55 80.6" stroke={INK} stroke-width="1.6" fill="none" stroke-linecap="round" />
    </>
  ),
  pepper: () => (
    <>
      <Stalk d="M50 100V30" width={4} />
      <Stalk d="M50 72 37 58M50 60 64 48" width={2.8} />
      <Leaf x={50} y={84} len={26} w={14} angle={-58} light="#6cc94c" dark="#3f9a37" />
      <Leaf x={50} y={46} len={24} w={14} angle={-42} light="#7fd65a" dark="#4ea83c" />
      <Leaf x={50} y={40} len={24} w={14} angle={44} light="#7fd65a" dark="#4ea83c" />
      <Leaf x={50} y={32} len={22} w={14} angle={0} light="#97e46c" dark="#5cb846" />
      <Pepper x={36} y={57} tilt={8} light="#ff4b3c" dark="#c42a22" />
      <Pepper x={64} y={48} tilt={-10} light="#ffd02e" dark="#d99a12" />
    </>
  ),
  wheat: () => (
    <>
      <Stalk d="M42 100C42 80 38 60 33 38M50 100V30M58 100C58 80 62 60 67 38" width={2.6} colour="#d9c46a" />
      <Leaf x={45} y={96} len={34} w={9} angle={-38} light="#a9cc58" dark="#7ea33a" />
      <Leaf x={55} y={96} len={32} w={9} angle={40} light="#a9cc58" dark="#7ea33a" />
      <Ear x={33} y={38} tilt={-14} />
      <Ear x={50} y={30} tilt={0} />
      <Ear x={67} y={38} tilt={14} />
    </>
  ),
  strawberry: () => (
    <>
      <Stalk d="M50 100C50 86 48 72 50 56M50 80C44 74 38 70 31 68M50 74C56 68 62 64 69 62" width={2.8} />
      <Leaf x={50} y={58} len={24} w={20} angle={-48} light="#6cc94c" dark="#3f9a37" />
      <Leaf x={50} y={58} len={24} w={20} angle={48} light="#6cc94c" dark="#3f9a37" />
      <Leaf x={50} y={58} len={28} w={21} angle={0} light="#7fd65a" dark="#4ea83c" />
      <circle cx="73" cy="40" r="5.5" fill="#fffaf0" stroke={INK} stroke-width="1.6" />
      <circle cx="73" cy="40" r="2.2" fill="#ffd166" stroke={INK} stroke-width="1" />
      <Berry x={30} y={68} tilt={6} />
      <Berry x={69} y={63} tilt={-8} />
    </>
  ),
};

function PotArt(): JSX.Element {
  return (
    <svg class="mg-pot-art" viewBox="0 0 100 50" aria-hidden="true" focusable="false">
      <ellipse cx="50" cy="6" rx="40" ry="4.6" fill="#4a3226" stroke={INK} stroke-width="2" />
      <path d="M14 12H86L79 47H21Z" fill="#f3ebd8" />
      <path d="M61 12H86L79 47H58Z" fill="#cfc1a0" />
      <path class="mg-pot-band" d="M16.4 25H83.6L82 33H18Z" />
      <path d="M60.6 25H83.6L82 33H58.8Z" fill="rgba(43, 36, 64, 0.22)" />
      <path d="M24.5 16 27.6 42" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.85" />
      <path d="M14 12H86L79 47H21Z" fill="none" stroke={INK} stroke-width="2.4" stroke-linejoin="round" />
      <rect x="8" y="5" width="84" height="10" rx="3" fill="#fbf6ea" stroke={INK} stroke-width="2.4" />
      <path d="M10.4 11.2H89.6V12.4H10.4Z" fill="#d9cdb0" />
      <path d="M14 8.2H34" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  );
}

/** What arrives at the plant: drops of water, a warm glow of light, or sparkles of food. */
function HelpPicture({ need }: { need: Need }): JSX.Element {
  return (
    <span class={`mg-fx mg-fx-${need}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

// ----- The game ------------------------------------------------------------------

type Stage = 'brief' | 'count' | 'play' | 'over' | 'result';

interface RoundProps extends MinigameProps {
  /** A second try after a loss: no briefing, straight to the countdown. */
  again: boolean;
  onRetry: () => void;
}

export function PlantCare(props: MinigameProps): JSX.Element {
  const [round, setRound] = useState(0);
  return <PlantRound key={round} {...props} again={round > 0} onRetry={() => setRound((n) => n + 1)} />;
}

function PlantRound({ site, level: askedLevel, onFinish, again, onRetry }: RoundProps): JSX.Element {
  const level = levelOf(askedLevel);
  const { finish, finished } = useFinish(onFinish);
  const later = useLater();
  const fact = useOneOf(FACTS);
  // One game object, made once and changed in place by taps and by the clock, which then ask
  // for a redraw. Taps always read the newest state, even two taps before the next drawing.
  const [g] = useState<Garden>(() => newGarden(level));
  const [, setFrame] = useState(0);
  const redraw = (): void => setFrame((frame) => frame + 1);
  const [stage, setStage] = useState<Stage>(again ? 'count' : 'brief');
  const [counting, setCounting] = useState(again);
  const [leaving, setLeaving] = useState(false);
  const hint = useFirstHint('plants');
  const tune = g.tune;

  // The clock: runs only while playing, and stands still while the page is hidden.
  useEffect(() => {
    if (stage !== 'play') return undefined;
    let last = performance.now();
    const onVisibility = (): void => {
      last = performance.now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(now - last, 250);
      last = now;
      // After "Leave" the host may keep the game on screen for a moment: let it stand still.
      if (document.hidden || finished.current || g.phase !== 'play') return;
      for (const event of stepGarden(g, dt)) {
        if (event === 'wilt') audio.play('bad');
        else {
          audio.play(event === 'won' ? 'win' : 'lose');
          setStage('over');
          later(() => setStage('result'), calmMotion() ? 300 : 1400);
        }
      }
      redraw();
    }, TICK_MS);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [stage]);

  const pickTool = (need: Need): void => {
    if (g.phase === 'over') return;
    audio.play('click');
    g.tool = need;
    redraw();
  };

  // Keys 1, 2 and 3 pick the tools too.
  useEffect(() => {
    if (stage !== 'count' && stage !== 'play') return undefined;
    const onKey = (event: KeyboardEvent): void => {
      const index = ['1', '2', '3'].indexOf(event.key);
      if (index < 0 || event.repeat) return;
      pickTool(NEEDS[index]);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [stage]);

  const start = (): void => {
    if (stage !== 'brief' || leaving) return;
    audio.play('confirm');
    const go = (): void => {
      setLeaving(false);
      setStage('count');
      setCounting(true);
    };
    if (calmMotion()) go();
    else {
      setLeaving(true);
      later(go, 240);
    }
  };

  const tap = (index: number): void => {
    const result = tapPot(g, index);
    if (!result) return;
    if (result === 'good') {
      audio.play(g.streak >= 3 ? 'collect' : 'good', g.streak);
      // The first plant helped: the player knows how it works now.
      if (hint.on) hint.done();
    } else if (result === 'fine') audio.play('click');
    else audio.play('deny');
    redraw();
  };

  // A first-time player is shown the way: the tool the first asking plant wants, then the plant.
  const asking = hint.on && stage === 'play' ? g.pots.findIndex((pot) => pot.need && pot.wiltUntil <= g.time) : -1;
  const askingNeed = asking >= 0 ? g.pots[asking].need : null;
  const hintTool = askingNeed && g.tool !== askingNeed ? askingNeed : null;
  const hintPot = askingNeed && g.tool === askingNeed ? asking : -1;

  const secondsLeft = Math.ceil((tune.gameMs - g.time) / 1000);
  const timeShare = 1 - g.time / tune.gameMs;
  const note = g.note && g.time - g.note.at < NOTE_MS ? t(g.note.key, { n: g.note.n ?? 0 }) : t('mg.plants.hint');
  const won = gardenWon(g);
  const ended = stage === 'over' || stage === 'result';
  const goals = plantGoals(g);
  const starGoals = [t('mg.plants.star1', { goal: tune.goal, max: tune.maxWilts }), t('mg.plants.star2'), t('mg.plants.star3')];
  // While playing, a goal shows as met only once nothing can undo it.
  const goalState = (index: number): GoalState => {
    if (ended) return goals[index] ? 'met' : 'lost';
    if (index === 0) return g.wilts > tune.maxWilts ? 'lost' : g.helped >= tune.goal ? 'met' : 'open';
    if (index === 1) return g.wilts > 1 ? 'lost' : 'open';
    return g.wilts > 0 || g.mistakes > 1 ? 'lost' : 'open';
  };

  const over =
    stage === 'brief' ? (
      <Briefing
        icon="plant"
        art={
          <span class="mg-brief-plant">
            <svg class="mg-plant" viewBox="0 0 100 100" focusable="false">
              {PLANT_ART.strawberry()}
            </svg>
            <PotArt />
          </span>
        }
        title={t('mg.plants.title')}
        intro={t('mg.plants.intro')}
        how={t('mg.plants.how', { goal: tune.goal, max: tune.maxWilts })}
        goals={starGoals}
        onStart={start}
        onLeave={leaveBriefing}
        leaving={leaving}
      />
    ) : stage === 'result' ? (
      <Result
        won={won}
        game="plants"
        stars={starsFor(goals)}
        title={
          won
            ? t('mg.plants.win', { n: g.helped })
            : g.wilts > tune.maxWilts
              ? t('mg.plants.loseWilt')
              : t('mg.plants.loseScore', { n: g.helped, goal: tune.goal })
        }
        goals={starGoals.map((text, index) => ({ text, met: goals[index] }))}
        stats={[
          { icon: 'plant', text: t('mg.plants.statHelped', { n: g.helped }) },
          { icon: 'warn', text: t('mg.plants.statWilted', { n: g.wilts }) },
          { icon: 'close', text: t('mg.plants.statMistakes', { n: g.mistakes }) },
        ]}
        fact={t(fact)}
        onContinue={() => finish(won)}
        onRetry={won ? undefined : onRetry}
      />
    ) : null;

  return (
    <Panel
      game="plants"
      site={site}
      level={level}
      icon="plant"
      title={t('mg.plants.title')}
      onLeave={stage === 'count' || stage === 'play' ? () => finish(false) : null}
      over={over}
    >
      <GoalLine text={t('mg.plants.goal', { goal: tune.goal, max: tune.maxWilts })}>
        <span class={`mg-target ${g.helped >= tune.goal ? 'is-3' : ''}`}>
          <Icon name="plant" size={15} />
          <b>
            {g.helped}/{tune.goal}
          </b>
        </span>
      </GoalLine>
      <StarTrack goals={starGoals.map((text, index) => ({ text, state: goalState(index) }))} />

      <div class="mg-play">
        <div class="mg-stats">
          <span class={`mg-chip ${g.helped >= tune.goal ? 'is-good' : ''}`}>
            <Icon name="plant" size={16} />
            {t(g.helped > tune.goal ? 'mg.plants.helpedMore' : 'mg.plants.helped', { n: g.helped, goal: tune.goal })}
          </span>
          <span class={`mg-chip mg-chip-wilt ${g.wilts > tune.maxWilts ? 'is-bad' : g.wilts === tune.maxWilts ? 'is-warn' : ''}`}>
            <Icon name="plant" size={16} />
            {t('mg.plants.wilted', { n: g.wilts, max: tune.maxWilts })}
          </span>
          {g.streak >= 2 && !ended && (
            <span key={`streak-${g.streak}`} class="mg-chip mg-chip-streak">
              <Icon name="star" size={14} />
              {t('mg.plants.inRow', { n: g.streak })}
            </span>
          )}
        </div>

        <div class={`mg-garden ${ended ? (won ? 'is-won' : 'is-lost') : ''}`}>
          <div class={`mg-clock ${stage === 'play' && secondsLeft <= 8 ? 'is-low' : ''}`}>
            <span class="mg-timebar" aria-hidden="true">
              <i style={{ width: `${timeShare * 100}%` }} />
            </span>
            <span class="mg-time">
              <ClockIcon />
              {t('mg.plants.time', { n: secondsLeft })}
            </span>
          </div>
          {g.pots.map((pot, index) => {
            const name = t(`mg.plants.p.${pot.plant}`);
            const wilted = pot.wiltUntil > g.time;
            const happy = g.time - pot.happyAt < HAPPY_MS;
            const shake = g.time - pot.shakeAt < 400;
            const left = pot.need ? Math.max(0, 1 - (g.time - pot.needAt) / tune.needMs) : 0;
            const label = wilted
              ? t('mg.plants.pot.wilted', { plant: name })
              : pot.need
                ? t(`mg.plants.pot.${pot.need}`, { plant: name })
                : t('mg.plants.pot.fine', { plant: name });
            return (
              <button
                key={pot.plant}
                type="button"
                class={`mg-pot ${wilted ? 'is-wilted' : ''} ${happy ? 'is-happy' : ''} ${shake ? 'is-shake' : ''} ${pot.need ? 'is-asking' : ''}`}
                style={{ '--grow': Math.min(4, pot.growth), '--k': index }}
                aria-label={label}
                disabled={g.phase !== 'play'}
                onPointerDown={(event) => tapRing(event)}
                onClick={() => tap(index)}
              >
                <span class="mg-grow">
                  <svg class="mg-plant" viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
                    {PLANT_ART[pot.plant]()}
                  </svg>
                </span>
                <PotArt />
                {pot.need && (
                  <span key={`need-${pot.needAt}`} class={`mg-need mg-need-${pot.need} ${left > 0.5 ? 'is-ok' : left > 0.25 ? 'is-soon' : 'is-late'}`} aria-hidden="true">
                    <svg class="mg-ring" viewBox="0 0 48 48" focusable="false">
                      <circle class="mg-ring-track" cx="24" cy="24" r="21" />
                      <circle class="mg-ring-fill" cx="24" cy="24" r="21" style={{ strokeDasharray: `${RING}px`, strokeDashoffset: `${RING * (1 - left)}px` }} />
                    </svg>
                    <Icon name={NEED_ICON[pot.need]} size={22} />
                  </span>
                )}
                {happy && pot.got && <HelpPicture key={`fx-${pot.happyAt}`} need={pot.got} />}
                {happy && <Burst key={`burst-${pot.happyAt}`} count={7} class="mg-pot-burst" />}
                {happy && (
                  <span key={`plus-${pot.happyAt}`} class="mg-plus" aria-hidden="true">
                    +1
                  </span>
                )}
                {shake && (
                  <span key={`no-${pot.shakeAt}`} class="mg-nope" aria-hidden="true">
                    <Icon name="close" size={16} />
                  </span>
                )}
                {hintPot === index && <HintHand x="50%" y="46%" label={t('mg.hint.tap')} />}
              </button>
            );
          })}

          {counting && (
            <Countdown
              onGo={() => {
                g.phase = 'play';
                setStage('play');
              }}
              onEnd={() => setCounting(false)}
            />
          )}
        </div>
      </div>

      {!ended && (
        <div class="mg-tools" role="group" aria-label={t('mg.plants.tools')}>
          {NEEDS.map((need, index) => (
            <button
              key={need}
              type="button"
              class={`mg-tool mg-tool-${need} ${g.tool === need ? 'is-on' : ''} ${hintTool === need ? 'is-hint' : ''}`}
              aria-pressed={g.tool === need}
              onPointerDown={(event) => tapRing(event)}
              onClick={() => pickTool(need)}
            >
              <span class="mg-tool-icon" aria-hidden="true">
                <Icon name={NEED_ICON[need]} size={26} />
              </span>
              <span class="mg-tool-name">{t(`mg.plants.tool.${need}`)}</span>
              <kbd class="mg-key" aria-hidden="true">
                {index + 1}
              </kbd>
              {hintTool === need && <HintHand x="50%" y="40%" label={t('mg.hint.tap')} />}
            </button>
          ))}
        </div>
      )}

      <div class="mg-foot">
        <p class="mg-note" aria-live="polite">
          {ended ? (won ? t('mg.plants.bloom') : t('mg.plants.droop')) : note}
        </p>
      </div>
    </Panel>
  );
}
