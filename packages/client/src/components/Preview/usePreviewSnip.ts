import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { PreviewSnipRect } from '@vibisual/shared';

import { useGraphStore, agentSessionInputKey } from '../../stores/graphStore.js';
import { snipFileName } from './snipRect.js';

/**
 * §5.17 (B) — 프리뷰 영역 캡처 → **그 프리뷰를 띄운 에이전트의 입력창 첨부**.
 *
 * 새 캡처 레이어를 만들지 않는다. 찍는 통로는 Electron `capturePage(rect)` 하나(`window.api`
 * 의 `capture.pageRegion`)이고, 붙이는 레일은 붙여넣기 이미지와 **같은** 첨부 엔드포인트다.
 * 첨부만 하고 **자동 전송 ❌** — 무엇을 고칠지는 사용자가 문장으로 얹어 직접 보낸다.
 */

/** 첨부는 IDE 입력창의 메인 탭(요소 집기 명령이 가는 그 자리)에 붙는다. */
const DRAFT_SESSION: string | null = null;

export interface PreviewSnip {
  /** 이 화면에서 캡처가 가능한가(`window.api` 없는 모드·구버전 preload 면 false). */
  available: boolean;
  /** 조준 레이어가 덮여 있는가. */
  snipMode: boolean;
  toggle: () => void;
  cancel: () => void;
  /** 사각형 하나를 찍어 첨부까지 간다. 끝나면 조준 레이어는 스스로 꺼진다. */
  capture: (rect: PreviewSnipRect) => void;
  /** 지금 찍는 중인가(업로드 포함). */
  busy: boolean;
  /** 이 프리뷰에서 붙인 첨부들 — 입력창의 그것과 같은 항목이다(지우면 양쪽에서 사라진다). */
  attachments: { tempId: string; previewUrl: string; uploading: boolean; error?: string }[];
  remove: (tempId: string) => void;
  /** 실패 사유 한 줄. 조용한 무동작 ❌. */
  error: string | null;
  clearError: () => void;
}

function makeTempId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `snip-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * @param hostAgentId 이 프리뷰를 띄운 에이전트. 없으면 붙일 입력창이 없어 캡처 자체를 열지 않는다.
 */
export function usePreviewSnip(hostAgentId: string | undefined): PreviewSnip {
  const [snipMode, setSnipMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 이 프리뷰가 붙인 첨부만 골라 보여 준다 — 사용자가 입력창에서 지우면 목록에서도 사라진다.
  const [mine, setMine] = useState<string[]>([]);

  const updateAttachments = useGraphStore((s) => s.updateAgentSessionInputAttachments);
  const draftKey = hostAgentId === undefined ? null : agentSessionInputKey(hostAgentId, DRAFT_SESSION);
  const draftAttachments = useGraphStore((s) =>
    (draftKey === null ? undefined : s.agentSessionInputs[draftKey]?.attachments),
  );

  const attachments = useMemo(() => {
    if (!draftAttachments) return [];
    return draftAttachments
      .filter((a) => mine.includes(a.tempId))
      .map((a) => ({
        tempId: a.tempId,
        previewUrl: a.previewUrl,
        uploading: a.uploading,
        ...(a.error === undefined ? {} : { error: a.error }),
      }));
  }, [draftAttachments, mine]);

  const available = useMemo(
    () => hostAgentId !== undefined && typeof window.api?.capture?.pageRegion === 'function',
    [hostAgentId],
  );

  const hostRef = useRef(hostAgentId);
  hostRef.current = hostAgentId;
  const availableRef = useRef(available);
  availableRef.current = available;

  // 이 프리뷰가 사라져도 blob URL 이 남으면 그만큼 메모리가 붙들린다. 우리가 만든 것만 되돌린다.
  const blobUrlsRef = useRef<string[]>([]);
  useEffect(() => () => {
    for (const url of blobUrlsRef.current) URL.revokeObjectURL(url);
    blobUrlsRef.current = [];
  }, []);

  const toggle = useCallback(() => {
    // 찍을 통로가 없는 화면에서 조준 레이어만 덮으면 프리뷰만 막고 끝난다 — 먼저 사유를 말한다.
    if (!availableRef.current) { setError('unavailable'); return; }
    setError(null);
    setSnipMode((v) => !v);
  }, []);

  const cancel = useCallback(() => { setSnipMode(false); }, []);
  const clearError = useCallback(() => { setError(null); }, []);

  const capture = useCallback((rect: PreviewSnipRect) => {
    const agentId = hostRef.current;
    setSnipMode(false);
    if (agentId === undefined) return;
    const pageRegion = window.api?.capture?.pageRegion;
    if (typeof pageRegion !== 'function') {
      setError('unavailable');
      return;
    }
    setBusy(true);
    void (async () => {
      const tempId = makeTempId();
      let previewUrl = '';
      try {
        const shot = await pageRegion(rect);
        if (!shot?.ok || !shot.dataUrl) throw new Error(shot?.error ?? 'capture failed');
        const blob = await (await fetch(shot.dataUrl)).blob();
        const file = new File([blob], snipFileName(), { type: 'image/png' });
        previewUrl = URL.createObjectURL(file);
        blobUrlsRef.current.push(previewUrl);
        // 낙관 추가 — 업로드가 끝나기 전에도 입력창에 그림이 떠 있어야 무엇을 붙였는지 보인다.
        setMine((prev) => [...prev, tempId]);
        updateAttachments(agentId, DRAFT_SESSION, (prev) => [
          ...prev,
          { tempId, previewUrl, serverPath: '', uploading: true },
        ]);

        const sessionId = useGraphStore.getState().agents.find((a) => a.id === agentId)?.path;
        if (!sessionId) throw new Error('agent session not found');
        const fd = new FormData();
        fd.append('image', file);
        const res = await fetch(`/api/agent-attachments/${encodeURIComponent(sessionId)}/upload`, {
          method: 'POST',
          body: fd,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { path: string };
        updateAttachments(agentId, DRAFT_SESSION, (prev) =>
          prev.map((a) => (a.tempId === tempId ? { ...a, serverPath: data.path, uploading: false } : a)),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'capture failed';
        setError(msg);
        // 낙관 추가까지 갔다면 그 항목에 사유를 남긴다(조용히 사라지면 왜 없는지 알 수 없다).
        if (previewUrl !== '') {
          updateAttachments(agentId, DRAFT_SESSION, (prev) =>
            prev.map((a) => (a.tempId === tempId ? { ...a, uploading: false, error: msg } : a)),
          );
        }
      } finally {
        setBusy(false);
      }
    })();
  }, [updateAttachments]);

  const remove = useCallback((tempId: string) => {
    const agentId = hostRef.current;
    if (agentId === undefined) return;
    const sessionId = useGraphStore.getState().agents.find((a) => a.id === agentId)?.path;
    updateAttachments(agentId, DRAFT_SESSION, (prev) => {
      const target = prev.find((a) => a.tempId === tempId);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        blobUrlsRef.current = blobUrlsRef.current.filter((u) => u !== target.previewUrl);
        if (target.serverPath && sessionId) {
          // 올려 둔 파일까지 함께 지운다(붙여넣기 첨부 지우기와 같은 경로).
          fetch(`/api/agent-attachments/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: target.serverPath }),
          }).catch(() => { /* 파일이 이미 없어도 화면은 그대로 */ });
        }
      }
      return prev.filter((a) => a.tempId !== tempId);
    });
    setMine((prev) => prev.filter((id) => id !== tempId));
  }, [updateAttachments]);

  return { available, snipMode, toggle, cancel, capture, busy, attachments, remove, error, clearError };
}
