/**
 * §5.13 Vibistudio — 서버 진입점(코어는 `mountVideoRoutes(app)` 한 줄만 안다). 서비스·공용 저장소는 `videoService.ts` 에, 경로는 기능별
 * `*Routes.ts` 에 있고 여기서는 등록 순서대로 붙이기만 한다 — 겹치는 패턴의 매칭은 이 순서가 정한다.
 */
import type { Express } from 'express';
import type { AppServerHost } from '../host.js';
import type { AppAgentLink } from '@vibisual/shared';
import { VIDEO_AGENT_TOOL_RULE, videoLinkDenyReason, videoLinkPointer } from '../agentLink.js';
import { mountHistoryRoutes } from './historyRoutes.js';
import { mountSceneRoutes } from './sceneRoutes.js';
import { mountNotesRoutes } from './notesRoutes.js';
import { mountStyleRoutes } from './styleRoutes.js';
import { mountPartsRoutes } from './partsRoutes.js';
import { mountLibsRoutes } from './libsRoutes.js';
import { mountExportRoutes } from './exportRoutes.js';
import { attachHost, h, videoService, videoHistory, videoActivity, videoNotes, exportStore, versionBook, ensureVersionRefresher } from './videoService.js';
import { mountGuideRoutes } from './guideRoutes.js';
import { mountDocRoutes, createStyledDoc, DEFAULT_DOC_TITLE } from './docRoutes.js';
import { mountAssetRoutes } from './assetRoutes.js';
import { mountCompositionRoutes } from './compositionRoutes.js';
import { mountSourceRoutes } from './sourceRoutes.js';
import { mountPreviewRoutes } from './previewRoutes.js';
import { mountPosterRoutes } from './posterRoutes.js';
import { mountSelfCheckRoutes } from './selfCheckRoutes.js';
import { mountDocToolsRoutes } from './docToolsRoutes.js';
import { mountJobRoutes } from './jobRoutes.js';
import { mountRenderCacheRoutes } from './renderCacheRoutes.js';

export {
  VERSION_REFRESH_MS,
  VERSION_WATCH_MS,
  __stopVersionRefresherForTest,
  exportStore,
  refreshWatchedCompositions,
  renderOutputRange,
  resolveVideoMedia,
  versionBook,
  videoActivity,
  videoHistory,
  videoNotes,
  videoService,
} from './videoService.js';
export type { CueOutcome, RenderEnqueueExtra, VideoJob, VideoJobKind, VideoJobLane, VideoJobStatus } from './videoService.js';

/** 프로젝트 해소는 호스트가 한다 — 앱은 프로젝트가 무엇인지 모른다. */
function resolveProjectPath(raw: unknown): string | null {
  return h().resolveProjectPath(raw);
}

/** §5.4 #36 (C) — 연결 강제 선언. 코어는 앱 이름 없이 이것만 부른다. */
export const videoAgentLink: AppAgentLink<AppServerHost> = {
  rule: VIDEO_AGENT_TOOL_RULE,
  ensureRef(serverHost, projectName, node) {
    const projectPath = serverHost.resolveProjectPath(projectName);
    return projectPath ? createStyledDoc(videoService, projectPath, node.title?.trim() || DEFAULT_DOC_TITLE).id : null;
  },
  pointer: videoLinkPointer,
  denyReason: videoLinkDenyReason,
};

export function mountVideoRoutes(app: Express, serverHost: AppServerHost): void {
  attachHost(serverHost);
  /** 공통 — 프로젝트를 못 찾으면 404. */
  const project = (raw: unknown): string | null => {
    const p = resolveProjectPath(raw);
    // §5.13 (AA) 42-6 — 그 프로젝트가 이 앱에 처음 닿을 때 렌더 대기열을 되살린다(한 번만).
    if (p) videoService.ensureQueueLoaded(p);
    return p;
  };

  mountGuideRoutes(app);

  // ─── §5.13 (V) 37-3 판 기록·바퀴 보고 ───
  mountHistoryRoutes(app, {
    project,
    readDoc: (p, docId) => videoService.readDoc(p, docId),
    writeDoc: (p, doc) => videoService.writeDoc(p, doc),
    requestStill: (p, docId, t, opts) => videoService.requestStill(p, docId, t, opts),
    history: videoHistory,
    activity: videoActivity,
    // §5.13 (V) 37-7 — 바퀴 보고가 고쳤다고 적은 메모를 '고침'으로.
    onNotesFixed: (p, docId, noteIds, passId) => { videoNotes.markFixed(p, docId, noteIds, passId); },
  });

  // ─── §5.13 (V) 37-23 장면 단위 받기·되돌리기 ───
  mountSceneRoutes(app, { project, service: videoService, history: videoHistory });

  // ─── §5.13 (V) 37-7 메모 핀 ───
  mountNotesRoutes(app, {
    project,
    docExists: (p, docId) => videoService.readDoc(p, docId) !== null,
    notes: videoNotes,
  });

  // ─── §5.13 (V) 37-10 스타일 카드 ───
  mountStyleRoutes(app, { project, host: () => h() });

  // ─── §5.13 (T-6)(T-10)(V) 37-11 가져오기 ───
  mountLibsRoutes(app, { project, host: () => h() });

  // ─── §5.13 (V) 37-11 부품 서랍 ───
  mountPartsRoutes(app, {
    project,
    readDoc: (p, docId) => videoService.readDoc(p, docId),
    writeDoc: (p, doc) => videoService.writeDoc(p, doc),
    patchFresh: (p, docId, build) => videoService.patchFresh(p, docId, build),
    requestStill: (p, docId, t, opts) => videoService.requestStill(p, docId, t, opts),
    atomicWriteFile: (file, data) => h().atomicWriteFile(file, data),
    warn: (message) => h().warn(message),
  });

  // ─── 문서 ───
  mountDocRoutes(app, { project, host: () => h(), service: videoService, history: videoHistory, activity: videoActivity, versions: versionBook, ensureVersionRefresher });
  mountAssetRoutes(app, { project, host: () => h() });

  // ─── §5.13 (T) 코드 컴포지션 ───
  mountCompositionRoutes(app, { project, host: () => h(), service: videoService, history: videoHistory, versions: versionBook });
  // §5.13 (V) 37-20 — 읽기 전용 코드 보기의 원본(쓰는 길 없음).
  mountSourceRoutes(app, { project, service: videoService });

  // ─── 스틸 · 프레임 띠 · 렌더 ───
  mountPreviewRoutes(app, { project, host: () => h(), service: videoService });
  // §5.13 (V) 37-1 — 문서 갤러리 포스터(대표 프레임 디스크 기억을 다시 쓰고, 없으면 한 장만 배경으로 굽는다).
  mountPosterRoutes(app, { project, service: videoService, versions: versionBook });
  // §5.13 (G) 스스로 판정할 재료 — 전후 비교 · 배치 요약 · 검수 점수(같은 일꾼 일감 + 순수 함수).
  mountSelfCheckRoutes(app, { project, host: () => h(), service: videoService, history: videoHistory });
  mountDocToolsRoutes(app, { project, service: videoService });
  mountJobRoutes(app, { project, service: videoService });
  // §5.13 (E-7)(E-9) 렌더 구간 캐시(일꾼 전용).
  mountRenderCacheRoutes(app, { project, service: videoService });

  // ─── §5.13 (AA) 42 내보내기 설정·렌더 대기열 ───
  mountExportRoutes(app, {
    project,
    store: exportStore,
    controlJob: (jobId, action) => videoService.controlJob(jobId, action),
    controlQueue: (p, action) => videoService.controlQueue(p, action),
  });

  h().info('[video] Vibistudio 라우트를 마운트했습니다.');
}
