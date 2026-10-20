/** Preflight before allocating a Blender scene: editable native groups/meshes are supported, opaque objects are explicit errors. */
export const VIBI3D_SOURCE_OBJECTS_PY = String.raw`

def check_source_objects(source):
    def visit(node):
        kind = node.get('type', 'unknown')
        if kind not in ('Group', 'Object3D', 'Scene', 'Mesh'):
            raise ValueError('unsupported-source-object: ' + str(kind))
        for child in node.get('children', []):
            visit(child)
    visit(source['scene']['object'])
`;
