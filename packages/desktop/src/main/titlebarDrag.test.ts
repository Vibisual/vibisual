/**
 * §3.7 · §5.5 #17-6 (H-19) — **헤더 로고 덮개를 더블클릭하면 제목줄과 똑같이 최대화/복원된다.**
 *
 * 사용자 보고: 헤더 로고 자리(`Header.tsx` 의 `app-nodrag` 덮개)만 더블클릭해도 전체화면이 안 됐다.
 * 덮개는 `onDoubleClick` 으로 `vibisual:window:toggle-maximize-self` 를 불렀지만, 그 채널이 창을 찾는
 * 목록(`selfWindowById` — 별창·지휘통제실·내부 앱 창)에 본체가 없어 호출이 조용히 `false` 로 끝났다.
 * 함께 고친 것 — 최대화된 창을 덮개에서 누르는 동안의 손떨림이 `move-self` 한 번으로 창을 풀어,
 * 이어지는 더블클릭이 "복원"이 아니라 "다시 최대화"가 되던 것(끌기 문턱).
 *
 * 문턱은 순수 함수라 직접 재고, 배선은 electron 없이 원문으로 고정한다(`sizeLedger.test.ts` 와 같은 방식).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  passedTitlebarDragThreshold,
  pickTitlebarPoint,
  TITLEBAR_LATE_SAMPLE_DIP,
  TITLEBAR_RESTORE_DRAG_DIP,
  toScreenPoint,
} from './titlebarDrag';

const HERE = dirname(fileURLToPath(import.meta.url));

// Windows 체크아웃은 줄 끝이 CRLF 일 수 있다 — 여러 줄 표식이 어긋나지 않게 LF 로 맞춰 읽는다.
function source(name: string): string {
  return readFileSync(join(HERE, name), 'utf8').replace(/\r\n/g, '\n');
}

function block(src: string, startMarker: string, endMarker: string): string {
  const from = src.indexOf(startMarker);
  expect(from, `시작점을 못 찾음: ${startMarker}`).toBeGreaterThan(-1);
  const to = src.indexOf(endMarker, from + startMarker.length);
  expect(to, `끝점을 못 찾음: ${endMarker}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

describe('최대화를 푸는 끌기 문턱', () => {
  const press = { x: 500, y: 12 };

  it('제자리와 손떨림(문턱 아래)은 끌기가 아니다', () => {
    expect(passedTitlebarDragThreshold(press, press)).toBe(false);
    expect(passedTitlebarDragThreshold(press, { x: 501, y: 12 })).toBe(false);
    expect(passedTitlebarDragThreshold(press, { x: 497, y: 14 })).toBe(false);
    // 대각선으로 3·3 — 두 축 모두 문턱 아래라 끌기가 아니다(거리 합으로 재지 않는다).
    expect(passedTitlebarDragThreshold(press, { x: 503, y: 15 })).toBe(false);
  });

  it('가로나 세로 한쪽이라도 문턱에 닿으면 끌기다 — 방향은 가리지 않는다', () => {
    expect(passedTitlebarDragThreshold(press, { x: 504, y: 12 })).toBe(true);
    expect(passedTitlebarDragThreshold(press, { x: 496, y: 12 })).toBe(true);
    expect(passedTitlebarDragThreshold(press, { x: 500, y: 16 })).toBe(true);
    expect(passedTitlebarDragThreshold(press, { x: 500, y: 8 })).toBe(true);
  });

  it('문턱은 OS 끌기 사각형 크기(4 DIP)다 — 0 이면 손떨림이 다시 최대화를 푼다', () => {
    expect(TITLEBAR_RESTORE_DRAG_DIP).toBe(4);
    expect(passedTitlebarDragThreshold(press, { x: 501, y: 12 }, 0)).toBe(true);
  });

  it('좌표가 음수인 보조 모니터(왼쪽·위)에서도 같은 답이다', () => {
    const left = { x: -1200, y: -40 };
    expect(passedTitlebarDragThreshold(left, { x: -1202, y: -41 })).toBe(false);
    expect(passedTitlebarDragThreshold(left, { x: -1205, y: -40 })).toBe(true);
  });

  it('분수 배율의 소수 좌표도 그대로 잰다', () => {
    expect(passedTitlebarDragThreshold({ x: 10.5, y: 3.25 }, { x: 13.5, y: 3.25 })).toBe(false);
    expect(passedTitlebarDragThreshold({ x: 10.5, y: 3.25 }, { x: 14.5, y: 3.25 })).toBe(true);
  });
});

describe('덮개의 끌기 — 최대화된 창은 문턱을 넘어야 풀린다', () => {
  const move = source('titlebarMove.ts');
  const maximizedAt = move.indexOf('if (win.isMaximized() || restoreFromMaximized) {');

  it('최대화 해제(unmaximize) 앞에서 문턱을 본다 — 문턱 아래면 창을 건드리지 않고 돌아간다', () => {
    expect(maximizedAt, '최대화 분기를 못 찾음').toBeGreaterThan(-1);
    const maximized = move.slice(maximizedAt);
    const gate = maximized.indexOf(
      'if (!passedTitlebarDragThreshold(press, cursor)) return;',
    );
    expect(gate, '문턱 판정이 최대화 분기 안에 없다').toBeGreaterThan(-1);
    expect(gate).toBeLessThan(maximized.indexOf('win.unmaximize();'));
    expect(gate).toBeLessThan(maximized.indexOf('win.getNormalBounds()'));
  });

});

describe('덮개의 더블클릭 — 자기 창 최대화 채널이 본체 창을 받는다', () => {
  const ipc = source('ipc.ts');
  const wm = source('windowManager.ts');

  it('채널은 보낸 창이 본체인지 먼저 보고, 아니면 종전 목록(별창·지휘통제실·앱 창)을 탄다', () => {
    const handler = block(
      ipc,
      "ipcMain.handle('vibisual:window:toggle-maximize-self'",
      "ipcMain.handle('vibisual:window:list-detached'",
    );
    expect(handler).toContain('toggleMaximizeMainWindow(BrowserWindow.fromWebContents(event.sender))');
    expect(handler).toContain('|| toggleMaximizeByWindowId(event.sender.id)');
  });

  it('본체는 번호가 아니라 창 그 자체로 맞춘다 — 목록은 창 번호, 채널은 webContents 번호다', () => {
    const fn = block(wm, 'export function toggleMaximizeMainWindow(', '\n}');
    expect(fn).toContain('sender !== getMainWindow()');
    expect(fn).toContain('toggleMaximize(sender);');
    expect(fn).not.toMatch(/\.id\b/);
  });

  it('본체를 자기 창 목록에 넣지 않는다 — 넣으면 닫기 채널이 본체에 닿아 앱이 꺼진다', () => {
    const lookup = block(wm, 'function selfWindowById(', '\n}');
    expect(lookup).not.toContain('getMainWindow');
  });
});

// §3.7 ③ — 렌더러가 잰 자리. 메인 스레드가 바빠 move-self 를 늦게 받으면 OS 커서는 손이 이미 옮겨 간 자리다.
describe('렌더러가 잰 자리 — 받는 규칙', () => {
  it('렌더러가 실어 보낸 좌표는 숫자 둘일 때만 쓴다(아니면 OS 커서로 대신한다)', () => {
    expect(toScreenPoint({ x: 10, y: -20.5 })).toEqual({ x: 10, y: -20.5 });
    expect(toScreenPoint(undefined)).toBeUndefined();
    expect(toScreenPoint(null)).toBeUndefined();
    expect(toScreenPoint({ x: '10', y: 3 })).toBeUndefined();
    expect(toScreenPoint({ x: Number.NaN, y: 3 })).toBeUndefined();
    expect(toScreenPoint({ x: 1 })).toBeUndefined();
  });

  it('놓은 자리가 지금 커서와 벌어져 있으면(메인이 늦게 받았다) 렌더러 쪽이 맞다', () => {
    const live = { x: 1700, y: 900 };
    expect(pickTitlebarPoint({ x: 1050, y: 80 }, live)).toEqual({ x: 1050, y: 80 });
    // 한 축만 벌어져도 늦은 것이다.
    expect(pickTitlebarPoint({ x: 1700, y: 900 - TITLEBAR_LATE_SAMPLE_DIP - 1 }, live)).toEqual({ x: 1700, y: 900 - TITLEBAR_LATE_SAMPLE_DIP - 1 });
  });

  it('가까우면 지금 커서를 쓴다 — 옮기던 중의 작은 좌표 차이가 놓는 순간의 튐이 되지 않게', () => {
    const live = { x: 1000, y: 42 };
    expect(pickTitlebarPoint({ x: 1003, y: 45 }, live)).toBe(live);
    expect(pickTitlebarPoint({ x: 1000 + TITLEBAR_LATE_SAMPLE_DIP, y: 42 }, live)).toBe(live);
    expect(pickTitlebarPoint(undefined, live)).toBe(live);
  });
});

// §3.7 「제목줄 영역은 코드로 껐다 켜지 않는다」 — 창 상태 전이(show·restore·최대화·focus)마다 렌더러에 드래그 영역
//   재신고를 시키던 배선은 걷었다. 그 재신고(영역을 두 프레임 동안 no-drag 로 흔들기)가 제목줄 누름을 버리게 했다 —
//   Chromium 126 은 제목줄 누름을 첫 마우스 이동에서야 OS 이동으로 넘기는데, 그 사이 흔들기가 끼면 넘기지 않는다.
describe('제목줄 영역을 흔드는 배선은 다시 붙지 않는다', () => {
  const code = (text: string): string => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('main·창 관리·IPC·preload 어디에도 재신고 채널이 없다', () => {
    for (const file of ['index.ts', 'windowManager.ts', 'ipc.ts', '../preload/index.ts']) {
      expect(code(source(file)), `${file} 에 드래그 영역 재신고 배선이 돌아왔다`)
        .not.toMatch(/keepDragRegionsFresh|drag-regions-refresh|DRAG_REGIONS_REFRESH|onDragRegionsRefresh/);
    }
  });
});
