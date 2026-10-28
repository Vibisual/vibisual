/** imageClipboard.ts — §5.5 #17-25 ④-2 표시한 그대로(없으면 원본) 클립보드로. OS 마다 갈리는 것은 막히는 방식(권한 거절 / API 없음)이라 클립보드를 인자로 받는다(안에서 `navigator` 를 읽으면 검증 불가). */

/** 클립보드 형식은 PNG 하나 — Chromium 비동기 클립보드가 세 OS 공통으로 받는 이미지는 `image/png` 뿐(win CF_DIBV5·mac NSPasteboard·linux `image/png`). 늘리면 어떤 앱에선 조용히 안 붙는다. */
export const CLIPBOARD_IMAGE_MIME = 'image/png';

/** 복사가 실패한 이유 — 화면이 서로 다른 문장을 말할 수 있게 갈라 둔다. */
export type CopyImageFailure =
  /** 이 런타임에 클립보드 이미지 쓰기가 아예 없다(구버전·비보안 컨텍스트). */
  | 'unsupported'
  /** OS·브라우저가 거절했다(권한, 또는 창이 초점을 잃은 사이의 호출). */
  | 'denied'
  /** 그 외 — 굽기·전달 중 실패. */
  | 'failed';

export type CopyImageResult = { ok: true } | { ok: false; reason: CopyImageFailure };

/** 클립보드 쓰기 두 조각만 추린 이음매 — `ClipboardItem` 타입은 lib.dom 에만 있어 `unknown`(DOM 없이 시험, 값은 넘기기만). */
export interface ClipboardSurface {
  write(items: readonly unknown[]): Promise<void>;
  createItem(payload: Record<string, Blob | Promise<Blob>>): unknown;
}

/** `resolveClipboardSurface` 가 들여다보는 전역의 모양(테스트가 가짜를 그대로 넣을 수 있게). */
export interface ClipboardScope {
  navigator?: { clipboard?: { write?: unknown } | null } | null;
  ClipboardItem?: unknown;
}

/** 쓸 수 있는 클립보드(하나라도 없으면 `null` — 버튼이 흐려진다). 보안 컨텍스트 전용이라 `file://`·loopback 에선 살아 있지만, 있다고 가정하지 않는다(던지면 라이트박스가 죽는다). */
export function resolveClipboardSurface(scope: ClipboardScope | null | undefined): ClipboardSurface | null {
  const clipboard = scope?.navigator?.clipboard;
  const ctor = scope?.ClipboardItem;
  if (!clipboard || typeof clipboard.write !== 'function') return null;
  if (typeof ctor !== 'function') return null;
  const write = clipboard.write as (items: readonly unknown[]) => Promise<void>;
  const Ctor = ctor as new (payload: Record<string, Blob | Promise<Blob>>) => unknown;
  return {
    // `clipboard` 를 this 로 묶어 둔다 — 떼어 낸 함수를 그냥 부르면 Chromium 이 Illegal invocation 으로 던진다.
    write: (items) => write.call(clipboard, items),
    createItem: (payload) => new Ctor(payload),
  };
}

/** 거절인가(권한·초점), 아니면 그냥 실패인가. 화면 문장이 갈리는 유일한 판정이라 따로 둔다. */
export function classifyCopyError(err: unknown): CopyImageFailure {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  return 'failed';
}

/** 구운 이미지를 클립보드에. `ClipboardItem` 에 Blob 대신 Promise 를 넣는다 — 사이에 `await` 가 끼면 제스처 밖 쓰기라 Safari 계열·일부 리눅스가 거절한다(Chromium 도 받는다). */
export async function copyImageToClipboard(
  blob: Blob | Promise<Blob | null> | null,
  surface: ClipboardSurface | null,
): Promise<CopyImageResult> {
  if (!surface) return { ok: false, reason: 'unsupported' };
  // 굽기가 아직 안 끝났으면 그 약속을 그대로 싣는다(위 주석). 이미 값이면 값을 싣는다.
  const payload = blob instanceof Promise
    ? blob.then((baked) => {
      if (!baked) throw new Error('render failed');
      return baked;
    })
    : blob;
  if (!payload) return { ok: false, reason: 'failed' };
  try {
    const item = surface.createItem({ [CLIPBOARD_IMAGE_MIME]: payload });
    await surface.write([item]);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: classifyCopyError(err) };
  }
}
