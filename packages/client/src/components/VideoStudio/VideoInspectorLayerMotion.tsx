import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VideoAsset, VideoItem } from '@vibisual/video';
import { isImageDocument, type ImageLayer } from '../Creation/imageSource.js';
import { StudioNumberField, STUDIO_INPUT_CLASS } from './StudioField.js';
import { assetUrl } from './assetUrl.js';
import { LAYER_MOTION_DEFAULT, LAYER_MOTION_PRESETS, readLayerMotions, type LayerMotion, type LayerMotionPreset } from './videoLayerMotion.js';

type LayerSummary = Pick<ImageLayer, 'id' | 'name' | 'kind'>;
const PRESET_KEYS: Readonly<Record<LayerMotionPreset, string>> = {
  none: 'panel.videoStudio.editor.options.none', zoom: 'panel.videoStudio.transitions.zoom', fade: 'panel.vibisound.fadeIn',
  rise: 'panel.videoStudio.editor.layerMotion.presets.rise', 'slide-left': 'panel.videoStudio.editor.layerMotion.presets.slideLeft',
  'slide-right': 'panel.videoStudio.editor.layerMotion.presets.slideRight',
};
const layerCache = new Map<string, Promise<LayerSummary[]>>();
/** The layers of an editable image asset (immutable once imported, so one read per asset path). */
function readLayers(project: string, path: string): Promise<LayerSummary[]> {
  const key = `${project}\u0000${path}`;
  let result = layerCache.get(key);
  if (!result) {
    result = fetch(assetUrl(project, path)).then(async (response) => {
      const doc: unknown = await response.json();
      if (!response.ok || !isImageDocument(doc)) throw new Error('image-source-invalid');
      return doc.layers.map(({ id, name, kind }) => ({ id, name, kind }));
    });
    result.catch(() => layerCache.delete(key));
    layerCache.set(key, result);
    if (layerCache.size > 32) layerCache.delete(layerCache.keys().next().value as string);
  }
  return result;
}

/**
 * §5.13 (R-10) — a still editable image becomes a moving scene layer by layer. The image source keeps every layer and
 * adjustment; each layer's motion (preset, delay, duration) is stored on this item as `props.layerMotion`.
 */
export function VideoInspectorLayerMotion({ project, item, asset, disabled, onUpdate }: {
  project: string; item: VideoItem; asset: VideoAsset | undefined; disabled?: boolean;
  onUpdate: (patch: Partial<Omit<VideoItem, 'id'>>) => void;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const path = asset?.source.kind === 'file' && /\.vibimage$/i.test(asset.source.path) ? asset.source.path : null;
  const [layers, setLayers] = useState<LayerSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!path) { setLayers(null); return undefined; }
    let stopped = false;
    setFailed(false);
    readLayers(project, path).then((list) => { if (!stopped) setLayers(list); }).catch(() => { if (!stopped) setFailed(true); });
    return () => { stopped = true; };
  }, [project, path]);
  if (!path) return null;
  const motions = readLayerMotions(item.props);
  const write = (id: string, motion: LayerMotion | null): void => {
    const next: Record<string, LayerMotion> = { ...motions };
    if (motion) next[id] = motion; else delete next[id];
    onUpdate({ props: { ...item.props, layerMotion: next } });
  };
  return <section className="space-y-3 border-t border-white/10 pt-3">
    <h3 className="text-xs font-semibold text-white/80">{t('panel.videoStudio.editor.layerMotion.title')}</h3>
    <p className="text-[12px] text-white/50">{t('panel.videoStudio.editor.layerMotion.hint')}</p>
    {failed && <p role="alert" className="text-[12px] text-amber-200/80">{t('panel.creation.errors.imageSourceInvalid')}</p>}
    {layers?.map((layer) => {
      const motion = motions[layer.id];
      const preset: LayerMotionPreset = motion?.preset ?? 'none';
      return <div key={layer.id} className="space-y-2 rounded border border-white/10 p-2">
        <label className="block space-y-1 text-xs text-white/60">
          <span className="break-words">{layer.name || layer.id}</span>
          <select aria-label={`${layer.name || layer.id} · ${t('panel.options.tokenSaver.preset')}`} className={STUDIO_INPUT_CLASS} value={preset} disabled={disabled}
            onChange={(event) => {
              const value = LAYER_MOTION_PRESETS.find((name) => name === event.target.value) ?? 'none';
              write(layer.id, value === 'none' ? null : { ...(motion ?? LAYER_MOTION_DEFAULT), preset: value });
            }}>
            {LAYER_MOTION_PRESETS.map((name) => <option key={name} value={name}>{t(PRESET_KEYS[name])}</option>)}
          </select>
        </label>
        {motion && <div className="grid grid-cols-2 gap-2">
          <StudioNumberField label={t('panel.videoStudio.editor.layerMotion.delay')} value={motion.delay} min={0} max={600} disabled={disabled}
            onCommit={(delay) => write(layer.id, { ...motion, delay })} />
          <StudioNumberField label={t('panel.videoStudio.editor.duration')} value={motion.duration} min={0.05} max={600} disabled={disabled}
            onCommit={(duration) => write(layer.id, { ...motion, duration })} />
        </div>}
      </div>;
    })}
  </section>;
}
