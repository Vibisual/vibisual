/** §4 앱 테마 — 창 색을 OS 에 넘기는 판정만 든 순수 모듈. electron·서버 코어를 import 하지 않는다 — 그래야 세 OS 가지를 단위 테스트한다. */
import type { AppThemeChrome } from '@vibisual/shared';

/** 기본 테마의 창 색 — 서버 코어가 아직 답하지 못할 때(부팅 실패 직후 등)의 바닥. */
export const FALLBACK_APP_THEME_CHROME: AppThemeChrome = {
  themeId: 'vibisual-dark',
  kind: 'dark',
  background: '#030712',
  titleBar: '#334155',
  titleBarSymbol: '#cbd5e1',
};

/** 제목줄 오버레이(OS 최소화·최대화·닫기 단추) 색 — Windows·Linux 만(`setTitleBarOverlay`). macOS 는 신호등에 색 지정이 없어 `null`. */
export function titleBarOverlayFor(
  chrome: AppThemeChrome,
  platform: NodeJS.Platform,
): { color: string; symbolColor: string } | null {
  if (platform === 'darwin') return null;
  return { color: chrome.titleBar, symbolColor: chrome.titleBarSymbol };
}
