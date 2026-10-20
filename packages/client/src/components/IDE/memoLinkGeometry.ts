/** 화면 좌표의 사각형 — DOM 없이도 링크 줄의 가림을 계산할 수 있다. */
export interface MemoLinkRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface MemoLinkAnchor {
  left: number;
  top: number;
  bottom: number;
}

/**
 * 여러 줄 링크에서 입력칸 안에 보이는 첫 줄을 고른다. 첫 줄이 스크롤로 가려져도 다음 줄은
 * 여전히 링크다. 일부만 보이는 줄은 보이는 부분에 붙이고, 전부 가려졌을 때만 상자를 접는다.
 */
export function visibleMemoLinkAnchor(rects: ArrayLike<MemoLinkRect>, viewport: MemoLinkRect): MemoLinkAnchor | null {
  for (let i = 0; i < rects.length; i += 1) {
    const rect = rects[i]!;
    const left = Math.max(rect.left, viewport.left);
    const right = Math.min(rect.right, viewport.right);
    const top = Math.max(rect.top, viewport.top);
    const bottom = Math.min(rect.bottom, viewport.bottom);
    if (left >= right || top >= bottom) continue;
    return { left: Math.round(left), top: Math.round(top), bottom: Math.round(bottom) };
  }
  return null;
}
