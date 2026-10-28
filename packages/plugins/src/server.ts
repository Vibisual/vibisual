/**
 * §5.11 — 서버 기여 배럴: 자기 REST 라우트가 필요한 카드만 싣는다(집행은 프롬프트 조립이라 `prompt.ts`).
 * 배선(`mountPluginRoutes`)이 여기 있어 서버 기여를 더할 때 코어(`server/src/index.ts`)를 다시 열지 않는다.
 * 라우트는 카드 폴더 `server.ts` 에 둔다 — 호스트 코어(`pluginHost.ts`)에 손으로 붙이면 폴더를 복사할 때 서버 쪽이 남는다.
 */
import type { PluginServerModule } from './types.js';
import { getPluginManifest } from './registry.js';
import { routes as ssotDriftRoutes, SSOT_DRIFT_ID } from './ssot-drift/server.js';

/**
 * 매니페스트는 **등록부에서 꺼낸다** — 카드 모듈(`index.tsx`)을 직접 물면 서버가 라우트 하나 붙이려고
 * React 를 끌어온다(집행 배럴 `prompt.ts` 가 같은 이유로 id 만 문자열로 든다).
 */
function serverModule(id: string, routes: PluginServerModule['routes']): PluginServerModule {
  const manifest = getPluginManifest(id);
  if (!manifest) throw new Error(`[plugins] server module for unknown plugin: ${id}`);
  return { manifest, routes };
}

export const PLUGIN_SERVER_MODULES: readonly PluginServerModule[] = [
  serverModule(SSOT_DRIFT_ID, ssotDriftRoutes),
];
