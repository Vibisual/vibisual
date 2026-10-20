import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreationDocSummary } from '@vibisual/shared';
import { IMAGE_RATIOS } from '../Creation/imageSource.js';
import { shortcutLabel } from '../../utils/platform.js';
import { imageLabelKey } from './imageLabels.js';

interface ImageToolbarProps {
  title: string; onTitle: (value: string) => void; docs: CreationDocSummary[]; id: string;
  busy: boolean; dirty: boolean; canUndo: boolean; canRedo: boolean;
  onOpen: (id: string) => void; onNew: () => void; onSave: () => void; onUndo: () => void; onRedo: () => void;
  onAdd: (kind: 'text' | 'shape') => void; onImport: (file: File) => void; onExport: (kind: 'png' | 'svg', variants: boolean) => void;
  onTools: () => void;
  /** Back to the picture this source was made from (R-9 viewer); absent when there is none. */
  onOriginal?: () => void;
}
/** The derived formats, as the user will receive them. */
export const IMAGE_VARIANT_SIZES = Object.values(IMAGE_RATIOS).map(([w, h]) => `${w}×${h}`).join(' · ');

export function ImageToolbar(props: ImageToolbarProps): React.JSX.Element {
  const { t } = useTranslation(); const key = (label: string): string => t(imageLabelKey(label));
  const fileInput = useRef<HTMLInputElement>(null);
  const button = (label: string, action: () => void, disabled = props.busy, title?: string): React.JSX.Element =>
    <button type="button" title={title} className="shrink-0 whitespace-nowrap rounded bg-white/5 px-2 py-1.5 hover:bg-white/10 disabled:opacity-35 pointer-coarse:py-2" onClick={action} disabled={disabled}>{key(label)}</button>;
  // 폰 폭(box-narrow)에서는 여러 줄로 접히며 무대를 밀어내지 않게 한 줄 가로 스크롤로 — 단추는 하나도 빼지 않는다.
  return <div className="scrollbar-thin flex shrink-0 flex-wrap items-center gap-1.5 border-b border-white/10 px-3 py-2 text-xs box-narrow:flex-nowrap box-narrow:overflow-x-auto">
    <select className="max-w-40 shrink-0 rounded bg-gray-900 p-1.5 pointer-coarse:p-2" aria-label={key('open')} value={props.id} disabled={props.busy || props.dirty} onChange={(e) => props.onOpen(e.target.value)}>
      <option value="">{key('open')}</option>{props.docs.map((doc) => <option value={doc.id} key={doc.id}>{doc.title || doc.id}</option>)}
    </select>
    <input className="w-36 shrink-0 rounded border border-white/10 bg-gray-900 px-2 py-1.5 box-narrow:w-28 pointer-coarse:py-2" aria-label={key('title')} value={props.title} placeholder={key('title')}
      onChange={(e) => props.onTitle(e.target.value)} />
    {button('new', props.onNew, props.busy || props.dirty)}
    {button('save', props.onSave, props.busy, shortcutLabel('Ctrl+S'))}
    {button('undo', props.onUndo, props.busy || !props.canUndo, shortcutLabel('Ctrl+Z'))}
    {button('redo', props.onRedo, props.busy || !props.canRedo, shortcutLabel('Ctrl+Shift+Z'))}
    {button('addText', () => props.onAdd('text'))}{button('addShape', () => props.onAdd('shape'))}{button('import', () => fileInput.current?.click())}
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,application/json,.vibimage.json" className="hidden"
      onChange={(e) => { const file = e.target.files?.[0]; if (file) props.onImport(file); e.target.value = ''; }} />
    {button('png', () => props.onExport('png', false))}{button('svg', () => props.onExport('svg', false))}
    {button('variants', () => props.onExport('png', true), props.busy, IMAGE_VARIANT_SIZES)}
    {button('variantsSvg', () => props.onExport('svg', true), props.busy, IMAGE_VARIANT_SIZES)}
    {/* 안내 글이라 폰 폭에서만 접는다 — 같은 크기 목록은 파생 단추의 title 에도 있다. */}
    <span className="text-gray-500 box-narrow:hidden">{t('panel.apps.vibimage.editor.variantSizes', { sizes: IMAGE_VARIANT_SIZES })}</span>
    {button('photoTools', props.onTools)}{props.onOriginal && button('original', props.onOriginal)}
  </div>;
}
