import { suitRule, unlockedSuits } from '../game/rewards';
import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { audio } from '../game/audio';
import { CODEX } from '../game/codex';
import { dataInfo } from '../game/data';
import { continueMission, getWorld, goTitle, openPanel, openSetup, previewSite, startDateFor, startMission } from '../game/director';
import { hasSave, notify, profile, updateProfile } from '../game/store';
import type { SetupChoice } from '../game/store';
import { crewAvailable, openCrewLobby } from '../net/crew';
import { LANGS, fmtDate, fmtDelay, fmtRange, lang, setLang, t } from '../i18n';
import { addDays, marsGeometry } from '../sim/ephemeris';
import { FEATURED_WINDOWS } from '../sim/sites';
import type { Difficulty, SiteId, SunMode } from '../sim/types';
import { SUIT_COLORS } from '../world/astronaut';
import { Btn, IconBtn, Segmented, Toggle } from './common';
import { Icon } from './icons';

export function LangSwitch(): JSX.Element {
  return (
    <div class="lang" role="group" aria-label={t('set.language')}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          class={lang.value === code ? 'is-on' : ''}
          aria-pressed={lang.value === code}
          onClick={() => {
            audio.play('click');
            setLang(code);
          }}
        >
          {code === 'en' ? 'EN' : 'RU'}
        </button>
      ))}
    </div>
  );
}

function Emblem(): JSX.Element {
  return (
    <svg class="emblem" viewBox="0 0 160 160" role="img" aria-label={t('app.emblem')}>
      <circle cx="80" cy="80" r="78" fill="#1D2333" stroke="#C9A55C" stroke-width="1.8" />
      <circle cx="80" cy="80" r="72" fill="#2C3550" stroke="#C9A55C" stroke-width="1" />
      <circle cx="80" cy="80" r="66" fill="none" stroke="#C9A55C" stroke-width="0.8" stroke-dasharray="1 4" stroke-linecap="round" />
      <path d="M80 22L84 36L98 40L84 44L80 58L76 44L62 40L76 36Z" fill="#E4C57E" />
      <g fill="#E4C57E">
        <circle cx="40" cy="52" r="1.6" />
        <circle cx="118" cy="46" r="1.6" />
        <circle cx="124" cy="74" r="1.2" />
        <circle cx="34" cy="78" r="1.2" />
      </g>
      <path d="M19.4 112Q80 94 140.6 112A66 66 0 0 1 19.4 112Z" fill="#F4EEE2" stroke="#C9A55C" stroke-width="1.4" stroke-linejoin="round" />
      <g fill="none" stroke="#B9AE96" stroke-width="1.3">
        <circle cx="46" cy="126" r="6" />
        <circle cx="108" cy="130" r="4.5" />
        <circle cx="80" cy="140" r="3.4" />
      </g>
      <path d="M56 106A24 24 0 0 1 104 106Z" fill="#1D2333" stroke="#C9A55C" stroke-width="1.6" stroke-linejoin="round" />
      <path d="M80 82V106M66 91Q66 98 62 106M94 91Q94 98 98 106" fill="none" stroke="#C9A55C" stroke-width="1" />
      <rect x="74" y="96" width="12" height="10" rx="5" fill="#F2D58A" />
      <path d="M80 82V70" stroke="#C9A55C" stroke-width="1.8" stroke-linecap="round" />
      <path d="M80 64l3.5 4L80 72l-3.5-4z" fill="#E4C57E" />
      <path d="M108 104l16-7v9l-16 5z M114 112l-2 6M120 109l-2 6" fill="#4A7FD6" stroke="#E4C57E" stroke-width="1.2" stroke-linejoin="round" />
    </svg>
  );
}

export function Title(): JSX.Element {
  const words = t('app.title').split(' ');
  const found = profile.value.unlocked.length;
  return (
    <div class="screen title">
      <header class="title-bar">
        <LangSwitch />
        <IconBtn icon="gear" label={t('menu.settings')} onClick={() => openPanel('settings')} />
      </header>

      <div class="title-main">
        <div class="logo">
          <Emblem />
          <span class="logo-tag">{t('app.subtitle')}</span>
          <h1>
            {words.map((word) => (
              <span key={word}>{word}</span>
            ))}
          </h1>
          <span class="logo-rule" aria-hidden="true">
            <i />
          </span>
          <p class="logo-line">{t('app.tagline')}</p>
        </div>

        <nav class="menu" aria-label={t('menu.title')}>
          {hasSave.value && (
            <Btn kind="primary" icon="play" wide autoFocus onClick={() => void continueMission()}>
              {t('menu.continue')}
            </Btn>
          )}
          <Btn kind={hasSave.value ? 'soft' : 'primary'} icon="rocket" wide autoFocus={!hasSave.value} onClick={openSetup}>
            {t('menu.play')}
          </Btn>
          {crewAvailable() && (
            <Btn icon="earth" wide onClick={openCrewLobby}>
              {t('crew.open')}
            </Btn>
          )}
          <Btn icon="book" wide onClick={() => openPanel('codex')}>
            {t('menu.codex')}
            {CODEX.length > 0 && <em class="count">{found}/{CODEX.length}</em>}
          </Btn>
          <div class="menu-row">
            <Btn icon="help" onClick={() => openPanel('help')}>
              {t('menu.help')}
            </Btn>
            <Btn icon="globe" onClick={() => openPanel('about')}>
              {t('menu.about')}
            </Btn>
          </div>
        </nav>
      </div>

      <footer class="title-foot">
        <span>{t('app.dataLine')}</span>
      </footer>
    </div>
  );
}

function WorldCard({ site, picked, onPick, delay }: { site: SiteId; picked: boolean; onPick: () => void; delay: string }): JSX.Element {
  const best = Math.max(0, ...Object.entries(profile.value.best).filter(([key]) => key.startsWith(site)).map(([, stars]) => stars));
  return (
    <button type="button" class={`world world-${site} ${picked ? 'is-on' : ''}`} aria-pressed={picked} onClick={onPick}>
      <span class="world-disc" aria-hidden="true" />
      <span class="world-text">
        <b>{t(`site.${site}.name`)}</b>
        <small>{t(`site.${site}.place`)}</small>
        <em>{t(`site.${site}.tag`)}</em>
      </span>
      <ul>
        <li>
          <Icon name="jump" size={16} /> {t(`site.${site}.f1`)}
        </li>
        <li>
          <Icon name="antenna" size={16} /> {t(`site.${site}.f2`, { delay })}
        </li>
        <li>
          <Icon name={site === 'mars' ? 'dust' : 'dose'} size={16} /> {t(`site.${site}.f3`)}
        </li>
        <li>
          <Icon name="rocket" size={16} /> {t(`site.${site}.f4`)}
        </li>
      </ul>
      {best > 0 && (
        <span class="world-best" aria-label={`${best} / 3`}>
          {[0, 1, 2].map((index) => (
            <Icon key={index} name="star" size={14} class={index < best ? 'lit' : 'dim'} />
          ))}
        </span>
      )}
    </button>
  );
}

export function Setup(): JSX.Element {
  const [choice, setChoice] = useState<SetupChoice>({ ...profile.value.setup, creative: false });
  const [name, setName] = useState(profile.value.name);
  const [suit, setSuit] = useState(profile.value.suit);
  // A colour the player already wears stays open; the others open with finished missions.
  const openSuits = [...unlockedSuits(profile.value.best), ...(profile.value.ownedSuits ?? []), profile.value.suit];
  const [busy, setBusy] = useState(false);
  const info = dataInfo.value;

  const change = (patch: Partial<SetupChoice>): void => {
    const next = { ...choice, ...patch };
    // A famous window may not exist for the other world: fall back to the first that does.
    if (next.sunMode === 'featured' && !FEATURED_WINDOWS.some((w) => w.id === next.windowId && w.sites.includes(next.site))) {
      next.windowId = FEATURED_WINDOWS.find((w) => w.sites.includes(next.site))!.id;
    }
    setChoice(next);
    if (patch.site) previewSite(patch.site);
  };

  const start = useMemo(() => (choice.sunMode === 'random' ? null : startDateFor(choice)), [choice, info.sunTo]);
  const marsDelay = start
    ? fmtDelay(marsGeometry(addDays(start, Math.floor((choice.weeks * 7) / 2))).lightSeconds)
    : t('setup.delayRange');
  const windows = FEATURED_WINDOWS.filter((w) => w.sites.includes(choice.site));
  const liveAge = info.sunFetchedAt ? fmtDate(info.sunFetchedAt) : '';

  const launch = (): void => {
    if (busy) return;
    setBusy(true);
    updateProfile({ name: name.trim().slice(0, 18), suit });
    void startMission(choice);
  };

  return (
    <div class="screen setup">
      <section class="sheet" role="dialog" aria-label={t('setup.title')}>
        <header class="sheet-head">
          <IconBtn icon="back" label={t('common.back')} onClick={goTitle} />
          <h2>{t('setup.title')}</h2>
          <LangSwitch />
        </header>

        <div class="sheet-body setup-grid">
          <div class="setup-col">
            <h3>{t('setup.world')}</h3>
            <div class="worlds">
              <WorldCard site="mars" picked={choice.site === 'mars'} onPick={() => change({ site: 'mars' })} delay={marsDelay} />
              <WorldCard site="moon" picked={choice.site === 'moon'} onPick={() => change({ site: 'moon' })} delay="" />
            </div>

            <h3>{t('setup.cadet')}</h3>
            <div class="cadet">
              <label class="field">
                <span>{t('setup.name')}</span>
                <input
                  type="text"
                  value={name}
                  maxLength={18}
                  autocomplete="off"
                  spellcheck={false}
                  placeholder={t('setup.namePlaceholder')}
                  onInput={(event) => setName((event.target as HTMLInputElement).value)}
                />
              </label>
              <div class="field">
                <span>{t('setup.suit')}</span>
                <div class="swatches" role="radiogroup" aria-label={t('setup.suit')}>
                  {SUIT_COLORS.map((color, index) => {
                    const open = openSuits.includes(color);
                    const hint = open ? '' : t(`suit.lock.${suitRule(color)}`);
                    return (
                      <button
                        key={color}
                        type="button"
                        role="radio"
                        aria-checked={suit === color}
                        aria-disabled={!open}
                        aria-label={open ? t(`suit.color${index}`) : `${t(`suit.color${index}`)}: ${hint}`}
                        title={hint || undefined}
                        class={`${suit === color ? 'is-on' : ''} ${open ? '' : 'is-locked'}`}
                        style={{ background: color }}
                        onClick={() => {
                          if (!open) {
                            audio.play('deny');
                            notify('suit.locked', { hint }, 'info', 3.4);
                            return;
                          }
                          audio.play('click');
                          setSuit(color);
                          updateProfile({ suit: color });
                          previewSuit(color);
                        }}
                      >
                        {!open && <Icon name="lock" size={16} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div class="setup-col">
            <h3>{t('setup.mode')}</h3>
            <Segmented<string>
              label={t('setup.mode')}
              value={choice.creative ? 'creative' : 'mission'}
              onChange={(mode) => change({ creative: mode === 'creative' })}
              options={[
                { value: 'mission', label: t('setup.modeMission'), hint: t('setup.modeMissionHint') },
                { value: 'creative', label: t('setup.modeCreative'), hint: t('setup.modeCreativeHint') },
              ]}
            />
            <h3>{t('setup.sun')}</h3>
            <p class="hint">{t('setup.sunHint')}</p>
            <Segmented<SunMode>
              label={t('setup.sun')}
              value={choice.sunMode}
              onChange={(sunMode) => change({ sunMode })}
              options={[
                { value: 'featured', label: t('sun.featured') },
                { value: 'random', label: t('sun.random') },
                { value: 'live', label: t('sun.live') },
              ]}
            />
            {choice.sunMode === 'featured' && (
              <div class="windows" role="radiogroup" aria-label={t('sun.featured')}>
                {windows.map((window) => (
                  <button
                    key={window.id}
                    type="button"
                    role="radio"
                    aria-checked={choice.windowId === window.id}
                    class={choice.windowId === window.id ? 'is-on' : ''}
                    onClick={() => {
                      audio.play('click');
                      change({ windowId: window.id });
                    }}
                  >
                    <b>{t(`window.${window.id}.name`)}</b>
                    <small>{t(`window.${window.id}.desc`)}</small>
                  </button>
                ))}
              </div>
            )}
            {choice.sunMode === 'random' && <p class="note">{t('sun.randomHint')}</p>}
            {choice.sunMode === 'live' && (
              <p class="note">
                {t('sun.liveHint', { date: fmtDate(info.sunTo) })}{' '}
                <span class={`tag ${info.live ? 'tag-live' : ''}`}>{info.live ? t('sun.liveFresh') : t('sun.liveOld', { date: liveAge })}</span>
              </p>
            )}

            <h3>{t('setup.length')}</h3>
            <Segmented<number>
              label={t('setup.length')}
              value={choice.weeks}
              onChange={(weeks) => change({ weeks })}
              options={[
                { value: 6, label: t('setup.short'), hint: t('setup.shortHint') },
                { value: 10, label: t('setup.full'), hint: t('setup.fullHint') },
              ]}
            />

            <h3>{t('setup.level')}</h3>
            <Segmented<Difficulty>
              label={t('setup.level')}
              value={choice.difficulty}
              onChange={(difficulty) => change({ difficulty })}
              options={[
                { value: 'cadet', label: t('diff.cadet'), hint: t('diff.cadetHint') },
                { value: 'commander', label: t('diff.commander'), hint: t('diff.commanderHint') },
                { value: 'legend', label: t('diff.legend'), hint: t('diff.legendHint') },
              ]}
            />
            <Toggle on={choice.tutorial} onChange={(tutorial) => change({ tutorial })} label={t('setup.tutorial')} />
          </div>
        </div>

        <footer class="sheet-foot">
          <p class="dates">
            {start ? (
              <>
                <Icon name="calendar" size={16} /> {t('setup.dates', { from: fmtRange(start, addDays(start, choice.weeks * 7 - 1)).split(' – ')[0], to: fmtRange(start, addDays(start, choice.weeks * 7 - 1)).split(' – ')[1] ?? '' })}
              </>
            ) : (
              profile.value.missions === 0 && t('setup.firstTime')
            )}
          </p>
          <Btn kind="primary" icon="rocket" onClick={launch} disabled={busy} autoFocus>
            {t('setup.start')}
          </Btn>
        </footer>
      </section>
    </div>
  );
}

function previewSuit(color: string): void {
  getWorld()?.setSuitColor(color);
}
