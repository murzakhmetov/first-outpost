"""
The crew lander: a gold-wrapped descent stage on four legs with the crew cabin on top.

The hatch, porch and ladder face -Y. Footpads on Z = 0. About 7.6 m tall.
"""
import math

from lib import bake_shadows, box, capsule, cylinder, decimate, export, join, lathe, paint, reset, sphere, torus, tube

PALETTE = {
    "hull": "#f4f0e8",
    "grey": "#aeb6c6",
    "dark": "#3a4260",
    "darker": "#262b40",
    "orange": "#ff9860",
}

# The cabin's outline: (radius, height above the descent stage).
CABIN = [(0.0, 0.0), (2.0, 0.0), (2.2, 0.45), (2.1, 1.7), (1.55, 2.9), (0.85, 3.55), (0.0, 3.75)]
CABIN_BASE = 2.75


def _cabin_radius(height):
    """Radius of the cabin wall at a height above its base."""
    for (r0, z0), (r1, z1) in zip(CABIN[1:-1], CABIN[2:]):
        if z0 <= height <= z1:
            return r0 + (r1 - r0) * (height - z0) / (z1 - z0)
    return 0.0


def _on_cabin(angle_deg, height, out=0.0):
    a = math.radians(angle_deg)
    r = _cabin_radius(height) + out
    return (r * math.cos(a), r * math.sin(a), CABIN_BASE + height)


def _solid():
    parts = []
    # Descent stage: eight sides, wrapped in gold foil.
    parts.append(cylinder("stage", 2.95, 1.5, (0, 0, 2.0), rot=(0, 0, 22.5), material="gold", segments=8, round=0.1, round_segments=3))
    parts.append(cylinder("stage_top", 2.5, 0.12, (0, 0, 2.78), rot=(0, 0, 22.5), material="grey", segments=8, round=0.03))
    parts.append(cylinder("stage_base", 2.4, 0.14, (0, 0, 1.2), rot=(0, 0, 22.5), material="dark", segments=8, round=0.03))
    # Engine bell.
    parts.append(
        lathe(
            "engine",
            [(0.38, 1.2), (0.46, 1.02), (0.72, 0.72), (1.02, 0.42), (1.1, 0.36), (1.0, 0.42), (0.68, 0.74), (0.36, 1.1)],
            material="darker",
            segments=28,
            cap_bottom=False,
            cap_top=False,
        )
    )
    parts.append(torus("engine_ring", 1.06, 0.04, (0, 0, 0.38), material="grey", segments=28, sides=6))
    # Fuel tanks on the four straight faces, equipment on two of them.
    for index in range(4):
        angle = index * 90
        a = math.radians(angle)
        parts.append(sphere("tank", 0.62, (2.5 * math.cos(a), 2.5 * math.sin(a), 2.0), material="grey", segments=20, rings=12))
        parts.append(torus("tank_band", 0.625, 0.03, (2.5 * math.cos(a), 2.5 * math.sin(a), 2.0), rot=(90, 0, angle + 90), material="orange", segments=20, sides=6))
        # Small steering thrusters above each tank.
        parts.append(box("rcs", (0.34, 0.3, 0.3), (2.35 * math.cos(a), 2.35 * math.sin(a), 2.98), rot=(0, 0, angle), material="grey", round=0.05))
        for dz, tilt in ((0.0, 90), (0.14, 0)):
            parts.append(cylinder("rcs_nozzle", 0.05, 0.14, (2.56 * math.cos(a), 2.56 * math.sin(a), 2.96 + dz), rot=(0, tilt, angle), material="darker", segments=10, radius2=0.085))

    # Legs: one main strut with a shock sleeve, two braces and a footpad each.
    for index in range(4):
        angle = 45 + index * 90
        a = math.radians(angle)
        cx, cy = math.cos(a), math.sin(a)
        foot = (4.3 * cx, 4.3 * cy, 0.2)
        parts.append(tube("leg", [(2.55 * cx, 2.55 * cy, 2.55), foot], 0.09, material="grey", smooth_path=False))
        parts.append(tube("sleeve", [(2.55 * cx, 2.55 * cy, 2.55), (3.3 * cx, 3.3 * cy, 1.54)], 0.15, material="gold", smooth_path=False))
        for spread in (-24, 24):
            b = math.radians(angle + spread)
            parts.append(tube("brace", [(2.6 * math.cos(b), 2.6 * math.sin(b), 1.35), (3.95 * cx, 3.95 * cy, 0.62)], 0.055, material="grey", smooth_path=False))
        parts.append(lathe("pad", [(0.0, 0.05), (0.5, 0.05), (0.66, 0.16), (0.62, 0.2), (0.45, 0.13), (0.0, 0.13)], loc=(4.3 * cx, 4.3 * cy, 0.0), material="dark", segments=20, cap_bottom=False, cap_top=False))
        parts.append(sphere("pad_joint", 0.14, foot, material="orange", segments=12, rings=8))
        parts.append(sphere("pad_light", 0.09, (4.3 * cx + 0.3 * cx, 4.3 * cy + 0.3 * cy, 0.3), material="glow_green" if index % 2 else "glow_red", segments=10, rings=6))

    # Crew cabin.
    parts.append(lathe("cabin", [(r, CABIN_BASE + z) for r, z in CABIN], material="hull", segments=36, cap_bottom=False, cap_top=False, sharp=None))
    parts.append(torus("cabin_ring", 2.22, 0.14, (0, 0, CABIN_BASE + 0.5), material="orange", segments=40, sides=8))
    for height in (1.2, 2.3, 3.2):
        parts.append(torus("seam", _cabin_radius(height) + 0.004, 0.022, (0, 0, CABIN_BASE + height), material="grey", segments=36, sides=6))
    for index in range(8):
        angle = 22.5 + index * 45
        parts.append(tube("rib", [_on_cabin(angle, h, 0.006) for h in (0.5, 1.1, 1.7, 2.3, 2.9, 3.4)], 0.02, material="grey", sides=6))
    # Top: docking ring, antenna, small dish.
    parts.append(torus("dock", 0.9, 0.12, (0, 0, 6.45), material="grey", segments=28, sides=8))
    parts.append(lathe("dock_cone", [(0.86, 6.3), (0.8, 6.42), (0.55, 6.62), (0.5, 6.66), (0.0, 6.66)], material="dark", segments=24, cap_bottom=False, cap_top=False))
    parts.append(cylinder("antenna", 0.03, 1.5, (0.5, 0.2, 7.2), material="dark", segments=8))
    parts.append(sphere("antenna_tip", 0.07, (0.5, 0.2, 7.98), material="glow_red", segments=10, rings=6))
    parts.append(cylinder("dish_post", 0.04, 0.5, (-0.6, 0.5, 6.7), material="grey", segments=8))
    parts.append(lathe("dish", [(0.0, 0.0), (0.2, 0.025), (0.38, 0.1), (0.5, 0.24), (0.47, 0.235), (0.36, 0.13), (0.19, 0.06), (0.0, 0.04)], loc=(-0.6, 0.5, 6.95), rot=(35, 20, 0), material="hull", segments=24, cap_bottom=False, cap_top=False))

    # Two round windows beside the hatch.
    for angle in (-90 - 42, -90 + 42):
        x, y, z = _on_cabin(angle, 2.25, 0.0)
        parts.append(cylinder("window_frame", 0.42, 0.14, (x, y, z), rot=(66, 0, angle + 90), material="grey", segments=20, round=0.03))
        parts.append(cylinder("window", 0.33, 0.17, (x, y, z), rot=(66, 0, angle + 90), material="window", segments=20, round=0.02))

    # Hatch (faces -Y), porch and ladder.
    parts.append(box("hatch_frame", (1.3, 0.3, 1.7), (0, -2.02, CABIN_BASE + 1.15), material="grey", round=0.12, segments=3))
    parts.append(box("hatch", (1.02, 0.3, 1.42), (0, -2.08, CABIN_BASE + 1.15), material="darker", round=0.1, segments=3))
    parts.append(box("hatch_window", (0.5, 0.06, 0.36), (0, -2.23, CABIN_BASE + 1.5), material="lamp_hatch", round=0.05))
    parts.append(torus("hatch_wheel", 0.17, 0.025, (0, -2.25, CABIN_BASE + 0.95), rot=(90, 0, 0), material="orange", segments=20, sides=6))
    parts.append(box("hatch_lamp", (0.9, 0.1, 0.1), (0, -2.14, CABIN_BASE + 2.12), material="lamp_hatch", round=0.03))
    parts.append(box("porch", (1.5, 1.0, 0.1), (0, -2.75, CABIN_BASE + 0.32), material="grey", round=0.03))
    for side in (-1, 1):
        parts.append(tube("porch_brace", [(side * 0.6, -3.15, CABIN_BASE + 0.28), (side * 0.6, -2.5, CABIN_BASE - 0.5)], 0.035, material="grey", smooth_path=False))
        parts.append(
            tube(
                "rail",
                [(side * 0.7, -2.3, CABIN_BASE + 1.3), (side * 0.7, -3.2, CABIN_BASE + 1.3), (side * 0.7, -3.2, CABIN_BASE + 0.36)],
                0.03,
                material="orange",
                smooth_path=False,
            )
        )
        parts.append(tube("ladder_rail", [(side * 0.32, -3.22, CABIN_BASE + 0.36), (side * 0.32, -3.95, 0.2)], 0.035, material="grey", smooth_path=False))
    steps = 8
    for index in range(steps):
        t = (index + 0.5) / steps
        y = -3.22 + (-3.95 + 3.22) * t
        z = CABIN_BASE + 0.36 + (0.2 - CABIN_BASE - 0.36) * t
        parts.append(tube("ladder_step", [(-0.32, y, z), (0.32, y, z)], 0.028, material="grey", smooth_path=False))

    # Cargo boxes strapped to the descent stage (toward +Y) and a coiled hose.
    parts.append(box("cargo", (1.2, 0.5, 0.7), (0.0, 2.95, 2.0), material="hull", round=0.08))
    parts.append(box("cargo_band", (1.22, 0.52, 0.12), (0.0, 2.95, 2.1), material="orange", round=0.03))
    parts.append(capsule("bottle", 0.16, 0.5, (0.95, 2.9, 2.0), material="grey", segments=14))
    return parts


def build(out_dir):
    reset()
    solid = _solid()
    bake_shadows(solid, reach=1.0, strength=0.95, floor=0.45, ground=0.0)
    paint(solid, PALETTE)
    lander = join(solid, "lander")
    export(out_dir + "/lander.glb", [lander])
    decimate(lander, 0.4)
    export(out_dir + "/lander_low.glb", [lander])
