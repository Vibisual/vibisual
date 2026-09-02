import { describe, it, expect } from 'vitest';
import {
  resolveStatusBarContext, resolveStatusBarModel, resolveStatusBarUsage,
} from './statusBarContext.js';

/**
 * §5.5 — 상태바 한 줄의 **주어가 하나**이고, **칸이 사라지지 않는다**는 회귀.
 *
 * 되돌아가기 쉬운 자리라 고정한다. 세 번 무너졌다:
 * ① `agent.contextUsed` 만 그리던 시절 — 서버가 버블에 채우는 "가장 최근에 움직인 sub" 가
 *    스냅샷마다 바뀌며 숫자가 세션들 사이를 뛰었다.
 * ② 그 뒤 칸마다 `activeSession?.X ?? agent.X` 로 폴백을 걸던 시절 — 고른 세션이 값을 아직
 *    안 가졌으면 조용히 버블 값으로 굴러떨어져, 방금 연 세션 넷을 오가도 `입력 1267.2M`
 *    (= 24개 세션 합계)이 넷 다 똑같이 떴다("세션을 넘겨도 안 변한다").
 * ③ 폴백을 걷어낸 뒤 — 값이 없는 순간마다 칸이 **언마운트**돼 옆 칸이 밀렸다 되돌아왔다
 *    ("간헐적으로 아래 내용이 사라진다"). 이제 모르면 `0` 을 그리고 칸은 남는다.
 * 한 줄만 되돌려도 셋 중 하나가 그대로 돌아온다.
 */
describe('resolveStatusBarContext', () => {
  it('세션이 자기 컨텍스트를 갖고 있으면 세션 값을 쓴다 (버블 값은 무시)', () => {
    expect(resolveStatusBarContext(
      { contextUsed: 284_000, contextMax: 1_000_000 },
      { contextUsed: 76_000, contextMax: 1_000_000 },
    )).toEqual({ used: 76_000, max: 1_000_000 });
  });

  it('세션이 여럿 돌아 버블 값이 흔들려도 보고 있는 세션 값은 그대로다', () => {
    const session = { contextUsed: 50_000, contextMax: 1_000_000 };
    // 서버가 매 스냅샷 다른 sub 로 채워 넣는 버블 값(76K → 284K → 111K …).
    for (const jitter of [76_000, 284_000, 111_000, 220_000]) {
      expect(resolveStatusBarContext({ contextUsed: jitter, contextMax: 1_000_000 }, session))
        .toEqual({ used: 50_000, max: 1_000_000 });
    }
  });

  it('세션을 골랐는데 그 세션이 컨텍스트를 모르면 버블 값으로 채우지 않는다', () => {
    // ← 종전에는 여기서 버블 값(153K)으로 물러났다. 그게 "세션을 넘겨도 안 변한다"의 절반이었다.
    expect(resolveStatusBarContext(
      { contextUsed: 153_000, contextMax: 1_000_000 },
      { contextUsed: undefined, contextMax: undefined },
    )).toEqual({ used: 0, max: 0 });
  });

  it('실측이 없으면 그 모델의 창 크기로 칸을 채운다 — 창 크기는 세션이 아니라 모델의 성질이다', () => {
    expect(resolveStatusBarContext({ contextUsed: 153_000, contextMax: 1_000_000 }, {}, 1_000_000))
      .toEqual({ used: 0, max: 1_000_000 });
    // 모델조차 몰라 폴백이 0 이면 지어내지 않는다.
    expect(resolveStatusBarContext({}, {}, 0)).toEqual({ used: 0, max: 0 });
  });

  it('never null — 값이 없다고 칸을 지우지 않는다 (줄이 흔들린다)', () => {
    expect(resolveStatusBarContext({}, {})).toEqual({ used: 0, max: 0 });
    expect(resolveStatusBarContext({}, null)).toEqual({ used: 0, max: 0 });
    expect(resolveStatusBarContext({}, undefined)).toEqual({ used: 0, max: 0 });
  });

  it('선택된 세션이 없으면(훅 버블 메인 탭 등) 버블 값을 쓴다', () => {
    expect(resolveStatusBarContext({ contextUsed: 42_000, contextMax: 200_000 }, null))
      .toEqual({ used: 42_000, max: 200_000 });
    expect(resolveStatusBarContext({ contextUsed: 42_000, contextMax: 200_000 }, undefined))
      .toEqual({ used: 42_000, max: 200_000 });
  });

  it('used/max 를 섞지 않는다 — 세션을 골랐으면 max 도 세션 것이다', () => {
    // 모델이 다르면 창 크기도 다르다(1M vs 200K). 섞으면 비율이 거짓이 된다.
    expect(resolveStatusBarContext(
      { contextUsed: 900_000, contextMax: 1_000_000 },
      { contextUsed: 150_000, contextMax: 200_000 },
    )).toEqual({ used: 150_000, max: 200_000 });
  });

  it('세션이 아직 한 턴도 안 돌아 used 가 없으면 0 으로 그린다 (칸은 남는다)', () => {
    expect(resolveStatusBarContext(
      { contextUsed: 284_000, contextMax: 1_000_000 },
      { contextMax: 1_000_000 },
    )).toEqual({ used: 0, max: 1_000_000 });
  });

  it('창 크기를 못 잰 값(0)은 "있다"로 치지 않는다', () => {
    // 세션 쪽 0 → 세션을 골랐으므로 버블로 굴러떨어지지 않고, 폴백(모델 창)으로 간다.
    expect(resolveStatusBarContext(
      { contextUsed: 10_000, contextMax: 200_000 },
      { contextUsed: 5_000, contextMax: 0 },
      200_000,
    )).toEqual({ used: 0, max: 200_000 });
  });
});

describe('resolveStatusBarModel', () => {
  it('세션의 실측 모델이 1순위', () => {
    expect(resolveStatusBarModel(
      { modelName: 'claude-opus-5' },
      { modelName: 'claude-sonnet-5' },
      'claude-haiku-4-5',
    )).toBe('claude-sonnet-5');
  });

  it('한 턴도 안 돈 세션은 이 에이전트에 설정된 모델 — 다른 세션의 실측 모델 ❌', () => {
    expect(resolveStatusBarModel({ modelName: 'claude-opus-5' }, {}, 'claude-haiku-4-5'))
      .toBe('claude-haiku-4-5');
    // 설정도 모르면 undefined — 호출부가 "모름"을 적는다(버블 모델을 빌려오지 않는다).
    expect(resolveStatusBarModel({ modelName: 'claude-opus-5' }, {})).toBeUndefined();
  });

  it('세션을 안 골랐으면 버블 모델', () => {
    expect(resolveStatusBarModel({ modelName: 'claude-opus-5' }, null)).toBe('claude-opus-5');
  });
});

describe('resolveStatusBarUsage', () => {
  /** 실제 보고 화면의 값 — 24개 세션을 가진 커스텀 버블. */
  const bubble = {
    modelName: 'claude-opus-5',
    contextUsed: 157_000,
    contextMax: 1_000_000,
    totalInputTokens: 1_267_200_000,
    totalOutputTokens: 7_400_000,
  };

  it('세션을 고르면 토큰도 그 세션 것이다', () => {
    const session = {
      modelName: 'claude-sonnet-5',
      contextUsed: 50_000,
      contextMax: 200_000,
      totalInputTokens: 9_733_989,
      totalOutputTokens: 63_663,
    };
    expect(resolveStatusBarUsage(bubble, session)).toEqual({
      scope: 'session',
      model: 'claude-sonnet-5',
      context: { used: 50_000, max: 200_000 },
      inputTokens: 9_733_989,
      outputTokens: 63_663,
    });
  });

  it('갓 연 세션 넷을 오가도 24개 세션 합계(1267.2M)가 뜨지 않는다 — 0 이 정답이다', () => {
    // 사용자 보고 재현: 방금 만든 탭들은 아직 JSONL 이 없어 토큰이 비어 있다.
    for (const fresh of [{}, { modelName: undefined }, { totalInputTokens: undefined }]) {
      const usage = resolveStatusBarUsage(bubble, fresh);
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.scope).toBe('session');
    }
  });

  it('아무것도 모르는 세션도 칸은 전부 남는다 — 컨텍스트는 0/0, 토큰은 0', () => {
    const usage = resolveStatusBarUsage({}, {});
    expect(usage.context).toEqual({ used: 0, max: 0 });
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
    expect(usage.model).toBeUndefined();
  });

  it('창 크기 폴백을 주면 첫 턴 전에도 0/1.0M 이 뜬다', () => {
    const usage = resolveStatusBarUsage(bubble, {}, {
      configuredModel: 'claude-opus-5',
      fallbackContextMax: 1_000_000,
    });
    expect(usage.model).toBe('claude-opus-5');
    expect(usage.context).toEqual({ used: 0, max: 1_000_000 });
  });

  it('세션을 안 골랐으면(훅 버블) 종전대로 버블 값을 그린다', () => {
    expect(resolveStatusBarUsage(bubble, null)).toEqual({
      scope: 'agent',
      model: 'claude-opus-5',
      context: { used: 157_000, max: 1_000_000 },
      inputTokens: 1_267_200_000,
      outputTokens: 7_400_000,
    });
  });
});
