"""
Six more outpost buildings, each its own node in annex.glb:

  workshop       fabrication workshop: a rounded hangar with a roll-up door, a rooftop
                 crane, a workbench and tool racks by the door (amber)
  oxygen         oxygen plant: a processing unit with an intake fan, two tall gas tanks,
                 pipes and valves (cyan)
  observatory    a drum with a turning dome and a telescope (violet). The dome is the
                 child node "observatory_dome", its pivot on the drum's axis, so it can turn.
  garden         a small greenhouse dome with plant racks and a little tree inside (green)
  bunker         a storm shelter half buried under heaped regolith (orange)
  solar_array    six tilted solar panels on one frame, a junction box and a cable conduit

Every building faces -Y (its door too), stands on Z = 0 and fits inside 9 x 9 m
(X and Y within -4.3..4.3), at most 7 m tall. Lamps, glass, windows, solar cells and
plants keep their own material names so the game can swap them.
"""
import math
import random

import bmesh
import bpy
from mathutils import Vector, noise
from mathutils.bvhtree import BVHTree

from lib import (
    bake_shadows,
    boolean,
    box,
    capsule,
    cylinder,
    decimate,
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
    set_pivot,
    shade,
    solidify,
    sphere,
    torus,
    triangles,
    tube,
)

PALETTE = {
    "hull": "#f4f0e8",
    "grey": "#aeb6c6",
    "dark": "#3a4260",
    "darker": "#262b40",
    "amber": "#ffb347",
    "cyan": "#5fd0ff",
    "violet": "#b79cff",
    "green": "#5fe39a",
    "orange": "#ff9860",
    "power": "#ffc94d",
    "regolith": "#b88a6a",
    "rubble": "#94705a",
    "sandbag": "#d8bb92",
    "soil": "#5b3a2a",
    "bark": "#8a5a3c",
    "fruit": "#ff6b5e",
    "solar_line": "#9fc0ff",
}

# Materials the game swaps by name. The colours only show in Blender previews.
SPECIAL = {
    "glass": (0.62, 0.85, 1.0),
    "window": (0.06, 0.1, 0.3),
    "solar": (0.04, 0.07, 0.28),
    "lamp_window": (1.0, 0.8, 0.5),
    "lamp_cyan": (0.2, 0.85, 1.0),
    "lamp_violet": (0.6, 0.45, 1.0),
    "lamp_grow": (1.0, 0.25, 0.8),
    "lamp_door": (0.45, 1.0, 0.65),
    "glow_green": (0.35, 1.0, 0.55),
    "glow_red": (1.0, 0.25, 0.25),
    "glow_cyan": (0.25, 0.95, 1.0),
    "plant": (0.2, 0.62, 0.25),
}

PLOT = 4.3  # every building stays within -PLOT..PLOT in X and Y
TALLEST = 7.0
TRIANGLE_BUDGET = 25000


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _finish(parts, name, reach=1.2, extra=()):
    """Soft shadows, flat colours, one object. `extra` parts (glass) are joined unbaked."""
    bake_shadows(parts, reach=reach, strength=0.9, floor=0.5, ground=0.0)
    paint(parts, PALETTE)
    return join(list(parts) + list(extra), name)


def _rrect(width, depth, radius, steps=6):
    """A rounded rectangle [(x, y), ...], counter-clockwise, centred on the origin."""
    half_w = width / 2 - radius
    half_d = depth / 2 - radius
    points = []
    for x, y, start in ((half_w, -half_d, -90), (half_w, half_d, 0), (-half_w, half_d, 90), (-half_w, -half_d, 180)):
        for index in range(steps + 1):
            a = math.radians(start + 90 * index / steps)
            points.append((x + radius * math.cos(a), y + radius * math.sin(a)))
    return points


def _band(name, width, depth, radius, height, z, material, cx=0.0, cy=0.0):
    """A stripe hugging a rounded box: a rounded slab a little bigger than the box in plan."""
    return prism(name, _rrect(width, depth, radius), height, loc=(cx, cy, z), material=material, round=0.03)


def _arch_line(width, height, radius, steps=8):
    """A hangar end (x, z): up the right wall, over the rounded roof, down the left wall."""
    half = width / 2
    points = [(half, 0.0)]
    for index in range(steps + 1):
        a = math.radians(90 * index / steps)
        points.append((half - radius + radius * math.cos(a), height - radius + radius * math.sin(a)))
    for index in range(steps + 1):
        a = math.radians(90 + 90 * index / steps)
        points.append((-half + radius + radius * math.cos(a), height - radius + radius * math.sin(a)))
    points.append((-half, 0.0))
    return points


def _rib_line(width, height, radius, out, inset, steps=8):
    """A U-shaped band around a hangar end: `out` beyond the skin, `inset` inside it."""
    outer = _arch_line(width + 2 * out, height + out, radius + out, steps)
    inner = _arch_line(width - 2 * inset, height - inset, radius - inset, steps)
    return outer + inner[::-1]


def _aim(obj, start, end):
    """Turn a part built along +Z (centred) so it runs from `start` to `end`, its +Y kept as upright as it can be."""
    start, end = Vector(start), Vector(end)
    direction = (end - start).normalized()
    if abs(direction.z) > 0.999:
        euler = Vector((0.0, 0.0, 1.0)).rotation_difference(direction).to_euler("XYZ")
    else:
        euler = direction.to_track_quat("Z", "Y").to_euler("XYZ")
    return place(obj, (start + end) / 2, rot=tuple(math.degrees(angle) for angle in euler))


def _rod(name, start, end, radius, material="grey", segments=10):
    length = (Vector(end) - Vector(start)).length
    return _aim(cylinder(name, radius, length, material=material, segments=segments), start, end)


def _beam(name, start, end, width, height, material="dark", round=0.02):
    length = (Vector(end) - Vector(start)).length
    return _aim(box(name, (width, height, length), material=material, round=round), start, end)


def _star(radius, inner=0.45, points=5):
    outline = []
    for index in range(points * 2):
        a = math.radians(90 + 180 * index / points)
        r = radius if index % 2 == 0 else radius * inner
        outline.append((r * math.cos(a), r * math.sin(a)))
    return outline


def _colours(obj):
    attribute = obj.data.color_attributes.get("Col")
    return [tuple(item.color) for item in attribute.data]


def _set_colours(obj, values):
    attribute = obj.data.color_attributes.get("Col")
    for item, value in zip(attribute.data, values):
        item.color = value


def _leaves(rng, radius, loc, squash=0.82, detail=1):
    """A leafy clump: a lumpy ball of material 'plant'."""
    blob = ico("leaves", radius, detail=detail, material="plant")
    offset = Vector((rng.uniform(0, 40), rng.uniform(0, 40), rng.uniform(0, 40)))
    for vertex in blob.data.vertices:
        direction = vertex.co.normalized()
        vertex.co = direction * radius * (1.0 + 0.24 * noise.noise(direction * 2.3 + offset))
    blob.data.update()
    place(blob, loc, rot=(rng.uniform(-12, 12), rng.uniform(-12, 12), rng.uniform(0, 360)), scale=(1.0, 1.0, squash))
    shade(blob, True, None)
    return blob


def _report(name, objects, door):
    """Print the building's size and check it against its plot and triangle budget."""
    bpy.context.view_layer.update()
    low = [1e9, 1e9, 1e9]
    high = [-1e9, -1e9, -1e9]
    for obj in objects:
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            for axis in range(3):
                low[axis] = min(low[axis], point[axis])
                high[axis] = max(high[axis], point[axis])
    count = triangles(objects)
    where = "front door %.2f m in front of the centre" % door if door is not None else "no door"
    print(
        "[annex] %s: %.2f x %.2f m (X %.2f..%.2f, Y %.2f..%.2f), Z %.2f..%.2f m, %d triangles, %s"
        % (name, high[0] - low[0], high[1] - low[1], low[0], high[0], low[1], high[1], low[2], high[2], count, where)
    )
    if max(-low[0], high[0], -low[1], high[1]) > PLOT or high[2] > TALLEST or low[2] < -0.001 or count > TRIANGLE_BUDGET:
        raise ValueError("%s does not fit its 9 x 9 x 7 m plot or its triangle budget" % name)


# ---------------------------------------------------------------------------
# Workshop (amber)
# ---------------------------------------------------------------------------


def _workshop():
    parts = []
    width, depth, top, corner = 7.0, 6.0, 4.5, 1.5
    front = -depth / 2
    parts.append(box("slab", (7.9, 7.5, 0.3), (0, -0.25, 0.15), material="grey", round=0.1, segments=3))

    # The hangar: a long rounded shell with grey frames at both ends and one in the middle.
    parts.append(prism("hull", _arch_line(width, top - 0.05, corner), depth, loc=(0, 0, 0.05), rot=(90, 0, 0), material="hull", round=0.2, segments=3))
    for y in (front + 0.14, -front - 0.14):
        parts.append(prism("end_frame", _rib_line(width, top - 0.05, corner, 0.09, 0.16), 0.34, loc=(0, y, 0.05), rot=(90, 0, 0), material="grey", round=0.04))
    parts.append(prism("mid_frame", _rib_line(width, top - 0.05, corner, 0.06, 0.1), 0.3, loc=(0, 0, 0.05), rot=(90, 0, 0), material="grey", round=0.04))
    parts.append(_band("stripe", width + 0.06, depth + 0.06, 0.23, 0.32, 1.5, "amber"))
    parts.append(_band("skirt", width + 0.06, depth + 0.06, 0.23, 0.22, 0.4, "dark"))

    # Side window strips.
    for side in (-1, 1):
        for y in (-1.45, 1.45):
            parts.append(box("window_frame", (0.16, 2.3, 0.95), (side * 3.52, y, 2.45), material="dark", round=0.1, segments=3))
            parts.append(box("window", (0.18, 2.1, 0.7), (side * 3.53, y, 2.45), material="lamp_window", round=0.08))
            for dy in (-0.35, 0.35):
                parts.append(box("mullion", (0.21, 0.06, 0.72), (side * 3.53, y + dy, 2.45), material="dark", round=0.0))
            parts.append(box("window_hood", (0.3, 2.4, 0.08), (side * 3.58, y, 2.96), material="grey", round=0.03))

    # The roll-up door: dark posts and header, a lit frame, and slats.
    opening, tall = 3.3, 2.9
    for side in (-1, 1):
        parts.append(box("door_post", (0.44, 0.4, tall + 0.5), (side * (opening / 2 + 0.22), front - 0.1, 0.3 + (tall + 0.5) / 2), material="dark", round=0.08))
        parts.append(box("door_light", (0.07, 0.04, tall - 0.1), (side * (opening / 2 + 0.06), front - 0.31, 0.3 + tall / 2), material="lamp_door", round=0.0))
        for z in (0.7, 1.9, 3.0):
            parts.append(cylinder("post_bolt", 0.035, 0.04, (side * (opening / 2 + 0.3), front - 0.31, z), rot=(90, 0, 0), material="grey", segments=8))
    parts.append(box("door_header", (opening + 0.98, 0.44, 0.6), (0, front - 0.11, 0.3 + tall + 0.3), material="dark", round=0.08))
    parts.append(box("header_stripe", (opening + 0.6, 0.04, 0.12), (0, front - 0.34, 0.3 + tall + 0.38), material="amber", round=0.0))
    parts.append(box("door_light", (opening + 0.19, 0.04, 0.07), (0, front - 0.34, 0.3 + tall + 0.06), material="lamp_door", round=0.0))
    parts.append(box("door_back", (opening, 0.05, tall), (0, front - 0.03, 0.3 + tall / 2), material="darker", round=0.0))
    slats = 7
    pitch = tall / slats
    for index in range(slats):
        z = 0.3 + pitch * (index + 0.5)
        material = "amber" if index == 0 else "grey"
        parts.append(box("slat", (opening - 0.04, 0.1, pitch - 0.02), (0, front - 0.09, z), material=material, round=0.06))
        if index == 0:
            for stripe in range(7):
                parts.append(box("hazard", (0.12, 0.02, 0.3), (-1.35 + stripe * 0.45, front - 0.145, z), rot=(0, 40, 0), material="darker", round=0.0))
        if index == 4:
            for pane in range(5):
                parts.append(box("slat_window", (0.4, 0.04, 0.2), (-1.24 + pane * 0.62, front - 0.145, z), material="lamp_window", round=0.04))
    parts.append(box("door_handle", (0.5, 0.06, 0.07), (0, front - 0.16, 0.3 + pitch * 1.5 - 0.1), material="dark", round=0.02))
    # An amber sign with a gear over the door.
    sign_z = 4.07
    parts.append(box("sign", (1.7, 0.08, 0.48), (0, front - 0.04, sign_z), material="amber", round=0.06, segments=3))
    parts.append(torus("sign_gear", 0.11, 0.045, (0, front - 0.09, sign_z), rot=(90, 0, 0), material="darker", segments=20, sides=6))
    for index in range(8):
        a = math.radians(index * 45)
        parts.append(box("sign_tooth", (0.07, 0.04, 0.08), (0.175 * math.cos(a), front - 0.09, sign_z + 0.175 * math.sin(a)), rot=(0, -index * 45, 0), material="darker", round=0.01))
    for side in (-1, 1):
        parts.append(cylinder("sign_bolt", 0.04, 0.03, (side * 0.7, front - 0.09, sign_z), rot=(90, 0, 0), material="darker", segments=8))
    # Work lights over the bench and the rack.
    for side in (-1, 1):
        parts.append(box("lamp_arm", (0.06, 0.24, 0.06), (side * 2.75, front - 0.12, 3.12), material="dark", round=0.01))
        parts.append(box("work_lamp", (0.5, 0.2, 0.16), (side * 2.75, front - 0.26, 3.05), rot=(-25, 0, 0), material="dark", round=0.05))
        parts.append(box("work_lamp_glow", (0.4, 0.12, 0.04), (side * 2.75, front - 0.29, 2.97), rot=(-25, 0, 0), material="lamp_window", round=0.015))
    # Floor markings on the apron.
    for side in (-1, 1):
        parts.append(box("marking", (0.1, 0.62, 0.012), (side * 1.75, -3.62, 0.306), material="amber", round=0.0))
    for index in range(6):
        parts.append(box("marking_dash", (0.36, 0.08, 0.012), (-1.25 + index * 0.5, -3.9, 0.306), material="amber", round=0.0))
    # Door controls with the green light.
    parts.append(box("door_panel", (0.26, 0.06, 0.42), (1.93, front - 0.33, 1.55), material="dark", round=0.03))
    parts.append(sphere("door_ok", 0.055, (1.93, front - 0.36, 1.68), material="glow_green", segments=10, rings=6))
    for row in range(2):
        for col in range(2):
            parts.append(box("key", (0.06, 0.03, 0.05), (1.89 + col * 0.08, front - 0.365, 1.5 - row * 0.08), material="grey", round=0.01))

    # Workbench left of the door, tools on a pegboard above it.
    bx, by, bz = -2.75, -3.5, 1.2
    parts.append(box("bench_top", (1.3, 0.62, 0.08), (bx, by, bz), material="grey", round=0.025))
    parts.append(box("bench_edge", (1.32, 0.05, 0.1), (bx, by - 0.31, bz - 0.01), material="amber", round=0.015))
    for dx in (-0.58, 0.58):
        for dy in (-0.25, 0.25):
            parts.append(box("bench_leg", (0.07, 0.07, bz - 0.34), (bx + dx, by + dy, 0.3 + (bz - 0.34) / 2), material="dark", round=0.015))
    parts.append(box("bench_shelf", (1.2, 0.55, 0.04), (bx, by, 0.55), material="dark", round=0.01))
    parts.append(box("crate", (0.52, 0.42, 0.3), (bx - 0.25, by, 0.72), material="hull", round=0.05))
    parts.append(box("crate_band", (0.54, 0.44, 0.08), (bx - 0.25, by, 0.74), material="amber", round=0.02))
    parts.append(box("toolbox", (0.44, 0.22, 0.2), (bx + 0.3, by + 0.08, bz + 0.14), material="amber", round=0.04))
    parts.append(box("toolbox_lid", (0.45, 0.23, 0.02), (bx + 0.3, by + 0.08, bz + 0.19), material="darker", round=0.0))
    parts.append(tube("toolbox_handle", [(bx + 0.18, by + 0.08, bz + 0.24), (bx + 0.18, by + 0.08, bz + 0.31), (bx + 0.42, by + 0.08, bz + 0.31), (bx + 0.42, by + 0.08, bz + 0.24)], 0.015, material="darker", smooth_path=False, sides=6))
    parts.append(box("vice", (0.18, 0.2, 0.14), (bx - 0.5, by - 0.18, bz + 0.11), material="dark", round=0.02))
    parts.append(box("vice_jaw", (0.2, 0.06, 0.1), (bx - 0.5, by - 0.3, bz + 0.13), material="grey", round=0.01))
    parts.append(_rod("vice_bar", (bx - 0.62, by - 0.36, bz + 0.1), (bx - 0.38, by - 0.36, bz + 0.1), 0.012, material="grey", segments=6))
    parts.append(box("hammer_handle", (0.3, 0.035, 0.03), (bx - 0.12, by - 0.12, bz + 0.055), rot=(0, 0, 20), material="amber", round=0.008))
    parts.append(box("hammer_head", (0.06, 0.13, 0.05), (bx + 0.02, by - 0.07, bz + 0.065), rot=(0, 0, 20), material="dark", round=0.01))
    # An angle lamp on the bench.
    parts.append(cylinder("lamp_foot", 0.07, 0.03, (bx + 0.55, by + 0.2, bz + 0.055), material="dark", segments=10))
    parts.append(tube("lamp_arm", [(bx + 0.55, by + 0.2, bz + 0.06), (bx + 0.5, by + 0.14, bz + 0.45), (bx + 0.36, by - 0.02, bz + 0.52)], 0.015, material="dark", smooth_path=False, sides=6))
    lamp_head = cylinder("lamp_head", 0.04, 0.12, material="amber", segments=10, radius2=0.08)
    parts.append(_aim(lamp_head, (bx + 0.34, by - 0.03, bz + 0.56), (bx + 0.3, by - 0.08, bz + 0.44)))
    parts.append(sphere("lamp_bulb", 0.05, (bx + 0.3, by - 0.08, bz + 0.44), material="lamp_window", segments=8, rings=6))
    # Pegboard and tools.
    pz = 1.95
    parts.append(box("pegboard", (1.1, 0.05, 0.9), (bx, front - 0.035, pz), material="dark", round=0.02))
    parts.append(box("wrench", (0.05, 0.02, 0.46), (bx - 0.38, front - 0.07, pz + 0.02), material="grey", round=0.008))
    parts.append(torus("wrench_end", 0.05, 0.018, (bx - 0.38, front - 0.07, pz + 0.27), rot=(90, 0, 0), material="grey", segments=12, sides=5))
    parts.append(box("wrench_small", (0.04, 0.02, 0.34), (bx - 0.24, front - 0.07, pz - 0.03), material="grey", round=0.008))
    parts.append(torus("wrench_small_end", 0.04, 0.015, (bx - 0.24, front - 0.07, pz + 0.16), rot=(90, 0, 0), material="grey", segments=12, sides=5))
    parts.append(box("saw_blade", (0.36, 0.015, 0.14), (bx + 0.05, front - 0.07, pz + 0.18), material="grey", round=0.005))
    parts.append(box("saw_grip", (0.12, 0.04, 0.16), (bx + 0.27, front - 0.075, pz + 0.18), material="amber", round=0.02))
    for index in range(3):
        sx = bx + 0.0 + index * 0.1
        parts.append(box("driver_grip", (0.045, 0.045, 0.12), (sx, front - 0.08, pz - 0.12), material="amber", round=0.012))
        parts.append(box("driver_shaft", (0.012, 0.012, 0.18), (sx, front - 0.08, pz - 0.27), material="grey", round=0.0))
    parts.append(box("hammer2_handle", (0.035, 0.03, 0.34), (bx + 0.4, front - 0.075, pz - 0.12), material="amber", round=0.008))
    parts.append(box("hammer2_head", (0.16, 0.05, 0.06), (bx + 0.4, front - 0.08, pz + 0.07), material="darker", round=0.01))

    # Tool rack right of the door.
    rx, ry = 2.8, -3.42
    for dx in (-0.55, 0.55):
        for dy in (-0.21, 0.21):
            parts.append(box("rack_post", (0.06, 0.06, 2.0), (rx + dx, ry + dy, 1.3), material="dark", round=0.012))
    for z in (0.62, 1.3, 1.98):
        parts.append(box("rack_shelf", (1.18, 0.5, 0.04), (rx, ry, z), material="grey", round=0.01))
    for index, colour in enumerate(("amber", "hull", "amber")):
        parts.append(box("bin", (0.32, 0.4, 0.22), (rx - 0.36 + index * 0.36, ry, 0.75), material=colour, round=0.035))
        parts.append(box("bin_label", (0.14, 0.01, 0.06), (rx - 0.36 + index * 0.36, ry - 0.205, 0.78), material="dark", round=0.0))
    parts.append(torus("cable_coil", 0.16, 0.05, (rx - 0.28, ry, 1.37), material="amber", segments=18, sides=6))
    parts.append(box("case", (0.48, 0.34, 0.22), (rx + 0.24, ry, 1.43), material="dark", round=0.04))
    parts.append(box("case_latch", (0.08, 0.02, 0.05), (rx + 0.24, ry - 0.175, 1.45), material="amber", round=0.0))
    for index in range(3):
        parts.append(cylinder("can", 0.08, 0.2, (rx - 0.36 + index * 0.18, ry + 0.05, 2.1), material="hull" if index != 1 else "amber", segments=12, round=0.015))
    # A shovel leaning on the rack.
    parts.append(_rod("shovel_shaft", (rx + 0.68, ry - 0.3, 0.42), (rx + 0.66, ry + 0.02, 1.85), 0.022, material="amber", segments=6))
    parts.append(_beam("shovel_blade", (rx + 0.68, ry - 0.33, 0.33), (rx + 0.69, ry - 0.36, 0.62), 0.22, 0.03, material="grey", round=0.01))

    # Rooftop crane, its boom over the front right corner.
    cx, cy = 1.4, -0.9
    parts.append(cylinder("crane_turret", 0.45, 0.3, (cx, cy, top + 0.12), material="dark", segments=20, round=0.04))
    parts.append(torus("crane_ring", 0.46, 0.04, (cx, cy, top + 0.24), material="amber", segments=24, sides=6))
    parts.append(cylinder("crane_mast", 0.14, 1.45, (cx, cy, top + 0.27 + 0.725), material="amber", segments=14))
    head = Vector((cx, cy, top + 1.77))
    parts.append(box("crane_head", (0.44, 0.44, 0.34), tuple(head), material="amber", round=0.08))
    reach = Vector((0.42, -0.9, 0.16)).normalized()
    tip = head + reach * 2.55
    parts.append(_beam("crane_boom", head + reach * 0.15, tip, 0.17, 0.2, material="amber", round=0.04))
    parts.append(_rod("crane_tie", head + Vector((0, 0, 0.42)), tip + Vector((0, 0, 0.06)), 0.018, material="dark", segments=6))
    parts.append(cylinder("crane_peak", 0.04, 0.3, tuple(head + Vector((0, 0, 0.3))), material="dark", segments=8))
    back = head - Vector((reach.x, reach.y, 0)).normalized() * 0.75
    parts.append(_beam("crane_jib", head, back, 0.14, 0.16, material="amber", round=0.03))
    parts.append(box("crane_weight", (0.4, 0.4, 0.36), tuple(back + Vector((0, 0, -0.08))), rot=(0, 0, math.degrees(math.atan2(reach.y, reach.x))), material="dark", round=0.05))
    parts.append(sphere("crane_light", 0.06, tuple(tip + Vector((0, 0, 0.14))), material="glow_red", segments=10, rings=6))
    hook_top = tip - Vector((0, 0, 0.1))
    parts.append(cylinder("crane_cable", 0.014, 0.85, tuple(hook_top - Vector((0, 0, 0.425))), material="darker", segments=6))
    block = hook_top - Vector((0, 0, 0.95))
    parts.append(box("hook_block", (0.14, 0.2, 0.22), tuple(block), material="grey", round=0.04))
    parts.append(torus("hook", 0.08, 0.025, tuple(block - Vector((0, 0, 0.2))), rot=(90, 0, 0), material="darker", segments=14, sides=6))

    # Roof: a skylight and a vent.
    parts.append(box("skylight_frame", (1.1, 0.9, 0.16), (-1.3, -1.2, top + 0.05), material="grey", round=0.05))
    parts.append(box("skylight", (0.92, 0.72, 0.06), (-1.3, -1.2, top + 0.12), material="lamp_window", round=0.03))
    parts.append(box("vent", (0.9, 0.7, 0.34), (-1.3, 1.1, top + 0.12), material="grey", round=0.08))
    for index in range(4):
        parts.append(box("vent_slat", (0.7, 0.07, 0.04), (-1.3, 0.86 + index * 0.16, top + 0.3), material="darker", round=0.0))

    # Gas bottles on the east side, a fan box at the back.
    for index, y in enumerate((1.0, 1.45)):
        parts.append(capsule("bottle", 0.17, 0.9, (3.76, y, 0.3 + 0.17 + 0.45), material="amber" if index == 0 else "grey", segments=14, rings=8))
        parts.append(cylinder("bottle_valve", 0.05, 0.12, (3.76, y, 0.3 + 0.9 + 0.36 + 0.06), material="dark", segments=8))
    parts.append(tube("bottle_strap", [(3.56, 0.76, 1.25), (3.96, 0.76, 1.25), (3.96, 1.69, 1.25), (3.56, 1.69, 1.25)], 0.02, material="dark", smooth_path=False, sides=6))
    parts.append(box("fan_box", (1.5, 0.5, 1.1), (1.7, 3.2, 0.3 + 0.55), material="grey", round=0.12))
    parts.append(cylinder("fan_ring", 0.4, 0.1, (1.7, 3.46, 0.85), rot=(90, 0, 0), material="dark", segments=20, round=0.02))
    for angle in (0, 60, 120):
        parts.append(box("fan_blade", (0.7, 0.03, 0.08), (1.7, 3.52, 0.85), rot=(0, angle, 0), material="hull", round=0.0))
    parts.append(tube("fan_duct", [(1.7, 3.1, 1.4), (1.7, 3.1, 1.75), (1.7, 3.02, 1.9)], 0.12, material="dark"))
    # Stock for making things: bars and pipes on a wall rack, sheets leaning on the wall.
    back = -front + 0.06
    for x in (-3.0, -1.9, -0.8):
        parts.append(box("stock_upright", (0.08, 0.06, 0.8), (x, back + 0.02, 2.3), material="dark", round=0.01))
        for z in (2.0, 2.52):
            parts.append(box("stock_arm", (0.08, 0.46, 0.06), (x, back + 0.23, z), material="dark", round=0.01))
    for z, dy, radius, material in ((2.09, 0.16, 0.05, "grey"), (2.08, 0.32, 0.04, "amber"), (2.61, 0.12, 0.06, "hull"), (2.59, 0.27, 0.04, "grey"), (2.59, 0.38, 0.035, "amber")):
        parts.append(cylinder("stock", radius, 2.9, (-1.9, back + dy, z), rot=(0, 90, 0), material=material, segments=10))
    for x, width, tall, dy, tilt, material in ((-2.8, 1.0, 1.3, 0.12, 9, "grey"), (-2.45, 0.7, 1.0, 0.2, 8, "amber")):
        parts.append(box("sheet", (width, 0.04, tall), (x, back + dy, 0.3 + tall / 2 * math.cos(math.radians(tilt))), rot=(tilt, 0, 0), material=material, round=0.015))

    workshop = _finish(parts, "workshop", reach=1.3)
    return [workshop], -(front - 0.15)


# ---------------------------------------------------------------------------
# Oxygen plant (cyan)
# ---------------------------------------------------------------------------


def _valve(parts, centre, axis="x"):
    """A valve body on a pipe with a hand wheel on top."""
    x, y, z = centre
    rot = (0, 90, 0) if axis == "x" else (90, 0, 0)
    parts.append(cylinder("valve_body", 0.15, 0.32, centre, rot=rot, material="grey", segments=14, round=0.03))
    parts.append(cylinder("valve_stem", 0.035, 0.32, (x, y, z + 0.2), material="dark", segments=8))
    parts.append(torus("valve_wheel", 0.17, 0.03, (x, y, z + 0.36), material="cyan", segments=18, sides=6))
    for angle in (0, 60, 120):
        a = math.radians(angle)
        parts.append(_rod("valve_spoke", (x - 0.17 * math.cos(a), y - 0.17 * math.sin(a), z + 0.36), (x + 0.17 * math.cos(a), y + 0.17 * math.sin(a), z + 0.36), 0.016, material="cyan", segments=6))


def _oxygen():
    parts = []
    parts.append(box("slab", (7.8, 7.0, 0.3), (0, 0, 0.15), material="grey", round=0.12, segments=3))

    # The processing unit: makes oxygen out of the ground.
    ux, uy, width, depth, top = -1.3, 0.35, 4.6, 4.2, 3.4
    front = uy - depth / 2
    parts.append(box("unit", (width, depth, top - 0.2), (ux, uy, 0.2 + (top - 0.2) / 2), material="hull", round=0.38, segments=4))
    parts.append(_band("skirt", width + 0.06, depth + 0.06, 0.41, 0.32, 0.46, "dark", ux, uy))
    parts.append(_band("stripe", width + 0.06, depth + 0.06, 0.41, 0.28, 1.12, "cyan", ux, uy))

    # Service door.
    dx = -2.75
    parts.append(box("door_frame", (1.3, 0.14, 2.32), (dx, front - 0.04, 0.3 + 1.16), material="grey", round=0.08))
    parts.append(box("door", (1.02, 0.12, 2.12), (dx, front - 0.09, 0.3 + 1.06), material="darker", round=0.07))
    parts.append(box("door_window", (0.5, 0.06, 0.42), (dx, front - 0.155, 1.95), material="lamp_window", round=0.06))
    parts.append(box("door_handle", (0.07, 0.08, 0.36), (dx + 0.36, front - 0.17, 1.25), material="cyan", round=0.03))
    parts.append(box("door_lamp", (0.7, 0.1, 0.12), (dx, front - 0.08, 2.75), material="lamp_door", round=0.04))

    # The big intake fan with its grille.
    fx, fz = -0.2, 1.72
    parts.append(cylinder("fan_back", 0.93, 0.1, (fx, front - 0.03, fz), rot=(90, 0, 0), material="darker", segments=36))
    parts.append(torus("fan_lip", 0.98, 0.1, (fx, front - 0.08, fz), rot=(90, 0, 0), material="grey", segments=40, sides=10))
    for index in range(7):
        blade = box("fan_blade", (0.2, 0.03, 0.62), material="dark", round=0.02)
        place(blade, rot=(0, 0, 28))
        place(blade, (fx + 0.5 * math.sin(math.radians(index * 360 / 7)), front - 0.1, fz + 0.5 * math.cos(math.radians(index * 360 / 7))), rot=(0, index * 360 / 7, 0))
        parts.append(blade)
    parts.append(cylinder("fan_hub", 0.2, 0.16, (fx, front - 0.14, fz), rot=(90, 0, 0), material="cyan", segments=18, round=0.04))
    for radius in (0.42, 0.72):
        parts.append(torus("grille", radius, 0.022, (fx, front - 0.2, fz), rot=(90, 0, 0), material="grey", segments=32, sides=5))
    for angle in (0, 45, 90, 135):
        parts.append(box("grille_bar", (0.035, 0.03, 1.9), (fx, front - 0.2, fz), rot=(0, angle, 0), material="grey", round=0.0))

    # Status lights along the top of the front.
    parts.append(box("light_bar", (3.0, 0.08, 0.3), (ux + 0.2, front - 0.03, 2.95), material="dark", round=0.05))
    for index in range(5):
        parts.append(cylinder("status_light", 0.08, 0.08, (ux - 1.0 + index * 0.6, front - 0.08, 2.95), rot=(90, 0, 0), material="lamp_cyan", segments=14))

    # Radiator fins on the west side.
    side = ux - width / 2
    parts.append(box("radiator_plate", (0.08, 2.9, 1.5), (side - 0.02, uy + 0.1, 2.15), material="dark", round=0.03))
    for index in range(11):
        parts.append(box("fin", (0.3, 0.05, 1.42), (side - 0.17, uy + 0.1 - 1.3 + index * 0.26, 2.15), material="grey", round=0.015))

    # Roof: a hopper full of regolith, and a vent stack with a beacon.
    hx, hy = -2.5, 1.05
    parts.append(box("hopper_base", (0.8, 0.8, 0.24), (hx, hy, top + 0.06), material="dark", round=0.05))
    parts.append(lathe("hopper", [(0.3, 0.0), (0.3, 0.32), (0.95, 0.95), (1.0, 1.02), (0.92, 1.02), (0.25, 0.36), (0.0, 0.36)], loc=(hx, hy, top + 0.1), material="grey", segments=28, cap_bottom=False, cap_top=False))
    parts.append(torus("hopper_rim", 0.97, 0.05, (hx, hy, top + 1.1), material="cyan", segments=28, sides=6))
    parts.append(sphere("hopper_regolith", 0.78, (hx, hy, top + 0.86), scale=(1.0, 1.0, 0.32), material="regolith", segments=20, rings=10))
    vx, vy = 0.25, 1.6
    parts.append(cylinder("stack", 0.2, 1.5, (vx, vy, top + 0.65), material="grey", segments=16))
    parts.append(torus("stack_ring", 0.21, 0.05, (vx, vy, top + 0.85), material="cyan", segments=16, sides=6))
    parts.append(cylinder("stack_cap", 0.3, 0.1, (vx, vy, top + 1.45), material="dark", segments=16, round=0.03))
    parts.append(sphere("beacon", 0.1, (vx, vy, top + 1.6), material="lamp_cyan", segments=12, rings=8))

    # Two tall gas tanks on the east side.
    tx = 2.55
    for index, ty in enumerate((-1.35, 1.65)):
        parts.append(lathe("tank_skirt", [(0.92, 0.25), (0.92, 0.42), (0.8, 0.52), (0.75, 0.6), (0.75, 1.27), (0.0, 1.27)], loc=(tx, ty, 0), material="grey", segments=28, cap_bottom=False, cap_top=False))
        parts.append(torus("skirt_ring", 0.76, 0.04, (tx, ty, 0.9), material="dark", segments=28, sides=6))
        parts.append(capsule("tank", 0.8, 2.75, (tx, ty, 0.75 + 0.8 + 1.375), material="hull", segments=28, rings=14))
        for z in (1.9, 4.0):
            parts.append(torus("tank_band", 0.815, 0.075, (tx, ty, z), material="cyan", segments=28, sides=6))
        # A glowing level gauge: the front tank shows it to the front, the back one to the east.
        if index == 0:
            gauge, glass, turn = (tx, ty - 0.8, 2.95), (tx, ty - 0.84, 2.95), 0
        else:
            gauge, glass, turn = (tx + 0.8, ty, 2.95), (tx + 0.84, ty, 2.95), 90
        parts.append(box("gauge_frame", (0.26, 0.1, 1.7), gauge, rot=(0, 0, turn), material="dark", round=0.04))
        parts.append(box("gauge_glass", (0.12, 0.08, 1.5), glass, rot=(0, 0, turn), material="lamp_cyan", round=0.03))
        parts.append(cylinder("tank_top", 0.13, 0.2, (tx, ty, 5.15), material="dark", segments=12))
        parts.append(torus("top_wheel", 0.17, 0.03, (tx, ty, 5.28), material="cyan", segments=18, sides=6))
        for angle in (0, 90):
            a = math.radians(angle)
            parts.append(_rod("top_spoke", (tx - 0.17 * math.cos(a), ty - 0.17 * math.sin(a), 5.28), (tx + 0.17 * math.cos(a), ty + 0.17 * math.sin(a), 5.28), 0.016, material="cyan", segments=6))
        # Pipe in from the unit, with a valve.
        parts.append(tube("feed_pipe", [(0.95, ty, 2.35), (1.8, ty, 2.35)], 0.1, material="dark", smooth_path=False))
        parts.append(torus("flange", 0.12, 0.04, (1.72, ty, 2.35), rot=(0, 90, 0), material="grey", segments=14, sides=6))
        _valve(parts, (1.32, ty, 2.35), axis="x")
        parts.append(box("pipe_stand", (0.16, 0.16, 2.0), (1.32, ty, 1.25), material="dark", round=0.03))
    # A gauge dial on the front tank.
    parts.append(cylinder("dial", 0.15, 0.08, (tx - 0.5, -1.35 - 0.63, 1.55), rot=(90, 0, 40), material="dark", segments=16, round=0.02))
    parts.append(cylinder("dial_face", 0.11, 0.04, (tx - 0.53, -1.35 - 0.67, 1.55), rot=(90, 0, 40), material="glow_cyan", segments=14))
    # The tanks share a pipe over the top.
    parts.append(tube("manifold", [(tx, -1.0, 4.95), (tx, -0.85, 5.35), (tx, 0.15, 5.5), (tx, 1.15, 5.35), (tx, 1.3, 4.95)], 0.09, material="dark"))
    # Oxygen leaves through a pipe to a coupling at the front of the plot.
    parts.append(tube("outlet", [(tx, -2.1, 1.35), (tx, -2.5, 1.35), (tx, -2.75, 0.75), (tx, -2.85, 0.5), (tx, -3.25, 0.48)], 0.1, material="dark"))
    parts.append(cylinder("coupling", 0.16, 0.14, (tx, -3.28, 0.48), rot=(90, 0, 0), material="cyan", segments=16, round=0.03))
    parts.append(cylinder("coupling_cap", 0.11, 0.08, (tx, -3.37, 0.48), rot=(90, 0, 0), material="dark", segments=12, round=0.02))
    parts.append(box("outlet_stand", (0.22, 0.22, 0.2), (tx, -3.0, 0.38), material="dark", round=0.03))

    # Back: a ladder to the roof and a power box.
    for dx in (-0.25, 0.25):
        parts.append(tube("ladder_rail", [(-2.8 + dx, front + depth + 0.12, 0.3), (-2.8 + dx, front + depth + 0.12, top + 0.4), (-2.8 + dx, front + depth - 0.3, top + 0.4)], 0.035, material="grey", smooth_path=False, sides=6))
    for index in range(10):
        z = 0.6 + index * 0.3
        parts.append(_rod("ladder_step", (-3.05, front + depth + 0.12, z), (-2.55, front + depth + 0.12, z), 0.028, material="grey", segments=6))
    parts.append(box("power_box", (0.7, 0.3, 0.8), (-0.6, front + depth + 0.12, 1.2), material="grey", round=0.06))
    parts.append(box("power_band", (0.72, 0.32, 0.1), (-0.6, front + depth + 0.12, 1.45), material="cyan", round=0.02))
    parts.append(sphere("power_light", 0.045, (-0.4, front + depth + 0.28, 1.3), material="lamp_cyan", segments=8, rings=6))

    oxygen = _finish(parts, "oxygen", reach=1.2)
    return [oxygen], -(front - 0.15)


# ---------------------------------------------------------------------------
# Observatory (violet), with a dome that turns
# ---------------------------------------------------------------------------

DOME_Z = 3.36  # dome centre (and pivot) height
DOME_R = 2.7
SLIT = 0.55  # half the width of the slit


def _dome_shell():
    """A thick hemisphere around the origin with a slit from the front, over the top."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=DOME_R)
    inner = bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=DOME_R - 0.1)
    bmesh.ops.reverse_faces(bm, faces=list({face for vert in inner["verts"] for face in vert.link_faces}))
    geometry = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=geometry, dist=1e-5, plane_co=(0, 0, 0), plane_no=(0, 0, 1), clear_inner=True)
    bmesh.ops.bridge_loops(bm, edges=[edge for edge in bm.edges if edge.is_boundary])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    shell = from_bm("dome", bm, "hull", smooth=True, sharp=None)
    cutter = box("slit", (SLIT * 2, 4.4, 3.4), (0, -1.45, 0.5 + 1.7), material="grey", round=0.0)
    boolean(shell, cutter)
    # Outside white, inside dark, cut edges grey.
    mesh = shell.data
    mesh.materials.clear()
    for name in ("hull", "darker", "grey"):
        mesh.materials.append(mat(name))
    for poly in mesh.polygons:
        facing = Vector(poly.normal).dot(Vector(poly.center).normalized())
        poly.material_index = 0 if facing > 0.5 else (1 if facing < -0.5 else 2)
    shade(shell, True, 40.0)
    return shell


def _sphere_patch(name, radius, half_width, a0, a1, material, steps_x=4, steps_a=12):
    """A strip of a sphere around the origin: |x| < half_width, from angle a0 to a1 (0 = front, 90 = top)."""
    bm = bmesh.new()
    grid = []
    for i in range(steps_x + 1):
        x = -half_width + 2 * half_width * i / steps_x
        rho = math.sqrt(radius * radius - x * x)
        row = []
        for j in range(steps_a + 1):
            a = math.radians(a0 + (a1 - a0) * j / steps_a)
            row.append(bm.verts.new((x, -rho * math.cos(a), rho * math.sin(a))))
        grid.append(row)
    for i in range(steps_x):
        for j in range(steps_a):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    return from_bm(name, bm, material, smooth=True, sharp=None)


def _arc(x, radius, a0, a1, steps=16, lift=0.0):
    """Points on a sphere of `radius` (centre on the dome) in the plane at `x`, from angle a0 to a1."""
    rho = math.sqrt(radius * radius - x * x)
    return [(x, -rho * math.cos(math.radians(a)), DOME_Z + lift + rho * math.sin(math.radians(a))) for a in [a0 + (a1 - a0) * i / steps for i in range(steps + 1)]]


def _telescope():
    """The telescope, built along +Z around its pivot, then tipped up toward the front sky."""
    parts = [
        cylinder("scope_tube", 0.32, 3.3, (0, 0, 0.75), material="hull", segments=24, round=0.03),
        cylinder("scope_shade", 0.37, 0.7, (0, 0, 2.55), material="dark", segments=24, round=0.03),
        torus("scope_rim", 0.37, 0.05, (0, 0, 2.9), material="violet", segments=24, sides=6),
        cylinder("scope_lens", 0.31, 0.04, (0, 0, 2.7), material="window", segments=24),
        cylinder("scope_back", 0.34, 0.24, (0, 0, -0.92), material="dark", segments=20, round=0.04),
        cylinder("eyepiece", 0.07, 0.3, (0, 0.2, -1.08), rot=(90, 0, 0), material="darker", segments=10),
        cylinder("finder", 0.07, 0.8, (0, 0.46, 1.5), material="violet", segments=12, round=0.015),
        cylinder("trunnion", 0.12, 1.0, (0, 0, 0), rot=(0, 90, 0), material="grey", segments=14, round=0.02),
    ]
    for z in (0.15, 1.95):
        parts.append(torus("scope_band", 0.33, 0.04, (0, 0, z), material="violet", segments=24, sides=6))
    for z in (1.2, 1.8):
        parts.append(box("finder_foot", (0.06, 0.18, 0.06), (0, 0.38, z), material="dark", round=0.01))
    for part in parts:
        place(part, rot=(38, 0, 0))
        place(part, (0, 0, DOME_Z + 0.6))
    return parts


def _observatory():
    base = []
    base.append(cylinder("plinth", 3.25, 0.3, (0, 0, 0.15), material="grey", segments=48, round=0.06))
    base.append(box("step", (1.6, 0.6, 0.15), (0, -3.42, 0.075), material="grey", round=0.04))
    base.append(cylinder("drum", 2.6, 3.1, (0, 0, 0.25 + 1.55), material="hull", segments=48, round=0.05))
    base.append(cylinder("drum_band", 2.635, 0.3, (0, 0, 0.62), material="violet", segments=48))
    base.append(cylinder("track", 2.76, 0.12, (0, 0, DOME_Z - 0.06), material="grey", segments=48, round=0.03))
    base.append(torus("lamp_ring", 2.63, 0.07, (0, 0, 3.12), material="lamp_violet", segments=56, sides=8))
    # Panel seams.
    for index in range(16):
        a = math.radians(index * 22.5 + 11.25)
        if -0.5 < math.cos(a) < 0.5 and math.sin(a) < 0:  # leave the door side clear
            continue
        base.append(box("seam", (0.05, 0.04, 2.2), (2.61 * math.cos(a), 2.61 * math.sin(a), 1.95), rot=(0, 0, math.degrees(a) + 90), material="grey", round=0.0))

    # Door with a lamp and a star.
    front = -2.6
    base.append(box("door_frame", (1.4, 0.36, 2.35), (0, front + 0.05, 0.3 + 1.175), material="grey", round=0.1, segments=3))
    base.append(box("door", (1.1, 0.2, 2.12), (0, front - 0.08, 0.3 + 1.06), material="darker", round=0.08, segments=3))
    base.append(cylinder("door_window", 0.19, 0.06, (0, front - 0.19, 1.8), rot=(90, 0, 0), material="lamp_window", segments=18))
    base.append(torus("door_window_ring", 0.2, 0.035, (0, front - 0.2, 1.8), rot=(90, 0, 0), material="violet", segments=18, sides=6))
    base.append(box("door_handle", (0.07, 0.08, 0.32), (0.38, front - 0.2, 1.25), material="violet", round=0.03))
    base.append(box("door_lamp", (0.8, 0.12, 0.12), (0, front - 0.12, 2.5), material="lamp_door", round=0.04))
    base.append(prism("star", _star(0.17), 0.06, loc=(0, front - 0.06, 2.83), rot=(90, 0, 0), material="violet", round=0.012))

    # Round windows.
    for turn in (-58, 58):
        a = math.radians(turn)
        x, y = 2.6 * math.sin(a), -2.6 * math.cos(a)
        base.append(cylinder("window", 0.3, 0.14, (x, y, 2.05), rot=(90, 0, turn), material="lamp_window", segments=20, round=0.02))
        base.append(torus("window_ring", 0.32, 0.07, (x * 1.01, y * 1.01, 2.05), rot=(90, 0, turn), material="dark", segments=22, sides=6))

    # A balcony on the east side, reached by a ladder that comes up through a gap in its floor.
    for start, end in ((-36, -6.5), (6.5, 36)):
        outline = []
        for index in range(7):
            a = math.radians(start + (end - start) * index / 6)
            outline.append((3.28 * math.cos(a), 3.28 * math.sin(a)))
        for index in range(7):
            a = math.radians(end - (end - start) * index / 6)
            outline.append((2.5 * math.cos(a), 2.5 * math.sin(a)))
        base.append(prism("balcony", outline, 0.1, loc=(0, 0, 3.22), material="grey", round=0.02))
    posts = []
    for index in range(6):
        a = math.radians(-34 + 68 * index / 5)
        posts.append((3.22 * math.cos(a), 3.22 * math.sin(a)))
        base.append(cylinder("rail_post", 0.03, 0.95, (3.22 * math.cos(a), 3.22 * math.sin(a), 3.27 + 0.475), material="dark", segments=6))
        base.append(_beam("balcony_strut", (2.6 * math.cos(a), 2.6 * math.sin(a), 2.55), (3.2 * math.cos(a), 3.2 * math.sin(a), 3.18), 0.07, 0.07, material="dark", round=0.015))
    for z, material in ((4.22, "violet"), (3.75, "dark")):
        points = [(3.22 * math.cos(math.radians(a)), 3.22 * math.sin(math.radians(a)), z) for a in range(-34, 35, 4)]
        base.append(tube("rail", points, 0.035 if material == "violet" else 0.022, material=material, sides=6))
    lx = 2.93
    for dy in (-0.24, 0.24):
        base.append(tube("ladder_rail", [(lx, dy, 0.3), (lx, dy, 4.15)], 0.035, material="grey", smooth_path=False, sides=6))
        for z in (0.9, 2.1):
            base.append(box("ladder_bracket", (0.4, 0.05, 0.05), (lx - 0.2, dy, z), material="dark", round=0.0))
    for index in range(10):
        base.append(_rod("ladder_step", (lx, -0.24, 0.6 + index * 0.3), (lx, 0.24, 0.6 + index * 0.3), 0.025, material="grey", segments=6))
    # Control box at the back.
    base.append(box("control_box", (0.7, 0.36, 0.9), (-1.1, 2.62, 1.0), rot=(0, 0, -23), material="grey", round=0.06))
    base.append(sphere("control_light", 0.05, (-1.2, 2.42, 1.3), material="lamp_violet", segments=8, rings=6))

    # The dome, its slit, the opened shutter and the telescope.
    shell = _dome_shell()
    place(shell, (0, 0, DOME_Z))
    dome = [shell]
    dome.append(torus("dome_rim", 2.67, 0.09, (0, 0, DOME_Z + 0.03), material="violet", segments=56, sides=8))
    # Panel seams up the sides (not across the slit or the shutter).
    for turn in (-135, -90, -45, 45, 90, 135):
        phi = math.radians(turn - 90)
        seam = [((DOME_R + 0.015) * math.cos(math.radians(e)) * math.cos(phi), (DOME_R + 0.015) * math.cos(math.radians(e)) * math.sin(phi), DOME_Z + (DOME_R + 0.015) * math.sin(math.radians(e))) for e in range(4, 67, 7)]
        dome.append(tube("dome_seam", seam, 0.03, material="grey", sides=6, smooth_path=False))
    # The opened shutter rides on the slit rails, over the back of the dome.
    shutter = _sphere_patch("shutter", DOME_R + 0.15, SLIT + 0.14, 104, 158, "hull", steps_x=4, steps_a=12)
    solidify(shutter, 0.045, offset=-1.0)
    shade(shutter, True, 50.0)
    place(shutter, (0, 0, DOME_Z))
    dome.append(shutter)
    for side in (-1, 1):
        dome.append(tube("slit_rail", _arc(side * (SLIT + 0.07), DOME_R + 0.05, 8, 160, steps=18), 0.05, material="violet", sides=8, smooth_path=False))
        dome.append(tube("shutter_edge", _arc(side * (SLIT + 0.14), DOME_R + 0.13, 104, 158, steps=8), 0.025, material="grey", sides=6, smooth_path=False))
    dome.append(tube("shutter_handle", _arc(0.0, DOME_R + 0.18, 112, 150, steps=6), 0.03, material="grey", sides=6, smooth_path=False))
    dome.append(cylinder("fork_base", 0.5, 0.16, (0, 0, DOME_Z + 0.08), material="dark", segments=20, round=0.03))
    for side in (-1, 1):
        dome.append(box("fork_arm", (0.1, 0.32, 0.72), (side * 0.56, 0, DOME_Z + 0.42), material="violet", round=0.04))
    dome += _telescope()

    # Shadows: the base with everything; the dome only with what is the same all the way round,
    # so the turning dome carries no shadow of the balcony.
    round_parts = [part for part in base if part.name.split(".")[0] in ("drum", "track", "plinth", "drum_band", "lamp_ring")]
    bake_shadows(dome + round_parts, reach=1.2, strength=0.9, floor=0.5, ground=0.0)
    saved = [_colours(part) for part in dome]
    bake_shadows(base + dome, reach=1.2, strength=0.9, floor=0.5, ground=0.0)
    for part, values in zip(dome, saved):
        _set_colours(part, values)
    paint(base + dome, PALETTE)
    observatory = join(base, "observatory")
    turning = set_pivot(join(dome, "observatory_dome"), (0, 0, DOME_Z))
    parent(turning, observatory)
    return [observatory, turning], -(front - 0.18)


# ---------------------------------------------------------------------------
# Greenhouse dome (green)
# ---------------------------------------------------------------------------

GLASS_R = 3.38
GLASS_Z = 0.86


def _rack(rng, length, shelves=(0.5, 1.15, 1.8), top=2.45, count=5):
    """A plant rack along Y, centred on the origin: troughs of leafy plants under pink grow lights."""
    parts = []
    half = length / 2
    for dx in (-0.27, 0.27):
        for dy in (-half + 0.03, half - 0.03):
            parts.append(box("rack_post", (0.06, 0.06, top - 0.12), (dx, dy, 0.12 + (top - 0.12) / 2), material="grey", round=0.012))
    parts.append(box("rack_top", (0.6, length, 0.05), (0, 0, top), material="grey", round=0.015))
    parts.append(box("grow_light", (0.12, length - 0.25, 0.03), (0, 0, top - 0.04), material="lamp_grow", round=0.0))
    for level, z in enumerate(shelves):
        parts.append(box("shelf", (0.6, length, 0.05), (0, 0, z), material="grey", round=0.015))
        parts.append(box("trough", (0.5, length - 0.16, 0.16), (0, 0, z + 0.105), material="hull", round=0.03))
        for dx in (-0.255, 0.255):
            parts.append(box("trough_rim", (0.03, length - 0.18, 0.05), (dx, 0, z + 0.15), material="green", round=0.0))
        parts.append(box("soil", (0.44, length - 0.24, 0.03), (0, 0, z + 0.19), material="soil", round=0.0))
        if level > 0:
            parts.append(box("grow_light", (0.12, length - 0.25, 0.03), (0, 0, z - 0.04), material="lamp_grow", round=0.0))
        # Two clumps of leaves per plant; they stay below the grow light over them.
        soil = z + 0.205
        for index in range(count):
            y = -half + (index + 0.5) * length / count + rng.uniform(-0.05, 0.05)
            size = rng.uniform(0.17, 0.21)
            parts.append(_leaves(rng, size, (rng.uniform(-0.04, 0.04), y, soil + 0.45 * size), squash=0.75))
            parts.append(_leaves(rng, size * 0.75, (rng.uniform(-0.1, 0.1), y + rng.choice((-0.12, 0.12)), soil + 0.9 * size), squash=0.8))
            if level == 2 and index % 2 == 0:
                parts.append(sphere("berry", 0.045, (0.18, y + 0.08, soil + 0.06), material="fruit", segments=8, rings=6))
    return parts


def _garden():
    rng = random.Random(42)
    parts = []
    # Ring wall, floor and the green band.
    parts.append(lathe("wall", [(3.58, 0.0), (3.58, 0.72), (3.52, 0.84), (3.42, 0.9), (3.26, 0.9), (3.2, 0.84), (3.2, 0.12)], material="hull", segments=56, cap_bottom=False, cap_top=False))
    parts.append(cylinder("floor", 3.22, 0.14, (0, 0, 0.07), material="grey", segments=48))
    parts.append(lathe("band", [(3.56, 0.34), (3.62, 0.37), (3.62, 0.58), (3.56, 0.61)], material="green", segments=56, cap_bottom=False, cap_top=False))
    for index in range(12):
        a = math.radians(index * 30 + 15)
        if math.sin(a) < -0.9:
            continue
        parts.append(box("foot", (0.34, 0.5, 0.3), (3.62 * math.cos(a), 3.62 * math.sin(a), 0.15), rot=(0, 0, math.degrees(a) + 90), material="dark", round=0.05))

    # Frame over the glass: ribs, two rings and a cap with a green light.
    rib = GLASS_R + 0.03
    for index in range(8):
        phi = math.radians(22.5 + index * 45)
        points = [(rib * math.cos(math.radians(e)) * math.cos(phi), rib * math.cos(math.radians(e)) * math.sin(phi), GLASS_Z + rib * math.sin(math.radians(e))) for e in range(0, 81, 8)]
        parts.append(tube("rib", points, 0.045, material="hull", sides=6, smooth_path=False))
    for e in (34, 60):
        r = rib * math.cos(math.radians(e))
        parts.append(torus("ring", r, 0.045, (0, 0, GLASS_Z + rib * math.sin(math.radians(e))), material="hull", segments=48, sides=6))
    cap_r = rib * math.cos(math.radians(80))
    cap_z = GLASS_Z + rib * math.sin(math.radians(80))
    parts.append(lathe("cap", [(cap_r + 0.06, cap_z - 0.1), (cap_r + 0.06, cap_z + 0.08), (cap_r - 0.1, cap_z + 0.18), (0.0, cap_z + 0.2)], material="hull", segments=24, cap_bottom=False))
    parts.append(torus("cap_ring", cap_r + 0.06, 0.05, (0, 0, cap_z - 0.06), material="green", segments=24, sides=6))
    parts.append(sphere("cap_light", 0.07, (0, 0, cap_z + 0.26), material="glow_green", segments=10, rings=6))

    # Airlock on the front.
    ay, az = -3.25, 2.55
    parts.append(box("airlock", (2.1, 1.3, az), (0, ay, az / 2), material="hull", round=0.4, segments=4))
    parts.append(_band("airlock_band", 2.14, 1.34, 0.42, 0.27, 0.475, "green", 0, ay))
    front = ay - 0.65
    parts.append(box("door_frame", (1.5, 0.1, 2.08), (0, front - 0.02, 1.04 + 0.12), material="green", round=0.08))
    parts.append(box("door", (1.18, 0.1, 1.9), (0, front - 0.06, 0.95 + 0.12), material="darker", round=0.08))
    parts.append(box("door_window", (0.62, 0.05, 0.5), (0, front - 0.12, 1.5), material="lamp_door", round=0.08))
    parts.append(box("door_handle", (0.07, 0.07, 0.32), (0.42, front - 0.13, 1.05), material="green", round=0.03))
    parts.append(box("door_lamp", (0.9, 0.08, 0.1), (0, front - 0.02, 2.29), material="lamp_door", round=0.03))
    parts.append(box("step", (1.8, 0.3, 0.12), (0, front - 0.19, 0.06), material="grey", round=0.03))
    for side in (-1, 1):
        parts.append(cylinder("airlock_port", 0.22, 0.1, (side * 1.05, ay - 0.1, 1.55), rot=(0, 90, 0), material="window", segments=18, round=0.02))
        parts.append(torus("airlock_port_ring", 0.24, 0.04, (side * 1.09, ay - 0.1, 1.55), rot=(0, 90, 0), material="green", segments=18, sides=6))
    # A leaf sign on the airlock roof edge.
    for side in (-1, 1):
        leaf = sphere("sign_leaf", 0.16, material="green", segments=12, rings=8)
        place(leaf, scale=(1.0, 0.25, 0.55))
        place(leaf, (side * 0.15, front + 0.12, az + 0.02), rot=(0, side * -35, 0))
        parts.append(leaf)

    # Inside: a little fruit tree in a round planter, racks, low planters, a ring of grow lights.
    tx, ty = 0.0, 0.55
    parts.append(lathe("pot", [(0.0, 0.14), (0.62, 0.14), (0.74, 0.3), (0.8, 0.6), (0.86, 0.64), (0.86, 0.7), (0.78, 0.7), (0.0, 0.66)], loc=(tx, ty, 0), material="dark", segments=28, cap_bottom=False, cap_top=False))
    parts.append(torus("pot_ring", 0.85, 0.04, (tx, ty, 0.5), material="green", segments=28, sides=6))
    parts.append(cylinder("pot_soil", 0.78, 0.04, (tx, ty, 0.69), material="soil", segments=24))
    parts.append(cylinder("trunk", 0.1, 1.3, (tx, ty, 0.7 + 0.65), material="bark", segments=10, radius2=0.07))
    for index in range(3):
        a = math.radians(index * 120 + 20)
        parts.append(tube("branch", [(tx, ty, 1.4 + index * 0.12), (tx + 0.22 * math.cos(a), ty + 0.22 * math.sin(a), 1.6 + index * 0.12), (tx + 0.38 * math.cos(a), ty + 0.38 * math.sin(a), 1.68 + index * 0.12)], 0.04, material="bark", sides=6))
    for layer, (count, ring, z, size) in enumerate(((5, 0.42, 1.78, 0.46), (3, 0.26, 2.25, 0.42), (1, 0.0, 2.62, 0.38))):
        for index in range(count):
            a = math.radians(index * 360 / count + layer * 31)
            parts.append(_leaves(rng, size * rng.uniform(0.92, 1.06), (tx + ring * math.cos(a), ty + ring * math.sin(a), z), squash=0.82, detail=2))
    for index in range(7):
        a = math.radians(index * 51 + 10)
        z = 1.72 + (index % 3) * 0.3
        reach = 0.8 - (index % 3) * 0.17
        parts.append(sphere("fruit", 0.075, (tx + reach * math.cos(a), ty + reach * math.sin(a), z), material="fruit", segments=8, rings=6))
    for side in (-1, 1):
        rack = _rack(rng, 2.5)
        for part in rack:
            place(part, (side * 2.22, 0.05, 0))
        parts += rack
    rack = _rack(rng, 2.2, count=4)
    for part in rack:
        place(part, (0, 2.38, 0), rot=(0, 0, 90))
    parts += rack
    for side in (-1, 1):
        px, py = side * 1.55, -1.95
        parts.append(box("planter", (0.95, 0.6, 0.4), (px, py, 0.32), material="hull", round=0.06))
        parts.append(box("planter_band", (0.97, 0.62, 0.08), (px, py, 0.4), material="green", round=0.02))
        parts.append(box("planter_soil", (0.85, 0.5, 0.04), (px, py, 0.52), material="soil", round=0.0))
        for index in range(3):
            parts.append(_leaves(rng, 0.17, (px - 0.28 + index * 0.28, py + rng.uniform(-0.05, 0.05), 0.6), squash=0.6))
    parts.append(torus("grow_ring", 1.5, 0.05, (0, 0, 3.32), material="lamp_grow", segments=40, sides=6))
    parts.append(torus("grow_ring_case", 1.5, 0.065, (0, 0, 3.4), material="dark", segments=40, sides=6))
    for index in range(4):
        a = math.radians(index * 90 + 45)
        top = GLASS_Z + math.sqrt(GLASS_R ** 2 - 1.5 ** 2) - 0.02
        parts.append(cylinder("hanger", 0.015, top - 3.4, (1.5 * math.cos(a), 1.5 * math.sin(a), (top + 3.4) / 2), material="grey", segments=6))

    # A water tank outside, at the back.
    wx, wy = 2.85, 2.85
    parts.append(box("tank_stand", (0.8, 0.8, 0.2), (wx, wy, 0.1), material="grey", round=0.05))
    parts.append(capsule("water_tank", 0.4, 0.55, (wx, wy, 0.2 + 0.4 + 0.275), material="hull", segments=18, rings=10))
    parts.append(torus("water_band", 0.41, 0.05, (wx, wy, 0.85), material="green", segments=18, sides=6))
    parts.append(tube("water_pipe", [(wx - 0.3, wy - 0.25, 0.5), (wx - 0.55, wy - 0.5, 0.5), (wx - 0.62, wy - 0.62, 0.62)], 0.05, material="dark"))

    glass = partial_sphere("glass", GLASS_R, loc=(0, 0, GLASS_Z), material="glass", segments=48, rings=24, plane=((0, 0, 0), (0, 0, 1)))
    garden = _finish(parts, "garden", reach=1.0, extra=[glass])
    return [garden], -(front - 0.11)


# ---------------------------------------------------------------------------
# Storm shelter (orange)
# ---------------------------------------------------------------------------

MOUND_W = 3.3  # half width of the arch at the ground line, before the foot spreads
MOUND_H = 3.5
MOUND_Z0 = -0.35  # the arch's centre is below the ground: it is half buried
MOUND_FRONT = -3.2


def _profile(t, scale=1.0):
    """The heap's cross-section: t = 0 is the east foot, 0.5 the top, 1 the west foot."""
    a0 = math.asin(-MOUND_Z0 / MOUND_H)
    a = a0 + (math.pi - 2 * a0) * t
    x = MOUND_W * math.cos(a)
    z = MOUND_Z0 + MOUND_H * math.sin(a)
    spread = 0.35 * (1.0 - z / (MOUND_Z0 + MOUND_H)) ** 3  # the foot of the heap spreads out
    x += spread if x > 0 else -spread
    return x * scale, z * scale


def _mound():
    """The regolith heap: an arch along Y that slopes into the door wall and rounds off at the back."""
    rows = [(MOUND_FRONT, 0.86), (-3.02, 0.92), (-2.84, 0.97), (-2.66, 0.995)]
    y = -2.45
    while y < 1.3:
        rows.append((y, 1.0))
        y += 0.25
    end = 2.7
    for k in range(1, 10):
        u = k / 10 * math.pi / 2
        rows.append((1.3 + end * math.sin(u), math.cos(u)))
    segments = 40
    bm = bmesh.new()
    grid = []
    for y, scale in rows:
        grid.append([bm.verts.new((_profile(i / segments, scale)[0], y, _profile(i / segments, scale)[1])) for i in range(segments + 1)])
    pole = bm.verts.new((0.0, 1.3 + end, 0.0))
    for j in range(len(grid) - 1):
        for i in range(segments):
            bm.faces.new((grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1]))
    for i in range(segments):
        bm.faces.new((grid[-1][i], pole, grid[-1][i + 1]))
    bm.normal_update()
    # Heap it up: push the surface in and out, but keep the edge at the door wall clean.
    offset = Vector((3.1, 7.7, 1.3))
    for vert in bm.verts:
        p = vert.co
        weight = min(1.0, max(0.0, (p.y - MOUND_FRONT) / 0.5))
        bump = noise.noise(p * 0.75 + offset) + 0.45 * noise.noise(p * 2.1 + offset * 2.0)
        push = vert.normal * (0.3 * weight * bump)
        if p.z < 0.02:
            push.z = 0.0
        vert.co = p + push
        vert.co.z = max(0.0, vert.co.z)
    heap = from_bm("heap", bm, "regolith", smooth=True, sharp=None)
    return heap


def _sandbag(rng, loc, turn, lift=0.0):
    """A plump bag, its long side turned `turn` degrees from +X."""
    bag = box("sandbag", (0.7, 0.4, 0.24), material="sandbag", round=0.11, segments=3)
    # Plump it up: the middle bulges, the ends pinch in a little.
    for vertex in bag.data.vertices:
        squeeze = 1.0 - (vertex.co.x / 0.35) ** 2
        vertex.co.z *= 1.0 + 0.25 * max(0.0, squeeze)
        vertex.co.y *= 1.0 + 0.12 * max(0.0, squeeze)
    bag.data.update()
    shade(bag, True, None)
    place(bag, rot=(rng.uniform(-4, 4), rng.uniform(-3, 3), turn + rng.uniform(-6, 6)))
    return place(bag, (loc[0], loc[1], 0.14 + lift))


def _bunker():
    rng = random.Random(7)
    parts = []
    heap = _mound()
    parts.append(heap)

    # The door wall and its orange arch.
    face = -3.45
    parts.append(prism("portal", [_profile(i / 40, 0.9) for i in range(41)], 0.5, loc=(0, face + 0.25, 0), rot=(90, 0, 0), material="grey", round=0.05))
    rim = [_profile(i / 40, 0.95) for i in range(41)] + [_profile(i / 40, 0.83) for i in range(40, -1, -1)]
    parts.append(prism("arch", rim, 0.26, loc=(0, face - 0.05, 0), rot=(90, 0, 0), material="orange", round=0.04))
    for index in range(1, 10):
        x, z = _profile(index / 10, 0.89)
        parts.append(cylinder("bolt", 0.06, 0.06, (x, face - 0.19, z), rot=(90, 0, 0), material="darker", segments=10, round=0.015))

    # Reinforced door frame, hazard stripes and the door.
    for side in (-1, 1):
        parts.append(box("door_post", (0.26, 0.34, 2.38), (side * 0.88, face - 0.07, 1.19), material="dark", round=0.05))
        parts.append(box("hazard_panel", (0.2, 0.03, 1.9), (side * 0.88, face - 0.25, 1.1), material="orange", round=0.01))
        for index in range(6):
            parts.append(box("hazard", (0.05, 0.02, 0.27), (side * 0.88, face - 0.27, 0.3 + index * 0.32), rot=(0, side * 35, 0), material="darker", round=0.0))
    parts.append(box("door_header", (2.02, 0.36, 0.3), (0, face - 0.08, 2.27), material="dark", round=0.05))
    parts.append(box("door_light", (1.3, 0.04, 0.09), (0, face - 0.27, 2.27), material="lamp_door", round=0.0))
    parts.append(box("door", (1.5, 0.12, 2.1), (0, face - 0.02, 1.05), material="darker", round=0.05))
    for z in (0.4, 1.8):
        parts.append(box("door_bar", (1.36, 0.05, 0.13), (0, face - 0.1, z), material="grey", round=0.02))
    for x in (-0.6, 0.6):
        for z in (0.4, 1.8):
            parts.append(cylinder("door_bolt", 0.04, 0.04, (x, face - 0.13, z), rot=(90, 0, 0), material="dark", segments=8))
    parts.append(torus("door_wheel", 0.22, 0.035, (0, face - 0.12, 1.1), rot=(90, 0, 0), material="orange", segments=22, sides=6))
    for angle in (0, 60, 120):
        a = math.radians(angle)
        parts.append(_rod("wheel_spoke", (-0.22 * math.cos(a), face - 0.12, 1.1 - 0.22 * math.sin(a)), (0.22 * math.cos(a), face - 0.12, 1.1 + 0.22 * math.sin(a)), 0.02, material="orange", segments=6))
    parts.append(cylinder("wheel_hub", 0.06, 0.08, (0, face - 0.12, 1.1), rot=(90, 0, 0), material="dark", segments=10))
    parts.append(box("threshold", (1.7, 0.42, 0.05), (0, face - 0.27, 0.025), material="orange", round=0.01))
    for index in range(6):
        parts.append(box("threshold_stripe", (0.08, 0.3, 0.012), (-0.65 + index * 0.26, face - 0.27, 0.053), rot=(0, 0, 35), material="darker", round=0.0))
    # A lamp with a little hood above the door.
    parts.append(box("lamp_bracket", (0.08, 0.32, 0.08), (0, face - 0.26, 2.7), material="dark", round=0.01))
    parts.append(sphere("lamp", 0.1, (0, face - 0.42, 2.6), material="lamp_door", segments=12, rings=8))
    parts.append(cylinder("lamp_hood", 0.15, 0.08, (0, face - 0.42, 2.72), material="dark", segments=16, radius2=0.08, round=0.02))
    parts.append(torus("lamp_cage", 0.11, 0.012, (0, face - 0.42, 2.6), rot=(90, 0, 0), material="dark", segments=14, sides=4))

    # Sandbags along the foot of the heap, round its back, and beside the door.
    for side in (-1, 1):
        for index in range(6):
            parts.append(_sandbag(rng, (side * 3.68, -2.5 + index * 0.74), 90))
        for index in range(5):
            parts.append(_sandbag(rng, (side * 3.56, -2.13 + index * 0.74), 90, lift=0.22))
        for index in range(3):
            u = math.radians(18 + index * 20)
            x, y = side * 3.66 * math.cos(u), 1.3 + 2.72 * math.sin(u)
            turn = math.degrees(math.atan2(2.72 * math.cos(u), -side * 3.66 * math.sin(u)))
            parts.append(_sandbag(rng, (x, y), turn))
        for index in range(2):
            parts.append(_sandbag(rng, (side * (1.55 + index * 0.76), face - 0.42), 0))
        parts.append(_sandbag(rng, (side * 1.93, face - 0.4), 0, lift=0.22))

    # Vents and a radio mast poke out of the heap.
    for x, y in ((1.0, -0.6), (-0.9, 0.9)):
        parts.append(cylinder("vent", 0.13, 1.4, (x, y, 2.95), material="grey", segments=14))
        parts.append(lathe("vent_cap", [(0.0, 0.0), (0.3, 0.0), (0.3, 0.06), (0.2, 0.18), (0.0, 0.22)], loc=(x, y, 3.68), material="orange", segments=18, cap_bottom=True, cap_top=False))
        parts.append(torus("vent_ring", 0.14, 0.03, (x, y, 3.45), material="dark", segments=14, sides=5))
    parts.append(cylinder("mast", 0.04, 1.8, (-1.55, 1.6, 3.35), material="dark", segments=8, radius2=0.03))
    parts.append(sphere("mast_light", 0.06, (-1.55, 1.6, 4.28), material="glow_red", segments=8, rings=6))
    parts.append(box("mast_bar", (0.5, 0.04, 0.04), (-1.55, 1.6, 3.95), material="dark", round=0.0))

    # Loose rubble on the heap.
    tree = BVHTree.FromPolygons([v.co.copy() for v in heap.data.vertices], [list(p.vertices) for p in heap.data.polygons])
    rocks = 0
    while rocks < 22:
        x = rng.uniform(-3.4, 3.4)
        y = rng.uniform(-2.4, 3.6)
        hit = tree.ray_cast(Vector((x, y, 10.0)), Vector((0, 0, -1)))
        if hit[0] is None:
            continue
        size = rng.uniform(0.14, 0.3)
        rock = ico("rock", size, detail=1, material="rubble")
        for vertex in rock.data.vertices:
            vertex.co *= 1.0 + 0.3 * noise.noise(vertex.co * 6.0 + Vector((rocks, 0.0, 0.0)))
        place(rock, (x, y, hit[0].z - size * 0.25), rot=(rng.uniform(0, 40), rng.uniform(0, 40), rng.uniform(0, 360)), scale=(1.2, 1.0, 0.7))
        shade(rock, True, 35.0)
        parts.append(rock)
        rocks += 1

    bunker = _finish(parts, "bunker", reach=1.2)
    # Nothing goes below the ground.
    for vertex in bunker.data.vertices:
        if vertex.co.z < 0.0:
            vertex.co.z = 0.0
    bunker.data.update()
    return [bunker], -(face - 0.08)


# ---------------------------------------------------------------------------
# Solar array
# ---------------------------------------------------------------------------


def _panel():
    """One solar panel lying flat around the origin: grey frame, dark blue cells with fine lines."""
    parts = [
        box("panel_frame", (2.32, 1.52, 0.07), material="grey", round=0.025),
        box("cells", (2.22, 1.42, 0.04), (0, 0, 0.03), material="solar", round=0.0),
    ]
    for index in range(1, 6):
        parts.append(box("line", (0.014, 1.42, 0.006), (-1.11 + index * 0.37, 0, 0.053), material="solar_line", round=0.0))
    for index in range(1, 4):
        parts.append(box("line", (2.22, 0.014, 0.006), (0, -0.71 + index * 0.355, 0.053), material="solar_line", round=0.0))
    return parts


def _solar_array():
    parts = []
    tilt = 26.0
    t = math.radians(tilt)
    up = Vector((0.0, math.cos(t), math.sin(t)))
    out = Vector((0.0, -math.sin(t), math.cos(t)))
    columns = (-3.25, -1.1, 1.1, 3.25)
    rows = ((-1.7, 1.0), (1.75, 1.45))
    for row, (yc, zc) in enumerate(rows):
        centre = Vector((0.0, yc, zc))
        for xc in (-2.42, 0.0, 2.42):
            for part in _panel():
                place(part, rot=(tilt, 0, 0))
                place(part, (xc, yc, zc))
                parts.append(part)
        for along in (-0.48, 0.48):
            rail = box("rail", (7.4, 0.1, 0.1), material="dark", round=0.02)
            place(rail, rot=(tilt, 0, 0))
            place(rail, tuple(centre + up * along - out * 0.1))
            parts.append(rail)
        for xp in columns:
            tops = []
            for along in (-0.48, 0.48):
                top = centre + up * along - out * 0.15
                tops.append(top)
                parts.append(box("post", (0.1, 0.1, top.z - 0.18), (xp, top.y, (top.z + 0.18) / 2), material="dark", round=0.02))
                parts.append(box("footing", (0.34, 0.34, 0.14), (xp, top.y, 0.07), material="grey", round=0.03))
            parts.append(_rod("brace", (xp, tops[0].y + 0.05, 0.3), (xp, tops[1].y - 0.05, tops[1].z - 0.12), 0.03, material="grey", segments=6))
    # Ground beams tie the two rows into one frame.
    for xp in columns:
        parts.append(box("sleeper", (0.12, 4.2, 0.08), (xp, 0.03, 0.18), material="dark", round=0.02))

    # Junction box with a green light, at the front west corner.
    jx, jy = -3.55, -3.15
    parts.append(box("box_post", (0.12, 0.12, 0.7), (jx, jy + 0.05, 0.35), material="dark", round=0.02))
    parts.append(box("box_foot", (0.4, 0.4, 0.1), (jx, jy + 0.05, 0.05), material="grey", round=0.03))
    parts.append(box("junction", (0.56, 0.34, 0.72), (jx, jy, 1.0), material="hull", round=0.06))
    parts.append(box("junction_roof", (0.64, 0.42, 0.06), (jx, jy, 1.39), material="grey", round=0.02))
    parts.append(box("junction_band", (0.58, 0.36, 0.1), (jx, jy, 1.2), material="power", round=0.02))
    parts.append(box("junction_door", (0.42, 0.02, 0.44), (jx, jy - 0.175, 0.9), material="grey", round=0.01))
    parts.append(sphere("junction_ok", 0.045, (jx + 0.17, jy - 0.18, 1.28), material="glow_green", segments=10, rings=6))
    bolt = [(0.02, 0.12), (-0.05, -0.01), (0.0, -0.01), (-0.02, -0.12), (0.05, 0.02), (0.0, 0.02)]
    parts.append(prism("bolt_icon", bolt, 0.02, loc=(jx, jy - 0.19, 0.92), rot=(90, 0, 0), material="power", round=0.0))

    # A little sign with a sun on it, at the other front corner.
    sx, sy = 3.3, -3.15
    parts.append(box("sign_post", (0.08, 0.08, 1.0), (sx, sy + 0.03, 0.5), material="dark", round=0.015))
    parts.append(box("sign_foot", (0.3, 0.3, 0.08), (sx, sy + 0.03, 0.04), material="grey", round=0.02))
    parts.append(cylinder("sign", 0.26, 0.05, (sx, sy - 0.03, 1.08), rot=(90, 0, 0), material="power", segments=24, round=0.015))
    parts.append(cylinder("sign_sun", 0.08, 0.02, (sx, sy - 0.065, 1.08), rot=(90, 0, 0), material="darker", segments=16))
    for index in range(8):
        a = math.radians(index * 45)
        parts.append(box("sign_ray", (0.025, 0.012, 0.07), (sx + 0.15 * math.cos(a), sy - 0.062, 1.08 + 0.15 * math.sin(a)), rot=(0, 90 - index * 45, 0), material="darker", round=0.0))

    # Cable conduit along the ground: out of the box, along the front, up the east side.
    def conduit(points):
        for start, end in zip(points, points[1:]):
            start, end = Vector(start), Vector(end)
            step = (end - start).normalized() * 0.1
            parts.append(_beam("conduit", start - step, end + step, 0.2, 0.12, material="dark", round=0.03))
            steps = max(1, int((end - start).length / 1.0))
            for index in range(1, steps + 1):
                p = start + (end - start) * (index / (steps + 1))
                clamp = box("clamp", (0.26, 0.08, 0.15), material="grey", round=0.02)
                place(clamp, rot=(0, 0, math.degrees(math.atan2(end.y - start.y, end.x - start.x)) + 90))
                place(clamp, (p.x, p.y, 0.08))
                parts.append(clamp)

    conduit([(jx, jy + 0.3, 0.07), (jx, -2.75, 0.07), (3.85, -2.75, 0.07), (3.85, 1.35, 0.07)])
    conduit([(jx - 0.05, jy, 0.07), (-4.1, jy, 0.07)])
    parts.append(cylinder("conduit_end", 0.1, 0.08, (-4.2, jy, 0.1), rot=(0, 90, 0), material="power", segments=12, round=0.02))
    parts.append(tube("box_cable", [(jx, jy + 0.12, 0.66), (jx, jy + 0.22, 0.3), (jx, jy + 0.3, 0.1)], 0.05, material="darker"))
    # Each row's cable runs down from the end of its lower rail into the conduit.
    for row, (yc, zc) in enumerate(rows):
        rail = Vector((3.62, yc, zc)) - up * 0.48 - out * 0.1
        end = Vector((3.85, -2.6, 0.12)) if row == 0 else Vector((3.85, 1.2, 0.12))
        parts.append(tube("drop", [tuple(rail), (3.72, rail.y - 0.02, 0.35), tuple(end)], 0.035, material="darker"))
        parts.append(box("drop_clip", (0.1, 0.12, 0.12), tuple(rail + Vector((0.0, 0.0, -0.02))), material="power", round=0.02))

    solar = _finish(parts, "solar_array", reach=0.9)
    return [solar], None


# ---------------------------------------------------------------------------


def build(out_dir, names=None):
    """Build all six buildings (or only `names`) into annex.glb and annex_low.glb."""
    reset()
    for name, colour in SPECIAL.items():
        mat(name, colour)
    makers = {
        "workshop": _workshop,
        "oxygen": _oxygen,
        "observatory": _observatory,
        "garden": _garden,
        "bunker": _bunker,
        "solar_array": _solar_array,
    }
    objects = []
    for name in names or list(makers):
        made, door = makers[name]()
        _report(name, made, door)
        objects += made
    export(out_dir + "/annex.glb", objects)
    for obj in objects:
        decimate(obj, 0.45)
    export(out_dir + "/annex_low.glb", objects)
