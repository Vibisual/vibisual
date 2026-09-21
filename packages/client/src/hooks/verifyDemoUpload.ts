/** 실패한 프레임만 다시 보낸다. null 은 원본 클립과 편집창을 유지해야 한다는 뜻이다. */
export async function uploadVerifyDemoFrames<T>(
  frames: readonly T[],
  completed: Set<number>,
  upload: (frame: T) => Promise<boolean>,
  progress: (done: number) => void,
): Promise<number | null> {
  for (let i = 0; i < frames.length; i++) {
    if (!completed.has(i)) {
      // 서버는 도착 순서로 파일 번호를 매긴다. 실패 뒤 장을 먼저 보내면 재시도 때 순서가 뒤집힌다.
      if (!await upload(frames[i]!)) return null;
      completed.add(i);
    }
    progress(completed.size);
  }
  return completed.size === frames.length ? completed.size : null;
}
