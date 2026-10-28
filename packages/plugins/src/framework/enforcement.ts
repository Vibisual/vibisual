/**
 * §5.11 — 집행 골격(Enforcement). 플러그인 = 관측(카드) + 집행(규칙) — 둘 다 없으면 플러그인이 아니다.
 * 이 골격은 집행 블록의 모양만 정한다. 무엇을 강제할지는 각 폴더의 `enforce.ts` 에 둔다 — 재는 것과 강제하는 것이 같은 폴더에 있어야 갈라지지 않는다.
 * 분량: 켠 카드만큼 프롬프트가 길어지고 긴 지시는 안 읽힌다 — 카드당 규칙 6줄이 상한(`enforcement.test.ts` 가 지킨다).
 */
import type { PluginFactMap, PluginPromptContext, PluginPromptModule } from '../types.js';

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
   * 파일 접근은 호스트가 넘긴 좁은 탐침(`ctx.fileExists`/`ctx.readFile`)만 쓴다. 던지면 호스트가 그 카드만 건너뛰지만, 안에서 조용히 실패하게 쓰는 편이 낫다.
   */
  probe?: (ctx: PluginPromptContext) => string[] | undefined;
  /**
   * 이 프로젝트/에이전트에 아예 해당이 없으면 false — 블록 자체가 안 붙는다.
   * 기본값은 "커스텀/CMD 에이전트에만"이 아니라 **항상**이다(켠 것은 켠 이유가 있다).
   */
  applies?: (ctx: PluginPromptContext) => boolean;
  /**
   * 훑은 근거를 카드에 돌려준다(선택) — 프롬프트에 실은 판단을 화면이 같은 값으로 그리게 한다.
   * `probe` 와 함께 노출 게이트(§5.11)의 판정 재료 — 둘 중 하나라도 있으면 매니페스트에 `enforcesProject: true` 를 적어야 한다(`readiness.test.ts` 가 대조).
   */
  survey?: (ctx: PluginPromptContext) => PluginFactMap | undefined;
}

/** 한 카드가 실을 수 있는 규칙 줄 수 상한. 늘리려면 이유를 SSOT 에 적고 테스트를 함께 고칠 것. */
export const ENFORCEMENT_RULE_MAX = 6;

export function defineEnforcement(spec: EnforcementSpec): PluginPromptModule {
  return {
    id: spec.id,
    // 실측을 낸 카드만 이 칸을 갖는다 — 없으면 배럴이 건너뛴다(빈 함수를 두면 빈 한 벌이 스냅샷에 뜬다).
    ...(spec.survey ? { survey: spec.survey } : {}),
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
