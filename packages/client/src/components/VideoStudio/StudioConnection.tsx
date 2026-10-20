import { useEffect } from 'react';
import { WS_PATH } from '@vibisual/shared';

import { useWebSocket } from '../../hooks/useWebSocket.js';
import { useGraphStore } from '../../stores/graphStore.js';

/**
 * §5.13 (X) 39-1 — 스튜디오가 **자기 창의 소켓**을 여는 자리. 단독 창(`#app=…` OS 창)에서만 선다.
 *
 * - **앱 안 창(메인 캔버스·별창 캔버스 안 — `appWindowId`)에서는 열지 않는다.** 그 셸의 소켓이 이미 같은 스토어를 채운다.
 *   하나 더 열면 같은 창에 연결이 둘이 되어 ① 열 때 전체 스냅샷이 두 번 더 오고(연결 · 범위 선언 회신) ② 그 뒤 모든 방송·
 *   스트림을 두 소켓이 따로 풀며 ③ 스토어의 보내기 창구(`_registerWsSend`)를 이 소켓이 가져갔다가, 창을 닫으면 닫힌 소켓을
 *   가리킨 채 남았다(탭 불러오기·닫기 메시지가 조용히 버려진다). Vibimage·Vibi3D 패널이 이미 지키던 규칙과 같다.
 * - 단독 창은 **자기 프로젝트**를 선언한다(`setActiveProjectLocal` — 이 창에만). 활성 프로젝트는 모든 창이 나눠 쓰는 저장값에서
 *   풀려 메인 창이 보던 탭이 되는데, 그대로 두면 서버가 그 탭만 실어 스튜디오 프로젝트의 에이전트가 이 창에 오지 않는다.
 * - 슬라이스는 **스코프 대상 묶음을 하나도 안 읽는다**고 말한다(`[]`). 이 창이 그리는 것(문서·대화·에이전트·노드)은 `ideLane`·
 *   `pluginAgentData` 밖이다(IDE 는 버블 오버레이 창이 따로 연다). 말하지 않으면 이 창이 떠 있는 동안 서버가 **모든 창에** 전량을
 *   실었다(§9 슬라이스 축 — 미선언 창 하나가 합집합을 전량으로 되돌린다).
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
