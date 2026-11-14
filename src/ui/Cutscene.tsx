/**
 * The film player (see game/films.ts). Each beat starts its 3D shot (World.cinematic), types
 * its line out and moves on by itself after a moment to read it. A tap finishes the line or
 * goes on at once, Skip jumps to the end card. The intro ends on the mission card, a task film
 * on its "why it matters" card, an event film just ends.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { audio } from '../game/audio';
import { filmShot, finishFilm, markFilmSeen } from '../game/director';
import { FILMS, beatKey, whyKeys } from '../game/films';
import type { Film, FilmId, TaskId } from '../game/films';
import { film, mission, profile, settings } from '../game/store';
import { playLine, prefetchLines, stopLine } from '../game/voice';
import { lang, t } from '../i18n';
import { currentEnv } from '../sim/mission';
import type { MissionState, SiteId } from '../sim/types';
import type { CineShot } from '../world/world';
import { Btn, SpeakBtn } from './common';
import { Icon, LumiFace } from './icons';
import type { IconName } from './icons';
import './cutscene.css';

/** Letters per second of the typewriter. */
const TYPE_SPEED = 42;

/** Seconds a typed line stays before the film goes on by itself: enough to read it slowly. */
export function readSeconds(text: string): number {
  return Math.min(9, Math.max(2.2, text.length / 17 + 0.8));
}

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
  const id = film.value;
  const m = mission.value;
  if (!id || !m) return null;
  // A new film starts from its first beat.
  return <FilmPlayer key={id} id={id} m={m} />;
}

function FilmPlayer({ id, m }: { id: FilmId; m: MissionState }): JSX.Element {
  const data: Film = FILMS[id];
  const beats = data.beats;
  const site = m.config.site;
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(0);
  const started = useRef(performance.now());
  const lastShot = useRef<CineShot | null>(null);
  const atCard = index >= beats.length;
  const beat = beats[Math.min(index, beats.length - 1)];
  const text = !atCard ? t(beatKey(beat, site), params(m)) : '';
  const complete = shown >= text.length;
  // The recorded voice (game/voice.ts): the film goes on a moment after the line ends instead of after a reading time.
  const lineKey = !atCard ? beatKey(beat, site) : '';
  const voiceOn = settings.value.voice;
  const [replay, setReplay] = useState(0);
  const [voiceEnd, setVoiceEnd] = useState<{ id: string; ended: boolean } | null>(null);
  const voiceId = `${index}:${replay}`;
  const voiceState: 'none' | 'playing' | 'done' = !voiceOn ? 'none' : voiceEnd?.id === voiceId ? (voiceEnd.ended ? 'done' : 'none') : 'playing';

  // Each beat starts its shot (once per shot) and types its line out.
  useEffect(() => {
    if (atCard && data.card === 'none') {
      finishFilm();
      return undefined;
    }
    const shot: CineShot | null = atCard ? (data.card === 'goal' ? 'goal' : null) : beat.shot;
    if (shot && shot !== lastShot.current) {
      lastShot.current = shot;
      filmShot(shot);
    }
    if (atCard) return undefined;
    // The intro tour counts as having seen each task's film.
    if (beat.task) markFilmSeen(`task.${beat.task}`);
    if (beat.speaker === 'mc') audio.play('signal');
    started.current = performance.now();
    setShown(0);
    let frame = 0;
    const tick = (): void => {
      const letters = Math.floor(((performance.now() - started.current) / 1000) * TYPE_SPEED);
      setShown(letters);
      if (letters < text.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [index]);

  // Each beat plays its recorded line; the voice stops when the beat changes, on skip and when the film ends.
  useEffect(() => {
    if (atCard || !voiceOn) return undefined;
    let live = true;
    void prefetchLines(beats.slice(index + 1, index + 3).map((next) => beatKey(next, site)), lang.value);
    void playLine(lineKey, lang.value, { text, fallback: settings.value.speak }).then((ended) => {
      if (live) setVoiceEnd({ id: voiceId, ended });
    });
    return () => {
      live = false;
      stopLine();
    };
  }, [index, replay, voiceOn]);

  // A typed line goes on by itself after a moment (a tap goes on at once). With a voice: when it has ended.
  useEffect(() => {
    if (atCard || !complete || voiceState === 'playing') return undefined;
    const wait = voiceState === 'done' ? 500 : readSeconds(text) * 1000;
    const timer = window.setTimeout(() => setIndex((now) => (now === index ? now + 1 : now)), wait);
    return () => window.clearTimeout(timer);
  }, [complete, index, voiceState]);

  const next = (): void => {
    if (atCard) return;
    if (!complete) {
      setShown(text.length);
      return;
    }
    audio.play('click');
    setIndex(index + 1);
  };
  const skip = (): void => {
    if (atCard) return;
    audio.play('click');
    if (data.card === 'none') finishFilm();
    else setIndex(beats.length);
  };

  // Space, Enter or E: on; Escape: skip (and on the card, close it).
  const keys = useRef({ next, skip, atCard });
  keys.current = { next, skip, atCard };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const code = event.code;
      const go = code === 'Space' || code === 'Enter' || code === 'NumpadEnter' || code === 'KeyE';
      if (!go && code !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (keys.current.atCard) finishFilm();
      else if (code === 'Escape') keys.current.skip();
      else keys.current.next();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const p = params(m);
  const short = beats.length <= 3;

  return (
    <div class={`cutscene ${atCard ? 'is-goal' : ''} ${short ? 'is-short' : ''} film-${id.replace('.', '-')}`} role="dialog" aria-modal="true" aria-label={t(id === 'intro' ? 'story.title' : 'film.title')}>
      <i class="cut-bar is-top" aria-hidden="true" />
      <i class="cut-bar is-bottom" aria-hidden="true" />
      {!atCard && (
        <>
          <button type="button" class="cut-skip" onClick={skip}>
            {t('story.skip')} <Icon name="next" size={16} />
          </button>
          <div class="cut-hit" onPointerDown={next} aria-hidden="true" />
          <div key={index} class={`cut-line speaker-${beat.speaker}`} aria-live="polite">
            {beat.speaker !== 'caption' && (
              <div class="cut-who">
                <span class="cut-face">{beat.speaker === 'lumi' ? <LumiFace mood={id === 'lose' ? 'sad' : id === 'storm' ? 'alert' : 'happy'} size={38} /> : <Icon name="antenna" size={22} />}</span>
                <b>{t(beat.speaker === 'lumi' ? 'story.lumi' : 'story.mc')}</b>
              </div>
            )}
            <p class="cut-text">
              {text.slice(0, shown)}
              <span class="cut-rest">{text.slice(shown)}</span>
            </p>
            <div class="cut-foot">
              {beats.length > 1 && (
                <span class="cut-progress" aria-hidden="true">
                  {beats.map((_, n) => (
                    <i key={n} class={n < index ? 'is-done' : n === index ? 'is-now' : ''} />
                  ))}
                </span>
              )}
              <SpeakBtn text={text} voiceKey={lineKey} auto={!voiceOn} onPlay={voiceOn ? () => setReplay((n) => n + 1) : undefined} />
              <button type="button" class={`cut-next ${complete ? 'is-ready' : ''}`} onClick={next}>
                {t('story.tap')} <Icon name="next" size={16} />
              </button>
            </div>
          </div>
        </>
      )}
      {atCard && data.card === 'goal' && <GoalCard weeks={Number(p.weeks)} where={String(p.where)} />}
      {atCard && data.card === 'why' && data.task && <WhyCard task={data.task} site={site} />}
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
      <Btn kind="primary" icon="rocket" wide autoFocus onClick={finishFilm}>
        {t('story.goal.start')}
      </Btn>
    </section>
  );
}

/** The icon of each task on its card. */
const TASK_ICON: Record<TaskId, IconName> = {
  forecast: 'calendar',
  plan: 'power',
  air: 'air',
  food: 'food',
  lab: 'science',
  shield: 'dose',
  walk: 'walk',
  event: 'check',
  earth: 'antenna',
  night: 'calendar',
};

function WhyCard({ task, site }: { task: TaskId; site: SiteId }): JSX.Element {
  const keys = whyKeys(task, site);
  const calm = settings.value.lessMotion;
  return (
    <section class={`cut-goal cut-why ${calm ? 'is-calm' : ''}`} aria-label={t(keys.title)}>
      <header>
        <small>{t('film.card.kicker')}</small>
        <h2>
          <Icon name={TASK_ICON[task]} size={26} /> {t(keys.title)}
        </h2>
      </header>
      <div class="cut-goal-block">
        <b>{t('film.card.what')}</b>
        <p>{t(keys.what)}</p>
      </div>
      <div class="cut-goal-block">
        <b>{t('film.card.whyTitle')}</b>
        <p>{t(keys.why)}</p>
      </div>
      <div class="cut-goal-block cut-why-fact">
        <b>
          <LumiFace mood="happy" size={26} /> {t('film.card.fact')}
        </b>
        <p>{t(keys.fact)}</p>
        <small class="cut-why-src">{t('film.card.src', { src: t(keys.src) })}</small>
      </div>
      <Btn kind="primary" icon="check" wide autoFocus onClick={finishFilm}>
        {t('film.card.ok')}
      </Btn>
    </section>
  );
}
