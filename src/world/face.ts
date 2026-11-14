/**
 * The cadet's face, painted on a small canvas the way an animator would draw it:
 * big eyes with highlights, a little mouth, a blush. A few expressions are drawn
 * once and swapped while the game runs (blink, happy, surprised, busy).
 */
import * as THREE from 'three';

export type FaceKind = 'normal' | 'blink' | 'happy' | 'wow' | 'focus';

const SIZE = 256;
const LINE = '#3a2740';
const IRIS_TOP = '#1f6f8f';
const IRIS_BOTTOM = '#63d8e6';

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}

function openEye(ctx: CanvasRenderingContext2D, x: number, y: number, wide: number): void {
  const rx = 25;
  const ry = 31 * wide;
  ctx.save();
  ellipse(ctx, x, y, rx, ry);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.clip();
  // Iris: darker at the top, lighter at the bottom.
  const iris = ctx.createLinearGradient(0, y - ry, 0, y + ry);
  iris.addColorStop(0, IRIS_TOP);
  iris.addColorStop(1, IRIS_BOTTOM);
  const scale = wide > 1 ? 0.78 : 1;
  ellipse(ctx, x, y + 3, 19 * scale, 25 * scale);
  ctx.fillStyle = iris;
  ctx.fill();
  ellipse(ctx, x, y + 3, 8.5 * scale, 12.5 * scale);
  ctx.fillStyle = '#17283c';
  ctx.fill();
  // The shadow of the upper lid.
  ctx.fillStyle = 'rgba(40, 30, 70, 0.28)';
  ctx.fillRect(x - rx, y - ry, rx * 2, ry * 0.42);
  // Two highlights.
  ctx.fillStyle = '#ffffff';
  ellipse(ctx, x - 9, y - 10, 7, 8.5);
  ctx.fill();
  ellipse(ctx, x + 9, y + 13, 3.2, 3.8);
  ctx.fill();
  ctx.restore();
  // Upper lash line, thicker at the outer corner.
  ctx.strokeStyle = LINE;
  ctx.lineCap = 'round';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.ellipse(x, y, rx + 1, ry + 1, 0, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();
}

function closedEye(ctx: CanvasRenderingContext2D, x: number, y: number, smiling: boolean): void {
  ctx.strokeStyle = LINE;
  ctx.lineCap = 'round';
  ctx.lineWidth = 6;
  ctx.beginPath();
  if (smiling) ctx.ellipse(x, y + 12, 24, 20, 0, Math.PI * 1.12, Math.PI * 1.88); // an arch: ^
  else ctx.ellipse(x, y - 8, 24, 17, 0, Math.PI * 0.14, Math.PI * 0.86); // a resting lid
  ctx.stroke();
}

function brow(ctx: CanvasRenderingContext2D, x: number, y: number, tilt: number, side: number): void {
  ctx.strokeStyle = 'rgba(58, 39, 64, 0.85)';
  ctx.lineCap = 'round';
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(x - 19, y + tilt * side * 8);
  ctx.quadraticCurveTo(x, y - 6, x + 19, y - tilt * side * 8);
  ctx.stroke();
}

function draw(kind: FaceKind): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const left = 80;
  const right = 176;
  const eyeY = 100;

  // Blush.
  for (const x of [54, 202]) {
    const blush = ctx.createRadialGradient(x, 148, 2, x, 148, 26);
    blush.addColorStop(0, kind === 'happy' ? 'rgba(255, 120, 130, 0.6)' : 'rgba(255, 130, 140, 0.42)');
    blush.addColorStop(1, 'rgba(255, 130, 140, 0)');
    ctx.fillStyle = blush;
    ctx.fillRect(x - 28, 122, 56, 52);
  }

  if (kind === 'blink') {
    closedEye(ctx, left, eyeY, false);
    closedEye(ctx, right, eyeY, false);
  } else if (kind === 'happy') {
    closedEye(ctx, left, eyeY, true);
    closedEye(ctx, right, eyeY, true);
  } else {
    const wide = kind === 'wow' ? 1.12 : 1;
    openEye(ctx, left, eyeY, wide);
    openEye(ctx, right, eyeY, wide);
  }

  const browY = kind === 'wow' ? 44 : 52;
  const tilt = kind === 'focus' ? -1 : kind === 'wow' ? 0.5 : 0.2;
  brow(ctx, left, browY, tilt, 1);
  brow(ctx, right, browY, tilt, -1);

  // Nose: one small soft mark.
  ctx.fillStyle = 'rgba(190, 110, 100, 0.5)';
  ellipse(ctx, 128, 140, 2.6, 2);
  ctx.fill();

  // Mouth.
  ctx.strokeStyle = LINE;
  ctx.lineCap = 'round';
  ctx.lineWidth = 4;
  ctx.beginPath();
  if (kind === 'happy') {
    ctx.moveTo(108, 176);
    ctx.quadraticCurveTo(128, 210, 148, 176);
    ctx.closePath();
    ctx.fillStyle = '#b8455a';
    ctx.fill();
    ctx.stroke();
  } else if (kind === 'wow') {
    ellipse(ctx, 128, 188, 8, 10);
    ctx.fillStyle = '#b8455a';
    ctx.fill();
    ctx.stroke();
  } else if (kind === 'focus') {
    ctx.moveTo(116, 188);
    ctx.lineTo(140, 188);
    ctx.stroke();
  } else {
    ctx.moveTo(112, 181);
    ctx.quadraticCurveTo(128, 196, 144, 181);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false; // models use the glTF picture direction
  texture.anisotropy = 4;
  return texture;
}

let cache: Record<FaceKind, THREE.CanvasTexture> | null = null;

/** All expressions, drawn once and shared by every astronaut. */
export function faceTextures(): Record<FaceKind, THREE.CanvasTexture> {
  cache ??= { normal: draw('normal'), blink: draw('blink'), happy: draw('happy'), wow: draw('wow'), focus: draw('focus') };
  return cache;
}
