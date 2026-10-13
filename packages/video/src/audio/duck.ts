/**
 * §5.13 (V) 37-12 — 덕킹 곡선 (순수). 내레이션(`props.role: 'voice'`)이 나오는 동안 음악(`'music'`)을 낮춘다.
 *
 * 곡선은 (시각, 배율) 점의 꺾은선이다 — 믹서는 그 점을 그대로 게인에 건다(미리보기·렌더가 같은 믹서). 목소리가 들어오기
 * `attack` 초 전부터 내려가 목소리 동안 머물고, 끝난 뒤 `release` 초에 걸쳐 돌아온다. 두 목소리 사이가 짧으면(내려갔다 다시
 * 올라오기 전에 또 내려가야 하면) 한 구간으로 잇는다 — 음악이 숨 쉬듯 출렁이지 않게.
 */

export const DUCK_DEFAULT_DB = -10;
export const DUCK_ATTACK_S = 0.15;
export const DUCK_RELEASE_S = 0.4;

export interface DuckRange {
  readonly start: number;
  readonly end: number;
}

export interface DuckPoint {
  readonly t: number;
  /** 게인 배율(1 = 그대로). */
  readonly gain: number;
}

export interface DuckOptions {
  readonly depthDb?: number;
  readonly attack?: number;
  readonly release?: number;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** 목소리 구간들을 이어 붙인다(겹치거나 내려갔다 올라오기 전에 다시 시작하면 하나로). */
export function mergeDuckRanges(ranges: readonly DuckRange[], attack = DUCK_ATTACK_S, release = DUCK_RELEASE_S): DuckRange[] {
  const sorted = ranges
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .map((r) => ({ start: Math.max(0, r.start), end: r.end }))
    .sort((a, b) => a.start - b.start);
  const out: DuckRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start - attack <= last.end + release) {
      out[out.length - 1] = { start: last.start, end: Math.max(last.end, r.end) };
    } else {
      out.push(r);
    }
  }
  return out;
}

/** 덕킹 곡선. 목소리가 없거나 깊이가 0 이면 빈 배열(믹서가 게인을 건드리지 않는다). */
export function duckEnvelope(voice: readonly DuckRange[], opts: DuckOptions = {}): DuckPoint[] {
  const depthDb = opts.depthDb ?? DUCK_DEFAULT_DB;
  if (!Number.isFinite(depthDb) || depthDb >= 0) return [];
  const attack = Math.max(0, opts.attack ?? DUCK_ATTACK_S);
  const release = Math.max(0, opts.release ?? DUCK_RELEASE_S);
  const low = dbToGain(depthDb);
  const points: DuckPoint[] = [];
  for (const r of mergeDuckRanges(voice, attack, release)) {
    const downFrom = Math.max(0, r.start - attack);
    points.push({ t: downFrom, gain: 1 });
    points.push({ t: Math.max(downFrom, r.start), gain: low });
    points.push({ t: r.end, gain: low });
    points.push({ t: r.end + release, gain: 1 });
  }
  return points;
}

/** 곡선의 시각 `t` 배율(점 사이는 직선). 시험과 화면의 그리기용. */
export function duckGainAt(points: readonly DuckPoint[], t: number): number {
  if (points.length === 0) return 1;
  const first = points[0];
  if (!first || t <= first.t) return first?.gain ?? 1;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    if (t <= b.t) {
      if (b.t - a.t <= 1e-9) return b.gain;
      return a.gain + ((b.gain - a.gain) * (t - a.t)) / (b.t - a.t);
    }
  }
  return points[points.length - 1]?.gain ?? 1;
}
