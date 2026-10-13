/**
 * §4 앱 테마 — 창마다 한 번 마운트되는 테마 배선(그리는 것은 없다).
 *
 * 부팅 지점(`main.tsx`)에서 shell 바깥에 둔다 — 별창·지휘통제실·오버레이·내부 앱 창도 같은 테마를
 * 칠해야 하고, shell 안에 두면 그 창들에서 빠진다(InspectorOverlay 를 거기 둔 것과 같은 이유).
 */
import { useAppThemeSync } from '../../theme/useAppTheme.js';

export function AppThemeHost(): null {
  useAppThemeSync();
  return null;
}
