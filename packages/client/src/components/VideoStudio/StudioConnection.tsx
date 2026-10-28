import { useEffect } from 'react';
import { WS_PATH } from '@vibisual/shared';

import { useWebSocket } from '../../hooks/useWebSocket.js';
import { useGraphStore } from '../../stores/graphStore.js';

/**
 * §5.13 (X) 39-1 — 스튜디오 자기 소켓. 단독 창(`#app=…` OS 창)에서만 연다 — 앱 안 창(`appWindowId`)에서 열면 연결이 둘이 되어 스냅샷·방송을 두 번 풀고,
 * `_registerWsSend` 가 닫힌 소켓을 가리킨 채 남아 탭 메시지가 조용히 버려진다(Vibimage·Vibi3D 패널과 같은 규칙).
 * 단독 창은 자기 프로젝트를 선언한다(`setActiveProjectLocal` — 안 하면 메인 탭으로 풀려 이 프로젝트 에이전트가 안 온다).
 * 슬라이스는 `[]` 로 선언한다 — 미선언 창 하나가 모든 창을 전량 싣기로 되돌린다(§9 슬라이스 축).
 */
const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`;
const READS_NO_SCOPED_SLICES: readonly [] = [];

export function StudioConnection({ projectName }: { readonly projectName: string | null }): null {
  useWebSocket(WS_URL, { sliceScope: READS_NO_SCOPED_SLICES });
  const setActiveProjectLocal = useGraphStore((s) => s.setActiveProjectLocal);
  const activeProject = useGraphStore((s) => s.activeProject);
  useEffect(() => {
    if (projectName && activeProject !== projectName) setActiveProjectLocal?.(projectName);
  }, [projectName, activeProject, setActiveProjectLocal]);
  return null;
}
