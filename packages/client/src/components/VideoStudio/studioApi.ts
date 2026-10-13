/**
 * §5.13 (V) — 스튜디오 개편이 더한 REST 의 얇은 층(판 기록·바퀴·지금 하는 일).
 *
 * 종전 `videoApi.ts` 와 같은 규약 — 실패면 서버의 이유 한 줄로 던지고(화면은 `studioErrors` 가 사람 말로 바꾼다), 판본을
 * 고치는 쓰기는 낙관적 잠금 경로를 그대로 지난다.
 */

import type {
  DocActivity,
  DocStyle,
  ExternalRef,
  HistoryEntry,
  LibItem,
  LibRequest,
  NoteStatus,
  PassRecord,
  StyleCandidates,
  VideoAsset,
  VideoDoc,
  VideoNote,
} from '@vibisual/video';
import { readJsonResponse } from './videoApi.js';

const BASE = '/api/app/vibistudio';

function q(project: string): string {
  return `project=${encodeURIComponent(project)}`;
}

function docPath(docId: string, rest = ''): string {
  return `${BASE}/doc/${encodeURIComponent(docId)}${rest}`;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return readJsonResponse<T>(res);
}

// ─── §5.13 (V) 37-3 판 기록 ───

export interface HistoryListing {
  readonly entries: readonly HistoryEntry[];
  readonly passes: readonly PassRecord[];
}

export async function readHistory(project: string, docId: string): Promise<HistoryListing> {
  const res = await fetch(`${docPath(docId, '/history')}?${q(project)}`);
  const body = await readJsonResponse<{ entries?: HistoryEntry[]; passes?: PassRecord[] }>(res);
  return { entries: body.entries ?? [], passes: body.passes ?? [] };
}

export async function readHistoryDoc(project: string, docId: string, revId: string): Promise<VideoDoc> {
  const res = await fetch(`${docPath(docId, `/history/${encodeURIComponent(revId)}`)}?${q(project)}`);
  return (await readJsonResponse<{ doc: VideoDoc }>(res)).doc;
}

/** 저장점을 찍거나, 맡기기 직전 판을 남긴다(그 바퀴를 연다). */
export async function recordHistory(
  project: string,
  docId: string,
  body: { kind: 'checkpoint' | 'pass-start'; passId?: string; request?: string; label?: string; mode?: string; chapterId?: string },
): Promise<{ entry?: HistoryEntry; pass?: PassRecord }> {
  return post(docPath(docId, '/history'), { project, ...body });
}

/** 그 판으로 돌아간다 — 되돌림도 새 판이다. 돌아간 문서를 돌려준다. */
export async function restoreHistory(project: string, docId: string, revId: string): Promise<{ doc: VideoDoc; entry: HistoryEntry }> {
  return post(docPath(docId, `/history/${encodeURIComponent(revId)}/restore`), { project });
}

export async function deleteHistory(project: string, docId: string, revId: string): Promise<void> {
  const res = await fetch(`${docPath(docId, `/history/${encodeURIComponent(revId)}`)}?${q(project)}`, { method: 'DELETE' });
  await readJsonResponse(res);
}

/** 그 판의 문서·코드로 찍은 정지 화면(data URL). 시각을 안 주면 그 판의 대표 시각(길이의 35%). */
export async function historyStill(project: string, docId: string, revId: string, t?: number): Promise<string> {
  const time = t === undefined ? '' : `&t=${encodeURIComponent(String(t))}`;
  const res = await fetch(`${docPath(docId, `/history/${encodeURIComponent(revId)}/still`)}?${q(project)}${time}`);
  const body = await readJsonResponse<{ image?: string }>(res);
  if (!body.image) throw new Error('no still');
  return body.image;
}

export async function readPasses(project: string, docId: string): Promise<{ passes: readonly PassRecord[]; activity: DocActivity | null }> {
  const res = await fetch(`${docPath(docId, '/passes')}?${q(project)}`);
  const body = await readJsonResponse<{ passes?: PassRecord[]; activity?: DocActivity | null }>(res);
  return { passes: body.passes ?? [], activity: body.activity ?? null };
}

/** 스튜디오가 요청마다 만드는 바퀴 id(파일 이름에 쓸 수 있는 모양). */
export function newPassId(): string {
  return `pass-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── §5.13 (V) 37-7 메모 핀 ───

export async function readNotes(project: string, docId: string): Promise<readonly VideoNote[]> {
  const res = await fetch(`${docPath(docId, '/notes')}?${q(project)}`);
  return (await readJsonResponse<{ notes?: VideoNote[] }>(res)).notes ?? [];
}

export async function addNote(
  project: string,
  docId: string,
  body: { t: number; x: number; y: number; text: string; itemId?: string; chapterId?: string; element?: string },
): Promise<VideoNote> {
  return (await post<{ note: VideoNote }>(docPath(docId, '/notes'), { project, ...body })).note;
}

export async function patchNote(
  project: string,
  docId: string,
  noteId: string,
  patch: { status?: NoteStatus; text?: string; passId?: string },
): Promise<VideoNote> {
  const res = await fetch(docPath(docId, `/notes/${encodeURIComponent(noteId)}`), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, ...patch }),
  });
  return (await readJsonResponse<{ note: VideoNote }>(res)).note;
}

export async function deleteNote(project: string, docId: string, noteId: string): Promise<void> {
  const res = await fetch(`${docPath(docId, `/notes/${encodeURIComponent(noteId)}`)}?${q(project)}`, { method: 'DELETE' });
  await readJsonResponse(res);
}

// ─── §5.13 (V) 37-10 스타일 카드 ───

export async function scanStyle(project: string): Promise<{ candidates: StyleCandidates; suggestion: DocStyle; current: DocStyle | null }> {
  return post(`${BASE}/style/scan`, { project });
}

export async function readStyle(project: string): Promise<DocStyle | null> {
  const res = await fetch(`${BASE}/style?${q(project)}`);
  return (await readJsonResponse<{ style?: DocStyle | null }>(res)).style ?? null;
}

/** 확정 — 글꼴·로고 파일은 서버가 스타일 자리로 복사한다. 확정된 한 벌(복사된 경로)을 돌려준다. */
export async function confirmStyle(project: string, style: DocStyle): Promise<DocStyle> {
  const res = await fetch(`${BASE}/style`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, style }) });
  return (await readJsonResponse<{ style: DocStyle }>(res)).style;
}

/** 프로젝트 안 파일을 화면에 띄울 주소(blob) — 패키지 앱에서 엘리먼트의 `/api` 요청은 비므로 fetch 로 받는다. */
export async function projectFileBlobUrl(project: string, relPath: string): Promise<string> {
  const res = await fetch(`${BASE}/asset?${q(project)}&path=${encodeURIComponent(relPath)}`);
  if (!res.ok) throw new Error(String(res.status));
  return URL.createObjectURL(await res.blob());
}

// ─── §5.13 (V) 37-11 부품 서랍 ───

export interface PartListing {
  readonly parts: readonly { readonly id: string; readonly category: string; readonly name: string; readonly defaultDuration: number }[];
  readonly mine: readonly { readonly id: string; readonly name: string; readonly createdAt: number; readonly duration: number; readonly items: number }[];
}

/** 부품을 꺼내 쓸 때 서버가 돌려주는 아이템 틀(장면 기준 시각·소재 id). */
export interface PartItemTemplate {
  readonly kind: string;
  readonly trackKind: 'visual' | 'audio' | 'caption';
  readonly relStart: number;
  readonly duration: number;
  readonly assetId?: string;
  readonly label?: string;
  readonly sceneId?: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly transform?: Readonly<Record<string, unknown>>;
  readonly asset?: Readonly<Record<string, unknown>>;
  readonly cues?: readonly { readonly start: number; readonly end: number; readonly text: string }[];
}

export async function listParts(project: string): Promise<PartListing> {
  const res = await fetch(`${BASE}/parts?${q(project)}`);
  const body = await readJsonResponse<Partial<PartListing>>(res);
  return { parts: body.parts ?? [], mine: body.mine ?? [] };
}

export async function partThumb(project: string, partId: string): Promise<string> {
  const res = await fetch(`${BASE}/parts/${encodeURIComponent(partId)}/thumb?${q(project)}`);
  const body = await readJsonResponse<{ image?: string }>(res);
  if (!body.image) throw new Error('no thumbnail');
  return body.image;
}

/** 부품을 그 문서의 사본으로 들인다(이름이 use 로 시작하면 훅으로 읽히므로 add). */
export async function addStudioPart(project: string, docId: string, partId: string): Promise<{ assets: readonly VideoAsset[]; items: readonly PartItemTemplate[] }> {
  const body = await post<{ assets?: VideoAsset[]; items?: PartItemTemplate[] }>(`${BASE}/parts/use`, { project, docId, partId });
  return { assets: body.assets ?? [], items: body.items ?? [] };
}

export async function savePart(project: string, docId: string, chapterId: string, name: string): Promise<string> {
  return (await post<{ id: string }>(`${BASE}/parts/save`, { project, docId, chapterId, name })).id;
}

// ─── §5.13 (T-6)(T-10) 가져오기 ───

export interface LibsListing {
  readonly items: readonly LibItem[];
  readonly requests: readonly LibRequest[];
}

export interface LibImportResult {
  readonly item: LibItem;
  readonly refs?: readonly ExternalRef[];
  readonly hasDuration?: boolean;
}

export async function listLibs(project: string): Promise<LibsListing> {
  const res = await fetch(`${BASE}/libs?${q(project)}`);
  const body = await readJsonResponse<Partial<LibsListing>>(res);
  return { items: body.items ?? [], requests: body.requests ?? [] };
}

export async function importLibFile(project: string, file: File): Promise<LibImportResult> {
  const res = await fetch(`${BASE}/libs/file?${q(project)}&name=${encodeURIComponent(file.name)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Blob([file], { type: 'application/octet-stream' }),
  });
  return readJsonResponse<LibImportResult>(res);
}

export async function importLibUrl(project: string, url: string, requestId?: string): Promise<LibImportResult> {
  return post(`${BASE}/libs/url`, { project, url, ...(requestId ? { requestId } : {}) });
}

export async function searchProjectLibFiles(project: string, query: string): Promise<readonly { path: string; bytes: number }[]> {
  const res = await fetch(`${BASE}/libs/project-files?${q(project)}&q=${encodeURIComponent(query)}`);
  return (await readJsonResponse<{ files?: { path: string; bytes: number }[] }>(res)).files ?? [];
}

export async function importLibFromProject(project: string, relPath: string): Promise<LibImportResult> {
  return post(`${BASE}/libs/project`, { project, path: relPath });
}

export async function rejectLibRequest(project: string, requestId: string): Promise<void> {
  const res = await fetch(`${BASE}/libs/requests/${encodeURIComponent(requestId)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, status: 'rejected' }),
  });
  await readJsonResponse(res);
}

export async function deleteLib(project: string, id: string): Promise<void> {
  const res = await fetch(`${BASE}/libs/${encodeURIComponent(id)}?${q(project)}`, { method: 'DELETE' });
  await readJsonResponse(res);
}

export async function vendorPack(project: string, packId: string, urls: readonly string[], duration?: number): Promise<{ item: LibItem; failed: readonly { url: string; error: string }[]; path: string }> {
  return post(`${BASE}/libs/${encodeURIComponent(packId)}/vendor`, { project, urls, ...(duration !== undefined ? { duration } : {}) });
}

// ─── §5.13 (V) 37-2 시작 화면 재료 ───

/** 소재 아닌 재료(CSV·표·JSON·글·SVG)를 프로젝트 안에 둔다 — 돌려받은 경로를 에이전트에게 알린다. */
export async function uploadMaterial(project: string, file: File): Promise<string> {
  const res = await fetch(`${BASE}/materials?${q(project)}&name=${encodeURIComponent(file.name)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Blob([file], { type: 'application/octet-stream' }),
  });
  return (await readJsonResponse<{ path: string }>(res)).path;
}
