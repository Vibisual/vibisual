import type { HitRect } from '@vibisual/video';

import { isPromiseLike, type InspectorPickLevels, type InspectorPickPoint } from '../../utils/inspectorPick.js';

/** §5.4 #15 (C) — Alt 인스펙터에게 주는 한 칸(문서 픽셀). */
export interface PreviewInspectLevel {
  readonly rect: HitRect;
  readonly label: string;
  readonly text: string;
  readonly clipboard: string;
}
export type PreviewInspectLevels = readonly PreviewInspectLevel[];

export type PreviewInspect = (x: number, y: number) => PreviewInspectLevels | Promise<PreviewInspectLevels>;

/**
 * §5.4 #15 (C) — 판 안의 보이는 픽셀 ↔ 문서 픽셀. 미리보기의 조작 판은 영상 프레임과 같은 상자라 판의 보이는 크기 대 문서 크기의
 * 비로 옮긴다 — 맞춤·100% 보기와 CSS `zoom` 에 무관하다(판의 보이는 크기는 코어가 잰다).
 */
export function previewInspectPicker(
  size: { readonly width: number; readonly height: number },
  inspect: PreviewInspect,
): (at: InspectorPickPoint) => InspectorPickLevels | PromiseLike<InspectorPickLevels> {
  return (at) => {
    if (at.width <= 0 || at.height <= 0 || size.width <= 0 || size.height <= 0) return [];
    const sx = at.width / size.width;
    const sy = at.height / size.height;
    const toLocal = (levels: PreviewInspectLevels): InspectorPickLevels => levels.map((l) => ({
      rect: { x: l.rect.x * sx, y: l.rect.y * sy, width: l.rect.width * sx, height: l.rect.height * sy },
      label: l.label,
      text: l.text,
      clipboard: l.clipboard,
    }));
    const answer = inspect(at.x / sx, at.y / sy);
    return isPromiseLike(answer) ? Promise.resolve(answer).then(toLocal) : toLocal(answer);
  };
}
