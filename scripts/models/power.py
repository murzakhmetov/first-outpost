"""
Power and building machines, as separate parts in one file:

  panel_base, panel_head   Mars: a flat solar panel that tilts toward the Sun
  mast_base, mast_head     Moon: a tall panel that stands up and turns
  battery                  the battery bank (bars are separate materials bar0..bar4)
  printer                  the robot that builds the regolith wall

Each part sits on the origin. Heads have their pivot at the origin.
"""
import math

from lib import bake_shadows, box, cylinder, decimate, export, join, lathe, paint, reset, sphere, torus, tube

PALETTE = {
    "hull": "#f4f0e8",
    "grey": "#aeb6c6",
    "dark": "#3a4260",
    "darker": "#262b40",
    "power": "#ffc94d",
    "shield": "#ff9860",
    "solar_line": "#9fc0ff",
}


def _finish(parts, name, reach=0.8, ground=0.0):
    bake_shadows(parts, reach=reach, strength=0.9, floor=0.5, ground=ground)
    paint(parts, PALETTE)
    return join(parts, name)


def _cells(width, depth, z, columns, rows, thickness=0.05):
    """A solar plate lying flat (in X and Y) with a grid of cell lines on top."""
    parts = [box("cells", (width, depth, thickness), (0, 0, z), material="solar", round=0.0)]
    top = z + thickness / 2 + 0.004
    for index in range(1, columns):
        parts.append(box("line", (0.02, depth, 0.008), (-width / 2 + index * width / columns, 0, top), material="solar_line", round=0.0))
    for index in range(1, rows):
        parts.append(box("line", (width, 0.02, 0.008), (0, -depth / 2 + index * depth / rows, top), material="solar_line", round=0.0))
    return parts


def _panel_base():
    parts = [
        cylinder("foot", 0.62, 0.16, (0, 0, 0.08), material="grey", segments=18, radius2=0.5, round=0.03),
        cylinder("post", 0.16, 1.75, (0, 0, 0.95), material="dark", segments=12, radius2=0.12),
        sphere("joint", 0.2, (0, 0, 1.82), material="grey", segments=14, rings=10),
        box("junction", (0.3, 0.2, 0.36), (0, 0.22, 0.5), material="grey", round=0.04),
        sphere("junction_light", 0.04, (0, 0.33, 0.58), material="glow_green", segments=8, rings=6),
    ]
    for index in range(3):
        a = math.radians(index * 120 + 30)
        parts.append(box("anchor", (0.3, 0.16, 0.1), (0.56 * math.cos(a), 0.56 * math.sin(a), 0.05), rot=(0, 0, math.degrees(a)), material="dark", round=0.03))
    return _finish(parts, "panel_base", reach=0.5)


def _panel_head():
    parts = [
        box("frame", (3.7, 2.3, 0.13), (0, 0, 0), material="grey", round=0.05),
        box("spine", (0.24, 2.0, 0.16), (0, 0, -0.12), material="dark", round=0.04),
        cylinder("hinge", 0.14, 0.5, (0, 0, -0.16), rot=(0, 90, 0), material="dark", segments=12, round=0.03),
    ]
    for x in (-1.2, 1.2):
        parts.append(box("rib", (0.1, 2.1, 0.1), (x, 0, -0.1), material="dark", round=0.02))
    parts += _cells(3.46, 2.06, 0.08, 6, 4)
    return _finish(parts, "panel_head", reach=0.4, ground=None)


def _mast_base():
    parts = [
        cylinder("foot", 0.85, 0.22, (0, 0, 0.11), material="grey", segments=20, radius2=0.7, round=0.04),
        cylinder("post", 0.2, 2.6, (0, 0, 1.4), material="dark", segments=12, radius2=0.14),
        cylinder("collar", 0.26, 0.3, (0, 0, 2.5), material="grey", segments=14, round=0.04),
    ]
    for index in range(3):
        a = math.radians(index * 120 + 90)
        parts.append(tube("brace", [(1.35 * math.cos(a), 1.35 * math.sin(a), 0.1), (0.1 * math.cos(a), 0.1 * math.sin(a), 1.75)], 0.05, material="dark", smooth_path=False, sides=6))
        parts.append(cylinder("brace_pad", 0.2, 0.08, (1.35 * math.cos(a), 1.35 * math.sin(a), 0.04), material="grey", segments=12))
    return _finish(parts, "mast_base", reach=0.6)


def _mast_head():
    parts = [
        cylinder("pole", 0.1, 6.8, (0, 0, 3.4), material="dark", segments=10),
        box("frame", (2.9, 0.1, 6.5), (0, 0, 3.9), material="grey", round=0.04),
        box("cells", (2.7, 0.16, 6.3), (0, 0, 3.9), material="solar", round=0.0),
        sphere("tip", 0.08, (0, 0, 6.86), material="glow_red", segments=8, rings=6),
    ]
    for side in (-1, 1):
        for index in range(1, 2):
            parts.append(box("line", (0.02, 0.008, 6.3), (0, side * 0.084, 3.9), material="solar_line", round=0.0))
        for index in range(1, 5):
            parts.append(box("line", (2.7, 0.008, 0.02), (0, side * 0.084, 0.75 + index * 1.26), material="solar_line", round=0.0))
    for z in (1.2, 3.9, 6.6):
        parts.append(box("clamp", (0.4, 0.3, 0.2), (0, 0, z), material="dark", round=0.04))
    return _finish(parts, "mast_head", reach=0.4, ground=None)


def _battery():
    parts = [
        box("slab", (3.9, 2.4, 0.3), (0, 0, 0.15), material="grey", round=0.08),
        box("body", (3.5, 1.9, 2.0), (0, 0, 1.3), material="hull", round=0.28, segments=4),
        box("band", (3.54, 1.94, 0.34), (0, 0, 0.55), material="power", round=0.04),
        box("vent", (1.5, 1.3, 0.16), (0, 0, 2.36), material="power", round=0.06),
        box("panel", (3.0, 0.1, 1.25), (0, -0.96, 1.5), material="dark", round=0.08),
        box("door", (0.9, 0.06, 1.2), (0.9, 0.97, 1.4), material="grey", round=0.05),
        box("door_handle", (0.06, 0.08, 0.3), (0.6, 1.02, 1.4), material="dark", round=0.02),
        cylinder("socket", 0.2, 0.2, (1.8, -0.5, 0.8), rot=(0, 90, 0), material="dark", segments=14, round=0.03),
        torus("socket_ring", 0.21, 0.035, (1.86, -0.5, 0.8), rot=(0, 90, 0), material="power", segments=18, sides=6),
        cylinder("beacon_post", 0.03, 0.4, (-1.4, 0.6, 2.5), material="dark", segments=8),
        sphere("beacon", 0.09, (-1.4, 0.6, 2.75), material="lamp_power", segments=10, rings=8),
    ]
    for index in range(5):
        parts.append(box("vent_fin", (1.3, 0.05, 0.08), (0, -0.48 + index * 0.24, 2.47), material="dark", round=0.0))
        parts.append(box("bar", (0.4, 0.1, 0.95), (-1.1 + index * 0.55, -1.02, 1.5), material="bar%d" % index, round=0.05))
    # Black chevrons on the yellow band, as on real high-voltage gear.
    for index in range(9):
        parts.append(box("chevron", (0.16, 0.02, 0.42), (-1.44 + index * 0.36, -0.98, 0.55), rot=(0, 32, 0), material="darker", round=0.0))
    for side in (-1, 1):
        for index in range(6):
            parts.append(box("fin", (0.06, 1.3, 0.1), (side * 1.77, 0, 1.0 + index * 0.2), material="grey", round=0.02))
    return _finish(parts, "battery", reach=0.8)


def _printer():
    """The wall-building robot. Its arm reaches toward +X."""
    parts = [
        box("chassis", (1.3, 0.95, 0.5), (0, 0, 0.55), material="shield", round=0.16, segments=3),
        box("deck", (1.0, 0.7, 0.3), (0, 0, 0.92), material="dark", round=0.08),
        lathe("hopper", [(0.12, 1.05), (0.2, 1.12), (0.32, 1.42), (0.3, 1.44), (0.17, 1.14), (0.1, 1.08)], loc=(-0.3, 0, 0), material="grey", segments=18, cap_bottom=False, cap_top=False),
        tube("arm_upper", [(0.15, 0, 1.05), (0.5, 0, 1.95)], 0.07, material="grey", smooth_path=False),
        sphere("arm_elbow", 0.11, (0.5, 0, 1.95), material="shield", segments=12, rings=8),
        tube("arm_lower", [(0.5, 0, 1.95), (1.05, 0, 1.64)], 0.06, material="grey", smooth_path=False),
        cylinder("nozzle", 0.06, 0.2, (1.1, 0, 1.56), rot=(0, 30, 0), material="dark", segments=10, radius2=0.1),
        sphere("nozzle_light", 0.13, (1.12, 0, 1.46), material="lamp_nozzle", segments=12, rings=8),
        cylinder("eye_ring", 0.1, 0.06, (0.66, 0, 0.62), rot=(0, 90, 0), material="dark", segments=12),
        cylinder("eye", 0.07, 0.04, (0.69, 0, 0.62), rot=(0, 90, 0), material="lamp_nozzle", segments=10),
        cylinder("aerial", 0.012, 0.5, (-0.4, 0.3, 1.3), material="dark", segments=6),
    ]
    for x in (-0.45, 0.45):
        for y in (-0.52, 0.52):
            parts.append(cylinder("wheel", 0.26, 0.2, (x, y, 0.26), rot=(90, 0, 0), material="darker", segments=16, round=0.04))
            parts.append(cylinder("hub", 0.11, 0.23, (x, y, 0.26), rot=(90, 0, 0), material="grey", segments=10))
    return _finish(parts, "printer", reach=0.5)


def build(out_dir):
    reset()
    objects = [_panel_base(), _panel_head(), _mast_base(), _mast_head(), _battery(), _printer()]
    export(out_dir + "/power.glb", objects)
    for obj in objects:
        decimate(obj, 0.5)
    export(out_dir + "/power_low.glb", objects)
