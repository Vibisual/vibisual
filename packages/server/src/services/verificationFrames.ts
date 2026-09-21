import path from 'node:path';
import type { VerificationDemo } from '@vibisual/shared';
import { VERIFICATION_DEMO_FRAMES_MAX } from '@vibisual/shared';
import type { DemoFrameRef } from './verificationPrompt.js';

/** 선택한 시연의 그림이 없으면 절차를 조용히 줄이지 않고 실행 전에 실패시킨다. */
export function resolveVerificationDemoFrames(
  demo: Pick<VerificationDemo, 'frames'>,
  frameDir: string | null,
  fileExists: (filePath: string) => boolean,
): { ok: true; frames: DemoFrameRef[] } | { ok: false; error: 'demo-frames-missing' } {
  if (demo.frames.length === 0) return { ok: true, frames: [] };
  if (!frameDir) return { ok: false, error: 'demo-frames-missing' };
  const frames: DemoFrameRef[] = [];
  // 재시도한 앞 장이 늦게 업로드될 수 있다. 도착 순서가 재현 순서를 바꾸면 안 된다.
  for (const frame of [...demo.frames].sort((a, b) => a.atMs - b.atMs).slice(0, VERIFICATION_DEMO_FRAMES_MAX)) {
    const abs = path.join(frameDir, path.basename(frame.rel));
    if (!fileExists(abs)) return { ok: false, error: 'demo-frames-missing' };
    frames.push({ path: abs, atMs: frame.atMs });
  }
  return { ok: true, frames };
}
