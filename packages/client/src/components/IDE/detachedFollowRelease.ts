// §5.5 #17-6 (H-4) ⑥ · (H-23) — 매달린 동안의 뗌은 두 창이 함께 듣는다(캡처 위치는 OS 가 정하고, 놓치면 창이 영영 커서를 따른다). 두 번 불려도 안전.
// ⓐ 나가는 길: `AgentIDEOverlay` 가 꺼내며 건다 — 컴포넌트가 곧 사라지므로 리스너는 모듈에. ⓑ 들어오는 길: (H-12) 가 숨긴 뒤라 메인 창이
// main 의 매달림 신호로 건다(`useDetachedFollowRelease`). 두 길이 같은 감지 조합(뗌·버튼 없이 움직임·포커스 잃음)을 쓴다.

/**
 * 창이 커서에서 놓이는 순간을 듣고 main 에 알린다.
 * @returns 그물을 걷는 손잡이 — 판이 신호로 끝났을 때 부른다. 안 불러도 첫 뗌에 스스로 걷힌다.
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
