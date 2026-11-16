import { FaceStill } from '../../apps/canvasFaceKit.js';
import type { AppThumbnail } from '../../apps/registry.js';

/**
 * §5.4 #36 (F)(G) — 앱 위성 화면 안쪽의 코어 몫(조작이 있는 안쪽은 앱의 `canvasFace`): 결과 없음 → 아이콘 + 안내(도는 중이면 "만드는 중…"),
 * 결과는 있는데 앱 그림이 없음 → 정지 미리보기(`FaceStill`). 앱 이름을 모른다 — 구운 두 모양(그림·파형)만. 가운데 재생 삼각형·노드 안 입력 ❌(#36 (D)).
 */
export interface AppScreenFaceProps {
  /** 안쪽 상자 크기(px) — 파형 좌표계. */
  readonly width: number;
  readonly height: number;
  /** 앱 색(밝은 쪽) — 파형·아이콘. */
  readonly glow: string;
  readonly icon: React.ReactNode;
  readonly hasFile: boolean;
  readonly working: boolean;
  readonly thumb: AppThumbnail | null;
  readonly thumbLoading: boolean;
  readonly emptyText: string;
  readonly workingText: string;
  /** §5.4 #36 (L) — 비추는 것이 결과가 아니라 작업 중 파일이면 아래 띠로 밝힌다. */
  readonly workCaption?: { readonly label: string; readonly name: string; readonly title: string } | undefined;
}

export function AppScreenFace({
  width,
  height,
  glow,
  icon,
  hasFile,
  working,
  thumb,
  thumbLoading,
  emptyText,
  workingText,
  workCaption,
}: AppScreenFaceProps): React.JSX.Element {
  if (hasFile) {
    return (
      <>
        <FaceStill thumb={thumb} loading={thumbLoading} glow={glow} icon={icon} width={width} height={height} />
        {workCaption ? (
          <div title={workCaption.title} className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-black/70 px-1.5 py-0.5 text-[12px] leading-4">
            <span className="shrink-0 font-medium text-white/85">{workCaption.label}</span>
            <span className="min-w-0 truncate text-white/55">{workCaption.name}</span>
          </div>
        ) : null}
      </>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center">
      <span className="flex opacity-75 [&>svg]:h-5 [&>svg]:w-5" style={{ color: glow }}>
        {icon}
      </span>
      <span className="text-[12px] leading-4 text-white/55">{working ? workingText : emptyText}</span>
    </div>
  );
}
