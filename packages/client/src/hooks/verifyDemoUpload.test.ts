import { describe, expect, it, vi } from 'vitest';
import { uploadVerifyDemoFrames } from './verifyDemoUpload.js';

describe('시연 프레임 업로드 복구', () => {
  it('모든 업로드가 실패하면 원본을 삭제하는 성공값을 반환하지 않는다', async () => {
    const result = await uploadVerifyDemoFrames(['first', 'last'], new Set(), async () => false, () => {});
    expect(result).toBeNull();
  });

  it('부분 실패는 미완료이고 재시도는 성공한 장을 건너뛰어 순서대로 이어 간다', async () => {
    const completed = new Set<number>();
    const frames = ['first', 'middle', 'last'];
    expect(await uploadVerifyDemoFrames(frames, completed, async (frame) => frame !== 'middle', () => {})).toBeNull();
    const retry = vi.fn(async () => true);
    expect(await uploadVerifyDemoFrames(frames, completed, retry, () => {})).toBe(3);
    expect(retry.mock.calls).toEqual([['middle'], ['last']]);
  });

  it('그림 없음 선택은 정상 저장으로 끝난다', async () => {
    const upload = vi.fn(async () => true);
    expect(await uploadVerifyDemoFrames([], new Set(), upload, () => {})).toBe(0);
    expect(upload).not.toHaveBeenCalled();
  });
});
