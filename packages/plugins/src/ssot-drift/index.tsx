/**
 * §5.11 v4.00 → v4.67 — SSOT(단일 진실 공급원).
 *
 * 같은 정보가 두 군데 있으면 반드시 어긋나고, 어느 쪽이 맞는지 아무도 모르게 된다. 사람은 "이건 옛날 거네"
 * 하고 넘기지만 모델은 **둘 다 그럴듯하게 인용**한다.
 *
 * v4.00 은 그 위험을 **세기만** 했다(0~3). v4.57 에서 **집행**이 붙었다 — 이 프로젝트에서 켜져 있는 동안
 * 에이전트의 매 턴 프롬프트에 SSOT 규율이 실린다(`enforce.ts`). 켜면 화면 한 칸이 아니라 **일하는 방식**이
 * 바뀐다.
 *
 * v4.65 에서 카드가 **집행과 같은 것을 세게** 됐다. 그전까지 이 카드는 `agentConfig.rules`·`skills`·기억 수를
 * "진실 공급원"이라 표시했는데, 그 사이 프롬프트에는 `docs/SCENARIO.md` 가 실리고 있었다 — 화면과 집행이
 * 다른 것을 세고 있었으므로 사용자는 켠 결과를 확인할 방법이 없었다. 이제 서버가 집행 시점에 남긴 실측
 * (`data.pluginFacts['ssot-drift']`)을 그대로 그린다. 실측이 아직 없으면 **없는 것을 0 으로 그리지 않고**
 * "아직 측정 전"이라고 말한다.
 *
 * v4.67 에서 둘을 고쳤다.
 *  - **표시 조건이 실측 단위와 어긋났다.** 실측은 프로젝트 단위인데 카드는 골격 기본값(`agentConfig` 가
 *    있는 에이전트 버블)에 걸려 있어서, 설정이 없는 버블에서는 켜도 카드가 안 보였다 — 같은 프로젝트를
 *    보고 있는데 버블에 따라 SSOT 상태가 보였다 안 보였다 하는 셈이다. 에이전트 버블이면 그린다.
 *  - **행이 실제 상태를 못 담았다.** "문서 있음"에 빈 문서가 섞여 있었고, 이름이 Drift 인데 어긋남을
 *    재는 행이 없었다. 문서 상태·뒤처짐 두 행을 더했다.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext, PluginFactMap } from '../sdk/index.js';
import { SsotDriftSettings } from './settings.js';

/** 서버가 남긴 이 카드의 실측. 켜지기 전이거나 아직 한 번도 안 잰 프로젝트면 undefined. */
const facts = (ctx: PluginBubbleContext): PluginFactMap | undefined => ctx.data.pluginFacts?.['ssot-drift'];

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** 집행이 잡은 SSOT 문서(경로). 실측이 없으면 null, 있는데 못 찾았으면 빈 문자열. */
const ssotDoc = (ctx: PluginBubbleContext): string | null => {
  const f = facts(ctx);
  return f ? str(f.doc) : null;
};

/** 지시 공급원 수 — **집행이 센 것과 같은 수**(SSOT 문서 + 정렬 안 된 경쟁 문서). 실측 없으면 null. */
const sourceCount = (ctx: PluginBubbleContext): number | null => {
  const f = facts(ctx);
  if (!f) return null;
  return typeof f.sources === 'number' ? f.sources : null;
};

/** 문서 상태 — 옛 실측(이 필드가 없던 시절)은 문서 유무로 되돌려 읽는다. */
const docState = (ctx: PluginBubbleContext): string | null => {
  const f = facts(ctx);
  if (!f) return null;
  const raw = str(f.docState);
  if (raw !== '') return raw;
  return str(f.doc) === '' ? 'none' : 'ok';
};

/** 저장소 최근 변경보다 며칠 뒤처졌나. 못 잰 프로젝트(비-git 등)는 null. */
const driftDays = (ctx: PluginBubbleContext): number | null => {
  const f = facts(ctx);
  if (!f) return null;
  return typeof f.driftDays === 'number' ? f.driftDays : null;
};

const inspector = defineInspector({
  id: 'ssot-drift', i18nKey: 'ssotDrift', name: 'SSOT Drift', category: 'observability',
  // v4.65 — `brain` 을 뺐다. 카드가 세는 것이 **집행 실측**으로 바뀌면서 기억 수를 읽지 않게 됐고,
  //   안 읽는 축을 선언해 두면 버블마다 쓸모없는 구독이 붙는다(`needs.test.ts` 가 이것을 잡는다).
  needs: ['pluginFacts'],
  // v4.67 — 실측이 **프로젝트 단위**라 표시 조건도 프로젝트 단위여야 한다. 골격 기본값은 "설정이 있는
  //   에이전트 버블"이라, 설정 없는 버블(훅으로 붙은 세션)에서는 켜 두고도 카드가 안 보였다.
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const n = sourceCount(ctx);
    // 아직 안 재봤으면 좋다고도 나쁘다고도 말하지 않는다 — 없는 값을 판정으로 바꾸면 그게 곧 거짓말이다.
    if (n === null) return { key: 'unmeasured', tone: 'neutral' };
    const state = docState(ctx);
    if (state === 'configMissing') return { key: 'configMissing', tone: 'bad' };
    if (state === 'thin') return { key: 'thin', tone: 'warn' };
    if (state === 'none' || !ssotDoc(ctx)) return { key: 'noDoc', tone: 'warn' };
    if (facts(ctx)?.stale === true) return { key: 'stale', tone: 'warn' };
    return n <= 1 ? { key: 'single', tone: 'good' } : n === 2 ? { key: 'two', tone: 'neutral' } : { key: 'many', tone: 'warn' };
  },
  checks: [
    {
      key: 'doc',
      value: (ctx) => {
        const doc = ssotDoc(ctx);
        if (doc === null) return ctx.t('panel.plugins.ssotDrift.notMeasured');
        if (doc !== '') return doc;
        // 지정해 놓고 그 자리에 파일이 없는 상태는 "못 찾음"과 다르다 — 지정한 경로를 그대로 보여 준다.
        const configured = str(facts(ctx)?.configured);
        return configured !== ''
          ? ctx.t('panel.plugins.ssotDrift.configuredMissing', { path: configured })
          : ctx.t('panel.plugins.ssotDrift.noneFound');
      },
      tone: (ctx) => (ssotDoc(ctx) === '' ? 'warn' : 'neutral'),
    },
    {
      // v4.67 — "있음"과 "내용이 있음"은 다르다. 빈 문서가 초록으로 통과하던 자리.
      key: 'docState',
      value: (ctx) => {
        const state = docState(ctx);
        if (state === null) return ctx.t('panel.plugins.ssotDrift.notMeasured');
        const f = facts(ctx);
        const chars = typeof f?.bodyChars === 'number' ? f.bodyChars : 0;
        if (state === 'ok') return ctx.t('panel.plugins.ssotDrift.state.ok', { chars });
        if (state === 'thin') return ctx.t('panel.plugins.ssotDrift.state.thin', { chars });
        if (state === 'configMissing') return ctx.t('panel.plugins.ssotDrift.state.configMissing');
        return ctx.t('panel.plugins.ssotDrift.state.none');
      },
      tone: (ctx) => {
        const state = docState(ctx);
        if (state === 'configMissing') return 'bad';
        return state === 'ok' ? 'good' : state === null ? 'neutral' : 'warn';
      },
    },
    {
      key: 'sources',
      value: (ctx) => {
        const n = sourceCount(ctx);
        return n === null ? ctx.t('panel.plugins.ssotDrift.notMeasured') : String(n);
      },
      tone: (ctx) => ((sourceCount(ctx) ?? 0) >= 3 ? 'warn' : 'neutral'),
    },
    {
      key: 'rivals',
      value: (ctx) => {
        const f = facts(ctx);
        if (!f) return ctx.t('panel.plugins.ssotDrift.notMeasured');
        const rivals = list(f.rivals);
        const aligned = list(f.alignedRivals);
        // 종속을 명시해 해소된 문서는 경고에서 빠지되 **사라지지는 않는다** — 사용자가 자기가 끈 경고를
        // 확인할 수 있어야 "왜 줄었지"가 안 생긴다.
        const alignedNote = aligned.length > 0 ? ` · ${ctx.t('panel.plugins.ssotDrift.aligned', { count: aligned.length })}` : '';
        return rivals.length === 0
          ? `${ctx.t('panel.plugins.ssotDrift.no')}${alignedNote}`
          : `${rivals.join(' · ')}${alignedNote}`;
      },
      tone: (ctx) => (list(facts(ctx)?.rivals).length > 0 ? 'warn' : 'neutral'),
    },
    {
      key: 'changeLog',
      value: (ctx) => {
        const f = facts(ctx);
        if (!f) return ctx.t('panel.plugins.ssotDrift.notMeasured');
        return f.hasChangeLog === true ? ctx.t('panel.plugins.ssotDrift.yes') : ctx.t('panel.plugins.ssotDrift.no');
      },
    },
    {
      // v4.67 — 이름이 Drift 인데 어긋남을 재는 행이 없었다. 문서 갱신이 저장소 활동보다 얼마나
      //   뒤처졌는지가 이 카드가 원래 재야 했던 값이다.
      key: 'drift',
      value: (ctx) => {
        const f = facts(ctx);
        if (!f) return ctx.t('panel.plugins.ssotDrift.notMeasured');
        const days = driftDays(ctx);
        // git 저장소가 아니거나 문서가 없으면 잴 근거 자체가 없다 — 0일이라고 그리면 거짓이 된다.
        if (days === null) return ctx.t('panel.plugins.ssotDrift.drift.unknown');
        return f.stale === true
          ? ctx.t('panel.plugins.ssotDrift.drift.behind', { days })
          : ctx.t('panel.plugins.ssotDrift.drift.fresh', { days });
      },
      tone: (ctx) => (facts(ctx)?.stale === true ? 'warn' : 'neutral'),
    },
  ],
  noteKey: () => '.note',
  // v4.67 — 켠 프로젝트에서 **정본 문서를 직접 지정**하는 자리(없으면 만들어 준다).
  settings: (ctx) => <SsotDriftSettings {...ctx} />,
});

export const ssotDriftManifest = inspector.manifest;
export const ssotDriftClient = inspector.client;
