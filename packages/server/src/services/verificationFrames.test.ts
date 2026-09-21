import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveVerificationDemoFrames } from './verificationFrames.js';

const frameDir = path.join(process.cwd(), '.vibisual', 'verify-demos', 'demo-a');
const demo = { frames: [
  { rel: 'demo-a/0.png', atMs: 100 },
  { rel: 'demo-a/1.png', atMs: 200 },
  { rel: 'demo-a/2.png', atMs: 300 },
] };

describe('resolveVerificationDemoFrames — 원래 시연 그대로 검증', () => {
  it('그림 없는 글 단계 시연은 프로젝트 프레임 폴더가 없어도 유지한다', () => {
    expect(resolveVerificationDemoFrames({ frames: [] }, null, () => false))
      .toEqual({ ok: true, frames: [] });
  });

  it('그림이 모두 있으면 원본 경로와 시각·순서를 유지한다', () => {
    const result = resolveVerificationDemoFrames(demo, frameDir, () => true);
    expect(result).toEqual({ ok: true, frames: [
      { path: path.join(frameDir, '0.png'), atMs: 100 },
      { path: path.join(frameDir, '1.png'), atMs: 200 },
      { path: path.join(frameDir, '2.png'), atMs: 300 },
    ] });
  });

  it('중간 프레임 하나가 삭제되어도 남은 두 장으로 몰래 진행하지 않는다', () => {
    expect(resolveVerificationDemoFrames(demo, frameDir, (file) => path.basename(file) !== '1.png'))
      .toEqual({ ok: false, error: 'demo-frames-missing' });
  });

  it('재시도로 늦게 저장된 앞 장도 원래 시간 순서로 전달한다', () => {
    const unordered = { frames: [demo.frames[2]!, demo.frames[0]!, demo.frames[1]!] };
    const result = resolveVerificationDemoFrames(unordered, frameDir, () => true);
    expect(result.ok && result.frames.map((frame) => frame.atMs)).toEqual([100, 200, 300]);
    expect(unordered.frames[0]?.atMs).toBe(300);
  });

  it('재시작 뒤 프레임 폴더를 찾을 수 없으면 그림 없는 시연으로 바꾸지 않는다', () => {
    expect(resolveVerificationDemoFrames(demo, null, () => true))
      .toEqual({ ok: false, error: 'demo-frames-missing' });
    expect(resolveVerificationDemoFrames(demo, frameDir, () => false))
      .toEqual({ ok: false, error: 'demo-frames-missing' });
  });
});
