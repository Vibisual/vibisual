/**
 * §5.11 v3.99 — 커밋 전 관문(Pre-commit Gate): 되돌릴 수 없는 것은 사전에 막는다.
 *
 * 에이전트는 커밋을 쉽게, 자주 한다. 사후 리뷰보다 사전 차단이 훨씬 싸고, 특히 **비밀 정보 유출은 푸시된
 * 순간 노출**이라 사후 대응이 성립하지 않는 유일한 범주다. 우회 가능한 형태로 두면 관문이 아니다.
 * Vibisual 저장소는 커밋 훅에서 사설 파일·내용 검사를 돌린다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const canCommit = (ctx: PluginBubbleContext): boolean => effectiveTools(ctx.agentConfig).has('Bash');

const inspector = defineInspector({
  id: 'pre-commit-gate', i18nKey: 'preCommitGate', name: 'Pre-commit Gate', category: 'workflow',
  status: (ctx) => (canCommit(ctx) ? { key: 'gated', tone: 'neutral' } : { key: 'cannot', tone: 'good' }),
  checks: [
    {
      key: 'canCommit',
      value: (ctx) => ctx.t(`panel.plugins.preCommitGate.${canCommit(ctx) ? 'yes' : 'no'}`),
      tone: (ctx) => (canCommit(ctx) ? 'neutral' : 'good'),
    },
    { key: 'gate', value: (ctx) => ctx.t('panel.plugins.preCommitGate.repoHook'), tone: () => 'good' },
  ],
  noteKey: () => '.note',
});

export const preCommitGateManifest = inspector.manifest;
export const preCommitGateClient = inspector.client;
