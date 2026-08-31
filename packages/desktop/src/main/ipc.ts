import { ipcMain, type WebContents } from 'electron';
import { mountAppIpc, removeAppIpc } from './apps/index';
// §5.5 #17-6 (H-6) — 밖으로 빼는 동안 앱 밖까지 이어지는 가상 창 윤곽선.
import { showPopOutGhost, nudgePopOutGhost, hidePopOutGhost } from './ghostFrame';
import { inject, type DispatchFunc } from 'light-my-request';
import type { Express } from 'express';
import {
  handleClientMessage,
  handleClientDisconnect,
  buildConnectionMessages,
  shutdownIframeLogStreamer,
  shutdownServerLogService,
  debugSessionManager,
  type ClientConnection,
} from '@vibisual/server';
import {
  openDetached,
  closeByTabKey,
  closeByWindowId,
  minimizeByWindowId,
  toggleMaximizeByWindowId,
  listDetached,
  hasTabKey,
  getCursorScreenPoint,
  getMainContentBounds,
  pushRedockHover,
  redockCommit,
  startDetachDragByWindowId,
  endDetachDragByWindowId,
  type DetachKind,
  openOverlay,
  closeOverlayByAgentId,
  closeOverlayByWindowId,
  expandOverlayByWindowId,
  collapseOverlayByWindowId,
  toggleMaximizeOverlaySelfByWindowId,
  startOverlayDragByWindowId,
  endOverlayDragByWindowId,
  endOverlayDragByAgentId,
  startOverlayRedockDragByWindowId,
  endOverlayRedockDragByWindowId,
  takePaneHandoff,
  listOverlays,
  getOverlaysVisible,
  setOverlaysVisible,
  hideOverlaySelfByWindowId,
  setOverlayOpacitySelfByWindowId,
  revealOverlayInMain,
  openOverlayMenuByWindowId,
  resizeOverlayMenu,
  overlayMenuAction,
  closeOverlayMenuByWindowId,
  openCommandCenter,

  closeCommandCenter,
  revealSessionInMain,
} from './windowManager';
import { checkForUpdates, quitAndInstall, getUpdateState } from './updaterManager';
import {
  getMobileAccessState,
  enableMobileAccess,
  disableMobileAccess,
  regenMobilePairingCode,
  enableExternalAccess,
  disableExternalAccess,
  issueMobileQrTicket,
  revokeMobileQrTicket,
} from './mobileAccess';
import {
  getChatBridgeState,
  verifyChatToken,
  setChatToken,
  enableChatChannel,
  disableChatChannel,
  issueChatPairTicket,
  revokeChatPairTicket,
  unpairChat,
  setChatVerbosity,
} from './chat';
import {
  createTerminal,
  getTerminalInfo,
  writeTerminal,
  resizeTerminal,
  killTerminal,
  killTerminalsForSink,
  type CreateTerminalSpec,
  type TermSink,
} from './terminalManager';
import { listCaptureSources } from './captureManager';
import { injectCaptureInput, resolveCaptureTargetRect } from './captureInputManager';
import type { ChatBridgeState, ChatChannelKind, ChatVerbosity, UpdateState, MobileAccessState, CaptureSourceInfo, CaptureInputEvent, CaptureSourceKind, CaptureTargetRect, CaptureInjectResult, PreviewSnipRect, PageRegionCapture } from '@vibisual/shared';

// IPC hub — SCENARIO.md §3.7 (in-process 통합).
//
// renderer↔server 는 소켓 없이 Electron IPC 직결. 채널:
//   - vibisual:server-info  → renderer 가 패키지 모드인지 확인용(in-process라 포트 의미 없음).
//   - vibisual:fetch        → HTTP 요청을 in-process Express app 으로 합성 디스패치
//                             (light-my-request — fake req/res 주입, TCP 소켓 없음).
//   - vibisual:send         → renderer→server WS 메시지(hydrate/unload/iframe-log) 직접 처리.
//   - vibisual:ws-connect   → renderer 의 IpcWebSocket 생성 시 초기 ack+snapshot 푸시.
//   - vibisual:ws (push)    → server broadcast sink(main/index.ts)가 renderer 로 푸시.

// §4 v3.33 — 데스크톱 IPC 용 TermSink. PTY 출력을 이 webContents 의 renderer 로 push.
function webContentsSink(wc: WebContents): TermSink {
  return {
    id: `wc:${wc.id}`,
    sendData: (termId, data) => { if (!wc.isDestroyed()) wc.send('vibisual:term:data', { termId, data }); },
    sendExit: (termId, exitCode) => { if (!wc.isDestroyed()) wc.send('vibisual:term:exit', { termId, exitCode }); },
    isAlive: () => !wc.isDestroyed(),
  };
}

interface FetchInitWire {
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  /** `body` 가 base64 인코딩 바이너리(FormData/Blob 등)임을 표시 — multipart 업로드 경로. */
  bodyEncoding?: 'base64';
}

interface FetchResponseWire {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  /** `body` 가 base64 인코딩 바이너리임을 표시 — 비텍스트 응답(이미지 등) 무손실 전달. */
  bodyEncoding?: 'base64';
}

export interface IpcHub {
  stop(): void;
}

/** iframeLogStreamer.safeSend 가 OPEN 여부를 readyState 로 확인하므로 1(OPEN) 을 부여한다. */
type RendererConnection = ClientConnection & { readyState: number };

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// 텍스트 계열 Content-Type 판정 — 그 외(이미지/폰트/옥텟 스트림 등)는 base64 로 무손실 전송.
// IPC 와이어가 텍스트 전용이라 비텍스트 응답을 res.payload(문자열)로 보내면 바이트가 깨진다.
function isTextualContentType(contentType: string | undefined): boolean {
  if (!contentType) return true;
  const v = contentType.toLowerCase();
  return (
    v.startsWith('text/') ||
    v.includes('json') ||
    v.includes('javascript') ||
    v.includes('xml') ||
    v.includes('urlencoded') ||
    v.includes('image/svg')
  );
}

export function setupIpc(expressApp: Express): IpcHub {
  // webContents 별 ClientConnection — handleClientMessage 응답·iframeLogStreamer 구독의
  // 대상 식별에 쓴다. 같은 webContents 면 같은 conn 객체를 재사용해야 unsubscribe 가 맞는다.
  const connections = new Map<number, RendererConnection>();

  const connFor = (sender: WebContents): RendererConnection => {
    const existing = connections.get(sender.id);
    if (existing) return existing;
    const conn: RendererConnection = {
      readyState: 1,
      send: (data: string): void => {
        if (!sender.isDestroyed()) sender.send('vibisual:ws', safeParse(data));
      },
    };
    connections.set(sender.id, conn);
    sender.once('destroyed', () => {
      connections.delete(sender.id);
      // §9 — 창이 닫히면 그 창의 프로젝트 구독 선언도 함께 지운다(합집합이 넓어진 채 굳지 않게).
      handleClientDisconnect(conn);
    });
    return conn;
  };

  ipcMain.handle('vibisual:server-info', () => ({ port: 0, running: true }));

  ipcMain.handle(
    'vibisual:fetch',
    async (_event, path: string, init?: FetchInitWire): Promise<FetchResponseWire> => {
      if (typeof path !== 'string' || !path.startsWith('/')) {
        throw new Error(`vibisual:fetch path must start with "/" (got ${String(path)})`);
      }
      // base64 와이어 본문(FormData/Blob 등)은 Buffer 로 복원해야 multer/busboy 가
      // multipart 를 파싱한다. 텍스트 본문은 그대로 합성 디스패치한다.
      const payload =
        init?.body == null
          ? undefined
          : init.bodyEncoding === 'base64'
            ? Buffer.from(init.body, 'base64')
            : init.body;
      const res = await inject(expressApp as unknown as DispatchFunc, {
        method: (init?.method ?? 'GET') as 'GET',
        url: path,
        headers: init?.headers,
        payload,
      });
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (v == null) continue;
        headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
      }
      const textual = isTextualContentType(headers['content-type']);
      const wire: FetchResponseWire = {
        ok: res.statusCode < 400,
        status: res.statusCode,
        statusText: res.statusMessage ?? '',
        headers,
        body: textual ? res.payload : res.rawPayload.toString('base64'),
      };
      if (!textual) wire.bodyEncoding = 'base64';
      return wire;
    },
  );

  ipcMain.handle('vibisual:send', (event, message: unknown) => {
    const msg = typeof message === 'string' ? safeParse(message) : message;
    if (msg && typeof msg === 'object') {
      handleClientMessage(msg as { type?: string; payload?: unknown }, connFor(event.sender));
    }
  });

  ipcMain.handle('vibisual:ws-connect', (event) => {
    // renderer 의 IpcWebSocket 생성 직후 호출 — standalone ws 의 'connection' 이벤트와
    // 동일하게 connection_ack + 현재 graph_snapshot 을 그 renderer 에만 보낸다.
    connFor(event.sender);
    for (const m of buildConnectionMessages()) {
      if (!event.sender.isDestroyed()) event.sender.send('vibisual:ws', m);
    }
    // SCENARIO.md §5.4 #14-1 — 별창/메인 모두 현재 detached 목록을 즉시 알아야 한다.
    if (!event.sender.isDestroyed()) {
      event.sender.send('vibisual:detached:list', listDetached());
      // §5.5 #17-6 — 오버레이 목록 + 전역 토글 상태도 초기 동기화.
      event.sender.send('vibisual:overlay:list', { overlays: listOverlays(), userVisible: getOverlaysVisible() });
    }
  });

  // ─── §5.4 #14-1 (v2.29) Detach/Redock 채널 ───────────────────────────────
  ipcMain.handle(
    'vibisual:window:detach',
    (
      _event,
      payload: { kind: DetachKind; tabKey: string; cursor?: { x: number; y: number } },
    ): { windowId: number; reused: boolean } => {
      if (!payload || (payload.kind !== 'project' && payload.kind !== 'iframe')) {
        throw new Error('vibisual:window:detach — invalid kind');
      }
      if (typeof payload.tabKey !== 'string' || payload.tabKey.length === 0) {
        throw new Error('vibisual:window:detach — tabKey required');
      }
      return openDetached({
        kind: payload.kind,
        tabKey: payload.tabKey,
        cursor: payload.cursor,
      });
    },
  );

  ipcMain.handle('vibisual:window:close-detached', (_event, tabKey: string): boolean => {
    return closeByTabKey(tabKey);
  });

  ipcMain.handle('vibisual:window:close-self', (event): boolean => {
    // 별창의 X 가 아니라 별창 안의 "메인으로 합치기" 버튼 같은 데서 자기 창 직접 닫기용.
    const wcId = event.sender.id;
    // detached 매핑이 있는 창이면 closeByWindowId, 아니면 BrowserWindow.fromWebContents 로 닫음.
    return closeByWindowId(wcId);
  });

  // §5.4 #14-1 — 별창 자기 창의 최소화/최대화(복원) 토글. 닫기(close-self) 와 동일하게
  // event.sender.id 로 자기 창을 식별한다.
  ipcMain.handle('vibisual:window:minimize-self', (event): boolean => {
    return minimizeByWindowId(event.sender.id);
  });
  ipcMain.handle('vibisual:window:toggle-maximize-self', (event): boolean => {
    return toggleMaximizeByWindowId(event.sender.id);
  });

  ipcMain.handle('vibisual:window:list-detached', () => listDetached());
  ipcMain.handle('vibisual:window:has-tab', (_e, tabKey: string) => hasTabKey(tabKey));

  ipcMain.handle('vibisual:window:cursor-screen', () => getCursorScreenPoint());
  ipcMain.handle('vibisual:window:main-bounds', () => getMainContentBounds());

  ipcMain.handle(
    'vibisual:window:redock-drag',
    (_e, payload: { tabKey: string; hovering: boolean }): void => {
      if (typeof payload?.tabKey !== 'string') return;
      pushRedockHover(payload.tabKey, !!payload.hovering);
    },
  );

  ipcMain.handle('vibisual:window:redock-commit', (_e, tabKey: string): boolean => {
    if (typeof tabKey !== 'string' || tabKey.length === 0) return false;
    return redockCommit(tabKey);
  });

  // §5.4 #14-1 v2.30 — 별창 미니 타이틀바 드래그 시작/종료.
  ipcMain.handle('vibisual:window:detach-drag-start', (event): boolean => {
    return startDetachDragByWindowId(event.sender.id);
  });
  ipcMain.handle('vibisual:window:detach-drag-end', (event, commit: boolean): boolean => {
    return endDetachDragByWindowId(event.sender.id, !!commit);
  });

  // ─── §5.5 #17-6 (v2.73) 버블 오버레이 창 채널 ─────────────────────────────
  ipcMain.handle(
    'vibisual:overlay:open',
    (
      _event,
      payload: {
        agentId: string;
        projectId: string;
        cursor?: { x: number; y: number };
        expanded?: boolean;
        size?: { width: number; height: number };
        handoff?: unknown;
        follow?: { grabX: number; grabY: number };
      },
    ): { windowId: number; reused: boolean } => {
      if (!payload || typeof payload.agentId !== 'string' || payload.agentId.length === 0) {
        throw new Error('vibisual:overlay:open — agentId required');
      }
      if (typeof payload.projectId !== 'string' || payload.projectId.length === 0) {
        throw new Error('vibisual:overlay:open — projectId required');
      }
      // 크기는 **숫자일 때만** 넘긴다 — 렌더러가 보낸 값이 무엇이든 창 기하가 NaN 으로 무너지지 않게.
      const size = payload.size
        && Number.isFinite(payload.size.width)
        && Number.isFinite(payload.size.height)
        ? { width: Math.round(payload.size.width), height: Math.round(payload.size.height) }
        : undefined;
      return openOverlay({
        agentId: payload.agentId,
        projectId: payload.projectId,
        cursor: payload.cursor,
        expanded: !!payload.expanded,
        size,
        // §17-6 (H) — 그 창이 들고 가는 짐. main 은 뜻을 모르고 맡아만 둔다(렌더러끼리의 약속).
        handoff: payload.handoff,
        // §17-6 (H-4) — 앱 경계를 넘는 그 순간 태어난 창. 잡은 지점 그대로 커서에 매달아 띄운다
        //   (숫자가 아니면 무시한다 — 창 기하가 NaN 으로 무너지지 않게).
        follow: payload.follow
          && Number.isFinite(payload.follow.grabX)
          && Number.isFinite(payload.follow.grabY)
          ? { grabX: Math.round(payload.follow.grabX), grabY: Math.round(payload.follow.grabY) }
          : undefined,
      });
    },
  );
  // §17-6 (H) — 새로 뜬 창이 자기 짐을 꺼낸다(한 번 꺼내면 사라진다).
  ipcMain.handle('vibisual:overlay:take-handoff', (_event, agentId: string): unknown => {
    return typeof agentId === 'string' && agentId.length > 0 ? takePaneHandoff(agentId) : null;
  });
  ipcMain.handle('vibisual:overlay:close', (_event, agentId: string): boolean => {
    return typeof agentId === 'string' ? closeOverlayByAgentId(agentId) : false;
  });
  ipcMain.handle('vibisual:overlay:close-self', (event): boolean => closeOverlayByWindowId(event.sender.id));
  ipcMain.handle('vibisual:overlay:expand-self', (event): boolean => expandOverlayByWindowId(event.sender.id));
  ipcMain.handle('vibisual:overlay:collapse-self', (event): boolean => collapseOverlayByWindowId(event.sender.id));
  // §17-6 (H-5) — 독립 창의 [최대화/복원]. 이 창은 frame:false + transparent 라 OS 타이틀바도
  //   시스템 최대화도 없다 — 최대화는 main 이 작업영역으로 bounds 를 옮겨 직접 한다.
  ipcMain.handle('vibisual:overlay:toggle-maximize-self', (event): boolean =>
    toggleMaximizeOverlaySelfByWindowId(event.sender.id),
  );
  // §17-6 v2.81 — 버블 드래그 = OS 창 이동(메인 프로세스 커서 폴링).
  ipcMain.handle(
    'vibisual:overlay:drag-start',
    (event, payload?: { redockOnEnter?: boolean; handoff?: unknown }): boolean =>
      // §17-6 (H-4) — 펼친 IDE 창의 타이틀바 드래그는 `redockOnEnter` 를 켜서 온다: 끌다 앱 안으로
      //   들어오면 그 자리에서 앱 안 IDE 로 돌아간다. 버블 드래그는 안 켜므로 종전 그대로 움직인다.
      startOverlayDragByWindowId(event.sender.id, {
        redockOnEnter: !!payload?.redockOnEnter,
        handoff: payload?.handoff,
      }),
  );
  ipcMain.handle('vibisual:overlay:drag-end', (event): boolean => endOverlayDragByWindowId(event.sender.id));
  // §17-6 (H-4) — **다른 창이** 끝내는 길(앱에서 끌어내 만든 창은 손이 메인 창에 있다).
  //   뗌을 두 창이 함께 듣는다 — 캡처가 어디에 있든 한쪽은 반드시 듣게(두 번 불려도 안전).
  ipcMain.handle('vibisual:overlay:drag-end-for', (_event, agentId: string): boolean =>
    typeof agentId === 'string' && agentId.length > 0 ? endOverlayDragByAgentId(agentId) : false,
  );
  // §17-6 (H-6) — 밖으로 빼는 동안 그리는 **가상 창 윤곽선**(클릭통과 투명 창).
  //   자리는 렌더러가 프레임마다 보내는 것이 아니라 main 이 커서를 폴링해 정한다 — (v2.81) 버블
  //   드래그·(H-4) `follow` 와 같은 물리라, 윤곽선과 곧 태어날 창이 정확히 같은 자리를 그린다.
  ipcMain.handle(
    'vibisual:overlay:ghost-show',
    (_event, payload: { width?: number; height?: number; grabX?: number; grabY?: number; label?: string; armed?: boolean }): boolean => {
      // 숫자일 때만 받는다 — 렌더러가 무엇을 보내든 창 기하가 NaN 으로 무너지지 않게(open 과 같은 규약).
      if (!payload
        || !Number.isFinite(payload.width) || !Number.isFinite(payload.height)
        || !Number.isFinite(payload.grabX) || !Number.isFinite(payload.grabY)) return false;
      return showPopOutGhost({
        width: payload.width as number,
        height: payload.height as number,
        grabX: payload.grabX as number,
        grabY: payload.grabY as number,
        label: typeof payload.label === 'string' ? payload.label.slice(0, 120) : undefined,
        armed: !!payload.armed,
      });
    },
  );
  ipcMain.handle('vibisual:overlay:ghost-nudge', (_event, payload: { dx?: number; dy?: number }): boolean =>
    nudgePopOutGhost({ dx: Number(payload?.dx) || 0, dy: Number(payload?.dy) || 0 }),
  );
  ipcMain.handle('vibisual:overlay:ghost-hide', (): boolean => hidePopOutGhost());
  // §17-6 (H) — 꺼낸 창을 **끌어다 앱 안으로 합치기**(칩으로 줄여 커서 따라가기 + 메인 창 위 판정).
  ipcMain.handle('vibisual:overlay:redock-drag-start', (event): boolean =>
    startOverlayRedockDragByWindowId(event.sender.id),
  );
  ipcMain.handle(
    'vibisual:overlay:redock-drag-end',
    (event, payload: { commit?: boolean; handoff?: unknown }): boolean =>
      endOverlayRedockDragByWindowId(event.sender.id, !!payload?.commit, payload?.handoff),
  );
  ipcMain.handle('vibisual:overlay:list', () => ({ overlays: listOverlays(), userVisible: getOverlaysVisible() }));
  ipcMain.handle('vibisual:overlay:set-visible', (_event, visible: boolean): boolean => {
    setOverlaysVisible(!!visible);
    return getOverlaysVisible();
  });
  // §17-6 (G) v2.82 — 버블 우클릭 메뉴 액션.
  ipcMain.handle('vibisual:overlay:hide-self', (event): boolean => hideOverlaySelfByWindowId(event.sender.id));
  ipcMain.handle('vibisual:overlay:set-opacity-self', (event, opacity: number): boolean =>
    setOverlayOpacitySelfByWindowId(event.sender.id, typeof opacity === 'number' ? opacity : 1),
  );
  ipcMain.handle(
    'vibisual:overlay:reveal-in-main',
    (_event, payload: { agentId: string; projectId: string; openIde?: boolean; handoff?: unknown }): boolean => {
      if (!payload || typeof payload.agentId !== 'string' || typeof payload.projectId !== 'string') return false;
      return revealOverlayInMain({
        agentId: payload.agentId,
        projectId: payload.projectId,
        openIde: !!payload.openIde,
        handoff: payload.handoff,
      });
    },
  );
  // §17-6 (G) v2.87 — 우클릭 메뉴 = 커서 위치 독립 팝업 창.
  ipcMain.handle('vibisual:overlay:open-menu', (event): boolean => openOverlayMenuByWindowId(event.sender.id));
  ipcMain.handle('vibisual:overlay:menu-resize', (event, size: { width: number; height: number }): boolean =>
    resizeOverlayMenu(event.sender.id, size?.width ?? 0, size?.height ?? 0),
  );
  ipcMain.handle('vibisual:overlay:menu-action', (event, payload: { action: string; value?: number }): boolean =>
    overlayMenuAction(event.sender.id, payload?.action ?? '', payload?.value),
  );
  ipcMain.handle('vibisual:overlay:close-menu', (event): boolean => closeOverlayMenuByWindowId(event.sender.id));

  // ─── §5.12 (v4.43) Command Center — 지휘통제실 창 채널 ────────────────────
  // 창 자체의 최소화/최대화/닫기는 별창의 `vibisual:window:*-self` 를 공유한다
  // (windowManager.selfWindowById 가 두 맵을 함께 조회).
  ipcMain.handle(
    'vibisual:command:open',
    (
      _event,
      payload: { projectId: string; cursor?: { x: number; y: number } },
    ): { windowId: number; reused: boolean } => {
      if (!payload || typeof payload.projectId !== 'string' || payload.projectId.length === 0) {
        throw new Error('vibisual:command:open — projectId required');
      }
      return openCommandCenter({ projectId: payload.projectId, cursor: payload.cursor });
    },
  );
  // v4.44 — 창이 하나뿐이라 인자가 없다(구버전 renderer 가 projectId 를 보내도 무시).
  ipcMain.handle('vibisual:command:close', (): boolean => closeCommandCenter());

  // ─── §5.13 (O) v4.48 내부 앱 채널 ───
  //
  // 앱마다 채널을 늘리지 않는다. 코어가 아는 것은 이 한 줄뿐이고, 앱이 늘어도
  // 늘어나는 것은 `main/apps/` 안의 파일 하나다(플러그인 호스트와 같은 규율).
  mountAppIpc(ipcMain);
  ipcMain.handle(
    'vibisual:command:reveal-in-main',
    (_event, payload: { projectId: string; agentId: string; subAgentId?: string | null }): boolean => {
      if (!payload || typeof payload.projectId !== 'string' || typeof payload.agentId !== 'string') return false;
      return revealSessionInMain({
        projectId: payload.projectId,
        agentId: payload.agentId,
        subAgentId: typeof payload.subAgentId === 'string' ? payload.subAgentId : undefined,
      });
    },
  );

  // ─── §4 v2.44 자동 업데이트 채널 ──────────────────────────────────────────
  // 상태 push 는 updaterManager 가 직접 webContents 로 보낸다(vibisual:update:status).
  // 여기서는 renderer→main 의 invoke 액션만 등록한다.
  ipcMain.handle('vibisual:update:check', (): Promise<UpdateState> => checkForUpdates());
  ipcMain.handle('vibisual:update:install', (): boolean => quitAndInstall());
  ipcMain.handle('vibisual:update:get-state', (): UpdateState => getUpdateState());

  // ─── §4 v3.16 모바일 웹 접속 모드 채널 ────────────────────────────────────
  // 상태 push 는 mobileAccess 매니저가 직접 webContents 로 보낸다(vibisual:mobile:status).
  ipcMain.handle('vibisual:mobile:get-state', (): MobileAccessState => getMobileAccessState());
  ipcMain.handle('vibisual:mobile:enable', (): Promise<MobileAccessState> => enableMobileAccess());
  ipcMain.handle('vibisual:mobile:disable', (): Promise<MobileAccessState> => disableMobileAccess());
  ipcMain.handle('vibisual:mobile:regen-code', (): MobileAccessState => regenMobilePairingCode());
  ipcMain.handle('vibisual:mobile:enable-external', (): Promise<MobileAccessState> => enableExternalAccess());
  ipcMain.handle('vibisual:mobile:disable-external', (): Promise<MobileAccessState> => disableExternalAccess());
  // §4 v3.66 — QR 페어링 티켓(3분) 발급/폐기.
  ipcMain.handle('vibisual:mobile:issue-qr', (): MobileAccessState => issueMobileQrTicket());
  ipcMain.handle('vibisual:mobile:revoke-qr', (): MobileAccessState => revokeMobileQrTicket());

  // ─── §4 메신저 원격제어 브리지 채널 (판올림 번호 발급 대기) ───────────────
  // 상태 push 는 chat 브리지가 직접 webContents 로 보낸다(vibisual:chat:status).
  // **봇 토큰은 이 문을 통해 renderer 로 나가지 않는다** — 상태에는 hasToken 만 실린다.
  ipcMain.handle('vibisual:chat:get-state', (): ChatBridgeState => getChatBridgeState());
  ipcMain.handle('vibisual:chat:verify-token', (_e, kind: ChatChannelKind, token: string) => verifyChatToken(kind, token));
  ipcMain.handle('vibisual:chat:set-token', (_e, kind: ChatChannelKind, token: string): Promise<ChatBridgeState> => setChatToken(kind, token));
  ipcMain.handle('vibisual:chat:enable', (_e, kind: ChatChannelKind): Promise<ChatBridgeState> => enableChatChannel(kind));
  ipcMain.handle('vibisual:chat:disable', (_e, kind: ChatChannelKind): Promise<ChatBridgeState> => disableChatChannel(kind));
  ipcMain.handle('vibisual:chat:issue-pair', (_e, kind: ChatChannelKind): ChatBridgeState => issueChatPairTicket(kind));
  ipcMain.handle('vibisual:chat:revoke-pair', (_e, kind: ChatChannelKind): ChatBridgeState => revokeChatPairTicket(kind));
  ipcMain.handle('vibisual:chat:unpair', (_e, kind: ChatChannelKind, chatId: string): ChatBridgeState => unpairChat(kind, chatId));
  ipcMain.handle('vibisual:chat:set-verbosity', (_e, verbosity: ChatVerbosity): ChatBridgeState => setChatVerbosity(verbosity));

  // ─── §4 v2.63 임베디드 인터랙티브 터미널 채널 ─────────────────────────────
  // §4 v3.33 — 출력 대상은 TermSink 추상화. 데스크톱 IPC 는 아래 webContents 싱크로
  //   `vibisual:term:data`|`vibisual:term:exit` 를 push 한다(모바일 /ws 싱크는 mobileAccess.ts).
  //   여기서는 renderer→main 의 invoke 액션(create/write/resize/kill)만 등록한다.
  ipcMain.handle(
    'vibisual:term:create',
    (event, spec: CreateTerminalSpec): { ok: boolean; error?: string } => {
      if (!spec || typeof spec.termId !== 'string' || !spec.termId) {
        return { ok: false, error: 'termId required' };
      }
      const wcId = event.sender.id;
      // 창이 닫히면 그 webContents 의 PTY 들을 정리(좀비 셸 방지). once 가 여러 번 붙어도 무해.
      event.sender.once('destroyed', () => killTerminalsForSink(`wc:${wcId}`));
      return createTerminal(webContentsSink(event.sender), spec as CreateTerminalSpec);
    },
  );
  ipcMain.handle('vibisual:term:write', (_event, payload: { termId: string; data: string }): void => {
    if (payload && typeof payload.termId === 'string' && typeof payload.data === 'string') {
      writeTerminal(payload.termId, payload.data);
    }
  });
  ipcMain.handle('vibisual:term:resize', (_event, payload: { termId: string; cols: number; rows: number }): void => {
    if (payload && typeof payload.termId === 'string') {
      resizeTerminal(payload.termId, payload.cols, payload.rows);
    }
  });
  ipcMain.handle('vibisual:term:kill', (_event, termId: string): void => {
    if (typeof termId === 'string') killTerminal(termId);
  });
  // §4 (CMD 터미널 업그레이드 ②) — 전경 프로세스명·크기 표본. 클라가 상태 신호에 얹어 올린다
  //   (서버가 직접 PTY 를 표본하지 않는 이유: 상태 쓰기 경로를 하나로 유지 — §3.1).
  ipcMain.handle('vibisual:term:info', (_event, termId: string): { process?: string; cols: number; rows: number } | null => {
    return typeof termId === 'string' ? getTerminalInfo(termId) : null;
  });

  // ─── §5.9 화면/프로그램 캡처 버블 채널 ──────────────────────────────────────
  // desktopCapturer.getSources 는 main 전용 — 렌더러는 이 목록에서 고른 소스 id 로
  // getUserMedia(desktop) 라이브 스트림을 붙인다(렌더러 전용, 서버 무관).
  ipcMain.handle('vibisual:capture:list-sources', (): Promise<CaptureSourceInfo[]> => listCaptureSources());
  // §5.9 Phase B — 캡처 본체 위 제스처를 OS 입력으로 주입(원격 조작). fire-and-forget.
  ipcMain.handle(
    'vibisual:capture:input',
    (_event, ev: CaptureInputEvent): Promise<CaptureInjectResult> => injectCaptureInput(ev),
  );
  // §5.9 v3.57 — 드래그 좌표를 렌더러가 닫힌 루프로 계산하려면 대상 사각형(DIP+물리)이 필요하다.
  ipcMain.handle(
    'vibisual:capture:target-rect',
    (_event, spec: { sourceId: string; sourceKind: CaptureSourceKind; sourceName: string }): Promise<CaptureTargetRect> =>
      resolveCaptureTargetRect(spec),
  );
  /**
   * §5.17 (B) — 프리뷰에서 그은 사각형을 PNG 로 찍는다.
   *
   * 찍는 대상은 **부른 그 창 자신**(`event.sender`)이다 — 도킹이든 별창(§5.5 #17-6)이든
   * 사용자가 누른 화면이 찍힌다. 좌표는 렌더러가 준 CSS px(문서 좌상단 기준) 그대로이고,
   * Electron 이 받는 rect 와 같은 좌표계라 변환이 없다. 실패는 던지지 않고 사유를 담아 돌려준다
   * (렌더러가 한 줄로 보여 준다 — 조용한 무동작 ❌).
   */
  ipcMain.handle(
    'vibisual:capture:page-region',
    async (event, rect: PreviewSnipRect): Promise<PageRegionCapture> => {
      try {
        const width = Math.round(rect?.width ?? 0);
        const height = Math.round(rect?.height ?? 0);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
          return { ok: false, error: 'invalid rect' };
        }
        const image = await event.sender.capturePage({
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width,
          height,
        });
        if (image.isEmpty()) return { ok: false, error: 'empty capture' };
        return { ok: true, dataUrl: image.toDataURL() };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  return {
    stop(): void {
      ipcMain.removeHandler('vibisual:server-info');
      ipcMain.removeHandler('vibisual:fetch');
      ipcMain.removeHandler('vibisual:send');
      ipcMain.removeHandler('vibisual:ws-connect');
      ipcMain.removeHandler('vibisual:window:detach');
      ipcMain.removeHandler('vibisual:window:close-detached');
      ipcMain.removeHandler('vibisual:window:close-self');
      ipcMain.removeHandler('vibisual:window:minimize-self');
      ipcMain.removeHandler('vibisual:window:toggle-maximize-self');
      ipcMain.removeHandler('vibisual:window:list-detached');
      ipcMain.removeHandler('vibisual:window:has-tab');
      ipcMain.removeHandler('vibisual:window:cursor-screen');
      ipcMain.removeHandler('vibisual:window:main-bounds');
      ipcMain.removeHandler('vibisual:window:redock-drag');
      ipcMain.removeHandler('vibisual:window:redock-commit');
      ipcMain.removeHandler('vibisual:window:detach-drag-start');
      ipcMain.removeHandler('vibisual:window:detach-drag-end');
      ipcMain.removeHandler('vibisual:overlay:open');
      ipcMain.removeHandler('vibisual:overlay:close');
      ipcMain.removeHandler('vibisual:overlay:close-self');
      ipcMain.removeHandler('vibisual:overlay:expand-self');
      ipcMain.removeHandler('vibisual:overlay:collapse-self');
      ipcMain.removeHandler('vibisual:overlay:toggle-maximize-self');
      ipcMain.removeHandler('vibisual:overlay:drag-start');
      ipcMain.removeHandler('vibisual:overlay:drag-end');
      ipcMain.removeHandler('vibisual:overlay:drag-end-for');
      ipcMain.removeHandler('vibisual:overlay:redock-drag-start');
      ipcMain.removeHandler('vibisual:overlay:redock-drag-end');
      ipcMain.removeHandler('vibisual:overlay:take-handoff');
      ipcMain.removeHandler('vibisual:overlay:list');
      ipcMain.removeHandler('vibisual:overlay:set-visible');
      ipcMain.removeHandler('vibisual:overlay:hide-self');
      ipcMain.removeHandler('vibisual:overlay:set-opacity-self');
      ipcMain.removeHandler('vibisual:overlay:reveal-in-main');
      ipcMain.removeHandler('vibisual:overlay:open-menu');
      ipcMain.removeHandler('vibisual:overlay:menu-resize');
      ipcMain.removeHandler('vibisual:overlay:menu-action');
      ipcMain.removeHandler('vibisual:overlay:close-menu');
      removeAppIpc(ipcMain);
      ipcMain.removeHandler('vibisual:command:open');
      ipcMain.removeHandler('vibisual:command:close');
      ipcMain.removeHandler('vibisual:command:reveal-in-main');
      ipcMain.removeHandler('vibisual:update:check');
      ipcMain.removeHandler('vibisual:update:install');
      ipcMain.removeHandler('vibisual:update:get-state');
      ipcMain.removeHandler('vibisual:mobile:get-state');
      ipcMain.removeHandler('vibisual:mobile:enable');
      ipcMain.removeHandler('vibisual:mobile:disable');
      ipcMain.removeHandler('vibisual:mobile:regen-code');
      ipcMain.removeHandler('vibisual:mobile:enable-external');
      ipcMain.removeHandler('vibisual:mobile:disable-external');
      ipcMain.removeHandler('vibisual:mobile:issue-qr');
      ipcMain.removeHandler('vibisual:mobile:revoke-qr');
      ipcMain.removeHandler('vibisual:chat:get-state');
      ipcMain.removeHandler('vibisual:chat:verify-token');
      ipcMain.removeHandler('vibisual:chat:set-token');
      ipcMain.removeHandler('vibisual:chat:enable');
      ipcMain.removeHandler('vibisual:chat:disable');
      ipcMain.removeHandler('vibisual:chat:issue-pair');
      ipcMain.removeHandler('vibisual:chat:revoke-pair');
      ipcMain.removeHandler('vibisual:chat:unpair');
      ipcMain.removeHandler('vibisual:chat:set-verbosity');
      ipcMain.removeHandler('vibisual:term:create');
      ipcMain.removeHandler('vibisual:term:write');
      ipcMain.removeHandler('vibisual:term:resize');
      ipcMain.removeHandler('vibisual:term:kill');
      ipcMain.removeHandler('vibisual:term:info');
      ipcMain.removeHandler('vibisual:capture:list-sources');
      ipcMain.removeHandler('vibisual:capture:input');
      ipcMain.removeHandler('vibisual:capture:target-rect');
      ipcMain.removeHandler('vibisual:capture:page-region');
      shutdownIframeLogStreamer();
      shutdownServerLogService();
      // §5.5 #17-20 ⑩ v4.94 — 붙어 있던 디버그 세션(어댑터 자식 프로세스·소켓)을 함께 회수한다.
      debugSessionManager.disposeAll();
      connections.clear();
    },
  };
}
