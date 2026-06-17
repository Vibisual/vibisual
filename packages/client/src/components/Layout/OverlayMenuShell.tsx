import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { OverlayBubbleContextMenu } from './OverlayBubbleContextMenu.js';

// SCENARIO.md §5.5 #17-6 (G) v2.87 — `#overlaymenu=1&targetWindowId=…&agentId=…&projectId=…&opacity=…`
// 해시로 뜬 **우클릭 메뉴 전용 팝업 창**의 shell. 280×320 버블 창 안에 갇혀 커서 아래에 못 열리고
// 하단 항목이 잘려 클릭 안 되던 문제(v2.82~v2.86)를, 메뉴를 커서 위치의 독립 투명 창으로 분리해 해소.
//
// 동작: ① 실제 메뉴 크기를 측정해 `overlay:menu-resize` 로 신고 → main 이 창을 딱 맞춰 커서 아래 배치.
//       ② 각 항목 클릭은 `overlay:menu-action` 으로 **대상(버블) 창**에 적용(라우팅은 main 이 담당).
//       ③ Esc → `overlay:close-menu`(메뉴 밖 클릭 닫힘은 main 의 blur 핸들러가 처리).
// 슬라이더는 그대로 유지 — opacity 액션만 메뉴를 닫지 않는다(main 측 규칙).

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
