/**
 * Sun, sky light, fog and colour mood for both worlds.
 *
 * Mars: a butterscotch day sky, a BLUE glow around the setting Sun (real: fine
 * dust scatters blue light forward), and cold starry nights.
 * Moon: a black sky, a hard white Sun skimming the horizon, soft blue earthshine.
 */
import * as THREE from 'three';
import type { SiteId } from '../sim/types';
import { flag } from './devflags';
import { GLOBALS } from './materials';
import type { PostFX } from './post';
import { Sky } from './sky';
import type { SkyColors } from './sky';

interface StopSpec {
  /** Height of the Sun above the horizon as sin(elevation). */
  y: number;
  zenith: string;
  horizon: string;
  ground: string;
  sun: string;
  sunPower: number;
  glow: string;
  glowAmount: number;
  halo: string;
  haloAmount: number;
  stars: number;
  clouds: number;
  cloud: string;
  light: string;
  lightPower: number;
  hemiSky: string;
  hemiGround: string;
  hemiPower: number;
  fog: string;
  rim: string;
  night: number;
  exposure: number;
  mountain: string;
}

type Stop = Omit<StopSpec, 'zenith' | 'horizon' | 'ground' | 'sun' | 'glow' | 'halo' | 'cloud' | 'light' | 'hemiSky' | 'hemiGround' | 'fog' | 'rim' | 'mountain'> & {
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  sun: THREE.Color;
  glow: THREE.Color;
  halo: THREE.Color;
  cloud: THREE.Color;
  light: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  fog: THREE.Color;
  rim: THREE.Color;
  mountain: THREE.Color;
};

const MARS_STOPS: StopSpec[] = [
  {
    y: -0.3,
    zenith: '#060918', horizon: '#12162b', ground: '#0a0a12',
    sun: '#000000', sunPower: 0,
    glow: '#3b62c4', glowAmount: 0, halo: '#2b4a9a', haloAmount: 0,
    stars: 1, clouds: 0.1, cloud: '#1c2238',
    light: '#7f97dd', lightPower: 0.55,
    hemiSky: '#2c3a6e', hemiGround: '#1c1626', hemiPower: 1.15,
    fog: '#0e1122', rim: '#8ea8ff', night: 1, exposure: 1.2, mountain: '#1c2240',
  },
  {
    y: -0.06,
    zenith: '#161a3a', horizon: '#3d3458', ground: '#15121e',
    sun: '#000000', sunPower: 0,
    glow: '#5f9bff', glowAmount: 0.6, halo: '#4f86ee', haloAmount: 0.9,
    stars: 0.7, clouds: 0.2, cloud: '#3a3a5c',
    light: '#8fa6e6', lightPower: 0.5,
    hemiSky: '#4b4e86', hemiGround: '#2a2030', hemiPower: 1.15,
    fog: '#2a2946', rim: '#9db6ff', night: 0.9, exposure: 1.15, mountain: '#3a3760',
  },
  {
    y: 0.05,
    zenith: '#4d4a70', horizon: '#c88f74', ground: '#4a2c26',
    sun: '#cfe4ff', sunPower: 7,
    glow: '#8fc0ff', glowAmount: 2.4, halo: '#5e97f5', haloAmount: 1.1,
    stars: 0.18, clouds: 0.7, cloud: '#e0a898',
    light: '#e6ecff', lightPower: 1.55,
    hemiSky: '#8f88c8', hemiGround: '#7a4636', hemiPower: 1.2,
    fog: '#b78c80', rim: '#d6e4ff', night: 0.45, exposure: 1.06, mountain: '#b7848c',
  },
  {
    y: 0.2,
    zenith: '#8c6d78', horizon: '#ecbd8e', ground: '#6b3d2a',
    sun: '#fff0d8', sunPower: 9,
    glow: '#ffe6c0', glowAmount: 1.3, halo: '#f6c89a', haloAmount: 0.4,
    stars: 0, clouds: 0.8, cloud: '#f8dcc4',
    light: '#ffe4c0', lightPower: 2.55,
    hemiSky: '#b7a3d6', hemiGround: '#a05c3c', hemiPower: 1.22,
    fog: '#dfb38a', rim: '#fff0d2', night: 0, exposure: 1, mountain: '#f1d2bc',
  },
  {
    y: 0.55,
    zenith: '#b98a7c', horizon: '#f6dcb4', ground: '#7a4630',
    sun: '#fff6e6', sunPower: 10,
    glow: '#fff0d8', glowAmount: 1, halo: '#f8dcb4', haloAmount: 0.25,
    stars: 0, clouds: 0.8, cloud: '#fbe9d8',
    light: '#fff2dc', lightPower: 2.9,
    hemiSky: '#c6b2e0', hemiGround: '#b0683f', hemiPower: 1.2,
    fog: '#e8c59c', rim: '#fff4de', night: 0, exposure: 1, mountain: '#ffffff',
  },
];

const MOON_STOPS: StopSpec[] = [
  {
    // The Sun is hidden behind a mountain: only earthshine and lamps.
    y: -0.2,
    zenith: '#000003', horizon: '#02030a', ground: '#010103',
    sun: '#000000', sunPower: 0,
    glow: '#ffffff', glowAmount: 0, halo: '#9fb4ff', haloAmount: 0.5,
    stars: 1, clouds: 0, cloud: '#000000',
    light: '#8fb0e8', lightPower: 0.42,
    hemiSky: '#27365c', hemiGround: '#20222c', hemiPower: 0.95,
    fog: '#000000', rim: '#a9c4ff', night: 1, exposure: 1.25, mountain: '#20263a',
  },
  {
    y: 0.02,
    zenith: '#000004', horizon: '#04050c', ground: '#020204',
    sun: '#ffffff', sunPower: 9,
    glow: '#ffffff', glowAmount: 1.2, halo: '#b9c8ff', haloAmount: 0.3,
    stars: 0.9, clouds: 0, cloud: '#000000',
    light: '#fff8ee', lightPower: 2.2,
    hemiSky: '#2c3550', hemiGround: '#6f727c', hemiPower: 0.75,
    fog: '#000000', rim: '#ffffff', night: 0.5, exposure: 1.08, mountain: '#8f93a0',
  },
  {
    y: 0.12,
    zenith: '#000004', horizon: '#04050c', ground: '#020204',
    sun: '#ffffff', sunPower: 12,
    glow: '#ffffff', glowAmount: 1.5, halo: '#b9c8ff', haloAmount: 0.14,
    stars: 0.85, clouds: 0, cloud: '#000000',
    light: '#fffaf0', lightPower: 3.3,
    hemiSky: '#303a58', hemiGround: '#8a8c94', hemiPower: 0.7,
    fog: '#000000', rim: '#ffffff', night: 0.3, exposure: 1, mountain: '#ffffff',
  },
];

function prepare(specs: StopSpec[]): Stop[] {
  const c = (hex: string) => new THREE.Color(hex);
  return specs.map((s) => ({
    ...s,
    zenith: c(s.zenith),
    horizon: c(s.horizon),
    ground: c(s.ground),
    sun: c(s.sun),
    glow: c(s.glow),
    halo: c(s.halo),
    cloud: c(s.cloud),
    light: c(s.light),
    hemiSky: c(s.hemiSky),
    hemiGround: c(s.hemiGround),
    fog: c(s.fog),
    rim: c(s.rim),
    mountain: c(s.mountain),
  }));
}

const COLOR_KEYS = ['zenith', 'horizon', 'ground', 'sun', 'glow', 'halo', 'cloud', 'light', 'hemiSky', 'hemiGround', 'fog', 'rim', 'mountain'] as const;
const NUMBER_KEYS = ['sunPower', 'glowAmount', 'haloAmount', 'stars', 'clouds', 'lightPower', 'hemiPower', 'night', 'exposure'] as const;

/** Where the cool fill light stands (Mars), relative to the view centre. */
const FILL_OFFSET = new THREE.Vector3(-40, 80, -30);

const WARM_SHADE = new THREE.Color(1.05, 0.97, 0.9);

export class Daylight {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  /** Second, weak light: earthshine on the Moon, starlight at night on Mars. */
  readonly fill = new THREE.DirectionalLight(0x88aaff, 0);
  /** Direction from the ground to the Sun. */
  readonly sunDir = new THREE.Vector3(0.4, 0.6, 0.5).normalize();
  /** Dust storm strength, 0-1 (Mars). */
  dust = 0;
  /** Radiation storm strength, 0-1: aurora on Mars, specks on the picture. */
  storm = 0;
  /** 0 = day, 1 = night. Read by lamps. */
  night = 0;

  private readonly stops: Stop[];
  private readonly current: Stop;
  private readonly sky: Sky;
  private readonly post: PostFX;
  private readonly scene: THREE.Scene;
  private readonly site: SiteId;
  private readonly fog: THREE.FogExp2 | null;
  private readonly mountainMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly shadowFocus = new THREE.Vector3(1e9, 0, 0);
  private readonly skyColors: SkyColors;
  private readonly tmp = new THREE.Vector3();
  private readonly dustFog = new THREE.Color('#8a5636');
  private readonly dustLight = new THREE.Color('#ffb070');
  private shadowRange = 46;
  private baseRange = 46;
  private shadowSize = 0;
  private shadowWide = false;
  private shadowRadius = 1;
  /** Range step in use while the wide box is on (0 = base range). */
  private rangeStep = 0;
  private wideActive = false;
  private readonly lightX = new THREE.Vector3();
  private readonly lightY = new THREE.Vector3();

  constructor(scene: THREE.Scene, sky: Sky, post: PostFX, site: SiteId, mountains: THREE.Object3D) {
    this.scene = scene;
    this.sky = sky;
    this.post = post;
    this.site = site;
    this.stops = prepare(site === 'mars' ? MARS_STOPS : MOON_STOPS);
    this.current = { ...this.stops[this.stops.length - 1] };
    for (const key of COLOR_KEYS) this.current[key] = this.current[key].clone();
    this.skyColors = {
      zenith: this.current.zenith,
      horizon: this.current.horizon,
      ground: this.current.ground,
      sunColor: new THREE.Color(),
      glowColor: this.current.glow,
      glow: 1,
      haloColor: this.current.halo,
      halo: 0,
      stars: 0,
      clouds: 0,
      cloudColor: this.current.cloud,
    };

    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target, this.hemi, this.fill, this.fill.target);

    this.fog = site === 'mars' ? new THREE.FogExp2(0xe8c59c, 0.0013) : null;
    scene.fog = this.fog;

    // The colour mood of each world (drawn on high and ultra): Mars is warm gold with violet shadows,
    // the Moon is cool silver with deep blue shadows.
    const look = post.look;
    if (site === 'mars') {
      look.high.set(1.07, 1.0, 0.9);
      look.shadow.set(0.93, 0.92, 1.09);
      look.amount = 0.85;
      look.glow = 0.3;
    } else {
      look.high.set(0.97, 1.0, 1.06);
      look.shadow.set(0.84, 0.92, 1.14);
      look.amount = 0.9;
      look.glow = 0.22;
    }

    mountains.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) this.mountainMaterials.push(mesh.material as THREE.MeshBasicMaterial);
    });
  }

  configureShadows(size: number, enabled: boolean, wide = false, radius = 1): void {
    this.sun.castShadow = enabled;
    this.shadowWide = wide;
    this.shadowRadius = radius;
    this.shadowSize = size;
    this.rangeStep = 0;
    this.wideActive = false;
    this.sun.shadow.radius = 1;
    this.sun.shadow.normalBias = 0.05;
    if (!enabled) return;
    // A low Sun throws long shadows, so the Moon needs a wider shadow area.
    this.baseRange = this.site === 'moon' ? 62 : 46;
    this.setShadowRange(this.baseRange);
    const camera = this.sun.shadow.camera;
    camera.near = 1;
    camera.far = 420;
    camera.updateProjectionMatrix();
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.shadowFocus.set(1e9, 0, 0);
  }

  private setShadowRange(range: number): void {
    this.shadowRange = range;
    const camera = this.sun.shadow.camera;
    camera.left = -range;
    camera.right = range;
    camera.top = range;
    camera.bottom = -range;
    camera.updateProjectionMatrix();
  }

  /**
   * High and ultra: the shadow box grows in three steps with the camera distance (with a margin
   * so it does not flip back and forth), and its centre sits on whole shadow texels in light space.
   * Returns the centre of the box.
   */
  private wideShadowAnchor(camera: THREE.Camera, focus: THREE.Vector3, lightDir: THREE.Vector3): THREE.Vector3 {
    const distance = camera.position.distanceTo(focus);
    let next = this.rangeStep;
    while (next < 2 && distance > [40, 90][next]) next++;
    while (next > 0 && distance < [36, 84][next - 1]) next--;
    if (next !== this.rangeStep || !this.wideActive) {
      this.rangeStep = next;
      this.wideActive = true;
      this.setShadowRange(Math.max(this.baseRange, [0, 80, 110][next]));
      // Larger texels at the wide steps: lift the surface offset in step with them.
      this.sun.shadow.normalBias = 0.05 * Math.sqrt(Math.max(1, this.shadowRange / this.baseRange));
      // Keep the blur about the same size in the world: texels get larger as the box widens.
      this.sun.shadow.radius = Math.max(1, this.shadowRadius * Math.sqrt(this.baseRange / this.shadowRange));
    }
    // The light camera looks along -lightDir with world up: its right and up axes.
    const x = this.lightX.set(0, 1, 0).cross(lightDir).normalize();
    const y = this.lightY.copy(lightDir).cross(x).normalize();
    const texel = (2 * this.shadowRange) / this.shadowSize;
    const snapX = Math.round(focus.dot(x) / texel) * texel;
    const snapY = Math.round(focus.dot(y) / texel) * texel;
    return this.shadowFocus
      .copy(focus)
      .addScaledVector(x, snapX - focus.dot(x))
      .addScaledVector(y, snapY - focus.dot(y));
  }

  /** Back to the fixed box and the old edge filter (the wide box is off in the dev A/B or on a weaker tier). */
  private resetShadowBox(): void {
    this.wideActive = false;
    this.rangeStep = 0;
    this.setShadowRange(this.baseRange);
    this.sun.shadow.radius = 1;
    this.sun.shadow.normalBias = 0.05;
    this.shadowFocus.set(1e9, 0, 0);
  }

  /**
   * Mars: place the Sun for a moment of the day.
   * 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.
   */
  setDayFraction(fraction: number): void {
    const hourAngle = (fraction - 0.5) * Math.PI * 2;
    this.sunDir.set(-Math.sin(hourAngle), Math.cos(hourAngle) * 0.86 + 0.02, 0.38 * Math.cos(hourAngle) + 0.28).normalize();
  }

  /**
   * Moon (south pole): the Sun circles the horizon once a month.
   * `azimuth` in radians; `hidden` 0-1 lowers it behind the mountains.
   */
  setPolarSun(azimuth: number, hidden: number): void {
    const elevation = THREE.MathUtils.lerp(0.105, -0.14, hidden); // about 6 degrees up, or just below
    const flat = Math.sqrt(1 - elevation * elevation);
    this.sunDir.set(Math.cos(azimuth) * flat, elevation, Math.sin(azimuth) * flat);
  }

  /** Bounce light colours (G3): sky above, sunlit ground below, horizon at the sides, and the shadow mood. */
  private setBounce(cur: Stop, up: boolean): void {
    const sunUp = up ? THREE.MathUtils.clamp(this.sunDir.y * 2.5, 0, 1) : 0;
    const power = cur.hemiPower * (1 - 0.35 * this.dust);
    GLOBALS.bounce.value = flag('G3') ? 1 : 0;
    GLOBALS.ambSky.value.copy(cur.hemiSky).multiplyScalar(power);
    // Ground: lit by the Sun, so it brightens with a high Sun and takes the light's colour.
    GLOBALS.ambGround.value
      .copy(cur.hemiGround)
      .multiplyScalar(power * (1 + 0.8 * sunUp * Math.min(cur.lightPower, 3) / 3));
    GLOBALS.ambSide.value.copy(cur.horizon).multiplyScalar(power * 0.6);
    // Mars: the shade side is lit from the warm sand, so the violet of the world look is pulled most of the way to a warm rose.
    GLOBALS.shadowTint.value.copy(this.post.look.shadow);
    if (this.site === 'mars') GLOBALS.shadowTint.value.lerp(WARM_SHADE, 0.8);
  }

  private sample(y: number): void {
    const stops = this.stops;
    let a = stops[0];
    let b = stops[stops.length - 1];
    if (y <= stops[0].y) b = a;
    else if (y >= b.y) a = b;
    else {
      for (let i = 0; i < stops.length - 1; i++) {
        if (y >= stops[i].y && y <= stops[i + 1].y) {
          a = stops[i];
          b = stops[i + 1];
          break;
        }
      }
    }
    const t = a === b ? 0 : (y - a.y) / (b.y - a.y);
    const eased = t * t * (3 - 2 * t);
    for (const key of COLOR_KEYS) this.current[key].copy(a[key]).lerp(b[key], eased);
    for (const key of NUMBER_KEYS) this.current[key] = a[key] + (b[key] - a[key]) * eased;
  }

  update(camera: THREE.Camera, time: number, focus: THREE.Vector3): void {
    const c = this.current;
    this.sample(this.sunDir.y);
    const dust = this.dust;
    this.night = c.night;

    // Sun light. Below the horizon it becomes a weak light from above (stars, lamps).
    const up = this.sunDir.y > 0.01;
    const lightDir = this.tmp;
    if (up) lightDir.copy(this.sunDir);
    else lightDir.set(0.25, 0.9, 0.35).normalize();
    this.sun.color.copy(c.light).lerp(this.dustLight, dust * 0.7);
    this.sun.intensity = c.lightPower * (1 - 0.78 * dust);

    // Keep the shadow area around the player; move it in steps to avoid shimmer.
    const wide = this.sun.castShadow && this.shadowWide && flag('G1');
    if (!wide && this.wideActive) this.resetShadowBox();
    if (wide) this.wideShadowAnchor(camera, focus, lightDir);
    else if (this.sun.castShadow && this.shadowFocus.distanceToSquared(focus) > 36) {
      this.shadowFocus.copy(focus);
    }
    const anchor = this.sun.castShadow ? this.shadowFocus : focus;
    this.sun.position.copy(anchor).addScaledVector(lightDir, 190);
    this.sun.target.position.copy(anchor);
    this.sun.target.updateMatrixWorld();

    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    this.hemi.intensity = c.hemiPower * (1 - 0.35 * dust);

    if (this.site === 'moon') {
      this.fill.color.set('#7ea2dc');
      this.fill.intensity = 0.32 + 0.3 * c.night;
      this.fill.position.copy(focus).addScaledVector(Sky.EARTH_DIR, 100);
    } else {
      this.fill.color.set('#6f86c9');
      this.fill.intensity = 0.3 * c.night;
      this.fill.position.copy(focus).add(FILL_OFFSET);
    }
    this.fill.target.position.copy(focus);
    this.fill.target.updateMatrixWorld();

    if (this.fog) {
      this.fog.color.copy(c.fog).lerp(this.dustFog, dust * 0.9);
      this.fog.density = 0.0013 * (1 + 9 * dust);
    }

    // Sky.
    this.skyColors.sunColor.copy(c.sun).multiplyScalar(c.sunPower);
    this.skyColors.glow = c.glowAmount;
    this.skyColors.halo = c.haloAmount;
    this.skyColors.stars = c.stars * (1 - dust);
    this.skyColors.clouds = c.clouds * (1 - dust);
    this.sky.apply(this.skyColors);
    this.sky.dust = dust;
    this.sky.aurora = this.site === 'mars' ? this.storm * (0.35 + 0.65 * c.night) : 0;
    this.sky.starSpin = time * 0.004;
    this.sky.setFancy(this.post.options.skyFancy);
    this.sky.lessMotion = this.post.lessMotion;
    this.sky.update(camera, time, this.sunDir);

    for (const material of this.mountainMaterials) {
      material.color.copy(c.mountain).lerp(this.dustFog, dust * 0.85);
    }

    // Shared material values.
    GLOBALS.time.value = time;
    GLOBALS.night.value = c.night;
    GLOBALS.anime.value = this.post.options.grade ? 1 : 0;
    GLOBALS.rimColor.value.copy(c.rim).multiplyScalar(up ? 1 : 0.55);
    GLOBALS.skyColor.value.copy(c.horizon).lerp(c.zenith, 0.35);
    if (this.site === 'moon') GLOBALS.skyColor.value.set(0.16, 0.2, 0.32);
    GLOBALS.sunDirView.value.copy(lightDir).transformDirection(camera.matrixWorldInverse);
    this.setBounce(c, up);

    // Outdoors the picture always starts from the same grade: a room's own grade must not leak out of the door.
    const grade = this.post.grade;
    grade.exposure = c.exposure * (1 - 0.12 * dust);
    grade.saturation = this.site === 'moon' && this.post.options.grade ? 1.04 : 1.16;
    grade.contrast = 1.07;
    grade.tint.setRGB(1, 1, 1);
    grade.bloom = 0.55;
    grade.vignette = 0.35;
    this.post.specks = this.storm;

    // Light shafts: Mars only (the Moon has no air to catch the light). They are strongest when the Sun is low and in dust.
    const shafts = this.post.sun;
    shafts.dir.copy(this.sunDir);
    if (this.site === 'mars') {
      const risen = THREE.MathUtils.smoothstep(this.sunDir.y, -0.03, 0.08);
      const low = 1 - THREE.MathUtils.smoothstep(this.sunDir.y, 0.1, 0.5);
      shafts.shafts = risen * Math.min(1.25, 0.28 + 0.55 * low + 1.1 * dust);
      shafts.color.copy(c.glow).lerp(this.dustLight, dust * 0.6).multiplyScalar(0.65);
    } else {
      shafts.shafts = 0;
    }
  }

  dispose(): void {
    this.scene.remove(this.sun, this.sun.target, this.hemi, this.fill, this.fill.target);
    this.sun.shadow.map?.dispose();
    this.scene.fog = null;
  }
}
