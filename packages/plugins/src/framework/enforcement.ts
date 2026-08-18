/**
 * §5.11 v4.59 — **집행 골격**(Enforcement).
 *
 * v4.57 이 집행 슬롯(`agentPrompt`)을 열었지만 실제로 집행하는 카드는 `ssot-drift` 하나였다.
 * 나머지는 여전히 켜도 화면 한 칸이 느는 것이 전부였고, 사용자가 그대로 지적했다 — "모든 플러그인이
 * SSOT 처럼 개별 폴더에 개발되어 있어야 하고, 켜면 **우리 프로젝트에 영향력을 행사**해야 한다.
 * 각자 SSOT 처럼 **강제할 수 있는 핵심 기능**이 있을 거 아니냐."
 *
 * 그래서 카드의 정의를 바꾼다.
 *
 * > **플러그인 = 관측(카드) + 집행(규칙). 둘 다 없으면 플러그인이 아니다.**
 *
 * 이 골격은 집행 블록의 **모양**만 정한다. 무엇을 강제할지는 플러그인마다 자기 폴더의 `enforce.ts`
 * 안에 있다 — 카드가 재는 것과 강제하는 것이 같은 폴더에 있어야 둘이 갈라지지 않는다.
 *
 * **분량 규율**: 규칙은 짧게. 켠 카드가 많을수록 프롬프트가 그만큼 길어지고, 길어진 지시는 읽히지 않는다
 * (§5.10 에서 규칙 카드 전량 주입이 같은 이유로 문제가 됐다). 한 카드당 **규칙 6줄**이 상한이며
 * `enforcement.test.ts` 가 그것을 지킨다.
 */
import type { PluginPromptContext, PluginPromptModule } from '../types.js';

export interface EnforcementSpec {
  /** kebab-case 플러그인 id — 켬/끔 판정 키. */
  id: string;
  /** 집행 블록 머리에 붙는 한 줄. 무엇을 강제하는지 사람이 먼저 읽는 자리다. */
  title: string;
  /**
   * 에이전트가 **그대로 따라야 하는** 문장들. "~를 보라"가 아니라 "~하라 / ~하지 마라"로 쓴다.
   * 관측 문구(카드에 이미 있는 것)를 여기에 옮겨 적으면 프롬프트만 길어지고 행동은 안 바뀐다.
   */
  rules: string[];
  /**
   * 이 프로젝트를 실제로 훑어 규칙을 보태거나 상황을 알린다(선택).
   *
   * 파일 접근은 호스트가 넘긴 좁은 탐침(`ctx.fileExists`/`ctx.readFile`)만 쓴다. 던지면 호스트가
   * 그 카드만 건너뛴다 — 그래도 이 안에서 조용히 실패하도록 쓰는 편이 낫다.
   */
  probe?: (ctx: PluginPromptContext) => string[] | undefined;
  /**
   * 이 프로젝트/에이전트에 아예 해당이 없으면 false — 블록 자체가 안 붙는다.
   * 기본값은 "커스텀/CMD 에이전트에만"이 아니라 **항상**이다(켠 것은 켠 이유가 있다).
   */
  applies?: (ctx: PluginPromptContext) => boolean;
}

/** 한 카드가 실을 수 있는 규칙 줄 수 상한. 늘리려면 이유를 SSOT 에 적고 테스트를 함께 고칠 것. */
export const ENFORCEMENT_RULE_MAX = 6;

export function defineEnforcement(spec: EnforcementSpec): PluginPromptModule {
  return {
    id: spec.id,
    buildBlock: (ctx) => {
      if (spec.applies && !spec.applies(ctx)) return undefined;
      let extra: string[] = [];
      try {
        extra = spec.probe?.(ctx) ?? [];
      } catch {
        extra = []; // 실측이 안 되면 규칙만 싣는다 — 파일 하나 때문에 집행이 통째로 빠지면 안 된다.
      }
      const lines = [...spec.rules, ...extra];
      if (lines.length === 0) return undefined;
      return `\n\n## ${spec.title}\n${lines.map((l) => `- ${l}`).join('\n')}\n`;
    },
  };
}
