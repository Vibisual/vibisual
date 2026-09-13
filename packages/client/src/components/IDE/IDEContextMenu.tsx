import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import type { CommandId } from '@vibisual/shared';
// §6 — 메뉴의 단축키 표시는 레지스트리에서 나온다(손으로 적으면 재매핑에 뒤처진다).
import { KeyHint } from '../Shortcuts/KeyHint.js';

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
  /**
   * 라벨 왼쪽 글리프. **이모지 ❌ — lucide 톤 인라인 stroke SVG** 만(CLAUDE.md 아이콘 규약).
   * 안 주면 자리도 생기지 않는다 — 글리프가 없는 기존 메뉴들의 배치는 1px 도 안 움직인다.
   */
  icon?: React.ReactNode;
  /**
   * 라벨 **아래** 한 줄. 우측 `hint` 는 긴 말을 담으면 메뉴 폭을 그만큼 넓히므로, 문장으로 된
   * 단서(예: "워크트리 2개는 빠집니다")는 여기로 온다.
   */
  note?: string;
  onClick: () => void;
  disabled?: boolean;
  /** 흐려진 이유 — 누를 수 없는 항목은 그 까닭을 툴팁으로 말한다. */
  disabledTitle?: string;
  /**
   * 오른쪽에 흐리게 붙는 단축키 표시(예: `Ctrl+C`).
   *
   * **우리가 처리하지 않는 키**(브라우저·OS 가 하는 잘라내기·되돌리기 등)에만 쓴다. 우리 명령이면
   * `cmd` 를 줘라 — 그래야 사용자가 재매핑했을 때 메뉴가 옛 키를 계속 말하지 않는다.
   */
  hint?: string;
  /**
   * §6 단축키 명령. 주면 현재 배정된 키를 **레지스트리에서 읽어** 오른쪽에 그린다.
   * `hint` 보다 우선한다.
   */
  cmd?: CommandId;
  /** 이 항목 위에 구분선을 긋는다(묶음이 바뀌는 자리). */
  separatorBefore?: boolean;
}

/** 기본 z-index. 모달 위에서 열릴 때는 호출부가 그 창보다 높은 값을 준다. */
const DEFAULT_Z = 9999;

interface IDEContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  /**
   * 겹침 순서. **모달 위의 메뉴는 반드시 줘야 한다** — 기본값은 IDE 안(9999) 기준이라
   * 로그인 창(100_600) 같은 상위 레이어에서는 메뉴가 창 **뒤로** 숨는다(= 우클릭 무반응으로 보인다).
   */
  zIndex?: number;
  /**
   * 밀도. `compact` 는 **항목이 한둘뿐인 작은 메뉴**용이다(§5.4 #34 버블 삭제) — 기본 밀도는
   * 항목이 여럿인 IDE 메뉴에 맞춰 잡혀 있어, 한 줄짜리 메뉴에 쓰면 빈 자리가 글자보다 넓어
   * 투박해 보인다. 줄이는 것은 **여백·최소폭·칩 크기**뿐이고 **글자 크기는 12px 그대로**다
   * (§9 한글 가독 하한 — 조밀하게 만든다고 읽기를 깎지 않는다).
   */
  density?: 'default' | 'compact';
  onClose: () => void;
}

export function IDEContextMenu({ x, y, items, zIndex, density = 'default', onClose }: IDEContextMenuProps): React.JSX.Element {
  const compact = density === 'compact';
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
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: zIndex ?? DEFAULT_Z }}
      className={`border border-gray-700 bg-gray-900 ${
        compact
          ? 'min-w-[132px] max-w-[260px] rounded-md py-0.5 shadow-lg shadow-black/40'
          : 'min-w-[180px] rounded py-1 shadow-xl'
      }`}
      onContextMenu={(e) => e.preventDefault()}
      // **초점을 빼앗지 않는다.** 항목이 `<button>` 이라 누르는 순간 초점이 옮겨가는데, 그러면
      // 대상 입력칸에 `blur` 가 먼저 떨어진다 — 탐색기 이름 바꾸기 칸처럼 `onBlur` 로 확정하는
      // 자리에서는 메뉴를 누른 순간 칸이 사라져 [붙여넣기] 가 갈 곳을 잃는다. mousedown 기본동작만
      // 막으면 클릭은 그대로 오면서 초점은 원래 자리에 남는다.
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <div key={it.id ?? i}>
          {it.separatorBefore && i > 0 && <div className={`border-t border-gray-800 ${compact ? 'my-0.5' : 'my-1'}`} />}
          <button
            type="button"
            disabled={it.disabled}
            title={it.disabled ? it.disabledTitle : undefined}
            onClick={() => { if (!it.disabled) { it.onClick(); onClose(); } }}
            // 둘째 줄이 있는 항목은 글리프·키캡을 **첫 줄에** 맞춘다(가운데 정렬하면 둘 다 줄 사이에 뜬다).
            className={`flex w-full text-left text-[12px] transition-colors ${
              it.note ? 'items-start' : 'items-center'
            } ${
              compact ? 'gap-2 px-2 py-1' : 'gap-4 px-3 py-1.5'
            } ${
              it.disabled
                ? 'cursor-not-allowed text-gray-600'
                : 'text-gray-200 hover:bg-blue-500/20'
            }`}
          >
            {it.icon && <span className={`flex-shrink-0 text-gray-400 ${it.note ? 'mt-0.5' : ''}`}>{it.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{it.label}</span>
              {/* 둘째 줄은 **라벨을 밀지 않는다** — 폭을 넓히는 대신 아래로 흐른다. */}
              {it.note && <span className="mt-0.5 block text-[12px] leading-snug text-gray-500">{it.note}</span>}
            </span>
            {it.cmd
              // 메뉴 안에서는 **읽기 전용**이다 — 연필을 누르면 메뉴가 닫히면서 상자만 남는다.
              //   바꾸는 자리는 오버레이(Ctrl+/)와 설정 탭이다.
              ? <KeyHint cmd={it.cmd} editable={false} size={compact ? 'sm' : 'md'} className="flex-shrink-0 self-start" />
              : it.hint && <span className="flex-shrink-0 text-[12px] text-gray-500">{it.hint}</span>}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
