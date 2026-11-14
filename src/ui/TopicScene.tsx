/**
 * Small drawn scenes for Science log cards that have no NASA photo: one scene per topic
 * (a world on the horizon, solar panels, a greenhouse, a radiation shield…), in the
 * game's cel style. Each card turns its scene a little (mirrored, a different time of
 * day, the stars in other places), so two cards of one topic do not look the same.
 */
import type { JSX } from 'preact';
import type { CodexTopic } from '../game/codex';

const INK = '#2b2440';
const line = { stroke: INK, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' } as const;

/** A small number from a card id, the same every time. */
function seed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

const SKIES: [string, string][] = [
  ['#1b1f45', '#4b3c7a'],
  ['#2a1838', '#8a3d52'],
  ['#14243f', '#2f6a8a'],
  ['#3a1f2a', '#c0623a'],
];

function Stars({ s }: { s: number }): JSX.Element {
  const dots = Array.from({ length: 14 }, (_, i) => {
    const a = (s * 997 + i * 61.3) % 1;
    const b = (s * 613 + i * 37.7) % 1;
    return <circle key={i} cx={6 + a * 188} cy={4 + b * 46} r={i % 4 === 0 ? 1.3 : 0.8} fill="#fff" opacity={0.45 + (i % 3) * 0.2} />;
  });
  return <>{dots}</>;
}

type Scene = (props: { s: number }) => JSX.Element;

const SCENES: Record<CodexTopic, Scene> = {
  // A world seen from the surface: red ground, rocks, a planet or Earth in the sky.
  worlds: ({ s }) => (
    <>
      <circle cx="150" cy="30" r="15" fill={s > 0.5 ? '#6fa8ff' : '#e8e2d6'} {...line} />
      {s > 0.5 ? <path d="M142 24 q6 4 3 10 q6 2 10 -2" fill="none" stroke="#5fd38a" stroke-width="3" /> : <circle cx="146" cy="27" r="3" fill="#c9c1b0" />}
      <path d="M0 74 q30 -14 60 -6 q34 -18 70 -4 q40 -12 70 0 v32 h-200 z" fill="#b5532e" {...line} />
      <path d="M0 84 q50 -10 100 -2 q50 -8 100 0 v22 h-200 z" fill="#d9774a" />
      <path d="M40 80 l8 -10 l9 4 l4 7 z" fill="#8f3f22" {...line} />
      <path d="M120 84 l6 -6 l7 3 l2 4 z" fill="#8f3f22" {...line} />
    </>
  ),
  // Solar panels under a bright sun.
  power: ({ s }) => (
    <>
      <circle cx={s > 0.5 ? 40 : 160} cy="26" r="13" fill="#ffd166" stroke="#ffb347" stroke-width="3" />
      <path d="M0 82 q100 -10 200 0 v24 h-200 z" fill="#c9784a" />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${44 + i * 44} 52)`}>
          <path d="M0 0 h36 l-6 18 h-36 z" fill="#27398a" {...line} />
          <path d="M12 0 l-6 18 M24 0 l-6 18 M-3 9 h36" stroke="#6f8bff" stroke-width="1.4" />
          <path d="M12 18 v14" {...line} />
        </g>
      ))}
    </>
  ),
  // A dome with a crew window and rising bubbles of air.
  air: ({ s }) => (
    <>
      <path d="M0 84 q100 -8 200 0 v22 h-200 z" fill="#a86a4a" />
      <path d="M60 84 a40 34 0 0 1 80 0 z" fill="#eef2f7" {...line} />
      <path d="M100 50 a40 34 0 0 1 40 34 h-40 z" fill="#c9d1de" />
      <rect x="92" y="66" width="16" height="18" rx="3" fill="#5fd0ff" {...line} />
      {[0, 1, 2, 3].map((i) => (
        <circle key={i} cx={52 + ((s * 90 + i * 37) % 100)} cy={20 + i * 8} r={3 + (i % 2) * 2} fill="none" stroke="#8fe9ff" stroke-width="2" opacity="0.85" />
      ))}
    </>
  ),
  // Plants in pots under pink grow lights.
  food: ({ s }) => (
    <>
      <rect x="20" y="16" width="160" height="6" rx="3" fill="#ff7ad9" opacity="0.9" />
      <path d="M20 22 l-10 30 M180 22 l10 30" stroke="#ff7ad9" stroke-width="10" opacity="0.15" />
      <path d="M0 86 h200 v20 h-200 z" fill="#3d4466" />
      {[0, 1, 2, 3].map((i) => {
        const x = 34 + i * 44;
        const tall = 20 + ((s * 7 + i) % 3) * 6;
        return (
          <g key={i}>
            <path d={`M${x} 86 v-${tall}`} stroke="#2f8f58" stroke-width="3" />
            <ellipse cx={x - 7} cy={86 - tall + 6} rx="8" ry="5" fill="#5fd38a" {...line} />
            <ellipse cx={x + 7} cy={86 - tall + 12} rx="8" ry="5" fill="#7fe0a0" {...line} />
            {i % 2 === 0 && <circle cx={x + 4} cy={86 - tall + 2} r="3.5" fill="#ff5a5a" {...line} />}
            <path d={`M${x - 11} 74 h22 l-3 12 h-16 z`} fill="#ff8a3d" {...line} />
          </g>
        );
      })}
    </>
  ),
  // A shield turning away fast particles from the Sun.
  radiation: ({ s }) => (
    <>
      <circle cx="18" cy="48" r="16" fill="#ffd166" stroke="#ffb347" stroke-width="3" />
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} d={`M40 ${30 + i * 9} l${46 + ((s * 13 + i * 7) % 14)} 0`} stroke="#e07ad9" stroke-width="2.4" stroke-dasharray="4 4" />
      ))}
      <path d="M118 22 l-22 8 v20 c0 16 10 26 22 30 c12 -4 22 -14 22 -30 v-20 z" fill="#3d4466" {...line} />
      <path d="M118 22 l22 8 v20 c0 16 -10 26 -22 30 z" fill="#5b6386" />
      <circle cx="118" cy="50" r="5" fill="#ffd166" {...line} />
      <path d="M152 40 q16 -6 30 4 M152 56 q16 6 30 -2" fill="none" stroke="#8fe9ff" stroke-width="2.4" opacity="0.8" />
    </>
  ),
  // The Sun with loops of fire on its edge.
  sun: ({ s }) => (
    <>
      <circle cx={s > 0.5 ? 70 : 130} cy="70" r="46" fill="#ffb347" stroke="#ff8a3d" stroke-width="3" />
      <circle cx={s > 0.5 ? 70 : 130} cy="70" r="34" fill="#ffd166" />
      <path d={s > 0.5 ? 'M108 46 q20 -24 30 4' : 'M92 46 q-20 -24 -30 4'} fill="none" stroke="#ff5a3d" stroke-width="5" stroke-linecap="round" />
      <path d={s > 0.5 ? 'M114 74 q18 -10 22 12' : 'M86 74 q-18 -10 -22 12'} fill="none" stroke="#ff8a3d" stroke-width="4" stroke-linecap="round" />
      <circle cx={s > 0.5 ? 60 : 140} cy="62" r="4" fill="#e0662b" />
      <circle cx={s > 0.5 ? 80 : 120} cy="80" r="3" fill="#e0662b" />
    </>
  ),
  // A dish sending a signal across space to Earth.
  radio: ({ s }) => (
    <>
      <circle cx={s > 0.5 ? 170 : 30} cy="26" r="11" fill="#6fa8ff" {...line} />
      <path d={s > 0.5 ? 'M165 22 q5 3 2 8' : 'M25 22 q5 3 2 8'} fill="none" stroke="#5fd38a" stroke-width="2.6" />
      <path d="M0 84 q100 -8 200 0 v22 h-200 z" fill="#b5532e" />
      <g transform={s > 0.5 ? 'translate(60 0)' : 'translate(140 0) scale(-1 1)'}>
        <path d="M0 50 a26 26 0 0 0 36 22 z" fill="#eef2f7" {...line} />
        <path d="M18 61 l14 -16" {...line} />
        <circle cx="33" cy="44" r="3" fill="#ff8a3d" {...line} />
        <path d="M18 66 v18 M10 84 h16" {...line} />
        <path d="M44 40 q8 -8 16 -14 M50 46 q12 -12 24 -20 M56 52 q16 -16 32 -26" fill="none" stroke="#8fe9ff" stroke-width="2.4" stroke-linecap="round" opacity="0.85" />
      </g>
    </>
  ),
  // An astronaut's helmet with Earth's light on the visor.
  people: ({ s }) => (
    <>
      <path d="M0 90 q100 -10 200 0 v16 h-200 z" fill="#3d4466" />
      <g transform={`translate(${s > 0.5 ? 70 : 130} 0)`}>
        <circle cx="0" cy="56" r="32" fill="#eef2f7" {...line} />
        <rect x="-24" y="38" width="48" height="32" rx="14" fill="#1d2a52" {...line} />
        <path d="M-16 46 q8 -6 18 -4" fill="none" stroke="#8fe9ff" stroke-width="3" stroke-linecap="round" />
        <circle cx="12" cy="60" r="5" fill="#6fa8ff" opacity="0.8" />
        <rect x="-36" y="50" width="8" height="14" rx="3" fill="#ff8a3d" {...line} />
        <path d="M-20 88 h40 l-4 -10 h-32 z" fill="#c9d1de" {...line} />
      </g>
    </>
  ),
  // A satellite and a rising chart of data.
  data: ({ s }) => (
    <>
      <path d="M20 86 h160" stroke="#8e96b3" stroke-width="2" />
      <path d="M20 86 v-60" stroke="#8e96b3" stroke-width="2" />
      <path d={`M24 ${76 - s * 10} l30 -8 l28 6 l30 -20 l30 4 l30 -26`} fill="none" stroke="#79e0d0" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
      {[24, 54, 82, 112, 142, 172].map((x, i) => (
        <circle key={x} cx={x} cy={[76 - s * 10, 68 - s * 10, 74 - s * 10, 54 - s * 10, 58 - s * 10, 32 - s * 10][i]} r="3.4" fill="#fff" {...line} />
      ))}
      <g transform="translate(150 22) rotate(-20)">
        <rect x="-8" y="-6" width="16" height="12" rx="2" fill="#ffd166" {...line} />
        <rect x="-30" y="-4" width="18" height="8" fill="#27398a" {...line} />
        <rect x="12" y="-4" width="18" height="8" fill="#27398a" {...line} />
      </g>
    </>
  ),
};

export function TopicScene({ topic, id }: { topic: CodexTopic; id: string }): JSX.Element {
  const s = seed(id);
  const [top, bottom] = SKIES[Math.floor(s * SKIES.length) % SKIES.length];
  const Draw = SCENES[topic];
  const gradient = `sky-${id}`;
  return (
    <svg class="topic-scene" viewBox="0 0 200 106" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={top} />
          <stop offset="1" stop-color={bottom} />
        </linearGradient>
      </defs>
      <rect width="200" height="106" fill={`url(#${gradient})`} />
      <Stars s={s} />
      <Draw s={s} />
    </svg>
  );
}
