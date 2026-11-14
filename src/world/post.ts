/**
 * Picture pipeline: the 3D scene is drawn into an off-screen image, then
 * glow (bloom), tone mapping, colour grading and screen effects are added.
 *
 * Even the lowest quality level uses the final pass, because it lets the 3D
 * picture be smaller than the screen (cheap) and stretched to fit.
 */
import * as THREE from 'three';
import { GLOBALS } from './materials';
import type { QualityOptions } from './quality';
import { flag } from './devflags';

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


const DEPTH_FUNCS = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform float uNear;
uniform float uFar;
float linZ(float d) {
  return (uNear * uFar) / (uFar - d * (uFar - uNear));
}
vec3 viewPos(vec2 uv, float d) {
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}`;

// Contact shadows: Alchemy-style ambient occlusion from the depth picture, at half size.
const AO_FRAG = /* glsl */ `
precision highp float;
${DEPTH_FUNCS}
uniform vec2 uTexel;
uniform float uRadius;
uniform float uProj11;
uniform float uAspect;
varying vec2 vUv;
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
void main() {
  float d0 = texture2D(tDepth, vUv).x;
  if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv, d0);
  float z = -P.z;
  float fade = 1.0 - smoothstep(30.0, 110.0, z);
  if (fade <= 0.0) { gl_FragColor = vec4(1.0); return; }
  // Surface direction from the depth around this pixel; take the side that is closer in depth, so silhouettes stay clean.
  vec2 e = uTexel;
  vec3 pl = viewPos(vUv - vec2(e.x, 0.0), texture2D(tDepth, vUv - vec2(e.x, 0.0)).x);
  vec3 pr = viewPos(vUv + vec2(e.x, 0.0), texture2D(tDepth, vUv + vec2(e.x, 0.0)).x);
  vec3 pd = viewPos(vUv - vec2(0.0, e.y), texture2D(tDepth, vUv - vec2(0.0, e.y)).x);
  vec3 pu = viewPos(vUv + vec2(0.0, e.y), texture2D(tDepth, vUv + vec2(0.0, e.y)).x);
  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 N = normalize(cross(dx, dy));
  float reach = clamp(uRadius * uProj11 * 0.5 / z, 4.0 * e.y, 0.1);
  float turn = ign(gl_FragCoord.xy) * 6.2831853;
  float occ = 0.0;
  for (int i = 0; i < AO_SAMPLES; i++) {
    float t = (float(i) + 0.5) / float(AO_SAMPLES);
    float a = turn + float(i) * 2.3999632;
    vec2 uv = vUv + vec2(cos(a) / uAspect, sin(a)) * reach * (0.15 + 0.85 * t);
    float ds = texture2D(tDepth, uv).x;
    if (ds >= 0.99999) continue;
    vec3 v = viewPos(uv, ds) - P;
    float dist = length(v);
    float facing = dot(N, v) / max(dist, 1e-3);
    float range = 1.0 - smoothstep(uRadius * 0.7, uRadius * 1.7, dist);
    occ += max(0.0, facing - 0.12) * range;
  }
  float ao = clamp(1.0 - occ / float(AO_SAMPLES) * 1.7, 0.0, 1.0);
  gl_FragColor = vec4(vec3(mix(1.0, ao, fade)), 1.0);
}`;

// Smooths the contact shadows without smearing them across object edges.
const AO_BLUR_FRAG = /* glsl */ `
precision highp float;
${DEPTH_FUNCS}
uniform sampler2D tAO;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  float z0 = linZ(texture2D(tDepth, vUv).x);
  float sum = texture2D(tAO, vUv).r;
  float weight = 1.0;
  for (int i = 1; i <= 3; i++) {
    float k = exp(-float(i * i) * 0.18);
    for (int s = -1; s <= 1; s += 2) {
      vec2 uv = vUv + uStep * float(i * s);
      float zs = linZ(texture2D(tDepth, uv).x);
      float w = k * exp(-abs(zs - z0) * 9.0 / (z0 + 0.5));
      sum += texture2D(tAO, uv).r * w;
      weight += w;
    }
  }
  gl_FragColor = vec4(vec3(sum / weight), 1.0);
}`;

// Light shafts: march from each pixel towards the Sun and count how much open sky the ray passes over.
const SHAFT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDepth;
uniform vec2 uSunUv;
uniform float uTime;
varying vec2 vUv;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec2 delta = (uSunUv - vUv) * (0.92 / float(SHAFT_SAMPLES));
  vec2 p = vUv + delta * hash12(gl_FragCoord.xy + fract(uTime) * 17.0);
  float light = 0.0;
  float decay = 1.0;
  for (int i = 0; i < SHAFT_SAMPLES; i++) {
    p += delta;
    float sky = step(0.99999, texture2D(tDepth, clamp(p, 0.001, 0.999)).x);
    float near = clamp(1.0 - length(p - uSunUv) * 1.3, 0.0, 1.0);
    light += sky * decay * (0.25 + 0.75 * near * near);
    decay *= 0.965;
  }
  light = light / ( float(SHAFT_SAMPLES) * 0.55 ) * 0.8;
  // Fade out away from the Sun so the glow stays a glow, not a full-screen wash.
  float reach = 1.0 - smoothstep(0.35, 1.35, length(vUv - uSunUv));
  gl_FragColor = vec4(vec3(clamp(light, 0.0, 1.0) * reach), 1.0);
}`;

// Where the film camera focuses: the depth at the middle of the picture, followed slowly.
const FOCUS_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDepth;
uniform sampler2D tPrev;
uniform float uNear;
uniform float uFar;
uniform float uBlend;
varying vec2 vUv;
float linZ(float d) {
  return (uNear * uFar) / (uFar - d * (uFar - uNear));
}
void main() {
  float z = 0.0;
  z += min(linZ(texture2D(tDepth, vec2(0.5)).x), 90.0) * 2.0;
  z += min(linZ(texture2D(tDepth, vec2(0.47, 0.5)).x), 90.0);
  z += min(linZ(texture2D(tDepth, vec2(0.53, 0.5)).x), 90.0);
  z += min(linZ(texture2D(tDepth, vec2(0.5, 0.46)).x), 90.0);
  z += min(linZ(texture2D(tDepth, vec2(0.5, 0.54)).x), 90.0);
  z /= 6.0;
  float prev = texture2D(tPrev, vec2(0.5)).r;
  if (prev <= 0.0) prev = z;
  gl_FragColor = vec4(mix(prev, z, uBlend), 0.0, 0.0, 1.0);
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
#ifdef USE_ANIME_INK
uniform float uAnimeInk;
#endif
uniform float uCine;
uniform sampler2D tAO;
uniform float uAO;
uniform vec2 uAOTexel;
uniform float uAOUp;
uniform sampler2D tShafts;
uniform vec3 uShaftColor;
uniform vec3 uGradeShadow;
uniform vec3 uGradeHigh;
uniform float uGrade;
uniform float uGlow;
uniform sampler2D tBlur;
uniform sampler2D tFocus;
uniform float uCA;
uniform float uAperture;
varying vec2 vUv;
float linZ(float d) {
  return (uNear * uFar) / (uFar - d * (uFar - uNear));
}

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

#ifdef USE_AO
// Half-size occlusion, enlarged with four taps that ignore texels lying on another surface (no grey halo).
float aoUpsample() {
  vec2 p = vUv / uAOTexel - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  float zc = linZ(texture2D(tDepth, vUv).x);
  float tol = zc * 0.03 + 0.02;
  float sum = 0.0;
  float wsum = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 o = vec2(float(k & 1), float(k >> 1));
    vec2 uv = (i + o + 0.5) * uAOTexel;
    float bw = (o.x > 0.5 ? f.x : 1.0 - f.x) * (o.y > 0.5 ? f.y : 1.0 - f.y);
    float dz = (linZ(texture2D(tDepth, uv).x) - zc) / tol;
    float w = bw * exp(-dz * dz);
    sum += texture2D(tAO, uv).r * w;
    wsum += w;
  }
  return wsum > 0.002 ? sum / wsum : texture2D(tAO, vUv).r;
}
#endif

void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  #ifdef USE_CINEMA
  if (uCine > 0.001) {
    // Film lens: colour fringes towards the corners and a soft background (focus follows what is in the middle).
    vec2 off = vUv - 0.5;
    vec2 shift = off * dot(off, off) * uCA * uCine;
    c.r = texture2D(tScene, vUv - shift).r;
    c.b = texture2D(tScene, vUv + shift).b;
    float z = linZ(texture2D(tDepth, vUv).x);
    float focus = max(texture2D(tFocus, vec2(0.5)).r, 0.5);
    float coc = abs(1.0 / focus - 1.0 / z) * uAperture;
    c = mix(c, texture2D(tBlur, vUv).rgb, smoothstep(0.12, 0.85, coc) * uCine);
  }
  #endif
  #ifdef USE_AO
  if (uAOUp > 0.5) {
    // Outdoors the occluded part takes the world's shadow colour, pushed darker; indoors uGrade is 0, so it stays neutral.
    float ao = aoUpsample();
    vec3 tint = vec3(ao) * uGradeShadow * uGradeShadow;
    c *= mix(vec3(1.0), mix(vec3(ao), tint, 0.35 * uGrade * (1.0 - ao)), uAO);
  } else {
    c *= mix(1.0, texture2D(tAO, vUv).r, uAO);
  }
  #endif
  #ifdef USE_SHAFTS
  c += uShaftColor * texture2D(tShafts, vUv).r;
  #endif
  vec3 bloomSample = vec3(0.0);
  #ifdef USE_BLOOM
  bloomSample = texture2D(tBloom, vUv).rgb;
  c += bloomSample * uBloom;
  #endif
  c = toSrgb(neutralToneMap(c * uExposure));

  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, uSaturation);
  c = (c - 0.5) * uContrast + 0.5;
  c *= uTint;

  #ifdef USE_GRADE
  {
    // The look of each world: tinted shadows and highlights, and a soft glow that spills from bright areas.
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c *= mix(vec3(1.0), uGradeShadow, (1.0 - smoothstep(0.0, 0.6, l)) * uGrade);
    c *= mix(vec3(1.0), uGradeHigh, smoothstep(0.4, 1.0, l) * uGrade);
    #ifdef USE_BLOOM
    vec3 g = toSrgb(neutralToneMap(bloomSample * uGlow));
    c = 1.0 - (1.0 - c) * (1.0 - g);
    #endif
  }
  #endif

  #ifdef USE_OUTLINE
  {
    // Ink lines where depth jumps. Raw depth is flat across any plane on screen,
    // so a simple Laplacian finds silhouettes without marking sloped surfaces.
    float d0 = texture2D(tDepth, vUv).x;
    vec2 tx = uTexel;
    #ifdef USE_ANIME_INK
    {
      // About 1.5 pixels near the camera, 1 pixel far away.
      float z0 = (uNear * uFar) / (uFar - d0 * (uFar - uNear));
      tx *= mix(1.0, mix(1.5, 1.0, smoothstep(8.0, 70.0, z0)), uAnimeInk);
    }
    #endif
    float dl = texture2D(tDepth, vUv - vec2(tx.x, 0.0)).x;
    float dr = texture2D(tDepth, vUv + vec2(tx.x, 0.0)).x;
    float du = texture2D(tDepth, vUv + vec2(0.0, tx.y)).x;
    float dd = texture2D(tDepth, vUv - vec2(0.0, tx.y)).x;
    float nearest = min(d0, min(min(dl, dr), min(du, dd)));
    float z = (uNear * uFar) / (uFar - nearest * (uFar - uNear));
    float jump = abs(dl + dr + du + dd - 4.0 * d0) * z / uNear;
    float line = smoothstep(0.045, 0.11, jump) * (1.0 - smoothstep(55.0, 150.0, z));
    vec3 inkColor = c * vec3(0.2, 0.16, 0.3);
    #ifdef USE_ANIME_INK
    {
      // The line takes its colour from the picture: the local colour, darker and richer, a little toward the ink tone.
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 rich = max(mix(vec3(lum), c, 1.6), 0.0) * 0.3;
      vec3 surf = mix(rich, vec3(0.2, 0.16, 0.3) * 0.55, 0.3);
      inkColor = mix(inkColor, surf, uAnimeInk);
    }
    #endif
    c = mix(c, inkColor, line * uOutline);
  }
  #endif

  vec2 q = (vUv - 0.5) * vec2(1.0, 0.92);
  c *= mix(1.0, smoothstep(0.92 - 0.12 * uCine, 0.28, length(q)), clamp(uVignette + 0.3 * uCine, 0.0, 1.0));

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

/** The colour mood of a world (high and ultra only): tinted shadows and highlights, and how much glow spills from bright areas. */
export interface Look {
  shadow: THREE.Color;
  high: THREE.Color;
  /** 0-1: how strongly the tints are applied. */
  amount: number;
  /** Strength of the soft glow on highlights. */
  glow: number;
}

function makeTarget(
  w: number,
  h: number,
  type: THREE.TextureDataType,
  colorSpace: THREE.ColorSpace = THREE.LinearSRGBColorSpace,
): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type,
    colorSpace,
    depthBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
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
  /** Per-world colour mood. The Daylight sets it; it is only drawn on high and ultra, and only outdoors. */
  readonly look: Look = { shadow: new THREE.Color(1, 1, 1), high: new THREE.Color(1, 1, 1), amount: 0, glow: 0.3 };
  /** Contact shadow strength, 0-1. */
  aoStrength = 0.85;
  /** Light shafts: direction to the Sun, its colour and how strong the shafts are (0 = none). Set each frame by the Daylight. */
  readonly sun = { dir: new THREE.Vector3(0, 1, 0), color: new THREE.Color(1, 0.9, 0.7), shafts: 0 };
  /** True while a building's inside is drawn: no light shafts and no world colour mood there. */
  indoor = false;
  /** Set from the "less motion" setting: no colour fringes, a calmer film look, no flicker in the shafts. */
  lessMotion = false;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private bloomDown: THREE.WebGLRenderTarget[] = [];
  private bloomUp: THREE.WebGLRenderTarget[] = [];
  private aoTargets: THREE.WebGLRenderTarget[] = [];
  private shaftTarget: THREE.WebGLRenderTarget | null = null;
  private blurTargets: THREE.WebGLRenderTarget[] = [];
  private focusTargets: THREE.WebGLRenderTarget[] = [];
  private focusIndex = 0;
  private prefilter!: THREE.ShaderMaterial;
  private down!: THREE.ShaderMaterial;
  private up!: THREE.ShaderMaterial;
  private final!: THREE.ShaderMaterial;
  private ao: THREE.ShaderMaterial | null = null;
  private aoBlur: THREE.ShaderMaterial | null = null;
  private shafts: THREE.ShaderMaterial | null = null;
  private focus: THREE.ShaderMaterial | null = null;
  private quality: QualityOptions;
  private readonly hdrSupported: boolean;
  private black: THREE.DataTexture;
  private white: THREE.DataTexture;
  private cine = 0;
  private cineGoal = 0;
  private lastTime = 0;
  private readonly sunView = new THREE.Vector3();

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
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.white.needsUpdate = true;
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
      uAnimeInk: { value: 1 },
      uCine: { value: 0 },
      tAO: { value: this.white },
      uAO: { value: 0.85 },
      uAOTexel: { value: new THREE.Vector2(1, 1) },
      uAOUp: { value: 1 },
      tShafts: { value: this.black },
      uShaftColor: { value: new THREE.Color(1, 0.9, 0.7) },
      uGradeShadow: { value: new THREE.Color(1, 1, 1) },
      uGradeHigh: { value: new THREE.Color(1, 1, 1) },
      uGrade: { value: 0 },
      uGlow: { value: 0.3 },
      tBlur: { value: this.black },
      tFocus: { value: this.black },
      uCA: { value: 0.014 },
      uAperture: { value: 16 },
    });
  }

  private depthUniforms(): Record<string, THREE.IUniform> {
    return {
      tDepth: { value: null },
      uInvProj: { value: new THREE.Matrix4() },
      uNear: { value: 0.25 },
      uFar: { value: 4000 },
    };
  }

  setQuality(quality: QualityOptions): void {
    this.quality = quality;
    // Characters, glass and lights switch their anime look at once, also while a room is drawn (the Daylight sleeps there).
    GLOBALS.anime.value = quality.grade ? 1 : 0;
  }

  /** The quality level in use (read by the Daylight to switch the extra sky on and off). */
  get options(): QualityOptions {
    return this.quality;
  }

  /**
   * Film look for cutscenes: a stronger vignette everywhere, and on high and ultra also soft focus
   * and colour fringes at the edges. It eases in and out and is safe to call at any quality.
   */
  setCinematic(on: boolean): void {
    this.cineGoal = on ? 1 : 0;
  }

  private setDefine(material: THREE.ShaderMaterial, name: string, value: string | null): void {
    const has = name in material.defines;
    if (value === null) {
      if (!has) return;
      delete material.defines[name];
    } else {
      if (has && material.defines[name] === value) return;
      material.defines[name] = value;
    }
    material.needsUpdate = true;
  }

  /** (Re)create the off-screen images for a picture of the given size in pixels. */
  resize(width: number, height: number): void {
    const q = this.quality;
    const w = Math.max(2, Math.round(width));
    const h = Math.max(2, Math.round(height));
    this.hdrActive = q.hdr && this.hdrSupported;
    const type = this.hdrActive ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const colorSpace = this.hdrActive ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
    const useAO = q.ao > 0;
    const useShafts = q.shafts > 0;
    const useCinema = q.cinematic && this.hdrActive;
    const needDepth = q.outlines || useAO || useShafts || useCinema;

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
    if (needDepth) {
      const depth = new THREE.DepthTexture(w, h);
      depth.type = THREE.UnsignedIntType;
      depth.minFilter = THREE.NearestFilter;
      depth.magFilter = THREE.NearestFilter;
      this.sceneTarget.depthTexture = depth;
    }
    this.setDefine(this.final, 'USE_OUTLINE', q.outlines ? '' : null);
    this.setDefine(this.final, 'USE_ANIME_INK', q.outlines && q.grade ? '' : null);
    this.final.uniforms.uTexel.value.set(1 / w, 1 / h);

    for (const target of [...this.bloomDown, ...this.bloomUp, ...this.aoTargets, ...this.blurTargets, ...this.focusTargets]) target.dispose();
    this.shaftTarget?.dispose();
    this.shaftTarget = null;
    this.bloomDown = [];
    this.bloomUp = [];
    this.aoTargets = [];
    this.blurTargets = [];
    this.focusTargets = [];
    if (q.bloom) {
      let bw = Math.max(2, w >> 1);
      let bh = Math.max(2, h >> 1);
      for (let i = 0; i < q.bloomLevels && bw >= 4 && bh >= 4; i++) {
        this.bloomDown.push(makeTarget(bw, bh, type, colorSpace));
        this.bloomUp.push(makeTarget(bw, bh, type, colorSpace));
        bw = Math.max(2, bw >> 1);
        bh = Math.max(2, bh >> 1);
      }
    }
    this.setDefine(this.final, 'USE_BLOOM', this.bloomDown.length > 0 ? '' : null);
    // Without HDR, colours stop at 1.0, so glow has to start from a lower brightness.
    this.prefilter.uniforms.uThreshold.value = this.hdrActive ? 1.0 : 0.82;
    this.prefilter.uniforms.uKnee.value = this.hdrActive ? 0.6 : 0.12;

    const hw = Math.max(2, w >> 1);
    const hh = Math.max(2, h >> 1);
    // Contact shadows.
    if (useAO) {
      this.aoTargets = [makeTarget(hw, hh, THREE.UnsignedByteType), makeTarget(hw, hh, THREE.UnsignedByteType)];
      if (!this.ao) {
        this.ao = fullscreenMaterial(AO_FRAG, {
          ...this.depthUniforms(),
          uTexel: { value: new THREE.Vector2() },
          uRadius: { value: 1 },
          uProj11: { value: 1 },
          uAspect: { value: 1 },
        });
        this.aoBlur = fullscreenMaterial(AO_BLUR_FRAG, { ...this.depthUniforms(), tAO: { value: null }, uStep: { value: new THREE.Vector2() } });
      }
      this.setDefine(this.ao, 'AO_SAMPLES', String(q.ao));
    }
    this.setDefine(this.final, 'USE_AO', useAO ? '' : null);
    // Light shafts.
    if (useShafts) {
      this.shaftTarget = makeTarget(hw, hh, THREE.UnsignedByteType);
      this.shafts ??= fullscreenMaterial(SHAFT_FRAG, { tDepth: { value: null }, uSunUv: { value: new THREE.Vector2() }, uTime: { value: 0 } });
      this.setDefine(this.shafts, 'SHAFT_SAMPLES', String(q.shafts));
    }
    this.setDefine(this.final, 'USE_SHAFTS', useShafts ? '' : null);
    this.setDefine(this.final, 'USE_GRADE', q.grade ? '' : null);
    // Film look: a soft copy of the picture at a quarter of the size, and where the focus is.
    if (useCinema) {
      this.blurTargets = [makeTarget(hw, hh, type), makeTarget(Math.max(2, hw >> 1), Math.max(2, hh >> 1), type)];
      this.focusTargets = [makeTarget(1, 1, THREE.HalfFloatType), makeTarget(1, 1, THREE.HalfFloatType)];
      this.focus ??= fullscreenMaterial(FOCUS_FRAG, {
        tDepth: { value: null },
        tPrev: { value: null },
        uNear: { value: 0.25 },
        uFar: { value: 4000 },
        uBlend: { value: 0.1 },
      });
    }
    this.setDefine(this.final, 'USE_CINEMA', useCinema ? '' : null);
  }

  private pass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number): void {
    const renderer = this.renderer;
    const dt = Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.cine += (this.cineGoal - this.cine) * Math.min(1, dt * 2.5);
    if (Math.abs(this.cine - this.cineGoal) < 0.002) this.cine = this.cineGoal;

    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);
    const depth = this.sceneTarget.depthTexture ?? null;
    const u = this.final.uniforms;

    // Contact shadows: half-size picture, then two smoothing passes that keep object edges sharp.
    if (this.ao && this.aoBlur && this.aoTargets.length === 2 && depth) {
      const [a, b] = this.aoTargets;
      const ao = this.ao.uniforms;
      ao.tDepth.value = depth;
      ao.uInvProj.value.copy(camera.projectionMatrixInverse);
      ao.uNear.value = camera.near;
      ao.uFar.value = camera.far;
      ao.uTexel.value.set(1 / this.sceneTarget.width, 1 / this.sceneTarget.height);
      ao.uRadius.value = 1.0;
      ao.uProj11.value = camera.projectionMatrix.elements[5];
      ao.uAspect.value = camera.aspect;
      this.pass(this.ao, a);
      const blur = this.aoBlur.uniforms;
      blur.tDepth.value = depth;
      blur.uInvProj.value.copy(camera.projectionMatrixInverse);
      blur.uNear.value = camera.near;
      blur.uFar.value = camera.far;
      blur.tAO.value = a.texture;
      blur.uStep.value.set(1 / a.width, 0);
      this.pass(this.aoBlur, b);
      blur.tAO.value = b.texture;
      blur.uStep.value.set(0, 1 / a.height);
      this.pass(this.aoBlur, a);
      u.tAO.value = a.texture;
      u.uAOTexel.value.set(1 / a.width, 1 / a.height);
    }
    u.uAO.value = this.aoStrength;
    u.uAOUp.value = flag('G7') ? 1 : 0;

    // Light shafts from the Sun's place on the screen.
    let shaft = 0;
    if (this.shafts && this.shaftTarget && depth && !this.indoor && this.sun.shafts > 0.001) {
      // The Sun is at infinity, so only its direction in the camera's frame matters.
      this.sunView.copy(this.sun.dir).transformDirection(camera.matrixWorldInverse);
      const facing = -this.sunView.z;
      shaft = this.sun.shafts * THREE.MathUtils.smoothstep(facing, -0.05, 0.3);
      if (shaft > 0.002) {
        const e = camera.projectionMatrix.elements;
        const w = Math.max(facing, 0.05);
        const sx = (this.sunView.x * e[0] + this.sunView.z * e[8]) / w;
        const sy = (this.sunView.y * e[5] + this.sunView.z * e[9]) / w;
        const s = this.shafts.uniforms;
        s.tDepth.value = depth;
        s.uSunUv.value.set(0.5 + 0.5 * THREE.MathUtils.clamp(sx, -6, 6), 0.5 + 0.5 * THREE.MathUtils.clamp(sy, -6, 6));
        s.uTime.value = this.lessMotion ? 0 : time % 1000;
        this.pass(this.shafts, this.shaftTarget);
        u.tShafts.value = this.shaftTarget.texture;
      }
    }
    u.uShaftColor.value.copy(this.sun.color).multiplyScalar(shaft > 0.002 ? shaft : 0);
    if (shaft <= 0.002) u.tShafts.value = this.black;

    // Film look: a soft copy of the picture and the focus distance (only while the look is showing).
    u.uCine.value = this.lessMotion ? this.cine * 0.6 : this.cine;
    u.uCA.value = this.lessMotion ? 0 : 0.014;
    if (this.focus && this.blurTargets.length === 2 && this.focusTargets.length === 2 && depth && this.cine > 0.002) {
      const src = this.sceneTarget;
      this.down.uniforms.tMap.value = src.texture;
      this.down.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.pass(this.down, this.blurTargets[0]);
      this.down.uniforms.tMap.value = this.blurTargets[0].texture;
      this.down.uniforms.uTexel.value.set(1 / this.blurTargets[0].width, 1 / this.blurTargets[0].height);
      this.pass(this.down, this.blurTargets[1]);
      const f = this.focus.uniforms;
      const next = this.focusTargets[this.focusIndex ^ 1];
      f.tDepth.value = depth;
      f.tPrev.value = this.focusTargets[this.focusIndex].texture;
      f.uNear.value = camera.near;
      f.uFar.value = camera.far;
      f.uBlend.value = Math.min(1, dt * 3);
      this.pass(this.focus, next);
      this.focusIndex ^= 1;
      u.tBlur.value = this.blurTargets[1].texture;
      u.tFocus.value = next.texture;
    }

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
      u.tBloom.value = current.texture;
    } else {
      u.tBloom.value = this.black;
    }

    u.tScene.value = this.sceneTarget.texture;
    u.tDepth.value = depth;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uOutline.value = this.outline;
    u.uAnimeInk.value = flag('G8') ? 1 : 0;
    u.uBloom.value = this.grade.bloom;
    u.uExposure.value = this.grade.exposure;
    u.uSaturation.value = this.grade.saturation;
    u.uContrast.value = this.grade.contrast;
    u.uVignette.value = this.grade.vignette;
    u.uTint.value.copy(this.grade.tint);
    u.uSpecks.value = this.specks;
    u.uTime.value = time % 1000;
    // The world's colour mood is for the outdoors; rooms have their own grade.
    u.uGrade.value = this.indoor ? 0 : this.look.amount;
    u.uGradeShadow.value.copy(this.look.shadow);
    u.uGradeHigh.value.copy(this.look.high);
    u.uGlow.value = this.indoor ? this.look.glow * 0.6 : this.look.glow;
    this.pass(this.final, null);
  }

  dispose(): void {
    this.sceneTarget?.depthTexture?.dispose();
    this.sceneTarget?.dispose();
    for (const target of [...this.bloomDown, ...this.bloomUp, ...this.aoTargets, ...this.blurTargets, ...this.focusTargets]) target.dispose();
    this.shaftTarget?.dispose();
    this.prefilter.dispose();
    this.down.dispose();
    this.up.dispose();
    this.final.dispose();
    this.ao?.dispose();
    this.aoBlur?.dispose();
    this.shafts?.dispose();
    this.focus?.dispose();
    this.quad.geometry.dispose();
    this.black.dispose();
    this.white.dispose();
  }
}
