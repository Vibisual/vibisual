/**
 * §5.5 #17-6 (H-16) · §5.13 (S-11) — 밖에 서 있는 창을 앱 안에서 **불렀을 때의 대답**(테두리 기척 한 번).
 *
 * 그 창은 이미 보이고 있던 경우가 많다 — 그때 앞으로 세우기만 하면 화면이 그대로여서 "내 더블클릭이 저 창에 닿았다"가
 * 어디에도 나타나지 않는다. 그래서 창 가장자리를 한 번 두르고 안쪽을 아주 옅게 씻어 내린다(`animate-overlay-attention`).
 * 클릭통과라 비치는 동안에도 창은 그대로 쓰고, 끝나면 스스로 빠져 DOM 에 남지 않는다. IDE 창과 앱 창이 **같은 그림**을
 * 쓴다 — 같은 대답이 창 종류마다 다르게 보이면 안 된다.
 *
 * @param seq 몇 번째 대답인가 — 0 이면 그리지 않는다. 연달아 불려도 번호가 바뀌면 **새 원소**가 되어 애니메이션이 다시 돈다.
 * @param className 창 모양(둥근 모서리 등)만 덧붙인다.
 */
export function AttentionFlash({ seq, onDone, className = '' }: {
  seq: number;
  onDone: () => void;
  className?: string;
}): React.JSX.Element | null {
  if (seq <= 0) return null;
  return (
    <div
      key={seq}
      aria-hidden
      onAnimationEnd={onDone}
      className={`animate-overlay-attention pointer-events-none fixed inset-0 z-[200] border-2 border-sky-300/80 bg-sky-300/10 shadow-[0_0_28px_rgba(125,211,252,0.35)_inset] ${className}`}
    />
  );
}
