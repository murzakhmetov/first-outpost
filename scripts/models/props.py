"""
Small things that are placed many times: cargo crates (three band colours) and
rocks (four shapes). Each is its own node in props.glb; the game copies them.

Crates are 1.3 x 1 x 1 m with the bottom on Z = 0. Rocks are about 1 m across,
flattened underneath, and white: the game tints each copy.
"""
from lib import bake_shadows, box, cylinder, decimate, displace, export, ico, join, paint, place, reset, shade, sphere, tube

BANDS = {"a": "#39c2f0", "b": "#ffc94d", "c": "#a987ff"}


def _crate(tag):
    palette = {"hull": "#f4f0e8", "grey": "#aeb6c6", "dark": "#3a4260", "band": BANDS[tag]}
    parts = [
        box("case", (1.3, 1.0, 0.92), (0, 0, 0.5), material="hull", round=0.09, segments=3),
        box("band", (1.32, 1.02, 0.2), (0, 0, 0.6), material="band", round=0.035),
        box("lid_seam", (1.31, 1.01, 0.02), (0, 0, 0.82), material="dark", round=0.0),
        box("feet", (1.1, 0.8, 0.08), (0, 0, 0.04), material="dark", round=0.03),
        box("label", (0.5, 0.36, 0.05), (-0.15, 0, 0.965), material="dark", round=0.02),
        box("label_mark", (0.3, 0.05, 0.012), (-0.15, 0.08, 0.992), material="band", round=0.0),
        box("label_mark2", (0.2, 0.05, 0.012), (-0.2, -0.04, 0.992), material="grey", round=0.0),
        sphere("led", 0.03, (0.42, 0.28, 0.975), material="glow_green", segments=10, rings=6),
    ]
    for sx in (-1, 1):
        for sy in (-1, 1):
            for z in (0.12, 0.88):
                parts.append(box("corner", (0.16, 0.16, 0.16), (sx * 0.6, sy * 0.45, z), material="grey", round=0.045, segments=3))
        # Carrying handles on the short sides.
        parts.append(tube("handle", [(sx * 0.66, -0.2, 0.5), (sx * 0.74, -0.2, 0.5), (sx * 0.74, 0.2, 0.5), (sx * 0.66, 0.2, 0.5)], 0.025, material="dark", smooth_path=False))
    for x in (-0.3, 0.3):
        parts.append(box("latch", (0.12, 0.05, 0.16), (x, -0.515, 0.8), material="grey", round=0.015))
        parts.append(box("latch_pin", (0.07, 0.02, 0.04), (x, -0.545, 0.76), material="dark", round=0.008))
    bake_shadows(parts, reach=0.3, strength=0.95, floor=0.5, ground=0.0)
    paint(parts, palette)
    return join(parts, "crate_" + tag)


def _rock(tag, seed):
    rock = ico("rock", 0.56, detail=3)
    # Move it before the noise is applied, so every rock gets a different piece of the pattern.
    place(rock, (seed * 7.3, seed * 3.1, seed * 1.7))
    displace(rock, strength=0.34, scale=0.62, kind="VORONOI", seed=seed)
    displace(rock, strength=0.1, scale=0.2, kind="CLOUDS", seed=seed + 20)
    place(rock, (-seed * 7.3, -seed * 3.1, -seed * 1.7))
    place(rock, scale=(1.0 + 0.12 * (seed % 3), 1.0, 0.72 + 0.08 * (seed % 2)))
    # Flatten the underside so it sits in the soil.
    for vertex in rock.data.vertices:
        if vertex.co.z < -0.22:
            vertex.co.z = -0.22 - (vertex.co.z + 0.22) * 0.12
    rock.data.update()
    decimate(rock, 0.3)
    shade(rock, True, 34.0)
    place(rock, (0, 0, 0.22))
    bake_shadows([rock], reach=0.5, strength=0.9, floor=0.5, ground=0.02)
    paint([rock], {"rock": "#ffffff"})
    rock.name = "rock_" + tag
    rock.data.name = rock.name
    return rock


def build(out_dir):
    reset()
    objects = [_crate(tag) for tag in ("a", "b", "c")]
    objects += [_rock(tag, seed) for tag, seed in (("a", 1), ("b", 2), ("c", 3), ("d", 4))]
    export(out_dir + "/props.glb", objects)
    for obj in objects:
        decimate(obj, 0.5)
    export(out_dir + "/props_low.glb", objects)
