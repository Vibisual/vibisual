/**
 * §5.11 v3.88 — `@vibisual/plugins` 기본 진입점.
 *
 * **React·node 에 의존하지 않는 것만** 여기서 내보낸다(매니페스트·등록부·판정 순수 함수).
 * 클라이언트 기여는 `@vibisual/plugins/client`, 서버 기여는 `@vibisual/plugins/server` 로 분리.
 */
export type {
  PluginTranslate,
  PluginDataNeed,
  PluginAgentData,
  PluginBubbleContext,
  PluginPanelContext,
  PluginSettingsContext,
  PluginActions,
  PluginHeaderContext,
  PluginHeaderItem,
  PluginBubbleBadge,
  PluginPanelSection,
  PluginSeverity,
  PluginClientModule,
  PluginServerModule,
  PluginPromptContext,
  PluginPromptModule,
  PluginFactMap,
  // §5.11 자립 규약 ⑥ — 카드 폴더 안에 사는 REST 창구의 계약(호스트가 구현한다).
  PluginRoute,
  PluginRouteRequest,
  PluginRouteResponse,
  PluginServerHost,
} from './types.js';

export {
  PLUGIN_MANIFESTS,
  PLUGIN_DATA_NEEDS,
  getPluginManifest,
  resolveEnabledPlugins,
  isPluginEnabled,
  selectProjectEnabledList,
  resolveEnabledPluginsFor,
  isPluginEnabledFor,
  withProjectEnabled,
  resolveProjectKey,
  unsupportedContributions,
  validateRegistry,
} from './registry.js';
export type { PluginEnablementSource } from './registry.js';

// §5.11 v4.57 — SSOT 집행 판정. 순수 함수라 fs 없이 단독 검증된다(`ssot.test.ts`).
export {
  surveySsot,
  surveySsotFacts,
  buildSsotPromptBlock,
  readSsotConfig,
  resolveCandidates,
  hasSubstance,
  SSOT_DOC_CANDIDATES,
  RIVAL_DIRECTION_SOURCES,
  // v4.67 — 프로젝트가 자기 SSOT 를 지정하는 파일. 호스트가 그 파일을 **써 주는** 창구를 열려면
  //   경로 정본이 하나여야 한다(호스트가 자기 문자열로 따로 적으면 그 순간 둘이 갈린다).
  SSOT_CONFIG_PATH,
  SSOT_MIN_BODY_CHARS,
  SSOT_STALE_DAYS,
} from './ssot-drift/ssot.js';
export type { SsotSurvey, SsotConfig, SsotDocState } from './ssot-drift/ssot.js';

export { LETHAL_TRIFECTA_ID, lethalTrifectaManifest } from './lethal-trifecta/manifest.js';
export {
  judgeTrifecta,
  effectiveTools,
  TRIFECTA_LEG_TOOLS,
} from './sdk/judgments/trifecta.js';
export type {
  TrifectaLeg,
  TrifectaLegState,
  TrifectaLegResult,
  TrifectaLevel,
  TrifectaVerdict,
} from './sdk/judgments/trifecta.js';

// ─── 2차 배치 (v3.88) — 판정 로직은 순수 함수라 UI 없이 단독 검증된다 ───
export { judgeLeastPrivilege } from './least-privilege/leastPrivilege.js';
export type { LeastPrivilegeVerdict, ToolClass } from './least-privilege/leastPrivilege.js';
export { judgeBlastRadius } from './sdk/judgments/blastRadius.js';
export type { BlastRadiusVerdict } from './sdk/judgments/blastRadius.js';
export { judgeAutonomy } from './autonomy-level/index.js';
export type { AutonomyLevel } from './autonomy-level/index.js';
export { computeLongHorizon } from './long-horizon/index.js';
export type { LongHorizonStats } from './long-horizon/index.js';
export { judgeRogue } from './rogue-agent/index.js';
export type { RogueVerdict } from './rogue-agent/index.js';
