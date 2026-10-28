import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { OverlayBubbleContextMenu } from './OverlayBubbleContextMenu.js';

// §5.5 #17-6 (G) — `#overlaymenu=1&targetWindowId=…` 해시로 뜬 우클릭 메뉴 전용 팝업 창의 shell.
// 크기를 재 `overlay:menu-resize`(main 이 커서 아래에 맞춘다), 항목은 `overlay:menu-action` 으로 대상 버블 창에, Esc → `overlay:close-menu`(밖 클릭은 main blur).
// opacity 액션만 메뉴를 닫지 않는다(main 규칙).

interface ParsedOverlayMenuHash {
  agentId: string;
  projectId: string;
  opacity: number;
}

export function parseOverlayMenuHash(hash: string): ParsedOverlayMenuHash | null {
  if (!hash || hash.length < 2) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.get('overlaymenu') !== '1') return null;
  const agentId = params.get('agentId');
  const projectId = params.get('projectId');
  if (!agentId || !projectId) return null;
  const op = Number(params.get('opacity'));
  const opacity = Number.isFinite(op) ? Math.max(0.2, Math.min(1, op)) : 1;
  return { agentId, projectId, opacity };
}

export interface OverlayMenuShellProps {
  initialOpacity: number;
}

export function OverlayMenuShell({ initialOpacity }: OverlayMenuShellProps): React.JSX.Element {
  const [opacity, setOpacity] = useState(initialOpacity);
  const boxRef = useRef<HTMLDivElement>(null);

  const action = useCallback((act: string, value?: number) => {
    void window.api?.overlay?.menuAction(value === undefined ? { action: act } : { action: act, value });
  }, []);

  // 실제 메뉴 크기를 측정해 main 에 신고(창을 딱 맞춰 커서 아래 배치). 내용 변화(번역·슬라이더 라벨)에도 추종.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const report = (): void => {
      const r = el.getBoundingClientRect();
      void window.api?.overlay?.menuResize({ width: Math.ceil(r.width), height: Math.ceil(r.height) });
    };
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Esc → 메뉴 닫기.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void window.api?.overlay?.closeMenu();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // 창은 측정한 래퍼 크기(메뉴 + shadow 여백 p-2)에 딱 맞춰진다. inline-block 래퍼라 폭도 내용에 맞음.
  return (
    <div ref={boxRef} className="inline-block bg-transparent p-2">
      <OverlayBubbleContextMenu
        opacity={opacity}
        onOpenIDE={() => action('open-ide')}
        onReveal={() => action('reveal')}
        onSetOpacity={(v) => {
          setOpacity(v);
          action('opacity', v);
        }}
        onHide={() => action('hide')}
        onCloseOverlay={() => action('close')}
      />
    </div>
  );
}
