import { WEB_PAGE_TAB_PREFIX, type BubbleData } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useWebOpenTargetStore } from '../../stores/webOpenTarget.js';
import { hasIframeTabHost } from '../../utils/iframeTabHost.js';
import { domainOpenTarget } from './domainOpenTarget.js';

/**
 * §5.23 「더블클릭」 — 도메인 버블을 더블클릭하면 그 버블에서 마지막으로 읽은 주소를 연다.
 *
 * 어느 주소인지는 `domainOpenTarget`(순수), 어디서 여는지는 기계 단위 설정(`useWebOpenTargetStore` — 기본 바깥 브라우저)이다.
 * 설정은 **동기로** 읽는다 — 누른 뒤 서버 응답을 기다리지 않는다.
 *
 * - 바깥 브라우저: 앱에 하나뿐인 여는 길 그대로(`window.open` → main `setWindowOpenHandler` → `openExternalWithNotice` —
 *   스킴 가드·실패 안내·리눅스 탐침이 함께 온다). 새 IPC·새 REST 를 만들지 않는다.
 * - 앱 안 iframe 탭: 버블마다 탭 하나(`web-<버블 id>`). 이미 있으면 그 탭을 지금의 마지막 주소·이름으로 옮겨 앞에 세운다.
 *   iframe 탭 줄이 없는 창이면 보이지 않는 탭을 만드는 대신 바깥 브라우저로 연다(`iframeTabHost.ts`).
 *
 * 열 것이 없으면(검색어 없는 검색 버블) 아무것도 하지 않고 `false`.
 */
export function openDomainBubble(data: BubbleData): boolean {
  const target = domainOpenTarget(data, useGraphStore.getState().domainEntries);
  if (!target) return false;
  openWebAddress(`${WEB_PAGE_TAB_PREFIX}${data.id}`, target.url, target.label);
  return true;
}

/**
 * 주소 하나를 설정이 고른 자리에서 연다 — 위 도메인 버블과 §5.5 #17-50 세션 버블 지도의 웹 버블이 **같은 길**을 쓴다
 * (여는 곳이 둘로 갈리면 설정을 바꿔도 한쪽만 따른다). `tabId` 는 앱 안 iframe 탭을 고를 때의 탭 이름이다.
 */
export function openWebAddress(tabId: string, url: string, label: string): void {
  const store = useGraphStore.getState();
  if (useWebOpenTargetStore.getState().target === 'iframe' && hasIframeTabHost()) {
    store.openIframeTab({ id: tabId, url, label, serverKind: 'frontend' });
    store.followIframeTab(tabId, url, label);
    return;
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    // 창이 막히면 조용히 넘어간다 — 더블클릭 한 번에 오류창이 뜨는 편이 더 나쁘다(`webSearchUrl` 과 같은 판단).
  }
}
