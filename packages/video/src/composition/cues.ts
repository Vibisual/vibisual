/**
 * §5.13 (T-8) — 표지 모으기 결과를 문서에 적을 모양으로 다듬는다 (순수).
 *
 * 일꾼은 컴포지션을 0초부터 끝까지 한 번 흘리며 받은 `cue{ name, t }` 와 오류를 그대로 넘긴다. 여기서
 * ① 모양이 틀린 것을 버리고 ② 같은 (이름, 시각) 겹침을 접고(임의 접근 코드가 걸음마다 같은 표지를 다시 알린다)
 * ③ 시각 순으로 세우고 ④ 상한(`COMPOSITION_CUES_MAX`)을 넘으면 앞에서부터만 남기고 ⑤ 같은 이름이 여러 번이면
 * 진단을 단다(묶이는 것은 시각이 가장 이른 첫 번째 — 해소기가 배열 앞에서부터 찾는다).
 */

import { COMPOSITION_CUES_MAX } from '../constants.js';
import type { CompositionCue, CueIssue } from '../types.js';

/** 이름 길이 상한(런타임이 이미 자른다 — 일꾼을 거치지 않은 값도 같은 모양으로). */
const CUE_NAME_MAX = 80;
/** 진단으로 남길 같은 이름·오류의 수 상한(문서가 진단으로 부풀지 않게). */
const ISSUE_LIST_MAX = 12;
const ERROR_TEXT_MAX = 240;

export interface CueScanError {
  readonly t?: number;
  readonly message: string;
}

export interface SettledCues {
  readonly cues: CompositionCue[];
  readonly issues: CueIssue[];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function settleCues(
  raw: readonly unknown[],
  errors: readonly CueScanError[] = [],
  max: number = COMPOSITION_CUES_MAX,
): SettledCues {
  const seen = new Set<string>();
  const valid: CompositionCue[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { name?: unknown; t?: unknown };
    if (typeof e.name !== 'string' || typeof e.t !== 'number' || !Number.isFinite(e.t) || e.t < 0) continue;
    const name = e.name.trim().slice(0, CUE_NAME_MAX);
    if (name === '') continue;
    const t = round3(e.t);
    const key = `${name}\u0000${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push({ name, t });
  }
  // 시각 순(같은 시각이면 알린 순서 — sort 는 안정 정렬이다).
  valid.sort((a, b) => a.t - b.t);

  const issues: CueIssue[] = [];
  const limit = Math.max(0, Math.floor(max));
  const cues = valid.length > limit ? valid.slice(0, limit) : valid;
  if (valid.length > limit) issues.push({ code: 'cues-truncated', count: limit });

  const counts = new Map<string, number>();
  for (const cue of cues) counts.set(cue.name, (counts.get(cue.name) ?? 0) + 1);
  let dupes = 0;
  for (const [name, count] of counts) {
    if (count < 2) continue;
    if (dupes >= ISSUE_LIST_MAX) break;
    issues.push({ code: 'cue-duplicate', name, count });
    dupes += 1;
  }

  for (const err of errors.slice(0, ISSUE_LIST_MAX)) {
    const message = String(err.message ?? '').slice(0, ERROR_TEXT_MAX);
    issues.push(typeof err.t === 'number' && Number.isFinite(err.t)
      ? { code: 'cue-error', t: round3(Math.max(0, err.t)), message }
      : { code: 'cue-error', message });
  }
  return { cues, issues };
}

/** 표지를 모을 길이(초) — 선언 길이, 없으면 그 소재를 쓰는 아이템 중 가장 긴 구간(+ 트림), 그것도 없으면 `fallback`. */
export function cueScanLength(declared: number | undefined, itemSpans: readonly number[], fallback: number): number {
  if (typeof declared === 'number' && Number.isFinite(declared) && declared > 0) return declared;
  const longest = itemSpans.filter((n) => Number.isFinite(n) && n > 0).reduce((a, b) => Math.max(a, b), 0);
  return longest > 0 ? longest : fallback;
}
