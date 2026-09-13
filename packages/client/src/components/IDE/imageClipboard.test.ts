/**
 * imageClipboard.test.ts — §5.5 #17-25 ④-2 클립보드 복사의 갈래를 DOM 없이 고정한다.
 *
 * 이 모듈이 클립보드를 **인자로 받는** 유일한 이유가 이 파일이다 — 실기(mac·linux)가 없으므로
 * "권한이 거절됐다"·"이 런타임엔 API 가 없다"를 win 개발기에서 재현할 방법이 이것뿐이다.
 */
import { describe, it, expect } from 'vitest';
import {
  CLIPBOARD_IMAGE_MIME,
  classifyCopyError,
  copyImageToClipboard,
  resolveClipboardSurface,
  type ClipboardSurface,
} from './imageClipboard';

/** 실제 `ClipboardItem` 처럼 **생성자 안에서 약속을 받아 두고**, write 에서 그것을 기다린다. */
function fakeSurface(): ClipboardSurface & { written: Array<Record<string, Blob>> } {
  const written: Array<Record<string, Blob>> = [];
  return {
    written,
    createItem: (payload) => payload,
    write: async (items) => {
      for (const item of items) {
        const entry = item as Record<string, Blob | Promise<Blob>>;
        const resolved: Record<string, Blob> = {};
        for (const [mime, value] of Object.entries(entry)) resolved[mime] = await value;
        written.push(resolved);
      }
    },
  };
}

const png = (): Blob => new Blob([new Uint8Array([137, 80, 78, 71])], { type: CLIPBOARD_IMAGE_MIME });

describe('resolveClipboardSurface — 없는 자리에서는 null 이지 예외가 아니다', () => {
  it('전역 자체가 없으면 null', () => {
    expect(resolveClipboardSurface(undefined)).toBeNull();
    expect(resolveClipboardSurface(null)).toBeNull();
  });

  it('navigator 는 있어도 clipboard 가 없으면 null (비보안 컨텍스트)', () => {
    expect(resolveClipboardSurface({ navigator: {}, ClipboardItem: class {} })).toBeNull();
    expect(resolveClipboardSurface({ navigator: { clipboard: null }, ClipboardItem: class {} })).toBeNull();
  });

  it('clipboard.write 가 없으면 null — writeText 만 있는 구버전', () => {
    expect(resolveClipboardSurface({ navigator: { clipboard: {} }, ClipboardItem: class {} })).toBeNull();
  });

  it('ClipboardItem 생성자가 없으면 null — 이미지 쓰기를 못 하는 런타임', () => {
    expect(resolveClipboardSurface({ navigator: { clipboard: { write: () => Promise.resolve() } } })).toBeNull();
  });

  it('둘 다 있으면 surface 를 돌려주고, write 는 clipboard 에 묶여 불린다', async () => {
    const seen: unknown[] = [];
    const clipboard = {
      marker: 'me',
      write(this: unknown, items: readonly unknown[]) {
        // 떼어 낸 함수로 불리면 this 가 undefined 다 — 그때 Chromium 은 Illegal invocation 으로 던진다.
        seen.push((this as { marker?: string })?.marker, items.length);
        return Promise.resolve();
      },
    };
    const surface = resolveClipboardSurface({ navigator: { clipboard }, ClipboardItem: class {} });
    expect(surface).not.toBeNull();
    await surface?.write(['a']);
    expect(seen).toEqual(['me', 1]);
  });
});

describe('copyImageToClipboard', () => {
  it('surface 가 없으면 unsupported — 화면이 "이 환경은 못 한다"를 말할 수 있게', async () => {
    expect(await copyImageToClipboard(png(), null)).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('굽기가 실패해 blob 이 null 이면 failed', async () => {
    expect(await copyImageToClipboard(null, fakeSurface())).toEqual({ ok: false, reason: 'failed' });
  });

  it('PNG 한 장을 image/png 로 싣는다', async () => {
    const surface = fakeSurface();
    expect(await copyImageToClipboard(png(), surface)).toEqual({ ok: true });
    expect(surface.written).toHaveLength(1);
    expect(Object.keys(surface.written[0] ?? {})).toEqual([CLIPBOARD_IMAGE_MIME]);
  });

  it('굽기가 끝나기 전에 write 가 먼저 불린다 — 쓰기가 제스처 안에서 시작된다', async () => {
    const surface = fakeSurface();
    let finishBake: (blob: Blob) => void = () => {};
    const baking = new Promise<Blob | null>((resolve) => { finishBake = resolve; });
    const order: string[] = [];
    const watched: ClipboardSurface = {
      createItem: (payload) => surface.createItem(payload),
      write: (items) => { order.push('write'); return surface.write(items); },
    };

    const pending = copyImageToClipboard(baking, watched);
    await Promise.resolve(); // microtask 한 바퀴 — 굽기는 아직 끝나지 않았다
    expect(order).toEqual(['write']);

    order.push('baked');
    finishBake(png());
    expect(await pending).toEqual({ ok: true });
    expect(order).toEqual(['write', 'baked']);
    expect(surface.written).toHaveLength(1);
  });

  it('약속이 null 로 끝나면 failed 로 접힌다', async () => {
    const surface = fakeSurface();
    const result = await copyImageToClipboard(Promise.resolve(null), surface);
    expect(result).toEqual({ ok: false, reason: 'failed' });
    expect(surface.written).toHaveLength(0);
  });

  it('권한 거절(NotAllowedError)은 denied 로 갈린다', async () => {
    const surface: ClipboardSurface = {
      createItem: (p) => p,
      write: () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })),
    };
    expect(await copyImageToClipboard(png(), surface)).toEqual({ ok: false, reason: 'denied' });
  });

  it('그 밖의 실패는 failed — 던지는 자리가 createItem 이어도 삼킨다', async () => {
    const surface: ClipboardSurface = {
      createItem: () => { throw new Error('boom'); },
      write: () => Promise.resolve(),
    };
    expect(await copyImageToClipboard(png(), surface)).toEqual({ ok: false, reason: 'failed' });
  });
});

describe('classifyCopyError', () => {
  it('NotAllowedError·SecurityError 만 denied', () => {
    expect(classifyCopyError(Object.assign(new Error(''), { name: 'NotAllowedError' }))).toBe('denied');
    expect(classifyCopyError(Object.assign(new Error(''), { name: 'SecurityError' }))).toBe('denied');
    expect(classifyCopyError(new Error('boom'))).toBe('failed');
    expect(classifyCopyError('문자열')).toBe('failed');
    expect(classifyCopyError(null)).toBe('failed');
  });
});
