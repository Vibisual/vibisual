import { FaceStill } from '../../apps/canvasFaceKit.js';
import type { AppThumbnail } from '../../apps/registry.js';

/**
 * §5.4 #36 (F)(G) — 앱 위성 **화면의 안쪽 — 코어가 그리는 몫**.
 *
 * 결과가 담긴 화면의 조작(재생·돌려 보기·맞춤)은 앱이 레지스트리 `canvasFace` 로 그린다(G). 여기는 그 바깥 둘만 맡는다.
 * - 결과가 아직 없다 → 아이콘 + "결과가 여기 뜹니다"(이어진 에이전트가 도는 중이면 "만드는 중…").
 * - 결과는 있는데 앱의 그림이 아직 안 내려왔거나 앱이 선언하지 않았다 → 정지 미리보기(공용 `FaceStill` — 앱의 그림과 같은 부품).
 *
 * 코어는 앱 이름을 모른다 — 앱이 구운 결과 두 모양(그림·파형)만 그린다. 이름·고정 표식은 머리줄이 말한다(G).
 * 가운데 큰 재생 삼각형·노드 안 입력은 두지 않는다(SSOT #36 (D)).
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
}: AppScreenFaceProps): React.JSX.Element {
  if (hasFile) {
    return <FaceStill thumb={thumb} loading={thumbLoading} glow={glow} icon={icon} width={width} height={height} />;
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
