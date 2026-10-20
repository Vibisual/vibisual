/**
 * §5.13 (Y) 40-2 ⑦ — 비트 재기용 **내려 담기**(순수 — 숫자 배열만 받는다).
 *
 * 종전에는 곡 파일을 통째로 받아 22.05kHz 로 통째 디코딩했다(3분 스테레오 약 32MB + 받은 바이트). 이제 디코더가 내주는 조각을
 * 하나씩 받아 **한 갈래 · 11.025kHz** 판(3분 약 7.6MB)의 그 시각 자리에 상자 평균으로 내려 담고 조각은 바로 버린다. 비트 분석은
 * 에너지 흐름(10ms 걸음)만 보므로 5.5kHz 위는 필요 없다 — 실측으로 같은 템포가 나온다(120 BPM 클릭 3분: 22.05kHz 119.8 ·
 * 11.025kHz 120.2). 분석 자체는 3분 곡에서 약 5ms 라 일꾼(Worker)을 따로 세우지 않는다(한가할 때 배경 줄에서 돈다).
 */

/** 비트 재기 표본율. */
export const BEAT_ANALYSIS_RATE = 11_025;

/**
 * 조각 하나(여러 갈래 · 원 표본율 · 시작 시각)를 `out`(한 갈래 · `outRate`)의 그 자리에 담는다. 출력 표본 `j` 는 원 신호
 * `[j/outRate, (j+1)/outRate)` 구간의 평균이다(조각 경계에 걸친 표본은 먼저 온 조각의 몫만 — 비트 분석에는 차이가 없다).
 */
export function downsampleMonoInto(out: Float32Array, outRate: number, startSeconds: number, channels: readonly Float32Array[], sourceRate: number): void {
  if (channels.length === 0 || !(sourceRate > 0) || !(outRate > 0) || !Number.isFinite(startSeconds)) return;
  const length = Math.min(...channels.map((c) => c.length));
  if (length === 0) return;
  const first = Math.max(0, Math.ceil(startSeconds * outRate - 1e-9));
  const last = Math.min(out.length, Math.ceil((startSeconds + length / sourceRate) * outRate - 1e-9));
  const count = channels.length;
  for (let j = first; j < last; j += 1) {
    const from = Math.max(0, Math.floor((j / outRate - startSeconds) * sourceRate + 1e-9));
    const to = Math.min(length, Math.max(from + 1, Math.floor(((j + 1) / outRate - startSeconds) * sourceRate + 1e-9)));
    let sum = 0;
    for (let i = from; i < to; i += 1) {
      for (let c = 0; c < count; c += 1) sum += channels[c]![i] ?? 0;
    }
    out[j] = sum / ((to - from) * count);
  }
}

/** 파일 태그의 BPM 을 믿을 만한 범위로만(40~240). 아니면 null. */
export function usableBpmTag(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 40 && value <= 240 ? value : null;
}

/** BPM 태그가 있으면 분석이 찾을 템포 범위를 그 둘레로 좁힌다(±`spread`). 없으면 기본 범위. */
export function bpmRangeFor(tag: number | null, spread = 0.06): { minBpm: number; maxBpm: number } | undefined {
  return tag === null ? undefined : { minBpm: tag * (1 - spread), maxBpm: tag * (1 + spread) };
}
