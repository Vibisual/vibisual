import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { EditorIcon, type EditorIconName } from './editorIcons.js';

/**
 * §5.13 (R-9) 레이어 편집기 — 명령 막대·도구 막대·패널이 함께 쓰는 단추와 묶음. 빠른 편집 도구 막대(`ImageToolbarButton`)와
 * 같은 색·눌림 꼴이라 한 창 안에서 두 화면이 같은 도구처럼 보인다.
 */

/**
 * 단추가 초점을 가져가지 않게 하되, 열려 있던 입력칸은 닫고(초안이 그 자리에서 반영된다) 초점을 편집기 뿌리로 돌린다 —
 * 문서 밖으로 빠지면 다음 단축키가 편집기에 닿지 않는다.
 */
export function keepEditorFocus(event: React.MouseEvent<HTMLElement>): void {
  event.preventDefault();
  const root = event.currentTarget.closest<HTMLElement>('[data-shortcut-scope]');
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== root) active.blur();
  root?.focus({ preventScroll: true });
}

const BUTTON = 'flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md text-gray-300 transition-colors hover:bg-gray-800 hover:text-gray-100 '
  + 'disabled:cursor-not-allowed disabled:text-gray-600 disabled:hover:bg-transparent pointer-coarse:h-10';

interface EditorButtonProps {
  icon: EditorIconName;
  label: string;
  /** `shortcutLabel()` 로 만든 표시 — 툴팁 꼬리에 붙는다. */
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  /** 아이콘 옆 글자 — 없으면 아이콘만(이름은 툴팁·aria-label). */
  text?: string;
  /** 저장 안 한 변경 같은 작은 점. */
  dot?: boolean;
  className?: string;
  /** 글자에 덧붙이는 클래스 — 좁은 창에서 글자만 접을 때. */
  textClassName?: string;
  onClick: () => void;
}

export function EditorButton({ icon, label, shortcut, active, disabled, text, dot, className = '', textClassName = '', onClick }: EditorButtonProps): React.JSX.Element {
  return (
    <button type="button" title={shortcut ? `${label} (${shortcut})` : label} aria-label={label} aria-pressed={active}
      aria-keyshortcuts={shortcut} disabled={disabled} onMouseDown={keepEditorFocus} onClick={onClick}
      className={`${BUTTON} relative ${text ? 'px-2' : 'w-8 pointer-coarse:w-10'} ${active ? 'bg-blue-600 text-white hover:bg-blue-500 hover:text-white' : ''} ${className}`}>
      <EditorIcon name={icon} />
      {text && <span className={`truncate text-xs ${textClassName}`}>{text}</span>}
      {dot && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />}
    </button>
  );
}

export function EditorDivider({ vertical = false }: { vertical?: boolean }): React.JSX.Element {
  return <span aria-hidden="true" className={vertical ? 'my-1 h-px w-6 shrink-0 bg-gray-800 box-narrow:mx-1 box-narrow:my-0 box-narrow:h-6 box-narrow:w-px' : 'mx-1 h-5 w-px shrink-0 bg-gray-800'} />;
}

const MENU_WIDTH = 288;

export interface MenuItem { id: string; label: string; hint?: string; icon?: EditorIconName; disabled?: boolean; onSelect: () => void }

/**
 * 글리프 단추 + 아래로 펼치는 메뉴(넣기·내보내기). 막대가 가로로 굴러가는 좁은 창에서도 잘리지 않게 문서 맨 위층에 띄우고,
 * 바깥 누르기·Esc·고르기로 닫힌다. 자리는 단추의 화면 자리에서 매번 재므로 style 로만 줄 수 있다.
 */
export function EditorMenuButton({ icon, label, items, disabled }: { icon: EditorIconName; label: string; items: MenuItem[]; disabled?: boolean }): React.JSX.Element {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const open = !!at;
  useOutsidePressDismiss({ enabled: open, onDismiss: () => setAt(null), refs: [panel, trigger], events: ['mousedown', 'pointerdown'] });
  useEffect(() => { if (open) panel.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus(); }, [open]);
  const toggle = (): void => {
    if (open || !trigger.current) { setAt(null); return; }
    const rect = trigger.current.getBoundingClientRect();
    setAt({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8)) });
  };
  return (
    <div className="relative shrink-0">
      <button ref={trigger} type="button" title={label} aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled}
        onMouseDown={keepEditorFocus} onClick={toggle} className={`${BUTTON} px-1.5 ${open ? 'bg-gray-800 text-gray-100' : ''}`}>
        <EditorIcon name={icon} />
        <EditorIcon name="chevronDown" className="h-3 w-3" />
      </button>
      {at && createPortal(
        <div ref={panel} role="menu" aria-label={label} style={{ top: at.top, left: at.left, width: MENU_WIDTH }}
          onKeyDown={(e) => {
            // 포털이라도 React 는 keydown 을 편집기 뿌리로 올린다 — 메뉴 안의 화살표가 레이어를 밀지 않게 여기서 끊는다.
            e.stopPropagation();
            if (e.key === 'Escape') { setAt(null); trigger.current?.focus(); return; }
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const list = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
            const i = list.indexOf(document.activeElement as HTMLButtonElement);
            list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
          }}
          className="fixed z-menu flex max-h-[calc(100dvh-6rem)] max-w-[calc(100vw-1rem)] flex-col overflow-auto rounded-lg border border-gray-700 bg-gray-900 p-1 text-gray-100 shadow-2xl">
          {items.map((item) => (
            <button key={item.id} type="button" role="menuitem" disabled={item.disabled}
              onClick={() => { setAt(null); trigger.current?.closest<HTMLElement>('[data-shortcut-scope]')?.focus({ preventScroll: true }); item.onSelect(); }}
              className="flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-200 outline-none hover:bg-gray-800 focus:bg-gray-800 disabled:text-gray-600 disabled:hover:bg-transparent pointer-coarse:min-h-10">
              {item.icon ? <EditorIcon name={item.icon} className="h-4 w-4 shrink-0 text-gray-400" /> : <span className="w-4 shrink-0" />}
              <span className="min-w-0 flex-1">{item.label}</span>
              {item.hint && <span className="shrink-0 tabular-nums text-gray-500">{item.hint}</span>}
            </button>
          ))}
        </div>, document.body)}
    </div>
  );
}

/** 접는 패널 머리 — 패널 이름은 굵게·대문자로 눌러 위계를 세운다(12px 하한). */
export function PanelSection({ title, open, onToggle, actions, children, className = '' }: {
  title: string; open: boolean; onToggle: () => void; actions?: ReactNode; children: ReactNode; className?: string;
}): React.JSX.Element {
  return (
    <section className={`flex min-h-0 flex-col border-b border-gray-800 ${className}`}>
      <header className="flex h-9 shrink-0 items-center gap-1 pl-1 pr-2">
        <button type="button" aria-expanded={open} onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-left text-xs font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-200">
          <EditorIcon name={open ? 'chevronDown' : 'chevronRight'} className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{title}</span>
        </button>
        {actions}
      </header>
      {open && children}
    </section>
  );
}

export interface SegmentOption<T extends string> { value: T; label: string; icon?: EditorIconName; text?: string }

/** 하나만 고르는 단추 묶음(정렬·맞춤·도형). 글리프가 있으면 글리프, 없으면 짧은 글자. */
export function Segmented<T extends string>({ label, value, options, disabled, onChange }: {
  label: string; value: T | undefined; options: readonly SegmentOption<T>[]; disabled?: boolean; onChange: (value: T) => void;
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className="flex min-w-0 rounded-md border border-gray-800 bg-gray-950 p-0.5">
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} aria-label={option.label} title={option.label}
          disabled={disabled} onClick={() => onChange(option.value)}
          className={`flex h-7 min-w-0 flex-1 items-center justify-center rounded px-1 text-xs transition-colors disabled:opacity-40 pointer-coarse:h-9 ${
            value === option.value ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
          {option.icon ? <EditorIcon name={option.icon} className="h-4 w-4" /> : <span className="truncate">{option.text ?? option.label}</span>}
        </button>
      ))}
    </div>
  );
}
