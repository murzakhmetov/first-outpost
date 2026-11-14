/**
 * The rest of the crew: two cadets who walk between the buildings and stop to work.
 *
 * They make the outpost feel lived in. They go indoors when the Sun is dangerous
 * (a solar storm, a dust storm) and at night, because a real crew would.
 */
import * as THREE from 'three';
import { Astronaut } from './astronaut';
import type { Emote } from './astronaut';

interface Stop {
  x: number;
  z: number;
  /** What the cadet does here, and for how long (seconds). */
  task: Emote;
  stay: number;
}

/** Routes around the outpost that keep clear of the buildings. */
const ROUTES: { suit: string; stops: Stop[] }[] = [
  {
    suit: '#39c2f0',
    stops: [
      { x: -17.4, z: 6.4, task: 'drill', stay: 5 },
      { x: -11.5, z: 2.6, task: 'none', stay: 1.5 },
      { x: -4.6, z: 1.4, task: 'wave', stay: 2.4 },
      { x: -11.8, z: 9.4, task: 'drill', stay: 4 },
    ],
  },
  {
    suit: '#ffd166',
    stops: [
      { x: 17.2, z: 6.4, task: 'drill', stay: 4.5 },
      { x: 21.5, z: 9.6, task: 'none', stay: 1.5 },
      { x: 24.0, z: 14.6, task: 'drill', stay: 4 },
      { x: 17.6, z: 12.2, task: 'wave', stay: 2.4 },
    ],
  },
];

const WALK_SPEED = 1.5; // metres per second: an unhurried walk in a suit

interface Member {
  figure: Astronaut;
  stops: Stop[];
  next: number;
  wait: number;
  x: number;
  z: number;
  heading: number;
  color: string;
}

export class Crew {
  readonly group = new THREE.Group();
  private readonly members: Member[] = [];
  private readonly height: (x: number, z: number) => number;
  private readonly floaty: boolean;
  private outside = true;
  private shown = 1;
  /** False in a crew mission: the friends' astronauts (world/friends.ts) take the place of the two NPC cadets. */
  npcs = true;
  /** More dots for the corner map (the friends). */
  extraPoints: (() => { x: number; z: number; color: string }[]) | null = null;

  constructor(count: number, withOutline: boolean, height: (x: number, z: number) => number, floaty: boolean) {
    this.height = height;
    this.floaty = floaty;
    for (const route of ROUTES.slice(0, count)) {
      const figure = new Astronaut(route.suit, withOutline);
      const start = route.stops[0];
      figure.group.position.set(start.x, height(start.x, start.z), start.z);
      this.group.add(figure.group);
      this.members.push({ figure, stops: route.stops, next: 1, wait: start.stay, x: start.x, z: start.z, heading: 0, color: route.suit });
    }
  }

  /** False sends the crew indoors (they shrink away at the spot; the buildings are close). */
  setOutside(outside: boolean): void {
    this.outside = outside;
  }

  /** Where the crew is right now, for the corner map. Empty while they are indoors. */
  points(): { x: number; z: number; color: string }[] {
    const friends = this.extraPoints?.() ?? [];
    if (this.shown < 0.5 || !this.npcs) return friends;
    return [...this.members.map((member) => ({ x: member.x, z: member.z, color: member.color })), ...friends];
  }

  update(dt: number): void {
    const target = this.outside ? 1 : 0;
    this.shown += (target - this.shown) * Math.min(1, dt * 4);
    this.group.visible = this.shown > 0.02 && this.npcs;
    if (!this.group.visible) return;

    for (const member of this.members) {
      const { figure } = member;
      let speed = 0;
      if (member.wait > 0) {
        member.wait -= dt;
        if (member.wait <= 0) figure.play('none');
      } else {
        const stop = member.stops[member.next];
        const dx = stop.x - member.x;
        const dz = stop.z - member.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.25) {
          member.wait = stop.stay;
          figure.play(stop.task);
          member.next = (member.next + 1) % member.stops.length;
        } else {
          const step = Math.min(distance, WALK_SPEED * dt);
          member.x += (dx / distance) * step;
          member.z += (dz / distance) * step;
          const facing = Math.atan2(dx, dz);
          let turn = facing - member.heading;
          turn = Math.atan2(Math.sin(turn), Math.cos(turn));
          member.heading += turn * Math.min(1, dt * 6);
          speed = 0.38;
        }
      }
      figure.group.position.set(member.x, this.height(member.x, member.z), member.z);
      figure.group.rotation.y = member.heading;
      figure.update(dt, { speed, grounded: true, vy: 0, floaty: this.floaty });
      // Astronaut.update sets the squash scale; fold the "going indoors" shrink into it.
      figure.group.scale.multiplyScalar(this.shown);
    }
  }

  dispose(): void {
    for (const member of this.members) member.figure.dispose();
  }
}
