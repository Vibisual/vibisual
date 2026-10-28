import { useEffect } from 'react';
import { useGraphStore } from '../stores/graphStore.js';
import { panesYieldingToDetachedIDE } from '../stores/detachedIDEFocus.js';
import { captureIDEPaneHandoff, coerceIDEPaneHandoff } from '../stores/idePaneHandoff.js';
import { putPaneDragResume } from '../stores/idePaneDragResume.js';
import { scheduleGhostHide } from '../components/IDE/ghostHandoff.js';

// §5.5 #17-6 (G) — 메인 윈도우 전용. 오버레이 버블 우클릭 점프의 `vibisual:overlay:reveal` 를 §5.4 #30 과 같은 순서(프로젝트 전환 → 직전 IDE 닫기 → 포커싱+선택)로 처리한다.
// 되돌아오는 길(`openIde`)은 카메라만((H-14)).

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
        // §5.5 #17-6 (H-14) — **고르지 않고** 카메라만 맞춘다(고르면 `DetailPanel` 이 IDE 옆에 함께 열린다). (H-4) ③ — 끌던 도중 돌아온 창은 드래그를 이어받으므로 짐은 창이 서기 **전에** 맡긴다.
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
        // §5.5 #17-6 (H-15) — **선 걷기 부탁을 여기서도 한다(그물)** — 짐 없는 되돌리기·판이 못 선 경우에도 선이 남지 않게(두 번 걷어도 안전). (H) — 지고 온 짐은 그대로 이어 세운다.
        // `redock` 이 없으면 목록에 남은 밖의 창을 앞으로 세우고 끝나 앱 안에 아무것도 안 선다.
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
      // 직전 세션 점프로 열린 IDE 가 캔버스를 가리지 않게 닫고 그 버블로 카메라 이동+선택. §5.5 #17-6 (H-9) — 닫기로 돌아온 길(`keepPanes`)은 닫지 않는다(앱에서 보던 남의 창까지 닫힌다).
      if (!keepPanes) store.closeIDEOverlay();
      store.focusOnNode(agentId);
      store.selectNode(agentId);
    });
    return () => { off(); };
  }, []);

  // §5.5 #17-6 (H-27) ⑤ — 밖의 창이 IDE 로 펴졌는데 앱 안에 같은 에이전트 창이 있으면 앱 안 창이 물러난다 — 짐을 (H) 꺼내기 길(`overlay.open` → `pane-handoff`)로 넘기고 닫는다(그냥 닫으면 탭·뷰·세션을 잃는다).
  useEffect(() => {
    const overlay = typeof window !== 'undefined' ? window.api?.overlay : undefined;
    if (!overlay?.onIdeOpened) return;
    const off = overlay.onIdeOpened(({ agentId, projectId }) => {
      const store = useGraphStore.getState();
      const { front, paneKeys } = panesYieldingToDetachedIDE(Object.values(store.ideOverlays), agentId);
      if (paneKeys.length === 0) return;
      const handoff = front ? captureIDEPaneHandoff(front) : null;
      if (handoff && overlay.open) {
        void overlay.open({ agentId, projectId, expanded: true, handoff })
          .catch(() => { /* 밖의 IDE 는 이미 서 있다 — 짐만 못 건넜을 뿐 두 벌은 아래에서 막는다 */ });
      }
      // 탭의 주인은 밖의 창으로 옮겼다. 뒤에 그 창을 닫아도 앱의 옛 목록이 되살아나면 안 된다.
      for (const key of paneKeys) store.closeIDEOverlay(key, { rememberEditorTabs: false });
    });
    return () => { off(); };
  }, []);
}
