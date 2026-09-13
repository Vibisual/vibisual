/**
 * §5.11 v3.99 → 정독 게이트 — 명세 주도 개발(SDD).
 *
 * 흐름이 명세 → 설계 → 작업 계획 → 구현 → 검증으로, 프롬프트 → 코드 → 땜질과 정반대다. 명세가 모호함을
 * 없애면 에이전트는 결정권자가 아니라 **고속 타이피스트**로 일하게 되고, 그때 비로소 산출량이 안전하게 커진다.
 *
 * v3.99 의 이 카드는 **표시 전용**이었다. `agentConfig.rules` 가 있는지, todo 를 적었는지 같은 곁신호를
 * 0~3 으로 세는 것이 전부였고, 그 셋이 다 있어도 기획을 실제로 읽었는지와는 아무 상관이 없었다.
 * 사용자가 겪은 문제가 정확히 그 틈이다 — "기획 정보를 끝까지 탐색하지 않고 대충 보고 끝낸다."
 *
 * 그래서 이 카드는 `ssot-drift` 와 같은 자리로 올라간다. 집행(`enforce.ts` → `spec.ts`)이 기획 문서를 절로
 * 잘라 이번 턴 필수 절을 지목하고, 훅이 남긴 열람 구간과 대조해 **읽었는지를 실제로 잰다.** 카드는 그
 * 집행이 남긴 실측(`data.pluginFacts['spec-driven']`)을 **그대로** 그린다 — 화면과 집행이 다른 것을 세면
 * 사용자는 켠 결과를 확인할 방법이 없어진다(v4.65 가 SSOT 카드에서 배운 그대로).
 *
 * 실측이 아직 없으면 **없는 것을 0 으로 그리지 않고** "측정 전"이라고 말한다.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext, PluginFactMap } from '../sdk/index.js';

/** 서버가 남긴 이 카드의 실측. 켜지기 전이거나 아직 한 번도 안 잰 프로젝트면 undefined. */
const facts = (ctx: PluginBubbleContext): PluginFactMap | undefined => ctx.data.pluginFacts?.['spec-driven'];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 실측 한 칸을 숫자로. 실측 자체가 없으면 null — "아직 안 쟀다"와 "0 이다"는 다른 말이다. */
const factNum = (ctx: PluginBubbleContext, key: string): number | null => {
  const f = facts(ctx);
  return f ? num(f[key]) : null;
};

const inspector = defineInspector({
  id: 'spec-driven', i18nKey: 'specDriven', name: 'Spec-Driven Development', category: 'workflow',
  // 실측만 읽는다 — 곁신호(todo·리뷰 체크포인트)는 정독 여부와 무관해서 세는 순간 화면이 집행과 갈렸다.
  needs: ['pluginFacts'],
  // §5.11 노출 게이트 — 이 카드의 집행은 프로젝트를 실제로 훑는다(`spec.ts` 가 기획 문서를 절로 잘라
  //   읽고, `surveySpecFacts` 가 그 근거를 돌려준다).
  enforcesProject: true,
  // §5.5 #17-44 ⑧(d) — 켜고 끄는 자리는 **활동바 `정독` 뷰의 3층 스위치 하나**다. 그래서 이 카드는
  //   Plugins 창 목록에 서지 않고, 집행 배럴·카드 호스트는 켬 집합을 묻지 않는다. 관문이 둘이었을 때는
  //   뷰에서 켠 것이 왜 안 도는지가 111장 목록 안에 숨었다 — 거기로 가는 길은 화면에 없었다.
  ownToggle: true,
  // 실측이 **프로젝트 단위**라 표시 조건도 프로젝트 단위여야 한다 — 설정 없는 버블(훅으로 붙은 세션)에서
  //   카드가 사라지면 같은 프로젝트인데 버블에 따라 정독 상태가 보였다 안 보였다 한다.
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    // §5.5 #17-44 ⑧ — 켬/끔 3층이 전부 꺼져 있으면 집행이 아예 안 돈다. 그 사실을 **먼저** 말한다 —
    //   "측정 전"으로 그리면 사용자는 재는 중인 줄 알고 기다리게 되고, 켜야 한다는 것을 영영 모른다.
    if (facts(ctx)?.specEnabled === false) return { key: 'off', tone: 'neutral' };
    const units = factNum(ctx, 'indexUnits');
    if (units === null) return { key: 'unmeasured', tone: 'neutral' };
    if (units === 0) return { key: 'noSpec', tone: 'warn' };
    const required = factNum(ctx, 'requiredTotal') ?? 0;
    if (required === 0) return { key: 'idle', tone: 'neutral' };
    // 지어낸 인용은 안 읽은 것보다 나쁘다 — 근거가 있는 것처럼 보이기 때문이다. 그래서 먼저 말한다.
    if ((factNum(ctx, 'citationsFailed') ?? 0) > 0) return { key: 'mismatch', tone: 'bad' };
    const satisfied = factNum(ctx, 'satisfied') ?? 0;
    return satisfied >= required ? { key: 'read', tone: 'good' } : { key: 'partial', tone: 'warn' };
  },
  checks: [
    {
      key: 'index',
      value: (ctx) => {
        const docs = factNum(ctx, 'indexDocs');
        const units = factNum(ctx, 'indexUnits');
        if (docs === null || units === null) return ctx.t('panel.plugins.specDriven.none');
        return `${docs} · ${units}${facts(ctx)?.indexTruncated === true ? '+' : ''}`;
      },
    },
    {
      key: 'required',
      value: (ctx) => {
        const required = factNum(ctx, 'requiredTotal');
        if (required === null) return ctx.t('panel.plugins.specDriven.none');
        return `${factNum(ctx, 'satisfied') ?? 0} / ${required}`;
      },
    },
    {
      key: 'citation',
      value: (ctx) => {
        const f = facts(ctx);
        const ok = num(f?.citationsVerified);
        const bad = num(f?.citationsFailed);
        if (ok === null || bad === null || ok + bad === 0) return ctx.t('panel.plugins.specDriven.none');
        return `${ok} / ${ok + bad}`;
      },
    },
  ],
  noteKey: () => '.note',
});

export const specDrivenManifest = inspector.manifest;
export const specDrivenClient = inspector.client;
