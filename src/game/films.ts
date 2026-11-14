/**
 * The films: short cutscenes made of beats. A beat is one line said over one camera shot
 * (see World.cinematic for the shots).
 *
 * - The intro tells how the mission began and then walks through every task of a week:
 *   what it is and why it matters.
 * - A task film replays one task with a card that explains it: what to do, why it matters,
 *   and a real fact with its source. The plan, walk, event and night films play by themselves the
 *   first time their task comes up if the intro tour did not show it; the "Why?" buttons replay
 *   any task's film between steps.
 * - Event films show the big moments: a solar storm, a dust storm, the first harvest, the
 *   first new building, and the end of the mission.
 *
 * Text keys may contain `{site}`, which becomes `mars` or `moon`.
 */
import type { SiteId } from '../sim/types';
import type { CineShot } from '../world/world';

export type FilmSpeaker = 'caption' | 'mc' | 'lumi';

/** The tasks of a week, in the order they come up. */
export const TASKS = ['forecast', 'plan', 'air', 'food', 'lab', 'shield', 'walk', 'event', 'earth', 'night'] as const;
export type TaskId = (typeof TASKS)[number];

export type EventFilmId = 'storm' | 'dust' | 'eclipse' | 'conjunction' | 'harvest' | 'built' | 'win' | 'lose';
export type FilmId = 'intro' | `task.${TaskId}` | EventFilmId;

export interface FilmBeat {
  shot: CineShot;
  speaker: FilmSpeaker;
  /** Text key; `{site}` is replaced by the world. */
  key: string;
  /** Showing this beat counts as having seen this task's film. */
  task?: TaskId;
}

export interface Film {
  id: FilmId;
  beats: FilmBeat[];
  /** The card at the end: the mission card, a "why it matters" card, or none. */
  card: 'goal' | 'why' | 'none';
  /** The task whose card closes the film. */
  task?: TaskId;
  /** Landing shots: the lander starts high in the sky and the other cadets stay out of view. */
  landing?: boolean;
  /** Sites the film can play on (all when missing). */
  sites?: SiteId[];
}

/** The camera place of every task: the building that does the job. */
export const TASK_SHOT: Record<TaskId, CineShot> = {
  forecast: 'spot:sky',
  plan: 'spot:solar',
  air: 'spot:hab',
  food: 'spot:farm',
  lab: 'spot:lab',
  shield: 'spot:shield',
  walk: 'spot:airlock',
  event: 'spot:far',
  earth: 'spot:sky',
  night: 'spot:overview',
};

/** The line Lumi says about a task (the intro tour and the task film share it). */
export function taskLine(task: TaskId): string {
  // The power line of the old intro already says it well for each world.
  if (task === 'plan') return 'story.{site}.8';
  if (task === 'earth') return 'film.task.earth.say.{site}';
  return `film.task.${task}.say`;
}

function taskBeat(task: TaskId, speaker: FilmSpeaker = 'lumi'): FilmBeat {
  return { shot: TASK_SHOT[task], speaker, key: taskLine(task), task };
}

/** The tasks the intro tour shows (the radio delay is in the story's last line). */
export const TOUR: TaskId[] = ['forecast', 'plan', 'air', 'food', 'lab', 'shield', 'walk', 'event', 'night'];

const INTRO: Film = {
  id: 'intro',
  landing: true,
  card: 'goal',
  beats: [
    { shot: 'approach', speaker: 'caption', key: 'story.{site}.1' },
    { shot: 'approach', speaker: 'mc', key: 'story.{site}.2' },
    { shot: 'touchdown', speaker: 'mc', key: 'story.{site}.3' },
    { shot: 'base', speaker: 'mc', key: 'story.{site}.4' },
    { shot: 'base', speaker: 'mc', key: 'story.{site}.5' },
    { shot: 'crew', speaker: 'lumi', key: 'story.{site}.6' },
    { shot: 'crew', speaker: 'lumi', key: 'story.{site}.7' },
    { shot: 'spot:overview', speaker: 'lumi', key: 'film.tour.start' },
    ...TOUR.map((task) => taskBeat(task)),
    { shot: 'goal', speaker: 'mc', key: 'story.{site}.9' },
  ],
};

function taskFilm(task: TaskId): Film {
  return { id: `task.${task}`, card: 'why', task, beats: [taskBeat(task)] };
}

const EVENT_FILMS: Film[] = [
  {
    id: 'storm',
    card: 'none',
    beats: [
      { shot: 'storm', speaker: 'caption', key: 'film.storm.1' },
      { shot: 'storm', speaker: 'mc', key: 'film.storm.2.{site}' },
      { shot: 'spot:shield', speaker: 'lumi', key: 'film.storm.3.{site}' },
    ],
  },
  {
    id: 'dust',
    card: 'none',
    sites: ['mars'],
    beats: [
      { shot: 'dust', speaker: 'caption', key: 'film.dust.1' },
      { shot: 'spot:solar', speaker: 'lumi', key: 'film.dust.2' },
    ],
  },
  {
    id: 'eclipse',
    card: 'none',
    sites: ['moon'],
    beats: [
      { shot: 'spot:sky', speaker: 'caption', key: 'film.eclipse.1' },
      { shot: 'spot:solar', speaker: 'lumi', key: 'film.eclipse.2' },
    ],
  },
  {
    id: 'conjunction',
    card: 'none',
    sites: ['mars'],
    beats: [
      { shot: 'spot:sky', speaker: 'caption', key: 'film.conjunction.1' },
      { shot: 'spot:lab', speaker: 'mc', key: 'film.conjunction.2' },
    ],
  },
  {
    id: 'harvest',
    card: 'none',
    beats: [
      { shot: 'spot:farm', speaker: 'lumi', key: 'film.harvest.1' },
      { shot: 'cheer', speaker: 'lumi', key: 'film.harvest.2' },
    ],
  },
  {
    id: 'built',
    card: 'none',
    beats: [{ shot: 'spot:overview', speaker: 'lumi', key: 'film.built.1' }],
  },
  {
    id: 'win',
    card: 'none',
    beats: [
      { shot: 'cheer', speaker: 'lumi', key: 'film.win.1' },
      { shot: 'liftoff', speaker: 'mc', key: 'film.win.2.{site}' },
    ],
  },
  {
    id: 'lose',
    card: 'none',
    beats: [
      { shot: 'spot:overview', speaker: 'lumi', key: 'film.lose.1' },
      { shot: 'liftoff', speaker: 'mc', key: 'film.lose.2' },
    ],
  },
];

export const FILMS: Record<FilmId, Film> = Object.fromEntries(
  [INTRO, ...TASKS.map(taskFilm), ...EVENT_FILMS].map((film) => [film.id, film]),
) as Record<FilmId, Film>;

/** The text key of a beat on a world. */
export function beatKey(beat: FilmBeat, site: SiteId): string {
  return beat.key.replace('{site}', site);
}

/** The keys of a task's card. The fact and its source differ by world. */
export function whyKeys(task: TaskId, site: SiteId): { title: string; what: string; why: string; fact: string; src: string } {
  return {
    title: `film.task.${task}.title`,
    what: `film.task.${task}.what`,
    why: `film.task.${task}.why`,
    fact: `film.task.${task}.fact.${site}`,
    src: `film.task.${task}.src.${site}`,
  };
}

/** The name a film is remembered under: event films about real data are remembered per world. */
export function seenKey(id: FilmId, site: SiteId): string {
  return id === 'storm' || id === 'harvest' ? `${id}@${site}` : id;
}
