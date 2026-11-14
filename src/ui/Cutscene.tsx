/**
 * The intro film at the start of a mission: the lander comes down, the camera flies over
 * the outpost, Mission Control and Lumi say why the crew is here, and a card sums up the
 * mission. Tap (or Space) to go on, Skip jumps to the card. The 3D shots live in
 * World.cinematic; this screen only says which shot comes with which line.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { audio } from '../game/audio';
import { finishIntro, introShot } from '../game/director';
import { mission, profile } from '../game/store';
import { lang, t } from '../i18n';
import { currentEnv } from '../sim/mission';
import type { MissionState } from '../sim/types';
import type { CineShot } from '../world/world';
import { Btn, SpeakBtn } from './common';
import { Icon, LumiFace } from './icons';
import type { IconName } from './icons';
import './cutscene.css';

type Speaker = 'caption' | 'mc' | 'lumi';

interface Beat {
  shot: CineShot;
  speaker: Speaker;
  line: number;
}

const SCRIPT: Beat[] = [
  { shot: 'approach', speaker: 'caption', line: 1 },
  { shot: 'approach', speaker: 'mc', line: 2 },
  { shot: 'touchdown', speaker: 'mc', line: 3 },
  { shot: 'base', speaker: 'mc', line: 4 },
  { shot: 'base', speaker: 'mc', line: 5 },
  { shot: 'crew', speaker: 'lumi', line: 6 },
  { shot: 'crew', speaker: 'lumi', line: 7 },
  { shot: 'crew', speaker: 'lumi', line: 8 },
  { shot: 'crew', speaker: 'mc', line: 9 },
];

/** Letters per second of the typewriter. */
const TYPE_SPEED = 42;

function params(m: MissionState): Record<string, string | number> {
  const env = currentEnv(m);
  const name = profile.value.name.trim();
  const mars = m.config.site === 'mars';
  const km = mars ? Math.round(env.earthDistanceKm / 1e6) : (Math.round(env.earthDistanceKm / 1000) * 1000).toLocaleString(lang.value === 'ru' ? 'ru-RU' : 'en-US');
  return {
    who: name ? t('story.who', { name }) : t('story.whoNone'),
    km,
    min: Math.max(1, Math.round(env.delaySeconds / 60)),
    weeks: m.config.weeks,
    where: t(`story.where.${m.config.site}`),
  };
}

export function Cutscene(): JSX.Element | null {
  const m = mission.value;
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(0);
  const started = useRef(performance.now());
  const lastShot = useRef<CineShot | null>(null);
  const atGoal = index >= SCRIPT.length;
  const beat = SCRIPT[Math.min(index, SCRIPT.length - 1)];
  const site = m?.config.site ?? 'mars';
  const text = m && !atGoal ? t(`story.${site}.${beat.line}`, params(m)) : '';
  const complete = shown >= text.length;

  // Each line starts its shot (once per shot) and types itself out.
  useEffect(() => {
    const shot = atGoal ? 'goal' : beat.shot;
    if (shot !== lastShot.current) {
      lastShot.current = shot;
      introShot(shot);
    }
    if (!atGoal && beat.speaker === 'mc') audio.play('signal');
    started.current = performance.now();
    setShown(0);
    if (atGoal) return;
    let frame = 0;
    const tick = (): void => {
      const letters = Math.floor(((performance.now() - started.current) / 1000) * TYPE_SPEED);
      setShown(letters);
      if (letters < text.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [index]);

  const next = (): void => {
    if (atGoal) return;
    if (!complete) {
      setShown(text.length);
      return;
    }
    audio.play('click');
    setIndex(index + 1);
  };
  const skip = (): void => {
    if (atGoal) return;
    audio.play('click');
    setIndex(SCRIPT.length);
  };

  // Space, Enter or E: on; Escape: skip (and on the card, start).
  const keys = useRef({ next, skip, atGoal });
  keys.current = { next, skip, atGoal };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const code = event.code;
      const go = code === 'Space' || code === 'Enter' || code === 'NumpadEnter' || code === 'KeyE';
      if (!go && code !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (keys.current.atGoal) {
        if (go || code === 'Escape') finishIntro();
      } else if (code === 'Escape') keys.current.skip();
      else keys.current.next();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (!m) return null;
  const p = params(m);

  return (
    <div class={`cutscene ${atGoal ? 'is-goal' : ''}`} role="dialog" aria-modal="true" aria-label={t('story.title')}>
      <i class="cut-bar is-top" aria-hidden="true" />
      <i class="cut-bar is-bottom" aria-hidden="true" />
      {!atGoal && (
        <>
          <button type="button" class="cut-skip" onClick={skip}>
            {t('story.skip')} <Icon name="next" size={16} />
          </button>
          <div class="cut-hit" onPointerDown={next} aria-hidden="true" />
          <div key={index} class={`cut-line speaker-${beat.speaker}`} aria-live="polite">
            {beat.speaker !== 'caption' && (
              <div class="cut-who">
                <span class="cut-face">{beat.speaker === 'lumi' ? <LumiFace mood="happy" size={38} /> : <Icon name="antenna" size={22} />}</span>
                <b>{t(beat.speaker === 'lumi' ? 'story.lumi' : 'story.mc')}</b>
              </div>
            )}
            <p class="cut-text">
              {text.slice(0, shown)}
              <span class="cut-rest">{text.slice(shown)}</span>
            </p>
            <div class="cut-foot">
              <span class="cut-progress" aria-hidden="true">
                {SCRIPT.map((_, n) => (
                  <i key={n} class={n < index ? 'is-done' : n === index ? 'is-now' : ''} />
                ))}
              </span>
              <SpeakBtn text={text} />
              <button type="button" class={`cut-next ${complete ? 'is-ready' : ''}`} onClick={next}>
                {t('story.tap')} <Icon name="next" size={16} />
              </button>
            </div>
          </div>
        </>
      )}
      {atGoal && <GoalCard weeks={Number(p.weeks)} where={String(p.where)} />}
    </div>
  );
}

const KEEP: { icon: IconName; key: string; tone: string }[] = [
  { icon: 'air', key: 'story.goal.air', tone: 'air' },
  { icon: 'food', key: 'story.goal.food', tone: 'food' },
  { icon: 'dose', key: 'story.goal.dose', tone: 'dose' },
];

const STEPS: { icon: IconName; key: string }[] = [
  { icon: 'calendar', key: 'story.goal.s1' },
  { icon: 'power', key: 'story.goal.s2' },
  { icon: 'walk', key: 'story.goal.s3' },
  { icon: 'check', key: 'story.goal.s4' },
];

function GoalCard({ weeks, where }: { weeks: number; where: string }): JSX.Element {
  return (
    <section class="cut-goal" aria-label={t('story.goal.title')}>
      <header>
        <small>{t('story.goal.kicker')}</small>
        <h2>{t('story.goal.title')}</h2>
        <p class="cut-goal-sub">{t('story.goal.sub', { weeks, where })}</p>
      </header>
      <div class="cut-goal-block">
        <b>{t('story.goal.keep')}</b>
        <div class="cut-chips">
          {KEEP.map((item) => (
            <span key={item.key} class={`cut-chip tone-${item.tone}`}>
              <Icon name={item.icon} size={20} /> {t(item.key)}
            </span>
          ))}
        </div>
        <p>{t('story.goal.keepNote')}</p>
      </div>
      <div class="cut-goal-block">
        <b>
          <Icon name="science" size={18} /> {t('story.goal.scienceTitle')}
        </b>
        <p>{t('story.goal.science')}</p>
      </div>
      <div class="cut-goal-block">
        <b>{t('story.goal.week')}</b>
        <ol class="cut-steps">
          {STEPS.map((item, n) => (
            <li key={item.key}>
              <span class="cut-step-icon">
                <Icon name={item.icon} size={20} />
                <em>{n + 1}</em>
              </span>
              <span>{t(item.key)}</span>
            </li>
          ))}
        </ol>
        <p class="cut-grow">
          <Icon name="build" size={16} /> {t('story.goal.grow')}
        </p>
      </div>
      <Btn kind="primary" icon="rocket" wide autoFocus onClick={finishIntro}>
        {t('story.goal.start')}
      </Btn>
    </section>
  );
}
