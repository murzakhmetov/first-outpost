import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/world/astronaut.ts', async () => {
  const THREE = await import('three');
  class Astronaut {
    group = new THREE.Group();
    footstep = { left: false, right: false };
    play() {}
    update() {}
    setAltitude() {}
    dispose() {}
  }
  return { Astronaut, SUIT_COLORS: ['#ff8a3d', '#39c2f0', '#8f7bff', '#5fe39a'] };
});

import * as THREE from 'three';
import { CameraRig } from '../src/world/cameraRig';
import { Astronaut } from '../src/world/astronaut';
import { Interior } from '../src/world/interior';

// The room builders paint canvas textures (no DOM here): skip them. They do not touch the camera rig.
for (const name of ['buildShell', 'buildProps', 'buildStations', 'buildLights', 'buildDecor']) {
  (Interior.prototype as any)[name] = () => {};
}

const terrain = (_x: number, z: number): number => 0.6 * z; // a slope behind the cadet
const outdoorColliders = [{ x: 0, z: 30, r: 5 }];
const look = { site: 'mars' as const, done: [], stock: { regolith: 4, metal: 2 } };

function setup() {
  const rig = new CameraRig(new THREE.PerspectiveCamera(50, 1.6, 0.1, 2000));
  rig.heightAt = terrain; // what World.build sets (world.ts:223-224)
  rig.blockers = outdoorColliders;
  const lumi = { group: new THREE.Group(), goal: new THREE.Vector3(), lookTarget: new THREE.Vector3(), bright: 1, snap() {}, update() {} };
  const interior = new Interior(new (Astronaut as any)(), lumi as any, rig, { shadows: false, shadowSize: 512, pointLights: false, outlines: false });
  return { rig, interior };
}

/** What World.leaveRoom does on a walk: setMode('eva') + eva.resync() (world.ts:419-421, eva.ts:304-312). */
function backOnTheWalk(rig: CameraRig): { cameraY: number; groundY: number } {
  rig.minDistance = 4.5; rig.maxDistance = 20; rig.minPitch = 0.08; rig.maxPitch = 1.15; rig.avoidBlockers = true; // setMode('eva')
  rig.follow(new THREE.Vector3(0, terrain(0, 0), 0));
  rig.setAngles(0, 0.24);
  rig.setDistance(8.5);
  rig.snap();
  const p = rig.camera.position;
  return { cameraY: +p.y.toFixed(2), groundY: +terrain(p.x, p.z).toFixed(2) };
}

describe('Interior.open while a room is already open', () => {
  it('control: one room in and out keeps the outdoor camera above the ground', () => {
    const { rig, interior } = setup();
    interior.open('workshop', look);
    interior.close();
    expect(rig.heightAt).toBe(terrain);
    expect(rig.blockers).toBe(outdoorColliders);
    const r = backOnTheWalk(rig);
    console.log('control', r);
    expect(r.cameraY).toBeGreaterThan(r.groundY);
  });

  it('workshop -> lab -> outside: the outdoor rig keeps the room settings (flat floor, no blockers)', () => {
    const { rig, interior } = setup();
    interior.open('workshop', look);
    interior.open('lab', look); // director.enterRoom from inside a room (no leaveRoom first)
    interior.close();
    const r = backOnTheWalk(rig);
    console.log('after room->room', { heightAtIsTerrain: rig.heightAt === terrain, blockers: rig.blockers.length, ...r });
    expect(rig.heightAt).toBe(terrain);
    expect(rig.blockers).toBe(outdoorColliders);
    expect(r.cameraY).toBeGreaterThan(r.groundY);
  });
});
