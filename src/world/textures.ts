/**
 * Small textures painted with the 2D canvas at start-up. Nothing is downloaded.
 */
import * as THREE from 'three';
import type { SiteId } from '../sim/types';
import { mulberry32 } from '../sim/rng';
import { canvasTexture } from './materials';

const cache = new Map<string, THREE.Texture>();

function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let texture = cache.get(key);
  if (!texture) {
    texture = make();
    cache.set(key, texture);
  }
  return texture;
}

/** Printed regolith bricks in the colour of the local soil. */
export function brickTexture(site: SiteId): THREE.Texture {
  return cached(`brick-${site}`, () => {
    const base = site === 'mars' ? [176, 98, 58] : [150, 153, 162];
    const texture = canvasTexture(
      256,
      128,
      (ctx, w, h) => {
        const random = mulberry32(site === 'mars' ? 5 : 6);
        const rows = 4;
        const cols = 4;
        const bw = w / cols;
        const bh = h / rows;
        for (let row = 0; row < rows; row++) {
          for (let col = -1; col < cols; col++) {
            const shade = 0.82 + random() * 0.3;
            ctx.fillStyle = `rgb(${Math.min(255, base[0] * shade)},${Math.min(255, base[1] * shade)},${Math.min(255, base[2] * shade)})`;
            const x = col * bw + (row % 2 ? bw / 2 : 0);
            ctx.fillRect(x, row * bh, bw, bh);
          }
        }
        ctx.strokeStyle = 'rgba(40,24,20,0.45)';
        ctx.lineWidth = 3;
        for (let row = 0; row <= rows; row++) {
          ctx.beginPath();
          ctx.moveTo(0, row * bh);
          ctx.lineTo(w, row * bh);
          ctx.stroke();
          for (let col = -1; col <= cols; col++) {
            const x = col * bw + (row % 2 ? bw / 2 : 0);
            ctx.beginPath();
            ctx.moveTo(x, row * bh);
            ctx.lineTo(x, (row + 1) * bh);
            ctx.stroke();
          }
        }
      },
      { repeat: true },
    );
    texture.repeat.set(0.35, 0.7);
    return texture;
  });
}

/** The mission patch: an original emblem with a planet, a rising star and an orbit line. */
export function emblemTexture(site: SiteId): THREE.Texture {
  return cached(`emblem-${site}`, () =>
    canvasTexture(256, 256, (ctx, w, h) => {
      const cx = w / 2;
      const cy = h / 2;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#16204a';
      ctx.beginPath();
      ctx.arc(cx, cy, 120, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 9;
      ctx.strokeStyle = '#ffd166';
      ctx.stroke();
      // The world.
      const planet = ctx.createLinearGradient(60, 150, 200, 250);
      if (site === 'mars') {
        planet.addColorStop(0, '#f08a4b');
        planet.addColorStop(1, '#a8492a');
      } else {
        planet.addColorStop(0, '#e6e8ee');
        planet.addColorStop(1, '#8a8e9a');
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, 112, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = planet;
      ctx.beginPath();
      ctx.arc(cx, cy + 150, 150, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Orbit line.
      ctx.strokeStyle = '#7fd6ff';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(cx, cy - 6, 96, 34, -0.45, 0, Math.PI * 2);
      ctx.stroke();
      // Four-point star.
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      const sx = cx + 34;
      const sy = cy - 44;
      for (let i = 0; i < 8; i++) {
        const radius = i % 2 === 0 ? 34 : 9;
        const angle = (i * Math.PI) / 4 - Math.PI / 2;
        ctx.lineTo(sx + Math.cos(angle) * radius, sy + Math.sin(angle) * radius);
      }
      ctx.closePath();
      ctx.fill();
      // A small dome: the outpost.
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx - 30, cy + 62, 24, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#39c2f0';
      ctx.fillRect(cx - 54, cy + 54, 48, 6);
    }),
  );
}

/** The plaza floor: hand-laid paving stones in rings, a compass rose in the middle and gold inlay. */
export function plazaTexture(site: SiteId): THREE.Texture {
  return cached(`plaza-${site}`, () =>
    canvasTexture(1024, 1024, (ctx, w, h) => {
      const random = mulberry32(site === 'mars' ? 41 : 42);
      const cx = w / 2;
      const cy = h / 2;
      const R = w / 2;
      const base = site === 'mars' ? [233, 214, 189] : [214, 218, 226];
      const seam = site === 'mars' ? '#9a7a62' : '#7c818f';
      ctx.fillStyle = seam;
      ctx.fillRect(0, 0, w, h);
      // Rings of paving stones, more stones in the outer rings.
      const rings: [number, number, number][] = [
        [0.29, 0.47, 12],
        [0.47, 0.65, 18],
        [0.65, 0.83, 26],
        [0.86, 1.0, 34],
      ];
      for (const [inner, outer, count] of rings) {
        for (let i = 0; i < count; i++) {
          const gap = 0.012;
          const a0 = (i / count) * Math.PI * 2 + gap;
          const a1 = ((i + 1) / count) * Math.PI * 2 - gap;
          const shade = 0.93 + random() * 0.1;
          ctx.fillStyle = `rgb(${base.map((c) => Math.min(255, Math.round(c * shade))).join(',')})`;
          ctx.beginPath();
          ctx.arc(cx, cy, outer * R - 4, a0, a1);
          ctx.arc(cx, cy, inner * R + 4, a1, a0, true);
          ctx.closePath();
          ctx.fill();
          // A soft highlight on the side toward the light.
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(cx, cy, outer * R - 7, a0 + 0.01, a1 - 0.01);
          ctx.stroke();
        }
      }
      // The gold band between the third and fourth rings, with inlaid dots.
      ctx.fillStyle = '#c9a45c';
      ctx.beginPath();
      ctx.arc(cx, cy, 0.86 * R - 2, 0, Math.PI * 2);
      ctx.arc(cx, cy, 0.83 * R + 2, Math.PI * 2, 0, true);
      ctx.fill();
      ctx.fillStyle = '#fff1c4';
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * 0.845 * R, cy + Math.sin(a) * 0.845 * R, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      // The middle: one round slab with a compass rose.
      ctx.fillStyle = site === 'mars' ? '#efe2cc' : '#e4e7ee';
      ctx.beginPath();
      ctx.arc(cx, cy, 0.29 * R - 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c9a45c';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(cx, cy, 0.25 * R, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const long = i % 2 === 0 ? 0.24 : 0.15;
        ctx.fillStyle = i % 2 === 0 ? '#3d78c9' : '#c9a45c';
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * long * R, cy + Math.sin(a) * long * R);
        ctx.lineTo(cx + Math.cos(a + 0.18) * 0.06 * R, cy + Math.sin(a + 0.18) * 0.06 * R);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a - 0.18) * 0.06 * R, cy + Math.sin(a - 0.18) * 0.06 * R);
        ctx.closePath();
        ctx.fill();
      }
      // Fine grit, so the stone does not look like plastic.
      for (let i = 0; i < 9000; i++) {
        const a = random() * Math.PI * 2;
        const r = Math.sqrt(random()) * R;
        ctx.fillStyle = random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.07)';
        ctx.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2, 2);
      }
    }),
  );
}

/** Landing pad markings. */
export function padTexture(): THREE.Texture {
  return cached('pad', () =>
    canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#59607a';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 100, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#f3efe6';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 58, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(w / 2 + Math.cos(angle) * 66, h / 2 + Math.sin(angle) * 66);
        ctx.lineTo(w / 2 + Math.cos(angle) * 92, h / 2 + Math.sin(angle) * 92);
        ctx.stroke();
      }
    }),
  );
}

/** Soft round dot for particles. */
export function dotTexture(): THREE.Texture {
  return cached('dot', () =>
    canvasTexture(64, 64, (ctx, w, h) => {
      const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }),
  );
}

/** Four-point sparkle for things the player can pick up. */
export function sparkleTexture(): THREE.Texture {
  return cached('sparkle', () =>
    canvasTexture(64, 64, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2, h / 2);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const radius = i % 2 === 0 ? 30 : 5;
        const angle = (i * Math.PI) / 4;
        ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      ctx.closePath();
      ctx.fill();
    }),
  );
}
