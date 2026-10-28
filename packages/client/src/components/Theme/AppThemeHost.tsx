/** §4 앱 테마 배선(그리는 것 없음) — 창마다 한 번, `main.tsx` 의 shell 바깥(안이면 별창·지휘통제실·오버레이·앱 창에서 빠진다). */
import { useAppThemeSync } from '../../theme/useAppTheme.js';

export function AppThemeHost(): null {
  useAppThemeSync();
  return null;
}
