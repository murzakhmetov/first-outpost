/**
 * The mission screen: one panel for each step of the week.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  askMissionControl,
  beginWalk,
  changeAlloc,
  chooseEvent,
  confirmEvent,
  confirmPlan,
  continueBriefing,
  explainTask,
  finishWalk,
  getWorld,
  goNextWeek,
  recallWalk,
  skipNight,
  skipWalk,
  useSafePlan,
} from '../game/director';
import { earthAnswer, evaHud, evaResult, eventResult, lastRecord, mission, panel, settings, step, room } from '../game/store';
import { delayText, earthText, eventView, flareUrl, linkLabel, optionLabel, resultText, stormDataUrl, stormLine, sunLine } from '../game/view';
import { fmtDelay, num, signed, t } from '../i18n';
import { FINDS, FIND_SCIENCE, foundIn } from '../sim/finds';
import { computeWeek, currentEnv, evaStormChance, nextSolar } from '../sim/mission';
import { buildingDef, robotIdle, underConstruction } from '../sim/outpost';
import { CROP_WEEKS, DIFFICULTY, EVA_AIR_PER_SECOND, FARM_GROW, GLOBAL_DUST_STORM_2018 } from '../sim/sites';
import type { MissionState, ModuleId, WeekEnv } from '../sim/types';
import { MAX_LEVEL, MODULES } from '../sim/types';
import type { TaskId } from '../game/films';
import { Btn, FxChips, Rich, SpeakBtn } from './common';
import { CrewDock } from './CrewDock';
import { DiscoveryBanner, Hud, LumiBubble, Markers, PickupFeed } from './Hud';
import { Joystick } from './Joystick';
import { InteractPrompt } from './Prompt';
import { Icon } from './icons';
import type { IconName } from './icons';

const MODULE_ICON: Record<ModuleId, IconName> = { life: 'life', farm: 'plant', lab: 'lab', shield: 'shield' };
/** The task film that explains each machine of the plan. */
const MODULE_TASK: Record<ModuleId, TaskId> = { life: 'air', farm: 'food', lab: 'lab', shield: 'shield' };

/** "Why?": replays the film that says what this task is and why it matters. */
function WhyBtn({ task, compact = false }: { task: TaskId; compact?: boolean }): JSX.Element {
  const label = `${t('film.why')} ${t(`film.task.${task}.title`)}`;
  return (
    <button type="button" class={`why-btn ${compact ? 'is-compact' : ''}`} onClick={() => explainTask(task)} aria-label={label} title={label}>
      <Icon name="help" size={14} />
      {!compact && t('film.why')}
    </button>
  );
}

function Link({ href, children }: { href: string; children: string }): JSX.Element {
  return (
    <a class="link" href={href} target="_blank" rel="noopener noreferrer">
      {children} <Icon name="link" size={13} />
    </a>
  );
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

function Briefing({ m }: { m: MissionState }): JSX.Element {
  const env = currentEnv(m);
  const solar = m.now.solar;
  const next = nextSolar(m);
  const mars = m.config.site === 'mars';
  const storm = stormLine(m, env);
  const stormUrl = stormDataUrl(env);
  const flare = flareUrl(env);
  const sunKey = env.reason === 'dust' ? 'brief.sunDust' : env.reason === 'dark' ? 'brief.sunDark' : 'brief.sunClear';
  const nextLow = next !== null && (next <= solar - 2 || (m.plan[m.week]?.sunlight ?? 1) < 0.7);

  return (
    <section class="dock card briefing" aria-label={t('brief.title', { n: m.week })}>
      <h2>
        <Icon name="calendar" /> {t('brief.title', { n: m.week })}
        <WhyBtn task="forecast" />
      </h2>

      <div class="rows">
        <div class={`row ${env.reason !== 'clear' ? 'row-warn' : ''}`}>
          <span class="row-icon tone-power">
            <Icon name="sun" />
          </span>
          <div>
            <b>{t('brief.sun')}</b>
            <p>{t(sunKey, { n: solar })}</p>
            {m.panelDust >= 0.1 && <p class="sub">{t('brief.sunDusty')}</p>}
            {next !== null && <p class={`sub ${nextLow ? 'warn' : ''}`}>{t(nextLow ? 'brief.nextLow' : 'brief.next', { n: next })}</p>}
            {((!mars && env.reason === 'dark') || (mars && env.reason === 'dust' && !realDust(env))) && <span class="tag tag-model">{t('common.gameModel')}</span>}
          </div>
        </div>

        <div class="row">
          <span class="row-icon tone-air">
            <Icon name="temp" />
          </span>
          <div>
            <b>{t(mars ? 'brief.weather' : 'brief.moonWeather')}</b>
            {mars ? (
              <p>
                {env.tempReal
                  ? t('brief.weatherReal', { min: env.tempMin ?? 0, max: env.tempMax ?? 0, sol: env.sol ?? 0 })
                  : t('brief.weatherTypical', { min: env.tempMin ?? 0, max: env.tempMax ?? 0 })}
              </p>
            ) : (
              <p>{t('brief.moonWeatherText')}</p>
            )}
            {mars && env.tempReal && <span class="tag tag-real">{t('common.realData')} · Curiosity REMS</span>}
          </div>
        </div>

        <div class={`row ${env.storm.strength > 0 ? 'row-alert' : ''}`}>
          <span class="row-icon tone-dose">
            <Icon name="storm" />
          </span>
          <div>
            <b>{t('brief.space')}</b>
            <p>{sunLine(env)}</p>
            {storm && <p class="strong">{storm}</p>}
            {env.autoShelter && <p class="sub">{t('brief.autoShelter')}</p>}
            <span class="tag tag-real">{t('common.realData')} · NASA DONKI</span>{' '}
            {(stormUrl ?? flare) && <Link href={(stormUrl ?? flare)!}>{linkLabel((stormUrl ?? flare)!)}</Link>}
            <p class="sub">{t('brief.cosmic', { n: env.gcrWeek })}</p>
          </div>
        </div>

        <div class="row">
          <span class="row-icon tone-science">
            <Icon name="antenna" />
          </span>
          <div>
            <b>{t('brief.radio')}</b>
            {env.conjunction ? (
              <p class="strong">{t('brief.conjunction')}</p>
            ) : mars ? (
              <p>{t('brief.radioMars', { km: Math.round(env.earthDistanceKm / 1e6), delay: delayText(env) })}</p>
            ) : (
              <p>{t('brief.radioMoon', { km: num(Math.round(env.earthDistanceKm / 100) * 100, 0), delay: delayText(env) })}</p>
            )}
          </div>
        </div>
      </div>

      <footer class="card-foot">
        <Btn kind="primary" iconRight="next" wide autoFocus onClick={continueBriefing}>
          {t('brief.go')}
        </Btn>
      </footer>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Decision card
// ---------------------------------------------------------------------------

function EventCard({ m }: { m: MissionState }): JSX.Element | null {
  const view = eventView(m);
  const [waiting, setWaiting] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const answer = earthAnswer.value;
  const env = currentEnv(m);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!view) return null;

  const mars = m.config.site === 'mars';
  const minutes = Math.max(1, Math.round(env.delaySeconds / 60));
  const ask = (): void => {
    askMissionControl();
    const reply = earthAnswer.value;
    if (!reply) return;
    setWaiting(true);
    // The Moon's real round trip is under 3 seconds. Mars is shown faster than real, with the true minutes on screen.
    const seconds = reply.tooLate ? 2.6 : mars ? 3.4 : Math.max(1.6, reply.roundTripSeconds);
    timer.current = window.setTimeout(() => setWaiting(false), seconds * 1000);
  };
  const advised = answer && !waiting && !answer.tooLate ? answer.advice : null;

  return (
    <section class={`dock card event ${view.storm ? 'event-storm' : ''}`} aria-label={view.title}>
      <h2>
        <span class={`event-icon ${view.storm ? 'is-alert' : ''}`}>
          <Icon name={view.icon as IconName} size={26} />
        </span>
        {view.title}
        <SpeakBtn text={`${view.title}. ${view.body}`} />
        <WhyBtn task="event" />
      </h2>
      <p class="event-body">
        <Rich text={view.body} />
      </p>
      {view.storm > 0 && (
        <p class="event-data">
          <span class="tag tag-real">{t('common.realData')}</span> {t('brief.stormRisk', { level: t(`brief.stormLevel${view.storm}`) })}
          {view.dataUrl && (
            <>
              {' · '}
              <Link href={view.dataUrl}>{linkLabel(view.dataUrl)}</Link>
            </>
          )}
        </p>
      )}

      {!view.notice && <h3 class="choose">{t('ev.choose')}</h3>}
      <div class="options">
        {view.options.map((option) => (
          <button
            key={option.id}
            type="button"
            class={`option ${advised === option.id ? 'is-advised' : ''}`}
            disabled={!!option.blocked}
            onClick={() => chooseEvent(option.id)}
          >
            <span class="option-label">
              {option.label}
              {advised === option.id && (
                <em class="advice-tag">
                  <Icon name="earth" size={13} /> {t('earth.answer')}
                </em>
              )}
            </span>
            <FxChips fx={option.fx} notes={option.notes} />
            {option.blocked && <span class="option-block">{option.blocked}</span>}
          </button>
        ))}
      </div>

      {!view.notice && (
        <div class="help-row">
          {!answer && !env.conjunction && (
            <button type="button" class="ask" onClick={ask}>
              <Icon name="earth" size={18} />
              <span>
                <b>{t('earth.ask')}</b>
                <small>{mars ? t('earth.askMars', { min: minutes * 2 }) : t('earth.askMoon', { sec: num(env.delaySeconds * 2, 1) })}</small>
              </span>
            </button>
          )}
          {!answer && !env.conjunction && <WhyBtn task="earth" />}
          {env.conjunction && <p class="sub">{t('earth.blackout')}</p>}
          {view.hint && !showHint && (
            <button type="button" class="ask" onClick={() => setShowHint(true)}>
              <Icon name="info" size={18} />
              <span>
                <b>{t('earth.hint')}</b>
              </span>
            </button>
          )}
        </div>
      )}
      {showHint && <p class="hint-box">{view.hint}</p>}
      {answer && waiting && (
        <div class="signal" role="status">
          <Icon name="antenna" size={18} /> {t('earth.waiting')}
          <span class="signal-track">
            <i style={{ animationDuration: answer.tooLate ? '2.6s' : mars ? '3.4s' : `${Math.max(1.6, answer.roundTripSeconds)}s` }} />
          </span>
          <small>{fmtDelay(answer.roundTripSeconds)}</small>
        </div>
      )}
      {answer && !waiting && (
        <div class={`earth-box ${answer.tooLate ? 'is-late' : ''}`} role="status">
          <Icon name="earth" size={20} />
          <div>
            {answer.tooLate ? (
              <Rich text={t('earth.tooLate', { min: minutes, round: minutes * 2 })} />
            ) : (
              <>
                <b>{t('earth.answer')}:</b> {earthText(m, view.id)}
                {mars && view.urgent && <p class="sub">{t('earth.inTime', { round: minutes * 2 })}</p>}
                {answer.scienceCost > 0 && <p class="sub">{t('earth.cost', { n: answer.scienceCost })}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function EventResult({ m }: { m: MissionState }): JSX.Element | null {
  const result = eventResult.value;
  const view = eventView(m);
  if (!result || !view) return null;
  const text = resultText(m, result.eventId, result.optionId);
  const answer = earthAnswer.value;
  // An urgent card answered before Earth's reply could arrive: the reply comes later.
  const onMarsUrgent = m.config.site === 'mars' && view.urgent && !!answer?.tooLate && result.advice;
  return (
    <section class="dock card event-result" aria-label={t('ev.resultTitle')}>
      <h2>
        <Icon name="check" /> {t('ev.resultTitle')}
        <SpeakBtn text={`${text} ${view.story}`} />
      </h2>
      <p class="event-body">{text}</p>
      <FxChips fx={result.fx} />

      {onMarsUrgent && (
        <div class="earth-box" role="status">
          <Icon name="earth" size={20} />
          <div>
            <b>{t('earth.later')}</b>{' '}
            {result.optionId === result.advice ? t('earth.agreed') : t('earth.differed', { label: optionLabel(m, result.eventId, result.advice!) })}
          </div>
        </div>
      )}

      <div class="story">
        <h3>
          <Icon name="book" size={18} /> {t('ev.storyTitle')}
        </h3>
        <p>{view.story}</p>
        <p class="sub">
          {t('common.source')}: <Link href={view.sourceUrl}>{view.sourceTitle}</Link>
        </p>
      </div>

      <footer class="card-foot">
        <Btn kind="primary" iconRight="next" wide autoFocus onClick={confirmEvent}>
          {t('common.continue')}
        </Btn>
      </footer>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Power plan
// ---------------------------------------------------------------------------

function moduleLine(m: MissionState, module: ModuleId): string {
  const level = m.alloc[module];
  if (module === 'shield') {
    const site = underConstruction(m);
    if (site) return t(level > 0 ? 'mod.shield.building' : 'mod.shield.waiting', { name: t(`bld.${site.id}.name`) });
    if (m.shield >= 1) return t('mod.shield.done');
  }
  return t(`mod.${module}.l${level}`);
}

function farmExtra(m: MissionState): string {
  const level = m.alloc.farm;
  if (level === 0) return m.crop > 0 ? '' : t('mod.farm.empty');
  const growth = FARM_GROW[level];
  const weeks = Math.ceil((CROP_WEEKS - m.crop) / growth - 1e-6);
  return weeks <= 1 ? t('mod.farm.harvestNow') : t('mod.farm.harvestIn', { n: weeks });
}

/** Under the robot row: how far the building or the wall has got. */
function shieldExtra(m: MissionState): string {
  const site = underConstruction(m);
  if (site) return t('mod.shield.site', { done: site.progress, total: buildingDef(site.id).work });
  return t('mod.shield.built', { n: Math.round(m.shield * 100) });
}

function PlanPanel({ m }: { m: MissionState }): JSX.Element {
  const outcome = computeWeek(m);
  const now = m.now;
  const eventCost = -(now.eventFx.cells ?? 0);
  const total = now.available;
  const cells: (ModuleId | null)[] = [];
  for (const module of MODULES) for (let i = 0; i < m.alloc[module]; i++) cells.push(module);
  while (cells.length < total) cells.push(null);
  const airDelta = outcome.airAfter - m.air;
  const doseDelta = outcome.doseAfter - m.dose;

  return (
    <section class="dock card plan" aria-label={t('plan.title')}>
      <h2>
        <Icon name="power" /> {t('plan.title')}
        <WhyBtn task="plan" />
      </h2>
      <p class="plan-have">
        <b>{t('plan.have', { n: total })}</b>
        <small>
          {eventCost > 0
            ? t('plan.fromEvent', { sun: now.solar, battery: m.battery, cost: eventCost })
            : t('plan.from', { sun: now.solar, battery: m.battery })}
        </small>
      </p>
      <div class="cells" aria-hidden="true">
        {cells.map((module, index) => (
          <i key={index} class={module ? `cell cell-${module}` : 'cell cell-free'} />
        ))}
      </div>

      <div class="preview" aria-label={t('plan.endOfWeek')}>
        <h3>{t('plan.endOfWeek')}</h3>
        <div class="preview-grid">
          <span class={`pv ${airDelta < 0 ? 'bad' : airDelta > 0 ? 'good' : ''}`}>
            <Icon name="air" size={16} /> {t('plan.pAir')} <b>{outcome.airAfter}%</b> <em>{signed(airDelta, 0)}</em>
          </span>
          <span class={`pv ${outcome.hungry ? 'bad' : outcome.harvested ? 'good' : ''}`}>
            <Icon name="food" size={16} /> {t('plan.pFood')} <b>{num(outcome.foodAfter)}</b> <em>{signed(outcome.foodAfter - m.food)}</em>
          </span>
          <span class={`pv ${outcome.doseAfter > m.doseLimit * 0.8 ? 'bad' : ''}`}>
            <Icon name="dose" size={16} /> {t('plan.pDose')} <b>{num(outcome.doseAfter, 0)}</b> <em>{signed(doseDelta)}</em>
          </span>
          <span class={`pv ${outcome.parts.sciLab > 0 ? 'good' : ''}`}>
            <Icon name="science" size={16} /> {t('plan.pScience')} <b>{outcome.scienceAfter}</b> <em>{signed(outcome.parts.sciLab, 0)}</em>
          </span>
        </div>
        {outcome.airAfter <= 0 && <p class="danger">{t('plan.airDanger')}</p>}
        {outcome.hungry && <p class="danger">{t('plan.hungry')}</p>}
        {outcome.doseAfter >= m.doseLimit && <p class="danger">{t('plan.doseDanger')}</p>}
      </div>

      <div class="modules">
        {MODULES.map((module) => {
          const level = m.alloc[module];
          const max = MAX_LEVEL[module];
          const finished = module === 'shield' && robotIdle(m);
          const canAdd = level < max && outcome.leftover > 0 && !finished;
          return (
            <div key={module} class={`module module-${module} ${level === 0 ? 'is-off' : ''}`}>
              <i key={`pulse-${level}`} class="module-pulse" aria-hidden="true" />
              <span class="module-icon">
                <Icon name={MODULE_ICON[module]} size={24} />
              </span>
              <div class="module-text">
                <b>
                  {t(`mod.${module}.name`)} <WhyBtn task={MODULE_TASK[module]} compact />
                </b>
                <small>
                  <Rich text={t(`mod.${module}.what`)} />
                </small>
                <span class="module-effect">
                  {moduleLine(m, module)}
                  {module === 'farm' && farmExtra(m) && <em> · {farmExtra(m)}</em>}
                  {module === 'shield' && <em> · {shieldExtra(m)}</em>}
                </span>
              </div>
              <div class="stepper" role="group" aria-label={t(`mod.${module}.name`)}>
                <button type="button" aria-label={t('plan.less', { name: t(`mod.${module}.name`) })} disabled={level === 0} onClick={() => changeAlloc(module, -1)}>
                  <Icon name="minus" size={18} />
                </button>
                <span class="level" aria-label={t('plan.level', { n: level })}>
                  {Array.from({ length: max }, (_, index) => (
                    <i key={index} class={index < level ? 'is-on' : ''} />
                  ))}
                </span>
                <button type="button" aria-label={t('plan.more', { name: t(`mod.${module}.name`) })} class={canAdd ? '' : 'is-blocked'} disabled={level >= max || finished} onClick={() => changeAlloc(module, 1)}>
                  <Icon name="plus" size={18} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p class={`leftover ${outcome.wasted > 0 ? 'warn' : ''}`}>
        <Icon name="battery" size={18} /> {t('plan.left', { n: outcome.leftover })}
        {outcome.leftover > 0 && <> · {t('plan.toBattery', { n: outcome.batteryAfter })}</>}
        {outcome.wasted > 0 && <b> · {t('plan.wasted', { n: outcome.wasted })}</b>}
      </p>

      <footer class="card-foot two">
        <Btn kind="ghost" icon="shield" onClick={useSafePlan}>
          {t('plan.safe')}
        </Btn>
        <Btn kind="primary" iconRight="play" onClick={confirmPlan}>
          {t('plan.go')}
        </Btn>
      </footer>
    </section>
  );
}

/** The week lies in the real 2018 global dust storm (other Mars dust storms are the game's own). */
function realDust(env: WeekEnv): boolean {
  return env.dateFrom <= GLOBAL_DUST_STORM_2018.to && env.dateTo >= GLOBAL_DUST_STORM_2018.from;
}

// ---------------------------------------------------------------------------
// Walk outside
// ---------------------------------------------------------------------------

function EvaIntro({ m }: { m: MissionState }): JSX.Element {
  const env = currentEnv(m);
  const chance = evaStormChance(m);
  const risk =
    chance === 0
      ? 'eva.riskNone'
      : env.storm.basis === 'cme' && env.storm.strength >= 2
        ? 'eva.riskModel'
        : `eva.risk${env.storm.strength}`;
  const mars = m.config.site === 'mars';
  const chore = mars ? m.panelDust >= 0.1 : m.week % 2 === 0;
  const findsLeft = FINDS[m.config.site].length - foundIn(m).length;
  return (
    <section class="dock card eva-intro" aria-label={t('eva.title')}>
      <h2>
        <Icon name="walk" /> {t('eva.title')}
        <WhyBtn task="walk" />
      </h2>
      <p class="event-body">{t('eva.body')}</p>
      <ul class="facts">
        <li>
          <Icon name="air" size={18} /> {t('eva.costAir')}
        </li>
        <li>
          <Icon name="sample" size={18} /> {t('eva.samples')}
        </li>
        {findsLeft > 0 && (
          <li>
            <Icon name="star" size={18} /> {t('eva.finds', { n: FIND_SCIENCE })}
          </li>
        )}
        {chore && (
          <li>
            <Icon name={mars ? 'sun' : 'ice'} size={18} /> {t(mars ? 'eva.choreMars' : 'eva.choreMoon')}
          </li>
        )}
        <li class={chance > 0 ? 'warn' : ''}>
          <Icon name="storm" size={18} /> {t(risk)}
        </li>
      </ul>
      <footer class="card-foot two">
        <Btn kind="ghost" onClick={skipWalk}>
          {t('eva.stay')}
        </Btn>
        <Btn kind="primary" icon="walk" autoFocus onClick={beginWalk}>
          {t('eva.go')}
        </Btn>
      </footer>
    </section>
  );
}

function Arrow({ bearing, distance, tone, icon }: { bearing: number; distance: number; tone: string; icon: IconName }): JSX.Element {
  return (
    <span class={`arrow arrow-${tone}`}>
      <span class="arrow-dial" style={{ transform: `rotate(${(bearing * 180) / Math.PI}deg)` }}>
        <Icon name="arrow" size={20} />
      </span>
      <Icon name={icon} size={15} />
      <b>{t('common.metres', { n: Math.round(distance) })}</b>
    </span>
  );
}

function EvaScreen({ m }: { m: MissionState }): JSX.Element {
  const hud = evaHud.value;
  const mars = m.config.site === 'mars';
  const [showKeys, setShowKeys] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setShowKeys(false), 7000);
    return () => window.clearTimeout(timer);
  }, []);
  // The driving keys are shown for a few seconds each time the cadet gets into the rover.
  const driving = !!hud?.driving;
  const [showDriveKeys, setShowDriveKeys] = useState(false);
  useEffect(() => {
    if (!driving) {
      setShowDriveKeys(false);
      return undefined;
    }
    setShowDriveKeys(true);
    const timer = window.setTimeout(() => setShowDriveKeys(false), 7000);
    return () => window.clearTimeout(timer);
  }, [driving]);
  if (!hud) return <div class="eva" />;
  const touch = matchMedia('(pointer: coarse)').matches;
  const share = hud.timeLeft / hud.total;
  const alert = hud.alert !== null;
  const promptKey = !hud.prompt
    ? ''
    : hud.prompt.kind === 'regolith'
      ? 'eva.promptRegolith'
      : hud.prompt.kind === 'metal'
        ? 'eva.promptMetal'
        : hud.prompt.kind === 'sample'
      ? 'eva.promptSample'
      : hud.prompt.kind === 'find'
        ? 'eva.promptFind'
        : mars
          ? 'eva.promptChoreMars'
          : 'eva.promptChoreMoon';
  return (
    <div class={`eva ${alert ? 'is-alert' : ''}`}>
      <div class="eva-top">
        <span class="eva-chip">
          <Icon name="sample" size={16} /> {hud.samples}/{hud.samplesTotal}
        </span>
        <span class="eva-chip good">
          <Icon name="science" size={16} /> +{hud.science}
        </span>
        <span class="eva-chip bad">
          <Icon name="air" size={16} /> −{hud.airUsed}
        </span>
        {(hud.materials.regolith > 0 || hud.materials.metal > 0) && (
          <span class="eva-chip eva-chip-materials">
            <Icon name="regolith" size={15} /> {hud.materials.regolith} <Icon name="metal" size={15} /> {hud.materials.metal}
          </span>
        )}
        {hud.choreAvailable && (
          <span class={`eva-chip ${hud.choreDone ? 'good' : ''}`}>
            <Icon name={hud.choreDone ? 'check' : mars ? 'sun' : 'ice'} size={16} />
          </span>
        )}
      </div>

      <div class="eva-arrows">
        <Arrow bearing={hud.homeBearing} distance={hud.home} tone="home" icon="home" />
        {hud.nextBearing !== null && hud.nextDistance !== null && !alert && (
          <Arrow bearing={hud.nextBearing} distance={hud.nextDistance} tone="sample" icon="sample" />
        )}
      </div>

      {alert && (
        <div class="alarm" role="alert">
          <Icon name="warn" size={26} />
          <span>{t('eva.alert')}</span>
          <b>{t('eva.alertTime', { n: Math.ceil(hud.alert ?? 0) })}</b>
        </div>
      )}

      {hud.prompt && hud.prompt.sweep === undefined && !hud.prompt.tension && (
        <div class="prompt" role="status">
          {t(promptKey)}
          <span class="prompt-bar">
            <i style={{ width: `${hud.prompt.progress * 100}%` }} />
          </span>
        </div>
      )}

      {/* Metal: hold to keep the marker inside the wandering zone. */}
      {hud.prompt && hud.prompt.tension && (
        <div class={`prompt prompt-dig dig-metal tension ${hud.prompt.tension.inside ? 'is-inside' : ''}`} role="status">
          <span class="dig-title">
            <Icon name="metal" size={16} /> {t(promptKey)}
          </span>
          <span class="dig-meter tension-meter" aria-hidden="true">
            <span
              class="tension-zone"
              style={{ left: `${(hud.prompt.tension.zone - hud.prompt.tension.width / 2) * 100}%`, width: `${hud.prompt.tension.width * 100}%` }}
            />
            <span class="dig-cursor" style={{ left: `${hud.prompt.tension.cursor * 100}%` }} />
          </span>
          <span class="prompt-bar">
            <i style={{ width: `${hud.prompt.progress * 100}%` }} />
          </span>
          <small>{t(touch ? 'eva.tensionHintTouch' : 'eva.tensionHint')}</small>
        </div>
      )}

      {/* Digging: the bar fills by itself; a press in the gold zone gives one more. */}
      {hud.prompt && hud.prompt.sweep !== undefined && hud.prompt.zone && (
        <div class={`prompt prompt-dig dig-${hud.prompt.kind} ${hud.prompt.tried ? 'is-tried' : ''}`} role="status">
          <span class="dig-title">
            <Icon name={hud.prompt.kind === 'metal' ? 'metal' : 'regolith'} size={16} /> {t(promptKey)}
          </span>
          <span class="dig-meter" aria-hidden="true">
            <span class="dig-gold" style={{ left: `${hud.prompt.zone[0] * 100}%`, width: `${(hud.prompt.zone[1] - hud.prompt.zone[0]) * 100}%` }} />
            {!hud.prompt.tried && <span class="dig-cursor" style={{ left: `${hud.prompt.sweep * 100}%` }} />}
          </span>
          <span class="prompt-bar">
            <i style={{ width: `${hud.prompt.progress * 100}%` }} />
          </span>
          <small>{hud.prompt.tried ? t('eva.digKeep') : t(touch ? 'eva.digHintTouch' : 'eva.digHint')}</small>
        </div>
      )}

      {hud.door && !hud.prompt && <InteractPrompt icon="door" tone="cyan" text={t('eva.goInto', { name: t(`room.${hud.door}.name`) })} />}

      {showKeys && !alert && !hud.driving && <p class="eva-keys">{touch ? t('eva.touch') : t('eva.keys')}</p>}
      {showDriveKeys && !alert && <p class="eva-keys">{touch ? t('eva.touchDrive') : t('eva.driveKeys')}</p>}

      {hud.canDrive && !hud.door && <InteractPrompt icon="rover" tone="gold" text={t('eva.driveIn')} />}

      {/* The rover battery, above the suit air, while driving. */}
      {hud.driving && (
        <div class={`suitbar chargebar ${hud.charge < 0.2 ? 'is-low' : ''}`} role="meter" aria-label={t('eva.charge')} aria-valuenow={Math.round(hud.charge * 100)}>
          <span class="suitbar-label">
            <Icon name="battery" size={15} /> {t('eva.charge')}
          </span>
          <span class="suitbar-track">
            <i style={{ width: `${Math.max(0, Math.min(1, hud.charge)) * 100}%` }} />
          </span>
          <b>{t('eva.kmh', { n: Math.round(hud.driveSpeed * 3.6) })}</b>
        </div>
      )}

      {/* Suit air: one long bar at the bottom of the screen. */}
      <div class={`suitbar ${share < 0.25 ? 'is-low' : ''} ${hud.running ? 'is-run' : ''}`} role="timer" aria-label={t('eva.time')}>
        <span class="suitbar-label">
          <Icon name="air" size={15} /> {t('eva.suit')}
        </span>
        <span class="suitbar-track">
          <i style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }} />
        </span>
        <b>{t('eva.seconds', { n: Math.ceil(hud.timeLeft) })}</b>
      </div>

      <Joystick />
      {hud.prompt && hud.prompt.tension && (
        <button
          type="button"
          class="round round-drive round-dig"
          onPointerDown={(event) => {
            event.preventDefault();
            getWorld()?.input.setUse(true);
          }}
          onPointerUp={() => getWorld()?.input.setUse(false)}
          onPointerLeave={() => getWorld()?.input.setUse(false)}
          onPointerCancel={() => getWorld()?.input.setUse(false)}
        >
          <Icon name="drill" size={26} />
          <small>{t('eva.hold')}</small>
        </button>
      )}
      {hud.prompt && hud.prompt.sweep !== undefined && !hud.prompt.tried && (
        <button type="button" class="round round-drive round-dig" onClick={() => getWorld()?.input.pressInteract()}>
          <Icon name="drill" size={26} />
          <small>{t('eva.dig')}</small>
        </button>
      )}
      {hud.door && !hud.prompt && !hud.canDrive && (
        <button type="button" class="round round-drive round-door" onClick={() => getWorld()?.input.pressInteract()}>
          <Icon name="door" size={26} />
          <small>{t('eva.goIn')}</small>
        </button>
      )}
      {hud.canDrive && (
        <button type="button" class="round round-drive" onClick={() => getWorld()?.input.pressInteract()}>
          <Icon name="rover" size={26} />
          <small>{t('eva.drive')}</small>
        </button>
      )}
      <div class={`eva-buttons ${hud.driving ? 'is-driving' : ''}`}>
        {!hud.driving && (
        <button
          type="button"
          class={`round round-run ${hud.running ? 'is-on' : ''}`}
          onPointerDown={(event) => {
            event.preventDefault();
            getWorld()?.input.setSprint(true);
          }}
          onPointerUp={() => getWorld()?.input.setSprint(false)}
          onPointerLeave={() => getWorld()?.input.setSprint(false)}
          onPointerCancel={() => getWorld()?.input.setSprint(false)}
        >
          <Icon name="walk" size={24} />
          <small>{t('eva.run')}</small>
        </button>
        )}
        {!hud.driving && (
          <button type="button" class={`round round-view ${settings.value.firstPerson ? 'is-on' : ''}`} onClick={() => getWorld()?.input.pressView()}>
            <Icon name="eye" size={24} />
            <small>{t('eva.view')}</small>
          </button>
        )}
        <button type="button" class="round" disabled={alert} onClick={recallWalk}>
          <Icon name="home" size={24} />
          <small>{t('eva.back')}</small>
        </button>
        {hud.driving ? (
          <button type="button" class="round round-big" onClick={() => getWorld()?.input.pressInteract()}>
            <Icon name="walk" size={30} />
            <small>{t('eva.exit')}</small>
          </button>
        ) : (
          <button
            type="button"
            class="round round-big"
            onPointerDown={(event) => {
              event.preventDefault();
              getWorld()?.input.pressJump();
            }}
          >
            <Icon name="jump" size={30} />
            <small>{t('eva.jump')}</small>
          </button>
        )}
      </div>
    </div>
  );
}

function EvaResultCard({ m }: { m: MissionState }): JSX.Element | null {
  const outcome = evaResult.value;
  if (!outcome) return null;
  const { result, reason } = outcome;
  const mars = m.config.site === 'mars';
  const air = Math.min(9, Math.round(result.seconds * EVA_AIR_PER_SECOND));
  const finds = result.finds?.length ?? 0;
  // Science from rock samples and from discoveries, each on its own line.
  const findScience = finds * FIND_SCIENCE;
  const sampleScience = result.science;
  return (
    <section class="dock card eva-result" aria-label={t('eva.resultTitle')}>
      <h2>
        <Icon name="home" /> {t('eva.resultTitle')}
      </h2>
      <ul class="facts">
        <li class={result.samples ? 'good' : ''}>
          <Icon name="sample" size={18} />{' '}
          <span>
            {result.samples ? t('eva.resultSamples', { n: result.samples }) : t('eva.resultNone')}
            {sampleScience > 0 && <b> +{sampleScience}</b>}
          </span>
        </li>
        {result.materials && result.materials.regolith + result.materials.metal > 0 && (
          <li class="good">
            <Icon name="build" size={18} />{' '}
            <span>
              {t('eva.resultMaterials', { r: result.materials.regolith, m: result.materials.metal })}
            </span>
          </li>
        )}
        {finds > 0 && (
          <li class="good">
            <Icon name="star" size={18} />{' '}
            <span>
              {t('eva.resultFinds', { n: finds })} <b>+{findScience}</b>
            </span>
          </li>
        )}
        <li>
          <Icon name="air" size={18} /> {t('eva.airUsed')}: −{air}
        </li>
        {result.chore && (
          <li class="good">
            <Icon name="check" size={18} /> {t(mars ? 'eva.resultChoreMars' : 'eva.resultChoreMoon')}
          </li>
        )}
        {result.alerted && !result.caught && (
          <li class="good">
            <Icon name="shield" size={18} /> {t('eva.resultSafe')}
          </li>
        )}
        {result.caught && (
          <li class="warn">
            <Icon name="warn" size={18} /> {t('eva.resultCaught')}
          </li>
        )}
        {reason === 'timeout' && (
          <li>
            <Icon name="info" size={18} /> {t('eva.resultTimeout')}
          </li>
        )}
      </ul>
      <footer class="card-foot">
        <Btn kind="primary" iconRight="next" wide autoFocus onClick={finishWalk}>
          {t('common.continue')}
        </Btn>
      </footer>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Night and report
// ---------------------------------------------------------------------------

const SKIP_KEYS = ['Space', 'Enter', 'NumpadEnter'];

/**
 * After a key skipped the night, the same key held down must not also press the buttons that
 * come next ("Next week" gets the focus when the report opens). Its repeats are dropped until it
 * is let go (or the window loses focus, or 5 seconds pass).
 */
function swallowHeldKey(code: string): void {
  let timer = 0;
  const onDown = (event: KeyboardEvent): void => {
    if (event.code !== code) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onUp = (event: KeyboardEvent): void => {
    if (event.code !== code) return;
    event.preventDefault();
    stop();
  };
  const stop = (): void => {
    window.clearTimeout(timer);
    window.removeEventListener('keydown', onDown, true);
    window.removeEventListener('keyup', onUp, true);
    window.removeEventListener('blur', stop);
  };
  window.addEventListener('keydown', onDown, true);
  window.addEventListener('keyup', onUp, true);
  window.addEventListener('blur', stop);
  timer = window.setTimeout(stop, 5000);
}

function Night({ m }: { m: MissionState }): JSX.Element {
  // Space, Enter or a tap skips the rest of the night.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!SKIP_KEYS.includes(event.code)) return;
      // Only a plain press on the game itself: not a held key, not a shortcut, not while a menu is
      // open, and not when a button or a field has the focus (the key belongs to it then).
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
      if (panel.value !== 'none') return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && target !== document.body && target.closest('button, a, input, select, textarea, [role="button"], [role="dialog"], [contenteditable="true"]')) return;
      event.preventDefault();
      skipNight();
      swallowHeldKey(event.code);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // The night button itself, when it has the focus: skip here, and keep the held key away from what comes next.
  const onButtonKey = (event: KeyboardEvent): void => {
    if (!SKIP_KEYS.includes(event.code)) return;
    event.preventDefault();
    if (event.repeat) return;
    skipNight();
    swallowHeldKey(event.code);
  };
  return (
    <>
      <p class="sr-only" role="status">
        {t('night.title', { n: m.week })} {t(m.config.site === 'mars' ? 'night.sols' : 'night.days')}
      </p>
      <button type="button" class="night" onClick={skipNight} onKeyDown={onButtonKey} aria-label={t('night.skip')}>
        <b>{t('night.title', { n: m.week })}</b>
        <small>{t(m.config.site === 'mars' ? 'night.sols' : 'night.days')}</small>
        <span class="night-dots" aria-hidden="true">
          {Array.from({ length: 7 }, (_, index) => (
            <i key={index} style={{ animationDelay: `${index * 0.5}s` }} />
          ))}
        </span>
        <em class="night-skip">{t('night.skip')}</em>
      </button>
    </>
  );
}

function Part({ label, value, digits = 0 }: { label: string; value: number; digits?: number }): JSX.Element | null {
  if (!value) return null;
  return (
    <span class={`part ${value > 0 ? 'plus' : 'minus'}`}>
      {label} <b>{signed(value, digits)}</b>
    </span>
  );
}

function Report({ m }: { m: MissionState }): JSX.Element | null {
  const record = lastRecord.value;
  if (!record) return null;
  const p = record.parts;
  const before = m.history[m.history.length - 2];
  const begin = DIFFICULTY[m.config.difficulty];
  // The week is measured from where it began (saved with the week; older saves: last week's record).
  const weekStart = m.now.start;
  const airBefore = weekStart ? weekStart.air : before ? before.air : begin.airStart;
  // The tank holds 100%: what the rows add up to beyond that is lost, and the report says so.
  const airRows = p.airLife + p.airBonus + p.airEvent + p.airEva + (p.airIce ?? 0) + (p.airRooms ?? 0);
  // Only a loss counts as "full" (a walk can also drain the tank to empty); saves from before the week
  // remembered its start have no reliable start, so no row.
  const airLimit = weekStart ? Math.min(0, Math.round((record.air - airBefore - airRows) * 10) / 10) : 0;
  const batteryBefore = weekStart?.battery ?? before?.battery ?? record.battery;
  const last = m.week >= m.config.weeks;
  const firstHarvest = record.harvested && m.harvests === 1;
  const doseTotal = p.doseGcr + p.doseStorm + p.doseEvent;
  const scienceTotal = record.science - (weekStart ? weekStart.science : before ? before.science : 0);
  const foodBefore = weekStart ? weekStart.food : before ? before.food : Math.round(m.config.weeks * begin.foodFactor * 10) / 10;
  const foodTotal = Math.round((record.food - foodBefore) * 10) / 10;
  // The building the robot worked on this week, if any.
  const buildSite = record.built ? (m.buildings?.find((item) => item.id === record.built) ?? null) : (p.build ?? 0) > 0 ? underConstruction(m) : null;

  return (
    <section class="dock card report" aria-label={t('report.title', { n: record.week })}>
      <h2>
        <Icon name="check" /> {t('report.title', { n: record.week })}
        <WhyBtn task="night" />
      </h2>

      <div class="report-rows">
        <div class={`rrow tone-air ${record.air < 25 ? 'is-bad' : ''}`}>
          <span class="rrow-head">
            <Icon name="air" size={18} /> {t('report.air')} <b>{record.air}%</b>
            <em>{signed(record.air - Math.round(Math.min(100, Math.max(0, airBefore))), 0)}</em>
          </span>
          <span class="parts">
            <Part label={t('report.airLife', { n: record.alloc.life })} value={p.airLife} />
            <Part label={t('report.airBonus')} value={p.airBonus} />
            <Part label={t('report.airEva')} value={p.airEva} />
            <Part label={t('report.airEvent')} value={p.airEvent} />
            <Part label={t('report.airIce')} value={p.airIce ?? 0} />
            <Part label={t('report.rooms')} value={p.airRooms ?? 0} />
            {Math.abs(airLimit) >= 0.5 && <Part label={t('report.airLimit')} value={airLimit} />}
          </span>
        </div>

        <div class={`rrow tone-food ${record.hungry ? 'is-bad' : ''}`}>
          <span class="rrow-head">
            <Icon name="food" size={18} /> {t('report.food')} <b>{t('hud.foodValue', { n: num(record.food) })}</b>
            <em>{signed(foodTotal)}</em>
          </span>
          <span class="parts">
            <Part label={t('report.foodEaten')} value={p.foodEaten} digits={1} />
            <Part label={t('report.foodHarvest')} value={p.foodHarvest} digits={1} />
            <Part label={t('report.foodBuild')} value={p.foodBuild ?? 0} digits={1} />
            <Part label={t('report.foodEvent')} value={p.foodEvent} digits={1} />
            <Part label={t('report.rooms')} value={p.foodRooms ?? 0} digits={1} />
          </span>
        </div>

        <div class={`rrow tone-dose ${record.dose > m.doseLimit * 0.8 ? 'is-bad' : ''}`}>
          <span class="rrow-head">
            <Icon name="dose" size={18} /> {t('report.dose')} <b>{t('hud.doseValue', { n: num(record.dose, 0), limit: m.doseLimit })}</b>
            <em>{signed(doseTotal)}</em>
          </span>
          <span class="parts">
            <Part label={t('report.doseGcr')} value={p.doseGcr} digits={1} />
            <Part label={t('report.doseStorm')} value={p.doseStorm} digits={1} />
            <Part label={t('report.doseEvent')} value={p.doseEvent} digits={1} />
            {record.doseAvoided >= 0.5 && <span class="part saved">{t('report.doseAvoided', { n: record.doseAvoided })}</span>}
          </span>
        </div>

        <div class="rrow tone-science">
          <span class="rrow-head">
            <Icon name="science" size={18} /> {t('report.science')} <b>{record.science}</b>
            <em>{signed(scienceTotal, 0)}</em>
          </span>
          <span class="parts">
            <Part label={t('report.sciLab')} value={p.sciLab} />
            <Part label={t('report.sciEva')} value={p.sciEva} />
            <Part label={t('report.sciFinds')} value={p.sciFinds ?? 0} />
            <Part label={t('report.sciBuild')} value={p.sciBuild ?? 0} />
            <Part label={t('report.sciEvent')} value={p.sciEvent} />
            <Part label={t('report.rooms')} value={p.sciRooms ?? 0} />
          </span>
        </div>

        <div class="rrow tone-power">
          <span class="rrow-head">
            <Icon name="battery" size={18} /> {t('report.battery')} <b>{record.battery}/{m.batteryCap}</b>
            <em>{signed(record.battery - batteryBefore, 0)}</em>
          </span>
        </div>

        {p.shield > 0 && (
          <div class="rrow tone-shield">
            <span class="rrow-head">
              <Icon name="shield" size={18} /> {t('report.shield')} <b>{Math.round(record.shield * 100)}%</b>
              <em>{signed(p.shield * 100, 0)}%</em>
            </span>
          </div>
        )}
        {buildSite && (
          <div class={`rrow tone-build ${record.built ? 'is-good' : ''}`}>
            <span class="rrow-head">
              <Icon name="build" size={18} /> {t('report.build')} <b>{t(`bld.${buildSite.id}.name`)}</b>
              <em>{record.built ? t('report.builtDone') : `${buildSite.progress}/${buildingDef(buildSite.id).work}`}</em>
            </span>
          </div>
        )}
      </div>

      <ul class="notes">
        {record.built && <li class="good">{t('report.built', { name: t(`bld.${record.built}.name`) })}</li>}
        {record.harvested && <li class="good">{t(firstHarvest ? 'report.harvest' : 'report.harvestAgain')}</li>}
        {record.cropDied && <li class="bad">{t('report.cropDied')}</li>}
        {record.hungry && <li class="bad">{t('report.hungry')}</li>}
        {record.wasted > 0 && <li class="warn">{t('report.wasted', { n: record.wasted })}</li>}
        {record.air < 25 && <li class="bad">{t('report.airLow')}</li>}
        {record.dose > m.doseLimit * 0.8 && <li class="bad">{t('report.doseHigh')}</li>}
        {record.efficiency < 0.95 && <li class="warn">{t('report.efficiency', { n: Math.round(record.efficiency * 100) })}</li>}
      </ul>

      <footer class="card-foot">
        <Btn kind="primary" iconRight="next" wide autoFocus onClick={goNextWeek}>
          {t(last ? 'report.finish' : 'report.next')}
        </Btn>
      </footer>
    </section>
  );
}

// ---------------------------------------------------------------------------

export function Game(): JSX.Element | null {
  const m = mission.value;
  const current = step.value;
  const stage = useRef<HTMLDivElement>(null);
  // Tell the styles how tall the docked card is, so Lumi's bubble can sit just above it on phones.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = (): void => {
      const dock = element.querySelector<HTMLElement>('.dock');
      element.style.setProperty('--dock-h', `${dock ? dock.offsetHeight : 0}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    const dock = element.querySelector('.dock');
    if (dock) observer.observe(dock);
    observer.observe(element);
    return () => observer.disconnect();
  }, [current, m?.week]);
  if (!m) return null;
  if (room.value) {
    // Inside a building: the room has its own screen (Rooms.tsx); Lumi and the notices stay.
    return (
      <div class={`screen game in-room site-${m.config.site}`}>
        <div class="stage" ref={stage}>
          <LumiBubble />
        </div>
        <DiscoveryBanner />
        <PickupFeed />
      </div>
    );
  }
  return (
    <div class={`screen game step-${current} site-${m.config.site} ${current === 'eva' && evaHud.value?.driving ? 'is-driving' : ''}`}>
      <Hud m={m} />
      <div class="stage" ref={stage}>
        {current === 'briefing' && <Briefing m={m} />}
        {current === 'event' && <EventCard key={`${m.week}-${m.now.eventId}`} m={m} />}
        {current === 'eventResult' && <EventResult m={m} />}
        {current === 'plan' && <PlanPanel m={m} />}
        {current === 'evaIntro' && <EvaIntro m={m} />}
        {current === 'eva' && <EvaScreen m={m} />}
        {current === 'evaResult' && <EvaResultCard m={m} />}
        {current === 'night' && <Night m={m} />}
        {current === 'report' && <Report m={m} />}
        <LumiBubble />
      </div>
      <DiscoveryBanner />
      <PickupFeed />
      <CrewDock />
      {current === 'plan' && <Markers m={m} />}
    </div>
  );
}
