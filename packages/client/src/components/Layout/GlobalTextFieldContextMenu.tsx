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
 * GlobalTextFieldContextMenu — **앱의 모든 입력칸** 우클릭 메뉴(잘라내기·복사·붙여넣기·전체 선택).
 *
 * **왜 있어야 하나**: Electron 패키지 빌드에는 브라우저 기본 우클릭 메뉴가 없다. 그래서 IDE
 * 입력창(§5.5 #17-3 v2.79)·편집창(#17-27 ⑨ v4.97)·터미널처럼 **직접 메뉴를 그려 둔 세 자리 말고는**
 * 우클릭이 통째로 무반응이었다 — 전수 조사 결과 그런 텍스트 입력칸이 61개 파일에 104개였다.
 * 로그인 창의 인증 코드처럼 **붙여넣기 말고는 들어갈 길이 없는 칸**에서는 그것이 곧 막다른 길이다
 * (브라우저가 준 코드를 손으로 옮겨 적을 수는 없다).
 *
 * **104곳을 하나씩 배선하지 않는다.** 문서 한 곳에서 받으면 ⓐ 오늘 빠뜨린 칸이 없고,
 * ⓑ **앞으로 만들 입력칸은 아무 것도 안 해도 된다** — 다음 사람이 이 규칙을 기억할 필요가 없다.
 *
 * **capture 단계인 이유**: 입력칸을 감싼 조상(탐색기 행·탭·캔버스)이 자기 우클릭 메뉴를 띄우려고
 * 이벤트를 먼저 삼키는 자리가 있다. 글자 칸을 눌렀는데 파일 메뉴가 뜨는 것은 고장이므로,
 * 우리가 먼저 받아 글자 칸이면 가로챈다(`preventDefault` + `stopPropagation`).
 *
 * **마운트는 부팅 지점(`main.tsx`) 한 곳** — `InspectorOverlay` 와 같은 이유다. shell 안에 두면
 * 별창·오버레이 창·지휘통제실 창·내부 앱 창에서는 또 우클릭이 죽는다(그 창들에도 입력칸이 있다).
 */

/**
 * 앱의 어떤 창보다 위. 현재 최고는 설치 게이트(100_700)다.
 * **모달 위에서도 열리므로 반드시 그보다 높아야 한다** — 낮으면 메뉴가 창 뒤로 숨어
 * 사용자에게는 고치기 전과 똑같이 "우클릭 무반응"으로 보인다.
 */
const GLOBAL_TEXT_MENU_Z = 1_000_000;

/**
 * 이미 자기 우클릭 메뉴를 가진 자리 — 전역은 손대지 않는다. **끄는 자리를 셀 수 있게** 한 곳에 모았다.
 *  - `[data-text-menu="own"]` : IDE 입력창(#17-3)·편집창(#17-27 ⑨). 표시를 요소에 직접 달아 두면
 *    컴포넌트가 옮겨 다녀도 예외가 따라간다(파일 경로로 적어 두면 반드시 어긋난다).
 *  - `.xterm` : 터미널. xterm 이 만든 숨은 helper textarea 가 그물에 걸리는데, 그 칸의 우클릭은
 *    터미널 자신의 메뉴(복사·붙여넣기·전체 선택)가 이미 맡고 있다.
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
