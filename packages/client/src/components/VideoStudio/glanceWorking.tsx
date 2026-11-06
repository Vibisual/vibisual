import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DocActivity } from '@vibisual/video';

import { useGraphStore } from '../../stores/graphStore.js';
import { STUDIO_APP_ID } from './studioAppId.js';
import { GLOW_ONCE_MS, ensureStudioMotion } from './studioMotion.js';

/**
 * §5.13 (V) 37-1 — 열린 바퀴를 "일하는 중"으로 믿는 상한(ms). 에이전트가 끝 보고 없이 쉬면 바퀴는 열린 채 남으므로, 마지막
 * 소식이 이보다 오래면 위성을 걷는다(이어진 에이전트가 아직 도는 중이면 그것이 먼저 말한다).
 */
const ACTIVITY_FRESH_MS = 10 * 60_000;

/**
 * §5.13 (V) 37-1 — 이 문서를 가리키는 노드에 이어진 에이전트가 도는가. 이어진 에이전트가 하나도 없으면 `null`(모른다 —
 * 바퀴 소식만으로 판정한다). 판정 결과만 구독한다.
 */
function useLinkedAgentActive(projectName: string, docId: string): boolean | null {
  return useGraphStore((s) => {
    const ids = new Set<string>();
    for (const b of s.appBubbles ?? []) {
      if (b.appId === STUDIO_APP_ID && b.ref === docId && (projectName === '' || b.projectName === projectName)) {
        for (const id of b.linkedAgentIds ?? []) ids.add(id);
      }
    }
    if (ids.size === 0) return null;
    return (s.agents ?? []).some((a) => ids.has(a.id) && a.status === 'active');
  });
}

/** AI 가 이 문서를 만지는 중인가 — 이어진 에이전트가 있으면 그것과 열린 바퀴, 없으면 열린 바퀴의 최근 소식. */
export function useGlanceWorking(projectName: string, docId: string, activity: DocActivity | null): boolean {
  const agentActive = useLinkedAgentActive(projectName, docId);
  const passOpen = activity?.status === 'open' && Date.now() - activity.at < ACTIVITY_FRESH_MS;
  return agentActive === null ? passOpen : agentActive && activity?.status === 'open';
}

/** §5.13 (V) 37-1 — AI 가 만지는 동안 노드 모서리에 위성이 돌고 끝나면 한 번 빛난다(장면 구슬과 같은 표시). 색은 레지스트리 앱 색(`glow`) 하나. */
export function WorkingSatellite({ working, glow }: { readonly working: boolean; readonly glow: string }): React.JSX.Element | null {
  const { t } = useTranslation();
  const [flash, setFlash] = useState(false);
  const was = useRef(working);
  useEffect(() => { ensureStudioMotion(); }, []);
  useEffect(() => {
    if (was.current && !working) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), GLOW_ONCE_MS);
      was.current = working;
      return () => clearTimeout(timer);
    }
    was.current = working;
    return undefined;
  }, [working]);
  const accent = { '--vs-accent': glow } as React.CSSProperties;
  if (working) {
    return (
      <span className="pointer-events-none absolute right-1.5 top-1.5 h-5 w-5 animate-[vs-orbit_2.4s_linear_infinite]" style={accent}
        role="status" aria-label={t('panel.videoStudio.strip.working')}>
        <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full" style={{ backgroundColor: glow, boxShadow: `0 0 6px ${glow}` }} />
      </span>
    );
  }
  if (flash) {
    return <span className="pointer-events-none absolute inset-0 animate-[vs-glow-once_900ms_ease-out] rounded-[inherit]" style={accent} aria-hidden="true" />;
  }
  return null;
}
