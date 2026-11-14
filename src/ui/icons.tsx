/**
 * Icons drawn as small inline pictures. One shape language: round line ends,
 * 24x24 grid, the colour of the surrounding text.
 */
import type { JSX } from 'preact';

export type IconName =
  | 'regolith'
  | 'metal'
  | 'build'
  | 'wrench'
  | 'telescope'
  | 'bunker'
  | 'tank'
  | 'drill'
  | 'radar'
  | 'boot'
  | 'vest'
  | 'door'
  | 'expand'
  | 'shrink'
  | 'power'
  | 'air'
  | 'food'
  | 'dose'
  | 'science'
  | 'shield'
  | 'battery'
  | 'sun'
  | 'temp'
  | 'antenna'
  | 'storm'
  | 'plant'
  | 'rocket'
  | 'rover'
  | 'ice'
  | 'dust'
  | 'wind'
  | 'cold'
  | 'quake'
  | 'leak'
  | 'water'
  | 'sleep'
  | 'meteor'
  | 'eclipse'
  | 'menu'
  | 'book'
  | 'gear'
  | 'close'
  | 'info'
  | 'speaker'
  | 'play'
  | 'next'
  | 'back'
  | 'plus'
  | 'minus'
  | 'star'
  | 'lock'
  | 'check'
  | 'home'
  | 'jump'
  | 'globe'
  | 'life'
  | 'lab'
  | 'earth'
  | 'link'
  | 'help'
  | 'walk'
  | 'eye'
  | 'badge'
  | 'warn'
  | 'sample'
  | 'calendar'
  | 'arrow';

const PATHS: Record<IconName, JSX.Element> = {
  power: <path d="M13 2 5 13h6l-1 9 8-12h-6l1-8Z" fill="currentColor" stroke="none" />,
  air: (
    <>
      <path d="M3 9h10a3 3 0 1 0-3-3" />
      <path d="M3 14h14a3 3 0 1 1-3 3" />
      <path d="M3 19h6" />
    </>
  ),
  food: (
    <>
      <path d="M12 21c-4 0-7-3-7-7 0-5 4-9 9-10 1 6-1 12-2 17Z" />
      <path d="M12 21c0-5 1-8 3-11" />
    </>
  ),
  dose: (
    <>
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <path d="M12 7.5V3a9 9 0 0 1 7.8 4.5l-3.9 2.25A4.5 4.5 0 0 0 12 7.5Z" fill="currentColor" stroke="none" />
      <path d="M8.1 14.25 4.2 16.5a9 9 0 0 1 0-9l3.9 2.25a4.5 4.5 0 0 0 0 4.5Z" fill="currentColor" stroke="none" />
      <path d="M15.9 14.25a4.5 4.5 0 0 1-3.9 2.25V21a9 9 0 0 0 7.8-4.5l-3.9-2.25Z" fill="currentColor" stroke="none" />
    </>
  ),
  science: (
    <>
      <path d="M9 3h6" />
      <path d="M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6l-8-3Z" />
      <path d="M8 11h8M8 15h8M12 7v4M10 11v4M14 15v3" />
    </>
  ),
  battery: (
    <>
      <rect x="3" y="7" width="16" height="10" rx="2.5" />
      <path d="M21.5 10.5v3" />
      <path d="M7 10v4M11 10v4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </>
  ),
  temp: (
    <>
      <path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0Z" />
      <circle cx="12" cy="17.5" r="1.4" fill="currentColor" />
    </>
  ),
  antenna: (
    <>
      <path d="M5 11a7 7 0 0 0 8 8L5 11Z" />
      <path d="m9 15 6-6" />
      <circle cx="16" cy="8" r="1.5" />
      <path d="M17 3a5 5 0 0 1 4 4M12 21h8" />
    </>
  ),
  storm: (
    <>
      <circle cx="8" cy="8" r="3.2" />
      <path d="M8 2v1.5M2 8h1.5M3.8 3.8l1 1M3.8 12.2l1-1M12.2 3.8l-1 1" />
      <path d="M13 9l8 3-5 2 5 2-9 4" />
    </>
  ),
  plant: (
    <>
      <path d="M12 21v-9" />
      <path d="M12 13c0-4-3-6-7-6 0 4 3 6 7 6Z" />
      <path d="M12 11c0-3 2.5-5 6-5 0 3.5-2.5 5-6 5Z" />
      <path d="M7 21h10" />
    </>
  ),
  rocket: (
    <>
      <path d="M12 2c4 3 5 8 4 13H8C7 10 8 5 12 2Z" />
      <circle cx="12" cy="9" r="1.8" />
      <path d="M8 13l-3 4h4M16 13l3 4h-4M10 18l2 4 2-4" />
    </>
  ),
  rover: (
    <>
      <path d="M4 14V9a2 2 0 0 1 2-2h8l4 4h2v3" />
      <circle cx="7" cy="17" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
      <path d="M9.5 17h5M14 7V4M13 4h3" />
    </>
  ),
  ice: (
    <>
      <path d="M12 2v20M3.5 7l17 10M20.5 7l-17 10" />
      <path d="m9.5 4 2.5 2 2.5-2M9.5 20l2.5-2 2.5 2" />
    </>
  ),
  dust: (
    <>
      <path d="M3 8h9M3 12h14M3 16h10M15 8h2M19 12h2M15 16h4" />
      <circle cx="19" cy="7" r="0.8" fill="currentColor" />
      <circle cx="6" cy="20" r="0.8" fill="currentColor" />
    </>
  ),
  wind: (
    <>
      <path d="M12 3c4 0 6 2 6 4s-3 3-6 3-5 1-5 3 2 3 5 3 4 1 4 2.5-1.500 2.500-4 2.500" />
    </>
  ),
  cold: (
    <>
      <path d="M12 2v20M4 6.5l16 11M20 6.500 4 17.500" />
      <path d="m9 4 3 2.500L15 4M9 20l3-2.500 3 2.500" />
    </>
  ),
  quake: <path d="M2 12h3l2-6 3 12 3-9 2 5 2-2h5" />,
  leak: (
    <>
      <circle cx="9" cy="12" r="6" />
      <path d="M15 12h6M17 8l3-2M17 16l3 2" />
      <circle cx="9" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  water: <path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11Z" />,
  sleep: (
    <>
      <path d="M20 14A8 8 0 1 1 10 4a6.500 6.500 0 0 0 10 10Z" />
      <path d="M15 4h4l-4 4h4" />
    </>
  ),
  meteor: (
    <>
      <circle cx="8" cy="16" r="4" />
      <path d="M11 13 20 4M13 16l8-3M8 12l3-8" />
    </>
  ),
  eclipse: (
    <>
      <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  regolith: (
    <>
      <ellipse cx="7.5" cy="16.5" rx="4.5" ry="3" /><ellipse cx="16.5" cy="17" rx="4.5" ry="2.8" /><ellipse cx="12" cy="10.5" rx="4" ry="3" /><path d="M4 8h.01M20 9h.01M17 5h.01" />
    </>
  ),
  metal: (
    <>
      <path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9Z" /><circle cx="12" cy="12" r="3.2" />
    </>
  ),
  build: (
    <>
      <path d="M5 21V4h14l-4 4" /><path d="M5 8h10" /><path d="M15 4v8" /><rect x="13" y="12" width="4" height="3" /><path d="M2 21h7" />
    </>
  ),
  wrench: (
    <>
      <path d="M14.5 5.5a4 4 0 0 0-5 5L3 17l3 3 6.5-6.5a4 4 0 0 0 5-5l-2.5 2.5-2.4-.6-.6-2.4Z" />
    </>
  ),
  telescope: (
    <>
      <path d="M3 13l11-6 2 4-11 6Z" /><path d="M14 7l3-1.5 2 4-3 1.5" /><path d="M9 15l-3 6M10 15l3 6" />
    </>
  ),
  bunker: (
    <>
      <path d="M3 20v-6a9 9 0 0 1 18 0v6Z" /><path d="M9 20v-5h6v5" />
    </>
  ),
  tank: (
    <>
      <rect x="7" y="5" width="10" height="16" rx="5" /><path d="M10 2h4M12 2v3" />
    </>
  ),
  drill: (
    <>
      <path d="M3 9h9l3 3-3 3H3Z" /><path d="M15 12h6" /><path d="M6 15v5h4v-5" />
    </>
  ),
  radar: (
    <>
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12l6-6" />
    </>
  ),
  boot: (
    <>
      <path d="M8 3v9l-4 3v4h16v-2l-6-3V3Z" /><path d="M4 19h16" />
    </>
  ),
  vest: (
    <>
      <path d="M8 3 4 6v14h6V9M16 3l4 3v14h-6V9" /><path d="M8 3c1 2 2.5 3 4 3s3-1 4-3" />
    </>
  ),
  door: (
    <>
      <path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17" /><path d="M3 21h18" /><circle cx="14.5" cy="12" r="1" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  shrink: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  book: (
    <>
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" />
      <path d="M4 19a2 2 0 0 1 2-2h13M9 8h6M9 12h4" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.900 4.900 7 7M17 17l2.100 2.100M4.900 19.100 7 17M17 7l2.100-2.100" />
    </>
  ),
  close: <path d="M5 5l14 14M19 5 5 19" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" />
      <circle cx="12" cy="7.600" r="1" fill="currentColor" />
    </>
  ),
  speaker: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M16.500 8.500a5 5 0 0 1 0 7M19 6a8.500 8.500 0 0 1 0 12" />
    </>
  ),
  play: <path d="M7 4v16l13-8L7 4Z" fill="currentColor" stroke="none" />,
  next: <path d="M9 5l7 7-7 7" />,
  back: <path d="M15 5l-7 7 7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  star: <path d="m12 2.500 2.900 6.100 6.600.900-4.800 4.600 1.200 6.600L12 17.500 6.100 20.700l1.200-6.600L2.500 9.500l6.600-.900L12 2.500Z" fill="currentColor" stroke="none" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2.500" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  check: <path d="m5 12.500 5 5L19 7" />,
  home: (
    <>
      <path d="M3 11.500 12 4l9 7.500" />
      <path d="M6 10v10h12V10" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  jump: (
    <>
      <path d="M12 20V7" />
      <path d="m6 12 6-6 6 6" />
      <path d="M6 21h12" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </>
  ),
  life: (
    <>
      <path d="M4 20V12a8 8 0 0 1 16 0v8" />
      <path d="M2 20h20M10 20v-5h4v5M8 11h2M14 11h2" />
    </>
  ),
  lab: (
    <>
      <rect x="3" y="10" width="13" height="9" rx="4.500" />
      <path d="M16 12l5-6M19 5.500a3 3 0 0 1 2 2" />
      <circle cx="8" cy="14.500" r="1.200" />
      <circle cx="12" cy="14.500" r="1.200" />
    </>
  ),
  earth: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M7 6c2 1 2 3 1 4s-1 3 1 4 2 3 1 5M15 4c-1 2 0 3 2 4s2 3 0 4-2 3 0 5" />
    </>
  ),
  link: (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.500 9.500a2.500 2.500 0 1 1 3.500 2.300c-.700.400-1 1-1 1.700" />
      <circle cx="12" cy="16.800" r="1" fill="currentColor" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.600-6.500 10-6.500S22 12 22 12s-3.600 6.500-10 6.500S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  walk: (
    <>
      <circle cx="12" cy="6" r="3.500" />
      <path d="M8 21l1.500-6-2-3 1.500-2.500h6L16.500 12l-2 3L16 21" />
    </>
  ),
  badge: (
    <>
      <circle cx="12" cy="9" r="6" />
      <path d="M8.500 14 7 22l5-3 5 3-1.500-8" />
    </>
  ),
  warn: (
    <>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v5" />
      <circle cx="12" cy="17.500" r="1" fill="currentColor" />
    </>
  ),
  sample: (
    <>
      <path d="M12 3 5 9l7 12 7-12-7-6Z" />
      <path d="M5 9h14M9 9l3 12 3-12" />
    </>
  ),
  arrow: <path d="M12 20V5M5.500 11.500 12 5l6.500 6.500" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
};

export function Icon({ name, size = 20, class: className }: { name: IconName; size?: number; class?: string }): JSX.Element {
  return (
    <svg
      class={`icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Lumi's face, used beside the speech bubble. */
export function LumiFace({ mood, size = 56 }: { mood: string; size?: number }): JSX.Element {
  const eye = { happy: '#7dffb0', calm: '#6fe3ff', alert: '#ffab4d', sad: '#7f9bff', think: '#e0b3ff' }[mood] ?? '#6fe3ff';
  const squint = mood === 'happy';
  const wide = mood === 'alert';
  return (
    <svg class="lumi-face" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="35" r="23" fill="#fff6e4" stroke="#2b2440" stroke-width="2.500" />
      <path d="M22 13h20l-3-6H25l-3 6Z" fill="#ffc94d" stroke="#2b2440" stroke-width="2" stroke-linejoin="round" />
      <path d="M32 7V3" stroke="#ffc94d" stroke-width="2.500" stroke-linecap="round" />
      <circle cx="32" cy="2.500" r="2.500" fill={mood === 'alert' ? '#ff5a3d' : '#ffd166'} />
      <ellipse cx="32" cy="37" rx="17" ry="13" fill="#1b2146" />
      {squint ? (
        <>
          <path d="M22 38q4-6 8 0" stroke={eye} stroke-width="3.200" fill="none" stroke-linecap="round" />
          <path d="M34 38q4-6 8 0" stroke={eye} stroke-width="3.200" fill="none" stroke-linecap="round" />
        </>
      ) : (
        <>
          <ellipse cx="26" cy="37" rx={wide ? 3.600 : 2.800} ry={wide ? 5.600 : 4.600} fill={eye} transform={mood === 'sad' ? 'rotate(-18 26 37)' : undefined} />
          <ellipse cx="38" cy="37" rx={wide ? 3.600 : 2.800} ry={wide ? 5.600 : 4.600} fill={eye} transform={mood === 'sad' ? 'rotate(18 38 37)' : undefined} />
        </>
      )}
      <path d="M9 34 3 37l6 3M55 34l6 3-6 3" fill="#ffc94d" stroke="#2b2440" stroke-width="2" stroke-linejoin="round" />
    </svg>
  );
}
