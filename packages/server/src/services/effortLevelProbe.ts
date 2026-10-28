/**
 * §4 — `--effort` 값 실측 probe 의 순수 판정부. `claude --help` 의 `--effort <level> (…)` 괄호가 CLI 가 받는 값 전부는 아니다
 * (실측 2.1.259: 괄호는 `(low, medium, high, xhigh, max)` 인데 `--effort ultracode` 도 경고 없이 수락) — 도움말만 믿으면 CLI 가 받는데 고를 수 없는 등급이 생긴다.
 * 그래서 도움말 밖 후보(`EFFORT_LEVEL_PROBE_CANDIDATES`)를 한 번씩 찔러 받아들여지는 것만 더한다(§4 규약 (4) 설치본 실측). spawn 은 호출자 몫 — 세 OS 출력 문구를 단위 시험하려고.
 * ⚠ 보정(calibration) 없이는 채택하지 않는다 — CLI 가 애초에 값 검증을 해야 "경고 없음 = 수락"이다. 검증 안 하는 판에서는 후보를 통째로 버린다(넘겨짚지 않는다).
 */

/** 보정 probe 용 무효값 — 어느 판에서도 실제 등급이 될 수 없게 접두어를 붙였다. 이 값이 거절되지 않으면 그 CLI 는 `--effort` 값을 검증하지 않는 것이라 후보 판정이 성립하지 않는다. */
export const EFFORT_PROBE_SENTINEL = 'vibisual-probe-invalid-effort';

/**
 * probe 출력이 그 값을 거절했다는 뜻인가. 두 방식을 다 잡는다:
 *  - 경고형(2.1.259 실측): `Warning: Unknown --effort value 'zzz' — ignoring it and using the default effort.` — 종료 코드가 0 이라 출력을 봐야 한다.
 *  - commander choices 형(`--autocompact` 가 쓰는 형태): `error: option '--effort <level>' argument 'zzz' is invalid.` — 즉시 종료.
 * 값이 출력에 인용돼 있어야 한다 — 다른 경고를 거절로 읽지 않게(한 번에 한 값만 찌르지만, 여러 값 출력에 쓰이는 날을 위해 남긴다).
 */
export function isEffortValueRejected(output: string, value: string): boolean {
  const text = (output ?? '').toLowerCase();
  const needle = (value ?? '').trim().toLowerCase();
  if (!text || !needle) return false;
  if (!text.includes(needle)) return false;
  // 경고형 — "unknown --effort value" (사이 토큰은 판올림마다 달라질 수 있어 느슨하게 잡는다)
  if (/unknown\b[^\n]{0,40}--effort\b[^\n]{0,20}value/.test(text)) return true;
  if (/--effort\b[^\n]{0,40}\bunknown\b[^\n]{0,40}value/.test(text)) return true;
  // commander choices 형 — "option '--effort <level>' argument 'zzz' is invalid"
  if (text.includes('--effort') && /\b(is invalid|invalid argument|not allowed|allowed choices)\b/.test(text)) return true;
  return false;
}

/** probe 출력이 판정에 쓸 수 있는 출력인가. 빈 출력은 spawn 실패·타임아웃이라 거절도 수락도 아니다 — 수락으로 읽으면 claude 가 안 뜨는 기계에서 후보가 전부 실린다. */
export function isUsableProbeOutput(output: string): boolean {
  return typeof output === 'string' && output.trim().length > 0;
}

/** 등급 이름 정규화 — 도움말 파싱과 같은 규칙(소문자 · 앞뒤 공백 제거). */
function normalizeLevel(value: string): string {
  return (value ?? '').trim().toLowerCase();
}

/** 실제로 찔러 볼 후보만 고른다. 도움말이 적은 등급은 찌르지 않는다(CLI 가 밝힌 값이고 부팅마다 자식 프로세스를 늘릴 이유가 없다) — 도움말에 오르면 probe 는 저절로 0회가 된다. */
export function planEffortProbeCandidates(
  helpLevels: readonly string[],
  candidates: readonly string[],
): string[] {
  const known = new Set(helpLevels.map(normalizeLevel).filter((v) => v.length > 0));
  known.add('default');
  const out: string[] = [];
  for (const raw of candidates) {
    const v = normalizeLevel(raw);
    if (!v || known.has(v)) continue;
    known.add(v);
    out.push(v);
  }
  return out;
}

/**
 * 도움말 등급 + 실측 수락 등급을 한 목록으로. 도움말 순서(`low … max` 오름차순)를 그대로 두고 수락분을 뒤에 붙인다 — 도움말 밖 등급은 그보다 위 자리다.
 * 재정렬하지 마라("CLI 가 적은 순서"라는 근거가 사라진다).
 */
export function mergeProbedEffortLevels(
  helpLevels: readonly string[],
  accepted: readonly string[],
): string[] {
  const out: string[] = [];
  for (const raw of [...helpLevels, ...accepted]) {
    const v = normalizeLevel(raw);
    if (!v || v === 'default' || out.includes(v)) continue;
    out.push(v);
  }
  return out;
}
