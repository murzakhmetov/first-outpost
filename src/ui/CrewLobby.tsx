/**
 * The crew lobby: make a room or join one with a code, see who is in, and (for the host) start.
 * The rules of crew mode are written here in plain words, always visible.
 */
import './crew.css';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { audio } from '../game/audio';
import { hasSave, loading, notify } from '../game/store';
import { t } from '../i18n';
import {
  canStart,
  closeCrewLobby,
  createRoom,
  crewIsLocal,
  crewView,
  hostStart,
  joinRoom,
  leaveRoom,
  setReady,
} from '../net/crew';
import { CODE_ALPHABET, CODE_LENGTH, CREW_SUITS, CREW_WEEKS, MAX_PLAYERS } from '../net/protocol';
import { coopVisible } from '../net/config';
import type { GameMode } from '../net/protocol';
import type { Player } from '../net/room';
import type { Difficulty, SiteId } from '../sim/types';
import { Btn, IconBtn, Segmented } from './common';
import { Icon } from './icons';
import { LangSwitch } from './Title';

export function Rules(): JSX.Element {
  return (
    <section class="crew-rules" aria-label={t('crew.rules')}>
      <h3>{t('crew.rules')}</h3>
      <ul>
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <li key={n}>
            <Icon name="check" size={16} />
            <span>{t(`crew.p${n}`, n === 3 ? { name: t('crew.name.0') } : undefined)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Member({ player }: { player: Player }): JSX.Element {
  return (
    <li class={`crew-member ${player.me ? 'is-me' : ''}`}>
      <span class="crew-dot" style={{ background: CREW_SUITS[player.suit] }} aria-hidden="true" />
      <b>{t(`crew.name.${player.name}`)}</b>
      {player.me && <em class="crew-tag">{t('crew.me')}</em>}
      {player.host && <em class="crew-tag crew-tag-host">{t('crew.host')}</em>}
      <span class={`crew-ready ${player.ready || player.host ? 'is-on' : ''}`}>
        {player.ready || player.host ? t('crew.ready') : t('crew.waiting')}
      </span>
    </li>
  );
}

export function CrewLobby(): JSX.Element {
  const view = crewView.value;
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [pick, setPick] = useState<{ site: SiteId; difficulty: Difficulty; weeks: number }>({ site: 'mars', difficulty: 'cadet', weeks: CREW_WEEKS[0] });
  const [mode, setMode] = useState<GameMode>('coop');
  const showMode = coopVisible();
  const me = view.players.find((player) => player.me);
  const isHost = !!me?.host;
  const inRoom = view.phase === 'lobby' || view.phase === 'playing';
  const busy = view.phase === 'connecting';
  const ready = !!me?.ready;

  const submit = (event: Event): void => {
    event.preventDefault();
    if (busy) return;
    audio.play('click');
    void joinRoom(code);
  };

  const copy = (): void => {
    audio.play('click');
    try {
      void navigator.clipboard.writeText(view.code).then(
        () => setCopied(true),
        () => undefined,
      );
    } catch {
      /* the browser may not allow it: the code is on the screen anyway */
    }
  };

  const start = (): void => {
    audio.play('click');
    if (!hostStart(pick, showMode ? mode : 'race')) notify('crew.loading', undefined, 'warn');
  };

  const waitText = !isHost
    ? t('crew.waitHost')
    : view.players.length < 2
      ? t('crew.waitFriends')
      : t('crew.waitReady');

  return (
    <div class="screen setup crew-screen">
      <section class="sheet" role="dialog" aria-label={t('crew.title')}>
        <header class="sheet-head">
          <IconBtn icon="back" label={t('common.back')} onClick={closeCrewLobby} />
          <h2>{t('crew.title')}</h2>
          <LangSwitch />
        </header>

        <div class="sheet-body crew-grid">
          <div class="crew-main">
            {crewIsLocal() && <p class="note crew-note">{t('crew.local')}</p>}
            {hasSave.value && <p class="note crew-note">{t('crew.saveWarn')}</p>}

            {(view.phase === 'failed' || view.phase === 'closed') && view.failure && (
              <div class="crew-error" role="alert">
                <Icon name="warn" size={20} />
                <p>{t(`crew.err.${view.failure}`)}</p>
                <Btn kind="soft" onClick={leaveRoom}>
                  {t('common.back')}
                </Btn>
              </div>
            )}

            {view.phase === 'idle' && (
              <>
                <p class="crew-intro">{t('crew.intro')}</p>
                <Btn kind="primary" icon="rocket" wide autoFocus onClick={() => void createRoom()}>
                  {t('crew.make')}
                </Btn>
                <form class="crew-join" onSubmit={submit}>
                  <h3>{t('crew.joinTitle')}</h3>
                  <label class="field">
                    <span>{t('crew.codeLabel')}</span>
                    <input
                      type="text"
                      value={code}
                      maxLength={CODE_LENGTH + 1}
                      autocomplete="off"
                      autocapitalize="characters"
                      spellcheck={false}
                      inputMode="text"
                      placeholder={t('crew.codePlaceholder')}
                      onInput={(event) => {
                        // Only the letters and digits a code can have: this is a code, not a text.
                        const clean = (event.target as HTMLInputElement).value
                          .toUpperCase()
                          .split('')
                          .filter((letter) => CODE_ALPHABET.includes(letter))
                          .join('')
                          .slice(0, CODE_LENGTH);
                        setCode(clean);
                      }}
                    />
                  </label>
                  <Btn kind="soft" icon="play" wide disabled={code.length !== CODE_LENGTH} onClick={() => void joinRoom(code)}>
                    {t('crew.joinGo')}
                  </Btn>
                </form>
              </>
            )}

            {busy && <p class="crew-status" role="status">{t('crew.connecting')}</p>}

            {inRoom && (
              <>
                {me && (
                  <p class="crew-you">
                    <span class="crew-dot" style={{ background: CREW_SUITS[me.suit] }} aria-hidden="true" />
                    {t('crew.you', { name: t(`crew.name.${me.name}`) })}
                  </p>
                )}
                <div class="crew-code-box">
                  <small>{t('crew.code')}</small>
                  <strong class="crew-code" aria-label={view.code.split('').join(' ')}>{view.code}</strong>
                  <Btn kind="ghost" small onClick={copy}>
                    {copied ? t('crew.copied') : t('crew.copy')}
                  </Btn>
                </div>
                <p class="note">{t('crew.codeTip')}</p>

                <h3>{t('crew.crew', { n: view.players.length })}</h3>
                <ul class="crew-members">
                  {view.players.map((player) => (
                    <Member key={player.id} player={player} />
                  ))}
                  {Array.from({ length: Math.max(0, MAX_PLAYERS - view.players.length) }, (_, index) => (
                    <li key={`free-${index}`} class="crew-member is-empty" aria-hidden="true" />
                  ))}
                </ul>

                {!view.online && <p class="crew-status crew-lost" role="status">{t('crew.lost')}</p>}

                {isHost && view.phase === 'lobby' && (
                  <div class="crew-pick">
                    <p class="note">{t('crew.hostPick')}</p>
                    {showMode && (
                      <>
                        <Segmented<GameMode>
                          label={t('crew.mode')}
                          value={mode}
                          onChange={setMode}
                          options={[
                            { value: 'coop', label: t('crew.modeCoop') },
                            { value: 'race', label: t('crew.modeRace') },
                          ]}
                        />
                        <p class="note">{mode === 'coop' ? t('crew.modeCoopHint') : t('crew.modeRaceHint')}</p>
                      </>
                    )}
                    <Segmented<SiteId>
                      label={t('setup.world')}
                      value={pick.site}
                      onChange={(site) => setPick({ ...pick, site })}
                      options={[
                        { value: 'mars', label: t('site.mars.name') },
                        { value: 'moon', label: t('site.moon.name') },
                      ]}
                    />
                    <Segmented<Difficulty>
                      label={t('setup.level')}
                      value={pick.difficulty}
                      onChange={(difficulty) => setPick({ ...pick, difficulty })}
                      options={[
                        { value: 'cadet', label: t('diff.cadet') },
                        { value: 'commander', label: t('diff.commander') },
                        { value: 'legend', label: t('diff.legend') },
                      ]}
                    />
                    <Segmented<number>
                      label={t('setup.length')}
                      value={pick.weeks}
                      onChange={(weeks) => setPick({ ...pick, weeks })}
                      options={[
                        { value: 6, label: t('setup.short') },
                        { value: 10, label: t('setup.full') },
                      ]}
                    />
                  </div>
                )}

                {view.phase === 'lobby' && !canStart() && <p class="crew-status" role="status">{waitText}</p>}
                {view.phase === 'playing' && <p class="crew-status" role="status">{t('crew.starting')}</p>}

                <div class="crew-actions">
                  {view.phase === 'lobby' && !isHost && (
                    <Btn kind={ready ? 'soft' : 'primary'} icon="check" onClick={() => setReady(!ready)}>
                      {ready ? t('crew.imNotReady') : t('crew.imReady')}
                    </Btn>
                  )}
                  {view.phase === 'lobby' && isHost && (
                    <Btn kind="primary" icon="rocket" disabled={!canStart() || loading.value} onClick={start}>
                      {t('crew.start')}
                    </Btn>
                  )}
                  <Btn kind="ghost" onClick={leaveRoom}>
                    {t('crew.leave')}
                  </Btn>
                </div>
              </>
            )}
          </div>

          <Rules />
        </div>
      </section>
    </div>
  );
}
