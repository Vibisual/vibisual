/**
 * §4 앱 테마 — 창 색을 OS 에 어떻게 넘길지의 **판정만** 든 순수 모듈.
 *
 * electron·서버 코어를 import 하지 않는다 — 그래야 Windows 개발기에서 세 OS 의 가지를 전부 단위
 * 테스트할 수 있다(멀티플랫폼 규칙: 플랫폼 분기는 `platform` 을 인자로 받는다).
 */
import type { AppThemeChrome } from '@vibisual/shared';

/**
 * 기본 테마(종전 화면)의 창 색. 서버 코어가 아직 답하지 못할 때(부팅 실패 직후 등)의 바닥이며,
 * 이 값은 종전에 창 생성부에 박혀 있던 그대로다(`#030712` 바탕 · `#334155` 제목줄 · `#cbd5e1` 단추).
 */
export const FALLBACK_APP_THEME_CHROME: AppThemeChrome = {
  themeId: 'vibisual-dark',
  kind: 'dark',
  background: '#030712',
  titleBar: '#334155',
  titleBarSymbol: '#cbd5e1',
};

/**
 * 제목줄 오버레이(OS 가 그리는 최소화·최대화·닫기 단추 자리)의 색 — **Windows·Linux 만** 받는다.
 * macOS 는 같은 설정(`titleBarStyle: 'hidden'`)이 신호등을 띄우고 색 지정이 없다(Electron 문서상
 * `setTitleBarOverlay` 는 Windows·Linux). 그래서 mac 에는 `null` — 아무것도 칠하지 않는다.
 */
export function titleBarOverlayFor(
  chrome: AppThemeChrome,
  platform: NodeJS.Platform,
): { color: string; symbolColor: string } | null {
  if (platform === 'darwin') return null;
  return { color: chrome.titleBar, symbolColor: chrome.titleBarSymbol };
}
