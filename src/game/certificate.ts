/**
 * Draws the mission certificate as a picture the player can save or print.
 * Everything stays on the device: the picture is made in the browser.
 */
import { fmtRange, t } from '../i18n';
import type { MissionState } from '../sim/types';
import { addDays } from '../sim/ephemeris';

function star(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, filled: boolean): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
  }
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = '#ffd166';
    ctx.fill();
  } else {
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.5)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, font: string): void {
  let current = size;
  do {
    ctx.font = `${font} ${current}px 'Unbounded Variable', 'Nunito Variable', system-ui, sans-serif`;
    current -= 2;
  } while (ctx.measureText(text).width > maxWidth && current > 14);
}

export function drawCertificate(state: MissionState, name: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const w = (canvas.width = 1600);
  const h = (canvas.height = 1130);
  const ctx = canvas.getContext('2d')!;
  const mars = state.config.site === 'mars';

  // Night sky.
  const sky = ctx.createLinearGradient(0, 0, w, h);
  sky.addColorStop(0, '#0d1238');
  sky.addColorStop(0.6, '#241a52');
  sky.addColorStop(1, mars ? '#5a2a2a' : '#2a2f45');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  let seed = state.config.seed || 7;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.25 + random() * 0.65})`;
    const size = random() < 0.9 ? 1.6 : 3;
    ctx.fillRect(random() * w, random() * h * 0.8, size, size);
  }

  // The world on the horizon.
  const ground = ctx.createLinearGradient(0, h - 260, 0, h);
  if (mars) {
    ground.addColorStop(0, '#e08a52');
    ground.addColorStop(1, '#8f4426');
  } else {
    ground.addColorStop(0, '#d5d8df');
    ground.addColorStop(1, '#6f7380');
  }
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.ellipse(w / 2, h + 620, w * 0.95, 860, 0, Math.PI, 0);
  ctx.fill();
  // A small dome with a lit window.
  ctx.fillStyle = '#f4f0e8';
  ctx.beginPath();
  ctx.arc(w / 2, h - 232, 54, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#39c2f0';
  ctx.fillRect(w / 2 - 54, h - 244, 108, 10);
  ctx.fillStyle = '#ffd9a0';
  ctx.fillRect(w / 2 - 14, h - 270, 28, 18);

  // Frame.
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 6;
  ctx.strokeRect(36, 36, w - 72, h - 72);
  ctx.strokeStyle = 'rgba(255, 209, 102, 0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(52, 52, w - 104, h - 104);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd166';
  fitText(ctx, t('cert.title').toUpperCase(), w - 260, 58, '700');
  ctx.fillText(t('cert.title').toUpperCase(), w / 2, 190);

  ctx.fillStyle = '#ffffff';
  const shown = name.trim() || t('cert.anon');
  fitText(ctx, shown, w - 320, 110, '800');
  ctx.fillText(shown, w / 2, 370);

  const from = state.config.startDate;
  const to = addDays(from, state.history.length * 7 - 1);
  ctx.fillStyle = '#e8e4f5';
  ctx.font = "600 40px 'Nunito Variable', system-ui, sans-serif";
  ctx.fillText(t('cert.body', { site: t(`site.${state.config.site}.name`), weeks: state.history.length }), w / 2, 470);
  ctx.font = "500 32px 'Nunito Variable', system-ui, sans-serif";
  ctx.fillStyle = '#c9c5e0';
  ctx.fillText(t('cert.detail', { from: fmtRange(from, to).split(' – ')[0], to: fmtRange(from, to).split(' – ')[1] ?? '' }), w / 2, 530);

  for (let i = 0; i < 3; i++) star(ctx, w / 2 - 110 + i * 110, 660, 44, i < state.stars);
  ctx.fillStyle = '#ffd166';
  ctx.font = "700 38px 'Nunito Variable', system-ui, sans-serif";
  ctx.fillText(t('cert.science', { n: state.science }), w / 2, 770);

  ctx.fillStyle = 'rgba(20, 16, 40, 0.75)';
  ctx.font = "600 22px 'Nunito Variable', system-ui, sans-serif";
  ctx.fillText(t('cert.foot'), w / 2, h - 78);
  return canvas;
}

export async function saveCertificate(state: MissionState, name: string): Promise<boolean> {
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    const canvas = drawCertificate(state, name);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${t('cert.file')}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
}
