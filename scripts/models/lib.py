"""
Small modelling kit for building the game's 3D models in Blender, from code.

Run through scripts/models/build.py (Blender, background mode). Every model is
made of simple parts (boxes, lathes, tubes) that get real modelling treatment:
bevelled edges, smooth shading, and soft contact shadows baked into the
vertex colours. The result is exported as .glb for the game.

Blender axes: X right, Y back (models face -Y), Z up. Units are metres.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

# ---------------------------------------------------------------------------
# Scene and materials
# ---------------------------------------------------------------------------


def reset():
    """Start from an empty file."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color=(0.8, 0.8, 0.8)):
    """A named material. The game swaps materials by name; the colour here is for previews."""
    material = bpy.data.materials.get(name)
    if material is None:
        material = bpy.data.materials.new(name)
        material.diffuse_color = (color[0], color[1], color[2], 1.0)
        try:
            if material.node_tree is None:
                material.use_nodes = True
            bsdf = material.node_tree.nodes.get("Principled BSDF")
            if bsdf is not None:
                bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
        except Exception:  # node layout differs between Blender versions; names are what matter
            pass
    return material


def _link(name, mesh):
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def from_bm(name, bm, material=None, smooth=True, sharp=42.0):
    """Turn a bmesh into an object."""
    bm.normal_update()
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = _link(name, mesh)
    if material:
        mesh.materials.append(mat(material))
    shade(obj, smooth, sharp)
    return obj


def shade(obj, smooth=True, sharp=42.0):
    """Smooth shading, with edges sharper than `sharp` degrees kept crisp."""
    mesh = obj.data
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    if smooth and sharp is not None:
        mesh.set_sharp_from_angle(angle=math.radians(sharp))
    mesh.update()
    return obj


def place(obj, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    """Move, turn (degrees, XYZ) and scale an object, baking the result into its mesh."""
    matrix = (
        Matrix.Translation(Vector(loc))
        @ Matrix.Rotation(math.radians(rot[2]), 4, "Z")
        @ Matrix.Rotation(math.radians(rot[1]), 4, "Y")
        @ Matrix.Rotation(math.radians(rot[0]), 4, "X")
        @ Matrix.Diagonal(Vector((scale[0], scale[1], scale[2], 1.0)))
    )
    obj.data.transform(matrix)
    if scale[0] * scale[1] * scale[2] < 0:
        obj.data.flip_normals()
    obj.data.update()
    return obj


def apply(obj):
    """Apply all modifiers."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
    old = obj.data
    obj.modifiers.clear()
    obj.data = mesh
    mesh.name = obj.name
    bpy.data.meshes.remove(old)
    return obj


# ---------------------------------------------------------------------------
# Modifiers
# ---------------------------------------------------------------------------


def bevel(obj, width=0.02, segments=2, angle=35.0, now=True):
    """Round the hard edges. This is what makes a box look manufactured."""
    modifier = obj.modifiers.new("bevel", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    modifier.angle_limit = math.radians(angle)
    modifier.miter_outer = "MITER_ARC"
    try:
        modifier.harden_normals = True
    except Exception:
        pass
    if now:
        apply(obj)
        shade(obj, True, 50.0)
    return obj


def subsurf(obj, levels=2, now=True):
    modifier = obj.modifiers.new("subsurf", "SUBSURF")
    modifier.levels = levels
    modifier.render_levels = levels
    if now:
        apply(obj)
        shade(obj, True, None)
    return obj


def solidify(obj, thickness=0.02, offset=-1.0, now=True):
    modifier = obj.modifiers.new("solid", "SOLIDIFY")
    modifier.thickness = thickness
    modifier.offset = offset
    if now:
        apply(obj)
    return obj


def boolean(obj, cutter, operation="DIFFERENCE", now=True, remove_cutter=True):
    modifier = obj.modifiers.new("bool", "BOOLEAN")
    modifier.operation = operation
    modifier.object = cutter
    modifier.solver = "EXACT"
    if now:
        apply(obj)
        if remove_cutter:
            remove(cutter)
    return obj


def displace(obj, strength=0.1, scale=1.0, kind="CLOUDS", seed=0, now=True):
    """Push the surface in and out with a noise pattern (rocks, soft ground)."""
    texture = bpy.data.textures.new(f"noise{seed}", kind)
    texture.noise_scale = scale
    if kind == "CLOUDS":
        texture.noise_depth = 2
    modifier = obj.modifiers.new("displace", "DISPLACE")
    modifier.texture = texture
    modifier.strength = strength
    modifier.texture_coords = "GLOBAL"
    if now:
        apply(obj)
    return obj


def decimate(obj, ratio=0.5, now=True):
    modifier = obj.modifiers.new("decimate", "DECIMATE")
    modifier.ratio = ratio
    if now:
        apply(obj)
    return obj


def weighted_normals(obj, now=True):
    """Make flat faces of a bevelled part shade flat while the bevels stay round."""
    modifier = obj.modifiers.new("wn", "WEIGHTED_NORMAL")
    modifier.keep_sharp = True
    modifier.weight = 60
    if now:
        apply(obj)
    return obj


def remove(obj):
    mesh = obj.data
    bpy.data.objects.remove(obj)
    if mesh is not None and mesh.users == 0:
        if isinstance(mesh, bpy.types.Mesh):
            bpy.data.meshes.remove(mesh)
        elif isinstance(mesh, bpy.types.Curve):
            bpy.data.curves.remove(mesh)


# ---------------------------------------------------------------------------
# Shapes. Each returns a new object with one material.
# ---------------------------------------------------------------------------


def box(name, size, loc=(0, 0, 0), rot=(0, 0, 0), material="grey", round=0.02, segments=2):
    """A box with rounded edges."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    obj = from_bm(name, bm, material, smooth=False)
    place(obj, scale=size)
    if round > 0:
        bevel(obj, min(round, min(size) * 0.49), segments)
    return place(obj, loc, rot)


def cylinder(name, radius, depth, loc=(0, 0, 0), rot=(0, 0, 0), material="grey", segments=24, radius2=None, round=0.0, round_segments=2):
    """A cylinder (or cone) standing along Z, centred."""
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=segments,
        radius1=radius,
        radius2=radius if radius2 is None else radius2,
        depth=depth,
    )
    obj = from_bm(name, bm, material, smooth=True, sharp=50.0)
    if round > 0:
        bevel(obj, round, round_segments, angle=50.0)
    return place(obj, loc, rot)


def sphere(name, radius, loc=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0), material="grey", segments=24, rings=14):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    obj = from_bm(name, bm, material, smooth=True, sharp=None)
    return place(obj, loc, rot, scale)


def ico(name, radius, loc=(0, 0, 0), scale=(1, 1, 1), material="rock", detail=2):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=detail, radius=radius)
    obj = from_bm(name, bm, material, smooth=True, sharp=None)
    return place(obj, loc, scale=scale)


def capsule(name, radius, length, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), material="grey", segments=20, rings=10):
    """A pill standing along Z. `length` is the straight part between the round ends."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    for vert in bm.verts:
        vert.co.z += length * 0.5 if vert.co.z > 1e-6 else (-length * 0.5 if vert.co.z < -1e-6 else 0.0)
    # The equator ring was not moved: split it into two rings so the side is straight.
    equator = [e for e in bm.edges if abs(e.verts[0].co.z) < 1e-6 and abs(e.verts[1].co.z) < 1e-6]
    if equator and length > 0:
        result = bmesh.ops.bevel(bm, geom=equator, offset=length * 0.5, offset_type="OFFSET", segments=1, affect="EDGES")
        del result
    obj = from_bm(name, bm, material, smooth=True, sharp=None)
    return place(obj, loc, rot, scale)


def torus(name, radius, tube, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), material="grey", segments=28, sides=10):
    """A ring lying flat (its hole points along Z)."""
    bm = bmesh.new()
    rings = []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        ring = []
        for j in range(sides):
            b = 2 * math.pi * j / sides
            r = radius + tube * math.cos(b)
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), tube * math.sin(b))))
        rings.append(ring)
    for i in range(segments):
        for j in range(sides):
            a, b = rings[i], rings[(i + 1) % segments]
            bm.faces.new((a[j], b[j], b[(j + 1) % sides], a[(j + 1) % sides]))
    obj = from_bm(name, bm, material, smooth=True, sharp=None)
    return place(obj, loc, rot, scale)


def lathe(name, profile, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), material="grey", segments=32, cap_bottom=True, cap_top=True, sharp=42.0):
    """Spin a profile [(radius, z), ...] around the Z axis. Points go from bottom to top."""
    bm = bmesh.new()
    rings = []
    for radius, z in profile:
        if radius <= 1e-6:
            rings.append([bm.verts.new((0.0, 0.0, z))])
        else:
            rings.append([bm.verts.new((radius * math.cos(2 * math.pi * i / segments), radius * math.sin(2 * math.pi * i / segments), z)) for i in range(segments)])
    for lower, upper in zip(rings[:-1], rings[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            if len(lower) == 1 and len(upper) == 1:
                continue
            if len(lower) == 1:
                bm.faces.new((lower[0], upper[j], upper[i]))
            elif len(upper) == 1:
                bm.faces.new((lower[i], lower[j], upper[0]))
            else:
                bm.faces.new((lower[i], lower[j], upper[j], upper[i]))
    if cap_bottom and len(rings[0]) > 1:
        bm.faces.new(list(reversed(rings[0])))
    if cap_top and len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    obj = from_bm(name, bm, material, smooth=True, sharp=sharp)
    return place(obj, loc, rot, scale)


def tube(name, points, radius, material="grey", sides=10, smooth_path=True, resolution=6, flat=1.0):
    """A hose or pipe through the given points."""
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = max(1, sides // 4)
    curve.resolution_u = resolution
    curve.use_fill_caps = True
    if smooth_path and len(points) > 2:
        spline = curve.splines.new("NURBS")
        spline.points.add(len(points) - 1)
        for point, co in zip(spline.points, points):
            point.co = (co[0], co[1], co[2], 1.0)
        spline.order_u = min(4, len(points))
        spline.use_endpoint_u = True
    else:
        spline = curve.splines.new("POLY")
        spline.points.add(len(points) - 1)
        for point, co in zip(spline.points, points):
            point.co = (co[0], co[1], co[2], 1.0)
    holder = bpy.data.objects.new(name + "_curve", curve)
    bpy.context.scene.collection.objects.link(holder)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    mesh = bpy.data.meshes.new_from_object(holder.evaluated_get(depsgraph), depsgraph=depsgraph)
    bpy.data.objects.remove(holder)
    bpy.data.curves.remove(curve)
    obj = _link(name, mesh)
    mesh.materials.append(mat(material))
    shade(obj, True, 60.0)
    if flat != 1.0:
        place(obj, scale=(1, 1, flat))
    return obj


def prism(name, outline, depth, loc=(0, 0, 0), rot=(0, 0, 0), material="grey", round=0.0, segments=2):
    """A flat outline [(x, y), ...] (counter-clockwise) pulled up along Z by `depth`, centred on Z."""
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, -depth * 0.5)) for x, y in outline]
    top = [bm.verts.new((x, y, depth * 0.5)) for x, y in outline]
    count = len(outline)
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    for i in range(count):
        j = (i + 1) % count
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    obj = from_bm(name, bm, material, smooth=False)
    if round > 0:
        bevel(obj, round, segments)
    return place(obj, loc, rot)


def partial_sphere(name, radius, keep=None, loc=(0, 0, 0), material="grey", segments=32, rings=18, thickness=0.0, plane=None):
    """
    Part of a sphere. `plane=(point, normal)` cuts it cleanly and keeps the side the normal
    points to. `keep(Vector)` keeps whole faces whose centre passes the test (a rougher edge).
    """
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    if plane is not None:
        geometry = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geometry, dist=0.00001, plane_co=Vector(plane[0]), plane_no=Vector(plane[1]).normalized(), clear_inner=True, clear_outer=False)
    if keep is not None:
        doomed = [face for face in bm.faces if not keep(face.calc_center_median())]
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
    obj = from_bm(name, bm, material, smooth=True, sharp=None)
    if thickness > 0:
        solidify(obj, thickness, offset=-1.0)
        shade(obj, True, 60.0)
    return place(obj, loc)


def patch(name, radius, lon=(-50, 50), lat=(-40, 35), loc=(0, 0, 0), material="face", steps=14):
    """A piece of a sphere facing -Y, with UVs that cover it once (for a painted face)."""
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    grid = []
    for iy in range(steps + 1):
        v = iy / steps
        phi = math.radians(lat[0] + (lat[1] - lat[0]) * v)
        row = []
        for ix in range(steps + 1):
            u = ix / steps
            theta = math.radians(lon[0] + (lon[1] - lon[0]) * u)
            x = radius * math.cos(phi) * math.sin(theta)
            y = -radius * math.cos(phi) * math.cos(theta)
            z = radius * math.sin(phi)
            row.append((bm.verts.new((x, y, z)), (u, v)))
        grid.append(row)
    for iy in range(steps):
        for ix in range(steps):
            corners = [grid[iy][ix], grid[iy][ix + 1], grid[iy + 1][ix + 1], grid[iy + 1][ix]]
            face = bm.faces.new([corner[0] for corner in corners])
            for loop, corner in zip(face.loops, corners):
                loop[uv_layer].uv = corner[1]
    obj = from_bm(name, bm, material, smooth=True, sharp=None)
    return place(obj, loc)


# ---------------------------------------------------------------------------
# Putting parts together
# ---------------------------------------------------------------------------


def join(parts, name):
    """Merge parts into one object. Materials stay per face."""
    materials = []
    bm = bmesh.new()
    for part in parts:
        mesh = part.data
        remap = []
        for material in mesh.materials:
            if material not in materials:
                materials.append(material)
            remap.append(materials.index(material))
        piece = bmesh.new()
        piece.from_mesh(mesh)
        piece.transform(part.matrix_world)
        for face in piece.faces:
            face.material_index = remap[face.material_index] if remap else 0
        temp = bpy.data.meshes.new("temp")
        piece.to_mesh(temp)
        piece.free()
        bm.from_mesh(temp)
        bpy.data.meshes.remove(temp)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for material in materials:
        mesh.materials.append(material)
    for part in parts:
        remove(part)
    obj = _link(name, mesh)
    return obj


def set_pivot(obj, pivot):
    """Make `pivot` (world position) the point the part turns around."""
    pivot = Vector(pivot)
    obj.data.transform(Matrix.Translation(-pivot))
    obj.location = pivot
    return obj


def empty(name, loc=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    obj.location = Vector(loc)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def parent(child, to):
    bpy.context.view_layer.update()
    world = child.matrix_world.copy()
    child.parent = to
    child.matrix_parent_inverse = to.matrix_world.inverted()
    child.matrix_world = world
    return child


# ---------------------------------------------------------------------------
# Soft contact shadows, baked into vertex colours
# ---------------------------------------------------------------------------

_DIRECTIONS = []


def _hemisphere(count=20):
    """Evenly spread directions over the upper half of a sphere."""
    if not _DIRECTIONS:
        golden = math.pi * (3.0 - math.sqrt(5.0))
        for i in range(count):
            z = (i + 0.5) / count
            r = math.sqrt(max(0.0, 1.0 - z * z))
            _DIRECTIONS.append(Vector((math.cos(golden * i) * r, math.sin(golden * i) * r, z)))
    return _DIRECTIONS


def bake_shadows(objects, reach=0.4, strength=0.85, floor=0.42, ground=None, skip=()):
    """
    For every corner of every mesh, measure how closed-in it is and store that as a
    grey vertex colour (white = open, darker = tucked in a corner). `ground` adds a
    floor at that height, so things look planted on the soil.
    """
    bpy.context.view_layer.update()
    vertices = []
    polygons = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        if any(slot.material and slot.material.name in skip for slot in obj.material_slots) and len(obj.material_slots) == 1:
            continue
        base = len(vertices)
        world = obj.matrix_world
        vertices.extend(world @ vertex.co for vertex in obj.data.vertices)
        polygons.extend([base + index for index in poly.vertices] for poly in obj.data.polygons)
    tree = BVHTree.FromPolygons(vertices, polygons, epsilon=0.0)
    directions = _hemisphere()

    for obj in objects:
        if obj.type != "MESH":
            continue
        mesh = obj.data
        world = obj.matrix_world
        normal_matrix = world.to_3x3().inverted_safe().transposed()
        values = []
        for vertex in mesh.vertices:
            origin = world @ vertex.co
            normal = (normal_matrix @ vertex.normal).normalized()
            # A frame around the normal.
            helper = Vector((0, 0, 1)) if abs(normal.z) < 0.9 else Vector((1, 0, 0))
            tangent = normal.cross(helper).normalized()
            bitangent = normal.cross(tangent)
            start = origin + normal * 0.004
            blocked = 0.0
            for direction in directions:
                ray = tangent * direction.x + bitangent * direction.y + normal * direction.z
                hit = tree.ray_cast(start, ray, reach)
                if hit[0] is not None:
                    blocked += 1.0 - hit[3] / reach
                elif ground is not None and ray.z < -0.05:
                    distance = (start.z - ground) / -ray.z
                    if 0 <= distance < reach:
                        blocked += 1.0 - distance / reach
            values.append(max(floor, 1.0 - strength * blocked / len(directions)))
        # One smoothing pass removes speckle.
        neighbours = [[] for _ in mesh.vertices]
        for edge in mesh.edges:
            a, b = edge.vertices
            neighbours[a].append(b)
            neighbours[b].append(a)
        smooth = []
        for index, value in enumerate(values):
            near = neighbours[index]
            smooth.append((value * 2 + sum(values[n] for n in near)) / (2 + len(near)) if near else value)
        attribute = mesh.color_attributes.get("Col") or mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        for index, value in enumerate(smooth):
            attribute.data[index].color = (value, value, value, 1.0)
        mesh.color_attributes.active_color = attribute
        try:
            mesh.color_attributes.render_color_index = list(mesh.color_attributes).index(attribute)
        except Exception:
            pass
        mesh.update()


def _linear(channel):
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def hex_linear(code):
    """'#rrggbb' as linear RGB, the form vertex colours are stored in."""
    code = code.lstrip("#")
    return tuple(_linear(int(code[i : i + 2], 16) / 255.0) for i in (0, 2, 4))


def paint(parts, palette):
    """
    Bake flat colours into the vertex colours (on top of the baked shadows) and give
    those parts one shared material, 'paint'. Fewer materials means fewer draw calls.
    """
    for obj in parts:
        mesh = obj.data
        names = [material.name for material in mesh.materials]
        if not any(name in palette for name in names):
            continue
        attribute = mesh.color_attributes.get("Col")
        if attribute is None:
            attribute = mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
            for item in attribute.data:
                item.color = (1.0, 1.0, 1.0, 1.0)
        # Parts are not welded together, so every point belongs to faces of one material.
        done = set()
        for poly in mesh.polygons:
            name = names[poly.material_index]
            if name not in palette:
                continue
            red, green, blue = hex_linear(palette[name])
            for index in poly.vertices:
                if index in done:
                    continue
                done.add(index)
                shade_value = attribute.data[index].color[0]
                attribute.data[index].color = (shade_value * red, shade_value * green, shade_value * blue, 1.0)
        # Painted faces share one material; the rest (glass, lamps) keep theirs.
        slots = []
        remap = {}
        for index, name in enumerate(names):
            target = "paint" if name in palette else name
            if target not in slots:
                slots.append(target)
            remap[index] = slots.index(target)
        for poly in mesh.polygons:
            poly.material_index = remap[poly.material_index]
        mesh.materials.clear()
        for name in slots:
            mesh.materials.append(mat(name))


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


def triangles(objects):
    total = 0
    for obj in objects:
        if obj.type == "MESH":
            total += sum(len(poly.vertices) - 2 for poly in obj.data.polygons)
    return total


def export(path, objects):
    """Write the given objects (and their hierarchy) as one .glb file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    # The exporter writes the *active* colour layer: make sure the baked one is active.
    for obj in objects:
        if obj.type == "MESH":
            attribute = obj.data.color_attributes.get("Col")
            if attribute is not None:
                obj.data.color_attributes.active_color = attribute
                obj.data.color_attributes.render_color_index = list(obj.data.color_attributes).index(attribute)
    options = dict(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
    )
    known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    if "export_vertex_color" in known:
        options["export_vertex_color"] = "ACTIVE"
    if "export_active_vertex_color_when_no_material" in known:
        options["export_active_vertex_color_when_no_material"] = True
    if "export_all_vertex_colors" in known:
        options["export_all_vertex_colors"] = False
    bpy.ops.export_scene.gltf(**options)
    size = os.path.getsize(path)
    print(f"[models] {os.path.basename(path)}: {triangles(objects)} triangles, {size / 1024:.0f} kB")


# ---------------------------------------------------------------------------
# Building blocks used by the outpost models
# ---------------------------------------------------------------------------


def arch(name, radius, y, base, thickness, material="hull", steps=14, sides=8):
    """A half-circle rib standing across the X axis at depth `y`, feet at height `base`."""
    points = [(radius * math.cos(math.pi * i / steps), y, base + radius * math.sin(math.pi * i / steps)) for i in range(steps + 1)]
    return tube(name, points, thickness, material=material, sides=sides)


def half_pipe(name, radius, length, base, material="glass", segments=30):
    """A thin half-cylinder skin running along Y (a greenhouse roof), open at both ends."""
    bm = bmesh.new()
    rows = []
    for y in (-length / 2, length / 2):
        rows.append([bm.verts.new((radius * math.cos(math.pi * i / segments), y, base + radius * math.sin(math.pi * i / segments))) for i in range(segments + 1)])
    for i in range(segments):
        bm.faces.new((rows[0][i], rows[1][i], rows[1][i + 1], rows[0][i + 1]))
    return from_bm(name, bm, material, smooth=True, sharp=None)


def half_disc(name, radius, thickness, loc=(0, 0, 0), material="hull", segments=24, round=0.03):
    """A half-circle wall standing across the X axis (the end of a tunnel-shaped building)."""
    outline = [(radius * math.cos(math.pi * i / segments), radius * math.sin(math.pi * i / segments)) for i in range(segments + 1)]
    wall = prism(name, outline, thickness, material=material, round=round)
    place(wall, rot=(90, 0, 0))
    return place(wall, loc)
