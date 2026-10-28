import { useEffect } from 'react';
import { useKeymapStore } from '../../stores/keymap.js';
import { ShortcutOverlay } from './ShortcutOverlay.js';
import { KeyPromoterToast } from './KeyPromoterToast.js';

/**
 * §6 단축키 표시 계층 — 창마다 한 번, `main.tsx` 에 둔다(shell 안이면 별창·오버레이·지휘통제실 창에서 빠진다).
 * 서버 키맵을 여기서 읽는다 — 없으면 새 창 직후 잠깐 기본 바인딩이 먹는다.
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
