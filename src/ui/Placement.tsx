/**
 * Creative mode: the bar shown while something is being put on the ground, with its
 * name, whether the spot is free, and buttons to turn it, put it down, or stop.
 */
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { confirmPlacement, rotatePlacement, stopPlacement } from '../game/director';
import { placing } from '../game/store';
import { t } from '../i18n';
import { Btn } from './common';
import { Icon } from './icons';

export function PlacementBar(): JSX.Element | null {
  const current = placing.value;
  useEffect(() => {
    if (!current) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') stopPlacement();
      else if (event.key === 'r' || event.key === 'R' || event.key === 'к' || event.key === 'К') rotatePlacement();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [!!current]);
  if (!current) return null;
  const touch = matchMedia('(pointer: coarse)').matches || document.body.classList.contains('touch');
  const name = current.kind === 'building' ? t(`bld.${current.id}.name`) : t(`decor.${current.id}`);
  return (
    <div class={`placement ${current.valid ? 'is-valid' : 'is-blocked'}`} role="status">
      <span class="placement-icon">
        <Icon name="build" size={22} />
      </span>
      <span class="placement-text">
        <b>{t('creative.placing', { name })}</b>
        <small>{current.valid ? t(touch ? 'creative.hintTouch' : 'creative.hint') : t('creative.blocked')}</small>
      </span>
      <Btn icon="gear" onClick={rotatePlacement}>
        {t('creative.rotate')}
      </Btn>
      {touch && (
        <Btn kind="primary" icon="check" disabled={!current.valid} onClick={confirmPlacement}>
          {t('creative.place')}
        </Btn>
      )}
      <Btn kind="ghost" icon="close" onClick={stopPlacement}>
        {t('creative.done')}
      </Btn>
    </div>
  );
}
