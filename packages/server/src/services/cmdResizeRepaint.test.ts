import { describe, it, expect } from 'vitest';
import { isConsoleRepaintChunk, shouldBufferPtyChunk, CMD_RESIZE_REPAINT_MS } from '@vibisual/shared';

/**
 * §4 (CMD 터미널 업그레이드 ③) — 리사이즈 리페인트가 replay 링버퍼에 쌓이지 않는지.
 *
 * 증상은 "cmd 창이 같은 걸 계속 출력한다" 였다. 실측으로 갈라 보니 CLI 가 도는 게 아니라
 * **Windows ConPTY 가 `ResizePseudoConsole` 마다 보이는 화면을 통째로 다시 내보내는** 것이었고
 * (리사이즈 6회 = cmd 배너 6벌 추가, 배너 사이 간격이 그때의 rows 와 일치), `terminalManager` 가
 * 그 리페인트까지 scrollback 링버퍼에 쌓는 바람에 재부착 replay 마다 같은 배너가 N벌 되살아났다.
 *
 * 아래 바이트는 node-pty 로 cmd.exe 를 띄워 실제로 받은 청크다(실측 시그니처 고정).
 */

const ESC = String.fromCharCode(27);

/** 리사이즈 직후 ConPTY 가 실제로 보낸 청크(창 크기 보고 포함). */
const REPAINT_WITH_SIZE_REPORT =
  `${ESC}[?25l${ESC}[8;14;80t${ESC}[HMicrosoft Windows [Version 10.0.26200.9168]${ESC}[K\r\n` +
  `(c) Microsoft Corporation. All rights reserved.${ESC}[K\r\n${ESC}[K\r\n` +
  `C:\\g>echo HELLO${ESC}[K\r\n${ESC}[K\r\n`;

/** 같은 리페인트인데 창 크기 보고가 없는 판본(두 번째 리사이즈부터 관측). */
const REPAINT_PLAIN =
  `${ESC}[?25l${ESC}[HMicrosoft Windows [Version 10.0.26200.9168]${ESC}[K\r\n` +
  `(c) Microsoft Corporation. All rights reserved.${ESC}[K\r\n`;

/** 부팅 배너 — `2J`(화면 지움)로 시작한다. 일부러 리페인트로 보지 않는다. */
const BOOT_BANNER =
  `${ESC}[?25l${ESC}[2J${ESC}[m${ESC}[HMicrosoft Windows [Version 10.0.26200.9168]`;

const NORMAL_SCROLL = `${ESC}[?25l\r\n(c) Microsoft Corporation. All rights reserved.`;

describe('isConsoleRepaintChunk — ConPTY 화면 전체 재출력 판별', () => {
  it('커서 home 으로 시작하는 리페인트를 잡는다(창 크기 보고 유무 무관)', () => {
    expect(isConsoleRepaintChunk(REPAINT_WITH_SIZE_REPORT)).toBe(true);
    expect(isConsoleRepaintChunk(REPAINT_PLAIN)).toBe(true);
    expect(isConsoleRepaintChunk(`${ESC}[?25l${ESC}[1;1Hredraw`)).toBe(true);
  });

  it('평범한 출력·스크롤·색만 있는 청크는 잡지 않는다', () => {
    expect(isConsoleRepaintChunk('echo HELLO')).toBe(false);
    expect(isConsoleRepaintChunk(NORMAL_SCROLL)).toBe(false);
    expect(isConsoleRepaintChunk(`${ESC}[32mgreen${ESC}[m done`)).toBe(false);
    expect(isConsoleRepaintChunk('')).toBe(false);
  });

  it('화면을 지우는 청크(부팅 배너·cls)는 리페인트로 보지 않는다 — 정상 출력을 삼키지 않게', () => {
    expect(isConsoleRepaintChunk(BOOT_BANNER)).toBe(false);
  });
});

describe('shouldBufferPtyChunk — 리페인트만 링버퍼에서 빠진다', () => {
  const now = 1_000_000;

  it('리사이즈가 없었으면 무엇이든 버퍼에 쌓는다', () => {
    expect(shouldBufferPtyChunk(REPAINT_WITH_SIZE_REPORT, 0, now)).toBe(true);
    expect(shouldBufferPtyChunk('echo HELLO', 0, now)).toBe(true);
  });

  it('리사이즈 직후의 리페인트만 버퍼에서 뺀다', () => {
    expect(shouldBufferPtyChunk(REPAINT_WITH_SIZE_REPORT, now - 50, now)).toBe(false);
    expect(shouldBufferPtyChunk(REPAINT_PLAIN, now - 50, now)).toBe(false);
  });

  it('리사이즈 직후라도 평범한 출력은 버린 적이 없다(출력 유실 금지)', () => {
    expect(shouldBufferPtyChunk('build finished', now - 50, now)).toBe(true);
    expect(shouldBufferPtyChunk(NORMAL_SCROLL, now - 50, now)).toBe(true);
  });

  it('시간 창을 넘긴 리페인트는 정상 출력으로 취급한다(무한 억제 금지)', () => {
    const stale = now - CMD_RESIZE_REPAINT_MS - 1;
    expect(shouldBufferPtyChunk(REPAINT_WITH_SIZE_REPORT, stale, now)).toBe(true);
  });
});

describe('링버퍼 누적 — 리사이즈를 반복해도 배너가 한 벌만 남는다', () => {
  /** `terminalManager.child.onData` 의 누적 규칙을 그대로 옮긴 시뮬레이터. */
  function accumulate(chunks: { data: string; resizedAt: number; at: number }[]): string {
    let buffer = '';
    let resizedAt = 0;
    for (const c of chunks) {
      if (c.resizedAt) resizedAt = c.resizedAt;
      if (shouldBufferPtyChunk(c.data, resizedAt, c.at)) buffer += c.data;
      else resizedAt = 0; // 한 리사이즈당 한 벌만 걸러 낸다.
    }
    return buffer;
  }

  const countBanners = (s: string): number => (s.match(/Microsoft Windows \[Version/g) ?? []).length;

  it('리사이즈 5회 뒤에도 배너는 1벌(종전엔 6벌이 쌓였다)', () => {
    const chunks = [{ data: BOOT_BANNER, resizedAt: 0, at: 1000 }];
    for (let i = 1; i <= 5; i++) {
      chunks.push({ data: REPAINT_PLAIN, resizedAt: 1000 + i * 1000, at: 1000 + i * 1000 + 30 });
    }
    const buffer = accumulate(chunks);
    expect(countBanners(buffer)).toBe(1);
  });

  it('리사이즈 사이의 실제 출력은 전부 남는다', () => {
    const buffer = accumulate([
      { data: BOOT_BANNER, resizedAt: 0, at: 1000 },
      { data: 'first output\r\n', resizedAt: 0, at: 1500 },
      { data: REPAINT_PLAIN, resizedAt: 2000, at: 2030 },
      { data: 'second output\r\n', resizedAt: 0, at: 2500 },
      { data: REPAINT_PLAIN, resizedAt: 3000, at: 3030 },
      { data: 'third output\r\n', resizedAt: 0, at: 3500 },
    ]);
    expect(countBanners(buffer)).toBe(1);
    expect(buffer).toContain('first output');
    expect(buffer).toContain('second output');
    expect(buffer).toContain('third output');
  });

  it('리페인트가 늦게 와도(다른 청크가 먼저 끼어들어도) 걸러 낸다', () => {
    const buffer = accumulate([
      { data: BOOT_BANNER, resizedAt: 0, at: 1000 },
      { data: 'noise\r\n', resizedAt: 2000, at: 2010 }, // 리사이즈 직후 끼어든 실제 출력
      { data: REPAINT_PLAIN, resizedAt: 0, at: 2100 },  // 그 뒤 도착한 리페인트
    ]);
    expect(countBanners(buffer)).toBe(1);
    expect(buffer).toContain('noise');
  });
});
