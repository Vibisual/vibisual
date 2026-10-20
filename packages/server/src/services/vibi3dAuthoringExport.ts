/** Blender's evaluated mesh becomes editable, stable-ID Three JSON; native modifiers remain in .blend. */
export const VIBI3D_EXPORT_PY = String.raw`import bpy, math, uuid, base64, json, struct
from mathutils import Matrix, Vector

SPACE = Matrix.Rotation(-math.pi / 2, 4, 'X')
NAMESPACE = uuid.UUID('6842a36d-7ea2-40ca-b1d1-ac5076139557')

def uid(name):
    return str(uuid.uuid5(NAMESPACE, name))

def linear_hex(color):
    def channel(value):
        srgb = value * 12.92 if value <= 0.0031308 else 1.055 * max(value, 0) ** (1 / 2.4) - 0.055
        return round(min(1, max(0, srgb)) * 255)
    r, g, b = [channel(value) for value in color[:3]]
    return (r << 16) + (g << 8) + b

def finite_values(values):
    if any(not math.isfinite(value) for value in values):
        raise ValueError('non-finite-geometry')
    return list(values)

def float32_values(values):
    values = finite_values(values)
    return list(struct.unpack('<' + str(len(values)) + 'f', struct.pack('<' + str(len(values)) + 'f', *values)))

def three_material(material, part, slot, output):
    identifier = uid('material:' + part + ':' + str(slot))
    rgba, roughness, metalness = (0.65, 0.65, 0.65, 1), 0.45, 0
    shader = None
    if material:
        rgba, roughness, metalness = material.diffuse_color, material.roughness, material.metallic
        if material.use_nodes:
            shader = next((node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'), None)
            if shader:
                rgba = shader.inputs['Base Color'].default_value
                roughness = shader.inputs['Roughness'].default_value
                metalness = shader.inputs['Metallic'].default_value
                rgba = (*rgba[:3], shader.inputs['Alpha'].default_value)
    value = {'uuid': identifier, 'type': 'MeshStandardMaterial', 'name': material.name if material else part,
             'color': linear_hex(rgba), 'roughness': float(roughness), 'metalness': float(metalness),
             'opacity': float(rgba[3]), 'transparent': rgba[3] < 1, 'side': 0, 'emissive': 0,
             'envMapRotation': [0, 0, 0, 'XYZ'], 'envMapIntensity': 1}
    if shader:
        socket = shader.inputs['Base Color']
        if socket.is_linked:
            node = socket.links[0].from_node
            if node.type != 'TEX_IMAGE' or not node.image:
                raise ValueError('bake-procedural-base-color-to-image-before-checkpoint: ' + material.name)
            image = node.image
            if max(image.size) > 4096:
                raise ValueError('texture-too-large: use at most 4096px')
            texture_file = output['directory'] / (identifier + '.png')
            image.save(filepath=str(texture_file), save_copy=True)
            image_id, texture_id = uid('image:' + identifier), uid('texture:' + identifier)
            output['images'].append({'uuid': image_id, 'url': 'data:image/png;base64,' + base64.b64encode(texture_file.read_bytes()).decode('ascii')})
            output['textures'].append({'uuid': texture_id, 'name': image.name, 'image': image_id, 'mapping': 300,
                                      'wrap': [1000, 1000], 'magFilter': 1006, 'minFilter': 1008,
                                      'colorSpace': 'srgb', 'flipY': True})
            value['map'] = texture_id
        for name in ('Metallic', 'Roughness', 'Normal', 'Alpha'):
            if shader.inputs[name].is_linked:
                raise ValueError('unsupported-linked-material-input: ' + name + '; bake or use constant PBR values')
    output['materials'].append(value)
    return identifier

def three_mesh(obj, part, output, budget):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=bpy.context.evaluated_depsgraph_get())
    try:
        mesh.calc_loop_triangles()
        count = len(mesh.loop_triangles)
        output['triangles'] += count
        if output['triangles'] > budget:
            raise ValueError('triangle-budget-exceeded: ' + str(budget))
        if not count:
            raise ValueError('empty-mesh: ' + part)
        position, normal, uv, groups = [], [], [], []
        uv_layer = mesh.uv_layers.active
        material_count = max(1, len(obj.material_slots))
        slots = [three_material(obj.material_slots[i].material if len(obj.material_slots) else None, part, i, output) for i in range(material_count)]
        triangles = sorted(mesh.loop_triangles, key=lambda tri: min(tri.material_index, material_count - 1))
        for triangle in triangles:
            slot = min(triangle.material_index, material_count - 1)
            start = len(position) // 3
            if not groups or groups[-1]['materialIndex'] != slot:
                groups.append({'start': start, 'count': 0, 'materialIndex': slot})
            groups[-1]['count'] += 3
            for loop_index in triangle.loops:
                loop = mesh.loops[loop_index]
                position.extend(SPACE.to_3x3() @ mesh.vertices[loop.vertex_index].co)
                normal.extend(SPACE.to_3x3() @ mesh.corner_normals[loop_index].vector)
                if uv_layer:
                    uv.extend(uv_layer.data[loop_index].uv)
        attributes = {'position': {'itemSize': 3, 'type': 'Float32Array', 'array': float32_values(position), 'normalized': False},
                      'normal': {'itemSize': 3, 'type': 'Float32Array', 'array': float32_values(normal), 'normalized': False}}
        if uv:
            attributes['uv'] = {'itemSize': 2, 'type': 'Float32Array', 'array': float32_values(uv), 'normalized': False}
        geometry_id = uid('geometry:' + part)
        output['geometries'].append({'uuid': geometry_id, 'type': 'BufferGeometry', 'data': {'attributes': attributes, 'groups': groups}})
        return geometry_id, slots
    finally:
        evaluated.to_mesh_clear()

def root_identity(root, previous):
    if previous is None:
        return root
    name = previous.get('name', '')
    if name:
        root['name'] = name
    else:
        root.pop('name', None)  # Match Object3D.toJSON's omitted empty name on the next save.
    identifier = previous.get('userData', {}).get('vibi3dId')
    if isinstance(identifier, str) and identifier:
        root['userData']['vibi3dId'] = identifier
    return root

def three_snapshot(root_uuid, budget, directory, previous_root=None):
    bpy.context.view_layer.update()
    output = {key: [] for key in ('geometries', 'materials', 'textures', 'images')}
    output.update(triangles=0, directory=directory)
    eligible = [obj for obj in bpy.context.scene.objects if obj.type in ('MESH', 'CURVE', 'FONT', 'SURFACE', 'META', 'EMPTY') and not obj.get('vibi3dHelper') and not obj.hide_render]
    ids = [obj.get('vibi3dId') for obj in eligible]
    if not ids or any(not isinstance(part, str) or not part for part in ids) or len(set(ids)) != len(ids):
        raise ValueError('assign-unique-stable-part-ids-with-ctx.part')
    allowed = set(eligible)
    def node(obj):
        part = obj['vibi3dId']
        matrix = obj.matrix_local if obj.parent in allowed else obj.matrix_world
        matrix = SPACE @ matrix @ SPACE.inverted()
        value = {'uuid': uid('object:' + part), 'type': 'Group', 'name': obj.name,
                 'matrix': finite_values([matrix[row][column] for column in range(4) for row in range(4)]),
                 'up': [0, 1, 0], 'layers': 1, 'userData': {'vibi3dId': part}}
        if obj.type != 'EMPTY':
            geometry, materials = three_mesh(obj, part, output, budget)
            value.update(type='Mesh', geometry=geometry, material=materials[0] if len(materials) == 1 else materials)
        children = [node(child) for child in obj.children if child in allowed]
        if children:
            value['children'] = children
        return value
    root = {'uuid': root_uuid, 'type': 'Group', 'name': 'Model', 'up': [0, 1, 0], 'layers': 1,
            'matrix': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            'userData': {'vibi3dId': 'root', 'vibi3dLighting': 1},
            'children': [node(obj) for obj in eligible if obj.parent not in allowed]}
    scene = {'metadata': {'version': 4.6, 'type': 'Object', 'generator': 'Vibi3D.BlenderWorker'}, 'object': root_identity(root, previous_root)}
    scene.update({key: output[key] for key in ('geometries', 'materials', 'textures', 'images') if output[key]})
    return {'format': 'vibi3d', 'version': 1, 'scene': scene, 'clips': []}, {
        'finite': True, 'triangles': output['triangles'], 'objects': len(eligible),
        'triangleBudget': budget, 'visualReview': 'pending'}
`;
