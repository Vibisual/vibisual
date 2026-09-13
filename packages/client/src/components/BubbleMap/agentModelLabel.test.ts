import { describe, expect, it } from 'vitest';
import { agentModelLabelOf, CODEX_DEFAULT_LABEL_RE } from '@vibisual/shared';

/**
 * §5.25 (J) — **"이 버블은 어느 모델로 도는가"의 회귀.**
 *
 * `AgentConfig.model` 은 클로드 칸이고 기본값이 `opus` 다. 엔진을 안 보고 그대로 적으면
 * 코덱스·로컬 버블이 자기를 클로드로 말한다 — 사용자 보고가 정확히 그것이었다
 * ("GPT 에이전트 버블인데 왜 이름에 opus 가 뜨냐"). `config.model` 은 코덱스·로컬 턴이
 * 읽지도 않는 칸이라 거짓이 아니라 **남의 값**이다.
 *
 * 종전에는 화면마다 `localProviderOf`/`codexProviderOf` 를 각자 부르는 구조였고, 그 둘을
 * 부르는 것을 잊은 자리(버블 하단 idle 줄 · IDE 상태바)가 그대로 `opus` 를 적었다.
 * 판정을 한 곳으로 모은 뒤, 그 한 곳을 여기서 못 박는다.
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
