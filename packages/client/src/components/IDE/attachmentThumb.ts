/**
 * 첨부 썸네일 — 메모리 blob(`attachmentPreviews[basename]`) 우선. blob 은 document 스코프라 별창·새로고침·재시작·복원에선 없으므로
 * `GET /api/agent-attachments/:sessionId/file?rel=...` 로 받아 현재 document 에서 폴백 blob 을 만든다.
 */
import { useEffect, useRef, useState } from 'react';
import { useGraphStore } from '../../stores/graphStore.js';

const API_BASE = '';

/** 경로의 마지막 세그먼트(파일명). blob preview 맵 키. */
export function basenameOf(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] ?? '';
}

/** 첨부 절대경로 → GET URL. 두 갈래: `.vibisual/attachments/…`(paste) · `.vibisual/verify-demos/<demoId>/…`(§5.5 #17-35 ⑨ — 검증 명령은 원본을 가리켜 없으면 그림이 안 뜬다). */
export function buildAttachmentFetchUrl(p: string): string | null {
  const norm = p.replace(/\\/g, '/');

  const demoMarker = '/.vibisual/verify-demos/';
  const demoIdx = norm.indexOf(demoMarker);
  if (demoIdx >= 0) {
    const parts = norm.slice(demoIdx + demoMarker.length).split('/').filter(Boolean);
    const demoId = parts[0];
    const file = parts[1];
    if (!demoId || !file) return null;
    // 서버가 `rel` 을 `<demoId>/<file>` 꼴로 대조한다(레코드에 적힌 그대로여야 통과).
    const rel = `${demoId}/${file}`;
    return `${API_BASE}/api/verification-demos/${encodeURIComponent(demoId)}/frame?rel=${encodeURIComponent(rel)}`;
  }

  const marker = '/.vibisual/attachments/';
  const idx = norm.indexOf(marker);
  if (idx < 0) return null;
  const rest = norm.slice(idx + marker.length); // <sessionId>/<subId?>/<file>
  const parts = rest.split('/').filter(Boolean);
  const sessionId = parts[0];
  if (!sessionId || parts.length < 2) return null;
  const rel = parts.slice(1).join('/');
  return `${API_BASE}/api/agent-attachments/${encodeURIComponent(sessionId)}/file?rel=${encodeURIComponent(rel)}`;
}

export interface AttachmentThumb {
  basename: string;
  url: string;
}

/** blob preview 우선, 없으면 폴백 blob(경로당 1회 fetch, 언마운트 때 revoke). 캐시 키는 전체 경로 — 시연 프레임은 `<demoId>/0.png` 처럼 파일명이 겹친다. */
export function useAttachmentThumbs(paths: string[] | undefined): AttachmentThumb[] {
  const previews = useGraphStore((s) => s.attachmentPreviews);
  const [fetched, setFetched] = useState<Record<string, string>>({});
  const doneRef = useRef<Set<string>>(new Set());
  const createdRef = useRef<string[]>([]);
  const key = (paths ?? []).join('|');

  useEffect(() => {
    let cancelled = false;
    const pending = new Set<string>();
    void (async () => {
      for (const p of paths ?? []) {
        if (cancelled) return;
        const bn = basenameOf(p);
        if (previews[bn] || doneRef.current.has(p)) continue;
        doneRef.current.add(p);
        const url = buildAttachmentFetchUrl(p);
        if (!url) continue;
        pending.add(p);
        try {
          const res = await fetch(url);
          if (!res.ok || cancelled) continue;
          const blob = await res.blob();
          if (cancelled) return;
          const obj = URL.createObjectURL(blob);
          createdRef.current.push(obj);
          pending.delete(p);
          setFetched((prev) => (prev[p] ? prev : { ...prev, [p]: obj }));
        } catch {
          /* 폴백 실패 — 썸네일 없이 진행 */
        }
      }
    })();
    return () => {
      cancelled = true;
      // A session switch cancels unfinished previews, not the ability to fetch them on return.
      // Clear only this effect's pending paths before the next effect claims them.
      for (const p of pending) doneRef.current.delete(p);
    };
  }, [key, previews]);

  // 폴백 blob 은 컴포넌트 언마운트 때만 revoke(렌더 중인 URL 조기 해제 방지).
  useEffect(() => () => { createdRef.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  return (paths ?? [])
    .map((p) => {
      const bn = basenameOf(p);
      return { basename: bn, url: previews[bn] ?? fetched[p] };
    })
    .filter((a): a is AttachmentThumb => !!a.url);
}
