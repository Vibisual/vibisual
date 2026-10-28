import { useState, useEffect, useCallback, useMemo, useRef, type RefObject } from 'react';
import {
  isReadOnlyHookAgent,
  PREVIEW_ALT_CAPTURE_DEFAULT,
  PREVIEW_ALT_CAPTURE_MESSAGE,
  PREVIEW_HOVER_MESSAGE,
  PREVIEW_PICK_SOURCE,
  PREVIEW_DEVICE_PRESETS,
  resolveCompareWidths,
  type PreviewPickPayload,
  type PreviewDevicePreset,
  type PreviewCompareWidth,
} from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';

/** §7.11 · §5.17 (A) — 프리뷰 조작(폭 + 요소 집기) 상태 한 벌(탭·캔버스 프리뷰가 같은 규칙을 쓰게). */

const DEVICE_KEY = 'vibisual:preview:device';
/** §7.11 (G) — Alt 를 우리가 가져갈지. 폭 프리셋과 같은 자리(클라 로컬)에 남는다. */
const ALT_KEY = 'vibisual:preview:alt';

export type PreviewDeviceId = PreviewDevicePreset['id'];

function loadDevice(): PreviewDeviceId {
  try {
    const raw = window.localStorage.getItem(DEVICE_KEY);
    const found = PREVIEW_DEVICE_PRESETS.find((p) => p.id === raw);
    return found?.id ?? 'auto';
  } catch {
    return 'auto';
  }
}

/** §7.11 (G) — `'off'` 만 끄기로 읽고 그 밖(저장 실패·옛 값·손으로 고친 값)은 기본(`PREVIEW_ALT_CAPTURE_DEFAULT`). */
function loadAltCapture(): boolean {
  try {
    const raw = window.localStorage.getItem(ALT_KEY);
    if (raw === 'off') return false;
    if (raw === 'on') return true;
    return PREVIEW_ALT_CAPTURE_DEFAULT;
  } catch {
    return PREVIEW_ALT_CAPTURE_DEFAULT;
  }
}

export interface PreviewPicker {
  /** 지금 고른 폭 프리셋. */
  device: PreviewDeviceId;
  setDevice: (id: PreviewDeviceId) => void;
  /** `null` = Auto(가득 채움). 그 외는 iframe 을 이 CSS 폭으로 **실제 렌더**한다(scale 축소 ❌). */
  deviceWidth: number | null;
  /**
   * §5.17 (A) — `compare` 를 골랐을 때 **나란히** 그릴 폭들. 그 외에는 null.
   * 목록은 프리셋 표에서 파생되므로(§3.3) 프리셋이 늘면 여기도 함께 늘어난다.
   */
  compareWidths: readonly PreviewCompareWidth[] | null;
  /** 요소 집기 모드가 켜져 있는가. */
  pickMode: boolean;
  togglePickMode: () => void;
  /** §7.11 (G) — 프리뷰 안 Alt 를 우리가 가져가나(기본 켜짐). 끄면 안의 앱이 쓰고 그 프리뷰엔 Alt 인스펙터가 없다. */
  altCapture: boolean;
  toggleAltCapture: () => void;
  /** §7.16 — 마우스가 이 프리뷰 안에 있나(안의 신고로 안다 — iframe 위엔 부모 `:hover` 가 없다). */
  hovered: boolean;
  /** §5.17 (A) — iframe 등록(콜백 ref). pick 모드는 등록된 전부에 방송하고, 붙는 순간 한 번 보낸다(늦게 태어난 칸이 꺼진 채 남지 않게). */
  registerFrame: (el: HTMLIFrameElement | null) => void;
  /** iframe 이 (재)로드된 뒤 호출 — 새로 태어난 문서에 현재 pick 모드를 다시 알린다. */
  notifyFrameLoaded: (el: HTMLIFrameElement | null) => void;
  /** 방금 집은 요소(없으면 null). */
  picked: PreviewPickPayload | null;
  clearPicked: () => void;
  /** 이 프리뷰를 띄운 커스텀 에이전트 — 없으면 보내기를 열지 않는다(§5.5 #17-29 경계). */
  hostAgentId: string | undefined;
  /** 조립된 명령을 그 에이전트에게 보낸다. 보낼 곳이 없으면 false. */
  send: (text: string) => boolean;
}

/**
 * @param iframeRef 대표 iframe(새로고침 등 한 장을 가리키는 조작의 상대).
 * @param url 원본 URL(프록시 경로 ❌) — 호스트 에이전트를 찾는 열쇠.
 * @param fallbackAgentId 위성이 없을 때의 후보(§5.17 (C) `PlayBubble.ownerAgentId` — 플레이 프리뷰는 iframe 위성을 안 만든다, §5.14).
 */
export function usePreviewPicker(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  url: string,
  fallbackAgentId?: string | undefined,
): PreviewPicker {
  const [device, setDeviceState] = useState<PreviewDeviceId>(() => loadDevice());
  const [pickMode, setPickMode] = useState(false);
  const [altCapture, setAltCaptureState] = useState<boolean>(() => loadAltCapture());
  const [hovered, setHovered] = useState(false);
  const [picked, setPicked] = useState<PreviewPickPayload | null>(null);
  const addCommand = useGraphStore((s) => s.addCommand);

  // 지금 화면에 살아 있는 프레임들. 비교 모드면 셋, 아니면 하나다.
  const framesRef = useRef<Set<HTMLIFrameElement>>(new Set());
  // 지금 마우스가 들어와 있다고 신고한 창들. 비교 모드에서는 칸이 여럿이라 **집합**이어야 한다 —
  //   한 칸에서 옆 칸으로 넘어갈 때 나감·들어옴이 어느 순서로 와도 hover 가 깜빡이지 않는다.
  const hoverWindowsRef = useRef<Set<MessageEventSource>>(new Set());
  // 콜백 ref 안에서 최신 pickMode 를 읽어야 하는데 그 시점의 클로저는 낡았다 — ref 로 들고 있는다.
  const pickModeRef = useRef(pickMode);
  pickModeRef.current = pickMode;
  // Alt 도 같은 이유로 ref 한 벌 — 늦게 태어난 프레임이 옛 값을 받으면 그 칸만 규칙이 달라진다.
  const altCaptureRef = useRef(altCapture);
  altCaptureRef.current = altCapture;

  // 이 URL 의 iframe 위성을 **매달고 있는** 에이전트(§7.11 owning shell 규약이 이미 정한 그 관계).
  //   위성은 부모 노드 id 로 묶여 오므로(`satellites`), 그 묶음에서 이 URL 을 가진 iframe 을 찾는다.
  //   훅 버블은 제외한다 — 관측 대상에 명령을 넣지 않는다(§5.5 #17-29).
  const hostAgentId = useGraphStore((s) => {
    for (const [parentId, items] of Object.entries(s.satellites)) {
      if (!items.some((n) => n.bubbleType === 'iframe' && n.url === url)) continue;
      const owner = s.agents.find((a) => a.id === parentId);
      if (owner && !isReadOnlyHookAgent(owner)) return owner.id;
    }
    // 위성이 없는 프리뷰(§5.14 플레이 프리뷰)는 넘겨받은 후보로 — 단 훅 버블 경계는 똑같이 지킨다.
    if (fallbackAgentId !== undefined) {
      const owner = s.agents.find((a) => a.id === fallbackAgentId);
      if (owner && !isReadOnlyHookAgent(owner)) return owner.id;
    }
    return undefined;
  });

  const setDevice = useCallback((id: PreviewDeviceId) => {
    setDeviceState(id);
    try { window.localStorage.setItem(DEVICE_KEY, id); } catch { /* 저장 실패는 표시에 영향 없음 */ }
  }, []);

  const deviceWidth = useMemo(
    () => PREVIEW_DEVICE_PRESETS.find((p) => p.id === device)?.width ?? null,
    [device],
  );

  const compareWidths = useMemo(
    () => (device === 'compare' ? resolveCompareWidths() : null),
    [device],
  );

  // 프리뷰 → 부모: 집은 요소 / 취소 / 마우스 들고 남. 출처 표식이 없는 메시지는 무시한다
  //   (남의 postMessage 오인 ❌).
  useEffect(() => {
    /** 우리 칸의 신고인가 — `message` 는 창에 하나라 옆 프리뷰의 신고도 온다. */
    function isOurs(win: MessageEventSource | null): boolean {
      if (!win) return false;
      if (iframeRef.current?.contentWindow === win) return true;
      for (const frame of framesRef.current) {
        if (frame.contentWindow === win) return true;
      }
      return false;
    }

    function onMessage(e: MessageEvent): void {
      const data = e.data as {
        source?: string; type?: string; payload?: PreviewPickPayload; on?: boolean;
      } | null;
      if (!data || data.source !== PREVIEW_PICK_SOURCE) return;
      if (data.type === 'pick' && data.payload) {
        setPicked(data.payload);
        setPickMode(false);
      } else if (data.type === 'pick-cancel') {
        setPickMode(false);
      } else if (data.type === PREVIEW_HOVER_MESSAGE) {
        if (!isOurs(e.source)) return;
        const wins = hoverWindowsRef.current;
        if (data.on === true) wins.add(e.source!);
        else wins.delete(e.source!);
        setHovered(wins.size > 0);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [iframeRef]);

  // 부모 → 프리뷰: 켜기/끄기. 대표 프레임과 등록된 모든 프레임에 함께 보낸다(비교 모드 대비).
  //   Alt 규칙도 **같은 편지**로 간다 — 두 갈래로 나누면 한쪽만 닿은 프레임이 생긴다.
  useEffect(() => {
    const targets = new Set<HTMLIFrameElement>(framesRef.current);
    if (iframeRef.current) targets.add(iframeRef.current);
    for (const frame of targets) {
      frame.contentWindow?.postMessage({ source: PREVIEW_PICK_SOURCE, type: 'pick-mode', on: pickMode }, '*');
      frame.contentWindow?.postMessage(
        { source: PREVIEW_PICK_SOURCE, type: PREVIEW_ALT_CAPTURE_MESSAGE, on: altCapture },
        '*',
      );
    }
  }, [pickMode, altCapture, iframeRef, compareWidths]);

  /** 프레임 하나에 지금 규칙을 통째로 알린다(막 붙었거나 막 다시 실린 문서). */
  const primeFrame = useCallback((el: HTMLIFrameElement) => {
    el.contentWindow?.postMessage(
      { source: PREVIEW_PICK_SOURCE, type: 'pick-mode', on: pickModeRef.current },
      '*',
    );
    el.contentWindow?.postMessage(
      { source: PREVIEW_PICK_SOURCE, type: PREVIEW_ALT_CAPTURE_MESSAGE, on: altCaptureRef.current },
      '*',
    );
  }, []);

  const registerFrame = useCallback((el: HTMLIFrameElement | null) => {
    if (!el) return; // 콜백 ref 의 정리 호출 — 아래 unmount 정리에서 죽은 프레임을 걷어낸다.
    framesRef.current.add(el);
    primeFrame(el);
  }, [primeFrame]);

  const notifyFrameLoaded = useCallback((el: HTMLIFrameElement | null) => {
    if (!el) return;
    framesRef.current.add(el);
    primeFrame(el);
  }, [primeFrame]);

  // 화면에서 사라진 프레임은 들고 있어 봐야 postMessage 가 조용히 실패할 뿐이다 — 주기적으로 걷어낸다.
  //   **마우스를 들고 간 채 사라진 칸**도 여기서 함께 정리한다. 나감 신고는 그 문서가 살아 있을 때만
  //   오므로(폭을 바꾸거나 새로고침하면 그 창은 그대로 죽는다), 안 걷어내면 스크롤바가 영영 떠 있는다.
  useEffect(() => {
    const frames = framesRef.current;
    for (const frame of [...frames]) {
      if (!frame.isConnected) frames.delete(frame);
    }
    const live = new Set<MessageEventSource>();
    for (const frame of frames) {
      if (frame.contentWindow) live.add(frame.contentWindow);
    }
    const wins = hoverWindowsRef.current;
    let dropped = false;
    for (const win of [...wins]) {
      if (!live.has(win)) { wins.delete(win); dropped = true; }
    }
    if (dropped) setHovered(wins.size > 0);
  });

  const togglePickMode = useCallback(() => {
    setPickMode((v) => !v);
    setPicked(null);
  }, []);

  const toggleAltCapture = useCallback(() => {
    setAltCaptureState((v) => {
      const next = !v;
      try { window.localStorage.setItem(ALT_KEY, next ? 'on' : 'off'); } catch { /* 저장 실패는 이번 화면에만 영향 */ }
      return next;
    });
  }, []);

  const clearPicked = useCallback(() => { setPicked(null); }, []);

  const send = useCallback((text: string): boolean => {
    if (hostAgentId === undefined || text === '') return false;
    addCommand(hostAgentId, text, null, []);
    setPicked(null);
    return true;
  }, [hostAgentId, addCommand]);

  return {
    device,
    setDevice,
    deviceWidth,
    compareWidths,
    pickMode,
    togglePickMode,
    altCapture,
    toggleAltCapture,
    hovered,
    registerFrame,
    notifyFrameLoaded,
    picked,
    clearPicked,
    hostAgentId,
    send,
  };
}
