/**
 * §5.11 — `@vibisual/plugins` 기본 진입점. React·node 에 의존하지 않는 것만 내보낸다(매니페스트·등록부·판정 순수 함수).
 * 클라이언트 기여는 `@vibisual/plugins/client`, 서버 기여는 `@vibisual/plugins/server`.
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
  hasOwnToggle,
  withProjectEnabled,
  resolveProjectKey,
  unsupportedContributions,
  validateRegistry,
} from './registry.js';
export type { PluginEnablementSource } from './registry.js';

// §5.11 — SSOT 집행 판정. 순수 함수라 fs 없이 단독 검증된다(`ssot.test.ts`).
export {
  surveySsot,
  surveySsotFacts,
  buildSsotPromptBlock,
  readSsotConfig,
  resolveCandidates,
  hasSubstance,
  SSOT_DOC_CANDIDATES,
  RIVAL_DIRECTION_SOURCES,
  // 프로젝트가 자기 SSOT 를 지정하는 파일의 경로 정본 — 호스트가 그 파일을 써 줄 때 자기 문자열로 따로 적으면 둘이 갈린다.
  SSOT_CONFIG_PATH,
  SSOT_MIN_BODY_CHARS,
  SSOT_STALE_DAYS,
} from './ssot-drift/ssot.js';
export type { SsotSurvey, SsotConfig, SsotDocState } from './ssot-drift/ssot.js';

/**
 * §5.11 정독 게이트 — 절 색인·라우팅·영수증·인용 확증의 판정 전부(순수 함수, `spec.test.ts`).
 * 서버는 이것을 그대로 부른다 — 따로 판정하면 프롬프트에 실린 판단과 게이트가 막는 근거가 갈려 "화면은 초록인데 막힌다"가 된다.
 */
export {
  evaluateSpecReading,
  buildSpecIndex,
  buildSpecIndexCached,
  clearSpecIndexCache,
  buildSpecPromptBlock,
  buildSpecSystemRules,
  surveySpecFacts,
  readSpecSettings,
  normalizeSpecSettings,
  routeRequiredUnits,
  classifySpans,
  computeTrust,
  verifyCitation,
  extractCitations,
  unitAt,
  splitUnits,
  slugify,
  countRequirements,
  tokenize,
  matchGlob,
  shapePath,
  specPlatform,
  spanFromRead,
  spanFromGrep,
} from './spec-driven/spec.js';
export type { SpecReadingEvaluation } from './spec-driven/spec.js';
export { SPEC_DRIVEN_ID } from './spec-driven/enforce.js';

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

// 2차 배치 판정 — 순수 함수라 UI 없이 단독 검증된다.
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
