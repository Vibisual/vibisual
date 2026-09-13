/**
 * §5.11 v4.58 — **플러그인 SDK** (언리얼의 엔진 모듈에 해당).
 *
 * 사용자 요구 — "각 플러그인은 다른 우리 앱에 **복붙해서 써도 될 정도로** 개별적으로 만들어야 한다.
 * 언리얼 플러그인이 그렇게 되어 있잖아."
 *
 * 그러려면 플러그인 폴더가 **자기 밖을 아무 데나 찔러서는 안 된다.** 종전에는 폴더마다
 * `../types.js` · `../framework/inspector.js` · `../ui/kit.js` · `../lethal-trifecta/trifecta.js` 같은
 * 상대경로가 흩어져 있어서, 폴더 하나를 떼면 네 방향으로 끊겼고 **남의 플러그인 폴더까지 딸려 왔다**.
 *
 * 그래서 규약을 하나로 좁힌다.
 *
 * > **플러그인 폴더가 바깥에서 가져올 수 있는 것은 `../sdk/index.js` 하나뿐이다.**
 *
 * 언리얼에서 플러그인이 엔진 모듈만 참조하고 다른 플러그인의 소스를 직접 열지 않는 것과 같은 규율이다.
 * 이 파일이 그 유일한 창구이고, `portability.test.ts` 가 위반을 기계로 잡는다.
 *
 * **다른 앱으로 옮길 때**: 플러그인 폴더 + 이 `sdk/` 폴더를 함께 두면 그대로 컴파일된다. 호스트 앱은
 * `plugin.json` 의 `hostApi` 를 보고 자기가 그 계약을 구현하는지 판단한다.
 */

// ── 계약 타입 — 플러그인이 호스트와 주고받는 모든 형태 ──
export type {
  PluginManifest,
  PluginTranslate,
  PluginDataNeed,
  PluginFactMap,
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
  PluginUsage,
  PluginClientModule,
  PluginServerModule,
  PluginPromptContext,
  PluginPromptModule,
  // §5.11 자립 규약 ⑥ — 서버 기여도 폴더 안에서 쓴다(프레임워크·파일 접근은 호스트가 건넨다).
  PluginRoute,
  PluginRouteRequest,
  PluginRouteResponse,
  PluginServerHost,
  // §5.11 정독 게이트 — 절 색인·영수증·인용·신뢰도.
  SpecCitation,
  SpecGateStrength,
  SpecIndex,
  SpecReadSpan,
  SpecReadingRoute,
  SpecReadingSettings,
  SpecReadingScope,
  SpecReadingScopeState,
  SpecRequiredEntry,
  SpecTrust,
  SpecUnit,
  SpecUnitStatus,
} from '../types.js';

// ── 점검 카드 골격 + 공용 글리프 ──
export { defineInspector, ICONS } from '../framework/inspector.js';
export type { InspectorSpec, InspectorCheck } from '../framework/inspector.js';

// ── "아직 아무 일도 없는 에이전트에 경고하지 않는다" 규칙(v4.26) ──
export { hasActivity, toneIfActive } from '../framework/activity.js';

// ── 집행 골격(v4.59) — 플러그인 = 관측(카드) + 집행(규칙) ──
export { defineEnforcement, ENFORCEMENT_RULE_MAX } from '../framework/enforcement.js';
export type { EnforcementSpec } from '../framework/enforcement.js';

/**
 * ── 설정 상수(§3.3) — 정독 게이트 ──
 *
 * 이 값들은 **플러그인·서버·클라가 함께 읽어야** 한다(색인 상한을 플러그인이 자르고, 원장 상한을
 * 서버가 걸고, 화면이 같은 숫자로 "잘렸다"를 말한다). 그래서 폴더 안에 사본을 두지 않고 이 문 하나로
 * 내보낸다 — 사본을 두면 셋 중 하나만 바뀌어 서로 다른 상한을 말하게 된다.
 */
export {
  SPEC_DOC_ROOT_CANDIDATES,
  SPEC_DOC_EXTENSIONS,
  SPEC_DOC_SCAN_MAX_DEPTH,
  SPEC_DOC_FILE_MAX,
  SPEC_ID_PATTERN_DEFAULT,
  SPEC_REQUIREMENT_MARKERS,
  SPEC_REQUIRED_MAX,
  SPEC_UNIT_MAX,
  SPEC_UNIT_TOKEN_MAX,
  SPEC_ITEM_PATTERN_DEFAULT,
  SPEC_RESPLIT_DEPTH_MAX,
  SPEC_ITEM_LABEL_MAX,
  SPEC_TITLE_MIN_HITS,
  // §5.11 — 겹침을 **개수**가 아니라 **무게**로 세는 재료(접착제 0 · 드문 낱말 가중).
  SPEC_TITLE_STOPWORDS,
  SPEC_RARE_TITLE_HIT_WEIGHT,
  SPEC_RARE_TITLE_DF_RATIO,
  SPEC_RARE_TITLE_MIN_UNITS,
  SPEC_TITLE_HEAD_PARTS,
  SPEC_DOC_SKIP_SEGMENTS,
  SPEC_DOC_SKIP_FILE_PATTERN,
  SPEC_DOC_LIST_MAX,
  SPEC_INDEX_SKIPPED_LIST_MAX,
  SPEC_CITATION_ACTUAL_MAX,
  SPEC_FULL_READ_LINE_MAX,
  SPEC_GREP_CONTEXT_LINES,
  SPEC_COVER_SATISFIED_RATIO,
  SPEC_STOP_RETRY_DEFAULT,
  SPEC_STOP_RETRY_LIMIT,
  SPEC_CITATION_MIN_CHARS,
  SPEC_CITATION_MAX_CHARS,
  SPEC_INDEX_TTL_MS,
  SPEC_SETTINGS_FILE,
  SPEC_GATE_STRENGTHS,
  SPEC_SCOPE_ENTRY_MAX,
  DEFAULT_SPEC_READING_SETTINGS,
  // §5.5 #17-44 ⑧ — 켬/끔 3층 판정은 shared 순수 함수 하나가 소유한다(카드·집행·게이트 공용).
  SPEC_SCOPE_ORDER,
  resolveSpecReadingEnabled,
  specReadingScopeStates,
  normalizeScopeMap,
} from '@vibisual/shared';

/**
 * 경로를 **키·비교로 쓸 때** 반드시 이것을 통과시킨다(멀티플랫폼 1축).
 *
 * `.toLowerCase()` 로 접으면 Linux 에서 `Feature-X` 와 `feature-x` 가 같은 파일이 된다.
 */
export { pathKey } from '@vibisual/shared';
export type { PlatformName } from '@vibisual/shared';

/**
 * 토큰 어림 — 서버·클라가 쓰는 **같은 산식**(`TOKEN_BYTES_RATIO`). 절 크기 상한(정독 게이트)이 이것으로
 * 잰다. 플러그인이 자기 산식을 들면 화면의 "~토큰" 과 프롬프트의 숫자가 갈린다.
 */
export { estimateTokens } from '@vibisual/shared';

// ── 화면 조각 — 카드 생김새를 카탈로그 전체가 공유한다 ──
export { PluginSection, PluginRow, PluginBadgePill, formatElapsed } from '../ui/kit.js';
export type { PluginTone } from '../ui/kit.js';

/**
 * ── 공용 판정 ──
 *
 * 여러 플러그인이 함께 쓰는 순수 판정은 **어느 한 플러그인의 소유가 아니다.** 한 카드 안에 두면
 * 나머지가 그 폴더를 물게 되고(실제로 `effectiveTools` 를 21곳, `judgeBlastRadius` 를 2곳이 물고 있었다)
 * 그 순간 두 폴더는 하나로 붙는다.
 */
export {
  judgeTrifecta,
  effectiveTools,
  TRIFECTA_LEG_TOOLS,
} from './judgments/trifecta.js';
export type {
  TrifectaLeg,
  TrifectaLegState,
  TrifectaLegResult,
  TrifectaLevel,
  TrifectaVerdict,
} from './judgments/trifecta.js';
export { judgeBlastRadius } from './judgments/blastRadius.js';
export type { BlastRadiusVerdict } from './judgments/blastRadius.js';
// §5.10 — 자동 목표 한 벌 접기. 3층을 접는 자리가 카드마다 갈리지 않게 여기 하나로 둔다.
export { readAutoGoal } from './judgments/autoGoal.js';
export type { AutoGoalReading } from './judgments/autoGoal.js';

/**
 * 호스트 API 버전 — 플러그인 `plugin.json` 의 `hostApi` 와 맞춰 본다.
 *
 * 복붙 대상 앱이 이보다 낮은 계약만 구현한다면 그 플러그인은 못 얹는다. 슬롯을 새로 열거나 컨텍스트
 * 필드를 **없애면** 올린다(추가만 하는 변경은 올리지 않는다 — 옛 플러그인이 그대로 돈다).
 */
export const PLUGIN_HOST_API = 1;
