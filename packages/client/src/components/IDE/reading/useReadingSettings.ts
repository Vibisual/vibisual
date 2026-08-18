import { useEffect, useMemo, useState } from 'react';
import { useGraphStore } from '../../../stores/graphStore.js';
import { detectFontAvailability, resolveReadingFontStack } from './readingFonts.js';
import { resolveReading, type ResolvedReading } from './readingModel.js';

/**
 * §5.5 — 읽기 설정을 실제 화면에 먹이는 훅.
 *
 * 값은 `document.documentElement` 의 CSS 커스텀 프로퍼티로 나가고, 폭 안은 `data-ide-layout`
 * 속성으로 나간다. 그래야 index.css 한 곳이 그리드·탈출·타이포그래피를 전부 맡고 컴포넌트는
 * 인라인 스타일을 들지 않는다(코딩 규칙: 인라인 스타일 금지).
 *
 * 뷰포트 폭을 상태로 들고 있는 이유는 **모바일 자동 변형** 때문이다 — 창을 좁히면 폭 제한이
 * 스스로 풀려야 하므로 resize 를 따라간다.
 */
export function useReadingSettings(): ResolvedReading & { fontAvailability: Record<string, boolean> } {
  const reading = useGraphStore((s) => s.ideReading);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = (): void => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 글꼴 설치 여부는 창 수명 동안 변하지 않으므로 첫 렌더에 한 번만 잰다(캔버스 계측 비용 회피).
  const [fontAvailability, setFontAvailability] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setFontAvailability(detectFontAvailability());
  }, []);

  const resolved = useMemo(
    // 제공 글꼴 / 커스텀 두 갈래는 resolveReadingFontStack 안에서 갈린다(여기서는 분기하지 않는다).
    () => resolveReading(reading, viewportWidth, resolveReadingFontStack(reading)),
    [reading, viewportWidth],
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const applied = Object.keys(resolved.vars);
    for (const [name, value] of Object.entries(resolved.vars)) root.style.setProperty(name, value);
    root.setAttribute('data-ide-layout', resolved.layoutAttr);
    // 대화 정렬은 켜졌을 때만 속성을 단다(꺼짐 = 속성 없음 → 규칙이 아예 걸리지 않는다).
    if (resolved.chatAttr) root.setAttribute('data-ide-chat', resolved.chatAttr);
    else root.removeAttribute('data-ide-chat');
    return () => {
      for (const name of applied) root.style.removeProperty(name);
      root.removeAttribute('data-ide-layout');
      root.removeAttribute('data-ide-chat');
    };
  }, [resolved]);

  return { ...resolved, fontAvailability };
}
