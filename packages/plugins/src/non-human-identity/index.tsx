/**
 * §5.11 — 비인간 신원(Non-Human Identity): 이 에이전트 하나만 즉시 끊을 수 있는가("전체를 끊어야 한다"면 신원 설계가 없다). 표시 전용.
 * 우리가 만든 커스텀 에이전트만 우리 소유 신원(버블 id + 자기 설정)을 갖는다 — 훅 외부 세션은 Claude Code 본체 소유라 끊을 손잡이가 없다.
 */
import { defineInspector } from '../sdk/index.js';

const K = 'panel.plugins.nonHumanIdentity';

const inspector = defineInspector({
  id: 'non-human-identity',
  i18nKey: 'nonHumanIdentity',
  name: 'Non-Human Identity',
  category: 'security',
  needs: ['subAgents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (ctx.customCreated ? { key: 'owned', tone: 'good' } : { key: 'external', tone: 'warn' }),
  checks: [
    { key: 'id', value: (ctx) => ctx.bubbleId },
    {
      key: 'owner',
      value: (ctx) => ctx.t(`${K}.${ctx.customCreated ? 'ours' : 'claudeCode'}`),
      tone: (ctx) => (ctx.customCreated ? 'good' : 'neutral'),
    },
    { key: 'sessions', value: (ctx) => String((ctx.data.subAgents ?? []).length) },
  ],
  noteKey: (ctx) => (ctx.customCreated ? '.noteOwned' : '.noteExternal'),
});

export const nonHumanIdentityManifest = inspector.manifest;
export const nonHumanIdentityClient = inspector.client;
