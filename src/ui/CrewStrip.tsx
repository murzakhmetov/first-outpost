/**
 * Shared base ("One base together"): the pieces of the screen that show the crew.
 *
 * Everything here draws only while a shared base runs (`coopLive` holds something); in solo play and in the
 * "each their own base" crew mode each piece returns nothing, and no timer runs. The rules (who is waited for, when
 * "Go on" shows, what changed in the plan) are in src/net/coopview.ts.
 *
 * One pattern on every waiting screen: a row of suit-colour dots with a tick for each child who answered, a
 * countdown that starts when the first child answers, and for the commander a "Go on" button after 5 seconds.
 */
import './crew.css';
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { mission } from '../game/store';
import { t } from '../i18n';
import { crewView } from '../net/crew';
import {
  answered,
  canGoOn,
  canPlayAlone,
  coopGo,
  coopLive,
  coopPlayAlone,
  coopSilentMs,
  doingKey,
  flashing,
  iAnswered,
  participants,
  planNote,
  secondsLeft,
  votersOf,
  waitingFor,
  waitingForCommander,
} from '../net/coopview';
import type { CoopLive } from '../net/coopview';
import { CREW_SUITS } from '../net/protocol';
import type { CoopStage } from '../sim/coop';
import type { ModuleId, OptionId } from '../sim/types';
import { Icon } from './icons';

/** The wall clock, ticking twice a second while `active` (countdowns, "Go on" after 5 s). No timer when it is off. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** The suit colour and the preset name of a seat. A seat the room does not know gets a colour by its place. */
function lookOf(live: CoopLive, seat: string): { color: string; name: string } {
  const player = crewView.value.players.find((item) => item.id === seat);
  if (player) return { color: CREW_SUITS[player.suit] ?? CREW_SUITS[0], name: t(`crew.name.${player.name}`) };
  const place = Math.max(0, live.seats.indexOf(seat));
  return { color: CREW_SUITS[place % CREW_SUITS.length], name: t('crew.co.crew') };
}

/** The shared base's state when this stage is the one the screen shows (else null: the screen is a step behind). */
export function coopAt(stage: CoopStage): CoopLive | null {
  const live = coopLive.value;
  const m = mission.value;
  return live && live.stage === stage && m && live.week === m.week ? live : null;
}

/** True when a shared base runs and this child has already answered on this stage (the button waits then). */
export function coopAnswered(stage: CoopStage): boolean {
  const live = coopAt(stage);
  return !!live && iAnswered(live);
}

/** The row of dots, the countdown and the commander's "Go on". Nothing unless the shared base is on this stage. */
export function CrewStrip({ stage }: { stage: CoopStage }): JSX.Element | null {
  const live = coopAt(stage);
  const now = useNow(live !== null);
  if (!live) return null;
  const done = answered(live);
  const who = participants(live);
  const waiting = waitingFor(live);
  const left = secondsLeft(live, now);
  const mine = iAnswered(live);
  const showWho = waiting.length > 0 && (mine || !who.includes(live.me));
  const countdownKey = live.stage === 'plan' && live.endsAt === null ? 'crew.co.planEnds' : 'crew.co.in';
  return (
    <div class="crew-strip" role="group" aria-label={t('crew.co.crew')}>
      <ul class="crew-pips">
        {who.map((seat) => {
          const look = lookOf(live, seat);
          const isDone = done.includes(seat);
          const mark = live.stage === 'walk' && !live.outside && seat in live.walk ? (live.walk[seat] ? 'walk' : 'home') : null;
          const text = isDone ? t('crew.co.isReady', { name: look.name }) : t('crew.co.notReady', { name: look.name });
          return (
            <li key={seat} class={`crew-pip ${isDone ? 'is-done' : ''} ${seat === live.me ? 'is-me' : ''}`} title={text} aria-label={text}>
              <i style={{ background: look.color }}>{isDone && !mark && <Icon name="check" size={13} />}</i>
              {mark && <Icon name={mark} size={13} class="crew-pip-mark" />}
              {seat === live.me && <small>{t('crew.co.you')}</small>}
            </li>
          );
        })}
      </ul>
      {left !== null && (
        <span class="crew-count" role="timer" aria-live="off">
          {t(countdownKey, { n: left })}
        </span>
      )}
      {showWho && (
        <span class="crew-waiting" role="status">
          {t('crew.co.waitNames', { names: waiting.map((seat) => lookOf(live, seat).name).join(', ') })}
        </span>
      )}
      {canGoOn(live, now) && (
        <button type="button" class="crew-goon" title={t('crew.co.goOnTip')} onClick={coopGo}>
          {t('crew.co.goOn')} <Icon name="next" size={16} />
        </button>
      )}
    </div>
  );
}

/** Small dots on an option of the event card: who voted for it. */
export function VoteDots({ option }: { option: OptionId }): JSX.Element | null {
  const live = coopLive.value;
  if (!live || live.stage !== 'event') return null;
  const voters = votersOf(live, option);
  if (voters.length === 0) return null;
  return (
    <span class="crew-votes" title={t('crew.co.votesFor', { n: voters.length })} aria-label={t('crew.co.votesFor', { n: voters.length })}>
      {voters.map((seat) => (
        <i key={seat} class={seat === live.me ? 'is-me' : ''} style={{ background: lookOf(live, seat).color }} />
      ))}
    </span>
  );
}

/** On the plan: a coloured dot on the row a friend has just changed. It fades by itself. */
export function ChangeFlash({ module }: { module: ModuleId }): JSX.Element | null {
  const live = coopLive.value;
  if (!live || live.stage !== 'plan') return null;
  const flash = flashing(live, Date.now());
  if (!flash || !flash.modules.includes(module)) return null;
  const look = flash.who ? lookOf(live, flash.who) : null;
  return (
    <i
      key={flash.at}
      class="crew-flash"
      style={{ background: look ? look.color : 'var(--gold)' }}
      title={look ? t('crew.co.changedRow', { name: look.name }) : undefined}
      aria-hidden="true"
    />
  );
}

/** On the plan: "New plan from Cadet Nova. Look again." when somebody else's change took this child's Ready back. */
export function PlanChangedNote(): JSX.Element | null {
  const live = coopLive.value;
  const now = useNow(!!live && live.stage === 'plan' && live.cleared !== null);
  if (!live || live.stage !== 'plan') return null;
  const note = planNote(live, now);
  if (!note) return null;
  return (
    <p key={note.at} class="crew-plan-note" role="status">
      <Icon name="info" size={16} /> {note.who ? t('crew.co.planChangedBy', { name: lookOf(live, note.who).name }) : t('crew.co.planChanged')}
    </p>
  );
}

/** "Waiting for the commander…" after 15 s without news from the host, and "Play on alone" after 45 s. */
export function CoopQuietBar(): JSX.Element | null {
  const live = coopLive.value;
  const quiet = !!live && waitingForCommander(live);
  useNow(quiet);
  if (!quiet) return null;
  return (
    <div class="crew-quiet" role="status">
      <Icon name="antenna" size={18} /> <b>{t('crew.co.commanderAway')}</b>
      {canPlayAlone(coopSilentMs()) && (
        <button type="button" class="crew-alone" title={t('crew.co.playAloneTip')} onClick={coopPlayAlone}>
          {t('crew.co.playAlone')}
        </button>
      )}
    </div>
  );
}

/** In a room: what the crew is doing outside it. */
export function CoopChip(): JSX.Element | null {
  const live = coopLive.value;
  const key = live ? doingKey(live) : null;
  if (!live || !key) return null;
  return (
    <p class="crew-chip" role="status">
      <Icon name="earth" size={14} /> {t(`crew.co.doing.${key}`)}
    </p>
  );
}
