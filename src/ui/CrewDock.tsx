/**
 * In the game: a small crew dock with each friend's outpost (week, air, food, radiation, science),
 * the sticker buttons, and the stickers friends send as small toasts.
 */
import './crew.css';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getWorld } from '../game/director';
import { num, t } from '../i18n';
import { crewBubbles, crewCooling, crewToasts, crewView, react } from '../net/crew';
import { TAG_RANGE, doingOf } from '../net/follow';
import { CREW_SUITS, REACTIONS, REACTION_ICON, doseShare } from '../net/protocol';
import type { Player } from '../net/room';
import type { ScreenPoint } from '../world/world';
import { Icon } from './icons';
import type { IconName } from './icons';

const DOING_ICON: Record<'plan' | 'outside' | 'report', IconName> = { plan: 'calendar', outside: 'walk', report: 'book' };

/**
 * Name tags over the friends' heads in the 3D world, and the sticker a friend just sent. HTML on top of the
 * picture, moved every frame to where the head is on the screen (as the building labels are). The name is
 * a preset one in our own language; the small icon says what the friend is doing. Hidden when the friend
 * is off the screen, behind the camera, more than TAG_RANGE metres away, or not drawn.
 */
function FriendTags({ players }: { players: Player[] }): JSX.Element {
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const ids = players.map((player) => player.id).join(',');
  useEffect(() => {
    let frame = 0;
    const point: ScreenPoint & { distance: number } = { x: 0, y: 0, visible: false, distance: 0 };
    const tick = (): void => {
      frame = requestAnimationFrame(tick);
      const world = getWorld();
      for (const [id, element] of Object.entries(refs.current)) {
        if (!element) continue;
        const spot = world && world.ready ? world.friendTag(id, point) : null;
        const shown = !!spot && spot.visible && spot.distance <= TAG_RANGE;
        element.style.opacity = shown ? '1' : '0';
        if (shown) element.style.transform = `translate(${spot.x.toFixed(1)}px, ${spot.y.toFixed(1)}px) translate(-50%, -100%)`;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ids]);
  const bubbles = crewBubbles.value;
  return (
    <div class="crew-tags" aria-hidden="true">
      {players
        .filter((player) => player.here && !player.finished)
        .map((player) => {
          const doing = doingOf(player.status?.step ?? null);
          const bubble = bubbles[player.id];
          return (
            <div
              key={player.id}
              class="crew-tag3d"
              ref={(element) => {
                if (element) refs.current[player.id] = element;
                else delete refs.current[player.id];
              }}
            >
              {bubble && (
                <span key={bubble.key} class="crew-bubble">
                  {bubble.icon} {t(`crew.r.${bubble.reaction}`)}
                </span>
              )}
              <span class="crew-tag3d-name" title={t('crew.tag', { name: t(`crew.name.${player.name}`), doing: t(`crew.doing.${doing}`) })}>
                <i style={{ background: CREW_SUITS[player.suit] }} />
                <b>{t(`crew.name.${player.name}`)}</b>
                <Icon name={DOING_ICON[doing]} size={13} />
              </span>
            </div>
          );
        })}
    </div>
  );
}

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
      <FriendTags players={friends} />
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
