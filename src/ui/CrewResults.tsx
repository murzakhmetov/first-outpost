/**
 * On the debrief: how every friend's crew did. Friends who are still playing show up when they finish.
 */
import './crew.css';
import type { JSX } from 'preact';
import { num, t } from '../i18n';
import { crewView, leaveRoom } from '../net/crew';
import { CREW_SUITS, awards, doseShare, highlightOf } from '../net/protocol';
import type { Player } from '../net/room';
import { Btn } from './common';
import { Icon } from './icons';

function rank(player: Player): number {
  const status = player.status;
  if (!player.finished || !status) return -1;
  return status.stars * 1e6 + status.science;
}

function Row({ player, prizes }: { player: Player; prizes: ReturnType<typeof awards> }): JSX.Element {
  const status = player.status;
  const done = player.finished && !!status;
  const line = status ? highlightOf(status) : null;
  return (
    <li class={`crew-row ${player.me ? 'is-me' : ''}`}>
      <span class="crew-dot" style={{ background: CREW_SUITS[player.suit] }} aria-hidden="true" />
      <div class="crew-row-main">
        <b>
          {t(`crew.name.${player.name}`)}
          {player.me && <em class="crew-tag">{t('crew.me')}</em>}
        </b>
        {done && status ? (
          <>
            <span class={`crew-end ${status.end === 'complete' ? 'is-good' : 'is-bad'}`}>{t(`crew.end.${status.end ?? 'complete'}`)}</span>
            <span class="crew-row-stats">
              <span class="crew-row-stars" role="img" aria-label={`${status.stars} / 3`}>
                {[0, 1, 2].map((index) => (
                  <Icon key={index} name="star" size={14} class={index < status.stars ? 'lit' : 'dim'} />
                ))}
              </span>
              <span>{t('crew.res.science.n', { n: num(status.science, 0) })}</span>
              <span>{t('crew.res.dose', { n: num(doseShare(status) * 100, 0) })}</span>
            </span>
            {line && <span class="crew-line">{t(line.key, { week: line.week })}</span>}
          </>
        ) : (
          <span class="crew-end">{player.here ? t('crew.res.playing') : t('crew.res.left')}</span>
        )}
        <span class="crew-prizes">
          {prizes.safest === player.id && <em class="crew-prize">{t('crew.res.safest')}</em>}
          {prizes.science === player.id && <em class="crew-prize">{t('crew.res.science')}</em>}
          {prizes.stars === player.id && <em class="crew-prize">{t('crew.res.stars')}</em>}
        </span>
      </div>
    </li>
  );
}

export function CrewResults(): JSX.Element | null {
  const view = crewView.value;
  if (view.phase !== 'playing' || view.players.length < 2) return null;
  const finished = view.players.filter((player) => player.finished && player.status).map((player) => ({ id: player.id, status: player.status! }));
  const prizes = awards(finished);
  const players = [...view.players].sort((a, b) => rank(b) - rank(a));
  return (
    <section class="crew-results" aria-label={t('crew.res.title')}>
      <h3>{t('crew.res.title')}</h3>
      <ul class="crew-rows">
        {players.map((player) => (
          <Row key={player.id} player={player} prizes={prizes} />
        ))}
      </ul>
      <Btn kind="ghost" small onClick={leaveRoom}>
        {t('crew.res.leave')}
      </Btn>
    </section>
  );
}
