/**
 * Friends' astronauts in the world (src/world/friends.ts) with a stand-in for the model, and the
 * base slots checked against the real outpost layout.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('../src/world/astronaut', () => ({
  Astronaut: class {
    group = new THREE.Group();
    setColor(): void {}
    play(): void {}
    update(): void {}
    dispose(): void {}
  },
}));

import { BASE_SLOTS } from '../src/net/follow';
import { Friends } from '../src/world/friends';
import type { FriendSpec } from '../src/world/friends';
import { FARM, HAB, LAB, SOLAR } from '../src/world/base';
import { FLAG, LANDER } from '../src/world/props';
import { ROVER } from '../src/world/rover';
import { PLAZA } from '../src/world/terrain';

const spec = (over: Partial<FriendSpec> = {}): FriendSpec => ({ id: 'a', color: '#fff', mode: 'walk', slot: 0, step: 'eva', ...over });
const make = (): Friends => new Friends(false, () => 0, false);
const run = (friends: Friends, seconds: number): void => {
  for (let t = 0; t < seconds; t += 0.1) friends.update(0.1);
};

describe('friends in the world', () => {
  it('a friend who just went out and has sent no position is not drawn (no statue at the airlock)', () => {
    const friends = make();
    friends.sync([spec()]);
    run(friends, 2);
    expect(friends.points()).toEqual([]);
    expect(friends.head('a', new THREE.Vector3())).toBeNull();
  });

  it('the friend appears at the first position, and goes quiet after 3 seconds without news', () => {
    const friends = make();
    friends.sync([spec()]);
    friends.setPosition('a', { x: 12, z: 5, a: 0, m: 1 });
    run(friends, 1);
    expect(friends.points()).toHaveLength(1);
    expect(friends.points()[0].x).toBeCloseTo(12, 0);
    run(friends, 4);
    expect(friends.points()).toEqual([]);
  });

  it('a friend at the base stands at their slot', () => {
    const friends = make();
    friends.sync([spec({ mode: 'base', slot: 1, step: 'plan' })]);
    run(friends, 1);
    const [point] = friends.points();
    expect(point.x).toBeCloseTo(BASE_SLOTS[1].x, 1);
    expect(point.z).toBeCloseTo(BASE_SLOTS[1].z, 1);
  });

  it('a friend who goes away is removed', () => {
    const friends = make();
    friends.sync([spec({ mode: 'base', step: 'plan' })]);
    run(friends, 1);
    friends.sync([]);
    expect(friends.points()).toEqual([]);
  });
});

describe('base slots against the outpost', () => {
  // The colliders of src/world/base.ts and props.ts, as written there.
  const walls = [
    { ...HAB, r: 7.3 },
    ...[-4.4, 0, 4.4].map((dz) => ({ x: FARM.x, z: FARM.z + dz, r: 4.5 })),
    ...[-3.6, 0, 3.6].map((dz) => ({ x: LAB.x, z: LAB.z + dz, r: 3.1 })),
    { x: SOLAR.x, z: SOLAR.z, r: 8 },
    { ...LANDER, r: 3.6 },
    { ...ROVER, r: 1.5 },
    { ...FLAG, r: 0.35 },
  ];
  it('no slot is inside or against a building, the pad, the rover or the flag', () => {
    for (const slot of BASE_SLOTS)
      for (const wall of walls) expect(Math.hypot(slot.x - wall.x, slot.z - wall.z)).toBeGreaterThan(wall.r + 0.9);
  });
  it('slots stand outside the plaza ring of crystals', () => {
    for (const slot of BASE_SLOTS) expect(Math.hypot(slot.x - PLAZA.x, slot.z - PLAZA.z)).toBeGreaterThan(PLAZA.r + 0.3);
  });
});
