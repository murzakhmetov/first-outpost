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
};

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

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBand = { value: new THREE.Vector2(bandEdge, bandSoft) };
    shader.uniforms.uRim = { value: new THREE.Vector2(rimWidth, rim) };
    shader.uniforms.uSpec = { value: spec };
    shader.uniforms.uLift = { value: lift };
    shader.uniforms.uRimColor = GLOBALS.rimColor;
    shader.uniforms.uSunDirView = GLOBALS.sunDirView;
    shader.uniforms.uDust = GLOBALS.dust;
    shader.uniforms.uDustColor = GLOBALS.dustColor;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <gradientmap_pars_fragment>',
        /* glsl */ `
        uniform vec2 uBand;
        uniform vec2 uRim;
        uniform float uSpec;
        uniform float uLift;
        uniform vec3 uRimColor;
        uniform vec3 uSunDirView;
        uniform float uDust;
        uniform vec3 uDustColor;
        vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
          float dotNL = dot( normal, lightDirection );
          float lit = smoothstep( uBand.x - uBand.y, uBand.x + uBand.y, dotNL );
          float bright = smoothstep( uBand.x + 0.45 - uBand.y, uBand.x + 0.45 + uBand.y, dotNL );
          return vec3( lit * 0.84 + bright * 0.16 );
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
          vec3 viewDir = normalize( vViewPosition );
          float facing = saturate( dot( viewDir, normal ) );
          float sunSide = saturate( dot( normal, uSunDirView ) * 0.6 + 0.4 );
          float rimBand = smoothstep( 1.0 - uRim.x, 1.0 - uRim.x * 0.45, 1.0 - facing );
          outgoingLight += uRimColor * rimBand * uRim.y * sunSide;
          outgoingLight += diffuseColor.rgb * uLift;
          if ( uSpec > 0.0 ) {
            vec3 halfDir = normalize( uSunDirView + viewDir );
            float highlight = smoothstep( 0.982, 0.994, dot( normal, halfDir ) );
            outgoingLight += uRimColor * highlight * uSpec;
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
        vec3 color = mix( uTint * 0.55, uSky * 1.15, fresnel ) + vec3( 1.0, 0.97, 0.9 ) * glint * 2.5;
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

/** Painted-looking ground with patches, pebbles and (on Mars) sand ripples. */
export function ground(options: {
  speck: THREE.ColorRepresentation;
  light: THREE.ColorRepresentation;
  bandEdge: number;
  bandSoft: number;
  ripples: boolean;
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
      .replace('#include <gradientmap_pars_fragment>', GROUND_PARS)
      .replace('#include <color_fragment>', GROUND_COLOR);
  };
  material.customProgramCacheKey = () => 'ground';
  return material;
}
