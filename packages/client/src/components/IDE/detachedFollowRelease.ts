// SCENARIO.md §5.5 #17-6 (H-4) ⑥ · (H-23) — **창이 커서에 매달린 동안의 뗌은 두 창이 함께 듣는다.**
//
// 마우스 캡처가 어느 창에 있는지는 OS 가 정한다(창이 활성화되거나 숨으면 캡처가 옮겨 가거나
// 걷힌다). 뗌을 놓쳤을 때의 대가가 **"창이 영영 커서를 따라다닌다"** 라 한쪽만 듣게 두지 않는다.
// 두 번 불려도 안전하다 — 이미 끝난 판은 main 이 조용히 지나간다.
//
// 이 그물이 사는 두 자리:
//   ⓐ **나가는 길** — 앱 안에서 끌어내는 순간(손은 메인 창에 있다). `AgentIDEOverlay` 가
//      꺼내면서 직접 건다. 꺼내는 순간 그 컴포넌트는 닫혀 사라지므로 리스너를 컴포넌트가
//      아니라 **모듈**에 단다.
//   ⓑ **들어오는 길** — 독립 창의 타이틀바를 잡고 앱 안으로 들어오는 판(손은 그 독립 창에
//      있었다). (H-12) 가 들어온 순간 그 창을 **숨기므로** OS 가 캡처를 걷고, 그 뒤의 뗌은
//      그 렌더러에 영영 닿지 않는다 — 그때 들을 수 있는 것은 커서 아래의 메인 창뿐이다.
//      메인 창은 main 이 보내는 매달림 신호를 듣고 이 그물을 건다(`useDetachedFollowRelease`).
//
// 둘이 같은 함수를 쓰는 까닭은 고쳐야 할 날이 왔을 때 한 곳만 고치기 위해서다 — 나가는 길에서
// 잡은 조합(뗌 · 버튼 없이 움직임 · 포커스 잃음)은 들어오는 길에서도 그대로 필요하다.

/**
 * 이 에이전트의 창이 커서에서 **놓이는 순간**을 듣고 main 에 알린다.
 *
 * @returns 그물을 걷는 손잡이 — 판이 신호로 끝났을 때(창이 합쳐졌다·되살아났다) 부른다.
 *   호출하지 않아도 첫 뗌에 스스로 걷히므로, 놓쳐도 리스너가 쌓이지는 않는다.
 */
export function watchDetachedFollowRelease(agentId: string): () => void {
  const end = (): void => {
    detach();
    void window.api?.overlay?.dragEndFor?.(agentId);
  };
  // 뗌 자체를 놓쳤을 때의 그물 — 버튼이 눌리지 않은 채 움직이면 이미 놓은 것이다.
  const onMove = (ev: MouseEvent): void => {
    if (ev.buttons === 0) end();
  };
  function detach(): void {
    window.removeEventListener('mouseup', end, true);
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('blur', end);
  }
  window.addEventListener('mouseup', end, true);
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('blur', end);
  return detach;
}
