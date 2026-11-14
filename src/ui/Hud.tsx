import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { audio, canSpeak } from '../game/audio';
import { CODEX, cardById } from '../game/codex';
import { changeAlloc, cycleAlloc, getWorld, openPanel } from '../game/director';
import { cutscene, discovery, evaHud, fading, fps, lumiLine, mission, panel, pickups, placing, printing, profile, roomGame, settings, step, toast } from '../game/store';
import type { Pickup } from '../game/store';
import type { Step } from '../game/store';
import { decideAutoSpeak, hasLine, isRepeat, loadManifest, speakAutoLine, stopAutoLine } from '../game/voice';
import { fmtRange, lang, num, t } from '../i18n';
import { computeWeek, currentEnv, starTargets } from '../sim/mission';
import { BUILDINGS, buildBlock, isCreative, robotIdle, stockOf } from '../sim/outpost';
import type { MissionState, ModuleId, SiteId } from '../sim/types';
import { MAX_LEVEL } from '../sim/types';
import { AIRLOCK, BATTERY, FARM, HAB, LAB, PATHS, SOLAR } from '../world/base';
import { LANDER } from '../world/props';
import { WALK_RADIUS } from '../world/terrain';
import type { MarkerId, ScreenPoint, World } from '../world/world';
import { Bar, IconBtn, Rich, SpeakBtn } from './common';
import { Icon, LumiFace } from './icons';
import type { IconName } from './icons';

type MeterId = 'power' | 'air' | 'food' | 'dose' | 'science';

// ---------------------------------------------------------------------------
// Minimap
// ---------------------------------------------------------------------------

const SAMPLE_TINT: Record<number, string> = { 2: '#9be8ff', 4: '#c9a8ff', 6: '#ffd76a' };

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size * 0.78, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size * 0.78, y);
  ctx.closePath();
}

/** A four-pointed star: the sign of a discovery. */
function star(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const waist = size * 0.3;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + waist, y - waist);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x + waist, y + waist);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - waist, y + waist);
  ctx.lineTo(x - size, y);
  ctx.lineTo(x - waist, y - waist);
  ctx.closePath();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw the outpost from above: north is up, the player (or the outpost) is in the middle. */
function paintMap(ctx: CanvasRenderingContext2D, size: number, world: World, site: SiteId): void {
  const half = size / 2;
  const walking = world.mode === 'eva' && world.eva.active;
  const cx = walking ? world.eva.position.x : 0;
  const cz = walking ? world.eva.position.z : 3;
  const reach = walking ? 48 : 46; // metres from the middle to the rim
  const k = (half - 3) / reach;
  const X = (x: number): number => half + (x - cx) * k;
  const Y = (z: number): number => half + (z - cz) * k;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(half, half, half - 2, 0, Math.PI * 2);
  ctx.clip();

  const ground = ctx.createRadialGradient(half, half, half * 0.1, half, half, half);
  if (site === 'mars') {
    ground.addColorStop(0, 'rgba(196, 112, 70, 0.92)');
    ground.addColorStop(1, 'rgba(104, 48, 32, 0.92)');
  } else {
    ground.addColorStop(0, 'rgba(150, 154, 168, 0.92)');
    ground.addColorStop(1, 'rgba(70, 74, 90, 0.92)');
  }
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, size, size);

  // Edge of the area that is safe to walk.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(X(0), Y(0), WALK_RADIUS * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Walkways.
  ctx.strokeStyle = 'rgba(255, 238, 206, 0.55)';
  ctx.lineWidth = Math.max(1.5, 2.4 * k);
  ctx.lineCap = 'round';
  for (const [ax, az, bx, bz] of PATHS) {
    ctx.beginPath();
    ctx.moveTo(X(ax), Y(az));
    ctx.lineTo(X(bx), Y(bz));
    ctx.stroke();
  }

  // Landing pad and lander.
  ctx.strokeStyle = 'rgba(255, 209, 102, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(X(LANDER.x), Y(LANDER.z), 7.4 * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f4f0e8';
  ctx.beginPath();
  ctx.arc(X(LANDER.x), Y(LANDER.z), 2.4 * k, 0, Math.PI * 2);
  ctx.fill();

  // Buildings, each in the colour of what it makes.
  const building = (x: number, z: number, w: number, d: number, fill: string, line: string, round = 3): void => {
    roundRect(ctx, X(x) - (w * k) / 2, Y(z) - (d * k) / 2, w * k, d * k, Math.min(round, (w * k) / 2));
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  ctx.beginPath();
  ctx.arc(X(HAB.x), Y(HAB.z), 6.6 * k, 0, Math.PI * 2);
  ctx.fillStyle = '#eef8ff';
  ctx.fill();
  ctx.strokeStyle = '#5fd0ff';
  ctx.lineWidth = 2;
  ctx.stroke();
  building(HAB.x, HAB.z + 8, 3.2, 4, '#eef8ff', '#5fd0ff', 2);
  building(FARM.x, FARM.z, 8.8, 13.4, '#d9ffe9', '#5fe39a');
  building(LAB.x, LAB.z, 7.2, 13, '#efe6ff', '#b79cff');
  building(BATTERY.x, BATTERY.z, 4.6, 4.6, '#fff0bf', '#ffd166');
  for (const x of [-21, -15, -9]) {
    for (const z of site === 'mars' ? [17.5, 23.5] : [20]) building(SOLAR.x + (x + 15), z, 4.4, 3.2, '#2d43a6', '#ffd166', 1.5);
  }
  // The rover, turned the way it faces. While it is driven, the arrow below stands for it.
  if (!world.rover.driving) {
    ctx.save();
    ctx.translate(X(world.rover.x), Y(world.rover.z));
    ctx.rotate(Math.PI - world.rover.heading);
    ctx.fillStyle = '#f4f0e8';
    ctx.strokeStyle = 'rgba(20, 16, 40, 0.8)';
    ctx.lineWidth = 1.2;
    const half = Math.max(3, 2.1 * k);
    roundRect(ctx, -half * 0.62, -half, half * 1.24, half * 2, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ff9860';
    ctx.fillRect(-half * 0.4, -half * 0.8, half * 0.8, half * 0.5);
    ctx.restore();
  }

  // The rest of the crew, each in their suit colour.
  for (const mate of world.crew.points()) {
    ctx.beginPath();
    ctx.arc(X(mate.x), Y(mate.z), 3.4, 0, Math.PI * 2);
    ctx.fillStyle = mate.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  // The airlock: where a walk starts and ends.
  ctx.strokeStyle = '#7dffb0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(X(AIRLOCK.x), Y(AIRLOCK.z + 1.4), Math.max(3, 2.4 * k), 0, Math.PI * 2);
  ctx.stroke();

  // Doors into buildings.
  if (walking) {
    for (const door of world.eva.doorPoints()) {
      const dx = X(door.x);
      const dy = Y(door.z);
      if (Math.hypot(dx - half, dy - half) > half - 6) continue;
      ctx.fillStyle = '#7fe0ff';
      ctx.strokeStyle = 'rgba(20, 16, 40, 0.9)';
      ctx.lineWidth = 1.4;
      roundRect(ctx, dx - 3, dy - 4.5, 6, 9, 1.5);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Things to find outside. Far ones wait at the rim, as on a compass.
  if (walking) {
    for (const point of world.eva.mapPoints()) {
      if (point.done) continue;
      const material = point.kind === 'regolith' || point.kind === 'metal';
      // Materials show when near, or everywhere with the scanner.
      if (material && !world.eva.hasScanner && Math.hypot(point.x - world.eva.position.x, point.z - world.eva.position.z) > 34) continue;
      let px = X(point.x);
      let py = Y(point.z);
      const distance = Math.hypot(px - half, py - half);
      const edge = half - 9;
      const far = distance > edge;
      if (far) {
        px = half + ((px - half) / distance) * edge;
        py = half + ((py - half) / distance) * edge;
      }
      ctx.fillStyle =
        point.kind === 'sample'
          ? (SAMPLE_TINT[point.value] ?? '#ffffff')
          : point.kind === 'find'
            ? '#ffe08a'
            : point.kind === 'regolith'
              ? '#e8c08a'
              : point.kind === 'metal'
                ? '#9fd8ff'
                : '#ffd166';
      ctx.strokeStyle = 'rgba(20, 16, 40, 0.9)';
      ctx.lineWidth = 1.5;
      if (point.kind === 'regolith') {
        ctx.beginPath();
        ctx.arc(px, py, far ? 2.6 : 3.8, 0, Math.PI * 2);
      } else if (point.kind === 'metal') {
        const r = far ? 3 : 4.4;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          if (i === 0) ctx.moveTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
          else ctx.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
        }
        ctx.closePath();
      } else if (point.kind === 'chore') {
        ctx.beginPath();
        ctx.arc(px, py, far ? 3 : 4.5, 0, Math.PI * 2);
      } else if (point.kind === 'find') {
        star(ctx, px, py, far ? 5.5 : 7.5);
      } else {
        diamond(ctx, px, py, far ? 4 : 6);
      }
      ctx.fill();
      ctx.stroke();
    }
  }

  // The cadet: a soft cone for where the camera looks, an arrow for where the cadet faces.
  const px = walking ? half : X(AIRLOCK.x);
  const py = walking ? half : Y(AIRLOCK.z + 1.4);
  if (walking) {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-world.rig.yaw);
    const cone = ctx.createRadialGradient(0, 0, 2, 0, 0, half * 0.62);
    cone.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
    cone.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, half * 0.62, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(Math.PI - (walking ? world.eva.facing : Math.PI));
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(5.6, 6);
  ctx.lineTo(0, 3);
  ctx.lineTo(-5.6, 6);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(20, 16, 40, 0.95)';
  ctx.lineWidth = 1.6;
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

/** A round map in the corner, like the ones in adventure games. */
function Minimap({ site }: { site: SiteId }): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx) return;
    let frame = 0;
    let last = 0;
    const tick = (now: number): void => {
      frame = requestAnimationFrame(tick);
      if (now - last < 66) return; // a map does not need more than 15 pictures a second
      last = now;
      const world = getWorld();
      if (!world || !world.ready) return;
      const size = element.clientWidth;
      if (size < 8) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const pixels = Math.round(size * ratio);
      if (element.width !== pixels) element.width = element.height = pixels;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      paintMap(ctx, size, world, site);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [site]);
  return (
    <div class="minimap" aria-hidden="true">
      <canvas ref={canvas} />
      <span class="minimap-north">{t('map.north')}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The week's to-do list
// ---------------------------------------------------------------------------

const PHASES: { id: string; steps: Step[] }[] = [
  { id: 'briefing', steps: ['briefing'] },
  { id: 'event', steps: ['event', 'eventResult'] },
  { id: 'plan', steps: ['plan'] },
  { id: 'eva', steps: ['evaIntro', 'eva', 'evaResult'] },
  { id: 'night', steps: ['night'] },
  { id: 'report', steps: ['report'] },
];

/** What to do now, as a short quest list. During a walk it lists the walk's own goals. */
function Quest({ m }: { m: MissionState }): JSX.Element {
  const hud = evaHud.value;
  if (step.value === 'eva' && hud) {
    const mars = m.config.site === 'mars';
    const allFound = hud.samples >= hud.samplesTotal;
    return (
      <div class="quest" role="status">
        <b class="quest-title">{t('quest.outside')}</b>
        <ul>
          <li class={allFound ? 'is-done' : 'is-now'}>
            <i />
            <span>{t('quest.samples', { n: hud.samples, total: hud.samplesTotal })}</span>
          </li>
          {hud.choreAvailable && (
            <li class={hud.choreDone ? 'is-done' : 'is-now'}>
              <i />
              <span>{t(mars ? 'quest.choreMars' : 'quest.choreMoon')}</span>
            </li>
          )}
          <li class={hud.finds >= hud.findsTotal ? 'is-done' : 'is-now is-find'}>
            <i />
            <span>{t('quest.finds', { n: hud.finds, total: hud.findsTotal })}</span>
          </li>
          {(hud.materials.regolith > 0 || hud.materials.metal > 0) && (
            <li class="is-done">
              <i />
              <span>{t('quest.materials', { r: hud.materials.regolith, m: hud.materials.metal })}</span>
            </li>
          )}
          <li class="is-now is-home">
            <i />
            <span>{t('quest.home', { n: Math.round(hud.home) })}</span>
          </li>
        </ul>
      </div>
    );
  }
  const current = Math.max(
    0,
    PHASES.findIndex((phase) => phase.steps.includes(step.value)),
  );
  const skipEvent = !m.now.eventId;
  return (
    <div class="quest" role="status" aria-label={t(`phase.${PHASES[current].id}`)}>
      <b class="quest-title">{t('quest.title')}</b>
      <ul>
        {PHASES.map((phase, index) => {
          if (phase.id === 'event' && skipEvent) return null;
          const state = index === current ? 'is-now' : index < current ? 'is-done' : '';
          return (
            <li key={phase.id} class={state} aria-current={index === current ? 'step' : undefined}>
              <i />
              <span>
                {t(index === current ? (phase.id === 'eva' && step.value === 'evaResult' ? 'quest.evaDone' : `quest.${phase.id}`) : `phase.${phase.id}`)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top of the screen
// ---------------------------------------------------------------------------

/** Full screen on and off. Hidden where the browser has none (iPhone). */
function FullscreenBtn(): JSX.Element | null {
  const [full, setFull] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const sync = (): void => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  if (!document.documentElement.requestFullscreen) return null;
  return (
    <IconBtn
      icon={full ? 'shrink' : 'expand'}
      label={t(full ? 'hud.fullscreenOff' : 'hud.fullscreen')}
      onClick={() => {
        audio.play('click');
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => undefined);
      }}
    />
  );
}

export function Hud({ m }: { m: MissionState }): JSX.Element {
  const [tip, setTip] = useState<MeterId | null>(null);
  // Escape opens the pause menu, as in most games. It listens before the others (capture), so a key
  // that closes a menu, the printer, placing or the film never also opens the pause menu.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.repeat) return;
      // Not while a door fades (the room would open under the pause menu).
      if (panel.value !== 'none' || placing.value || cutscene.value || roomGame.value || printing.value || fading.value) return;
      openPanel('pause');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const env = currentEnv(m);
  const targets = starTargets(m.config);
  const startFood = Math.max(m.food, m.config.weeks * 0.75);
  const planning = step.value === 'plan';
  const battery = planning ? computeWeek(m).batteryAfter : m.battery;
  const doseShare = m.dose / m.doseLimit;
  // During a walk, samples already picked up count on the meter (discoveries are in m.science already).
  const walkHud = step.value === 'eva' ? evaHud.value : null;
  const science = m.science + (walkHud?.sampleScience ?? 0);
  const stars = science >= targets.three ? 3 : science >= targets.two ? 2 : 1;
  const unread = profile.value.unlocked.filter((id) => !profile.value.read.includes(id)).length;

  const meter = (id: MeterId, icon: IconName, value: string, bar: JSX.Element | null, danger = false): JSX.Element => (
    <button
      type="button"
      class={`meter meter-${id} ${danger ? 'is-danger' : ''} ${tip === id ? 'is-open' : ''}`}
      aria-label={`${t(`hud.${id}`)}: ${value}`}
      aria-expanded={tip === id}
      onClick={() => {
        audio.play('click');
        setTip(tip === id ? null : id);
      }}
    >
      <span class="meter-icon">
        <Icon name={icon} size={18} />
      </span>
      <span class="meter-main">
        <span class="meter-name">{t(`hud.${id}`)}</span>
        <b class="meter-value">{value}</b>
        {bar}
      </span>
    </button>
  );

  return (
    <header class="hud">
      <div class="hud-left">
        <Minimap site={m.config.site} />
        <div class="hud-week">
          <b>
            {t('common.weekOf', { n: m.week, total: m.config.weeks })}
            {m.config.creative && <span class="gi-creative">{t('creative.badge')}</span>}
          </b>
          <small>{fmtRange(env.dateFrom, env.dateTo)}</small>
        </div>
        <Quest m={m} />
      </div>

      <div class="meters" role="group">
        {meter(
          'power',
          'battery',
          `${battery}/${m.batteryCap}`,
          <span class="pips" aria-hidden="true">
            {Array.from({ length: m.batteryCap }, (_, index) => (
              <i key={index} class={index < battery ? 'is-on' : ''} />
            ))}
          </span>,
        )}
        {meter('air', 'air', `${Math.round(m.air)}%`, <Bar value={m.air} max={100} tone="air" danger={m.air < 25} />, m.air < 25)}
        {meter('food', 'food', t('hud.foodValue', { n: num(m.food, 1) }), <Bar value={m.food} max={startFood} tone="food" danger={m.food < 1.5} />, m.food < 1.5)}
        {meter(
          'dose',
          'dose',
          `${num(m.dose, 0)}/${m.doseLimit}`,
          <Bar value={m.dose} max={m.doseLimit} tone="dose" danger={doseShare > 0.8} />,
          doseShare > 0.8,
        )}
        {meter(
          'science',
          'science',
          String(science),
          <span class="mini-stars" aria-hidden="true">
            {[1, 2, 3].map((index) => (
              <Icon key={index} name="star" size={11} class={index <= stars ? 'lit' : 'dim'} />
            ))}
          </span>,
        )}
      </div>

      <div class="hud-buttons">
        {settings.value.showFps && <span class="fps">{t('hud.fps', { fps: fps.value })}</span>}
        <OutpostBtn m={m} />
        {CODEX.length > 0 && (
          <span class="with-dot">
            <IconBtn icon="book" label={t('menu.codex')} onClick={() => openPanel('codex')} />
            {unread > 0 && <i class="dot">{unread}</i>}
          </span>
        )}
        <FullscreenBtn />
        <IconBtn icon="menu" label={t('hud.menu')} onClick={() => openPanel('pause')} />
      </div>

      {tip && (
        <div class="meter-tip" role="status" onClick={() => setTip(null)}>
          <Rich text={t(`hud.${tip}Tip`)} />
          {tip === 'science' && (
            <p class="tip-extra">
              <Icon name="star" size={14} class="lit" /> {targets.two} · <Icon name="star" size={14} class="lit" />
              <Icon name="star" size={14} class="lit" /> {targets.three}
            </p>
          )}
        </div>
      )}
    </header>
  );
}

/** The Outpost button: materials in store, and a dot when something new can be built. */
function OutpostBtn({ m }: { m: MissionState }): JSX.Element {
  const busy = step.value === 'night' || step.value === 'eva';
  const ready = !busy && BUILDINGS.some((def) => !buildBlock(m, def.id));
  return (
    <span class={`with-dot gi-hud-btn ${ready ? 'is-ready' : ''}`}>
      <button
        type="button"
        class="icon-btn gi-outpost"
        disabled={busy}
        aria-label={t('hud.outpost')}
        title={`${t('hud.outpost')} · ${t('mat.regolith')} ${stockOf(m).regolith} · ${t('mat.metal')} ${stockOf(m).metal}`}
        onClick={() => openPanel('outpost')}
      >
        <Icon name="build" size={22} />
      </button>
      {ready && <i class="gi-dot" />}
    </span>
  );
}

/** The text of a line of Lumi as it is shown (a missing name would leave ", !" behind: tidy that up). */
function lumiText(line: NonNullable<typeof lumiLine.value>): string {
  const name = profile.value.name.trim();
  return t(line.key, { ...line.params, name }).replace(/,\s*!/, '!').replace(/\s+!/, '!');
}

/** A new line of Lumi is spoken at once when "Lumi speaks by itself" is on (see decideAutoSpeak in game/voice.ts). */
let seenLineId = -1;
function speakNewLine(line: NonNullable<typeof lumiLine.value>): void {
  // The bubble can mount again with the line that is already current (a panel opens and closes): not a new line.
  if (seenLineId === line.id) return;
  seenLineId = line.id;
  const now = (hasFile: boolean): 'file' | 'speech' | 'none' =>
    decideAutoSpeak({ autoSpeak: settings.value.autoSpeak, voices: settings.value.voice, hasFile, inFilm: cutscene.value, volume: settings.value.volume });
  // Nothing to do (the setting is off, a film plays, or the sound is off): nothing is downloaded either.
  if (now(false) === 'none') return;
  const text = lumiText(line);
  if (isRepeat(line.key)) return;
  void (settings.value.voice ? loadManifest() : Promise.resolve({})).then(() => {
    // A newer line came while the list of voices was loading: that one speaks.
    if (lumiLine.peek()?.id !== line.id) return;
    const what = now(settings.value.voice && hasLine(line.key, lang.value));
    if (what === 'none' || isRepeat(line.key)) return;
    // No voice of this device for the language and no file: nothing can sound, so the line is not marked as spoken.
    if (what === 'speech' && !canSpeak(lang.value)) return;
    speakAutoLine(what, line.key, text, lang.value);
  });
}

/** Lumi speaks: the helper's name, then the line, as in a story game. */
export function LumiBubble(): JSX.Element | null {
  const line = lumiLine.value;
  const [hidden, setHidden] = useState(0);
  const inFilm = cutscene.value;
  useEffect(() => {
    if (line) speakNewLine(line);
  }, [line?.id]);
  // A film speaks for itself: a line of Lumi that is still being read stops when it starts.
  useEffect(() => {
    if (inFilm) stopAutoLine();
  }, [inFilm]);
  if (!line || hidden === line.id) return null;
  const text = lumiText(line);
  return (
    <aside key={line.id} class={`lumi mood-${line.mood}`} aria-live="polite">
      <LumiFace mood={line.mood} />
      <div class="lumi-text">
        <b>{t('lumi.name')}</b>
        <p>
          <Rich text={text} />
        </p>
      </div>
      <div class="lumi-tools">
        <SpeakBtn text={text} voiceKey={line.key} auto={false} />
        <button type="button" class="lumi-close" aria-label={t('common.close')} onClick={() => setHidden(line.id)}>
          <Icon name="close" size={14} />
        </button>
      </div>
    </aside>
  );
}

const MARKERS: { id: MarkerId; module: ModuleId | null; icon: IconName }[] = [
  { id: 'life', module: 'life', icon: 'life' },
  { id: 'farm', module: 'farm', icon: 'plant' },
  { id: 'lab', module: 'lab', icon: 'lab' },
  { id: 'shield', module: 'shield', icon: 'shield' },
  { id: 'power', module: null, icon: 'sun' },
];

/**
 * Labels pinned above the buildings while planning. Tap one to add power,
 * so the plan can be made by touching the outpost itself.
 */
export function Markers({ m }: { m: MissionState }): JSX.Element {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    let frame = 0;
    const point: ScreenPoint = { x: 0, y: 0, visible: false };
    const tick = (): void => {
      frame = requestAnimationFrame(tick);
      const world = getWorld();
      if (!world) return;
      for (const marker of MARKERS) {
        const element = refs.current[marker.id];
        if (!element) continue;
        world.projectMarker(marker.id, point);
        element.style.transform = `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px) translate(-50%, -100%)`;
        element.style.opacity = point.visible ? '1' : '0';
        element.style.pointerEvents = point.visible ? 'auto' : 'none';
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div class="markers">
      {MARKERS.map((marker) => {
        const level = marker.module ? m.alloc[marker.module] : m.now.solar;
        const max = marker.module ? MAX_LEVEL[marker.module] : 0;
        const done = marker.module === 'shield' && robotIdle(m);
        return (
          <button
            key={marker.id}
            ref={(element) => {
              refs.current[marker.id] = element;
            }}
            type="button"
            class={`marker marker-${marker.id} ${marker.module && level === 0 ? 'is-off' : ''}`}
            aria-label={marker.module ? `${t(`mod.${marker.module}.name`)}: ${t('plan.level', { n: level })}` : t('mod.power.name')}
            onClick={() => marker.module && !done && cycleAlloc(marker.module)}
            onContextMenu={(event) => {
              event.preventDefault();
              if (marker.module) changeAlloc(marker.module, -1);
            }}
          >
            <Icon name={marker.icon} size={20} />
            {marker.module ? (
              <span class="marker-pips">
                {Array.from({ length: max }, (_, index) => (
                  <i key={index} class={index < level ? 'is-on' : ''} />
                ))}
              </span>
            ) : (
              <b>+{level}</b>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Colour of a pickup line: the sample colour by worth, gold for discoveries and chores. */
function pickupTint(item: Pickup): string {
  if (item.kind === 'sample') return SAMPLE_TINT[item.value] ?? '#ffffff';
  if (item.kind === 'material') return item.unit === 'metal' ? '#9fd8ff' : '#e8c08a';
  return item.kind === 'find' ? '#ffe08a' : '#8fd8ff';
}

/** What was just picked up, listed on the side of the screen as in adventure games. */
export function PickupFeed(): JSX.Element | null {
  const list = pickups.value;
  if (!list.length) return null;
  return (
    <ul class="pickups" aria-live="polite">
      {list.map((item) => (
        <li key={item.id} class={`pickup pickup-${item.kind}`} style={`--tint: ${pickupTint(item)}`}>
          <span class="pickup-icon">
            <Icon name={item.kind === 'material' ? (item.unit as IconName) : item.kind === 'find' ? 'star' : item.kind === 'chore' ? 'check' : 'sample'} size={17} />
          </span>
          <span class="pickup-name">{t(item.key, item.params)}</span>
          {item.value > 0 && (
            <b class="pickup-value">
              +{item.value} <Icon name={item.unit} size={13} />
            </b>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A discovery: a gold banner across the screen, the way adventure games show a new find. */
export function DiscoveryBanner(): JSX.Element | null {
  const current = discovery.value;
  if (!current) return null;
  if (current.kind === 'building') {
    return (
      <div key={current.key} class="discovery discovery-building" role="status">
        <span class="discovery-kicker">
          <Icon name="build" size={14} /> {t('build.kicker')} <Icon name="build" size={14} />
        </span>
        <b class="discovery-title">{t(`bld.${current.id}.name`)}</b>
        <small class="discovery-note">
          {t(`bld.${current.id}.effect`)} · {t(mission.value && isCreative(mission.value) ? 'build.noteCreative' : 'build.note')}
        </small>
      </div>
    );
  }
  const card = cardById(current.id);
  if (!card) return null;
  return (
    <div key={current.key} class="discovery" role="status">
      <span class="discovery-kicker">
        <Icon name="star" size={14} /> {t('find.kicker')} <Icon name="star" size={14} />
      </span>
      <b class="discovery-title">{card[lang.value].title}</b>
      <small class="discovery-note">{t(current.fresh ? 'find.note' : 'find.noteKnown', { n: current.science })}</small>
    </div>
  );
}

export function ToastView(): JSX.Element | null {
  const current = toast.value;
  if (!current) return null;
  return (
    <div key={current.id} class={`toast toast-${current.tone}`} role="status">
      <i />
      {t(current.key, current.params)}
    </div>
  );
}
