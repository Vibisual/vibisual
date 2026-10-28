import type { DetachGhostFrame } from '@vibisual/shared';

/**
 * §5.4 #14-1 (H) — 탭을 뗄 때의 앱 안 폴백 선. 정본은 main 클릭통과 창(`ghostFrame.ts`) — 그 창이 서기 전이나 못 띄우는 환경(합성 없는 리눅스 등)에서 그린다.
 * 그림은 IDE 창(§5.5 #17-6 (H-19))·앱 창(§5.13 (S-10))의 선과 같아야 한다(이름 띠 34px + 안내 한 줄) — 넘어가는 순간이 안 보이게. 늘 무장한 밝은 선.
 * 자리는 고스트 칸 안 오프셋 `탭 안 잡은 지점 - 선의 잡은 지점` → 화면에선 `커서 - 선의 잡은 지점`(= main 의 선 자리).
 */
export function TabDetachOutline({
  frame,
  offset,
  label,
  hint,
}: {
  frame: DetachGhostFrame;
  offset: { x: number; y: number };
  label: string;
  hint: string;
}): React.JSX.Element {
  return (
    <div
      data-tab-detach-ghost=""
      aria-hidden="true"
      className="absolute overflow-hidden rounded-[10px] border-2 border-violet-300/95 bg-violet-500/[0.14] shadow-[inset_0_0_0_1px_rgba(15,23,42,0.55),0_10px_30px_rgba(0,0,0,0.35)]"
      style={{
        left: Math.round(offset.x),
        top: Math.round(offset.y),
        width: frame.width,
        height: frame.height,
      }}
    >
      <div className="flex h-[34px] items-center gap-1.5 border-b border-violet-300/80 bg-slate-900/55 px-2.5 text-[12px] font-medium text-violet-100/95">
        <span className="h-2 w-2 flex-none rounded-full bg-violet-400/95" />
        <span className="truncate">{label}</span>
      </div>
      <div className="truncate border-b border-violet-400/30 bg-slate-900/40 px-[11px] py-[7px] text-[12px] font-medium leading-[1.35] text-violet-200/90">
        {hint}
      </div>
    </div>
  );
}
