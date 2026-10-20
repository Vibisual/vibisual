import { readJsonResponse as json } from '../Creation/videoDocumentApi.js';
import type { DocEnvelope } from '../Creation/videoDocumentApi.js';
export { createDoc, patchDoc, importVideoAsset, readJsonResponse, VersionConflictError } from '../Creation/videoDocumentApi.js';
export type { DocEnvelope } from '../Creation/videoDocumentApi.js';
/**
 * §5.13 Vibistudio — 클라이언트 REST 얇은 층.
 *
 * 호출을 한 곳에 모으는 이유는 **낙관적 잠금 규약을 한 군데서만 지키면 되게** 하기
 * 위해서다. 화면 여러 곳이 각자 patch 를 만들면 `baseVersion` 을 빠뜨리는 자리가
 * 생기고, 그때부터는 저장이 조용히 서로를 덮는다.
 */

import type {
  CompositionLintEntry,
  CompositionPropDecl,
  CompositionSeekMode,
  DocActivity,
  ExportPreset,
  ExportSettings,
  RenderOutputSpec,
  RenderSpec,
  VideoAsset,
  VideoDoc,
} from '@vibisual/video';
// React 밖에서 문구를 고르는 통로 — `hooks/useWebSocket.ts` 와 같은 방식이다. 여기서 던지는
// 오류는 `<pre>{error}</pre>` 로 **그대로 화면에 찍히므로** 사용자의 언어여야 한다.
import i18n from '../../i18n/index.js';



export interface DocSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
  readonly version: number;
  /** §5.13 (AA) 42-4 — 문서 크기(판형). 옛 서버면 없다. */
  readonly width?: number;
  readonly height?: number;
}

export type VideoJobStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled';

export interface VideoJob {
  readonly id: string;
  /**
   * §5.13 (V) 37-9 — `review` = 프레임 검수 표본. §5.13 (T-8) — `cues` = 표지 모으기(렌더 줄). §5.13 (X) 39-4 — `stills` = 여러
   * 시각을 한 무대에서 차례로 찍은 그림 목록(JSON).
   */
  readonly kind: 'render' | 'still' | 'strip' | 'review' | 'cues' | 'stills';
  readonly projectPath: string;
  readonly docId: string;
  readonly status: VideoJobStatus;
  readonly progress: number;
  readonly result?: string;
  readonly error?: string;
  readonly note?: string;
  readonly t?: number;
  /** §5.13 (T-9) `strip` — 찍을 시각들(초). */
  readonly times?: readonly number[];
  /** `still`·`strip` — 결과 한 변 상한(px). 0 이면 문서 원본 크기. */
  readonly maxEdge?: number;
  /** §5.13 (V) 37-3 — 판 기록의 한 판을 찍는 일감이면 그 판. */
  readonly revId?: string;
  /** §5.13 (T-8) `cues` — 표지를 모을 컴포지션 소재. */
  readonly assetId?: string;
  /** §5.13 (T-8) — 렌더가 표지 모으기를 먼저 기다리는 중이면 `cues`. */
  readonly waitingFor?: 'cues';
  /** §5.13 (V) 37-15 — 자막 따로 내기(자막 트랙을 숨기고 렌더). */
  readonly hideCaptions?: boolean;
  /** §5.13 (T-8) — 표지를 다시 모으지 못해 예전 표지 시각으로 그렸다. */
  readonly cuesFailed?: boolean;
  /** §5.13 (W) 38-3 — 투명 배경 렌더(WebM + 알파). */
  readonly transparent?: boolean;
  /** §5.13 (W) 38-7 — `still` 이 장면 정지 화면이면 그 장면 id(그 컴포지션 하나짜리 문서로 그린다). */
  readonly frameOf?: string;
  /** §5.13 (X) 39-4 — `stills` 의 그림 형식(없으면 png). */
  readonly imageType?: 'png' | 'webp';
  /** §5.13 (AA) 42-5 — 대기열 칸(서버 `VideoJob` 과 같은 이름). */
  readonly order?: number;
  readonly held?: boolean;
  readonly heldReason?: 'user' | 'missed' | 'interrupted';
  readonly notBefore?: number;
  readonly paused?: boolean;
  readonly pausedAt?: number;
  readonly pausedMs?: number;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly frame?: number;
  readonly totalFrames?: number;
  readonly spec?: RenderSpec;
  readonly output?: RenderOutputSpec;
  readonly title?: string;
  readonly label?: string;
  readonly exported?: string;
  readonly exportNote?: { readonly code: 'export-failed' | 'overwrite-fallback'; readonly detail?: string };
  readonly delivered?: boolean;
  readonly createdAt?: number;
}

/** §5.13 (AA) 42-5 — 일감 하나에 거는 조작 · 줄 전체에 거는 조작(서버 `renderQueue.ts` 와 같은 이름). */
export type RenderJobAction = 'pause' | 'resume' | 'cancel' | 'start-now' | 'hold' | 'move-up' | 'move-down' | 'delivered';
export type RenderQueueAction = 'start-all' | 'hold-all' | 'cancel-all' | 'clear-finished';

/** §5.13 (AA) 42 — 렌더를 거는 방법. 아무것도 없으면 종전 렌더(기본 자리 · 지금). */
export interface RenderRequest {
  readonly captions?: 'burn' | 'separate';
  readonly transparent?: boolean;
  readonly spec?: RenderSpec;
  readonly output?: RenderOutputSpec;
  /** `hold` = 대기열에 멈춘 채 · `at` = 예약 시각(ms). */
  readonly schedule?: { readonly at?: number; readonly hold?: boolean };
  readonly label?: string;
}

/** §5.13 (AA) 42-1 — 마지막 설정 + 내 프리셋. */
export interface ExportSettingsEnvelope {
  readonly last: ExportSettings;
  readonly presets: readonly ExportPreset[];
}

/**
 * §5.13 (X) 39-4 — 장면 대표 프레임 한 번에. 디스크에 남은 것은 바로 오고(`thumbs` — 열쇠 → 그림), `render` 면 빠진 것을 일감 하나로
 * 묶어 굽고 남긴 뒤 함께 온다. 열쇠는 `chapterThumbWants` 와 같다. `missing` 은 그래도 없는 열쇠.
 */
export async function fetchChapterThumbs(project: string, docId: string, render: boolean): Promise<{ thumbs: Record<string, string>; missing: string[] }> {
  const q = `project=${encodeURIComponent(project)}${render ? '&render=1' : ''}`;
  const res = await fetch(`/api/app/vibistudio/doc/${encodeURIComponent(docId)}/chapter-thumbs?${q}`);
  const body = await json<{ thumbs?: Record<string, string>; missing?: string[] }>(res);
  return { thumbs: body.thumbs ?? {}, missing: body.missing ?? [] };
}

/** §5.13 (T-8) — 표지 모으기 한 벌의 끝(서버 `CueOutcome`). */
export interface CueOutcome {
  readonly assetId: string;
  readonly ok: boolean;
  readonly cues?: readonly { name: string; t: number }[];
  readonly docVersion?: number;
  readonly error?: string;
}

/**
 * §5.13 (T-8) — 표지를 지금 모은다(끝날 때까지 기다린다). `assetId` 를 주면 그 컴포지션만, `all` 이면 표지를 부르는 컴포지션 전부를
 * 다시(낡지 않았어도), 둘 다 없으면 낡은 것만.
 */
export async function collectCues(project: string, docId: string, opts: { assetId?: string; all?: boolean } = {}): Promise<CueOutcome[]> {
  const res = await fetch(`/api/app/vibistudio/doc/${encodeURIComponent(docId)}/cues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, ...(opts.assetId === undefined ? {} : { assetId: opts.assetId }), ...(opts.all === true ? { all: true } : {}) }),
  });
  const body = await json<{ results?: CueOutcome[] }>(res);
  return body.results ?? [];
}

/** §5.13 (V) 37-12 — 화면이 잰 비트를 그 소재에 얹는다(서버가 최신 문서에 그 칸만 — 되돌리기 이력 밖). 새 문서를 돌려준다. */
export async function writeBeatFacts(
  project: string,
  docId: string,
  assetId: string,
  facts: { beats: readonly number[]; beatsStrong: readonly number[]; bpm: number; beatsHash: string },
): Promise<VideoDoc> {
  const res = await fetch(`/api/app/vibistudio/doc/${encodeURIComponent(docId)}/asset-facts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, assetId, facts }),
  });
  const body = await json<{ doc: VideoDoc }>(res);
  return body.doc;
}

/** §5.13 (V) 37-15 — 판형 파생 문서(`<docId>-<판형>` — 있으면 그것). */
export async function deriveDoc(project: string, docId: string, format: 'landscape' | 'portrait' | 'square'): Promise<{ doc: VideoDoc; created: boolean }> {
  const res = await fetch(`/api/app/vibistudio/doc/${encodeURIComponent(docId)}/derive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, format }),
  });
  return json<{ doc: VideoDoc; created: boolean }>(res);
}

/** §5.13 (T-4) — 일감 두 줄. 스틸·프레임 띠는 렌더 뒤에 줄 서지 않는다. */
export type VideoJobLane = 'still' | 'render';

export async function listDocs(project: string): Promise<DocSummary[]> {
  const res = await fetch(`/api/app/vibistudio/docs?project=${encodeURIComponent(project)}`);
  const body = await json<{ docs: DocSummary[] }>(res);
  return body.docs;
}

export async function readDoc(project: string, docId: string): Promise<DocEnvelope> {
  const res = await fetch(`/api/app/vibistudio/doc/${encodeURIComponent(docId)}?project=${encodeURIComponent(project)}`);
  return json<DocEnvelope>(res);
}

/**
 * `captions: 'separate'` — 자막 트랙을 숨기고 렌더한다(§5.13 (V) 37-15 자막 따로 내기). §5.13 (AA) 42 — `spec`·`output`·`schedule`
 * 을 실으면 대기열의 한 줄이 된다(저장 위치·이름·예약·멈춤).
 */
export async function startRender(project: string, docId: string, opts: RenderRequest = {}): Promise<VideoJob> {
  const res = await fetch(`/api/app/vibistudio/doc/${encodeURIComponent(docId)}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // §5.13 (W) 38-3 — 투명 배경(WebM)은 따로 싣는다.
    body: JSON.stringify({
      project,
      ...(opts.captions === 'separate' ? { captions: 'separate' } : {}),
      ...(opts.transparent === true ? { transparent: true } : {}),
      ...(opts.spec ? { spec: opts.spec } : {}),
      ...(opts.output ? { output: opts.output } : {}),
      ...(opts.schedule ? { schedule: opts.schedule } : {}),
      ...(opts.label ? { label: opts.label } : {}),
    }),
  });
  const body = await json<{ job: VideoJob }>(res);
  return body.job;
}

export async function getJob(jobId: string): Promise<VideoJob> {
  const res = await fetch(`/api/app/vibistudio/job/${encodeURIComponent(jobId)}`);
  const body = await json<{ job: VideoJob }>(res);
  return body.job;
}

/** §5.13 (AA) 42-5 — 이 프로젝트의 렌더 대기열(끝난 기록 포함). */
export async function listRenderJobs(project: string): Promise<VideoJob[]> {
  const res = await fetch(`/api/app/vibistudio/jobs?project=${encodeURIComponent(project)}&kind=render`);
  const body = await json<{ jobs: VideoJob[] }>(res);
  return body.jobs;
}

export async function controlRenderJob(jobId: string, action: RenderJobAction): Promise<VideoJob> {
  const res = await fetch(`/api/app/vibistudio/job/${encodeURIComponent(jobId)}/control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
  });
  return (await json<{ job: VideoJob }>(res)).job;
}

export async function controlRenderQueue(project: string, action: RenderQueueAction): Promise<number> {
  const res = await fetch('/api/app/vibistudio/jobs/control', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, action }),
  });
  return (await json<{ changed: number }>(res)).changed;
}

/** §5.13 (AA) 42-1 — 마지막 내보내기 설정·내 프리셋. */
export async function readExportSettings(project: string): Promise<ExportSettingsEnvelope> {
  const res = await fetch(`/api/app/vibistudio/export-settings?project=${encodeURIComponent(project)}`);
  const body = await json<ExportSettingsEnvelope>(res);
  return { last: body.last, presets: body.presets };
}

export async function saveExportSettings(project: string, settings: ExportSettings): Promise<void> {
  const res = await fetch('/api/app/vibistudio/export-settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, settings }),
  });
  await json(res);
}

export async function saveExportPreset(project: string, name: string, settings: ExportSettings): Promise<ExportSettingsEnvelope> {
  const res = await fetch('/api/app/vibistudio/export-presets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, name, settings }),
  });
  const body = await json<ExportSettingsEnvelope>(res);
  return { last: body.last, presets: body.presets };
}

export async function deleteExportPreset(project: string, presetId: string): Promise<ExportSettingsEnvelope> {
  const res = await fetch(`/api/app/vibistudio/export-presets/${encodeURIComponent(presetId)}?project=${encodeURIComponent(project)}`, { method: 'DELETE' });
  const body = await json<ExportSettingsEnvelope>(res);
  return { last: body.last, presets: body.presets };
}

/** 일꾼이 다음 일감을 가져간다. 없으면 null. `lane` 을 주면 그 줄만(§5.13 (T-4)). */
export async function claimJob(project?: string, lane?: VideoJobLane): Promise<VideoJob | null> {
  const res = await fetch('/api/app/vibistudio/jobs/claim', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, lane }),
  });
  const body = await json<{ job: VideoJob | null }>(res);
  return body.job;
}

/** §5.13 (T-7) — 문서의 판본만(에이전트가 고친 것을 저절로 다시 읽으려고 몇 초마다 묻는다). */
export interface DocVersion {
  readonly id: string;
  readonly title: string;
  readonly version: number;
  readonly updatedAt: number;
  readonly duration: number;
  /** §5.13 (V) 37-3 — 지금 하는 일(바퀴·만지는 장면). */
  readonly activity?: DocActivity | null;
}

export async function readDocVersion(project: string, docId: string): Promise<DocVersion> {
  const res = await fetch(`/api/app/vibistudio/doc/${encodeURIComponent(docId)}/version?project=${encodeURIComponent(project)}`);
  return json<DocVersion>(res);
}

/**
 * 스틸 한 장을 **최종 렌더와 같은 경로**(숨은 일꾼 창)로 받는다 — 컴포지션이 든 문서는 이 길로만 제대로 보인다.
 * `full` 이면 문서 원본 크기(PNG 저장용), 아니면 작은 그림(노드 포스터·확인용).
 */
export async function fetchStillImage(project: string, docId: string, t: number, opts: { full?: boolean } = {}): Promise<string> {
  const q = `project=${encodeURIComponent(project)}&t=${encodeURIComponent(String(t))}&format=dataurl${opts.full ? '&full=1' : ''}`;
  const res = await fetch(`/api/app/vibistudio/doc/${encodeURIComponent(docId)}/still?${q}`);
  const body = await json<{ image?: string }>(res);
  if (!body.image) throw new Error(i18n.t('panel.videoStudio.errRequestFailed', { status: res.status }));
  return body.image;
}

/** §5.13 (W) 38-7 — 장면 정지 화면 한 장(그 장면의 `frame` 컴포지션 — 스틸과 같은 일꾼). */
export async function fetchFrameImage(project: string, docId: string, chapterId: string): Promise<string> {
  const q = `project=${encodeURIComponent(project)}&chapter=${encodeURIComponent(chapterId)}&format=dataurl`;
  const res = await fetch(`/api/app/vibistudio/doc/${encodeURIComponent(docId)}/frame?${q}`);
  const body = await json<{ image?: string }>(res);
  if (!body.image) throw new Error(i18n.t('panel.videoStudio.errRequestFailed', { status: res.status }));
  return body.image;
}

/** §5.13 (T-9) — 프레임 띠(한 아이템 구간을 고르게 찍은 격자 한 장). */
export async function fetchStripImage(project: string, docId: string, itemId: string, count?: number): Promise<{ image: string; times: readonly number[] }> {
  const q = `project=${encodeURIComponent(project)}&item=${encodeURIComponent(itemId)}&format=dataurl${count ? `&count=${count}` : ''}`;
  const res = await fetch(`/api/app/vibistudio/doc/${encodeURIComponent(docId)}/strip?${q}`);
  const body = await json<{ image?: string; times?: number[] }>(res);
  if (!body.image) throw new Error(i18n.t('panel.videoStudio.errRequestFailed', { status: res.status }));
  return { image: body.image, times: body.times ?? [] };
}

/** §5.13 (T-5) — 기본 자리에 컴포지션 뼈대를 만들고(문서를 주면 소재까지 올린다) 경로·소재 id 를 돌려받는다. */
export async function createComposition(
  project: string,
  args: { name: string; docId?: string; title?: string; width?: number; height?: number; duration?: number },
): Promise<{ path: string; assetId?: string }> {
  const res = await fetch('/api/app/vibistudio/composition', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, ...args }),
  });
  return json<{ path: string; assetId?: string }>(res);
}

/** §5.13 (T-5) — 탐침 결과(길이·판형·시각 맞춤 방식·lint·지문). 문서를 주었으면 채운 소재 id·판본도. */
export interface CompositionProbeEnvelope {
  readonly path: string;
  readonly duration?: number;
  readonly width?: number;
  readonly height?: number;
  readonly mode: CompositionSeekMode;
  readonly lint: readonly CompositionLintEntry[];
  readonly contentHash: string;
  /** §5.13 (V) 37-5 — 값 선언(순서 보존). */
  readonly propsDecl?: readonly CompositionPropDecl[];
  /** §5.13 (V) 37-15 — 상자 크기에 맞춰 다시 짜는 컴포지션. */
  readonly responsive?: boolean;
  readonly assetId?: string;
  readonly docVersion?: number;
}

/** §5.13 (T-5) — 탐침(길이·판형·lint·지문). 문서를 주면 그 소재를 채운다. */
export async function probeComposition(
  project: string,
  path: string,
  docId?: string,
  assetId?: string,
): Promise<CompositionProbeEnvelope> {
  const res = await fetch('/api/app/vibistudio/composition/probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, path, docId, assetId }),
  });
  return json<CompositionProbeEnvelope>(res);
}

/**
 * §5.13 (L) — 캔버스 노드에 결과를 담는다(코어의 결과 전달 창구 — 렌더러에서는 IPC 로 닿는다). 렌더한 MP4 를 그 문서에
 * 묶인 노드에 넣어 노드가 바로 재생하게 할 때 쓴다.
 */
export async function deliverToNode(bubbleId: string, body: { file?: string; ref?: string }): Promise<void> {
  const res = await fetch(`/api/app-bubbles/${encodeURIComponent(bubbleId)}/output`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await json(res);
}

export async function reportJob(
  jobId: string,
  patch: { status?: VideoJobStatus; progress?: number; image?: string; bytes?: string; error?: string; note?: string; data?: string; frame?: number; totalFrames?: number },
): Promise<void> {
  const res = await fetch(`/api/app/vibistudio/job/${encodeURIComponent(jobId)}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  await json(res);
}



/** Binary output avoids the server's small JSON body limit and base64 expansion. */
export async function completeRenderJob(jobId: string, bytes: Uint8Array, note: string): Promise<void> {
  await reportJob(jobId, { note });
  const res = await fetch(`/api/app/vibistudio/job/${encodeURIComponent(jobId)}/output`, {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' },
    body: new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }),
  });
  await json(res);
}

export async function completeStillJob(jobId: string, image: string): Promise<void> {
  const png = await (await fetch(image)).blob();
  const res = await fetch(`/api/app/vibistudio/job/${encodeURIComponent(jobId)}/output`, {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' },
    body: new Blob([png], { type: 'application/octet-stream' }),
  });
  await json(res);
}

export { assetUrl } from './assetUrl.js';
