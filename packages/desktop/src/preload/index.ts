import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import type { UpdateState, AgentConfig, MobileAccessState, ChatBridgeState, ChatChannelKind, ChatVerbosity, CaptureSourceInfo, CaptureInputEvent, CaptureSourceKind, CaptureTargetRect, CaptureInjectResult, PreviewSnipRect, PageRegionCapture, ExternalOpenFailure } from '@vibisual/shared';

// Preload — SCENARIO.md §3.7 / §3.4 contextBridge surface.
//
// renderer 의 transport 어댑터(install-packaged-transport.ts)가 global fetch + WebSocket 을
// 이 채널들로 monkey-patch 한다(window.api 존재 시). UI 소스는 손대지 않는다.

export interface FetchInitWire {
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  /** `body` 가 base64 인코딩 바이너리(FormData/Blob 등)임을 표시 — multipart 업로드 경로. */
  bodyEncoding?: 'base64';
}

export interface FetchResponseWire {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  /** `body` 가 base64 인코딩 바이너리임을 표시 — 비텍스트 응답(이미지 등) 무손실 전달. */
  bodyEncoding?: 'base64';
}

export interface ServerInfo {
  port: number;
  running: boolean;
}

// SCENARIO.md §5.4 #14-1 (v2.29) — 별창 detach/redock IPC surface.
export type DetachKindWire = 'project' | 'iframe';
export interface DetachedTabInfoWire {
  windowId: number;
  tabKey: string;
  kind: DetachKindWire;
}
export interface DetachPayloadWire {
  kind: DetachKindWire;
  tabKey: string;
  cursor?: { x: number; y: number };
}
export interface RectWire { x: number; y: number; width: number; height: number }
export interface PointWire { x: number; y: number }

// SCENARIO.md §5.5 #17-6 (v2.73) — 버블 오버레이 창 IPC surface.
export interface OverlayInfoWire {
  windowId: number;
  agentId: string;
  projectId: string;
  expanded: boolean;
}
export interface OverlayListWire {
  overlays: OverlayInfoWire[];
  userVisible: boolean;
}

const api = {
  serverInfo: (): Promise<ServerInfo> => ipcRenderer.invoke('vibisual:server-info'),
  /**
   * OS 파일 드래그앤드롭 — 드롭된 File 의 절대경로 해석(Electron 31+ webUtils).
   * `File.path` 는 Electron 32 에서 제거 예정이라 공식 권장 경로(webUtils.getPathForFile)로 통일.
   * 동기 반환이며 File 객체는 contextBridge 가 그대로 preload 로 전달한다.
   */
  getPathForFile: (file: File): string => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },
  request: (path: string, init?: FetchInitWire): Promise<FetchResponseWire> =>
    ipcRenderer.invoke('vibisual:fetch', path, init),
  send: (message: unknown): Promise<void> => ipcRenderer.invoke('vibisual:send', message),
  /** IpcWebSocket 생성 시 호출 → main 이 초기 connection_ack + graph_snapshot 을 푸시한다. */
  connect: (): Promise<void> => ipcRenderer.invoke('vibisual:ws-connect'),
  onMessage: (cb: (payload: unknown) => void): (() => void) => {
    const listener = (_e: unknown, payload: unknown): void => cb(payload);
    ipcRenderer.on('vibisual:ws', listener);
    return () => ipcRenderer.removeListener('vibisual:ws', listener);
  },
  /** §5.4 #14-1 별창 surface. */
  window: {
    detach: (payload: DetachPayloadWire): Promise<{ windowId: number; reused: boolean }> =>
      ipcRenderer.invoke('vibisual:window:detach', payload),
    closeDetached: (tabKey: string): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:window:close-detached', tabKey),
    closeSelf: (): Promise<boolean> => ipcRenderer.invoke('vibisual:window:close-self'),
    minimizeSelf: (): Promise<boolean> => ipcRenderer.invoke('vibisual:window:minimize-self'),
    toggleMaximizeSelf: (): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:window:toggle-maximize-self'),
    /** main 이 maximize/unmaximize 시 푸시하는 자기 창의 최대화 상태 구독(아이콘 토글용). */
    onMaximizeState: (cb: (payload: { maximized: boolean }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { maximized: boolean }): void => cb(payload);
      ipcRenderer.on('vibisual:window:maximize-state', listener);
      return () => ipcRenderer.removeListener('vibisual:window:maximize-state', listener);
    },
    listDetached: (): Promise<DetachedTabInfoWire[]> =>
      ipcRenderer.invoke('vibisual:window:list-detached'),
    hasTab: (tabKey: string): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:window:has-tab', tabKey),
    cursorScreen: (): Promise<PointWire> => ipcRenderer.invoke('vibisual:window:cursor-screen'),
    mainBounds: (): Promise<RectWire | null> =>
      ipcRenderer.invoke('vibisual:window:main-bounds'),
    redockDrag: (tabKey: string, hovering: boolean): Promise<void> =>
      ipcRenderer.invoke('vibisual:window:redock-drag', { tabKey, hovering }),
    redockCommit: (tabKey: string): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:window:redock-commit', tabKey),
    /** 모든 창에 푸시되는 현재 detached 목록 — 메인 TabBar 가 그 키 숨김. */
    onDetachedList: (cb: (list: DetachedTabInfoWire[]) => void): (() => void) => {
      const listener = (_e: unknown, list: DetachedTabInfoWire[]): void => cb(list);
      ipcRenderer.on('vibisual:detached:list', listener);
      return () => ipcRenderer.removeListener('vibisual:detached:list', listener);
    },
    /** 별창에서 보낸 redock-drag 가 메인의 탭바 위에 있을 때 메인에 푸시. */
    onRedockHover: (cb: (payload: { tabKey: string; hovering: boolean }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { tabKey: string; hovering: boolean }): void => cb(payload);
      ipcRenderer.on('vibisual:tab:redock-hover', listener);
      return () => ipcRenderer.removeListener('vibisual:tab:redock-hover', listener);
    },
    /** 별창이 redock 확정 시 메인에 푸시 — 메인 TabBar 가 탭 재등장. */
    onRedockCommit: (cb: (payload: { tabKey: string; kind: DetachKindWire | null }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { tabKey: string; kind: DetachKindWire | null }): void => cb(payload);
      ipcRenderer.on('vibisual:tab:redock-commit', listener);
      return () => ipcRenderer.removeListener('vibisual:tab:redock-commit', listener);
    },
    // §5.4 #14-1 v2.30 — 별창 미니 타이틀바 드래그 시작/종료. 본체가 mini ghost 로 축소되어
    // cursor 따라가게 한다(main 의 windowManager 가 폴링).
    startDetachDrag: (): Promise<boolean> => ipcRenderer.invoke('vibisual:window:detach-drag-start'),
    endDetachDrag: (commit: boolean): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:window:detach-drag-end', commit),
    /** main 의 polling 이 별창 자신에게 dragging/hovering 상태 변경을 푸시. */
    onDragState: (cb: (payload: { dragging: boolean; hovering: boolean }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { dragging: boolean; hovering: boolean }): void => cb(payload);
      ipcRenderer.on('vibisual:tab:redock-drag-state', listener);
      return () => ipcRenderer.removeListener('vibisual:tab:redock-drag-state', listener);
    },
  },
  /** §5.5 #17-6 (v2.73) — 버블 오버레이 창 surface. */
  overlay: {
    /**
     * 에이전트 버블을 데스크톱 상시-위 위젯 창으로 분리. 이미 있으면 그 창 focus.
     * (판올림 번호 발급 대기) `expanded` 면 버블이 아니라 **IDE 크기로 바로** 뜬다 —
     * IDE 창을 앱 밖으로 끌어내 만든 독립 창이 그 경로다(`size` 는 끌던 창 크기).
     */
    open: (payload: {
      agentId: string;
      projectId: string;
      cursor?: { x: number; y: number };
      expanded?: boolean;
      size?: { width: number; height: number };
      /** §17-6 (H) — 앱 안에서 그 창이 들고 있던 것(열어 둔 편집 탭·보던 뷰·붙어 있던 변). */
      handoff?: unknown;
      /**
       * §17-6 (H-4) — 앱 경계를 넘는 **그 순간** 만들어지는 창. 잡고 있던 지점(창 좌상단에서
       * 커서까지의 거리)을 그대로 물려받아 커서에 매달린 채 뜬다 — 끌던 손 아래에서 창이 이어진다.
       */
      follow?: { grabX: number; grabY: number };
    }): Promise<{ windowId: number; reused: boolean }> =>
      ipcRenderer.invoke('vibisual:overlay:open', payload),
    /**
     * §17-6 (H) — 새로 뜬 창이 **자기 짐**을 꺼낸다. 한 번 꺼내면 사라지고, 없으면 null 이다
     * (그때는 종전대로 첫 화면에서 시작한다 — 짐이 없다고 창이 안 뜨지는 않는다).
     */
    takeHandoff: (agentId: string): Promise<unknown> =>
      ipcRenderer.invoke('vibisual:overlay:take-handoff', agentId),
    /** 특정 에이전트의 오버레이 창 닫기(메인에서 토글 해제 시). */
    close: (agentId: string): Promise<boolean> => ipcRenderer.invoke('vibisual:overlay:close', agentId),
    /** 오버레이 창이 자기 자신을 닫기. */
    closeSelf: (): Promise<boolean> => ipcRenderer.invoke('vibisual:overlay:close-self'),
    /** 버블 클릭 → 자기 창을 IDE 크기로 확대. */
    expandSelf: (): Promise<boolean> => ipcRenderer.invoke('vibisual:overlay:expand-self'),
    /** IDE 닫기 → 자기 창을 버블 크기로 축소. */
    collapseSelf: (): Promise<boolean> => ipcRenderer.invoke('vibisual:overlay:collapse-self'),
    /**
     * §17-6 (H-5) — 독립 창의 [최대화/복원] 토글. 이 창은 `frame:false + transparent` 라 OS
     * 타이틀바도 시스템 최대화도 없어, main 이 작업영역으로 bounds 를 옮겨 직접 한다.
     */
    toggleMaximizeSelf: (): Promise<boolean> => ipcRenderer.invoke('vibisual:overlay:toggle-maximize-self'),
    /** §17-6 (H-5) — main 이 밀어 주는 자기 창의 최대화 상태(아이콘은 **이 값만** 따른다). */
    onMaximizeState: (cb: (payload: { maximized: boolean }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { maximized: boolean }): void => cb(payload);
      ipcRenderer.on('vibisual:overlay:maximize-state', listener);
      return () => ipcRenderer.removeListener('vibisual:overlay:maximize-state', listener);
    },
    /**
     * §17-6 v2.81 — 버블 드래그 = OS 창 이동. mousedown 시 시작(메인이 커서 폴링으로 창을 따라가게).
     * (H-4) 펼친 IDE 창의 타이틀바는 `redockOnEnter` 를 켜서 부른다 — 끌다 앱 안으로 들어오면
     * 그 자리에서 앱 안 IDE 로 돌아간다(그때 실어 보낼 짐도 **시작할 때** 함께 맡긴다).
     */
    dragStart: (payload?: { redockOnEnter?: boolean; handoff?: unknown }): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:overlay:drag-start', payload),
    /** 버블 드래그 종료(window mouseup) — 커서 폴링 해제. */
    dragEnd: (): Promise<boolean> => ipcRenderer.invoke('vibisual:overlay:drag-end'),
    /**
     * §17-6 (H-4) — **다른 창의** 매달림을 끝낸다(앱에서 끌어내 만든 창은 손이 메인 창에 있다).
     * 뗌은 두 창이 함께 듣는다 — 캡처가 어디에 있든 한쪽은 반드시 듣게(두 번 불려도 안전).
     */
    dragEndFor: (agentId: string): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:overlay:drag-end-for', agentId),
    /**
     * §17-6 (H-6) — 밖으로 빼는 동안 그리는 **가상 창 윤곽선**. 앱 창 밖은 렌더러가 그릴 수 없어
     * main 이 클릭통과 투명 창으로 대신 그린다. 자리는 main 이 커서를 폴링해 정하므로(= `follow` 와
     * 같은 물리) 윤곽선과 곧 태어날 창이 같은 자리를 그린다. 거짓이면 앱 안 윤곽선으로 폴백한다.
     */
    ghostShow: (payload: {
      width: number;
      height: number;
      grabX: number;
      grabY: number;
      label?: string;
      /** 지금 손을 떼도 그대로 나가는가 — 선이 밝아져 놓기 **전에** 그것을 말한다. */
      armed?: boolean;
    }): Promise<boolean> => ipcRenderer.invoke('vibisual:overlay:ghost-show', payload),
    /** §17-6 (H-6) — 가장자리 버팀 동안 윤곽선을 그 변 밖으로 밀어 낸다(어디에 설지 미리 보여 주기). */
    ghostNudge: (payload: { dx: number; dy: number }): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:overlay:ghost-nudge', payload),
    /** §17-6 (H-6) — 윤곽선 걷기(도로 앱 안 · 손 뗌). 밖으로 나간 경우는 main 이 스스로 걷는다. */
    ghostHide: (): Promise<boolean> => ipcRenderer.invoke('vibisual:overlay:ghost-hide'),
    /**
     * §17-6 (H-7) — **이 창이 다 그려졌다.** 끌어내서 만든 창은 부팅(스냅샷 → 짐 꺼내기 → IDE
     * 마운트)이 `ready-to-show` 보다 한참 뒤에 끝난다 — main 은 이 신호를 받고서야 윤곽선을
     * 걷는다(그전에 걷으면 투명한 빈 창만 커서 아래 남는다).
     */
    shellReady: (): Promise<boolean> => ipcRenderer.invoke('vibisual:overlay:shell-ready'),
    /**
     * §17-6 (H-8) — **앱 안 IDE 창을 끄는 동안 커서를 main 이 대신 본다.**
     * 밖에서 끌던 손을 이어받은 판에는 이 창의 `mousedown` 이 없어 마우스 캡처가 없다 —
     * 커서가 창 밖으로 나가면 렌더러에 이벤트가 끊겨 "밖으로 나갔다"가 영영 서지 않는다.
     */
    paneDragWatch: (on: boolean): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:ide:pane-drag-watch', on),
    /** §17-6 (H-8) — 커서가 이 창 밖으로 나갔다(한 판에 한 번). 좌표는 **화면 좌표**다. */
    onPaneDragEscape: (cb: (payload: { cursor: { x: number; y: number } }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { cursor: { x: number; y: number } }): void => cb(payload);
      ipcRenderer.on('vibisual:ide:pane-drag-escape', listener);
      return () => ipcRenderer.removeListener('vibisual:ide:pane-drag-escape', listener);
    },
    /** §17-6 (H-4) — 이 창이 지금 커서에 매달려 있는가(그렇다면 이 창도 뗌을 듣는다). */
    onFollowDragState: (cb: (payload: { following: boolean }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { following: boolean }): void => cb(payload);
      ipcRenderer.on('vibisual:overlay:follow-drag-state', listener);
      return () => ipcRenderer.removeListener('vibisual:overlay:follow-drag-state', listener);
    },
    /**
     * §17-6 (H) — 꺼낸 IDE 창을 **끌어다 앱 안으로 합치기**. 잡으면 창이 칩으로 줄어 커서를 따라오고,
     * 메인 창 위에서 놓으면 합쳐진다(밖에서 놓으면 원래 자리로 되돌아온다).
     */
    redockDragStart: (): Promise<boolean> => ipcRenderer.invoke('vibisual:overlay:redock-drag-start'),
    /** 합치기 드래그 종료(window mouseup). `commit` 이면 합치고, 그때 들고 갈 짐도 함께 넘긴다. */
    redockDragEnd: (payload: { commit: boolean; handoff?: unknown }): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:overlay:redock-drag-end', payload),
    /** §17-6 (H) — main 의 폴링이 이 창에 알리는 합치기 드래그 상태(칩 모양 전환·놓을 자리 강조). */
    onRedockDragState: (cb: (payload: { dragging: boolean; hovering: boolean }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { dragging: boolean; hovering: boolean }): void => cb(payload);
      ipcRenderer.on('vibisual:overlay:redock-drag-state', listener);
      return () => ipcRenderer.removeListener('vibisual:overlay:redock-drag-state', listener);
    },
    /** §17-6 (H) — 이미 서 있던 창에 짐이 뒤늦게 도착했을 때(부팅을 다시 하지 않으므로 push 로 온다). */
    onPaneHandoff: (cb: (payload: { agentId: string; handoff: unknown }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { agentId: string; handoff: unknown }): void => cb(payload);
      ipcRenderer.on('vibisual:overlay:pane-handoff', listener);
      return () => ipcRenderer.removeListener('vibisual:overlay:pane-handoff', listener);
    },
    /** 현재 오버레이 목록 + 전역 토글 상태 조회(초기 동기화용). */
    list: (): Promise<OverlayListWire> => ipcRenderer.invoke('vibisual:overlay:list'),
    /** Header 전역 토글 — 모든 오버레이 창 show/hide. */
    setVisible: (visible: boolean): Promise<boolean> => ipcRenderer.invoke('vibisual:overlay:set-visible', visible),
    /** §17-6 (G) v2.82 — 우클릭 "숨기기(이 버블만)" — 이 창만 숨김(복귀는 Header 전역 토글). */
    hideSelf: (): Promise<boolean> => ipcRenderer.invoke('vibisual:overlay:hide-self'),
    /** §17-6 (G) v2.82 — 우클릭 불투명도(1/0.75/0.5) — 접힘 버블에 적용. */
    setOpacitySelf: (opacity: number): Promise<boolean> => ipcRenderer.invoke('vibisual:overlay:set-opacity-self', opacity),
    /**
     * §17-6 (G) v2.82 — 우클릭 "본체에서 이 버블로 점프" — 메인 창 포커스 + reveal 신호.
     * (판올림 번호 발급 대기) `openIde` 면 점프에서 그치지 않고 **앱 안에서 IDE 창까지 다시 연다**
     * (밖으로 끌어냈던 창을 되돌리는 길).
     */
    revealInMain: (payload: {
      agentId: string;
      projectId: string;
      openIde?: boolean;
      /** §17-6 (H) — 되돌아가며 들고 가는 짐. 메인 창이 `takeHandoff` 로 꺼내 그 창을 이어 세운다. */
      handoff?: unknown;
    }): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:overlay:reveal-in-main', payload),
    /** §17-6 (G) v2.82 — 메인 윈도우 한정: 오버레이가 보낸 캔버스 점프 신호 구독. */
    onReveal: (
      cb: (payload: { agentId: string; projectId: string; openIde?: boolean; hasHandoff?: boolean }) => void,
    ): (() => void) => {
      const listener = (
        _e: unknown,
        payload: { agentId: string; projectId: string; openIde?: boolean; hasHandoff?: boolean },
      ): void => cb(payload);
      ipcRenderer.on('vibisual:overlay:reveal', listener);
      return () => ipcRenderer.removeListener('vibisual:overlay:reveal', listener);
    },
    /** §17-6 (G) v2.87 — 버블 창: 우클릭 → 커서 위치에 메뉴 팝업 창 열기. */
    openMenu: (): Promise<boolean> => ipcRenderer.invoke('vibisual:overlay:open-menu'),
    /** §17-6 (G) v2.87 — 메뉴 창: 실제 메뉴 크기 신고(main 이 창을 딱 맞춰 커서 아래 배치). */
    menuResize: (size: { width: number; height: number }): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:overlay:menu-resize', size),
    /** §17-6 (G) v2.87 — 메뉴 창: 액션(open-ide·reveal·opacity·hide·close)을 대상 버블 창에 적용. */
    menuAction: (payload: { action: string; value?: number }): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:overlay:menu-action', payload),
    /** §17-6 (G) v2.87 — 메뉴 창: 자기 자신 닫기(Esc 등). */
    closeMenu: (): Promise<boolean> => ipcRenderer.invoke('vibisual:overlay:close-menu'),
    /** §17-6 (G) v2.87 — 버블 창: 메뉴가 보낸 명령(open-ide) 구독 → openIDEOverlay. */
    onMenuCommand: (cb: (payload: { command: string }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { command: string }): void => cb(payload);
      ipcRenderer.on('vibisual:overlay:menu-command', listener);
      return () => ipcRenderer.removeListener('vibisual:overlay:menu-command', listener);
    },
    /** main 이 모든 창에 푸시하는 현재 오버레이 목록 + 토글 상태. */
    onList: (cb: (payload: OverlayListWire) => void): (() => void) => {
      const listener = (_e: unknown, payload: OverlayListWire): void => cb(payload);
      ipcRenderer.on('vibisual:overlay:list', listener);
      return () => ipcRenderer.removeListener('vibisual:overlay:list', listener);
    },
  },
  /** §5.12 (v4.44) — 지휘통제실 창 surface. **앱 전체에 1창**이며 활성 프로젝트를 따라간다. */
  command: {
    /** 프로젝트 root 버블 더블클릭 → 지휘통제실 창. 이미 있으면 focus + show-project push. */
    open: (payload: { projectId: string; cursor?: { x: number; y: number } }): Promise<{ windowId: number; reused: boolean }> =>
      ipcRenderer.invoke('vibisual:command:open', payload),
    /** 지휘통제실 창 닫기(창이 하나라 인자 없음). */
    close: (): Promise<boolean> => ipcRenderer.invoke('vibisual:command:close'),
    /** 지휘통제실 창 한정 — "이 프로젝트를 보여라" 신호 구독(v4.44). */
    onShowProject: (cb: (payload: { projectId: string }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { projectId: string }): void => cb(payload);
      ipcRenderer.on('vibisual:command:show-project', listener);
      return () => ipcRenderer.removeListener('vibisual:command:show-project', listener);
    },
    /** 카드 [이동] — 메인 창 focus + 그 세션으로 점프 신호. */
    revealInMain: (payload: { projectId: string; agentId: string; subAgentId?: string | null }): Promise<boolean> =>
      ipcRenderer.invoke('vibisual:command:reveal-in-main', payload),
    /** 메인 윈도우 한정 — 지휘통제실이 보낸 세션 점프 신호 구독. */
    onReveal: (cb: (payload: { projectId: string; agentId: string; subAgentId: string | null }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { projectId: string; agentId: string; subAgentId: string | null }): void => cb(payload);
      ipcRenderer.on('vibisual:command:reveal', listener);
      return () => ipcRenderer.removeListener('vibisual:command:reveal', listener);
    },
  },
  /**
   * §5.13 (O) v4.48 — 내부 앱 surface (앱 무관).
   *
   * 앱마다 surface 를 만들지 않는다. `appId` 만 다르고 통로는 셋으로 고정이다 —
   * 앱이 늘어도 이 파일은 그대로다.
   */
  app: {
    open: (appId: string, params?: Record<string, string>): Promise<{ windowId: number; reused: boolean }> =>
      ipcRenderer.invoke('vibisual:app:open', { appId, params }),
    close: (appId: string): Promise<boolean> => ipcRenderer.invoke('vibisual:app:close', { appId }),
    /** 그 앱만 아는 기능. 코어는 뜻을 모르고 그대로 넘긴다. */
    invoke: (appId: string, action: string, payload?: unknown): Promise<unknown> =>
      ipcRenderer.invoke('vibisual:app:invoke', { appId, action, payload }),
    /** 앱 창 한정 — "이 대상을 보여라" 신호 구독(같은 앱을 다시 열었을 때). */
    onShowTarget: (cb: (payload: { appId: string; hash: string }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { appId: string; hash: string }): void => cb(payload);
      ipcRenderer.on('vibisual:app:show-target', listener);
      return () => ipcRenderer.removeListener('vibisual:app:show-target', listener);
    },
  },
  /** §4 v2.44 자동 업데이트 surface — VS Code 식 업데이트 버튼. */
  update: {
    /** 수동 체크 트리거(부팅 직후·주기 체크는 main 이 자동). 갱신된 상태를 반환. */
    check: (): Promise<UpdateState> => ipcRenderer.invoke('vibisual:update:check'),
    /** 다운로드 완료 상태에서 재시작+설치. true=실행됨. */
    install: (): Promise<boolean> => ipcRenderer.invoke('vibisual:update:install'),
    /** 현재 업데이트 상태 1회 조회(마운트 시 초기값 채우기). */
    getState: (): Promise<UpdateState> => ipcRenderer.invoke('vibisual:update:get-state'),
    /** main 이 푸시하는 업데이트 상태 구독 — checking/available/downloading/downloaded/error. */
    onStatus: (cb: (state: UpdateState) => void): (() => void) => {
      const listener = (_e: unknown, state: UpdateState): void => cb(state);
      ipcRenderer.on('vibisual:update:status', listener);
      return () => ipcRenderer.removeListener('vibisual:update:status', listener);
    },
  },
  /** §4 v3.16 모바일 웹 접속 모드 surface — File 메뉴 Mobile Access 모달. */
  mobile: {
    /** 현재 상태 1회 조회(모달 오픈 시 초기값). */
    getState: (): Promise<MobileAccessState> => ipcRenderer.invoke('vibisual:mobile:get-state'),
    /** LAN 리스너 기동 + 페어링 코드 발급. 갱신된 상태를 반환. */
    enable: (): Promise<MobileAccessState> => ipcRenderer.invoke('vibisual:mobile:enable'),
    /** LAN 리스너 종료(연결된 모바일 클라이언트도 끊는다). */
    disable: (): Promise<MobileAccessState> => ipcRenderer.invoke('vibisual:mobile:disable'),
    /** 새 페어링 코드 발급 — 실패 잠금 해제 겸용. */
    regenCode: (): Promise<MobileAccessState> => ipcRenderer.invoke('vibisual:mobile:regen-code'),
    /** §4 v3.20 — UPnP 외부 개방 켜기(공유기 포트 자동 개방 + HTTPS). */
    enableExternal: (): Promise<MobileAccessState> => ipcRenderer.invoke('vibisual:mobile:enable-external'),
    /** §4 v3.20 — 외부 개방 끄기(UPnP 매핑 제거 + HTTPS 종료). */
    disableExternal: (): Promise<MobileAccessState> => ipcRenderer.invoke('vibisual:mobile:disable-external'),
    /** §4 v3.66 — QR 페어링 티켓 발급(3분). 기존 티켓이 있으면 폐기하고 새로 만든다. */
    issueQr: (): Promise<MobileAccessState> => ipcRenderer.invoke('vibisual:mobile:issue-qr'),
    /** §4 v3.66 — QR 페어링 티켓 즉시 폐기(이미 페어링된 기기는 유지). */
    revokeQr: (): Promise<MobileAccessState> => ipcRenderer.invoke('vibisual:mobile:revoke-qr'),
    /** main 이 푸시하는 상태 변경 구독(페어링 성공/클라이언트 접속·해제 등). */
    onStatus: (cb: (state: MobileAccessState) => void): (() => void) => {
      const listener = (_e: unknown, state: MobileAccessState): void => cb(state);
      ipcRenderer.on('vibisual:mobile:status', listener);
      return () => ipcRenderer.removeListener('vibisual:mobile:status', listener);
    },
  },
  /**
   * §4 메신저 원격제어 브리지 surface — File 메뉴 Remote Control 모달.
   * 모바일 웹(위)과 **방향이 반대**다: 여기서는 우리가 포트를 열지 않고 바깥으로 나가서 붙는다.
   * 봇 토큰은 이 문으로 **되돌아 나오지 않는다**(상태에는 hasToken 만 실린다).
   */
  chat: {
    /** 현재 상태 1회 조회(모달 오픈 시 초기값). */
    getState: (): Promise<ChatBridgeState> => ipcRenderer.invoke('vibisual:chat:get-state'),
    /** 저장 전 토큰 검증 — 봇 이름을 돌려줘 사용자가 성공을 눈으로 확인한다. */
    verifyToken: (kind: ChatChannelKind, token: string): Promise<{ ok: boolean; botName?: string; error?: string }> =>
      ipcRenderer.invoke('vibisual:chat:verify-token', kind, token),
    /** 토큰 저장(빈 문자열이면 지우고 채널을 끈다). */
    setToken: (kind: ChatChannelKind, token: string): Promise<ChatBridgeState> =>
      ipcRenderer.invoke('vibisual:chat:set-token', kind, token),
    /** 채널 켜기 — 그때 처음 바깥으로 나간다. */
    enable: (kind: ChatChannelKind): Promise<ChatBridgeState> => ipcRenderer.invoke('vibisual:chat:enable', kind),
    /** 채널 끄기(재시도 타이머까지 정리). */
    disable: (kind: ChatChannelKind): Promise<ChatBridgeState> => ipcRenderer.invoke('vibisual:chat:disable', kind),
    /** 딥링크 페어링 티켓 발급(3분). 채널당 살아 있는 티켓은 항상 한 장. */
    issuePair: (kind: ChatChannelKind): Promise<ChatBridgeState> => ipcRenderer.invoke('vibisual:chat:issue-pair', kind),
    /** 티켓 즉시 폐기(이미 페어링된 대화는 유지). */
    revokePair: (kind: ChatChannelKind): Promise<ChatBridgeState> => ipcRenderer.invoke('vibisual:chat:revoke-pair', kind),
    /** 페어링된 대화 하나 끊기. */
    unpair: (kind: ChatChannelKind, chatId: string): Promise<ChatBridgeState> =>
      ipcRenderer.invoke('vibisual:chat:unpair', kind, chatId),
    /** 폰으로 나가는 전송량 정책(기본 cards). */
    setVerbosity: (verbosity: ChatVerbosity): Promise<ChatBridgeState> =>
      ipcRenderer.invoke('vibisual:chat:set-verbosity', verbosity),
    /** main 이 푸시하는 상태 변경 구독(연결/페어링/티켓 만료 등). */
    onStatus: (cb: (state: ChatBridgeState) => void): (() => void) => {
      const listener = (_e: unknown, state: ChatBridgeState): void => cb(state);
      ipcRenderer.on('vibisual:chat:status', listener);
      return () => ipcRenderer.removeListener('vibisual:chat:status', listener);
    },
  },
  /** §4 v2.63 임베디드 인터랙티브 터미널 surface — IDE 창 안 PTY. */
  terminal: {
    /**
     * 셸+claude prefill PTY 생성. termId 는 renderer 가 (agent+session) 으로 부여.
     * §5.5 #17-20 v4.74 — `command` 를 주면 claude 대신 그 명령을 띄우는 실행 런처가 된다.
     */
    create: (spec: {
      termId: string;
      cwd: string;
      config: AgentConfig;
      cols?: number;
      rows?: number;
      command?: string;
      autoRun?: boolean;
      env?: Record<string, string>;
    }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('vibisual:term:create', spec),
    /** xterm 키 입력 → PTY stdin. */
    write: (termId: string, data: string): Promise<void> =>
      ipcRenderer.invoke('vibisual:term:write', { termId, data }),
    /** xterm 리사이즈 → PTY. */
    resize: (termId: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke('vibisual:term:resize', { termId, cols, rows }),
    /** PTY 종료(컴포넌트 unmount / IDE 닫기 / 모드 전환). */
    kill: (termId: string): Promise<void> => ipcRenderer.invoke('vibisual:term:kill', termId),
    /** §4 (CMD ②) — 전경 프로세스명·크기. 탭 라벨 보조 표기 + 상태 신고에 실린다. */
    info: (termId: string): Promise<{ process?: string; cols: number; rows: number } | null> =>
      ipcRenderer.invoke('vibisual:term:info', termId),
    /** main 이 PTY 출력 바이트를 푸시 — 해당 termId 만 골라 xterm.write. */
    onData: (cb: (payload: { termId: string; data: string }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { termId: string; data: string }): void => cb(payload);
      ipcRenderer.on('vibisual:term:data', listener);
      return () => ipcRenderer.removeListener('vibisual:term:data', listener);
    },
    /** main 이 PTY 종료를 푸시 — xterm 에 종료 안내 표시. */
    onExit: (cb: (payload: { termId: string; exitCode: number }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { termId: string; exitCode: number }): void => cb(payload);
      ipcRenderer.on('vibisual:term:exit', listener);
      return () => ipcRenderer.removeListener('vibisual:term:exit', listener);
    },
  },
  /** §5.9 화면/프로그램 캡처 버블 surface — desktopCapturer 소스 열거 + 원격 조작 입력 주입. */
  capture: {
    /** 캡처 가능한 화면·창 목록(썸네일 data URL 포함). picker 그리드 렌더용. */
    listSources: (): Promise<CaptureSourceInfo[]> => ipcRenderer.invoke('vibisual:capture:list-sources'),
    /** §5.9 Phase B — 캡처 본체 위 제스처를 OS 입력으로 주입(원격 조작). */
    sendInput: (event: CaptureInputEvent): Promise<CaptureInjectResult> => ipcRenderer.invoke('vibisual:capture:input', event),
    /** §5.9 v3.57 — 대상 화면/창의 사각형(DIP+물리). 드래그 중 손 움직임만 뽑아내는 데 쓴다. */
    targetRect: (spec: { sourceId: string; sourceKind: CaptureSourceKind; sourceName: string }): Promise<CaptureTargetRect> =>
      ipcRenderer.invoke('vibisual:capture:target-rect', spec),
    /** §5.17 (B) — 프리뷰에서 그은 사각형을 이 창에서 그대로 찍는다(프리뷰 → 입력창 첨부). */
    pageRegion: (rect: PreviewSnipRect): Promise<PageRegionCapture> =>
      ipcRenderer.invoke('vibisual:capture:page-region', rect),
  },
  /**
   * §3.7 — 바깥 브라우저 열기 실패 알림.
   *
   * 여는 길은 종전 그대로 renderer 의 `window.open(url, '_blank')` 하나다(새 여는 길 ❌).
   * 이건 그 반대 방향 — main 이 "안 열렸다"를 알려 주는 길이다. 리눅스에서는
   * `shell.openExternal` 이 실패해도 resolve 하므로 renderer 는 스스로 알 방법이 없다.
   */
  externalOpen: {
    onFailed: (cb: (payload: ExternalOpenFailure) => void): (() => void) => {
      const listener = (_e: unknown, payload: ExternalOpenFailure): void => cb(payload);
      ipcRenderer.on('vibisual:external-open-failed', listener);
      return () => ipcRenderer.removeListener('vibisual:external-open-failed', listener);
    },
  },

  /**
   * §3.2.1 — 종료 직전 "아직 디스크에 안 앉힌 손글씨를 지금 밀어라".
   *
   * 세션 입력 초안·IDE 폼 초안·명령 히스토리는 타이핑 핫패스를 지키려고 debounce 로 쓰고
   * `pagehide`/`beforeunload`/`visibilitychange` 에서 즉시 flush 한다. 그런데 앱 종료는 창을
   * 정상으로 닫지 않고 `app.exit(0)` 으로 프로세스를 내리므로 **그 세 이벤트가 뜨지 않는다** —
   * main 이 대신 물어봐 주는 길이다.
   *
   * `cb` 가 던져도 **반드시 답한다** — 답이 없으면 main 이 상한(600ms)까지 기다렸다 나가고,
   * 그만큼 다른 창의 초안 저장까지 늦어진다.
   */
  lifecycle: {
    onFlushDrafts: (cb: () => void): (() => void) => {
      // 채널 이름 정본은 main 의 `rendererFlushPlan.ts` — 바꾸면 양쪽을 함께 고친다.
      const listener = (_e: unknown, payload: { requestId?: number } | undefined): void => {
        try {
          cb();
        } catch (err) {
          console.error('[preload] flush-drafts handler failed', err);
        } finally {
          ipcRenderer.send('vibisual:lifecycle:flush-drafts:done', payload?.requestId ?? 0);
        }
      };
      ipcRenderer.on('vibisual:lifecycle:flush-drafts', listener);
      return () => ipcRenderer.removeListener('vibisual:lifecycle:flush-drafts', listener);
    },
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error('[preload] contextBridge expose failed', error);
  }
} else {
  console.error('[preload] contextIsolation is OFF — refusing to expose api (security invariant).');
}

export type DesktopApi = typeof api;
