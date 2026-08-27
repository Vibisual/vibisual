import { describe, it, expect, vi } from 'vitest';
import { ensureTerminalFonts, TERMINAL_FONT_STACK, type TerminalFontSet } from './terminalFont.js';

// §4 (CMD) — 터미널이 창을 넘어가던 자리의 회귀 방지.
//
// xterm 은 열릴 때 잰 셀 폭을 끝까지 쓰므로, 동봉 글꼴이 실리기 전에 재면 열 수(cols)가 실제보다
// 크게 잡혀 그 값이 셸에 실려 간다. 그래서 "기다려야 하는가"의 판정이 정확해야 한다.

function fakeFontSet(over: Partial<TerminalFontSet> & { checked?: string[][] } = {}): TerminalFontSet & { checked: string[][]; loaded: string[][] } {
  const checked: string[][] = [];
  const loaded: string[][] = [];
  return {
    checked,
    loaded,
    check(font: string, text?: string): boolean {
      checked.push([font, text ?? '']);
      return over.check ? over.check(font, text) : true;
    },
    load(font: string, text?: string): Promise<unknown> {
      loaded.push([font, text ?? '']);
      return over.load ? over.load(font, text) : Promise.resolve([]);
    },
  };
}

describe('ensureTerminalFonts', () => {
  it('글꼴 확인 수단이 없으면 기다리지 않는다', () => {
    expect(ensureTerminalFonts(13, undefined)).toBeNull();
  });

  it('둘 다 이미 실려 있으면 기다리지 않는다', () => {
    const fonts = fakeFontSet({ check: () => true });
    expect(ensureTerminalFonts(13, fonts)).toBeNull();
    expect(fonts.loaded).toHaveLength(0);
  });

  it('한글 조각은 한글 글자를 주고 확인한다 — 라틴만 보고 통과하면 한글이 폴백인 채로 잰다', () => {
    const fonts = fakeFontSet({ check: () => true });
    ensureTerminalFonts(13, fonts);
    const hangulCheck = fonts.checked.find((row) => (row[0] ?? '').includes('Nanum Gothic Coding'));
    expect(hangulCheck).toBeDefined();
    expect(hangulCheck?.[1]).not.toBe('');
  });

  it('아직 안 실렸으면 두 글꼴을 실제 크기로 불러오며 기다린다', async () => {
    const fonts = fakeFontSet({ check: () => false });
    const pending = ensureTerminalFonts(17, fonts);
    expect(pending).not.toBeNull();
    await pending;
    expect(fonts.loaded.map((row) => row[0])).toEqual([
      "17px 'JetBrains Mono'",
      "17px 'Nanum Gothic Coding'",
    ]);
  });

  it('한쪽 로드가 실패해도 기다림은 정상적으로 풀린다 — 폴백 글꼴로 뜨는 것이지 오류가 아니다', async () => {
    const fonts = fakeFontSet({
      check: () => false,
      load: (font: string) => (font.includes('Nanum') ? Promise.reject(new Error('no file')) : Promise.resolve([])),
    });
    await expect(ensureTerminalFonts(13, fonts)).resolves.toBeUndefined();
  });

  it('글꼴을 끝내 못 받아도 상한 시간 뒤에는 풀린다 — 터미널이 영영 안 뜨면 안 된다', async () => {
    vi.useFakeTimers();
    try {
      const fonts = fakeFontSet({ check: () => false, load: () => new Promise(() => { /* 영영 안 끝남 */ }) });
      const pending = ensureTerminalFonts(13, fonts);
      let settled = false;
      void pending?.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(1600);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('확인이 던지는 구현에서는 기다리지 않는다', () => {
    const fonts = fakeFontSet({ check: () => { throw new Error('bad font shorthand'); } });
    expect(ensureTerminalFonts(13, fonts)).toBeNull();
  });

  it('글꼴 스택 앞머리는 동봉 글꼴 둘 — 확인 대상과 실제로 쓰는 값이 같아야 한다', () => {
    expect(TERMINAL_FONT_STACK.startsWith("'JetBrains Mono', 'Nanum Gothic Coding'")).toBe(true);
  });
});
