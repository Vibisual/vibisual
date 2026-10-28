import { useGraphStore } from '../../stores/graphStore.js';
import { OptionsWindow, type CategoryKey } from './OptionsWindow.js';

/** §5.10 (O) — 옵션 창의 유일한 마운트 지점(셸마다 하나). 여는 쪽이 여럿이라 열림·첫 탭은 스토어 `optionsCategory` 가 들고 창은 여기서만 그린다(`GuideWindowHost` 와 같다). */
export function OptionsWindowHost(): React.JSX.Element | null {
  const category = useGraphStore((s) => s.optionsCategory);
  const closeOptions = useGraphStore((s) => s.closeOptions);
  if (!category) return null;
  return <OptionsWindow open onClose={closeOptions} initialCategory={category as CategoryKey} />;
}
