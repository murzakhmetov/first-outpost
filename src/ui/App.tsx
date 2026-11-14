import '@fontsource-variable/nunito';
import '@fontsource/prata/400.css';
import './styles.css';
import './theme.css';
import './outpost.css';
import './gi.css';
import './hud.css';
import './mobile.css';
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { cancelPrint } from '../game/director';
import { crewLobbyOpen } from '../net/crew';
import { cutscene, fading, notify, panel, printing, screen } from '../game/store';
import { Debrief } from './Debrief';
import { Game } from './Game';
import { OutpostPanel } from './Outpost';
import { RoomScreen } from './Rooms';
import { PlacementBar } from './Placement';
import { useLoaded } from './lazy';
import { Cutscene } from './Cutscene';
import { CrewLobby } from './CrewLobby';
import { ToastView } from './Hud';
import { AboutPanel, CodexPanel, HelpPanel, PausePanel, SettingsPanel } from './Panels';
import { Setup, Title } from './Title';

// The printer's code is downloaded the first time a tool is printed.
const loadPrinter = () => import('./PrintGame').then((module) => module.PrintGame);

/** The last thing that had the keyboard outside a menu: it gets it back when the menu closes. */
let lastOutside: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement | null;
    if (target && !target.closest('.gi-screen, .modal-back')) lastOutside = target;
  });
}

export function App(): JSX.Element {
  const current = screen.value;
  const open = panel.value;
  const Printer = useLoaded(loadPrinter, !!printing.value, () => {
    cancelPrint(); // keeps the materials; the next print tries to load the printer again
    notify('toast.loadFailed', undefined, 'warn', 5);
  });
  // While a menu is open, the screen behind it cannot be reached with the keyboard (Enter would press a button under the menu).
  useEffect(() => {
    if (open === 'none') return undefined;
    const before = lastOutside;
    const behind = Array.from(document.querySelectorAll<HTMLElement>('.screen, .room3d'));
    for (const element of behind) element.setAttribute('inert', '');
    return () => {
      for (const element of behind) element.removeAttribute('inert');
      if (before && before !== document.body && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [open]);
  return (
    <>
      {current === 'title' && !crewLobbyOpen.value && <Title />}
      {current === 'setup' && <Setup />}
      {current === 'title' && crewLobbyOpen.value && <CrewLobby />}
      {current === 'game' && !cutscene.value && <Game />}
      {current === 'game' && cutscene.value && <Cutscene />}
      {current === 'game' && <RoomScreen />}
      {current === 'game' && <PlacementBar />}
      {current === 'debrief' && <Debrief />}
      {open === 'codex' && <CodexPanel />}
      {open === 'settings' && <SettingsPanel />}
      {open === 'about' && <AboutPanel />}
      {open === 'help' && <HelpPanel />}
      {open === 'pause' && <PausePanel />}
      {open === 'outpost' && <OutpostPanel />}
      {current === 'game' && printing.value && Printer && <Printer key={printing.value} tool={printing.value} />}
      <ToastView />
      <div class={`fade ${fading.value ? 'is-on' : ''}`} aria-hidden="true" />
    </>
  );
}
