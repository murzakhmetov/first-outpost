import { effect } from '@preact/signals';
import { h, render } from 'preact';
import { t } from './i18n';
import * as director from './game/director';
import { App } from './ui/App';
import { hasSave } from './game/store';
import { FEATURED_WINDOWS } from './sim/sites';
import { modelUrls } from './world/models';

// The loading screen (public/boot.js) checks this: if the game's code never runs, it says so.
(window as unknown as { __foStarted?: boolean }).__foStarted = true;

const canvas = document.getElementById('world') as HTMLCanvasElement;
// The label follows the language of the game.
effect(() => canvas.setAttribute('aria-label', t('app.canvas')));
const bootScreen = document.getElementById('boot');

function fail(message: string): void {
  const line = bootScreen?.querySelector('p');
  if (line) line.textContent = message;
  bootScreen?.querySelector('.mark')?.remove();
  bootScreen?.querySelector('.bar')?.remove();
  bootScreen?.querySelector('.tip')?.remove();
}

function hasWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    // three.js r170 draws only with WebGL 2.
    return !!probe.getContext('webgl2');
  } catch {
    return false;
  }
}

/**
 * Ask the service worker to keep the 3D models this device loaded, so the game
 * starts without a connection next time. Asked again whenever the answer may
 * have changed: the worker took over, the game finished loading, the quality changed.
 */
function keepModels(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const urls = modelUrls();
  if (urls.length) navigator.serviceWorker.controller?.postMessage({ type: 'keep', urls });
}

/**
 * A link straight into a mission, for teachers and judges: ?play=may2024&world=mars starts the
 * featured May 2024 storm window on Mars (cadet level, six weeks, with Lumi's tips; the opening
 * film plays the first time). A mission that is still saved is never replaced: then the title
 * screen shows, with "Continue". The address is cleaned, so a reload goes back to the title.
 */
function playFromLink(): void {
  const params = new URLSearchParams(location.search);
  const id = params.get('play');
  if (!id) return;
  const site = params.get('world') === 'moon' ? 'moon' : 'mars';
  history.replaceState(null, '', location.pathname + location.hash);
  const featured = FEATURED_WINDOWS.find((item) => item.id === id && item.sites.includes(site));
  if (!featured || hasSave.value) return; // a saved mission is never replaced: the title offers to continue it
  void director.startMission({ site, difficulty: 'cadet', weeks: 6, sunMode: 'featured', windowId: featured.id, tutorial: true });
}

if (!hasWebGL()) {
  fail('This game needs WebGL 2. Please try a newer browser. / Игре нужен WebGL 2. Попробуй другой браузер.');
} else {
  render(h(App, {}), document.getElementById('ui')!);
  const bar = bootScreen?.querySelector<HTMLElement>('.bar i');
  director
    .boot(canvas, (share) => {
      if (bar) bar.style.width = `${Math.round(4 + share * 96)}%`;
    })
    .then(() => {
      bootScreen?.classList.add('gone');
      keepModels();
      playFromLink();
    })
    .catch((error: unknown) => {
      console.error(error);
      fail('Something went wrong while loading. Please reload the page. / Не удалось загрузить игру. Обнови страницу.');
    });
}

// Once opened, the game can start again without a connection.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', keepModels);
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        keepModels();
        window.setInterval(keepModels, 30_000);
      })
      .catch(() => {
        /* offline start is a bonus, not a requirement */
      });
  });
}

// A handle for testing in the browser console during development. Not part of the build.
if (import.meta.env.DEV) void import('./dev');
