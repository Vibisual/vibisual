import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';

/**
 * IDEContextMenu.tsx — §5.5 #17-3 v2.31 / #17-27 ⑨ v4.97 IDE 공용 우클릭 메뉴.
 *
 * 원래 `IDEMainArea` 안에만 있던 `TerminalContextMenu` 를 그대로 꺼낸 것이다 — 스트림 본문·입력창이
 * 쓰던 그 메뉴를 편집창(본문·줄 번호·탭)도 함께 쓴다. 새 메뉴 위젯을 하나 더 만들면 넘침 보정과
 * 닫기 규약이 두 벌이 되고, 그중 한 벌은 반드시 뒤처진다.
 *
 * 담당하는 것 셋 — (a) 뷰포트 밖으로 넘치면 좌상단 좌표 보정, (b) 바깥 press 로 닫기(§6 팝업 닫기
 * 공통 규약 — 메뉴 안에서 시작한 드래그로는 안 닫힌다), (c) Esc 로 닫기.
 */

export interface ContextMenuItem {
  /** 테스트·식별용 키(화면에는 안 보인다). */
  id?: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** 흐려진 이유 — 누를 수 없는 항목은 그 까닭을 툴팁으로 말한다. */
  disabledTitle?: string;
  /** 오른쪽에 흐리게 붙는 단축키 표시(예: `Ctrl+C`). */
  hint?: string;
  /** 이 항목 위에 구분선을 긋는다(묶음이 바뀌는 자리). */
  separatorBefore?: boolean;
}

interface IDEContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function IDEContextMenu({ x, y, items, onClose }: IDEContextMenuProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  // 뷰포트 클리핑: 메뉴가 화면 밖으로 넘치면 좌상단 좌표 보정 (mount 직후 1회).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - r.width - 8);
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top });
  }, [x, y]);

  // 외부 press → 닫기(공통 규약 — 메뉴 안에서 시작한 드래그로는 안 닫힌다).
  useOutsidePressDismiss({ onDismiss: onClose, refs: [ref] });

  // Esc → 닫기.
  // 누수 방지: onClose 를 ref 로 고정해 의존성에서 빼면, 호출자가 매 렌더 새 콜백을 줘도
  //   리스너를 재등록(중복 누적)하지 않는다 — 마운트당 1회만 등록/해제.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 9999 }}
      className="min-w-[180px] rounded border border-gray-700 bg-gray-900 py-1 shadow-xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <div key={it.id ?? i}>
          {it.separatorBefore && i > 0 && <div className="my-1 border-t border-gray-800" />}
          <button
            type="button"
            disabled={it.disabled}
            title={it.disabled ? it.disabledTitle : undefined}
            onClick={() => { if (!it.disabled) { it.onClick(); onClose(); } }}
            className={`flex w-full items-center gap-4 px-3 py-1.5 text-left text-[12px] transition-colors ${
              it.disabled
                ? 'cursor-not-allowed text-gray-600'
                : 'text-gray-200 hover:bg-blue-500/20'
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.hint && <span className="flex-shrink-0 text-[12px] text-gray-500">{it.hint}</span>}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
