import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IDEContextMenu } from '../IDE/IDEContextMenu.js';
import {
  buildTextFieldMenuItems,
  shouldOpenTextFieldMenu,
} from '../../hooks/textFieldContextMenu.js';
import {
  createTextFieldActions,
  hasSelectionFrom,
  readFieldSelection,
  type FieldSelection,
  type TextFieldElement,
} from '../../hooks/textFieldActions.js';

/**
 * 앱의 모든 입력칸 우클릭 메뉴 — Electron 패키지 빌드에는 기본 메뉴가 없다(인증 코드 칸처럼 붙여넣기뿐인 칸이 막힌다).
 * document 한 곳에서 capture 단계로 받는다 — 새 입력칸은 할 일이 없고, 자기 메뉴를 띄우려 이벤트를 삼키는 조상(탐색기 행·탭·캔버스)보다 먼저 가로챈다.
 * 마운트는 부팅 지점(`main.tsx`) 한 곳 — shell 안이면 별창·오버레이·지휘통제실·내부 앱 창에서 죽는다.
 */

/** 앱의 어떤 창보다 위(현재 최고는 설치 게이트 100_700) — 낮으면 모달 뒤로 숨어 우클릭 무반응으로 보인다. */
const GLOBAL_TEXT_MENU_Z = 1_000_000;

/**
 * 자기 우클릭 메뉴가 있는 자리(전역은 손대지 않는다).
 * - `[data-text-menu="own"]`: IDE 입력창(#17-3)·편집창(#17-27 ⑨) — 요소에 달아 두어 컴포넌트가 옮겨도 따라간다.
 * - `.xterm`: 터미널의 숨은 helper textarea(터미널 메뉴가 맡는다).
 */
const OWN_MENU_SELECTOR = '[data-text-menu="own"], .xterm';

interface OpenState {
  x: number;
  y: number;
  el: TextFieldElement;
  sel: FieldSelection;
  hasSelection: boolean;
  readOnly: boolean;
}

export function GlobalTextFieldContextMenu(): React.JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState<OpenState | null>(null);
  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent): void => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;
      const allowed = shouldOpenTextFieldMenu({
        tagName: el.tagName,
        type: el instanceof HTMLInputElement ? el.type : undefined,
        disabled: el.disabled,
        ownsMenu: el.closest(OWN_MENU_SELECTOR) !== null,
      });
      if (!allowed) return;

      // 글자 칸의 우클릭은 글자 메뉴다 — 감싼 조상의 메뉴(파일·탭·캔버스)가 대신 뜨지 않게 가로챈다.
      e.preventDefault();
      e.stopPropagation();
      const sel = readFieldSelection(el);
      setOpen({
        x: e.clientX,
        y: e.clientY,
        el,
        sel,
        hasSelection: hasSelectionFrom(sel),
        readOnly: el.readOnly,
      });
    };

    document.addEventListener('contextmenu', onContextMenu, true);
    return () => document.removeEventListener('contextmenu', onContextMenu, true);
  }, []);

  const items = useMemo(() => {
    if (!open) return [];
    return buildTextFieldMenuItems(
      { hasSelection: open.hasSelection, readOnly: open.readOnly },
      createTextFieldActions(open.el, open.sel),
      t,
      // 읽기 전용 칸이 왜 안 고쳐지는지는 칸마다 다르다 — 공용 문구를 지어내지 않고 툴팁은 비운다.
      undefined,
    );
  }, [open, t]);

  if (!open) return null;
  return (
    <IDEContextMenu
      x={open.x}
      y={open.y}
      items={items}
      zIndex={GLOBAL_TEXT_MENU_Z}
      onClose={close}
    />
  );
}
