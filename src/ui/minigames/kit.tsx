/**
 * Pieces every room game shares: the panel with its title, level and Leave
 * button; the goal line; the briefing card shown before a game; the 3-2-1
 * countdown; the star goals; the pointing hand that shows a first-time player
 * what to do; and the result card, where the stars land one by one and then
 * the room's reward. Games keep their own rules in plain .ts files next to them.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { audio } from '../../game/audio';
import { mission, room, roomGame, roomWon } from '../../game/store';
import { has, t } from '../../i18n';
import { ROOMS, roomRewardTaken } from '../../sim/outpost';
import type { GameId } from '../../sim/outpost';
import { Btn } from '../common';
import { Icon } from '../icons';
import type { IconName } from '../icons';
import type { Level, Site } from './score';

export { levelOf, starsFor } from './score';
export type { Level, Site } from './score';

// ----- Small helpers ------------------------------------------------------------------

/** Calm mode (Settings) or the system's "reduce motion": fewer and shorter animations. */
export function calmMotion(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.body.classList.contains('less-motion')) return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The wide layout of the panel (words on the left, the game on the right), as in minigames.css. */
export function isWide(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(min-aspect-ratio: 5/4) and (min-width: 600px)').matches;
}

/** Leave from the briefing card: nothing was played, so nothing is lost and no card opens. */
export function leaveBriefing(): void {
  audio.play('click');
  roomGame.value = null;
}

/** `onFinish` is called once only, whatever the player presses and however often. */
export function useFinish(onFinish: (won: boolean) => void): { finish: (won: boolean) => void; finished: { current: boolean } } {
  const finished = useRef(false);
  const latest = useRef(onFinish);
  latest.current = onFinish;
  const finish = (won: boolean): void => {
    if (finished.current) return;
    finished.current = true;
    latest.current(won);
  };
  return { finish, finished };
}

/** setTimeout that is cleared when the game closes. */
export function useLater(): (run: () => void, ms: number) => void {
  const ids = useRef<number[]>([]);
  useEffect(
    () => () => {
      for (const id of ids.current) window.clearTimeout(id);
    },
    [],
  );
  return (run, ms) => {
    ids.current.push(window.setTimeout(run, Math.max(0, ms)));
  };
}

/**
 * Calls `onFrame` on every screen frame while `active`. `dt` is in seconds and
 * never more than 0.05, so a slow frame slows the game down instead of jumping.
 * Frames stop while the page is hidden.
 */
export function useFrames(active: boolean, onFrame: (dt: number, now: number) => void): void {
  const latest = useRef(onFrame);
  latest.current = onFrame;
  useEffect(() => {
    if (!active) return undefined;
    let id = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      latest.current(dt, now);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    const onVisible = (): void => {
      last = performance.now();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active]);
}

/** One of several facts, picked once when the game opens. */
export function useOneOf<T>(items: readonly T[]): T {
  const [item] = useState(() => items[Math.floor(Math.random() * items.length)]);
  return item;
}

// ----- First-time help ----------------------------------------------------------------------

const HINT_KEY = 'fo.mg.hint.';

/** Has this game's first-time hint been seen on this device? Storage may be blocked: then it shows. */
export function hintSeen(game: string): boolean {
  try {
    return localStorage.getItem(HINT_KEY + game) === 'seen';
  } catch {
    return false;
  }
}

/**
 * The first round of a game shows a pointing hand. `done` hides it and remembers, per game,
 * that the player has seen it, so later rounds start without it.
 */
export function useFirstHint(game: string): { on: boolean; done: () => void } {
  const [on, setOn] = useState(() => !hintSeen(game));
  const done = (): void => {
    setOn(false);
    try {
      localStorage.setItem(HINT_KEY + game, 'seen');
    } catch {
      /* storage may be blocked: the hint simply shows again next time */
    }
  };
  return { on, done };
}

/**
 * A cartoon glove that points at a spot and taps it (or holds it down), with a ring where the
 * finger lands and an optional word. The fingertip sits at `x`, `y` inside the nearest
 * positioned parent. It never catches a tap.
 */
export function HintHand({
  x = '50%',
  y = '50%',
  mode = 'tap',
  label,
  class: className,
}: {
  x?: string;
  y?: string;
  mode?: 'tap' | 'hold';
  label?: string;
  class?: string;
}): JSX.Element {
  return (
    <span class={`mg-hand is-${mode} ${className ?? ''}`} style={{ '--hx': x, '--hy': y }} aria-hidden="true">
      <span class="mg-hand-ring" />
      <svg class="mg-hand-art" viewBox="0 0 48 64" focusable="false">
        <g transform="rotate(-26 19 3)" stroke="#2b2440" stroke-width="2.2" stroke-linejoin="round">
          <rect x="13" y="50" width="25" height="11" rx="3" fill="#f2c46d" />
          <path d="M14.2 56.5h22.6v1.6a1.9 1.9 0 0 1-1.9 1.9H16.1a1.9 1.9 0 0 1-1.9-1.9Z" fill="#c9973f" stroke="none" />
          <rect x="11" y="25" width="28" height="28" rx="10" fill="#d9d2ea" stroke="none" />
          <rect x="11" y="25" width="22" height="26" rx="9" fill="#fffaf0" stroke="none" />
          <rect x="11" y="25" width="28" height="28" rx="10" fill="none" />
          <rect x="23" y="21.5" width="8.5" height="12" rx="4.2" fill="#fffaf0" />
          <rect x="29.5" y="23.5" width="8" height="12" rx="4" fill="#efe9f6" />
          <rect x="34" y="27.5" width="6.5" height="11" rx="3.2" fill="#d9d2ea" />
          <ellipse cx="13.5" cy="39" rx="7.5" ry="4.6" transform="rotate(-38 13.5 39)" fill="#fffaf0" />
          <rect x="14" y="3" width="10" height="31" rx="5" fill="#d9d2ea" stroke="none" />
          <rect x="14" y="3" width="7.4" height="30" rx="3.7" fill="#fffaf0" stroke="none" />
          <rect x="14" y="3" width="10" height="31" rx="5" fill="none" />
          <path d="M16.6 7.5v6" stroke="#ffffff" stroke-width="2" stroke-linecap="round" />
        </g>
      </svg>
      {label && <span class="mg-hand-label">{label}</span>}
    </span>
  );
}

/**
 * A ring that opens where a finger (or the mouse) lands: every tap answers at once.
 * It lives outside the game's own elements, so it never upsets what the game draws.
 */
export function tapRing(event: { clientX: number; clientY: number; currentTarget: EventTarget | null }, tone = 'rgba(255, 244, 214, 0.9)'): void {
  if (calmMotion() || typeof document === 'undefined') return;
  let x = event.clientX;
  let y = event.clientY;
  // A key press "clicks" with no position: use the middle of the button.
  if (!x && !y && event.currentTarget instanceof HTMLElement) {
    const box = event.currentTarget.getBoundingClientRect();
    x = box.left + box.width / 2;
    y = box.top + box.height / 2;
  }
  const ring = document.createElement('span');
  ring.className = 'mg-tapring';
  ring.style.left = `${x}px`;
  ring.style.top = `${y}px`;
  ring.style.setProperty('--tone', tone);
  document.body.appendChild(ring);
  window.setTimeout(() => ring.remove(), 600);
}

// ----- Stars -----------------------------------------------------------------------------

const STAR = 'M12 2.6c.4 0 .7.2.9.6l2.3 4.7 5.2.8c.9.1 1.2 1.2.6 1.8l-3.8 3.7.9 5.2c.2.9-.8 1.6-1.6 1.1L12 18l-4.6 2.5c-.8.5-1.8-.2-1.6-1.1l.9-5.2-3.8-3.7c-.6-.6-.3-1.7.6-1.8l5.2-.8 2.3-4.7c.2-.4.6-.6 1-.6Z';

/** A plump star: gold when earned, a dark slot when not. */
export function StarShape({ on, size = 24 }: { on: boolean; size?: number }): JSX.Element {
  return (
    <svg class={`mg-star ${on ? 'is-on' : ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={STAR} class="mg-star-body" />
      {on && <path d="M9.2 8.4 11.2 4.6c.3-.5.8-.4.9.1l.3 2.3c0 .4-.3.7-.7.8l-1.9.9c-.5.2-.8-.1-.6-.3Z" class="mg-star-shine" />}
    </svg>
  );
}

/** Small stars in a row: how many a goal is worth. */
export function StarCount({ n }: { n: number }): JSX.Element {
  return (
    <span class="mg-starcount" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <StarShape key={i} on size={13} />
      ))}
    </span>
  );
}

/** Little lights that fly out of a point: for a win, a match, a happy plant. */
export function Burst({ count = 8, class: className }: { count?: number; class?: string }): JSX.Element {
  return (
    <span class={`mg-burst ${className ?? ''}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} style={{ '--i': i, '--n': count }} />
      ))}
    </span>
  );
}

// ----- The panel ---------------------------------------------------------------------------

interface PanelProps {
  /** The game's id: the panel gets the class `mg-<game>`. */
  game: string;
  site: Site;
  level: Level;
  icon: IconName;
  title: string;
  /** The Leave button; null hides it. */
  onLeave: (() => void) | null;
  children: ComponentChildren;
  /** The briefing or the result, laid over the whole panel. */
  over?: ComponentChildren;
  class?: string;
}

/**
 * The glass panel of a room game. Keys pressed inside it stay inside it (except
 * Escape, which the room uses to close the game), so Enter on a button never
 * also reaches the 3D room behind and starts the game again.
 */
export function Panel(props: PanelProps): JSX.Element {
  const titleId = useId();
  const covered = !!props.over;
  return (
    <section
      class={`mg mg-${props.game} mg-${props.site} mg-lv${props.level} ${covered ? 'has-over' : ''} ${props.class ?? ''}`}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') event.stopPropagation();
      }}
    >
      <div class="mg-in" inert={covered} aria-hidden={covered ? true : undefined}>
        <header class="mg-head">
          <span class="mg-badge" aria-hidden="true">
            <Icon name={props.icon} size={22} />
          </span>
          <h2 id={titleId}>{props.title}</h2>
          <span class="mg-lv" role="img" aria-label={t('mg.level', { n: props.level })} title={t('mg.level', { n: props.level })}>
            {[1, 2, 3].map((step) => (
              <i key={step} class={step <= props.level ? 'is-on' : ''} />
            ))}
          </span>
          {props.onLeave && (
            <Btn kind="ghost" small icon="back" class="mg-leave" onClick={props.onLeave}>
              {t('mg.leave')}
            </Btn>
          )}
        </header>
        {props.children}
      </div>
      {props.over}
    </section>
  );
}

/** The goal of the game in one line, with room on the right for a live target. */
export function GoalLine({ text, children }: { text: string; children?: ComponentChildren }): JSX.Element {
  return (
    <div class="mg-goal">
      <span class="mg-goal-mark" aria-hidden="true" />
      <p class="mg-goal-text">
        <b>{t('mg.goal')}</b> {text}
      </p>
      {children && <span class="mg-goal-side">{children}</span>}
    </div>
  );
}

export type GoalState = 'met' | 'open' | 'lost';

/** The three star goals while playing: met, still open, or out of reach. Shown on wide screens. */
export function StarTrack({ goals }: { goals: { text: string; state: GoalState }[] }): JSX.Element {
  return (
    <ol class="mg-track" aria-label={t('mg.starGoals')}>
      {goals.map((goal, index) => (
        <li key={index} class={`is-${goal.state}`}>
          <StarCount n={index + 1} />
          <span class="mg-track-text">{goal.text}</span>
          <span class="mg-track-mark" role="img" aria-label={t(`mg.goalState.${goal.state}`)}>
            {goal.state === 'met' ? <Icon name="check" size={14} /> : goal.state === 'lost' ? <Icon name="close" size={12} /> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ----- Before the game: the briefing and the countdown --------------------------------------

interface BriefingProps {
  icon: IconName;
  title: string;
  intro: string;
  how: string;
  /** The three star goals, easiest first. */
  goals: string[];
  /** One more short line under the goals (for example the gravity of this world). */
  note?: string;
  /** A small picture from the game, shown instead of the round icon. */
  art?: ComponentChildren;
  onStart: () => void;
  onLeave: () => void;
  /** Fading away after Start. */
  leaving?: boolean;
}

/** The card before a game: what is going on, how to play, and what the stars are for. */
export function Briefing(props: BriefingProps): JSX.Element {
  const headId = useId();
  return (
    <div class={`mg-over mg-over-brief ${props.leaving ? 'is-leaving' : ''}`} role="dialog" aria-modal="true" aria-labelledby={headId}>
      <div class="mg-card mg-brief">
        <div class="mg-card-a">
          {props.art ? (
            <span class="mg-brief-art" aria-hidden="true">
              {props.art}
            </span>
          ) : (
            <span class="mg-medal" aria-hidden="true">
              <Icon name={props.icon} size={30} />
            </span>
          )}
          <h3 id={headId} class="mg-card-title">
            {props.title}
          </h3>
          <p class="mg-brief-intro">{props.intro}</p>
        </div>
        <div class="mg-card-b">
          <p class="mg-brief-how">
            <span class="mg-brief-how-icon" aria-hidden="true">
              <Icon name="help" size={16} />
            </span>
            <span>{props.how}</span>
          </p>
          <ol class="mg-goals" aria-label={t('mg.starGoals')}>
            {props.goals.map((text, index) => (
              <li key={index}>
                <StarCount n={index + 1} />
                <span>{text}</span>
              </li>
            ))}
          </ol>
          {props.note && <p class="mg-brief-note">{props.note}</p>}
          <div class="mg-card-buttons">
            <Btn kind="ghost" icon="back" onClick={props.onLeave}>
              {t('mg.leave')}
            </Btn>
            <Btn kind="primary" icon="play" autoFocus onClick={props.onStart}>
              {t('mg.start')}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 3, 2, 1, Go! over the play area. `onGo` starts the game; `onEnd` comes when the "Go!" has faded. */
export function Countdown({ onGo, onEnd }: { onGo: () => void; onEnd: () => void }): JSX.Element | null {
  const [count, setCount] = useState(3);
  const go = useRef(onGo);
  const end = useRef(onEnd);
  go.current = onGo;
  end.current = onEnd;
  useEffect(() => {
    const beat = calmMotion() ? 500 : 650;
    let left = 3;
    // A pop for each number, a little higher each time, and a bright chord for "Go!".
    audio.play('pop', 0);
    const timer = window.setInterval(() => {
      left -= 1;
      if (left > 0) {
        setCount(left);
        audio.play('pop', 3 - left);
      } else if (left === 0) {
        setCount(0);
        audio.play('confirm');
        go.current();
      } else {
        window.clearInterval(timer);
        end.current();
      }
    }, beat);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div class="mg-count" aria-live="assertive">
      <span key={count} class={`mg-count-num ${count === 0 ? 'is-go' : ''}`}>
        {count === 0 ? t('mg.go') : count}
      </span>
    </div>
  );
}

// ----- After the game: the result card ----------------------------------------------------------

/** A small clock, for times (the icon set has none). */
export function ClockIcon({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2M9.5 3h5" />
    </svg>
  );
}

/** "0:42" */
export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** What this room's game pays the first time it is won in a week, in words, and whether it still will. */
export interface RoomReward {
  text: string;
  icon: IconName;
  /** Not collected yet this week: winning now pays it. */
  fresh: boolean;
}

/**
 * The reward of the room the cadet is standing in, for this game (the host pays it when the game
 * ends with a win). Null outside a room, or when the room's game pays nothing.
 */
export function roomReward(game: GameId): RoomReward | null {
  try {
    const state = mission.value;
    const here = room.value;
    if (!state || !here) return null;
    const entry = ROOMS.find((def) => def.id === here)?.games.find((item) => item.game === game);
    if (!entry) return null;
    const reward = entry.reward;
    const parts: string[] = [];
    if (reward.air && has('reward.air')) parts.push(t('reward.air', { n: reward.air }));
    if (reward.science && has('reward.science')) parts.push(t('reward.science', { n: reward.science }));
    if (reward.food && has('reward.food')) parts.push(t('reward.food', { n: reward.food }));
    if (reward.crop && has('reward.crop')) parts.push(t('reward.crop'));
    if (!parts.length) return null;
    const icon: IconName = reward.air ? 'air' : reward.science ? 'science' : reward.food ? 'food' : 'plant';
    return { text: parts.join(', '), icon, fresh: !roomRewardTaken(state) };
  } catch {
    return null;
  }
}

/** The reward line under the stars: what was earned, already collected, or what a win would give. */
export function RewardChip({ reward, won }: { reward: RoomReward; won: boolean }): JSX.Element | null {
  if (!won) {
    // After a loss, say what a win pays, unless this week's reward is collected already.
    if (!reward.fresh) return null;
    return (
      <p class="mg-reward is-locked">
        <Icon name="lock" size={15} />
        <span>{t('mg.reward.win', { reward: reward.text })}</span>
      </p>
    );
  }
  if (!reward.fresh) {
    return (
      <p class="mg-reward is-old">
        <Icon name="check" size={15} />
        <span>{t('mg.reward.again')}</span>
      </p>
    );
  }
  return (
    <p class="mg-reward is-fresh">
      <span class="mg-reward-icon" aria-hidden="true">
        <Icon name={reward.icon} size={18} />
      </span>
      <span>
        <small>{t('mg.reward.got')}</small>
        <b>{reward.text}</b>
      </span>
      <Burst count={8} class="mg-reward-burst" />
    </p>
  );
}

/** When the first star lands, and the time between stars (ms). */
export const STAR_FIRST_MS = 560;
export const STAR_GAP_MS = 440;

/**
 * Stars that land one at a time, each with a pop, a sparkle and a rising chime; then `onDone`.
 * Calm mode shows them all at once with one chime.
 */
export function useStarReveal(stars: number, onDone?: () => void): number {
  const calm = calmMotion();
  const [lit, setLit] = useState(calm ? stars : 0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (calm) {
      if (stars > 0) audio.play('star', stars - 1);
      done.current?.();
      return undefined;
    }
    const ids: number[] = [];
    for (let i = 0; i < stars; i++) {
      ids.push(
        window.setTimeout(() => {
          setLit(i + 1);
          audio.play('star', i);
        }, STAR_FIRST_MS + i * STAR_GAP_MS),
      );
    }
    ids.push(window.setTimeout(() => done.current?.(), STAR_FIRST_MS + Math.max(0, stars - 1) * STAR_GAP_MS + 380));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, []);
  return lit;
}

/** Three star slots: `lit` of them gold (each pops in as it lights), the others dark. */
export function StarRow({ stars, lit, big = 64, small = 50 }: { stars: number; lit: number; big?: number; small?: number }): JSX.Element {
  return (
    <div class="mg-stars3" role="img" aria-label={t('mg.starsGot', { n: stars })}>
      {[0, 1, 2].map((index) => {
        const on = index < lit;
        return (
          <span key={`${index}-${on}`} class={`mg-star-slot ${on ? 'is-on' : index < stars ? 'is-coming' : ''}`} style={{ '--k': index }}>
            <StarShape on={on} size={index === 1 ? big : small} />
            {on && <Burst count={8} class="mg-star-burst" />}
          </span>
        );
      })}
    </div>
  );
}

export interface ResultProps {
  won: boolean;
  stars: number;
  title: string;
  /** The three star goals and whether each was met. */
  goals: { text: string; met: boolean }[];
  stats: { icon: IconName | 'clock'; text: string }[];
  /** One true science sentence. */
  fact: string;
  /** Anything special for this game, under the fact. */
  extra?: ComponentChildren;
  /** This game's id: the card shows the room's reward after the stars. */
  game?: GameId;
  onContinue: () => void;
  /** Shown after a loss: play again without leaving. */
  onRetry?: () => void;
}

export function Result(props: ResultProps): JSX.Element {
  const headId = useId();
  const [reward] = useState(() => (props.game ? roomReward(props.game) : null));
  const [chip, setChip] = useState(false);
  // The win counts the moment its card shows: Escape or Leave must not lose the week's reward.
  useEffect(() => {
    if (props.won && props.game) roomWon.value = props.game;
  }, []);
  const lit = useStarReveal(props.stars, () => {
    setChip(true);
    if (reward && props.won && reward.fresh) audio.play('collect', 4);
  });
  return (
    <div class="mg-over mg-over-result" role="dialog" aria-modal="true" aria-labelledby={headId}>
      <div class={`mg-card mg-result ${props.won ? 'is-win' : 'is-lose'}`}>
        <div class="mg-card-a">
          <p class="mg-kicker">{t(props.won ? 'mg.done.win' : 'mg.done.lose')}</p>
          <StarRow stars={props.stars} lit={lit} />
          <h3 id={headId} class="mg-card-title" role="status">
            {props.title}
          </h3>
          {props.stats.length > 0 && (
            <ul class="mg-stats-line">
              {props.stats.map((stat, index) => (
                <li key={index}>
                  {stat.icon === 'clock' ? <ClockIcon size={14} /> : <Icon name={stat.icon} size={14} />}
                  {stat.text}
                </li>
              ))}
            </ul>
          )}
          {reward && (
            <div class={`mg-reward-slot ${chip ? 'is-shown' : ''}`} aria-live="polite">
              {chip && <RewardChip reward={reward} won={props.won} />}
            </div>
          )}
        </div>
        <div class="mg-card-b">
          <ul class="mg-checks" aria-label={t('mg.starGoals')}>
            {props.goals.map((goal, index) => (
              <li key={index} class={goal.met ? 'is-met' : ''}>
                <span class="mg-check-box" aria-hidden="true">
                  {goal.met ? <Icon name="check" size={14} /> : null}
                </span>
                <StarCount n={index + 1} />
                <span class="mg-check-text">
                  {goal.text}
                  <span class="mg-sr"> — {t(goal.met ? 'mg.goalState.met' : 'mg.goalState.open')}</span>
                </span>
              </li>
            ))}
          </ul>
          <div class="mg-fact">
            <span class="mg-fact-icon" aria-hidden="true">
              <Icon name="book" size={16} />
            </span>
            <p>
              <b>{t('mg.fact')}</b> {props.fact}
            </p>
          </div>
          {props.extra}
          <div class="mg-card-buttons">
            {props.onRetry && (
              <Btn kind="ghost" icon="back" onClick={props.onRetry}>
                {t('mg.retry')}
              </Btn>
            )}
            <Btn kind="primary" iconRight="next" autoFocus onClick={props.onContinue}>
              {t('mg.continue')}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
