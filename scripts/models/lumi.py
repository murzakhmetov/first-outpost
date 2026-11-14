"""
Lumi, the helper robot: a small floating lantern with a screen for a face.

Only the shell is modelled here. The eyes, the antenna bulb and the halo ring are
drawn by the game, because they change with Lumi's mood. Faces -Y. Centre at the origin.
"""
from lib import bake_shadows, box, cylinder, decimate, export, join, lathe, paint, reset, sphere, torus

PALETTE = {"shell": "#fff6e4", "trim": "#ffc94d", "dark": "#3a4260", "seam": "#cdbfa6"}


def _solid():
    parts = []
    parts.append(sphere("body", 0.3, scale=(1.0, 0.96, 0.98), material="shell", segments=32, rings=20))
    # Panel seams: one around the middle, one over the top.
    parts.append(torus("seam_h", 0.2955, 0.006, (0, 0, -0.03), scale=(1.0, 0.96, 1.0), material="seam", segments=40, sides=6))
    parts.append(torus("seam_v", 0.293, 0.006, (0, 0.03, 0), rot=(0, 90, 0), scale=(1.0, 0.96, 0.98), material="seam", segments=40, sides=6))

    # Face: a dark glass screen set into the front, with a gold frame.
    parts.append(sphere("screen", 0.255, (0, -0.13, 0.012), scale=(1.0, 0.66, 0.74), material="screen", segments=28, rings=16))
    parts.append(torus("frame", 0.2, 0.017, (0, -0.232, 0.012), rot=(90, 0, 0), scale=(1.2, 1.0, 0.88), material="trim", segments=36, sides=8))

    # Lantern cap with a carrying ring, and the antenna stalk.
    parts.append(lathe("cap", [(0.215, 0.205), (0.2, 0.245), (0.15, 0.285), (0.08, 0.31), (0.0, 0.317)], material="trim", segments=28, cap_bottom=False, cap_top=False))
    parts.append(torus("cap_ring", 0.214, 0.014, (0, 0, 0.207), material="dark", segments=32, sides=6))
    parts.append(cylinder("stalk", 0.012, 0.16, (0, 0, 0.395), material="trim", segments=8))
    parts.append(cylinder("stalk_base", 0.03, 0.03, (0, 0, 0.325), material="dark", segments=12, round=0.006))

    # Side thrusters: little pods with dark nozzles.
    for side in (-1, 1):
        parts.append(cylinder("pod", 0.085, 0.1, (side * 0.3, 0.02, 0.01), rot=(0, 90, 0), material="trim", segments=18, round=0.02, round_segments=3))
        parts.append(cylinder("nozzle", 0.055, 0.04, (side * 0.355, 0.02, 0.01), rot=(0, 90, 0), material="dark", segments=14, radius2=0.04 if side > 0 else 0.055))
        parts.append(box("fin", (0.02, 0.1, 0.16), (side * 0.3, 0.1, 0.01), rot=(-25, 0, 0), material="trim", round=0.008))

    # Underside: the hover ring and its warm light.
    parts.append(lathe("skirt", [(0.1, -0.31), (0.17, -0.285), (0.2, -0.235), (0.17, -0.25), (0.11, -0.285)], material="dark", segments=28, cap_bottom=False, cap_top=False))
    parts.append(cylinder("hover", 0.1, 0.012, (0, 0, -0.3), material="glow_warm", segments=20))
    # Two cheek lights under the screen.
    for side in (-1, 1):
        parts.append(sphere("cheek", 0.018, (side * 0.19, -0.225, -0.085), material="glow_warm", segments=10, rings=6))
    return parts


def build(out_dir):
    reset()
    solid = _solid()
    bake_shadows(solid, reach=0.12, strength=1.0, floor=0.55)
    paint(solid, PALETTE)
    lumi = join(solid, "lumi")
    export(out_dir + "/lumi.glb", [lumi])
    decimate(lumi, 0.45)
    export(out_dir + "/lumi_low.glb", [lumi])
