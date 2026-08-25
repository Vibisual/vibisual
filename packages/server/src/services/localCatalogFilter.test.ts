/**
 * §5.19 (E) 받기 목록 — 대화가 안 되는 모델을 애초에 안 내놓는다.
 *
 * 회귀 방지 대상 — 2026-08-21. 새로 설치한 사용자가 목록에서 `nvidia/parakeet-ctc-1.1b`
 * (음성인식 모델)을 받아 1.18GB 를 쓰고, 프롬프트를 친 뒤에야 "이건 대화 모델이 아니다"를
 * 알았다. 목록이 허깅페이스의 GGUF 를 그대로 내놓은 탓이다.
 *
 * **화이트리스트로 풀면 더 나빠진다(실측)**: `pipeline_tag=text-generation` 만 남기는 쪽을
 * 먼저 재 봤더니 인기 GGUF 40건 중 그 태그를 단 것이 6건뿐이었고, 정작 잘 도는
 * `unsloth/Qwen3.8-27B-GGUF`(태그 없음)·`Qwen3.6-35B-A3B`(`image-text-to-text`)·
 * `gemma-4-12B-it-qat`(`any-to-any`)가 통째로 사라졌다.
 *
 * 그래서 조건은 둘 — **아니라고 밝힌 것만 뺄 것**, 그리고 **모르면 막지 말 것**.
 */
import { describe, it, expect } from 'vitest';
import { isChatCapablePipelineTag, LOCAL_MODEL_NON_CHAT_PIPELINE_TAGS } from '@vibisual/shared';

describe('대화가 아닌 것만 뺀다', () => {
  it('음성인식은 뺀다 — 1.18GB 를 받고서야 알게 되던 자리', () => {
    expect(isChatCapablePipelineTag('automatic-speech-recognition')).toBe(false);
  });

  it('임베딩·리랭커도 뺀다 — 말을 하지 않는다', () => {
    expect(isChatCapablePipelineTag('feature-extraction')).toBe(false);
    expect(isChatCapablePipelineTag('sentence-similarity')).toBe(false);
    expect(isChatCapablePipelineTag('text-ranking')).toBe(false);
  });

  it('이미지·영상·음성 생성도 뺀다', () => {
    expect(isChatCapablePipelineTag('text-to-image')).toBe(false);
    expect(isChatCapablePipelineTag('image-to-video')).toBe(false);
    expect(isChatCapablePipelineTag('text-to-speech')).toBe(false);
  });

  it('목록에 오른 태그는 전부 거절된다 — 목록이 바뀌어도 이 규칙은 같다', () => {
    for (const tag of LOCAL_MODEL_NON_CHAT_PIPELINE_TAGS) {
      expect(isChatCapablePipelineTag(tag)).toBe(false);
    }
  });
});

describe('모르면 막지 않는다 — 화이트리스트로 뒤집으면 좋은 모델이 사라진다', () => {
  it('태그가 없으면 통과 — Qwen3.8-27B 이 이 경우다', () => {
    expect(isChatCapablePipelineTag(undefined)).toBe(true);
    expect(isChatCapablePipelineTag(null)).toBe(true);
    expect(isChatCapablePipelineTag('')).toBe(true);
  });

  it('멀티모달 대화 모델도 통과 — 이것들은 실제로 말을 한다', () => {
    // Qwen3.6-35B-A3B · gemma-4-26B 가 이 태그를 단다.
    expect(isChatCapablePipelineTag('image-text-to-text')).toBe(true);
    // gemma-4-12B-it-qat 가 이 태그를 단다.
    expect(isChatCapablePipelineTag('any-to-any')).toBe(true);
  });

  it('text-generation 은 당연히 통과', () => {
    expect(isChatCapablePipelineTag('text-generation')).toBe(true);
  });

  it('처음 보는 태그도 통과 — 넘겨짚어 막으면 그 계열이 통째로 사라진다', () => {
    expect(isChatCapablePipelineTag('some-future-task')).toBe(true);
  });
});
