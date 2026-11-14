/**
 * New buildings around the outpost (see sim/outpost.ts). Each has its own plot.
 * An empty plot shows its marked-out ground; while the builder robot works on it,
 * scaffolding stands round a glowing plan of the building; when finished, the real
 * building stands there. Models come from annex.glb (scripts/models/annex.py).
 */
import * as THREE from 'three';
import type { BuildingId, DecorItem } from '../sim/outpost';
import { makeProp, propRadius } from './interior';
import type { Collider } from './base';
import { disposeTree } from './build';
import { canvasTexture, glass, glow, lamp, toon } from './materials';
import { hasModel, modelPart } from './models';

/** Where each new building stands. All face the middle of the outpost. */
export const PLOTS: Record<BuildingId, { x: number; z: number }> = {
  workshop: { x: 31, z: -6 },
  oxygen: { x: -31, z: -16 },
  solar_array: { x: -34, z: 22 },
  garden: { x: -2, z: 32 },
  observatory: { x: 24, z: -26 },
  bunker: { x: -14, z: -33 },
};

/** Distance from a building's middle to its front door, metres (from the models). */
const DOOR: Record<BuildingId, number> = {
  workshop: 3.15,
  oxygen: 1.9,
  // No door: the junction box is about here.
  solar_array: 3.2,
  garden: 4.01,
  observatory: 2.78,
  bunker: 3.53,
};

/** Accent colour of each building, used for its plot marks and plan. */
export const ACCENT: Record<BuildingId, string> = {
  workshop: '#ffb347',
  oxygen: '#5fd0ff',
  solar_array: '#ffd166',
  garden: '#5fe39a',
  observatory: '#b79cff',
  bunker: '#ff9860',
};

/** The way a building faces: toward the middle of the outpost. */
export function plotHeading(id: BuildingId): number {
  const plot = PLOTS[id];
  return Math.atan2(-plot.x, -plot.z);
}

/** The spot in front of a building's door, and the way the door faces. In creative mode the building may stand elsewhere. */
export function doorOf(id: BuildingId, place?: { x: number; z: number; heading: number }): { x: number; z: number; heading: number } {
  const plot = place ?? PLOTS[id];
  const heading = place ? place.heading : plotHeading(id);
  const reach = DOOR[id] + 1.2;
  return { x: plot.x + Math.sin(heading) * reach, z: plot.z + Math.cos(heading) * reach, heading };
}

export interface PlotView {
  id: BuildingId;
  state: 'empty' | 'building' | 'done';
  /** Share of the robot's work done, 0-1. */
  progress: number;
  /** Creative mode: where the player put it, and no marked plot while it is not there. */
  x?: number;
  z?: number;
  heading?: number;
  free?: boolean;
}

interface Slot {
  id: BuildingId;
  root: THREE.Group;
  pad: THREE.Group;
  scaffold: THREE.Group;
  plan: THREE.Object3D | null;
  building: THREE.Object3D | null;
  dome: THREE.Object3D | null;
  collider: Collider;
  state: PlotView['state'];
  /** Seconds since the building appeared (for its little pop). */
  shown: number;
}

const always = { value: 1 };

export class Annex {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  private readonly slots = new Map<BuildingId, Slot>();
  private readonly own: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly paint = toon({ color: '#ffffff', rim: 0.42, vertexColors: true });
  private readonly planMaterial: THREE.MeshBasicMaterial;
  /** Creative-mode decorations, and the colliders kept for them. */
  private readonly decorGroup = new THREE.Group();
  private readonly decorColliders: Collider[] = [];
  private decorKey = '';
  private readonly ghostMaterial: THREE.MeshBasicMaterial;

  constructor(private readonly height: (x: number, z: number) => number) {
    this.group.name = 'annex';
    this.planMaterial = this.keep(
      new THREE.MeshBasicMaterial({ color: '#7fdcff', transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    for (const id of Object.keys(PLOTS) as BuildingId[]) this.slots.set(id, this.makeSlot(id));
    this.ghostMaterial = this.keep(
      new THREE.MeshBasicMaterial({ color: '#7fe9ff', transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.decorGroup.name = 'decor';
    this.group.add(this.decorGroup);
    // Room for decorations to stop the cadet; unused ones have no size.
    for (let i = 0; i < 64; i++) {
      const collider: Collider = { x: 0, z: 0, r: 0 };
      this.decorColliders.push(collider);
      this.colliders.push(collider);
    }
  }

  /** The collider of a building, so a building being moved does not bump into itself. */
  colliderOf(id: BuildingId): Collider | null {
    return this.slots.get(id)?.collider ?? null;
  }

  /** A see-through copy of a building or a decoration, for placing it. */
  ghost(kind: 'building' | 'decor', id: string): THREE.Object3D {
    const object = kind === 'building' ? this.makeBuilding(id as BuildingId, true) : makeProp(id).clone(true);
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = this.ghostMaterial;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.noOutline = true;
    });
    return object;
  }

  /** Creative mode: put the decorations where the game says. */
  setDecor(items: readonly DecorItem[]): void {
    // Built again once the furniture model has arrived (until then the decorations are stand-ins).
    const key = JSON.stringify(items) + (hasModel('interior') ? ':model' : '');
    if (key === this.decorKey) return;
    this.decorKey = key;
    disposeTree(this.decorGroup);
    this.decorGroup.clear();
    this.decorColliders.forEach((collider) => (collider.r = 0));
    items.forEach((item, index) => {
      const object = makeProp(item.id);
      object.position.set(item.x, this.height(item.x, item.z), item.z);
      object.rotation.y = item.heading;
      this.decorGroup.add(object);
      const collider = this.decorColliders[index];
      if (collider) Object.assign(collider, { x: item.x, z: item.z, r: Math.max(0.3, propRadius(item.id) - 0.25) });
    });
  }

  private keep<T extends THREE.Material>(material: T): T {
    this.own.push(material);
    return material;
  }

  private makeSlot(id: BuildingId): Slot {
    const plot = PLOTS[id];
    const root = new THREE.Group();
    root.position.set(plot.x, this.height(plot.x, plot.z), plot.z);
    root.rotation.y = plotHeading(id);
    root.name = `plot-${id}`;
    this.group.add(root);

    const pad = this.makePad(id);
    const scaffold = this.makeScaffold(id);
    scaffold.visible = false;
    root.add(pad, scaffold);

    // The building stops the cadet once its scaffolding goes up.
    const collider: Collider = { x: plot.x, z: plot.z, r: 0 };
    this.colliders.push(collider);
    return { id, root, pad, scaffold, plan: null, building: null, dome: null, collider, state: 'empty', shown: 0 };
  }

  /** Marked-out ground: a square of dashed lines in the building's colour, with a stake at each corner. */
  private makePad(id: BuildingId): THREE.Group {
    const group = new THREE.Group();
    const accent = ACCENT[id];
    const texture = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
      ctx.fillRect(10, 10, w - 20, h - 20);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 9;
      ctx.setLineDash([26, 18]);
      ctx.strokeRect(14, 14, w - 28, h - 28);
      ctx.setLineDash([]);
      ctx.lineWidth = 6;
      // A plus sign in the middle: something can be built here.
      ctx.beginPath();
      ctx.moveTo(w / 2 - 26, h / 2);
      ctx.lineTo(w / 2 + 26, h / 2);
      ctx.moveTo(w / 2, h / 2 - 26);
      ctx.lineTo(w / 2, h / 2 + 26);
      ctx.stroke();
    });
    const markMaterial = this.keep(
      new THREE.MeshBasicMaterial({ map: texture, color: accent, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    const plane = new THREE.PlaneGeometry(8.6, 8.6);
    plane.rotateX(-Math.PI / 2);
    this.geometries.push(plane);
    const mark = new THREE.Mesh(plane, markMaterial);
    mark.position.y = 0.05;
    mark.renderOrder = 2;
    mark.userData.noOutline = true;
    group.add(mark);

    const post = new THREE.CylinderGeometry(0.06, 0.08, 0.9, 8);
    post.translate(0, 0.45, 0);
    const bulb = new THREE.SphereGeometry(0.11, 10, 8);
    bulb.translate(0, 0.95, 0);
    this.geometries.push(post, bulb);
    const postMaterial = toon({ color: '#3a4260', rim: 0.25 });
    const bulbMaterial = this.keep(lamp(accent, always, { day: 1.2, night: 3.8 }));
    for (const [x, z] of [
      [-4.3, -4.3],
      [4.3, -4.3],
      [-4.3, 4.3],
      [4.3, 4.3],
    ]) {
      const stake = new THREE.Mesh(post, postMaterial);
      stake.position.set(x, 0, z);
      const light = new THREE.Mesh(bulb, bulbMaterial);
      light.position.set(x, 0, z);
      group.add(stake, light);
    }
    return group;
  }

  /** Scaffolding: corner posts, two rings of beams and cross braces, in safety orange. */
  private makeScaffold(id: BuildingId): THREE.Group {
    const group = new THREE.Group();
    const tall = id === 'solar_array' ? 2.6 : 5.4;
    const half = 4.0;
    const beam = toon({ color: '#ff9f43', rim: 0.3 });
    const dark = toon({ color: '#3a4260', rim: 0.2 });
    const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, turn = 0, tilt = 0): void => {
      const geometry = new THREE.BoxGeometry(w, h, d);
      this.geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(tilt, turn, 0);
      mesh.castShadow = true;
      group.add(mesh);
    };
    for (const x of [-half, half]) {
      for (const z of [-half, half]) addBox(0.16, tall, 0.16, x, tall / 2, z, dark);
    }
    for (const y of [tall * 0.4, tall - 0.1]) {
      addBox(half * 2, 0.14, 0.14, 0, y, -half, beam);
      addBox(half * 2, 0.14, 0.14, 0, y, half, beam);
      addBox(0.14, 0.14, half * 2, -half, y, 0, beam);
      addBox(0.14, 0.14, half * 2, half, y, 0, beam);
    }
    // One diagonal brace on each side.
    const span = Math.hypot(half * 2, tall * 0.4);
    const angle = Math.atan2(tall * 0.4, half * 2);
    addBox(span, 0.1, 0.1, 0, tall * 0.2, -half, beam, 0, 0);
    (group.children[group.children.length - 1] as THREE.Mesh).rotation.z = angle;
    addBox(span, 0.1, 0.1, 0, tall * 0.2, half, beam, 0, 0);
    (group.children[group.children.length - 1] as THREE.Mesh).rotation.z = -angle;
    // A plank floor round the edge.
    addBox(half * 2, 0.08, 0.7, 0, tall * 0.4 + 0.1, -half + 0.35, dark);
    addBox(half * 2, 0.08, 0.7, 0, tall * 0.4 + 0.1, half - 0.35, dark);
    return group;
  }

  /** Game materials for the building model, by the names set in Blender. */
  private pick(name: string, mesh: THREE.Mesh): THREE.Material {
    mesh.receiveShadow = true;
    switch (name) {
      case 'glass':
        mesh.renderOrder = 5;
        return this.keep(glass('#e6f4ff', { opacity: 0.16, edge: 0.6, interior: 0.6 }));
      case 'window':
        return toon({ color: '#1d2a52', rim: 0.7, rimWidth: 0.55, spec: 1.6, vertexColors: true });
      case 'solar':
        return toon({ color: '#27398a', spec: 1.1, rim: 0.6, dusty: true, vertexColors: true });
      case 'plant':
        return toon({ color: '#5fd38a', rim: 0.3, vertexColors: true });
      case 'lamp_window':
      case 'lamp_door':
        return this.keep(lamp('#ffd9a0', always, { day: 1.1, night: 3.4 }));
      case 'lamp_cyan':
        return this.keep(lamp('#5fe0ff', always, { day: 1.4, night: 3.6 }));
      case 'lamp_violet':
        return this.keep(lamp('#c9a8ff', always, { day: 1.4, night: 3.6 }));
      case 'lamp_grow':
        return this.keep(lamp('#ff7ad9', always, { day: 1.6, night: 3.8 }));
      case 'glow_green':
        return this.keep(glow('#5fff9a', 2.6));
      case 'glow_red':
        return this.keep(glow('#ff5a5a', 2.6));
      case 'glow_cyan':
        return this.keep(glow('#5fe0ff', 2.4));
      default:
        return this.paint;
    }
  }

  /** The real building, or a simple stand-in if its model is not available. */
  private makeBuilding(id: BuildingId, plan: boolean): THREE.Object3D {
    if (hasModel('annex')) {
      const copy = modelPart('annex', id, (name, mesh) => {
        if (plan) {
          mesh.userData.noOutline = true;
          return this.planMaterial;
        }
        return this.pick(name, mesh);
      });
      if (plan) copy.traverse((child) => ((child as THREE.Mesh).castShadow = false));
      return copy;
    }
    const geometry = new THREE.BoxGeometry(6.5, 3.6, 6.5);
    geometry.translate(0, 1.8, 0);
    this.geometries.push(geometry);
    return new THREE.Mesh(geometry, plan ? this.planMaterial : toon({ color: ACCENT[id], rim: 0.4 }));
  }

  /** The building model arrived after the start: swap the stand-ins for the real buildings. */
  refreshModels(): void {
    if (!hasModel('annex')) return;
    for (const slot of this.slots.values()) {
      if (!slot.plan && !slot.building) continue;
      if (slot.plan) slot.root.remove(slot.plan);
      if (slot.building) slot.root.remove(slot.building);
      slot.plan = null;
      slot.building = null;
      slot.dome = null;
      const state = slot.state;
      slot.state = 'empty';
      this.change(slot, state);
      // Already standing: no pop-up bounce for a swap.
      slot.shown = 1;
      // (change() has just made it again.)
      (slot.building as THREE.Object3D | null)?.scale.set(1, 1, 1);
    }
  }

  /** Show each plot as the game says it is. */
  setView(views: readonly PlotView[]): void {
    for (const view of views) {
      const slot = this.slots.get(view.id);
      if (!slot) continue;
      // Creative mode: the building stands where it was put, and empty plots are not marked.
      const x = view.x ?? PLOTS[view.id].x;
      const z = view.z ?? PLOTS[view.id].z;
      const heading = view.heading ?? plotHeading(view.id);
      if (slot.root.position.x !== x || slot.root.position.z !== z || slot.root.rotation.y !== heading) {
        slot.root.position.set(x, this.height(x, z), z);
        slot.root.rotation.y = heading;
        slot.collider.x = x;
        slot.collider.z = z;
        slot.shown = 0;
      }
      if (view.state !== slot.state) this.change(slot, view.state);
      slot.pad.visible = view.state !== 'done' && !(view.free && view.state === 'empty');
      if (slot.plan && view.state === 'building') {
        // The plan glows brighter as the work goes on.
        slot.plan.scale.setScalar(1);
        this.planMaterial.opacity = 0.18 + 0.12 * Math.min(1, view.progress);
      }
    }
  }

  private change(slot: Slot, state: PlotView['state']): void {
    slot.state = state;
    slot.pad.visible = state !== 'done';
    slot.scaffold.visible = state === 'building';
    if (state === 'building' && !slot.plan) {
      slot.plan = this.makeBuilding(slot.id, true);
      slot.root.add(slot.plan);
    }
    if (slot.plan) slot.plan.visible = state === 'building';
    if (state === 'done' && !slot.building) {
      slot.building = this.makeBuilding(slot.id, false);
      slot.dome = slot.building.getObjectByName('observatory_dome') ?? null;
      slot.root.add(slot.building);
      slot.shown = 0;
    }
    if (slot.building) slot.building.visible = state === 'done';
    slot.collider.r = state === 'empty' ? 0 : 4.2;
  }

  /** Where the builder robot should work: the plot under construction. */
  activeSite(): { x: number; z: number } | null {
    for (const slot of this.slots.values()) if (slot.state === 'building') return { x: slot.root.position.x, z: slot.root.position.z };
    return null;
  }

  update(dt: number, time: number): void {
    for (const slot of this.slots.values()) {
      if (slot.building && slot.state === 'done') {
        // A new building pops up with a little bounce.
        if (slot.shown < 1) {
          slot.shown = Math.min(1, slot.shown + dt * 1.8);
          const t = slot.shown;
          const bounce = 1 + Math.sin(t * Math.PI) * 0.12 * (1 - t);
          slot.building.scale.set(1, t < 1 ? 0.2 + 0.8 * t * bounce : 1, 1);
        }
        // The observatory dome turns slowly to follow the sky.
        if (slot.dome) slot.dome.rotation.y = Math.sin(time * 0.05) * 1.2;
      }
      if (slot.plan && slot.state === 'building') slot.plan.rotation.y = Math.sin(time * 0.7) * 0.02;
    }
  }

  dispose(): void {
    disposeTree(this.group);
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.own) {
      // The marked-out ground has a picture of its own.
      (material as THREE.MeshBasicMaterial).map?.dispose();
      material.dispose();
    }
  }
}
