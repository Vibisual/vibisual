import { describe, expect, it } from 'vitest';
import { formatImageBytes, imageMetaLabel } from './editorImageMeta.js';

describe('formatImageBytes', () => {
  it('1KB 미만은 바이트 그대로 정수로 적는다', () => {
    expect(formatImageBytes(0)).toBe('0 B');
    expect(formatImageBytes(999)).toBe('999 B');
  });

  it('KB·MB 로 올라가며 소수 한 자리를 남긴다', () => {
    expect(formatImageBytes(10_752)).toBe('10.5 KB');
    expect(formatImageBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('정수 자리가 셋이면 소수를 버려 줄을 짧게 지킨다', () => {
    expect(formatImageBytes(512 * 1024)).toBe('512 KB');
    expect(formatImageBytes(134_720)).toBe('132 KB');
  });

  it('음수·NaN 은 빈 문자열 — 지어내지 않는다', () => {
    expect(formatImageBytes(-1)).toBe('');
    expect(formatImageBytes(Number.NaN)).toBe('');
  });
});

describe('imageMetaLabel', () => {
  it('픽셀 크기를 알면 가로×세로와 파일 크기를 함께 적는다', () => {
    expect(imageMetaLabel({ w: 1309, h: 825 }, 134_720)).toBe('1309 × 825 · 132 KB');
  });

  it('아직 못 읽었으면 크기만 — 0 × 0 을 지어내지 않는다', () => {
    expect(imageMetaLabel(null, 134_720)).toBe('132 KB');
    expect(imageMetaLabel({ w: 0, h: 0 }, 134_720)).toBe('132 KB');
  });
});
