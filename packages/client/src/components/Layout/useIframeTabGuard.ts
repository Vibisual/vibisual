/**
 * §7.11 / §3.5 — 열어 둔 프리뷰 탭이 지금 보여 주려는 주소를 **불러와도 되는가**.
 *
 * 탭은 연 순간의 주소를 들고 있고 탭 목록은 프로젝트 탭과 상관없이 하나로 공유된다. A 에서 연 탭을
 * B 를 보는 중에 누르면, 그 사이 A 의 서버가 내려가고 B 가 같은 주소를 잡았을 때 탭이 B 의 화면을
 * 다시 불러왔다(2026-10-01 신고의 남은 길). 그래서 화면을 불러오기 직전과 떠 있는 동안 서버에 묻는다
 * — 판정 규칙은 `utils/iframeTabFollow.ts`, 판정 자체는 서버(`judgeIframeTab`).
 *
 * - `pending`: 첫 판정 전 — iframe 을 아직 띄우지 않는다(남의 화면이 한 순간도 스치지 않게).
 * - `show`: 그대로 보여 준다(우리 서버 · 주인 미상 · 못 읽음).
 * - `block`: 다른 열린 프로젝트의 서버다 — 불러오지 않는다. 떠 있는 동안 계속 묻고, 우리 서버가
 *   돌아오면 다시 보여 준다.
 * `follow` 판정은 스토어의 탭 주소를 옮긴다 — 화면은 탭 주소를 따라가므로 옮긴 주소로 다시 묻는다.
 *
 * `enabled` 가 false 면(사용자가 주소창으로 딴 데를 보고 있다) 묻지 않는다 — 명시적으로 고른 주소다.
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
