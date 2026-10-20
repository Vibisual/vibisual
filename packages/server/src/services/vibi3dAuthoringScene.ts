import { VIBI3D_SOURCE_LOOK_PY } from './vibi3dAuthoringLook.js';
import { VIBI3D_SOURCE_MATERIAL_PY } from './vibi3dAuthoringMaterial.js';
import { VIBI3D_SOURCE_OBJECTS_PY } from './vibi3dAuthoringObjects.js';
/** Assemble a disposable scene for exports. Original generator objects/modifiers are never flattened or mutated. */
export const VIBI3D_SCENE_PY = String.raw`
${VIBI3D_SOURCE_LOOK_PY}
${VIBI3D_SOURCE_MATERIAL_PY}
${VIBI3D_SOURCE_OBJECTS_PY}

def blender_matrix(values):
    matrix = Matrix([[values[column * 4 + row] for column in range(4)] for row in range(4)])
    return SPACE.inverted() @ matrix @ SPACE

def rebuild_mesh(node, geometry, scene):
    if geometry.get('type') != 'BufferGeometry':
        raise ValueError('unsupported-source-geometry: ' + str(geometry.get('type')) + '; use the built-in editor')
    data = geometry['data']
    positions = data['attributes']['position']['array']
    vertices = [SPACE.inverted().to_3x3() @ Vector(positions[i:i+3]) for i in range(0, len(positions), 3)]
    index = data.get('index', {}).get('array', list(range(len(vertices))))
    faces = [index[i:i+3] for i in range(0, len(index), 3)]
    mesh = bpy.data.meshes.new(node['name'])
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    normals = data['attributes'].get('normal', {}).get('array')
    if normals:
        converted = [SPACE.inverted().to_3x3() @ Vector(normals[i:i+3]) for i in range(0, len(normals), 3)]
        mesh.normals_split_custom_set_from_vertices(converted)
        for polygon in mesh.polygons:
            polygon.use_smooth = True
    uv = data['attributes'].get('uv', {}).get('array')
    if uv:
        layer = mesh.uv_layers.new(name='UVMap')
        for loop in mesh.loops:
            layer.data[loop.index].uv = uv[loop.vertex_index * 2:loop.vertex_index * 2 + 2]
    for polygon in mesh.polygons:
        start = polygon.index * 3
        polygon.material_index = next((group['materialIndex'] for group in data.get('groups', []) if group['start'] <= start < group['start'] + group['count']), 0)
    obj = bpy.data.objects.new(node['name'], mesh)
    scene.collection.objects.link(obj)
    return obj

def apply_material(value, material, directory, images, textures):
    check_source_material(value, textures)
    result = material.copy() if material else bpy.data.materials.new(value.get('name', 'Material'))
    result.use_nodes = True
    shader = next((n for n in result.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not shader:
        raise ValueError('unsupported-material-shader')
    color = int(value.get('color', 0xffffff))
    srgb = [(color >> shift & 255) / 255 for shift in (16, 8, 0)]
    linear = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in srgb]
    for name, v in [('Base Color', (*linear, 1)), ('Roughness', value.get('roughness', 0.45)),
                    ('Metallic', value.get('metalness', 0)), ('Alpha', value.get('opacity', 1))]:
        socket = shader.inputs[name]
        for link in list(socket.links):
            result.node_tree.links.remove(link)
        socket.default_value = v
    if value.get('map'):
        image_value = images[textures[value['map']]['image']]['url']
        if not isinstance(image_value, str) or not image_value.startswith('data:image/') or ';base64,' not in image_value:
            raise ValueError('unsupported-texture-image')
        file = directory / ('preview-' + value['uuid'] + '.png')
        file.write_bytes(base64.b64decode(image_value.split(';base64,', 1)[1]))
        image = bpy.data.images.load(str(file), check_existing=False)
        image.pack()
        texture = result.node_tree.nodes.new('ShaderNodeTexImage')
        texture.image = image
        result.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    return result

def assembled_scene(source, generated, directory):
    check_source_look(source)
    check_source_objects(source)
    if source.get('clips'):
        raise ValueError('animated-source-requires-built-in-editor')
    scene = bpy.data.scenes.new('Vibi3D checkpoint')
    originals = {obj.get('vibi3dId'): obj for obj in bpy.context.scene.objects if obj.get('vibi3dId')}
    def index(payload, key):
        return {item['uuid']: item for item in payload['scene'].get(key, [])}
    geometries, materials = index(source, 'geometries'), index(source, 'materials')
    raw_geometries, raw_materials = index(generated, 'geometries'), index(generated, 'materials')
    images, textures = index(source, 'images'), index(source, 'textures')
    def geometry_shape(geometry):
        if not geometry:
            return None
        data = geometry.get('data', {})
        return {key: data.get(key, [] if key == 'groups' else {}) for key in ('attributes', 'index', 'groups')}
    def build(node, parent=None, hidden=False):
        part = node.get('userData', {}).get('vibi3dId', node['uuid'])
        original = originals.get(part)
        if original:
            if node.get('geometry') and not native_geometry_equal(geometry_shape(geometries[node['geometry']]), geometry_shape(raw_geometries.get(node['geometry']))):
                raise ValueError('native-geometry-conflict: ' + part + '; keep locked geometry in generator or use the built-in editor')
            obj = original.copy()
            if original.data:
                obj.data = original.data.copy()
            scene.collection.objects.link(obj)
        elif node.get('geometry'):
            obj = rebuild_mesh(node, geometries[node['geometry']], scene)
        else:
            obj = bpy.data.objects.new(node.get('name', part), None)
            scene.collection.objects.link(obj)
        obj.name = node.get('name', part)
        hidden = hidden or node.get('visible') is False
        obj.hide_render = hidden
        obj.hide_viewport = hidden
        obj['vibi3dId'] = part
        for key in ('vibi3dLocked', 'vibi3dLighting'):
            if key in node.get('userData', {}):
                obj[key] = node['userData'][key]
        obj.parent = parent
        obj.matrix_parent_inverse.identity()
        obj.matrix_basis = blender_matrix(node.get('matrix', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]))
        if node.get('geometry'):
            slots = node.get('material', [])
            slots = slots if isinstance(slots, list) else [slots]
            old_slots = list(obj.data.materials)
            obj.data.materials.clear()
            for i, identifier in enumerate(slots):
                old = old_slots[i] if i < len(old_slots) else None
                value = materials[identifier]
                obj.data.materials.append(old if old and value == raw_materials.get(identifier) else apply_material(value, old, directory, images, textures))
        for child in node.get('children', []):
            build(child, obj, hidden)
    try:
        build(source['scene']['object'])
        return scene
    except Exception:
        dispose_scene(scene)
        raise

def dispose_scene(scene):
    objects = list(scene.objects)
    bpy.data.scenes.remove(scene)
    for obj in objects:
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data and data.users == 0:
            bpy.data.batch_remove(ids=[data])

def render_views(scene, directory):
    bpy.context.view_layer.update()
    points = [obj.matrix_world @ Vector(corner) for obj in scene.objects if obj.type == 'MESH' and not obj.hide_render for corner in obj.bound_box]
    if not points:
        raise ValueError('cannot-render-empty-model')
    low = Vector([min(point[i] for point in points) for i in range(3)])
    high = Vector([max(point[i] for point in points) for i in range(3)])
    center, size = (low + high) / 2, max((high - low).length, 0.1)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.world = bpy.data.worlds.new('Vibi3D studio')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes.get('Background').inputs[0].default_value = (0.16, 0.18, 0.22, 1)
    for number, offset in enumerate([(2, -3, 4), (-3, -1, 2), (0, 3, 3)]):
        light = bpy.data.lights.new('Studio ' + str(number), 'AREA')
        light.energy, light.shape, light.size = size * size * 100, 'DISK', size * 2
        obj = bpy.data.objects.new(light.name, light)
        obj['vibi3dHelper'] = True
        scene.collection.objects.link(obj)
        obj.location = center + Vector(offset).normalized() * size * 2
        obj.rotation_euler = (center - obj.location).to_track_quat('-Z', 'Y').to_euler()
    camera = bpy.data.cameras.new('Review camera')
    camera.type, camera.ortho_scale = 'ORTHO', size * 1.15
    obj = bpy.data.objects.new('Review camera', camera)
    obj['vibi3dHelper'] = True
    scene.collection.objects.link(obj)
    scene.camera = obj
    files = []
    for name, direction in [('front', (0, -1, 0.05)), ('side', (1, 0, 0.05)), ('perspective', (1, -1.5, 1))]:
        obj.location = center + Vector(direction).normalized() * size * 2
        obj.rotation_euler = (center - obj.location).to_track_quat('-Z', 'Y').to_euler()
        file = directory / (name + '.png')
        scene.render.filepath = str(file)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        files.append(file)
    return files
`;
