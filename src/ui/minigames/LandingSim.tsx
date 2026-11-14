/**
 * Landing simulator, in the lander cockpit. A side view of a lander falling
 * towards a pad under the real gravity of Mars or the Moon. Hold THRUST (or
 * Space / ↑) to slow down; ← and → fire small side jets to stay over the pad.
 * Fuel runs out. Touch down slower than the safe speed, on the pad, to win.
 *
 * Rules and physics: lander.ts. Pictures: landingArt.ts.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { audio } from '../../game/audio';
import { num, t } from '../../i18n';
import { Icon } from '../icons';
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
import { EARTH_GRAVITY, GRAVITY, groundAt, landerGoals, landerTune, newLander, stepLander } from './lander';
import type { Lander, LanderInput, LanderTune } from './lander';
import { makeView, newScene, paintBackground, paintFrame, touchdownFx, updateScene } from './landingArt';

type Stage = 'brief' | 'count' | 'play' | 'down' | 'result';
type Side = -1 | 0 | 1;

interface Hud {
  /** Height above the ground under the lander, m. */
  alt: number;
  /** Speed up or down, m/s (always positive). */
  speed: number;
  rising: boolean;
  /** Share of the fuel left, 0 to 1. */
  fuel: number;
  /** Metres from the middle of the pad. */
  off: number;
}

function readHud(lander: Lander, tune: LanderTune): Hud {
  return {
    alt: Math.max(0, lander.y - groundAt(lander.x, tune.padHalf)),
    speed: Math.abs(lander.vy),
    rising: lander.vy > 0.05,
    fuel: tune.fuel > 0 ? lander.fuel / tune.fuel : 0,
    off: Math.abs(lander.x),
  };
}

/**
 * Time to brake: at full power the engine needs this much height to slow down to a
 * safe speed. Below it, the lander can no longer stop in time without help.
 */
function mustBrake(hud: Hud, tune: LanderTune): boolean {
  if (hud.rising || hud.speed <= tune.safeVy) return false;
  const brake = Math.max(0.1, tune.thrust - tune.g);
  const needed = (hud.speed * hud.speed - tune.safeVy * tune.safeVy) / (2 * brake);
  return needed > hud.alt * 0.85 - 2;
}

/** The lander as the briefing shows it: gold foil, a white cabin, legs out and a small flame. */
function LanderBadge(): JSX.Element {
  const ink = '#2b2440';
  return (
    <svg class="mg-lander-badge" viewBox="0 0 80 84" aria-hidden="true" focusable="false">
      <path d="M33 66q7 16 7 16t7-16Z" fill="#ffd36b" stroke="#ff9440" stroke-width="2" stroke-linejoin="round" />
      <path d="M37 66q3 8 3 8t3-8Z" fill="#fffbe8" />
      <path d="M24 56 13 74M56 56l11 18M27 52l-9 10M53 52l9 10" stroke={ink} stroke-width="5.5" stroke-linecap="round" />
      <path d="M24 56 13 74M56 56l11 18M27 52l-9 10M53 52l9 10" stroke="#c9cfdc" stroke-width="2.6" stroke-linecap="round" />
      <ellipse cx="13" cy="75" rx="6" ry="2.4" fill="#a3abbf" stroke={ink} stroke-width="2" />
      <ellipse cx="67" cy="75" rx="6" ry="2.4" fill="#a3abbf" stroke={ink} stroke-width="2" />
      <path d="M33 58h14l3 9H30Z" fill="#8e96b3" stroke={ink} stroke-width="2.2" stroke-linejoin="round" />
      <path d="M17 42h46l4 5v8l-4 4H17l-4-4v-8Z" fill="#c9952f" />
      <path d="M17 42h46l4 5v4H13v-4Z" fill="#f2c94c" />
      <path d="M17 42h46l4 5v8l-4 4H17l-4-4v-8Z" fill="none" stroke={ink} stroke-width="2.4" stroke-linejoin="round" />
      <path d="M24 26q0-12 16-12t16 12v16H24Z" fill="#c9cdd9" />
      <path d="M24 26q0-12 16-12 8 0 11 3-5-1-9 3-6 6-6 22H24Z" fill="#ffffff" />
      <path d="M24 26q0-12 16-12t16 12v16H24Z" fill="none" stroke={ink} stroke-width="2.4" stroke-linejoin="round" />
      <circle cx="40" cy="28" r="6.5" fill="#2a86b8" stroke={ink} stroke-width="2.2" />
      <path d="M36.8 25.8a4 4 0 0 1 3.4-2.2" stroke="#d3fbff" stroke-width="1.8" stroke-linecap="round" />
      <path d="M49 15l4-7" stroke={ink} stroke-width="2" stroke-linecap="round" />
      <circle cx="53.5" cy="7" r="2.6" fill="#ffd166" stroke={ink} stroke-width="1.6" />
      <path d="M18 46h20" stroke="#fff6d8" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  );
}

/** Gravity on Earth, Mars and the Moon as bars: the result card's picture. */
function GravityBars({ site }: { site: Site }): JSX.Element {
  const rows: { id: 'earth' | Site; g: number }[] = [
    { id: 'earth', g: EARTH_GRAVITY },
    { id: 'mars', g: GRAVITY.mars },
    { id: 'moon', g: GRAVITY.moon },
  ];
  return (
    <div class="mg-gravity">
      <p class="mg-gravity-title">{t('mg.land.gravityTitle')}</p>
      {rows.map((row) => (
        <div key={row.id} class={`mg-gravity-row is-${row.id} ${row.id === site ? 'is-here' : ''}`}>
          <span class="mg-gravity-name">{t(`mg.land.world.${row.id}`)}</span>
          <span class="mg-gravity-bar" aria-hidden="true">
            <i style={{ width: `${(row.g / EARTH_GRAVITY) * 100}%` }} />
          </span>
          <b>{t('mg.land.gUnit', { g: num(row.g, 2) })}</b>
        </div>
      ))}
    </div>
  );
}

interface RoundProps extends MinigameProps {
  again: boolean;
  onRetry: () => void;
}

export function LandingSim(props: MinigameProps): JSX.Element {
  const [round, setRound] = useState(0);
  return <LandingRound key={round} {...props} again={round > 0} onRetry={() => setRound((n) => n + 1)} />;
}

type Hold = 'thrust' | 'left' | 'right';

function LandingRound({ site, level: askedLevel, onFinish, again, onRetry }: RoundProps): JSX.Element {
  const level = levelOf(askedLevel);
  const { finish, finished } = useFinish(onFinish);
  const later = useLater();
  const [tune] = useState(() => landerTune(site, level));
  const [lander] = useState(() => newLander(tune));
  const [scene] = useState(() => newScene(tune, calmMotion()));
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<Stage>(again ? 'count' : 'brief');
  const [counting, setCounting] = useState(again);
  const [leaving, setLeaving] = useState(false);
  const keys = useRef<Record<Hold, boolean>>({ thrust: false, left: false, right: false });
  const pads = useRef<Record<Hold, boolean>>({ thrust: false, left: false, right: false });
  const input = useRef<LanderInput>({ thrust: false, side: 0 });
  const [held, setHeld] = useState<{ thrust: boolean; side: Side }>({ thrust: false, side: 0 });
  const [hud, setHud] = useState<Hud>(() => readHud(lander, tune));
  const hudAt = useRef(0);
  const sounds = useRef({ rumble: 0, lowFuel: false, empty: false, fast: false });
  const hint = useFirstHint('landing');

  const draw = (): void => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) paintFrame(ctx, scene, lander, tune);
  };

  // Keep the canvas as big as its box, sharp on every screen.
  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return undefined;
    const fit = (): void => {
      const w = Math.max(200, box.clientWidth);
      const h = Math.max(150, box.clientHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (scene.view.w === w && scene.view.h === h && scene.dpr === dpr && scene.bg) return;
      scene.view = makeView(w, h, tune);
      scene.dpr = dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      paintBackground(scene, tune);
      draw();
    };
    fit();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    observer?.observe(box);
    window.addEventListener('resize', fit);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);

  const sync = (): void => {
    const thrust = keys.current.thrust || pads.current.thrust;
    const right = keys.current.right || pads.current.right;
    const left = keys.current.left || pads.current.left;
    const side: Side = right && !left ? 1 : left && !right ? -1 : 0;
    input.current = { thrust, side };
    setHeld((now) => (now.thrust === thrust && now.side === side ? now : { thrust, side }));
    // The first time the engine fires, the hand on THRUST has done its job.
    if (thrust && hint.on) hint.done();
  };

  const release = (): void => {
    keys.current = { thrust: false, left: false, right: false };
    pads.current = { thrust: false, left: false, right: false };
    sync();
  };

  // Keys: Space, ↑ or W for the engine; ← → or A D for the side jets.
  useEffect(() => {
    if (stage !== 'count' && stage !== 'play') return undefined;
    const which = (code: string): Hold | null =>
      code === 'Space' || code === 'ArrowUp' || code === 'KeyW'
        ? 'thrust'
        : code === 'ArrowLeft' || code === 'KeyA'
          ? 'left'
          : code === 'ArrowRight' || code === 'KeyD'
            ? 'right'
            : null;
    const onKey = (event: KeyboardEvent): void => {
      const hold = which(event.code);
      if (!hold) return;
      event.preventDefault();
      keys.current[hold] = event.type === 'keydown';
      sync();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', release);
    };
  }, [stage]);

  const touchdown = (): void => {
    const landing = lander.landing;
    if (!landing) return;
    touchdownFx(scene, lander, tune);
    release();
    audio.play('land');
    later(() => audio.play(landing.won ? 'win' : 'lose'), 280);
    setStage('down');
    later(() => setStage('result'), calmMotion() ? 700 : 2100);
  };

  useFrames(stage === 'count' || stage === 'play' || stage === 'down', (dt, now) => {
    if (stage === 'play' && !finished.current && !lander.landing) {
      stepLander(lander, input.current, dt, tune);
      const said = sounds.current;
      if (lander.burning && now - said.rumble > 135) {
        said.rumble = now;
        audio.play('step', 1);
      }
      const state = readHud(lander, tune);
      if (!said.lowFuel && state.fuel < 0.25) {
        said.lowFuel = true;
        audio.play('alarm');
      }
      if (!said.empty && lander.fuel <= 0) {
        said.empty = true;
        audio.play('deny');
      }
      if (!said.fast && mustBrake(state, tune) && !lander.burning) {
        said.fast = true;
        audio.play('alarm');
      }
      if (lander.landing) touchdown();
    }
    updateScene(scene, lander, tune, dt);
    draw();
    if (now - hudAt.current > 90 || lander.landing) {
      hudAt.current = now;
      setHud(readHud(lander, tune));
    }
  });

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

  const playing = stage === 'count' || stage === 'play';
  const hold = (what: Hold) => ({
    onPointerDown: (event: PointerEvent): void => {
      if (!playing) return;
      event.preventDefault();
      tapRing(event, what === 'thrust' ? 'rgba(255, 190, 110, 0.95)' : 'rgba(127, 227, 255, 0.9)');
      try {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        /* some browsers refuse capture for synthetic events */
      }
      pads.current[what] = true;
      sync();
    },
    onPointerUp: (): void => {
      pads.current[what] = false;
      sync();
    },
    onPointerCancel: (): void => {
      pads.current[what] = false;
      sync();
    },
    onLostPointerCapture: (): void => {
      pads.current[what] = false;
      sync();
    },
    onContextMenu: (event: MouseEvent): void => event.preventDefault(),
  });

  const landing = lander.landing;
  const won = !!landing?.won;
  const goals = landerGoals(landing, tune);
  const starGoals = [t('mg.land.star1'), t('mg.land.star2', { v: num(tune.gentleVy, 1) }), t('mg.land.star3')];
  const goalState = (index: number): GoalState => (goals[index] ? 'met' : landing ? 'lost' : 'open');
  const speedState = hud.rising || hud.speed <= tune.safeVy ? 'is-safe' : hud.speed <= tune.safeVy * 1.6 ? 'is-warn' : 'is-bad';
  const [noteKey, alert] =
    stage === 'down' || stage === 'result'
      ? [won ? 'mg.land.win' : `mg.land.${landing?.result ?? 'hard'}`, !won]
      : lander.fuel <= 0
        ? ['mg.land.noFuel', true]
        : mustBrake(hud, tune) || (hud.alt < 25 && speedState !== 'is-safe')
          ? ['mg.land.tooFast', true]
          : hud.alt < 45 && hud.off > tune.padHalf
            ? ['mg.land.offPad', false]
            : ['mg.land.hint', false];

  const over =
    stage === 'brief' ? (
      <Briefing
        icon="rocket"
        art={<LanderBadge />}
        title={t('mg.land.title')}
        intro={t(`mg.land.intro.${site}`)}
        how={t('mg.land.how', { v: num(tune.safeVy, 1) })}
        goals={starGoals}
        note={t(`mg.land.note.${site}`, { g: num(tune.g, 2) })}
        onStart={start}
        onLeave={leaveBriefing}
        leaving={leaving}
      />
    ) : stage === 'result' && landing ? (
      <Result
        won={won}
        game="landing"
        stars={starsFor(goals)}
        title={t(won ? 'mg.land.win' : `mg.land.${landing.result}`)}
        goals={starGoals.map((text, index) => ({ text, met: goals[index] }))}
        stats={[
          { icon: 'arrow', text: t('mg.land.statSpeed', { v: num(landing.speed, 1) }) },
          { icon: 'radar', text: t('mg.land.statOff', { d: num(landing.off, 1) }) },
          { icon: 'battery', text: t('mg.land.statFuel', { n: Math.round(landing.fuelLeft * 100) }) },
        ]}
        fact={t(`mg.land.fact.${site}`)}
        extra={<GravityBars site={site} />}
        onContinue={() => finish(won)}
        onRetry={won ? undefined : onRetry}
      />
    ) : null;

  return (
    <Panel game="landing" site={site} level={level} icon="rocket" title={t('mg.land.title')} onLeave={playing ? () => finish(false) : null} over={over}>
      <GoalLine text={t('mg.land.goal', { v: num(tune.safeVy, 1) })}>
        <span class="mg-target mg-gee" title={t(`mg.land.note.${site}`, { g: num(tune.g, 2) })}>
          <b>{t('mg.land.gShort', { g: num(tune.g, 2) })}</b>
        </span>
      </GoalLine>
      <StarTrack goals={starGoals.map((text, index) => ({ text, state: goalState(index) }))} />

      <div class="mg-play">
        <div ref={boxRef} class={`mg-land ${held.thrust ? 'is-burning' : ''}`}>
          <canvas
            ref={canvasRef}
            class="mg-land-view"
            role="img"
            aria-label={t('mg.land.view', { h: num(hud.alt, 0), v: num(hud.speed, 1) })}
          />

          <div class="mg-land-hud">
            <div class="mg-gauge">
              <span class="mg-gauge-row">
                <span class="mg-gauge-name">{t('mg.land.alt')}</span>
                <b>{t('mg.land.meters', { n: num(hud.alt, 0) })}</b>
              </span>
              <span class={`mg-gauge-row mg-speed ${speedState}`}>
                <span class="mg-gauge-name">{t('mg.land.speed')}</span>
                <b>
                  {hud.rising ? '↑' : '↓'} {t('mg.land.mps', { v: num(hud.speed, 1) })}
                </b>
              </span>
              <span class="mg-safe" aria-hidden="true">
                <i style={{ width: `${Math.min(100, (hud.speed / (tune.safeVy * 3)) * 100)}%` }} />
                <em style={{ left: `${100 / 3}%` }} />
              </span>
            </div>
            <div class={`mg-gauge mg-fuel ${hud.fuel < 0.25 ? 'is-low' : ''}`}>
              <span class="mg-gauge-row">
                <span class="mg-gauge-name">{t('mg.land.fuel')}</span>
                <b>{Math.round(hud.fuel * 100)}%</b>
              </span>
              <span class="mg-fuel-bar" aria-hidden="true">
                <i style={{ width: `${hud.fuel * 100}%` }} />
              </span>
            </div>
          </div>

          <div class="mg-land-pads">
            <div class="mg-land-sides">
              <button
                type="button"
                class={`mg-pad-btn ${held.side === -1 ? 'is-on' : ''}`}
                aria-label={t('mg.land.left')}
                disabled={!playing}
                {...hold('left')}
              >
                <Icon name="back" size={26} />
              </button>
              <button
                type="button"
                class={`mg-pad-btn ${held.side === 1 ? 'is-on' : ''}`}
                aria-label={t('mg.land.right')}
                disabled={!playing}
                {...hold('right')}
              >
                <Icon name="next" size={26} />
              </button>
            </div>
            <button type="button" class={`mg-thrust ${held.thrust ? 'is-on' : ''}`} aria-label={t('mg.land.thrustLabel')} disabled={!playing} {...hold('thrust')}>
              <Icon name="rocket" size={28} />
              <span>{t('mg.land.thrust')}</span>
              {hint.on && playing && <HintHand x="50%" y="46%" mode="hold" label={t('mg.hint.hold')} class="mg-hand-left" />}
            </button>
          </div>

          {stage === 'down' && landing && (
            <div class={`mg-stamp ${won ? '' : 'is-bad'}`} role="status">
              <Icon name={won ? 'check' : 'warn'} size={20} />
              {t(won ? 'mg.land.stampWin' : 'mg.land.stampLose')}
            </div>
          )}
          {stage === 'down' && won && <Burst count={12} class="mg-land-burst" />}
          {counting && (
            <Countdown
              onGo={() => {
                setStage('play');
              }}
              onEnd={() => setCounting(false)}
            />
          )}
        </div>
      </div>

      <div class="mg-foot">
        <p class={`mg-note ${alert ? 'is-alert' : ''}`} aria-live="polite">
          {t(noteKey)}
        </p>
        <p class="mg-keys" aria-hidden="true">
          <kbd>Space</kbd> / <kbd>↑</kbd> {t('mg.land.keyThrust')} · <kbd>←</kbd> <kbd>→</kbd> {t('mg.land.keySide')}
        </p>
      </div>
    </Panel>
  );
}
