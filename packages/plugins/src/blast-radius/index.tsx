/**
 * §5.11 v3.88 — 폭발 반경(Blast Radius) 플러그인.
 *
 * "이 에이전트가 완전히 장악되면 무엇에 접근하고, 무엇을 바꾸고, 어디로 보낼 수 있는가"를 열거하면
 * 그게 곧 반경이다. 치명적 3요소가 **경로가 성립하는가**를 본다면, 여기서는 **성립했을 때 얼마나 큰가**를 본다.
 *
 * 치명적 3요소와 달리 여기서는 **격리(worktree)를 감쇄로 반영한다** — 반경은 "피해 범위"의 척도이고
 * 격리는 그 범위를 실제로 좁히기 때문. 3요소 판정에서 격리를 분리한 규칙과 모순이 아니라 역할이 다르다.
 */
import type { AgentConfig } from '@vibisual/shared';
import type { PluginClientModule, PluginBubbleContext, PluginManifest, PluginSeverity } from '../types.js';
import { effectiveTools } from '../lethal-trifecta/trifecta.js';
import { PluginSection, PluginRow, type PluginTone } from '../ui/kit.js';

export const blastRadiusManifest: PluginManifest = {
  id: 'blast-radius',
  name: 'Blast Radius',
  version: '1.0.0',
  category: 'security',
  descriptionKey: 'panel.plugins.blastRadius.desc',
  enabledByDefault: false,
  contributes: ['panelSection'],
  clientOnly: true,
};

const K = 'panel.plugins.blastRadius';

/*
 * **배지를 달지 않는다.** `Bash` 는 잠긴 도구라 어떤 설정에서도 유효 도구에 남고, 그 하나가
 * `canExecute` 와 `canSend` 를 동시에 켠다. 그래서 읽기 도구가 하나라도 있으면 점수가 3 이상이 되어
 * **모든 에이전트가 '큼'으로 판정된다** — 판정 자체는 사실이지만, 모든 버블에 똑같이 붙는 배지는
 * 버블을 구분해 주지 못한다. 값은 패널 카드에서 그대로 보여 준다.
 */

export interface BlastRadiusVerdict {
  canRead: boolean;
  canWrite: boolean;
  canExecute: boolean;
  canSend: boolean;
  isolated: boolean;
  /** 0~4. 격리면 1 깎는다(0 미만으로는 안 내려간다). */
  score: number;
  level: 'small' | 'medium' | 'large';
}

export function judgeBlastRadius(config: AgentConfig | undefined): BlastRadiusVerdict {
  const tools = effectiveTools(config);
  const canRead = ['Read', 'Grep', 'Glob'].some((t) => tools.has(t));
  const canWrite = ['Write', 'Edit', 'NotebookEdit'].some((t) => tools.has(t));
  const canExecute = tools.has('Bash');
  const canSend = ['WebFetch', 'Bash'].some((t) => tools.has(t));
  const isolated = config?.isolation === 'worktree';

  const raw = [canRead, canWrite, canExecute, canSend].filter(Boolean).length;
  const score = Math.max(0, raw - (isolated ? 1 : 0));
  const level: BlastRadiusVerdict['level'] = score <= 1 ? 'small' : score <= 2 ? 'medium' : 'large';

  return { canRead, canWrite, canExecute, canSend, isolated, score, level };
}

const TONE: Record<BlastRadiusVerdict['level'], PluginTone> = { small: 'good', medium: 'warn', large: 'bad' };

function judgeable(ctx: PluginBubbleContext): boolean {
  return ctx.bubbleType === 'agent' && ctx.agentConfig !== undefined;
}

/**
 * 호스트는 카드 내용을 열어 보지 않고 이 등급만으로 정렬·접힘을 정한다. 등급을 안 주면 `neutral` 로 떨어져
 * **문제를 보고하는 순간에도 조용한 카드로 분류돼 접힘 대상이 된다.** 카드가 이미 계산해 둔 판정을 그대로 넘긴다.
 */
function severity(ctx: PluginBubbleContext): PluginSeverity {
  return TONE[judgeBlastRadius(ctx.agentConfig).level];
}

function Section({ ctx }: { ctx: PluginBubbleContext }): React.JSX.Element {
  const { t } = ctx;
  const v = judgeBlastRadius(ctx.agentConfig);
  const yn = (on: boolean): string => (on ? t(`${K}.yes`) : t(`${K}.no`));
  return (
    <PluginSection
      title={t(`${K}.heading`)}
      status={t(`${K}.level.${v.level}`)}
      tone={TONE[v.level]}
      note={v.isolated ? t(`${K}.isolatedNote`) : t(`${K}.narrowHint`)}
    >
      <PluginRow label={t(`${K}.row.read`)} value={yn(v.canRead)} tone={v.canRead ? 'neutral' : 'good'} />
      <PluginRow label={t(`${K}.row.write`)} value={yn(v.canWrite)} tone={v.canWrite ? 'warn' : 'good'} />
      <PluginRow label={t(`${K}.row.execute`)} value={yn(v.canExecute)} tone={v.canExecute ? 'warn' : 'good'} />
      <PluginRow label={t(`${K}.row.send`)} value={yn(v.canSend)} tone={v.canSend ? 'bad' : 'good'} />
    </PluginSection>
  );
}

export const blastRadiusClient: PluginClientModule = {
  manifest: blastRadiusManifest,
  usage: {
    i18nKey: 'blastRadius',
    checkKeys: ['row.read', 'row.write', 'row.execute', 'row.send'],
    badgeIsConditional: false,
  },
  panelSections: [{ key: 'radius', match: judgeable, severity, render: (ctx) => <Section ctx={ctx} /> }],
};
