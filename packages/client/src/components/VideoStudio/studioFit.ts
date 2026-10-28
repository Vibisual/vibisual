/**
 * 반응형 — 좁은 창·작은 미리보기에서 떠 있는 상자를 그 상자가 놓이는 영역 안으로 맞추는 순수 계산(시험한다).
 * 이미 들어맞는 자리는 그대로 돌려준다(넓은 창 모습은 바뀌지 않는다). 폭은 부르는 쪽이 잰 값을 받는다 — 매 프레임 재서 다시 그리지 않게.
 */

/**
 * 길이 `size` 인 칸의 시작 자리를 `[margin, limit − margin]` 안으로 민다. 영역이 칸보다 좁으면 앞(`margin`)에 맞춘다 — 칸의
 * 시작(글 칸의 왼쪽·위)이 늘 보이게.
 */
export function clampSpan(start: number, size: number, limit: number, margin = 0): number {
  const max = limit - margin - size;
  if (max < margin) return margin;
  return Math.min(Math.max(start, margin), max);
}

/** 메모 글 칸(`StudioPreview` 의 NoteEditor) — 넓을 때의 폭 256px(`w-64`) · 핀과의 틈 12px(`top-3`·`left-3`) · 상자 안 여백. */
export const NOTE_EDITOR = {
  width: 256,
  /** 글 칸의 어림 높이(px) — 글 3줄 + 단추 줄. 터치에서 단추가 커진 높이까지 넉넉히 잡는다(실제보다 작으면 아래가 잘린다). */
  height: 136,
  gap: 12,
  margin: 8,
} as const;

/** 미리보기 상자의 크기와, 그 안에서 그림 판(프레임)이 선 자리(px). */
export interface PreviewBounds {
  readonly width: number;
  readonly height: number;
  readonly frameLeft: number;
  readonly frameTop: number;
}

/** 핀 기준 글 칸의 자리(px) — 핀 자리를 감싼 칸 안의 `left`·`top`, 폭, 높이 상한(넘으면 글 칸 안에서 스크롤한다). */
export interface NoteEditorPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly maxHeight: number;
}

/**
 * 메모 글 칸의 자리. 핀(판 안 `anchorX`·`anchorY`) 옆 12px 에 서되 — 오른쪽에 꽂은 핀이면(`flip`) 왼쪽으로 — 미리보기 상자를
 * 넘으면 안으로 민다. 아래가 모자라면 핀 위로 올리고, 위아래 다 모자라면 상자 안에 맞춘다. 폭은 상자 폭 − 여백까지 줄어든다.
 */
export function noteEditorPlacement(anchorX: number, anchorY: number, flip: boolean, box: PreviewBounds): NoteEditorPlacement {
  const { gap, margin } = NOTE_EDITOR;
  const width = Math.max(0, Math.min(NOTE_EDITOR.width, box.width - margin * 2));
  const maxHeight = Math.max(0, box.height - margin * 2);
  const height = Math.min(NOTE_EDITOR.height, maxHeight);
  // 핀의 상자 안 자리.
  const ax = box.frameLeft + anchorX;
  const ay = box.frameTop + anchorY;
  const x = clampSpan(flip ? ax - gap - width : ax + gap, width, box.width, margin);
  const below = ay + gap;
  const above = ay - gap - height;
  const y = below + height <= box.height - margin ? below : above >= margin ? above : clampSpan(below, height, box.height, margin);
  return { left: x - ax, top: y - ay, width, maxHeight };
}

/** 구슬 폭(px)이 이보다 좁으면 제목을 걷고 번호·메뉴만 남긴다(제목 두세 글자 + 메뉴 단추가 들어가는 폭). */
export const STRIP_TITLE_MIN_PX = 48;

/**
 * 장면 구슬 줄(`SceneStrip`)에서 제목을 세울 수 없는 좁은 구슬들. 구슬 폭 = 줄 폭 × 길이 몫 − 4px(`SceneStrip` 과 같은 식).
 * 줄 폭을 못 쟀으면(0) 하나도 없다 — 넓은 배치 그대로.
 */
export function narrowChapterIds(
  chapters: readonly { readonly id: string; readonly start: number; readonly end: number }[],
  total: number,
  trackWidth: number,
  minPx: number = STRIP_TITLE_MIN_PX,
): string[] {
  if (!(trackWidth > 0) || !(total > 0)) return [];
  return chapters
    .filter((c) => (Math.max(0, Math.min(total, c.end - c.start)) / total) * trackWidth - 4 < minPx)
    .map((c) => c.id);
}
