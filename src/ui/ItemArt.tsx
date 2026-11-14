/**
 * Pictures of things the player owns or can make, for the item slots and detail cards.
 *
 * Buildings, rooms and decorations are pictures of the game's own 3D models
 * (public/thumbs, rendered by scripts/thumbs/render.js). Tools and materials have no
 * model, so they are drawn here in the same style: flat colours with a light side and a
 * shadow side, a dark outline and a white highlight.
 */
import type { JSX } from 'preact';
import type { BuildingId, DecorId, RoomId, ToolId } from '../sim/outpost';

export type ArtItem =
  | { kind: 'building'; id: BuildingId }
  | { kind: 'room'; id: RoomId }
  | { kind: 'decor'; id: DecorId }
  | { kind: 'tool'; id: ToolId }
  | { kind: 'material'; id: 'regolith' | 'metal' };

/** Rooms use the picture of the building they are in. */
const ROOM_PICTURE: Record<RoomId, string> = {
  hab: 'hab',
  farm: 'farm',
  lab: 'lab',
  lander: 'lander',
  workshop: 'workshop',
  garden: 'garden',
  observatory: 'observatory',
  oxygen: 'oxygen',
  bunker: 'bunker',
};

function picture(item: ArtItem): string | null {
  if (item.kind === 'building' || item.kind === 'decor') return item.id;
  if (item.kind === 'room') return ROOM_PICTURE[item.id];
  return null;
}

export function ItemArt({ item, size = 96 }: { item: ArtItem; size?: number }): JSX.Element {
  const file = picture(item);
  if (file) {
    return <img class="item-art" src={`${import.meta.env.BASE_URL}thumbs/${file}.png`} width={size} height={size} alt="" loading="lazy" decoding="async" draggable={false} />;
  }
  const Draw = item.kind === 'tool' ? TOOL_ART[item.id] : MATERIAL_ART[item.id as 'regolith' | 'metal'];
  return (
    <svg class="item-art" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <Draw />
    </svg>
  );
}

const INK = '#2b2440';
const stroke = { stroke: INK, 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' } as const;

/** A soft shadow under every item. */
const Ground = (): JSX.Element => <ellipse cx="50" cy="90" rx="30" ry="5" fill="#000" opacity="0.18" />;

const TOOL_ART: Record<ToolId, () => JSX.Element> = {
  // A big air tank: a white cylinder with a cyan band, a valve and a gauge.
  tank: () => (
    <>
      <Ground />
      <rect x="31" y="22" width="38" height="66" rx="17" fill="#eef2f7" {...stroke} />
      <path d="M50 24 h12 a5 5 0 0 1 5 5 v52 a5 5 0 0 1 -5 5 h-12 z" fill="#c9d1de" />
      <rect x="31" y="50" width="38" height="11" fill="#5fd0ff" {...stroke} />
      <rect x="50" y="51.5" width="17.5" height="8" fill="#2f9fd6" />
      <rect x="43" y="10" width="14" height="13" rx="3" fill="#8e96b3" {...stroke} />
      <rect x="36" y="7" width="28" height="6" rx="3" fill="#ff8a3d" {...stroke} />
      <circle cx="50" cy="72" r="7" fill="#fff" {...stroke} />
      <path d="M50 72 l4 -4" stroke={INK} stroke-width="2.4" stroke-linecap="round" />
      <path d="M37 30 q0 -4 4 -5" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" />
      <text x="50" y="44" text-anchor="middle" font-size="11" font-weight="900" fill={INK} font-family="Nunito Variable, sans-serif">
        O₂
      </text>
    </>
  ),
  // A rock drill: orange body, grip and a spiral bit.
  drill: () => (
    <>
      <Ground />
      <path d="M22 40 h40 a8 8 0 0 1 8 8 v4 a8 8 0 0 1 -8 8 h-40 z" fill="#ffad5c" {...stroke} />
      <path d="M22 52 h44 a8 8 0 0 1 -4 8 h-40 z" fill="#e0662b" />
      <path d="M30 60 l-4 22 a5 5 0 0 0 5 6 h8 a5 5 0 0 0 5 -5 l1 -23" fill="#3a4058" {...stroke} />
      <rect x="16" y="38" width="10" height="24" rx="4" fill="#8e96b3" {...stroke} />
      <path d="M70 44 l20 6 l-20 6 z" fill="#d0d5e6" {...stroke} />
      <path d="M74 45.5 l3 9 M80 47.3 l2.4 5.5" stroke={INK} stroke-width="2" stroke-linecap="round" />
      <circle cx="46" cy="50" r="5" fill="#7fffb0" stroke={INK} stroke-width="2.4" />
      <path d="M28 44 h26" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity="0.8" />
    </>
  ),
  // A rover battery: a dark block with green charge bars and a lightning bolt.
  battery: () => (
    <>
      <Ground />
      <rect x="20" y="28" width="60" height="56" rx="8" fill="#3d4466" {...stroke} />
      <rect x="20" y="28" width="60" height="12" rx="6" fill="#5b6386" />
      <rect x="30" y="20" width="12" height="9" rx="2" fill="#ff5a5a" {...stroke} />
      <rect x="58" y="20" width="12" height="9" rx="2" fill="#8e96b3" {...stroke} />
      {[0, 1, 2, 3].map((n) => (
        <rect key={n} x={28 + n * 11.5} y="50" width="9" height="26" rx="2.5" fill={n < 3 ? '#5fff9a' : '#2a3150'} stroke={INK} stroke-width="2" />
      ))}
      <path d="M53 33 l-6 10 h6 l-4 9" fill="none" stroke="#ffd166" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />
    </>
  ),
  // A handheld scanner: a screen with radar rings and a little dish.
  scanner: () => (
    <>
      <Ground />
      <rect x="40" y="62" width="16" height="24" rx="5" fill="#8a5fe0" {...stroke} />
      <rect x="18" y="18" width="60" height="48" rx="10" fill="#eef2f7" {...stroke} />
      <rect x="25" y="25" width="46" height="34" rx="6" fill="#123a4f" stroke={INK} stroke-width="2.5" />
      <circle cx="48" cy="42" r="13" fill="none" stroke="#5fe0ff" stroke-width="2" opacity="0.6" />
      <circle cx="48" cy="42" r="7" fill="none" stroke="#5fe0ff" stroke-width="2" opacity="0.8" />
      <path d="M48 42 L60 34" stroke="#7fffb0" stroke-width="2.6" stroke-linecap="round" />
      <circle cx="57" cy="48" r="3" fill="#ffd166" />
      <path d="M78 26 q10 4 10 16" fill="none" {...stroke} />
      <circle cx="88" cy="44" r="4" fill="#ff8a3d" {...stroke} />
    </>
  ),
  // Jump boots: a chunky white boot with a blue sole and a spring.
  boots: () => (
    <>
      <Ground />
      <path d="M30 14 h24 v40 l22 10 a8 8 0 0 1 4 8 v4 h-52 v-58 a4 4 0 0 1 2 -4 z" fill="#eef2f7" {...stroke} />
      <path d="M54 54 l22 10 a8 8 0 0 1 4 8 v4 h-26 z" fill="#c9d1de" />
      <rect x="26" y="76" width="56" height="9" rx="4" fill="#4d78d6" {...stroke} />
      <path d="M30 30 h24 M30 40 h24" stroke="#ff8a3d" stroke-width="4" />
      <path d="M36 85 l4 6 l4 -6 l4 6 l4 -6" fill="none" stroke="#8e96b3" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M35 20 v28" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity="0.9" />
    </>
  ),
  // A radiation vest: an amber vest with a shield badge.
  vest: () => (
    <>
      <Ground />
      <path d="M34 14 l-16 12 v56 a4 4 0 0 0 4 4 h56 a4 4 0 0 0 4 -4 v-56 l-16 -12 q-6 12 -16 12 q-10 0 -16 -12 z" fill="#ffd166" {...stroke} />
      <path d="M50 26 v60 h28 a4 4 0 0 0 4 -4 v-56 l-16 -12 q-6 12 -16 12 z" fill="#e0a92b" />
      <path d="M18 52 h64" stroke={INK} stroke-width="3" />
      <path d="M18 56 h64" stroke="#fff" stroke-width="3" opacity="0.7" />
      <path d="M50 60 l-11 4 v8 c0 6 5 10 11 12 c6 -2 11 -6 11 -12 v-8 z" fill="#3d4466" {...stroke} />
      <circle cx="50" cy="71" r="2.4" fill="#ffd166" />
      <path d="M24 30 v18" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity="0.85" />
    </>
  ),
};

const MATERIAL_ART: Record<'regolith' | 'metal', () => JSX.Element> = {
  // A heap of rusty Mars rocks and dust.
  regolith: () => (
    <>
      <Ground />
      <path d="M14 86 q4 -18 18 -22 q8 -14 22 -12 q14 -4 22 10 q12 6 12 24 z" fill="#d9774a" {...stroke} />
      <path d="M50 52 q14 -4 22 10 q12 6 12 24 h-34 z" fill="#b5532e" />
      <path d="M28 70 l8 -4 l6 6 l-6 6 l-8 -2 z" fill="#f2a272" stroke={INK} stroke-width="2.2" stroke-linejoin="round" />
      <path d="M56 64 l9 -2 l4 8 l-8 5 l-6 -4 z" fill="#8f3f22" stroke={INK} stroke-width="2.2" stroke-linejoin="round" />
      <circle cx="44" cy="80" r="3" fill="#f2a272" stroke={INK} stroke-width="1.8" />
      <path d="M34 60 q6 -6 14 -6" fill="none" stroke="#ffd2b0" stroke-width="3" stroke-linecap="round" />
    </>
  ),
  // A metal bar with a shine.
  metal: () => (
    <>
      <Ground />
      <path d="M20 66 l14 -22 h44 l-6 22 z" fill="#d0d5e6" {...stroke} />
      <path d="M20 66 h52 v16 h-52 z" fill="#8e96b3" {...stroke} />
      <path d="M72 66 l6 -22 v16 l-6 22 z" fill="#6b7392" {...stroke} />
      <path d="M38 50 h28" stroke="#fff" stroke-width="4" stroke-linecap="round" />
      <path d="M78 24 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 z" fill="#fff" />
    </>
  ),
};
