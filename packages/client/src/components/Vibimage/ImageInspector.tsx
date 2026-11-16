import { useTranslation } from 'react-i18next';
import { ScrollFade } from '../ScrollFade.js';
import { IMAGE_BLEND_MODES, type ImageBlendMode, type ImageDocument } from '../Creation/imageSource.js';
import { patchLayers, type ArrangeMode } from './imageArrange.js';
import { EditorButton } from './editorControls.js';
import { InspectorGroup, InspectorRow, InspectorSlider, SELECT } from './InspectorFields.js';
import { InspectorArrange } from './InspectorArrange.js';
import { InspectorCanvas } from './InspectorCanvas.js';
import { InspectorLayer, blendKey } from './InspectorLayer.js';
import { InspectorStyle } from './InspectorStyle.js';
import { imageLabelKey } from './imageLabels.js';
import { shortcutLabel } from '../../utils/platform.js';

/** Where a picture layer comes from (shown to the user; a 3D render is not "an imported photo"). */
export type ImageLayerOrigin = 'import' | 'model-render' | 'linked-image';
const ORIGIN_KEY: Readonly<Record<ImageLayerOrigin, string>> = { import: 'importedImage', 'model-render': 'modelRender', 'linked-image': 'linkedImage' };

interface ImageInspectorProps {
  doc: ImageDocument;
  selection: readonly string[];
  /** One edit; edits sharing `key` (typing in one field, one colour drag, one scrub) are one undo step. */
  onChange: (doc: ImageDocument, key?: string) => void;
  /** Ends the current grouped edit (focus left the field, the drag ended). */
  onEndEdit: () => void;
  origin: (layerId: string) => ImageLayerOrigin;
  onTools: () => void;
  onArrange: (mode: ArrangeMode) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  className?: string;
}

/** §5.13 (R-9) 레이어 편집기 ⑤ — 고른 것이 없으면 문서 설정, 하나면 그 레이어, 여럿이면 함께 거는 편집(정렬·분배·불투명도·혼합). */
export function ImageInspector({ doc, selection, onChange, onEndEdit, origin, onTools, onArrange, onDuplicate, onRemove, className = '' }: ImageInspectorProps): React.JSX.Element {
  const { t } = useTranslation(); const key = (label: string): string => t(imageLabelKey(label));
  const chosen = doc.layers.filter((layer) => selection.includes(layer.id));
  const layer = chosen.length === 1 ? chosen[0] : undefined;
  const ids = chosen.map((item) => item.id);
  const allLocked = chosen.length > 0 && chosen.every((item) => item.locked);
  const first = chosen[0];
  return <div className={`flex min-h-0 flex-1 flex-col text-xs ${className}`}>
    <ScrollFade fill>
      <div className="flex flex-col pb-2">
        {!chosen.length && <InspectorCanvas doc={doc} onChange={onChange} onEndEdit={onEndEdit} />}
        {layer && <>
          <InspectorLayer doc={doc} layer={layer} originKey={layer.kind === 'image' ? ORIGIN_KEY[origin(layer.id)] : layer.kind}
            onChange={onChange} onEndEdit={onEndEdit} />
          <InspectorArrange doc={doc} ids={ids} disabled={layer.locked} onChange={onChange} onArrange={onArrange} />
          <InspectorStyle doc={doc} layer={layer} onChange={onChange} onEndEdit={onEndEdit} onTools={onTools} />
        </>}
        {chosen.length > 1 && first && <>
          <InspectorGroup title={t('panel.apps.vibimage.editor.selectedCount', { count: chosen.length })} actions={<>
            <EditorButton icon="copy" label={key('duplicate')} shortcut={shortcutLabel('Ctrl+D')} disabled={allLocked} onClick={onDuplicate} />
            <EditorButton icon="trash" label={key('delete')} shortcut={shortcutLabel('Delete')} disabled={allLocked} onClick={onRemove} />
          </>}>
            {allLocked && <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">{key('lockedHint')}</p>}
          </InspectorGroup>
          <InspectorArrange doc={doc} ids={ids} disabled={allLocked} onChange={onChange} onArrange={onArrange} />
          <InspectorGroup title={key('layer')}>
            <InspectorSlider label={key('opacity')} value={first.opacity} disabled={allLocked}
              onPreview={(opacity) => onChange(patchLayers(doc, ids, { opacity }), `opacity:${ids.join(',')}`)} onEnd={onEndEdit} />
            <InspectorRow label={key('blend')}>
              <select className={SELECT} aria-label={key('blend')} value={chosen.every((item) => (item.blend ?? 'normal') === (first.blend ?? 'normal')) ? first.blend ?? 'normal' : ''}
                disabled={allLocked} onChange={(e) => onChange(patchLayers(doc, ids, { blend: e.target.value === 'normal' ? undefined : e.target.value as ImageBlendMode }))}>
                <option value="" disabled>—</option>
                {IMAGE_BLEND_MODES.map((mode) => <option key={mode} value={mode}>{key(blendKey(mode))}</option>)}
              </select>
            </InspectorRow>
          </InspectorGroup>
        </>}
      </div>
    </ScrollFade>
  </div>;
}
