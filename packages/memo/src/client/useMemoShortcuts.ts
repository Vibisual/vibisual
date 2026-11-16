import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react';

interface ShortcutActions {
  searchRef: RefObject<HTMLInputElement>;
  newNote: () => void; showLibrary: () => void; toggleLibrary: () => void; save: () => void;
}
/** 루트 div 의 onKeyDown 에 거는 핸들러. 전역 리스너를 쓰지 않아 앱 창 밖 입력과 섞이지 않는다. */
export function useMemoShortcuts(actions: ShortcutActions): (event: KeyboardEvent<HTMLElement>) => void {
  const [searchRequest, setSearchRequest] = useState(0);
  // 목록이 접혀 있으면 다음 렌더 뒤에야 검색칸이 보이므로 요청 번호로 포커스 시점을 늦춘다.
  useEffect(() => { if (searchRequest) actions.searchRef.current?.focus(); }, [searchRequest, actions.searchRef]);
  return event => {
    // Windows 의 AltGr 는 ctrl+alt 로 보고되므로 문자 입력(ń 등)을 단축키로 가로채지 않는다.
    if (event.nativeEvent?.isComposing || !(event.ctrlKey || event.metaKey) || event.getModifierState?.('AltGraph')) return;
    const plain = !event.shiftKey && !event.altKey;
    let run: (() => void) | null = null;
    if (event.code === 'KeyN' && event.altKey) run = actions.newNote;
    else if (event.code === 'KeyF' && plain) run = () => { actions.showLibrary(); setSearchRequest(value => value + 1); };
    else if (event.code === 'Backslash' && plain) run = actions.toggleLibrary;
    else if (event.code === 'KeyS' && plain) run = actions.save;
    if (!run) return;
    event.preventDefault(); event.stopPropagation(); run();
  };
}
