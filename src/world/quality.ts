/**
 * Graphics quality levels.
 *
 * The same game must run on a school Chromebook, a phone and a gaming PC,
 * so every costly effect can be scaled or switched off.
 */

export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';
export type QualityChoice = QualityTier | 'auto';

export interface QualityOptions {
  tier: QualityTier;
  /** Upper limit for the device pixel ratio. */
  pixelRatioCap: number;
  /** Size of the 3D picture compared with the screen (1 = full). */
  renderScale: number;
  /** Anti-aliasing samples (0 = off). */
  msaa: number;
  /** Bright, wide colour range for glow effects. */
  hdr: boolean;
  bloom: boolean;
  bloomLevels: number;
  shadows: boolean;
  shadowSize: number;
  softShadows: boolean;
  /** Sun shadows also cover the far edges of the overview picture (the box widens in steps). */
  shadowWide: boolean;
  /** Edge softness of the sun shadow in shadow texels; above 1 uses the radius filter instead of PCFSoft. */
  shadowRadius: number;
  /** Dark outlines around characters. */
  outlines: boolean;
  /** Multiplier for the number of dust, sparkle and star particles. */
  particles: number;
  /** Ground mesh resolution (squares per side). */
  terrain: number;
  /** Multiplier for the number of rocks. */
  rocks: number;
  /** Small lamps that light the ground around them. */
  pointLights: boolean;
  /** Extra sky detail: clouds, Milky Way. */
  skyDetail: boolean;
  /** Let the game lower the picture size when the frame rate drops. */
  dynamicResolution: boolean;
  /** Contact shadows in corners and under objects (half-size picture). 0 = off, else the number of samples. */
  ao: number;
  /** Sun light shafts through dust and haze. 0 = off, else the number of samples along each ray. */
  shafts: number;
  /** Mars dust lit through the Sun's shadow map instead of screen-space rays (ultra only). */
  shaftsVolumetric: boolean;
  /** Per-world colour grade and the soft anime glow on highlights. */
  grade: boolean;
  /** Film look for cutscenes: depth of field and colour fringes. */
  cinematic: boolean;
  /** Moons, Earth "star", shooting stars, sun glare and softer clouds in the sky. */
  skyFancy: boolean;
  /** Fine relief on the ground: grain and an irregular light/shadow edge near the camera. */
  groundDetail: boolean;
  /** FXAA on the finished picture (one extra full-screen pass and one 8-bit image). */
  fxaa: boolean;
  /** Small stones scattered on bare ground (instances; 0 = none). */
  scatter: number;
}

export const QUALITY: Record<QualityTier, QualityOptions> = {
  low: {
    tier: 'low',
    pixelRatioCap: 1,
    renderScale: 0.8,
    msaa: 0,
    hdr: false,
    bloom: false,
    bloomLevels: 0,
    shadows: false,
    shadowSize: 0,
    softShadows: false,
    shadowWide: false,
    shadowRadius: 1,
    outlines: false,
    particles: 0.3,
    terrain: 72,
    rocks: 0.4,
    pointLights: false,
    skyDetail: false,
    dynamicResolution: true,
    ao: 0,
    shafts: 0,
    shaftsVolumetric: false,
    grade: false,
    cinematic: false,
    skyFancy: false,
    groundDetail: false,
    fxaa: false,
    scatter: 0,
  },
  medium: {
    tier: 'medium',
    pixelRatioCap: 1.25,
    renderScale: 1,
    msaa: 2,
    hdr: true,
    bloom: true,
    bloomLevels: 4,
    shadows: true,
    shadowSize: 1024,
    softShadows: false,
    shadowWide: false,
    shadowRadius: 1,
    outlines: true,
    particles: 0.6,
    terrain: 110,
    rocks: 0.7,
    pointLights: false,
    skyDetail: true,
    dynamicResolution: true,
    ao: 0,
    shafts: 0,
    shaftsVolumetric: false,
    grade: false,
    cinematic: false,
    skyFancy: false,
    groundDetail: false,
    fxaa: false,
    scatter: 0,
  },
  high: {
    tier: 'high',
    pixelRatioCap: 1.5,
    renderScale: 1,
    msaa: 4,
    hdr: true,
    bloom: true,
    bloomLevels: 5,
    shadows: true,
    shadowSize: 2048,
    softShadows: true,
    shadowWide: true,
    shadowRadius: 1,
    outlines: true,
    particles: 1,
    terrain: 150,
    rocks: 1,
    pointLights: true,
    skyDetail: true,
    dynamicResolution: true,
    ao: 8,
    shafts: 20,
    shaftsVolumetric: false,
    grade: true,
    cinematic: true,
    skyFancy: true,
    groundDetail: true,
    fxaa: true,
    scatter: 2000,
  },
  ultra: {
    tier: 'ultra',
    pixelRatioCap: 2,
    renderScale: 1,
    msaa: 4,
    hdr: true,
    bloom: true,
    bloomLevels: 6,
    shadows: true,
    shadowSize: 4096,
    softShadows: true,
    shadowWide: true,
    shadowRadius: 1,
    outlines: true,
    particles: 1.5,
    terrain: 190,
    rocks: 1.4,
    pointLights: true,
    skyDetail: true,
    dynamicResolution: true,
    ao: 14,
    shafts: 32,
    shaftsVolumetric: true,
    grade: true,
    cinematic: true,
    skyFancy: true,
    groundDetail: true,
    fxaa: true,
    scatter: 6000,
  },
};

export const TIERS: QualityTier[] = ['low', 'medium', 'high', 'ultra'];

/** A first guess from what the browser tells us about the device. */
export function guessTier(): QualityTier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  const touch = matchMedia('(pointer: coarse)').matches;
  const smallScreen = Math.min(screen.width, screen.height) < 700;
  const mobile = touch && (smallScreen || /Android|iPhone|iPad|iPod/i.test(nav.userAgent));

  let gpu = '';
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
    if (!gl) return 'low';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (info) gpu = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    return 'low';
  }

  const software = /swiftshader|llvmpipe|software|basic render/i.test(gpu);
  if (software) return 'low';
  const strongGpu = /rtx|radeon rx|geforce gtx 1[06-9]|gtx 16|apple m\d|arc\b/i.test(gpu);
  // Ultra by itself only for clearly strong desktop cards: RTX 3070 / 4070 / 5070 and up, RX 6700 / 7700 and up,
  // M-series Pro, Max and Ultra. Dynamic resolution and the Auto step-down catch a card that is weaker than it looks.
  const topGpu = /rtx ?(?:30|40|50)[789]0|radeon rx ?(?:6[789]|7[789])00|apple m\d (?:pro|max|ultra)/i.test(gpu);
  const weakGpu =/intel.*(hd|uhd) graphics (?![67])|mali-[gt]?[1-5]\d\b|adreno \(?(tm\))? ?[1-5]\d\d|powervr/i.test(gpu);

  if (mobile) {
    if (cores >= 8 && memory >= 6 && !weakGpu) return 'medium';
    return 'low';
  }
  if (weakGpu || cores <= 2 || memory <= 2) return 'low';
  if (topGpu && cores >= 8 && memory >= 8 && !laptopGpu(gpu)) return 'ultra';
  if (strongGpu && cores >= 8) return 'high';
  return 'medium';
}

/** Laptop cards share power and heat with the rest of the machine, so Auto keeps them one level lower. */
function laptopGpu(gpu: string): boolean {
  return /laptop|max-q|mobile|rx ?\d{4}[ms]\b/i.test(gpu);
}

/** One step down or up, used by the automatic tuner. */
export function shiftTier(tier: QualityTier, delta: number): QualityTier {
  const index = Math.max(0, Math.min(TIERS.length - 1, TIERS.indexOf(tier) + delta));
  return TIERS[index];
}
