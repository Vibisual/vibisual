/** Keep basic legacy PBR export; native-only effects fail with exact fields instead of silently losing their look. */
export const VIBI3D_SOURCE_MATERIAL_PY = String.raw`
def check_source_material(value, textures):
    unsupported = [key for key in value if key.endswith('Map') and value[key] and key != 'envMap']
    if unsupported:
        raise ValueError('unsupported-source-material-map: ' + ','.join(sorted(unsupported)) + '; use Vibi3D native rendering')
    physical = [key for key in ('transmission', 'clearcoat') if value.get(key, 0) != 0]
    if value.get('ior', 1.5) != 1.5:
        physical.append('ior')
    if physical:
        raise ValueError('unsupported-source-material-physical: ' + ','.join(physical) + '; use Vibi3D native rendering')
    effects = []
    if value.get('emissive', 0) and value.get('emissiveIntensity', 1) > 0:
        effects.append('emissive')
    if value.get('alphaTest', 0) > 0:
        effects.append('alphaTest')
    if value.get('side', 0) != 0:
        effects.append('side')
    if value.get('envMapIntensity', 1) != 1:
        effects.append('envMapIntensity')
    if value.get('polygonOffset') and (value.get('polygonOffsetFactor', 0) or value.get('polygonOffsetUnits', 0)):
        effects.append('polygonOffset')
    if effects:
        raise ValueError('unsupported-source-material-property: ' + ','.join(effects) + '; use Vibi3D native rendering')
    if value.get('map'):
        texture = textures[value['map']]
        transforms = [key for key, default in [('repeat', [1, 1]), ('offset', [0, 0]), ('rotation', 0)] if texture.get(key, default) != default]
        if transforms:
            raise ValueError('unsupported-source-texture-transform: ' + ','.join(transforms) + '; use Vibi3D native rendering')
`;
