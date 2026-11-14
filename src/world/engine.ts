/**
 * Renderer, main loop, screen size handling and automatic performance tuning.
 */
import * as THREE from 'three';
import { flag } from './devflags';
import { PostFX } from './post';
import type { QualityOptions } from './quality';

export type UpdateFn = (dt: number, time: number) => void;

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** A scene drawn instead of the main one (the inside of a building), or null. */
  view: THREE.Scene | null = null;
  /** Wider view inside small rooms. */
  private fovScale = 1;
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.25, 4000);
  readonly post: PostFX;
  readonly canvas: HTMLCanvasElement;

  quality: QualityOptions;
  /** Seconds since start, paused time excluded. */
  time = 0;
  /** Smoothed frames per second. */
  fps = 60;
  /** Frame rate limit chosen by the player (0 = no limit). */
  maxFps = 0;
  /** Current automatic picture scale (1 = as set by quality). */
  dynamicScale = 1;
  width = 1;
  height = 1;

  private readonly updates = new Set<UpdateFn>();
  private readonly resizeListeners = new Set<(w: number, h: number) => void>();
  private frame = 0;
  private last = 0;
  private running = false;
  private slowTime = 0;
  private fastTime = 0;
  private needsResize = true;
  private lostContext = false;
  /** How far the picture is slid sideways or up, as a fraction of the screen (so panels do not cover the outpost). */
  private readonly shift = { x: 0, y: 0 };
  private readonly shiftGoal = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement, quality: QualityOptions) {
    this.canvas = canvas;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.info.autoReset = false;
    this.post = new PostFX(this.renderer, quality);
    this.applyShadowSettings();

    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  private onResize = (): void => {
    this.needsResize = true;
  };

  private onVisibility = (): void => {
    if (document.hidden) this.last = 0;
  };

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    this.lostContext = true;
  };

  private onContextRestored = (): void => {
    this.lostContext = false;
    this.needsResize = true;
  };

  private applyShadowSettings(): void {
    const q = this.quality;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = this.wantedShadowType();
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** The radius filter (PCF) is used where the quality asks for a soft edge wider than PCFSoft gives. */
  private wantedShadowType(): THREE.ShadowMapType {
    const q = this.quality;
    if (q.shadows && q.shadowRadius > 1 && flag('G1')) return THREE.PCFShadowMap;
    return q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  }

  /** Follows the dev A/B flag: lit materials must be built again when the filter changes. */
  private syncShadowType(): void {
    const type = this.wantedShadowType();
    if (type === this.renderer.shadowMap.type) return;
    this.renderer.shadowMap.type = type;
    this.renderer.shadowMap.needsUpdate = true;
    const refresh = (scene: THREE.Object3D): void =>
      scene.traverse((child) => {
        const material = (child as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) for (const m of material) m.needsUpdate = true;
        else if (material) material.needsUpdate = true;
      });
    refresh(this.scene);
    if (this.view) refresh(this.view);
  }

  setQuality(quality: QualityOptions): void {
    this.quality = quality;
    this.dynamicScale = 1;
    this.post.setQuality(quality);
    this.applyShadowSettings();
    this.needsResize = true;
  }

  /** Slide the 3D picture: x > 0 moves the scene right, y > 0 moves it down. Values are fractions of the screen. */
  setViewShift(x: number, y: number, instant = false): void {
    this.shiftGoal.x = x;
    this.shiftGoal.y = y;
    if (instant) {
      this.shift.x = x;
      this.shift.y = y;
      this.applyShift();
    }
  }

  private applyShift(): void {
    const { x, y } = this.shift;
    if (Math.abs(x) < 0.002 && Math.abs(y) < 0.002) this.camera.clearViewOffset();
    else this.camera.setViewOffset(this.width, this.height, -x * this.width, -y * this.height, this.width, this.height);
  }

  /** Widen (or restore) the view: 1 is normal. */
  setFovScale(scale: number): void {
    if (scale === this.fovScale) return;
    this.fovScale = scale;
    // Only the lens changes: no need to rebuild every render target.
    this.updateFov();
  }

  onUpdate(fn: UpdateFn): () => void {
    this.updates.add(fn);
    return () => this.updates.delete(fn);
  }

  onResized(fn: (w: number, h: number) => void): () => void {
    this.resizeListeners.add(fn);
    return () => this.resizeListeners.delete(fn);
  }

  /** Tall phone screens get a wider view so the outpost still fits. */
  private updateFov(): void {
    this.camera.fov = (this.camera.aspect < 0.8 ? 62 : this.camera.aspect < 1.2 ? 54 : 48) * this.fovScale;
    this.camera.updateProjectionMatrix();
  }

  private resize(): void {
    this.needsResize = false;
    const cssWidth = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const cssHeight = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap);
    this.width = cssWidth;
    this.height = cssHeight;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(cssWidth, cssHeight, false);
    const scale = this.quality.renderScale * this.dynamicScale;
    this.post.resize(cssWidth * pixelRatio * scale, cssHeight * pixelRatio * scale);
    this.camera.aspect = cssWidth / cssHeight;
    this.updateFov();
    this.applyShift();
    for (const fn of this.resizeListeners) fn(cssWidth, cssHeight);
  }

  /** Draw the picture. Rooms are drawn from their own scene: there the Sun's light shafts and the world's colour mood stay off. */
  private draw(): void {
    this.syncShadowType();
    this.post.indoor = this.view !== null;
    this.post.render(this.view ?? this.scene, this.camera, this.time);
  }

  /** Lower the picture size when frames are slow, raise it again when there is room. */
  private tune(dt: number): void {
    if (!this.quality.dynamicResolution) return;
    const target = this.maxFps > 0 ? Math.min(this.maxFps, 60) : 60;
    const slow = this.fps < target * 0.72;
    const fast = this.fps > target * 0.94;
    this.slowTime = slow ? this.slowTime + dt : 0;
    this.fastTime = fast ? this.fastTime + dt : 0;
    if (this.slowTime > 1.2 && this.dynamicScale > 0.55) {
      this.dynamicScale = Math.max(0.55, this.dynamicScale - 0.12);
      this.slowTime = 0;
      this.needsResize = true;
    } else if (this.fastTime > 6 && this.dynamicScale < 1) {
      this.dynamicScale = Math.min(1, this.dynamicScale + 0.08);
      this.fastTime = 0;
      this.needsResize = true;
    }
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.loop);
    if (document.hidden || this.lostContext) return;
    if (this.last === 0) this.last = now - 16.7;
    const elapsed = now - this.last;
    if (this.maxFps > 0 && elapsed < 1000 / this.maxFps - 1.5) return;
    this.last = now;

    const dt = Math.min(0.1, elapsed / 1000);
    this.time += dt;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.06;
    this.tune(dt);
    if (this.needsResize) this.resize();
    const dx = this.shiftGoal.x - this.shift.x;
    const dy = this.shiftGoal.y - this.shift.y;
    if (Math.abs(dx) > 0.0005 || Math.abs(dy) > 0.0005) {
      const k = Math.min(1, dt * 4);
      this.shift.x += dx * k;
      this.shift.y += dy * k;
      this.applyShift();
    }

    for (const fn of this.updates) fn(dt, this.time);
    this.renderer.info.reset();
    this.draw();
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    this.frame = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  /** Advance the world by a fixed time and draw, without waiting for the browser (tests, hidden tabs). */
  step(dt: number): void {
    this.time += dt;
    if (this.needsResize) this.resize();
    this.shift.x = this.shiftGoal.x;
    this.shift.y = this.shiftGoal.y;
    this.applyShift();
    for (const fn of this.updates) fn(dt, this.time);
    this.renderer.info.reset();
    this.draw();
  }

  /** Draw one frame right now (used for screenshots and the mission certificate). */
  renderOnce(): void {
    if (this.needsResize) this.resize();
    this.draw();
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.post.dispose();
    this.renderer.dispose();
  }
}
