"""
Scenery and science finds for the walks outside. Each is its own node in scenery.glb.

Mars: three layered buttes (flat-topped rock towers, like the Murray Buttes that
NASA's Curiosity rover drove among in 2016), a cracked rock full of yellow sulfur
crystals, an iron meteorite, and a slab of rounded pebbles from an old stream.
Moon: a patch of orange glass beads, and a white rock sitting on a grey boulder.
Both: two sample rocks with crystals that the game lights up.

Sizes are in metres. Bottoms are on Z = 0; the buttes reach a little below it so
no gap shows where the ground is uneven.
"""
import math
import random

import bmesh
from mathutils import Vector, noise
from mathutils.bvhtree import BVHTree

from lib import bake_shadows, decimate, displace, export, from_bm, hex_linear, ico, join, mat, paint, place, reset, shade, sphere

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def _tint(obj, colour_of):
    """Multiply the baked shadows by a colour chosen for every point, and use the shared 'paint' material."""
    mesh = obj.data
    attribute = mesh.color_attributes.get("Col")
    if attribute is None:
        attribute = mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        for item in attribute.data:
            item.color = (1.0, 1.0, 1.0, 1.0)
    for vertex in mesh.vertices:
        shade_value = attribute.data[vertex.index].color[0]
        red, green, blue = colour_of(vertex.co, vertex.normal)
        attribute.data[vertex.index].color = (shade_value * red, shade_value * green, shade_value * blue, 1.0)
    for poly in mesh.polygons:
        poly.material_index = 0
    mesh.materials.clear()
    mesh.materials.append(mat("paint"))
    mesh.update()


def _bvh(objects):
    vertices = []
    polygons = []
    for obj in objects:
        base = len(vertices)
        vertices.extend(obj.matrix_world @ vertex.co for vertex in obj.data.vertices)
        polygons.extend([base + index for index in poly.vertices] for poly in obj.data.polygons)
    return BVHTree.FromPolygons(vertices, polygons, epsilon=0.0)


def _drop(tree, x, y):
    """Height of the surface under a point, or None when there is nothing there."""
    hit = tree.ray_cast(Vector((x, y, 50.0)), Vector((0.0, 0.0, -1.0)))
    return None if hit[0] is None else hit[0].z


def _ground(obj, sink=0.0):
    """Stand an object on the ground: its lowest point goes to -sink."""
    lowest = min(vertex.co.z for vertex in obj.data.vertices)
    return place(obj, (0, 0, -lowest - sink))


def _chunk(name, radius, seed, scale=(1.0, 1.0, 1.0), detail=2, material="rock", sharp=36.0):
    """An angular rock with a flat underside, standing on Z = 0."""
    rock = ico(name, radius, detail=detail, material=material)
    # Move it before the noise is applied, so every rock gets a different piece of the pattern.
    offset = (seed * 3.7, seed * 1.9, seed * 0.7)
    place(rock, offset)
    displace(rock, strength=radius * 0.6, scale=radius * 1.1, kind="VORONOI", seed=100 + seed)
    displace(rock, strength=radius * 0.18, scale=radius * 0.36, kind="CLOUDS", seed=200 + seed)
    place(rock, tuple(-value for value in offset))
    place(rock, scale=scale)
    low = -radius * 0.42 * scale[2]
    for vertex in rock.data.vertices:
        if vertex.co.z < low:
            vertex.co.z = low - (vertex.co.z - low) * 0.12
    rock.data.update()
    shade(rock, True, sharp)
    return place(rock, (0, 0, -low))


def _cut(obj, point, normal, inner="inner"):
    """
    Slice an object with a plane and keep the side the normal points to. The cut is
    closed with faces of material `inner`; they get their own points, so their colour
    does not run into the outside.
    """
    mesh = obj.data
    mesh.materials.append(mat(inner))
    slot = len(mesh.materials) - 1
    bm = bmesh.new()
    bm.from_mesh(mesh)
    geometry = list(bm.verts) + list(bm.edges) + list(bm.faces)
    result = bmesh.ops.bisect_plane(
        bm,
        geom=geometry,
        dist=0.0001,
        plane_co=Vector(point),
        plane_no=Vector(normal).normalized(),
        clear_inner=True,
        clear_outer=False,
    )
    edges = [item for item in result["geom_cut"] if isinstance(item, bmesh.types.BMEdge)]
    filled = bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges)
    for item in filled["geom"]:
        if isinstance(item, bmesh.types.BMFace):
            item.material_index = slot
            item.smooth = False
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bmesh.ops.split_edges(bm, edges=[edge for edge in edges if edge.is_valid])
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return obj


def _crystal(name, radius, length, loc, direction, material="crystal", sides=6, turn=0.0):
    """A six-sided crystal with a pointed end, growing from `loc` along `direction`."""
    bm = bmesh.new()
    shoulder = length * 0.68
    low = []
    high = []
    for index in range(sides):
        angle = math.tau * index / sides + turn
        low.append(bm.verts.new((math.cos(angle) * radius * 0.78, math.sin(angle) * radius * 0.78, -radius * 0.4)))
        high.append(bm.verts.new((math.cos(angle) * radius, math.sin(angle) * radius, shoulder)))
    apex = bm.verts.new((0.0, 0.0, length))
    for index in range(sides):
        after = (index + 1) % sides
        bm.faces.new((low[index], low[after], high[after], high[index]))
        bm.faces.new((high[index], high[after], apex))
    obj = from_bm(name, bm, material, smooth=False)
    euler = Vector((0.0, 0.0, 1.0)).rotation_difference(Vector(direction).normalized()).to_euler("XYZ")
    return place(obj, loc, rot=(math.degrees(euler.x), math.degrees(euler.y), math.degrees(euler.z)))


# ---------------------------------------------------------------------------
# Mars: layered buttes
# ---------------------------------------------------------------------------

HARD = [hex_linear(code) for code in ("#8a4630", "#743a2a", "#93503a")]
SOFT = [hex_linear(code) for code in ("#dba072", "#cf9364", "#e6b081")]
TALUS = hex_linear("#b4714a")
SOIL = hex_linear("#a9643f")
DUST = hex_linear("#dba777")
CAP = hex_linear("#6e3a2c")


def _butte(name, seed, radius, height, layer_count, squash=(1.0, 1.0)):
    """
    A flat-topped tower of layered rock. Hard layers stand as small cliffs and stick
    out; soft layers slope back. Gullies cut the walls, and fallen rock makes an apron
    around the foot.
    """
    rng = random.Random(seed)
    segments = 88
    waves = [(rng.uniform(0.06, 0.15) / (1 + 0.4 * index), count, rng.uniform(0, math.tau)) for index, count in enumerate((2, 3, 5, 7))]
    gullies = [(rng.uniform(0, math.tau), rng.uniform(0.07, 0.16), rng.uniform(0.05, 0.14)) for _ in range(8)]
    gullies += [(rng.uniform(0, math.tau), rng.uniform(0.1, 0.18), rng.uniform(0.18, 0.26)) for _ in range(2)]
    drift = (rng.uniform(0, math.tau), rng.uniform(0, math.tau))

    def outline(theta):
        return 1.0 + sum(size * math.sin(count * theta + phase) for size, count, phase in waves)

    def gully(theta):
        total = 0.0
        for at, width, depth in gullies:
            away = math.atan2(math.sin(theta - at), math.cos(theta - at))
            total += depth * math.exp(-((away / width) ** 2))
        return total

    buried = 1.4
    talus_top = height * 0.24
    # Rows of the wall from the ground up: (height, radius factor, kind, layer).
    rows = []
    for index in range(6):
        t = index / 5
        rows.append((-buried + (talus_top + buried) * t, 1.03 + 0.46 * (1 - t) ** 1.7, "talus", -1))
    weights = [rng.uniform(0.7, 1.4) for _ in range(layer_count)]
    z = talus_top
    factor = 1.0
    bounds = []
    for index, weight in enumerate(weights):
        thickness = (height - talus_top) * weight / sum(weights)
        hard = index % 2 == 0
        if hard:
            # A hard layer sticks out over the soft rock under it.
            edge = factor + 0.035
            rows.append((z + 0.001, edge, "hard", index))
            rows.append((z + thickness * 0.5, edge + 0.012, "hard", index))
            rows.append((z + thickness, edge + 0.01, "hard", index))
            last = edge + 0.01
            factor = last - 0.06 - rng.uniform(0, 0.03)
        else:
            rows.append((z + 0.001, factor, "soft", index))
            rows.append((z + thickness * 0.5, factor - 0.03, "soft", index))
            factor -= 0.055 + rng.uniform(0, 0.03)
            rows.append((z + thickness, factor, "soft", index))
            last = factor
        bounds.append((z, z + thickness, hard))
        z += thickness
    rows.append((height + 0.18, last * 0.84, "top", layer_count))
    rows.append((height + 0.3, last * 0.45, "top", layer_count))

    bm = bmesh.new()
    rings = []
    for row_z, row_factor, kind, layer in rows:
        ring = []
        # The tower does not stand perfectly straight: each level sits a little off the one below.
        climb = max(0.0, row_z) / height
        off_x = radius * 0.1 * climb * math.sin(drift[0] + climb * 2.2)
        off_y = radius * 0.1 * climb * math.cos(drift[1] + climb * 1.7)
        for index in range(segments):
            theta = math.tau * index / segments
            reach = radius * outline(theta) * row_factor
            if kind == "talus":
                t = (row_z + buried) / (talus_top + buried)
                reach *= 1 + gully(theta) * 0.9 * (1 - t)  # fans of fallen rock under the gullies
            else:
                reach *= 1 - gully(theta) * (0.55 + 0.45 * (row_z - talus_top) / (height - talus_top))
                # Every layer has its own outline, so the tower does not look turned on a lathe.
                reach *= 1 + 0.07 * noise.noise(Vector((math.cos(theta) * 1.7, math.sin(theta) * 1.7, layer * 3.1 + seed)))
            if kind == "hard":
                # Hard rock breaks into blocks along joints.
                reach *= 1 + 0.05 * (noise.cell(Vector((theta * 7.0, layer + 0.5, seed + 0.5))) - 0.5)
            wobble = noise.noise(Vector((math.cos(theta) * 2.3 + seed, math.sin(theta) * 2.3, row_z * 0.35)))
            reach *= 1 + 0.035 * wobble
            lift = 0.0 if kind == "talus" else 0.14 * wobble
            ring.append(bm.verts.new((off_x + math.cos(theta) * reach * squash[0], off_y + math.sin(theta) * reach * squash[1], row_z + lift)))
        rings.append(ring)
    for below, above in zip(rings, rings[1:]):
        for index in range(segments):
            after = (index + 1) % segments
            bm.faces.new((below[index], below[after], above[after], above[index]))
    centre = bm.verts.new((0.0, 0.0, height + 0.34))
    for index in range(segments):
        bm.faces.new((rings[-1][index], rings[-1][(index + 1) % segments], centre))
    wall = from_bm(name + "_wall", bm, "rock", smooth=True, sharp=32.0)
    displace(wall, strength=radius * 0.03, scale=radius * 0.2, kind="CLOUDS", seed=300 + seed)
    shade(wall, True, 32.0)

    def wall_colour(co, normal):
        if co.z <= talus_top + 0.06:
            base = _mix(SOIL, TALUS, (co.z + buried) / (talus_top + buried))
        else:
            base = CAP
            for index, (_low, high, hard) in enumerate(bounds):
                if co.z <= high + 0.08 or index == len(bounds) - 1:
                    palette = HARD if hard else SOFT
                    base = palette[(index // 2) % len(palette)]
                    # Thin beds inside a layer.
                    beds = 0.5 + 0.5 * math.sin(co.z * 2.6 + index * 1.7)
                    base = tuple(channel * (0.9 + 0.14 * beds) for channel in base)
                    break
        if normal.z > 0.55:
            base = _mix(base, DUST, 0.8 * (normal.z - 0.55) / 0.45)  # dust settles on ledges and on top
        return base

    # Blocks that broke off and rolled to the foot.
    blocks = []
    for index in range(7):
        theta = rng.uniform(0, math.tau)
        size = rng.uniform(0.045, 0.1) * radius
        block = _chunk(name + "_block", size, seed * 10 + index, scale=(rng.uniform(0.9, 1.3), rng.uniform(0.8, 1.1), rng.uniform(0.6, 0.9)))
        away = radius * outline(theta) * rng.uniform(1.25, 1.62)
        place(block, (math.cos(theta) * away * squash[0], math.sin(theta) * away * squash[1], -size * 0.2), rot=(0, 0, rng.uniform(0, 360)))
        blocks.append(block)

    bake_shadows([wall] + blocks, reach=radius * 0.2, strength=0.85, floor=0.45, ground=0.0)
    _tint(wall, wall_colour)
    for index, block in enumerate(blocks):
        colour = HARD[index % len(HARD)]
        _tint(block, lambda co, normal, colour=colour: _mix(colour, DUST, 0.7 * max(0.0, normal.z - 0.5) / 0.5))
    butte = join([wall] + blocks, name)
    shade(butte, True, 32.0)
    return butte


# ---------------------------------------------------------------------------
# Mars: things to find
# ---------------------------------------------------------------------------


def _sulfur():
    """A rock cracked open like an egg, yellow crystals inside (Curiosity, 30 May 2024)."""
    rng = random.Random(7)
    parts = []
    for side in (-1, 1):
        half = ico("half", 0.4, detail=3, material="rock")
        displace(half, strength=0.2, scale=0.55, kind="VORONOI", seed=61)
        place(half, scale=(1.15, 0.95, 0.8))
        _cut(half, (0, 0, 0), (side, 0, 0))
        # Open the halves like a book and lay them down: the cut faces look up and inward.
        turn = (0, side * 42, side * 14)
        shift = Vector((side * 0.2, side * 0.05, 0.0))
        place(half, shift, rot=turn)
        lowest = min(vertex.co.z for vertex in half.data.vertices)
        place(half, (0, 0, -lowest - 0.03))
        shade(half, True, 36.0)
        parts.append(half)
        # Crystals grow out of the cut face.
        euler = [math.radians(angle) for angle in turn]
        from mathutils import Euler

        matrix = Euler(euler, "XYZ").to_matrix()
        out = matrix @ Vector((-side, 0, 0))
        for _ in range(11):
            y = rng.uniform(-0.27, 0.27)
            z = rng.uniform(-0.2, 0.2)
            if (y / 0.3) ** 2 + (z / 0.24) ** 2 > 1:
                continue
            at = matrix @ Vector((0, y, z)) + shift + Vector((0, 0, -lowest - 0.03))
            lean = out + Vector((rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35), rng.uniform(-0.1, 0.4)))
            parts.append(_crystal("crystal", rng.uniform(0.022, 0.045), rng.uniform(0.07, 0.17), at, lean, turn=rng.uniform(0, 1)))
    # Pieces that fell out between the halves.
    for _ in range(9):
        at = (rng.uniform(-0.28, 0.28), rng.uniform(-0.45, 0.45), 0.0)
        lean = (rng.uniform(-0.8, 0.8), rng.uniform(-0.8, 0.8), 0.5)
        parts.append(_crystal("crystal", rng.uniform(0.02, 0.04), rng.uniform(0.05, 0.11), at, lean, turn=rng.uniform(0, 1)))
    bake_shadows(parts, reach=0.25, strength=0.9, floor=0.5, ground=0.0)
    paint(parts, {"rock": "#a9744f", "inner": "#f0dc82"})
    return join(parts, "find_sulfur")


def _meteorite():
    """An iron meteorite: dark, smooth, covered in thumb-print pits."""
    rock = ico("iron", 0.38, detail=4, material="iron")
    displace(rock, strength=0.1, scale=0.7, kind="CLOUDS", seed=71)
    displace(rock, strength=0.085, scale=0.2, kind="VORONOI", seed=72)
    place(rock, scale=(1.3, 0.95, 0.7), rot=(0, 8, 20))
    low = min(vertex.co.z for vertex in rock.data.vertices) + 0.06
    for vertex in rock.data.vertices:
        if vertex.co.z < low:
            vertex.co.z = low
    rock.data.update()
    decimate(rock, 0.4)
    shade(rock, True, 40.0)
    _ground(rock)
    parts = [rock]
    for seed, (x, y, size) in enumerate(((0.55, 0.22, 0.09), (-0.5, -0.3, 0.065), (0.2, -0.52, 0.05))):
        bit = ico("iron_bit", size, detail=2, material="iron")
        place(bit, (seed * 2.0, 0, 0))
        displace(bit, strength=size * 0.5, scale=size * 1.2, kind="VORONOI", seed=73 + seed)
        place(bit, (-seed * 2.0, 0, 0))
        place(bit, scale=(1.2, 0.9, 0.7))
        _ground(bit, size * 0.15)
        place(bit, (x, y, 0), rot=(0, 0, seed * 70))
        shade(bit, True, 40.0)
        parts.append(bit)
    bake_shadows(parts, reach=0.3, strength=0.9, floor=0.5, ground=0.0)
    return join(parts, "find_meteorite")


def _pebbles():
    """A broken slab of rock full of round pebbles: the bed of a stream that dried up long ago."""
    rng = random.Random(23)
    slab = ico("slab", 0.8, detail=3, material="rock")
    place(slab, scale=(1.2, 0.82, 0.16))
    displace(slab, strength=0.06, scale=0.4, kind="CLOUDS", seed=81)
    _cut(slab, (0.6, 0, 0), (-1, 0.3, 0), inner="rock")
    place(slab, (-0.1, 0, 0.3), rot=(0, -13, 18))
    shade(slab, True, 40.0)
    piece = ico("piece", 0.46, detail=3, material="rock")
    place(piece, scale=(1.05, 0.72, 0.2))
    displace(piece, strength=0.05, scale=0.35, kind="CLOUDS", seed=82)
    place(piece, (0.98, -0.2, 0.1), rot=(0, 5, -32))
    shade(piece, True, 40.0)
    parts = [slab, piece]
    tree = _bvh(parts)
    loose = 0
    made = 0
    while made < 40:
        x = rng.uniform(-1.05, 1.5)
        y = rng.uniform(-0.85, 0.85)
        height = _drop(tree, x, y)
        if height is None:
            # A few have weathered out and lie on the soil.
            if loose >= 12:
                continue
            loose += 1
            height = 0.0
        size = rng.uniform(0.035, 0.085)
        parts.append(
            sphere(
                "pebble",
                size,
                (x, y, height + size * 0.2),
                scale=(1.0, rng.uniform(0.72, 1.0), 0.62),
                rot=(0, 0, rng.uniform(0, 180)),
                material="pebble" + str(rng.randrange(4)),
                segments=10,
                rings=6,
            )
        )
        made += 1
    bake_shadows(parts, reach=0.22, strength=0.9, floor=0.5, ground=0.0)
    paint(parts, {"rock": "#8f6c55", "pebble0": "#ded2c0", "pebble1": "#8e8d92", "pebble2": "#b58f6f", "pebble3": "#5d585c"})
    return join(parts, "find_pebbles")


# ---------------------------------------------------------------------------
# Moon: things to find
# ---------------------------------------------------------------------------

REGOLITH = hex_linear("#9a9da6")
ORANGE = hex_linear("#e2772e")
RUST = hex_linear("#c9753a")


def _beads():
    """A patch of orange soil: tiny beads of volcanic glass (Apollo 17, December 1972)."""
    rng = random.Random(31)
    segments = 44
    rows = 7
    reach = 1.3
    waves = [(rng.uniform(0.07, 0.16), count, rng.uniform(0, math.tau)) for count in (2, 3, 5)]

    def outline(theta):
        return 1.0 + sum(size * math.sin(count * theta + phase) for size, count, phase in waves)

    def lift(t, theta):
        return 0.07 * (1 - t * t) + 0.012 * noise.noise(Vector((math.cos(theta) * t * 3, math.sin(theta) * t * 3, 4.0)))

    bm = bmesh.new()
    centre = bm.verts.new((0.0, 0.0, lift(0, 0)))
    rings = []
    for row in range(1, rows + 1):
        t = row / rows
        ring = []
        for index in range(segments):
            theta = math.tau * index / segments
            distance = reach * t * (1 + (outline(theta) - 1) * t)
            ring.append(bm.verts.new((math.cos(theta) * distance, math.sin(theta) * distance, lift(t, theta) if row < rows else 0.0)))
        rings.append(ring)
    for index in range(segments):
        bm.faces.new((centre, rings[0][index], rings[0][(index + 1) % segments]))
    for inner, outer in zip(rings, rings[1:]):
        for index in range(segments):
            after = (index + 1) % segments
            bm.faces.new((inner[index], outer[index], outer[after], inner[after]))
    soil = from_bm("soil", bm, "soil", smooth=True, sharp=None)

    def soil_colour(co, _normal):
        theta = math.atan2(co.y, co.x)
        t = math.hypot(co.x, co.y) / (reach * outline(theta))
        speck = 0.5 + 0.5 * noise.noise(Vector((co.x * 5, co.y * 5, 1.0)))
        base = _mix(ORANGE, RUST, speck * 0.6 + t * 0.4)
        return _mix(base, REGOLITH, (t - 0.62) / 0.38)

    parts = [soil]
    tree = _bvh(parts)
    made = 0
    while made < 46:
        theta = rng.uniform(0, math.tau)
        distance = reach * 0.8 * math.sqrt(rng.random())
        x = math.cos(theta) * distance
        y = math.sin(theta) * distance
        height = _drop(tree, x, y)
        if height is None:
            continue
        size = rng.uniform(0.02, 0.05)
        material = "bead" if rng.random() < 0.72 else "bead_dark"
        parts.append(sphere("bead", size, (x, y, height + size * 0.55), material=material, segments=10, rings=6))
        made += 1
    bake_shadows(parts, reach=0.15, strength=0.8, floor=0.6, ground=None)
    _tint(soil, soil_colour)
    return join(parts, "find_beads")


def _white_rock():
    """A white rock on a little mound of grey soil: a piece of the Moon's ancient crust (Apollo 15, 1971)."""
    stand = sphere("stand", 0.55, scale=(1.0, 0.85, 0.34), material="rock", segments=28, rings=14)
    displace(stand, strength=0.035, scale=0.22, kind="CLOUDS", seed=93)
    # Only the upper half shows: the rest is under the ground.
    for vertex in stand.data.vertices:
        if vertex.co.z < 0.0:
            vertex.co.z = 0.0
    stand.data.update()
    shade(stand, True, None)
    tree = _bvh([stand])
    top = _drop(tree, 0.04, 0.02) or 0.18
    rock = ico("white", 0.17, detail=2, material="white")
    displace(rock, strength=0.11, scale=0.22, kind="VORONOI", seed=91)
    place(rock, scale=(1.25, 0.9, 0.82), rot=(8, -6, 25))
    lowest = min(vertex.co.z for vertex in rock.data.vertices)
    place(rock, (0.04, 0.02, top - lowest - 0.03))
    shade(rock, True, 30.0)
    crumbs = []
    for seed, (x, y, size) in enumerate(((0.62, 0.3, 0.05), (-0.55, -0.42, 0.04))):
        crumb = ico("white", size, detail=1, material="white")
        place(crumb, (x, y, size * 0.5), scale=(1.2, 0.9, 0.7), rot=(0, 0, seed * 50))
        shade(crumb, True, 30.0)
        crumbs.append(crumb)
    parts = [stand, rock] + crumbs
    bake_shadows(parts, reach=0.35, strength=0.9, floor=0.5, ground=0.0)
    paint(parts, {"rock": "#8b8e97"})
    return join(parts, "find_white")


# ---------------------------------------------------------------------------
# Both worlds: sample rocks
# ---------------------------------------------------------------------------


def _sample(tag, seed):
    """A rock worth picking up: crystals show where it broke. The game lights the crystals."""
    rng = random.Random(seed)
    rock = _chunk("rock", 0.3, 50 + seed, scale=(1.2, 1.0, 0.82), detail=2)
    tree = _bvh([rock])
    parts = [rock]
    made = 0
    while made < 5:
        x = rng.uniform(-0.16, 0.16)
        y = rng.uniform(-0.14, 0.14)
        height = _drop(tree, x, y)
        if height is None:
            continue
        lean = (x * 3 + rng.uniform(-0.3, 0.3), y * 3 + rng.uniform(-0.3, 0.3), 1.0)
        parts.append(_crystal("crystal", rng.uniform(0.035, 0.06), rng.uniform(0.14, 0.3), (x, y, height - 0.03), lean, turn=rng.uniform(0, 1)))
        made += 1
    bake_shadows(parts, reach=0.25, strength=0.9, floor=0.5, ground=0.0)
    paint(parts, {"rock": "#ffffff"})
    return join(parts, "sample_" + tag)


def build(out_dir):
    reset()
    buttes = [
        _butte("butte_a", 3, 9.0, 24.0, 7, squash=(1.0, 0.86)),
        _butte("butte_b", 5, 21.0, 16.0, 5, squash=(1.0, 0.7)),
        _butte("butte_c", 8, 13.0, 30.0, 9, squash=(0.9, 1.0)),
    ]
    finds = [_sulfur(), _meteorite(), _pebbles(), _beads(), _white_rock(), _sample("a", 1), _sample("b", 2)]
    objects = buttes + finds
    export(out_dir + "/scenery.glb", objects)
    for obj in buttes:
        decimate(obj, 0.42)
    for obj in finds:
        decimate(obj, 0.6)
    export(out_dir + "/scenery_low.glb", objects)
