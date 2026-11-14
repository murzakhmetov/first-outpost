/**
 * The science log: fact cards the player collects by playing.
 * The card texts live in src/data/codex.ts.
 */
import credits from '../data/codex-images.json';
import type { SiteId } from '../sim/types';
import { profile, updateProfile } from './store';
import { CODEX as CARDS } from '../data/codex';

export type CodexTopic = 'radiation' | 'sun' | 'power' | 'air' | 'food' | 'radio' | 'worlds' | 'people' | 'data';

export interface CodexText {
  title: string;
  body: string;
  numbers: [string, string][];
}

export interface CodexCard {
  id: string;
  topic: CodexTopic;
  image?: string;
  en: CodexText;
  ru: CodexText;
  sources: { title: string; url: string }[];
}

export const CODEX: CodexCard[] = CARDS;

export const TOPICS: CodexTopic[] = ['worlds', 'power', 'air', 'food', 'radiation', 'sun', 'radio', 'people', 'data'];

/** Cards every player starts with. */
export const STARTER_CARDS = ['gravity', 'sol', 'comm_delay', 'daily_needs', 'donki'];

/** Cards found by landing on a world. */
export const SITE_CARDS: Record<SiteId, string[]> = {
  mars: ['mars_sunset', 'sound_on_mars', 'curiosity_rad', 'rems'],
  moon: ['moon_radiation', 'earth_from_moon', 'three_days', 'polar_light'],
};

/** Cards found by flying through a famous stretch of real space weather. */
export const WINDOW_CARDS: Record<string, string[]> = {
  may2024: ['may_2024'],
  oct2024: ['solar_cycle'],
  sep2017: ['aurora_mars'],
  oct2021: ['moon_radiation'],
  dust2018: ['dust_storm'],
  quiet2019: ['cosmic_rays'],
};

export function cardById(id: string): CodexCard | undefined {
  return CODEX.find((card) => card.id === id);
}

/** Add cards to the player's log. Returns the ones that were new. */
export function unlockCards(ids: string[]): string[] {
  const known = new Set(profile.value.unlocked);
  const fresh = ids.filter((id) => !known.has(id) && cardById(id));
  if (fresh.length) updateProfile({ unlocked: [...profile.value.unlocked, ...fresh] });
  return fresh;
}

export function markRead(id: string): void {
  if (!profile.value.read.includes(id)) updateProfile({ read: [...profile.value.read, id] });
}

export function isUnlocked(id: string): boolean {
  return profile.value.unlocked.includes(id);
}

export function imageUrl(image: string): string {
  return `./img/codex/${image}.jpg`;
}

export interface ImageCredit {
  title: string;
  credit: string;
  page: string;
  date: string;
}

/** Credit line and NASA page of a photo, from the NASA Image and Video Library. */
export function imageCredit(image: string): ImageCredit | null {
  return (credits as Record<string, ImageCredit>)[image] ?? null;
}
