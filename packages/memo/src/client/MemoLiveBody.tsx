import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type JSX, type MouseEvent, type ReactNode } from 'react';
import { blockAt, endRange, rangeOf, sourceOffset, splitBlocks, type LiveBlock, type LiveRange } from './liveBlocks.js';
import type { BodyCaret } from './MemoBody.js';
import { liveSelection } from './liveSelection.js';

type Markdown = ComponentType<{ text: string; onToggleTask?: (offset: number) => void }>;
interface MemoLiveBodyProps {
  body: string; range: LiveRange | null; locked: boolean; Markdown: Markdown;
  segment: string; activeBlock: LiveBlock | undefined;
  /** 편집 중인 블록 칸(MemoBody). range 가 있을 때만 그린다. */
  children: ReactNode;
  activate: (range: LiveRange | null, caret?: BodyCaret, clickY?: number) => void;
  toggleTask: (offset: number) => void;
  /** 본문 바깥(제목·태그·창 밖)으로 손이 가면 칸을 닫는다. 도구 줄·대화상자·삽입 목록은 예외. */
  keepInside: (target: Element) => boolean;
  /** 빈 메모에서 칸 아래에 보이는 빠른 삽입 안내. */
  hint: string | null;
  selectAll: () => void;
  deleteSelection: (start: number, end: number) => void;
}

// 블록 사이 간격은 원문의 빈 줄이 맡으므로 서식 모양 자체의 위아래 여백은 지운다.
// 인용의 원문 줄바꿈은 화면에서도 줄바꿈이다(M13 (A)) — 아니면 원문 칸이 서식보다 길어진다.
const FLAT = '[&_.prose>*]:!my-0 [&_.prose]:text-[15px] [&_.prose]:leading-7 [&_.prose_p]:whitespace-pre-line';
function spacing(block: Pick<LiveBlock, 'kind' | 'level'>): string {
  if (block.kind === 'heading') return block.level === 1 ? 'pt-3' : 'pt-2';
  if (block.kind === 'table' || block.kind === 'code' || block.kind === 'hr') return 'py-1';
  return '';
}

/** 블록 id 는 앞 블록은 시작 자리, 뒤 블록은 끝에서 센 자리라 편집 중 칸에서 글자가 늘어도 그 블록들이 다시 그려지지 않는다. */
const LiveBlockView = memo(function LiveBlockView({ id, text, kind, level, Markdown, toggle }: {
  id?: string; text: string; kind: LiveBlock['kind']; level: number | undefined; Markdown: Markdown; toggle: ((id: string, offset: number) => void) | null;
}): JSX.Element {
  if (kind === 'blank') return <div data-block={id} className="h-7" />;
  return <div data-block={id} className={`${FLAT} ${spacing({ kind, ...(level ? { level } : {}) })}`}>
    <div className="min-h-7"><Markdown text={text} {...(id && toggle ? { onToggleTask: (offset: number) => toggle(id, offset) } : {})} /></div>
  </div>;
});

/** 누른 자리까지 보인 글자. 브라우저마다 이름이 다른 두 API 를 차례로 쓴다. */
function shownBefore(element: HTMLElement, x: number, y: number): string | null {
  const doc = element.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const point = doc.caretPositionFromPoint?.(x, y);
  const hit = point ? { node: point.offsetNode, offset: point.offset } : (() => { const r = doc.caretRangeFromPoint?.(x, y); return r ? { node: r.startContainer, offset: r.startOffset } : null; })();
  if (!hit || !element.contains(hit.node)) return null;
  const range = doc.createRange();
  range.setStart(element, 0); range.setEnd(hit.node, hit.offset);
  return range.toString();
}

/** §5.13 MEMO M13 — 본문은 늘 서식 모양이고, 편집 중인 한 블록만 원문 칸이다. */
export function MemoLiveBody({ body, range, segment, activeBlock, locked, Markdown, children, activate, toggleTask, keepInside, hint, selectAll, deleteSelection }: MemoLiveBodyProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ body, range, activate, toggleTask });
  latest.current = { body, range, activate, toggleTask };
  const open = range !== null;
  // 끝 빈 곳에서 연 새 줄은 아래 여백 자리를 쓴다. 첫 글자로 실제 줄이 돼도 그 줄을 쓰는 동안은 여백을 되살리지 않아 아래 칸이 밀리지 않는다.
  const endLine = useRef(false);
  if (!range || range.tail > 0) endLine.current = false; else if (range.lead) endLine.current = true;
  // 원문이 서식보다 길면 칸이 뒤 블록 위로 펼쳐진다. 그때만 그림자로 겹침을 알린다.
  const placeRef = useRef<HTMLDivElement>(null); const editRef = useRef<HTMLDivElement>(null);
  const [spill, setSpill] = useState(false);
  useLayoutEffect(() => {
    const place = placeRef.current; const box = editRef.current;
    if (!place || !box) { setSpill(false); return; }
    const measure = (): void => setSpill(box.offsetHeight > place.offsetHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(box); observer.observe(place);
    return () => observer.disconnect();
  }, [open, activeBlock]);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event): void => {
      const target = event.target as Element | null;
      if (!target || !(target instanceof Element) || rootRef.current?.contains(target) || keepInside(target)
        || target.closest('[data-text-field-menu]')) return;
      latest.current.activate(null);
    };
    const doc = rootRef.current?.ownerDocument;
    doc?.addEventListener('pointerdown', close, true); doc?.addEventListener('focusin', close, true);
    return () => { doc?.removeEventListener('pointerdown', close, true); doc?.removeEventListener('focusin', close, true); };
  }, [open, keepInside]);

  const resolve = (id: string): number => {
    const { body: text } = latest.current;
    return id.startsWith('a') ? text.length - Number(id.slice(1)) : Number(id.slice(1));
  };
  const toggle = useRef((id: string, offset: number): void => { latest.current.toggleTask(resolve(id) + offset); }).current;

  const end = range ? body.length - range.tail : 0;
  const beforeText = range ? (range.lead ? body : range.start > 0 ? body.slice(0, range.start - 1) : '') : body;
  const afterText = range && !range.lead && range.tail > 0 ? body.slice(end + 1) : '';
  const hasBefore = range ? (range.lead ? body !== '' : range.start > 0) : body !== '';
  const hasAfter = !!range && !range.lead && range.tail > 0;
  const before = useMemo(() => hasBefore ? splitBlocks(beforeText) : [], [beforeText, hasBefore]);
  const after = useMemo(() => hasAfter ? splitBlocks(afterText) : [], [afterText, hasAfter]);
  const view = (block: LiveBlock, id: string): JSX.Element =>
    <LiveBlockView key={id} id={id} text={body.slice(block.start, block.end)} kind={block.kind} level={block.level} Markdown={Markdown} toggle={locked ? null : toggle} />;

  const click = (event: MouseEvent<HTMLDivElement>): void => {
    if (locked) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, button, [role="listbox"]')) return;
    // 서식 모양의 글자를 끌어 고른 중이면 복사할 수 있게 칸을 열지 않는다.
    const picked = target.ownerDocument?.getSelection?.();
    if (picked && !picked.isCollapsed && rootRef.current?.contains(picked.anchorNode)) return;
    const holder = target.closest<HTMLElement>('[data-block]');
    const text = latest.current.body;
    if (!holder) {
      if (target === rootRef.current) activate(endRange(text), { start: 0, end: 0 }, event.clientY);
      return;
    }
    const start = resolve(holder.dataset['block'] ?? 'b0');
    const block = blockAt(splitBlocks(text), start);
    if (!block) return;
    const source = text.slice(block.start, block.end);
    const shown = shownBefore(holder, event.clientX, event.clientY);
    const at = shown === null ? source.length : Math.min(sourceOffset(source, shown), source.length);
    activate(rangeOf(text, block), { start: at, end: at }, event.clientY);
  };

  return <div ref={rootRef} data-select-scope="body" onClick={click} tabIndex={locked ? undefined : 0} onKeyDown={event => {
    if (locked || event.defaultPrevented || event.nativeEvent?.isComposing) return;
    if (event.target instanceof Element && event.target.closest('textarea, input, button')) return;
    if (!locked && !event.defaultPrevented && !event.nativeEvent?.isComposing && (event.ctrlKey || event.metaKey)
      && !event.altKey && !event.shiftKey && (event.code === 'KeyA' || event.key.toLowerCase() === 'a')) {
      event.preventDefault(); event.stopPropagation(); selectAll();
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === 'Delete' || event.key === 'Backspace')) {
      const selected = rootRef.current ? liveSelection(rootRef.current, body) : null;
      if (selected) { event.preventDefault(); event.stopPropagation(); deleteSelection(selected.start, selected.end); }
    }
  }} className={`min-h-[40vh] text-[15px] leading-7 text-gray-200 outline-none ${endLine.current ? '' : 'pb-7'} ${locked ? '' : 'cursor-text'}`}>
    {before.map(block => view(block, `b${block.start}`))}
    {range && <div key="active" className="relative">
      {/* 서식 높이로 자리를 잡고 원문 칸은 그 위에 겹쳐 아래로만 자란다 — 앞뒤 블록을 밀지도, 원문을 칸 안에 가두지도 않는다(M13 (F)). */}
      {activeBlock && <div ref={placeRef} aria-hidden="true" className="pointer-events-none invisible">
        <LiveBlockView text={segment} kind={activeBlock.kind} level={activeBlock.level} Markdown={Markdown} toggle={null} />
      </div>}
      <div ref={editRef} className={activeBlock ? `absolute inset-x-0 top-0 z-[5] min-h-full bg-gray-900 ${spacing(activeBlock)} ${spill ? 'rounded-b-md shadow-[0_10px_14px_-10px_rgb(0_0_0/0.6)]' : ''}` : undefined}>{children}</div>
    </div>}
    {after.map(block => view({ ...block, start: block.start + end + 1, end: block.end + end + 1 }, `a${afterText.length - block.start}`))}
    {hint && <p className="pointer-events-none pt-2 text-xs text-gray-600">{hint}</p>}
  </div>;
}

