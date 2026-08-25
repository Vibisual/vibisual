import { describe, expect, it } from 'vitest';
import type { AgentProvider } from '@vibisual/shared';
import { LOCAL_CONTEXT_MAX, LOCAL_CONTEXT_MIN } from '@vibisual/shared';

import { applyLocalProviderDraft } from './localProviderPayload.js';

/** 왕복이 갱신해 둔 값이 들어 있는 "지금" 프로바이더. */
const live = (): AgentProvider => ({
  kind: 'local-llama',
  modelId: 'ornith-1.0-9b-q4-k-m',
  modelName: 'ornith-1.0-9B-Q4_K_M',
  contextSize: 16384,
  temperature: 0.7,
  toolSupport: 'none',
  contextUsed: 12043,
  contextLimit: 16384,
  tokensIn: 128_000,
  tokensOut: 9_400,
});

describe('applyLocalProviderDraft', () => {
  it('대화 창 크기를 허용 범위로 가둔다', () => {
    expect(applyLocalProviderDraft(live(), {
      contextDraft: '1', temperatureDraft: '', retryToolSupport: false,
    }).contextSize).toBe(LOCAL_CONTEXT_MIN);

    expect(applyLocalProviderDraft(live(), {
      contextDraft: '999999999', temperatureDraft: '', retryToolSupport: false,
    }).contextSize).toBe(LOCAL_CONTEXT_MAX);

    expect(applyLocalProviderDraft(live(), {
      contextDraft: '32768.4', temperatureDraft: '', retryToolSupport: false,
    }).contextSize).toBe(32768);
  });

  it('빈 칸·숫자가 아닌 입력은 미설정(엔진 기본값)으로 떨어뜨린다', () => {
    for (const contextDraft of ['', '   ', 'abc', '0', '-4096']) {
      expect(applyLocalProviderDraft(live(), {
        contextDraft, temperatureDraft: '', retryToolSupport: false,
      }).contextSize).toBeUndefined();
    }
  });

  it('온도는 빈 칸이면 미설정이지만 0 은 사용자가 정한 값이라 살아남는다', () => {
    expect(applyLocalProviderDraft(live(), {
      contextDraft: '16384', temperatureDraft: '', retryToolSupport: false,
    }).temperature).toBeUndefined();

    expect(applyLocalProviderDraft(live(), {
      contextDraft: '16384', temperatureDraft: '0', retryToolSupport: false,
    }).temperature).toBe(0);

    expect(applyLocalProviderDraft(live(), {
      contextDraft: '16384', temperatureDraft: ' 0.35 ', retryToolSupport: false,
    }).temperature).toBe(0.35);
  });

  it('[다시 확인] 을 누른 저장만 도구 판정을 지운다', () => {
    expect(applyLocalProviderDraft(live(), {
      contextDraft: '16384', temperatureDraft: '', retryToolSupport: false,
    }).toolSupport).toBe('none');

    expect(applyLocalProviderDraft(live(), {
      contextDraft: '16384', temperatureDraft: '', retryToolSupport: true,
    }).toolSupport).toBeUndefined();
  });

  it('창을 열어 둔 사이 왕복이 갱신한 값은 되돌아가지 않는다', () => {
    const next = applyLocalProviderDraft(live(), {
      contextDraft: '32768', temperatureDraft: '0.2', retryToolSupport: false,
    });
    expect(next.kind).toBe('local-llama');
    expect(next.modelId).toBe('ornith-1.0-9b-q4-k-m');
    expect(next.modelName).toBe('ornith-1.0-9B-Q4_K_M');
    expect(next.contextUsed).toBe(12043);
    expect(next.contextLimit).toBe(16384);
    expect(next.tokensIn).toBe(128_000);
    expect(next.tokensOut).toBe(9_400);
  });
});
