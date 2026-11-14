/**
 * 3D models made in Blender (see scripts/models) and loaded as .glb files.
 *
 * Each model comes in two versions: full detail, and a lighter one for phones
 * and older laptops. Blender materials are swapped for the game's cel-shaded
 * materials by name.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { QualityTier } from './quality';

export type Detail = 'high' | 'low';

const NAMES = ['astronaut', 'rover', 'lander', 'lumi', 'props', 'hab', 'farm', 'lab', 'power', 'scenery'] as const;
/** Models the game can do without (plain stand-ins are drawn instead): loaded if the file is there. */
const EXTRAS = ['annex', 'interior'] as const;
export type ModelName = (typeof NAMES)[number] | (typeof EXTRAS)[number];
const ALL: readonly ModelName[] = [...NAMES, ...EXTRAS];
/**
 * Extras not needed for the first picture (the new buildings, and the furniture inside buildings):
 * fetched after the others, without holding up the start.
 */
const LATER: readonly ModelName[] = ['annex', 'interior'];
const FIRST: readonly ModelName[] = ALL.filter((name) => !LATER.includes(name));
const lateListeners = new Set<() => void>();

/** Call `listener` each time a model fetched after the start arrives. */
export function onLateModel(listener: () => void): () => void {
  lateListeners.add(listener);
  return () => lateListeners.delete(listener);
}

const sources = new Map<string, THREE.Object3D>();
const urls = new Set<string>();
const pending = new Map<Detail, Promise<void>>();
let current: Detail = 'high';
/** The level asked for last: a slower download of an earlier request must not take over. */
let wanted: Detail = 'high';

/** Which version of the models a quality level uses. */
export function modelDetail(tier: QualityTier): Detail {
  return tier === 'low' || tier === 'medium' ? 'low' : 'high';
}

/** Download the models for a detail level (once) and make it the one `model()` hands out. */
export function loadModels(detail: Detail, onProgress?: (share: number) => void): Promise<void> {
  wanted = detail;
  let job = pending.get(detail);
  if (!job) {
    const loader = new GLTFLoader();
    let done = 0;
    const suffix = detail === 'low' ? '_low' : '';
    const fetchOne = async (name: ModelName, attempt = 1): Promise<void> => {
      const url = `${import.meta.env.BASE_URL}models/${name}${suffix}.glb?v=${__MODELS_VERSION__}`;
      let gltf: Awaited<ReturnType<typeof loader.loadAsync>>;
      try {
        gltf = await loader.loadAsync(url);
      } catch (error) {
        if (!(EXTRAS as readonly string[]).includes(name)) throw error;
        // The extra models are not needed to play: try once more, then keep the simple stand-ins.
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          return fetchOne(name, attempt + 1);
        }
        console.warn(`First Outpost: the "${name}" model could not be loaded; simple stand-ins are drawn instead.`, error);
        return;
      }
      urls.add(url);
      gltf.scene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        // Shared by every copy of the model: never freed when one scene is torn down.
        if (mesh.isMesh) mesh.geometry.userData.shared = true;
      });
      sources.set(`${name}:${detail}`, gltf.scene);
    };
    job = Promise.all(
      FIRST.map(async (name) => {
        await fetchOne(name);
        done += 1;
        onProgress?.(done / FIRST.length);
      }),
    ).then(() => undefined);
    pending.set(detail, job);
    // The rest follows in the background; until it is here, simple stand-ins are drawn.
    void job
      .then(() => Promise.all(LATER.map((name) => fetchOne(name).catch(() => undefined))))
      .then(() => lateListeners.forEach((listener) => listener()));
  }
  return job.then(() => {
    if (wanted === detail) current = detail;
  });
}

/** Is a model loaded for the current detail level? */
export function hasModel(name: string): boolean {
  return sources.has(name + ':' + current);
}

/** Addresses of the model files loaded so far (kept for offline play). */
export function modelUrls(): string[] {
  return [...urls];
}

/**
 * A fresh copy of a model. `pick` returns the game material for a Blender material
 * name (or null to keep the mesh as it is). Geometry is shared between copies.
 */
export function model(name: ModelName, pick: Pick): THREE.Object3D {
  return dress(source(name).clone(true), pick);
}

/** A fresh copy of one named piece of a model that holds several things (a crate, a rock). */
export function modelPart(name: ModelName, piece: string, pick: Pick): THREE.Object3D {
  const copy = find(name, piece).clone(true);
  copy.position.set(0, 0, 0);
  return dress(copy, pick);
}

/** The shared geometry of a one-mesh piece, for drawing many copies in one batch. */
export function modelGeometry(name: ModelName, piece: string): THREE.BufferGeometry {
  const mesh = find(name, piece) as THREE.Mesh;
  if (!mesh.isMesh) throw new Error('Model piece "' + piece + '" is not a single mesh');
  return mesh.geometry;
}

type Pick = (material: string, mesh: THREE.Mesh) => THREE.Material | null;

function source(name: ModelName): THREE.Object3D {
  const found = sources.get(name + ':' + current);
  if (!found) throw new Error('Model "' + name + '" is not loaded');
  return found;
}

function find(name: ModelName, piece: string): THREE.Object3D {
  const found = source(name).getObjectByName(piece);
  if (!found) throw new Error('Model "' + name + '" has no piece "' + piece + '"');
  return found;
}

function dress(copy: THREE.Object3D, pick: Pick): THREE.Object3D {
  copy.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const original = (mesh.userData.material as string | undefined) ?? (mesh.material as THREE.Material).name;
    mesh.userData = { ...mesh.userData, material: original };
    const material = pick(original, mesh);
    if (material) mesh.material = material;
    mesh.castShadow = !(mesh.material as THREE.Material).transparent;
    mesh.receiveShadow = false;
  });
  return copy;
}

/**
 * Outlines are drawn by pushing a dark copy of the mesh outwards along its normals.
 * Where a model has a crisp edge the normals split and the outline would crack, so
 * the copy gets normals averaged over each point.
 */
export function outlineGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = geometry.userData.hull as THREE.BufferGeometry | undefined;
  if (cached) return cached;
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const sums = new Map<string, [number, number, number]>();
  const keys: string[] = new Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const key = `${Math.round(position.getX(i) * 2000)},${Math.round(position.getY(i) * 2000)},${Math.round(position.getZ(i) * 2000)}`;
    keys[i] = key;
    const sum = sums.get(key);
    if (sum) {
      sum[0] += normal.getX(i);
      sum[1] += normal.getY(i);
      sum[2] += normal.getZ(i);
    } else {
      sums.set(key, [normal.getX(i), normal.getY(i), normal.getZ(i)]);
    }
  }
  const smooth = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const [x, y, z] = sums.get(keys[i])!;
    const length = Math.hypot(x, y, z) || 1;
    smooth[i * 3] = x / length;
    smooth[i * 3 + 1] = y / length;
    smooth[i * 3 + 2] = z / length;
  }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', position);
  hull.setAttribute('normal', new THREE.BufferAttribute(smooth, 3));
  hull.setIndex(geometry.index);
  hull.userData.shared = true;
  geometry.userData.hull = hull;
  return hull;
}
