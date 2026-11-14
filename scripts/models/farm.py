"""
The greenhouse: a glass tunnel on a slab, with planter trays, pink grow lights,
a door at the front and a water tank with its pump on the west side.

The door faces -Y. The ground is Z = 0. About 8.8 m wide and 13.4 m long.
The plants themselves are drawn by the game, because they grow.
"""
from lib import arch, bake_shadows, box, capsule, cylinder, decimate, export, half_disc, half_pipe, join, paint, reset, sphere, torus, tube

PALETTE = {
    "hull": "#f4f0e8",
    "grey": "#aeb6c6",
    "dark": "#3a4260",
    "darker": "#262b40",
    "farm": "#4fd98a",
    "soil": "#5b3a2a",
    "water": "#5fb8ff",
}


def _solid():
    parts = []
    parts.append(box("slab", (8.8, 13.4, 0.5), (0, 0, 0.25), material="grey", round=0.15, segments=3))
    for side in (-1, 1):
        parts.append(box("curb", (0.55, 12.6, 0.75), (side * 3.9, 0, 0.87), material="hull", round=0.12, segments=3))
        for y in (-5.5, -2.75, 0, 2.75, 5.5):
            parts.append(box("curb_clamp", (0.62, 0.3, 0.3), (side * 3.9, y, 1.1), material="dark", round=0.05))
    # Ribs and the ridge beam.
    for index in range(7):
        parts.append(arch("rib", 3.72, -6 + index * 2, 0.5, 0.14, material="hull"))
    parts.append(cylinder("ridge", 0.11, 12.3, (0, 0, 4.22), rot=(90, 0, 0), material="hull", segments=10))
    for side in (-1, 1):
        parts.append(cylinder("purlin", 0.07, 12.3, (side * 2.63, 0, 3.13), rot=(90, 0, 0), material="hull", segments=8))

    # End walls. The front one has the door.
    for y in (-6.1, 6.1):
        parts.append(half_disc("end", 3.74, 0.26, (0, y, 0.5), material="hull", round=0.05))
    parts.append(box("door_frame", (1.9, 0.24, 2.6), (0, -6.22, 1.75), material="grey", round=0.12, segments=3))
    parts.append(box("door", (1.6, 0.26, 2.4), (0, -6.26, 1.7), material="darker", round=0.1, segments=3))
    parts.append(box("door_window", (0.9, 0.06, 0.7), (0, -6.4, 2.2), material="lamp_door", round=0.08))
    parts.append(box("door_handle", (0.08, 0.1, 0.5), (0.55, -6.42, 1.5), material="farm", round=0.03))
    parts.append(box("sign", (3.2, 0.12, 0.26), (0, -6.28, 3.25), material="farm", round=0.05))
    parts.append(box("sign_lamp", (0.9, 0.1, 0.14), (0, -6.32, 3.02), material="lamp_door", round=0.04))
    # Two round fans high in the front wall.
    for side in (-1, 1):
        parts.append(cylinder("fan_ring", 0.42, 0.2, (side * 1.9, -6.24, 2.5), rot=(90, 0, 0), material="grey", segments=20, round=0.03))
        parts.append(cylinder("fan", 0.33, 0.24, (side * 1.9, -6.24, 2.5), rot=(90, 0, 0), material="darker", segments=16))
        for angle in (0, 90):
            parts.append(box("fan_blade", (0.6, 0.04, 0.07), (side * 1.9, -6.37, 2.5), rot=(0, angle, 0), material="grey", round=0.0))
    parts.append(box("step", (2.2, 0.9, 0.2), (0, -6.9, 0.1), material="grey", round=0.05))

    # Planter trays with soil, and drip lines.
    for x in (-2.1, 0.0, 2.1):
        parts.append(box("tray", (1.5, 10.6, 0.56), (x, 0, 0.78), material="dark", round=0.1, segments=3))
        parts.append(box("soil", (1.3, 10.4, 0.1), (x, 0, 1.08), material="soil", round=0.0))
        parts.append(tube("drip", [(x - 0.55, -5.2, 1.2), (x - 0.55, 5.2, 1.2)], 0.03, material="water", smooth_path=False, sides=6))
        for leg_y in (-4.6, 0.0, 4.6):
            parts.append(box("tray_leg", (1.3, 0.2, 0.3), (x, leg_y, 0.6), material="darker", round=0.03))
    # Pink grow lights, the kind real space gardens use.
    for x in (-1.25, 1.25):
        parts.append(box("grow_light", (0.26, 10.9, 0.1), (x, 0, 3.72), material="lamp_grow", round=0.04))
        parts.append(box("light_case", (0.4, 11.0, 0.08), (x, 0, 3.81), material="dark", round=0.02))
        for y in (-4.0, 0.0, 4.0):
            parts.append(cylinder("hanger", 0.02, 0.36, (x, y, 4.0), material="grey", segments=6))

    # Water tank and pump on the west side, with pipes into the wall.
    parts.append(capsule("water_tank", 0.7, 2.2, (-5.05, 3.0, 0.95), rot=(90, 0, 0), material="hull", segments=20))
    for y in (2.2, 3.8):
        parts.append(torus("water_band", 0.72, 0.07, (-5.05, y, 0.95), rot=(90, 0, 0), material="farm", segments=22, sides=6))
    for y in (2.2, 3.8):
        parts.append(box("tank_cradle", (1.3, 0.3, 0.5), (-5.05, y, 0.3), material="grey", round=0.05))
    parts.append(box("pump", (1.2, 1.3, 1.1), (-5.05, -0.2, 0.55), material="grey", round=0.12, segments=3))
    parts.append(box("pump_band", (1.22, 1.32, 0.2), (-5.05, -0.2, 0.95), material="farm", round=0.04))
    parts.append(cylinder("pump_wheel", 0.2, 0.08, (-5.05, -0.9, 0.6), rot=(90, 0, 0), material="dark", segments=14, round=0.02))
    parts.append(sphere("pump_light", 0.07, (-4.7, -0.86, 1.0), material="lamp_door", segments=10, rings=6))
    parts.append(tube("pipe_a", [(-5.05, 1.6, 0.95), (-5.05, 0.9, 0.95), (-5.05, 0.5, 0.8)], 0.09, material="water"))
    parts.append(tube("pipe_b", [(-4.45, -0.2, 0.7), (-4.2, -0.2, 0.7), (-4.15, -0.2, 0.9)], 0.08, material="water", smooth_path=False))
    return parts


def build(out_dir):
    reset()
    solid = _solid()
    glass = half_pipe("shell", 3.64, 11.9, 0.5, material="glass", segments=30)
    bake_shadows(solid, reach=1.2, strength=0.9, floor=0.5, ground=0.0)
    paint(solid, PALETTE)
    farm = join(solid + [glass], "farm")
    export(out_dir + "/farm.glb", [farm])
    decimate(farm, 0.45)
    export(out_dir + "/farm_low.glb", [farm])
