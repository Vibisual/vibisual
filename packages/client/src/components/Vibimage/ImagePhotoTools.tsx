import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageLightboxView } from '../IDE/ImageAnnotator.js';
import type { ImageLightboxState } from '../../stores/graphStore.js';
import { blobDataUrl, renderImageBlob } from '../Creation/imageRender.js';
import type { ImageDocument } from '../Creation/imageSource.js';

interface ImagePhotoToolsProps {
  root: string; doc: ImageDocument; selected: string; agentId: string;
  /** The edited picture, inline; it reaches the disk only when the source is saved (as a content-addressed blob). */
  onApply: (id: string, source: string) => void;
  onClose: () => void;
}
/**
 * §5.5 #17-25 tools on one picture layer (or the whole canvas). Nothing is written before or during the edit:
 * the result comes back through `onApplyImage` and becomes the layer's new picture in the draft.
 */
export function ImagePhotoTools({ root, doc, selected, agentId, onApply, onClose }: ImagePhotoToolsProps): React.JSX.Element {
  const { t } = useTranslation();
  const [state, setState] = useState<ImageLightboxState | null>(null);
  const [failed, setFailed] = useState(false);
  const layer = doc.layers.find((item) => item.id === selected && item.kind === 'image' && !item.locked);
  useEffect(() => {
    let cancelled = false; let src = '';
    const photo: ImageDocument = layer ? {
      ...doc, width: Math.max(16, Math.min(8192, Math.ceil(layer.width))), height: Math.max(16, Math.min(8192, Math.ceil(layer.height))),
      background: 'transparent', layers: [{ ...layer, x: 0, y: 0, opacity: 1, visible: true }],
    } : doc;
    void renderImageBlob(photo, root, 'png').then((blob) => {
      if (cancelled) return;
      src = URL.createObjectURL(blob);
      setState({ url: src, origin: { slot: 'vibimage', cell: null } });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (src) URL.revokeObjectURL(src); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, doc, selected]);
  if (state) {
    return <ImageLightboxView state={state} agentId={agentId} activeSessionId={null} canAttach={!!agentId} onClose={onClose}
      onApplyImage={layer ? async (png) => { onApply(layer.id, await blobDataUrl(png)); } : undefined} />;
  }
  return <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-950/95 text-xs"><div>
    <p>{t(failed ? 'panel.apps.vibimage.loadFailed' : 'ide.explorer.loading')}</p>
    <button type="button" className="mt-3 rounded bg-white/10 p-2" onClick={onClose}>{t('panel.apps.vibimage.editor.back')}</button>
  </div></div>;
}
