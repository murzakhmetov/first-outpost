/**
 * Interior light (G13, high and ultra only): fake light that makes a room feel lit instead of flat.
 *  - warm pools on the floor under the lamps (the floor tile stays visible: the pool multiplies it),
 *  - a wall gradient (darker near the floor, a little warmer and lighter up high),
 *  - soft light shafts from the windows, with a bright patch where each one lands on the floor,
 *  - soft contact shadows under benches, crates and machines, and a blob under the cadet.
 * Everything is cheap decals and one tube per window: no real lights. The caller shows or hides `group`
 * (the dev flag G13) and calls `setCadet` every frame. The materials must be disposed by the caller.
 */
import * as THREE from 'three';

export interface RoomLightSetup {
  /** Top of the room, metres. */
  height: number;
  /** Colour of the light that comes in at the windows. */
  daylight: string;
  /** Floor pools: centre on the floor, radius, colour. */
  pools: { x: number; z: number; r: number; color: string }[];
  /** Round windows: centre, radius and the way the wall faces out of the room. */
  windows: { x: number; y: number; z: number; r: number; out: THREE.Vector3 }[];
  /** Wall meshes to lay the gradient over (their geometry is shared, not copied). */
  walls: THREE.Mesh[];
  /** Things on the floor: footprint, height, turn (prop front faces (sin rot, cos rot)). */
  props: { x: number; z: number; rot: number; w: number; d: number; h: number; round: boolean }[];
  /** Crewmates standing in the room. */
  mates: { x: number; z: number }[];
  /** Colour of the gradient near the floor and high up. */
  wallDark: string;
  wallWarm: string;
  /** Colour a contact shadow tints the floor with. */
  shadow: string;
}

const FLOOR = 0.024;
const RING = 28;

const POOL_VERT = /* glsl */ `
  attribute float aR;
  attribute vec3 aCol;
  varying float vR;
  varying vec3 vCol;
  void main() {
    vR = aR;
    vCol = aCol;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const POOL_FRAG = /* glsl */ `
  varying float vR;
  varying vec3 vCol;
  void main() {
    float f = 1.0 - smoothstep(0.0, 1.0, vR);
    gl_FragColor = vec4(vCol * f, 1.0);
  }
`;

const SHAFT_VERT = /* glsl */ `
  attribute float aT;
  varying float vT;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vT = aT;
    vN = normalMatrix * normal;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
const SHAFT_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vT;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float face = abs(dot(normalize(vN), normalize(vV)));
    float soft = pow(face, 1.6);
    float along = smoothstep(0.0, 0.1, vT) * (1.0 - smoothstep(0.45, 1.0, vT));
    gl_FragColor = vec4(uColor * soft * along, 1.0);
  }
`;

const WALL_VERT = /* glsl */ `
  varying float vY;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vY = world.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const WALL_FRAG = /* glsl */ `
  uniform vec3 uDark;
  uniform vec3 uWarm;
  uniform float uTop;
  varying float vY;
  void main() {
    float lo = 1.0 - smoothstep(0.0, 3.0, vY);
    float hi = smoothstep(uTop * 0.35, uTop, vY);
    float aLo = lo * 0.72;
    float aHi = hi * 0.3;
    float a = aLo + aHi;
    vec3 c = (uDark * aLo + uWarm * aHi) / max(a, 0.0001);
    gl_FragColor = vec4(c, a);
  }
`;

const BLOB_VERT = /* glsl */ `
  attribute vec2 aLocal;
  attribute vec4 aShape;
  attribute float aStr;
  varying vec2 vLocal;
  varying vec4 vShape;
  varying float vStr;
  void main() {
    vLocal = aLocal;
    vShape = aShape;
    vStr = aStr;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const BLOB_FRAG = /* glsl */ `
  uniform vec3 uTint;
  varying vec2 vLocal;
  varying vec4 vShape;
  varying float vStr;
  void main() {
    vec2 q = max(abs(vLocal) - vShape.xy, 0.0);
    float sd = length(q) - vShape.z;
    // A wide soft part and a tight dark core right at the foot of the thing.
    float wide = 1.0 - clamp(sd / vShape.w, 0.0, 1.0);
    wide = wide * wide * (3.0 - 2.0 * wide);
    float tight = 1.0 - clamp(sd / (vShape.w * 0.28), 0.0, 1.0);
    float f = clamp(wide * 0.62 + tight * tight * 0.5, 0.0, 1.0);
    gl_FragColor = vec4(mix(vec3(1.0), uTint, f * vStr), 1.0);
  }
`;

function colour(hex: string, scale = 1): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(scale);
}

export class RoomLight {
  readonly group = new THREE.Group();
  readonly materials: THREE.Material[] = [];
  private readonly cadet: THREE.Mesh;

  constructor(setup: RoomLightSetup) {
    this.group.name = 'roomLight';
    this.buildWalls(setup);
    this.buildPools(setup);
    this.buildShafts(setup);
    this.buildContact(setup);
    this.cadet = this.buildCadet(setup);
  }

  /** Keep the soft blob under the cadet (y is the jump height). */
  setCadet(x: number, y: number, z: number): void {
    this.cadet.position.set(x, FLOOR + 0.004, z);
    this.cadet.scale.setScalar(1 / (1 + Math.max(0, y) * 1.1));
  }

  private material(parameters: THREE.ShaderMaterialParameters): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, ...parameters });
    this.materials.push(material);
    return material;
  }

  private buildWalls(setup: RoomLightSetup): void {
    for (const wall of setup.walls) {
      const material = this.material({
        vertexShader: WALL_VERT,
        fragmentShader: WALL_FRAG,
        uniforms: {
          uDark: { value: colour(setup.wallDark) },
          uWarm: { value: colour(setup.wallWarm) },
          uTop: { value: setup.height },
        },
        side: (wall.material as THREE.Material).side,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const mesh = new THREE.Mesh(wall.geometry, material);
      mesh.position.copy(wall.position);
      mesh.quaternion.copy(wall.quaternion);
      mesh.scale.copy(wall.scale);
      mesh.renderOrder = 1;
      this.group.add(mesh);
    }
  }

  /** Floor pools and the bright patches where the window light lands: one mesh, light multiplies the floor. */
  private buildPools(setup: RoomLightSetup): void {
    const positions: number[] = [];
    const radii: number[] = [];
    const colours: number[] = [];
    const indices: number[] = [];
    const disc = (cx: number, cz: number, ring: (i: number) => [number, number], color: THREE.Color): void => {
      const base = positions.length / 3;
      positions.push(cx, FLOOR, cz);
      radii.push(0);
      colours.push(color.r, color.g, color.b);
      for (let i = 0; i < RING; i++) {
        const [x, z] = ring(i);
        positions.push(x, FLOOR, z);
        radii.push(1);
        colours.push(color.r, color.g, color.b);
      }
      for (let i = 0; i < RING; i++) indices.push(base, base + 1 + i, base + 1 + ((i + 1) % RING));
    };
    for (const pool of setup.pools) {
      disc(pool.x, pool.z, (i) => {
        const a = (i / RING) * Math.PI * 2;
        return [pool.x + Math.sin(a) * pool.r, pool.z + Math.cos(a) * pool.r];
      }, colour(pool.color, 1.6));
    }
    for (const window of setup.windows) {
      const ring = windowRing(window, setup.height);
      const centre = ring.floor.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / RING);
      disc(centre.x, centre.z, (i) => [ring.floor[i].x, ring.floor[i].z], colour(setup.daylight, 2.0));
    }
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aR', new THREE.Float32BufferAttribute(radii, 1));
    geometry.setAttribute('aCol', new THREE.Float32BufferAttribute(colours, 3));
    geometry.setIndex(indices);
    const material = this.material({
      vertexShader: POOL_VERT,
      fragmentShader: POOL_FRAG,
      // The floor colour times (1 + light): lamps brighten the tile, they do not paint over it.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  /** Soft light tubes from every window down to the floor. */
  private buildShafts(setup: RoomLightSetup): void {
    if (!setup.windows.length) return;
    const positions: number[] = [];
    const ts: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (const window of setup.windows) {
      const ring = windowRing(window, setup.height);
      const base = positions.length / 3;
      for (let i = 0; i < RING; i++) {
        const top = ring.window[i];
        const bottom = ring.floor[i];
        // Sideways out of the tube: the window ring seen along the beam.
        const radial = top.clone().sub(ring.centre);
        radial.addScaledVector(ring.beam, -radial.dot(ring.beam)).normalize();
        positions.push(top.x, top.y, top.z, bottom.x, bottom.y + 0.02, bottom.z);
        ts.push(0, 1);
        normals.push(radial.x, radial.y, radial.z, radial.x, radial.y, radial.z);
      }
      for (let i = 0; i < RING; i++) {
        const a = base + i * 2;
        const b = base + ((i + 1) % RING) * 2;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1));
    geometry.setIndex(indices);
    const material = this.material({
      vertexShader: SHAFT_VERT,
      fragmentShader: SHAFT_FRAG,
      uniforms: { uColor: { value: colour(setup.daylight, 0.45) } },
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  private contactMaterial(setup: RoomLightSetup): THREE.ShaderMaterial {
    return this.material({
      vertexShader: BLOB_VERT,
      fragmentShader: BLOB_FRAG,
      uniforms: { uTint: { value: colour(setup.shadow) } },
      side: THREE.DoubleSide,
      // Multiplies the floor, so the tile shows through the shadow.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  /** Soft shadows under furniture: one mesh with a quad for each footprint. */
  private buildContact(setup: RoomLightSetup): void {
    const positions: number[] = [];
    const locals: number[] = [];
    const shapes: number[] = [];
    const strengths: number[] = [];
    const indices: number[] = [];
    // The room light leans a little toward the back of the room: shift the shadow away from it.
    const shiftX = -0.07;
    const shiftZ = -0.12;
    const quad = (cx: number, cz: number, rot: number, bx: number, bz: number, rad: number, soft: number, str: number): void => {
      const ex = bx + rad + soft;
      const ez = bz + rad + soft;
      const sin = Math.sin(rot);
      const cos = Math.cos(rot);
      const base = positions.length / 3;
      for (const [lx, lz] of [[-ex, -ez], [ex, -ez], [ex, ez], [-ex, ez]] as const) {
        positions.push(cx + shiftX + lx * cos + lz * sin, FLOOR, cz + shiftZ - lx * sin + lz * cos);
        locals.push(lx, lz);
        shapes.push(bx, bz, rad, soft);
        strengths.push(str);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (const prop of setup.props) {
      const soft = 0.32 + Math.min(0.5, prop.h * 0.2);
      const str = 0.82 + Math.min(0.15, prop.h * 0.08);
      if (prop.round) quad(prop.x, prop.z, prop.rot, 0, 0, prop.w / 2 - 0.02, soft, str);
      else quad(prop.x, prop.z, prop.rot, Math.max(0, prop.w / 2 - 0.05), Math.max(0, prop.d / 2 - 0.05), 0.04, soft, str);
    }
    for (const mate of setup.mates) quad(mate.x, mate.z, 0, 0, 0, 0.2, 0.34, 0.55);
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aLocal', new THREE.Float32BufferAttribute(locals, 2));
    geometry.setAttribute('aShape', new THREE.Float32BufferAttribute(shapes, 4));
    geometry.setAttribute('aStr', new THREE.Float32BufferAttribute(strengths, 1));
    geometry.setIndex(indices);
    const mesh = new THREE.Mesh(geometry, this.contactMaterial(setup));
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  private buildCadet(setup: RoomLightSetup): THREE.Mesh {
    const e = 0.75;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-e, 0, -e, e, 0, -e, e, 0, e, -e, 0, e], 3));
    geometry.setAttribute('aLocal', new THREE.Float32BufferAttribute([-e, -e, e, -e, e, e, -e, e], 2));
    geometry.setAttribute('aShape', new THREE.Float32BufferAttribute(new Array(4).fill([0, 0, 0.2, 0.5]).flat(), 4));
    geometry.setAttribute('aStr', new THREE.Float32BufferAttribute([0.62, 0.62, 0.62, 0.62], 1));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const mesh = new THREE.Mesh(geometry, this.contactMaterial(setup));
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }
}

/** Direction the window light travels: into the room and down. */
const BEAM_DOWN = 0.58;

/** The window circle and where the same circle lands on the floor along the beam. */
function windowRing(
  window: { x: number; y: number; z: number; r: number; out: THREE.Vector3 },
  _height: number,
): { window: THREE.Vector3[]; floor: THREE.Vector3[]; centre: THREE.Vector3; beam: THREE.Vector3 } {
  const out = window.out;
  const beam = new THREE.Vector3(-out.x, 0, -out.z).normalize().multiplyScalar(Math.sqrt(1 - BEAM_DOWN * BEAM_DOWN));
  beam.y = -BEAM_DOWN;
  const centre = new THREE.Vector3(window.x, window.y, window.z).addScaledVector(out, -0.1);
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(out, -out.y).normalize();
  const right = new THREE.Vector3().crossVectors(up, out).normalize();
  const top: THREE.Vector3[] = [];
  const floor: THREE.Vector3[] = [];
  for (let i = 0; i < RING; i++) {
    const a = (i / RING) * Math.PI * 2;
    const p = centre.clone().addScaledVector(right, Math.cos(a) * window.r * 0.97).addScaledVector(up, Math.sin(a) * window.r * 0.97);
    const t = p.y / BEAM_DOWN;
    top.push(p);
    floor.push(new THREE.Vector3(p.x + beam.x * t, FLOOR, p.z + beam.z * t));
  }
  return { window: top, floor, centre, beam };
}
