/**
 * §9 **폴더 스코프드 스냅샷 — "그리는 폴더와 한 칸 앞"만 싣는다.** 규칙 단일 소유.
 *
 * 프로젝트 축(§9 스코프드 스냅샷 구독)이 "아무도 안 보는 프로젝트는 보내지 않는다"였다면,
 * 이 절은 그 한 칸 아래다 — **한 프로젝트 안에서도 화면에 그려지는 폴더는 하나뿐이다.**
 *
 * 실측(2026-09-02 · 이 프로젝트의 살아 있는 checkpoint.json): 폴더 부모 459개 · 자식 2,866개가
 * 매 스냅샷마다 통째로 실렸다. 그런데 캔버스가 그리는 것은 **최상위 폴더들**(31개)과 **지금
 * 열어 둔 폴더 하나**의 자식뿐이다. 나머지는 ① 서버에서 `enrichNode` 로 새로 만들어지고
 * ② Electron IPC 의 **동기 structuredClone** 을 타고 ③ 렌더러에서 역직렬화되고 ④ 클라
 * `structuralShare` 비교까지 받은 뒤 — 한 번도 그려지지 않고 버려졌다.
 * 세 슬라이스(`children`·`innerEdges`·폴더 위성) 합 **1,306,933 → 72,938 바이트(5.6%)**.
 *
 * ── 규칙: **그려지는 폴더 + 한 칸 앞** ─────────────────────────────────────────────
 *
 * 싣는 대상은 아래 셋의 합집합이다.
 *  1. **최상위 폴더** — 메인 뷰에 실제로 그려진다. 그 `children` 은 곧 "메인 뷰에서 폴더 하나를
 *     눌렀을 때" 필요한 것이므로 한 칸 앞을 겸한다.
 *  2. **선언된 내비 경로**(조상 … 현재 폴더) — 현재 폴더의 `children` 이 지금 그려지는 내용이고,
 *     조상들의 `children` 은 `← Back` 과 상단 경로 표시(breadcrumb)가 이름을 찾는 자리다.
 *  3. **현재 폴더 안에서 다음에 누를 수 있는 폴더**(선언된 폴더들의 하위 폴더) — 한 칸 앞.
 *
 * 3번이 이 규칙의 핵심이다. 이것이 없으면 폴더를 열 때마다 **선언 → 스냅샷 회신**이라는 왕복이
 * 눈에 보이는 지연이 된다(느린 회선에서는 몇 초). 한 칸을 미리 실어 두면 드릴다운도 `← Back`도
 * 왕복 없이 즉시 열리고, 그런데도 비용은 전량의 6% 안쪽이다. **두 칸까지 미리 실으면** 같은
 * 실측에서 19.4% 로 세 배가 되면서 얻는 것은 없다(두 번 연속 누르는 사이에 왕복이 끝난다).
 *
 * ── 안전 기본값 ────────────────────────────────────────────────────────────────
 *
 * `declared === null` 이면 **전량**이다(`null` 반환). 프로젝트 축이 세운 것과 같은 규칙 —
 * 선언한 창이 하나도 없거나, 폴더 축을 모르는 구버전 클라가 하나라도 붙어 있으면 좁히지 않는다.
 * **침묵이 축소로 읽히면 그 창의 폴더 내부가 빈 채로 굳는다.**
 */

/**
 * 이번 스냅샷에 `children`/`innerEdges`/폴더 위성을 실어야 할 폴더 id 집합을 정한다.
 *
 * @param topFolderIds 메인 뷰에 그려지는 최상위 폴더 id (그 자체가 "한 칸 앞"을 겸한다)
 * @param declared 창들이 선언한 내비 경로 id 의 합집합. `null` = 범위 미적용(전량)
 * @param childFolderIdsOf 폴더 id → 그 폴더의 **하위 폴더** id 목록(파일·위성은 제외)
 * @returns 실어야 할 폴더 id 집합. `null` 이면 "전부 실어라"
 */
export function resolveFolderShipSet(
  topFolderIds: Iterable<string>,
  declared: ReadonlySet<string> | null,
  childFolderIdsOf: (folderId: string) => readonly string[],
): ReadonlySet<string> | null {
  if (declared === null) return null;

  const ship = new Set<string>();
  // ① 메인 뷰에 그려지는 것 — 폴더 안에 들어가 있어도 계속 싣는다. 홈으로 돌아가는 것도
  //    드릴다운과 똑같이 즉시여야 하고, 31개 폴더의 자식은 실측 31.6KB 로 싸다.
  for (const id of topFolderIds) ship.add(id);

  for (const id of declared) {
    // ② 지금 그리는 내용 + 조상(뒤로가기·경로 표시)
    ship.add(id);
    // ③ 한 칸 앞 — 이 폴더 안에서 다음에 누를 수 있는 폴더
    for (const childId of childFolderIdsOf(id)) ship.add(childId);
  }
  return ship;
}
