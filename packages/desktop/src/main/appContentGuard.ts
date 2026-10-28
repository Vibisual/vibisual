import type { WebContents } from 'electron';
import { isAppContentPath } from '@vibisual/shared';

/**
 * §5.13 (T-3)(T-11) ③ — **앱 콘텐츠 프레임은 처음 연 문서 밖으로 가지 못한다.**
 * 내부 앱 iframe 의 정적 콘텐츠(`/api/app/<앱id>/content/…`, 예: 에이전트가 짠 모션 코드)는 샌드박스라 부모·저장소·네트워크에 못 닿지만,
 * CSP 는 프레임 자신의 이동(`location = …`·meta refresh)을 못 막는다 — 두면 다른 파일을 띄워 그 글자가 영상에 찍힌다.
 * 그래서 main 이 모든 창의 하위 프레임 이동을 지켜보다 앱 콘텐츠 프레임이 다른 문서로 가면 막는다(같은 주소 새로고침만 둔다; 해시 이동은 이 사건이 안 온다).
 * **앱 이름을 모른다** — 판정은 공유 모듈의 경로 모양(`isAppContentPath`) 하나뿐이다.
 */

/** URL 이 내부 앱의 정적 콘텐츠인가(vibproxy·http 어느 쪽이든 경로로 본다). */
export function isAppContentUrl(raw: string): boolean {
  if (!raw) return false;
  try {
    return isAppContentPath(new URL(raw).pathname);
  } catch {
    return false;
  }
}

/** 해시를 뗀 같은 문서인가(새로고침). */
function sameDocument(from: string, to: string): boolean {
  try {
    const a = new URL(from);
    const b = new URL(to);
    a.hash = '';
    b.hash = '';
    return a.href === b.href;
  } catch {
    return false;
  }
}

/** 이동을 막아야 하는가 — 지금 문서가 앱 콘텐츠이고, 가려는 곳이 그 문서가 아니다. 순수 판정(시험용). */
export function shouldBlockAppContentNavigation(currentUrl: string, nextUrl: string): boolean {
  if (!isAppContentUrl(currentUrl)) return false;
  return !sameDocument(currentUrl, nextUrl);
}

/** 이 webContents 의 하위 프레임 이동을 지켜본다. 창마다 한 번(`web-contents-created`). */
export function guardAppContentFrames(contents: WebContents): void {
  contents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame) return;
    let current = '';
    try {
      current = details.frame?.url ?? '';
    } catch {
      // 프레임이 이미 사라졌다 — 판정할 문서가 없다.
      return;
    }
    if (shouldBlockAppContentNavigation(current, details.url)) details.preventDefault();
  });
}
