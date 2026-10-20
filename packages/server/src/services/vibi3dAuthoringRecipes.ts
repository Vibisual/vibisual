/** Our small recipes use Blender's installed public Python interface; no Blender binary/code is bundled. */
export const VIBI3D_RECIPES_PY = String.raw`import bpy, math

def part(obj, identifier, name=None, parent=None):
    obj['vibi3dId'] = identifier
    obj.name = name or identifier
    if parent is not None:
        obj.parent = parent
    return obj

def material(name, color='#aeb6c2', roughness=0.4, metallic=0.0):
    if not isinstance(color, str) or len(color) != 7 or color[0] != '#':
        raise ValueError('material-color-must-be-hex')
    rgb = [int(color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    linear = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in rgb]
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*linear, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    result.diffuse_color = (*linear, 1)
    return result

def finish(obj, identifier, material=None, parent=None):
    part(obj, identifier, parent=parent)
    if material:
        obj.data.materials.append(material)
    return obj

def bevel(obj, width=0.03, segments=3):
    modifier = obj.modifiers.new('Edge radius', 'BEVEL')
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = 'ANGLE'
    modifier.harden_normals = True
    return obj

def box(identifier, size=(1, 1, 1), location=(0, 0, 0), material=None, radius=0.03, parent=None):
    if any(not math.isfinite(v) or v <= 0 for v in size):
        raise ValueError('box-size-must-be-positive')
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if radius:
        bevel(obj, min(radius, min(size) / 3))
    return finish(obj, identifier, material, parent)

def cylinder(identifier, radius=0.5, depth=1, location=(0, 0, 0), material=None, edge=0.02, vertices=48, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    if edge:
        bevel(obj, min(edge, radius / 3, depth / 3))
    return finish(obj, identifier, material, parent)

def torus(identifier, major_radius=0.5, minor_radius=0.05, location=(0, 0, 0), material=None, parent=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=major_radius, minor_radius=minor_radius, major_segments=64, minor_segments=16, location=location)
    obj = bpy.context.object
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return finish(obj, identifier, material, parent)

def group(identifier, location=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(identifier, None)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    return part(obj, identifier, parent=parent)
`;

export const VIBI3D_EXAMPLE_PY = String.raw`# Replace this demonstration with the requested design. Blender coordinates: Z is up; units are meters.
# Keep part IDs stable across revisions. Parameters are declared in manifest.parameters.
def build(ctx):
    r = ctx.recipes
    width = ctx.params.get('width', 1.6)
    color = ctx.params.get('bodyColor', '#304a66')
    paint = r.material('Body paint', color, roughness=0.32, metallic=0.25)
    metal = r.material('Brushed metal', '#c7cbd1', roughness=0.3, metallic=0.8)
    rubber = r.material('Rubber feet', '#22252b', roughness=0.75)
    r.box('body', (width, 0.8, 0.8), (0, 0, 0.55), paint, radius=0.06)
    ctx.checkpoint('blockout', 'Proportions and main body')
    r.box('lid', (width + 0.025, 0.825, 0.1), (0, 0, 1.0), paint, radius=0.025)
    r.box('handle-top', (0.65, 0.12, 0.09), (0, 0, 1.27), metal)
    for side in (-1, 1):
        r.box('handle-support-' + str(side), (0.09, 0.12, 0.21), (side * 0.28, 0, 1.16), metal, radius=0.02)
        r.box('latch-' + str(side), (0.12, 0.06, 0.18), (side * width * 0.32, -0.43, 0.89), metal, radius=0.015)
        for front in (-1, 1):
            r.box('foot-' + str(side) + '-' + str(front), (0.18, 0.18, 0.1), (side * width * 0.35, front * 0.25, 0.1), rubber)
    ctx.checkpoint('details', 'Handle, latches, edge radii and feet')
# The worker makes a final checkpoint with real front/side/perspective renders after build returns.
`;
