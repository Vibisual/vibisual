/**
 * §5.11 v3.88 — 플러그인 호스트 (서버).
 *
 * 코어(`index.ts`)는 `mountPluginRoutes(app)` 한 줄만 안다. 플러그인이 늘어도 코어를 다시 열지 않는 것이
 * 이 층의 목적이므로, 지금 등록된 111종이 전부 `clientOnly`(서버 기여 0)라도 배선은 미리 세워 둔다.
 * 따라서 지금 실제로 도는 것은 아래 목록 조회 하나뿐이고, 마운트 반복문은 한 바퀴도 돌지 않는다.
 *
 * **재시작 불필요 설계**: 라우터는 부팅 시 전부 마운트하되 `requirePluginEnabled` 로 감싼다. 비활성이면
 * 409 로 끊기므로, 토글이 즉시 유효해지고 플러그인 코드가 활성 여부를 직접 확인할 필요도 없다.
 */
import type { Express, RequestHandler, Router } from 'express';
import { PLUGIN_API_PREFIX } from '@vibisual/shared';
import { PLUGIN_MANIFESTS, isPluginEnabled, validateRegistry } from '@vibisual/plugins';
import { PLUGIN_SERVER_MODULES } from '@vibisual/plugins/server';
import { userDefaultsService } from './userDefaultsService.js';
import { logger } from '../logger.js';

/** 비활성 플러그인의 라우트를 409 로 끊는 미들웨어. 활성 판정 SSOT 는 `UserDefaults.enabledPlugins`. */
export function requirePluginEnabled(id: string): RequestHandler {
  return (_req, res, next) => {
    if (!isPluginEnabled(id, userDefaultsService.get().enabledPlugins)) {
      res.status(409).json({ ok: false, error: 'plugin disabled', pluginId: id });
      return;
    }
    next();
  };
}

export function mountPluginRoutes(app: Express): void {
  const problems = validateRegistry();
  for (const problem of problems) logger.warn(`[plugins] ${problem}`);

  // 목록 조회 — 활성 상태는 user-defaults 가 SSOT 이므로 여기서는 매니페스트 + 계산된 enabled 만 준다.
  app.get(PLUGIN_API_PREFIX, (_req, res) => {
    const enabled = userDefaultsService.get().enabledPlugins;
    res.json({
      plugins: PLUGIN_MANIFESTS.map((m) => ({ ...m, enabled: isPluginEnabled(m.id, enabled) })),
    });
  });

  for (const mod of PLUGIN_SERVER_MODULES) {
    if (!mod.createRouter) continue;
    const router = mod.createRouter() as Router;
    app.use(`${PLUGIN_API_PREFIX}/${mod.manifest.id}`, requirePluginEnabled(mod.manifest.id), router);
    logger.info(`[plugins] mounted ${PLUGIN_API_PREFIX}/${mod.manifest.id}`);
  }

  logger.info(`[plugins] registry: ${PLUGIN_MANIFESTS.length} manifest(s), ${PLUGIN_SERVER_MODULES.length} server module(s)`);
}
