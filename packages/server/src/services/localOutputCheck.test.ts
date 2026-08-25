/**
 * §5.19 (E) 받은 모델이 실제로 말을 하는지 — 깨진 출력 판별 테스트.
 *
 * 회귀 방지 대상 — 2026-08-21 실측. 파일은 온전하고 엔진도 읽어 들이는데
 * `Qwen3.5-9B-IQ4_XS.gguf` 는 뜻 없는 글자만 뱉었다. 사용자는 5GB 를 받고 프롬프트를 친
 * 뒤에야 그 사실을 알았다 — 그것도 "빈 말풍선 + 완료" 라는 아무 설명 없는 모습으로.
 *
 * **깨진 것은 구조가 아니라 그 파일이었다** — 같은 `qwen35` 구조의 공식 Q4_K_M 양자화
 * (`Qwen3.8-27B-UD-Q4_K_M`)는 같은 빌드에서 멀쩡히 답한다. 그래서 이 점검의 단위는
 * **구조가 아니라 파일**이고, 그 판정은 `.output-check.json` 에 파일 단위로 남는다.
 *
 * 아래 문자열은 전부 **그때 실제로 받아 본 출력**이다. 조건은 둘 —
 * **깨진 것은 반드시 잡을 것**, 그리고 **멀쩡한 답을 잘못 잡지 말 것**(오탐이 나면
 * 정상 모델에 "못 씁니다" 딱지가 붙는다).
 */
import { describe, it, expect } from 'vitest';
import { looksDegenerate } from './localRunner.js';

/** Vulkan 에서 받은 것 — 한 글자만 되풀이. */
const REPEATED_QUESTION = '?'.repeat(24);
/** CPU 원시 생성에서 받은 것. */
const REPEATED_G = 'G'.repeat(24);
/** CPU 채팅에서 받은 것 — 글자 종류는 많지만 낱말이 없다. */
const SYMBOL_SOUP =
  '<=@F75D=4:)%B!52F%"!(!3:-8C(40/)D\'*0%007>&58;F1&/F1-:>"D@E&,G%C8"-.8C83D)%C3*04-62!A1.F67%34-F.H.1<C37B:E)8113(G8=H)1H.<\'$/-7<:';

// ─────────────────────────────────────────────────────────────
describe('looksDegenerate — 실제로 받아 본 깨진 출력', () => {
  it('한 글자만 되풀이하면 깨진 것이다', () => {
    expect(looksDegenerate(REPEATED_QUESTION)).toBe(true);
    expect(looksDegenerate(REPEATED_G)).toBe(true);
  });

  it('글자 종류가 많아도 낱말이 없으면 깨진 것이다 — 기호 나열', () => {
    expect(looksDegenerate(SYMBOL_SOUP)).toBe(true);
  });

  it('아무 말도 못 하면 깨진 것이다', () => {
    expect(looksDegenerate('')).toBe(true);
    expect(looksDegenerate('   ')).toBe(true);
    expect(looksDegenerate('ab')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
describe('looksDegenerate — 멀쩡한 답은 건드리지 않는다', () => {
  it('한국어 답 — 우리 러너로 실제로 받은 문장', () => {
    expect(looksDegenerate('2 더하기 3은 5입니다.')).toBe(false);
  });

  it('영어 답 — 대조 모델이 실제로 낸 문장', () => {
    expect(looksDegenerate('Hello! How can I assist you today?')).toBe(false);
    expect(looksDegenerate(' Paris. It is the largest city in Europe and the second largest in the world')).toBe(false);
  });

  it('긴 영어 문단', () => {
    expect(
      looksDegenerate(
        'Two plus three equals five. This is a basic arithmetic fact that holds in the ordinary integers, and it is one of the first things children learn.',
      ),
    ).toBe(false);
  });

  it('중국어·일본어 답', () => {
    expect(looksDegenerate('二加三等于五。这是一个非常基本的算术问题，答案是五。')).toBe(false);
    expect(looksDegenerate('二たす三は五です。とても簡単な計算ですね、はい。')).toBe(false);
  });

  it('코드 답 — 기호가 많아도 낱말과 띄어쓰기가 있다', () => {
    expect(looksDegenerate('const sum = 2 + 3; // sum is 5, printed below\nconsole.log(sum);')).toBe(false);
  });

  it('대문자로만 답해도 잡지 않는다 — 띄어쓰기가 있으면 사람 말이다', () => {
    expect(looksDegenerate('YES, TWO PLUS THREE EQUALS FIVE. THAT IS THE ANSWER TO YOUR QUESTION.')).toBe(false);
  });

  it('짧고 멀쩡한 답도 그대로 통과', () => {
    expect(looksDegenerate('5')).toBe(true); // 너무 짧아 판단 불가 — 보수적으로 깨진 쪽
    expect(looksDegenerate('답은 5입니다')).toBe(false);
  });
});
