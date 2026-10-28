import { describe, expect, it } from 'vitest';
import { agentEngineOf, agentModelLabelOf, CODEX_DEFAULT_LABEL_RE } from '@vibisual/shared';

/**
 * §5.25 (J) — 버블이 자기 엔진의 모델을 말하는가. `config.model` 은 클로드 칸(기본 `opus`)이라 코덱스·로컬 버블에 적으면 남의 값이다.
 * 화면마다 따로 판정하면 잊은 자리(버블 idle 줄·IDE 상태바)가 `opus` 를 적는다 — 한 곳에 모은 판정을 여기서 못 박는다.
 */

const FALLBACKS = { codex: 'Codex', local: 'All Model' };

describe('§5.25 (J) agentModelLabelOf — 엔진이 자기 모델을 말한다', () => {
  it('코덱스 버블은 config.model(opus) 이 아니라 자기 모델을 말한다', () => {
    const label = agentModelLabelOf({
      model: 'opus',
      provider: { kind: 'codex-cli', modelId: 'gpt-reserve', modelName: 'GPT-Reserve' },
    }, FALLBACKS);

    expect(label).toBe('GPT-Reserve');
    // 회귀의 정체 — 여기 `opus` 가 나오면 GPT 버블이 자기를 클로드로 말하는 것이다.
    expect(label).not.toBe('opus');
  });

  it('모델을 아직 안 문 코덱스 버블은 엔진 이름을 말한다 (opus 로 떨어지지 않는다)', () => {
    const label = agentModelLabelOf({
      model: 'opus',
      provider: { kind: 'codex-cli', modelId: '' },
    }, FALLBACKS);

    expect(label).toBe('Codex');
    expect(label).not.toBe('opus');
  });

  it('modelName 이 없으면 modelId 가 그 자리를 잇는다', () => {
    const label = agentModelLabelOf({
      model: 'opus',
      provider: { kind: 'codex-cli', modelId: 'gpt-5-codex' },
    }, FALLBACKS);

    expect(label).toBe('gpt-5-codex');
  });

  it('로컬(All Model) 버블도 같은 규칙이다', () => {
    expect(agentModelLabelOf({
      model: 'opus',
      provider: { kind: 'local-llama', modelId: 'qwen-q4', modelName: 'Qwen Coder Q4' },
    }, FALLBACKS)).toBe('Qwen Coder Q4');

    expect(agentModelLabelOf({
      model: 'opus',
      provider: { kind: 'local-llama', modelId: '' },
    }, FALLBACKS)).toBe('All Model');
  });

  it('엔진 축이 없으면 종전대로 config.model 이다 (클로드 경로 무변경)', () => {
    expect(agentModelLabelOf({ model: 'opus' }, FALLBACKS)).toBe('opus');
    expect(agentModelLabelOf({ model: 'sonnet' }, FALLBACKS)).toBe('sonnet');
  });

  it('적을 것이 없으면 null 이다 — 훅 버블처럼 설정이 없는 자리', () => {
    expect(agentModelLabelOf(undefined, FALLBACKS)).toBeNull();
    expect(agentModelLabelOf(null, FALLBACKS)).toBeNull();
    expect(agentModelLabelOf({}, FALLBACKS)).toBeNull();
  });

  it('폴백 문구를 안 주면 null 이다 — 없는 이름을 지어내지 않는다', () => {
    expect(agentModelLabelOf({ model: 'opus', provider: { kind: 'codex-cli', modelId: '' } })).toBeNull();
  });
});

describe('§5.25 (B-1) agentModelLabelOf — CMD 버블은 셸에 채울 CLI 가 먼저다', () => {
  const CMD = 'interactive-terminal';

  it('Codex CMD 는 config.model(opus) 이 아니라 CLI 이름을 말한다', () => {
    expect(agentModelLabelOf({ model: 'opus', executionMode: CMD, cliKind: 'codex' }, FALLBACKS)).toBe('Codex CLI');
  });

  it('Claude CMD(cliKind 없음·claude)는 종전대로 config.model 이다', () => {
    expect(agentModelLabelOf({ model: 'opus', executionMode: CMD }, FALLBACKS)).toBe('opus');
    expect(agentModelLabelOf({ model: 'opus', executionMode: CMD, cliKind: 'claude' }, FALLBACKS)).toBe('opus');
  });

  it('순수 셸은 적을 모델이 없다', () => {
    expect(agentModelLabelOf({ model: 'opus', executionMode: CMD, cliKind: 'shell' }, FALLBACKS)).toBeNull();
  });

  it('헤드리스로 되돌린 버블에 남은 cliKind 는 클로드 모델을 가리지 않는다', () => {
    expect(agentModelLabelOf({ model: 'sonnet', executionMode: 'headless', cliKind: 'codex' }, FALLBACKS)).toBe('sonnet');
    expect(agentModelLabelOf({ model: 'sonnet', cliKind: 'codex' }, FALLBACKS)).toBe('sonnet');
  });
});

/* §5.25 (B-1) · (M-1) — "실제로 도는 엔진" 판정. 서버가 cliKind 만·화면이 공급자만 보면 Codex CMD 스킬 칸이 거절되고 클로드 비용을 코덱스 원장에서 찾는다. */
describe('§5.25 (M-1) agentEngineOf — 터미널이 띄우는 CLI 가 먼저, cliKind 는 CMD 에서만', () => {
  it('Codex CMD 는 공급자 칸이 비어 있어도 코덱스다', () => {
    expect(agentEngineOf({ executionMode: 'interactive-terminal', cliKind: 'codex' })).toBe('codex');
  });

  it('헤드리스로 되돌린 버블에 남은 cliKind 는 읽지 않는다', () => {
    expect(agentEngineOf({ executionMode: 'headless', cliKind: 'codex' })).toBe('claude');
    expect(agentEngineOf({ cliKind: 'codex' })).toBe('claude');
  });

  it('CMD 가 아니면 공급자가 엔진이다', () => {
    expect(agentEngineOf({ provider: { kind: 'codex-cli', modelId: '' } })).toBe('codex');
    expect(agentEngineOf({ provider: { kind: 'local-llama', modelId: '' } })).toBe('local');
    expect(agentEngineOf({})).toBe('claude');
    expect(agentEngineOf(undefined)).toBe('claude');
  });

  it('코덱스가 아닌 CLI 의 CMD 는 종전대로 공급자를 따른다', () => {
    expect(agentEngineOf({ executionMode: 'interactive-terminal', cliKind: 'gemini' })).toBe('claude');
    expect(agentEngineOf({ executionMode: 'interactive-terminal' })).toBe('claude');
    expect(agentEngineOf({ executionMode: 'interactive-terminal', provider: { kind: 'codex-cli', modelId: '' } })).toBe('codex');
  });
});

describe('§5.25 (B) CODEX_DEFAULT_LABEL_RE — 이름 바꾼 뒤에도 옛 버블을 안 버린다', () => {
  it('새 기본 이름(Codex Agent 3)과 옛 기본 이름(Codex 3) 둘 다 받는다', () => {
    expect(CODEX_DEFAULT_LABEL_RE.test('Codex Agent 3')).toBe(true);
    expect(CODEX_DEFAULT_LABEL_RE.test('Codex 3')).toBe(true);
  });

  it('사용자가 직접 지은 이름은 걸리지 않는다', () => {
    expect(CODEX_DEFAULT_LABEL_RE.test('GPT-Reserve')).toBe(false);
    expect(CODEX_DEFAULT_LABEL_RE.test('Codex 리뷰어')).toBe(false);
    expect(CODEX_DEFAULT_LABEL_RE.test('내 Codex 3')).toBe(false);
  });
});
