import { useEffect } from 'react';
import { useGraphStore } from '../stores/graphStore.js';
import { coerceIDEPaneHandoff } from '../stores/idePaneHandoff.js';
import { putPaneDragResume } from '../stores/idePaneDragResume.js';
import { scheduleGhostHide } from '../components/IDE/ghostHandoff.js';

// SCENARIO.md §5.5 #17-6 (G) v2.82 — 메인 윈도우 한정.
//
// 오버레이 버블의 우클릭 "본체에서 이 버블로 점프" 가 main 프로세스를 거쳐
// `vibisual:overlay:reveal` 를 메인 윈도우 렌더러로 보낸다. 그 신호를 받아 §5.4 #30 버블 북마크
// 점프와 동형으로 캔버스의 그 버블을 보여준다: 프로젝트 전환 → 직전 IDE 닫기 → 노드 포커싱+선택.
// 단 **되돌아오는 길**(`openIde`)은 고르지 않는다 — 카메라만 맞춘다(§5.5 #17-6 (H-14)).
//
// 메인 윈도우(App)에서만 사용 — 오버레이 창은 OverlayShell 을 렌더하므로 이 훅을 부르지 않는다.
// dev/web 모드(window.api.overlay 없음)에선 no-op.

export function useOverlayReveal(): void {
  useEffect(() => {
    const overlay = typeof window !== 'undefined' ? window.api?.overlay : undefined;
    if (!overlay?.onReveal) return;
    const off = overlay.onReveal(({ agentId, projectId, openIde, keepPanes, hasHandoff, resumeDrag }) => {
      const store = useGraphStore.getState();
      const known = !!store.projects[projectId] || !!store.stubProjects[projectId];
      if (known) store.setActiveProject(projectId);
      if (openIde) {
        // (판올림 번호 발급 대기) 밖으로 끌어냈던 창을 **앱 안으로 되돌리는** 길 — 캔버스로 점프만
        //   하면 되돌린 게 아니다(사용자는 그 IDE 를 계속 보려고 되돌린다). 그 자리에 창을 다시 연다.
        store.focusOnNode(agentId);
        // §5.5 #17-6 (H-14) — **고르지는 않는다.** 아래 점프 길이 버블을 고르는 것은 "그 버블을
        //   보여 달라"는 손짓이라 그렇고(§5.4 #30 북마크 점프와 같은 규율), 되돌아오는 길은 그
        //   손짓이 아니다 — 사용자는 IDE 를 계속 보려고 창을 들고 들어왔다. 여기서 고르면 그
        //   순간 캔버스 옆에 에이전트 설정 패널(`selectedNodeId` → `DetailPanel`)이 함께 열려,
        //   누르지도 않은 창이 IDE 와 나란히 뜬다(사용자 보고). 카메라만 그 버블에 맞춘다.
        // §5.5 #17-6 (H-4) ③ — 끌던 **도중에** 돌아온 창이면(손이 아직 눌려 있다) 앱 안에 서는
        //   창이 그 드래그를 그대로 이어받는다. 짐은 창이 서기 **전에** 맡겨야 한다 — 창이 선
        //   뒤에 맡기면 그 창은 이미 "이어받을 것 없음"으로 마운트를 마친 뒤다.
        if (resumeDrag) {
          putPaneDragResume({
            agentId,
            grabX: resumeDrag.grabX,
            grabY: resumeDrag.grabY,
            width: resumeDrag.width,
            height: resumeDrag.height,
            cursor: resumeDrag.cursor,
            // (H-17) 손을 떼서 합쳐진 판이면 자리만 물려받는다(끌던 판이면 종전대로 이어받는다).
            dragging: resumeDrag.dragging,
          });
        }
        // §5.5 #17-6 (H-15) — **선을 걷는 부탁은 여기서도 한다(그물).** 종전에는 (H-12) 윤곽선을
        //   걷는 자리가 **이어받을 짐이 있는 판** 하나뿐이었다 — 짐이 안 실려 온 되돌리기(↩ 버튼·
        //   칩 드래그)나 그 판이 어떤 이유로 서지 못한 경우에는 아무도 말하지 않아, main 의 그물이
        //   걷을 때까지 클릭통과 선이 커서에 붙어 있었다. 앱 안에 창을 세우는 이 자리도 "선이
        //   창이 된" 순간이므로 같은 부탁을 함께 보낸다(두 번 걷어도 안전하다 — 선은 한 벌이다).
        // §5.5 #17-6 (H) — 그 창이 **지고 온 짐**이 있으면 그대로 이어 세운다: 열어 둔 편집 탭·
        //   보던 뷰·고른 세션은 물론 **밖으로 나가기 전 붙어 있던 변**까지 되살아나, 되돌리기가
        //   "그 창이 원래 자리로 돌아온 것"이 된다(종전에는 늘 새 창이 떠 하던 일을 잃었다).
        // §5.5 #17-6 (판올림 번호 발급 대기) — `redock` 은 "밖에서 안으로 돌아오는 길"이라는 표시다.
        //   그 표시가 없으면 앱 안에 창을 세우는 대신 **아직 목록에 남아 있는 밖의 그 창**을
        //   앞으로 세우고 끝나, 되돌리기를 눌러도 앱 안에는 아무것도 서지 않는다.
        if (!hasHandoff || !overlay.takeHandoff) {
          store.openIDEOverlay(agentId, { pane: 'new', redock: true });
          scheduleGhostHide();
          return;
        }
        void overlay.takeHandoff(agentId).then((raw) => {
          const handoff = coerceIDEPaneHandoff(raw);
          useGraphStore.getState().openIDEOverlay(agentId, {
            pane: 'new',
            handoff,
            handoffTarget: 'app',
            redock: true,
          });
          scheduleGhostHide();
        });
        return;
      }
      // 직전 세션 점프로 열린 IDE 가 캔버스를 가리지 않도록 닫고, 그 버블로 카메라 이동+선택.
      //
      // §5.5 #17-6 (H-9) — 단, **닫기로 돌아온 길**(`keepPanes`)은 그 한 줄을 건너뛴다. 밖에 있던
      //   창 하나를 닫았을 뿐인데 앱에서 보고 있던 **남의 창**이 함께 닫히면, 닫기가 누르지도
      //   않은 창까지 가져간다. 앞 창 정리는 우클릭 점프의 규율이지 닫기의 규율이 아니다.
      if (!keepPanes) store.closeIDEOverlay();
      store.focusOnNode(agentId);
      store.selectNode(agentId);
    });
    return () => { off(); };
  }, []);
}
