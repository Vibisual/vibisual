/**
 * taskEdgePopupOwner.ts — §3.5 프로젝트 독립성 · §5.3 #12 Task Edge —
 * **태스크 엣지 설정창(생성·편집)은 연 프로젝트의 것이다.**
 *
 * 종전 편집창은 "그 엣지가 스토어에 있으면" 그렸다. 탭을 옮기면 앞 프로젝트의 엣지가 전선에서
 * 빠지므로 평소에는 우연히 맞았다. 그런데 스냅샷은 **모든 창이 선언한 범위의 합집합**이라
 * (`SetProjectScopePayload`) 독립 창(§5.5 #17-6 — 제 프로젝트를 `setActiveProjectLocal` 로 선언한다)이
 * 앞 프로젝트를 붙들고 있으면 그 엣지가 메인 창 스토어에도 그대로 남고, 설정창이 옮겨 간 프로젝트
 * 위에 떠 있었다. 생성창은 아예 프로젝트를 보지 않아 독립 창 없이도 따라왔다.
 *
 * 그래서 "스토어에 있나"가 아니라 **열 때 적어 둔 프로젝트**로 가른다(스토어 존재는 여전히 함께 본다 —
 * 그 사이 지워진 엣지의 창을 그리지 않게). 닫지는 않는다 — 원래 프로젝트로 돌아오면 그 자리에
 * 다시 선다. 독립 창이 없을 때 편집창이 하던 그대로다.
 *
 * 값은 `activeProject` 와 같은 **표시명**이다(`commentBoxes`·`appBubbles` 의 `projectName` 과 같은 축).
 */
export function isTaskEdgePopupOwnedByActiveProject(
  ownerProject: string | null,
  activeProject: string | null,
): boolean {
  return ownerProject === activeProject;
}
