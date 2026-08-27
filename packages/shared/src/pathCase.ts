/**
 * 경로 대소문자 정책 SSOT.
 *
 * 이 앱은 오랫동안 경로를 **무조건 소문자로 접어** Map 키·비교 키로 써 왔다.
 * Windows 파일시스템은 대소문자를 가리지 않으니 거기서는 옳은 동작이지만,
 * Linux(ext4 등)에서는 `Feature-X` 와 `feature-x` 가 **실재하는 서로 다른 디렉터리**다.
 * 무조건 접으면 두 프로젝트/워크트리가 같은 키로 뭉개져 그래프·탭·두뇌 설정이
 * 에러 한 줄 없이 섞인다. (워크트리 생성은 이름 케이스를 보존하고 중복 판정을
 * `fs.existsSync` 로 하므로, Linux 에서는 케이스만 다른 두 워크트리가 실제로 공존한다.)
 *
 * ⚠️ shared 는 브라우저에서도 로드되므로 `process.platform` 을 읽어서는 안 된다
 * (constants.ts 의 같은 규약). 그래서 **플랫폼을 인자로 받는다.**
 * - server: `services/pathKey.ts` 가 `process.platform` 을 물려 감싼다.
 * - client: 서버가 스냅샷에 실어 보낸 플랫폼 문자열을 쓴다(모르면 안전하게 접는다).
 */

/** `process.platform` 이 낼 수 있는 값 중 우리가 구분하는 것. 그 외는 POSIX 로 취급. */
export type PlatformName = 'win32' | 'darwin' | 'linux' | (string & {});

/**
 * 이 플랫폼의 기본 파일시스템이 대소문자를 가리지 않는가.
 *
 * - win32: NTFS/FAT 는 대소문자 무시.
 * - darwin: 기본 APFS 볼륨이 대소문자 무시(사용자가 case-sensitive 로 포맷했다면 예외지만,
 *   그 경우 접지 않는 쪽이 오히려 "같은 폴더를 두 개로 본다"는 더 흔한 오작동을 낳는다).
 * - linux 등: 대소문자를 구분한다 — 절대 접으면 안 된다.
 */
export function isCaseInsensitiveFs(platform: PlatformName): boolean {
  return platform === 'win32' || platform === 'darwin';
}

/**
 * 경로의 **모양**만 정규화한다 — 케이스는 건드리지 않는다.
 * backslash → forward slash, 연속 슬래시 축약, 끝 슬래시 제거.
 *
 * 경계 조건 셋을 일부러 살려 둔다(비교 키가 서로 다른 대상을 같은 것으로 뭉개면 안 된다):
 * - UNC(`\\server\share`)의 **선행 이중 슬래시**는 보존한다. 축약하면 `/server/share` 가 되어
 *   루트 절대경로와 구분되지 않는다.
 * - 드라이브 루트(`C:/`)는 끝 슬래시를 남긴다. 떼면 `C:` 가 되는데, Windows 에서 그건
 *   "C 드라이브의 현재 디렉터리"라는 **다른 뜻**이다.
 * - POSIX 루트(`/`)는 그대로 `/`.
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
 * 예전 방식(플랫폼 무관 무조건 소문자)으로 만든 키.
 *
 * **읽기 폴백 전용이다.** 이미 디스크에 저장된 체크포인트·app-state·두뇌/플러그인 맵은
 * mac/linux 에서도 소문자 키로 적혀 있다. `pathKey` 로 조회해 못 찾았을 때 이 키로 한 번 더
 * 찾아 주면, 업그레이드한 mac/linux 사용자가 열린 탭·두뇌 설정을 잃지 않는다.
 * 새로 쓰는 키에는 절대 쓰지 마라.
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
 * `child` 가 `root` 안(또는 root 자신)인가 — 경로 탈출(`..`) 방어의 공통 판정.
 *
 * 서버의 세 곳(REST 경로 검증·워크스페이스 탐색기·내장 편집창)이 각자
 * "win32 면 소문자로 접고 아니면 그대로" 를 손으로 적고 있었다. 그 방식은 **mac 에서 틀린다** —
 * mac 기본 APFS 는 대소문자를 무시하므로 아래 두 예시 경로는 같은 폴더인데,
 *   `/Users/me/Proj` · `/users/me/proj` — 가상의 예시다(privacy-ok).
 * 접지 않으면 정상 요청이 사유 없이 거부된다(= 조용한 실패). 반대로 linux 에서 접으면 케이스만
 * 다른 남의 폴더가 안쪽으로 통과한다. 그래서 접을지 말지는 `pathKey` 한 곳에만 맡긴다.
 *
 * ⚠ `pathKey` 는 구분자를 forward slash 로 접는다 — **경계 비교도 forward slash 로 해야 한다.**
 *   `path.sep` 으로 비교하면 Windows 에서 백슬래시를 찾다가 언제나 어긋나, 루트 자신을 뺀
 *   모든 하위 경로가 거부된다.
 *
 * 판정에만 쓰고, **호출부가 돌려주는 경로는 원본 대소문자 그대로** 써야 한다(표시·열기에 쓰이므로).
 */
export function isPathWithin(child: string, root: string, platform: PlatformName): boolean {
  const c = pathKey(child, platform);
  const r = pathKey(root, platform);
  if (c === r) return true;
  // 드라이브 루트(`c:/`)와 POSIX 루트(`/`)는 이미 끝에 슬래시가 있다 — 하나 더 붙이면 못 맞춘다.
  const prefix = r.endsWith('/') ? r : `${r}/`;
  return c.startsWith(prefix);
}
