/** Pure Python merge code, appended to the exporter and exercised without a Blender dependency. */
export const VIBI3D_MERGE_PY = String.raw`

import copy

_ABSENT = object()

def _equal(left, right):
    return left is right or (left is not _ABSENT and right is not _ABSENT and left == right)

def _clone(value):
    return _ABSENT if value is _ABSENT else copy.deepcopy(value)

def _stable(item):
    return (item.get('id') or item.get('uuid')) if isinstance(item, dict) else None

def _pointer(key):
    return str(key).replace('~', '~0').replace('/', '~1')

def merge_source(base, current, generated, locked_paths=(), pointer=''):
    """Keep independent human edits. A shared edit fails instead of silently taking either side."""
    if pointer in locked_paths:
        return _clone(current)
    if generated is _ABSENT and any(p.startswith(pointer + '/') for p in locked_paths):
        return _clone(current)
    if _equal(base, current):
        # Descendant locks must still be visited when the generator changes this container.
        if not any(p.startswith(pointer + '/') for p in locked_paths):
            return _clone(generated)
    if _equal(base, generated) or _equal(current, generated):
        return _clone(current)
    if all(isinstance(v, dict) for v in (base, current, generated)):
        out = {}
        for key in dict.fromkeys([*generated, *current, *base]):
            result = merge_source(base.get(key, _ABSENT), current.get(key, _ABSENT),
                                  generated.get(key, _ABSENT), locked_paths, pointer + '/' + _pointer(key))
            if result is not _ABSENT:
                out[key] = result
        return out
    if all(isinstance(v, list) for v in (base, current, generated)):
        keys = [[_stable(item) for item in v] for v in (base, current, generated)]
        if all(all(k for k in ks) and len(set(ks)) == len(ks) for ks in keys):
            maps = [dict(zip(ks, v)) for ks, v in zip(keys, (base, current, generated))]
            out = []
            common = set(keys[0]) & set(keys[1]) & set(keys[2])
            orders = [[key for key in ks if key in common] for ks in keys]
            if orders[1] != orders[0] and orders[2] != orders[0] and orders[1] != orders[2]:
                raise ValueError('source-order-conflict: ' + pointer)
            preferred = keys[1] if orders[1] != orders[0] else keys[2]
            for key in dict.fromkeys([*preferred, *keys[2], *keys[1], *keys[0]]):
                result = merge_source(*(m.get(key, _ABSENT) for m in maps), locked_paths,
                                      pointer + '/@' + _pointer(key))
                if result is not _ABSENT:
                    out.append(result)
            return out
    raise ValueError('source-merge-conflict: ' + (pointer or '/'))

def merge_payload(base, current, generated, locked_paths):
    # Generation owns these three fields only. Preserve UI metadata, clips and unrelated parts via the merge.
    before = {key: base.get(key, []) for key in ('scene', 'clips')}
    now = {key: current.get(key, []) for key in ('scene', 'clips')}
    after = {key: generated.get(key, []) for key in ('scene', 'clips')}
    return {**copy.deepcopy(current), **merge_source(before, now, after, locked_paths), 'format': 'vibi3d', 'version': 1}

def source_checks(source, budget):
    import math
    def finite(value):
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError('non-finite-source')
        if isinstance(value, dict):
            for item in value.values(): finite(item)
        if isinstance(value, list):
            for item in value: finite(item)
    finite(source['scene'])
    geometries = {entry['uuid']: entry for entry in source['scene'].get('geometries', [])}
    ids, counts = set(), [0, 0]
    def visit(node):
        if node['uuid'] in ids:
            raise ValueError('duplicate-source-object-id')
        ids.add(node['uuid'])
        counts[0] += 1
        if counts[0] > 10000:
            raise ValueError('object-budget-exceeded')
        if node.get('geometry'):
            geometry = geometries[node['geometry']]
            if geometry.get('type') != 'BufferGeometry':
                raise ValueError('unsupported-source-geometry: use the built-in editor')
            data = geometry['data']
            positions = data['attributes']['position']['array']
            if not isinstance(positions, list) or len(positions) % 3:
                raise ValueError('invalid-position-array')
            index = data.get('index', {}).get('array')
            size = len(index) if index is not None else len(positions) // 3
            if size % 3 or size == 0:
                raise ValueError('invalid-triangle-array')
            if index is not None and any(type(i) not in (int, float) or i != int(i) or not 0 <= i < len(positions) // 3 for i in index):
                raise ValueError('invalid-mesh-index')
            counts[1] += size // 3
        for child in node.get('children', []): visit(child)
    visit(source['scene']['object'])
    if counts[1] > budget:
        raise ValueError('triangle-budget-exceeded-after-merge')
    return {'finite': True, 'triangles': counts[1], 'objects': max(0, counts[0] - 1),
            'triangleBudget': budget, 'visualReview': 'pending'}

def native_geometry_equal(left, right):
    # Blender bevel UVs can differ by one Float32 ULP across runs. This is ONLY the native-preview check;
    # merge/locks and published JSON retain the user's exact values and original blob references.
    import math
    if type(left) in (int, float) and type(right) in (int, float):
        return math.isclose(left, right, rel_tol=2e-7, abs_tol=2e-7)
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(native_geometry_equal(left[key], right[key]) for key in left)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(native_geometry_equal(a, b) for a, b in zip(left, right))
    return left == right
`;
