import { useEffect } from 'react';
import { useKeymapStore } from '../../stores/keymap.js';
import { ShortcutOverlay } from './ShortcutOverlay.js';
import { KeyPromoterToast } from './KeyPromoterToast.js';

/**
 * ShortcutsHost.tsx — §6 단축키 표시 계층을 **창마다 한 번** 세운다.
 *
 * `main.tsx`(부팅 지점)에 둔다 — `InspectorOverlay`·`GlobalTextFieldContextMenu` 와 같은 이유다.
 * shell 안(App·DetachedShell)에 두면 별창·오버레이 창·지휘통제실 창에서는 단축키 판이 안 뜬다.
 *
 * 여기서 서버 키맵을 한 번 읽어 둔다 — 이게 없으면 창을 새로 띄운 직후 잠깐 **기본 바인딩**으로
 * 돌아, 사용자가 바꿔 둔 키가 그 사이에 안 먹는다.
 */
export function ShortcutsHost(): React.JSX.Element {
  const fetchKeymap = useKeymapStore((s) => s.fetchKeymap);
  useEffect(() => { void fetchKeymap(); }, [fetchKeymap]);

  return (
    <>
      <ShortcutOverlay />
      <KeyPromoterToast />
    </>
  );
}
