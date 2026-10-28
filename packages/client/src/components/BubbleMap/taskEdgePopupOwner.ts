/**
 * §3.5 · §5.3 #12 — 태스크 엣지 설정창(생성·편집)은 **열 때 적어 둔 프로젝트**로 가른다(스토어 존재도 함께 본다).
 * "엣지가 스토어에 있나"만 보면 안 된다 — 스냅샷은 모든 창 범위의 합집합이라 독립 창(§5.5 #17-6)이 앞 프로젝트를 붙들면 엣지가 남는다.
 * 닫지 않는다(돌아오면 다시 선다). 값은 `activeProject` 와 같은 **표시명**이다.
 */
export function isTaskEdgePopupOwnedByActiveProject(
  ownerProject: string | null,
  activeProject: string | null,
): boolean {
  return ownerProject === activeProject;
}
