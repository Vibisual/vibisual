/**
 * §5.13 (P) — 내부 앱의 서버 자리(코어는 `mountAppRoutes(app)` 만 안다). 앱 모듈을 정적 import 하지 마라 — 부팅과 함께 메모리에 올라간다.
 * 첫 요청 때 늦게 불러온다(§5.13 (H)). 앱은 코어를 import 하지 않는다 — `AppServerHost` 가 유일한 접촉면(§5.13 (P) 도킹 계약).
 */
import type { Express, RequestHandler, Router } from 'express';
import { APP_API_PREFIX, LOOPBACK_REQUEST_MAX_BYTES, type AppEventPayload, type CreationValue, type CreationLink } from '@vibisual/shared';
import { Router as makeRouter, json } from 'express';
import type { CreationStore } from './creationStore.js';

import { broadcast } from '../broadcastBus.js';
import { logger } from '../logger.js';
import { graphManager } from './projectGraphManager.js';
import { atomicWriteFileSync } from './statePersistence.js';
import { resolveWorkspacePath } from './workspaceExplorer.js';

/**
 * §5.13 (T-11) ① — 서버 몫이 같은 앱의 main 몫을 부르는 함수(한 프로세스 §3.7 — 소켓·IPC 없음). 데스크톱 main 이 부팅 때 `setAppMainInvoker` 로 주입한다.
 * 앱 이름은 모른다(`makeHost(appId)` 가 묶는다).
 */
export type AppMainInvoker = (appId: string, action: string, payload: unknown) => Promise<unknown>;
let appMainInvoker: AppMainInvoker | null = null;

export function setAppMainInvoker(fn: AppMainInvoker | null): void {
  appMainInvoker = fn;
}

/**
 * §5.13 (R-10) — 편집 원본 저장소는 **한 벌**이다. 원본 라우트와 앱의 색인 동기화(`syncCreationSource`)가 같은
 * 인스턴스를 쓴다(정리 예약·진행 중 정리가 둘로 갈리지 않게). 처음 부를 때 늦게 불러온다.
 */
let creationStore: Promise<CreationStore> | null = null;
function sharedCreationStore(): Promise<CreationStore> {
  creationStore ??= import('./creationStore.js').then(({ CreationStore }) => new CreationStore(makeHost('creation')));
  return creationStore;
}

/** 앱에게 건네는 호스트. 앱이 코어에 닿는 유일한 통로다. */
function makeHost(appId: string): {
  resolveProjectPath(raw: unknown): string | null;
  resolveWorkspacePath(root: string, relativePath: string): { abs: string; rel: string } | null;
  atomicWriteFile(filePath: string, data: string): void;
  info(message: string): void;
  warn(message: string): void;
  invokeMain(action: string, payload?: unknown): Promise<unknown>;
  notify(event: Omit<AppEventPayload, 'appId'>): void;
  getCreationStore(): Promise<CreationStore>;
  syncCreationSource(
    project: string,
    input: { key: string; appId: string; title: string; payload?: CreationValue; links: CreationLink[] },
  ): Promise<{ id: string; revision: number } | null>;
} {
  return {
    getCreationStore: sharedCreationStore,
    // §5.13 (Y) 40-7 ② — 앱 서버 몫의 알림을 기존 방송 한 줄로 나른다(새 통로 ❌). 코어는 뜻을 모른다 — 앱 id 만 붙인다.
    notify: (event) => {
      const payload: AppEventPayload = { ...event, appId };
      broadcast({ type: 'app_event', timestamp: Date.now(), payload });
    },
    syncCreationSource: async (project, input) => (await sharedCreationStore()).sync(project, input),
    // main 이 없는 실행 형태(시험 등)면 거절한다 — 부르는 앱이 그 사실을 이유로 남긴다.
    invokeMain: (action, payload) => (appMainInvoker
      ? appMainInvoker(appId, action, payload)
      : Promise.reject(new Error('main process bridge unavailable'))),
    resolveProjectPath(raw: unknown): string | null {
      if (typeof raw !== 'string' || raw.length === 0) return null;
      const byName = graphManager.getProjectByName(raw);
      if (byName?.path) return byName.path;
      // 절대 경로를 그대로 준 경우 — 등록된 프로젝트인지 확인한 뒤에만 받아들인다.
      for (const info of Object.values(graphManager.getProjects())) {
        if (info.path === raw) return info.path;
      }
      return null;
    },
    atomicWriteFile: atomicWriteFileSync,
    resolveWorkspacePath,
    info: (m) => logger.info(m),
    warn: (m) => logger.warn(m),
  };
}

interface ServerAppEntry {
  readonly id: string;
  /** 이 앱의 REST 앞머리 — 반드시 `${APP_API_PREFIX}/<id>`. 코어가 앱 이름을 몰라도 판정되게. */
  readonly apiPrefix: string;
  /** Parse before the server's small default JSON parser; declared by each app, not in core branches. */
  readonly jsonLimit?: string | number;
  /** 앱의 서버 몫. **호출 전까지 로드되지 않는다.** */
  readonly load: () => Promise<LoadedAppModule>;
}

type AppHost = ReturnType<typeof makeHost>;

interface LoadedAppModule {
  mountRoutes: (app: Express, host: AppHost) => void;
  /**
   * §5.13 (Y) 40-1 — 앱 **미디어** 요청(`/api/app/<id>/media?…`)이 가리키는 파일의 절대 경로. 그 앱의 경로 규칙으로 검사해
   * 프로젝트 밖·없는 파일이면 null. 운반(구간·흘려 보내기)은 코어가 한다 — 앱은 "어느 파일인가"만 답한다.
   */
  resolveMedia?: (host: AppHost, query: URLSearchParams) => string | null | Promise<string | null>;
}

const SERVER_APPS: readonly ServerAppEntry[] = [
  {
    id: 'creation',
    apiPrefix: `${APP_API_PREFIX}/creation`,
    // 외부 에이전트 본문이 지나는 loopback 상한과 같은 값 — 둘이 어긋나면 한쪽 약속이 거짓이 된다.
    jsonLimit: LOOPBACK_REQUEST_MAX_BYTES,
    load: async () => {
      const [{ mountCreationRoutes }, store] = await Promise.all([import('./creationRoutes.js'), sharedCreationStore()]);
      return { mountRoutes: (app, host) => mountCreationRoutes(app, host, store) };
    },
  },
  {
    id: 'vibisound',
    apiPrefix: `${APP_API_PREFIX}/vibisound`,
    load: async () => ({ mountRoutes: (await import('@vibisual/audio/server')).mountAudioRoutes }),
  },
  {
    id: 'vibistudio',
    apiPrefix: `${APP_API_PREFIX}/vibistudio`,
    // §5.13 (Y) 40-7 ⑥ — 장면 대표 프레임 보고(data URL JSON)가 기본 상한(100KB)에 걸려 413 이 났다(장면 9개 안팎부터).
    jsonLimit: '16mb',
    load: async () => {
      const mod = await import('@vibisual/video/server');
      return { mountRoutes: mod.mountVideoRoutes, resolveMedia: mod.resolveVideoMedia };
    },
  },
  {
    id: 'vibi3d',
    apiPrefix: `${APP_API_PREFIX}/vibi3d`,
    load: async () => ({ mountRoutes: (await import('./vibi3dRoutes.js')).mountVibi3DRoutes }),
  },
];

export function mountAppBodyParsers(app: Express): void {
  for (const entry of SERVER_APPS) {
    if (entry.jsonLimit) app.use(entry.apiPrefix, json({ limit: entry.jsonLimit }));
  }
}

/** §5.13 (H) — 설치 게이트는 없다(앱은 프로젝트에 기본 귀속 — "먼저 설치하라" 409 를 만들지 않는다). 그래도 앱 코드는 첫 요청 때 늦게(`lazy`) 올라온다. */

/** 불러온 앱 하나 — 라우터와 미디어 해석기가 **같은 모듈·같은 호스트**를 쓴다(두 벌로 불러오지 않는다). */
interface LoadedApp {
  readonly router: Router;
  readonly host: AppHost;
  readonly mod: LoadedAppModule;
}

const loadedApps = new Map<string, Promise<LoadedApp>>();

/**
 * 앱 서버 몫을 **처음 부를 때 한 번만** 불러온다(라우트의 첫 요청이든 미디어의 첫 요청이든). 실패하면 다음 요청이 다시 시도한다
 * (조용히 굳지 않게).
 */
function loadApp(entry: ServerAppEntry): Promise<LoadedApp> {
  let loading = loadedApps.get(entry.id);
  if (!loading) {
    loading = (async () => {
      const mod = await entry.load();
      const router = makeRouter();
      const host = makeHost(entry.id);
      // 앱은 Express 앱처럼 생긴 것에 라우트를 건다 — 라우터가 그 역할을 한다.
      mod.mountRoutes(router as unknown as Express, host);
      logger.info(`[apps] ${entry.id} 서버 몫을 이제야 불러왔습니다 (${entry.apiPrefix}).`);
      return { router, host, mod };
    })();
    loadedApps.set(entry.id, loading);
    loading.catch(() => { if (loadedApps.get(entry.id) === loading) loadedApps.delete(entry.id); });
  }
  return loading;
}

/**
 * §5.13 (Y) 40-1 — 앱 미디어 요청이 가리키는 파일(절대 경로). 그 앱이 해석기를 내지 않았거나 경로 검사에서 떨어지면 null.
 * 데스크톱 main 의 vibproxy 미디어 갈래가 부른다 — **앱 이름을 모른 채** 경로 모양에서 뽑은 id 로 묻는다.
 */
export async function resolveAppMediaFile(appId: string, query: URLSearchParams): Promise<string | null> {
  const entry = SERVER_APPS.find((e) => e.id === appId);
  if (!entry) return null;
  try {
    const app = await loadApp(entry);
    return app.mod.resolveMedia ? await app.mod.resolveMedia(app.host, query) : null;
  } catch (err) {
    logger.warn(`[apps] ${appId} 미디어 해석 실패: ${String(err)}`);
    return null;
  }
}

export function mountAppRoutes(app: Express): void {
  for (const entry of SERVER_APPS) {
    /** 첫 요청에 앱을 불러온다 — 부르지 않은 앱은 메모리에 올리지 않는다(§5.13 (H)). */
    let loaded: Router | null = null;

    const lazy: RequestHandler = (req, res, next) => {
      if (loaded) {
        loaded(req, res, next);
        return;
      }
      loadApp(entry)
        .then((ready) => {
          loaded = ready.router;
          ready.router(req, res, next);
        })
        .catch((err: unknown) => {
          logger.warn(`[apps] ${entry.id} 로드 실패: ${String(err)}`);
          res.status(500).json({ ok: false, error: 'app failed to load', appId: entry.id });
        });
    };

    app.use(entry.apiPrefix, lazy);
    logger.info(`[apps] ${entry.apiPrefix} 대기 (${entry.id}) — 코드는 첫 요청 때 로드`);
  }
}
