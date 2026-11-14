/**
 * Send the data to Earth, at the radio desk: a rhythm game. Packets of the
 * day's science data slide along three lanes towards the antenna's line. Tap a
 * lane (or press 1/2/3 or J/K/L) when its packet reaches the line: perfect,
 * good, or missed. Each packet sent beams up to Earth. Send 70% or more to win;
 * the result shows how long the data will take to arrive from this world.
 *
 * Rules and the chart of packets: rhythm.ts. Packets move by the song clock,
 * so a slow screen never changes the timing.
 */
import type { JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { audio } from '../../game/audio';
import { fmtDelay, t } from '../../i18n';
import { Icon } from '../icons';
import type { IconName } from '../icons';
import type { MinigameProps } from './index';
import {
  Briefing,
  Burst,
  calmMotion,
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
  useFrames,
  useLater,
} from './kit';
import type { GoalState, Site } from './kit';
import { LANES, RHYTHM_LEVELS, WIN_SHARE, isLost, judgeTap, makeChart, noteFor, sentShare, signalGoals, signalWon } from './rhythm';
import type { Judgement } from './rhythm';

const INK = '#2b2440';

type Stage = 'brief' | 'count' | 'play' | 'over' | 'result';

/** What the packets carry: rock data, plant data, air data, weather, lab data, rover pictures. */
const CARGO: IconName[] = ['sample', 'plant', 'air', 'sun', 'science', 'rover'];
const KEYS: string[][] = [
  ['1', 'KeyJ'],
  ['2', 'KeyK'],
  ['3', 'KeyL'],
];
const KEY_LABEL = ['1 · J', '2 · K', '3 · L'];
/** A packet that was missed fades out over this long. */
const FADE_MS = 420;

/** The big dish antenna by the outpost: a white bowl on a pedestal, tipped up towards Earth. */
function Dish(): JSX.Element {
  return (
    <svg class="mg-dish" viewBox="0 0 80 80" aria-hidden="true" focusable="false">
      <path d="M29 79 35.5 50h13L55 79Z" fill="#c9d2ea" />
      <path d="M44 50h4.5L55 79h-7Z" fill="#7f8db5" />
      <path d="M33 61h18M31.4 70h21.2" stroke={INK} stroke-width="1.4" opacity="0.55" />
      <path d="M29 79 35.5 50h13L55 79Z" fill="none" stroke={INK} stroke-width="2.4" stroke-linejoin="round" />
      <circle cx="42" cy="48" r="6.2" fill="#dbe2f3" stroke={INK} stroke-width="2.2" />
      <circle cx="40.6" cy="46.6" r="1.6" fill="#ffffff" />
      <g transform="rotate(-35 40 36)">
        <path d="M14 30C15 45 65 45 66 30Z" fill="#9aa6c8" stroke={INK} stroke-width="2.4" stroke-linejoin="round" />
        <path d="M14 30C15 38 30 42 40 42.6 30 40 20 36 14 30Z" fill="#c9d2ea" />
        <ellipse cx="40" cy="30" rx="26" ry="8.4" fill="#f7f8fc" stroke={INK} stroke-width="2.4" />
        <ellipse cx="41" cy="31" rx="19" ry="5.4" fill="#dfe5f3" />
        <path d="M27 31.5 40 13.5M53 31.5 40 13.5" stroke={INK} stroke-width="1.5" />
        <path d="M40 31V14" stroke={INK} stroke-width="2.2" />
        <rect x="36.2" y="8" width="7.6" height="7.6" rx="1.8" fill="#f2c46d" stroke={INK} stroke-width="1.8" />
        <path d="M22 26.5C27 24.4 33 23.6 38 23.6" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" />
      </g>
      <circle class="mg-dish-light" cx="25.1" cy="10.4" r="2.4" />
    </svg>
  );
}

/** The Earth as the Moon sees it: big, blue, with clouds, half in night. From Mars it is only a bright dot. */
function EarthArt(): JSX.Element {
  const clip = useId();
  return (
    <svg class="mg-sig-globe" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}>
          <circle cx="24" cy="24" r="20" />
        </clipPath>
      </defs>
      <circle cx="24" cy="24" r="23.5" fill="rgba(120, 180, 255, 0.22)" />
      <circle cx="24" cy="24" r="20" fill="#2f6fd0" />
      <g clip-path={`url(#${clip})`}>
        <circle cx="20.5" cy="20.5" r="17.5" fill="#4f95ec" />
        <path d="M9 15c4-5 11-5 13-1s-2 8 2 11-1 9-6 7-5-7-9-8-4-5 0-9Z" fill="#62bf5c" stroke={INK} stroke-width="1.2" stroke-linejoin="round" />
        <path d="M28 30c3-2 7-1 9 2s-1 7-4 7-6-3-5-9Z" fill="#62bf5c" stroke={INK} stroke-width="1.2" stroke-linejoin="round" />
        <path d="M30 11c2-1 5 0 6 2s-2 3-4 3-3-3-2-5Z" fill="#e2c98c" stroke={INK} stroke-width="1" />
        <path d="M7 23c5-1 9 1 12 0M26 9c4-1 8 0 11 2M22 39c3 0 7-1 10-3" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" opacity="0.92" />
        <circle cx="47" cy="27" r="21" fill="rgba(6, 8, 28, 0.6)" />
      </g>
      <circle cx="24" cy="24" r="20" fill="none" stroke={INK} stroke-width="2" />
      <path d="M11.5 17a14 14 0 0 1 8-7" stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity="0.85" />
    </svg>
  );
}

/** Low hills along the bottom of the sky, with the outpost's dome. */
function Ground(): JSX.Element {
  return (
    <>
      <svg class="mg-sig-ground" viewBox="0 0 200 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M0 11 22 6 46 12 78 5 112 12 142 6 172 11 200 7V24H0Z" class="mg-sig-hill" />
        <path d="M0 11 22 6 46 12 78 5 112 12 142 6 172 11 200 7" fill="none" stroke={INK} stroke-width="2" vector-effect="non-scaling-stroke" />
      </svg>
      <svg class="mg-sig-dome" viewBox="0 0 40 22" aria-hidden="true" focusable="false">
        <path d="M3 21C3 11 10 4 20 4s17 7 17 17Z" fill="#eef2fa" />
        <path d="M24 4.5C31 6.5 37 12.5 37 21H28C28 13 27 8 24 4.5Z" fill="#b6c1dc" />
        <path d="M3 21C3 11 10 4 20 4s17 7 17 17Z" fill="none" stroke={INK} stroke-width="2" stroke-linejoin="round" />
        <path d="M14 21v-6a4 4 0 0 1 8 0v6" fill="#ffd98c" stroke={INK} stroke-width="1.6" />
        <path d="M8 14.6a12 12 0 0 1 6-7.4" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" />
      </svg>
    </>
  );
}

/** How long the data takes to reach Earth, with a dot that travels at the real speed. */
function DelayTrack({ site, delaySeconds }: { site: Site; delaySeconds?: number }): JSX.Element {
  const exact = delaySeconds !== undefined && delaySeconds > 0 ? delaySeconds : null;
  const seconds = exact ?? (site === 'moon' ? 1.3 : null);
  const [arrived, setArrived] = useState(false);
  const calm = calmMotion();
  useEffect(() => {
    // Only a short trip is worth waiting for on screen: from the Moon, it is over in a moment.
    if (seconds === null || seconds > 20) return undefined;
    const id = window.setTimeout(
      () => {
        setArrived(true);
        audio.play('blip', 4);
      },
      calm ? 0 : seconds * 1000,
    );
    return () => window.clearTimeout(id);
  }, []);
  const text =
    exact !== null
      ? t('mg.sig.delayExact', { delay: fmtDelay(exact) })
      : site === 'moon'
        ? t('mg.sig.delayMoon')
        : t('mg.sig.delayMars');
  return (
    <div class={`mg-delay ${arrived ? 'is-arrived' : ''}`}>
      <p class="mg-delay-text">
        <Icon name="antenna" size={16} /> {text}
      </p>
      <div class="mg-delay-track" aria-hidden="true">
        <span class="mg-delay-end">{t(`mg.sig.from.${site}`)}</span>
        <span class="mg-delay-line">
          <i style={{ animationDuration: `${seconds ?? 600}s` }} />
        </span>
        <span class="mg-delay-end">
          <Icon name="earth" size={15} /> {t('mg.sig.earth')}
        </span>
      </div>
      <p class="mg-delay-state" role="status">
        {arrived ? t('mg.sig.arrived') : t('mg.sig.onWay')}
      </p>
    </div>
  );
}

interface RoundProps extends MinigameProps {
  again: boolean;
  onRetry: () => void;
}

export function SignalRelay(props: MinigameProps): JSX.Element {
  const [round, setRound] = useState(0);
  return <SignalRound key={round} {...props} again={round > 0} onRetry={() => setRound((n) => n + 1)} />;
}

interface LaneFx {
  key: number;
  judge: Judgement | null;
}

function SignalRound({ site, level: askedLevel, delaySeconds, onFinish, again, onRetry }: RoundProps): JSX.Element {
  const level = levelOf(askedLevel);
  const tune = RHYTHM_LEVELS[level];
  const { finish, finished } = useFinish(onFinish);
  const later = useLater();
  const [chart] = useState(() => makeChart(tune, Math.floor(Math.random() * 0x7fffffff)));
  const notes = chart.notes;
  const total = notes.length;
  const [stage, setStage] = useState<Stage>(again ? 'count' : 'brief');
  const [counting, setCounting] = useState(again);
  const [leaving, setLeaving] = useState(false);
  const [, setTick] = useState(0);
  const bump = (): void => setTick((n) => n + 1);

  // Game state that changes many times a second lives in refs; the screen redraws on events.
  const done = useRef<boolean[]>(notes.map(() => false));
  const judged = useRef<(Judgement | null)[]>(notes.map(() => null));
  const judgedAt = useRef<number[]>(notes.map(() => 0));
  const score = useRef({ perfect: 0, good: 0, miss: 0, combo: 0, best: 0 });
  const clock = useRef({ start: 0, paused: 0, hiddenAt: 0, beat: -1 });
  const packets = useRef<(HTMLSpanElement | null)[]>([]);
  const lanesRef = useRef<HTMLDivElement>(null);
  const track = useRef({ startX: 22, hitX: 260 });
  const [fx, setFx] = useState<LaneFx[]>(() => Array.from({ length: LANES }, () => ({ key: 0, judge: null })));
  const [beams, setBeams] = useState<number[]>([]);
  const beamKey = useRef(0);
  const calm = calmMotion();
  const hint = useFirstHint('signal');

  const songTime = (): number => performance.now() - clock.current.start - clock.current.paused;

  // The lanes' size sets where packets start and where the line is: the middle of the gate,
  // 62 px from the lane's right end (signal.css).
  useEffect(() => {
    const lanes = lanesRef.current;
    if (!lanes) return undefined;
    const fit = (): void => {
      const lane = lanes.querySelector<HTMLElement>('.mg-lane');
      const width = lane ? lane.clientWidth : lanes.clientWidth - 16;
      track.current = { startX: 22, hitX: Math.max(120, width - 62) };
    };
    fit();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    observer?.observe(lanes);
    window.addEventListener('resize', fit);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);

  // The song clock stands still while the page is hidden.
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.hidden) clock.current.hiddenAt = performance.now();
      else if (clock.current.hiddenAt) {
        clock.current.paused += performance.now() - clock.current.hiddenAt;
        clock.current.hiddenAt = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const showFx = (lane: number, judge: Judgement | null): void => {
    setFx((now) => now.map((item, index) => (index === lane ? { key: item.key + 1, judge } : item)));
  };

  const place = (time: number): void => {
    const { startX, hitX } = track.current;
    notes.forEach((note, i) => {
      const el = packets.current[i];
      if (!el) return;
      const progress = 1 - (note.t - time) / tune.approachMs;
      const verdict = judged.current[i];
      const gone = verdict === 'perfect' || verdict === 'good' || (verdict === 'miss' && time - judgedAt.current[i] > FADE_MS);
      if (progress < 0 || gone) {
        el.style.visibility = 'hidden';
        return;
      }
      const x = startX + (hitX - startX) * progress;
      el.style.visibility = 'visible';
      el.style.transform = `translate3d(${x.toFixed(1)}px, -50%, 0)`;
      el.style.opacity = verdict === 'miss' ? String(Math.max(0, 1 - (time - judgedAt.current[i]) / FADE_MS)) : String(Math.min(1, progress / 0.08));
    });
  };

  const ended = useRef(false);
  const end = (): void => {
    if (ended.current) return;
    ended.current = true;
    const s = score.current;
    const hits = s.perfect + s.good;
    const won = signalWon(hits, total);
    audio.play('signal');
    later(() => audio.play(won ? 'win' : 'lose'), 650);
    setStage('over');
    later(() => setStage('result'), calm ? 500 : 1500);
  };

  useFrames(stage === 'play', () => {
    if (finished.current) return;
    const time = songTime();
    // A soft beat, so the rhythm can be felt.
    const beat = Math.floor(time / chart.beatMs);
    if (beat > clock.current.beat) {
      clock.current.beat = beat;
      if (beat >= 0 && time < chart.endMs - 600) audio.play('step', 1);
    }
    // Packets nobody tapped in time are lost.
    let changed = false;
    notes.forEach((note, i) => {
      if (done.current[i] || !isLost(time - note.t, tune)) return;
      done.current[i] = true;
      judged.current[i] = 'miss';
      judgedAt.current[i] = time;
      score.current.miss += 1;
      score.current.combo = 0;
      changed = true;
      showFx(note.lane, 'miss');
    });
    place(time);
    if (changed) bump();
    if (time > chart.endMs) end();
  });

  const hit = (lane: number): void => {
    if (stage !== 'play' || finished.current || ended.current) return;
    const time = songTime();
    const index = noteFor(notes, done.current, lane, time, tune);
    if (index < 0) {
      showFx(lane, null);
      audio.play('click');
      return;
    }
    const judge = judgeTap(time - notes[index].t, tune) ?? 'miss';
    done.current[index] = true;
    judged.current[index] = judge;
    judgedAt.current[index] = time;
    const s = score.current;
    if (judge === 'miss') {
      s.miss += 1;
      s.combo = 0;
      audio.play('down', 0);
    } else {
      if (judge === 'perfect') s.perfect += 1;
      else s.good += 1;
      s.combo += 1;
      s.best = Math.max(s.best, s.combo);
      audio.play('blip', notes[index].tone);
      // Every fifth packet in a row rings a little chime.
      if (s.combo % 5 === 0) audio.play('collect', Math.min(4, s.combo / 5));
      if (hint.on) hint.done();
      if (!calm) {
        beamKey.current += 1;
        const key = beamKey.current;
        setBeams((now) => [...now.slice(-5), key]);
      }
    }
    showFx(lane, judge);
    place(time);
    bump();
  };

  // Keys 1, 2, 3 or J, K, L tap the lanes.
  useEffect(() => {
    if (stage !== 'play' && stage !== 'count') return undefined;
    const onKey = (event: KeyboardEvent): void => {
      const lane = KEYS.findIndex((keys) => keys.includes(event.key) || keys.includes(event.code));
      if (lane < 0) return;
      event.preventDefault();
      if (!event.repeat) hit(lane);
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
    if (calm) go();
    else {
      setLeaving(true);
      later(go, 240);
    }
  };

  const s = score.current;
  const hits = s.perfect + s.good;
  const share = sentShare(hits, total);
  const possible = sentShare(total - s.miss, total);
  const goals = signalGoals(hits, total);
  const won = goals[0];
  const percent = Math.round(share * 100);
  const thresholds = [WIN_SHARE, 0.85, 0.95];
  const starGoals = [t('mg.sig.star1'), t('mg.sig.star2'), t('mg.sig.star3')];
  const goalState = (index: number): GoalState =>
    share >= thresholds[index] - 1e-9 ? 'met' : possible < thresholds[index] - 1e-9 ? 'lost' : 'open';
  const playing = stage === 'count' || stage === 'play';
  // A first-time player sees a hand tapping the gate of the lane the next packet comes along.
  const nextNote = hint.on && playing ? notes.findIndex((_, i) => !done.current[i]) : -1;
  const hintLane = nextNote >= 0 ? notes[nextNote].lane : -1;

  const over =
    stage === 'brief' ? (
      <Briefing
        icon="antenna"
        art={<Dish />}
        title={t('mg.sig.title')}
        intro={t(`mg.sig.intro.${site}`)}
        how={t('mg.sig.how')}
        goals={starGoals}
        onStart={start}
        onLeave={leaveBriefing}
        leaving={leaving}
      />
    ) : stage === 'result' ? (
      <Result
        won={won}
        game="signal"
        stars={starsFor(goals)}
        title={t(won ? 'mg.sig.win' : 'mg.sig.lose')}
        goals={starGoals.map((text, index) => ({ text, met: goals[index] }))}
        stats={[
          { icon: 'antenna', text: t('mg.sig.statSent', { n: percent }) },
          { icon: 'star', text: t('mg.sig.statPerfect', { n: s.perfect }) },
          { icon: 'power', text: t('mg.sig.statCombo', { n: s.best }) },
        ]}
        fact={t(`mg.sig.fact.${site}`)}
        extra={<DelayTrack site={site} delaySeconds={delaySeconds} />}
        onContinue={() => finish(won)}
        onRetry={won ? undefined : onRetry}
      />
    ) : null;

  return (
    <Panel game="signal" site={site} level={level} icon="antenna" title={t('mg.sig.title')} onLeave={playing ? () => finish(false) : null} over={over}>
      <GoalLine text={t('mg.sig.goal')}>
        <span class={`mg-target ${won ? 'is-3' : ''}`}>
          <Icon name="antenna" size={15} />
          <b>{percent}%</b>
        </span>
      </GoalLine>
      <StarTrack goals={starGoals.map((text, index) => ({ text, state: goalState(index) }))} />

      <div class="mg-play">
        <div class="mg-sig">
          <div class="mg-sig-sky" aria-hidden="true">
            <span class="mg-sig-earth">{site === 'moon' ? <EarthArt /> : <i />}</span>
            <span class="mg-sig-earth-name">{t('mg.sig.earth')}</span>
            <Ground />
            <Dish />
            {beams.map((key) => (
              <span key={key} class="mg-sig-beam" />
            ))}
          </div>

          <div class="mg-sig-meter">
            <span class="mg-sig-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('mg.sig.sent', { n: percent })}>
              <i class="is-possible" style={{ width: `${possible * 100}%` }} />
              <i class="is-sent" style={{ width: `${share * 100}%` }} />
              {thresholds.map((mark, index) => (
                <em key={index} class={`mg-sig-mark ${share >= mark - 1e-9 ? 'is-met' : ''}`} style={{ left: `${mark * 100}%` }}>
                  <b>{Math.round(mark * 100)}%</b>
                </em>
              ))}
            </span>
            <span class={`mg-combo ${s.combo >= 2 ? 'is-on' : ''} ${s.combo >= 5 ? 'is-hot' : ''}`}>
              {s.combo >= 2 && (
                <b key={s.combo}>
                  {t('mg.sig.combo', { n: s.combo })}
                </b>
              )}
            </span>
          </div>

          <div ref={lanesRef} class="mg-lanes">
            <span class="mg-hitline" aria-hidden="true" />
            {Array.from({ length: LANES }, (_, lane) => (
              <button
                key={lane}
                type="button"
                class={`mg-lane mg-lane-${lane}`}
                aria-label={t('mg.sig.lane', { n: lane + 1, keys: KEY_LABEL[lane] })}
                disabled={!playing}
                onPointerDown={(event) => {
                  event.preventDefault();
                  tapRing(event);
                  hit(lane);
                }}
                onClick={(event) => {
                  // A keyboard press on a focused lane (a pointer already counted on pointerdown).
                  if (event.detail === 0) hit(lane);
                }}
              >
                <span class="mg-lane-rail" aria-hidden="true" />
                <span class="mg-lane-port" aria-hidden="true">
                  <Icon name="science" size={16} />
                </span>
                {fx[lane].key > 0 && fx[lane].judge === 'miss' && <span key={`flash-${fx[lane].key}`} class="mg-lane-flash" aria-hidden="true" />}
                <span class="mg-gate" aria-hidden="true">
                  {fx[lane].key > 0 && <span key={`ring-${fx[lane].key}`} class={`mg-gate-ring ${fx[lane].judge ? `is-${fx[lane].judge}` : 'is-empty'}`} />}
                  {fx[lane].key > 0 && fx[lane].judge === 'perfect' && <Burst key={`burst-${fx[lane].key}`} count={8} class="mg-gate-burst" />}
                </span>
                {hintLane === lane && <HintHand x="calc(100% - 62px)" y="50%" label={t('mg.hint.tap')} class="mg-hand-left" />}
                <kbd class="mg-lane-key" aria-hidden="true">
                  {KEY_LABEL[lane]}
                </kbd>
                {fx[lane].key > 0 && fx[lane].judge && (
                  <span key={`judge-${fx[lane].key}`} class={`mg-judge is-${fx[lane].judge}`} aria-hidden="true">
                    {t(`mg.sig.${fx[lane].judge}`)}
                  </span>
                )}
                {notes.map((note, i) =>
                  note.lane === lane ? (
                    <span
                      key={i}
                      ref={(el) => {
                        packets.current[i] = el;
                      }}
                      class={`mg-packet ${judged.current[i] === 'miss' ? 'is-lost' : ''}`}
                      style={{ visibility: 'hidden' }}
                      aria-hidden="true"
                    >
                      <Icon name={CARGO[note.kind % CARGO.length]} size={18} />
                    </span>
                  ) : null,
                )}
              </button>
            ))}
            {counting && (
              <Countdown
                onGo={() => {
                  clock.current = { start: performance.now(), paused: 0, hiddenAt: 0, beat: -1 };
                  setStage('play');
                }}
                onEnd={() => setCounting(false)}
              />
            )}
          </div>

          {stage === 'over' && (
            <div class={`mg-stamp ${won ? '' : 'is-bad'}`} role="status">
              <Icon name="antenna" size={20} />
              {t(won ? 'mg.sig.stampWin' : 'mg.sig.stampLose')}
            </div>
          )}
        </div>
      </div>

      <div class="mg-foot">
        <p class="mg-note" aria-live="polite">
          {stage === 'over' ? t(won ? 'mg.sig.win' : 'mg.sig.lose') : t('mg.sig.hint')}
        </p>
      </div>
    </Panel>
  );
}
