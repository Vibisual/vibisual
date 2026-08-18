/**
 * §5.11 v4.27 — 서버 기여 배럴.
 *
 * **이 배열은 비어 있다 — 다만 "전부 `clientOnly` 라서"는 아니다.**
 * v4.59 이후 111종은 하나도 `clientOnly` 가 아니다(전부 `agentPrompt` 로 집행한다). 그 집행은
 * 라우트가 아니라 프롬프트 조립이라 다른 배럴(`prompt.ts`)을 탄다. 여기 실릴 것은 **자기 REST 라우트가
 * 필요한 카드**뿐이고, 그런 카드가 아직 없다는 뜻이다.
 *
 * 그래도 배선(`mountPluginRoutes`)은 세워 둔다 — 첫 서버 기여 플러그인이 들어올 때 코어
 * (`server/src/index.ts`)를 다시 열지 않게 하는 것이 이 층의 목적이기 때문이다.
 *
 * ⚠ 온/오프 관문(`requirePluginEnabled`)은 v4.67 부터 **실제로 돈다** — `ssot-drift` 의 설정 창구가
 * 그것을 통과하는 첫 경로다. 다만 그 라우트는 이 배럴이 아니라 호스트(`server/src/services/pluginHost.ts`)
 * 안에 손으로 붙어 있다. 즉 "코어를 다시 열지 않는다"는 이 층의 목적은 아직 한 번도 지켜지지 않았고,
 * 그 카드 폴더를 다른 앱에 복사해도 서버 쪽은 따라가지 않는다. 두 번째 서버 기여 카드를 만드는 사람은
 * 그 라우트를 여기로 옮길지부터 정하는 편이 낫다.
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
