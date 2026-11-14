/**
 * Cel-shaded ("toon") materials.
 *
 * Look: two clean light bands, coloured shadows that come from the sky light,
 * a bright rim on the sunny side, and dark outlines on characters.
 */
import * as THREE from 'three';
import { outlineGeometry } from './models';

/** Values shared by every material, updated once per frame. */
export const GLOBALS = {
  time: { value: 0 },
  /** Direction to the Sun in camera space. */
  sunDirView: { value: new THREE.Vector3(0, 1, 0) },
  rimColor: { value: new THREE.Color(1, 0.95, 0.85) },
  /** Colour reflected by glass: roughly the sky near the horizon. */
  skyColor: { value: new THREE.Color(0.8, 0.6, 0.5) },
  /** How much dust tints dusty surfaces, 0-1. */
  dust: { value: 0 },
  dustColor: { value: new THREE.Color(0.75, 0.5, 0.35) },
  /** 0 = day, 1 = night: lamps and windows glow by this amount. */
  night: { value: 0 },
  /** 1 on high and ultra: the anime look of characters (sharper shadow edge, rim tinted by the sky, glints) and brighter lights at night. */
  anime: { value: 0 },
  /** Bounce light (dev switch G3): 1 in production. The effect is also multiplied by `anime`. */
  bounce: { value: 1 },
  /** Ambient colour of up-facing, down-facing and side-facing surfaces (neutral until a Daylight or room fills them). */
  ambSky: { value: new THREE.Color(0, 0, 0) },
  ambGround: { value: new THREE.Color(0, 0, 0) },
  ambSide: { value: new THREE.Color(0, 0, 0) },
  /** The colour mood of shadows (copied from the world look: violet on Mars, blue on the Moon). */
  shadowTint: { value: new THREE.Color(1, 1, 1) },
};

/**
 * Ambient light by world normal: up faces lean to the sky colour, down faces to the ground colour, side faces to the
 * horizon colour. The mean over the sphere is taken out, so energy is redistributed, not added. Weight 0.25 at most.
 */
const BOUNCE_UNIFORMS = /* glsl */ `
uniform float uBounce;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uAmbSide;`;

const BOUNCE_DELTA = /* glsl */ `
vec3 bounceDelta( vec3 normalView ) {
  vec3 wn = normalize( ( vec4( normalView, 0.0 ) * viewMatrix ).xyz );
  float up = max( wn.y, 0.0 );
  float dn = max( -wn.y, 0.0 );
  float sd = 1.0 - abs( wn.y );
  return ( uAmbSky * up + uAmbGround * dn + uAmbSide * sd - ( uAmbSky + uAmbGround + uAmbSide * 2.0 ) * 0.25 ) * 0.25;
}`;

/** Fog values that three.js fills in for custom shaders that opt into fog. */
export function fogUniforms(): Record<string, THREE.IUniform> {
  return THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
}

export interface ToonOptions {
  color: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  map?: THREE.Texture | null;
  /** Rim light strength (0 = none). */
  rim?: number;
  /** Rim width, 0-1. */
  rimWidth?: number;
  /** Shiny highlight strength (0 = matte). */
  spec?: number;
  /** Position of the light/shadow edge, -1 to 1. */
  bandEdge?: number;
  /** Softness of that edge. */
  bandSoft?: number;
  vertexColors?: boolean;
  side?: THREE.Side;
  flatShading?: boolean;
  /** Surface collects dust (solar panels). */
  dusty?: boolean;
  transparent?: boolean;
  opacity?: number;
  /** Share of its own colour a surface keeps in full shadow (characters: about 0.2). */
  lift?: number;
  /** A small hard glint of the Sun on high and ultra (suits). */
  glint?: number;
}

const toonCache = new Map<string, THREE.MeshToonMaterial>();

export function toon(options: ToonOptions): THREE.MeshToonMaterial {
  const key = JSON.stringify({ ...options, map: options.map?.uuid ?? null });
  const cached = toonCache.get(key);
  if (cached) return cached;

  const material = new THREE.MeshToonMaterial({
    color: options.color,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 1,
    map: options.map ?? null,
    vertexColors: options.vertexColors ?? false,
    side: options.side ?? THREE.FrontSide,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
  });
  // MeshToonMaterial has no flatShading flag in its type, but the shader honours the define.
  if (options.flatShading) (material as unknown as { flatShading: boolean }).flatShading = true;

  const rim = options.rim ?? 0.35;
  const rimWidth = options.rimWidth ?? 0.42;
  const spec = options.spec ?? 0;
  const bandEdge = options.bandEdge ?? 0.02;
  const bandSoft = options.bandSoft ?? 0.035;
  const dusty = !!options.dusty;
  const lift = options.lift ?? 0;
  const glint = options.glint ?? 0;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBand = { value: new THREE.Vector2(bandEdge, bandSoft) };
    shader.uniforms.uRim = { value: new THREE.Vector2(rimWidth, rim) };
    shader.uniforms.uSpec = { value: spec };
    shader.uniforms.uLift = { value: lift };
    shader.uniforms.uGlint = { value: glint };
    shader.uniforms.uAnime = GLOBALS.anime;
    shader.uniforms.uSky = GLOBALS.skyColor;
    shader.uniforms.uRimColor = GLOBALS.rimColor;
    shader.uniforms.uSunDirView = GLOBALS.sunDirView;
    shader.uniforms.uDust = GLOBALS.dust;
    shader.uniforms.uDustColor = GLOBALS.dustColor;
    shader.uniforms.uBounce = GLOBALS.bounce;
    shader.uniforms.uAmbSky = GLOBALS.ambSky;
    shader.uniforms.uAmbGround = GLOBALS.ambGround;
    shader.uniforms.uAmbSide = GLOBALS.ambSide;
    shader.uniforms.uShadowTint = GLOBALS.shadowTint;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <gradientmap_pars_fragment>',
        /* glsl */ `
        uniform vec2 uBand;
        uniform vec2 uRim;
        uniform float uSpec;
        uniform float uLift;
        uniform float uGlint;
        uniform float uAnime;
        uniform vec3 uSky;
        uniform vec3 uRimColor;
        uniform vec3 uSunDirView;
        uniform float uDust;
        uniform vec3 uDustColor;
        uniform vec3 uShadowTint;
        ${BOUNCE_UNIFORMS}
        ${BOUNCE_DELTA}
        vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
          float dotNL = dot( normal, lightDirection );
          // Characters (they keep some of their colour in shadow) get a crisper light/shadow edge on high and ultra.
          float soft = uBand.y * mix( 1.0, 0.38, uAnime * step( 0.001, uLift ) );
          float lit = smoothstep( uBand.x - soft, uBand.x + soft, dotNL );
          float bright = smoothstep( uBand.x + 0.45 - soft, uBand.x + 0.45 + soft, dotNL );
          // High and ultra: a narrow mid-tone between light and shadow (zero when uAnime or the dev switch is 0).
          float core = smoothstep( uBand.x - 0.3 - soft, uBand.x - 0.3 + soft, dotNL ) * ( 1.0 - lit );
          return vec3( lit * 0.84 + bright * 0.16 + uAnime * uBounce * 0.14 * core );
        }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        ${dusty ? 'diffuseColor.rgb = mix( diffuseColor.rgb, uDustColor, uDust * 0.85 );' : ''}`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        {
          // Bounce light: ambient by normal, and a tint on the shadow side (both zero when gk is 0).
          float gk = uAnime * uBounce;
          outgoingLight += bounceDelta( normal ) * material.diffuseColor * gk;
          float lumD = dot( reflectedLight.directDiffuse, vec3( 0.333 ) );
          float lumI = dot( reflectedLight.indirectDiffuse, vec3( 0.333 ) );
          float shade = 1.0 - lumD / ( lumD + lumI + 0.0001 );
          outgoingLight += ( uShadowTint - 1.0 ) * ( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse ) * ( shade * 0.5 * gk );
        }
        {
          vec3 viewDir = normalize( vViewPosition );
          float facing = saturate( dot( viewDir, normal ) );
          float sunSide = saturate( dot( normal, uSunDirView ) * 0.6 + 0.4 );
          float rimBand = smoothstep( 1.0 - uRim.x, 1.0 - uRim.x * 0.45, 1.0 - facing );
          // The rim picks up the colour of the sky it is seen against.
          vec3 rimTone = mix( uRimColor, uSky * 1.5 + uRimColor * 0.35, 0.45 * uAnime );
          outgoingLight += rimTone * rimBand * uRim.y * sunSide;
          outgoingLight += diffuseColor.rgb * uLift;
          float shine = uSpec + uGlint * uAnime;
          if ( shine > 0.0 ) {
            vec3 halfDir = normalize( uSunDirView + viewDir );
            float highlight = smoothstep( 0.982, 0.994, dot( normal, halfDir ) );
            outgoingLight += uRimColor * highlight * shine;
          }
        }
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `toon-${dusty ? 'd' : 'c'}`;
  toonCache.set(key, material);
  return material;
}

/** Glowing, unlit material. Intensity above 1 feeds the bloom effect. */
export function glow(color: THREE.ColorRepresentation, intensity = 2): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color });
  material.color.multiplyScalar(intensity);
  material.toneMapped = false;
  // On high and ultra, small lights and screens shine brighter in the dark so they read (and bloom) at night.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = GLOBALS.night;
    shader.uniforms.uAnime = GLOBALS.anime;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform float uAnime;')
      .replace('#include <opaque_fragment>', 'outgoingLight *= 1.0 + 0.9 * uNight * uAnime;\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'glow-n';
  return material;
}

/**
 * A lamp or window whose brightness follows the time of day and the power it gets.
 * `power` is a shared uniform (0-1) so one module can dim all of its lights at once.
 */
export function lamp(
  color: THREE.ColorRepresentation,
  power: { value: number },
  options: { day?: number; night?: number } = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...fogUniforms(),
      uColor: { value: new THREE.Color(color) },
      uPower: power,
      uNight: GLOBALS.night,
      uDay: { value: options.day ?? 0.9 },
      uNightLevel: { value: options.night ?? 3.2 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uPower;
      uniform float uNight;
      uniform float uDay;
      uniform float uNightLevel;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        float level = mix( uDay, uNightLevel, uNight ) * mix( 0.06, 1.0, uPower );
        gl_FragColor = vec4( uColor * level, 1.0 );
        #include <fog_fragment>
      }`,
    fog: true,
  });
}

/** Dark hull drawn behind a mesh to give it an outline. */
export function outlineMaterial(color: THREE.ColorRepresentation = 0x2a2140, width = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uWidth: { value: width } },
    vertexShader: /* glsl */ `
      uniform float uWidth;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
        vec3 viewNormal = normalize( normalMatrix * normal );
        // Grow along the normal by an amount that scales with distance: constant width on screen.
        mvPosition.xyz += viewNormal * uWidth * 0.0036 * max( 2.0, -mvPosition.z );
        gl_Position = projectionMatrix * mvPosition;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4( uColor, 1.0 ); }`,
    side: THREE.BackSide,
  });
}

/** Glass with a bright edge and soft sky reflection (greenhouse, domes, visors). */
export function glass(
  tint: THREE.ColorRepresentation,
  options: { opacity?: number; edge?: number; glow?: { value: number }; glowColor?: THREE.ColorRepresentation } = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...fogUniforms(),
      uTint: { value: new THREE.Color(tint) },
      uSky: GLOBALS.skyColor,
      uSunDirView: GLOBALS.sunDirView,
      uOpacity: { value: options.opacity ?? 0.16 },
      uEdge: { value: options.edge ?? 0.75 },
      uGlow: options.glow ?? { value: 0 },
      uGlowColor: { value: new THREE.Color(options.glowColor ?? 0xff66cc) },
      uNight: GLOBALS.night,
      uAnime: GLOBALS.anime,
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
        vNormal = normalize( normalMatrix * normal );
        vView = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint;
      uniform vec3 uSky;
      uniform vec3 uSunDirView;
      uniform vec3 uGlowColor;
      uniform float uOpacity;
      uniform float uEdge;
      uniform float uGlow;
      uniform float uNight;
      uniform float uAnime;
      varying vec3 vNormal;
      varying vec3 vView;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec3 n = normalize( vNormal );
        if ( !gl_FrontFacing ) n = -n;
        vec3 v = normalize( vView );
        float fresnel = pow( 1.0 - saturate( dot( n, v ) ), 2.2 );
        vec3 halfDir = normalize( uSunDirView + v );
        float glint = smoothstep( 0.985, 0.996, dot( n, halfDir ) );
        // A fake reflection of the sky: the glass mirrors a gradient from the ground, over the horizon, to the zenith.
        vec3 mirror = reflect( -v, n );
        float up = dot( mirror, normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) );
        vec3 zenith = uSky * vec3( 0.7, 0.82, 1.15 );
        vec3 ground = uSky * vec3( 0.38, 0.3, 0.27 );
        vec3 env = mix( ground, mix( uSky, zenith, smoothstep( 0.0, 0.85, up ) ), smoothstep( -0.25, 0.08, up ) );
        vec3 reflected = mix( uSky, env, uAnime );
        vec3 color = mix( uTint * 0.55, reflected * 1.15, fresnel ) + vec3( 1.0, 0.97, 0.9 ) * glint * 2.5;
        color += uGlowColor * uGlow * ( 0.25 + 0.55 * uNight ) * ( 1.0 - fresnel * 0.5 );
        float alpha = mix( uOpacity, uEdge, fresnel ) + glint + uGlow * 0.08;
        gl_FragColor = vec4( color, saturate( alpha ) );
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
}

/** Draw a small picture with the 2D canvas and use it as a texture. */
export function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  options: { repeat?: boolean; nearest?: boolean } = {},
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (options.repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  if (options.nearest) texture.magFilter = THREE.NearestFilter;
  return texture;
}

/** Add a dark outline hull to every mesh under the given object. */
export function addOutline(root: THREE.Object3D, material: THREE.ShaderMaterial): THREE.Mesh[] {
  const hulls: THREE.Mesh[] = [];
  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && !mesh.userData.noOutline) meshes.push(mesh);
  });
  for (const mesh of meshes) {
    // Blender models have crisp edges: their outline uses a copy with rounded-off normals.
    const hull = new THREE.Mesh(mesh.geometry.userData.shared ? outlineGeometry(mesh.geometry) : mesh.geometry, material);
    hull.userData.noOutline = true;
    hull.userData.isOutline = true;
    hull.castShadow = false;
    hull.receiveShadow = false;
    mesh.add(hull);
    hulls.push(hull);
  }
  return hulls;
}

const GROUND_PARS = /* glsl */ `
uniform vec2 uBand;
uniform vec3 uSpeck;
uniform vec3 uLight;
uniform float uRipple;
varying vec3 vWorldPos;
float gHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float gNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( gHash( i ), gHash( i + vec2( 1.0, 0.0 ) ), f.x ),
              mix( gHash( i + vec2( 0.0, 1.0 ) ), gHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float gFbm( vec2 p ) {
  return 0.5 * gNoise( p ) + 0.3 * gNoise( p * 2.1 + 7.0 ) + 0.2 * gNoise( p * 4.3 + 13.0 );
}
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
  float dotNL = dot( normal, lightDirection );
  // A little wobble makes the shadow edge look painted by hand.
  float paint = ( gNoise( vWorldPos.xz * 0.8 ) - 0.5 ) * 0.09;
  float lit = smoothstep( uBand.x - uBand.y, uBand.x + uBand.y, dotNL + paint );
  float bright = smoothstep( 0.5, 0.72, dotNL + paint );
  return vec3( lit * 0.86 + bright * 0.14 );
}`;

const GROUND_COLOR = /* glsl */ `
#include <color_fragment>
{
  float viewDist = length( vViewPosition );
  float near = 1.0 - smoothstep( 35.0, 130.0, viewDist );
  float patches = gFbm( vWorldPos.xz * 0.1 );
  diffuseColor.rgb *= 0.82 + 0.36 * patches;
  // Long soft strokes, as if the ground were brushed on: drifts of lighter soil lying with the wind.
  float stroke = gFbm( vec2( vWorldPos.x * 0.045 + vWorldPos.z * 0.02, vWorldPos.z * 0.2 - vWorldPos.x * 0.05 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, uLight, smoothstep( 0.5, 0.78, stroke ) * 0.26 );
  float fine = gNoise( vWorldPos.xz * 2.6 );
  diffuseColor.rgb = mix( diffuseColor.rgb, uLight, smoothstep( 0.6, 0.95, fine ) * 0.16 * near );
  float pebbles = gNoise( vWorldPos.xz * 10.0 );
  diffuseColor.rgb = mix( diffuseColor.rgb, uSpeck, smoothstep( 0.84, 0.95, pebbles ) * 0.3 * near );
  if ( uRipple > 0.0 ) {
    // Wind ripples in the sand.
    float wave = sin( dot( vWorldPos.xz, vec2( 0.82, 0.57 ) ) * 5.0 + gNoise( vWorldPos.xz * 0.5 ) * 9.0 );
    diffuseColor.rgb *= 1.0 + 0.09 * smoothstep( 0.5, 1.0, wave ) * near * smoothstep( 0.35, 0.7, patches );
  }
}`;


// ---- Ground micro-relief (high and ultra only; compiled in by USE_RELIEF) ----
const GROUND_RELIEF_PARS = /* glsl */ `
#ifdef USE_RELIEF
// Value noise with its analytic gradient: x = value, yz = d/dp.
vec3 gNoiseD( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  vec2 du = 6.0 * f * ( 1.0 - f );
  float a = gHash( i );
  float b = gHash( i + vec2( 1.0, 0.0 ) );
  float c = gHash( i + vec2( 0.0, 1.0 ) );
  float d = gHash( i + vec2( 1.0, 1.0 ) );
  float k = a - b - c + d;
  return vec3( a + ( b - a ) * u.x + ( c - a ) * u.y + k * u.x * u.y,
               du * vec2( ( b - a ) + k * u.y, ( c - a ) + k * u.x ) );
}
#endif`;

const GROUND_RELIEF = /* glsl */ `
#ifdef USE_RELIEF
{
  float reliefDist = length( vViewPosition );
  float reliefFade = 1.0 - smoothstep( 25.0, 110.0, reliefDist );
  // Flat-on views (grazing) would sparkle: scale the effect down towards the horizon.
  float reliefGraze = smoothstep( 0.1, 0.45, abs( dot( normal, vViewPosition ) ) / max( reliefDist, 0.001 ) );
  float reliefAmount = reliefFade * reliefGraze;
  if ( reliefAmount > 0.001 ) {
    // Two octaves of the ground noise (about 1.5 and 6 cycles per metre) read as a small height field.
    vec3 n1 = gNoiseD( vWorldPos.xz * 1.5 + 3.7 );
    vec3 n2 = gNoiseD( vWorldPos.xz * 6.0 + 11.3 );
    vec2 slope = n1.yz * 1.5 * 0.045 + n2.yz * 6.0 * 0.012;
    if ( uRipple > 0.0 ) {
      // The wind ripples of the colour term, as a small ridge too.
      vec2 rippleDir = vec2( 0.82, 0.57 );
      float ripplePhase = dot( vWorldPos.xz, rippleDir ) * 5.0 + gNoise( vWorldPos.xz * 0.5 ) * 9.0;
      float rippleMask = smoothstep( 0.35, 0.7, gFbm( vWorldPos.xz * 0.1 ) );
      slope += rippleDir * ( cos( ripplePhase ) * 5.0 * 0.014 * rippleMask );
    }
    vec3 worldTilt = vec3( -slope.x, 0.0, -slope.y ) * reliefAmount;
    normal = normalize( normal + ( viewMatrix * vec4( worldTilt, 0.0 ) ).xyz );
  }
}
#endif`;

const GROUND_BOUNCE_PARS = /* glsl */ `
#ifdef USE_RELIEF
uniform float uAnime;
${BOUNCE_UNIFORMS}
${BOUNCE_DELTA}
#endif`;

const GROUND_BOUNCE = /* glsl */ `
#ifdef USE_RELIEF
// Ground faces mostly up, so half weight keeps the sand warm.
outgoingLight += bounceDelta( normal ) * material.diffuseColor * ( uAnime * uBounce * 0.5 );
#endif
#include <opaque_fragment>`;

/** Painted-looking ground with patches, pebbles and (on Mars) sand ripples. */
export function ground(options: {
  speck: THREE.ColorRepresentation;
  light: THREE.ColorRepresentation;
  bandEdge: number;
  bandSoft: number;
  ripples: boolean;
  /** High and ultra: fine normal relief near the camera (own shader program). */
  relief?: boolean;
}): THREE.MeshToonMaterial {
  const material = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBand = { value: new THREE.Vector2(options.bandEdge, options.bandSoft) };
    shader.uniforms.uSpeck = { value: new THREE.Color(options.speck) };
    shader.uniforms.uLight = { value: new THREE.Color(options.light) };
    shader.uniforms.uRipple = { value: options.ripples ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <gradientmap_pars_fragment>', options.relief ? GROUND_PARS + GROUND_RELIEF_PARS + GROUND_BOUNCE_PARS : GROUND_PARS)
      .replace('#include <color_fragment>', GROUND_COLOR);
    if (options.relief) {
      shader.uniforms.uAnime = GLOBALS.anime;
      shader.uniforms.uBounce = GLOBALS.bounce;
      shader.uniforms.uAmbSky = GLOBALS.ambSky;
      shader.uniforms.uAmbGround = GLOBALS.ambGround;
      shader.uniforms.uAmbSide = GLOBALS.ambSide;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + GROUND_RELIEF)
        .replace('#include <opaque_fragment>', GROUND_BOUNCE);
    }
  };
  if (options.relief) material.defines.USE_RELIEF = '';
  material.customProgramCacheKey = () => (options.relief ? 'ground-relief' : 'ground');
  return material;
}
