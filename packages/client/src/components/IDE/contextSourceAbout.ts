/** §5.5 #17-28 ⑦ — 주입원 줄의 설명 키 고르기(순수). 무엇인가·어디서 오는가·끄면 어떻게 되는가 — 화면은 후보 중 있는 첫 키를 쓴다. */
import { CONTEXT_PLUGIN_ID_PREFIX, CONTEXT_SOURCE_IDS } from '@vibisual/shared';
import type { ContextSourceCategory } from '@vibisual/shared';

/** 설명 i18n 키의 뿌리. */
export const CONTEXT_ABOUT_ROOT = 'ide.context.about';

/** 설명이 답하는 세 가지. */
export type ContextAboutField = 'what' | 'more' | 'off';

/** 화면이 순서대로 그리는 세 칸. */
export const CONTEXT_ABOUT_FIELDS: ContextAboutField[] = ['what', 'more', 'off'];

/** 조각 이름은 화면 라벨(`ide.context.src.*`)과 같게 — 로케일에서 제목과 설명이 나란히 서야 함께 번역된다. */
export const CONTEXT_ABOUT_KEY_BY_ID: Record<string, string> = {
  [CONTEXT_SOURCE_IDS.skillsPrefix]: 'skillsPrefix',
  [CONTEXT_SOURCE_IDS.agentRules]: 'agentRules',
  [CONTEXT_SOURCE_IDS.edges]: 'edges',
  [CONTEXT_SOURCE_IDS.feedback]: 'feedback',
  [CONTEXT_SOURCE_IDS.intentFirst]: 'intentFirst',
  [CONTEXT_SOURCE_IDS.compactSelf]: 'compactSelf',
  [CONTEXT_SOURCE_IDS.compactRecovery]: 'compactRecovery',
  [CONTEXT_SOURCE_IDS.verificationPolicy]: 'verificationPolicy',
  [CONTEXT_SOURCE_IDS.cardCommon]: 'cardCommon',
  [CONTEXT_SOURCE_IDS.cardReport]: 'cardReport',
  [CONTEXT_SOURCE_IDS.cardQuestion]: 'cardQuestion',
  [CONTEXT_SOURCE_IDS.cardReview]: 'cardReview',
  [CONTEXT_SOURCE_IDS.goal]: 'goal',
  [CONTEXT_SOURCE_IDS.autoGoalSkills]: 'autoGoalSkills',
  [CONTEXT_SOURCE_IDS.hookEnforcement]: 'hookEnforcement',
  [CONTEXT_SOURCE_IDS.plugins]: 'plugins',
  [CONTEXT_SOURCE_IDS.claudeMd]: 'claudeMd',
  [CONTEXT_SOURCE_IDS.autoMemory]: 'autoMemory',
  [CONTEXT_SOURCE_IDS.slashCommands]: 'skills',
  [CONTEXT_SOURCE_IDS.bundledSkills]: 'bundledSkills',
  [CONTEXT_SOURCE_IDS.workflows]: 'workflows',
  [CONTEXT_SOURCE_IDS.gitInstructions]: 'gitInstructions',
  [CONTEXT_SOURCE_IDS.subagentDefs]: 'subagentDefs',
  [CONTEXT_SOURCE_IDS.systemPrompt]: 'systemPrompt',
  [CONTEXT_SOURCE_IDS.toolSchemas]: 'toolSchemas',
  [CONTEXT_SOURCE_IDS.mcp]: 'mcp',
  [CONTEXT_SOURCE_IDS.hooks]: 'hooks',
  'codex.instructions': 'codexInstructions',
  'codex.global-instructions': 'codexGlobalInstructions',
  'codex.collaboration-instructions': 'codexCollaborationInstructions',
  'codex.skills': 'codexSkills',
  'codex.developer-instructions': 'codexDeveloperInstructions',
  'codex.mcp': 'codexMcp',
  'codex.plugins': 'codexPlugins',
  'codex.runtime-mcp': 'codexRuntimeMcp',
  'codex.runtime-plugins': 'codexRuntimePlugins',
  'codex.hooks': 'codexHooks',
  'codex.system-prompt': 'codexSystemPrompt',
};

/** 개별 플러그인 줄(`plugin:<id>`)이 함께 쓰는 설명 조각 — 이름만 갈아 끼운다. */
export const CONTEXT_ABOUT_PLUGIN_KEY = 'plugin';

/** 개별 플러그인은 한 벌을 나눠 쓴다(111종). 모르는 id 는 `null` — 분류 설명으로 물러난다. */
export function aboutSlugFor(sourceId: string): string | null {
  if (sourceId.startsWith(CONTEXT_PLUGIN_ID_PREFIX)) return CONTEXT_ABOUT_PLUGIN_KEY;
  return CONTEXT_ABOUT_KEY_BY_ID[sourceId] ?? null;
}

/** 분류 설명이 맨 뒤 — 설명보다 먼저 들어온 새 주입원도 빈 줄이 되지 않는다. */
export function aboutKeyCandidates(
  sourceId: string,
  category: ContextSourceCategory,
  field: ContextAboutField,
): string[] {
  const keys: string[] = [];
  const slug = aboutSlugFor(sourceId);
  if (slug) keys.push(`${CONTEXT_ABOUT_ROOT}.src.${slug}.${field}`);
  keys.push(`${CONTEXT_ABOUT_ROOT}.cat.${category}.${field}`);
  return keys;
}

/** 통제 성격("이 줄을 어떻게 끄는가")을 풀어 쓴 한 줄의 키. */
export function controlExplainKey(control: string): string {
  return `${CONTEXT_ABOUT_ROOT}.control.${control}`;
}
