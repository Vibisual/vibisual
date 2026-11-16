import { useTranslation } from 'react-i18next';
import { EDITOR_TOOLS, type EditorTool } from './editorTools.js';
import { EditorButton, EditorDivider } from './editorControls.js';
import { imageLabelKey } from './imageLabels.js';

interface ImageToolRailProps {
  tool: EditorTool;
  onTool: (tool: EditorTool) => void;
  onPlaceImage: () => void;
  disabled: boolean;
}

/** §5.13 (R-9) 레이어 편집기 ① — 왼쪽 도구 막대. 폰 폭이면 무대 위 가로줄로 눕는다(입구는 그대로). */
export function ImageToolRail({ tool, onTool, onPlaceImage, disabled }: ImageToolRailProps): React.JSX.Element {
  const { t } = useTranslation();
  const key = (label: string): string => t(imageLabelKey(label));
  return (
    <nav aria-label={key('tools')}
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-gray-800 bg-gray-900 py-2 box-narrow:w-full box-narrow:flex-row box-narrow:justify-center box-narrow:border-b box-narrow:border-r-0 box-narrow:px-2 box-narrow:py-1">
      {EDITOR_TOOLS.map((spec, index) => <span key={spec.id} className="contents">
        {index === 3 && <EditorDivider vertical />}
        <EditorButton icon={spec.icon} label={key(spec.label)} shortcut={spec.keys.map((k) => k.toUpperCase()).join(' / ')}
          active={tool === spec.id} disabled={disabled && spec.id !== 'hand' && spec.id !== 'zoom'} onClick={() => onTool(spec.id)} />
      </span>)}
      <EditorDivider vertical />
      <EditorButton icon="imagePlus" label={key('placeImage')} disabled={disabled} onClick={onPlaceImage} />
    </nav>
  );
}
