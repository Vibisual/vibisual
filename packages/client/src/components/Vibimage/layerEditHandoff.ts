import { openAppWindow, type AppWindowArgs } from '../../apps/appWindows.js';

/**
 * §5.5 #17-25 ④-3 — 빠른 편집에서 레이어 편집기로 넘기는 그림. 디스크를 거치지 않는 한 번 쓰는 손넘김이라 같은 렌더러의 앱 안 창만
 * 받는다(새 창의 `draftKey` 가 열쇠). 바이트는 그 원본을 저장할 때만 `.vibisual/creation/blobs/` 에 간다(§5.13 (R-10)).
 */
export interface LayerEditPicture {
  readonly blob: Blob;
  /** 레이어·창 이름. */
  readonly name: string;
  /** 그 그림이 온 프로젝트 파일(루트 기준) — 있을 때만. */
  readonly original?: string;
}

const VIBIMAGE_APP_ID = 'vibimage';
/** 받지 못한 손넘김은 최근 이만큼만 붙든다 — 창이 끝내 뜨지 않으면 그 바이트를 계속 쥐지 않게. */
const PENDING_MAX = 4;
const pending = new Map<string, LayerEditPicture>();
let seq = 0;

/** 레이어 편집기 창을 새로 열어 그림을 넘긴다. 프로젝트를 모르거나 창을 못 열면 false(넘긴 것도 거둔다). */
export function openInLayerEditor(
  projectId: string,
  picture: LayerEditPicture,
  open: (args: AppWindowArgs) => boolean = openAppWindow,
): boolean {
  if (!projectId) return false;
  seq += 1;
  const key = `layers-${Date.now().toString(36)}-${seq}`;
  pending.set(key, picture);
  while (pending.size > PENDING_MAX) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
  const opened = open({ appId: VIBIMAGE_APP_ID, projectId, draftKey: key, title: picture.name });
  if (!opened) pending.delete(key);
  return opened;
}

/** 그 창에 온 그림 — 지우지 않는다(같은 창이 다시 그려져도 같은 답이어야 한다). 받은 뒤 `releaseLayerEditPicture`. */
export function peekLayerEditPicture(key: string | undefined): LayerEditPicture | null {
  return key ? pending.get(key) ?? null : null;
}

export function releaseLayerEditPicture(key: string | undefined): void {
  if (key) pending.delete(key);
}
