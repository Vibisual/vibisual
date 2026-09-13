/**
 * imageClipboard.ts — §5.5 #17-25 ④-2 **표시한 그대로 클립보드로 나간다.**
 *
 * 라이트박스에서 그림이 나가는 길은 셋이었다 — 첨부(④)·그 파일 덮어쓰기(④-1)·내려받기(⑤).
 * 셋 다 목적지가 **이 앱 안이거나 디스크**라, 그린 표시를 **다른 프로그램에 곧바로 붙이는** 길이
 * 없었다(메신저·이슈·문서). 그 자리를 클립보드가 채운다. 내려받기처럼 **주석이 없어도 된다** —
 * 없으면 원본 한 장이 그대로 나간다.
 *
 * **왜 이 파일이 따로 있는가** — 클립보드는 §CLAUDE.md 멀티플랫폼 6축의 마지막(OS 기능)이고,
 * 세 OS 에서 갈리는 것은 코드가 아니라 **막히는 방식**이다(권한 거절 / 이 런타임엔 API 자체가
 * 없음). 그 갈래를 win 개발기에서 다 시험하려면 클립보드를 **인자로 받아야** 한다 — 클라
 * 테스트에는 DOM 이 없으므로(jsdom 미설치) `navigator` 를 모듈 안에서 직접 읽으면 그 분기는
 * 영영 검증되지 않는다(`process.platform` 을 함수 안에서 읽지 말라는 규약과 같은 이유).
 */

/**
 * 클립보드에 싣는 형식은 **PNG 하나**다.
 *
 * ④-1 의 파일 덮어쓰기는 원본 형식(jpeg·webp)을 지켜야 확장자와 내용이 어긋나지 않지만,
 * 클립보드는 파일이 아니라 **붙여넣기 한 번짜리 그림**이다. 그리고 Chromium 의 비동기
 * 클립보드가 세 OS 에서 공통으로 받아 주는 이미지 형식은 `image/png` 뿐이라(win 은 CF_DIBV5,
 * mac 은 NSPasteboard PNG, linux 는 `image/png` 타깃으로 각자 옮긴다), 원본이 무엇이든
 * PNG 로 구워 내보낸다. 형식을 늘리려다 "어떤 앱에서는 조용히 안 붙는" 상태를 만들지 않는다.
 */
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

/**
 * 클립보드 이미지 쓰기에 필요한 두 조각만 추린 이음매.
 *
 * `unknown` 인 이유는 `ClipboardItem` 타입이 lib.dom 에만 있고 이 모듈은 DOM 없이도 시험되기
 * 때문이다 — 실제 값은 그냥 넘겨 주기만 하면 되므로 우리가 그 모양을 알 필요가 없다.
 */
export interface ClipboardSurface {
  write(items: readonly unknown[]): Promise<void>;
  createItem(payload: Record<string, Blob | Promise<Blob>>): unknown;
}

/** `resolveClipboardSurface` 가 들여다보는 전역의 모양(테스트가 가짜를 그대로 넣을 수 있게). */
export interface ClipboardScope {
  navigator?: { clipboard?: { write?: unknown } | null } | null;
  ClipboardItem?: unknown;
}

/**
 * 전역에서 쓸 수 있는 클립보드를 뽑는다 — 하나라도 없으면 `null`(그때 버튼이 흐려진다).
 *
 * `navigator.clipboard` 는 **보안 컨텍스트에서만** 정의된다. 패키지 앱의 렌더러는 `file://`
 * 에서 뜨는데 Chromium 은 그 출처를 신뢰 가능으로 다루므로 셋 다 살아 있고, 브라우저로 여는
 * 개발 경로(`http://127.0.0.1`)도 loopback 이라 보안 컨텍스트다. 그래도 **있다고 가정하지
 * 않는다** — 없는 자리에서 던지면 라이트박스가 통째로 죽는다.
 */
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

/**
 * 구운 이미지 한 장을 클립보드에 올린다.
 *
 * **`ClipboardItem` 에 Blob 이 아니라 Promise 를 넣는다.** 굽기(`canvas.toBlob`)와 쓰기 사이에
 * `await` 가 끼면 사용자 제스처가 이미 끝난 뒤에 클립보드를 만지는 셈이 되어, 그 순간을 엄격히
 * 보는 런타임(Safari 계열·일부 리눅스 조합)에서 거절된다. 값이 아니라 약속을 먼저 건네면 쓰기
 * 자체는 제스처 안에서 시작된다 — Chromium 도 같은 모양을 받아 주므로 **한 길로 족하다**.
 */
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
