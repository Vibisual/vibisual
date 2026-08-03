/**
 * §5.11 v4.27 — 서버 기여 배럴.
 *
 * **등록된 111종이 전부 `clientOnly` 라 이 배열은 비어 있다.** 카드들은 이미 서버가 브로드캐스트해
 * 스토어에 들어온 값을 읽어 판정할 뿐이라, 자기 서버 라우트가 필요한 것이 아직 하나도 없다.
 *
 * 그래도 배선(`mountPluginRoutes`)은 세워 둔다 — 첫 서버 기여 플러그인이 들어올 때 코어
 * (`server/src/index.ts`)를 다시 열지 않게 하는 것이 이 층의 목적이기 때문이다.
 *
 * ⚠ 그 말은 **온/오프 관문(`requirePluginEnabled`)이 아직 한 번도 실행된 적이 없다**는 뜻이기도 하다.
 * 여기에 첫 모듈을 넣는 사람은 `server/src/services/pluginHost.test.ts` 가 그 관문의 행동을 이미
 * 고정해 두었다는 것을 알아 두면 된다(꺼짐 409 · 매 요청 재판정).
 */
import type { PluginServerModule } from './types.js';

export const PLUGIN_SERVER_MODULES: readonly PluginServerModule[] = [];

export function getServerModule(id: string): PluginServerModule | undefined {
  return PLUGIN_SERVER_MODULES.find((m) => m.manifest.id === id);
}
