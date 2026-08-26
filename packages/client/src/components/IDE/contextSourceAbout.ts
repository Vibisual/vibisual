/**
 * §5.5 #17-28 ⑦ — 주입원 한 줄의 **설명을 찾아 주는** 순수 층.
 *
 * 표에 남아 있던 것은 이름·숫자·배지 셋뿐이라 `cc.slash-commands · ~7.4K · spawn` 이 처음 보는
 * 사람에게는 아무 뜻도 아니었다. 무엇이 사라지는지 모르는 스위치는 아무도 끄지 못한다 — 그래서
 * 모든 줄에 "무엇인가 · 어디서 오는가 · 끄면 어떻게 되는가" 세 문장을 붙인다.
 *
 * 여기서는 **어떤 키를 읽어야 하는가**만 정한다(React·i18n 을 물지 않는 순수 함수라 테스트로 고정된다).
 * 실제 번역문은 로케일 파일에 있고, 화면은 후보를 앞에서부터 훑어 **있는 첫 키**를 쓴다.
 */
import { CONTEXT_PLUGIN_ID_PREFIX, CONTEXT_SOURCE_IDS } from '@vibisual/shared';
import type { ContextSourceCategory } from '@vibisual/shared';

/** 설명 i18n 키의 뿌리. */
export const CONTEXT_ABOUT_ROOT = 'ide.context.about';

/** 설명이 답하는 세 가지. */
export type ContextAboutField = 'what' | 'more' | 'off';

/** 화면이 순서대로 그리는 세 칸. */
export const CONTEXT_ABOUT_FIELDS: ContextAboutField[] = ['what', 'more', 'off'];

/**
 * 주입원 id → 설명 키 조각.
 *
 * 조각 이름은 화면 라벨(`ide.context.src.*`)과 **같은 이름**을 쓴다 — 로케일 파일에서 제목과 설명이
 * 같은 이름으로 나란히 서야 번역할 때도 둘을 함께 보게 된다.
 */
export const CONTEXT_ABOUT_KEY_BY_ID: Record<string, string> = {
  [CONTEXT_SOURCE_IDS.skillsPrefix]: 'skillsPrefix',
  [CONTEXT_SOURCE_IDS.agentRules]: 'agentRules',
  [CONTEXT_SOURCE_IDS.edges]: 'edges',
  [CONTEXT_SOURCE_IDS.feedback]: 'feedback',
  [CONTEXT_SOURCE_IDS.intentFirst]: 'intentFirst',
  [CONTEXT_SOURCE_IDS.cardCommon]: 'cardCommon',
  [CONTEXT_SOURCE_IDS.cardReport]: 'cardReport',
  [CONTEXT_SOURCE_IDS.cardQuestion]: 'cardQuestion',
  [CONTEXT_SOURCE_IDS.cardReview]: 'cardReview',
  [CONTEXT_SOURCE_IDS.goal]: 'goal',
  [CONTEXT_SOURCE_IDS.brainCards]: 'brainCards',
  [CONTEXT_SOURCE_IDS.brainTopics]: 'brainTopics',
  [CONTEXT_SOURCE_IDS.brainRules]: 'brainRules',
  [CONTEXT_SOURCE_IDS.brainSkills]: 'brainSkills',
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
};

/** 개별 플러그인 줄(`plugin:<id>`)이 함께 쓰는 설명 조각 — 이름만 갈아 끼운다. */
export const CONTEXT_ABOUT_PLUGIN_KEY = 'plugin';

/**
 * 이 줄의 설명 조각. 개별 플러그인은 한 벌을 나눠 쓰고(수가 111종이라 한 장씩 쓸 수 없다),
 * 모르는 id 는 `null` — 그때는 분류 설명으로 물러난다.
 */
export function aboutSlugFor(sourceId: string): string | null {
  if (sourceId.startsWith(CONTEXT_PLUGIN_ID_PREFIX)) return CONTEXT_ABOUT_PLUGIN_KEY;
  return CONTEXT_ABOUT_KEY_BY_ID[sourceId] ?? null;
}

/**
 * 읽어 볼 키를 **우선순위 순서**로. 화면은 앞에서부터 훑어 있는 첫 키를 쓴다.
 *
 * 분류 설명을 뒤에 두는 것은 "설명이 비어 있는 줄"을 만들지 않기 위해서다 — 새 주입원이 설명보다
 * 먼저 들어오더라도 최소한 그 분류가 무엇인지는 읽힌다.
 */
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
