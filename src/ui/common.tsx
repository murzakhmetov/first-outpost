/**
 * Small building blocks shared by every screen.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { audio, canSpeak, speak, stopSpeaking } from '../game/audio';
import { settings } from '../game/store';
import { has, lang, num, signed, t } from '../i18n';
import type { Effects } from '../sim/types';
import { Icon } from './icons';
import type { IconName } from './icons';

/**
 * Text with **bold** words and [[glossary]] links.
 * Tapping a glossary word shows a short, plain explanation.
 */
export function Rich({ text, class: className }: { text: string; class?: string }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const parts = text.split(/(\*\*[^*]+\*\*|\[\[\w+\]\])/g).filter(Boolean);
  return (
    <span class={className}>
      {parts.map((part, index) => {
        if (part.startsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('[[')) {
          const term = part.slice(2, -2);
          const label = has(`gloss.${term}.name`) ? t(`gloss.${term}.name`) : term;
          return (
            <span key={index} class="term-wrap">
              <button
                type="button"
                class="term"
                aria-expanded={open === term}
                onClick={(event) => {
                  event.stopPropagation();
                  audio.play('click');
                  setOpen(open === term ? null : term);
                }}
              >
                {label}
              </button>
              {open === term && (
                <span class="term-pop" role="tooltip" onClick={() => setOpen(null)}>
                  <b>{label}</b> — {t(`gloss.${term}.def`)}
                </span>
              )}
            </span>
          );
        }
        return part;
      })}
    </span>
  );
}

interface BtnProps {
  children?: ComponentChildren;
  onClick?: () => void;
  kind?: 'primary' | 'ghost' | 'soft' | 'danger';
  icon?: IconName;
  iconRight?: IconName;
  disabled?: boolean;
  wide?: boolean;
  small?: boolean;
  label?: string;
  class?: string;
  autoFocus?: boolean;
}

export function Btn(props: BtnProps): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Keyboard players can press Enter straight away.
    if (props.autoFocus && matchMedia('(pointer: fine)').matches) ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <button
      ref={ref}
      type="button"
      class={`btn btn-${props.kind ?? 'soft'} ${props.wide ? 'btn-wide' : ''} ${props.small ? 'btn-small' : ''} ${props.class ?? ''}`}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
    >
      {props.icon && <Icon name={props.icon} />}
      {props.children && <span>{props.children}</span>}
      {props.iconRight && <Icon name={props.iconRight} />}
    </button>
  );
}

/** Round button with only an icon. */
export function IconBtn({ icon, label, onClick, active }: { icon: IconName; label: string; onClick: () => void; active?: boolean }): JSX.Element {
  return (
    <button type="button" class={`icon-btn ${active ? 'is-active' : ''}`} aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} size={22} />
    </button>
  );
}

/** Reads a text aloud with the device's voice, for children who are still learning to read. */
export function SpeakBtn({ text }: { text: string }): JSX.Element | null {
  const [on, setOn] = useState(false);
  const byHand = useRef(false);
  // Only a text the child asked for stops when its card closes; an automatic reading is left to finish.
  useEffect(() => () => {
    if (byHand.current) stopSpeaking();
  }, []);
  useEffect(() => {
    // With "read aloud" switched on, new texts are spoken by themselves, one after the other.
    if (settings.value.speak && text) speak(text, lang.value, true);
  }, [text]);
  if (!canSpeak(lang.value)) return null;
  return (
    <button
      type="button"
      class={`speak ${on ? 'is-on' : ''}`}
      aria-label={t(on ? 'common.stopReading' : 'common.readAloud')}
      title={t(on ? 'common.stopReading' : 'common.readAloud')}
      onClick={() => {
        byHand.current = !on;
        if (on) stopSpeaking();
        else speak(text, lang.value);
        setOn(!on);
        if (!on) window.setTimeout(() => setOn(false), Math.min(20000, 600 + text.length * 70));
      }}
    >
      <Icon name="speaker" size={18} />
    </button>
  );
}

const FX_ORDER: (keyof Effects)[] = ['cells', 'air', 'food', 'dose', 'science', 'shield', 'crop', 'batteryCap'];
const FX_ICON: Record<keyof Effects, IconName> = {
  cells: 'power',
  air: 'air',
  food: 'food',
  dose: 'dose',
  science: 'science',
  shield: 'shield',
  crop: 'plant',
  batteryCap: 'battery',
};

/** Little tags that show what a choice costs or gives. */
export function FxChips({ fx, notes }: { fx: Effects; notes?: string[] }): JSX.Element {
  return (
    <span class="chips">
      {FX_ORDER.filter((key) => fx[key]).map((key) => {
        const value = fx[key] ?? 0;
        // More radiation is bad; more of anything else is good.
        const good = key === 'dose' ? value < 0 : value > 0;
        const shown = key === 'shield' ? `${signed(value * 100, 0)}%` : signed(value);
        return (
          <span key={key} class={`chip ${good ? 'chip-good' : 'chip-bad'} fx-${key}`} title={t(`fx.${key}`)}>
            <Icon name={FX_ICON[key]} size={15} />
            <b>{shown}</b>
            <span class="chip-word">{t(`fx.${key}`)}</span>
          </span>
        );
      })}
      {(notes ?? []).map((note) => (
        <span key={note} class="chip chip-note">
          {note}
        </span>
      ))}
    </span>
  );
}

export function Stars({ count, big }: { count: number; big?: boolean }): JSX.Element {
  return (
    <span class={`stars ${big ? 'stars-big' : ''}`} role="img" aria-label={`${count} / 3`}>
      {[0, 1, 2].map((index) => (
        <span key={index} class={`star ${index < count ? 'is-on' : ''}`} style={{ animationDelay: `${0.25 + index * 0.28}s` }}>
          <Icon name="star" size={big ? 54 : 20} />
        </span>
      ))}
    </span>
  );
}

/** A window in the middle of the screen with a title and a close button. */
export function Modal(props: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean; icon?: IconName }): JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="modal-back" onClick={(event) => event.target === event.currentTarget && props.onClose()}>
      <section class={`modal ${props.wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title}>
        <header class="modal-head">
          {props.icon && <Icon name={props.icon} size={24} />}
          <h2>{props.title}</h2>
          <IconBtn icon="close" label={t('common.close')} onClick={props.onClose} />
        </header>
        <div class="modal-body">{props.children}</div>
      </section>
    </div>
  );
}

/** A labelled bar from empty to full. `danger` turns it red and makes it pulse. */
export function Bar({ value, max, tone, danger }: { value: number; max: number; tone: string; danger?: boolean }): JSX.Element {
  const fill = Math.max(0, Math.min(1, value / max));
  return (
    <span class={`bar bar-${tone} ${danger ? 'is-danger' : ''}`}>
      <span class="bar-fill" style={{ width: `${fill * 100}%` }} />
    </span>
  );
}

export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (next: boolean) => void; label: string; hint?: string }): JSX.Element {
  return (
    <label class="toggle">
      <span class="toggle-text">
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        checked={on}
        onChange={(event) => {
          audio.play('click');
          onChange((event.target as HTMLInputElement).checked);
        }}
      />
      <span class="toggle-track" aria-hidden="true" />
    </label>
  );
}

/** A row of choices where one is picked. */
export function Segmented<T extends string | number>(props: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (next: T) => void;
  label: string;
}): JSX.Element {
  return (
    <div class="segmented" role="radiogroup" aria-label={props.label}>
      {props.options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === props.value}
          class={option.value === props.value ? 'is-on' : ''}
          onClick={() => {
            audio.play('click');
            props.onChange(option.value);
          }}
        >
          <b>{option.label}</b>
          {option.hint && <small>{option.hint}</small>}
        </button>
      ))}
    </div>
  );
}

export { num, signed };
