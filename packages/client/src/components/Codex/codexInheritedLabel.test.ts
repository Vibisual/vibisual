/**
 * §5.25 (G-2) — 비워 둔 칸의 선택지 문구 고정 시험. 번역 대신 키와 인자를 그대로 돌려주는 가짜 t 로
 * "어느 키를 어떤 값으로 부르는가"만 본다.
 */
import { describe, it, expect } from 'vitest';
import type { TranslateFn } from '../../formatSince.js';
import { codexInheritedOption } from './codexInheritedLabel.js';

const t: TranslateFn = (key, opts) => {
  const args = { ...(opts ?? {}) };
  delete args['defaultValue'];
  return Object.keys(args).length ? `${key}${JSON.stringify(args)}` : key;
};

describe('codexInheritedOption', () => {
  it('파일에서 읽은 값은 같은 칸의 선택지 이름 + 출처, 설명은 경로', () => {
    expect(codexInheritedOption(t, 'webSearch', { kind: 'layer', value: 'live', source: 'user', path: '/h/config.toml' })).toEqual({
      label: 'panel.agentConfig.effective.resolved{"value":"panel.agentConfig.codex.webSearch.live","source":"panel.agentConfig.codex.source.user"}',
      description: 'panel.agentConfig.codex.sourceTip.layer{"path":"/h/config.toml"}',
    });
  });

  it('강도는 모델이 신고한 단계 이름을 그대로 쓴다', () => {
    expect(codexInheritedOption(t, 'reasoningEffort', { kind: 'model', value: 'xhigh' }).label)
      .toBe('panel.agentConfig.effective.resolved{"value":"xhigh","source":"panel.agentConfig.codex.source.model"}');
  });

  it('프로필은 이름을 싣는다', () => {
    const out = codexInheritedOption(t, 'networkAccess', { kind: 'layer', value: 'true', source: 'profile', profile: 'deep', path: '/h/c.toml' });
    expect(out.label).toContain('panel.agentConfig.codex.source.profile');
    expect(out.label).toContain('deep');
    expect(out.label).toContain('panel.agentConfig.codex.network.true');
    expect(out.description).toBe('panel.agentConfig.codex.sourceTip.profile{"path":"/h/c.toml","name":"deep"}');
  });

  it('값이 없는 상태는 값을 지어내지 않는다', () => {
    expect(codexInheritedOption(t, 'modelVerbosity', { kind: 'unsupported' }).label).toBe('panel.agentConfig.codex.unsupported');
    expect(codexInheritedOption(t, 'reasoningEffort', { kind: 'loading' }).label).toBe('panel.options.account.checking');
    expect(codexInheritedOption(t, 'reasoningEffort', { kind: 'unresolved' }).label).toBe('panel.agentConfig.effective.unknown');
  });
});
