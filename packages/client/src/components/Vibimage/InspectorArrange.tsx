import { useTranslation } from 'react-i18next';
import { shortcutLabel } from '../../utils/platform.js';
import type { ImageDocument } from '../Creation/imageSource.js';
import { alignLayers, distributeLayers, type AlignMode, type ArrangeMode } from './imageArrange.js';
import { EditorButton } from './editorControls.js';
import type { EditorIconName } from './editorIcons.js';
import { InspectorGroup } from './InspectorFields.js';
import { imageLabelKey } from './imageLabels.js';

const ALIGN: readonly { mode: AlignMode; icon: EditorIconName; label: string }[] = [
  { mode: 'left', icon: 'alignLeft', label: 'alignLeft' },
  { mode: 'hcenter', icon: 'alignHCenter', label: 'centerHorizontal' },
  { mode: 'right', icon: 'alignRight', label: 'alignRight' },
  { mode: 'top', icon: 'alignTop', label: 'alignTop' },
  { mode: 'vcenter', icon: 'alignVCenter', label: 'centerVertical' },
  { mode: 'bottom', icon: 'alignBottom', label: 'alignBottom' },
];
const ARRANGE: readonly { mode: ArrangeMode; icon: EditorIconName; label: string; shortcut: string }[] = [
  { mode: 'front', icon: 'toFront', label: 'bringToFront', shortcut: 'Ctrl+Shift+]' },
  { mode: 'forward', icon: 'arrowUp', label: 'forward', shortcut: 'Ctrl+]' },
  { mode: 'backward', icon: 'arrowDown', label: 'backward', shortcut: 'Ctrl+[' },
  { mode: 'back', icon: 'toBack', label: 'sendToBack', shortcut: 'Ctrl+Shift+[' },
];

/** §5.13 (R-9) 레이어 편집기 ⑤ — 정렬(1개 = 캔버스, 여럿 = 선택 상자)·분배(3개 이상)·앞뒤 순서. */
export function InspectorArrange({ doc, ids, disabled, onChange, onArrange }: {
  doc: ImageDocument; ids: readonly string[]; disabled: boolean; onChange: (doc: ImageDocument) => void; onArrange: (mode: ArrangeMode) => void;
}): React.JSX.Element {
  const { t } = useTranslation(); const key = (label: string): string => t(imageLabelKey(label));
  return (
    <InspectorGroup title={key(ids.length > 1 ? 'alignSelection' : 'alignCanvas')}>
      <div className="flex flex-wrap items-center gap-0.5">
        {ALIGN.map((item) => <EditorButton key={item.mode} icon={item.icon} label={key(item.label)} disabled={disabled}
          onClick={() => onChange(alignLayers(doc, ids, item.mode))} />)}
        {ids.length >= 3 && <>
          <EditorButton icon="distributeH" label={key('distributeHorizontal')} disabled={disabled} onClick={() => onChange(distributeLayers(doc, ids, 'x'))} />
          <EditorButton icon="distributeV" label={key('distributeVertical')} disabled={disabled} onClick={() => onChange(distributeLayers(doc, ids, 'y'))} />
        </>}
      </div>
      <div className="flex flex-wrap items-center gap-0.5">
        {ARRANGE.map((item) => <EditorButton key={item.mode} icon={item.icon} label={key(item.label)} shortcut={shortcutLabel(item.shortcut)}
          disabled={disabled} onClick={() => onArrange(item.mode)} />)}
      </div>
    </InspectorGroup>
  );
}
