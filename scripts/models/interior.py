"""
Props that stand inside the walk-in rooms. The game builds the room shells (floors,
curved walls, ribs, windows); everything here stands in them. Each prop is its own
node in interior.glb:

  crew module   bunk_bed, table_round, stool, galley, air_machine, water_recycler,
                exercise_bike, locker
  greenhouse    plant_rack, pepper_plant, garden_bed, dwarf_tree, water_tank,
                farm_console, bench
  lab           lab_bench, sample_shelf, spectrometer, radio_console
  workshop      printer_3d, workbench, tool_wall, crate_regolith, metal_rack, robot_arm
  observatory   telescope, star_console
  everywhere    airlock_door, ceiling_light, crate_small, floor_hatch
  lander cabin  pilot_seat, cockpit_console, supply_rack, hatch_ladder

Every prop is one mesh with its origin in the middle of its footprint on the floor and
its front (the side you use it from) toward -Y. Two exceptions: ceiling_light has its
origin at its top centre (it hangs from a ceiling point), and tool_wall hangs with its
bottom edge 0.9 m above the floor (its origin is still on the floor). The telescope's
origin is the middle of its pier; the mount fits in 1.6 x 1.6 m, while the tube reaches
out above head height toward -Y.

Materials the game swaps by name: paint (colours are vertex colours), glass,
screen_cyan / screen_green / screen_amber, glow_white / glow_pink / glow_cyan /
glow_amber / glow_green. Every screen is a child mesh of its prop, named
"<prop>_screen" (or "<prop>_screen_1", "_2", ... from left to right), with UVs running
0-1 across it: u to the right and v up as you face the screen (a texture with
flipY = false shows upright).

interior_low.glb comes from the same code with fewer segments, no small bevels and
no bolts. Faces nobody can see (flat against another part, or on the floor) are
dropped, and both files store normals and colours as bytes (KHR_mesh_quantization,
which three.js reads natively) to keep them small.
"""
import json
import math
import os
import random
import struct
from array import array

import bmesh
import bpy
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

from lib import (
    bake_shadows,
    bevel,
    box,
    capsule,
    cylinder,
    export,
    from_bm,
    ico,
    join,
    lathe,
    mat,
    paint,
    parent,
    partial_sphere,
    place,
    prism,
    reset,
    shade,
    sphere,
    torus,
    triangles,
)

PALETTE = {
    "white": "#f4f0e8",
    "cream": "#ece3cf",
    "grey": "#aeb6c6",
    "steel": "#8c95a8",
    "dark": "#3a4260",
    "darker": "#262b40",
    "rubber": "#30343f",
    "teal": "#39c2f0",
    "orange": "#ff8a3d",
    "green": "#4fd98a",
    "violet": "#8f7bff",
    "yellow": "#ffd166",
    "red": "#ff5d5d",
    "pink": "#ff9cc2",
    "mattress": "#dfe7f3",
    "water": "#5cc8f2",
    "soil": "#6b4632",
    "leaf": "#62cf5e",
    "leaf_light": "#a6e86e",
    "leaf_dark": "#3a9a4a",
    "lettuce": "#b9ef72",
    "stem": "#4f8a3a",
    "bark": "#8a5a3c",
    "pepper_red": "#f0432f",
    "pepper_yellow": "#ffc632",
    "fruit": "#ff6f4a",
    "rust": "#b4502f",
    "rock": "#8f8b86",
    "ochre": "#ef8f3e",
    "chalk": "#f1ede4",
    "regolith": "#a99a84",
    "sack": "#d4bf96",
    "copper": "#d88a4a",
    "alu": "#cfd6e2",
}

# Materials the game swaps by name. The colours only show in Blender and in previews.
SPECIAL = {
    "glass": (0.75, 0.9, 1.0),
    "screen_cyan": (0.25, 0.85, 1.0),
    "screen_green": (0.35, 1.0, 0.55),
    "screen_amber": (1.0, 0.72, 0.25),
    "glow_white": (1.0, 0.98, 0.92),
    "glow_pink": (1.0, 0.4, 0.85),
    "glow_cyan": (0.3, 0.95, 1.0),
    "glow_amber": (1.0, 0.75, 0.3),
    "glow_green": (0.4, 1.0, 0.6),
}
ALLOWED = {"paint"} | set(SPECIAL)

PROPS = [
    "bunk_bed", "table_round", "stool", "galley", "air_machine", "water_recycler", "exercise_bike", "locker",
    "plant_rack", "pepper_plant", "garden_bed", "dwarf_tree", "water_tank", "farm_console", "bench",
    "lab_bench", "sample_shelf", "spectrometer", "radio_console",
    "printer_3d", "workbench", "tool_wall", "crate_regolith", "metal_rack", "robot_arm",
    "telescope", "star_console",
    "airlock_door", "ceiling_light", "crate_small", "floor_hatch",
    "pilot_seat", "cockpit_console", "supply_rack", "hatch_ladder",
]

# Shadow settings that differ from the default, and props whose origin is not re-centred.
FINISH = {
    "ceiling_light": dict(ground=None, reach=0.2),
    "tool_wall": dict(ground=None, reach=0.25),
    "floor_hatch": dict(reach=0.12),
    "telescope": dict(reach=0.7, centre=False),
    "dwarf_tree": dict(reach=0.6, strength=0.6),
    "plant_rack": dict(reach=0.45, strength=0.6),
    "pepper_plant": dict(strength=0.6),
    "garden_bed": dict(strength=0.65),
    "hatch_ladder": dict(centre=False),
}

LOW = False  # True while the light version is built
SMALL_LOW = 0.03  # roundings smaller than this are left off in the light version


# ---------------------------------------------------------------------------
# Shapes that get lighter in the low version
# ---------------------------------------------------------------------------


def n_(count, least=6):
    """Segments around a round part; halved in the low version."""
    return count if not LOW else max(least, int(round(count / 2)))


def B(name, size, loc=(0, 0, 0), rot=(0, 0, 0), m="white", r=0.02, s=2):
    """A rounded box. Small roundings get one bevel segment (a chamfer reads the same)."""
    if LOW:
        r = 0.0 if r < SMALL_LOW else r
        s = 1
    elif r < 0.025:
        s = 1
    return box(name, size, loc, rot, material=m, round=r, segments=s)


def C(name, radius, depth, loc=(0, 0, 0), rot=(0, 0, 0), m="grey", n=16, r2=None, r=0.0, s=2):
    """A cylinder (or cone) along Z, centred. Thin ones get fewer sides."""
    n = n_(min(n, max(8, int(round(max(radius, r2 or 0.0) * 200)))))
    if LOW:
        r = 0.0 if r < SMALL_LOW else r
        s = 1
    elif r < 0.03:
        s = 1
    obj = cylinder(name, radius, depth, rot=(0, 0, 0), material=m, segments=n, radius2=r2, round=r, round_segments=s)
    if r <= 0:
        shade(obj, True, max(50.0, 360.0 / n + 8.0))  # few-sided ones still shade round
    return place(obj, loc, rot)


def S(name, radius, loc=(0, 0, 0), scale=(1, 1, 1), m="grey", n=12, rings=8, rot=(0, 0, 0)):
    return sphere(name, radius, loc, scale, rot, material=m, segments=n_(n), rings=n_(rings, 4))


def T(name, radius, thick, loc=(0, 0, 0), rot=(0, 0, 0), m="grey", n=24, sides=6, scale=(1, 1, 1)):
    """A ring lying flat (hole along Z)."""
    n = min(n, max(10, int(round(radius * 80))))
    return torus(name, radius, thick, loc, rot, scale, material=m, segments=n_(n, 8), sides=n_(sides, 4))


def L(name, profile, loc=(0, 0, 0), rot=(0, 0, 0), m="white", n=24, caps=(True, True), sharp=42.0, scale=(1, 1, 1)):
    """A lathe: spin [(radius, z), ...] around Z."""
    n = n_(n)
    return lathe(name, profile, loc, rot, scale, material=m, segments=n, cap_bottom=caps[0], cap_top=caps[1], sharp=max(sharp, 360.0 / n + 8.0))


def aim(obj, start, end):
    """
    Turn a part built along +Z (centred) so it runs from `start` to `end`. Its X side
    stays level, so flat bars and straps lie flat.
    """
    start, end = Vector(start), Vector(end)
    z_axis = (end - start).normalized()
    side = Vector((0, 0, 1)) if abs(z_axis.z) < 0.9 else Vector((0, 1, 0))
    x_axis = side.cross(z_axis).normalized()
    y_axis = z_axis.cross(x_axis)
    matrix = Matrix((x_axis, y_axis, z_axis)).transposed()
    euler = matrix.to_euler("XYZ")
    return place(obj, (start + end) / 2, rot=tuple(math.degrees(angle) for angle in euler))


def rod(name, start, end, radius, m="grey", n=10, r=0.0):
    length = (Vector(end) - Vector(start)).length
    return aim(C(name, radius, length, m=m, n=n, r=r), start, end)


def beam(name, start, end, width, height, m="dark", r=0.02):
    length = (Vector(end) - Vector(start)).length
    return aim(B(name, (width, height, length), m=m, r=r), start, end)


def move(parts, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Turn a group built around the origin (degrees, XYZ), then move it."""
    for part in parts:
        place(part, loc, rot)
    return parts


# ---------------------------------------------------------------------------
# Pipes, hoses and cables: a circle swept along a path
# ---------------------------------------------------------------------------


def _catmull(points, res):
    padded = [points[0]] + points + [points[-1]]
    out = []
    for i in range(1, len(padded) - 2):
        p0, p1, p2, p3 = padded[i - 1], padded[i], padded[i + 1], padded[i + 2]
        for k in range(res):
            t = k / res
            out.append(0.5 * ((2 * p1) + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t))
    out.append(points[-1])
    return out


def _fillet(points, bend, steps):
    """Round each corner of a polyline with a bend of about `bend` metres."""
    out = [points[0]]
    for i in range(1, len(points) - 1):
        a, b, c = points[i - 1], points[i], points[i + 1]
        d1, d2 = a - b, c - b
        radius = min(bend, d1.length * 0.45, d2.length * 0.45)
        p0 = b + d1.normalized() * radius
        p2 = b + d2.normalized() * radius
        for k in range(steps + 1):
            t = k / steps
            out.append(p0 * (1 - t) ** 2 + b * (2 * (1 - t) * t) + p2 * (t * t))
    out.append(points[-1])
    return out


def H(name, points, radius, m="dark", sides=8, smooth=False, bend=0.0, steps=4, res=5, caps=True):
    """
    A pipe through `points`. `bend` rounds the corners of a straight-run pipe (elbows);
    `smooth` lays a soft curve through every point instead (a hose or a cable).
    """
    pts = [Vector(p) for p in points]
    if smooth and len(pts) > 2:
        path = _catmull(pts, res if not LOW else max(2, res // 2))
    elif bend > 0 and len(pts) > 2:
        path = _fillet(pts, bend, steps if not LOW else max(2, steps // 2))
    else:
        path = pts
    clean = [path[0]]
    for point in path[1:]:
        if (point - clean[-1]).length > 1e-5:
            clean.append(point)
    path = clean
    sides = n_(sides, 4 if radius < 0.02 else 5)
    count = len(path)
    tangents = []
    for i in range(count):
        if i == 0:
            t = path[1] - path[0]
        elif i == count - 1:
            t = path[-1] - path[-2]
        else:
            t = (path[i + 1] - path[i]).normalized() + (path[i] - path[i - 1]).normalized()
        tangents.append(t.normalized())
    helper = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
    normal = tangents[0].cross(helper).normalized()
    bm = bmesh.new()
    rings = []
    for i in range(count):
        tangent = tangents[i]
        if i > 0:
            normal = tangents[i - 1].rotation_difference(tangent) @ normal
            normal = (normal - tangent * normal.dot(tangent)).normalized()
        binormal = tangent.cross(normal)
        stretch, bend_dir = 1.0, None
        if 0 < i < count - 1:
            a = (path[i] - path[i - 1]).normalized()
            b = (path[i + 1] - path[i]).normalized()
            half = math.acos(max(-1.0, min(1.0, a.dot(b)))) / 2
            if half > 1e-3:
                stretch = 1.0 / max(0.35, math.cos(half))
                bend_dir = (b - a).normalized()
        ring = []
        for k in range(sides):
            angle = 2 * math.pi * k / sides
            offset = normal * math.cos(angle) + binormal * math.sin(angle)
            if bend_dir is not None:
                offset = offset + bend_dir * offset.dot(bend_dir) * (stretch - 1.0)
            ring.append(bm.verts.new(path[i] + offset * radius))
        rings.append(ring)
    for i in range(count - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    if caps:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return from_bm(name, bm, m, smooth=True, sharp=max(70.0, 360.0 / sides + 8.0))


# ---------------------------------------------------------------------------
# Flat things: screens, dots, plates with holes
# ---------------------------------------------------------------------------


def screen(name, width, height, loc, rot=(0, 0, 0), m="screen_cyan"):
    """A flat screen facing -Y (before `rot`), UV 0-1: u to the right, v up as you face it."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    corners = [(-width / 2, -height / 2, 0.0, 0.0), (width / 2, -height / 2, 1.0, 0.0), (width / 2, height / 2, 1.0, 1.0), (-width / 2, height / 2, 0.0, 1.0)]
    face = bm.faces.new([bm.verts.new((x, 0.0, z)) for x, z, _, _ in corners])
    for loop, (_, _, u, v) in zip(face.loops, corners):
        loop[uv].uv = (u, v)
    obj = from_bm(name, bm, m, smooth=False)
    return place(obj, loc, rot)


def dots(name, centres, width, height, m="dark", y=0.0):
    """Many small flat squares facing -Y (holes in a pegboard, slots in a grille), one mesh."""
    bm = bmesh.new()
    for x, z in centres:
        quad = [(x - width / 2, z - height / 2), (x + width / 2, z - height / 2), (x + width / 2, z + height / 2), (x - width / 2, z + height / 2)]
        bm.faces.new([bm.verts.new((qx, y, qz)) for qx, qz in quad])
    return from_bm(name, bm, m, smooth=False)


def rrect(width, height, radius, steps=4, cx=0.0, cz=0.0):
    """A rounded rectangle [(x, z), ...], counter-clockwise as seen from the front."""
    hw, hh = width / 2 - radius, height / 2 - radius
    points = []
    for x, z, start in ((hw, -hh, -90), (hw, hh, 0), (-hw, hh, 90), (-hw, -hh, 180)):
        for index in range(steps + 1):
            a = math.radians(start + 90 * index / steps)
            points.append((cx + x + radius * math.cos(a), cz + z + radius * math.sin(a)))
    return points


def _inside_rrect(x, z, width, height, radius):
    ax, az = abs(x), abs(z)
    if ax > width / 2 or az > height / 2:
        return False
    if ax <= width / 2 - radius or az <= height / 2 - radius:
        return True
    return (ax - (width / 2 - radius)) ** 2 + (az - (height / 2 - radius)) ** 2 <= radius * radius


def rrect_by_angle(width, height, radius, count, cx=0.0, cz=0.0, ox=0.0, oz=0.0, start=-90.0):
    """
    Points on a rounded rectangle centred at (ox, oz), one per ray from (cx, cz) at even
    angles. Two outlines sampled from the same centre pair up into a plate with a hole.
    """
    points = []
    for index in range(count):
        a = math.radians(start + 360.0 * index / count)
        dx, dz = math.cos(a), math.sin(a)
        low, high = 0.0, width + height
        for _ in range(40):
            mid = (low + high) / 2
            if _inside_rrect(cx + dx * mid - ox, cz + dz * mid - oz, width, height, radius):
                low = mid
            else:
                high = mid
        points.append((cx + dx * low, cz + dz * low))
    return points


def circle_xz(radius, count, cx=0.0, cz=0.0, start=-90.0):
    return [(cx + radius * math.cos(math.radians(start + 360.0 * i / count)), cz + radius * math.sin(math.radians(start + 360.0 * i / count))) for i in range(count)]


def plate(name, outer, inner, depth, loc=(0, 0, 0), rot=(0, 0, 0), m="white", r=0.0, s=2):
    """
    A plate standing in the XZ plane (facing -Y), `depth` thick along Y, between two
    outlines of the same length (`inner` is the hole). Both run counter-clockwise.
    """
    bm = bmesh.new()
    of = [bm.verts.new((x, -depth / 2, z)) for x, z in outer]
    ob = [bm.verts.new((x, depth / 2, z)) for x, z in outer]
    inf = [bm.verts.new((x, -depth / 2, z)) for x, z in inner]
    inb = [bm.verts.new((x, depth / 2, z)) for x, z in inner]
    count = len(outer)
    for i in range(count):
        j = (i + 1) % count
        bm.faces.new((of[i], of[j], inf[j], inf[i]))
        bm.faces.new((ob[i], inb[i], inb[j], ob[j]))
        bm.faces.new((of[i], ob[i], ob[j], of[j]))
        bm.faces.new((inf[i], inf[j], inb[j], inb[i]))
    obj = from_bm(name, bm, m, smooth=False)
    if LOW:
        r = 0.0 if r < SMALL_LOW else r
        s = 1
    elif r < 0.025:
        s = 1
    if r > 0:
        bevel(obj, r, s, angle=40.0)
    return place(obj, loc, rot)


def slab(name, outline, depth, loc=(0, 0, 0), rot=(0, 0, 0), m="white", r=0.0, s=2):
    """A flat outline [(x, z), ...] (counter-clockwise from the front) made `depth` thick along Y."""
    if LOW:
        r = 0.0 if r < SMALL_LOW else r
        s = 1
    obj = prism(name, [(x, -z) for x, z in outline][::-1], depth, material=m, round=r, segments=s)
    place(obj, rot=(-90, 0, 0))
    return place(obj, loc, rot)


# ---------------------------------------------------------------------------
# Plants
# ---------------------------------------------------------------------------


def leaf(name, length, width, loc, yaw, pitch, m="leaf", cup=0.25, droop=0.25, ruffle=0.0, roll=0.0, seed=0, tip=1.0, round_tip=False):
    """
    One curved leaf, both sides (the game draws only front faces). Built along +Y from its
    stem point, pitched up by `pitch` degrees, then turned by `yaw` around Z. `round_tip`
    makes a broad leaf with a blunt end (lettuce, basil) instead of a pointed one.
    """
    nx = 2
    if round_tip:
        rows = [0.06, 0.38, 0.68, 0.88] if not LOW else [0.06, 0.45, 0.8]
    else:
        rows = [0.08 + 0.85 * j / 3 for j in range(3)] if not LOW else [0.08, 0.505]
    ny = len(rows)
    bm = bmesh.new()
    front, back = [], []
    for j in range(ny):
        t = rows[j]
        if round_tip:
            half = width * 0.5 * max(0.0, math.sin(math.pi * t ** 1.6)) ** 0.45
        else:
            half = width * 0.5 * math.sin(math.pi * min(1.0, t ** 0.85)) ** 0.7
        row_f, row_b = [], []
        for i in range(nx + 1):
            s = -1.0 + 2.0 * i / nx
            x = s * half
            y = length * t
            z = -droop * length * t * t + cup * half * s * s
            if ruffle and i in (0, nx):
                z += ruffle * width * math.sin(seed * 1.7 + j * 2.3 + i)
            row_f.append(bm.verts.new((x, y, z)))
            row_b.append(bm.verts.new((x, y, z - 0.0015)))
        front.append(row_f)
        back.append(row_b)
    tip_z = -droop * length
    tip_f = bm.verts.new((0.0, length * tip, tip_z))
    tip_b = bm.verts.new((0.0, length * tip, tip_z - 0.0015))
    for j in range(ny - 1):
        for i in range(nx):
            bm.faces.new((front[j][i], front[j][i + 1], front[j + 1][i + 1], front[j + 1][i]))
            bm.faces.new((back[j][i], back[j + 1][i], back[j + 1][i + 1], back[j][i + 1]))
    for i in range(nx):
        bm.faces.new((front[-1][i], front[-1][i + 1], tip_f))
        bm.faces.new((back[-1][i + 1], back[-1][i], tip_b))
    obj = from_bm(name, bm, m, smooth=True, sharp=None)
    matrix = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(math.radians(yaw), 4, "Z") @ Matrix.Rotation(math.radians(pitch), 4, "X") @ Matrix.Rotation(math.radians(roll), 4, "Y")
    obj.data.transform(matrix)
    obj.data.update()
    return obj


def blob(name, radius, loc, rng, m="leaf", squash=0.85, lumps=0.24, detail=2, scale=(1, 1, 1)):
    """A lumpy ball (a leafy clump, a sack, a rock)."""
    obj = ico(name, radius, detail=detail if not LOW else max(1, detail - 1), material=m)
    offset = Vector((rng.uniform(0, 40), rng.uniform(0, 40), rng.uniform(0, 40)))
    for vertex in obj.data.vertices:
        direction = vertex.co.normalized()
        vertex.co = direction * radius * (1.0 + lumps * noise.noise(direction * 2.3 + offset))
    obj.data.update()
    place(obj, loc, rot=(rng.uniform(-10, 10), rng.uniform(-10, 10), rng.uniform(0, 360)), scale=(scale[0], scale[1], scale[2] * squash))
    shade(obj, True, None)
    return obj


# ---------------------------------------------------------------------------
# Small details
# ---------------------------------------------------------------------------


def bolts(parts, points, y, r=0.012, m="steel", depth=0.012):
    """Round bolt heads on a face looking toward -Y (skipped in the low version)."""
    if LOW:
        return
    for x, z in points:
        parts.append(cylinder("bolt", r, depth, (x, y - depth / 2, z), (90, 0, 0), material=m, segments=8))


def knob(parts, x, y, z, r=0.03, m="orange", depth=0.03):
    """A round knob on a face looking toward -Y, with a pointer line."""
    parts.append(C("knob", r, depth, (x, y - depth / 2, z), (90, 0, 0), m=m, n=14, r=min(0.008, r * 0.25), s=1))
    if not LOW:
        parts.append(box("knob_mark", (r * 0.22, 0.006, r * 0.8), (x, y - depth - 0.002, z + r * 0.4), material="white", round=0.0))


def button(parts, x, y, z, r=0.025, m="green", depth=0.02):
    parts.append(C("button", r, depth, (x, y - depth / 2, z), (90, 0, 0), m=m, n=12, r=min(0.006, r * 0.3), s=1))


def handle(parts, a0, a1, y, c, m="grey", r=0.012, out=0.035, vertical=False):
    """
    A D-shaped grab handle on a face looking toward -Y: from x = a0 to a1 at height c,
    or (vertical) from z = a0 to a1 at x = c.
    """
    if vertical:
        points = [(c, y, a0), (c, y - out, a0), (c, y - out, a1), (c, y, a1)]
    else:
        points = [(a0, y, c), (a0, y - out, c), (a1, y - out, c), (a1, y, c)]
    parts.append(H("handle", points, r, m=m, sides=8, bend=out * 0.6, steps=3))


def label(parts, x, y, z, w, h, m="teal", depth=0.006):
    parts.append(box("label", (w, depth, h), (x, y - depth / 2, z), material=m, round=0.0))


def seam(parts, x0, x1, y, z, m="grey", t=0.008, depth=0.006):
    """A thin horizontal strip on a face looking toward -Y."""
    parts.append(box("seam", (x1 - x0, depth, t), ((x0 + x1) / 2, y - depth / 2, z), material=m, round=0.0))


def vseam(parts, x, y, z0, z1, m="grey", t=0.008, depth=0.006):
    parts.append(box("seam", (t, depth, z1 - z0), (x, y - depth / 2, (z0 + z1) / 2), material=m, round=0.0))


def led(parts, x, y, z, m="glow_green", r=0.012):
    parts.append(C("led", r, 0.012, (x, y - 0.006, z), (90, 0, 0), m=m, n=10))


def _clip_x(polygon, x0, x1):
    """Cut a convex polygon [(x, z), ...] down to x0 <= x <= x1."""
    for edge, keep in ((x0, lambda p: p[0] >= x0), (x1, lambda p: p[0] <= x1)):
        out = []
        for i, current in enumerate(polygon):
            previous = polygon[i - 1]
            if keep(current):
                if not keep(previous):
                    t = (edge - previous[0]) / (current[0] - previous[0])
                    out.append((edge, previous[1] + t * (current[1] - previous[1])))
                out.append(current)
            elif keep(previous):
                t = (edge - previous[0]) / (current[0] - previous[0])
                out.append((edge, previous[1] + t * (current[1] - previous[1])))
        polygon = out
        if len(polygon) < 3:
            return []
    return polygon


def hazard(parts, x0, x1, z0, z1, y, m="yellow", stripe="darker", depth=0.01, pitch=0.14):
    """A yellow band with dark diagonal stripes on a face looking toward -Y."""
    parts.append(box("hazard", (x1 - x0, depth, z1 - z0), ((x0 + x1) / 2, y - depth / 2, (z0 + z1) / 2), material=m, round=0.0))
    h = z1 - z0
    x = x0 - h
    while x < x1:
        quad = _clip_x([(x, z0), (x + pitch * 0.5, z0), (x + pitch * 0.5 + h, z1), (x + h, z1)], x0, x1)
        if quad:
            parts.append(slab("hazard_stripe", quad, 0.004, loc=(0, y - depth - 0.002, 0), m=stripe))
        x += pitch


# ---------------------------------------------------------------------------
# Putting a prop together
# ---------------------------------------------------------------------------


def _tint(parts):
    """Glass, screens and lights keep their names; colour their vertices for previews only."""
    for obj in parts:
        mesh = obj.data
        names = [material.name for material in mesh.materials]
        if not any(name in SPECIAL for name in names):
            continue
        attribute = mesh.color_attributes.get("Col")
        done = set()
        for poly in mesh.polygons:
            tint = SPECIAL.get(names[poly.material_index])
            if tint is None:
                continue
            for index in poly.vertices:
                if index in done:
                    continue
                done.add(index)
                value = 0.6 + 0.4 * attribute.data[index].color[0]
                attribute.data[index].color = (tint[0] * value, tint[1] * value, tint[2] * value, 1.0)


def _covered(tree, owner, me, start, direction, reach):
    """Does a ray from `start` meet another part (not part `me`) within `reach`?"""
    travelled = 0.0
    for _ in range(6):
        hit = tree.ray_cast(start, direction, reach - travelled)
        if hit[0] is None:
            return False
        if owner[hit[2]] != me:
            return True
        travelled += (hit[0] - start).length + 1e-5
        start = hit[0] + direction * 1e-5
        if travelled >= reach:
            return False
    return False


def _cull_hidden(parts, gap=0.004, ground=0.0):
    """
    Delete faces nobody can see: faces lying flat against another part all over (the back
    of a label, a door against its cabinet, the bottom of a box on a shelf), and bottoms
    standing on the floor. Fewer points means a smaller file; the look does not change.
    """
    vertices, polygons, owner = [], [], []
    for index, obj in enumerate(parts):
        names = {material.name for material in obj.data.materials}
        if names <= {"glass"}:
            continue  # you can see through glass, so it hides nothing
        base = len(vertices)
        vertices.extend(vertex.co.copy() for vertex in obj.data.vertices)
        for poly in obj.data.polygons:
            polygons.append([base + i for i in poly.vertices])
            owner.append(index)
    tree = BVHTree.FromPolygons(vertices, polygons, epsilon=0.0)
    removed = 0
    for index, obj in enumerate(parts):
        mesh = obj.data
        if mesh.materials and mesh.materials[0].name.startswith("screen_"):
            continue
        doomed = []
        for poly in mesh.polygons:
            corners = [mesh.vertices[i].co for i in poly.vertices]
            normal = poly.normal
            if ground is not None and normal.z < -0.95 and all(abs(co.z - ground) < 0.002 for co in corners):
                doomed.append(poly.index)
                continue
            centre = poly.center
            probes = [centre] + [centre.lerp(co, 0.9) for co in corners]
            if all(_covered(tree, owner, index, point - normal * 0.001, normal, gap + 0.001) for point in probes):
                doomed.append(poly.index)
        if not doomed:
            continue
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in doomed], context="FACES")
        loose = [vertex for vertex in bm.verts if not vertex.link_faces]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        removed += len(doomed)
    return removed


def _finish(name, parts, reach=0.45, ground=0.0, centre=True, strength=0.85):
    """Shadows, colours, hidden faces culled, one mesh; screens become child meshes with their own UVs."""
    bake_shadows(parts, reach=reach, strength=strength, floor=0.5, ground=ground, skip=("glass",))
    paint(parts, PALETTE)
    _tint(parts)
    _cull_hidden(parts, ground=ground)
    screens = [part for part in parts if part.data.materials[0].name.startswith("screen_")]
    rest = [part for part in parts if part not in screens]
    for part in rest:
        while part.data.uv_layers:
            part.data.uv_layers.remove(part.data.uv_layers[0])
    body = join(rest, name)
    body.data.name = name
    if body.name != name:
        raise ValueError("name clash: %s became %s" % (name, body.name))
    shift = Vector((0, 0, 0))
    if centre:
        xs = [v.co.x for v in body.data.vertices]
        ys = [v.co.y for v in body.data.vertices]
        shift = Vector((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, 0))
        body.data.transform(Matrix.Translation(shift))
        body.data.update()
    children = []
    screens.sort(key=lambda part: (round(sum((part.matrix_world @ v.co).x for v in part.data.vertices) / len(part.data.vertices), 2), -sum((part.matrix_world @ v.co).z for v in part.data.vertices)))
    for index, part in enumerate(screens):
        part.data.transform(Matrix.Translation(shift))
        part.data.update()
        part.name = name + "_screen" if len(screens) == 1 else "%s_screen_%d" % (name, index + 1)
        part.data.name = part.name
        parent(part, body)
        children.append(part)
    return [body] + children


def _report(name, objects):
    bpy.context.view_layer.update()
    low = [1e9] * 3
    high = [-1e9] * 3
    for obj in objects:
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            for axis in range(3):
                low[axis] = min(low[axis], point[axis])
                high[axis] = max(high[axis], point[axis])
    print(
        "[interior]%s %-15s %.2f x %.2f x %.2f m  (X %+.2f..%+.2f  Y %+.2f..%+.2f  Z %+.2f..%+.2f)  %d triangles"
        % (" low" if LOW else "", name, high[0] - low[0], high[1] - low[1], high[2] - low[2], low[0], high[0], low[1], high[1], low[2], high[2], triangles(objects))
    )


def _check(objects, names):
    found = {obj.name for obj in objects}
    missing = [name for name in names if name not in found]
    if missing:
        raise ValueError("props missing: %s" % missing)
    for obj in objects:
        for material in obj.data.materials:
            if material.name not in ALLOWED:
                raise ValueError("%s uses material %s" % (obj.name, material.name))


def _compact(path):
    """
    Rewrite an exported .glb with normals stored as bytes (glTF extension KHR_mesh_quantization,
    which three.js reads natively) and vertex colours as bytes (plain glTF). The shapes and
    colours stay the same; the file gets about a third smaller.
    """
    with open(path, "rb") as handle:
        data = handle.read()
    total = struct.unpack_from("<I", data, 8)[0]
    offset, doc, binary = 12, None, b""
    while offset < total:
        size, kind = struct.unpack_from("<II", data, offset)
        body = data[offset + 8 : offset + 8 + size]
        if kind == 0x4E4F534A:
            doc = json.loads(body.decode("utf-8"))
        elif kind == 0x004E4942:
            binary = body
        offset += 8 + size
    widths = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
    lanes = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
    role = {}
    for mesh in doc.get("meshes", []):
        for primitive in mesh["primitives"]:
            for key, index in primitive["attributes"].items():
                role[index] = key
            if "indices" in primitive:
                role[primitive["indices"]] = "INDICES"
    out = bytearray()
    views = []
    for index, accessor in enumerate(doc["accessors"]):
        view = doc["bufferViews"][accessor["bufferView"]]
        lane = lanes[accessor["type"]]
        element = widths[accessor["componentType"]] * lane
        stride = view.get("byteStride", element)
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        count = accessor["count"]
        if stride == element:
            raw = binary[start : start + element * count]
        else:
            raw = b"".join(binary[start + i * stride : start + i * stride + element] for i in range(count))
        kind = role.get(index, "")
        new_view = {"buffer": 0}
        if kind == "NORMAL" and accessor["componentType"] == 5126:
            floats = array("f")
            floats.frombytes(raw)
            packed = array("b", [0]) * (count * 4)
            for i in range(count):
                for k in range(3):
                    packed[i * 4 + k] = max(-127, min(127, int(round(floats[i * 3 + k] * 127.0))))
            raw = packed.tobytes()
            accessor["componentType"] = 5120
            accessor["normalized"] = True
            accessor.pop("min", None)
            accessor.pop("max", None)
            new_view["byteStride"] = 4
        elif kind.startswith("COLOR") and accessor["componentType"] == 5123:
            shorts = array("H")
            shorts.frombytes(raw)
            raw = bytes(min(255, (value * 255 + 32767) // 65535) for value in shorts)
            accessor["componentType"] = 5121
            accessor["normalized"] = True
        while len(out) % 4:
            out.append(0)
        new_view["byteOffset"] = len(out)
        new_view["byteLength"] = len(raw)
        if kind == "INDICES":
            new_view["target"] = 34963
        elif kind:
            new_view["target"] = 34962
        out += raw
        accessor["bufferView"] = len(views)
        accessor.pop("byteOffset", None)
        views.append(new_view)
    while len(out) % 4:
        out.append(0)
    doc["bufferViews"] = views
    doc["buffers"] = [{"byteLength": len(out)}]
    for key in ("extensionsUsed", "extensionsRequired"):
        names = doc.setdefault(key, [])
        if "KHR_mesh_quantization" not in names:
            names.append("KHR_mesh_quantization")
    text = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    text += b" " * (-len(text) % 4)
    blob = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(text) + 8 + len(out))
    blob += struct.pack("<II", len(text), 0x4E4F534A) + text
    blob += struct.pack("<II", len(out), 0x004E4942) + bytes(out)
    with open(path, "wb") as handle:
        handle.write(blob)
    print("[interior] %s compacted: %d kB" % (os.path.basename(path), len(blob) // 1024))


def build(out_dir, names=None):
    """Build every prop (or only `names`) into interior.glb, then again into interior_low.glb."""
    global LOW
    names = names or PROPS
    try:
        for low, suffix in ((False, ""), (True, "_low")):
            LOW = low
            reset()
            for material, colour in SPECIAL.items():
                mat(material, colour)
            objects = []
            for name in names:
                options = dict(FINISH.get(name, {}))
                made = _finish(name, globals()["_" + name](), **options)
                _report(name, made)
                objects += made
            _check(objects, names)
            path = out_dir + "/interior" + suffix + ".glb"
            export(path, objects)
            _compact(path)
    finally:
        LOW = False


# ===========================================================================
# Crew module
# ===========================================================================


def _bunk_bed():
    p = []
    hx, hy = 1.0, 0.45
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.append(B("post", (0.08, 0.08, 1.86), (sx * hx, sy * hy, 0.93), m="grey", r=0.025))
            p.append(B("post_cap", (0.1, 0.1, 0.05), (sx * hx, sy * hy, 1.875), m="teal", r=0.02))
            p.append(B("post_foot", (0.11, 0.11, 0.05), (sx * hx, sy * hy, 0.025), m="dark", r=0.01))
        p.append(B("end_panel", (0.04, 0.82, 1.62), (sx * hx, 0, 0.95), m="white", r=0.02))
        p.append(C("end_badge", 0.12, 0.012, (sx * (hx + 0.026), 0, 1.5), (0, 90, 0), m="teal", n=20))
        p.append(C("end_badge_dot", 0.05, 0.014, (sx * (hx + 0.028), 0, 1.5), (0, 90, 0), m="yellow", n=14))
    p.append(B("back", (1.92, 0.04, 1.62), (0, hy, 0.95), m="white", r=0.02))
    # Storage under the lower bunk.
    p.append(B("under", (1.94, 0.84, 0.2), (0, 0.02, 0.12), m="dark", r=0.01))
    for index, x in enumerate((-0.48, 0.48)):
        p.append(B("drawer", (0.9, 0.04, 0.17), (x, -0.43, 0.125), m="cream", r=0.02))
        handle(p, x - 0.14, x + 0.14, -0.45, 0.15, m="dark", r=0.01, out=0.03)
        label(p, x + 0.33, -0.45, 0.16, 0.12, 0.05, m=("teal", "orange")[index])
    # Two bunks: deck, trim, mattress, pillow, blanket with stripes, padded wall, lamp.
    for level, (deck, blanket, stripe, trim) in enumerate(((0.3, "teal", "yellow", "teal"), (1.12, "orange", "violet", "violet"))):
        p.append(B("deck", (1.96, 0.88, 0.08), (0, 0, deck - 0.04), m="grey", r=0.02))
        p.append(B("deck_trim", (1.96, 0.03, 0.07), (0, -0.445, deck - 0.04), m=trim, r=0.012))
        p.append(B("bunk_number", (0.07, 0.01, 0.045), (-0.8, -0.462, deck - 0.04), m="white", r=0.0))
        top = deck + 0.14
        p.append(B("mattress", (1.9, 0.84, 0.14), (0, 0, deck + 0.07), m="mattress", r=0.05, s=3))
        p.append(B("pillow", (0.34, 0.6, 0.12), (-0.7, 0.03, top + 0.045), rot=(0, -8, 0), m="white", r=0.05, s=3))
        p.append(B("blanket", (1.3, 0.86, 0.04), (0.29, 0, top + 0.01), m=blanket, r=0.015))
        p.append(B("blanket_flap", (1.3, 0.03, 0.17), (0.29, -0.435, top - 0.065), m=blanket, r=0.012))
        p.append(B("sheet_fold", (0.16, 0.875, 0.055), (-0.34, 0, top + 0.02), m="white", r=0.02))
        for x in (0.25, 0.7):
            p.append(B("stripe", (0.07, 0.866, 0.044), (x, 0, top + 0.01), m=stripe, r=0.0))
            p.append(B("stripe", (0.07, 0.036, 0.15), (x, -0.436, top - 0.07), m=stripe, r=0.0))
        for x in (-0.48, 0.48):
            p.append(B("wall_pad", (0.9, 0.05, 0.4), (x, 0.405, top + 0.25), m="cream", r=0.04, s=2))
        # Reading lamp over the pillow, with its switch.
        lz = top + 0.55
        p.append(B("lamp", (0.16, 0.08, 0.07), (-0.62, 0.37, lz), m="dark", r=0.02))
        p.append(B("lamp_hood", (0.17, 0.06, 0.02), (-0.62, 0.35, lz + 0.04), m=trim, r=0.008))
        p.append(B("lamp_light", (0.13, 0.012, 0.035), (-0.62, 0.326, lz - 0.005), m="glow_amber", r=0.0))
        button(p, -0.48, 0.38, lz, r=0.014, m="orange", depth=0.012)
        # A little shelf with books at the foot end.
        p.append(B("shelf", (0.42, 0.11, 0.02), (0.62, 0.37, top + 0.3), m="grey", r=0.006))
        for index, (colour, width, height) in enumerate((("violet", 0.04, 0.17), ("yellow", 0.035, 0.14), ("green", 0.045, 0.16), ("pink", 0.03, 0.12))):
            if level == 1 and index > 1:
                break
            p.append(B("book", (width, 0.09, height), (0.48 + index * 0.055, 0.37, top + 0.31 + height / 2), rot=(0, -6 if index == 3 else 0, 0), m=colour, r=0.006, s=1))
        # Privacy curtain on its rail, gathered at the head end.
        rail_z = 1.02 if level == 0 else 1.83
        p.append(rod("curtain_rail", (-0.98, -0.47, rail_z), (0.98, -0.47, rail_z), 0.012, m="steel", n=8))
        bottom = top + 0.02
        for index, (dx, dy) in enumerate(((-0.91, 0.0), (-0.83, -0.02), (-0.75, 0.0))):
            p.append(B("curtain", (0.09, 0.05, rail_z - 0.02 - bottom), (dx, -0.475 + dy, (rail_z - 0.02 + bottom) / 2), m="violet" if level == 0 else "teal", r=0.024))
            p.append(B("curtain_clip", (0.03, 0.03, 0.025), (dx, -0.47, rail_z - 0.01), m="dark", r=0.006, s=1))
        p.append(B("curtain_tie", (0.27, 0.08, 0.035), (-0.83, -0.48, (rail_z + bottom) / 2), m="yellow", r=0.012))
    # Guard rail on the top bunk, and the ladder on the right.
    p.append(H("guard_rail", [(-0.96, -0.455, 1.18), (-0.96, -0.455, 1.44), (0.42, -0.455, 1.44), (0.42, -0.455, 1.18)], 0.022, m="teal", bend=0.07))
    for x in (0.53, 0.87):
        p.append(B("ladder_rail", (0.045, 0.045, 1.58), (x, -0.49, 0.79), m="teal", r=0.015))
        p.append(B("ladder_hook", (0.045, 0.07, 0.045), (x, -0.46, 1.555), m="teal", r=0.012))
        p.append(B("ladder_foot", (0.06, 0.07, 0.03), (x, -0.49, 0.015), m="dark", r=0.01))
    for z in (0.3, 0.6, 0.9, 1.2, 1.48):
        p.append(rod("ladder_rung", (0.53, -0.49, z), (0.87, -0.49, z), 0.019, m="grey", n=8))
    return p


def _table_round():
    rng = random.Random(3)
    p = []
    p.append(C("top", 0.63, 0.05, (0, 0, 0.725), m="white", n=40, r=0.018))
    p.append(T("top_edge", 0.628, 0.022, (0, 0, 0.722), m="teal", n=40, sides=6))
    p.append(C("top_mat", 0.46, 0.004, (0, 0, 0.751), m="cream", n=36))
    p.append(C("top_under", 0.48, 0.03, (0, 0, 0.687), m="dark", n=24))
    p.append(C("collar", 0.12, 0.05, (0, 0, 0.65), m="dark", n=20, r=0.012))
    p.append(C("column", 0.07, 0.56, (0, 0, 0.36), m="grey", n=20))
    p.append(T("column_ring", 0.072, 0.012, (0, 0, 0.42), m="teal", n=20, sides=6))
    p.append(C("base_cone", 0.3, 0.08, (0, 0, 0.095), m="grey", n=32, r2=0.09))
    p.append(C("base", 0.34, 0.05, (0, 0, 0.03), m="dark", n=32, r=0.02))
    # Two food trays and two drink pouches.
    for x, y, yaw, foods in ((-0.24, -0.2, 8, ("green", "orange", "yellow")), (0.25, 0.17, 196, ("red", "cream", "green"))):
        tray = [B("tray", (0.4, 0.3, 0.03), (0, 0, 0.015), m="grey", r=0.012)]
        tray.append(B("tray_rim", (0.41, 0.31, 0.012), (0, 0, 0.027), m="teal", r=0.005, s=1))
        tray.append(B("food", (0.17, 0.25, 0.02), (-0.1, 0, 0.033), m=foods[0], r=0.008, s=1))
        tray.append(B("food", (0.15, 0.11, 0.024), (0.1, 0.065, 0.035), m=foods[1], r=0.01, s=1))
        tray.append(B("food", (0.15, 0.11, 0.018), (0.1, -0.065, 0.032), m=foods[2], r=0.008, s=1))
        tray.append(S("roll", 0.04, (0.1, -0.06, 0.055), scale=(1.25, 1.0, 0.65), m="ochre", n=10, rings=6))
        if not LOW:
            for index in range(3):
                tray.append(B("bean", (0.03, 0.02, 0.012), (-0.13 + (index % 2) * 0.05, -0.07 + index * 0.06, 0.046), rot=(0, 0, index * 40), m="leaf_light", r=0.0))
        tray.append(B("spoon", (0.016, 0.15, 0.008), (0.23, -0.02, 0.012), m="steel", r=0.0))
        tray.append(B("spoon_bowl", (0.035, 0.045, 0.01), (0.23, 0.07, 0.012), m="steel", r=0.004, s=1))
        p += move(tray, (x, y, 0.752), (0, 0, yaw))
    for x, y, colour in ((0.12, -0.32, "violet"), (-0.33, 0.22, "orange")):
        pouch = [B("pouch", (0.1, 0.035, 0.15), (0, 0, 0.075), m=colour, r=0.015)]
        pouch.append(B("pouch_label", (0.104, 0.039, 0.05), (0, 0, 0.07), m="white", r=0.0))
        pouch.append(C("pouch_cap", 0.014, 0.025, (0.025, 0, 0.16), m="teal", n=10))
        pouch.append(rod("straw", (-0.02, 0, 0.14), (-0.035, 0, 0.21), 0.005, m="white", n=6))
        p += move(pouch, (x, y, 0.752), (0, 0, rng.uniform(-30, 30)))
    return p


def _stool():
    p = []
    p.append(C("seat", 0.2, 0.07, (0, 0, 0.425), m="orange", n=28, r=0.03, s=2))
    p.append(T("seat_piping", 0.188, 0.008, (0, 0, 0.452), m="white", n=28, sides=4))
    p.append(C("seat_base", 0.17, 0.03, (0, 0, 0.38), m="dark", n=20, r=0.008))
    p.append(C("post_collar", 0.05, 0.03, (0, 0, 0.35), m="dark", n=14))
    p.append(C("post", 0.035, 0.3, (0, 0, 0.2), m="grey", n=12))
    p.append(T("foot_ring", 0.15, 0.013, (0, 0, 0.17), m="teal", n=20, sides=6))
    for index in range(3):
        a = math.radians(90 + index * 120)
        p.append(rod("ring_spoke", (0.03 * math.cos(a), 0.03 * math.sin(a), 0.17), (0.15 * math.cos(a), 0.15 * math.sin(a), 0.17), 0.009, m="grey", n=6))
    p.append(C("base_dome", 0.18, 0.04, (0, 0, 0.06), m="grey", n=24, r2=0.06))
    p.append(C("base", 0.205, 0.04, (0, 0, 0.02), m="dark", n=24, r=0.015))
    return p


def _galley():
    p = []
    # Counter: toe kick, body, doors and drawers, worktop.
    p.append(B("kick", (2.34, 0.58, 0.08), (0, 0.04, 0.04), m="dark", r=0.01))
    p.append(B("counter_body", (2.4, 0.64, 0.82), (0, 0.03, 0.49), m="white", r=0.02))
    colours = ("teal", "orange", "green", "yellow")
    for index, x in enumerate((-0.885, -0.295, 0.295, 0.885)):
        if index == 2:
            for row, z in enumerate((0.25, 0.49, 0.73)):
                p.append(B("drawer", (0.56, 0.03, 0.22), (x, -0.3, z), m="cream", r=0.02))
                handle(p, x - 0.1, x + 0.1, -0.315, z + 0.04, m="dark", r=0.009, out=0.028)
                label(p, x + 0.19, -0.315, z + 0.05, 0.08, 0.04, m=colours[row])
            continue
        p.append(B("door", (0.56, 0.03, 0.7), (x, -0.3, 0.49), m="cream", r=0.02))
        handle(p, x - 0.1, x + 0.1, -0.315, 0.78, m="dark", r=0.01, out=0.03)
        label(p, x - 0.18, -0.315, 0.79, 0.08, 0.04, m=colours[index])
        seam(p, x - 0.22, x + 0.22, -0.315, 0.32, m="white", t=0.01)
    p.append(B("worktop", (2.44, 0.68, 0.05), (0, 0.01, 0.925), m="grey", r=0.015))
    p.append(B("worktop_edge", (2.44, 0.025, 0.04), (0, -0.338, 0.925), m="teal", r=0.01))
    p.append(B("splash", (2.4, 0.03, 0.52), (0, 0.335, 1.21), m="cream", r=0.01))
    # Wall cabinets: two doors on the left, open shelves of food packets on the right.
    p.append(B("wall_cab", (1.2, 0.34, 0.6), (-0.6, 0.18, 1.78), m="white", r=0.02))
    for index, x in enumerate((-0.9, -0.3)):
        p.append(B("wall_door", (0.56, 0.025, 0.54), (x, 0.0, 1.78), m="cream", r=0.018))
        handle(p, x - 0.09, x + 0.09, -0.012, 1.56, m="dark", r=0.009, out=0.026)
        label(p, x + 0.18, -0.012, 1.98, 0.09, 0.045, m=("violet", "teal")[index])
    p.append(B("shelf_back", (1.2, 0.02, 0.6), (0.6, 0.34, 1.78), m="dark", r=0.0))
    for x in (0.02, 1.18):
        p.append(B("shelf_side", (0.04, 0.34, 0.6), (x, 0.18, 1.78), m="white", r=0.012))
    for z in (1.49, 1.78, 2.07):
        p.append(B("shelf_board", (1.16, 0.33, 0.025), (0.6, 0.18, z), m="white", r=0.008))
        p.append(B("shelf_lip", (1.16, 0.015, 0.035), (0.6, 0.02, z + 0.02), m="orange" if z < 2 else "white", r=0.005, s=1))
    p.append(B("cab_top", (2.42, 0.36, 0.03), (0, 0.18, 2.085), m="teal", r=0.01))
    p.append(B("light_housing", (2.3, 0.05, 0.03), (0, 0.06, 1.465), m="dark", r=0.008))
    p.append(B("light_strip", (2.2, 0.03, 0.012), (0, 0.06, 1.446), m="glow_white", r=0.0))
    packets = ("orange", "yellow", "green", "violet", "teal", "red", "pink")
    for row, z in enumerate((1.5, 1.79)):
        count = 8 if row == 0 else 7
        for index in range(count):
            x = 0.12 + (index + 0.5) * (0.98 / count)
            colour = packets[(index * 3 + row * 2) % len(packets)]
            height = 0.13 + 0.02 * ((index + row) % 2)
            p.append(B("packet", (0.08, 0.035, height), (x, 0.2 + 0.05 * (index % 2), z + 0.0125 + height / 2), rot=(0, (index % 3 - 1) * 4, 0), m=colour, r=0.01, s=1))
            if not LOW:
                p.append(B("packet_label", (0.084, 0.039, 0.035), (x, 0.2 + 0.05 * (index % 2), z + 0.0125 + height * 0.45), rot=(0, (index % 3 - 1) * 4, 0), m="white", r=0.0))
    # Food warmer with a lit window, a little green screen and two dials.
    wx = -0.72
    p.append(B("warmer", (0.6, 0.42, 0.34), (wx, 0.09, 1.12), m="white", r=0.035))
    p.append(B("warmer_band", (0.61, 0.43, 0.04), (wx, 0.09, 1.03), m="orange", r=0.012))
    p.append(B("warmer_door", (0.38, 0.025, 0.25), (wx - 0.08, -0.125, 1.14), m="dark", r=0.02))
    p.append(B("warmer_glow", (0.3, 0.004, 0.17), (wx - 0.08, -0.137, 1.14), m="glow_amber", r=0.0))
    p.append(B("warmer_glass", (0.3, 0.01, 0.17), (wx - 0.08, -0.143, 1.14), m="glass", r=0.0))
    p.append(rod("warmer_handle", (wx - 0.22, -0.16, 1.28), (wx + 0.06, -0.16, 1.28), 0.011, m="grey", n=8))
    for x in (wx - 0.22, wx + 0.06):
        p.append(B("handle_post", (0.02, 0.035, 0.02), (x, -0.145, 1.28), m="grey", r=0.0))
    p.append(B("warmer_panel", (0.12, 0.012, 0.26), (wx + 0.21, -0.125, 1.14), m="darker", r=0.008))
    p.append(screen("warmer_screen", 0.09, 0.06, (wx + 0.21, -0.133, 1.22), m="screen_green"))
    knob(p, wx + 0.21, -0.131, 1.13, r=0.028, m="orange", depth=0.025)
    knob(p, wx + 0.21, -0.131, 1.05, r=0.022, m="yellow", depth=0.025)
    for index in range(4):
        p.append(B("vent", (0.3, 0.06, 0.008), (wx - 0.05, 0.02 + index * 0.08, 1.291), m="darker", r=0.0))
    # Water dispenser with a window on its water bottle.
    dx = 0.05
    p.append(B("dispenser", (0.32, 0.3, 0.42), (dx, 0.16, 1.16), m="white", r=0.035))
    p.append(B("dispenser_cap", (0.33, 0.31, 0.04), (dx, 0.16, 1.37), m="teal", r=0.012))
    p.append(B("niche", (0.2, 0.03, 0.17), (dx, 0.0, 1.06), m="darker", r=0.012))
    p.append(C("nozzle", 0.016, 0.04, (dx, -0.005, 1.125), m="grey", n=10))
    p.append(B("drip_tray", (0.24, 0.12, 0.025), (dx, -0.04, 0.963), m="grey", r=0.008))
    for index in range(4):
        p.append(B("drip_slot", (0.18, 0.012, 0.004), (dx, -0.075 + index * 0.025, 0.977), m="darker", r=0.0))
    p.append(C("cup", 0.034, 0.075, (dx, -0.03, 1.016), m="violet", n=14, r2=0.04))
    p.append(B("water_window", (0.13, 0.012, 0.11), (dx, 0.004, 1.27), m="dark", r=0.01))
    p.append(B("water_level", (0.11, 0.004, 0.065), (dx, -0.003, 1.252), m="water", r=0.0))
    p.append(B("water_glass", (0.11, 0.006, 0.09), (dx, -0.006, 1.27), m="glass", r=0.0))
    button(p, dx - 0.12, 0.01, 1.2, r=0.018, m="teal")
    button(p, dx - 0.12, 0.01, 1.14, r=0.018, m="orange")
    # A basket of food packets on the right end of the counter.
    bx = 0.82
    p.append(B("basket", (0.5, 0.26, 0.1), (bx, 0.06, 1.0), m="grey", r=0.02))
    p.append(B("basket_band", (0.51, 0.27, 0.025), (bx, 0.06, 1.035), m="teal", r=0.008))
    for index in range(6):
        colour = packets[(index * 2 + 1) % len(packets)]
        p.append(B("packet", (0.07, 0.03, 0.13), (bx - 0.19 + index * 0.075, 0.06 + (index % 2) * 0.03, 1.08), rot=(-12 + (index % 3) * 8, (index % 2) * 6 - 3, 0), m=colour, r=0.01, s=1))
    p.append(C("utensil_cup", 0.05, 0.13, (bx - 0.05, 0.25, 1.015), m="orange", n=14))
    for dxs, tilt in ((-0.015, 8), (0.015, -6), (0.0, 0)):
        p.append(rod("utensil", (bx - 0.05 + dxs, 0.25, 1.0), (bx - 0.05 + dxs * 4 + tilt * 0.002, 0.25, 1.17), 0.006, m="steel", n=6))
    return p


def valve(p, centre, axis, colour, pipe_r, wheel_r=0.09, reach=0.1):
    """A valve on a pipe running along `axis` ('x' or 'z'), its hand wheel facing -Y."""
    x, y, z = centre
    rot = (0, 90, 0) if axis == "x" else (0, 0, 0)
    p.append(C("valve_body", pipe_r * 1.45, pipe_r * 2.4, centre, rot, m="dark", n=16, r=0.012))
    front = y - pipe_r * 1.3
    wy = y - pipe_r - reach
    p.append(C("valve_bonnet", pipe_r * 0.7, front - wy + 0.02, (x, (front + wy) / 2, z), (90, 0, 0), m="grey", n=12))
    p.append(T("valve_wheel", wheel_r, 0.016, (x, wy, z), (90, 0, 0), m=colour, n=20, sides=5))
    for angle in (45, 135):
        a = math.radians(angle)
        p.append(rod("valve_spoke", (x - wheel_r * math.cos(a), wy, z - wheel_r * math.sin(a)), (x + wheel_r * math.cos(a), wy, z + wheel_r * math.sin(a)), 0.01, m=colour, n=6))
    p.append(C("valve_hub", 0.022, 0.03, (x, wy - 0.005, z), (90, 0, 0), m="darker", n=10))
    p.append(S("valve_grip", 0.016, (x + wheel_r * 0.71, wy - 0.02, z), m="darker", n=6, rings=4))


def flange(p, centre, axis, pipe_r, m="dark"):
    rot = (0, 90, 0) if axis == "x" else ((90, 0, 0) if axis == "y" else (0, 0, 0))
    p.append(C("flange", pipe_r * 1.35, 0.03, centre, rot, m=m, n=16, r=0.006))


def gauge(p, x, y, z, r=0.06, angle=40, rim="dark"):
    """A round dial on a face looking toward -Y."""
    p.append(C("gauge_rim", r, 0.035, (x, y - 0.0175, z), (90, 0, 0), m=rim, n=20, r=0.008))
    p.append(C("gauge_face", r * 0.8, 0.006, (x, y - 0.036, z), (90, 0, 0), m="white", n=18))
    p.append(B("gauge_zone", (r * 0.5, 0.004, r * 0.16), (x + r * 0.3, y - 0.04, z + r * 0.45), rot=(0, -35, 0), m="green", r=0.0))
    a = math.radians(angle)
    p.append(B("gauge_needle", (0.008, 0.004, r * 0.65), (x + math.sin(a) * r * 0.3, y - 0.042, z + math.cos(a) * r * 0.3), rot=(0, angle, 0), m="orange", r=0.0))


def fan(p, x, z, y, r, hub="teal"):
    """A round fan with its guard, on a face looking toward -Y."""
    p.append(C("fan_frame", r + 0.035, 0.04, (x, y - 0.02, z), (90, 0, 0), m="grey", n=32, r=0.012))
    p.append(C("fan_hole", r, 0.01, (x, y - 0.044, z), (90, 0, 0), m="darker", n=28))
    for index in range(5):
        angle = index * 72
        a = math.radians(angle)
        p.append(B("fan_blade", (r * 0.36, 0.012, r * 0.62), (x + math.sin(a) * r * 0.52, y - 0.052, z + math.cos(a) * r * 0.52), rot=(0, angle + 12, 0), m="steel", r=0.008))
    p.append(C("fan_hub", r * 0.24, 0.035, (x, y - 0.06, z), (90, 0, 0), m=hub, n=16, r=0.01))
    for ring in (0.5, 0.82):
        p.append(T("fan_guard", r * ring, 0.008, (x, y - 0.078, z), (90, 0, 0), m="dark", n=28, sides=4))
    for angle in (45, 135):
        p.append(B("fan_bar", (0.014, 0.012, r * 1.95), (x, y - 0.078, z), rot=(0, angle, 0), m="dark", r=0.0))


def _air_machine():
    p = []
    cx, front, back = -0.13, -0.34, 0.42
    p.append(B("plinth", (1.08, 0.72, 0.08), (cx, 0.04, 0.04), m="dark", r=0.015))
    p.append(B("body", (1.1, back - front, 1.87), (cx, (front + back) / 2, 1.015), m="white", r=0.05))
    p.append(B("top_band", (1.12, back - front + 0.02, 0.08), (cx, (front + back) / 2, 1.86), m="teal", r=0.02))
    p.append(B("low_band", (1.12, back - front + 0.02, 0.05), (cx, (front + back) / 2, 0.11), m="dark", r=0.012))
    label(p, cx, front - 0.01, 1.86, 0.3, 0.05, m="white")
    # Two big fans on top.
    for x in (-0.4, 0.14):
        fan(p, x, 1.54, front, 0.21)
    # Control panel with the screen, buttons, gauges and status lights.
    p.append(B("panel", (0.56, 0.04, 0.34), (-0.33, front - 0.02, 1.05), m="dark", r=0.02))
    p.append(screen("air_screen", 0.46, 0.24, (-0.33, front - 0.042, 1.06), m="screen_cyan"))
    for index, colour in enumerate(("green", "yellow", "orange")):
        button(p, 0.03, front, 1.15 - index * 0.09, r=0.026, m=colour, depth=0.03)
    gauge(p, 0.25, front, 1.13, r=0.07, angle=35)
    gauge(p, 0.25, front, 0.95, r=0.07, angle=-20)
    for index in range(4):
        led(p, -0.53 + index * 0.06, front, 1.255, m="glow_cyan" if index < 3 else "glow_green", r=0.011)
    seam(p, -0.66, 0.4, front, 1.29, m="grey", t=0.012)
    seam(p, -0.66, 0.4, front, 0.79, m="grey", t=0.012)
    bolts(p, [(-0.64, 1.33), (0.38, 1.33), (-0.64, 0.75), (0.38, 0.75), (-0.64, 1.76), (0.38, 1.76)], front)
    # Filter cartridges in their bay.
    p.append(B("filter_bay", (0.98, 0.02, 0.58), (cx, front - 0.005, 0.46), m="darker", r=0.02))
    for index, (x, colour) in enumerate(((-0.46, "teal"), (-0.13, "green"), (0.2, "yellow"))):
        p.append(C("filter", 0.1, 0.44, (x, front - 0.01, 0.46), m="white", n=20))
        for z in (0.255, 0.665):
            p.append(C("filter_cap", 0.107, 0.05, (x, front - 0.01, z), m=colour, n=20, r=0.012))
        p.append(T("filter_rib", 0.101, 0.008, (x, front - 0.01, 0.46), m="grey", n=20, sides=4))
        p.append(B("filter_label", (0.07, 0.01, 0.08), (x, front - 0.112, 0.46), m="dark", r=0.0))
        p.append(B("filter_clip", (0.06, 0.04, 0.03), (x, front - 0.005, 0.705), m="dark", r=0.008))
    # Louvres on the left side.
    for index in range(7):
        p.append(B("louvre", (0.03, 0.5, 0.03), (cx - 0.565, 0.04, 0.55 + index * 0.08), rot=(-20, 0, 0), m="grey", r=0.008))
    # The air pipes: two out of the top, two out of the right side, each with its own colour.
    top = 1.9
    for x, radius, colour in ((-0.43, 0.075, "orange"), (0.13, 0.085, "green")):
        p.append(C("pipe", radius, 2.2 - top, (x, 0.12, (top + 2.2) / 2), m="white", n=20))
        flange(p, (x, 0.12, top + 0.04), "z", radius)
        flange(p, (x, 0.12, 2.185), "z", radius)
        p.append(C("pipe_band", radius + 0.004, 0.04, (x, 0.12, 2.0), m=colour, n=20))
        valve(p, (x, 0.12, 2.09), "z", colour, radius, wheel_r=0.085, reach=0.12)
    gauge(p, 0.13, 0.03, 1.995, r=0.045, angle=60, rim="grey")
    side = cx + 0.55
    for z, y, radius, colour in ((1.6, 0.02, 0.075, "yellow"), (0.6, 0.12, 0.06, "violet")):
        p.append(C("pipe", radius, 0.7 - side, ((side + 0.7) / 2, y, z), (0, 90, 0), m="white", n=20))
        flange(p, (side + 0.02, y, z), "x", radius)
        flange(p, (0.685, y, z), "x", radius)
        p.append(C("pipe_band", radius + 0.004, 0.035, (0.63, y, z), (0, 90, 0), m=colour, n=20))
        valve(p, (side + 0.13, y, z), "x", colour, radius, wheel_r=0.075, reach=0.11)
    return p


def _water_recycler():
    p = []
    p.append(B("plinth", (0.94, 0.66, 0.06), (0, 0.04, 0.03), m="dark", r=0.012))
    p.append(B("cabinet", (0.96, 0.68, 0.9), (0, 0.04, 0.51), m="white", r=0.04))
    p.append(B("band", (0.97, 0.69, 0.06), (0, 0.04, 0.88), m="teal", r=0.015))
    front = -0.3
    p.append(B("panel", (0.38, 0.03, 0.24), (-0.2, front - 0.015, 0.68), m="dark", r=0.02))
    p.append(screen("water_screen", 0.3, 0.16, (-0.2, front - 0.032, 0.69), m="screen_green"))
    for index, colour in enumerate(("teal", "green", "orange")):
        button(p, -0.3 + index * 0.1, front, 0.52, r=0.024, m=colour, depth=0.025)
    gauge(p, 0.22, front, 0.7, r=0.075, angle=25)
    led(p, 0.12, front, 0.79, m="glow_green")
    led(p, 0.32, front, 0.79, m="glow_cyan")
    p.append(B("service_door", (0.82, 0.025, 0.34), (0, front - 0.01, 0.25), m="cream", r=0.015))
    handle(p, -0.08, 0.08, front - 0.022, 0.38, m="dark", r=0.01, out=0.03)
    for index in range(5):
        p.append(B("vent", (0.025, 0.008, 0.18), (0.2 + index * 0.04, front - 0.025, 0.22), m="darker", r=0.0))
    p.append(C("drop_badge", 0.04, 0.008, (-0.25, front - 0.026, 0.25), (90, 0, 0), m="teal", n=16))
    # Two tanks on top, joined by a pipe with a valve.
    tanks = ((-0.22, 0.08, 0.19, 0.6), (0.24, 0.1, 0.17, 0.48))
    for x, y, radius, height in tanks:
        p.append(C("tank_seat", radius + 0.02, 0.04, (x, y, 0.97), m="dark", n=24))
        p.append(L("tank", [(radius, 0.0), (radius, height - 0.08), (radius * 0.85, height - 0.02), (radius * 0.5, height + 0.02), (0.0, height + 0.03)], loc=(x, y, 0.99), m="white", n=28))
        for z in (0.12, height - 0.14):
            p.append(C("tank_band", radius + 0.006, 0.04, (x, y, 0.99 + z), m="teal", n=28))
    # Sight glass on the big tank: you can see how much water is in it.
    sx, sy = -0.22, 0.08 - 0.19 - 0.045
    p.append(C("sight_glass", 0.03, 0.36, (sx, sy, 1.27), m="glass", n=14))
    p.append(C("sight_water", 0.023, 0.21, (sx, sy, 1.195), m="water", n=12))
    p.append(S("sight_float", 0.02, (sx, sy, 1.305), m="yellow", n=8, rings=6))
    for z in (1.075, 1.465):
        p.append(C("sight_cap", 0.042, 0.03, (sx, sy, z), m="dark", n=14, r=0.006))
        p.append(B("sight_bracket", (0.03, 0.06, 0.03), (sx, sy + 0.04, z), m="dark", r=0.006))
    for dx in (-0.045, 0.045):
        p.append(B("sight_guard", (0.012, 0.012, 0.37), (sx + dx, sy - 0.012, 1.27), m="grey", r=0.0))
    for index in range(5):
        p.append(B("sight_tick", (0.025, 0.006, 0.006), (sx + 0.06, sy + 0.01, 1.12 + index * 0.075), m="dark", r=0.0))
    # Level stripe and dial on the small tank.
    for index, colour in enumerate(("green", "yellow", "orange")):
        p.append(B("level_mark", (0.05, 0.01, 0.06), (0.24, 0.1 - 0.172, 1.13 + index * 0.07), m=colour, r=0.0))
    pipe_z = 1.72
    p.append(H("top_pipe", [(-0.22, 0.08, 1.6), (-0.22, 0.08, pipe_z), (0.24, 0.08, pipe_z), (0.24, 0.1, 1.48)], 0.03, m="grey", bend=0.07))
    valve(p, (0.01, 0.08, pipe_z), "x", "orange", 0.03, wheel_r=0.06, reach=0.08)
    # Pipes down the back into the cabinet, and a drain hose on the right side.
    for x in (-0.3, 0.3):
        p.append(H("back_pipe", [(x, 0.27, 1.25), (x, 0.33, 1.2), (x, 0.33, 0.95)], 0.025, m="dark", bend=0.05))
    p.append(H("drain_hose", [(0.47, 0.25, 0.6), (0.5, 0.22, 0.45), (0.48, 0.12, 0.2), (0.46, 0.0, 0.08), (0.4, -0.12, 0.05)], 0.022, m="teal", smooth=True))
    p.append(C("hose_clamp", 0.028, 0.025, (0.47, 0.25, 0.6), (0, 90, 0), m="grey", n=10))
    p.append(C("pressure_gauge_stem", 0.012, 0.08, (0.24, 0.1, 1.58), m="grey", n=8))
    gauge(p, 0.24, 0.07, 1.64, r=0.045, angle=-30)
    return p


def _exercise_bike():
    p = []
    # Feet on little shock absorbers, and the main beam.
    for x in (-0.48, 0.48):
        p.append(B("foot", (0.1, 0.56, 0.06), (x, 0, 0.09), m="dark", r=0.02))
        for y in (-0.29, 0.29):
            p.append(B("foot_cap", (0.11, 0.04, 0.07), (x, y, 0.09), m="teal", r=0.015))
            p.append(C("damper", 0.035, 0.06, (x, y * 0.8, 0.03), m="rubber", n=12, r=0.008))
    p.append(B("beam", (1.0, 0.09, 0.08), (0, 0, 0.16), m="grey", r=0.02))
    # Flywheel housing with the crank and pedals.
    hx, hz = -0.18, 0.4
    p.append(C("housing", 0.24, 0.15, (hx, 0, hz), (90, 0, 0), m="white", n=32, r=0.03))
    p.append(C("housing_band", 0.243, 0.04, (hx, 0, hz), (90, 0, 0), m="teal", n=32))
    p.append(C("housing_cap", 0.09, 0.17, (hx, 0, hz), (90, 0, 0), m="dark", n=20, r=0.01))
    for side, pedal in ((-1, (hx + 0.12, hz - 0.12)), (1, (hx - 0.12, hz + 0.12))):
        y = side * 0.1
        p.append(beam("crank", (hx, y, hz), (pedal[0], y, pedal[1]), 0.035, 0.03, m="grey", r=0.01))
        p.append(C("crank_bolt", 0.025, 0.04, (hx, y, hz), (90, 0, 0), m="darker", n=12))
        p.append(B("pedal", (0.12, 0.08, 0.03), (pedal[0], side * 0.165, pedal[1]), m="darker", r=0.01))
        p.append(B("pedal_strap", (0.06, 0.09, 0.05), (pedal[0] + 0.01, side * 0.165, pedal[1] + 0.03), m="orange", r=0.012))
    # Seat post, seat and bottle.
    p.append(beam("seat_sleeve", (0.3, 0, 0.16), (0.33, 0, 0.5), 0.075, 0.075, m="dark", r=0.02))
    p.append(beam("seat_post", (0.33, 0, 0.45), (0.36, 0, 0.74), 0.05, 0.05, m="grey", r=0.012))
    p.append(C("seat_knob", 0.03, 0.05, (0.32, -0.06, 0.42), (90, 0, 0), m="orange", n=12, r=0.008))
    p.append(B("seat_base", (0.24, 0.14, 0.03), (0.37, 0, 0.75), m="dark", r=0.01))
    p.append(B("seat", (0.3, 0.22, 0.07), (0.38, 0, 0.795), m="orange", r=0.035))
    p.append(B("seat_stripe", (0.3, 0.05, 0.072), (0.38, 0, 0.797), m="white", r=0.0))
    p.append(T("bottle_cage", 0.04, 0.008, (0.4, 0, 0.42), m="dark", n=12, sides=4))
    p.append(C("bottle", 0.035, 0.17, (0.41, 0, 0.44), m="teal", n=12, r=0.01))
    p.append(C("bottle_cap", 0.02, 0.03, (0.41, 0, 0.54), m="white", n=10))
    # Handlebar column, handlebars and the console with its screen.
    p.append(beam("column", (-0.28, 0, 0.5), (-0.42, 0, 1.0), 0.07, 0.07, m="dark", r=0.02))
    p.append(beam("column_cover", (-0.3, 0, 0.56), (-0.36, 0, 0.78), 0.085, 0.085, m="white", r=0.025))
    p.append(C("resistance_knob", 0.035, 0.04, (-0.37, 0, 0.83), (0, 76, 0), m="orange", n=14, r=0.008))
    p.append(H("handlebar", [(-0.32, -0.25, 0.98), (-0.44, -0.25, 1.0), (-0.44, 0.25, 1.0), (-0.32, 0.25, 0.98)], 0.018, m="grey", bend=0.06))
    for y in (-0.25, 0.25):
        p.append(rod("grip", (-0.4, y, 0.995), (-0.29, y, 0.977), 0.024, m="rubber", n=10))
    console = [B("console", (0.26, 0.05, 0.17), (0, 0.0, 0), m="dark", r=0.02)]
    console.append(B("console_trim", (0.27, 0.03, 0.03), (0, 0.0, -0.08), m="teal", r=0.008))
    console.append(screen("bike_screen", 0.2, 0.11, (0, -0.027, 0.01), m="screen_cyan"))
    console.append(C("console_button", 0.012, 0.012, (0.11, -0.03, -0.055), (90, 0, 0), m="green", n=8))
    console.append(C("console_button", 0.012, 0.012, (0.08, -0.03, -0.055), (90, 0, 0), m="yellow", n=8))
    p += move(console, (-0.46, 0, 1.11), (-35, 0, 90))
    p.append(H("console_cable", [(-0.47, 0.03, 1.04), (-0.44, 0.05, 0.9), (-0.35, 0.05, 0.62), (-0.3, 0.06, 0.52)], 0.009, m="darker", smooth=True))
    return p


def _locker():
    p = []
    # The cabinet: open front, dark inside, the door slid up into the header.
    p.append(B("back", (0.7, 0.03, 1.94), (0, 0.285, 0.99), m="white", r=0.012))
    p.append(B("back_liner", (0.62, 0.01, 1.7), (0, 0.266, 0.95), m="dark", r=0.0))
    for side in (-1, 1):
        p.append(B("side", (0.035, 0.55, 1.96), (side * 0.3325, 0.025, 0.98), m="white", r=0.015))
        p.append(B("side_liner", (0.004, 0.5, 1.68), (side * 0.3135, 0.03, 0.94), m="dark", r=0.0))
        p.append(B("side_stripe", (0.004, 0.06, 1.5), (side * 0.352, -0.15, 0.95), m="teal", r=0.0))
        p.append(B("door_track", (0.02, 0.02, 1.68), (side * 0.303, -0.235, 0.94), m="grey", r=0.0))
    for index in range(5):
        p.append(B("vent", (0.005, 0.2, 0.018), (0.352, 0.08, 1.45 + index * 0.04), m="darker", r=0.0))
    p.append(B("plinth", (0.66, 0.53, 0.08), (0, 0.025, 0.04), m="dark", r=0.01))
    p.append(B("floor", (0.63, 0.5, 0.02), (0, 0.03, 0.09), m="steel", r=0.0))
    p.append(B("header", (0.7, 0.55, 0.22), (0, 0.025, 1.89), m="white", r=0.025))
    p.append(B("header_stripe", (0.71, 0.56, 0.04), (0, 0.025, 1.95), m="teal", r=0.012))
    p.append(B("name_plate", (0.22, 0.01, 0.06), (-0.12, -0.255, 1.86), m="cream", r=0.0))
    p.append(B("name_mark", (0.06, 0.012, 0.03), (-0.19, -0.256, 1.86), m="orange", r=0.0))
    led(p, 0.2, -0.25, 1.86, m="glow_green", r=0.014)
    p.append(B("door_edge", (0.62, 0.035, 0.07), (0, -0.235, 1.745), m="teal", r=0.015))
    handle(p, -0.12, 0.12, -0.252, 1.735, m="dark", r=0.011, out=0.03)
    p.append(B("inside_light", (0.5, 0.03, 0.012), (0, 0.0, 1.773), m="glow_white", r=0.0))
    # The spare suit, hanging on a hook at the back with its helmet on.
    sy = 0.07
    p.append(B("hook", (0.06, 0.08, 0.05), (0, 0.24, 1.48), m="dark", r=0.01))
    p.append(B("backpack", (0.34, 0.13, 0.48), (0, 0.19, 1.24), m="white", r=0.05))
    p.append(B("backpack_band", (0.35, 0.135, 0.05), (0, 0.19, 1.36), m="teal", r=0.015))
    p.append(B("torso", (0.36, 0.24, 0.46), (0, sy, 1.24), m="white", r=0.1, s=3))
    p.append(B("chest_box", (0.18, 0.07, 0.1), (0, sy - 0.14, 1.22), m="grey", r=0.02))
    for index, colour in enumerate(("teal", "orange", "green")):
        p.append(C("chest_button", 0.012, 0.012, (-0.05 + index * 0.05, sy - 0.18, 1.225), (90, 0, 0), m=colour, n=8))
    p.append(B("chest_badge", (0.06, 0.008, 0.04), (0.11, sy - 0.12, 1.37), m="violet", r=0.0))
    p.append(H("chest_hose", [(-0.08, sy - 0.16, 1.18), (-0.15, sy - 0.12, 1.08), (-0.17, sy + 0.02, 1.06), (-0.15, 0.15, 1.12)], 0.012, m="teal", smooth=True))
    p.append(T("neck_ring", 0.12, 0.025, (0, sy, 1.47), m="grey", n=24, sides=6))
    p.append(S("helmet", 0.155, (0, sy, 1.6), m="white", n=18, rings=10))
    visor = partial_sphere("visor", 0.159, loc=(0, sy, 1.6), material="darker", segments=n_(18), rings=n_(10, 6), plane=((0, -0.07, 0.01), (0, -1, -0.15)))
    p.append(visor)
    p.append(B("visor_shine", (0.05, 0.01, 0.02), (-0.05, sy - 0.15, 1.66), rot=(-20, -25, 0), m="teal", r=0.0))
    p.append(T("helmet_ring", 0.147, 0.012, (0, sy - 0.07, 1.6), rot=(90, 0, 0), m="orange", n=24, sides=4))
    p.append(B("hips", (0.34, 0.24, 0.22), (0, sy, 0.93), m="white", r=0.08, s=3))
    p.append(T("waist_ring", 0.16, 0.02, (0, sy, 1.03), m="dark", n=24, sides=6))
    for side in (-1, 1):
        x = side * 0.22
        p.append(B("shoulder", (0.14, 0.2, 0.12), (x, sy, 1.39), m="white", r=0.05))
        p.append(C("upper_arm", 0.07, 0.24, (x, sy, 1.24), m="white", n=14, r=0.03))
        p.append(T("elbow_ring", 0.07, 0.016, (x, sy, 1.12), m="orange", n=14, sides=4))
        p.append(C("forearm", 0.064, 0.2, (x * 1.02, sy - 0.01, 1.01), m="white", n=14, r=0.025))
        p.append(T("cuff", 0.064, 0.016, (x * 1.02, sy - 0.01, 0.92), m="teal", n=14, sides=4))
        p.append(S("glove", 0.058, (x * 1.02, sy - 0.015, 0.86), scale=(0.85, 1.0, 1.2), m="grey", n=10, rings=6))
        lx = side * 0.09
        p.append(C("thigh", 0.088, 0.28, (lx, sy, 0.76), m="white", n=14, r=0.03))
        p.append(T("knee_ring", 0.086, 0.018, (lx, sy, 0.6), m="orange", n=14, sides=4))
        p.append(C("shin", 0.082, 0.32, (lx, sy, 0.43), m="white", n=14, r=0.03))
        p.append(B("boot", (0.14, 0.24, 0.13), (lx, sy - 0.03, 0.22), m="grey", r=0.045))
        p.append(B("boot_sole", (0.15, 0.25, 0.03), (lx, sy - 0.03, 0.155), m="dark", r=0.01))
    p.append(C("patch", 0.035, 0.01, (-0.3, sy, 1.3), (0, 90, 0), m="violet", n=14))
    p.append(C("patch_dot", 0.018, 0.012, (-0.302, sy, 1.3), (0, 90, 0), m="yellow", n=10))
    return p


# ===========================================================================
# Greenhouse
# ===========================================================================


def lettuce(p, rng, x, y, z, size=1.0):
    """A leafy lettuce head: a ring of ruffled outer leaves round an upright pale heart."""
    outer = 6 if not LOW else 4
    inner = 3
    turn = rng.uniform(0, 360)
    for i in range(outer):
        yaw = turn + i * 360 / outer + rng.uniform(-12, 12)
        p.append(leaf("lettuce", 0.19 * size, 0.2 * size, (x, y, z), yaw, rng.uniform(24, 34), m="leaf_light" if i % 2 else "leaf", cup=0.5, droop=0.35, ruffle=0.14, seed=i, round_tip=True))
    for i in range(inner):
        yaw = turn + 45 + i * 360 / inner
        p.append(leaf("lettuce_heart", 0.13 * size, 0.15 * size, (x, y, z + 0.01), yaw, rng.uniform(52, 64), m="lettuce", cup=0.6, droop=0.15, ruffle=0.1, seed=i + 7, round_tip=True))


def chile(p, attach, length, radius, colour, rng):
    """A chile pepper hanging from `attach` (its stem end), with a green cap."""
    profile = [(0.0, 0.0), (radius * 0.35, length * 0.12), (radius * 0.75, length * 0.42), (radius, length * 0.78), (radius * 0.85, length * 0.95), (0.0, length)]
    pepper = L("pepper", profile, m=colour, n=8)
    for vertex in pepper.data.vertices:
        t = 1.0 - vertex.co.z / length
        vertex.co.x += 0.3 * length * t * t
    pepper.data.update()
    ax, ay, az = attach
    place(pepper, (ax, ay, az - length - 0.012), rot=(rng.uniform(-12, 12), rng.uniform(-10, 10), rng.uniform(0, 360)))
    p.append(pepper)
    p.append(C("pepper_cap", radius * 1.05, 0.018, (ax, ay, az - 0.012), m="stem", n=8, r2=radius * 0.5))
    p.append(C("pepper_stem", 0.004, 0.03, (ax, ay, az + 0.002), m="stem", n=6))


def _plant_rack():
    rng = random.Random(11)
    p = []
    for x in (-1.16, 0.0, 1.16):
        for y in (-0.36, 0.36):
            p.append(B("post", (0.06, 0.06, 2.2), (x, y, 1.1), m="dark", r=0.015))
            p.append(B("post_foot", (0.1, 0.1, 0.03), (x, y, 0.015), m="grey", r=0.008))
    p.append(B("top_frame", (2.38, 0.78, 0.06), (0, 0, 2.17), m="dark", r=0.015))
    p.append(B("top_trim", (2.38, 0.02, 0.04), (0, -0.39, 2.17), m="green", r=0.0))
    shelves = (0.35, 0.95, 1.55)
    for level, z in enumerate(shelves):
        p.append(B("shelf", (2.36, 0.74, 0.04), (0, 0, z), m="grey", r=0.012))
        p.append(B("shelf_lip", (2.36, 0.02, 0.05), (0, -0.375, z + 0.005), m="green", r=0.0))
        p.append(B("tray", (2.2, 0.56, 0.1), (0, -0.02, z + 0.07), m="white", r=0.025))
        p.append(B("tray_board", (2.12, 0.5, 0.01), (0, -0.02, z + 0.121), m="darker", r=0.0))
        for index in range(5):
            x = -0.88 + index * 0.44
            p.append(C("net_cup", 0.05, 0.012, (x, -0.02, z + 0.125), m="grey", n=12))
            lettuce(p, rng, x + rng.uniform(-0.03, 0.03), -0.02 + rng.uniform(-0.03, 0.03), z + 0.13, size=rng.uniform(0.9, 1.15))
        label(p, -0.95, -0.3, z + 0.08, 0.1, 0.045, m=("yellow", "orange", "teal")[level])
        # The water line along the back of the tray.
        p.append(H("water_tube", [(-1.06, 0.24, z + 0.135), (1.08, 0.24, z + 0.135), (1.1, 0.3, z + 0.12)], 0.012, m="teal", sides=6))
        # Grow light over the tray, under the next shelf up.
        light_z = (shelves[level + 1] if level < 2 else 2.17) - 0.04
        p.append(B("light_bar", (2.1, 0.12, 0.035), (0, -0.02, light_z), m="dark", r=0.01))
        p.append(B("grow_light", (2.0, 0.085, 0.01), (0, -0.02, light_z - 0.022), m="glow_pink", r=0.0))
        for x in (-0.95, 0.95):
            p.append(B("light_hanger", (0.03, 0.03, 0.03), (x, -0.02, light_z + 0.03), m="grey", r=0.0))
    # Water supply up the right end, from a reservoir with a pump on the floor.
    p.append(H("supply", [(1.1, 0.3, 0.3), (1.1, 0.3, 1.67)], 0.016, m="teal", sides=6))
    p.append(B("reservoir", (0.9, 0.5, 0.26), (0.55, 0.0, 0.17), m="white", r=0.03))
    p.append(B("reservoir_lid", (0.92, 0.52, 0.03), (0.55, 0.0, 0.3), m="teal", r=0.01))
    p.append(B("level_window", (0.2, 0.01, 0.12), (0.3, -0.255, 0.16), m="dark", r=0.0))
    p.append(B("level_water", (0.17, 0.008, 0.06), (0.3, -0.26, 0.135), m="water", r=0.0))
    p.append(B("pump", (0.16, 0.14, 0.14), (0.95, 0.15, 0.39), m="dark", r=0.02))
    led(p, 0.95, 0.08, 0.42, m="glow_green", r=0.01)
    p.append(H("pump_pipe", [(0.95, 0.22, 0.39), (1.1, 0.3, 0.39), (1.1, 0.3, 0.3)], 0.016, m="teal", sides=6, bend=0.05))
    p.append(C("nutrient_bottle", 0.06, 0.2, (-0.6, 0.0, 0.14), m="green", n=14, r=0.012))
    p.append(C("nutrient_cap", 0.03, 0.04, (-0.6, 0.0, 0.26), m="white", n=10))
    p.append(C("nutrient_bottle", 0.05, 0.16, (-0.45, 0.05, 0.12), m="violet", n=14, r=0.012))
    return p


def _pepper_plant():
    rng = random.Random(5)
    p = []
    p.append(C("saucer", 0.2, 0.025, (0, 0, 0.0125), m="white", n=24, r=0.008))
    p.append(L("pot", [(0.14, 0.02), (0.155, 0.035), (0.185, 0.25), (0.205, 0.255), (0.21, 0.3), (0.19, 0.3), (0.185, 0.27)], m="orange", n=24, caps=(True, False)))
    p.append(T("pot_band", 0.177, 0.012, (0, 0, 0.19), m="yellow", n=24, sides=4))
    p.append(C("soil", 0.186, 0.02, (0, 0, 0.272), m="soil", n=20))
    p.append(H("stem", [(0, 0, 0.27), (0.01, 0.0, 0.5), (-0.005, 0.01, 0.7)], 0.015, m="stem", smooth=True, sides=6))
    tips = []
    for index in range(6):
        a = math.radians(index * 60 + rng.uniform(-12, 12))
        z0 = 0.36 + index * 0.05
        out = rng.uniform(0.12, 0.15)
        tip = (out * math.cos(a), out * math.sin(a), z0 + rng.uniform(0.1, 0.16))
        mid = (out * 0.5 * math.cos(a), out * 0.5 * math.sin(a), z0 + 0.06)
        p.append(H("branch", [(0, 0, z0), mid, tip], 0.008, m="stem", smooth=True, sides=5, res=3))
        tips.append((tip, mid, math.degrees(a)))
    for tip, mid, heading in tips:
        for k in range(4 if not LOW else 3):
            yaw = heading - 90 + rng.uniform(-60, 60) + k * 40
            where = tip if k < 2 else mid
            p.append(leaf("leaf", rng.uniform(0.11, 0.13), 0.06, where, yaw, rng.uniform(5, 30), m=("leaf", "leaf_dark", "leaf", "leaf_light")[k], cup=0.2, droop=0.3))
    for k in range(5):
        p.append(leaf("leaf", 0.11, 0.06, (-0.005, 0.01, 0.69), k * 72 + 20, 40, m="leaf_light", cup=0.25, droop=0.2))
    # Peppers hanging under the branches, red and yellow.
    for index, (tip, mid, heading) in enumerate(tips):
        x, y, z = mid
        chile(p, (x * 1.15, y * 1.15, z - 0.005), rng.uniform(0.09, 0.11), 0.021, "pepper_red" if index % 2 == 0 else "pepper_yellow", rng)
        x, y, z = tip
        if index % 3 != 2:
            chile(p, (x * 0.85, y * 0.85, z - 0.03), rng.uniform(0.08, 0.1), 0.019, "pepper_yellow" if index % 2 == 0 else "pepper_red", rng)
    p.append(B("plant_tag_stick", (0.01, 0.006, 0.12), (0.1, -0.08, 0.32), m="white", r=0.0))
    p.append(B("plant_tag", (0.06, 0.008, 0.04), (0.1, -0.084, 0.38), m="pepper_red", r=0.0))
    return p


def _garden_bed():
    rng = random.Random(21)
    p = []
    # The bed: cream walls, green rim, dark corner posts, a name tag on the front.
    for y in (-0.47, 0.47):
        p.append(B("wall", (1.9, 0.06, 0.42), (0, y, 0.27), m="cream", r=0.02))
        p.append(B("rim", (1.94, 0.09, 0.04), (0, y, 0.5), m="green", r=0.015))
    for x in (-0.96, 0.96):
        p.append(B("wall", (0.06, 0.88, 0.42), (x, 0, 0.27), m="cream", r=0.02))
        p.append(B("rim", (0.09, 0.9, 0.04), (x, 0, 0.5), m="green", r=0.015))
    for x in (-0.96, 0.96):
        for y in (-0.47, 0.47):
            p.append(B("corner", (0.11, 0.11, 0.54), (x, y, 0.27), m="dark", r=0.025))
            p.append(B("corner_cap", (0.12, 0.12, 0.03), (x, y, 0.545), m="yellow", r=0.012))
    p.append(B("base", (1.9, 0.9, 0.06), (0, 0, 0.03), m="dark", r=0.01))
    for x in (-0.32, 0.32):
        vseam(p, x, -0.5, 0.1, 0.46, m="white", t=0.012)
    bolts(p, [(-0.32 + dx, z) for dx in (-0.03, 0.03) for z in (0.13, 0.43)] + [(0.32 + dx, z) for dx in (-0.03, 0.03) for z in (0.13, 0.43)], -0.5)
    p.append(B("name_tag_back", (0.4, 0.012, 0.15), (-0.62, -0.506, 0.3), m="orange", r=0.0))
    p.append(B("name_tag", (0.36, 0.012, 0.11), (-0.62, -0.514, 0.3), m="white", r=0.0))
    p.append(slab("name_star", [(0.03 * math.cos(math.radians(90 + 36 * i)) * (1 if i % 2 == 0 else 0.45), 0.03 * math.sin(math.radians(90 + 36 * i)) * (1 if i % 2 == 0 else 0.45)) for i in range(10)], 0.006, loc=(-0.75, -0.523, 0.3), m="yellow"))
    for index, width in enumerate((0.16, 0.1)):
        p.append(B("name_text", (width, 0.006, 0.014), (-0.6 + width / 2 - 0.05, -0.522, 0.32 - index * 0.035), m="dark", r=0.0))
    p.append(B("soil", (1.86, 0.86, 0.06), (0, 0, 0.41), m="soil", r=0.02))
    top = 0.44
    # Basil on the left: round leaves in little bushes.
    for cx, cy in ((-0.7, -0.14), (-0.5, 0.17)):
        p.append(C("basil_stem", 0.008, 0.1, (cx, cy, top + 0.05), m="stem", n=6))
        for k in range(7 if not LOW else 5):
            p.append(leaf("basil", rng.uniform(0.11, 0.13), 0.09, (cx, cy, top + 0.02), k * 51 + rng.uniform(-12, 12), rng.uniform(15, 32), m="leaf", cup=0.45, droop=0.25, round_tip=True))
        for k in range(4 if not LOW else 3):
            p.append(leaf("basil", 0.09, 0.07, (cx, cy, top + 0.07), k * 90 + 30, 50, m="leaf_light", cup=0.5, droop=0.12, round_tip=True))
        for k in range(3):
            p.append(leaf("basil", 0.06, 0.05, (cx, cy, top + 0.1), k * 120 + 70, 68, m="lettuce", cup=0.5, droop=0.05, round_tip=True))
    # Chives in the middle: thin blades, some with purple flowers.
    for cx, cy in ((-0.13, -0.12), (0.13, 0.15)):
        for k in range(10 if not LOW else 6):
            a = math.radians(k * 36 + rng.uniform(-10, 10))
            lean = rng.uniform(5, 16)
            height = rng.uniform(0.15, 0.2)
            blade = C("chive", 0.008, height, (0, 0, height / 2), m="leaf_dark", n=5, r2=0.002)
            place(blade, rot=(lean, 0, math.degrees(a)))
            place(blade, (cx + 0.025 * math.cos(a), cy + 0.025 * math.sin(a), top))
            p.append(blade)
            if k % 4 == 0:
                tip = Matrix.Rotation(a, 3, "Z") @ Vector((0, -math.sin(math.radians(lean)) * height, math.cos(math.radians(lean)) * height))
                p.append(S("chive_flower", 0.022, (cx + 0.025 * math.cos(a) + tip.x, cy + 0.025 * math.sin(a) + tip.y, top + tip.z), m="violet", n=8, rings=5))
    # Sprouts on the right, in two neat rows.
    for row, y in enumerate((-0.18, 0.15)):
        for k in range(5):
            x = 0.42 + k * 0.11 + (0.05 if row else 0)
            height = rng.uniform(0.06, 0.09)
            p.append(C("sprout_stem", 0.006, height, (x, y, top + height / 2), m="stem", n=5))
            for side in (0, 180):
                p.append(leaf("sprout_leaf", 0.05, 0.04, (x, y, top + height), side + rng.uniform(-20, 20) + k * 25, 25, m="leaf_light", cup=0.4, droop=0.15))
    # Little markers for each patch, and a drip line.
    for x, colour in ((-0.88, "green"), (-0.3, "violet"), (0.86, "yellow")):
        p.append(B("marker_stick", (0.01, 0.006, 0.12), (x, -0.36, top + 0.05), m="white", r=0.0))
        p.append(B("marker_flag", (0.06, 0.008, 0.04), (x + 0.02, -0.364, top + 0.1), m=colour, r=0.0))
    p.append(H("drip_line", [(0.93, 0.0, top + 0.01), (0.3, 0.0, top + 0.012), (-0.3, 0.02, top + 0.012), (-0.9, 0.0, top + 0.012)], 0.008, m="teal", smooth=True, sides=5))
    p.append(C("tap", 0.02, 0.06, (0.99, 0.0, 0.4), (0, 90, 0), m="grey", n=8))
    p.append(T("tap_wheel", 0.025, 0.007, (1.025, 0.0, 0.4), rot=(0, 90, 0), m="orange", n=10, sides=4))
    return p


def _dwarf_tree():
    rng = random.Random(8)
    p = []
    p.append(L("pot", [(0.36, 0.0), (0.4, 0.035), (0.47, 0.42), (0.5, 0.45), (0.5, 0.52), (0.46, 0.52), (0.45, 0.48)], m="white", n=40, caps=(True, False)))
    p.append(C("pot_foot", 0.37, 0.04, (0, 0, 0.02), m="dark", n=36))
    p.append(T("pot_band", 0.445, 0.02, (0, 0, 0.32), m="teal", n=40, sides=6))
    p.append(T("pot_band", 0.425, 0.012, (0, 0, 0.24), m="yellow", n=40, sides=4))
    p.append(C("soil", 0.455, 0.03, (0, 0, 0.475), m="soil", n=32))
    p.append(B("pot_label", (0.12, 0.012, 0.07), (0, -0.445, 0.15), rot=(-5, 0, 0), m="green", r=0.0))
    # Trunk and branches.
    p.append(H("trunk", [(0, 0, 0.47), (0.03, 0.01, 0.75), (-0.01, 0.02, 1.02), (0.0, 0.0, 1.25)], 0.055, m="bark", smooth=True, sides=8))
    for a, z, reach in ((20, 0.98, 0.32), (140, 1.04, 0.3), (250, 1.1, 0.3), (320, 1.18, 0.22)):
        r = math.radians(a)
        p.append(H("branch", [(0, 0, z), (0.5 * reach * math.cos(r), 0.5 * reach * math.sin(r), z + 0.12), (reach * math.cos(r), reach * math.sin(r), z + 0.3)], 0.025, m="bark", smooth=True, sides=6, res=3))
    p.append(rod("stake", (0.14, -0.1, 0.46), (0.1, -0.06, 1.0), 0.012, m="grey", n=6))
    p.append(T("tie", 0.045, 0.012, (0.07, -0.03, 0.85), m="teal", n=10, sides=4))
    # The crown: lumpy clumps of leaves with fruit on the outside.
    clumps = [((0.0, 0.0, 1.5), 0.36), ((0.3, 0.12, 1.36), 0.27), ((-0.28, 0.16, 1.4), 0.28), ((0.12, -0.3, 1.38), 0.26), ((-0.18, -0.24, 1.5), 0.25), ((0.05, 0.22, 1.66), 0.24), ((0.0, -0.05, 1.72), 0.2)]
    shades = ("leaf", "leaf_dark", "leaf", "leaf_light", "leaf_dark", "leaf", "leaf_light")
    for (centre, radius), shade_name in zip(clumps, shades):
        p.append(blob("crown", radius, centre, rng, m=shade_name, squash=0.85, lumps=0.22, detail=2))
    fruit = 0
    tries = 0
    while fruit < (12 if not LOW else 9) and tries < 200:
        tries += 1
        centre, radius = clumps[rng.randrange(len(clumps))]
        direction = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.6, 0.4)))
        if direction.length < 0.3:
            continue
        direction.normalize()
        point = Vector(centre) + Vector((direction.x, direction.y, direction.z * 0.85)) * radius * 0.95
        if (point.xy.length < 0.28 and point.z > 1.5) or point.z < 1.12:
            continue
        p.append(S("fruit", 0.04, tuple(point), m="fruit" if fruit % 3 else "yellow", n=8, rings=6))
        p.append(B("fruit_leaf", (0.03, 0.012, 0.006), tuple(point + Vector((0.0, 0.0, 0.04))), rot=(0, 0, rng.uniform(0, 180)), m="leaf_dark", r=0.0))
        fruit += 1
    return p


def _water_tank():
    p = []
    p.append(C("skirt", 0.4, 0.14, (0, 0, 0.07), m="dark", n=32, r=0.02))
    p.append(L("tank", [(0.38, 0.0), (0.38, 1.2), (0.34, 1.32), (0.24, 1.4), (0.0, 1.43)], loc=(0, 0, 0.12), m="white", n=32))
    for z in (0.35, 1.08):
        p.append(C("tank_band", 0.387, 0.05, (0, 0, z), m="teal", n=32))
    # The level window: water behind glass, with ticks beside it.
    p.append(B("window_frame", (0.15, 0.05, 0.86), (0, -0.375, 0.74), m="dark", r=0.02))
    p.append(B("window_water", (0.085, 0.01, 0.46), (0, -0.405, 0.54), m="water", r=0.0))
    p.append(B("window_empty", (0.085, 0.01, 0.3), (0, -0.405, 0.92), m="darker", r=0.0))
    p.append(B("window_glass", (0.095, 0.008, 0.78), (0, -0.413, 0.74), m="glass", r=0.0))
    for index in range(6):
        p.append(B("tick", (0.03 if index % 2 else 0.045, 0.008, 0.01), (0.1, -0.37, 0.4 + index * 0.13), m="dark", r=0.0))
    p.append(C("drop_badge", 0.05, 0.01, (-0.22, -0.31, 1.25), (90, 0, -35), m="teal", n=16))
    p.append(C("drop_dot", 0.02, 0.012, (-0.225, -0.317, 1.25), (90, 0, -35), m="white", n=10))
    # Outlet with a valve and a spout at the bottom front.
    p.append(H("outlet", [(0.2, -0.3, 0.32), (0.2, -0.36, 0.32), (0.2, -0.36, 0.14)], 0.03, m="grey", bend=0.04))
    valve(p, (0.2, -0.36, 0.25), "z", "orange", 0.03, wheel_r=0.06, reach=0.05)
    p.append(C("spout", 0.022, 0.04, (0.2, -0.36, 0.13), m="dark", n=10))
    # Lid, inlet and a gauge on top.
    p.append(C("lid", 0.13, 0.04, (0, 0, 1.56), m="grey", n=20, r=0.012))
    p.append(rod("lid_handle", (-0.06, 0.0, 1.6), (0.06, 0.0, 1.6), 0.01, m="dark", n=6))
    for x in (-0.06, 0.06):
        p.append(B("lid_post", (0.015, 0.015, 0.03), (x, 0.0, 1.585), m="dark", r=0.0))
    p.append(C("inlet", 0.04, 0.12, (0.2, 0.12, 1.47), m="grey", n=12))
    p.append(C("inlet_cap", 0.05, 0.03, (0.2, 0.12, 1.54), m="orange", n=12, r=0.008))
    p.append(C("gauge_stem", 0.01, 0.08, (-0.18, -0.12, 1.47), m="grey", n=6))
    gauge(p, -0.18, -0.14, 1.53, r=0.045, angle=30)
    return p


def _farm_console():
    p = []
    p.append(B("plinth", (0.66, 0.42, 0.04), (0, 0.05, 0.02), m="dark", r=0.01))
    p.append(B("body", (0.7, 0.45, 0.82), (0, 0.05, 0.45), m="white", r=0.04))
    p.append(B("body_band", (0.71, 0.46, 0.05), (0, 0.05, 0.75), m="green", r=0.015))
    p.append(B("door", (0.5, 0.02, 0.42), (0, -0.18, 0.36), m="cream", r=0.015))
    handle(p, 0.12, 0.3, -0.19, 0.18, m="dark", r=0.01, out=0.028, vertical=True)
    p.append(slab("leaf_sign", [(0.0, -0.06), (0.04, -0.02), (0.045, 0.03), (0.0, 0.07), (-0.045, 0.03), (-0.04, -0.02)], 0.008, loc=(-0.12, -0.194, 0.42), m="green"))
    # The slanted control desk: green screen, three sliders, three big buttons.
    desk = [B("desk", (0.8, 0.46, 0.07), (0, 0, 0), m="grey", r=0.025)]
    desk.append(B("desk_trim", (0.82, 0.04, 0.05), (0, -0.23, 0.0), m="green", r=0.012))
    desk.append(B("bezel", (0.5, 0.28, 0.03), (0, 0.07, 0.045), m="darker", r=0.012))
    desk.append(screen("farm_screen", 0.42, 0.22, (0, 0.075, 0.062), rot=(-90, 0, 0), m="screen_green"))
    for index, (x, colour, offset) in enumerate(((-0.33, "yellow", 0.03), (-0.25, "orange", -0.02), (-0.17, "teal", 0.01))):
        desk.append(B("slider_track", (0.025, 0.15, 0.01), (x, -0.13, 0.04), m="darker", r=0.0))
        desk.append(B("slider", (0.05, 0.035, 0.04), (x, -0.13 + offset, 0.055), m=colour, r=0.012))
    for x, colour in ((0.05, "green"), (0.17, "yellow"), (0.29, "teal")):
        desk.append(C("button_ring", 0.055, 0.016, (x, -0.13, 0.042), m="dark", n=18))
        desk.append(C("big_button", 0.045, 0.035, (x, -0.13, 0.06), m=colour, n=18, r=0.012))
    for index in range(4):
        desk.append(C("desk_led", 0.01, 0.01, (-0.32 + index * 0.04, 0.2, 0.04), m="glow_green" if index < 3 else "glow_amber", n=8))
    p += move(desk, (0, -0.02, 0.98), (30, 0, 0))
    p.append(B("neck", (0.6, 0.3, 0.16), (0, 0.06, 0.9), m="white", r=0.03))
    # A board at the back with status lights and a water drop.
    p.append(B("riser", (0.84, 0.07, 0.26), (0, 0.22, 1.17), m="white", r=0.025))
    p.append(B("riser_trim", (0.85, 0.075, 0.03), (0, 0.22, 1.285), m="green", r=0.01))
    for index, colour in enumerate(("glow_green", "glow_green", "glow_amber")):
        led(p, -0.3 + index * 0.08, 0.185, 1.2, m=colour, r=0.016)
    p.append(C("riser_badge", 0.04, 0.01, (0.28, 0.18, 1.18), (90, 0, 0), m="teal", n=14))
    # Hose reel on the right side.
    p.append(B("reel_bracket", (0.04, 0.16, 0.16), (0.37, 0.05, 0.5), m="dark", r=0.01))
    p.append(C("reel", 0.13, 0.08, (0.42, 0.05, 0.5), (0, 90, 0), m="grey", n=20, r=0.01))
    p.append(T("hose_coil", 0.1, 0.022, (0.42, 0.05, 0.5), rot=(0, 90, 0), m="green", n=20, sides=6))
    p.append(C("reel_hub", 0.04, 0.1, (0.43, 0.05, 0.5), (0, 90, 0), m="dark", n=10))
    p.append(H("hose_end", [(0.43, -0.03, 0.42), (0.44, -0.12, 0.3), (0.43, -0.16, 0.2)], 0.02, m="green", smooth=True, sides=6))
    p.append(C("nozzle", 0.025, 0.08, (0.43, -0.165, 0.17), m="orange", n=10))
    return p


def _bench():
    p = []
    for x in (-0.72, 0.72):
        p.append(B("end", (0.08, 0.44, 0.4), (x, 0, 0.22), m="white", r=0.03))
        p.append(B("foot", (0.1, 0.46, 0.04), (x, 0, 0.02), m="dark", r=0.01))
        p.append(B("end_stripe", (0.084, 0.06, 0.3), (x, -0.12, 0.24), m="teal", r=0.0))
    p.append(B("stretcher", (1.36, 0.06, 0.06), (0, 0.1, 0.13), m="dark", r=0.015))
    p.append(B("seat", (1.6, 0.48, 0.07), (0, 0, 0.42), m="grey", r=0.025))
    p.append(B("seat_trim", (1.6, 0.012, 0.03), (0, -0.242, 0.42), m="teal", r=0.0))
    for x in (-0.375, 0.375):
        p.append(B("cushion", (0.72, 0.42, 0.05), (x, 0, 0.475), m="green", r=0.022))
        for dx in (-0.2, 0.0, 0.2):
            p.append(C("tuft", 0.012, 0.006, (x + dx, 0, 0.5), m="leaf_dark", n=8))
    bolts(p, [(x, z) for x in (-0.72, 0.72) for z in (0.12, 0.34)], -0.22)
    return p


# ===========================================================================
# Lab
# ===========================================================================


def tube_glass(p, x, y, z, radius, height, fill, colour, cap=None, n=10):
    """A glass tube or jar standing at (x, y, z) with coloured contents (and a lid)."""
    p.append(C("glass", radius, height, (x, y, z + height / 2), m="glass", n=n))
    level = height * fill
    p.append(C("contents", radius * 0.8, level, (x, y, z + 0.004 + level / 2), m=colour, n=n))
    if cap:
        p.append(C("lid", radius * 1.08, max(0.012, radius * 0.4), (x, y, z + height + max(0.006, radius * 0.2)), m=cap, n=n, r=min(0.008, radius * 0.15)))


def _lab_bench():
    rng = random.Random(31)
    p = []
    z0 = 0.93
    p.append(B("top", (2.4, 0.8, 0.05), (0, 0, z0 - 0.025), m="white", r=0.015))
    p.append(B("top_trim", (2.4, 0.02, 0.035), (0, -0.4, z0 - 0.025), m="violet", r=0.0))
    p.append(B("upstand", (2.4, 0.04, 0.28), (0, 0.38, z0 + 0.14), m="cream", r=0.012))
    p.append(B("power_strip", (0.6, 0.03, 0.06), (0.7, 0.355, z0 + 0.12), m="dark", r=0.008))
    for index in range(4):
        p.append(B("socket", (0.06, 0.006, 0.035), (0.48 + index * 0.15, 0.338, z0 + 0.12), m="orange" if index % 2 else "teal", r=0.0))
    # Drawer stack on the left, a cupboard on the right, a footrest between.
    for x in (-0.85, 0.85):
        p.append(B("kick", (0.56, 0.66, 0.06), (x, 0.04, 0.03), m="dark", r=0.01))
        p.append(B("cabinet", (0.6, 0.72, 0.82), (x, 0.02, 0.47), m="white", r=0.02))
    for index, z in enumerate((0.2, 0.46, 0.72)):
        p.append(B("drawer", (0.56, 0.025, 0.24), (-0.85, -0.345, z), m="cream", r=0.015))
        handle(p, -0.95, -0.75, -0.358, z + 0.05, m="violet", r=0.01, out=0.03)
        label(p, -1.07, -0.358, z + 0.06, 0.07, 0.04, m=("teal", "yellow", "orange")[index])
    p.append(B("door", (0.56, 0.025, 0.76), (0.85, -0.345, 0.47), m="cream", r=0.015))
    handle(p, 0.66, 0.84, -0.358, 0.62, m="violet", r=0.011, out=0.03, vertical=True)
    p.append(C("door_badge", 0.06, 0.008, (0.9, -0.36, 0.7), (90, 0, 0), m="violet", n=18))
    p.append(C("door_badge_dot", 0.025, 0.01, (0.9, -0.362, 0.7), (90, 0, 0), m="white", n=12))
    p.append(B("modesty", (1.1, 0.02, 0.6), (0, 0.37, 0.55), m="grey", r=0.0))
    p.append(rod("footrest", (-0.55, 0.15, 0.14), (0.55, 0.15, 0.14), 0.02, m="steel", n=10))
    # Microscope: base, arm, stage, turret, eyepieces and focus knobs.
    mx, my = -0.62, 0.02
    p.append(B("scope_base", (0.24, 0.3, 0.05), (mx, my, z0 + 0.025), m="white", r=0.02))
    p.append(C("scope_lamp", 0.025, 0.012, (mx, my - 0.04, z0 + 0.055), m="glow_white", n=12))
    p.append(beam("scope_arm", (mx, my + 0.12, z0 + 0.04), (mx, my + 0.09, z0 + 0.4), 0.08, 0.08, m="violet", r=0.025))
    p.append(B("scope_stage", (0.17, 0.15, 0.02), (mx, my - 0.03, z0 + 0.15), m="dark", r=0.008))
    p.append(B("scope_slide", (0.1, 0.035, 0.004), (mx, my - 0.04, z0 + 0.162), m="glass", r=0.0))
    p.append(C("scope_sample", 0.01, 0.005, (mx, my - 0.04, z0 + 0.164), m="orange", n=8))
    p.append(B("scope_head", (0.1, 0.2, 0.1), (mx, my + 0.02, z0 + 0.37), m="white", r=0.03))
    p.append(C("scope_turret", 0.04, 0.04, (mx, my - 0.04, z0 + 0.31), m="dark", n=14))
    for k in range(3):
        a = math.radians(90 + k * 120)
        p.append(C("objective", 0.011, 0.06, (mx + 0.022 * math.cos(a), my - 0.04 + 0.022 * math.sin(a), z0 + 0.27), m="steel", n=8))
    p.append(rod("eyepiece_tube", (mx, my + 0.05, z0 + 0.41), (mx, my + 0.1, z0 + 0.5), 0.025, m="white", n=12))
    for dx in (-0.028, 0.028):
        p.append(rod("eyepiece", (mx + dx, my + 0.1, z0 + 0.49), (mx + dx, my + 0.13, z0 + 0.55), 0.015, m="darker", n=10))
    for dx in (-0.055, 0.055):
        p.append(C("focus_knob", 0.035, 0.02, (mx + dx, my + 0.1, z0 + 0.18), (0, 90, 0), m="orange", n=14))
    # Two racks of test tubes with coloured liquids.
    colours = ("green", "violet", "orange", "teal", "yellow", "pink")
    for rack, rx in enumerate((-0.15, 0.17)):
        p.append(B("rack_base", (0.27, 0.09, 0.015), (rx, -0.12, z0 + 0.0075), m="grey", r=0.0))
        p.append(B("rack_top", (0.27, 0.09, 0.012), (rx, -0.12, z0 + 0.075), m="violet" if rack == 0 else "teal", r=0.0))
        for dx in (-0.13, 0.13):
            p.append(B("rack_end", (0.012, 0.08, 0.075), (rx + dx, -0.12, z0 + 0.04), m="grey", r=0.0))
        for k in range(5):
            tube_glass(p, rx - 0.096 + k * 0.048, -0.12, z0 + 0.015, 0.013, 0.13, rng.uniform(0.35, 0.7), colours[(k + rack * 2) % len(colours)], cap=None if k % 2 else "white", n=8)
    tube_glass(p, 0.45, 0.12, z0, 0.045, 0.11, 0.55, "violet", n=14)
    p.append(B("beaker_lip", (0.02, 0.02, 0.01), (0.45, 0.075, z0 + 0.11), m="glass", r=0.0))
    # Sample bags with rocks, and a notebook.
    for k, (bx, by, yaw, rock) in enumerate(((0.62, -0.15, 12, "rust"), (0.82, -0.06, -20, "rock"), (1.0, -0.2, 35, "ochre"))):
        bag = [B("bag", (0.16, 0.12, 0.03), (0, 0, 0.015), m="glass", r=0.012)]
        bag.append(blob("bag_rock", 0.035, (0.01, 0.0, 0.018), rng, m=rock, squash=0.6, lumps=0.3, detail=1))
        bag.append(B("bag_zip", (0.012, 0.125, 0.008), (-0.07, 0, 0.026), m="teal", r=0.0))
        bag.append(B("bag_label", (0.04, 0.05, 0.004), (0.045, 0.02, 0.031), m="white", r=0.0))
        p += move(bag, (bx, by, z0), (0, 0, yaw))
    p.append(B("notebook", (0.22, 0.3, 0.02), (-0.25, 0.15, z0 + 0.01), rot=(0, 0, 8), m="violet", r=0.006))
    p.append(B("notebook_pages", (0.2, 0.29, 0.012), (-0.25, 0.15, z0 + 0.016), rot=(0, 0, 8), m="white", r=0.0))
    return p


def _sample_shelf():
    rng = random.Random(41)
    p = []
    for x in (-0.78, 0.78):
        p.append(B("side", (0.04, 0.4, 1.8), (x, 0, 0.9), m="white", r=0.015))
        p.append(B("side_stripe", (0.044, 0.05, 1.6), (x, -0.16, 0.9), m="violet", r=0.0))
    p.append(B("back", (1.52, 0.02, 1.76), (0, 0.19, 0.9), m="dark", r=0.0))
    p.append(B("plinth", (1.52, 0.36, 0.06), (0, 0.01, 0.03), m="dark", r=0.01))
    levels = (0.08, 0.5, 0.92, 1.34)
    for z in levels + (1.76,):
        p.append(B("shelf", (1.52, 0.38, 0.03), (0, 0, z), m="white", r=0.008))
        p.append(B("shelf_lip", (1.52, 0.012, 0.035), (0, -0.19, z + 0.005), m="violet", r=0.0))
    contents = ("rust", "rock", "ochre", "chalk")
    lids = ("violet", "teal", "orange", "yellow")
    for level, z in enumerate(levels[1:]):
        x = -0.66
        k = 0
        while x < 0.68:
            radius = rng.choice((0.05, 0.06, 0.07))
            height = rng.choice((0.14, 0.18, 0.22)) if radius < 0.07 else 0.14
            x += radius
            if x + radius > 0.74:
                break
            colour = contents[(k + level) % 4]
            tube_glass(p, x, -0.02, z + 0.015, radius, height, rng.uniform(0.55, 0.85), colour, cap=lids[(k * 3 + level) % 4], n=10)
            p.append(B("jar_label", (radius * 1.1, 0.006, 0.045), (x, -0.02 - radius - 0.002, z + 0.015 + height * 0.45), m="white", r=0.0))
            p.append(B("jar_mark", (radius * 0.5, 0.004, 0.015), (x, -0.02 - radius - 0.006, z + 0.015 + height * 0.45), m=colour if colour != "chalk" else "dark", r=0.0))
            x += radius + 0.045
            k += 1
    # Sample trays of rocks on the bottom shelf.
    for tx, colours in ((-0.38, ("rust", "rock", "ochre")), (0.38, ("chalk", "rust", "rock"))):
        p.append(B("tray", (0.6, 0.3, 0.08), (tx, -0.01, 0.135), m="cream", r=0.015))
        p.append(B("tray_label", (0.14, 0.006, 0.04), (tx, -0.163, 0.135), m="violet", r=0.0))
        for k, colour in enumerate(colours):
            p.append(blob("sample_rock", rng.uniform(0.06, 0.075), (tx - 0.18 + k * 0.18, -0.01, 0.19), rng, m=colour, squash=0.7, lumps=0.3, detail=1))
    p.append(B("sign", (0.5, 0.012, 0.08), (0, -0.2, 1.7), m="violet", r=0.0))
    p.append(B("sign_text", (0.3, 0.006, 0.02), (0, -0.208, 1.7), m="white", r=0.0))
    return p


def _spectrometer():
    rng = random.Random(51)
    p = []
    p.append(B("plinth", (1.16, 0.66, 0.04), (0, 0.04, 0.02), m="dark", r=0.01))
    p.append(B("cabinet", (1.2, 0.7, 0.72), (0, 0.04, 0.4), m="white", r=0.03))
    p.append(B("band", (1.21, 0.71, 0.04), (0, 0.04, 0.7), m="violet", r=0.012))
    front = -0.31
    p.append(B("door", (0.52, 0.02, 0.5), (-0.3, front - 0.008, 0.36), m="cream", r=0.015))
    handle(p, -0.12, 0.03, front - 0.018, 0.5, m="violet", r=0.01, out=0.028)
    p.append(dots("vents", [(0.15 + (k % 6) * 0.06, 0.2 + (k // 6) * 0.05) for k in range(18)], 0.04, 0.014, m="darker", y=front - 0.001))
    for k, colour in enumerate(("red", "orange", "yellow", "green", "teal", "violet")):
        p.append(B("rainbow", (0.03, 0.006, 0.06), (0.15 + k * 0.032, front - 0.003, 0.5), m=colour, r=0.0))
    # The rock chamber with its glass door.
    cx, cw, cz0, cz1 = -0.3, 0.5, 0.76, 1.18
    ch = cz1 - cz0
    p.append(B("chamber_back", (cw, 0.03, ch), (cx, 0.235, (cz0 + cz1) / 2), m="white", r=0.01))
    for side in (-1, 1):
        p.append(B("chamber_side", (0.03, 0.5, ch), (cx + side * (cw / 2 - 0.015), 0.0, (cz0 + cz1) / 2), m="white", r=0.01))
        p.append(B("chamber_liner", (0.004, 0.44, ch - 0.02), (cx + side * (cw / 2 - 0.032), 0.0, (cz0 + cz1) / 2), m="darker", r=0.0))
    p.append(B("chamber_liner", (cw - 0.06, 0.004, ch - 0.02), (cx, 0.218, (cz0 + cz1) / 2), m="darker", r=0.0))
    p.append(B("chamber_floor", (cw - 0.06, 0.46, 0.01), (cx, 0.0, cz0 + 0.005), m="dark", r=0.0))
    p.append(B("chamber_top", (cw, 0.5, 0.04), (cx, 0.0, cz1 + 0.02), m="grey", r=0.012))
    for z in (cz0 + 0.025, cz1 - 0.025):
        p.append(B("chamber_frame", (cw, 0.035, 0.05), (cx, -0.25, z), m="dark", r=0.012))
    for x in (cx - cw / 2 + 0.025, cx + cw / 2 - 0.025):
        p.append(B("chamber_frame", (0.05, 0.035, ch - 0.1), (x, -0.25, (cz0 + cz1) / 2), m="dark", r=0.012))
    p.append(B("chamber_glass", (cw - 0.08, 0.008, ch - 0.08), (cx, -0.25, (cz0 + cz1) / 2), m="glass", r=0.0))
    p.append(B("chamber_handle", (0.025, 0.03, 0.14), (cx + cw / 2 - 0.03, -0.28, (cz0 + cz1) / 2), m="violet", r=0.008))
    for z in (cz0 + 0.08, cz1 - 0.08):
        p.append(C("hinge", 0.014, 0.05, (cx - cw / 2 + 0.01, -0.27, z), m="grey", n=8))
    p.append(C("turntable", 0.08, 0.03, (cx, 0.02, cz0 + 0.02), m="dark", n=20, r=0.008))
    p.append(blob("rock", 0.075, (cx, 0.02, cz0 + 0.09), rng, m="rust", squash=0.75, lumps=0.3, detail=2))
    # Laser head on top, its glowing tip inside the chamber, its beam on the rock.
    p.append(C("laser", 0.055, 0.18, (cx, 0.02, cz1 + 0.13), m="dark", n=18, r=0.015))
    for z in (cz1 + 0.08, cz1 + 0.12, cz1 + 0.16):
        p.append(C("laser_fin", 0.07, 0.012, (cx, 0.02, z), m="grey", n=18))
    p.append(C("laser_cap", 0.06, 0.03, (cx, 0.02, cz1 + 0.235), m="violet", n=18, r=0.01))
    p.append(C("laser_tip", 0.022, 0.035, (cx, 0.02, cz1 - 0.012), m="glow_cyan", n=12))
    p.append(C("laser_beam", 0.004, cz1 - 0.03 - (cz0 + 0.14), (cx, 0.02, (cz1 - 0.03 + cz0 + 0.14) / 2), m="glow_cyan", n=6))
    p.append(H("laser_cable", [(cx + 0.05, 0.05, cz1 + 0.2), (cx + 0.2, 0.15, cz1 + 0.18), (0.1, 0.2, 0.95), (0.2, 0.2, 0.8)], 0.012, m="darker", smooth=True, sides=6))
    # The big screen on its stand, and a keypad.
    sx = 0.3
    p.append(B("stand_foot", (0.26, 0.2, 0.02), (sx, 0.08, 0.77), m="dark", r=0.008))
    p.append(B("stand_neck", (0.06, 0.04, 0.2), (sx, 0.1, 0.87), m="grey", r=0.01))
    p.append(B("monitor", (0.58, 0.05, 0.38), (sx, 0.07, 1.15), m="dark", r=0.02))
    p.append(B("monitor_trim", (0.58, 0.052, 0.02), (sx, 0.07, 0.97), m="violet", r=0.0))
    p.append(screen("spec_screen", 0.52, 0.32, (sx, 0.07 - 0.027, 1.155), m="screen_cyan"))
    keypad = [B("keypad", (0.4, 0.13, 0.03), (0, 0, 0), m="grey", r=0.01)]
    for k in range(8):
        keypad.append(B("key", (0.035, 0.03, 0.012), (-0.15 + (k % 4) * 0.045, -0.02 + (k // 4) * 0.045, 0.018), m=("teal", "white", "white", "orange")[k % 4], r=0.0))
    keypad.append(C("dial", 0.03, 0.025, (0.13, 0.0, 0.02), m="violet", n=14))
    p += move(keypad, (sx, -0.2, 0.78), (12, 0, 0))
    led(p, -0.52, front - 0.005, 0.62, m="glow_green")
    led(p, -0.47, front - 0.005, 0.62, m="glow_cyan")
    return p


def _radio_console():
    rng = random.Random(61)
    p = []
    top = 0.77
    p.append(B("desk", (2.0, 0.75, 0.05), (0, 0.0, top - 0.025), m="white", r=0.015))
    p.append(B("desk_trim", (2.0, 0.02, 0.035), (0, -0.375, top - 0.025), m="violet", r=0.0))
    for x in (-0.73, 0.73):
        p.append(B("pedestal", (0.5, 0.66, 0.72), (x, 0.03, 0.36), m="white", r=0.02))
    for index, z in enumerate((0.15, 0.37, 0.59)):
        p.append(B("drawer", (0.46, 0.02, 0.19), (-0.73, -0.305, z), m="cream", r=0.012))
        handle(p, -0.8, -0.66, -0.315, z + 0.03, m="violet", r=0.009, out=0.025)
    for index, z in enumerate((0.22, 0.52)):
        p.append(B("radio_unit", (0.46, 0.03, 0.25), (0.73, -0.31, z), m="dark", r=0.012))
        for k in range(3):
            knob(p, 0.58 + k * 0.08, -0.325, z - 0.04, r=0.025, m=("orange", "teal", "yellow")[(k + index) % 3], depth=0.025)
        p.append(B("radio_display", (0.14, 0.006, 0.05), (0.85, -0.328, z + 0.06), m="green" if index else "teal", r=0.0))
        led(p, 0.58, -0.325, z + 0.07, m="glow_green", r=0.01)
        led(p, 0.62, -0.325, z + 0.07, m="glow_amber", r=0.01)
    p.append(B("modesty", (0.96, 0.02, 0.6), (0, 0.33, 0.42), m="grey", r=0.0))
    # Back riser with three screens, the outer two turned in a little.
    p.append(B("riser", (1.96, 0.08, 0.7), (0, 0.33, top + 0.35), m="cream", r=0.02))
    p.append(B("riser_cap", (1.98, 0.1, 0.04), (0, 0.33, top + 0.71), m="violet", r=0.012))
    for x, turn in ((-0.62, 18), (0.0, 0), (0.62, -18)):
        screen_parts = [B("bezel", (0.56, 0.04, 0.36), (0, 0, 0), m="dark", r=0.02)]
        screen_parts.append(screen("radio_screen", 0.5, 0.3, (0, -0.021, 0.005), m="screen_cyan"))
        screen_parts.append(B("bezel_arm", (0.08, 0.1, 0.08), (0, 0.06, 0), m="grey", r=0.01))
        p += move(screen_parts, (x, 0.22, top + 0.38), (0, 0, turn))
    p.append(B("on_air", (0.2, 0.03, 0.05), (0, 0.27, top + 0.65), m="glow_amber", r=0.0))
    p.append(B("on_air_frame", (0.24, 0.025, 0.07), (0, 0.29, top + 0.65), m="dark", r=0.008))
    # Slanted strip of dials in front of the screens.
    strip = [B("dial_strip", (1.5, 0.14, 0.04), (0, 0, 0), m="grey", r=0.012)]
    strip.append(C("tuning_dial", 0.055, 0.03, (0.55, 0.0, 0.03), m="orange", n=20, r=0.008))
    strip.append(B("tuning_mark", (0.008, 0.03, 0.006), (0.55, 0.03, 0.047), m="white", r=0.0))
    for k in range(7):
        strip.append(C("small_knob", 0.02, 0.025, (-0.6 + k * 0.12, 0.0, 0.03), m=("teal", "white", "yellow", "white", "violet", "white", "green")[k], n=10))
    strip.append(B("freq_display", (0.18, 0.08, 0.006), (0.3, 0.0, 0.022), m="green", r=0.0))
    p += move(strip, (0, 0.13, top + 0.04), (18, 0, 0))
    # Keyboard.
    p.append(B("keyboard", (0.46, 0.16, 0.025), (0, -0.17, top + 0.013), m="dark", r=0.008))
    for row in range(3):
        for k in range(9 if not LOW else 3):
            width = 0.036 if LOW is False else 0.12
            p.append(B("key", (width, 0.03, 0.012), (-0.18 + k * (0.045 if not LOW else 0.135) + (0.0 if not LOW else 0.045), -0.215 + row * 0.042, top + 0.03), m="white" if (row + k) % 5 else "violet", r=0.0))
    # Microphone on a gooseneck stand.
    mx, my = -0.42, -0.12
    p.append(C("mic_base", 0.065, 0.025, (mx, my, top + 0.0125), m="dark", n=18, r=0.008))
    p.append(C("mic_button", 0.018, 0.012, (mx + 0.03, my - 0.03, top + 0.028), m="orange", n=10))
    p.append(H("gooseneck", [(mx, my, top + 0.02), (mx, my + 0.01, top + 0.15), (mx + 0.02, my - 0.04, top + 0.27), (mx + 0.03, my - 0.12, top + 0.3)], 0.009, m="steel", smooth=True, sides=6))
    mic = C("mic", 0.03, 0.09, m="darker", n=12, r=0.012)
    p.append(aim(mic, (mx + 0.03, my - 0.12, top + 0.3), (mx + 0.04, my - 0.2, top + 0.28)))
    p.append(S("mic_grille", 0.033, (mx + 0.04, my - 0.2, top + 0.28), m="grey", n=10, rings=6))
    # Headset on a little stand.
    hx, hy = 0.5, -0.1
    p.append(C("headset_stand", 0.05, 0.015, (hx, hy, top + 0.008), m="dark", n=14))
    p.append(C("headset_post", 0.01, 0.2, (hx, hy, top + 0.11), m="grey", n=8))
    p.append(H("headband", [(hx - 0.08, hy, top + 0.16), (hx - 0.06, hy, top + 0.22), (hx, hy, top + 0.24), (hx + 0.06, hy, top + 0.22), (hx + 0.08, hy, top + 0.16)], 0.012, m="darker", smooth=True, sides=6))
    for side in (-1, 1):
        p.append(C("ear_cup", 0.045, 0.035, (hx + side * 0.09, hy, top + 0.14), (0, 90, 0), m="dark", n=16, r=0.01))
        p.append(C("ear_pad", 0.038, 0.016, (hx + side * 0.068, hy, top + 0.14), (0, 90, 0), m="violet", n=14))
    p.append(H("headset_mic", [(hx - 0.1, hy - 0.01, top + 0.13), (hx - 0.1, hy - 0.08, top + 0.11), (hx - 0.06, hy - 0.12, top + 0.1)], 0.005, m="darker", smooth=True, sides=5))
    p.append(S("headset_mic_ball", 0.012, (hx - 0.06, hy - 0.12, top + 0.1), m="grey", n=8, rings=5))
    p.append(H("antenna_cable", [(0.9, 0.36, top + 0.6), (0.95, 0.39, top + 0.5), (0.97, 0.39, 0.2), (0.97, 0.39, 0.02)], 0.015, m="darker", smooth=True, sides=6))
    return p


# ===========================================================================
# Workshop
# ===========================================================================


def _gear_outline(radius, teeth, depth=0.035):
    points = []
    for k in range(teeth):
        a = 2 * math.pi * k / teeth
        step = 2 * math.pi / teeth
        for frac, r in ((0.0, radius - depth), (0.2, radius - depth), (0.32, radius), (0.68, radius), (0.8, radius - depth)):
            points.append((r * math.cos(a + step * frac), r * math.sin(a + step * frac)))
    return points


def spool(p, x, y, z, colour):
    """A filament spool turning around X."""
    p.append(C("spool_core", 0.06, 0.12, (x, y, z), (0, 90, 0), m="darker", n=14))
    p.append(C("spool_filament", 0.14, 0.09, (x, y, z), (0, 90, 0), m=colour, n=24))
    for dx in (-0.055, 0.055):
        p.append(C("spool_flange", 0.165, 0.012, (x + dx, y, z), (0, 90, 0), m="white", n=24))


def _printer_3d():
    p = []
    # Frame: four posts, top rails, a base full of electronics.
    for x in (-0.86, 0.86):
        for y in (-0.66, 0.66):
            p.append(B("post", (0.08, 0.08, 2.2), (x, y, 1.1), m="grey", r=0.015))
            p.append(B("post_cap", (0.1, 0.1, 0.04), (x, y, 2.18), m="orange", r=0.012))
    for y in (-0.66, 0.66):
        p.append(B("rail_x", (1.64, 0.08, 0.08), (0, y, 2.12), m="orange", r=0.015))
    for x in (-0.86, 0.86):
        p.append(B("rail_y", (0.08, 1.24, 0.08), (x, 0, 2.12), m="dark", r=0.015))
    p.append(B("base", (1.66, 1.26, 0.4), (0, 0, 0.2), m="white", r=0.035))
    p.append(B("base_band", (1.67, 1.27, 0.05), (0, 0, 0.36), m="orange", r=0.015))
    front = -0.63
    p.append(B("panel", (0.44, 0.03, 0.24), (-0.45, front - 0.012, 0.19), m="dark", r=0.015))
    p.append(screen("printer_screen", 0.36, 0.17, (-0.45, front - 0.029, 0.195), m="screen_amber"))
    knob(p, -0.12, front, 0.2, r=0.05, m="orange", depth=0.035)
    for k, colour in enumerate(("green", "yellow", "teal")):
        button(p, 0.04 + k * 0.07, front, 0.2, r=0.022, m=colour)
    p.append(B("card_slot", (0.08, 0.008, 0.015), (0.4, front - 0.004, 0.25), m="darker", r=0.0))
    led(p, 0.55, front, 0.25, m="glow_amber", r=0.012)
    led(p, 0.6, front, 0.25, m="glow_green", r=0.012)
    p.append(dots("vents", [(0.32 + (k % 6) * 0.05, 0.12 + (k // 6) * 0.04) for k in range(12)], 0.035, 0.012, m="darker", y=front - 0.001))
    # Z-axis screws at the sides, the build plate and the half-printed parts.
    for x in (-0.78, 0.78):
        p.append(rod("z_screw", (x, 0.12, 0.4), (x, 0.12, 2.08), 0.022, m="steel", n=10))
        p.append(B("z_motor", (0.12, 0.12, 0.1), (x, 0.12, 2.03), m="dark", r=0.015))
    for x in (-0.5, 0.5):
        for y in (-0.4, 0.4):
            p.append(B("bed_post", (0.05, 0.05, 0.18), (x, y, 0.49), m="dark", r=0.0))
    p.append(B("bed", (1.2, 1.0, 0.04), (0, 0, 0.6), m="dark", r=0.012))
    p.append(B("bed_sheet", (1.14, 0.94, 0.006), (0, 0, 0.622), m="steel", r=0.0))
    for k in range(5):
        p.append(B("bed_line", (1.12, 0.006, 0.004), (0, -0.36 + k * 0.18, 0.626), m="grey", r=0.0))
        p.append(B("bed_line", (0.006, 0.92, 0.004), (-0.45 + k * 0.225, 0, 0.626), m="grey", r=0.0))
    p.append(prism("gear", _gear_outline(0.2, 12 if not LOW else 10), 0.1, loc=(-0.25, 0.12, 0.675), material="orange", round=0.006 if not LOW else 0.0, segments=1))
    p.append(C("gear_hub", 0.07, 0.11, (-0.25, 0.12, 0.68), m="darker", n=16))
    p.append(C("part", 0.15, 0.2, (0.3, -0.1, 0.725), m="teal", n=28))
    for k in range(4):
        p.append(B("infill", (0.26, 0.008, 0.006), (0.3, -0.1, 0.826), rot=(0, 0, 45 + 90 * (k % 2)), m="white", r=0.0))
    for k in range(3):
        p.append(T("layer_line", 0.151, 0.004, (0.3, -0.1, 0.65 + k * 0.05), m="water", n=24, sides=4))
    # Gantry with the print head, its glowing nozzle just above the part.
    gz = 1.08
    p.append(B("x_beam", (1.62, 0.1, 0.1), (0, 0.0, gz), m="orange", r=0.02))
    for x in (-0.78, 0.78):
        p.append(B("z_carriage", (0.12, 0.2, 0.2), (x, 0.06, gz), m="dark", r=0.02))
    p.append(B("head", (0.18, 0.12, 0.22), (0.3, -0.1, gz - 0.02), m="white", r=0.035))
    p.append(B("head_stripe", (0.185, 0.125, 0.04), (0.3, -0.1, gz + 0.04), m="orange", r=0.012))
    p.append(C("head_fan", 0.05, 0.02, (0.3, -0.165, gz - 0.04), (90, 0, 0), m="darker", n=16))
    p.append(T("head_fan_guard", 0.035, 0.005, (0.3, -0.177, gz - 0.04), rot=(90, 0, 0), m="grey", n=12, sides=4))
    p.append(B("heater", (0.06, 0.05, 0.04), (0.3, -0.1, gz - 0.16), m="steel", r=0.0))
    p.append(C("nozzle", 0.02, 0.035, (0.3, -0.1, gz - 0.198), m="copper", n=10, r2=0.006))
    p.append(S("nozzle_glow", 0.011, (0.3, -0.1, gz - 0.222), m="glow_amber", n=8, rings=6))
    # Spools at the back, filament to the head, a cable chain.
    p.append(rod("spool_rod", (-0.82, 0.52, 1.78), (0.82, 0.52, 1.78), 0.015, m="steel", n=8))
    for x in (-0.82, 0.82):
        p.append(B("spool_bracket", (0.04, 0.16, 0.04), (x, 0.6, 1.78), m="dark", r=0.0))
    for x, colour in ((-0.45, "teal"), (0.0, "orange"), (0.45, "violet")):
        spool(p, x, 0.52, 1.78, colour)
    p.append(H("filament", [(-0.45, 0.42, 1.73), (-0.2, 0.2, 1.6), (0.2, -0.05, 1.35), (0.3, -0.1, gz + 0.1)], 0.008, m="white", smooth=True, sides=5))
    p.append(H("cable_chain", [(0.78, 0.0, gz + 0.12), (0.62, -0.02, gz + 0.22), (0.45, -0.06, gz + 0.16), (0.36, -0.1, gz + 0.09)], 0.022, m="darker", smooth=True, sides=6))
    return p


def _workbench():
    rng = random.Random(71)
    p = []
    top = 0.95
    p.append(B("top", (2.2, 0.85, 0.06), (0, 0.0, top - 0.03), m="grey", r=0.015))
    p.append(B("top_edge", (2.2, 0.025, 0.045), (0, -0.425, top - 0.03), m="orange", r=0.0))
    p.append(B("upstand", (2.2, 0.03, 0.12), (0, 0.41, top + 0.06), m="white", r=0.01))
    for x in (-1.04, 1.04):
        for y in (-0.36, 0.36):
            p.append(B("leg", (0.08, 0.08, top - 0.06), (x, y, (top - 0.06) / 2), m="dark", r=0.015))
            p.append(B("leg_foot", (0.11, 0.11, 0.03), (x, y, 0.015), m="rubber", r=0.008))
    p.append(B("shelf", (2.1, 0.75, 0.03), (0, 0.0, 0.18), m="grey", r=0.008))
    p.append(B("drawers", (0.55, 0.78, 0.32), (0.74, 0.02, top - 0.22), m="white", r=0.02))
    for z in (top - 0.15, top - 0.3):
        p.append(B("drawer", (0.51, 0.02, 0.13), (0.74, -0.375, z), m="cream", r=0.012))
        handle(p, 0.66, 0.82, -0.385, z, m="dark", r=0.009, out=0.025)
    label(p, 0.92, -0.385, top - 0.15, 0.06, 0.035, m="yellow")
    # On the shelf: a crate and a coil of cable.
    p.append(B("shelf_crate", (0.5, 0.36, 0.26), (-0.55, 0.05, 0.325), m="orange", r=0.03))
    p.append(B("shelf_crate_band", (0.51, 0.37, 0.04), (-0.55, 0.05, 0.4), m="dark", r=0.01))
    p.append(T("cable_coil", 0.13, 0.03, (0.2, 0.1, 0.225), m="yellow", n=20, sides=6))
    # The vice at the front left, holding a part.
    vx, vy = -0.78, -0.27
    p.append(B("vice_base", (0.18, 0.22, 0.04), (vx, vy, top + 0.02), m="dark", r=0.01))
    p.append(B("vice_body", (0.14, 0.26, 0.09), (vx, vy, top + 0.085), m="orange", r=0.02))
    p.append(B("vice_jaw", (0.2, 0.05, 0.09), (vx, vy + 0.1, top + 0.15), m="grey", r=0.01))
    p.append(B("vice_jaw", (0.2, 0.05, 0.09), (vx, vy - 0.07, top + 0.15), m="grey", r=0.01))
    p.append(B("vice_part", (0.14, 0.12, 0.05), (vx, vy + 0.015, top + 0.2), m="copper", r=0.008))
    p.append(rod("vice_screw", (vx, vy - 0.1, top + 0.1), (vx, vy - 0.2, top + 0.1), 0.012, m="steel", n=8))
    p.append(rod("vice_bar", (vx - 0.1, vy - 0.2, top + 0.1), (vx + 0.1, vy - 0.2, top + 0.1), 0.01, m="steel", n=8))
    for dx in (-0.1, 0.1):
        p.append(S("vice_ball", 0.018, (vx + dx, vy - 0.2, top + 0.1), m="dark", n=8, rings=6))
    # Tools lying on top.
    p.append(B("hammer_handle", (0.3, 0.035, 0.03), (-0.38, -0.2, top + 0.015), rot=(0, 0, 20), m="orange", r=0.01))
    p.append(B("hammer_head", (0.05, 0.14, 0.05), (-0.25, -0.15, top + 0.025), rot=(0, 0, 20), m="steel", r=0.008))
    p.append(C("driver_grip", 0.02, 0.11, (-0.1, -0.25, top + 0.02), (0, 90, -10), m="teal", n=10, r=0.006))
    p.append(C("driver_shaft", 0.005, 0.14, (0.02, -0.27, top + 0.02), (0, 90, -10), m="steel", n=6))
    p.append(B("wrench", (0.24, 0.03, 0.01), (0.15, -0.15, top + 0.005), rot=(0, 0, -30), m="steel", r=0.0))
    for end in (-1, 1):
        p.append(C("wrench_end", 0.03, 0.012, (0.15 + end * 0.104, -0.15 - end * 0.06, top + 0.006), m="steel", n=12))
    p.append(C("tape", 0.045, 0.04, (-0.05, 0.05, top + 0.045), (90, 0, 0), m="yellow", n=16, r=0.01))
    p.append(C("tape_side", 0.025, 0.045, (-0.05, 0.05, top + 0.045), (90, 0, 0), m="dark", n=12))
    for k in range(4):
        p.append(C("nut", 0.014, 0.012, (0.0 + k * 0.04, -0.33 + (k % 2) * 0.03, top + 0.006), m="steel", n=6))
    # Toolbox on the right.
    tx, ty = 0.55, 0.12
    p.append(B("toolbox", (0.5, 0.24, 0.2), (tx, ty, top + 0.1), m="orange", r=0.03))
    p.append(B("toolbox_lid", (0.51, 0.25, 0.04), (tx, ty, top + 0.19), m="red", r=0.015))
    p.append(H("toolbox_handle", [(tx - 0.12, ty, top + 0.21), (tx - 0.12, ty, top + 0.27), (tx + 0.12, ty, top + 0.27), (tx + 0.12, ty, top + 0.21)], 0.014, m="dark", bend=0.03))
    for dx in (-0.15, 0.15):
        p.append(B("toolbox_latch", (0.05, 0.02, 0.05), (tx + dx, ty - 0.125, top + 0.16), m="steel", r=0.0))
    # A clamp lamp at the back.
    lx, ly = -0.2, 0.33
    p.append(C("lamp_foot", 0.06, 0.03, (lx, ly, top + 0.015), m="dark", n=12))
    p.append(beam("lamp_arm", (lx, ly, top + 0.03), (lx + 0.05, ly - 0.05, top + 0.38), 0.025, 0.025, m="orange", r=0.008))
    p.append(beam("lamp_arm", (lx + 0.05, ly - 0.05, top + 0.38), (lx + 0.12, ly - 0.24, top + 0.45), 0.022, 0.022, m="orange", r=0.008))
    head = C("lamp_head", 0.04, 0.1, m="dark", n=14, r2=0.07)
    p.append(aim(head, (lx + 0.12, ly - 0.24, top + 0.47), (lx + 0.15, ly - 0.3, top + 0.38)))
    p.append(S("lamp_bulb", 0.04, (lx + 0.155, ly - 0.31, top + 0.37), m="glow_amber", n=10, rings=6))
    return p


def _tool_wall():
    p = []
    z0, z1 = 0.9, 2.5
    zc = (z0 + z1) / 2
    face = 0.045
    p.append(B("board", (2.36, 0.03, 1.56), (0, 0.06, zc), m="cream", r=0.01))
    for z in (z0 + 0.025, z1 - 0.025):
        p.append(B("frame", (2.4, 0.04, 0.05), (0, 0.055, z), m="orange", r=0.012))
    for x in (-1.175, 1.175):
        p.append(B("frame", (0.05, 0.04, 1.5), (x, 0.055, zc), m="orange", r=0.012))
    if not LOW:
        holes = [(-1.05 + i * 0.1, z0 + 0.1 + j * 0.1) for i in range(22) for j in range(14)]
        p.append(dots("holes", holes, 0.016, 0.016, m="dark", y=face - 0.001))
    # Light bar along the top.
    p.append(B("light_bar", (2.2, 0.08, 0.04), (0, 0.01, z1 - 0.07), m="dark", r=0.01))
    p.append(B("light", (2.1, 0.05, 0.008), (0, 0.005, z1 - 0.092), m="glow_white", r=0.0))
    y = 0.015
    # Three spanners.
    for k, length in enumerate((0.36, 0.3, 0.25)):
        x = -1.0 + k * 0.11
        zt = 2.2
        p.append(B("spanner", (0.035, 0.012, length), (x, y, zt - length / 2), m="steel", r=0.0))
        p.append(T("spanner_ring", 0.032, 0.01, (x, y, zt + 0.02), rot=(90, 0, 0), m="steel", n=12, sides=4))
        for dx in (-0.022, 0.022):
            p.append(B("spanner_jaw", (0.016, 0.012, 0.05), (x + dx, y, zt - length - 0.015), rot=(0, -dx * 300, 0), m="steel", r=0.0))
        p.append(rod("peg", (x, face, zt + 0.02), (x, -0.005, zt + 0.02), 0.005, m="grey", n=6))
    # Hammer.
    hx = -0.55
    p.append(B("hammer_grip", (0.045, 0.035, 0.16), (hx, y, 1.82), m="rubber", r=0.012))
    p.append(B("hammer_handle", (0.035, 0.03, 0.2), (hx, y, 2.0), m="orange", r=0.01))
    p.append(B("hammer_head", (0.17, 0.05, 0.055), (hx - 0.01, y, 2.12), m="steel", r=0.012))
    p.append(B("hammer_claw", (0.06, 0.04, 0.03), (hx - 0.11, y, 2.105), rot=(0, 25, 0), m="steel", r=0.0))
    # Pliers.
    px = -0.25
    for side in (-1, 1):
        p.append(B("pliers_grip", (0.03, 0.02, 0.15), (px + side * 0.028, y, 1.86), rot=(0, side * 8, 0), m="red", r=0.008))
        p.append(B("pliers_jaw", (0.02, 0.015, 0.08), (px + side * 0.008, y, 2.0), rot=(0, -side * 6, 0), m="steel", r=0.0))
    p.append(C("pliers_pivot", 0.015, 0.03, (px, y - 0.005, 1.955), (90, 0, 0), m="dark", n=8))
    # The drill on its bracket.
    dx0, dz0 = 0.3, 1.95
    p.append(B("drill_bracket", (0.2, 0.06, 0.03), (dx0 + 0.05, 0.02, dz0 - 0.08), m="dark", r=0.0))
    p.append(B("drill_body", (0.26, 0.08, 0.11), (dx0 + 0.05, y - 0.02, dz0), m="orange", r=0.035))
    p.append(C("drill_motor", 0.05, 0.05, (dx0 + 0.19, y - 0.02, dz0), (0, 90, 0), m="dark", n=14, r=0.01))
    p.append(C("drill_chuck", 0.032, 0.07, (dx0 - 0.11, y - 0.02, dz0), (0, 90, 0), m="darker", n=12, r2=0.024))
    p.append(C("drill_bit", 0.007, 0.12, (dx0 - 0.2, y - 0.02, dz0), (0, 90, 0), m="steel", n=6))
    p.append(B("drill_handle", (0.06, 0.07, 0.17), (dx0 + 0.1, y - 0.02, dz0 - 0.13), rot=(0, 12, 0), m="dark", r=0.02))
    p.append(B("drill_trigger", (0.025, 0.03, 0.04), (dx0 + 0.06, y - 0.02, dz0 - 0.08), m="yellow", r=0.0))
    p.append(B("drill_battery", (0.13, 0.09, 0.07), (dx0 + 0.13, y - 0.02, dz0 - 0.24), m="orange", r=0.02))
    p.append(B("drill_battery_band", (0.135, 0.095, 0.015), (dx0 + 0.13, y - 0.02, dz0 - 0.215), m="dark", r=0.0))
    # Screwdrivers in a holder, a tape measure.
    p.append(B("driver_holder", (0.32, 0.07, 0.03), (0.85, 0.01, 2.1), m="dark", r=0.008))
    for k, colour in enumerate(("yellow", "teal", "red", "green")):
        x = 0.74 + k * 0.075
        p.append(C("driver_grip", 0.017, 0.1, (x, -0.005, 2.165), m=colour, n=10, r=0.006))
        p.append(C("driver_shaft", 0.005, 0.14 - k * 0.015, (x, -0.005, 2.08 - (0.14 - k * 0.015) / 2), m="steel", n=6))
    p.append(C("tape", 0.055, 0.05, (0.95, 0.01, 1.6), (90, 0, 0), m="yellow", n=16, r=0.012))
    p.append(C("tape_cap", 0.03, 0.056, (0.95, 0.01, 1.6), (90, 0, 0), m="dark", n=12))
    # A little shelf of screw jars.
    p.append(B("jar_shelf", (0.6, 0.12, 0.025), (-0.5, -0.0, 1.12), m="dark", r=0.008))
    for k, colour in enumerate(("steel", "copper", "steel", "alu")):
        tube_glass(p, -0.72 + k * 0.145, -0.01, 1.133, 0.04, 0.09, 0.6, colour, cap=("orange", "teal", "yellow", "orange")[k], n=12)
    return p


def _crate_regolith():
    rng = random.Random(81)
    p = []
    p.append(B("bottom", (0.74, 0.74, 0.04), (0, 0, 0.06), m="dark", r=0.0))
    for y in (-0.3, 0.3):
        p.append(B("skid", (0.8, 0.1, 0.04), (0, y, 0.02), m="dark", r=0.01))
    for y in (-0.375, 0.375):
        p.append(B("wall", (0.72, 0.05, 0.46), (0, y, 0.31), m="cream", r=0.015))
        p.append(B("rim", (0.74, 0.06, 0.04), (0, y, 0.52), m="orange", r=0.012))
    for x in (-0.375, 0.375):
        p.append(B("wall", (0.05, 0.72, 0.46), (x, 0, 0.31), m="cream", r=0.015))
        p.append(B("rim", (0.06, 0.74, 0.04), (x, 0, 0.52), m="orange", r=0.012))
        p.append(B("hand_slot", (0.012, 0.2, 0.06), (x * 1.04, 0, 0.42), m="darker", r=0.0))
    for x in (-0.37, 0.37):
        for y in (-0.37, 0.37):
            p.append(B("corner", (0.07, 0.07, 0.5), (x, y, 0.29), m="grey", r=0.02))
    p.append(B("crate_label", (0.26, 0.008, 0.12), (-0.12, -0.404, 0.3), m="orange", r=0.0))
    p.append(B("crate_label_text", (0.18, 0.006, 0.025), (-0.12, -0.409, 0.32), m="white", r=0.0))
    p.append(B("crate_label_text", (0.12, 0.006, 0.02), (-0.15, -0.409, 0.28), m="white", r=0.0))
    p.append(B("crate_tag", (0.1, 0.008, 0.1), (0.2, -0.404, 0.3), rot=(0, 45, 0), m="yellow", r=0.0))
    # Sacks of regolith, tied at the top; one is open.
    sacks = ((-0.16, -0.15, "yellow", True), (0.17, -0.14, "teal", False), (-0.15, 0.17, "orange", False), (0.17, 0.17, "yellow", False))
    for x, y, tie, open_top in sacks:
        body = blob("sack", 0.21, (x, y, 0.37), rng, m="sack", squash=1.0, lumps=0.1, detail=2, scale=(0.9, 0.85, 1.12))
        for vertex in body.data.vertices:
            if vertex.co.z < 0.1:
                vertex.co.z = 0.1 - (0.1 - vertex.co.z) * 0.2
        body.data.update()
        p.append(body)
        if open_top:
            p.append(T("sack_roll", 0.14, 0.03, (x, y, 0.59), m="sack", n=18, sides=6))
            p.append(blob("regolith", 0.13, (x, y, 0.6), rng, m="regolith", squash=0.35, lumps=0.25, detail=2))
            p.append(B("scoop", (0.1, 0.07, 0.03), (x + 0.03, y - 0.02, 0.64), rot=(15, 0, 30), m="steel", r=0.01))
            p.append(rod("scoop_handle", (x + 0.07, y - 0.05, 0.65), (x + 0.16, y - 0.12, 0.7), 0.01, m="orange", n=8))
        else:
            p.append(C("sack_neck", 0.08, 0.05, (x, y, 0.6), m="sack", n=12, r2=0.042))
            p.append(T("sack_tie", 0.045, 0.014, (x, y, 0.625), m=tie, n=12, sides=4))
            p.append(S("sack_top", 0.05, (x, y, 0.65), scale=(1.0, 0.8, 0.55), m="sack", n=10, rings=6))
    return p


def _metal_rack():
    p = []
    for x in (-0.65, 0.65):
        for y in (-0.25, 0.25):
            p.append(B("post", (0.06, 0.06, 1.18), (x, y, 0.61), m="dark", r=0.015))
        p.append(B("foot", (0.1, 0.6, 0.04), (x, 0, 0.02), m="dark", r=0.01))
        p.append(rod("brace", (x, -0.22, 0.12), (x, 0.22, 0.98), 0.012, m="steel", n=6))
    levels = (0.3, 0.68, 1.05)
    for level, z in enumerate(levels):
        for x in (-0.65, 0.65):
            p.append(B("cross_arm", (0.07, 0.56, 0.05), (x, 0, z), m="orange", r=0.012))
        for y in (-0.2, 0.2):
            p.append(B("rail", (1.26, 0.04, 0.04), (0, y, z + 0.01), m="grey", r=0.008))
        label(p, -0.45, -0.22, z, 0.1, 0.03, m=("yellow", "teal", "orange")[level])
    # Plates on the bottom level.
    for k, colour in enumerate(("steel", "alu", "copper", "steel")):
        p.append(B("plate", (1.18 - k * 0.06, 0.44 - k * 0.03, 0.022), (0.01 * k, 0.005 * k, 0.345 + k * 0.023), rot=(0, 0, k * 1.5 - 2), m=colour, r=0.004))
    # Round bars in the middle, their ends painted to show what they are.
    for k, (colour, radius, tip) in enumerate((("steel", 0.025, "yellow"), ("copper", 0.02, "copper"), ("alu", 0.03, "teal"), ("steel", 0.022, "red"), ("alu", 0.025, "teal"), ("copper", 0.02, "copper"))):
        y = -0.16 + k * 0.064
        z = 0.72 + radius
        p.append(rod("bar", (-0.62, y, z), (0.62 - (k % 3) * 0.05, y, z), radius, m=colour, n=10))
        p.append(C("bar_end", radius + 0.002, 0.012, (0.625 - (k % 3) * 0.05, y, z), (0, 90, 0), m=tip, n=10))
    # Square tubes and angles on top.
    for k, colour in enumerate(("steel", "alu", "steel")):
        y = -0.14 + k * 0.08
        p.append(B("square_tube", (1.24, 0.05, 0.05), (0.0, y, 1.1), m=colour, r=0.006))
        p.append(B("tube_end", (0.006, 0.034, 0.034), (0.623, y, 1.1), m="darker", r=0.0))
    for k in range(2):
        y = 0.14 + k * 0.06
        p.append(B("angle_a", (1.2, 0.05, 0.008), (0.0, y, 1.079), m="alu", r=0.0))
        p.append(B("angle_b", (1.2, 0.008, 0.05), (0.0, y - 0.021, 1.1), m="alu", r=0.0))
    return p


def _robot_arm():
    p = []
    p.append(B("base_plate", (0.8, 0.8, 0.05), (0, 0, 0.025), m="dark", r=0.015))
    for x in (-0.33, 0.33):
        for y in (-0.33, 0.33):
            if not LOW:
                p.append(C("bolt", 0.02, 0.02, (x, y, 0.06), m="steel", n=6))
    for x in (-0.25, 0.25):
        p.append(B("stripe_pad", (0.16, 0.08, 0.006), (x, -0.36, 0.053), m="yellow", r=0.0))
        p.append(B("stripe_dark", (0.03, 0.085, 0.007), (x, -0.36, 0.054), rot=(0, 0, 40), m="darker", r=0.0))
    p.append(B("control_box", (0.16, 0.12, 0.14), (0.28, 0.27, 0.12), m="white", r=0.02))
    led(p, 0.25, 0.21, 0.15, m="glow_green", r=0.012)
    p.append(C("stop_button", 0.025, 0.02, (0.31, 0.27, 0.2), m="red", n=12))
    # Pedestal and turntable with a glowing ring.
    p.append(C("pedestal", 0.22, 0.3, (0, 0, 0.2), m="white", n=32, r=0.03))
    p.append(C("pedestal_band", 0.224, 0.05, (0, 0, 0.12), m="orange", n=32))
    p.append(C("turret", 0.2, 0.12, (0, 0, 0.41), m="grey", n=32, r=0.02))
    p.append(T("turret_light", 0.205, 0.012, (0, 0, 0.47), m="glow_cyan", n=32, sides=5))
    # Shoulder, upper arm, elbow, forearm, wrist and gripper.
    shoulder = Vector((0, 0, 0.66))
    elbow = Vector((0, 0.16, 1.42))
    wrist = Vector((0, -0.24, 1.66))
    p.append(B("shoulder", (0.3, 0.3, 0.26), (0, 0, 0.6), m="white", r=0.08, s=3))
    p.append(C("shoulder_joint", 0.13, 0.36, tuple(shoulder), (0, 90, 0), m="grey", n=24, r=0.02))
    for side in (-1, 1):
        p.append(T("joint_light", 0.11, 0.012, (side * 0.183, shoulder.y, shoulder.z), rot=(0, 90, 0), m="glow_cyan", n=24, sides=5))
    p.append(beam("upper_arm", shoulder, elbow, 0.18, 0.15, m="white", r=0.06))
    p.append(beam("upper_arm_stripe", shoulder + Vector((0, -0.07, 0.15)), elbow + Vector((0, -0.07, -0.15)), 0.1, 0.02, m="orange", r=0.0))
    p.append(C("elbow_joint", 0.1, 0.26, tuple(elbow), (0, 90, 0), m="grey", n=20, r=0.02))
    for side in (-1, 1):
        p.append(T("joint_light", 0.085, 0.01, (side * 0.133, elbow.y, elbow.z), rot=(0, 90, 0), m="glow_cyan", n=20, sides=5))
    p.append(beam("forearm", elbow, wrist, 0.14, 0.12, m="white", r=0.05))
    p.append(beam("forearm_stripe", elbow + Vector((0, -0.03, 0.065)), wrist + Vector((0, 0.06, 0.06)), 0.07, 0.015, m="orange", r=0.0))
    p.append(C("wrist_joint", 0.07, 0.18, tuple(wrist), (0, 90, 0), m="grey", n=16, r=0.015))
    p.append(T("joint_light", 0.058, 0.009, (0.093, wrist.y, wrist.z), rot=(0, 90, 0), m="glow_cyan", n=16, sides=5))
    hand = wrist + Vector((0, -0.05, -0.12))
    p.append(rod("wrist_roll", wrist, hand, 0.055, m="dark", n=16))
    p.append(B("palm", (0.15, 0.09, 0.06), tuple(hand + Vector((0, 0, -0.02))), m="white", r=0.02))
    for side in (-1, 1):
        p.append(B("finger", (0.03, 0.06, 0.11), tuple(hand + Vector((side * 0.05, -0.005, -0.1))), m="grey", r=0.01))
        p.append(B("finger_tip", (0.034, 0.064, 0.03), tuple(hand + Vector((side * 0.05, -0.005, -0.15))), m="orange", r=0.008))
    # A camera eye on the wrist, so the robot can see what it holds.
    p.append(C("eye", 0.035, 0.04, (0, wrist.y - 0.07, wrist.z + 0.02), (90, 0, 0), m="dark", n=16, r=0.008))
    p.append(C("eye_lens", 0.02, 0.012, (0, wrist.y - 0.092, wrist.z + 0.02), (90, 0, 0), m="glow_cyan", n=12))
    p.append(H("arm_cable", [(0, 0.2, 0.45), (0, 0.17, 0.8), (0, 0.24, 1.2), (0, 0.24, 1.42), (0, 0.12, 1.52)], 0.022, m="darker", smooth=True, sides=6))
    return p


# ===========================================================================
# Observatory
# ===========================================================================

PIVOT = 1.48  # height of the telescope's altitude axis
TILT = 40.0  # the tube points this many degrees up, toward -Y


def _telescope():
    """
    A big tube on a fork mount on a short pier. The axis sits near the back of the tube,
    so the mount and the tube's lower end stay inside the 1.6 m footprint while the
    front end reaches out above head height toward -Y.
    """
    p = []
    # Base: four feet with levelling pads, the pier, a motor box.
    for angle in (45, 135, 225, 315):
        a = math.radians(angle)
        p.append(B("foot", (0.92, 0.14, 0.1), (0.36 * math.cos(a), 0.36 * math.sin(a), 0.06), rot=(0, 0, angle), m="dark", r=0.03))
        p.append(C("foot_pad", 0.08, 0.04, (0.72 * math.cos(a), 0.72 * math.sin(a), 0.02), m="grey", n=16, r=0.01))
    p.append(C("pier_flange", 0.36, 0.06, (0, 0, 0.13), m="dark", n=32, r=0.02))
    p.append(C("pier", 0.24, 0.42, (0, 0, 0.37), m="white", n=32))
    p.append(C("pier_band", 0.245, 0.05, (0, 0, 0.3), m="violet", n=32))
    p.append(C("pier_top", 0.34, 0.05, (0, 0, 0.585), m="dark", n=32, r=0.015))
    p.append(B("motor_box", (0.2, 0.1, 0.2), (0, -0.28, 0.36), m="grey", r=0.025))
    led(p, -0.05, -0.33, 0.41, m="glow_green", r=0.012)
    led(p, 0.0, -0.33, 0.41, m="glow_cyan", r=0.012)
    p.append(B("motor_label", (0.12, 0.006, 0.04), (0.0, -0.333, 0.32), m="violet", r=0.0))
    # Fork mount.
    p.append(C("turntable", 0.45, 0.1, (0, 0, 0.66), m="grey", n=40, r=0.025))
    p.append(C("turntable_band", 0.455, 0.03, (0, 0, 0.66), m="violet", n=40))
    for side in (-1, 1):
        p.append(B("fork_arm", (0.12, 0.34, 1.0), (side * 0.5, 0, 0.71 + 0.5), m="white", r=0.05))
        p.append(B("fork_stripe", (0.124, 0.06, 0.7), (side * 0.5, -0.13, 1.08), m="violet", r=0.0))
        p.append(C("bearing", 0.13, 0.16, (side * 0.5, 0, PIVOT), (0, 90, 0), m="grey", n=24, r=0.02))
        p.append(C("bearing_cap", 0.08, 0.18, (side * 0.5, 0, PIVOT), (0, 90, 0), m="violet", n=16, r=0.012))
    # Counterweights on the right, a hand controller hanging on the left.
    p.append(rod("weight_bar", (0.58, 0, PIVOT), (0.8, 0, PIVOT), 0.025, m="steel", n=12))
    for x in (0.66, 0.73):
        p.append(C("weight", 0.13, 0.055, (x, 0, PIVOT), (0, 90, 0), m="dark", n=24, r=0.012))
        p.append(T("weight_ring", 0.13, 0.012, (x, 0, PIVOT), rot=(0, 90, 0), m="yellow", n=24, sides=4))
    p.append(C("weight_knob", 0.035, 0.03, (0.785, 0, PIVOT), (0, 90, 0), m="orange", n=12))
    p.append(H("controller_cable", [(-0.56, -0.12, 1.3), (-0.62, -0.18, 1.15), (-0.6, -0.22, 1.0), (-0.58, -0.22, 0.93)], 0.01, m="darker", smooth=True, sides=5))
    p.append(B("controller", (0.07, 0.04, 0.15), (-0.58, -0.22, 0.85), m="dark", r=0.015))
    for k, colour in enumerate(("orange", "teal", "white")):
        p.append(B("controller_key", (0.02, 0.008, 0.015), (-0.58, -0.243, 0.89 - k * 0.03), m=colour, r=0.0))
    # The tube, built along +Z around the axis and then tipped up toward -Y.
    tube = []
    tube.append(C("tube", 0.35, 2.42, (0, 0, 0.59), m="white", n=36))
    tube.append(L("dew_shield", [(0.37, 1.8), (0.37, 2.2), (0.345, 2.2), (0.345, 1.86), (0.0, 1.86)], m="dark", n=36, caps=(True, False)))
    tube.append(T("front_rim", 0.37, 0.025, (0, 0, 2.2), m="violet", n=36, sides=6))
    tube.append(C("objective", 0.335, 0.008, (0, 0, 1.87), m="glass", n=28))
    tube.append(C("rear_cell", 0.33, 0.2, (0, 0, -0.7), m="dark", n=28, r=0.02))
    tube.append(C("focuser", 0.06, 0.16, (0, 0, -0.86), m="grey", n=14))
    tube.append(B("diagonal", (0.1, 0.1, 0.1), (0, 0, -0.96), m="dark", r=0.02))
    tube.append(C("eyepiece", 0.035, 0.14, (0, 0.11, -0.96), (-90, 0, 0), m="darker", n=12, r=0.008))
    for z in (-0.32, 0.5):
        tube.append(T("tube_ring", 0.36, 0.03, (0, 0, z), m="violet", n=36, sides=6))
    for side in (-1, 1):
        tube.append(C("trunnion", 0.1, 0.1, (side * 0.39, 0, 0), (0, 90, 0), m="grey", n=20))
    for z in (0.95, 1.55):
        tube.append(B("finder_foot", (0.04, 0.13, 0.05), (0, 0.4, z), m="dark", r=0.01))
    tube.append(C("finder", 0.055, 0.62, (0, 0.47, 1.25), m="violet", n=16, r=0.012))
    tube.append(C("finder_glass", 0.045, 0.006, (0, 0.47, 1.563), m="glass", n=14))
    tube.append(C("finder_eyepiece", 0.025, 0.08, (0, 0.47, 0.9), m="darker", n=10))
    tube.append(B("tube_label", (0.15, 0.006, 0.3), (0, -0.351, 1.1), m="violet", r=0.0))
    for part in tube:
        place(part, (0, 0, PIVOT), rot=(90 - TILT, 0, 0))
    p += tube
    return p


def _star_console():
    p = []
    top = 0.76
    p.append(B("desk", (1.6, 0.45, 0.05), (0, 0.155, top - 0.025), m="white", r=0.015))
    p.append(B("desk_trim", (1.6, 0.02, 0.035), (0, -0.07, top - 0.025), m="violet", r=0.0))
    for x in (-0.76, 0.76):
        p.append(B("side", (0.05, 0.43, top - 0.05), (x, 0.16, (top - 0.05) / 2), m="white", r=0.02))
    p.append(B("modesty", (1.48, 0.02, 0.5), (0, 0.36, 0.45), m="grey", r=0.0))
    p.append(B("riser", (1.5, 0.05, 0.08), (0, 0.33, top + 0.04), m="dark", r=0.012))
    for x, turn in ((-0.37, 10), (0.37, -10)):
        parts = [B("bezel", (0.62, 0.04, 0.38), (0, 0, 0), m="dark", r=0.02)]
        parts.append(screen("star_screen", 0.56, 0.32, (0, -0.021, 0.005), m="screen_cyan"))
        parts.append(B("arm", (0.06, 0.08, 0.2), (0, 0.04, -0.25), m="grey", r=0.01))
        p += move(parts, (x, 0.3, top + 0.35), (0, 0, turn))
    # On the desk: a star chart, a little planet, a slewing joystick, a keyboard.
    p.append(B("chart", (0.32, 0.22, 0.004), (-0.48, 0.05, top + 0.002), rot=(0, 0, 6), m="dark", r=0.0))
    for k, (dx, dy) in enumerate(((-0.08, 0.04), (0.02, -0.05), (0.09, 0.06), (-0.03, 0.08), (0.11, -0.02))):
        p.append(B("chart_star", (0.014, 0.014, 0.004), (-0.48 + dx, 0.05 + dy, top + 0.005), rot=(0, 0, 45), m="yellow" if k % 2 else "white", r=0.0))
    p.append(C("planet_stand", 0.04, 0.02, (0.55, 0.12, top + 0.01), m="dark", n=12))
    p.append(C("planet_post", 0.006, 0.08, (0.55, 0.12, top + 0.05), m="grey", n=6))
    p.append(S("planet", 0.06, (0.55, 0.12, top + 0.15), m="orange", n=14, rings=10))
    p.append(T("planet_ring", 0.09, 0.006, (0.55, 0.12, top + 0.15), rot=(20, 10, 0), m="yellow", n=24, sides=4))
    p.append(C("stick_base", 0.05, 0.03, (0.32, -0.0, top + 0.015), m="dark", n=14, r=0.008))
    p.append(rod("stick", (0.32, 0.0, top + 0.03), (0.33, -0.01, top + 0.13), 0.009, m="steel", n=6))
    p.append(S("stick_ball", 0.025, (0.33, -0.01, top + 0.14), m="orange", n=10, rings=6))
    p.append(B("keyboard", (0.42, 0.14, 0.02), (-0.05, 0.02, top + 0.01), m="dark", r=0.006))
    for k in range(6 if not LOW else 2):
        p.append(B("key_row", (0.38 if k % 2 == 0 else 0.34, 0.016, 0.006), (-0.05, -0.03 + (k // 2) * 0.04 + (k % 2) * 0.0, top + 0.023), m="white" if k % 2 == 0 else "violet", r=0.0))
    # The chair, fixed to a rail on the floor that runs to the desk.
    cy = -0.18
    p.append(B("chair_rail", (0.14, 0.62, 0.03), (0, 0.04, 0.015), m="dark", r=0.008))
    p.append(B("rail_clamp", (0.2, 0.08, 0.06), (0, 0.3, 0.03), m="grey", r=0.012))
    p.append(B("chair_foot", (0.3, 0.3, 0.04), (0, cy, 0.04), m="grey", r=0.015))
    p.append(C("chair_column", 0.04, 0.34, (0, cy, 0.23), m="steel", n=12))
    p.append(B("seat_base", (0.4, 0.38, 0.03), (0, cy, 0.41), m="dark", r=0.01))
    p.append(B("seat", (0.46, 0.42, 0.08), (0, cy, 0.46), m="violet", r=0.035))
    p.append(B("backrest", (0.44, 0.08, 0.42), (0, cy - 0.21, 0.76), rot=(-8, 0, 0), m="violet", r=0.035))
    p.append(B("backrest_shell", (0.46, 0.04, 0.44), (0, cy - 0.255, 0.76), rot=(-8, 0, 0), m="white", r=0.015))
    p.append(B("back_post", (0.06, 0.04, 0.3), (0, cy - 0.24, 0.5), rot=(-8, 0, 0), m="grey", r=0.01))
    for side in (-1, 1):
        p.append(B("arm_post", (0.03, 0.03, 0.12), (side * 0.22, cy - 0.04, 0.55), m="grey", r=0.0))
        p.append(B("arm_pad", (0.06, 0.26, 0.04), (side * 0.22, cy - 0.04, 0.62), m="dark", r=0.015))
    return p


# ===========================================================================
# Every module
# ===========================================================================


def _airlock_door():
    p = []
    n = n_(48, 24)
    oz = 1.155  # middle of the doorway
    frame_out = rrect_by_angle(1.8, 2.5, 0.32, n, cx=0, cz=oz, ox=0, oz=1.25)
    frame_in = rrect_by_angle(1.12, 1.95, 0.26, n, cx=0, cz=oz, ox=0, oz=oz)
    p.append(plate("frame", frame_out, frame_in, 0.4, m="white", r=0.03))
    p.append(plate("frame_trim", rrect_by_angle(1.3, 2.13, 0.34, n, cx=0, cz=oz, ox=0, oz=oz), rrect_by_angle(1.12, 1.95, 0.26, n, cx=0, cz=oz, ox=0, oz=oz), 0.03, loc=(0, -0.2, 0), m="teal", r=0.0))
    # The door itself, with a round window looking into the airlock.
    wz = 1.62
    leaf_out = rrect_by_angle(1.08, 1.91, 0.24, n, cx=0, cz=wz, ox=0, oz=oz)
    p.append(plate("door", leaf_out, circle_xz(0.17, n, 0, wz), 0.1, loc=(0, 0.04, 0), m="grey", r=0.02))
    p.append(B("door_panel", (0.8, 0.012, 0.5), (0, -0.016, 0.55), m="cream", r=0.0))
    p.append(T("window_ring", 0.19, 0.035, (0, -0.02, wz), rot=(90, 0, 0), m="dark", n=n_(32, 16), sides=6))
    p.append(C("window_glass", 0.175, 0.01, (0, 0.04, wz), (90, 0, 0), m="glass", n=n_(28, 14)))
    p.append(B("airlock_inside", (0.6, 0.06, 0.6), (0, 0.19, wz), m="darker", r=0.0))
    p.append(B("airlock_lamp", (0.2, 0.02, 0.03), (0.1, 0.155, wz + 0.2), m="glow_green", r=0.0))
    if not LOW:
        for k in range(8):
            a = math.radians(k * 45 + 22.5)
            p.append(C("window_bolt", 0.014, 0.02, (0.24 * math.cos(a), -0.02, wz + 0.24 * math.sin(a)), (90, 0, 0), m="steel", n=6))
    # Hatch wheel and the locking bars it drives.
    hz = 1.06
    p.append(C("wheel_axle", 0.03, 0.12, (0, -0.05, hz), (90, 0, 0), m="steel", n=10))
    p.append(T("hatch_wheel", 0.22, 0.03, (0, -0.11, hz), rot=(90, 0, 0), m="yellow", n=32, sides=6))
    for angle in (0, 60, 120):
        a = math.radians(angle)
        p.append(rod("wheel_spoke", (-0.22 * math.cos(a), -0.11, hz - 0.22 * math.sin(a)), (0.22 * math.cos(a), -0.11, hz + 0.22 * math.sin(a)), 0.014, m="yellow", n=8))
    p.append(C("wheel_hub", 0.06, 0.05, (0, -0.12, hz), (90, 0, 0), m="dark", n=16, r=0.012))
    for x0, x1, z0, z1 in ((-0.5, -0.06, hz, hz), (0.06, 0.5, hz, hz), (0, 0, hz + 0.06, 1.38), (0, 0, 0.3, hz - 0.06)):
        if x0 == x1:
            p.append(B("lock_bar", (0.05, 0.02, z1 - z0), (0, -0.018, (z0 + z1) / 2), m="steel", r=0.0))
        else:
            p.append(B("lock_bar", (x1 - x0, 0.02, 0.05), ((x0 + x1) / 2, -0.018, z0), m="steel", r=0.0))
    for x, z in ((-0.5, hz), (0.5, hz)):
        p.append(B("lock_dog", (0.08, 0.05, 0.1), (x, -0.03, z), m="dark", r=0.012))
    for z in (0.55, 1.75):
        p.append(C("hinge", 0.05, 0.2, (-0.58, -0.04, z), m="steel", n=14, r=0.01))
    # Warning stripes, the green light over the door, panels on both sides.
    hazard(p, -0.56, 0.56, 0.02, 0.16, -0.2)
    for x0 in (-0.86, 0.6):
        hazard(p, x0, x0 + 0.26, 0.3, 0.42, -0.2)
    p.append(B("light_housing", (1.0, 0.04, 0.1), (0, -0.21, 2.25), m="dark", r=0.015))
    p.append(B("exit_light", (0.9, 0.03, 0.05), (0, -0.225, 2.25), m="glow_green", r=0.0))
    p.append(B("keypad", (0.16, 0.03, 0.26), (0.73, -0.215, 1.2), m="dark", r=0.015))
    for k in range(9 if not LOW else 3):
        p.append(B("key", (0.03, 0.01, 0.025), (0.69 + (k % 3) * 0.04, -0.233, 1.2 - (k // 3) * 0.04), m="white" if k != 4 else "orange", r=0.0))
    led(p, 0.73, -0.23, 1.29, m="glow_green", r=0.016)
    gauge(p, -0.73, -0.2, 1.3, r=0.065, angle=0)
    p.append(B("exit_sign", (0.2, 0.012, 0.1), (-0.73, -0.205, 1.62), m="green", r=0.0))
    p.append(slab("exit_arrow", [(-0.06, -0.015), (0.02, -0.015), (0.02, -0.035), (0.07, 0.0), (0.02, 0.035), (0.02, 0.015), (-0.06, 0.015)], 0.006, loc=(-0.73, -0.214, 1.62), m="white"))
    return p


def _ceiling_light():
    p = []
    p.append(C("canopy", 0.12, 0.03, (0, 0, -0.015), m="grey", n=20))
    p.append(L("housing", [(0.0, -0.13), (0.43, -0.13), (0.45, -0.115), (0.45, -0.085), (0.3, -0.065), (0.12, -0.045), (0.0, -0.045)], m="white", n=36))
    p.append(C("light", 0.4, 0.008, (0, 0, -0.136), m="glow_white", n=36))
    p.append(T("rim", 0.443, 0.012, (0, 0, -0.1), m="teal", n=36, sides=5))
    p.append(T("lip", 0.405, 0.008, (0, 0, -0.14), m="grey", n=36, sides=4))
    if not LOW:
        for k in range(4):
            a = math.radians(45 + k * 90)
            p.append(C("screw", 0.012, 0.006, (0.425 * math.cos(a), 0.425 * math.sin(a), -0.133), m="steel", n=6))
    return p


def _crate_small():
    p = []
    p.append(B("feet", (0.46, 0.4, 0.03), (0, 0, 0.015), m="dark", r=0.008))
    p.append(B("body", (0.5, 0.46, 0.36), (0, 0, 0.2), m="white", r=0.04))
    p.append(B("band", (0.51, 0.47, 0.06), (0, 0, 0.25), m="teal", r=0.015))
    p.append(B("lid", (0.54, 0.5, 0.06), (0, 0, 0.41), m="grey", r=0.025))
    for x in (-0.22, 0.22):
        for y in (-0.2, 0.2):
            p.append(B("lid_corner", (0.1, 0.1, 0.02), (x, y, 0.445), m="dark", r=0.008))
    for side in (-1, 1):
        p.append(H("handle", [(side * 0.25, -0.09, 0.32), (side * 0.285, -0.09, 0.32), (side * 0.285, 0.09, 0.32), (side * 0.25, 0.09, 0.32)], 0.013, m="dark", bend=0.025, steps=3))
    for x in (-0.18, 0.18):
        p.append(B("latch", (0.05, 0.025, 0.06), (x, -0.24, 0.37), m="steel", r=0.008))
    p.append(B("label", (0.24, 0.006, 0.1), (0, -0.233, 0.15), m="dark", r=0.0))
    p.append(B("label_stripe", (0.06, 0.008, 0.08), (-0.08, -0.236, 0.15), m="orange", r=0.0))
    p.append(B("label_text", (0.12, 0.006, 0.015), (0.04, -0.236, 0.17), m="white", r=0.0))
    p.append(B("label_text", (0.08, 0.006, 0.015), (0.02, -0.236, 0.135), m="white", r=0.0))
    return p


def _floor_hatch():
    p = []
    for y in (-0.55, 0.55):
        p.append(B("frame", (1.2, 0.1, 0.05), (0, y, 0.025), m="grey", r=0.01))
    for x in (-0.55, 0.55):
        p.append(B("frame", (0.1, 1.0, 0.05), (x, 0, 0.025), m="grey", r=0.01))
    p.append(B("pit", (1.0, 1.0, 0.01), (0, 0, 0.005), m="darker", r=0.0))
    p.append(rod("pipe", (-0.5, -0.15, 0.022), (0.5, -0.15, 0.022), 0.012, m="teal", n=8))
    p.append(rod("pipe", (-0.5, 0.2, 0.022), (0.5, 0.2, 0.022), 0.012, m="orange", n=8))
    for k in range(9):
        p.append(B("bar", (1.0, 0.014, 0.012), (0, -0.4 + k * 0.1, 0.04), m="dark", r=0.0))
        p.append(B("bar", (0.014, 1.0, 0.012), (-0.4 + k * 0.1, 0, 0.042), m="dark", r=0.0))
    # Yellow and dark stripes along the front edge, bolts in the corners, a lift ring.
    p.append(B("stripe_band", (1.0, 0.07, 0.004), (0, -0.55, 0.051), m="yellow", r=0.0))
    x = -0.57
    while x < 0.5:
        poly = _clip_x([(x, -0.585), (x + 0.05, -0.585), (x + 0.12, -0.515), (x + 0.07, -0.515)], -0.5, 0.5)
        if poly:
            p.append(prism("stripe", poly, 0.004, loc=(0, 0, 0.054), material="darker"))
        x += 0.12
    if not LOW:
        for sx in (-1, 1):
            for sy in (-1, 1):
                p.append(C("bolt", 0.014, 0.008, (sx * 0.55, sy * 0.55, 0.053), m="steel", n=6))
    p.append(T("lift_ring", 0.04, 0.008, (0.0, 0.55, 0.052), m="dark", n=12, sides=4))
    return p


# ===========================================================================
# Lander cabin
# ===========================================================================


def _pilot_seat():
    p = []
    p.append(B("floor_plate", (0.5, 0.6, 0.04), (0, 0.05, 0.02), m="dark", r=0.012))
    p.append(C("column", 0.07, 0.26, (0, 0.06, 0.17), m="steel", n=16))
    p.append(B("seat_frame", (0.5, 0.46, 0.05), (0, 0.0, 0.31), m="grey", r=0.015))
    p.append(B("seat", (0.56, 0.5, 0.11), (0, -0.02, 0.39), m="orange", r=0.045))
    for side in (-1, 1):
        p.append(B("bolster", (0.08, 0.48, 0.1), (side * 0.27, -0.02, 0.46), m="orange", r=0.035))
    tilt = -12.0
    t = math.radians(-tilt)

    def back(z):
        """The front face of the backrest at height z (it leans back)."""
        return 0.2 + (z - 0.78) * math.tan(t)

    p.append(B("back_shell", (0.62, 0.07, 0.74), (0, 0.33, 0.8), rot=(tilt, 0, 0), m="white", r=0.03))
    p.append(B("backrest", (0.54, 0.14, 0.62), (0, 0.27, 0.78), rot=(tilt, 0, 0), m="orange", r=0.05))
    for side in (-1, 1):
        p.append(B("back_wing", (0.05, 0.24, 0.62), (side * 0.3, 0.28, 0.8), rot=(tilt, 0, 0), m="white", r=0.02))
        p.append(rod("headrest_post", (side * 0.08, 0.35, 1.1), (side * 0.08, 0.38, 1.18), 0.012, m="steel", n=6))
    p.append(B("headrest", (0.34, 0.13, 0.2), (0, 0.37, 1.2), rot=(tilt, 0, 0), m="orange", r=0.05))
    p.append(B("headrest_band", (0.345, 0.135, 0.04), (0, 0.37, 1.2), rot=(tilt, 0, 0), m="white", r=0.012))
    # A five-point harness that meets at the round buckle.
    buckle = Vector((0, -0.14, 0.46))
    for side in (-1, 1):
        top = Vector((side * 0.12, back(1.04) - 0.01, 1.04))
        low = Vector((side * 0.1, back(0.52) - 0.02, 0.52))
        p.append(beam("shoulder_strap", top, low, 0.055, 0.012, m="teal", r=0.0))
        p.append(beam("shoulder_strap", low, buckle + Vector((side * 0.03, 0, 0.01)), 0.055, 0.012, m="teal", r=0.0))
        p.append(beam("lap_strap", Vector((side * 0.27, 0.12, 0.5)), buckle + Vector((side * 0.035, 0, 0)), 0.055, 0.012, m="teal", r=0.0))
        p.append(B("strap_buckle", (0.06, 0.02, 0.03), tuple(low + Vector((0, -0.01, 0.0))), m="steel", r=0.0))
    p.append(beam("crotch_strap", Vector((0, -0.26, 0.44)), buckle, 0.055, 0.012, m="teal", r=0.0))
    p.append(C("buckle", 0.045, 0.02, tuple(buckle + Vector((0, 0, 0.012))), m="steel", n=16, r=0.006))
    p.append(C("buckle_button", 0.02, 0.024, tuple(buckle + Vector((0, 0, 0.014))), m="orange", n=10))
    # Armrests, one with a button, and the foot rest.
    for side in (-1, 1):
        p.append(B("arm_post", (0.04, 0.06, 0.18), (side * 0.34, 0.08, 0.53), m="grey", r=0.01))
        p.append(B("armrest", (0.08, 0.4, 0.05), (side * 0.34, -0.02, 0.645), m="dark", r=0.02))
    p.append(C("arm_button", 0.016, 0.012, (0.34, -0.17, 0.675), m="green", n=10))
    for side in (-1, 1):
        p.append(beam("foot_strut", (side * 0.16, 0.0, 0.05), (side * 0.16, -0.36, 0.12), 0.04, 0.04, m="grey", r=0.01))
    p.append(B("foot_rest", (0.46, 0.14, 0.03), (0, -0.38, 0.13), rot=(20, 0, 0), m="dark", r=0.01))
    for k in range(3):
        p.append(B("foot_grip", (0.42, 0.015, 0.006), (0, -0.42 + k * 0.04, 0.13 + (k - 1) * 0.014 + 0.018), rot=(20, 0, 0), m="orange", r=0.0))
    return p


def _console_segment(colour, controls, side):
    """One part of the flight console, built facing -Y around the origin."""
    p = []
    w = 0.94
    p.append(B("kick", (w - 0.04, 0.36, 0.06), (0, 0.06, 0.03), m="dark", r=0.01))
    p.append(B("cabinet", (w, 0.42, 0.66), (0, 0.06, 0.39), m="white", r=0.03))
    p.append(B("cabinet_band", (w + 0.005, 0.425, 0.04), (0, 0.06, 0.6), m="teal", r=0.012))
    p.append(B("knee_panel", (w - 0.2, 0.01, 0.3), (0, -0.155, 0.3), m="cream", r=0.0))
    # The slanted desk with switches, buttons and lights.
    desk = [B("desk", (w, 0.34, 0.06), (0, 0, 0), m="grey", r=0.02)]
    desk.append(B("desk_inset", (w - 0.1, 0.26, 0.01), (0, 0.01, 0.033), m="dark", r=0.0))
    for row in range(2):
        for k in range(6 if not LOW else 3):
            x = -0.33 + k * (0.11 if not LOW else 0.22)
            if controls == "switches" and row == 0:
                desk.append(B("switch_base", (0.03, 0.03, 0.012), (x, -0.06, 0.042), m="steel", r=0.0))
                desk.append(beam("switch", (x, -0.06, 0.045), (x, -0.08, 0.09), 0.012, 0.012, m=("yellow", "white", "teal")[k % 3], r=0.0))
            else:
                desk.append(B("desk_button", (0.05, 0.035, 0.016), (x, -0.06 + row * 0.08, 0.044), m=("orange", "teal", "white", "green", "yellow", "white")[(k + row) % 6], r=0.0))
    for k in range(5):
        desk.append(C("desk_light", 0.012, 0.012, (-0.3 + k * 0.15, 0.11, 0.04), m="glow_green" if (k + side) % 2 else "glow_amber", n=8))
    p += move(desk, (0, -0.06, 0.76), (22, 0, 0))
    # The screen panel above the desk.
    p.append(B("screen_panel", (w, 0.08, 0.5), (0, 0.17, 1.1), rot=(-6, 0, 0), m="cream", r=0.025))
    p.append(B("screen_bezel", (0.72, 0.03, 0.4), (0, 0.12, 1.1), rot=(-6, 0, 0), m="dark", r=0.015))
    p.append(screen("console_screen", 0.66, 0.34, (0, 0.102, 1.1), rot=(-6, 0, 0), m=colour))
    p.append(B("top_cap", (w, 0.14, 0.04), (0, 0.18, 1.37), m="teal", r=0.012))
    for k in range(4):
        p.append(C("top_light", 0.014, 0.012, (-0.3 + k * 0.2, 0.105, 1.37), (90, 0, 0), m="glow_amber" if k % 2 else "glow_green", n=8))
    return p


def _cockpit_console():
    p = []
    angle = 24.0
    # Far enough out that the outer back corners stay 1.3 m from the middle.
    radius = (1.3 - 0.47 * math.cos(math.radians(angle)) - 0.27 * math.sin(math.radians(angle))) / math.sin(math.radians(angle))
    pivot = Vector((0, 0.2 - radius, 0))
    layout = ((-angle, "screen_cyan", "switches", 0), (0.0, "screen_amber", "buttons", 1), (angle, "screen_cyan", "switches", 2))
    for theta, colour, controls, index in layout:
        parts = _console_segment(colour, controls, index)
        a = math.radians(theta)
        where = pivot + Vector((radius * math.sin(a), radius * math.cos(a), 0))
        p += move(parts, tuple(where), (0, 0, -theta))
    # Two hand controllers on the inner ends of the side desks.
    for side in (-1, 1):
        a = math.radians(side * angle)
        base = pivot + Vector(((radius - 0.12) * math.sin(a), (radius - 0.12) * math.cos(a), 0.79)) + Vector((-side * 0.3 * math.cos(a), side * 0.3 * math.sin(a), 0))
        p.append(C("stick_base", 0.055, 0.04, tuple(base), m="dark", n=16, r=0.01))
        p.append(C("stick_boot", 0.04, 0.05, tuple(base + Vector((0, 0, 0.04))), m="rubber", n=12, r2=0.018))
        p.append(rod("stick", base + Vector((0, 0, 0.05)), base + Vector((0, -0.01, 0.13)), 0.012, m="steel", n=8))
        grip = C("stick_grip", 0.026, 0.11, m="darker", n=12, r=0.01)
        p.append(aim(grip, base + Vector((0, -0.01, 0.12)), base + Vector((0, -0.03, 0.23))))
        p.append(C("stick_button", 0.014, 0.02, tuple(base + Vector((0, -0.03, 0.235))), m="orange" if side < 0 else "red", n=10))
    return p


def _supply_rack():
    rng = random.Random(91)
    p = []
    for x in (-0.575, 0.575):
        for y in (-0.22, 0.22):
            p.append(B("post", (0.05, 0.05, 2.0), (x, y, 1.0), m="grey", r=0.012))
        p.append(rod("brace", (x, -0.2, 0.1), (x, 0.2, 0.9), 0.01, m="steel", n=6))
        p.append(rod("brace", (x, -0.2, 1.0), (x, 0.2, 1.8), 0.01, m="steel", n=6))
    levels = (0.05, 0.5, 0.95, 1.4)
    for z in levels + (1.95,):
        p.append(B("shelf", (1.2, 0.48, 0.03), (0, 0, z), m="white", r=0.01))
        p.append(B("shelf_lip", (1.2, 0.012, 0.04), (0, -0.24, z + 0.005), m="teal", r=0.0))
    colours = ("orange", "teal", "white")
    for level, z in enumerate(levels):
        x = -0.54
        k = 0
        while x < 0.5:
            width = rng.uniform(0.3, 0.38)
            if x + width > 0.56:
                width = 0.56 - x
                if width < 0.2:
                    break
            height = rng.uniform(0.28, 0.36)
            depth = rng.uniform(0.36, 0.42)
            colour = colours[(k + level) % 3]
            cx = x + width / 2
            p.append(B("bag", (width - 0.02, depth, height), (cx, 0.0, z + 0.015 + height / 2), m=colour, r=0.06))
            p.append(B("bag_strap", (width * 0.5, 0.012, 0.03), (cx, -depth / 2 - 0.004, z + height * 0.7), m="dark" if colour != "teal" else "white", r=0.0))
            p.append(B("bag_label", (0.08, 0.008, 0.06), (cx + width * 0.22, -depth / 2 - 0.002, z + height * 0.4), m="white" if colour != "white" else "teal", r=0.0))
            p.append(B("bag_zip", (width - 0.08, 0.008, 0.01), (cx, -depth / 2 + 0.01, z + height - 0.02), m="darker", r=0.0))
            x += width + 0.01
            k += 1
        # Straps across the front hold the bags in.
        if level < 3:
            for dz in (0.1, 0.24):
                p.append(B("strap", (1.14, 0.012, 0.035), (0, -0.235, z + dz), m="yellow", r=0.0))
                p.append(B("strap_buckle", (0.05, 0.02, 0.05), (0.3, -0.24, z + dz), m="steel", r=0.0))
        else:
            for k in range(4):
                p.append(B("net", (1.12, 0.008, 0.012), (0, -0.235, z + 0.06 + k * 0.09), m="dark", r=0.0))
            for k in range(7):
                p.append(B("net", (0.012, 0.008, 0.33), (-0.48 + k * 0.16, -0.237, z + 0.2), m="dark", r=0.0))
    label(p, -0.45, -0.25, 1.98, 0.16, 0.035, m="orange")
    return p


def _hatch_ladder():
    p = []
    # Round floor hatch with its green light ring.
    p.append(C("floor_ring", 0.45, 0.04, (0, 0, 0.02), m="dark", n=40, r=0.01))
    p.append(C("floor_lid", 0.37, 0.045, (0, 0, 0.0225), m="grey", n=36, r=0.008))
    p.append(T("light_ring", 0.41, 0.014, (0, 0, 0.04), m="glow_green", n=40, sides=5))
    p.append(H("lid_handle", [(-0.1, -0.15, 0.045), (-0.1, -0.15, 0.08), (0.1, -0.15, 0.08), (0.1, -0.15, 0.045)], 0.012, m="yellow", bend=0.02, steps=3))
    for k in range(6 if not LOW else 0):
        a = math.radians(k * 60 + 30)
        p.append(C("lid_bolt", 0.014, 0.01, (0.32 * math.cos(a), 0.32 * math.sin(a), 0.048), m="steel", n=6))
    # Ceiling hatch (its ring touches the ceiling at 2.4 m) with a wheel underneath.
    p.append(C("ceiling_ring", 0.44, 0.06, (0, 0, 2.37), m="white", n=40, r=0.015))
    p.append(C("ceiling_lid", 0.34, 0.03, (0, 0, 2.33), m="dark", n=32, r=0.008))
    p.append(T("ceiling_light", 0.39, 0.01, (0, 0, 2.335), m="glow_green", n=40, sides=4))
    p.append(T("ceiling_wheel", 0.14, 0.018, (0, 0, 2.27), m="orange", n=24, sides=5))
    for angle in (0, 90):
        a = math.radians(angle)
        p.append(rod("wheel_spoke", (-0.14 * math.cos(a), -0.14 * math.sin(a), 2.27), (0.14 * math.cos(a), 0.14 * math.sin(a), 2.27), 0.01, m="orange", n=6))
    p.append(C("wheel_hub", 0.035, 0.06, (0, 0, 2.29), m="dark", n=12))
    # The ladder at the back of the hatch, from the floor ring up to the ceiling ring.
    ly = 0.33
    for x in (-0.2, 0.2):
        p.append(B("rail", (0.05, 0.05, 2.3), (x, ly, 1.19), m="teal", r=0.015))
        p.append(B("rail_foot", (0.08, 0.1, 0.03), (x, ly, 0.055), m="dark", r=0.008))
        p.append(B("rail_bracket", (0.08, 0.1, 0.05), (x, ly, 2.32), m="dark", r=0.01))
    for k in range(7):
        z = 0.32 + k * 0.3
        p.append(rod("rung", (-0.2, ly, z), (0.2, ly, z), 0.02, m="grey", n=8))
        p.append(rod("rung_grip", (-0.08, ly, z), (0.08, ly, z), 0.024, m="darker", n=8))
    p.append(B("up_sign", (0.1, 0.012, 0.14), (0.27, ly - 0.02, 1.5), m="green", r=0.0))
    p.append(slab("up_arrow", [(-0.015, -0.05), (0.015, -0.05), (0.015, 0.0), (0.035, 0.0), (0.0, 0.05), (-0.035, 0.0), (-0.015, 0.0)], 0.006, loc=(0.27, ly - 0.03, 1.5), m="white"))
    return p


# === END ===
