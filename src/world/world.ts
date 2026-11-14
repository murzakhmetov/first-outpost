/**
 * The 3D world: one object the rest of the game talks to.
 *
 * The game logic never touches three.js directly. It tells the world what the
 * outpost looks like (setView), where to look (setMode) and what the sky is
 * doing (setWeather), and listens for what the player does outside (eva).
 */
import * as THREE from 'three';
import type { SiteId } from '../sim/types';
import { Astronaut, SUIT_COLORS } from './astronaut';
import { Annex } from './annex';
import type { PlotView } from './annex';
import { AIRLOCK, BATTERY, Base, FARM, HAB, LAB, PATHS, SOLAR } from './base';
import type { BaseView, Collider, SpotId } from './base';
import { disposeTree } from './build';
import { CameraRig } from './cameraRig';
import { Crew } from './crew';
import { Daylight } from './daylight';
import { DustDevils } from './devils';
import { Engine } from './engine';
import { Eva } from './eva';
import type { EvaConfig } from './eva';
import { DustMotes, Puffs, Tracks } from './fx';
import { Input } from './input';
import { Interior } from './interior';
import { Placer } from './placer';
import type { DecorItem } from '../sim/outpost';
import type { RoomLook } from './interior';
import type { RoomId } from '../sim/outpost';
import { Lumi } from './lumi';
import type { Mood } from './lumi';
import { Props } from './props';
import { Rover } from './rover';
import { Scenery } from './scenery';
import type { QualityOptions } from './quality';
import { Sky } from './sky';
import { buildTerrain } from './terrain';
import type { TerrainBuild } from './terrain';

export type WorldMode = 'title' | 'overview' | 'focus' | 'eva' | 'cinema';
/** The shots of the intro film (see `cinematic`). */
export type CineShot = 'approach' | 'touchdown' | 'base' | 'crew' | 'goal';
export type MarkerId = 'life' | 'farm' | 'lab' | 'shield' | 'power';

/** Points above each building where the UI pins its labels. */
const MARKER_POINTS: Record<MarkerId, THREE.Vector3> = {
  life: new THREE.Vector3(HAB.x, 9.6, HAB.z),
  farm: new THREE.Vector3(FARM.x, 6.4, FARM.z),
  lab: new THREE.Vector3(LAB.x, 10.6, LAB.z),
  shield: new THREE.Vector3(HAB.x + 9.2, 5.2, HAB.z - 6.5),
  power: new THREE.Vector3(SOLAR.x, 6.2, SOLAR.z),
};

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

export class World {
  readonly engine: Engine;
  readonly rig: CameraRig;
  readonly input: Input;
  site: SiteId = 'mars';
  mode: WorldMode = 'overview';
  ready = false;
  /** Freeze the walk outside and the clock (a menu is open). The picture keeps drawing. */
  paused = false;
  /** Calmer camera for players who asked for less motion. */
  calm = false;

  sky!: Sky;
  daylight!: Daylight;
  terrain!: TerrainBuild;
  base!: Base;
  props!: Props;
  rover!: Rover;
  scenery!: Scenery;
  annex!: Annex;
  astronaut!: Astronaut;
  crew!: Crew;
  lumi!: Lumi;
  eva!: Eva;
  /** The inside of a building, when the cadet is in one. */
  interior!: Interior;
  /** Creative mode: putting things on the ground. */
  placer!: Placer;
  private decor: readonly DecorItem[] = [];
  /** What the camera was doing before the cadet went inside. */
  private outsideMode: WorldMode = 'overview';
  puffs!: Puffs;
  tracks!: Tracks;
  dust: DustMotes | null = null;
  /** Mars only: whirls of dust out on the plain. */
  devils: DustDevils | null = null;
  /** Something worth a word from Lumi came into view during a walk. */
  onSight: ((what: 'devil') => void) | null = null;
  private sightTimer = 0;

  /** Mars: time of day, 0-1 (wraps). Moon: the Sun's compass position in turns. */
  private clock = 0.4;
  private clockGoal = 0.4;
  private clockSpeed = 0;
  private clockDone: (() => void) | null = null;
  private sunHidden = 0;
  private sunHiddenGoal = 0;
  private dustGoal = 0;
  private stormGoal = 0;
  private suitColor: string = SUIT_COLORS[0];
  private crewOutside = true;
  /** What the game last asked the outpost to look like, kept so a rebuilt scene looks the same. */
  private readonly view: Partial<BaseView> = {};
  /** What the game last said about the new buildings, kept so a rebuilt scene looks the same. */
  private outpost: PlotView[] = [];
  private mood: Mood = 'calm';
  private spot: SpotId | undefined;
  /** A cheaper scene is wanted, but a walk outside is under way: rebuild when it ends. */
  private rebuildWaiting = false;
  private waveTimer = 4;
  private readonly root = new THREE.Group();
  private readonly focus = new THREE.Vector3();
  private readonly colliders: Collider[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, quality: QualityOptions) {
    this.engine = new Engine(canvas, quality);
    this.rig = new CameraRig(this.engine.camera);
    this.input = new Input(canvas);
    this.input.onLook = (yaw, pitch) => {
      // A focused view stays still, but inside a building the player always looks around.
      if (this.mode !== 'focus' || this.interior?.active) this.rig.rotate(yaw, pitch);
    };
    this.input.onZoom = (factor) => this.rig.zoom(factor);
    this.engine.scene.add(this.root);
    this.engine.onUpdate((dt, time) => this.update(dt, time));
    this.engine.onResized((w, h) => {
      this.rig.aspectScale = w / h < 0.8 ? 1.5 : w / h < 1.2 ? 1.22 : 1;
    });
  }

  /** Build (or rebuild) the scene for a world. */
  build(site: SiteId): void {
    // The walk's listeners belong to the game, not to one scene: carry them over.
    const listeners = this.ready ? { onHud: this.eva.onHud, onEvent: this.eva.onEvent, onFinish: this.eva.onFinish, onView: this.eva.onView, firstPerson: this.eva.firstPerson } : null;
    const inside = this.ready ? { onHud: this.interior.onHud, onUse: this.interior.onUse, onStep: this.interior.onStep } : null;
    this.clear();
    this.rebuildWaiting = false;
    this.site = site;
    const quality = this.engine.quality;

    this.terrain = buildTerrain(site, quality.terrain, PATHS);
    const height = this.terrain.info.height;
    this.sky = new Sky({ detail: quality.skyDetail, withEarth: site === 'moon', sunSize: site === 'moon' ? 0.02 : 0.026 });
    this.base = new Base(site);
    this.base.setView(this.view);
    this.props = new Props(site, height, quality.rocks, quality.shadows);
    this.scenery = new Scenery(site, height);
    this.annex = new Annex(height);
    this.annex.setView(this.outpost);
    this.base.setBuildSite(this.annex.activeSite());
    this.rover = new Rover(this.props.rover, this.props.roverColliders, height, site);
    this.astronaut = new Astronaut(this.suitColor, quality.outlines);
    // Fewer crew on slower devices: each cadet is a full model.
    this.crew = new Crew(quality.tier === 'low' ? 0 : quality.tier === 'medium' ? 1 : 2, quality.outlines, height, site === 'moon');
    this.crew.setOutside(this.crewOutside);
    this.lumi = new Lumi(quality.outlines, quality.pointLights);
    this.lumi.setMood(this.mood);
    this.puffs = new Puffs(site);
    this.tracks = new Tracks(site);

    this.colliders.length = 0;
    this.colliders.push(...this.base.colliders, ...this.props.colliders, ...this.scenery.colliders, ...this.annex.colliders);
    const crater = this.terrain.info.iceCrater;
    // The ice chore sits on the rim of the dark crater, on the side facing the outpost.
    const icePoint = crater
      ? (() => {
          const distance = Math.hypot(crater.x, crater.z);
          const scale = (distance - crater.r * 0.82) / distance;
          return { x: crater.x * scale, z: crater.z * scale };
        })()
      : null;
    this.eva = new Eva(this.astronaut, this.rig, this.puffs, height, this.colliders, icePoint, this.tracks, this.rover);
    this.eva.onFov = (scale) => this.engine.setFovScale(scale);
    if (listeners) Object.assign(this.eva, listeners);
    this.interior = new Interior(this.astronaut, this.lumi, this.rig, {
      shadows: quality.shadows,
      shadowSize: quality.shadowSize,
      pointLights: quality.pointLights,
      outlines: quality.outlines,
      suit: () => this.suitColor,
    });
    if (inside) Object.assign(this.interior, inside);
    this.placer = new Placer(this.engine.camera, this.engine.canvas, this.colliders, height);
    this.annex.setDecor(this.decor);

    this.root.add(
      this.sky.mesh,
      this.terrain.mesh,
      this.terrain.mountains,
      this.base.group,
      this.props.group,
      this.scenery.group,
      this.annex.group,
      this.placer.group,
      this.astronaut.group,
      this.crew.group,
      this.lumi.group,
      this.eva.group,
      this.puffs.group,
      this.tracks.mesh,
    );
    if (this.sky.earth) this.root.add(this.sky.earth);
    if (site === 'mars') {
      this.dust = new DustMotes(Math.round(900 * quality.particles), '#e8b48a');
      this.root.add(this.dust.points);
      this.devils = new DustDevils(height, quality.tier === 'high' || quality.tier === 'ultra' ? 2 : 1);
      this.root.add(this.devils.group);
    }

    this.daylight = new Daylight(this.engine.scene, this.sky, this.engine.post, site, this.terrain.mountains);
    this.daylight.configureShadows(quality.shadowSize, quality.shadows);

    this.rig.heightAt = height;
    this.rig.blockers = this.colliders;
    this.clock = this.clockGoal = site === 'mars' ? 0.4 : 0.12;
    this.clockSpeed = 0;
    this.sunHidden = this.sunHiddenGoal = 0;
    this.dustGoal = this.stormGoal = 0;
    this.ready = true;
    this.setMode('overview', undefined, true);
  }

  private clear(): void {
    if (!this.ready) return;
    this.ready = false;
    if (this.interior.active) {
      this.interior.close();
      this.engine.view = null;
      this.engine.setFovScale(1);
    }
    this.interior.dispose();
    this.placer.dispose();
    this.daylight.dispose();
    this.base.dispose();
    this.props.dispose();
    this.scenery.dispose();
    this.annex.dispose();
    this.terrain.dispose();
    this.sky.dispose();
    this.astronaut.dispose();
    this.crew.dispose();
    this.lumi.dispose();
    this.eva.dispose();
    this.puffs.dispose();
    this.tracks.dispose();
    this.dust?.dispose();
    this.dust = null;
    this.devils?.dispose();
    this.devils = null;
    disposeTree(this.root);
    this.root.clear();
  }

  setQuality(quality: QualityOptions): void {
    const previous = this.engine.quality;
    const rebuild =
      this.ready &&
      (quality.terrain !== previous.terrain ||
        quality.skyDetail !== previous.skyDetail ||
        quality.rocks !== previous.rocks ||
        quality.outlines !== previous.outlines ||
        quality.particles !== previous.particles ||
        quality.pointLights !== previous.pointLights ||
        quality.shadows !== previous.shadows);
    this.engine.setQuality(quality);
    if (this.ready) this.daylight.configureShadows(quality.shadowSize, quality.shadows);
    if (!rebuild) return;
    // The picture gets cheaper at once. The scene itself cannot be swapped under a
    // player who is walking outside, so that part waits until the walk ends.
    if (this.eva.active || this.interior.active) this.rebuildWaiting = true;
    else this.rebuild();
  }

  /** Build the scene again for a new quality level and put everything back as it was. */
  private rebuild(): void {
    const mode = this.mode === 'eva' ? 'overview' : this.mode;
    const spot = this.spot;
    // A running clock (the night) keeps running, and whoever waits for it is still told.
    const clock = { now: this.clock, goal: this.clockGoal, speed: this.clockSpeed, done: this.clockDone };
    const sky = { dust: this.dustGoal, storm: this.stormGoal, hidden: this.sunHiddenGoal };
    this.build(this.site);
    this.clock = clock.now;
    this.clockGoal = clock.goal;
    this.clockSpeed = clock.speed;
    this.clockDone = clock.done;
    this.setWeather({ dust: sky.dust, storm: sky.storm, sunHidden: sky.hidden }, true);
    this.setMode(mode, spot, true);
  }

  setSuitColor(color: string): void {
    this.suitColor = color;
    if (this.ready) this.astronaut.setColor(color);
  }

  setView(view: Partial<BaseView>): void {
    Object.assign(this.view, view);
    if (this.ready) this.base.setView(view);
  }

  /** Whether the rest of the crew is out working (false in storms and at night). */
  setCrewOutside(outside: boolean): void {
    this.crewOutside = outside;
    if (this.ready) this.crew.setOutside(outside);
  }

  /** Creative mode: the decorations set out around the outpost. */
  setDecor(items: readonly DecorItem[]): void {
    this.decor = items;
    if (this.ready) this.annex.setDecor(items);
  }

  /** Models fetched after the start have arrived: swap stand-ins for them. */
  refreshModels(): void {
    if (!this.ready) return;
    this.annex.refreshModels();
    this.annex.setView(this.outpost);
    this.annex.setDecor(this.decor);
  }

  /** The new buildings: empty plot, being built, or finished. */
  setOutpost(views: PlotView[]): void {
    this.outpost = views;
    if (!this.ready) return;
    this.annex.setView(views);
    this.base.setBuildSite(this.annex.activeSite());
  }

  setMood(mood: Mood): void {
    this.mood = mood;
    if (this.ready) this.lumi.setMood(mood);
  }

  /** Change what the camera is doing. */
  setMode(mode: WorldMode, spot?: SpotId, instant = false): void {
    if (!this.ready) return;
    this.mode = mode;
    this.spot = mode === 'focus' ? spot : undefined;
    const rig = this.rig;
    // On a walk and in the intro film the camera does not sit behind rocks and buildings.
    rig.avoidBlockers = mode === 'eva' || mode === 'cinema';
    // The first-person view belongs to the walk only.
    if (mode !== 'eva') this.eva.endView();
    switch (mode) {
      case 'title':
        // The cadet stands by the rover and watches the Sun go down behind the outpost.
        this.eva.pose(13.9, 12.3, 1.14); // turned toward the camera, to greet the player
        rig.setSpot({ target: new THREE.Vector3(6, 2.5, 10.6), distance: 17, yaw: 1.45, pitch: 0.07 }, instant);
        rig.autoRotate = 0; // the title view sways instead (see update)
        rig.minDistance = 12;
        rig.maxDistance = 40;
        rig.minPitch = 0.04;
        rig.maxPitch = 0.7;
        this.lumi.goal.set(12.7, 2.3, 13.7);
        this.lumi.snap();
        break;
      case 'overview':
        if (!this.eva.active) this.eva.placeAtAirlock();
        rig.setSpot(this.base.spots.overview, instant);
        rig.autoRotate = 0.02;
        rig.minDistance = 26;
        rig.maxDistance = 105;
        rig.minPitch = 0.14;
        rig.maxPitch = 1.2;
        this.lumi.goal.set(3.4, 3.4, 2.6);
        if (instant) this.lumi.snap();
        break;
      case 'focus':
        rig.setSpot(this.base.spots[spot ?? 'overview'], instant);
        // Far views (the sky, the horizon) stay still; close views drift a little.
        rig.autoRotate = this.base.spots[spot ?? 'overview'].distance > 45 ? 0 : 0.012;
        rig.minDistance = 8;
        rig.maxDistance = 105;
        rig.minPitch = -0.3;
        rig.maxPitch = 1.2;
        break;
      case 'cinema':
        // The film moves the camera itself (see `cinematic`).
        rig.autoRotate = 0;
        rig.minDistance = 3;
        rig.maxDistance = 140;
        rig.minPitch = -0.6;
        rig.maxPitch = 1.3;
        break;
      case 'eva':
        rig.autoRotate = 0;
        rig.minDistance = 3.2;
        rig.maxDistance = 20;
        rig.minPitch = 0.08;
        rig.maxPitch = 1.15;
        break;
    }
    if (instant) rig.snap();
  }

  /** Step into a building. The room replaces the outside until `leaveRoom`. */
  enterRoom(room: RoomId, look: RoomLook): void {
    if (!this.ready) return;
    if (!this.interior.active) this.outsideMode = this.mode;
    this.eva.endView(); // the room has its own camera
    this.interior.open(room, look);
    this.engine.view = this.interior.scene;
    this.engine.setFovScale(1.14);
  }

  /** Back outside: on a walk, at the door; otherwise the overview as before. */
  leaveRoom(): void {
    if (!this.ready || !this.interior.active) return;
    this.interior.close();
    this.root.add(this.astronaut.group, this.lumi.group);
    this.engine.view = null;
    this.engine.setFovScale(1);
    if (this.outsideMode === 'eva' && this.eva.active) {
      this.setMode('eva');
      this.eva.resync();
      this.updateLumi(0);
      this.lumi.snap();
    } else {
      this.setMode(this.outsideMode === 'eva' ? 'overview' : this.outsideMode, this.spot, true);
      this.lumi.snap();
    }
  }

  // ----- Intro film ------------------------------------------------------------

  private cine: { shot: CineShot; time: number; landing: number; landed: boolean; dustTimer: number } | null = null;
  private readonly cineTarget = new THREE.Vector3();

  /**
   * One shot of the intro film. approach: the lander comes down from the sky, seen from
   * the ground; touchdown: it lands in a cloud of dust; base: a slow flight round the
   * outpost; crew: the cadet and Lumi; goal: a quiet wide view behind the mission card.
   */
  cinematic(shot: CineShot): void {
    if (!this.ready) return;
    const first = !this.cine;
    if (first) {
      this.setMode('cinema');
      this.cine = { shot, time: 0, landing: 0, landed: false, dustTimer: 0 };
      this.props.lander.position.y = 46;
      this.props.landerFlame.visible = true;
      // The other two cadets stay out of the shots.
      this.crew.group.visible = false;
    }
    const cine = this.cine!;
    cine.shot = shot;
    cine.time = 0;
    const rig = this.rig;
    const pad = this.props.lander.position;
    switch (shot) {
      case 'approach':
        rig.setSpot({ target: new THREE.Vector3(pad.x, 47.5, pad.z), distance: 94, yaw: 2.35, pitch: -0.5 }, first);
        break;
      case 'touchdown':
        // Tapping on early: the lander does not wait in the air.
        cine.landing = Math.max(cine.landing, 0.8);
        if (cine.landed) rig.setSpot({ target: new THREE.Vector3(pad.x, 2.4, pad.z), distance: 24, yaw: 2.45, pitch: 0.08 });
        break;
      case 'base':
        this.finishLanding();
        rig.setSpot(this.base.spots.overview);
        break;
      case 'crew': {
        this.finishLanding();
        // The cadet waits by the rover, turned to the camera, with Lumi beside.
        this.eva.pose(13.9, 12.3, 1.14);
        const ground = this.terrain.info.height(13.9, 12.3);
        rig.setSpot({ target: new THREE.Vector3(13.9, ground + 0.75, 12.3), distance: 7.6, yaw: 1.3, pitch: 0.14 });
        // Lumi floats at the cadet's shoulder, on the camera's side.
        this.lumi.goal.set(13.9 + Math.sin(1.3) * 0.9 - Math.cos(1.3) * 1.1, ground + 2.15, 12.3 + Math.cos(1.3) * 0.9 + Math.sin(1.3) * 1.1);
        this.astronaut.play('wave');
        setTimeout(() => this.ready && this.cine?.shot === 'crew' && this.astronaut.play('none'), 2400);
        break;
      }
      case 'goal':
        this.finishLanding();
        rig.setSpot({ ...this.base.spots.overview, distance: this.base.spots.overview.distance * 1.15 });
        break;
    }
  }

  /** The film is over: the lander stands on its pad and the camera goes back to the outpost. */
  endCinematic(): void {
    if (!this.cine) return;
    this.finishLanding();
    this.cine = null;
    this.crew.group.visible = true;
    this.setMode('overview');
  }

  private finishLanding(): void {
    const cine = this.cine;
    if (!cine) return;
    cine.landing = 1;
    cine.landed = true;
    this.props.lander.position.y = 0;
    this.props.landerFlame.visible = false;
  }

  private updateCinema(dt: number, time: number): void {
    const cine = this.cine;
    if (!cine) return;
    cine.time += dt;
    const lander = this.props.lander;
    if (!cine.landed) {
      // About eight seconds from high in the sky, slowing all the way down.
      cine.landing = Math.min(1, cine.landing + dt / 8);
      const t = cine.landing;
      const height = 46 * (1 - t) ** 2.4;
      lander.position.y = height;
      const flame = this.props.landerFlame;
      const flicker = 0.9 + Math.sin(time * 41) * 0.06 + Math.sin(time * 67) * 0.05;
      flame.scale.set(flicker, 0.85 + 0.35 * Math.min(1, height / 6) * flicker, flicker);
      // Dust is blown off the pad as the engine comes close to the ground.
      if (height < 9) {
        cine.dustTimer -= dt;
        if (cine.dustTimer <= 0) {
          cine.dustTimer = 0.05;
          const angle = Math.random() * Math.PI * 2;
          const reach = 2 + Math.random() * 3.5;
          this.tmp2.set(lander.position.x + Math.cos(angle) * reach, 0.1, lander.position.z + Math.sin(angle) * reach);
          this.puffs.step(this.tmp2);
        }
      }
      if (cine.shot === 'approach' || cine.shot === 'touchdown') {
        // The camera stays low on the ground and looks up at the lander as it comes down.
        const aim = Math.max(2.4, height + 1.5);
        const distance = Math.max(cine.shot === 'approach' ? 34 : 24, (aim - 2.2) / 0.48);
        const pitch = -Math.asin(Math.min(0.48, Math.max(0, (aim - 2.2) / distance)));
        this.rig.setSpot({ target: this.cineTarget.set(lander.position.x, aim, lander.position.z), distance, yaw: cine.shot === 'approach' ? 2.35 : 2.45, pitch: Math.min(pitch, 0.1) });
      }
      if (t >= 1) {
        cine.landed = true;
        lander.position.y = 0;
        this.props.landerFlame.visible = false;
        this.rig.addShake(0.5);
        this.onCine?.('touchdown');
        for (let i = 0; i < 16; i++) {
          const angle = (i / 16) * Math.PI * 2;
          this.tmp2.set(lander.position.x + Math.cos(angle) * 3, 0.1, lander.position.z + Math.sin(angle) * 3);
          this.puffs.step(this.tmp2);
        }
      }
    }
    if (cine.shot === 'base' || cine.shot === 'goal') this.rig.rotate(dt * 0.035, 0);
    if (cine.shot === 'crew') this.rig.rotate(dt * 0.02, 0);
  }

  /** Things that happen during the film, for sound. */
  onCine: ((what: 'touchdown') => void) | null = null;

  lookAt(spot: SpotId, instant = false): void {
    this.setMode('focus', spot, instant);
  }

  startEva(config: EvaConfig): void {
    if (!this.ready) return;
    this.setMode('eva');
    this.eva.start(config);
  }

  /** Jump to a time (Mars: fraction of the day. Moon: Sun position in turns). */
  setClock(value: number): void {
    this.clock = this.clockGoal = value;
    this.clockSpeed = 0;
    // Nobody is left waiting for a clock that was stopped.
    const done = this.clockDone;
    this.clockDone = null;
    done?.();
  }

  getClock(): number {
    return this.clock;
  }

  /** Run the clock forward to a value over some seconds. Resolves when it arrives. */
  runClock(to: number, seconds: number): Promise<void> {
    return new Promise((resolve) => {
      this.clockDone?.();
      this.clockGoal = to;
      this.clockSpeed = (to - this.clock) / Math.max(0.01, seconds);
      if (this.clockSpeed === 0) {
        resolve();
        return;
      }
      this.clockDone = resolve;
    });
  }

  setWeather(options: { dust?: number; storm?: number; sunHidden?: number }, instant = false): void {
    if (options.dust !== undefined) this.dustGoal = options.dust;
    if (options.storm !== undefined) this.stormGoal = options.storm;
    if (options.sunHidden !== undefined) this.sunHiddenGoal = options.sunHidden;
    if (instant && this.ready) {
      this.daylight.dust = this.dustGoal;
      this.daylight.storm = this.stormGoal;
      this.sunHidden = this.sunHiddenGoal;
    }
  }

  private readonly sightPoint: ScreenPoint = { x: 0, y: 0, visible: false };

  /** A dust devil crosses the solar field (the "lucky whirlwind" card on Mars). */
  dustDevilAcrossPanels(): void {
    this.devils?.spawn({ x: SOLAR.x - 34, z: SOLAR.z - 14 }, { x: SOLAR.x + 30, z: SOLAR.z + 12 }, 26);
  }

  /** Where a building label should sit on the screen, in CSS pixels. */
  projectMarker(id: MarkerId, out: ScreenPoint): ScreenPoint {
    return this.project(MARKER_POINTS[id], out);
  }

  project(point: THREE.Vector3, out: ScreenPoint): ScreenPoint {
    const v = this.tmp.copy(point).project(this.engine.camera);
    out.visible = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    out.x = (v.x * 0.5 + 0.5) * this.engine.width;
    out.y = (-v.y * 0.5 + 0.5) * this.engine.height;
    return out;
  }

  private update(dt: number, time: number): void {
    if (!this.ready) return;

    if (this.rebuildWaiting && !this.eva.active && !this.interior.active) this.rebuild();
    this.rig.calm = this.calm;
    this.input.enabled = !this.paused;
    if (this.interior.active) {
      // Inside a building: only the room lives; the outside waits.
      const input = this.input.read(dt);
      this.interior.update(dt, time, input, this.paused);
      this.rig.update(dt, time);
      this.engine.camera.updateMatrixWorld();
      this.interior.applyLook(this.engine.camera, this.engine.post);
      return;
    }
    // Clock.
    if (this.clockSpeed !== 0 && !this.paused) {
      this.clock += this.clockSpeed * dt;
      const arrived =
        (this.clockSpeed > 0 && this.clock >= this.clockGoal) || (this.clockSpeed < 0 && this.clock <= this.clockGoal);
      if (arrived) {
        this.clock = this.clockGoal;
        this.clockSpeed = 0;
        const done = this.clockDone;
        this.clockDone = null;
        done?.();
      }
    }
    const ease = Math.min(1, dt * 1.4);
    const storm = Math.max(this.stormGoal, this.eva.alertLevel);
    this.daylight.dust += (this.dustGoal - this.daylight.dust) * ease;
    this.daylight.storm += (storm - this.daylight.storm) * Math.min(1, dt * 2.5);
    this.sunHidden += (this.sunHiddenGoal - this.sunHidden) * ease;
    if (this.site === 'mars') this.daylight.setDayFraction(((this.clock % 1) + 1) % 1);
    else this.daylight.setPolarSun(this.clock * Math.PI * 2, this.sunHidden);

    // Player and helper.
    const input = this.input.read(dt);
    if (!this.paused) this.eva.update(dt, input, time);
    this.updateLumi(dt);
    if (this.mode === 'cinema') this.updateCinema(dt, time);
    if (this.mode === 'title') {
      // A slow sway around the hero angle keeps the cadet, the rover and the outpost in the picture.
      if (this.rig.idle > 4 && !this.calm) this.rig.setAngles(1.45 + Math.sin(time * 0.16) * 0.2, 0.07 + Math.sin(time * 0.11) * 0.012);
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.astronaut.play('wave');
        this.waveTimer = 9;
        setTimeout(() => this.ready && this.mode === 'title' && this.astronaut.play('none'), 2200);
      }
    }

    this.rig.update(dt, time);
    this.focus.copy(this.mode === 'eva' ? this.eva.position : this.rig.target);
    this.focus.y = 0;
    this.daylight.update(this.engine.camera, time, this.focus);
    this.base.update(dt, time, this.daylight.sunDir);
    this.props.update(time);
    this.annex.update(dt, time);
    this.placer.update(time);
    this.puffs.update(dt);
    if (!this.paused && !this.cine) this.crew.update(dt);
    if (this.devils) {
      // Whirls start only on calm, sunny days: not at night and not in a dust storm.
      this.devils.update(dt, time, this.daylight.night < 0.3 && this.daylight.dust < 0.3);
      if (this.mode === 'eva' && this.eva.active) {
        this.sightTimer -= dt;
        if (this.sightTimer <= 0) {
          this.sightTimer = 1;
          const near = this.devils.nearest(this.eva.position.x, this.eva.position.z);
          if (near && near.distance < 190) {
            this.tmp2.set(near.x, this.terrain.info.height(near.x, near.z) + 12, near.z);
            if (this.project(this.tmp2, this.sightPoint).visible) this.onSight?.('devil');
          }
        }
      }
    }
    if (this.dust) {
      this.dust.storm = this.daylight.dust;
      this.dust.update(time, this.engine.camera, this.engine.height);
    }
  }

  /** Seconds the walking cadet has stood still (Lumi then looks at the camera). */
  private lumiStill = 0;

  private updateLumi(dt: number): void {
    const lumi = this.lumi;
    const camera = this.engine.camera;
    if (this.mode === 'eva') {
      // Fly beside the player, a little ahead, and look where they are going.
      const yaw = this.astronaut.group.rotation.y;
      const p = this.eva.position;
      lumi.goal.set(p.x + Math.cos(yaw) * 1.1 + Math.sin(yaw) * 0.5, p.y + 2.05, p.z - Math.sin(yaw) * 1.1 + Math.cos(yaw) * 0.5);
      // Standing still for a moment, Lumi turns round and looks at the player.
      this.lumiStill = this.eva.speed < 0.35 ? this.lumiStill + dt : 0;
      if (this.lumiStill > 1.2) lumi.lookTarget.copy(camera.position);
      else lumi.lookTarget.set(p.x + Math.sin(yaw) * 6, p.y + 1.4, p.z + Math.cos(yaw) * 6);
    } else if (this.mode === 'focus' && this.rig.distance < 45) {
      // Hover near whatever the camera is looking at, on the camera's side.
      this.tmp2.copy(camera.position).sub(this.rig.target).setY(0).normalize();
      lumi.goal.copy(this.rig.target).addScaledVector(this.tmp2, Math.min(9, this.rig.distance * 0.42));
      lumi.goal.x += this.tmp2.z * 4;
      lumi.goal.z -= this.tmp2.x * 4;
      lumi.goal.y = Math.max(2.4, this.rig.target.y * 0.6 + 1.6);
      lumi.lookTarget.copy(camera.position);
    } else {
      lumi.lookTarget.copy(camera.position);
    }
    lumi.update(dt, this.daylight.night);
  }

  /** Numbers for the performance display. */
  stats(): { fps: number; calls: number; triangles: number; scale: number } {
    const info = this.engine.renderer.info.render;
    return { fps: Math.round(this.engine.fps), calls: info.calls, triangles: info.triangles, scale: this.engine.dynamicScale };
  }

  start(): void {
    this.engine.start();
  }

  dispose(): void {
    this.clear();
    this.input.dispose();
    this.engine.dispose();
  }
}

export { AIRLOCK, BATTERY };
