/**
 * Going inside the buildings: the list of rooms (in the Outpost menu), and the
 * screen laid over the 3D room while the cadet walks in it: the room's name, the
 * way out, what the station at hand does, and the small game when one is played.
 * Each room's game gives a reward once a week (sim/outpost.ts: ROOMS).
 */
import type { ComponentType, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { closeRoomGame, finishRoomGame, getWorld, leaveRoom, winRoomGame } from '../game/director';
import { interiorHud, mission, notify, panel, room, roomGame, roomWon } from '../game/store';
import { has, t } from '../i18n';
import { currentEnv } from '../sim/mission';
import { ROOMS, roomPlayed, roomRewardTaken } from '../sim/outpost';
import type { GameId, Reward } from '../sim/outpost';
import type { RoomId } from '../sim/outpost';
import type { MissionState } from '../sim/types';
import type { InteriorHud } from '../world/interior';
import { Btn } from './common';
import { CoopChip } from './CrewStrip';
import { Icon } from './icons';
import type { IconName } from './icons';
import { Joystick } from './Joystick';
import { InteractPrompt } from './Prompt';
import { useLoaded } from './lazy';

interface MinigameProps {
  site: 'mars' | 'moon';
  /** 1 = easy, 2 = middle, 3 = harder. */
  level?: 1 | 2 | 3;
  /** This week’s one-way radio delay to Earth, in seconds (the radio game uses it). */
  delaySeconds?: number;
  onFinish: (won: boolean) => void;
}

/** How hard the room games are: easy in the first third of the mission, harder toward the end. */
export function gameLevel(m: MissionState): 1 | 2 | 3 {
  const share = m.week / Math.max(1, m.config.weeks);
  return share <= 0.34 ? 1 : share <= 0.67 ? 2 : 3;
}

const loadGames = (): Promise<Record<GameId, ComponentType<MinigameProps>>> => import('./minigames').then((module) => module.MINIGAMES);

export const ROOM_ICON: Record<RoomId, IconName> = {
  hab: 'life',
  farm: 'plant',
  lab: 'lab',
  workshop: 'wrench',
  garden: 'plant',
  observatory: 'telescope',
  oxygen: 'air',
  bunker: 'bunker',
  lander: 'rocket',
};

export const GAME_ICON: Record<GameId, IconName> = {
  pipes: 'air',
  plants: 'plant',
  spectro: 'science',
  landing: 'rocket',
  signal: 'antenna',
};

/** What a game gives, in words: "+4 science". */
export function rewardText(reward: Reward): string {
  const parts: string[] = [];
  if (reward.air) parts.push(t('reward.air', { n: reward.air }));
  if (reward.science) parts.push(t('reward.science', { n: reward.science }));
  if (reward.food) parts.push(t('reward.food', { n: reward.food }));
  if (reward.crop) parts.push(t('reward.crop'));
  return parts.join(', ');
}

/** The name of a game as it is played in a room. */
export function gameLabel(room: RoomId, game: GameId): string {
  return has(`in.game.${room}.${game}`) ? t(`in.game.${room}.${game}`) : t(`in.play.${game}`);
}

const STATION_ICON: Record<string, IconName> = { exit: 'door', game: 'play', printer: 'wrench', look: 'info' };

function stationLabel(current: RoomId, station: NonNullable<InteriorHud['station']>): string {
  switch (station.kind) {
    case 'exit':
      return t('in.exit');
    case 'game': {
      const label = gameLabel(current, station.id.replace('game:', '') as GameId);
      return station.done ? `${label} · ${t('room.playedWeek')}` : label;
    }
    case 'printer':
      return t('in.printer');
    default:
      return t('in.look', { thing: t(`thing.${station.thing}`) });
  }
}

function isTouch(): boolean {
  return matchMedia('(pointer: coarse)').matches || document.body.classList.contains('touch');
}

/** The screen over the 3D room: name, way out, the station prompt, and the small game. */
export function RoomScreen(): JSX.Element | null {
  const m = mission.value;
  const current = room.value;
  const hud = interiorHud.value;
  const game = roomGame.value;
  const [round, setRound] = useState(0);
  // The room games are downloaded the first time one is opened.
  // Each time the player starts a game counts as a new request: a failed download is tried again then,
  // not in a loop while the player only stands in the room.
  const [asks, setAsks] = useState(0);
  useEffect(() => {
    if (roomGame.value) setAsks((n) => n + 1);
  }, [roomGame.value]);
  const games = useLoaded(
    loadGames,
    !!room.value,
    () => {
      // The download starts early, in the background: only a player who asked for a game hears about a failure.
      if (!roomGame.value) return;
      closeRoomGame();
      notify('toast.loadFailed', undefined, 'warn', 5);
    },
    asks,
  );
  // A win pays at once, when its card appears.
  const won = roomWon.value;
  useEffect(() => {
    if (won && current && game === won) winRoomGame(current, game as GameId);
  }, [won, current, game]);
  const [showKeys, setShowKeys] = useState(true);
  useEffect(() => {
    setShowKeys(true);
    const timer = window.setTimeout(() => setShowKeys(false), 8000);
    return () => window.clearTimeout(timer);
  }, [current]);
  // Escape closes the game, or leaves the room (menus close themselves first).
  useEffect(() => {
    if (!current) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || panel.value !== 'none') return;
      if (roomGame.value) closeRoomGame();
      else leaveRoom();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current]);
  if (!m || !current) return null;
  const def = ROOMS.find((item) => item.id === current);
  if (!def) return null;
  const Game = game && games ? games[game] : undefined;
  const station = hud?.room === current ? hud.station : null;
  const touch = isTouch();

  return (
    <div class={`room3d room-${current} ${game ? 'is-playing' : ''}`}>
      {/* The place name, as adventure games show it when you arrive. */}
      <div key={current} class="discovery discovery-room" role="status">
        <span class="discovery-kicker">
          <Icon name={ROOM_ICON[current]} size={14} /> {t('room.inside')} <Icon name={ROOM_ICON[current]} size={14} />
        </span>
        <b class="discovery-title">{t(`room.${current}.name`)}</b>
        <small class="discovery-note">{def.games.length ? def.games.map((item) => gameLabel(current, item.game)).join(' · ') : t(`room.${current}.what`)}</small>
      </div>
      <header class="room-head">
        <span class="room-icon">
          <Icon name={ROOM_ICON[current]} size={22} />
        </span>
        <span class="room-title">
          <small>{t('room.inside')}</small>
          <b>{t(`room.${current}.name`)}</b>
        </span>
        {def.games.map((item) => {
          const done = roomPlayed(m, current, item.game);
          // Another game paid this week's room reward: this one pays again next week.
          const spent = !done && roomRewardTaken(m);
          return (
            <span
              key={item.game}
              class={`room-task ${done ? 'is-done' : spent ? 'is-spent' : ''}`}
              title={spent ? t('room.weekTaken') : gameLabel(current, item.game)}
            >
              <Icon name={done ? 'check' : GAME_ICON[item.game]} size={14} />{' '}
              {done ? t('room.playedWeek') : spent ? t(m.week >= m.config.weeks ? 'room.rewardUsed' : 'room.nextWeek') : rewardText(item.reward)}
            </span>
          );
        })}
        <Btn kind="ghost" icon="back" onClick={() => leaveRoom()}>
          {t('room.leave')}
        </Btn>
      </header>
      <CoopChip />

      {station && !game && (
        <InteractPrompt
          icon={station.kind === 'game' ? GAME_ICON[station.id.replace('game:', '') as GameId] : (STATION_ICON[station.kind] ?? 'info')}
          text={stationLabel(current, station)}
          tone={station.done ? 'done' : station.kind === 'exit' ? 'green' : station.kind === 'look' ? 'cyan' : station.kind === 'printer' ? 'amber' : 'gold'}
        />
      )}

      {!game && showKeys && <p class="eva-keys room-keys">{touch ? t('in.touch') : t('in.keys')}</p>}
      {!game && <Joystick />}
      {!game && (
        <div class="eva-buttons room-buttons">
          <button
            type="button"
            class="round"
            onPointerDown={(event) => {
              event.preventDefault();
              getWorld()?.input.pressJump();
            }}
          >
            <Icon name="jump" size={24} />
            <small>{t('eva.jump')}</small>
          </button>
          <button type="button" class={`round round-big ${station ? 'is-ready' : ''}`} disabled={!station} onClick={() => getWorld()?.input.pressInteract()}>
            <Icon name={station ? (STATION_ICON[station.kind] ?? 'info') : 'play'} size={30} />
            <small>{t('in.use')}</small>
          </button>
        </div>
      )}

      {game && !Game && (
        <div class="room-game-back">
          <p class="room-loading" role="status">{t('room.loading')}</p>
        </div>
      )}

      {game && Game && (
        <div class="room-game-back">
          <div class="room-game-frame">
            <Game
              key={round}
              site={m.config.site}
              level={gameLevel(m)}
              delaySeconds={currentEnv(m).delaySeconds}
              onFinish={(won) => {
                finishRoomGame(current, game!, won);
                setRound((n) => n + 1);
                closeRoomGame();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
