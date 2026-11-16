import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shortcutLabel } from '../../utils/platform.js';
import { ScrollFade } from '../ScrollFade.js';
import { patchImageLayer, type ImageDocument, type ImageLayer } from '../Creation/imageSource.js';
import { moveLayerToIndex, type ArrangeMode } from './imageArrange.js';
import { EditorButton } from './editorControls.js';
import { EditorIcon, type EditorIconName } from './editorIcons.js';
import { imageLabelKey } from './imageLabels.js';

interface ImageLayersPanelProps {
  doc: ImageDocument;
  selection: readonly string[];
  busy: boolean;
  onSelect: (ids: string[]) => void;
  onChange: (doc: ImageDocument) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onArrange: (mode: ArrangeMode) => void;
}

export const LAYER_ICON = (layer: ImageLayer): EditorIconName => layer.kind === 'text' ? 'text' : layer.kind === 'image' ? 'image' : layer.shape === 'ellipse' ? 'ellipse' : 'rect';

/**
 * 레이어 줄 하나 끌기 — 놓을 자리는 배열 칸(0 = 맨 뒤). 패널은 위가 앞이라 줄의 위 절반은 그 줄 앞(배열 다음 칸)이다.
 * 포인터는 실제로 끌기 시작할 때 목록이 잡는다 — 누르자마자 줄이 잡으면 두 번 누르기(이름 바꾸기)가 줄로 가 이름표에 닿지 않는다.
 */
interface Drag { id: string; y: number; slot: number | null; active: boolean }

/**
 * §5.13 (R-9) 레이어 편집기 ④ — 위가 앞. 눈·자물쇠 토글, 두 번 눌러 이름 바꾸기, 끌어 순서 바꾸기, Shift 범위·Ctrl/⌘ 더하기 선택.
 * 맨 아래 「캔버스」 줄은 선택을 풀어 속성 패널을 문서 설정으로 돌린다.
 */
export function ImageLayersPanel({ doc, selection, busy, onSelect, onChange, onDuplicate, onRemove, onArrange }: ImageLayersPanelProps): React.JSX.Element {
  const { t } = useTranslation(); const key = (label: string): string => t(imageLabelKey(label));
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const anchor = useRef('');
  const list = useRef<HTMLDivElement>(null);
  // Esc 로 닫은 이름 칸이 사라지며 blur 를 내도 옛 초안을 반영하지 않는다.
  const renameCancelled = useRef(false);
  const rows = [...doc.layers].reverse();
  const chosen = doc.layers.filter((layer) => selection.includes(layer.id));
  const editable = chosen.some((layer) => !layer.locked) && !busy;
  const pick = (event: React.MouseEvent, layer: ImageLayer): void => {
    if (event.shiftKey && anchor.current) {
      const a = rows.findIndex((row) => row.id === anchor.current); const b = rows.findIndex((row) => row.id === layer.id);
      if (a >= 0 && b >= 0) { onSelect(rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((row) => row.id)); return; }
    }
    anchor.current = layer.id;
    if (event.ctrlKey || event.metaKey) onSelect(selection.includes(layer.id) ? selection.filter((id) => id !== layer.id) : [...selection, layer.id]);
    else onSelect([layer.id]);
  };
  const rename = (): void => {
    if (renameCancelled.current) { renameCancelled.current = false; setRenaming(null); return; }
    if (renaming) { const layer = doc.layers.find((item) => item.id === renaming.id); if (layer && renaming.draft.trim() && renaming.draft !== layer.name) onChange(patchImageLayer(doc, layer.id, { name: renaming.draft.trim() })); }
    setRenaming(null);
  };
  const slotAt = (clientX: number, clientY: number): number | null => {
    const row = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-layer-row]');
    if (!row) return null;
    const index = Number(row.dataset.layerRow);
    const rect = row.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2 ? index + 1 : index;
  };
  const toggle = (layer: ImageLayer, patch: Partial<ImageLayer>): void => { if (!busy) onChange(patchImageLayer(doc, layer.id, patch)); };
  return <div className="flex min-h-0 flex-1 flex-col">
    <ScrollFade fill className="min-h-16">
      <div ref={list} role="listbox" aria-label={key('layers')} aria-multiselectable="true" className="flex flex-col gap-px px-1.5 py-1"
        onPointerMove={(event) => {
          // 목록 밖에서 손을 뗐으면 끌기는 이미 끝났다.
          if (drag && !(event.buttons & 1)) { setDrag(null); return; }
          if (!drag || Math.abs(event.clientY - drag.y) < 4) return;
          if (!drag.active) list.current?.setPointerCapture(event.pointerId);
          const slot = slotAt(event.clientX, event.clientY);
          if (slot !== drag.slot || !drag.active) setDrag({ ...drag, slot, active: true });
        }}
        onPointerUp={() => { if (drag?.active && drag.slot !== null) onChange(moveLayerToIndex(doc, drag.id, drag.slot)); setDrag(null); }}
        onPointerCancel={() => setDrag(null)}>
        {rows.map((layer) => {
          const index = doc.layers.indexOf(layer);
          const selected = selection.includes(layer.id);
          return <div key={layer.id} role="option" aria-selected={selected} data-layer-row={index}
            className={`group relative flex h-8 shrink-0 cursor-default items-center gap-1 rounded-md pr-1 text-xs pointer-coarse:h-10 ${
              selected ? 'bg-blue-600/25 text-white' : 'text-gray-300 hover:bg-gray-800'} ${layer.visible ? '' : 'text-gray-500'}`}
            onClick={(event) => pick(event, layer)}
            onPointerDown={(event) => {
              if (event.button !== 0 || busy || layer.locked || (event.target as Element).closest('button,input')) return;
              setDrag({ id: layer.id, y: event.clientY, slot: null, active: false });
            }}>
            {drag?.active && drag.slot === index + 1 && drag.id !== layer.id && <span aria-hidden="true" className="absolute inset-x-1 -top-px h-0.5 rounded bg-blue-500" />}
            {drag?.active && drag.slot === index && index === 0 && drag.id !== layer.id && <span aria-hidden="true" className="absolute inset-x-1 -bottom-px h-0.5 rounded bg-blue-500" />}
            <button type="button" aria-pressed={layer.visible} aria-label={key('visible')} title={key('visible')} disabled={busy || layer.locked}
              onClick={(event) => { event.stopPropagation(); toggle(layer, { visible: !layer.visible }); }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 hover:text-gray-100 disabled:opacity-40 pointer-coarse:h-9 pointer-coarse:w-9">
              <EditorIcon name={layer.visible ? 'eye' : 'eyeOff'} className="h-3.5 w-3.5" />
            </button>
            <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded border border-gray-700 bg-gray-950 text-gray-300">
              <EditorIcon name={LAYER_ICON(layer)} className="h-3.5 w-3.5" />
              {layer.kind !== 'image' && <svg aria-hidden="true" viewBox="0 0 6 6" className="absolute -bottom-0.5 -right-0.5 h-2 w-2"><rect width="6" height="6" rx="1" fill={layer.fill} className="stroke-gray-900" /></svg>}
            </span>
            {renaming?.id === layer.id
              ? <input autoFocus value={renaming.draft} aria-label={key('name')} className="h-6 min-w-0 flex-1 rounded border border-blue-500 bg-gray-950 px-1 text-xs text-gray-100 outline-none"
                onChange={(event) => setRenaming({ id: layer.id, draft: event.target.value })} onBlur={rename}
                onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') rename(); if (event.key === 'Escape') { renameCancelled.current = true; setRenaming(null); } }} />
              : <span className="min-w-0 flex-1 truncate pl-1" title={layer.name}
                onDoubleClick={() => { if (!layer.locked && !busy) setRenaming({ id: layer.id, draft: layer.name }); }}>{layer.name || key(layer.kind)}</span>}
            <button type="button" aria-pressed={layer.locked} aria-label={key('lock')} title={key('lock')} disabled={busy}
              onClick={(event) => { event.stopPropagation(); toggle(layer, { locked: !layer.locked }); }}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded hover:text-gray-100 pointer-coarse:h-9 pointer-coarse:w-9 pointer-coarse:opacity-100 ${
                layer.locked ? 'text-amber-300' : 'text-gray-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}>
              <EditorIcon name={layer.locked ? 'lock' : 'unlock'} className="h-3.5 w-3.5" />
            </button>
          </div>;
        })}
        <button type="button" onClick={() => onSelect([])}
          className={`flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-left text-xs pointer-coarse:h-10 ${selection.length ? 'text-gray-400 hover:bg-gray-800' : 'bg-blue-600/25 text-white'}`}>
          <EditorIcon name="frame" className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{key('canvas')}</span>
          <span className="shrink-0 tabular-nums text-gray-500">{doc.width} × {doc.height}</span>
        </button>
      </div>
    </ScrollFade>
    <div className="flex shrink-0 items-center gap-0.5 border-t border-gray-800 px-1.5 py-1">
      <span className="min-w-0 flex-1 truncate pl-1 text-xs tabular-nums text-gray-500">{t('panel.apps.vibimage.editor.layerCount', { count: doc.layers.length })}</span>
      <EditorButton icon="copy" label={key('duplicate')} shortcut={shortcutLabel('Ctrl+D')} disabled={!editable} onClick={onDuplicate} />
      <EditorButton icon="arrowUp" label={key('forward')} shortcut={shortcutLabel('Ctrl+]')} disabled={!editable} onClick={() => onArrange('forward')} />
      <EditorButton icon="arrowDown" label={key('backward')} shortcut={shortcutLabel('Ctrl+[')} disabled={!editable} onClick={() => onArrange('backward')} />
      <EditorButton icon="trash" label={key('delete')} shortcut={shortcutLabel('Delete')} disabled={!editable} onClick={onRemove} />
    </div>
  </div>;
}
