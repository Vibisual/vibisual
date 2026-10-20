import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { isComposingKeyEvent } from '../../utils/inputComposition.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import type { CommandId } from '@vibisual/shared';
import { IDEContextMenuPanel } from './IDEContextMenuPanel.js';

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
  /** 하위 항목이 있으면 실행·닫기 대신 메뉴를 펼친다. 상위 항목의 onClick은 호출하지 않는다. */
  children?: ContextMenuItem[];
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
  const ref = useRef<HTMLDivElement>(null);
  // 하위 패널도 이 DOM 트리 안에 있어, 안에서 시작한 제스처는 메뉴를 닫지 않는다.
  useOutsidePressDismiss({ onDismiss: onClose, refs: [ref] });

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isComposingKeyEvent(e) || e.defaultPrevented) return;
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      // 입력칸은 blur로 이름 바꾸기 등을 확정할 수 있다. 방향키도 초점을 빼앗지 않는다.
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !ref.current?.contains(document.activeElement)) {
        const active = document.activeElement;
        if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || (active instanceof HTMLElement && active.isContentEditable)) return;
        const menu = ref.current?.querySelector('[role="menu"]');
        const buttons = Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])
          .filter((button) => button.closest('[role="menu"]') === menu);
        const button = e.key === 'ArrowDown' ? buttons?.[0] : buttons?.[buttons.length - 1];
        if (button) { e.preventDefault(); button.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <div
      ref={ref}
      onContextMenu={(e) => e.preventDefault()}
      // 입력칸의 blur 확정/선택 범위를 지킨다. 클릭 자체는 정상 전달된다.
      onMouseDown={(e) => e.preventDefault()}
    >
      <IDEContextMenuPanel key={`${x}:${y}`} x={x} y={y} items={items} compact={density === 'compact'} zIndex={zIndex ?? DEFAULT_Z} onClose={onClose} />
    </div>,
    document.body,
  );
}
