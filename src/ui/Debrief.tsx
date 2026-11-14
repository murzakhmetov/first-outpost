/**
 * After the mission: stars, a chart of the whole mission, and plain-language
 * links between the player's choices and what happened.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { audio } from '../game/audio';
import { saveCertificate } from '../game/certificate';
import { cardById } from '../game/codex';
import { goTitle, missionInsights, openPanel, openSetup, playAgain, wearSuit } from '../game/director';
import { codexFocus, mission, newBadges, newCards, newRank, newSuits, notify, profile } from '../game/store';
import { SUIT_COLORS } from '../world/astronaut';
import { fmtDate, fmtRange, lang, num, t } from '../i18n';
import { addDays } from '../sim/ephemeris';
import { starTargets } from '../sim/mission';
import { DIFFICULTY } from '../sim/sites';
import type { MissionState } from '../sim/types';
import { Btn, Stars } from './common';
import { Icon } from './icons';
import type { IconName } from './icons';

interface Series {
  id: 'air' | 'food' | 'dose' | 'science';
  icon: IconName;
  values: number[];
}

function Chart({ m }: { m: MissionState }): JSX.Element {
  const log = m.history;
  const targets = starTargets(m.config);
  const startFood = Math.round(m.config.weeks * DIFFICULTY[m.config.difficulty].foodFactor * 10) / 10;
  const startAir = DIFFICULTY[m.config.difficulty].airStart;
  const maxScience = Math.max(targets.three, m.science, 1);
  const maxFood = Math.max(startFood, ...log.map((week) => week.food), 1);
  const series: Series[] = [
    { id: 'air', icon: 'air', values: [startAir / 100, ...log.map((week) => week.air / 100)] },
    { id: 'food', icon: 'food', values: [startFood / maxFood, ...log.map((week) => week.food / maxFood)] },
    { id: 'dose', icon: 'dose', values: [0, ...log.map((week) => Math.min(1, week.dose / m.doseLimit))] },
    { id: 'science', icon: 'science', values: [0, ...log.map((week) => week.science / maxScience)] },
  ];
  const width = 640;
  const height = 220;
  const left = 30;
  const right = 14;
  const top = 14;
  const bottom = 30;
  const weeks = m.config.weeks;
  const x = (index: number): number => left + (index / weeks) * (width - left - right);
  const y = (value: number): number => top + (1 - value) * (height - top - bottom);
  const names: Record<string, string> = { air: t('hud.air'), food: t('hud.food'), dose: t('hud.dose'), science: t('hud.science') };

  return (
    <figure class="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('end.chart')}>
        {[0, 0.5, 1].map((level) => (
          <line key={level} x1={left} x2={width - right} y1={y(level)} y2={y(level)} class="grid" />
        ))}
        {Array.from({ length: weeks + 1 }, (_, index) => (
          <text key={index} x={x(index)} y={height - 8} class="tick" text-anchor="middle">
            {index}
          </text>
        ))}
        {/* Weeks with a real solar storm. */}
        {log
          .filter((week) => week.storm > 0)
          .map((week) => (
            <rect key={week.week} x={x(week.week - 1)} width={x(1) - x(0)} y={top} height={height - top - bottom} class="storm-band" />
          ))}
        {series.map((line) => (
          <g key={line.id} class={`line line-${line.id}`}>
            <polyline points={line.values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ')} />
            {line.values.map((value, index) => (
              <circle key={index} cx={x(index)} cy={y(value)} r={index === line.values.length - 1 ? 4.5 : 2.6} />
            ))}
          </g>
        ))}
      </svg>
      <figcaption>
        {series.map((line) => (
          <span key={line.id} class={`legend legend-${line.id}`}>
            <Icon name={line.icon} size={14} /> {names[line.id]}
          </span>
        ))}
        {log.some((week) => week.storm > 0) && (
          <span class="legend legend-storm">
            <Icon name="storm" size={14} /> {t('brief.space')}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

export function Debrief(): JSX.Element | null {
  const m = mission.value;
  const [saving, setSaving] = useState(false);
  if (!m) return null;
  const won = m.end === 'complete';
  const reason = m.end ?? 'complete';
  const targets = starTargets(m.config);
  const toNext = won && m.stars < 3 ? (m.stars === 1 ? targets.two : targets.three) - m.science : 0;
  const insights = missionInsights();
  const from = m.config.startDate;
  const to = addDays(from, m.history.length * 7 - 1);
  const range = fmtRange(from, to).split(' – ');
  void lang.value;

  return (
    <div class="screen debrief">
      <section class={`sheet ${won ? 'is-win' : 'is-loss'}`} role="dialog" aria-label={t(`end.${reason}`)}>
        <div class="sheet-body">
          <header class="end-head">
            {won && <Stars count={m.stars} big />}
            <h2>{t(`end.${reason}`)}</h2>
            <p>{t(`end.${reason}Sub`)}</p>
            <p class="end-line">{t(`end.stars${m.stars}`)}</p>
            {toNext > 0 && <p class="sub">{t('end.nextStar', { n: toNext })}</p>}
          </header>

          <div class="stats">
            <span>
              <Icon name="calendar" />
              <b>{m.history.length}/{m.config.weeks}</b>
              <small>{t('end.weeks')}</small>
            </span>
            <span>
              <Icon name="science" />
              <b>{m.science}</b>
              <small>{t('end.science')}</small>
            </span>
            <span>
              <Icon name="dose" />
              <b>{num(m.dose, 0)}/{m.doseLimit}</b>
              <small>
                {t('end.dose')} · {t('common.msv')}
              </small>
            </span>
            <span>
              <Icon name="plant" />
              <b>{m.harvests}</b>
              <small>{t('end.harvests')}</small>
            </span>
          </div>

          {(newRank.value || newSuits.value.length > 0) && <h3>{t('reward.title')}</h3>}
          {newRank.value && (
            <>
              <div class="suit-reward">
                <span class="suit-dot rank-dot" aria-hidden="true">
                  <Icon name="badge" size={22} />
                </span>
                <span>
                  <b>{t('reward.rank')}</b>
                  <small>{t(`rank.${newRank.value}`)}</small>
                </span>
              </div>
            </>
          )}

          {newSuits.value.length > 0 && (
            <>
              <div class="suit-rewards">
                {newSuits.value.map((color) => (
                  <div key={color} class="suit-reward">
                    <span class="suit-dot" style={{ background: color }} aria-hidden="true" />
                    <span>
                      <b>{t('reward.suit')}</b>
                      <small>{t(`suit.color${SUIT_COLORS.indexOf(color as (typeof SUIT_COLORS)[number])}`)}</small>
                    </span>
                    <Btn
                      kind="soft"
                      small
                      disabled={profile.value.suit === color}
                      onClick={() => {
                        audio.play('confirm');
                        wearSuit(color);
                        notify('reward.worn', undefined, 'good');
                      }}
                    >
                      {profile.value.suit === color ? t('reward.wearing') : t('reward.wear')}
                    </Btn>
                  </div>
                ))}
              </div>
            </>
          )}

          <h3>{t('end.chart')}</h3>
          <Chart m={m} />
          <p class="sub credit">
            <span class="tag tag-real">{t('common.realData')}</span> {t('end.sunCredit', { from: range[0], to: range[1] ?? '' })}
          </p>

          <h3>{t('end.why')}</h3>
          <ul class="insights">
            {insights.map((insight) => {
              const params = { ...insight.params };
              if (typeof params.saved === 'string') params.saved = t(params.saved);
              if (insight.date) params.date = fmtDate(insight.date);
              return (
                <li key={insight.key} class={`insight insight-${insight.tone}`}>
                  <Icon name={insight.tone === 'good' ? 'check' : insight.tone === 'bad' ? 'warn' : 'info'} size={18} />
                  <span>{t(insight.key, params)}</span>
                </li>
              );
            })}
          </ul>

          {newBadges.value.length > 0 && (
            <>
              <h3>{t('end.badges')}</h3>
              <div class="badges">
                {newBadges.value.map((badge) => (
                  <span key={badge} class="badge">
                    <Icon name="badge" size={22} />
                    <span>
                      <b>{t(`badge.${badge}`)}</b>
                      <small>{t(`badge.${badge}Hint`)}</small>
                    </span>
                  </span>
                ))}
              </div>
            </>
          )}

          {newCards.value.length > 0 && (
            <>
              <h3>{t('end.learned')}</h3>
              <div class="learned">
                {newCards.value.map((id) => {
                  const card = cardById(id);
                  if (!card) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      class="learned-card"
                      onClick={() => {
                        codexFocus.value = id;
                        openPanel('codex');
                      }}
                    >
                      <Icon name="book" size={16} /> {card[lang.value].title}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <footer class="sheet-foot end-foot">
          <Btn kind="ghost" icon="home" onClick={goTitle}>
            {t('menu.title')}
          </Btn>
          {won && (
            <Btn
              kind="soft"
              icon="badge"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                audio.play('click');
                void saveCertificate(m, profile.value.name).then((ok) => {
                  setSaving(false);
                  // A browser that blocks downloads says so instead of doing nothing.
                  notify(ok ? 'toast.saved' : 'toast.certFailed', undefined, ok ? 'good' : 'warn', ok ? 3.2 : 5);
                });
              }}
            >
              {t('end.certificate')}
            </Btn>
          )}
          <Btn kind={won ? 'primary' : 'soft'} icon="rocket" autoFocus={won} onClick={openSetup}>
            {t('end.new')}
          </Btn>
          <Btn kind={won ? 'soft' : 'primary'} icon="play" autoFocus={!won} onClick={playAgain}>
            {t(won ? 'end.replay' : 'end.again')}
          </Btn>
        </footer>
      </section>
    </div>
  );
}
