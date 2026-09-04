/**
 * §4 — `--effort` **값** 실측 probe 의 순수 판정부.
 *
 * `modelRegistryService` 는 `claude --help` 의 `--effort <level> (…)` 괄호를 파싱해 Effort 드롭다운을
 * 짓는다("0 하드코딩 · CLI 진실"). 그런데 도움말은 **CLI 가 받는 값 전부를 적어 두지 않는다** —
 * 실측 2.1.259 의 괄호는 `(low, medium, high, xhigh, max)` 뿐인데 `--effort ultracode` 는 경고 없이
 * 수락된다. 도움말만 믿으면 **CLI 가 받는데 사용자는 고를 수 없는 등급**이 생긴다.
 *
 * 그래서 도움말 밖 후보(`EFFORT_LEVEL_PROBE_CANDIDATES`)는 한 번씩 찔러 보고 받아들여지는 것만 더한다.
 * 판정 근거는 §4 규약 (4) 가 세운 그대로 **설치본 실측**이며, 이 파일은 그 실측의
 * "출력을 보고 거절인지 가린다" 부분만 순수 함수로 들고 있다(spawn 은 호출자 몫 —
 * 그래야 win 개발기에서 세 OS 의 출력 문구를 전부 단위 테스트로 고정할 수 있다).
 *
 * ⚠ **보정(calibration) 없이는 채택하지 않는다.** "경고가 없다"가 "수락했다"가 되려면 그 CLI 가
 * 애초에 값 검증을 한다는 사실이 먼저 서야 한다. 값 검증을 안 하는 판올림에서는 무효값도 조용히
 * 지나가므로, 그때는 "모르는 것을 수락으로 넘겨짚지 않는다"는 규율대로 후보를 통째로 버린다
 * (§2.1 Bash 읽기/쓰기 추출기가 화이트리스트 밖을 버리는 것과 같은 갈래).
 */

/**
 * 보정 probe 에 쓰는 무효값.
 *
 * 어느 판올림에서도 실제 등급이 될 수 없게 접두어를 박았다 — 이 값이 **거절되지 않으면**
 * 그 CLI 는 `--effort` 값을 검증하지 않는 것이므로 후보 판정 자체가 성립하지 않는다.
 */
export const EFFORT_PROBE_SENTINEL = 'vibisual-probe-invalid-effort';

/**
 * probe 출력이 "그 값을 거절했다"는 뜻인가.
 *
 * 설치본이 거절을 알리는 방식은 두 가지이고 둘 다 잡는다.
 *  - **경고형**(2.1.259 실측): `Warning: Unknown --effort value 'zzz' — ignoring it and using the default effort.`
 *    → 종료 코드는 0 이라 exit code 로는 못 가린다. 출력을 봐야 한다.
 *  - **commander choices 형**(`--autocompact` 가 쓰는 형태): `error: option '--effort <level>' argument 'zzz' is invalid.`
 *    → 이쪽은 즉시 종료라 출력이 그대로 남는다.
 *
 * 값 자체가 출력에 인용돼 있어야 한다 — 후보와 무관한 다른 경고를 거절로 읽지 않기 위함이다.
 * (한 번에 한 값만 찌르므로 인용 검사는 사실상 자기 자신 확인이지만, 이 함수가 여러 값을 담은
 *  출력에 잘못 쓰이는 날을 위해 남겨 둔다.)
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

/**
 * probe 출력이 "정상적으로 떴다"는 뜻인가 (= 판정에 쓸 수 있는 출력인가).
 *
 * 빈 출력은 spawn 실패·타임아웃이라 **거절도 수락도 아니다**. 이걸 수락으로 읽으면
 * claude 가 아예 안 뜨는 기계에서 후보가 전부 목록에 실린다.
 */
export function isUsableProbeOutput(output: string): boolean {
  return typeof output === 'string' && output.trim().length > 0;
}

/** 등급 이름 정규화 — 도움말 파싱과 같은 규칙(소문자 · 앞뒤 공백 제거). */
function normalizeLevel(value: string): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * 실제로 찔러 볼 후보만 고른다.
 *
 * 도움말이 이미 적어 둔 등급은 찌르지 않는다 — CLI 가 스스로 밝힌 값이라 확인이 필요 없고,
 * 부팅 때마다 도는 자식 프로세스를 늘릴 이유도 없다(그래서 CLI 가 언젠가 `ultracode` 를
 * 도움말에 올리면 이 probe 는 **저절로 0회**가 된다).
 */
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
 * 도움말 등급 + 실측으로 수락된 등급을 한 목록으로.
 *
 * 순서는 **도움말이 적은 순서 그대로 두고 수락분을 뒤에 붙인다** — 도움말의 괄호는 낮은 등급부터
 * 오름차순이고(`low … max`), 도움말에 없던 등급은 그보다 위를 뜻하는 자리라 꼬리가 맞다.
 * 목록을 우리가 재정렬하면 "CLI 가 적은 순서" 라는 근거가 사라진다.
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
