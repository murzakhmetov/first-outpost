/**
 * Texts in two languages, with placeholders and plural forms.
 */
import { signal } from '@preact/signals';
import { crewEn, crewRu } from './crew';
import { en as enBase } from './en';
import { filmsEn, filmsRu } from './films';
import { minigamesEn, minigamesRu } from './minigames';
import { ru as ruBase } from './ru';
import { voiceEn, voiceRu } from './voice';

export type Lang = 'en' | 'ru';
export const LANGS: Lang[] = ['en', 'ru'];

// The room games, the films, the voice and crew mode keep their texts in their own files.
const en: Record<string, string> = { ...enBase, ...minigamesEn, ...filmsEn, ...voiceEn, ...crewEn };
const ru: Record<string, string> = { ...ruBase, ...minigamesRu, ...filmsRu, ...voiceRu, ...crewRu };
const DICTS: Record<Lang, Record<string, string>> = { en, ru };

function detect(): Lang {
  try {
    const saved = localStorage.getItem('fo.lang');
    if (saved === 'en' || saved === 'ru') return saved;
  } catch {
    /* storage may be blocked */
  }
  const prefer = (navigator.languages?.[0] ?? navigator.language ?? 'en').toLowerCase();
  return /^(ru|be|uk|kk|ky|uz|tg|hy|az)/.test(prefer) ? 'ru' : 'en';
}

export const lang = signal<Lang>(detect());

export function setLang(next: Lang): void {
  lang.value = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem('fo.lang', next);
  } catch {
    /* ignore */
  }
}

/** Russian has three plural forms: 1 неделя, 2 недели, 5 недель. */
function pluralIndex(language: Lang, n: number, count: number): number {
  if (language === 'ru' && count >= 3) {
    if (!Number.isInteger(n)) return 1;
    const mod10 = Math.abs(n) % 10;
    const mod100 = Math.abs(n) % 100;
    if (mod10 === 1 && mod100 !== 11) return 0;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1;
    return 2;
  }
  return Math.abs(n) === 1 ? 0 : Math.min(1, count - 1);
}

/** Format a number the way the current language writes it (decimal comma in Russian). */
export function num(value: number, digits = 1): string {
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  return new Intl.NumberFormat(lang.value, { maximumFractionDigits: digits }).format(rounded);
}

/** A number with a plus or minus sign, for changes. */
export function signed(value: number, digits = 1): string {
  const text = num(Math.abs(value), digits);
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

export type Params = Record<string, string | number>;

export function has(key: string): boolean {
  return key in DICTS[lang.value] || key in en;
}

/** Look up a text. Reading `lang.value` makes components re-draw when the language changes. */
export function t(key: string, params?: Params): string {
  const language = lang.value;
  const text = DICTS[language][key] ?? en[key];
  if (text === undefined) return key;
  if (!text.includes('{')) return text;
  return text.replace(/\{(\w+)(?:\|([^}]*))?\}/g, (_match, name: string, forms?: string) => {
    const value = params?.[name];
    if (forms !== undefined) {
      const options = forms.split('|');
      return options[pluralIndex(language, Number(value ?? 0), options.length)] ?? options[options.length - 1];
    }
    if (value === undefined) return '';
    return typeof value === 'number' ? num(value) : value;
  });
}

const DATE_CACHE = new Map<string, Intl.DateTimeFormat>();
function dateFormat(language: Lang, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = language + JSON.stringify(options);
  let format = DATE_CACHE.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-GB', { timeZone: 'UTC', ...options });
    DATE_CACHE.set(key, format);
  }
  return format;
}

/** "10 May 2024" / "10 мая 2024 г." */
export function fmtDate(iso: string, withYear = true): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const text = dateFormat(lang.value, { day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) }).format(date);
  return text.replace(/\s*г\.$/, '');
}

/** "6 – 12 May 2024" */
export function fmtRange(from: string, to: string): string {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  if (sameMonth) return `${Number(from.slice(8, 10))} – ${fmtDate(to)}`;
  return `${fmtDate(from, !sameYear)} – ${fmtDate(to)}`;
}

/** A radio delay in words: "16 min 40 s" or "1.3 s". */
export function fmtDelay(seconds: number): string {
  const ru = lang.value === 'ru';
  if (seconds < 60) return `${num(seconds, 1)} ${ru ? 'с' : 's'}`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `${minutes} ${ru ? 'мин' : 'min'}${rest ? ` ${rest} ${ru ? 'с' : 's'}` : ''}`;
}
