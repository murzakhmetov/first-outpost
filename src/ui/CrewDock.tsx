/**
 * In the game: a small crew dock with each friend's outpost (week, air, food, radiation, science),
 * the sticker buttons, and the stickers friends send as small toasts.
 */
import './crew.css';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { num, t } from '../i18n';
import { crewCooling, crewToasts, crewView, react } from '../net/crew';
import { CREW_SUITS, REACTIONS, REACTION_ICON, doseShare } from '../net/protocol';
import type { Player } from '../net/room';
import { Icon } from './icons';

function Friend({ player }: { player: Player }): JSX.Element {
  const status = player.status;
  return (
    <li class={`crew-friend ${player.here ? '' : 'is-gone'}`}>
      <span class="crew-dot" style={{ background: CREW_SUITS[player.suit] }} aria-hidden="true" />
      <span class="crew-friend-main">
        <b>{t(`crew.name.${player.name}`)}</b>
        {!status && <small>{player.here ? t('crew.waitStatus') : t('crew.gone')}</small>}
        {status && (
          <small class="crew-numbers">
            <span>{player.finished ? t('crew.done') : t('crew.week', { n: status.week })}</span>
            <span title={t('hud.air')}>
              <Icon name="air" size={12} /> {num(status.air, 0)}
            </span>
            <span title={t('hud.food')}>
              <Icon name="food" size={12} /> {num(status.food, 0)}
            </span>
            <span title={t('hud.dose')} class={doseShare(status) > 0.75 ? 'is-warn' : ''}>
              <Icon name="dose" size={12} /> {num(doseShare(status) * 100, 0)}%
            </span>
            <span title={t('hud.science')}>
              <Icon name="science" size={12} /> {num(status.science, 0)}
            </span>
          </small>
        )}
        {status && !player.here && !player.finished && <small>{t('crew.gone')}</small>}
      </span>
    </li>
  );
}

export function CrewDock(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const view = crewView.value;
  if (view.phase !== 'playing') return null;
  const friends = view.players.filter((player) => !player.me);
  const toasts = crewToasts.value;
  return (
    <>
      <aside class={`crew-dock ${open ? 'is-open' : ''}`} aria-label={t('crew.dock')}>
        <button
          type="button"
          class="crew-dock-toggle"
          aria-expanded={open}
          aria-label={open ? t('crew.dockHide') : t('crew.dockShow')}
          title={open ? t('crew.dockHide') : t('crew.dockShow')}
          onClick={() => setOpen(!open)}
        >
          <Icon name="earth" size={18} />
          <span>{t('crew.dock')}</span>
          <span class="crew-dots" aria-hidden="true">
            {friends.map((player) => (
              <i key={player.id} class={player.here ? '' : 'is-gone'} style={{ background: CREW_SUITS[player.suit] }} />
            ))}
          </span>
          {!view.online && <Icon name="warn" size={14} />}
        </button>
        {open && (
          <div class="crew-dock-body">
            {!view.online && <p class="crew-lost">{t('crew.lost')}</p>}
            <ul class="crew-friends">
              {friends.map((player) => (
                <Friend key={player.id} player={player} />
              ))}
            </ul>
            <div class="crew-stickers" role="group" aria-label={t('crew.stickers')}>
              {REACTIONS.map((id) => (
                <button key={id} type="button" class="crew-sticker" disabled={crewCooling.value} onClick={() => react(id)}>
                  <span aria-hidden="true">{REACTION_ICON[id]}</span> {t(`crew.r.${id}`)}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>
      <div class="crew-toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} class="crew-toast">
            <span class="crew-dot" style={{ background: CREW_SUITS[toast.suit] }} aria-hidden="true" />
            {t('crew.say', { name: t(`crew.name.${toast.name}`), icon: toast.icon, text: t(`crew.r.${toast.reaction}`) })}
          </div>
        ))}
      </div>
    </>
  );
}
