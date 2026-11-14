/**
 * Mini-games inside the buildings of the outpost. The host screen shows the
 * room around the game and gives the reward when the game calls `onFinish`.
 *
 *   pipes   - life support repair, inside the habitat
 *   plants  - plant care, inside the greenhouse
 *   spectro - rock analysis with the laser spectrometer, inside the lab
 *   landing - landing simulator, in the lander cockpit
 *   signal  - sending the science data to Earth, at the radio desk
 *
 * Every game is one panel: a briefing card with the star goals, the game
 * (with a 3-2-1 countdown when it is against the clock), and a result card with
 * 0-3 stars and one true science sentence. Continue (or Leave) calls `onFinish`
 * exactly once.
 *
 * The rules of each game live in plain .ts files (pipes, plants, spectro,
 * lander, rhythm) so the tests can check them without a screen.
 * Texts live in src/i18n/minigames.ts (keys "mg.*"); the host merges them into the dictionaries.
 */
import './minigames.css';
import './landing.css';
import './signal.css';
import type { ComponentType } from 'preact';
import { LandingSim } from './LandingSim';
import { PipePuzzle } from './PipePuzzle';
import { PlantCare } from './PlantCare';
import { SignalRelay } from './SignalRelay';
import { Spectrometer } from './Spectrometer';

export type MinigameId = 'pipes' | 'plants' | 'spectro' | 'landing' | 'signal';

export interface MinigameProps {
  site: 'mars' | 'moon';
  /**
   * How hard: 1 = easy (weeks 1-2), 2 = middle, 3 = harder. Missing means 1.
   * Bigger pipe boards, faster plants, more element cards, a smaller landing
   * pad with less fuel, a faster beat.
   */
  level?: 1 | 2 | 3;
  /**
   * Only for `signal`: this week's one-way radio delay to Earth, in seconds
   * (MissionState env.delaySeconds). Without it the result names the usual
   * range: about 1.3 s for the Moon, 3 to 22 minutes for Mars.
   */
  delaySeconds?: number;
  /** Called once, when the player presses the final Continue button (or Leave). */
  onFinish: (won: boolean) => void;
}

export const MINIGAMES: Record<MinigameId, ComponentType<MinigameProps>> = {
  pipes: PipePuzzle,
  plants: PlantCare,
  spectro: Spectrometer,
  landing: LandingSim,
  signal: SignalRelay,
};

export { LandingSim, PipePuzzle, PlantCare, SignalRelay, Spectrometer };
