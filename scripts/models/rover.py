"""
The crew rover: a small pressurised cabin on six wheels, with a bubble
windscreen, a folded sampling arm, a roof solar deck and a radio dish.

Faces -Y. Wheels on Z = 0, each its own node (wheel_l0..wheel_r2, front to back) so they can turn. About 4.4 m long, 2.9 m wide, 3.4 m tall with the mast.
"""
import math

from lib import bake_shadows, box, capsule, cylinder, decimate, export, join, lathe, paint, place, reset, set_pivot, sphere, torus, tube

PALETTE = {
    "hull": "#f4f0e8",
    "grey": "#aeb6c6",
    "dark": "#3a4260",
    "darker": "#262b40",
    "orange": "#ff9860",
    "tire": "#2b2e3c",
    "solar": "#27398a",
    "solar_line": "#9fc0ff",
}


def _wheel(x, y, radius=0.62, width=0.5):
    """One wheel with a treaded tyre. Built around the Z axis, then turned so the axle lies along X."""
    side = 1 if x > 0 else -1
    half = width / 2
    parts = [
        lathe(
            "tyre",
            [(radius * 0.6, -half), (radius * 0.92, -half), (radius, -half * 0.7), (radius, half * 0.7), (radius * 0.92, half), (radius * 0.6, half)],
            material="tire",
            segments=28,
            cap_bottom=False,
            cap_top=False,
            sharp=30,
        ),
        lathe(
            "rim",
            [(0.0, half * 0.35), (radius * 0.28, half * 0.4), (radius * 0.36, half * 0.72), (radius * 0.6, half * 0.82), (radius * 0.63, half * 0.6), (radius * 0.63, -half * 0.6), (radius * 0.6, -half * 0.82), (radius * 0.3, -half * 0.5), (0.0, -half * 0.5)][::-1],
            material="grey",
            segments=24,
            cap_bottom=False,
            cap_top=False,
        ),
        cylinder("cap", radius * 0.2, 0.08, (0, 0, half * 0.42), material="orange", segments=16, round=0.015),
    ]
    for index in range(6):
        a = 2 * math.pi * index / 6
        parts.append(cylinder("bolt", 0.03, 0.05, (radius * 0.44 * math.cos(a), radius * 0.44 * math.sin(a), half * 0.74), material="dark", segments=8))
    count = 18
    for index in range(count):
        a = 360.0 * index / count
        rad = math.radians(a)
        shift = half * 0.34 if index % 2 == 0 else -half * 0.34
        parts.append(box("tread", (0.075, 0.13, width * 0.5), ((radius + 0.012) * math.cos(rad), (radius + 0.012) * math.sin(rad), shift), rot=(0, 0, a), material="tire", round=0.012))
    wheel = join(parts, "wheel")
    # Outer face (+Z of the lathe) must point away from the rover.
    place(wheel, rot=(0, 90 if side > 0 else -90, 0))
    return place(wheel, (x, y, radius))


def _solid(wheels):
    """The body parts. Wheels are made too, but kept apart (added to `wheels`), so the game can spin them."""
    parts = []
    # Chassis and suspension.
    parts.append(box("chassis", (1.7, 4.0, 0.34), (0, 0, 0.98), material="dark", round=0.08, segments=3))
    parts.append(box("belly", (1.2, 3.2, 0.2), (0, 0, 0.78), material="darker", round=0.06))
    for side in (-1, 1):
        for index, y in enumerate((-1.4, 0.0, 1.4)):
            wheel = _wheel(side * 1.22, y)
            wheel.name = "wheel_%s%d" % ("l" if side < 0 else "r", index)
            wheel.data.name = wheel.name
            wheels.append((wheel, (side * 1.22, y, 0.62)))
            parts.append(cylinder("axle", 0.07, 0.42, (side * 0.9, y, 0.62), rot=(0, 90, 0), material="grey", segments=12))
        # Rocker arms: the long beam and the short bogie, as on real planetary rovers.
        parts.append(tube("rocker", [(side * 0.93, -1.4, 0.62), (side * 0.93, -0.7, 0.98), (side * 0.93, 0.7, 0.98)], 0.07, material="grey", smooth_path=False))
        parts.append(tube("bogie", [(side * 0.93, 0.0, 0.62), (side * 0.93, 0.7, 0.98), (side * 0.93, 1.4, 0.62)], 0.07, material="grey", smooth_path=False))
        parts.append(cylinder("pivot", 0.12, 0.2, (side * 0.93, 0.7, 0.98), rot=(0, 90, 0), material="orange", segments=14, round=0.02))
        parts.append(cylinder("pivot2", 0.1, 0.2, (side * 0.93, -0.7, 0.98), rot=(0, 90, 0), material="dark", segments=14, round=0.02))
        # Mudguards over the front and rear wheels.
        for y in (-1.4, 1.4):
            parts.append(box("guard", (0.56, 1.0, 0.07), (side * 1.22, y, 1.36), material="orange", round=0.03))
            parts.append(box("guard_lip", (0.56, 0.07, 0.24), (side * 1.22, y + (0.5 if y > 0 else -0.5), 1.27), rot=(28 if y > 0 else -28, 0, 0), material="orange", round=0.03))

    # Cabin: a rounded pressure hull.
    parts.append(box("cabin", (2.0, 2.7, 1.42), (0, 0.42, 1.9), material="hull", round=0.42, segments=5))
    parts.append(box("stripe", (2.02, 2.72, 0.18), (0, 0.42, 1.36), material="orange", round=0.06))
    parts.append(box("skirt", (2.04, 2.74, 0.1), (0, 0.42, 1.2), material="dark", round=0.04))
    # Front cab: where the bubble windscreen sits.
    parts.append(box("nose", (1.8, 1.1, 0.7), (0, -1.25, 1.5), material="hull", round=0.25, segments=4))
    parts.append(torus("screen_frame", 0.86, 0.07, (0, -1.02, 1.98), rot=(62, 0, 0), scale=(1.06, 1.0, 1.0), material="grey", segments=32, sides=8))
    parts.append(box("dash", (1.2, 0.3, 0.14), (0, -1.5, 1.86), rot=(20, 0, 0), material="darker", round=0.04))
    parts.append(box("dash_light", (0.5, 0.02, 0.05), (0, -1.38, 1.95), rot=(20, 0, 0), material="glow_cyan", round=0.0))
    for side in (-1, 1):
        parts.append(box("seat", (0.44, 0.4, 0.62), (side * 0.4, -0.72, 1.86), rot=(-8, 0, 0), material="dark", round=0.1, segments=3))
        # Side windows with frames.
        for y in (0.0, 0.95):
            parts.append(box("window_frame", (0.06, 0.74, 0.56), (side * 1.0, y, 2.1), material="grey", round=0.1, segments=3))
            parts.append(box("window", (0.07, 0.62, 0.44), (side * 1.005, y, 2.1), material="window", round=0.08, segments=3))
        parts.append(box("handrail_post_a", (0.04, 0.04, 0.14), (side * 1.03, 1.45, 1.78), material="grey", round=0.01))
        parts.append(tube("handrail", [(side * 1.07, 1.45, 1.6), (side * 1.07, 1.45, 2.3)], 0.022, material="grey", smooth_path=False))
        # Headlights and tail lights.
        parts.append(cylinder("headlight_ring", 0.15, 0.1, (side * 0.62, -1.82, 1.42), rot=(90, 0, 0), material="grey", segments=18, round=0.02))
        parts.append(cylinder("headlight", 0.115, 0.06, (side * 0.62, -1.86, 1.42), rot=(90, 0, 0), material="lamp_head", segments=16))
        parts.append(box("tail_light", (0.22, 0.04, 0.1), (side * 0.7, 1.78, 1.46), material="glow_red", round=0.02))
        # Side lockers.
        parts.append(box("locker", (0.12, 0.9, 0.36), (side * 1.02, 0.5, 1.52), material="grey", round=0.03))
        parts.append(box("locker_handle", (0.03, 0.2, 0.04), (side * 1.09, 0.5, 1.58), material="dark", round=0.01))

    # Bumper and tow hook.
    parts.append(tube("bumper", [(-0.95, -1.78, 1.12), (-0.8, -1.98, 1.12), (0.8, -1.98, 1.12), (0.95, -1.78, 1.12)], 0.06, material="dark"))
    parts.append(box("plate", (0.5, 0.03, 0.18), (0, -2.0, 1.12), material="hull", round=0.02))
    parts.append(box("plate_mark", (0.3, 0.01, 0.06), (0, -2.02, 1.12), material="orange", round=0.0))

    # Rear: airlock hatch, ladder, two gas tanks.
    parts.append(cylinder("hatch_ring", 0.55, 0.1, (0, 1.78, 1.95), rot=(90, 0, 0), material="grey", segments=24, round=0.025))
    parts.append(cylinder("hatch", 0.46, 0.06, (0, 1.82, 1.95), rot=(90, 0, 0), material="hull", segments=24, round=0.02))
    parts.append(torus("hatch_wheel", 0.16, 0.022, (0, 1.88, 1.95), rot=(90, 0, 0), material="orange", segments=20, sides=6))
    parts.append(box("hatch_bar", (0.34, 0.03, 0.03), (0, 1.88, 1.95), material="orange", round=0.01))
    for side in (-1, 1):
        parts.append(capsule("tank", 0.16, 0.7, (side * 0.72, 1.86, 1.9), material="grey", segments=16))
        parts.append(torus("tank_band", 0.163, 0.018, (side * 0.72, 1.86, 2.05), material="orange", segments=16, sides=6))
        parts.append(tube("ladder_rail", [(side * 0.22, 1.98, 0.5), (side * 0.22, 1.98, 1.4)], 0.025, material="grey", smooth_path=False))
    for index in range(4):
        parts.append(tube("ladder_step", [(-0.22, 1.98, 0.6 + index * 0.24), (0.22, 1.98, 0.6 + index * 0.24)], 0.02, material="grey", smooth_path=False))

    # Roof: solar deck, light bar, radio mast with a dish, a camera head.
    parts.append(box("deck", (1.56, 1.7, 0.07), (0, 0.72, 2.66), material="grey", round=0.025))
    parts.append(box("solar", (1.44, 1.58, 0.03), (0, 0.72, 2.71), material="solar", round=0.0))
    for index in range(1, 4):
        parts.append(box("solar_line_x", (0.012, 1.58, 0.008), (-0.72 + index * 0.36, 0.72, 2.728), material="solar_line", round=0.0))
    for index in range(1, 5):
        parts.append(box("solar_line_y", (1.44, 0.012, 0.008), (0, -0.07 + index * 0.316, 2.728), material="solar_line", round=0.0))
    parts.append(box("light_bar", (1.3, 0.12, 0.1), (0, -0.74, 2.66), material="dark", round=0.03))
    for index in range(4):
        parts.append(cylinder("bar_lamp", 0.07, 0.05, (-0.48 + index * 0.32, -0.81, 2.66), rot=(90, 0, 0), material="lamp_head", segments=12))
    parts.append(cylinder("mast", 0.035, 0.9, (-0.72, 1.5, 3.05), material="grey", segments=10))
    parts.append(lathe("dish", [(0.0, 0.0), (0.16, 0.02), (0.3, 0.08), (0.38, 0.17), (0.4, 0.2), (0.37, 0.19), (0.29, 0.11), (0.15, 0.05), (0.0, 0.035)], loc=(-0.72, 1.5, 3.42), rot=(-35, 0, 20), material="hull", segments=24, cap_bottom=False, cap_top=False))
    parts.append(cylinder("dish_feed", 0.015, 0.3, (-0.68, 1.39, 3.6), rot=(-35, 0, 20), material="dark", segments=6))
    parts.append(sphere("mast_tip", 0.04, (-0.72, 1.5, 3.52), material="glow_red", segments=8, rings=6))
    parts.append(cylinder("cam_post", 0.03, 0.45, (0.74, -0.5, 2.85), material="grey", segments=8))
    parts.append(box("cam_head", (0.3, 0.16, 0.14), (0.74, -0.5, 3.12), material="hull", round=0.04))
    for dx in (-0.08, 0.08):
        parts.append(cylinder("cam_eye", 0.045, 0.04, (0.74 + dx, -0.59, 3.12), rot=(90, 0, 0), material="darker", segments=12))

    # Sampling arm, folded along the left side of the nose.
    parts.append(cylinder("arm_base", 0.12, 0.16, (-0.98, -1.2, 1.3), rot=(0, 90, 0), material="grey", segments=14, round=0.02))
    parts.append(tube("arm_upper", [(-1.08, -1.2, 1.3), (-1.08, -1.75, 1.75)], 0.055, material="hull", smooth_path=False))
    parts.append(cylinder("arm_elbow", 0.085, 0.16, (-1.08, -1.75, 1.75), rot=(0, 90, 0), material="orange", segments=14, round=0.02))
    parts.append(tube("arm_lower", [(-1.08, -1.75, 1.75), (-1.08, -2.15, 1.3)], 0.045, material="hull", smooth_path=False))
    parts.append(box("arm_hand", (0.14, 0.14, 0.2), (-1.08, -2.2, 1.2), rot=(-40, 0, 0), material="grey", round=0.03))
    for dx in (-0.045, 0.045):
        parts.append(box("arm_claw", (0.03, 0.05, 0.16), (-1.08 + dx, -2.27, 1.07), rot=(-40, 0, 0), material="dark", round=0.01))
    return parts


def build(out_dir):
    reset()
    wheels = []
    solid = _solid(wheels)
    glass = sphere("screen", 0.84, (0, -1.02, 1.98), scale=(1.06, 0.9, 0.86), material="glass", segments=32, rings=18)
    spinners = [wheel for wheel, _ in wheels]
    bake_shadows(solid + spinners, reach=0.6, strength=0.95, floor=0.45, ground=0.0)
    paint(solid + spinners, PALETTE)
    rover = join(solid + [glass], "rover")
    # Each wheel turns about its own centre: the game spins and steers them by name (wheel_l0 .. wheel_r2).
    for wheel, pivot in wheels:
        set_pivot(wheel, pivot)
    objects = [rover] + spinners
    export(out_dir + "/rover.glb", objects)
    decimate(rover, 0.35)
    for wheel in spinners:
        decimate(wheel, 0.5)
    export(out_dir + "/rover_low.glb", objects)
