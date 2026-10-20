// Existing creation/video REST primitives are shared here so one app never imports another app.

import type { VideoAsset, VideoDoc, VideoDocOp } from '@vibisual/video';

import i18n from '../../i18n/index.js';

export interface DocEnvelope {
  readonly doc: VideoDoc;
  readonly duration: number;
  readonly diagnostics: readonly { code: string; level: string; message: string; itemId?: string }[];
}

/** All callers retain the existing localized HTTP failure contract. */
export async function readJsonResponse<T>(res: Response): Promise<T> {
  let body: T & { ok?: boolean; error?: string };
  try { body = await res.json() as T & { ok?: boolean; error?: string }; }
  catch { throw new Error(i18n.t('panel.videoStudio.errRequestFailed', { status: res.status })); }
  if (res.ok) return body;
  throw new Error(body.error ?? i18n.t('panel.videoStudio.errRequestFailed', { status: res.status }));
}

export class VersionConflictError extends Error {
  constructor() {
    super(i18n.t('panel.videoStudio.reloaded'));
    this.name = 'VersionConflictError';
  }
}

/** An explicit ID returns the existing document on retry instead of overwriting human edits. */
export async function createDoc(project: string, title: string, id?: string): Promise<VideoDoc> {
  const res = await fetch('/api/app/vibistudio/docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(id === undefined ? { project, title } : { project, title, id }),
  });
  const body = await readJsonResponse<{ doc: VideoDoc }>(res);
  return body.doc;
}

/** Every caller supplies baseVersion; conflict identity is shared with the existing editor. */
export async function patchDoc(
  project: string,
  docId: string,
  baseVersion: number,
  ops: readonly VideoDocOp[],
): Promise<DocEnvelope> {
  const res = await fetch(`/api/app/vibistudio/doc/${encodeURIComponent(docId)}/patch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, baseVersion, ops }),
  });
  if (res.status === 409) throw new VersionConflictError();
  return readJsonResponse<DocEnvelope>(res);
}

export async function importVideoAsset(project: string, file: File): Promise<VideoAsset> {
  const res = await fetch(`/api/app/vibistudio/assets?project=${encodeURIComponent(project)}&name=${encodeURIComponent(file.name)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' },
    body: new Blob([file], { type: 'application/octet-stream' }),
  });
  return (await readJsonResponse<{ asset: VideoAsset }>(res)).asset;
}
