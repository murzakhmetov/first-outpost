import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MIN_COLLIDER_HEIGHT, boundsTop, colliderHeight, overhangs, sweptTop, topOf, topWithin } from '../src/world/heights';
import { TALL, solidGap } from '../src/world/keepclear';
import type { Solids } from '../src/world/keepclear';

const material = new THREE.MeshBasicMaterial();
/** A box mesh with its middle at (x, y, z). */
const block = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
};

describe('collider heights from the placed model', () => {
  it('takes the top of a whole object from its bounds, in world space', () => {
    const parent = new THREE.Group();
    parent.position.set(10, 2, 0);
    const object = new THREE.Group();
    object.scale.setScalar(2);
    object.add(block(1, 3, 1, 0, 1.5, 0)); // 3 m tall, scaled to 6 m
    parent.add(object);
    expect(topOf(parent)).toBeCloseTo(2 + 6, 6);
  });

  it('has no top for an object without geometry', () => {
    expect(topOf(new THREE.Group())).toBeUndefined();
  });

  it('measures only the part of a model inside the footprint', () => {
    // A low hall (2 m) with a tall tower (9 m) at its end: the circle round the hall sees 2 m, the one round the tower 9 m.
    const model = new THREE.Group();
    const parts = new THREE.Group();
    parts.add(block(20, 2, 4, 0, 1, 0), block(2, 9, 2, 12, 4.5, 0));
    model.add(parts);
    expect(topWithin(model, { x: 0, z: 0, r: 5 })).toBeCloseTo(2, 6);
    expect(topWithin(model, { x: 12, z: 0, r: 1.5 })).toBeCloseTo(9, 6);
    // A circle that only grazes the tower's side still counts it.
    expect(topWithin(model, { x: 13.6, z: 0, r: 0.5 })).toBeUndefined();
    expect(topWithin(model, { x: 13.4, z: 0, r: 0.5 })).toBeCloseTo(9, 6);
  });

  it('counts a big roof triangle that covers the circle although its corners lie far away', () => {
    const roof = new THREE.BufferGeometry();
    roof.setAttribute('position', new THREE.Float32BufferAttribute([-50, 6, -50, 50, 6, -50, 0, 6, 80], 3));
    const mesh = new THREE.Mesh(roof, material);
    expect(topWithin(mesh, { x: 0, z: 0, r: 1 })).toBeCloseTo(6, 6);
    expect(topWithin(mesh, { x: 0, z: -80, r: 1 })).toBeUndefined();
  });

  it('skips hidden meshes', () => {
    const group = new THREE.Group();
    const hidden = block(2, 20, 2, 0, 10, 0);
    hidden.visible = false;
    group.add(hidden, block(2, 3, 2, 0, 1.5, 0));
    expect(topWithin(group, { x: 0, z: 0, r: 1 })).toBeCloseTo(3, 6);
  });

  it('gives a turning part the height it reaches at any angle', () => {
    const group = new THREE.Group();
    const head = new THREE.Group();
    head.position.set(0, 2, 0);
    head.add(block(3.7, 0.1, 2.3, 0, 0, 0));
    group.add(head);
    // Farthest corner from the pivot: sqrt(1.85^2 + 0.05^2 + 1.15^2).
    expect(sweptTop(head)).toBeCloseTo(2 + Math.hypot(1.85, 0.05, 1.15), 5);
    head.rotation.set(0.9, 0.4, 1.2);
    expect(sweptTop(head)).toBeCloseTo(2 + Math.hypot(1.85, 0.05, 1.15), 5);
  });

  it('takes the top of an instance from its bounds under its matrix', () => {
    const bounds = new THREE.Box3(new THREE.Vector3(-1, -0.5, -1), new THREE.Vector3(1, 1, 1));
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(5, 3, 0), new THREE.Quaternion(), new THREE.Vector3(2, 2, 2));
    expect(boundsTop(bounds, matrix)).toBeCloseTo(3 + 2, 6);
  });

  it('turns a top into a height above the ground at the middle, never below the smallest height', () => {
    expect(colliderHeight(8.5, 0.16)).toBeCloseTo(8.34, 6);
    expect(colliderHeight(0.1, 0.5)).toBe(MIN_COLLIDER_HEIGHT);
    // Nothing to measure: no height, so the collider stays tall.
    expect(colliderHeight(undefined, 0)).toBeUndefined();
    expect(colliderHeight(Number.NaN, 0)).toBeUndefined();
  });
});

describe('a collider without a model stays tall', () => {
  it('uses TALL for a missing height and the measured height otherwise', () => {
    const noModel = { x: 0, z: 0, r: 2 };
    const measured = { x: 10, z: 0, r: 2, h: colliderHeight(topOf(block(2, 3, 2, 0, 1.5, 0)), 0) };
    const solids: Solids = { circles: [noModel, measured], boxes: [], ground: () => 0 };
    expect(colliderHeight(topOf(new THREE.Group()), 0)).toBeUndefined();
    // Over the model-less collider anything below TALL is still inside; over the measured one 3 m is enough.
    expect(solidGap({ x: 0, y: TALL - 1, z: 0 }, solids)).toBe(0);
    expect(solidGap({ x: 10, y: 3.5, z: 0 }, solids)).toBeCloseTo(0.5, 6);
  });
});

describe('parts that stick out of their colliders', () => {
  const flat = (): number => 0;
  it('finds a canopy the circle does not cover, and nothing where the circle is enough', () => {
    const model = new THREE.Group();
    // A 4 m tower under a circle of r 2, with a canopy 3 m wide at 3 m up that reaches 3.5 m from the middle.
    model.add(block(3, 4, 3, 0, 2, 0), block(2, 0.3, 2, 3.0, 3, 0));
    const circle = [{ x: 0, z: 0, r: 2, h: 4 }];
    const found = overhangs(model, circle, flat, 0.35);
    expect(found.length).toBeGreaterThan(0);
    for (const o of found) expect(o.top).toBeCloseTo(3.15, 6);
    // Every point of the canopy outside the circle lies inside one of the circles that were found.
    expect(found.some((o) => Math.hypot(o.x - 3.0, o.z) <= o.r + 1e-6 || Math.abs(o.x - 3.0) < 1.1)).toBe(true);
    // A circle wide and high enough covers it all.
    expect(overhangs(model, [{ x: 0, z: 0, r: 4.5, h: 4 }], flat, 0.35)).toEqual([]);
    // Low parts (below the flying height) are not counted.
    expect(overhangs(model, circle, flat, 0.35, 3.4)).toEqual([]);
  });
});

describe('distance to the nearest solid', () => {
  const solids: Solids = {
    circles: [{ x: 0, z: 0, r: 2, h: 3 }],
    boxes: [{ x: 10, z: 0, hx: 1, hz: 2, yaw: 0, y0: 0, y1: 3 }],
    ground: () => 0,
  };
  it('measures to the side wall, over the top, and over the rim', () => {
    expect(solidGap({ x: 5, y: 1, z: 0 }, solids)).toBeCloseTo(3, 6);
    expect(solidGap({ x: 0.5, y: 5, z: 0 }, solids)).toBeCloseTo(2, 6);
    expect(solidGap({ x: 5, y: 7, z: 0 }, solids)).toBeCloseTo(Math.hypot(3, 4), 6);
  });
  it('is 0 inside, and sees the box too', () => {
    expect(solidGap({ x: 1, y: 1, z: 0 }, solids)).toBe(0);
    expect(solidGap({ x: 12.5, y: 1, z: 0 }, solids)).toBeCloseTo(1.5, 6);
    expect(solidGap({ x: 10, y: 4.2, z: 0 }, solids)).toBeCloseTo(1.2, 6);
  });
});
