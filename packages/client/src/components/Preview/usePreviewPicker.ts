import { useState, useEffect, useCallback, useMemo, useRef, type RefObject } from 'react';
import {
  isReadOnlyHookAgent,
  PREVIEW_PICK_SOURCE,
  PREVIEW_DEVICE_PRESETS,
  resolveCompareWidths,
  type PreviewPickPayload,
  type PreviewDevicePreset,
  type PreviewCompareWidth,
} from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';

/**
 * §7.11 (판올림 번호 발급 대기) + §5.17 (A) — 프리뷰 조작(디바이스 폭 + 요소 집기) 상태 한 벌.
 *
 * 탭 프리뷰(`IframeView`)와 캔버스 프리뷰(`PlayPreviewNode`)가 **같은 규칙**을 써야 한 쪽만
 * 동작하는 사고가 안 난다(§7.11 `toProxyUrl` 이 한 곳에 사는 것과 같은 이유) — 그래서 이 훅 하나다.
 */

const DEVICE_KEY = 'vibisual:preview:device';

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
  /**
   * §5.17 (A) — 프리뷰 iframe 한 장을 이 훅에 등록한다(콜백 ref).
   *
   * 비교 모드에서는 프레임이 셋이라, pick 모드를 **등록된 전부**에 방송해야 어느 칸에서 집어도
   * 올라온다. 프레임이 붙는 그 순간 현재 모드를 한 번 보내 준다(늦게 태어난 칸이 꺼진 채 남는 것 ❌).
   */
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
 * @param iframeRef 프리뷰의 **대표** iframe(새로고침처럼 한 장을 가리켜야 하는 조작의 상대).
 * @param url       프리뷰가 보고 있는 **원본** URL(프록시 경로 ❌) — 호스트 에이전트를 찾는 열쇠.
 * @param fallbackAgentId
 *   위성으로 찾지 못할 때 쓸 후보(§5.17 (C) `PlayBubble.ownerAgentId`). 플레이 프리뷰는
 *   iframe 위성을 만들지 않으므로(§5.14) 이것이 없으면 캔버스 프리뷰에서는 보낼 곳도
 *   붙일 곳도 영영 없다 — 엣지가 가리키는 그 에이전트를 그대로 쓴다(두 기능이 어긋나지 않는다).
 */
export function usePreviewPicker(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  url: string,
  fallbackAgentId?: string | undefined,
): PreviewPicker {
  const [device, setDeviceState] = useState<PreviewDeviceId>(() => loadDevice());
  const [pickMode, setPickMode] = useState(false);
  const [picked, setPicked] = useState<PreviewPickPayload | null>(null);
  const addCommand = useGraphStore((s) => s.addCommand);

  // 지금 화면에 살아 있는 프레임들. 비교 모드면 셋, 아니면 하나다.
  const framesRef = useRef<Set<HTMLIFrameElement>>(new Set());
  // 콜백 ref 안에서 최신 pickMode 를 읽어야 하는데 그 시점의 클로저는 낡았다 — ref 로 들고 있는다.
  const pickModeRef = useRef(pickMode);
  pickModeRef.current = pickMode;

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

  // 프리뷰 → 부모: 집은 요소 / 취소. 출처 표식이 없는 메시지는 무시한다(남의 postMessage 오인 ❌).
  useEffect(() => {
    function onMessage(e: MessageEvent): void {
      const data = e.data as { source?: string; type?: string; payload?: PreviewPickPayload } | null;
      if (!data || data.source !== PREVIEW_PICK_SOURCE) return;
      if (data.type === 'pick' && data.payload) {
        setPicked(data.payload);
        setPickMode(false);
      } else if (data.type === 'pick-cancel') {
        setPickMode(false);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // 부모 → 프리뷰: 켜기/끄기. 대표 프레임과 등록된 모든 프레임에 함께 보낸다(비교 모드 대비).
  useEffect(() => {
    const targets = new Set<HTMLIFrameElement>(framesRef.current);
    if (iframeRef.current) targets.add(iframeRef.current);
    for (const frame of targets) {
      frame.contentWindow?.postMessage({ source: PREVIEW_PICK_SOURCE, type: 'pick-mode', on: pickMode }, '*');
    }
  }, [pickMode, iframeRef, compareWidths]);

  const registerFrame = useCallback((el: HTMLIFrameElement | null) => {
    if (!el) return; // 콜백 ref 의 정리 호출 — 아래 unmount 정리에서 죽은 프레임을 걷어낸다.
    framesRef.current.add(el);
    el.contentWindow?.postMessage(
      { source: PREVIEW_PICK_SOURCE, type: 'pick-mode', on: pickModeRef.current },
      '*',
    );
  }, []);

  const notifyFrameLoaded = useCallback((el: HTMLIFrameElement | null) => {
    if (!el) return;
    framesRef.current.add(el);
    el.contentWindow?.postMessage(
      { source: PREVIEW_PICK_SOURCE, type: 'pick-mode', on: pickModeRef.current },
      '*',
    );
  }, []);

  // 화면에서 사라진 프레임은 들고 있어 봐야 postMessage 가 조용히 실패할 뿐이다 — 주기적으로 걷어낸다.
  useEffect(() => {
    const frames = framesRef.current;
    for (const frame of [...frames]) {
      if (!frame.isConnected) frames.delete(frame);
    }
  });

  const togglePickMode = useCallback(() => {
    setPickMode((v) => !v);
    setPicked(null);
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
    registerFrame,
    notifyFrameLoaded,
    picked,
    clearPicked,
    hostAgentId,
    send,
  };
}
