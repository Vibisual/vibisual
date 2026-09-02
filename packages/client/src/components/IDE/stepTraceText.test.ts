/**
 * stepTraceText.test.ts — §5.5 #17-39 자국 문구.
 *
 * 가짜 `t` 를 지어내지 않고 **실제 `en.json` 을 읽어** 보간한다. 그래서 이 테스트는 문구 규칙만이 아니라
 * **키가 로케일 파일에 실제로 있는지**까지 함께 지킨다 — 키를 지우거나 오타를 내면 여기서 먼저 걸린다.
 *
 * ⚠ `packages/client` 에서 실행해야 한다(레포 루트에서 돌리면 glob 이 비어 아래에서 멈춘다).
 */
import { describe, it, expect } from 'vitest';
import { thinkTraceText, writeTraceText, toolElapsedText, elapsedText, TRACE_SEP, type TranslateFn } from './stepTraceText.js';

const LOCALES = import.meta.glob<string>(
  ['/src/i18n/locales/en.json', '/src/i18n/locales/ko.json'],
  { query: '?raw', import: 'default', eager: true },
);

function loadStepTrace(locale: string): Record<string, string> {
  const raw = LOCALES[`/src/i18n/locales/${locale}.json`];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(`로케일을 읽지 못했습니다: ${locale}. vitest 를 packages/client 에서 실행하세요(레포 루트 ❌).`);
  }
  const parsed = JSON.parse(raw) as { ide?: { stepTrace?: Record<string, string> } };
  const block = parsed.ide?.stepTrace;
  if (!block) throw new Error(`${locale}.json 에 ide.stepTrace 가 없습니다.`);
  return block;
}

/** 실제 로케일 문자열로 `{{var}}` 만 채우는 최소 t — i18next 없이 문구 조립만 검증한다. */
function makeT(locale: string): TranslateFn {
  const block = loadStepTrace(locale);
  return (key, opts) => {
    const short = key.replace(/^ide\.stepTrace\./, '');
    const tmpl = block[short];
    if (tmpl === undefined) throw new Error(`${locale}.json 에 없는 키: ${key}`);
    return tmpl.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''));
  };
}

describe('§5.5 #17-39 자국 문구 (en)', () => {
  const t = makeT('en');

  it('사고 자국 — 사진과 같은 모양(시간 + 분량)', () => {
    expect(thinkTraceText(t, 'en-US', 73_000, 4_182)).toBe(`Thought for 1m 13s${TRACE_SEP}4,182 chars`);
  });

  it('분량을 세지 못했으면 붙일 말이 없다 — 시간만 적는다', () => {
    expect(thinkTraceText(t, 'en-US', 3_000, 0)).toBe('Thought for 3s');
  });

  it('1초 미만은 `under 1s` 로 뭉친다(`0s` 라고 적지 않는다)', () => {
    expect(elapsedText(t, 400)).toBe('under 1s');
    expect(thinkTraceText(t, 'en-US', 400, 120)).toBe(`Thought for under 1s${TRACE_SEP}120 chars`);
  });

  it('작성 자국 — 걸린 시간은 뜻이 생길 때만 붙는다', () => {
    expect(writeTraceText(t, 'en-US', 21_000, 1_904)).toBe(`Wrote 1,904 chars${TRACE_SEP}21s`);
    expect(writeTraceText(t, 'en-US', 300, 1_904)).toBe('Wrote 1,904 chars');
  });

  it('도구 묶음 경과 — 잴 수 없으면 빈 문자열(호출측이 아무것도 안 붙인다)', () => {
    expect(toolElapsedText(t, 0)).toBe('');
    expect(toolElapsedText(t, 999)).toBe('');
    expect(toolElapsedText(t, 38_000)).toBe('38s');
  });
});

describe('§5.5 #17-39 자국 문구 (ko)', () => {
  const t = makeT('ko');

  it('사진의 그 문장이 한국어로도 그대로 나온다', () => {
    expect(thinkTraceText(t, 'ko-KR', 73_000, 4_182)).toBe(`1분 13초 동안 사고함${TRACE_SEP}4,182자`);
  });
});

describe('로케일 12벌이 같은 키를 든다', () => {
  it('en 이 든 키를 ko 도 그대로 든다(하나라도 빠지면 그 언어에서 자국이 깨진다)', () => {
    expect(Object.keys(loadStepTrace('ko')).sort()).toEqual(Object.keys(loadStepTrace('en')).sort());
  });
});
