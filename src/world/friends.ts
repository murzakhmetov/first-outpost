/**
 * Friends' astronauts in crew mode: the same model as the player's cadet, in the friend's suit colour.
 * On a walk they follow the friend's live position (smoothed); otherwise they stand at a base slot by
 * the habitat plaza; at night, when finished or gone they go indoors (shrink away).
 * All the rules (smoothing, slots, staleness) live in src/net/follow.ts.
 *
 * Decisions (see docs/MULTIPLAYER.md):
 * - Detail: Astronaut copies the shared model that model() hands out for the quality tier (the light version
 *   on low and medium), and outlines follow the tier, so friends cost what the player's own cadet costs.
 *   Friends are people, so they are never thinned out by tier (the NPC cadets are).
 * - In a building: the status message has no "in a room" field, so a friend indoors is found by silence
 *   (no position for STALE_SECONDS) and hidden then. For a few seconds they may stand at the door.
 * - Rover: a friend driving (m = 2) is drawn as the astronaut sliding at the rover's place, with no walking
 *   animation. A second rover is not drawn: the rover is a physics model owned by Rover (wheels, colliders),
 *   and cloning it for a ghost is not cheap or simple enough for this step.
 */
import * as THREE from 'three';
import { AIRLOCK_FACING, BASE_SLOTS, BASE_WALK, approach, emoteFor, isStale, smoothAngle, smoothTowards } from '../net/follow';
import type { FriendMode } from '../net/follow';
import type { Step } from '../game/store';
import type { Position } from '../net/protocol';
import { Astronaut } from './astronaut';

export interface FriendSpec {
  id: string;
  color: string;
  mode: FriendMode;
  /** Place in BASE_SLOTS (while at the base). */
  slot: number;
  step: Step | null;
}

interface Figure {
  astronaut: Astronaut;
  color: string;
  mode: FriendMode;
  slot: number;
  step: Step | null;
  x: number;
  z: number;
  heading: number;
  target: Position | null;
  /** When the last position arrived, in the clock of this object (seconds). */
  lastPosAt: number;
  placed: boolean;
  /** When the friend's mode last changed (seconds, this object's clock). */
  modeAt: number;
  shown: number;
  emote: string;
}

const AIRLOCK_SPOT = { x: 0, z: -2.2 };

export class Friends {
  readonly group = new THREE.Group();
  private readonly figures = new Map<string, Figure>();
  private clock = 0;

  constructor(
    private readonly withOutline: boolean,
    private readonly height: (x: number, z: number) => number,
    private readonly floaty: boolean,
  ) {}

  /** The friends that should exist now (new ones appear, missing ones are removed). */
  sync(list: readonly FriendSpec[]): void {
    const keep = new Set(list.map((spec) => spec.id));
    for (const [id, figure] of this.figures) {
      if (keep.has(id)) continue;
      this.group.remove(figure.astronaut.group);
      figure.astronaut.dispose();
      this.figures.delete(id);
    }
    for (const spec of list) {
      let figure = this.figures.get(spec.id);
      if (!figure) {
        const astronaut = new Astronaut(spec.color, this.withOutline);
        this.group.add(astronaut.group);
        figure = {
          astronaut,
          color: spec.color,
          mode: spec.mode,
          slot: spec.slot,
          step: spec.step,
          x: 0,
          z: 0,
          heading: 0,
          target: null,
          lastPosAt: -Infinity,
          placed: false,
          modeAt: this.clock,
          shown: 0,
          emote: '',
        };
        this.figures.set(spec.id, figure);
      }
      if (figure.color !== spec.color) {
        figure.color = spec.color;
        figure.astronaut.setColor(spec.color);
      }
      if (figure.mode === 'walk' && spec.mode !== 'walk') figure.target = null;
      if (figure.mode !== spec.mode) figure.modeAt = this.clock;
      figure.mode = spec.mode;
      figure.slot = spec.slot;
      figure.step = spec.step;
    }
  }

  /** A position from a friend on a walk. */
  setPosition(id: string, position: Position): void {
    const figure = this.figures.get(id);
    if (!figure) return;
    figure.target = position;
    figure.lastPosAt = this.clock;
  }

  /** Where a friend's head is (for the name tag), or null when the friend is not drawn. */
  head(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const figure = this.figures.get(id);
    if (!figure || figure.shown < 0.5) return null;
    return out.set(figure.x, this.height(figure.x, figure.z) + 2.15, figure.z);
  }

  private quiet(figure: Figure): boolean {
    // A walker with no position since they went out is not drawn yet (no statue at the airlock): they appear at their first position.
    return figure.mode === 'walk' && (figure.lastPosAt < figure.modeAt || isStale(figure.lastPosAt, this.clock));
  }

  /** Where the friends are, for the corner map. */
  points(): { x: number; z: number; color: string }[] {
    const out: { x: number; z: number; color: string }[] = [];
    for (const figure of this.figures.values()) if (figure.shown > 0.5) out.push({ x: figure.x, z: figure.z, color: figure.color });
    return out;
  }

  update(dt: number): void {
    this.clock += dt;
    let any = false;
    for (const figure of this.figures.values()) {
      // A walker nobody has heard from for a while is most likely in a building: hide them rather than leave a statue.
      const goal = figure.mode === 'hidden' || this.quiet(figure) ? 0 : 1;
      figure.shown += (goal - figure.shown) * Math.min(1, dt * 4);
      const visible = figure.shown > 0.02;
      figure.astronaut.group.visible = visible;
      if (!visible) continue;
      any = true;
      this.step(figure, dt);
      const { astronaut } = figure;
      astronaut.group.position.set(figure.x, this.height(figure.x, figure.z), figure.z);
      astronaut.group.rotation.y = figure.heading;
      astronaut.group.scale.multiplyScalar(figure.shown);
    }
    this.group.visible = any;
  }

  private step(figure: Figure, dt: number): void {
    const { astronaut } = figure;
    let speed = 0;
    if (figure.mode === 'walk') {
      const target = figure.target;
      if (!target || this.quiet(figure)) {
        // Nothing heard (they are fading out): stay where they were instead of sliding on old news.
        if (!figure.placed) this.place(figure, AIRLOCK_SPOT.x, AIRLOCK_SPOT.z, 0);
      } else {
        if (!figure.placed) this.place(figure, target.x, target.z, target.a);
        const moved = smoothTowards(figure, target, dt);
        const distance = Math.hypot(moved.x - figure.x, moved.z - figure.z);
        figure.x = moved.x;
        figure.z = moved.z;
        figure.heading = moved.snapped ? target.a : smoothAngle(figure.heading, target.a, dt);
        // Moving (or told they are moving): the walking animation; a rover driver slides without it.
        if (target.m === 1 || (target.m === 0 && distance / Math.max(dt, 1e-3) > 0.3)) speed = 0.38;
      }
      this.emote(figure, 'none');
    } else {
      const slot = BASE_SLOTS[figure.slot % BASE_SLOTS.length];
      if (!figure.placed) this.place(figure, slot.x, slot.z, Math.atan2(AIRLOCK_FACING.x - slot.x, AIRLOCK_FACING.z - slot.z));
      // Far away (a long walk): do not cross the whole plain, just be there.
      if (Math.hypot(figure.x - slot.x, figure.z - slot.z) > 40) this.place(figure, slot.x, slot.z, figure.heading);
      const next = approach(figure, slot, BASE_WALK, dt);
      if (next.moved > 0) {
        figure.heading = smoothAngle(figure.heading, Math.atan2(slot.x - figure.x, slot.z - figure.z), dt, 10);
        speed = 0.38;
      } else {
        figure.heading = smoothAngle(figure.heading, Math.atan2(AIRLOCK_FACING.x - slot.x, AIRLOCK_FACING.z - slot.z), dt, 4);
      }
      figure.x = next.x;
      figure.z = next.z;
      this.emote(figure, next.moved > 0 ? 'none' : emoteFor(figure.step));
    }
    astronaut.update(dt, { speed, grounded: true, vy: 0, floaty: this.floaty });
  }

  private place(figure: Figure, x: number, z: number, heading: number): void {
    figure.x = x;
    figure.z = z;
    figure.heading = heading;
    figure.placed = true;
  }

  private emote(figure: Figure, emote: ReturnType<typeof emoteFor>): void {
    if (figure.emote === emote) return;
    figure.emote = emote;
    figure.astronaut.play(emote);
  }

  dispose(): void {
    for (const figure of this.figures.values()) figure.astronaut.dispose();
    this.figures.clear();
  }
}
