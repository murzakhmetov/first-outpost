/**
 * In the game: a small crew dock with each friend's outpost (week, air, food, radiation, science),
 * the sticker buttons, and the stickers friends send as small toasts.
 */
import './crew.css';
import type { JSX } from 'preact';
import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { getWorld } from '../game/director';
import { num, t } from '../i18n';
import { crewBubbles, crewCooling, crewToasts, crewView, react } from '../net/crew';
import { TAG_RANGE, doingOf } from '../net/follow';
import { CREW_SUITS, REACTIONS, doseShare } from '../net/protocol';
import type { ReactionId } from '../net/protocol';
import type { Player } from '../net/room';
import type { ScreenPoint } from '../world/world';
import { Icon } from './icons';
import type { IconName } from './icons';

/** The pictures for the stickers (the protocol's own emoji are not drawn). */
const REACTION_PIC: Record<ReactionId, IconName> = { great: 'check', hooray: 'star', shield: 'shield', plants: 'plant', power: 'power', wow: 'eye', thanks: 'badge', oops: 'warn' };

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
                  <Icon name={REACTION_PIC[bubble.reaction]} size={15} /> {t(`crew.r.${bubble.reaction}`)}
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

/** The list of friends is open (the Friends button in the top row opens and closes it). */
const dockOpen = signal(false);

/** The Friends button in the row of round buttons at the top right. Only while a crew plays together. */
export function CrewButton(): JSX.Element | null {
  const view = crewView.value;
  if (view.phase !== 'playing') return null;
  const open = dockOpen.value;
  const here = view.players.filter((player) => !player.me && player.here).length;
  return (
    <span class="with-dot">
      <button
        type="button"
        class={`icon-btn ${open ? 'is-active' : ''}`}
        aria-expanded={open}
        aria-label={`${t('crew.dock')}${here ? `, ${here}` : ''}`}
        title={open ? t('crew.dockHide') : t('crew.dockShow')}
        onClick={() => {
          dockOpen.value = !open;
        }}
      >
        <Icon name="earth" size={22} />
      </button>
      {here > 0 && <i class="dot">{here}</i>}
      {!view.online && <i class="dot dot-ready dot-left" aria-hidden="true" />}
    </span>
  );
}

export function CrewDock(): JSX.Element | null {
  const view = crewView.value;
  if (view.phase !== 'playing') return null;
  const open = dockOpen.value;
  const friends = view.players.filter((player) => !player.me);
  const toasts = crewToasts.value;
  return (
    <>
      {open && (
        <aside class="crew-dock" aria-label={t('crew.dock')}>
          <div class="crew-dock-body">
            <h2 class="crew-dock-head">{t('crew.dock')}</h2>
            {!view.online && <p class="crew-lost">{t('crew.lost')}</p>}
            <ul class="crew-friends">
              {friends.map((player) => (
                <Friend key={player.id} player={player} />
              ))}
            </ul>
            <div class="crew-stickers" role="group" aria-label={t('crew.stickers')}>
              {REACTIONS.map((id) => (
                <button key={id} type="button" class="crew-sticker" disabled={crewCooling.value} onClick={() => react(id)}>
                  <Icon name={REACTION_PIC[id]} size={16} /> {t(`crew.r.${id}`)}
                </button>
              ))}
            </div>
          </div>
        </aside>
      )}
      <FriendTags players={friends} />
      <div class="crew-toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} class="crew-toast">
            <span class="crew-dot" style={{ background: CREW_SUITS[toast.suit] }} aria-hidden="true" />
            <Icon name={REACTION_PIC[toast.reaction]} size={16} />
            {t('crew.say', { name: t(`crew.name.${toast.name}`), icon: '', text: t(`crew.r.${toast.reaction}`) })}
          </div>
        ))}
      </div>
    </>
  );
}
