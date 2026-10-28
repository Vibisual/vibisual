import { WEB_PAGE_TAB_PREFIX, type BubbleData } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useWebOpenTargetStore } from '../../stores/webOpenTarget.js';
import { hasIframeTabHost } from '../../utils/iframeTabHost.js';
import { domainOpenTarget } from './domainOpenTarget.js';

/**
 * §5.23 — 도메인 버블에서 마지막으로 읽은 주소를 연다. 여는 곳 설정(`useWebOpenTargetStore`)은 **동기로** 읽는다(서버를 기다리지 않는다).
 * 바깥 브라우저는 앱에 하나뿐인 길(`window.open` → `openExternalWithNotice` — 스킴 가드·실패 안내·리눅스 탐침) — 새 IPC·REST ❌.
 * 앱 안이면 버블마다 iframe 탭 하나(`web-<버블 id>`), 탭 줄이 없는 창은 바깥 브라우저로(`iframeTabHost.ts`). 열 것이 없으면 `false`.
 */
export function openDomainBubble(data: BubbleData): boolean {
  const target = domainOpenTarget(data, useGraphStore.getState().domainEntries);
  if (!target) return false;
  openWebAddress(`${WEB_PAGE_TAB_PREFIX}${data.id}`, target.url, target.label);
  return true;
}

/** 도메인 버블과 §5.5 #17-50 세션 지도의 웹 버블이 **같은 길**을 쓴다 — 갈리면 설정을 바꿔도 한쪽만 따른다. `tabId` 는 앱 안 iframe 탭 이름. */
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
