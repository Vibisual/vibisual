/**
 * §5.5 #17-6 (H-16) · §5.13 (S-11) — 밖에 선 창을 앱 안에서 불렀을 때의 대답(테두리 기척 한 번).
 * 이미 보이던 창은 앞세워도 화면이 그대로라 필요하다. 클릭통과이고 끝나면 DOM 에서 빠진다. IDE 창과 앱 창이 같은 그림을 쓴다.
 * @param seq 몇 번째 대답인가 — 0 이면 안 그린다. 번호가 바뀌면 새 원소라 애니메이션이 다시 돈다.
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
