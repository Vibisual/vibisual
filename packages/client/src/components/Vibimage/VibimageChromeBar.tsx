import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAppChrome } from '../../apps/appChrome.js';
import { WindowControls } from '../Layout/WindowControls.js';

interface VibimageChromeBarProps {
  /** 앱 안 창·IDE 무대에 떠 있나 — 아니면 이 줄이 OS 창 제목줄이라 끌기·창 단추를 맡는다. */
  hosted: boolean;
  /** 창 제목(OS 창 제목·가상 창 띠). null 이면 창 틀 기본(버블 이름 → 앱 이름). */
  title: string | null;
  /** `dragRegion` 이면 이 줄이 CSS 끌기 영역이다 — 글자는 `app-drag-label`, 단추는 `app-nodrag` 를 단다. */
  children: (dragRegion: boolean) => React.ReactNode;
}

/**
 * §5.13 (R-9) — 창이 머리줄 자리를 주면(§5.13 (V) 37-1) 그 한 줄에 싣고, 없으면 제 머리줄 한 줄로 그린다. 보기 화면과 레이어 편집기가
 * 함께 쓴다 — 한 창 안에서 둘을 오가도 크롬 줄 수가 같다.
 */
export function VibimageChromeBar({ hosted, title, children }: VibimageChromeBarProps): React.JSX.Element {
  const chrome = useAppChrome();
  const slot = chrome?.slot ?? null;
  const claim = chrome?.claim;
  const setTitle = chrome?.setTitle;
  useEffect(() => (slot && claim ? claim() : undefined), [slot, claim]);
  useEffect(() => {
    if (!setTitle) return undefined;
    setTitle(title);
    return () => setTitle(null);
  }, [setTitle, title]);

  if (slot) return createPortal(<div className="flex min-w-0 flex-1 items-center gap-2">{children(false)}</div>, slot);
  const dragRegion = !hosted;
  return (
    <header className={`${dragRegion ? 'app-drag ' : ''}flex h-10 shrink-0 items-center gap-2 border-b border-white/10 bg-vb-sunken/90 px-3 text-slate-200`}>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children(dragRegion)}</div>
      {dragRegion && <div className="app-nodrag shrink-0"><WindowControls /></div>}
    </header>
  );
}
