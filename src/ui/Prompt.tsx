/**
 * What the use button does here, shown the way adventure games show it: a pill to the
 * right of the screen's middle, with the key to press, an icon and a few words. On
 * touch screens the pill itself is a button.
 */
import type { JSX } from 'preact';
import { getWorld } from '../game/director';
import { Icon } from './icons';
import type { IconName } from './icons';

export type PromptTone = 'gold' | 'cyan' | 'green' | 'amber' | 'done';

function isTouch(): boolean {
  return matchMedia('(pointer: coarse)').matches || document.body.classList.contains('touch');
}

export function InteractPrompt({ icon, text, tone = 'gold', keyLabel = 'E' }: { icon: IconName; text: string; tone?: PromptTone; keyLabel?: string }): JSX.Element {
  const touch = isTouch();
  return (
    <div class="gi-prompts" role="status">
      <button type="button" class={`gi-prompt tone-${tone}`} tabIndex={-1} onClick={() => getWorld()?.input.pressInteract()}>
        {!touch && <kbd class="gi-key">{keyLabel}</kbd>}
        <span class="gi-prompt-icon">
          <Icon name={icon} size={18} />
        </span>
        <span class="gi-prompt-text">{text}</span>
      </button>
    </div>
  );
}
