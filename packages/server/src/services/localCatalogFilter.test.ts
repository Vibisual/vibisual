/** §5.19 (E) — 대화 못 하는 모델은 안 내놓는다. **화이트리스트는 더 나쁘다**(실측: `pipeline_tag=text-generation` 은 인기 40건 중 6건 — 잘 도는 모델이 사라진다). 아니라고 밝힌 것만 빼고 모르면 둔다. */
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
