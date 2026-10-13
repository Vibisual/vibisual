/**
 * §5.13 (P) v4.49 — 내부 앱의 서버 자리.
 *
 * 코어(`index.ts`)가 아는 것은 `mountAppRoutes(app)` 한 줄뿐이다.
 *
 * **부르지 않은 앱은 코드조차 로드하지 않는다.** 이게 이 파일의 존재 이유다 — 앱 모듈을 위에서
 * 정적으로 불러오면 그 코드가 서버 부팅과 함께 메모리에 올라가고, 그러면 "안 쓰면 비용이 없다"는
 * 말이 문서에서만 참이 된다. 그래서 여기서는 **경로만 알고 있다가 실제 요청이 처음 들어올 때**
 * 늦게 불러온다(§5.13 (H) 개정 — 이 규율의 주인은 설치 여부가 아니라 첫 요청이다).
 *
 * 앱은 코어를 import 하지 않는다(§5.13 (P) 도킹 계약). 필요한 것은 `AppServerHost` 로
 * 건네주며, 그 인터페이스가 앱과 코어 사이의 유일한 접촉면이다.
 */
import type { Express, RequestHandler, Router } from 'express';
import { APP_API_PREFIX } from '@vibisual/shared';
import { Router as makeRouter } from 'express';

import { logger } from '../logger.js';
import { graphManager } from './projectGraphManager.js';
import { atomicWriteFileSync } from './statePersistence.js';
import { resolveWorkspacePath } from './workspaceExplorer.js';

/**
 * §5.13 (T-11) ① — 서버 몫이 **같은 앱의 main 몫**을 부르는 통로. 데스크톱 main 이 부팅 때 한 번 주입한다
 * (`setAppMainInvoker`). 서버와 main 이 한 프로세스라(§3.7) 새 소켓도 새 IPC 채널도 없다 — 함수 하나다.
 * 앱 이름을 모른다: 어느 앱의 몫인지는 아래 `makeHost(appId)` 가 묶어 준다.
 */
export type AppMainInvoker = (appId: string, action: string, payload: unknown) => Promise<unknown>;
let appMainInvoker: AppMainInvoker | null = null;

export function setAppMainInvoker(fn: AppMainInvoker | null): void {
  appMainInvoker = fn;
}

/** 앱에게 건네는 호스트. 앱이 코어에 닿는 유일한 통로다. */
function makeHost(appId: string): {
  resolveProjectPath(raw: unknown): string | null;
  resolveWorkspacePath(root: string, relativePath: string): { abs: string; rel: string } | null;
  atomicWriteFile(filePath: string, data: string): void;
  info(message: string): void;
  warn(message: string): void;
  invokeMain(action: string, payload?: unknown): Promise<unknown>;
} {
  return {
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
  /** 앱의 서버 몫. **호출 전까지 로드되지 않는다.** */
  readonly load: () => Promise<{
    mountRoutes: (app: Express, host: ReturnType<typeof makeHost>) => void;
  }>;
}

const SERVER_APPS: readonly ServerAppEntry[] = [
  {
    id: 'vibisound',
    apiPrefix: `${APP_API_PREFIX}/vibisound`,
    load: async () => ({ mountRoutes: (await import('@vibisual/audio/server')).mountAudioRoutes }),
  },
  {
    id: 'vibistudio',
    apiPrefix: `${APP_API_PREFIX}/vibistudio`,
    load: async () => ({ mountRoutes: (await import('@vibisual/video/server')).mountVideoRoutes }),
  },
  {
    id: 'vibi3d',
    apiPrefix: `${APP_API_PREFIX}/vibi3d`,
    load: async () => ({ mountRoutes: (await import('./vibi3dRoutes.js')).mountVibi3DRoutes }),
  },
];

/**
 * §5.13 (H) 개정 — **설치 게이트는 없다.**
 *
 * 종전에는 `UserDefaults.installedApps` 를 보고 안 깐 앱의 REST 를 409 로 돌려세웠다. 이제 앱은
 * 프로젝트에 기본으로 귀속되므로 그 판정 자체가 없어졌다 — 사용자가 파일을 눌렀는데 "먼저 설치하라"
 * 는 답이 돌아오는 자리를 만들지 않는다(사용자 지시: "앱설치 빼버리고 기본 우리 프로젝트에 귀속").
 *
 * **그렇다고 앱 코드가 부팅과 함께 올라오지는 않는다** — 늦은 로드(`lazy`)가 그 몫을 그대로 한다.
 * 즉 "안 쓰는 앱은 코드조차 로드하지 않는다"는 규율은 설치가 아니라 **첫 요청**이 지킨다.
 */

export function mountAppRoutes(app: Express): void {
  for (const entry of SERVER_APPS) {
    /**
     * 앱마다 라우터를 하나 세우고, 그 안에서 **처음 통과한 요청에** 앱을 불러온다.
     *
     * 한 번도 부르지 않은 앱의 코드는 프로세스가 사는 동안 메모리에 올라가지 않는다 — 이 규율을
     * 지키는 것은 설치 여부가 아니라 **첫 요청**이다(§5.13 (H) 개정).
     */
    let loaded: Router | null = null;
    let loading: Promise<void> | null = null;

    const lazy: RequestHandler = (req, res, next) => {
      if (loaded) {
        loaded(req, res, next);
        return;
      }
      loading ??= (async () => {
        const mod = await entry.load();
        const router = makeRouter();
        // 앱은 Express 앱처럼 생긴 것에 라우트를 건다 — 라우터가 그 역할을 한다.
        mod.mountRoutes(router as unknown as Express, makeHost(entry.id));
        loaded = router;
        logger.info(`[apps] ${entry.id} 서버 몫을 이제야 불러왔습니다 (${entry.apiPrefix}).`);
      })();

      loading
        .then(() => {
          if (loaded) loaded(req, res, next);
          else next();
        })
        .catch((err: unknown) => {
          loading = null;
          logger.warn(`[apps] ${entry.id} 로드 실패: ${String(err)}`);
          res.status(500).json({ ok: false, error: 'app failed to load', appId: entry.id });
        });
    };

    app.use(entry.apiPrefix, lazy);
    logger.info(`[apps] ${entry.apiPrefix} 대기 (${entry.id}) — 코드는 첫 요청 때 로드`);
  }
}
