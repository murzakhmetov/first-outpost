"""
The cadet: a young astronaut in a soft suit with a clear helmet.

Built as rigid parts with pivots (hips, neck, shoulders, elbows, knees) so the
game can animate it in code. Faces -Y. Feet on Z = 0. About 1.86 m tall.
"""
import math

from lib import (
    bake_shadows,
    box,
    capsule,
    cylinder,
    decimate,
    empty,
    export,
    join,
    lathe,
    paint,
    parent,
    partial_sphere,
    patch,
    place,
    reset,
    set_pivot,
    sphere,
    torus,
    tube,
)

# Flat colours that are baked into the model. The accent colour, skin and hair stay separate
# materials because the game changes or shades them differently.
PALETTE = {"suit": "#f4f1ec", "grey": "#b4bccb", "dark": "#353c58"}

HEAD_RADIUS = 0.232
BUBBLE_RADIUS = 0.372
HEAD = (0.0, -0.015, 1.515)
HELMET = (0.0, 0.0, 1.535)


def _white(obj):
    """Parts that must not be darkened (glass, the painted face)."""
    mesh = obj.data
    attribute = mesh.color_attributes.get("Col") or mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for item in attribute.data:
        item.color = (1.0, 1.0, 1.0, 1.0)
    return obj


def _torso():
    parts = []
    body = lathe(
        "body",
        [(0.0, 0.56), (0.15, 0.565), (0.215, 0.6), (0.24, 0.68), (0.232, 0.8), (0.245, 0.93), (0.262, 1.03), (0.245, 1.12), (0.19, 1.185), (0.12, 1.215), (0.0, 1.22)],
        material="suit",
        segments=32,
        cap_bottom=False,
        cap_top=False,
        sharp=None,
    )
    parts.append(place(body, scale=(1.0, 0.8, 1.0)))
    hips = lathe("hips", [(0.0, 0.47), (0.14, 0.475), (0.215, 0.52), (0.238, 0.59), (0.22, 0.66)], material="suit", segments=32, cap_bottom=False, cap_top=False, sharp=None)
    parts.append(place(hips, scale=(1.0, 0.8, 1.0)))
    # Chest seam: a thin raised line where the suit closes.
    seam = lathe("seam", [(0.249, 0.855), (0.257, 0.862), (0.257, 0.874), (0.249, 0.881)], material="grey", segments=32, cap_bottom=False, cap_top=False)
    parts.append(place(seam, scale=(1.0, 0.8, 1.0)))

    belt = lathe("belt", [(0.236, 0.618), (0.262, 0.628), (0.264, 0.69), (0.238, 0.7)], material="accent", segments=32, cap_bottom=False, cap_top=False)
    parts.append(place(belt, scale=(1.0, 0.8, 1.0)))
    parts.append(box("buckle", (0.09, 0.03, 0.065), (0, -0.212, 0.655), material="grey", round=0.012))
    parts.append(box("buckle_light", (0.04, 0.01, 0.02), (0, -0.23, 0.655), material="glow_cyan", round=0.004))
    for side in (-1, 1):
        parts.append(box("pouch", (0.085, 0.05, 0.085), (side * 0.165, -0.168, 0.63), rot=(0, 0, side * 28), material="suit", round=0.018))
        parts.append(box("pouch_flap", (0.09, 0.054, 0.03), (side * 0.165, -0.17, 0.665), rot=(0, 0, side * 28), material="accent", round=0.012))

    # Chest control unit.
    parts.append(box("chest", (0.27, 0.09, 0.17), (0, -0.215, 0.985), material="grey", round=0.022, segments=3))
    parts.append(box("screen", (0.105, 0.012, 0.072), (-0.062, -0.262, 1.0), material="dark", round=0.006))
    for index in range(3):
        parts.append(box("screen_line", (0.07 - index * 0.016, 0.004, 0.008), (-0.062 - index * 0.008, -0.2695, 1.02 - index * 0.02), material="glow_cyan", round=0.0))
    parts.append(cylinder("button_a", 0.016, 0.02, (0.04, -0.262, 1.022), rot=(90, 0, 0), material="glow_cyan", segments=14))
    parts.append(cylinder("button_b", 0.016, 0.02, (0.088, -0.262, 1.022), rot=(90, 0, 0), material="glow_green", segments=14))
    parts.append(cylinder("dial", 0.027, 0.022, (0.064, -0.262, 0.955), rot=(90, 0, 0), material="dark", segments=16, round=0.005))
    parts.append(box("dial_mark", (0.008, 0.006, 0.026), (0.064, -0.275, 0.962), material="accent", round=0.0))

    for side in (-1, 1):
        parts.append(
            tube(
                "strap",
                [(side * 0.105, -0.2, 1.055), (side * 0.14, -0.15, 1.165), (side * 0.15, 0.0, 1.228), (side * 0.14, 0.15, 1.165), (side * 0.12, 0.2, 1.08)],
                0.022,
                material="dark",
            )
        )
    parts.append(tube("hose", [(0.135, -0.2, 0.935), (0.25, -0.14, 0.9), (0.3, 0.04, 0.86), (0.24, 0.2, 0.83), (0.16, 0.25, 0.82)], 0.021, material="grey"))
    parts.append(torus("hose_ring", 0.024, 0.009, (0.139, -0.2, 0.935), rot=(0, 90, 20), material="accent", segments=14, sides=6))

    # Life-support backpack.
    parts.append(box("pack", (0.44, 0.2, 0.56), (0, 0.265, 0.99), material="suit", round=0.06, segments=4))
    parts.append(box("pack_stripe", (0.452, 0.212, 0.07), (0, 0.267, 1.16), material="accent", round=0.02))
    parts.append(box("pack_plate", (0.26, 0.02, 0.2), (0, 0.366, 0.93), material="grey", round=0.008))
    for index in range(3):
        parts.append(box("vent", (0.2, 0.012, 0.022), (0, 0.378, 0.875 + index * 0.05), material="dark", round=0.004))
    for side in (-1, 1):
        parts.append(capsule("tank", 0.06, 0.3, (side * 0.245, 0.27, 0.95), material="grey", segments=18))
        parts.append(cylinder("tank_cap", 0.046, 0.04, (side * 0.245, 0.27, 1.175), material="accent", segments=16, round=0.008))
        parts.append(torus("tank_band", 0.061, 0.008, (side * 0.245, 0.27, 0.95), material="dark", segments=18, sides=6))
        parts.append(cylinder("thruster", 0.03, 0.055, (side * 0.15, 0.3, 0.695), material="dark", segments=14, radius2=0.046))
    parts.append(sphere("pack_lamp", 0.03, (0.13, 0.368, 1.2), material="glow_green", segments=12, rings=8))
    parts.append(cylinder("antenna", 0.008, 0.44, (-0.16, 0.3, 1.47), material="dark", segments=8))
    parts.append(cylinder("antenna_base", 0.022, 0.04, (-0.16, 0.3, 1.27), material="grey", segments=12, round=0.005))
    parts.append(sphere("antenna_tip", 0.022, (-0.16, 0.3, 1.7), material="glow_warm", segments=10, rings=6))
    return parts


def _head():
    solid = []
    clear = []
    hx, hy, hz = HEAD
    cx, cy, cz = HELMET
    R = HEAD_RADIUS
    B = BUBBLE_RADIUS

    solid.append(sphere("skull", R, HEAD, scale=(1.0, 0.96, 1.03), material="skin", segments=28, rings=16))
    solid.append(cylinder("neck", 0.075, 0.14, (0, 0.0, 1.3), material="skin", segments=14))
    # Hair: a cap over the top and back, a fringe that leaves the eyes clear, and one stubborn tuft.
    hair = partial_sphere("hair", R + 0.014, lambda p: not (p.y < -R * 0.2 and p.z < R * 0.52), HEAD, material="hair", segments=28, rings=16)
    solid.append(hair)
    # The fringe: one smooth shell over the forehead whose lower edge is cut into pointed locks.
    def fringe_keep(p):
        if p.y > -R * 0.12:
            return False
        around = math.atan2(p.x, -p.y)  # 0 = straight ahead
        if abs(around) > math.radians(80):
            return False
        lock = abs(math.sin(around * 3.4 + 0.5))  # 0 at the gaps between locks, 1 at their tips
        lower = R * (0.5 - 0.2 * lock)
        return lower < p.z < R * 0.99

    fringe = partial_sphere("fringe", R + 0.03, fringe_keep, HEAD, material="hair", segments=72, rings=44, thickness=0.014)
    solid.append(fringe)
    for side in (-1, 1):
        solid.append(sphere("lock", R * 0.3, (hx + side * R * 0.96, hy - R * 0.2, hz - R * 0.05), scale=(0.45, 0.85, 1.9), rot=(0, side * -8, 0), material="hair", segments=12, rings=8))
    top = hz + R
    solid.append(tube("tuft", [(0.0, 0.02, top - 0.01), (0.015, -0.01, top + 0.055), (0.05, -0.05, top + 0.07), (0.09, -0.065, top + 0.04)], 0.013, material="hair", sides=8))

    face = patch("face", R + 0.0025, lon=(-52, 52), lat=(-50, 34), material="face", steps=14)
    clear.append(_white(place(face, HEAD, scale=(1.0, 0.96, 1.03))))

    # Helmet: clear bubble in front, hard shell over the top and back.
    clear.append(_white(sphere("bubble", B, HELMET, material="visor", segments=36, rings=20)))
    S = B + 0.012
    shell = partial_sphere("shell", S, loc=HELMET, material="suit", segments=36, rings=20, thickness=0.024, plane=((0, 0.05, 0), (0, 1, 0.32)))
    solid.append(shell)
    norm = math.hypot(1.0, 0.32)
    offset = 0.05 / norm
    ring_radius = math.sqrt(S**2 - offset**2)
    solid.append(torus("rim", ring_radius, 0.028, (cx, cy + offset / norm, cz + offset * 0.32 / norm), rot=(-72.26, 0, 0), material="accent", segments=40, sides=10))
    for side in (-1, 1):
        solid.append(cylinder("ear", 0.092, 0.065, (side * (B + 0.0), 0.035, cz - 0.01), rot=(0, 90, 0), material="accent", segments=20, round=0.014))
        solid.append(cylinder("ear_core", 0.054, 0.085, (side * (B + 0.0), 0.035, cz - 0.01), rot=(0, 90, 0), material="grey", segments=16, round=0.01))
        solid.append(sphere("ear_lamp", 0.02, (side * (B + 0.045), 0.035, cz - 0.01), material="glow_cyan", segments=10, rings=6))
    solid.append(box("crest", (0.13, 0.11, 0.04), (0, 0.02, cz + S - 0.004), rot=(-8, 0, 0), material="grey", round=0.014))
    solid.append(box("crest_lamp", (0.075, 0.02, 0.022), (0, -0.04, cz + S + 0.001), rot=(-8, 0, 0), material="glow_warm", round=0.006))
    solid.append(box("stripe", (0.05, 0.32, 0.012), (0, S * 0.55, cz + S * 0.83), rot=(-33, 0, 0), material="accent", round=0.004))

    collar = lathe("collar", [(0.185, 1.195), (0.228, 1.2), (0.24, 1.238), (0.228, 1.276), (0.185, 1.283)], material="grey", segments=32, cap_bottom=False, cap_top=False)
    solid.append(collar)
    for index in range(4):
        a = math.radians(45 + index * 90)
        solid.append(box("latch", (0.05, 0.026, 0.05), (0.236 * math.cos(a), 0.236 * math.sin(a), 1.238), rot=(0, 0, 45 + index * 90 + 90), material="dark", round=0.008))
    return solid, clear


def _arm(side):
    x = side * 0.315
    upper = [
        sphere("shoulder", 0.102, (x, 0, 1.1), material="accent", segments=18, rings=12),
        capsule("upper_arm", 0.08, 0.12, (x, 0, 0.955), material="suit", segments=18),
    ]
    for index in range(3):
        upper.append(torus("elbow", 0.074, 0.021, (x, 0, 0.868 - index * 0.032), material="grey", segments=18, sides=8))
    lower = [
        lathe("forearm", [(0.066, 0.632), (0.08, 0.69), (0.083, 0.77), (0.072, 0.822)], loc=(x, 0, 0), material="suit", segments=18),
        torus("wrist", 0.07, 0.02, (x, 0, 0.63), material="accent", segments=18, sides=8),
        cylinder("cuff", 0.066, 0.05, (x, 0, 0.6), material="dark", segments=16),
        sphere("glove", 0.08, (x, -0.005, 0.54), scale=(0.84, 1.0, 1.12), material="dark", segments=16, rings=10),
        sphere("thumb", 0.034, (x - side * 0.045, -0.055, 0.565), scale=(0.9, 1.0, 1.3), rot=(25, 0, side * 20), material="dark", segments=10, rings=8),
        box("wrist_pad", (0.07, 0.022, 0.06), (x, -0.078, 0.73), material="grey", round=0.008),
    ]
    if side > 0:
        lower.append(box("wrist_light", (0.04, 0.008, 0.02), (x, -0.091, 0.735), material="glow_green", round=0.003))
    return upper, lower


def _leg(side):
    x = side * 0.125
    upper = [capsule("thigh", 0.108, 0.1, (x, 0, 0.44), material="suit", segments=18)]
    for index in range(2):
        upper.append(torus("knee", 0.1, 0.022, (x, 0, 0.338 - index * 0.032), material="grey", segments=18, sides=8))
    upper.append(box("knee_pad", (0.125, 0.05, 0.115), (x, -0.102, 0.33), rot=(8, 0, 0), material="accent", round=0.024, segments=3))
    lower = [
        lathe("shin", [(0.086, 0.1), (0.098, 0.16), (0.103, 0.24), (0.096, 0.3)], loc=(x, 0, 0), material="suit", segments=18),
        torus("ankle", 0.092, 0.02, (x, 0, 0.112), material="grey", segments=18, sides=8),
        sphere("boot", 0.1, (x, -0.04, 0.078), scale=(1.05, 1.52, 0.8), material="accent", segments=18, rings=10),
        box("sole", (0.2, 0.34, 0.046), (x, -0.045, 0.023), material="dark", round=0.02, segments=3),
        box("toe", (0.15, 0.06, 0.05), (x, -0.185, 0.06), material="grey", round=0.022, segments=3),
    ]
    return upper, lower


def build(out_dir):
    reset()
    torso_parts = _torso()
    head_solid, head_clear = _head()
    arms = {side: _arm(side) for side in (-1, 1)}
    legs = {side: _leg(side) for side in (-1, 1)}

    solid = torso_parts + head_solid
    for side in (-1, 1):
        solid += arms[side][0] + arms[side][1] + legs[side][0] + legs[side][1]
    bake_shadows(solid, reach=0.22, strength=1.0, floor=0.5)
    paint(solid, PALETTE)

    root = empty("astronaut")
    torso = set_pivot(join(torso_parts, "torso"), (0, 0, 0.6))
    head = set_pivot(join(head_solid + head_clear, "head"), (0, 0, 1.24))
    parent(torso, root)
    parent(head, torso)
    objects = [root, torso, head]
    for side, tag in ((-1, "L"), (1, "R")):
        x = side * 0.315
        arm = set_pivot(join(arms[side][0], "arm" + tag), (x, 0, 1.1))
        forearm = set_pivot(join(arms[side][1], "forearm" + tag), (x, 0, 0.836))
        parent(arm, torso)
        parent(forearm, arm)
        lx = side * 0.125
        leg = set_pivot(join(legs[side][0], "leg" + tag), (lx, 0, 0.56))
        shin = set_pivot(join(legs[side][1], "shin" + tag), (lx, 0, 0.322))
        parent(leg, root)
        parent(shin, leg)
        objects += [arm, forearm, leg, shin]

    export(out_dir + "/astronaut.glb", objects)
    for obj in objects:
        if obj.type == "MESH":
            decimate(obj, 0.4)
    export(out_dir + "/astronaut_low.glb", objects)
