// 스모크 실패 때 무엇을 다시 지을지 정하는 순수 표(`releasePackaging.test.ts`) — 러너에서 죽는 비결정적 조립 결함(예: Windows `0xC0000005`)은 다시 짓기가 유일한 해법이다.
// ⚠️ 문자열은 실제 잡 이름과 짝이다 — 한쪽만 고치면 재시도가 조용히 아무것도 못 찾는다(시험이 양쪽을 붙든다):
//   `smoke.yml` 의 `matrix.include[].label` · `release.yml` 의 `matrix.include[].script`(잡 이름 `release (<os>, <script>)` 에서 유일하다)

/** 한 판올림이 도달해야 하는 네 갈래. 순서는 사람이 읽는 순서(빠른 것부터)다. */
export const PLATFORMS = [
  { key: 'win', smokeLabel: 'win-x64 (nsis)', script: 'release:win', runner: 'windows-latest' },
  { key: 'linux', smokeLabel: 'linux-x64 (AppImage)', script: 'release:linux', runner: 'ubuntu-latest' },
  { key: 'mac-arm64', smokeLabel: 'mac-arm64 (dmg)', script: 'release:mac:arm64', runner: 'macos-latest' },
  { key: 'mac-x64', smokeLabel: 'mac-x64 (dmg)', script: 'release:mac:x64', runner: 'macos-15-intel' },
];

/**
 * 스모크 잡 이름(`smoke (win-x64 (nsis))`) → 그 잡이 재고 있던 플랫폼.
 *
 * 라벨 자체가 괄호를 품고 있어서 정규식으로 벗기려 들면 중첩 괄호에서 어긋난다. 포함 관계로
 * 짚는 편이 규칙이 바뀌어도 버티고, 라벨 넷은 서로의 부분문자열이 아니라 애매해질 일이 없다.
 *
 * @param {string} jobName
 * @returns {(typeof PLATFORMS)[number] | null}
 */
export function platformForSmokeJob(jobName) {
  if (typeof jobName !== 'string') return null;
  return PLATFORMS.find((p) => jobName.includes(p.smokeLabel)) ?? null;
}

/**
 * 릴리스 빌드 잡 이름(`release (windows-latest, release:win)`) → 그 잡이 짓던 플랫폼.
 * ⚠️ **script 로 짚는다, runner 로 짚지 마라** — 러너 이름은 조립 규칙이 바뀌면 헷갈리고, script 넷은 서로의 부분문자열이 아니다(확인함).
 * @param {string} jobName
 * @returns {(typeof PLATFORMS)[number] | null}
 */
export function platformForReleaseJob(jobName) {
  if (typeof jobName !== 'string') return null;
  // 가장 긴 것부터 본다 — 미래에 접두가 겹치는 script 가 생겨도 더 구체적인 쪽이 이긴다.
  const byLength = [...PLATFORMS].sort((a, b) => b.script.length - a.script.length);
  return byLength.find((p) => jobName.includes(p.script)) ?? null;
}

/**
 * 스모크 런의 잡 목록에서 **다시 지어야 할 플랫폼**을 고른다. `publish` 잡의 실패는 거른다 — 설치본이 나쁜 게 아니라
 * 자산이 덜 올라왔거나 발행이 미끄러진 것이라 무엇을 다시 지을지 정할 수 없다(부르는 쪽이 재검증부터 한다).
 * @param {{name:string, conclusion:string|null, status?:string}[]} jobs
 * @returns {(typeof PLATFORMS)[number][]}
 */
export function platformsToRebuild(jobs) {
  const out = [];
  for (const job of jobs ?? []) {
    if (!job || job.conclusion === 'success' || job.conclusion === 'skipped') continue;
    const p = platformForSmokeJob(job.name);
    if (p && !out.includes(p)) out.push(p);
  }
  // PLATFORMS 순서를 유지한다 — 로그가 매번 같은 순서로 읽히게.
  return PLATFORMS.filter((p) => out.includes(p));
}

/**
 * 한 라운드에서 무엇을 할지 — 플랫폼 잡이 깨졌으면 그 플랫폼만 **다시 짓는다**(가장 흔하다).
 * 플랫폼은 다 초록인데 빨가면 발행 잡이 미끄러진 것 — 다시 짓기는 20분이 넘어 **먼저 재검증만** 한 번, 그래도 빨가면 전부 다시 짓는다.
 * @param {{name:string, conclusion:string|null}[]} jobs
 * @param {{reverifyTried?: boolean}} [state]
 * @returns {{kind:'rebuild'|'reverify', platforms:(typeof PLATFORMS)[number][], why:string}}
 */
export function planRepair(jobs, state = {}) {
  const broken = platformsToRebuild(jobs);
  if (broken.length > 0) {
    return {
      kind: 'rebuild',
      platforms: broken,
      why: `설치 검증이 깨진 플랫폼: ${broken.map((p) => p.key).join(', ')} — 그것만 다시 짓는다`,
    };
  }
  if (!state.reverifyTried) {
    return {
      kind: 'reverify',
      platforms: [],
      why: '네 OS 설치는 전부 통과했다 — 발행 잡이 미끄러진 것이라 다시 짓지 않고 재검증만 한다',
    };
  }
  return {
    kind: 'rebuild',
    platforms: [...PLATFORMS],
    why: '재검증으로도 안 풀렸다 — 자산이 덜 올라왔을 수 있으니 네 갈래를 전부 다시 짓는다',
  };
}

/** 재시도 기본 횟수. 3 이면 최초 1회 + 재시도 2회다(비결정 결함은 대개 1회 재빌드에서 풀린다). */
export const DEFAULT_MAX_ATTEMPTS = 3;
