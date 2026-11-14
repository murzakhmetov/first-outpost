"""
The habitat: an inflatable dome on a ring base, with a window band, a roof cupola,
radiators, a radio mast, water and oxygen tanks, and the airlock tunnel in front.

The airlock faces -Y. The ground is Z = 0. The dome is about 12.8 m across.
Lamps keep their own material names so the game can dim them with the power level.
"""
import math

from lib import bake_shadows, box, capsule, cylinder, decimate, export, join, lathe, paint, partial_sphere, reset, sphere, torus, tube

PALETTE = {
    "hull": "#f4f0e8",
    "grey": "#aeb6c6",
    "dark": "#3a4260",
    "darker": "#262b40",
    "life": "#39c2f0",
}

RADIUS = 6.4
SQUASH = 0.78
BASE = 0.9


def _dome(theta_deg, phi_deg, out=0.0):
    """A point on the dome. theta: 0 = top, 90 = rim. phi: compass angle, -90 = the airlock side."""
    theta = math.radians(theta_deg)
    phi = math.radians(phi_deg)
    r = (RADIUS + out) * math.sin(theta)
    return (r * math.cos(phi), r * math.sin(phi), BASE + (RADIUS + out) * SQUASH * math.cos(theta))


def _solid():
    parts = []
    # Ring base and the dome skin.
    parts.append(lathe("base", [(7.05, 0.0), (7.05, 0.28), (6.92, 0.4), (6.8, 0.9), (6.4, 0.94)], material="grey", segments=56, cap_bottom=False, cap_top=False))
    profile = [(RADIUS * math.sin(math.radians(t)), BASE + RADIUS * SQUASH * math.cos(math.radians(t))) for t in range(90, -1, -6)]
    profile[-1] = (0.0, BASE + RADIUS * SQUASH)
    parts.append(lathe("dome", profile, material="hull", segments=56, cap_bottom=False, cap_top=False, sharp=None))
    parts.append(torus("band", 6.38, 0.17, (0, 0, 1.3), material="life", segments=64, sides=8))
    # The skin is made of panels: ribs run up the dome, seams run around it.
    for index in range(12):
        phi = 15 + index * 30
        parts.append(tube("rib", [_dome(t, phi, 0.02) for t in (86, 74, 62, 50, 38, 26, 15)], 0.055, material="grey", sides=6))
    for theta in (47, 27):
        point = _dome(theta, 0, 0.02)
        parts.append(torus("seam", point[0], 0.045, (0, 0, point[2]), material="grey", segments=56, sides=6))
    for index in range(14):
        a = math.radians(index * 360 / 14 + 8)
        parts.append(box("foot", (0.5, 0.34, 0.3), (7.0 * math.cos(a), 7.0 * math.sin(a), 0.15), rot=(0, 0, math.degrees(a) + 90), material="dark", round=0.05))

    # A band of windows. None on the airlock side.
    for phi in range(0, 360, 24):
        if -124 < phi - 360 < -56:
            continue
        x, y, z = _dome(62, phi, -0.02)
        turn = phi - 90
        parts.append(box("window_frame", (1.56, 0.26, 1.14), (x, y, z), rot=(30, 0, turn), material="dark", round=0.12, segments=3))
        x, y, z = _dome(62, phi, 0.04)
        parts.append(box("window", (1.2, 0.3, 0.78), (x, y, z), rot=(30, 0, turn), material="lamp_warm", round=0.1, segments=3))
        x, y, z = _dome(56.5, phi, 0.12)
        parts.append(box("window_hood", (1.6, 0.3, 0.1), (x, y, z), rot=(30, 0, turn), material="hull", round=0.04))

    # Roof: hatch ring, cupola frame, mast with a beacon, two radiators, a small dish.
    top = BASE + RADIUS * SQUASH
    parts.append(lathe("hatch", [(1.62, top - 0.24), (1.6, top - 0.02), (1.34, top + 0.26), (1.14, top + 0.26)], material="grey", segments=32, cap_bottom=False, cap_top=False))
    parts.append(torus("cupola_ring", 1.13, 0.06, (0, 0, top + 0.27), material="dark", segments=32, sides=6))
    for index in range(4):
        a = math.radians(45 + index * 90)
        parts.append(tube("cupola_rib", [(1.12 * math.cos(a) * math.cos(math.radians(e)), 1.12 * math.sin(a) * math.cos(math.radians(e)), top + 0.27 + 1.12 * math.sin(math.radians(e))) for e in (0, 22, 45, 68, 90)], 0.035, material="dark", sides=6))
    parts.append(cylinder("mast", 0.05, 3.0, (-1.9, 0, top + 1.2), material="dark", segments=10, radius2=0.07))
    parts.append(sphere("beacon", 0.16, (-1.9, 0, top + 2.8), material="glow_red", segments=12, rings=8))
    for dz, width in ((1.6, 0.9), (2.1, 0.6)):
        parts.append(tube("mast_bar", [(-1.9 - width / 2, 0, top + dz), (-1.9 + width / 2, 0, top + dz)], 0.025, material="dark", smooth_path=False))
    for side in (-1, 1):
        parts.append(cylinder("radiator_post", 0.06, 1.3, (side * 0.9, 2.2, top + 0.35), rot=(-28, 0, 0), material="dark", segments=8))
        parts.append(box("radiator", (0.1, 2.6, 1.5), (side * 0.9, 2.75, top + 1.3), rot=(-10, side * 7, 0), material="hull", round=0.04))
        for index in range(5):
            parts.append(box("radiator_rib", (0.13, 0.05, 1.4), (side * 0.9, 1.75 + index * 0.5, top + 1.3), rot=(-10, side * 7, 0), material="grey", round=0.0))
    parts.append(cylinder("dish_post", 0.05, 0.9, (2.0, 0.6, top + 0.2), material="grey", segments=8))
    parts.append(lathe("dish", [(0.0, 0.0), (0.3, 0.035), (0.55, 0.13), (0.7, 0.3), (0.66, 0.29), (0.5, 0.17), (0.28, 0.08), (0.0, 0.05)], loc=(2.0, 0.6, top + 0.7), rot=(40, 0, -30), material="hull", segments=24, cap_bottom=False, cap_top=False))

    # A service ladder up the west side of the dome.
    for offset in (-2.2, 2.2):
        parts.append(tube("ladder_rail", [_dome(t, 180 + offset, 0.16) for t in (88, 76, 64, 52, 40, 28)], 0.04, material="grey", sides=6))
    for theta in range(86, 28, -5):
        parts.append(tube("ladder_step", [_dome(theta, 180 - 2.2, 0.16), _dome(theta, 180 + 2.2, 0.16)], 0.03, material="grey", smooth_path=False, sides=6))

    # Airlock tunnel, door and porch.
    parts.append(cylinder("tunnel", 1.55, 3.7, (0, -7.55, 1.75), rot=(90, 0, 0), material="hull", segments=32))
    for y, tube_radius, material in ((-9.4, 0.2, "life"), (-7.2, 0.12, "life"), (-8.3, 0.06, "grey")):
        parts.append(torus("tunnel_ring", 1.56, tube_radius, (0, y, 1.75), rot=(90, 0, 0), material=material, segments=36, sides=8))
    parts.append(cylinder("door", 1.36, 0.14, (0, -9.38, 1.75), rot=(90, 0, 0), material="darker", segments=32, round=0.03))
    parts.append(cylinder("door_window", 0.42, 0.18, (0, -9.42, 2.2), rot=(90, 0, 0), material="lamp_warm", segments=20, round=0.03))
    parts.append(torus("door_window_ring", 0.44, 0.05, (0, -9.5, 2.2), rot=(90, 0, 0), material="grey", segments=24, sides=6))
    parts.append(torus("door_wheel", 0.3, 0.04, (0, -9.5, 1.3), rot=(90, 0, 0), material="life", segments=24, sides=6))
    for angle in (0, 60, 120):
        a = math.radians(angle)
        parts.append(tube("door_spoke", [(-0.3 * math.cos(a), -9.5, 1.3 - 0.3 * math.sin(a)), (0.3 * math.cos(a), -9.5, 1.3 + 0.3 * math.sin(a))], 0.025, material="life", smooth_path=False, sides=6))
    for index in range(10):
        a = math.radians(index * 36)
        parts.append(cylinder("door_bolt", 0.06, 0.08, (1.2 * math.cos(a), -9.46, 1.75 + 1.2 * math.sin(a)), rot=(90, 0, 0), material="grey", segments=8))
    parts.append(box("door_sign", (1.7, 0.12, 0.16), (0, -9.46, 3.55), material="lamp_cyan", round=0.05))
    parts.append(box("porch", (4.2, 2.8, 0.36), (0, -10.7, 0.18), material="grey", round=0.1))
    parts.append(box("porch_mat", (2.2, 1.6, 0.05), (0, -10.6, 0.38), material="dark", round=0.02))
    for side in (-1, 1):
        parts.append(cylinder("porch_post", 0.07, 2.7, (side * 1.95, -11.7, 1.35), material="dark", segments=10, radius2=0.09))
        parts.append(sphere("porch_lamp", 0.24, (side * 1.95, -11.7, 2.8), material="lamp_warm", segments=14, rings=10))
        parts.append(tube("porch_rail", [(side * 1.95, -11.7, 1.3), (side * 1.95, -9.7, 1.3), (side * 1.75, -9.5, 1.3)], 0.04, material="life", smooth_path=False))
        parts.append(cylinder("rail_post", 0.035, 0.95, (side * 1.95, -10.6, 0.83), material="dark", segments=8))
        # Water and oxygen tanks beside the airlock.
        parts.append(cylinder("tank_base", 0.95, 0.3, (side * 3.6, -6.5, 0.15), material="grey", segments=20, radius2=1.0, round=0.04))
        parts.append(capsule("tank", 0.82, 1.9, (side * 3.6, -6.5, 2.07), material="hull", segments=24))
        for z in (1.45, 2.7):
            parts.append(torus("tank_band", 0.84, 0.08, (side * 3.6, -6.5, z), material="life", segments=24, sides=6))
        parts.append(tube("tank_pipe", [(side * 3.6, -6.5, 3.75), (side * 3.3, -5.9, 4.3), (side * 2.6, -5.0, 4.1)], 0.1, material="dark"))
        parts.append(torus("tank_valve", 0.16, 0.03, (side * 3.6, -7.38, 1.9), rot=(90, 0, 0), material="life", segments=16, sides=6))
        parts.append(cylinder("tank_gauge", 0.12, 0.06, (side * 3.6, -7.34, 2.4), rot=(90, 0, 0), material="dark", segments=14))
        parts.append(cylinder("tank_gauge_light", 0.07, 0.04, (side * 3.6, -7.38, 2.4), rot=(90, 0, 0), material="lamp_cyan", segments=12))
    return parts


def build(out_dir):
    reset()
    solid = _solid()
    top = BASE + RADIUS * SQUASH
    glass = partial_sphere("cupola", 1.12, loc=(0, 0, top + 0.27), material="glass", segments=24, rings=14, plane=((0, 0, 0), (0, 0, 1)))
    bake_shadows(solid, reach=1.4, strength=0.9, floor=0.5, ground=0.0)
    paint(solid, PALETTE)
    hab = join(solid + [glass], "hab")
    export(out_dir + "/hab.glb", [hab])
    decimate(hab, 0.42)
    export(out_dir + "/hab_low.glb", [hab])
