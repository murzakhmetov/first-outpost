/**
 * The Outpost menu, laid out like the item screens of adventure games: tabs along the
 * top, the materials in store in the corner, a grid of item slots on the left and the
 * chosen item's details on the right. Build new buildings, print tools in the
 * workshop, and go inside the buildings.
 */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { audio } from '../game/audio';
import { beginPlacement, closePanel, enterRoom, orderBuilding, removePlaced, startPrint } from '../game/director';
import { mission, outpostTab, step } from '../game/store';
import type { OutpostTab } from '../game/store';
import { has, t } from '../i18n';
import { ItemArt } from './ItemArt';
import { BUILDINGS, DECOR, ROOMS, TOOLS, buildBlock, craftBlock, isCreative, roomOpen, roomPlayed, roomRewardTaken, stockOf, underConstruction } from '../sim/outpost';
import type { BuildingId, DecorId, RoomId, Stock, ToolId } from '../sim/outpost';
import type { MissionState } from '../sim/types';
import { ACCENT } from '../world/annex';
import { Btn } from './common';
import { Icon } from './icons';
import type { IconName } from './icons';
import { GAME_ICON, gameLabel, rewardText } from './Rooms';

export const TOOL_ICON: Record<ToolId, IconName> = {
  tank: 'tank',
  drill: 'drill',
  battery: 'battery',
  scanner: 'radar',
  boots: 'boot',
  vest: 'vest',
};

/** The room inside a building, if it has one. */
const BUILDING_ROOM: Partial<Record<BuildingId, RoomId>> = {
  workshop: 'workshop',
  oxygen: 'oxygen',
  garden: 'garden',
  observatory: 'observatory',
  bunker: 'bunker',
};

type Item = { kind: 'building'; id: BuildingId } | { kind: 'tool'; id: ToolId } | { kind: 'room'; id: RoomId } | { kind: 'decor'; id: DecorId };

/** The colour of each kind of item: gold for buildings, violet for tools, blue for rooms, green for decorations.
    (Only a colour: stars in this game mean mission and game results, never how rare a thing is.) */
const RANK: Record<Item['kind'], { tone: string }> = {
  building: { tone: 'r5' },
  tool: { tone: 'r4' },
  room: { tone: 'r3' },
  decor: { tone: 'r2' },
};

function itemsFor(tab: OutpostTab): Item[] {
  if (tab === 'build') return BUILDINGS.map((def) => ({ kind: 'building', id: def.id }));
  if (tab === 'workshop') return TOOLS.map((def) => ({ kind: 'tool', id: def.id }));
  if (tab === 'decor') return DECOR.map((id) => ({ kind: 'decor', id }));
  return ROOMS.map((def) => ({ kind: 'room', id: def.id }));
}

function itemName(item: Item): string {
  if (item.kind === 'building') return t(`bld.${item.id}.name`);
  if (item.kind === 'tool') return t(`tool.${item.id}.name`);
  if (item.kind === 'decor') return t(`decor.${item.id}`);
  return t(`room.${item.id}.name`);
}

/** A small mark on a slot: done, under way, ready, or locked. */
function slotBadge(m: MissionState, item: Item): JSX.Element | null {
  if (item.kind === 'decor') {
    const count = (m.decor ?? []).filter((entry) => entry.id === item.id).length;
    return count ? <i class="gi-badge is-busy">{count}</i> : null;
  }
  if (item.kind === 'building') {
    const site = m.buildings?.find((entry) => entry.id === item.id);
    if (site?.done)
      return (
        <i class="gi-badge is-done">
          <Icon name="check" size={13} />
        </i>
      );
    if (site) return <i class="gi-badge is-busy">{Math.round((site.progress / BUILDINGS.find((def) => def.id === item.id)!.work) * 100)}%</i>;
    if (!buildBlock(m, item.id)) return <i class="gi-badge is-ready" />;
    return null;
  }
  if (item.kind === 'tool') {
    const block = craftBlock(m, item.id);
    if (block === 'made')
      return (
        <i class="gi-badge is-done">
          <Icon name="check" size={13} />
        </i>
      );
    if (block === 'workshop')
      return (
        <i class="gi-badge is-locked">
          <Icon name="lock" size={12} />
        </i>
      );
    if (!block) return <i class="gi-badge is-ready" />;
    return null;
  }
  if (!roomOpen(m, item.id))
    return (
      <i class="gi-badge is-locked">
        <Icon name="lock" size={12} />
      </i>
    );
  if (roomPlayed(m, item.id))
    return (
      <i class="gi-badge is-done">
        <Icon name="check" size={13} />
      </i>
    );
  return null;
}

/** Have and need for each material, in the item detail. */
function CostRows({ stock, cost }: { stock: Stock; cost: Stock }): JSX.Element {
  return (
    <ul class="gi-cost">
      {(['regolith', 'metal'] as const).map((key) =>
        cost[key] > 0 ? (
          <li key={key} class={stock[key] < cost[key] ? 'is-short' : ''}>
            <span class={`gi-cost-icon stock-${key}`}>
              <ItemArt item={{ kind: 'material', id: key }} size={30} />
            </span>
            <span>{t(`mat.${key}`)}</span>
            <b>
              {stock[key]} / {cost[key]}
            </b>
          </li>
        ) : null,
      )}
    </ul>
  );
}

function Detail({ m, item }: { m: MissionState; item: Item }): JSX.Element {
  const stock = stockOf(m);
  const rank = RANK[item.kind];
  const night = step.value === 'night';
  let kindLabel = '';
  let effect = '';
  let what = '';
  let body: JSX.Element | null = null;
  let action: JSX.Element | null = null;

  if (item.kind === 'building') {
    const def = BUILDINGS.find((entry) => entry.id === item.id)!;
    const site = m.buildings?.find((entry) => entry.id === item.id);
    const block = buildBlock(m, item.id);
    const busy = underConstruction(m);
    kindLabel = t('gi.kind.building');
    effect = t(`bld.${item.id}.effect`);
    what = t(m.config.site === 'moon' && has(`bld.${item.id}.what.moon`) ? `bld.${item.id}.what.moon` : `bld.${item.id}.what`);
    if (isCreative(m)) {
      const inside = BUILDING_ROOM[item.id];
      body = (
        <>
          <p class="gi-note">{t('creative.what')}</p>
          {site && (
            <p class="gi-state is-good">
              <Icon name="check" size={16} /> {t('outpost.built')}
            </p>
          )}
        </>
      );
      action = (
        <div class="gi-actions">
          <Btn kind="primary" icon="build" wide disabled={night} onClick={() => beginPlacement('building', item.id)}>
            {t(site ? 'creative.move' : 'creative.place')}
          </Btn>
          {site && inside && (
            <Btn icon="door" disabled={night} onClick={() => enterRoom(inside)}>
              {t('room.enter')}
            </Btn>
          )}
          {site && (
            <Btn kind="ghost" icon="close" onClick={() => removePlaced('building', item.id)}>
              {t('creative.remove')}
            </Btn>
          )}
        </div>
      );
    } else if (site?.done) {
      body = (
        <p class="gi-state is-good">
          <Icon name="check" size={16} /> {t('outpost.built')}
        </p>
      );
      const inside = BUILDING_ROOM[item.id];
      if (inside)
        action = (
          <Btn kind="primary" icon="door" wide disabled={night} onClick={() => enterRoom(inside)}>
            {t('room.enter')}
          </Btn>
        );
    } else if (site) {
      body = (
        <div class="gi-state">
          <span>{t('outpost.building', { done: site.progress, total: def.work })}</span>
          <span class="ocard-bar">
            <i style={{ width: `${(site.progress / def.work) * 100}%` }} />
          </span>
        </div>
      );
    } else {
      body = (
        <>
          <CostRows stock={stock} cost={def.cost} />
          <p class="gi-note">
            <Icon name="power" size={14} /> {t('outpost.work', { n: def.work })}
          </p>
          {block === 'busy' && busy && <p class="gi-warn">{t('outpost.busy', { name: t(`bld.${busy.id}.name`) })}</p>}
          {block === 'materials' && <p class="gi-warn">{t('outpost.need')}</p>}
        </>
      );
      action = (
        <Btn kind="primary" icon="build" wide disabled={!!block || night} onClick={() => orderBuilding(item.id)}>
          {t('outpost.build')}
        </Btn>
      );
    }
  } else if (item.kind === 'tool') {
    const def = TOOLS.find((entry) => entry.id === item.id)!;
    const block = craftBlock(m, item.id);
    kindLabel = t('gi.kind.tool');
    effect = t(`tool.${item.id}.what`);
    what = has(`tool.${item.id}.story`) ? t(`tool.${item.id}.story`) : '';
    if (block === 'made') {
      body = (
        <p class="gi-state is-good">
          <Icon name="check" size={16} /> {t('workshop.made')}
        </p>
      );
    } else if (block === 'workshop') {
      body = (
        <p class="gi-warn">
          <Icon name="lock" size={14} /> {t('workshop.locked')}
        </p>
      );
    } else {
      body = <CostRows stock={stock} cost={def.cost} />;
      action = (
        <Btn kind="primary" icon="wrench" wide disabled={!!block} onClick={() => startPrint(item.id)}>
          {t('workshop.make')}
        </Btn>
      );
    }
  } else if (item.kind === 'decor') {
    kindLabel = t('gi.kind.decor');
    effect = t('gi.intro.decor');
    const count = (m.decor ?? []).length;
    body = (
      <p class="gi-note">
        <Icon name="build" size={14} /> {count} / 60
      </p>
    );
    action = (
      <div class="gi-actions">
        <Btn kind="primary" icon="build" wide disabled={night || count >= 60} onClick={() => beginPlacement('decor', item.id)}>
          {t('creative.place')}
        </Btn>
        <Btn kind="ghost" icon="back" disabled={!count} onClick={() => removePlaced('decor')}>
          {t('creative.undo')}
        </Btn>
        <Btn kind="ghost" icon="close" disabled={!count} onClick={() => removePlaced('decor', undefined, true)}>
          {t('creative.clear')}
        </Btn>
      </div>
    );
  } else {
    const def = ROOMS.find((entry) => entry.id === item.id)!;
    const open = roomOpen(m, item.id);
    kindLabel = t('gi.kind.room');
    effect = def.games.length ? def.games.map((game) => gameLabel(item.id, game.game)).join(' · ') : t(`room.${item.id}.what`);
    what = has(`room.${item.id}.story`) ? t(`room.${item.id}.story`) : '';
    body = (
      <ul class="gi-games">
        {def.games.map((game) => {
          const done = roomPlayed(m, item.id, game.game);
          const spent = !done && roomRewardTaken(m);
          return (
            <li key={game.game} class={done ? 'is-done' : spent ? 'is-spent' : ''} title={spent ? t('room.weekTaken') : undefined}>
              <Icon name={done ? 'check' : GAME_ICON[game.game]} size={16} />
              <span>{gameLabel(item.id, game.game)}</span>
              <b>{done ? t('room.playedWeek') : spent ? t(m.week >= m.config.weeks ? 'room.rewardUsed' : 'room.nextWeek') : rewardText(game.reward)}</b>
            </li>
          );
        })}
        {!open && (
          <li class="is-locked">
            <Icon name="lock" size={16} />
            <span>{t('room.locked')}</span>
          </li>
        )}
      </ul>
    );
    action = (
      <Btn kind="primary" icon="door" wide disabled={!open || night} onClick={() => enterRoom(item.id)}>
        {t('room.enter')}
      </Btn>
    );
  }

  const accent = item.kind === 'building' ? ACCENT[item.id] : undefined;
  return (
    <aside class={`gi-detail ${rank.tone}`} style={accent ? `--accent: ${accent}` : undefined}>
      <header class="gi-detail-head">
        <div class="gi-detail-title">
          <b>{itemName(item)}</b>
          <small>{kindLabel}</small>
        </div>
        <span class="gi-detail-art">
          <ItemArt item={item} size={132} />
        </span>
      </header>
      <div class="gi-detail-body">
        <p class="gi-effect">{effect}</p>
        {what && <p class="gi-desc">{what}</p>}
        {body}
      </div>
      {action && <footer class="gi-detail-foot">{action}</footer>}
    </aside>
  );
}

export function OutpostPanel(): JSX.Element | null {
  const m = mission.value;
  const tab = outpostTab.value;
  const [chosen, setChosen] = useState<Record<OutpostTab, number>>({ build: 0, workshop: 0, rooms: 0, decor: 0 });
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!m) return null;
  const items = itemsFor(tab === 'decor' && !isCreative(m) ? 'build' : tab);
  const index = Math.min(chosen[tab], items.length - 1);
  const pick = (next: OutpostTab): void => {
    audio.play('click');
    outpostTab.value = next;
  };
  const creative = isCreative(m);
  const tabs: { id: OutpostTab; icon: IconName }[] = [
    { id: 'build', icon: 'build' },
    { id: 'workshop', icon: 'wrench' },
    { id: 'rooms', icon: 'door' },
    ...(creative ? [{ id: 'decor' as OutpostTab, icon: 'plant' as IconName }] : []),
  ];
  const stock = stockOf(m);
  return (
    <div class="gi-screen outpost-screen" role="dialog" aria-modal="true" aria-label={t('outpost.title')}>
      <header class="gi-top">
        <span class="gi-title">
          <Icon name="build" size={24} /> {t('outpost.title')}
        </span>
        <nav class="gi-tabs" role="tablist">
          {tabs.map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} class={tab === entry.id ? 'is-on' : ''} onClick={() => pick(entry.id)}>
              <Icon name={entry.icon} size={20} />
              <span>{t(`outpost.tab.${entry.id}`)}</span>
            </button>
          ))}
        </nav>
        <span class="gi-wallet" title={t('outpost.stock')}>
          <span class="gi-coin stock-regolith">
            <ItemArt item={{ kind: 'material', id: 'regolith' }} size={24} /> <b>{creative ? '∞' : stock.regolith}</b>
          </span>
          <span class="gi-coin stock-metal">
            <ItemArt item={{ kind: 'material', id: 'metal' }} size={24} /> <b>{creative ? '∞' : stock.metal}</b>
          </span>
        </span>
        <button type="button" class="gi-close" aria-label={t('common.close')} onClick={closePanel}>
          <Icon name="close" size={22} />
        </button>
      </header>
      <p class="gi-intro">{t(`gi.intro.${tab}`)}</p>
      <main class="gi-body">
        <section class="gi-grid" aria-label={t(`outpost.tab.${tab}`)}>
          {items.map((item, i) => {
            const rank = RANK[item.kind];
            return (
              <button
                key={`${item.kind}-${item.id}`}
                type="button"
                class={`gi-slot ${rank.tone} ${i === index ? 'is-on' : ''}`}
                aria-pressed={i === index}
                onClick={() => {
                  audio.play('click');
                  setChosen({ ...chosen, [tab]: i });
                }}
              >
                <span class="gi-slot-art">
                  <ItemArt item={item} size={96} />
                </span>
                {slotBadge(m, item)}
                <span class="gi-slot-name">{itemName(item)}</span>
              </button>
            );
          })}
        </section>
        {items[index] && <Detail key={`${tab}-${index}`} m={m} item={items[index]} />}
      </main>
    </div>
  );
}
