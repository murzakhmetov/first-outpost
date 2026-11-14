/**
 * Windows that open over the game: science log, settings, NASA data, help, pause.
 */
import type { JSX } from 'preact';
import { rankOf } from '../game/rewards';
import { useEffect, useState } from 'preact/hooks';
import { canSpeak } from '../game/audio';
import { CODEX, TOPICS, cardById, imageCredit, imageUrl, isUnlocked, markRead } from '../game/codex';
import { FINDS } from '../sim/finds';
import type { CodexTopic } from '../game/codex';
import { dataInfo } from '../game/data';
import { closePanel, leaveToMenu, openPanel, playIntro, quitMission } from '../game/director';
import { autoTier, codexFocus, notify, profile, resetProgress, screen, settings, updateSettings } from '../game/store';
import { fmtDate, lang, t } from '../i18n';
import type { QualityChoice } from '../world/quality';
import { Btn, Modal, Rich, Segmented, SpeakBtn, Toggle } from './common';
import { Icon } from './icons';
import './codex.css';
import { TopicScene } from './TopicScene';
import type { IconName } from './icons';
import { LangSwitch } from './Title';

const TOPIC_ICON: Record<CodexTopic, IconName> = {
  radiation: 'dose',
  sun: 'sun',
  power: 'power',
  air: 'air',
  food: 'food',
  radio: 'antenna',
  worlds: 'globe',
  people: 'walk',
  data: 'science',
};

function External({ href, children }: { href: string; children: string }): JSX.Element {
  return (
    <a class="link" href={href} target="_blank" rel="noopener noreferrer">
      {children} <Icon name="link" size={13} />
    </a>
  );
}

// ---------------------------------------------------------------------------
// Science log
// ---------------------------------------------------------------------------

/** What a locked card says about how to find it. Discoveries say where to walk. */
function lockedHint(id: string): string {
  if (FINDS.mars.some((find) => find.id === id)) return 'codexui.findHint.mars';
  if (FINDS.moon.some((find) => find.id === id)) return 'codexui.findHint.moon';
  return 'codexui.lockedHint';
}

export function CodexPanel(): JSX.Element {
  const [topic, setTopic] = useState<CodexTopic | 'all'>('all');
  const [open, setOpen] = useState<string | null>(codexFocus.value);
  const language = lang.value;
  useEffect(() => {
    codexFocus.value = null;
  }, []);
  useEffect(() => {
    if (open) markRead(open);
  }, [open]);

  const unlocked = CODEX.filter((card) => isUnlocked(card.id)).length;
  const card = open ? cardById(open) : undefined;

  if (card) {
    const text = card[language];
    return (
      <Modal title={text.title} icon={TOPIC_ICON[card.topic]} onClose={closePanel} wide>
        <article class="card-detail">
          <button type="button" class="back-link" onClick={() => setOpen(null)}>
            <Icon name="back" size={16} /> {t('codexui.title')}
          </button>
          {card.image && (
            <figure class="photo">
              <img src={imageUrl(card.image)} alt="" loading="lazy" onError={(event) => ((event.target as HTMLElement).parentElement!.style.display = 'none')} />
              <figcaption>
                <span class="tag tag-real">{t('codexui.photo')}</span>{' '}
                {imageCredit(card.image) ? (
                  <External href={imageCredit(card.image)!.page}>{imageCredit(card.image)!.credit}</External>
                ) : (
                  'NASA'
                )}
              </figcaption>
            </figure>
          )}
          <p class="detail-body">
            {text.body} <SpeakBtn text={`${text.title}. ${text.body}`} />
          </p>
          {text.numbers.length > 0 && (
            <>
              <h3>{t('codexui.numbers')}</h3>
              <dl class="numbers">
                {text.numbers.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <h3>{t('codexui.sources')}</h3>
          <ul class="sources">
            {card.sources.map((source) => (
              <li key={source.url}>
                <External href={source.url}>{source.title}</External>
              </li>
            ))}
          </ul>
        </article>
      </Modal>
    );
  }

  // New cards first, then the ones already read, then the locked ones (in their usual order).
  const rank = (id: string): number => (isUnlocked(id) ? (profile.value.read.includes(id) ? 1 : 0) : 2);
  const shown = CODEX.filter((item) => topic === 'all' || item.topic === topic).sort((a, b) => rank(a.id) - rank(b.id));
  // Discoveries are cards found on walks outside: their own small collection.
  const findIds = [...FINDS.mars, ...FINDS.moon].map((find) => find.id);
  const discoveries = { found: findIds.filter((id) => isUnlocked(id)).length, total: findIds.length };
  return (
    <Modal title={t('codexui.title')} icon="book" onClose={closePanel} wide>
      <p class="intro">
        {t('codexui.intro')} <b>{t('codexui.count', { n: unlocked, total: CODEX.length })}</b>
        <span class="codex-finds">
          <Icon name="star" size={14} /> {t('codexui.finds', { n: discoveries.found, total: discoveries.total })}
        </span>
      </p>
      <div class="topics" role="tablist">
        <button type="button" role="tab" aria-selected={topic === 'all'} class={topic === 'all' ? 'is-on' : ''} onClick={() => setTopic('all')}>
          {t('codexui.all')}
        </button>
        {TOPICS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={topic === id} class={topic === id ? 'is-on' : ''} onClick={() => setTopic(id)}>
            <Icon name={TOPIC_ICON[id]} size={15} /> {t(`topic.${id}`)}
          </button>
        ))}
      </div>
      <div class="codex-grid">
        {shown.map((item) => {
          const found = isUnlocked(item.id);
          const fresh = found && !profile.value.read.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              class={`codex-card topic-${item.topic} ${found ? 'is-found' : 'is-locked'} ${found && item.image ? 'has-photo' : ''}`}
              disabled={!found}
              onClick={() => setOpen(item.id)}
            >
              {/* A NASA photo when the card has one, else the topic's emblem; a lock while it is still hidden. */}
              <span class="codex-cover" aria-hidden="true">
                {found && item.image ? (
                  <img src={imageUrl(item.image)} alt="" loading="lazy" decoding="async" />
                ) : (
                  <TopicScene topic={item.topic} id={item.id} />
                )}
                <span class="codex-emblem">
                  <Icon name={found ? TOPIC_ICON[item.topic] : 'lock'} size={found ? 16 : 24} />
                </span>
              </span>
              <span class="codex-text">
                <b>{found ? item[language].title : t('codexui.locked')}</b>
                <small>{found ? t(`topic.${item.topic}`) : t(lockedHint(item.id))}</small>
              </span>
              {fresh && <em class="new">{t('codexui.new')}</em>}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function SettingsPanel(): JSX.Element {
  const s = settings.value;
  const [asking, setAsking] = useState(false);
  return (
    <Modal title={t('set.title')} icon="gear" onClose={closePanel}>
      <div class="settings">
        <h3>{t('set.language')}</h3>
        <LangSwitch />

        <h3>{t('set.graphics')}</h3>
        <Segmented<QualityChoice>
          label={t('set.quality')}
          value={s.quality}
          onChange={(quality) => updateSettings({ quality })}
          options={[
            { value: 'auto', label: t('set.auto') },
            { value: 'low', label: t('set.low') },
            { value: 'medium', label: t('set.medium') },
            { value: 'high', label: t('set.high') },
            { value: 'ultra', label: t('set.ultra') },
          ]}
        />
        <p class="hint">{s.quality === 'auto' ? `${t('set.qualityHint')} ${t('set.autoNow', { tier: t(`set.${autoTier.value}`) })}` : t('set.qualityHint')}</p>
        <h4>{t('set.fps')}</h4>
        <Segmented<number>
          label={t('set.fps')}
          value={s.fpsLimit}
          onChange={(fpsLimit) => updateSettings({ fpsLimit })}
          options={[
            { value: 30, label: t('set.fps30') },
            { value: 60, label: t('set.fps60') },
            { value: 0, label: t('set.fpsMax') },
          ]}
        />
        <Toggle on={s.showFps} onChange={(showFps) => updateSettings({ showFps })} label={t('set.showFps')} />

        <h3>{t('set.sound')}</h3>
        <label class="slider" style={{ '--fill': `${Math.round(s.volume * 100)}%` } as never}>
          <span>{t('set.volume')}</span>
          <input type="range" min="0" max="1" step="0.05" value={s.volume} onInput={(event) => updateSettings({ volume: Number((event.target as HTMLInputElement).value) })} />
        </label>
        <label class="slider" style={{ '--fill': `${Math.round(s.music * 100)}%` } as never}>
          <span>{t('set.music')}</span>
          <input type="range" min="0" max="1" step="0.05" value={s.music} onInput={(event) => updateSettings({ music: Number((event.target as HTMLInputElement).value) })} />
        </label>

        <h3>{t('set.reading')}</h3>
        <h4>{t('set.textSize')}</h4>
        <Segmented<number>
          label={t('set.textSize')}
          value={s.textScale}
          onChange={(textScale) => updateSettings({ textScale })}
          options={[
            { value: 1, label: 'A' },
            { value: 1.15, label: 'A+' },
            { value: 1.3, label: 'A++' },
          ]}
        />
        {canSpeak(lang.value) && <Toggle on={s.speak} onChange={(speak) => updateSettings({ speak })} label={t('set.speak')} hint={t('set.speakHint')} />}
        <Toggle on={s.voice} onChange={(voice) => updateSettings({ voice })} label={t('set.voice')} hint={t('set.voiceHint')} />
        <Toggle on={s.lessMotion} onChange={(lessMotion) => updateSettings({ lessMotion })} label={t('set.motion')} hint={t('set.motionHint')} />
        <Toggle on={s.patterns} onChange={(patterns) => updateSettings({ patterns })} label={t('set.contrast')} hint={t('set.contrastHint')} />

        <h3>{t('set.controls')}</h3>
        <Toggle on={s.firstPerson} onChange={(firstPerson) => updateSettings({ firstPerson })} label={t('set.firstPerson')} hint={t('set.firstPersonHint')} />
        <Toggle on={s.leftHand} onChange={(leftHand) => updateSettings({ leftHand })} label={t('set.leftHand')} />

        <p class="privacy">
          <Icon name="lock" size={16} /> {t('set.privacy')}
        </p>
        {asking ? (
          <div class="confirm">
            <p>{t('set.resetAsk')}</p>
            <Btn kind="danger" onClick={() => { resetProgress(); setAsking(false); notify('set.resetDone', undefined, 'info'); }}>
              {t('common.yes')}
            </Btn>
            <Btn onClick={() => setAsking(false)}>{t('common.no')}</Btn>
          </div>
        ) : (
          <Btn kind="ghost" small onClick={() => setAsking(true)}>
            {t('set.reset')}
          </Btn>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// NASA data
// ---------------------------------------------------------------------------

export function AboutPanel(): JSX.Element {
  const info = dataInfo.value;
  const fetched = info.sunFetchedAt ? fmtDate(info.sunFetchedAt) : '';
  const block = (id: string, icon: IconName, url: string, extra?: string): JSX.Element => (
    <section class="data-block">
      <h3>
        <Icon name={icon} size={20} /> {t(`about.${id}.name`)}
      </h3>
      <p>{t(`about.${id}.what`)}</p>
      <p>
        <b>{t(`about.${id}.how`)}</b>
      </p>
      {extra && <p class="sub">{extra}</p>}
      <External href={url}>{t('about.open')}</External>
    </section>
  );
  return (
    <Modal title={t('about.title')} icon="globe" onClose={closePanel} wide>
      <div class="about">
        <p class="intro">{t('about.intro')}</p>
        {block(
          'donki',
          'storm',
          'https://ccmc.gsfc.nasa.gov/tools/DONKI/',
          t('about.donki.count', {
            flares: info.counts.flares,
            seps: info.counts.sepEvents,
            storms: info.counts.geomagneticStorms,
            sims: info.counts.enlilSimulations,
            from: fmtDate(info.archiveFrom),
            to: fmtDate(info.sunTo),
          }),
        )}
        {block('rems', 'temp', 'https://science.nasa.gov/mission/msl-curiosity/', t('about.rems.count', { n: info.marsSols, from: fmtDate(info.marsFrom), to: fmtDate(info.marsTo) }))}
        {block('rad', 'dose', 'https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm')}
        {block('orbit', 'globe', 'https://ssd.jpl.nasa.gov/planets/approx_pos.html')}
        {block('osdr', 'plant', 'https://www.nasa.gov/wp-content/uploads/2023/03/veggie-fact-sheet-508.pdf')}
        <section class="data-block">
          <h3>
            <Icon name="sun" size={20} /> {t('about.live.name')}
          </h3>
          <p>{t('about.live.how', { date: fetched })}</p>
          <span class={`tag ${info.live ? 'tag-live' : ''}`}>{info.live ? t('sun.liveFresh') : t('sun.liveOld', { date: fetched })}</span>
        </section>

        <h3>{t('about.simple.title')}</h3>
        <ul class="simple">
          {[1, 2, 3, 4, 5].map((index) => (
            <li key={index}>{t(`about.simple.${index}`)}</li>
          ))}
        </ul>
        <h3>{t('about.credits')}</h3>
        <p>{t('about.creditsText')}</p>
        <p>{t('about.voiceCredit')}</p>
        <h3>{t('about.ai')}</h3>
        <p>{t('about.aiText')}</p>
        <p class="sub">{t('about.nasa')}</p>
      </div>
    </Modal>
  );
}

export function HelpPanel(): JSX.Element {
  return (
    <Modal title={t('help.title')} icon="help" onClose={closePanel}>
      <ol class="help">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((index) => (
          <li key={index}>
            <Rich text={t(`help.${index}`)} />
          </li>
        ))}
      </ol>
      <h3>{t('help.controls')}</h3>
      <ul class="simple">
        <li>{t('help.c1')}</li>
        <li>{t('help.c2')}</li>
        <li>{t('help.c3')}</li>
        <li>{t('help.c4')}</li>
      </ul>
    </Modal>
  );
}

/** Puts the keyboard on the first menu item (a plain autoFocus attribute is ignored on a button added later). */
function focusOnMount(element: HTMLButtonElement | null): void {
  if (element && matchMedia('(pointer: fine)').matches) element.focus({ preventScroll: true });
}

export function PausePanel(): JSX.Element {
  const [asking, setAsking] = useState(false);
  const inGame = screen.value === 'game';
  const p = profile.value;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const items: { id: string; icon: IconName; label: string; action: () => void }[] = [
    { id: 'resume', icon: 'play', label: t('menu.resume'), action: closePanel },
    { id: 'codex', icon: 'book', label: t('menu.codex'), action: () => openPanel('codex') },
    ...(inGame ? [{ id: 'outpost', icon: 'build' as IconName, label: t('hud.outpost'), action: () => openPanel('outpost') }] : []),
    ...(inGame ? [{ id: 'story', icon: 'rocket' as IconName, label: t('story.replay'), action: () => void playIntro() }] : []),
    { id: 'help', icon: 'help', label: t('menu.help'), action: () => openPanel('help') },
    { id: 'settings', icon: 'gear', label: t('menu.settings'), action: () => openPanel('settings') },
    { id: 'about', icon: 'globe', label: t('menu.about'), action: () => openPanel('about') },
    ...(inGame ? [{ id: 'title', icon: 'home' as IconName, label: t('menu.title'), action: leaveToMenu }] : []),
  ];
  return (
    <div class="gi-screen pause-screen" role="dialog" aria-modal="true" aria-label={t('menu.paused')}>
      <header class="gi-top">
        <span class="gi-title">
          <Icon name="menu" size={24} /> {t('menu.paused')}
        </span>
        <button type="button" class="gi-close" aria-label={t('common.close')} onClick={closePanel}>
          <Icon name="close" size={22} />
        </button>
      </header>
      <main class="pause-body">
        <section class="pause-card">
          <span class="pause-avatar" style={`--suit: ${p.suit}`}>
            <Icon name="walk" size={52} />
          </span>
          <b>{p.name.trim() || t('pause.cadet')}</b>
          <small>{t(`rank.${rankOf(p.best)}`)}</small>
          <ul class="pause-stats">
            <li>
              <Icon name="rocket" size={16} /> {t('pause.missions', { n: p.missions })}
            </li>
            <li>
              <Icon name="book" size={16} /> {t('pause.cards', { n: p.unlocked.length })}
            </li>
            <li>
              <Icon name="badge" size={16} /> {t('pause.badges', { n: p.badges.length })}
            </li>
          </ul>
        </section>
        <nav class="pause-grid">
          {items.map((item, index) => (
            <button key={item.id} type="button" class={`pause-item ${index === 0 ? 'is-main' : ''}`} ref={index === 0 ? focusOnMount : undefined} onClick={item.action}>
              <span class="pause-ring">
                <Icon name={item.icon} size={30} />
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </main>
      {inGame && (
        <footer class="pause-foot">
          {asking ? (
            <div class="confirm">
              <p>{t('menu.quitMission')}?</p>
              <Btn kind="danger" onClick={quitMission}>
                {t('common.yes')}
              </Btn>
              <Btn onClick={() => setAsking(false)}>{t('common.no')}</Btn>
            </div>
          ) : (
            <Btn kind="ghost" small onClick={() => setAsking(true)}>
              {t('menu.quitMission')}
            </Btn>
          )}
        </footer>
      )}
    </div>
  );
}
