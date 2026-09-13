import { useGraphStore } from '../../stores/graphStore.js';
import { OptionsWindow, type CategoryKey } from './OptionsWindow.js';

/**
 * §5.10 (O) — 옵션 창의 **유일한 마운트 지점**(셸마다 하나).
 *
 * 여는 쪽이 둘이 됐다(File 메뉴 · 기억 정리 칸의 「활성화 하러 가기」). 각자 창을 들면 두 벌이 겹쳐
 * 뜨므로, 열림 여부와 처음 보일 탭은 스토어(`optionsCategory`)가 들고 창은 여기서만 그린다 —
 * 가이드(`GuideWindowHost`)와 같은 문법이다.
 */
export function OptionsWindowHost(): React.JSX.Element | null {
  const category = useGraphStore((s) => s.optionsCategory);
  const closeOptions = useGraphStore((s) => s.closeOptions);
  if (!category) return null;
  return <OptionsWindow open onClose={closeOptions} initialCategory={category as CategoryKey} />;
}
