/**
 * Lumi, the helper robot: a small floating lantern with a screen face.
 * Lumi follows the player, looks at things worth noticing, and shows a mood.
 */
import * as THREE from 'three';
import { shape } from './build';
import { GLOBALS, addOutline, glow, outlineMaterial, toon } from './materials';
import { model } from './models';
import { dotTexture } from './textures';

export type Mood = 'happy' | 'calm' | 'alert' | 'sad' | 'think';

const MOOD_COLOR: Record<Mood, string> = {
  happy: '#7dffb0',
  calm: '#6fe3ff',
  alert: '#ffab4d',
  sad: '#7f9bff',
  think: '#e0b3ff',
};

export class Lumi {
  readonly group = new THREE.Group();
  /** Where Lumi wants to be. */
  readonly goal = new THREE.Vector3(2, 2.6, 2);
  /** What Lumi looks at. */
  readonly lookTarget = new THREE.Vector3();
  readonly light: THREE.PointLight | null;
  /** How strongly the ring and halo shine (1 outside; less in bright rooms, where they would wash Lumi out). */
  bright = 1;

  private readonly eyes: THREE.Mesh[] = [];
  private readonly eyeMaterial: THREE.MeshBasicMaterial;
  private readonly bulbMaterial: THREE.MeshBasicMaterial;
  private readonly ring: THREE.Mesh;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly glowSprite: THREE.Sprite;
  private readonly bulbGlow: THREE.Sprite;
  private readonly ownMaterials: THREE.Material[] = [];
  private readonly velocity = new THREE.Vector3();
  private readonly spot = new THREE.Vector3(2, 2.6, 2);
  private readonly moodColor = new THREE.Color(MOOD_COLOR.calm);
  private readonly tmp = new THREE.Vector3();
  private mood: Mood = 'calm';
  private blink = 0;
  private nextBlink = 2;
  private time = 0;
  private hop = 0;

  constructor(withOutline = true, withLight = false) {
    // The shell is a Blender model with its colours and soft shadows baked in.
    const paint = toon({ color: '#ffffff', rim: 0.7, rimWidth: 0.5, vertexColors: true, lift: 0.22 });
    // The screen lights itself a little (blue glow), so the face reads in shade and at night.
    const face = toon({ color: '#1b2146', rim: 0.5, spec: 1.2, vertexColors: true, emissive: '#16347a', emissiveIntensity: 0.75 });
    const hover = glow('#ffd9a0', 2.2);
    this.ownMaterials.push(hover);
    const shell = model('lumi', (name, mesh) => {
      if (name === 'glow_warm') {
        mesh.userData.noOutline = true;
        return hover;
      }
      return name === 'screen' ? face : paint;
    });
    this.bulbMaterial = new THREE.MeshBasicMaterial({ color: '#ffd166' });
    this.bulbMaterial.color.multiplyScalar(3);
    const bulb = new THREE.Mesh(shape.sphere(0.05, 10), this.bulbMaterial);
    bulb.position.y = 0.49;
    bulb.userData.noOutline = true;
    this.group.add(shell, bulb);

    this.eyeMaterial = new THREE.MeshBasicMaterial({ color: MOOD_COLOR.calm });
    this.eyeMaterial.color.multiplyScalar(2.6);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(shape.sphere(0.045, 12), this.eyeMaterial);
      eye.scale.set(0.85, 1.5, 0.35);
      eye.position.set(side * 0.085, 0.02, 0.3);
      eye.userData.noOutline = true;
      this.eyes.push(eye);
      this.group.add(eye);
    }

    const ringMaterial = new THREE.MeshBasicMaterial({ color: '#ffd166' });
    ringMaterial.color.multiplyScalar(2.2);
    this.ringMaterial = ringMaterial;
    this.ring = new THREE.Mesh(shape.torus(0.45, 0.014, 40, 5), ringMaterial);
    this.ring.userData.noOutline = true;
    this.group.add(this.ring);

    const spriteMaterial = new THREE.SpriteMaterial({
      map: dotTexture(),
      color: '#ffd9a0',
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glowSprite = new THREE.Sprite(spriteMaterial);
    this.glowSprite.scale.setScalar(1.7);
    this.glowSprite.userData.noOutline = true;
    this.group.add(this.glowSprite);
    // A little glow round the antenna light that pulses; it turns red and quick when Lumi is alarmed.
    const bulbSprite = new THREE.SpriteMaterial({
      map: dotTexture(),
      color: '#ffd166',
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.bulbGlow = new THREE.Sprite(bulbSprite);
    this.bulbGlow.scale.setScalar(0.3);
    this.bulbGlow.position.y = 0.49;
    this.bulbGlow.userData.noOutline = true;
    this.group.add(this.bulbGlow);
    this.ownMaterials.push(this.eyeMaterial, this.bulbMaterial, ringMaterial, spriteMaterial, bulbSprite);

    if (withOutline) {
      const hull = outlineMaterial('#2b2440', 0.8);
      this.ownMaterials.push(hull);
      addOutline(this.group, hull);
    }
    this.light = withLight ? new THREE.PointLight('#ffd9a0', 0, 9, 1.6) : null;
    if (this.light) this.group.add(this.light);
    this.spot.copy(this.goal);
    this.group.position.copy(this.goal);
  }

  setMood(mood: Mood): void {
    if (mood !== this.mood) this.hop = 1;
    this.mood = mood;
    this.moodColor.set(MOOD_COLOR[mood]);
  }

  /** Jump straight to the goal (used when the scene changes). */
  snap(): void {
    this.spot.copy(this.goal);
    this.group.position.copy(this.goal);
    this.velocity.set(0, 0, 0);
  }

  update(dt: number, night: number): void {
    this.time += dt;
    const t = this.time;

    // Springy flight toward the goal, with a gentle bob.
    this.tmp.copy(this.goal).sub(this.spot);
    this.velocity.addScaledVector(this.tmp, dt * 26);
    this.velocity.multiplyScalar(Math.exp(-dt * 7));
    this.spot.addScaledVector(this.velocity, dt);
    this.hop = Math.max(0, this.hop - dt * 2.4);
    const bob = Math.sin(t * 2.2) * 0.07 + Math.sin(this.hop * Math.PI) * 0.25;
    this.group.position.set(this.spot.x, this.spot.y + bob, this.spot.z);

    // Face what matters.
    this.tmp.copy(this.lookTarget).sub(this.group.position);
    if (this.tmp.lengthSq() > 0.01) {
      const yaw = Math.atan2(this.tmp.x, this.tmp.z);
      let delta = yaw - this.group.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.group.rotation.y += delta * Math.min(1, dt * 6);
      const pitch = -Math.atan2(this.tmp.y, Math.hypot(this.tmp.x, this.tmp.z)) * 0.5;
      this.group.rotation.x += (THREE.MathUtils.clamp(pitch, -0.4, 0.4) - this.group.rotation.x) * Math.min(1, dt * 5);
    }
    this.group.rotation.z = Math.sin(t * 1.3) * 0.06 + this.velocity.x * 0.02;

    // Eyes: blink, and change shape with mood.
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 1;
      this.nextBlink = 1.8 + Math.random() * 3.5;
    }
    this.blink = Math.max(0, this.blink - dt * 9);
    const open = 1 - Math.sin(this.blink * Math.PI) * 0.9;
    const shapeY = { happy: 0.75, calm: 1.5, alert: 1.9, sad: 1.1, think: 1.2 }[this.mood];
    const shapeX = { happy: 1.35, calm: 0.85, alert: 1.15, sad: 0.9, think: 0.85 }[this.mood];
    this.eyes.forEach((eye, index) => {
      const side = index === 0 ? -1 : 1;
      eye.scale.set(shapeX, shapeY * open, 0.35);
      eye.rotation.z = this.mood === 'sad' ? side * 0.45 : this.mood === 'happy' ? -side * 0.15 : 0;
      eye.position.y = 0.02 + (this.mood === 'think' && index === 1 ? 0.03 : 0);
    });
    this.eyeMaterial.color.lerp(this.tmpColor.copy(this.moodColor).multiplyScalar(2.6), Math.min(1, dt * 6));
    const flash = this.mood === 'alert' ? 0.6 + 0.4 * Math.sin(t * 10) : 1;
    this.bulbMaterial.color.copy(this.mood === 'alert' ? this.tmpColor.set('#ff5a3d') : this.tmpColor.set('#ffd166')).multiplyScalar(3 * flash);

    const pulse = this.mood === 'alert' ? 0.65 + 0.35 * Math.sin(t * 10) : 0.7 + 0.3 * Math.sin(t * 2.4);
    // The antenna glow is part of the high and ultra look; the lower levels keep their draw call.
    this.bulbGlow.visible = GLOBALS.anime.value > 0.5;
    const bulbSprite = this.bulbGlow.material as THREE.SpriteMaterial;
    bulbSprite.color.copy(this.bulbMaterial.color).multiplyScalar(0.33);
    bulbSprite.opacity = (0.35 + 0.35 * night) * pulse * this.bright;
    this.bulbGlow.scale.setScalar(0.26 + 0.1 * pulse);

    this.ring.rotation.x = Math.PI / 2 + Math.sin(t * 0.9) * 0.35;
    this.ring.rotation.y = t * 1.4;
    (this.glowSprite.material as THREE.SpriteMaterial).opacity = (0.25 + 0.4 * night) * this.bright;
    this.ringMaterial.color.set('#ffd166').multiplyScalar(0.9 + 1.3 * this.bright);
    if (this.light) this.light.intensity = 6 * night;
  }

  private readonly tmpColor = new THREE.Color();

  dispose(): void {
    this.group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && !mesh.userData.isOutline && !mesh.geometry.userData.shared) mesh.geometry.dispose();
    });
    for (const material of this.ownMaterials) material.dispose();
  }
}
