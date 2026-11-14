"""
The laboratory: a pressure module on cradles with round windows, an entry at the
front, a weather mast, and the big radio dish on the roof.

The door faces -Y. The ground is Z = 0. The dish is its own part ("dish") with its
pivot at the mount, so the game can turn it.
"""
import math

from lib import bake_shadows, box, capsule, cylinder, decimate, export, join, lathe, paint, place, reset, set_pivot, sphere, torus, tube

PALETTE = {
    "hull": "#f4f0e8",
    "grey": "#aeb6c6",
    "dark": "#3a4260",
    "darker": "#262b40",
    "lab": "#a987ff",
}

MOUNT = (0.0, 1.4, 6.55)


def _module():
    parts = []
    parts.append(capsule("module", 2.7, 6.5, (0, 0, 3.35), rot=(90, 0, 0), material="hull", segments=32, rings=14))
    for y in (-2.7, 2.7):
        parts.append(torus("ring", 2.74, 0.14, (0, y, 3.35), rot=(90, 0, 0), material="lab", segments=44, sides=8))
        parts.append(box("cradle", (4.8, 0.9, 1.0), (0, y, 0.8), material="grey", round=0.15, segments=3))
        for side in (-1, 1):
            parts.append(box("leg", (0.55, 0.55, 1.3), (side * 2.0, y, 0.65), material="dark", round=0.08))
            parts.append(box("leg_pad", (0.9, 0.9, 0.14), (side * 2.0, y, 0.07), material="grey", round=0.04))
    for y in (-0.9, 0.9):
        parts.append(torus("seam", 2.705, 0.035, (0, y, 3.35), rot=(90, 0, 0), material="grey", segments=44, sides=6))
    # A walkway rail along the top.
    parts.append(tube("top_rail", [(0, -2.6, 6.12), (0, 0.0, 6.12)], 0.05, material="grey", smooth_path=False))

    # Round windows on both sides.
    for side in (-1, 1):
        for y in (-1.5, 0.0, 1.5):
            parts.append(cylinder("window", 0.5, 0.16, (side * 2.6, y, 3.9), rot=(0, 90, 0), material="lamp_window", segments=22, round=0.03))
            parts.append(torus("window_ring", 0.54, 0.1, (side * 2.62, y, 3.9), rot=(0, 90, 0), material="dark", segments=24, sides=8))
        # A long equipment box under the windows.
        parts.append(box("locker", (0.3, 3.6, 0.6), (side * 2.42, 0, 2.2), material="grey", round=0.08))
        for y in (-1.2, 0.0, 1.2):
            parts.append(box("locker_handle", (0.06, 0.3, 0.08), (side * 2.6, y, 2.3), material="dark", round=0.02))

    # Entry: collar, door, light bar and stairs.
    parts.append(cylinder("entry", 1.25, 1.1, (0, -5.9, 2.5), rot=(90, 0, 0), material="hull", segments=28))
    parts.append(torus("entry_ring", 1.26, 0.15, (0, -6.46, 2.5), rot=(90, 0, 0), material="lab", segments=32, sides=8))
    parts.append(cylinder("door", 1.08, 0.12, (0, -6.44, 2.5), rot=(90, 0, 0), material="darker", segments=28, round=0.03))
    parts.append(cylinder("door_window", 0.34, 0.16, (0, -6.46, 2.85), rot=(90, 0, 0), material="lamp_window", segments=18, round=0.02))
    parts.append(torus("door_wheel", 0.24, 0.035, (0, -6.55, 2.1), rot=(90, 0, 0), material="lab", segments=20, sides=6))
    parts.append(box("door_light", (1.2, 0.1, 0.14), (0, -6.3, 3.95), material="lamp_violet", round=0.04))
    for index in range(4):
        parts.append(box("stair", (1.7, 0.55, 0.28), (0, -7.0 - index * 0.5, 1.3 - index * 0.36), material="grey", round=0.06))
    for side in (-1, 1):
        parts.append(tube("stair_rail", [(side * 0.9, -6.6, 2.4), (side * 0.9, -8.7, 0.95), (side * 0.9, -8.7, 0.1)], 0.04, material="lab", smooth_path=False))

    # Roof platform for the dish, and a weather mast.
    parts.append(box("platform", (1.9, 2.3, 0.45), (0, 1.4, 6.2), material="grey", round=0.1))
    parts.append(cylinder("mount", 0.34, 0.5, (0, 1.4, 6.5), material="dark", segments=16, radius2=0.26, round=0.03))
    parts.append(cylinder("mast", 0.05, 2.4, (0, -2.6, 7.2), material="dark", segments=10, radius2=0.07))
    parts.append(box("vane", (0.5, 0.18, 0.18), (0, -2.6, 8.2), material="hull", round=0.05))
    parts.append(sphere("mast_lamp", 0.12, (0, -2.6, 8.45), material="lamp_violet", segments=10, rings=8))
    for index in range(3):
        a = math.radians(index * 120)
        parts.append(tube("cup_arm", [(0, -2.6, 7.7), (0.42 * math.cos(a), -2.6 + 0.42 * math.sin(a), 7.7)], 0.02, material="grey", smooth_path=False, sides=6))
        parts.append(sphere("cup", 0.09, (0.42 * math.cos(a), -2.6 + 0.42 * math.sin(a), 7.7), material="lab", segments=10, rings=6))
    return parts


def _dish():
    """The radio dish, built pointing straight up around the origin, then tilted back and moved to the mount."""
    parts = []
    front = [(r, 0.11 * r * r) for r in [i * 0.27 for i in range(11)]]
    back = [(r, 0.11 * r * r - 0.09) for r in [i * 0.27 for i in range(10, -1, -1)]]
    outline = back[::-1][:1] + [(r, z) for r, z in back[::-1][1:]]
    # Go up the back of the bowl, over the rim, and down the front.
    profile = [(r, z) for r, z in outline] + [(2.74, 0.11 * 2.7 * 2.7 - 0.03)] + front[::-1]
    parts.append(lathe("bowl", profile, loc=(0, 0, 0.6), material="hull", segments=40, cap_bottom=False, cap_top=False))
    parts.append(torus("rim", 2.7, 0.09, (0, 0, 0.6 + 0.11 * 2.7 * 2.7), material="lab", segments=48, sides=8))
    parts.append(cylinder("neck", 0.24, 0.8, (0, 0, 0.2), material="grey", segments=14, radius2=0.34))
    for index in range(6):
        a = math.radians(index * 60)
        parts.append(tube("back_rib", [(0.3 * math.cos(a), 0.3 * math.sin(a), 0.5), (1.5 * math.cos(a), 1.5 * math.sin(a), 0.6 + 0.11 * 2.25 - 0.1), (2.6 * math.cos(a), 2.6 * math.sin(a), 0.6 + 0.11 * 6.76 - 0.1)], 0.04, material="grey", sides=6))
    for index in range(3):
        a = math.radians(index * 120 + 30)
        parts.append(tube("strut", [(1.9 * math.cos(a), 1.9 * math.sin(a), 0.6 + 0.11 * 3.61), (0.16 * math.cos(a), 0.16 * math.sin(a), 2.72)], 0.035, material="dark", smooth_path=False, sides=6))
    parts.append(cylinder("feed", 0.2, 0.4, (0, 0, 2.75), material="grey", segments=12, radius2=0.26))
    parts.append(sphere("feed_lamp", 0.17, (0, 0, 2.5), material="lamp_violet", segments=12, rings=8))
    return parts


def build(out_dir):
    reset()
    module_parts = _module()
    dish_parts = _dish()
    for part in dish_parts:
        place(part, rot=(-43, 0, 0))
        place(part, MOUNT)
    solid = module_parts + dish_parts
    bake_shadows(solid, reach=1.3, strength=0.9, floor=0.5, ground=0.0)
    paint(solid, PALETTE)
    lab = join(module_parts, "lab")
    dish = set_pivot(join(dish_parts, "dish"), MOUNT)
    export(out_dir + "/lab.glb", [lab, dish])
    decimate(lab, 0.45)
    decimate(dish, 0.5)
    export(out_dir + "/lab_low.glb", [lab, dish])
