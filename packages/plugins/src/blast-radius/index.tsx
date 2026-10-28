/**
 * §5.11 — 폭발 반경(Blast Radius): 장악되면 무엇에 접근·변경·전송할 수 있나 — 3요소가 경로의 성립을 본다면 여기서는 크기를 본다.
 * 격리(worktree)를 감쇄로 반영한다 — 반경은 피해 범위라 격리가 실제로 좁힌다(3요소 판정에서 격리를 뺀 것과 모순이 아니다).
 */
import type { PluginClientModule, PluginBubbleContext, PluginManifest, PluginSeverity } from '../sdk/index.js';
import { judgeBlastRadius, type BlastRadiusVerdict } from '../sdk/index.js';
import { PluginSection, PluginRow, type PluginTone } from '../sdk/index.js';

export const blastRadiusManifest: PluginManifest = {
  id: 'blast-radius',
  name: 'Blast Radius',
  version: '1.0.0',
  category: 'security',
  descriptionKey: 'panel.plugins.blastRadius.desc',
  enabledByDefault: false,
  contributes: ['panelSection', 'agentPrompt'],
  clientOnly: false,
};

const K = 'panel.plugins.blastRadius';

/*
 * 배지를 달지 않는다 — 잠긴 도구 `Bash` 가 늘 남아 `canExecute`·`canSend` 를 함께 켜므로, 읽기 도구가 하나만 있어도
 * 점수가 3 이상이 되어 모든 에이전트가 '큼'이 된다. 모든 버블에 같은 배지는 구분이 안 된다 — 값은 패널 카드에서 보여 준다.
 */

/* 판정(`judgeBlastRadius`)은 SDK 에 둔다 — 여러 카드(`containment`·`owasp-asi`)가 함께 쓰므로, 이 폴더에 두면 폴더 복사 시 남의 폴더가 딸려 와 자립 규약이 깨진다. */

const TONE: Record<BlastRadiusVerdict['level'], PluginTone> = { small: 'good', medium: 'warn', large: 'bad' };

function judgeable(ctx: PluginBubbleContext): boolean {
  return ctx.bubbleType === 'agent' && ctx.agentConfig !== undefined;
}

/** 호스트는 이 등급만으로 정렬·접힘을 정한다 — 안 주면 `neutral` 로 떨어져 문제를 보고할 때도 접힌다. */
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
