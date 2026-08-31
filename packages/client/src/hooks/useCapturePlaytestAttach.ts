import { useCallback, useRef, useState } from 'react';

import { useGraphStore, agentSessionInputKey } from '../stores/graphStore.js';
import type { PlaytestClip } from '../stores/capturePlaytest.js';
import { frameFileName, frameTimesFor, type ClipRange } from '../components/BubbleMap/playtestClip.js';
import { extractClipFrames } from './clipFrames.js';

// §5.9 플레이테스트 — 고른 구간을 프레임 PNG 로 뽑아 **그 에이전트의 입력창에 첨부**한다.
//
// 새 업로드 레일을 만들지 않는다. 붙는 곳은 붙여넣기 이미지·프리뷰 스닙(§5.17 (B))이 쓰는 그
// 첨부 엔드포인트 하나이고, 첨부만 하고 **자동 전송 ❌** — 무엇이 잘못됐는지는 사용자가 문장으로
// 얹어 직접 보낸다. 영상 파일이 아니라 프레임을 붙이는 이유는 모델이 읽는 것이 그림이기 때문이다.

/** 첨부는 IDE 입력창의 메인 탭(요소 집기·스닙 첨부가 가는 그 자리)에 붙는다. */
const DRAFT_SESSION: string | null = null;

export interface PlaytestAttachProgress {
  done: number;
  total: number;
}

export interface PlaytestAttachResult {
  /** 실제로 붙은 장수. */
  attached: number;
  agentId: string;
  at: number;
}

export interface PlaytestAttach {
  busy: boolean;
  progress: PlaytestAttachProgress | null;
  /** 마지막으로 성공한 첨부(창이 "몇 장을 어디에 붙였는지" 한 줄로 보여 준다). */
  result: PlaytestAttachResult | null;
  error: string | null;
  clearError: () => void;
  /** 구간에서 프레임을 뽑아 첨부한다. 성공하면 붙은 장수를 돌려준다. */
  attach: (clip: PlaytestClip, range: ClipRange, frameCount: number, agentId: string) => Promise<number>;
}

function makeTempId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `playtest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** 첨부 레일 — 붙여넣기 이미지와 같은 엔드포인트. 올린 뒤 서버 경로를 draft 에 채운다. */
async function uploadFrame(sessionId: string, file: File): Promise<string> {
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
  return data.path;
}

export function useCapturePlaytestAttach(): PlaytestAttach {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PlaytestAttachProgress | null>(null);
  const [result, setResult] = useState<PlaytestAttachResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateAttachments = useGraphStore((s) => s.updateAgentSessionInputAttachments);

  // 우리가 만든 blob URL 만 되돌린다(입력창에서 지우는 경로는 그쪽이 따로 갖고 있다).
  const blobUrlsRef = useRef<string[]>([]);

  const clearError = useCallback(() => setError(null), []);

  const attach = useCallback(async (
    clip: PlaytestClip,
    range: ClipRange,
    frameCount: number,
    agentId: string,
  ): Promise<number> => {
    setError(null);
    setBusy(true);
    const times = frameTimesFor(range, frameCount);
    setProgress({ done: 0, total: times.length });
    try {
      const sessionId = useGraphStore.getState().agents.find((a) => a.id === agentId)?.path;
      if (!sessionId) throw new Error('agentNotFound');

      const grabbed = await extractClipFrames(
        clip,
        times,
        (index, timeMs) => frameFileName(clip.sourceName, index, timeMs, clip.at),
        (done) => setProgress({ done, total: times.length }),
      );
      const files = grabbed.map((f) => f.file);
      if (files.length === 0) throw new Error('noFrames');

      // 낙관 추가 — 업로드가 끝나기 전에도 입력창에 그림이 떠 있어야 무엇을 붙였는지 보인다.
      const entries = files.map((file) => {
        const previewUrl = URL.createObjectURL(file);
        blobUrlsRef.current.push(previewUrl);
        return { tempId: makeTempId(), file, previewUrl };
      });
      updateAttachments(agentId, DRAFT_SESSION, (prev) => [
        ...prev,
        ...entries.map((e) => ({ tempId: e.tempId, previewUrl: e.previewUrl, serverPath: '', uploading: true })),
      ]);

      let attached = 0;
      for (const entry of entries) {
        try {
          const path = await uploadFrame(sessionId, entry.file);
          attached += 1;
          updateAttachments(agentId, DRAFT_SESSION, (prev) =>
            prev.map((a) => (a.tempId === entry.tempId ? { ...a, serverPath: path, uploading: false } : a)),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'upload failed';
          setError(msg);
          // 조용히 사라지면 왜 없는지 알 수 없다 — 그 항목에 사유를 남긴다.
          updateAttachments(agentId, DRAFT_SESSION, (prev) =>
            prev.map((a) => (a.tempId === entry.tempId ? { ...a, uploading: false, error: msg } : a)),
          );
        }
      }
      if (attached > 0) setResult({ attached, agentId, at: Date.now() });
      return attached;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'attach failed');
      return 0;
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [updateAttachments]);

  return { busy, progress, result, error, clearError, attach };
}
