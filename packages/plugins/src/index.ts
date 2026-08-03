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
} from './types.js';

export {
  PLUGIN_MANIFESTS,
  PLUGIN_DATA_NEEDS,
  getPluginManifest,
  resolveEnabledPlugins,
  isPluginEnabled,
  unsupportedContributions,
  validateRegistry,
} from './registry.js';

export { LETHAL_TRIFECTA_ID, lethalTrifectaManifest } from './lethal-trifecta/manifest.js';
export {
  judgeTrifecta,
  effectiveTools,
  TRIFECTA_LEG_TOOLS,
} from './lethal-trifecta/trifecta.js';
export type {
  TrifectaLeg,
  TrifectaLegState,
  TrifectaLegResult,
  TrifectaLevel,
  TrifectaVerdict,
} from './lethal-trifecta/trifecta.js';

// ─── 2차 배치 (v3.88) — 판정 로직은 순수 함수라 UI 없이 단독 검증된다 ───
export { judgeLeastPrivilege } from './least-privilege/leastPrivilege.js';
export type { LeastPrivilegeVerdict, ToolClass } from './least-privilege/leastPrivilege.js';
export { judgeBlastRadius } from './blast-radius/index.js';
export type { BlastRadiusVerdict } from './blast-radius/index.js';
export { judgeAutonomy } from './autonomy-level/index.js';
export type { AutonomyLevel } from './autonomy-level/index.js';
export { computeLongHorizon } from './long-horizon/index.js';
export type { LongHorizonStats } from './long-horizon/index.js';
export { judgeRogue } from './rogue-agent/index.js';
export type { RogueVerdict } from './rogue-agent/index.js';
