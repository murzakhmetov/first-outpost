/**
 * The player's astronaut: a young cadet in a soft suit with a clear helmet.
 *
 * The model is made in Blender (scripts/models/astronaut.py) as rigid parts with
 * pivots. Everything that moves is animated here in code: walk, hop, wave, drill,
 * cheer, and a face that blinks and reacts.
 */
import * as THREE from 'three';
import { shape } from './build';
import { faceTextures } from './face';
import type { FaceKind } from './face';
import { GLOBALS, addOutline, glow, outlineMaterial, toon } from './materials';
import { model } from './models';
import { dotTexture } from './textures';

export type Emote = 'none' | 'wave' | 'cheer' | 'drill' | 'alarm';

export interface Motion {
  /** Ground speed as a fraction of top speed, 0-1. */
  speed: number;
  grounded: boolean;
  /** Vertical speed, m/s. */
  vy: number;
  /** Low gravity: slower, bouncier steps. */
  floaty: boolean;
}

export const SUIT_COLORS = ['#ff8a3d', '#39c2f0', '#ff5fa2', '#8f7bff', '#4fd98a', '#ffd166'] as const;

/** The clear helmet bubble: nearly invisible in the middle, sky-coloured at the edge, with two drawn highlights. */
function bubbleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uSky: GLOBALS.skyColor, uAnime: GLOBALS.anime, uTint: { value: new THREE.Color('#dff3ff') } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
        vNormal = normalize( normalMatrix * normal );
        vView = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSky;
      uniform vec3 uTint;
      uniform float uAnime;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec3 n = normalize( vNormal );
        vec3 v = normalize( vView );
        float fresnel = pow( 1.0 - clamp( dot( n, v ), 0.0, 1.0 ), 2.6 );
        // The glass mirrors the sky (high and ultra): ground below, horizon in the middle, zenith above.
        vec3 mirror = reflect( -v, n );
        float up = dot( mirror, normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) );
        vec3 env = mix( uSky * vec3( 0.38, 0.3, 0.27 ), mix( uSky, uSky * vec3( 0.7, 0.82, 1.15 ), smoothstep( 0.0, 0.85, up ) ), smoothstep( -0.25, 0.08, up ) );
        vec3 sky = mix( uSky, env, uAnime );
        // Highlights that stay at the upper left of the glass, the way an animator draws them.
        vec2 a = ( n.xy - vec2( -0.5, 0.56 ) ) * vec2( 1.0, 2.1 );
        vec2 b = ( n.xy - vec2( -0.3, 0.75 ) ) * vec2( 1.0, 1.8 );
        float glint = ( 1.0 - smoothstep( 0.012, 0.02, dot( a, a ) ) ) + ( 1.0 - smoothstep( 0.002, 0.004, dot( b, b ) ) );
        vec3 color = mix( uTint * 0.6, sky * 1.25, fresnel ) + vec3( 1.0, 0.98, 0.94 ) * glint * 1.5;
        // A soft sky-coloured sheen across the whole visor, a little stronger when the Sun is out.
        color += sky * 0.12 * uAnime * ( 1.0 - fresnel );
        float alpha = clamp( 0.035 + fresnel * 0.72 + glint * 0.8 + 0.05 * uAnime, 0.0, 1.0 );
        gl_FragColor = vec4( color, alpha );
      }`,
    transparent: true,
    depthWrite: false,
  });
}

/** Parts that never get a dark outline: glass, lights, the painted face. */
const NO_OUTLINE = new Set(['visor', 'face', 'glow_cyan', 'glow_green', 'glow_warm']);

export class Astronaut {
  readonly group = new THREE.Group();
  /** Where the feet touch the ground, for dust puffs. */
  readonly footstep = { left: false, right: false };

  private readonly torso: THREE.Object3D;
  private readonly head: THREE.Object3D;
  private readonly armL: THREE.Object3D;
  private readonly armR: THREE.Object3D;
  private readonly foreL: THREE.Object3D;
  private readonly foreR: THREE.Object3D;
  private readonly legL: THREE.Object3D;
  private readonly legR: THREE.Object3D;
  private readonly shinL: THREE.Object3D;
  private readonly shinR: THREE.Object3D;
  private readonly torsoY: number;
  private readonly accent: THREE.MeshToonMaterial;
  private readonly face: THREE.MeshToonMaterial;
  private readonly blob: THREE.Mesh;
  private readonly outlines: THREE.Mesh[] = [];
  private readonly ownMaterials: THREE.Material[] = [];
  private phase = 0;
  private blend = 0;
  private squash = 0;
  private squashSpeed = 0;
  private wasGrounded = true;
  private emote: Emote = 'none';
  private emoteTime = 0;
  private time = 0;
  private lastSin = 0;
  private blinkIn = 2.4;
  private blinkFor = 0;
  private faceKind: FaceKind = 'normal';

  constructor(suitColor: string = SUIT_COLORS[0], withOutline = true) {
    // Colours and soft shadows are baked into the model; the suit colour stays changeable.
    const paint = toon({ color: '#ffffff', rim: 0.55, rimWidth: 0.46, bandSoft: 0.03, vertexColors: true, lift: 0.2, glint: 0.28 });
    const skin = toon({ color: '#ffdcc8', rim: 0.18, bandEdge: -0.3, bandSoft: 0.22, vertexColors: true, lift: 0.34 });
    const hair = toon({ color: '#3d315e', rim: 0.6, rimWidth: 0.5, spec: 0.3, vertexColors: true, lift: 0.2 });
    const shaded = toon({ color: '#ffffff', rim: 0.55, vertexColors: true, lift: 0.2, glint: 0.22 });
    this.accent = new THREE.MeshToonMaterial({ color: suitColor, vertexColors: true });
    this.accent.onBeforeCompile = shaded.onBeforeCompile;
    this.accent.customProgramCacheKey = () => 'toon-c';
    const faces = faceTextures();
    const faceBase = toon({ color: '#ffffff', rim: 0, bandEdge: -0.3, bandSoft: 0.22, lift: 0.34 });
    this.face = new THREE.MeshToonMaterial({
      map: faces.normal,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.face.onBeforeCompile = faceBase.onBeforeCompile;
    this.face.customProgramCacheKey = () => 'toon-c';
    const visor = bubbleMaterial();
    const lights: Record<string, THREE.Material> = {
      glow_cyan: glow('#5fe0ff', 2.4),
      glow_green: glow('#9dffc4', 2.4),
      glow_warm: glow('#ffd27a', 2.6),
    };
    this.ownMaterials.push(this.accent, this.face, visor, ...Object.values(lights));

    const figure = model('astronaut', (name, mesh) => {
      if (NO_OUTLINE.has(name)) mesh.userData.noOutline = true;
      switch (name) {
        case 'paint':
          return paint;
        case 'accent':
          return this.accent;
        case 'skin':
          return skin;
        case 'hair':
          return hair;
        case 'face':
          mesh.renderOrder = 4;
          return this.face;
        case 'visor':
          mesh.renderOrder = 5;
          return visor;
        default:
          return lights[name] ?? paint;
      }
    });
    const part = (name: string): THREE.Object3D => {
      const found = figure.getObjectByName(name);
      if (!found) throw new Error(`Astronaut model has no part "${name}"`);
      return found;
    };
    this.torso = part('torso');
    this.head = part('head');
    this.armL = part('armL');
    this.armR = part('armR');
    this.foreL = part('forearmL');
    this.foreR = part('forearmR');
    this.legL = part('legL');
    this.legR = part('legR');
    this.shinL = part('shinL');
    this.shinR = part('shinR');
    this.torsoY = this.torso.position.y;
    this.group.add(figure);

    if (withOutline) {
      const hull = outlineMaterial('#2b2440', 0.8);
      this.ownMaterials.push(hull);
      this.outlines = addOutline(this.group, hull);
    }

    // Soft round shadow under the feet (also works when real shadows are off).
    this.blob = new THREE.Mesh(
      shape.disc(0.62, 20),
      new THREE.MeshBasicMaterial({ color: 0x1a1024, map: dotTexture(), transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.blob.position.y = 0.03;
    this.blob.renderOrder = 3;
    this.blob.userData.noOutline = true;
    this.ownMaterials.push(this.blob.material as THREE.Material);
    this.group.add(this.blob);
  }

  setColor(color: string): void {
    this.accent.color.set(color);
  }

  setOutline(visible: boolean): void {
    for (const hull of this.outlines) hull.visible = visible;
  }

  play(emote: Emote): void {
    this.emote = emote;
    this.emoteTime = 0;
  }

  /** Height above the ground, so the round shadow stays on the ground during a jump. */
  setAltitude(altitude: number): void {
    this.blob.position.y = 0.03 - altitude;
    const fade = Math.max(0.12, 1 - altitude / 4);
    (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.5 * fade;
    this.blob.scale.setScalar(0.7 + 0.3 * fade);
  }

  update(dt: number, motion: Motion): void {
    this.time += dt;
    this.emoteTime += dt;
    const t = this.time;
    this.blend += (motion.speed - this.blend) * Math.min(1, dt * 9);
    const walk = this.blend;
    const cadence = motion.floaty ? 6.2 : 10.5;
    if (walk > 0.03 && motion.grounded) this.phase += dt * cadence * (0.4 + 0.6 * walk);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);

    // Report footfalls for dust puffs.
    this.footstep.left = motion.grounded && walk > 0.2 && this.lastSin < 0.95 && s >= 0.95;
    this.footstep.right = motion.grounded && walk > 0.2 && this.lastSin > -0.95 && s <= -0.95;
    this.lastSin = s;

    // Landing squash and take-off stretch, on a little spring.
    if (motion.grounded && !this.wasGrounded) this.squashSpeed = -3.2;
    this.wasGrounded = motion.grounded;
    this.squashSpeed += (-this.squash * 90 - this.squashSpeed * 11) * dt;
    this.squash += this.squashSpeed * dt;
    const stretch = motion.grounded ? this.squash : Math.max(-0.1, Math.min(0.16, motion.vy * 0.03));
    this.group.scale.set(1 - stretch * 0.5, 1 + stretch, 1 - stretch * 0.5);

    const breathe = Math.sin(t * 2.1) * 0.012;
    let armL = 0;
    let armR = 0;
    let armLz = -0.14;
    let armRz = 0.14;
    let elbowL = 0.16;
    let elbowR = 0.16;
    let foreRz = 0;
    let legL = 0;
    let legR = 0;
    let kneeL = 0;
    let kneeR = 0;
    let lean = 0;
    let lift = breathe;
    let headYaw = Math.sin(t * 0.6) * 0.22 * (1 - walk);
    let headPitch = 0;

    if (motion.grounded) {
      const stride = motion.floaty ? 0.7 : 0.82;
      legL = s * stride * walk;
      legR = -s * stride * walk;
      // The knee bends while its leg swings forward.
      kneeL = Math.max(0, -c) * 1.2 * walk;
      kneeR = Math.max(0, c) * 1.2 * walk;
      armL = -s * 0.72 * walk + Math.sin(t * 1.3) * 0.05;
      armR = s * 0.72 * walk - Math.sin(t * 1.3) * 0.05;
      elbowL = 0.16 + 0.62 * walk + Math.max(0, s) * 0.3 * walk;
      elbowR = 0.16 + 0.62 * walk + Math.max(0, -s) * 0.3 * walk;
      lean = 0.15 * walk;
      lift += Math.abs(c) * (motion.floaty ? 0.11 : 0.06) * walk;
    } else {
      // In the air: knees up, arms out for balance.
      const up = motion.vy > 0 ? 1 : 0.45;
      legL = 0.35 * up;
      legR = -0.75 * up;
      kneeL = 0.75 * up;
      kneeR = 1.25 * up;
      armLz = -1.05;
      armRz = 1.05;
      armL = armR = -0.3;
      elbowL = elbowR = 0.45;
    }

    switch (this.emote) {
      case 'wave':
        armRz = 2.35;
        armR = 0;
        elbowR = 0.35;
        foreRz = Math.sin(this.emoteTime * 9) * 0.45;
        headYaw = 0.15;
        if (this.emoteTime > 2.4) this.emote = 'none';
        break;
      case 'cheer': {
        const bounce = Math.abs(Math.sin(this.emoteTime * 7));
        armLz = -2.5 - bounce * 0.2;
        armRz = 2.5 + bounce * 0.2;
        armL = armR = 0;
        elbowL = elbowR = 0.25;
        lift += bounce * 0.12;
        headPitch = -0.2;
        if (this.emoteTime > 1.6) this.emote = 'none';
        break;
      }
      case 'drill':
        lean = 0.5;
        armL = armR = -0.95;
        elbowL = elbowR = 0.7;
        headPitch = 0.3;
        lift -= 0.05 + Math.sin(this.emoteTime * 40) * 0.008;
        kneeL = kneeR = 0.25;
        break;
      case 'alarm':
        headYaw = Math.sin(this.emoteTime * 6) * 0.5;
        armLz = -0.75;
        armRz = 0.75;
        elbowL = elbowR = 1.5;
        break;
      default:
        break;
    }

    const k = Math.min(1, dt * 14);
    const ease = (object: THREE.Object3D, axis: 'x' | 'y' | 'z', goal: number): void => {
      object.rotation[axis] += (goal - object.rotation[axis]) * k;
    };
    ease(this.armL, 'x', armL);
    ease(this.armR, 'x', armR);
    ease(this.armL, 'z', armLz);
    ease(this.armR, 'z', armRz);
    ease(this.foreL, 'x', -elbowL);
    ease(this.foreR, 'x', -elbowR);
    ease(this.foreR, 'z', foreRz);
    ease(this.legL, 'x', legL);
    ease(this.legR, 'x', legR);
    ease(this.shinL, 'x', kneeL);
    ease(this.shinR, 'x', kneeR);
    ease(this.torso, 'x', lean);
    ease(this.head, 'y', headYaw);
    ease(this.head, 'x', headPitch - lean * 0.6);
    this.torso.position.y += (this.torsoY + lift - this.torso.position.y) * Math.min(1, dt * 20);

    // The face: blink now and then, and react to what is happening.
    this.blinkIn -= dt;
    this.blinkFor -= dt;
    if (this.blinkIn <= 0) {
      this.blinkFor = 0.12;
      this.blinkIn = 2.2 + Math.random() * 3.2;
    }
    const kind: FaceKind =
      this.emote === 'cheer' ? 'happy' : this.emote === 'alarm' ? 'wow' : this.emote === 'drill' ? 'focus' : this.blinkFor > 0 ? 'blink' : !motion.grounded ? 'happy' : 'normal';
    if (kind !== this.faceKind) {
      this.faceKind = kind;
      this.face.map = faceTextures()[kind];
    }
  }

  dispose(): void {
    // The model's geometry is shared between copies and stays loaded; only the round shadow is ours.
    this.blob.geometry.dispose();
    for (const material of this.ownMaterials) material.dispose();
  }
}
