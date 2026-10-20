import { useId, useLayoutEffect, useRef, useState } from 'react';
import { isComposingKeyEvent } from '../../utils/inputComposition.js';
import { MENU_VIEWPORT_MARGIN, placeCanvasMenu, placeCanvasSubmenu } from '../BubbleMap/canvasMenuPlacement.js';
import { ScrollFade } from '../ScrollFade.js';
import { KeyHint } from '../Shortcuts/KeyHint.js';
import type { ContextMenuItem } from './IDEContextMenu.js';

interface IDEContextMenuPanelProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  compact: boolean;
  zIndex: number;
  onClose: () => void;
  anchor?: HTMLButtonElement;
  focusOnOpen?: boolean;
  onBack?: () => void;
  id?: string;
}

/** Each level owns one open branch; fixed descendants remain inside the dismissal boundary. */
export function IDEContextMenuPanel({ x, y, items, compact, zIndex, onClose, anchor, focusOnOpen, onBack, id }: IDEContextMenuPanelProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const childRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState<{ index: number; focus: boolean } | null>(null);
  const openItem = open === null ? undefined : items[open.index];

  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const update = (): void => {
      const visual = window.visualViewport;
      const viewport = { left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0, width: visual?.width ?? window.innerWidth, height: visual?.height ?? window.innerHeight };
      const maxWidth = Math.max(0, viewport.width - MENU_VIEWPORT_MARGIN * 2);
      panel.style.minWidth = `${Math.min(compact ? 132 : 180, maxWidth)}px`;
      panel.style.maxWidth = `${Math.min(compact ? 260 : maxWidth, maxWidth)}px`;
      panel.style.maxHeight = `${Math.max(0, viewport.height - MENU_VIEWPORT_MARGIN * 2)}px`;
      const size = panel.getBoundingClientRect();
      const position = anchor
        ? placeCanvasSubmenu(anchor.getBoundingClientRect(), size, viewport)
        : placeCanvasMenu({ x, y }, size, viewport);
      if ('maxHeight' in position) panel.style.maxHeight = `${position.maxHeight}px`;
      panel.style.left = `${position.left}px`;
      panel.style.top = `${position.top}px`;
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(panel);
    if (anchor) observer?.observe(anchor);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const visual = window.visualViewport;
    visual?.addEventListener('resize', update);
    visual?.addEventListener('scroll', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      visual?.removeEventListener('resize', update);
      visual?.removeEventListener('scroll', update);
    };
  }, [x, y, compact, anchor]);

  useLayoutEffect(() => {
    if (focusOnOpen) buttons.current.find((button) => button && !button.disabled)?.focus();
  }, [focusOnOpen]);

  const openChild = (index: number, focus: boolean): void => {
    setOpen({ index, focus });
    // Hover may already have mounted the child before a keyboard activation.
    if (focus && open?.index === index) childRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (isComposingKeyEvent(event.nativeEvent) || (event.target as HTMLElement).closest('[role="menu"]') !== ref.current) return;
    const enabled = buttons.current.filter((button): button is HTMLButtonElement => !!button && !button.disabled);
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const index = buttons.current.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    if (event.key === 'ArrowDown') next = enabled[(current + 1) % enabled.length];
    else if (event.key === 'ArrowUp') next = enabled[(current - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled[enabled.length - 1];
    else if (event.key === 'ArrowRight' && items[index]?.children?.length) openChild(index, true);
    else if (event.key === 'ArrowLeft' && onBack) onBack();
    else return;
    event.preventDefault();
    event.stopPropagation();
    next?.focus();
  };

  return (
    <div
      ref={ref} id={id} role="menu" aria-labelledby={anchor?.id} onKeyDown={onKeyDown}
      style={{ position: 'fixed', left: x, top: y, zIndex }}
      className={`flex flex-col border border-gray-700 bg-gray-900 ${compact ? 'min-w-[132px] max-w-[260px] rounded-md py-0.5 shadow-lg shadow-black/40' : 'min-w-[180px] rounded py-1 shadow-xl'}`}
    >
      <ScrollFade fill>
        {items.map((item, index) => {
          const hasChildren = !!item.children?.length;
          const expanded = hasChildren && !item.disabled && open?.index === index;
          return (
            <div key={item.id ?? index}>
              {item.separatorBefore && index > 0 && <div role="separator" className={`border-t border-gray-800 ${compact ? 'my-0.5' : 'my-1'}`} />}
              <button
                ref={(button) => { buttons.current[index] = button; }}
                id={`${menuId}-${index}`} type="button" role="menuitem" disabled={item.disabled}
                title={item.disabled ? item.disabledTitle : undefined}
                aria-haspopup={hasChildren ? 'menu' : undefined}
                aria-expanded={hasChildren ? expanded : undefined}
                aria-controls={expanded ? `${menuId}-child` : undefined}
                onMouseEnter={() => { if (hasChildren && !item.disabled) openChild(index, false); else setOpen(null); }}
                onFocus={() => { if (open?.index !== index) setOpen(null); }}
                onClick={(event) => {
                  if (item.disabled) return;
                  if (hasChildren) openChild(index, event.detail === 0);
                  else { item.onClick(); onClose(); }
                }}
                // 터치에서는 줄을 손가락 높이로 — 촘촘한 줄(`compact`, 버블 메뉴)도 같다. 12px 글자에 위아래 4px 이면
                //   줄이 20px 남짓이라 옆 줄을 누르기 쉽다.
                className={`flex w-full text-left text-[12px] transition-colors pointer-coarse:py-2.5 ${item.note ? 'items-start' : 'items-center'} ${compact ? 'gap-2 px-2 py-1' : 'gap-4 px-3 py-1.5'} ${item.disabled ? 'cursor-not-allowed text-gray-600' : 'text-gray-200 hover:bg-blue-500/20 focus-visible:bg-blue-500/20'} ${expanded ? 'bg-blue-500/20' : ''}`}
              >
                {item.icon && <span className={`flex-shrink-0 text-gray-400 ${item.note ? 'mt-0.5' : ''}`}>{item.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  {item.note && <span className="mt-0.5 block text-[12px] leading-snug text-gray-500">{item.note}</span>}
                </span>
                {item.cmd
                  ? <KeyHint cmd={item.cmd} editable={false} size={compact ? 'sm' : 'md'} className="flex-shrink-0 self-start" />
                  : item.hint && <span className="flex-shrink-0 text-[12px] text-gray-500">{item.hint}</span>}
                {hasChildren && <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 flex-shrink-0 self-center text-gray-400"><path d="m9 6 6 6-6 6" /></svg>}
              </button>
            </div>
          );
        })}
      </ScrollFade>
      {open && openItem?.children?.length && !openItem.disabled && (
        <div ref={childRef}>
          <IDEContextMenuPanel
            key={openItem.id ?? open.index} id={`${menuId}-child`} x={x} y={y}
            items={openItem.children} compact={compact} zIndex={zIndex + 1} onClose={onClose}
            anchor={buttons.current[open.index] ?? undefined} focusOnOpen={open.focus}
            onBack={() => { setOpen(null); buttons.current[open.index]?.focus(); }}
          />
        </div>
      )}
    </div>
  );
}
