/**
 * §5.13 Vibistudio — 클라이언트 REST 얇은 층.
 *
 * 호출을 한 곳에 모으는 이유는 **낙관적 잠금 규약을 한 군데서만 지키면 되게** 하기
 * 위해서다. 화면 여러 곳이 각자 patch 를 만들면 `baseVersion` 을 빠뜨리는 자리가
 * 생기고, 그때부터는 저장이 조용히 서로를 덮는다.
 */

import type { VideoDoc, VideoDocOp } from '@vibisual/video';

export interface DocEnvelope {
  readonly doc: VideoDoc;
  readonly duration: number;
  readonly diagnostics: readonly { code: string; level: string; message: string; itemId?: string }[];
}

export interface DocSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
  readonly version: number;
}

export type VideoJobStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled';

export interface VideoJob {
  readonly id: string;
  readonly kind: 'render' | 'still';
  readonly projectPath: string;
  readonly docId: string;
  readonly status: VideoJobStatus;
  readonly progress: number;
  readonly result?: string;
  readonly error?: string;
  readonly note?: string;
  readonly t?: number;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { ok?: boolean; error?: string };
  if (res.ok) return body;
  throw new Error(body.error ?? `요청이 실패했습니다 (${res.status}).`);
}

export async function listDocs(project: string): Promise<DocSummary[]> {
  const res = await fetch(`/api/app/vibistudio/docs?project=${encodeURIComponent(project)}`);
  const body = await json<{ docs: DocSummary[] }>(res);
  return body.docs;
}

/**
 * 문서를 만든다. `id` 를 주면 **그 id 로** 만들고 이미 있으면 그것을 돌려받는다(§5.13 (R-3)).
 * 파일을 눌러 여는 경로가 이 인자를 쓴다 — 같은 파일은 언제 눌러도 같은 문서로 간다.
 */
export async function createDoc(project: string, title: string, id?: string): Promise<VideoDoc> {
  const res = await fetch('/api/app/vibistudio/docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(id === undefined ? { project, title } : { project, title, id }),
  });
  const body = await json<{ doc: VideoDoc }>(res);
  return body.doc;
}

export async function readDoc(project: string, docId: string): Promise<DocEnvelope> {
  const res = await fetch(`/api/app/vibistudio/doc/${encodeURIComponent(docId)}?project=${encodeURIComponent(project)}`);
  return json<DocEnvelope>(res);
}

export class VersionConflictError extends Error {
  constructor() {
    super('다른 곳에서 문서가 바뀌었습니다. 다시 읽어 옵니다.');
    this.name = 'VersionConflictError';
  }
}

/**
 * 문서를 고친다.
 *
 * 409 를 특별한 오류로 구분하는 이유는, 그때는 실패가 아니라 **다시 읽고 재시도하면
 * 되는 상황**이기 때문이다. 화면이 이 둘을 같게 다루면 사용자에게 헛된 오류를 띄운다.
 */
export async function patchDoc(
  project: string,
  docId: string,
  baseVersion: number,
  ops: VideoDocOp[],
): Promise<DocEnvelope> {
  const res = await fetch(`/api/app/vibistudio/doc/${encodeURIComponent(docId)}/patch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, baseVersion, ops }),
  });
  if (res.status === 409) throw new VersionConflictError();
  return json<DocEnvelope>(res);
}

export async function startRender(project: string, docId: string): Promise<VideoJob> {
  const res = await fetch(`/api/app/vibistudio/doc/${encodeURIComponent(docId)}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project }),
  });
  const body = await json<{ job: VideoJob }>(res);
  return body.job;
}

export async function getJob(jobId: string): Promise<VideoJob> {
  const res = await fetch(`/api/app/vibistudio/job/${encodeURIComponent(jobId)}`);
  const body = await json<{ job: VideoJob }>(res);
  return body.job;
}

/** 스튜디오가 다음 일감을 가져간다. 없으면 null. */
export async function claimJob(): Promise<VideoJob | null> {
  const res = await fetch('/api/app/vibistudio/jobs/claim', { method: 'POST' });
  const body = await json<{ job: VideoJob | null }>(res);
  return body.job;
}

export async function reportJob(
  jobId: string,
  patch: { status?: VideoJobStatus; progress?: number; image?: string; bytes?: string; error?: string; note?: string },
): Promise<void> {
  await fetch(`/api/app/vibistudio/job/${encodeURIComponent(jobId)}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** 소재 파일 주소. 프로젝트 안 경로만 통한다(서버가 막는다). */
export function assetUrl(project: string, relPath: string): string {
  return `/api/app/vibistudio/asset?project=${encodeURIComponent(project)}&path=${encodeURIComponent(relPath)}`;
}
