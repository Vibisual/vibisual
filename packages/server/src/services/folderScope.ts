/**
 * §9 폴더 스코프드 스냅샷 — **그리는 폴더와 한 칸 앞**만 싣는다(규칙 단일 소유).
 * 합집합: ① 최상위 폴더(그 `children` 이 한 칸 앞) ② 선언된 내비 경로(조상 `children` 은 `← Back`·breadcrumb 이 이름을 찾는다) ③ 선언된 폴더의 하위 폴더(한 칸 앞 — 없으면 열 때마다 왕복 지연).
 * 실측(2026-09-02): 1,306,933 → 72,938 바이트(5.6%). 두 칸 앞은 19.4% 로 얻는 것이 없다.
 * `declared === null` 이면 전량 — 선언이 없거나 폴더 축을 모르는 구버전 클라가 있으면 좁히지 않는다(침묵을 축소로 읽으면 폴더 내부가 빈 채 굳는다).
 */

/**
 * `children`·`innerEdges`·폴더 위성을 실을 폴더 id 집합.
 * @param topFolderIds 최상위 폴더 id(한 칸 앞을 겸한다)
 * @param declared 창들이 선언한 내비 경로 id 합집합. `null` = 범위 미적용(전량)
 * @param childFolderIdsOf 폴더 id → 하위 폴더 id(파일·위성 제외)
 * @returns 실을 폴더 id 집합. `null` = 전부
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
