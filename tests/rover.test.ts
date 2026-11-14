/**
 * The rover the cadet can drive on walks outside.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Collider } from '../src/world/base';
import { ROVER, Rover } from '../src/world/rover';

/** A rover on flat ground, with the three circles that stand for it when parked. */
function makeRover(site: 'mars' | 'moon' = 'mars'): { rover: Rover; parked: Collider[]; model: THREE.Group } {
  const model = new THREE.Group();
  for (const name of ['wheel_l0', 'wheel_l1', 'wheel_l2', 'wheel_r0', 'wheel_r1', 'wheel_r2']) {
    const wheel = new THREE.Object3D();
    wheel.name = name;
    model.add(wheel);
  }
  const parked: Collider[] = [0, 1, 2].map(() => ({ x: ROVER.x, z: ROVER.z, r: 1.5 }));
  return { rover: new Rover(model, parked, () => 0, site), parked, model };
}

/** Drive for some seconds at 60 frames a second. */
function drive(rover: Rover, seconds: number, throttle: number, steer: number, colliders: Collider[] = []): void {
  for (let i = 0; i < seconds * 60; i++) rover.update(1 / 60, throttle, steer, colliders);
}

describe('rover', () => {
  it('speeds up, rolls along its heading and is faster on Mars than on the Moon', () => {
    const mars = makeRover('mars').rover;
    const moon = makeRover('moon').rover;
    mars.setDriving(true);
    moon.setDriving(true);
    const from = { x: mars.x, z: mars.z };
    drive(mars, 3, 1, 0);
    drive(moon, 3, 1, 0);
    expect(mars.speed).toBeGreaterThan(mars.top * 0.8);
    expect(mars.speed).toBeGreaterThan(moon.speed);
    const moved = Math.hypot(mars.x - from.x, mars.z - from.z);
    expect(moved).toBeGreaterThan(15);
    // It went where it faces.
    const bearing = Math.atan2(mars.x - from.x, mars.z - from.z);
    expect(Math.sin(bearing)).toBeCloseTo(Math.sin(mars.heading), 1);
    expect(Math.cos(bearing)).toBeCloseTo(Math.cos(mars.heading), 1);
  });

  it('turns right when steered right, and rolls to a stop when the gas is let go', () => {
    const { rover } = makeRover();
    rover.setDriving(true);
    const start = rover.heading;
    drive(rover, 2, 1, 1);
    expect(rover.heading).toBeLessThan(start - 0.5);
    drive(rover, 6, 0, 0);
    expect(rover.speed).toBe(0);
  });

  it('cannot drive through rocks and buildings', () => {
    const { rover } = makeRover();
    rover.setDriving(true);
    const ahead = 8;
    const wall: Collider = { x: rover.x + Math.sin(rover.heading) * ahead, z: rover.z + Math.cos(rover.heading) * ahead, r: 2 };
    drive(rover, 4, 1, 0, [wall]);
    // The front of the rover (a circle 1.3 m ahead of its middle) never gets inside the wall.
    const frontX = rover.x + Math.sin(rover.heading) * 1.3;
    const frontZ = rover.z + Math.cos(rover.heading) * 1.3;
    expect(Math.hypot(frontX - wall.x, frontZ - wall.z)).toBeGreaterThanOrEqual(2 + 1.3 - 0.05);
    expect(rover.speed).toBeLessThan(1);
  });

  it('uses up its battery, and with an empty battery it stops', () => {
    const { rover } = makeRover();
    rover.setDriving(true);
    // In a wide circle, so it stays inside the walking area the whole time.
    drive(rover, 10, 1, 0.6);
    expect(rover.charge).toBeLessThan(0.8);
    expect(rover.charge).toBeGreaterThan(0.5);
    drive(rover, 40, 1, 0.6);
    expect(rover.charge).toBe(0);
    // Out of power: it rolls to a stop even with the gas down.
    drive(rover, 8, 1, 0.6);
    expect(rover.speed).toBe(0);
  });

  it('stays inside the walking area', () => {
    const { rover } = makeRover();
    rover.setDriving(true);
    rover.charge = 1;
    for (let lap = 0; lap < 4; lap++) {
      rover.charge = 1;
      drive(rover, 30, 1, 0);
    }
    expect(Math.hypot(rover.x, rover.z)).toBeLessThanOrEqual(116.001);
  });

  it('blocks the cadet while parked, not while driven, and goes home on park()', () => {
    const { rover, parked } = makeRover();
    expect(parked.every((circle) => circle.r > 1)).toBe(true);
    rover.setDriving(true);
    expect(parked.every((circle) => circle.r === 0)).toBe(true);
    drive(rover, 2, 1, 0);
    rover.setDriving(false);
    // The circles stand where the rover stopped.
    expect(parked.every((circle) => circle.r > 1)).toBe(true);
    const middle = parked[1];
    expect(Math.hypot(middle.x - rover.x, middle.z - rover.z)).toBeLessThan(0.01);
    rover.park();
    expect(rover.x).toBe(ROVER.x);
    expect(rover.z).toBe(ROVER.z);
    expect(rover.charge).toBe(1);
  });

  it('spins its wheels as it rolls, and steers the front pair', () => {
    const { rover, model } = makeRover();
    rover.setDriving(true);
    drive(rover, 1, 1, 1);
    const front = model.getObjectByName('wheel_l0')!;
    const rear = model.getObjectByName('wheel_l2')!;
    expect(front.rotation.x).toBeGreaterThan(5);
    // The rear pair steers the other way.
    expect(Math.sign(front.rotation.y)).toBe(-Math.sign(rear.rotation.y));
  });
});

describe('rover card', () => {
  it('exists in both languages with NASA sources, since driving unlocks it', async () => {
    const { CODEX } = await import('../src/data/codex');
    const card = CODEX.find((item) => item.id === 'rovers');
    expect(card).toBeDefined();
    expect(card!.en.numbers.length).toBe(card!.ru.numbers.length);
    expect(card!.sources.every((source) => /^https:\/\/[a-z0-9.]*nasa\.gov\//.test(source.url))).toBe(true);
  });
});
