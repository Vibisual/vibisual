/**
 * §5.13 (P) v4.49 — 내부 앱의 서버 자리.
 *
 * 코어(`index.ts`)가 아는 것은 `mountAppRoutes(app)` 한 줄뿐이다.
 *
 * **안 깐 앱은 코드조차 로드하지 않는다.** 이게 이 파일의 존재 이유다 — 앱 모듈을 위에서
 * `import` 해 버리면 설치 여부와 무관하게 그 코드가 서버 부팅과 함께 메모리에 올라가고,
 * 그러면 "설치"라는 말이 화면에서만 참이 된다. 그래서 여기서는 **경로만 알고 있다가
 * 실제 요청이 처음 들어올 때** 늦게 불러온다.
 *
 * 앱은 코어를 import 하지 않는다(§5.13 (P) 도킹 계약). 필요한 것은 `AppServerHost` 로
 * 건네주며, 그 인터페이스가 앱과 코어 사이의 유일한 접촉면이다.
 */
import type { Express, RequestHandler, Router } from 'express';
import { APP_API_PREFIX } from '@vibisual/shared';
import { Router as makeRouter } from 'express';

import { logger } from '../logger.js';
import { graphManager } from './projectGraphManager.js';
import { userDefaultsService } from './userDefaultsService.js';
import { atomicWriteFileSync } from './statePersistence.js';

/** 앱에게 건네는 호스트. 앱이 코어에 닿는 유일한 통로다. */
function makeHost(): {
  resolveProjectPath(raw: unknown): string | null;
  atomicWriteFile(filePath: string, data: string): void;
  info(message: string): void;
  warn(message: string): void;
} {
  return {
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
    mountVideoRoutes: (app: Express, host: ReturnType<typeof makeHost>) => void;
  }>;
}

const SERVER_APPS: readonly ServerAppEntry[] = [
  {
    id: 'vibistudio',
    apiPrefix: `${APP_API_PREFIX}/vibistudio`,
    load: () => import('@vibisual/video/server'),
  },
];

/**
 * 설치 여부 판정.
 *
 * 클라이언트의 `resolveInstalledApps` 와 **같은 규칙**이어야 한다 — 한쪽만 구 필드를
 * 인정하면 화면과 서버가 다른 답을 낸다.
 */
export function isAppInstalledOnServer(appId: string): boolean {
  const defaults = userDefaultsService.get();
  if ((defaults.installedApps ?? []).includes(appId)) return true;
  // v4.46 이전 필드 — 읽기 전용 하위호환.
  return appId === 'vibistudio' && defaults.videoStudio?.installed === true;
}

export function requireAppInstalled(appId: string): RequestHandler {
  return (_req, res, next) => {
    if (!isAppInstalledOnServer(appId)) {
      // 없는 것(404)이 아니라 **아직 켜지지 않은 것**이라 409.
      res.status(409).json({ ok: false, error: 'app not installed', appId });
      return;
    }
    next();
  };
}

export function mountAppRoutes(app: Express): void {
  for (const entry of SERVER_APPS) {
    /**
     * 앱마다 라우터를 하나 세우고, 그 안에서 **처음 통과한 요청에** 앱을 불러온다.
     *
     * 설치 게이트를 앞에 두므로 안 깐 앱은 여기까지 오지 못하고, 따라서 그 앱의 코드는
     * 프로세스가 사는 동안 한 번도 메모리에 올라가지 않는다.
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
        mod.mountVideoRoutes(router as unknown as Express, makeHost());
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

    app.use(entry.apiPrefix, requireAppInstalled(entry.id), lazy);
    logger.info(`[apps] ${entry.apiPrefix} 게이트 설치 (${entry.id}) — 코드는 첫 요청 때 로드`);
  }
}
