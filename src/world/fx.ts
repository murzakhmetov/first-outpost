/**
 * Particles: drifting dust, dust puffs from boots, and pick-up sparkles.
 */
import * as THREE from 'three';
import type { SiteId } from '../sim/types';
import { mulberry32 } from '../sim/rng';
import { fogUniforms } from './materials';
import { dotTexture, sparkleTexture } from './textures';

/**
 * Dust in the air around the camera. The points live in a box that wraps
 * around the camera, so a few hundred points fill the whole world.
 * Mars only: the Moon has no air to carry dust.
 */
export class DustMotes {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  /** 0 = calm air, 1 = dust storm. */
  storm = 0;

  constructor(count: number, color: THREE.ColorRepresentation) {
    const random = mulberry32(4242);
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = random() * 60;
      positions[i * 3 + 1] = random() * 22;
      positions[i * 3 + 2] = random() * 60;
      seeds[i] = random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...fogUniforms(),
        uTime: { value: 0 },
        uStorm: { value: 0 },
        uCamera: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color(color) },
        uMap: { value: dotTexture() },
        uScale: { value: 600 },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform float uStorm;
        uniform vec3 uCamera;
        uniform float uScale;
        varying float vAlpha;
        #include <common>
        #include <fog_pars_vertex>
        void main() {
          vec3 box = vec3( 60.0, 22.0, 60.0 );
          // Wind blows the dust; a storm makes it race sideways.
          vec3 wind = vec3( 0.9 + 9.0 * uStorm, 0.12 * sin( uTime * 0.6 + aSeed * 40.0 ), 0.35 + 3.0 * uStorm );
          vec3 p = position + wind * uTime * ( 0.6 + aSeed );
          p = mod( p - uCamera + box * 0.5, box ) - box * 0.5 + uCamera;
          p.y = max( p.y, uCamera.y - 9.0 );
          vec4 mvPosition = modelViewMatrix * vec4( p, 1.0 );
          gl_Position = projectionMatrix * mvPosition;
          float size = mix( 0.06, 0.2, aSeed ) * ( 1.0 + 2.5 * uStorm );
          gl_PointSize = size * uScale / max( 1.0, -mvPosition.z );
          float shown = step( aSeed, 0.3 + 0.7 * uStorm );
          vAlpha = shown * ( 0.2 + 0.4 * uStorm ) * smoothstep( 1.0, 4.0, -mvPosition.z );
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform sampler2D uMap;
        varying float vAlpha;
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          float a = texture2D( uMap, gl_PointCoord ).a * vAlpha;
          if ( a < 0.01 ) discard;
          gl_FragColor = vec4( uColor, a );
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }

  update(time: number, camera: THREE.Camera, viewportHeight: number): void {
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uStorm.value = this.storm;
    u.uCamera.value.copy(camera.position);
    u.uScale.value = viewportHeight * 0.9;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

interface Puff {
  sprite: THREE.Sprite;
  life: number;
  duration: number;
  velocity: THREE.Vector3;
  grow: number;
  gravity: number;
  startScale: number;
}

/**
 * A pool of little sprites for boot dust, sparkles and bursts.
 * On Mars dust hangs and drifts. On the Moon there is no air: grains fly in
 * clean arcs and fall straight back.
 */
export class Puffs {
  readonly group = new THREE.Group();
  private readonly pool: Puff[] = [];
  private readonly dustMaterial: THREE.SpriteMaterial[] = [];
  private readonly sparkMaterial: THREE.SpriteMaterial[] = [];
  private cursor = 0;
  private readonly site: SiteId;
  private readonly dustColor: THREE.Color;

  constructor(site: SiteId, size = 40) {
    this.site = site;
    this.dustColor = new THREE.Color(site === 'mars' ? '#d99a6a' : '#c9ccd3');
    for (let i = 0; i < size; i++) {
      const material = new THREE.SpriteMaterial({ map: dotTexture(), transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.renderOrder = 15;
      this.group.add(sprite);
      this.pool.push({ sprite, life: 0, duration: 1, velocity: new THREE.Vector3(), grow: 0, gravity: 0, startScale: 0.3 });
      this.dustMaterial.push(material);
    }
  }

  private take(): Puff {
    const puff = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    return puff;
  }

  /** Dust kicked up by a boot. */
  step(position: THREE.Vector3): void {
    const moon = this.site === 'moon';
    const count = moon ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const puff = this.take();
      const material = puff.sprite.material;
      material.map = dotTexture();
      material.color.copy(this.dustColor);
      material.blending = THREE.NormalBlending;
      puff.sprite.position.set(position.x + (Math.random() - 0.5) * 0.3, position.y + 0.1, position.z + (Math.random() - 0.5) * 0.3);
      puff.duration = moon ? 0.9 : 0.8;
      puff.life = puff.duration;
      puff.startScale = moon ? 0.12 : 0.35;
      puff.grow = moon ? 0 : 1.3;
      puff.gravity = moon ? 1.62 : -0.15;
      puff.velocity.set((Math.random() - 0.5) * (moon ? 1.6 : 0.5), moon ? 1.0 + Math.random() * 0.8 : 0.25, (Math.random() - 0.5) * (moon ? 1.6 : 0.5));
      puff.sprite.visible = true;
    }
  }

  /** A ring of sparkles when something is collected. */
  burst(position: THREE.Vector3, color: THREE.ColorRepresentation, count = 12): void {
    for (let i = 0; i < count; i++) {
      const puff = this.take();
      const material = puff.sprite.material;
      material.map = sparkleTexture();
      material.color.set(color).multiplyScalar(2.2);
      material.blending = THREE.AdditiveBlending;
      const angle = (i / count) * Math.PI * 2;
      puff.sprite.position.copy(position);
      puff.duration = 0.75 + Math.random() * 0.3;
      puff.life = puff.duration;
      puff.startScale = 0.5;
      puff.grow = -0.4;
      puff.gravity = 1.5;
      puff.velocity.set(Math.cos(angle) * 2.6, 2.4 + Math.random() * 1.6, Math.sin(angle) * 2.6);
      puff.sprite.visible = true;
    }
  }

  update(dt: number): void {
    for (const puff of this.pool) {
      if (puff.life <= 0) continue;
      puff.life -= dt;
      if (puff.life <= 0) {
        puff.sprite.visible = false;
        continue;
      }
      const t = 1 - puff.life / puff.duration;
      puff.velocity.y -= puff.gravity * dt;
      puff.sprite.position.addScaledVector(puff.velocity, dt);
      const size = Math.max(0.02, puff.startScale + puff.grow * t);
      puff.sprite.scale.setScalar(size);
      puff.sprite.material.opacity = (1 - t) * (puff.sprite.material.blending === THREE.AdditiveBlending ? 1 : 0.5);
    }
  }

  dispose(): void {
    for (const material of this.dustMaterial) material.dispose();
    for (const material of this.sparkMaterial) material.dispose();
  }
}

/**
 * Boot prints left on the ground. The newest ones replace the oldest, so the
 * trail has a fixed length and costs one draw call.
 */
export class Tracks {
  readonly mesh: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private next = 0;
  private used = 0;

  constructor(site: SiteId, private readonly size = 260) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    // The sole of a boot: a rounded shape with a drawn edge and tread bars across it.
    const sole = (): void => {
      ctx.beginPath();
      ctx.moveTo(32, 6);
      ctx.bezierCurveTo(52, 6, 56, 40, 50, 66); // outer side of the forefoot
      ctx.bezierCurveTo(47, 82, 50, 96, 49, 104); // waist, then the heel
      ctx.bezierCurveTo(48, 118, 40, 122, 32, 122);
      ctx.bezierCurveTo(24, 122, 16, 118, 15, 104);
      ctx.bezierCurveTo(14, 96, 17, 82, 14, 66);
      ctx.bezierCurveTo(8, 40, 12, 6, 32, 6);
      ctx.closePath();
    };
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    sole();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 3.5;
    sole();
    ctx.stroke();
    ctx.save();
    sole();
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    for (let y = 15; y < 118; y += 13) ctx.fillRect(12, y, 40, 6);
    ctx.restore();
    const texture = new THREE.CanvasTexture(canvas);
    // Prints are seen at a low angle from behind the walker: without this they blur away.
    texture.anisotropy = 8;
    // Dark only: a print pressed into the dust stays right in any light, day or night.
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: site === 'moon' ? '#1a1c24' : '#3b1508',
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const geometry = new THREE.PlaneGeometry(0.23, 0.44);
    geometry.rotateX(-Math.PI / 2); // flat on the ground, toe toward +Z after the turn below
    geometry.rotateY(Math.PI);
    this.mesh = new THREE.InstancedMesh(geometry, material, size);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.userData.noOutline = true;
  }

  /** Leave one print. `heading` is the way the walker faces (radians, 0 = +Z). */
  add(x: number, y: number, z: number, heading: number, left: boolean): void {
    const side = left ? 0.13 : -0.13; // facing +Z, the left foot is on the +X side
    this.position.set(x + Math.cos(heading) * side, y + 0.035, z - Math.sin(heading) * side);
    this.quaternion.setFromAxisAngle(this.up, heading);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.mesh.setMatrixAt(this.next, this.matrix);
    this.next = (this.next + 1) % this.size;
    this.used = Math.min(this.size, this.used + 1);
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const material = this.mesh.material as THREE.MeshBasicMaterial;
    material.map?.dispose();
    material.dispose();
  }
}
