import { useState, useEffect, useCallback, useMemo, type RefObject } from 'react';
import { isReadOnlyHookAgent, PREVIEW_PICK_SOURCE, PREVIEW_DEVICE_PRESETS, type PreviewPickPayload, type PreviewDevicePreset } from '@vibisual/shared';

import { useGraphStore } from '../../stores/graphStore.js';

/**
 * §7.11 (판올림 번호 발급 대기) — 프리뷰 조작(디바이스 폭 + 요소 집기) 상태 한 벌.
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
  /** 요소 집기 모드가 켜져 있는가. */
  pickMode: boolean;
  togglePickMode: () => void;
  /** 방금 집은 요소(없으면 null). */
  picked: PreviewPickPayload | null;
  clearPicked: () => void;
  /** 이 프리뷰를 띄운 커스텀 에이전트 — 없으면 보내기를 열지 않는다(§5.5 #17-29 경계). */
  hostAgentId: string | undefined;
  /** 조립된 명령을 그 에이전트에게 보낸다. 보낼 곳이 없으면 false. */
  send: (text: string) => boolean;
}

/**
 * @param iframeRef 프리뷰 iframe. picker 를 켜고 끄는 `postMessage` 의 상대.
 * @param url       프리뷰가 보고 있는 **원본** URL(프록시 경로 ❌) — 호스트 에이전트를 찾는 열쇠.
 */
export function usePreviewPicker(iframeRef: RefObject<HTMLIFrameElement | null>, url: string): PreviewPicker {
  const [device, setDeviceState] = useState<PreviewDeviceId>(() => loadDevice());
  const [pickMode, setPickMode] = useState(false);
  const [picked, setPicked] = useState<PreviewPickPayload | null>(null);
  const addCommand = useGraphStore((s) => s.addCommand);

  // 이 URL 의 iframe 위성을 **매달고 있는** 에이전트(§7.11 owning shell 규약이 이미 정한 그 관계).
  //   위성은 부모 노드 id 로 묶여 오므로(`satellites`), 그 묶음에서 이 URL 을 가진 iframe 을 찾는다.
  //   훅 버블은 제외한다 — 관측 대상에 명령을 넣지 않는다(§5.5 #17-29).
  const hostAgentId = useGraphStore((s) => {
    for (const [parentId, items] of Object.entries(s.satellites)) {
      if (!items.some((n) => n.bubbleType === 'iframe' && n.url === url)) continue;
      const owner = s.agents.find((a) => a.id === parentId);
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

  // 부모 → 프리뷰: 켜기/끄기. 프리뷰가 다시 로드되면 스스로 꺼진 상태로 태어나므로 여기서 다시 보낸다.
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: PREVIEW_PICK_SOURCE, type: 'pick-mode', on: pickMode },
      '*',
    );
  }, [pickMode, iframeRef]);

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

  return { device, setDevice, deviceWidth, pickMode, togglePickMode, picked, clearPicked, hostAgentId, send };
}
