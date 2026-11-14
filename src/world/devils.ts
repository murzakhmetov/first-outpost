/**
 * Dust devils on Mars: spinning columns of wind and dust that wander across the
 * plain by day. Each is a see-through funnel with dust bands drawn by a shader
 * that climb and turn, plus a low skirt of dust where it touches the ground.
 */
import * as THREE from 'three';
import { GLOBALS, fogUniforms } from './materials';

interface Devil {
  group: THREE.Group;
  uniforms: { uAlpha: { value: number }; uSeed: { value: number } };
  x: number;
  z: number;
  /** Direction of travel (radians) and speed (m/s). */
  heading: number;
  speed: number;
  /** How the path bends, radians per second. */
  turn: number;
  age: number;
  life: number;
  size: number;
}

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewPosition;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec3 p = position;
    // The column leans and sways: the higher, the further it drifts.
    float h = uv.y;
    p.x += sin(uTime * 0.6 + uSeed * 6.0 + h * 2.4) * h * h * 6.0;
    p.z += cos(uTime * 0.45 + uSeed * 4.0 + h * 1.7) * h * h * 4.0;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    vViewPosition = -mvPosition.xyz;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uAlpha;
  uniform float uNight;
  uniform vec3 uColor;
  uniform vec3 uShade;
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewPosition;
  #include <common>
  #include <fog_pars_fragment>
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    float u = vUv.x;
    float v = vUv.y;
    float t = uTime + uSeed * 10.0;
    // Dust bands winding upwards around the column (u wraps, so the noise wraps too).
    float bands = noise(vec2(u * 8.0 + v * 5.0 - t * 1.4, v * 4.0 - t * 0.8));
    float grit = noise(vec2(u * 20.0 - t * 2.6, v * 12.0 + t * 0.4));
    float swirl = bands * 0.7 + grit * 0.3;
    // Denser through the middle of the column than at its edges.
    float facing = abs(dot(normalize(vNormalView), normalize(vViewPosition)));
    float body = smoothstep(0.04, 0.6, facing);
    // Thick at the ground, thinning out towards the top.
    float ends = smoothstep(0.0, 0.05, v) * (1.0 - smoothstep(0.35, 1.0, v));
    float alpha = body * ends * (0.25 + 0.75 * swirl) * uAlpha * (1.0 - uNight);
    vec3 color = mix(uShade, uColor, 0.45 + 0.55 * swirl);
    gl_FragColor = vec4(color, alpha * 0.8);
    #include <fog_fragment>
  }
`;

export class DustDevils {
  readonly group = new THREE.Group();
  private readonly devils: Devil[] = [];
  private readonly column: THREE.BufferGeometry;
  private readonly skirt: THREE.BufferGeometry;
  private readonly time = { value: 0 };
  private readonly color = { value: new THREE.Color('#e3b088') };
  private readonly shade = { value: new THREE.Color('#9a5a3e') };
  private readonly materials: THREE.ShaderMaterial[] = [];
  private wait = 3;
  private seed = 1;

  constructor(
    private readonly height: (x: number, z: number) => number,
    private readonly max: number,
  ) {
    this.group.name = 'dust-devils';
    // A funnel, narrow at the ground and wide at the top, open at both ends.
    this.column = new THREE.CylinderGeometry(1, 0.24, 1, 28, 18, true);
    this.column.translate(0, 0.5, 0);
    // A low cone of dust where the whirl meets the ground.
    this.skirt = new THREE.CylinderGeometry(0.22, 1, 1, 28, 4, true);
    this.skirt.translate(0, 0.5, 0);
  }

  private random(): number {
    // Small repeatable generator: each scene gets the same sequence of whirls.
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  private material(seed: number): { material: THREE.ShaderMaterial; uniforms: Devil['uniforms'] } {
    const uniforms = { uAlpha: { value: 0 }, uSeed: { value: seed } };
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...fogUniforms(),
        uTime: this.time,
        uNight: GLOBALS.night,
        uColor: this.color,
        uShade: this.shade,
        ...uniforms,
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.materials.push(material);
    return { material, uniforms };
  }

  /**
   * Start a dust devil. Without a place, it starts somewhere out on the plain.
   * With one, it starts there and heads for `toward` (used when a whirl crosses the solar field).
   */
  spawn(at?: { x: number; z: number }, toward?: { x: number; z: number }, life?: number): void {
    if (this.devils.length >= Math.max(1, this.max) && !at) return;
    let x: number;
    let z: number;
    if (at) {
      x = at.x;
      z = at.z;
    } else {
      const angle = this.random() * Math.PI * 2;
      const distance = 140 + this.random() * 190;
      x = Math.cos(angle) * distance;
      z = Math.sin(angle) * distance;
    }
    const heading = toward ? Math.atan2(toward.x - x, toward.z - z) : this.random() * Math.PI * 2;
    const size = at ? 0.55 : 0.7 + this.random() * 0.6;
    const seed = this.random();
    const { material, uniforms } = this.material(seed);
    const group = new THREE.Group();
    const column = new THREE.Mesh(this.column, material);
    column.scale.set(11 * size, 62 * size, 11 * size);
    const skirt = new THREE.Mesh(this.skirt, material);
    skirt.scale.set(7 * size, 6 * size, 7 * size);
    column.renderOrder = skirt.renderOrder = 4;
    column.frustumCulled = skirt.frustumCulled = false;
    group.add(column, skirt);
    group.userData.noOutline = true;
    this.group.add(group);
    this.devils.push({
      group,
      uniforms,
      x,
      z,
      heading,
      speed: at ? 4.5 : 2 + this.random() * 2.5,
      turn: at ? 0 : (this.random() - 0.5) * 0.06,
      age: 0,
      life: life ?? 70 + this.random() * 50,
      size,
    });
  }

  /** The nearest dust devil to a point, if any is in full swing. */
  nearest(x: number, z: number): { x: number; z: number; distance: number } | null {
    let best: { x: number; z: number; distance: number } | null = null;
    for (const devil of this.devils) {
      if (devil.uniforms.uAlpha.value < 0.6) continue;
      const distance = Math.hypot(devil.x - x, devil.z - z);
      if (!best || distance < best.distance) best = { x: devil.x, z: devil.z, distance };
    }
    return best;
  }

  /** `calm` is false at night and in dust storms: no new whirls start then. */
  update(dt: number, time: number, calm: boolean): void {
    this.time.value = time;
    if (calm && this.max > 0) {
      this.wait -= dt;
      if (this.wait <= 0) {
        this.spawn();
        this.wait = 20 + this.random() * 35;
      }
    }
    for (let i = this.devils.length - 1; i >= 0; i--) {
      const devil = this.devils[i];
      devil.age += dt;
      devil.heading += devil.turn * dt;
      devil.x += Math.sin(devil.heading) * devil.speed * dt;
      devil.z += Math.cos(devil.heading) * devil.speed * dt;
      // Fade in, live, fade out.
      const fadeIn = Math.min(1, devil.age / 6);
      const fadeOut = Math.min(1, (devil.life - devil.age) / 8);
      devil.uniforms.uAlpha.value = Math.max(0, Math.min(fadeIn, fadeOut));
      devil.group.position.set(devil.x, this.height(devil.x, devil.z) - 0.6, devil.z);
      devil.group.rotation.y = time * 1.3 + devil.uniforms.uSeed.value * 6;
      if (devil.age >= devil.life) {
        this.group.remove(devil.group);
        const material = (devil.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
        material.dispose();
        this.materials.splice(this.materials.indexOf(material), 1);
        this.devils.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.column.dispose();
    this.skirt.dispose();
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    this.devils.length = 0;
    this.group.clear();
  }
}
