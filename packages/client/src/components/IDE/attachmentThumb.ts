/**
 * attachmentThumb — 첨부 이미지 썸네일 URL 해석 (v2.93).
 *
 * 썸네일은 제출 시점 클라가 만든 메모리 blob URL(`graphStore.attachmentPreviews[basename]`)을
 * 우선 쓴다. 그러나 blob URL 은 document 스코프라 detach 별창 IDE(다른 BrowserWindow)·페이지
 * 새로고침·앱 재시작·부팅 복원된 명령에선 사라진다(파일은 디스크에 보존). 그 경우 server 의
 * `GET /api/agent-attachments/:sessionId/file?rel=...` 로 파일을 받아 **현재 document 에서**
 * `URL.createObjectURL` 로 폴백 blob 을 만든다(별창 스코프까지 해소).
 */
import { useEffect, useRef, useState } from 'react';
import { useGraphStore } from '../../stores/graphStore.js';

const API_BASE = '';

/** 경로의 마지막 세그먼트(파일명). blob preview 맵 키. */
export function basenameOf(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] ?? '';
}

/** 첨부 절대경로에서 `.vibisual/attachments/<sessionId>/<rel...>` 을 파싱해 server GET URL 구성. */
function buildAttachmentFetchUrl(p: string): string | null {
  const norm = p.replace(/\\/g, '/');
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

/**
 * 첨부 경로 배열 → 렌더 가능한 썸네일 목록. blob preview 우선, 없으면 server 라우트로 폴백 blob.
 * 각 basename 은 인스턴스당 1회만 폴백 fetch(`doneRef`), 폴백 blob 은 언마운트 시 일괄 revoke.
 */
export function useAttachmentThumbs(paths: string[] | undefined): AttachmentThumb[] {
  const previews = useGraphStore((s) => s.attachmentPreviews);
  const [fetched, setFetched] = useState<Record<string, string>>({});
  const doneRef = useRef<Set<string>>(new Set());
  const createdRef = useRef<string[]>([]);
  const key = (paths ?? []).join('|');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const p of paths ?? []) {
        const bn = basenameOf(p);
        if (previews[bn] || doneRef.current.has(bn)) continue;
        doneRef.current.add(bn);
        const url = buildAttachmentFetchUrl(p);
        if (!url) continue;
        try {
          const res = await fetch(url);
          if (!res.ok || cancelled) continue;
          const blob = await res.blob();
          if (cancelled) return;
          const obj = URL.createObjectURL(blob);
          createdRef.current.push(obj);
          setFetched((prev) => (prev[bn] ? prev : { ...prev, [bn]: obj }));
        } catch {
          /* 폴백 실패 — 썸네일 없이 진행 */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, previews]);

  // 폴백 blob 은 컴포넌트 언마운트 때만 revoke(렌더 중인 URL 조기 해제 방지).
  useEffect(() => () => { createdRef.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  return (paths ?? [])
    .map((p) => {
      const bn = basenameOf(p);
      return { basename: bn, url: previews[bn] ?? fetched[bn] };
    })
    .filter((a): a is AttachmentThumb => !!a.url);
}
