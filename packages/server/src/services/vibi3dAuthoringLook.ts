import { VIBI3D_LOOK_PRESETS } from '@vibisual/shared';

/** The Blender preview does not implement the native sky/postprocessing; never silently substitute its studio. */
export const VIBI3D_SOURCE_LOOK_PY = String.raw`
def check_source_look(source):
    import copy, json
    data = source.get('scene', {}).get('object', {}).get('userData', {})
    look = data.get('vibi3dLook')
    if not isinstance(look, dict):
        return
    baseline = json.loads(${JSON.stringify(JSON.stringify(VIBI3D_LOOK_PRESETS.studio))})
    baseline['intensity'] = data.get('vibi3dLighting', 1)
    resolved = copy.deepcopy(baseline)
    for key, value in look.items():
        if key == 'quality':
            continue
        if key not in resolved:
            raise ValueError('unsupported-source-look-requires-native-render')
        if isinstance(resolved[key], dict):
            if isinstance(value, bool) and key != 'sun':
                resolved[key]['enabled'] = value
            elif isinstance(value, dict):
                resolved[key].update(value)
            else:
                raise ValueError('unsupported-source-look-requires-native-render')
        else:
            resolved[key] = value
    for key in ('shadows', 'ao', 'bloom', 'fog'):
        if not resolved[key].get('enabled'):
            resolved[key] = baseline[key]
    for key in ('sun', 'fog'):
        if isinstance(resolved[key].get('color'), str):
            resolved[key]['color'] = resolved[key]['color'].lower()
    if resolved != baseline:
        raise ValueError('unsupported-source-look-requires-native-render; use Vibi3D native capture/still/video')
`;
