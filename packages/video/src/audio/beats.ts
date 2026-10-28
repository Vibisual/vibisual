/**
 * §5.13 (V) 37-12 — 음악 비트 분석(순수, 외부 라이브러리 0): 에너지 흐름(10ms 제곱평균·로그·오르막) → 자기상관 템포(60~180 BPM, 120 근처 가중 —
 * 두 배·절반 오판 방지) → 빗질 위상 → 오르막 꼭대기로 당김 → 4박 가정 강박. 주기성이 약하면(말소리·효과음) 비트를 내지 않는다.
 */

export interface BeatAnalysis {
  /** 비트 시각(초, 오름차순). */
  readonly beats: number[];
  /** 그중 강한 비트(마디 첫 박). */
  readonly strong: number[];
  /** 템포. 비트를 못 찾았으면 0. */
  readonly bpm: number;
}

export const BEAT_MIN_BPM = 60;
export const BEAT_MAX_BPM = 180;
/** 이보다 짧은 소리는 재지 않는다(초). */
const MIN_SECONDS = 4;
/** 자기상관 꼭대기가 평균보다 이만큼은 높아야 주기가 있다고 본다. */
const MIN_CONFIDENCE = 1.25;
/** 템포 선호(120 BPM 중심, 옥타브 단위 표준편차). */
const TEMPO_CENTER = 120;
const TEMPO_SPREAD_OCTAVES = 0.9;

const EMPTY: BeatAnalysis = { beats: [], strong: [], bpm: 0 };

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function analyzeBeats(mono: Float32Array, sampleRate: number, opts: { minBpm?: number; maxBpm?: number } = {}): BeatAnalysis {
  if (!(sampleRate > 0) || mono.length < sampleRate * MIN_SECONDS) return EMPTY;
  const hop = Math.max(1, Math.round(sampleRate / 100));
  const win = hop * 2;
  const frames = Math.floor((mono.length - win) / hop) + 1;
  if (frames < 200) return EMPTY;
  const fps = sampleRate / hop;

  // ① 에너지 흐름 → 오르막.
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    const offset = f * hop;
    for (let i = 0; i < win; i += 1) {
      const v = mono[offset + i] ?? 0;
      sum += v * v;
    }
    energy[f] = Math.log1p(1000 * Math.sqrt(sum / win));
  }
  const rise = new Float32Array(frames);
  for (let f = 1; f < frames; f += 1) rise[f] = Math.max(0, (energy[f] ?? 0) - (energy[f - 1] ?? 0));
  // 둘레 평균을 빼 꾸준히 큰 소리(긴 음)를 걷는다.
  const half = Math.max(1, Math.round(fps * 0.25));
  const prefix = new Float64Array(frames + 1);
  for (let f = 0; f < frames; f += 1) prefix[f + 1] = (prefix[f] ?? 0) + (rise[f] ?? 0);
  const onset = new Float32Array(frames);
  let peak = 0;
  for (let f = 0; f < frames; f += 1) {
    const a = Math.max(0, f - half);
    const b = Math.min(frames, f + half + 1);
    const mean = ((prefix[b] ?? 0) - (prefix[a] ?? 0)) / (b - a);
    const v = Math.max(0, (rise[f] ?? 0) - mean);
    onset[f] = v;
    if (v > peak) peak = v;
  }
  if (peak <= 1e-6) return EMPTY;

  // ② 자기상관 템포.
  const minBpm = Math.max(30, opts.minBpm ?? BEAT_MIN_BPM);
  const maxBpm = Math.min(300, Math.max(minBpm + 1, opts.maxBpm ?? BEAT_MAX_BPM));
  const minLag = Math.max(1, Math.floor((60 * fps) / maxBpm));
  const maxLag = Math.min(frames - 1, Math.ceil((60 * fps) / minBpm));
  if (maxLag <= minLag + 1) return EMPTY;
  const scores = new Float64Array(maxLag + 2);
  let rawSum = 0;
  let rawCount = 0;
  let bestLag = minLag;
  let bestScore = -1;
  let bestRaw = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let s = 0;
    for (let f = 0; f + lag < frames; f += 1) s += (onset[f] ?? 0) * (onset[f + lag] ?? 0);
    s /= frames - lag;
    rawSum += s;
    rawCount += 1;
    const bpm = (60 * fps) / lag;
    const weight = Math.exp(-0.5 * (Math.log2(bpm / TEMPO_CENTER) / TEMPO_SPREAD_OCTAVES) ** 2);
    const score = s * weight;
    scores[lag] = score;
    if (score > bestScore) { bestScore = score; bestLag = lag; bestRaw = s; }
  }
  const meanRaw = rawCount > 0 ? rawSum / rawCount : 0;
  if (meanRaw <= 0 || bestRaw / meanRaw < MIN_CONFIDENCE) return EMPTY;
  // 꼭대기를 포물선으로 다듬어 프레임보다 고운 주기를 얻는다.
  let period = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const y0 = scores[bestLag - 1] ?? 0;
    const y1 = scores[bestLag] ?? 0;
    const y2 = scores[bestLag + 1] ?? 0;
    const denom = y0 - 2 * y1 + y2;
    if (denom < 0) period = bestLag + Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom));
  }

  // ③ 위상 — 그 주기로 빗질해 오르막 합이 가장 큰 자리.
  let bestPhase = 0;
  let bestPhaseScore = -1;
  const phaseSteps = Math.max(1, Math.ceil(period));
  for (let p = 0; p < phaseSteps; p += 1) {
    let s = 0;
    for (let x = p; x < frames; x += period) s += onset[Math.round(x)] ?? 0;
    if (s > bestPhaseScore) { bestPhaseScore = s; bestPhase = p; }
  }

  // ④ 비트 — 격자 자리에서 가까운 오르막 꼭대기로 조금 당긴다(격자 자체는 움직이지 않는다).
  const reach = Math.max(1, Math.round(period * 0.08));
  const beatFrames: number[] = [];
  const beatValues: number[] = [];
  for (let x = bestPhase; x < frames; x += period) {
    const center = Math.round(x);
    let pickF = center;
    let pickV = onset[center] ?? 0;
    for (let d = -reach; d <= reach; d += 1) {
      const f = center + d;
      if (f < 0 || f >= frames) continue;
      const v = onset[f] ?? 0;
      if (v > pickV) { pickV = v; pickF = f; }
    }
    if (beatFrames.length > 0 && pickF <= (beatFrames[beatFrames.length - 1] ?? -1)) continue;
    beatFrames.push(pickF);
    beatValues.push(pickV);
  }
  const toSeconds = (f: number): number => round3((f * hop + hop) / sampleRate);
  const beats = beatFrames.map(toSeconds);

  // ⑤ 강한 비트 — 4박 마디의 어느 자리가 가장 센가.
  const strong: number[] = [];
  if (beats.length >= 4) {
    let bestOffset = 0;
    let bestSum = -1;
    for (let m = 0; m < 4; m += 1) {
      let s = 0;
      for (let k = m; k < beatValues.length; k += 4) s += beatValues[k] ?? 0;
      if (s > bestSum) { bestSum = s; bestOffset = m; }
    }
    for (let k = bestOffset; k < beats.length; k += 4) strong.push(beats[k] ?? 0);
  }
  return { beats, strong, bpm: Math.round(((60 * fps) / period) * 10) / 10 };
}

/** 여러 갈래 소리를 한 갈래로(평균). */
export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0] ?? new Float32Array(0);
  const length = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i += 1) out[i] = (out[i] ?? 0) + (channel[i] ?? 0) / channels.length;
  }
  return out;
}

/**
 * 시각 `t` 에서 가장 가까운 강한 비트(문턱 안이면). 자석 붙이기(장면 경계·전환)가 쓴다. 없으면 null.
 * `beats` 는 문서 시각이어야 한다(아이템 시작·트림을 이미 반영한 값).
 */
export function nearestBeat(beats: readonly number[], t: number, threshold: number): number | null {
  let best: number | null = null;
  let bestDist = threshold;
  for (const beat of beats) {
    const d = Math.abs(beat - t);
    if (d <= bestDist) { best = beat; bestDist = d; }
  }
  return best;
}
