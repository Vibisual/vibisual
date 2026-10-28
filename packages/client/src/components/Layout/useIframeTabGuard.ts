/**
 * §7.11 / §3.5 — 프리뷰 탭이 지금 주소를 불러와도 되는가. 탭 목록은 프로젝트와 무관하게 공유돼, A 서버가 내려가고 B 가 그 주소를 잡으면 A 탭에 B 화면이 뜬다
 * — 불러오기 직전과 떠 있는 동안 서버(`judgeIframeTab`, 규칙 `utils/iframeTabFollow.ts`)에 묻는다.
 * `pending` = 첫 판정 전(iframe ❌) · `show` · `block` = 다른 열린 프로젝트 서버(계속 묻는다) · `follow` = 탭 주소를 옮겨 다시 묻는다.
 * `enabled` false(주소창으로 딴 데를 본다) = 묻지 않는다.
 */
import { useEffect, useState } from 'react';
import type { IframeTabVerdict } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import {
  IFRAME_TAB_FIRST_CHECK_TIMEOUT_MS,
  IFRAME_TAB_RECHECK_MS,
  iframeTabCheckPath,
  iframeTabGuardStep,
  parseIframeTabVerdict,
} from '../../utils/iframeTabFollow.js';

export type IframeTabGuard = 'pending' | 'show' | 'block';

/** 판정 하나를 받아 온다. 시간 초과·실패는 `null`(판정 불가). */
function askVerdict(path: string, timeoutMs: number): Promise<IframeTabVerdict | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    fetch(path)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        clearTimeout(timer);
        resolve(body === null ? null : parseIframeTabVerdict(body));
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

export function useIframeTabGuard(tabId: string, url: string, enabled: boolean): IframeTabGuard {
  const projectPath = useGraphStore((s) => s.iframeTabs.find((t) => t.id === tabId)?.projectPath);
  const path = enabled ? iframeTabCheckPath({ tabId, projectPath, url }) : null;
  const [verdict, setVerdict] = useState<{ path: string; action: 'show' | 'block' } | null>(null);

  useEffect(() => {
    if (!path) return undefined;
    let cancelled = false;
    let asked = false;
    const ask = async (): Promise<void> => {
      const isFirst = !asked;
      asked = true;
      const result = await askVerdict(path, isFirst ? IFRAME_TAB_FIRST_CHECK_TIMEOUT_MS : IFRAME_TAB_RECHECK_MS);
      if (cancelled) return;
      const step = iframeTabGuardStep(result, isFirst);
      if (step.kind === 'keep') return;
      if (step.kind === 'set') {
        setVerdict({ path, action: step.action });
        return;
      }
      const store = useGraphStore.getState();
      const tab = store.iframeTabs.find((t) => t.id === tabId);
      // 옮길 탭이 없으면(그럴 일은 없지만) 의심스러운 주소를 그대로 보여 주지 않는다.
      if (!tab) {
        setVerdict({ path, action: 'block' });
        return;
      }
      // 이미 그 주소다 — 옮길 것이 없으니 보여 준다(그대로 두면 판정 전 상태에 영영 머문다).
      if (tab.url === step.url) {
        setVerdict({ path, action: 'show' });
        return;
      }
      store.followIframeTab(tabId, step.url);
    };
    void ask();
    const timer = setInterval(() => { void ask(); }, IFRAME_TAB_RECHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [path, tabId]);

  if (!path) return 'show';
  return verdict?.path === path ? verdict.action : 'pending';
}
