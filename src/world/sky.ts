/**
 * The sky dome: colour gradient, Sun, stars, thin clouds, dust and aurora.
 * On the Moon it also carries the Earth.
 */
import * as THREE from 'three';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  gl_Position.z = gl_Position.w; // always at the far plane
}`;

const SKY_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunSize;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uGlowColor;
uniform float uGlow;
uniform vec3 uHaloColor;
uniform float uHalo;
uniform float uStars;
uniform float uClouds;
uniform vec3 uCloudColor;
uniform float uDust;
uniform vec3 uDustColor;
uniform float uAurora;
uniform float uTime;
uniform float uStarSpin;
uniform float uAirless;
varying vec3 vDir;

float hash13( vec3 p3 ) {
  p3 = fract( p3 * 0.1031 );
  p3 += dot( p3, p3.zyx + 31.32 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float noise2( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash12( i ), hash12( i + vec2( 1.0, 0.0 ) ), f.x ),
              mix( hash12( i + vec2( 0.0, 1.0 ) ), hash12( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float fbm2( vec2 p ) {
  float sum = 0.0;
  float amp = 0.5;
  for ( int i = 0; i < 4; i++ ) {
    sum += amp * noise2( p );
    p = p * 2.03 + vec2( 17.0, 9.0 );
    amp *= 0.5;
  }
  return sum;
}

vec3 starLayer( vec3 d, float scale, float density ) {
  vec3 p = d * scale;
  vec3 cell = floor( p );
  float h = hash13( cell );
  if ( h > density ) return vec3( 0.0 );
  vec3 centre = vec3( hash13( cell + 1.7 ), hash13( cell + 5.3 ), hash13( cell + 9.1 ) ) * 0.6 + 0.2;
  float dist = length( fract( p ) - centre );
  float size = mix( 0.07, 0.17, hash13( cell + 13.9 ) );
  float glow = smoothstep( size, 0.0, dist );
  float twinkle = 0.7 + 0.3 * sin( uTime * ( 1.0 + 3.0 * hash13( cell + 3.1 ) ) + h * 90.0 );
  vec3 tint = mix( vec3( 0.72, 0.84, 1.0 ), vec3( 1.0, 0.88, 0.72 ), hash13( cell + 21.0 ) );
  return tint * glow * glow * twinkle * ( 0.7 + 3.4 * hash13( cell + 7.7 ) );
}

void main() {
  vec3 d = normalize( vDir );
  float h = d.y;

  // Sky gradient.
  float t = pow( smoothstep( -0.03, 1.0, h ), 0.42 );
  vec3 color = mix( uHorizon, uZenith, t );
  color = mix( color, uGround, smoothstep( 0.0, -0.22, h ) );

  // Sun glow and disc.
  float sunDot = dot( d, uSunDir );
  float near = max( sunDot, 0.0 );
  color += uGlowColor * uGlow * pow( near, 48.0 );
  color += uHaloColor * uHalo * pow( near, 5.0 ) * ( 0.35 + 0.65 * smoothstep( 0.35, -0.05, h ) );
  float angle = acos( clamp( sunDot, -1.0, 1.0 ) );
  float disc = 1.0 - smoothstep( uSunSize * 0.86, uSunSize, angle );
  color += uSunColor * disc * ( 1.0 - uDust * 0.9 );

  // Stars turn slowly around the pole.
  if ( uStars > 0.01 ) {
    float c = cos( uStarSpin );
    float s = sin( uStarSpin );
    vec3 sd = vec3( d.x * c - d.z * s, d.y, d.x * s + d.z * c );
    vec3 stars = starLayer( sd, 46.0, 0.09 ) + starLayer( sd, 95.0, 0.07 ) * 0.7;
    #ifdef SKY_DETAIL
    // The Milky Way: a soft, cloudy band.
    vec3 galaxyAxis = normalize( vec3( 0.35, 0.55, 0.76 ) );
    float band = exp( -pow( dot( sd, galaxyAxis ) * 3.2, 2.0 ) );
    float cloud = fbm2( sd.xz * 5.0 + sd.y * 3.0 );
    stars += vec3( 0.45, 0.5, 0.75 ) * band * ( 0.25 + 0.75 * cloud ) * 0.5;
    stars += starLayer( sd, 170.0, 0.12 ) * band * 0.8;
    #endif
    float mask = mix( smoothstep( -0.04, 0.16, h ), step( -0.02, h ), uAirless ) * ( 1.0 - disc ) * ( 1.0 - smoothstep( 0.9, 0.999, sunDot ) );
    color += stars * uStars * mask;
  }

  #ifdef SKY_DETAIL
  // Thin, high ice clouds (Mars has them).
  if ( uClouds > 0.01 ) {
    vec2 uv = d.xz / ( h + 0.24 ) * 0.78 + vec2( uTime * 0.004, 0.0 );
    float body = fbm2( uv * vec2( 0.8, 2.3 ) + fbm2( uv * 0.6 ) * 1.6 );
    float shape = body + fbm2( uv * vec2( 3.0, 6.5 ) + 4.0 ) * 0.16;
    // Painted the way an animator would: a clean edge, a sunlit core, a cooler rim.
    float cover = smoothstep( 0.55, 0.62, shape ) * smoothstep( 0.03, 0.26, h ) * uClouds;
    float core = smoothstep( 0.62, 0.8, shape );
    vec3 rim = mix( uCloudColor, uHorizon, 0.5 ) * 0.94;
    vec3 lit = mix( rim, uCloudColor * 1.06, core ) + uGlowColor * pow( near, 6.0 ) * 0.9;
    color = mix( color, lit, cover * 0.9 );
  }
  // Aurora: Mars has no global magnetic field, so a solar storm can light the whole sky.
  if ( uAurora > 0.01 ) {
    float curtain = fbm2( vec2( atan( d.z, d.x ) * 3.0 + uTime * 0.05, h * 4.0 - uTime * 0.08 ) );
    float glow = smoothstep( 0.35, 0.85, curtain ) * smoothstep( 0.0, 0.25, h ) * smoothstep( 0.95, 0.3, h );
    color += vec3( 0.25, 1.0, 0.45 ) * glow * uAurora * 0.55;
  }
  #endif

  color = mix( color, uDustColor * ( 0.55 + 0.45 * smoothstep( -0.1, 0.5, h ) ), uDust * 0.92 );
  gl_FragColor = vec4( color, 1.0 );
}`;

const EARTH_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = position;
  vWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
  vNormalW = normalize( mat3( modelMatrix ) * normal );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const EARTH_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uSunDir;
uniform float uTime;
varying vec3 vNormalW;
varying vec3 vLocal;
varying vec3 vWorld;

float hash13( vec3 p3 ) {
  p3 = fract( p3 * 0.1031 );
  p3 += dot( p3, p3.zyx + 31.32 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float noise3( vec3 p ) {
  vec3 i = floor( p );
  vec3 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( hash13( i ), hash13( i + vec3( 1, 0, 0 ) ), f.x ), mix( hash13( i + vec3( 0, 1, 0 ) ), hash13( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( hash13( i + vec3( 0, 0, 1 ) ), hash13( i + vec3( 1, 0, 1 ) ), f.x ), mix( hash13( i + vec3( 0, 1, 1 ) ), hash13( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
    f.z );
}
float fbm3( vec3 p ) {
  float sum = 0.0;
  float amp = 0.5;
  for ( int i = 0; i < 4; i++ ) {
    sum += amp * noise3( p );
    p = p * 2.1 + 11.0;
    amp *= 0.5;
  }
  return sum;
}

void main() {
  vec3 n = normalize( vNormalW );
  vec3 p = normalize( vLocal );
  float land = smoothstep( 0.5, 0.56, fbm3( p * 2.2 + 3.0 ) );
  float ice = smoothstep( 0.78, 0.9, abs( p.y ) + fbm3( p * 6.0 ) * 0.1 );
  vec3 ocean = mix( vec3( 0.02, 0.12, 0.42 ), vec3( 0.05, 0.3, 0.7 ), fbm3( p * 4.0 ) );
  vec3 ground = mix( vec3( 0.12, 0.42, 0.16 ), vec3( 0.62, 0.5, 0.3 ), fbm3( p * 5.0 + 7.0 ) );
  vec3 surface = mix( ocean, ground, land );
  surface = mix( surface, vec3( 0.95 ), ice );
  float clouds = smoothstep( 0.52, 0.7, fbm3( p * 3.4 + vec3( uTime * 0.01, 0.0, 0.0 ) ) );
  surface = mix( surface, vec3( 1.0 ), clouds * 0.85 );

  float light = dot( n, uSunDir );
  float day = smoothstep( -0.08, 0.22, light );
  vec3 color = surface * ( 0.02 + 1.9 * day );
  // Thin blue air glowing at the edge.
  float edge = pow( 1.0 - abs( dot( n, normalize( cameraPosition - vWorld ) ) ), 2.5 );
  color += vec3( 0.25, 0.55, 1.0 ) * edge * ( 0.25 + 1.6 * day );
  gl_FragColor = vec4( color, 1.0 );
}`;

export interface SkyColors {
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  sunColor: THREE.Color;
  glowColor: THREE.Color;
  glow: number;
  haloColor: THREE.Color;
  halo: number;
  stars: number;
  clouds: number;
  cloudColor: THREE.Color;
}

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly earth: THREE.Mesh | null;
  private readonly earthMaterial: THREE.ShaderMaterial | null = null;

  constructor(options: { detail: boolean; withEarth: boolean; sunSize: number }) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      defines: options.detail ? { SKY_DETAIL: '' } : {},
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSunSize: { value: options.sunSize },
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uGlowColor: { value: new THREE.Color() },
        uGlow: { value: 1 },
        uHaloColor: { value: new THREE.Color() },
        uHalo: { value: 0 },
        uStars: { value: 0 },
        uClouds: { value: 0 },
        uCloudColor: { value: new THREE.Color(1, 1, 1) },
        uDust: { value: 0 },
        uDustColor: { value: new THREE.Color(0.55, 0.36, 0.24) },
        uAurora: { value: 0 },
        uTime: { value: 0 },
        uStarSpin: { value: 0 },
        uAirless: { value: options.withEarth ? 1 : 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.mesh.scale.setScalar(1800);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;

    if (options.withEarth) {
      this.earthMaterial = new THREE.ShaderMaterial({
        vertexShader: EARTH_VERT,
        fragmentShader: EARTH_FRAG,
        uniforms: { uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uTime: { value: 0 } },
        fog: false,
        toneMapped: false,
      });
      this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.earthMaterial);
      this.earth.scale.setScalar(74);
      this.earth.rotation.set(0.4, 1.2, 0.41);
      this.earth.frustumCulled = false;
      this.earth.renderOrder = -90;
    } else {
      this.earth = null;
    }
  }

  /** Where Earth hangs in the lunar sky (it barely moves, as seen from the Moon). */
  static readonly EARTH_DIR = new THREE.Vector3(-0.42, 0.2, -0.88).normalize();

  update(camera: THREE.Camera, time: number, sunDir: THREE.Vector3): void {
    this.mesh.position.copy(camera.position);
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uSunDir.value.copy(sunDir);
    if (this.earth && this.earthMaterial) {
      this.earth.position.copy(camera.position).addScaledVector(Sky.EARTH_DIR, 1500);
      this.earth.rotation.y = 1.2 + time * 0.004;
      this.earthMaterial.uniforms.uSunDir.value.copy(sunDir);
      this.earthMaterial.uniforms.uTime.value = time;
    }
  }

  apply(colors: SkyColors): void {
    const u = this.material.uniforms;
    u.uZenith.value.copy(colors.zenith);
    u.uHorizon.value.copy(colors.horizon);
    u.uGround.value.copy(colors.ground);
    u.uSunColor.value.copy(colors.sunColor);
    u.uGlowColor.value.copy(colors.glowColor);
    u.uGlow.value = colors.glow;
    u.uHaloColor.value.copy(colors.haloColor);
    u.uHalo.value = colors.halo;
    u.uStars.value = colors.stars;
    u.uClouds.value = colors.clouds;
    u.uCloudColor.value.copy(colors.cloudColor);
  }

  set dust(value: number) {
    this.material.uniforms.uDust.value = value;
  }

  set aurora(value: number) {
    this.material.uniforms.uAurora.value = value;
  }

  set starSpin(value: number) {
    this.material.uniforms.uStarSpin.value = value;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.earth?.geometry.dispose();
    this.earthMaterial?.dispose();
  }
}
