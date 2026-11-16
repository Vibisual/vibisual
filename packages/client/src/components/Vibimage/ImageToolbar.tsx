import { useTranslation } from 'react-i18next';
import type { CreationDocSummary } from '@vibisual/shared';
import { useScrollReveal } from '../../hooks/useScrollReveal.js';
import { IMAGE_RATIOS } from '../Creation/imageSource.js';
import { shortcutLabel } from '../../utils/platform.js';
import { EditorButton, EditorDivider, EditorMenuButton } from './editorControls.js';
import { EditorIcon } from './editorIcons.js';
import { imageLabelKey } from './imageLabels.js';

interface ImageToolbarProps {
  title: string; onTitle: (value: string) => void; docs: CreationDocSummary[]; id: string;
  busy: boolean; dirty: boolean; canUndo: boolean; canRedo: boolean;
  onOpen: (id: string) => void; onNew: () => void; onSave: () => void; onUndo: () => void; onRedo: () => void;
  onAdd: (kind: 'text' | 'shape', shape?: 'rect' | 'ellipse') => void;
  /** 그림·원본 파일 고르기를 연다. */
  onImport: () => void;
  onExport: (kind: 'png' | 'svg', variants: boolean) => void;
  onTools: () => void;
  /** 사진 도구는 그림 레이어(또는 판 전체)에만 — 글자·도형만 고른 동안은 끈다. */
  toolsDisabled?: boolean;
  /** Back to the picture this source was made from (R-9 viewer); absent when there is none. */
  onOriginal?: () => void;
}
/** The derived formats, as the user will receive them. */
export const IMAGE_VARIANT_SIZES = Object.values(IMAGE_RATIOS).map(([w, h]) => `${w}×${h}`).join(' · ');

/**
 * §5.13 (R-9) 레이어 편집기 ① — 명령 막대. 원본(열기·제목·새로) | 저장·되돌리기 | 넣기·가져오기·내보내기 | 사진 도구·원본 보기.
 * 좁으면 한 줄 그대로 가로로 굴러간다 — 단추는 하나도 빼지 않는다.
 */
export function ImageToolbar(props: ImageToolbarProps): React.JSX.Element {
  const { t } = useTranslation(); const key = (label: string): string => t(imageLabelKey(label));
  const scrollReveal = useScrollReveal();
  return <div role="toolbar" aria-label={key('commands')} {...scrollReveal}
    className="scrollbar-thin flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-gray-800 bg-gray-900 px-2 text-xs">
    <label className="flex h-8 shrink-0 items-center gap-1 rounded-md pl-1.5 text-gray-400 hover:bg-gray-800 focus-within:bg-gray-800" title={key('open')}>
      <EditorIcon name="open" />
      <select className="h-full max-w-36 cursor-pointer bg-transparent pr-1 text-xs text-gray-200 outline-none disabled:cursor-not-allowed disabled:text-gray-600 box-narrow:max-w-24"
        aria-label={key('open')} value={props.id} disabled={props.busy || props.dirty} onChange={(e) => props.onOpen(e.target.value)}>
        <option value="">{key('open')}</option>{props.docs.map((doc) => <option value={doc.id} key={doc.id}>{doc.title || doc.id}</option>)}
      </select>
    </label>
    <input className="h-8 w-44 shrink-0 rounded-md border border-transparent bg-transparent px-2 text-[13px] font-medium text-gray-100 outline-none hover:border-gray-700 focus:border-blue-500 focus:bg-gray-950 box-compact:w-32 box-narrow:w-24"
      aria-label={key('title')} value={props.title} placeholder={key('title')} onChange={(e) => props.onTitle(e.target.value)} />
    <EditorButton icon="newFile" label={key('new')} disabled={props.busy || props.dirty} onClick={props.onNew} />
    <EditorDivider />
    <EditorButton icon="save" label={key('save')} shortcut={shortcutLabel('Ctrl+S')} dot={props.dirty} disabled={props.busy} onClick={props.onSave} />
    <EditorButton icon="undo" label={key('undo')} shortcut={shortcutLabel('Ctrl+Z')} disabled={props.busy || !props.canUndo} onClick={props.onUndo} />
    <EditorButton icon="redo" label={key('redo')} shortcut={shortcutLabel('Ctrl+Shift+Z')} disabled={props.busy || !props.canRedo} onClick={props.onRedo} />
    <EditorDivider />
    <EditorMenuButton icon="plus" label={key('insert')} disabled={props.busy} items={[
      { id: 'text', icon: 'text', label: key('addText'), hint: 'T', onSelect: () => props.onAdd('text') },
      { id: 'rect', icon: 'rect', label: key('addRect'), hint: 'R', onSelect: () => props.onAdd('shape', 'rect') },
      { id: 'ellipse', icon: 'ellipse', label: key('addEllipse'), hint: 'O', onSelect: () => props.onAdd('shape', 'ellipse') },
      { id: 'image', icon: 'imagePlus', label: key('placeImage'), onSelect: props.onImport },
    ]} />
    <EditorButton icon="upload" label={key('import')} disabled={props.busy} onClick={props.onImport} />
    <EditorMenuButton icon="download" label={key('export')} disabled={props.busy} items={[
      { id: 'png', icon: 'image', label: key('png'), hint: 'PNG', onSelect: () => props.onExport('png', false) },
      { id: 'svg', icon: 'image', label: key('svg'), hint: 'SVG', onSelect: () => props.onExport('svg', false) },
      { id: 'variants', icon: 'frame', label: key('variants'), hint: IMAGE_VARIANT_SIZES, onSelect: () => props.onExport('png', true) },
      { id: 'variantsSvg', icon: 'frame', label: key('variantsSvg'), hint: IMAGE_VARIANT_SIZES, onSelect: () => props.onExport('svg', true) },
    ]} />
    <EditorDivider />
    <EditorButton icon="wand" label={key('photoTools')} text={key('photoToolsShort')} className="box-compact:w-8 box-compact:px-0" textClassName="box-compact:hidden"
      disabled={props.busy || props.toolsDisabled} onClick={props.onTools} />
    {props.onOriginal && <EditorButton icon="image" label={key('original')} disabled={props.busy} onClick={props.onOriginal} />}
  </div>;
}
