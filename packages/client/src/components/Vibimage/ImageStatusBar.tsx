import { useTranslation } from 'react-i18next';
import { shortcutLabel } from '../../utils/platform.js';
import type { ImageDocument } from '../Creation/imageSource.js';
import { EditorButton } from './editorControls.js';
import { EditorIcon } from './editorIcons.js';
import { useCursorPoint, type CursorStore } from './editorCursor.js';
import { percentOf } from './editorViewport.js';
import { boxBounds, unionBounds } from './imageGeometry.js';
import type { EditorViewport } from './useEditorViewport.js';

interface ImageStatusBarProps {
  doc: ImageDocument;
  selection: readonly string[];
  viewport: EditorViewport;
  cursor: CursorStore;
}

/** 커서 좌표만 따로 구독한다 — 마우스가 움직일 때 상태 막대의 이 칸만 다시 그린다. */
function CursorReadout({ cursor }: { cursor: CursorStore }): React.JSX.Element {
  const point = useCursorPoint(cursor);
  return <span className="flex w-28 shrink-0 items-center gap-1 tabular-nums box-narrow:hidden">
    <EditorIcon name="cursor" className="h-3.5 w-3.5 shrink-0 text-gray-500" />
    {point ? `${Math.round(point.x)}, ${Math.round(point.y)}` : '—'}
  </span>;
}

/** §5.13 (R-9) 레이어 편집기 ① — 배율(축소·배율·확대·맞춤·100%) · 커서 좌표 · 선택 크기/각도 · 레이어 수. */
export function ImageStatusBar({ doc, selection, viewport, cursor }: ImageStatusBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const chosen = doc.layers.filter((layer) => selection.includes(layer.id));
  const bounds = unionBounds(chosen.map(boxBounds));
  const single = chosen.length === 1 ? chosen[0] : undefined;
  const scale = viewport.view.scale;
  return <footer className="flex h-8 shrink-0 items-center gap-2 overflow-hidden border-t border-gray-800 bg-gray-900 px-1.5 text-xs text-gray-400">
    <div role="toolbar" aria-label={t('panel.apps.vibimage.viewControls')} className="flex shrink-0 items-center gap-0.5">
      <EditorButton icon="zoomOut" label={t('panel.apps.vibimage.zoomOut')} shortcut="−" className="h-7 w-7" onClick={() => viewport.zoomStep(-1)} />
      <output aria-live="polite" className="w-12 text-center tabular-nums text-gray-200">{percentOf(scale)}</output>
      <EditorButton icon="zoom" label={t('panel.apps.vibimage.zoomIn')} shortcut="+" className="h-7 w-7" onClick={() => viewport.zoomStep(1)} />
      <EditorButton icon="fit" label={t('panel.apps.vibimage.fit')} shortcut={shortcutLabel('Shift+1')} active={viewport.fitted} className="h-7 w-7" onClick={viewport.fit} />
      <button type="button" title={`${t('panel.apps.vibimage.actualSize')} (${shortcutLabel('Shift+0')})`} aria-label={t('panel.apps.vibimage.actualSize')}
        aria-pressed={Math.abs(scale - 1) < 1e-6} onClick={viewport.actual}
        className={`flex h-7 shrink-0 items-center rounded-md px-1.5 font-semibold tabular-nums hover:bg-gray-800 hover:text-gray-100 ${Math.abs(scale - 1) < 1e-6 ? 'text-blue-400' : ''}`}>1:1</button>
    </div>
    <span aria-hidden="true" className="h-4 w-px shrink-0 bg-gray-800" />
    <CursorReadout cursor={cursor} />
    {bounds && <span className="flex min-w-0 shrink items-center gap-1 truncate tabular-nums text-gray-300">
      <EditorIcon name="frame" className="h-3.5 w-3.5 shrink-0 text-gray-500" />
      {`${Math.round(bounds.width)} × ${Math.round(bounds.height)}`}
      {single?.rotation ? ` · ${Number(single.rotation.toFixed(1))}°` : ''}
      {chosen.length > 1 ? ` · ${t('panel.apps.vibimage.editor.selectedCount', { count: chosen.length })}` : ''}
    </span>}
    <span className="ml-auto shrink-0 truncate tabular-nums box-narrow:hidden">{doc.width} × {doc.height}</span>
    <span className="shrink-0 tabular-nums">{t('panel.apps.vibimage.editor.layerCount', { count: doc.layers.length })}</span>
  </footer>;
}
