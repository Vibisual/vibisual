/**
 * 경로 대소문자 정책 SSOT. Linux 는 `Feature-X` ≠ `feature-x` 다 — 무조건 접으면 두 프로젝트/워크트리가 한 키로 뭉개져 그래프·탭·두뇌 설정이
 * 에러 없이 섞인다(워크트리 생성은 케이스를 보존해 실제로 공존한다). ⚠️ 브라우저에서도 로드되므로 `process.platform` 대신 인자로 받는다 —
 * 서버는 `services/pathKey.ts` 가 감싸고, 클라는 스냅샷의 플랫폼 문자열을 쓴다(모르면 접는다).
 */

/** `process.platform` 이 낼 수 있는 값 중 우리가 구분하는 것. 그 외는 POSIX 로 취급. */
export type PlatformName = 'win32' | 'darwin' | 'linux' | (string & {});

/**
 * 기본 파일시스템이 대소문자를 무시하는가 — win32·darwin(기본 APFS)은 무시, linux 는 구분(절대 접지 마라).
 * case-sensitive 로 포맷한 mac 도 접는 쪽이 낫다 — 안 접으면 "같은 폴더를 둘로 본다"는 더 흔한 오작동이 난다.
 */
export function isCaseInsensitiveFs(platform: PlatformName): boolean {
  return platform === 'win32' || platform === 'darwin';
}

/**
 * 경로 모양만 정규화(케이스 그대로): `\` → `/`, 연속 슬래시 축약, 끝 슬래시 제거. 경계 셋은 살린다(다른 대상을 한 키로 뭉개지 않게):
 * UNC 선행 `//`(축약하면 루트 절대경로와 같아진다) · 드라이브 루트 `C:/`(`C:` 는 "그 드라이브의 현재 디렉터리") · POSIX `/`.
 */
export function normalizePathShape(p: string): string {
  const unc = /^[\\/]{2}/.test(p);
  const body = p.replace(/[\\/]+/g, '/');
  const collapsed = unc ? `/${body}` : body; // 축약으로 잃은 선행 슬래시 하나를 되돌린다
  if (collapsed === '/' || collapsed === '//') return collapsed;
  if (/^[A-Za-z]:\/$/.test(collapsed)) return collapsed; // 드라이브 루트는 슬래시 유지
  return collapsed.replace(/(.)\/+$/, '$1');
}

/**
 * 경로를 비교·Map 키로 쓸 수 있는 정규 형태로 바꾼다.
 * 대소문자는 **그 플랫폼의 파일시스템이 실제로 무시할 때만** 접는다.
 */
export function pathKey(p: string, platform: PlatformName): string {
  const shaped = normalizePathShape(p);
  return isCaseInsensitiveFs(platform) ? shaped.toLowerCase() : shaped;
}

/**
 * 예전 키(플랫폼 무관 무조건 소문자) — **읽기 폴백 전용**, 새 키에 쓰지 마라. 디스크의 체크포인트·app-state·두뇌/플러그인 맵은 mac/linux 에서도
 * 소문자로 적혀 있어, `pathKey` 로 못 찾으면 이 키로 다시 찾아야 업그레이드한 사용자가 탭·설정을 잃지 않는다.
 */
export function legacyLowerPathKey(p: string): string {
  return normalizePathShape(p).toLowerCase();
}

/**
 * `pathKey` 로 먼저 찾고, 없으면 예전 소문자 키로 한 번 더 찾는 조회 헬퍼.
 * 영속 맵(`Record<string, T>` / `Map<string, T>`)을 읽는 자리에서 쓴다.
 */
export function lookupByPath<T>(
  store: { get(k: string): T | undefined } | Record<string, T>,
  p: string,
  platform: PlatformName,
): T | undefined {
  const read = (k: string): T | undefined =>
    typeof (store as { get?: unknown }).get === 'function'
      ? (store as { get(k: string): T | undefined }).get(k)
      : (store as Record<string, T>)[k];

  const hit = read(pathKey(p, platform));
  if (hit !== undefined) return hit;
  // 업그레이드 직후 한 번 — 예전 무조건-소문자 키로 적힌 저장분.
  const legacy = legacyLowerPathKey(p);
  return read(legacy);
}

/** 두 경로가 같은 대상을 가리키는가(플랫폼 규칙 적용). */
export function samePath(a: string, b: string, platform: PlatformName): boolean {
  return pathKey(a, platform) === pathKey(b, platform);
}

/**
 * `child` 가 `root` 안(또는 root 자신)인가 — 경로 탈출(`..`) 방어의 공통 판정. 대소문자를 접을지는 `pathKey` 한 곳이 정한다:
 * "win32 만 접기"는 mac(APFS 는 대소문자 무시)에서 케이스만 다른 같은 폴더를 조용히 거부하고, linux 에서 접으면 남의 폴더가 통과한다.
 * ⚠ `pathKey` 는 구분자를 `/` 로 접으므로 경계 비교도 `/` 로 — `path.sep` 이면 Windows 에서 루트 자신 말고 전부 거부된다.
 * 판정에만 쓰고, **호출부가 돌려주는 경로는 원본 대소문자 그대로** 쓴다(표시·열기용).
 */
export function isPathWithin(child: string, root: string, platform: PlatformName): boolean {
  const c = pathKey(child, platform);
  const r = pathKey(root, platform);
  if (c === r) return true;
  // 드라이브 루트(`c:/`)와 POSIX 루트(`/`)는 이미 끝에 슬래시가 있다 — 하나 더 붙이면 못 맞춘다.
  const prefix = r.endsWith('/') ? r : `${r}/`;
  return c.startsWith(prefix);
}
