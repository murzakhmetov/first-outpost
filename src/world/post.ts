/**
 * Picture pipeline: the 3D scene is drawn into an off-screen image, then
 * glow (bloom), tone mapping, colour grading and screen effects are added.
 *
 * Even the lowest quality level uses the final pass, because it lets the 3D
 * picture be smaller than the screen (cheap) and stretched to fit.
 */
import * as THREE from 'three';
import type { QualityOptions } from './quality';

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const PREFILTER_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tMap;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
vec3 bright(vec3 c) {
  float level = max(c.r, max(c.g, c.b));
  float soft = clamp(level - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float gain = max(soft, level - uThreshold) / max(level, 1e-4);
  return min(c * gain, vec3(24.0));
}
void main() {
  vec3 c = bright(texture2D(tMap, vUv + uTexel * vec2(-1.0, -1.0)).rgb);
  c += bright(texture2D(tMap, vUv + uTexel * vec2(1.0, -1.0)).rgb);
  c += bright(texture2D(tMap, vUv + uTexel * vec2(-1.0, 1.0)).rgb);
  c += bright(texture2D(tMap, vUv + uTexel * vec2(1.0, 1.0)).rgb);
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;

// Dual-filter blur (Marius Bjorge, ARM): few samples, wide soft glow.
const DOWN_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tMap;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tMap, vUv).rgb * 4.0;
  c += texture2D(tMap, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tMap, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tMap, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tMap, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}`;

const UP_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tMap;
uniform sampler2D tAdd;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tMap, vUv + uTexel * vec2(-2.0, 0.0)).rgb;
  c += texture2D(tMap, vUv + uTexel * vec2(2.0, 0.0)).rgb;
  c += texture2D(tMap, vUv + uTexel * vec2(0.0, -2.0)).rgb;
  c += texture2D(tMap, vUv + uTexel * vec2(0.0, 2.0)).rgb;
  c += texture2D(tMap, vUv + uTexel * vec2(-1.0, 1.0)).rgb * 2.0;
  c += texture2D(tMap, vUv + uTexel * vec2(1.0, 1.0)).rgb * 2.0;
  c += texture2D(tMap, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 2.0;
  c += texture2D(tMap, vUv + uTexel * vec2(1.0, -1.0)).rgb * 2.0;
  gl_FragColor = vec4(c / 12.0 + texture2D(tAdd, vUv).rgb, 1.0);
}`;

const FINAL_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uExposure;
uniform float uSaturation;
uniform float uContrast;
uniform float uVignette;
uniform float uSpecks;
uniform float uTime;
uniform vec3 uTint;
uniform vec4 uFade;
uniform vec2 uResolution;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uOutline;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Khronos PBR Neutral tone mapper: keeps colours true, only tames the highlights.
vec3 neutralToneMap(vec3 color) {
  const float startCompression = 0.76;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  #ifdef USE_BLOOM
  c += texture2D(tBloom, vUv).rgb * uBloom;
  #endif
  c = toSrgb(neutralToneMap(c * uExposure));

  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, uSaturation);
  c = (c - 0.5) * uContrast + 0.5;
  c *= uTint;

  #ifdef USE_OUTLINE
  {
    // Ink lines where depth jumps. Raw depth is flat across any plane on screen,
    // so a simple Laplacian finds silhouettes without marking sloped surfaces.
    float d0 = texture2D(tDepth, vUv).x;
    float dl = texture2D(tDepth, vUv - vec2(uTexel.x, 0.0)).x;
    float dr = texture2D(tDepth, vUv + vec2(uTexel.x, 0.0)).x;
    float du = texture2D(tDepth, vUv + vec2(0.0, uTexel.y)).x;
    float dd = texture2D(tDepth, vUv - vec2(0.0, uTexel.y)).x;
    float nearest = min(d0, min(min(dl, dr), min(du, dd)));
    float z = (uNear * uFar) / (uFar - nearest * (uFar - uNear));
    float jump = abs(dl + dr + du + dd - 4.0 * d0) * z / uNear;
    float line = smoothstep(0.045, 0.11, jump) * (1.0 - smoothstep(55.0, 150.0, z));
    c = mix(c, c * vec3(0.2, 0.16, 0.3), line * uOutline);
  }
  #endif

  vec2 q = (vUv - 0.5) * vec2(1.0, 0.92);
  c *= mix(1.0, smoothstep(0.92, 0.28, length(q)), uVignette);

  // Charged particles hitting the camera during a radiation storm. Real rover cameras show this "snow".
  if (uSpecks > 0.001) {
    vec2 cell = floor(gl_FragCoord.xy / 2.0);
    float tick = floor(uTime * 24.0);
    float speck = step(1.0 - 0.006 * uSpecks, hash12(cell + tick * 17.13));
    float streak = step(1.0 - 0.0012 * uSpecks, hash12(vec2(cell.x * 0.07 + tick, floor(cell.y / 9.0))));
    c += vec3(0.9, 0.95, 1.0) * (speck + streak * 0.7);
  }

  c = mix(c, uFade.rgb, uFade.a);
  c += (hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;

function fullscreenMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    uniforms,
    defines,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

export interface Grade {
  exposure: number;
  saturation: number;
  contrast: number;
  tint: THREE.Color;
  bloom: number;
  vignette: number;
}

export class PostFX {
  /** The 3D scene is drawn into this image. */
  sceneTarget!: THREE.WebGLRenderTarget;
  readonly grade: Grade = {
    exposure: 1,
    saturation: 1.16,
    contrast: 1.07,
    tint: new THREE.Color(1, 1, 1),
    bloom: 0.55,
    vignette: 0.35,
  };
  /** Screen fade (colour + amount) for scene changes. */
  readonly fade = new THREE.Vector4(0, 0, 0, 0);
  /** Radiation storm "snow" on the picture, 0-1. */
  specks = 0;
  /** Ink line strength, 0-1. */
  outline = 0.8;
  /** True when the bright-colour (HDR) path is active. */
  hdrActive = false;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private bloomDown: THREE.WebGLRenderTarget[] = [];
  private bloomUp: THREE.WebGLRenderTarget[] = [];
  private prefilter!: THREE.ShaderMaterial;
  private down!: THREE.ShaderMaterial;
  private up!: THREE.ShaderMaterial;
  private final!: THREE.ShaderMaterial;
  private quality: QualityOptions;
  private readonly hdrSupported: boolean;
  private black: THREE.DataTexture;

  constructor(renderer: THREE.WebGLRenderer, quality: QualityOptions) {
    this.renderer = renderer;
    this.quality = quality;
    const gl = renderer.getContext();
    this.hdrSupported =
      renderer.capabilities.isWebGL2 &&
      (!!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float'));

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(geometry);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
    this.buildMaterials();
  }

  private buildMaterials(): void {
    this.prefilter = fullscreenMaterial(PREFILTER_FRAG, {
      tMap: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: 1 },
      uKnee: { value: 0.5 },
    });
    this.down = fullscreenMaterial(DOWN_FRAG, { tMap: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up = fullscreenMaterial(UP_FRAG, {
      tMap: { value: null },
      tAdd: { value: null },
      uTexel: { value: new THREE.Vector2() },
    });
    this.final = fullscreenMaterial(FINAL_FRAG, {
      tScene: { value: null },
      tBloom: { value: this.black },
      uBloom: { value: 0.5 },
      uExposure: { value: 1 },
      uSaturation: { value: 1 },
      uContrast: { value: 1 },
      uVignette: { value: 0.3 },
      uSpecks: { value: 0 },
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uFade: { value: this.fade },
      uResolution: { value: new THREE.Vector2(1, 1) },
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.25 },
      uFar: { value: 4000 },
      uOutline: { value: 0.8 },
    });
  }

  setQuality(quality: QualityOptions): void {
    this.quality = quality;
  }

  /** (Re)create the off-screen images for a picture of the given size in pixels. */
  resize(width: number, height: number): void {
    const q = this.quality;
    const w = Math.max(2, Math.round(width));
    const h = Math.max(2, Math.round(height));
    this.hdrActive = q.hdr && this.hdrSupported;
    const type = this.hdrActive ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const colorSpace = this.hdrActive ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;

    this.sceneTarget?.dispose();
    this.sceneTarget?.depthTexture?.dispose();
    this.sceneTarget = new THREE.WebGLRenderTarget(w, h, {
      type,
      colorSpace,
      samples: q.msaa,
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    if (q.outlines) {
      const depth = new THREE.DepthTexture(w, h);
      depth.type = THREE.UnsignedIntType;
      depth.minFilter = THREE.NearestFilter;
      depth.magFilter = THREE.NearestFilter;
      this.sceneTarget.depthTexture = depth;
    }
    if (!!this.final.defines.USE_OUTLINE !== q.outlines) {
      if (q.outlines) this.final.defines.USE_OUTLINE = '';
      else delete this.final.defines.USE_OUTLINE;
      this.final.needsUpdate = true;
    }
    this.final.uniforms.uTexel.value.set(1 / w, 1 / h);

    for (const target of [...this.bloomDown, ...this.bloomUp]) target.dispose();
    this.bloomDown = [];
    this.bloomUp = [];
    if (q.bloom) {
      let bw = Math.max(2, w >> 1);
      let bh = Math.max(2, h >> 1);
      for (let i = 0; i < q.bloomLevels && bw >= 4 && bh >= 4; i++) {
        const make = () =>
          new THREE.WebGLRenderTarget(bw, bh, {
            type,
            colorSpace,
            depthBuffer: false,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            generateMipmaps: false,
          });
        this.bloomDown.push(make());
        this.bloomUp.push(make());
        bw = Math.max(2, bw >> 1);
        bh = Math.max(2, bh >> 1);
      }
    }
    const useBloom = this.bloomDown.length > 0;
    if (!!this.final.defines.USE_BLOOM !== useBloom) {
      if (useBloom) this.final.defines.USE_BLOOM = '';
      else delete this.final.defines.USE_BLOOM;
      this.final.needsUpdate = true;
    }
    // Without HDR, colours stop at 1.0, so glow has to start from a lower brightness.
    this.prefilter.uniforms.uThreshold.value = this.hdrActive ? 1.0 : 0.82;
    this.prefilter.uniforms.uKnee.value = this.hdrActive ? 0.6 : 0.12;
  }

  private pass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number): void {
    const renderer = this.renderer;
    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);

    const levels = this.bloomDown.length;
    if (levels > 0) {
      const src = this.sceneTarget;
      this.prefilter.uniforms.tMap.value = src.texture;
      this.prefilter.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.pass(this.prefilter, this.bloomDown[0]);
      for (let i = 1; i < levels; i++) {
        const from = this.bloomDown[i - 1];
        this.down.uniforms.tMap.value = from.texture;
        this.down.uniforms.uTexel.value.set(1 / from.width, 1 / from.height);
        this.pass(this.down, this.bloomDown[i]);
      }
      let current = this.bloomDown[levels - 1];
      for (let i = levels - 2; i >= 0; i--) {
        this.up.uniforms.tMap.value = current.texture;
        this.up.uniforms.tAdd.value = this.bloomDown[i].texture;
        this.up.uniforms.uTexel.value.set(1 / current.width, 1 / current.height);
        this.pass(this.up, this.bloomUp[i]);
        current = this.bloomUp[i];
      }
      this.final.uniforms.tBloom.value = current.texture;
    } else {
      this.final.uniforms.tBloom.value = this.black;
    }

    const u = this.final.uniforms;
    u.tScene.value = this.sceneTarget.texture;
    u.tDepth.value = this.sceneTarget.depthTexture ?? null;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uOutline.value = this.outline;
    u.uBloom.value = this.grade.bloom;
    u.uExposure.value = this.grade.exposure;
    u.uSaturation.value = this.grade.saturation;
    u.uContrast.value = this.grade.contrast;
    u.uVignette.value = this.grade.vignette;
    u.uTint.value.copy(this.grade.tint);
    u.uSpecks.value = this.specks;
    u.uTime.value = time % 1000;
    this.pass(this.final, null);
  }

  dispose(): void {
    this.sceneTarget?.depthTexture?.dispose();
    this.sceneTarget?.dispose();
    for (const target of [...this.bloomDown, ...this.bloomUp]) target.dispose();
    this.prefilter.dispose();
    this.down.dispose();
    this.up.dispose();
    this.final.dispose();
    this.quad.geometry.dispose();
    this.black.dispose();
  }
}
