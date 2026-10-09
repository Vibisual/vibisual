import type { AudioAsset, AudioDoc, AudioDocOp } from '@vibisual/audio';

export const SOUND_API = '/api/app/vibisound';
export interface SoundHistory { requestId: string; action: string; actor?: string; version: number; at: number }
export interface SoundEnvelope { doc: AudioDoc; canUndo: boolean; canRedo: boolean; history?: SoundHistory[] }
export interface SoundSummary { id: string; title: string; version: number; updatedAt: number; duration: number }
export class SoundApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
async function response<T>(res: Response): Promise<T> {
  const body = await res.json() as T & { error?: string; message?: string };
  if (!res.ok) throw new SoundApiError(res.status, body.error ?? 'request-failed', body.message ?? body.error ?? String(res.status));
  return body;
}
async function post<T>(path: string, body: unknown): Promise<T> {
  return response<T>(await fetch(`${SOUND_API}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
}
export async function listSoundDocs(project: string): Promise<SoundSummary[]> {
  return (await response<{ docs: SoundSummary[] }>(await fetch(`${SOUND_API}/docs?project=${encodeURIComponent(project)}`))).docs;
}
export async function createSoundDoc(project: string, title: string, id?: string): Promise<SoundEnvelope> {
  return post('/docs', { project, title, id });
}
export async function readSoundDoc(project: string, id: string): Promise<SoundEnvelope> {
  return response(await fetch(`${SOUND_API}/doc/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`));
}
export async function mutateSoundDoc(project: string, doc: AudioDoc, action: 'patch' | 'undo' | 'redo', ops?: readonly AudioDocOp[]): Promise<SoundEnvelope> {
  const payload = { project, baseVersion: doc.version, requestId: crypto.randomUUID(), actor: 'human', ops };
  // One retry uses the SAME request ID: a lost response must not apply an edit twice.
  try { return await post(`/doc/${encodeURIComponent(doc.id)}/${action}`, payload); }
  catch (error) {
    if (error instanceof SoundApiError) throw error;
    return post(`/doc/${encodeURIComponent(doc.id)}/${action}`, payload);
  }
}
export async function importSoundAsset(project: string, file: File | string): Promise<AudioAsset> {
  if (typeof file === 'string') return (await post<{ asset: AudioAsset }>('/assets/import', { project, path: file })).asset;
  // Explicit binary MIME also survives the packaged IPC fetch adapter.
  const res = await fetch(`${SOUND_API}/assets?project=${encodeURIComponent(project)}&name=${encodeURIComponent(file.name)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Blob([file], { type: 'application/octet-stream' }),
  });
  return (await response<{ asset: AudioAsset }>(res)).asset;
}
export function soundAssetUrl(project: string, path: string): string {
  return `${SOUND_API}/asset?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`;
}
