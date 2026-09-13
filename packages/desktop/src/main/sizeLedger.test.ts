/**
 * sizeLedger.test.ts — §5.5 #17-6 (H-19) **창 크기는 장부가 답한다.**
 *
 * 독립 창이 끌 때마다 저절로 커지던 원인은 "창에 크기를 되묻는 것"이었다 — 분수 배율에서
 * `setPosition()` 은 크기를 창에 되물어 다시 쓰므로 부를 때마다 1px 자랐고(실측 150%: 40번에
 * +40px), `getBounds()` 로 읽은 크기를 되돌아오는 길·선·복원에 되쓰면 왕복마다 2px 자랐다.
 * 규칙(`overlaySize.ts`)은 순수 함수가 쥐고, 여기서는 **그 규칙을 실제로 그렇게 부르는지**를
 * 소스로 집행한다 — `windowManager` 는 electron 에 붙어 있어 여기서 실행할 수 없다.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'windowManager.ts'), 'utf8');

/** 그 함수의 본문만 잘라 본다 — 파일의 다른 자리와 섞이지 않게. */
function block(src: string, startMarker: string, endMarker: string): string {
  const from = src.indexOf(startMarker);
  expect(from, `시작점을 못 찾음: ${startMarker}`).toBeGreaterThan(-1);
  const to = src.indexOf(endMarker, from);
  expect(to, `끝점을 못 찾음: ${endMarker}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

function count(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

describe('(H-19) 창을 옮기는 길은 크기를 되묻지 않는다', () => {
  it('`setPosition` 호출은 0건 — 그 호출이 배율에서 부를 때마다 창을 키운다', () => {
    expect(count(SRC, '.setPosition(')).toBe(0);
  });

  it('커서 폴링은 장부 크기로 **함께** 쓴다(`moveOverlayTo`)', () => {
    const tick = block(SRC, 'const tick = (): void => {', 'if (!drag.redockOnEnter) return;');
    expect(tick).toContain('moveOverlayTo(entry, p.x - drag.offX, p.y - drag.offY)');
    expect(tick).not.toContain('getBounds()');
  });

  it('옮기기·크기 쓰기는 둘 다 `movedBounds` 를 지난다 — 격자와 장부가 한 곳에서 맞는다', () => {
    const move = block(SRC, 'function moveOverlayTo(', '\n}');
    expect(move).toContain('movedBounds(entry.size,');
    expect(move).not.toContain('getBounds()');
    const write = block(SRC, 'function writeOverlayBounds(', '\n}');
    expect(write).toContain('entry.size = { width: Math.round(b.width), height: Math.round(b.height) };');
    expect(write).toContain('movedBounds(entry.size,');
  });

  it('이미 밖에 서 있던 창을 놓은 자리로 옮길 때도 같은 길이다', () => {
    const reuse = block(SRC, 'if (opts.follow && !overlayDrags.has(existing.id)) {', 'finishGhostHandoff();');
    expect(reuse).toContain('moveOverlayTo(existing,');
  });
});

describe('(H-19) 선·되돌리기·복원은 장부를 읽는다', () => {
  it('들어오는 선(`beginRedockDwell`·`armRedockDwell`)의 크기는 장부다', () => {
    const begin = block(SRC, 'function beginRedockDwell(', 'function armRedockDwell(');
    expect(begin).toContain('width: entry.size.width');
    expect(begin).not.toContain('getBounds()');
    const arm = block(SRC, 'function armRedockDwell(', 'function cancelRedockDwell(');
    expect(arm).toContain('width: entry.size.width');
    expect(arm).not.toContain('getBounds()');
  });

  it('앱 안에 서는 창의 크기(`resumeDrag`)는 장부다 — 종전에는 이 왕복마다 2px 씩 자랐다', () => {
    const redock = block(SRC, 'function redockFollowedOverlay(', 'export function startOverlayDragByWindowId(');
    expect(redock).toContain('width: entry.size.width');
    expect(redock).toContain('height: entry.size.height');
    expect(redock).not.toContain('getBounds()');
  });

  it('펼치기·접기·최대화·복원은 `writeOverlayBounds` 로 장부를 먼저 적는다', () => {
    const writers: Array<[string, string]> = [
      ['export function expandOverlayByWindowId(', 'export function collapseOverlayByWindowId('],
      ['export function collapseOverlayByWindowId(', 'export function setOverlaysVisible('],
      ['export function toggleMaximizeOverlaySelfByWindowId(', 'export function closeOverlayByAgentId('],
      ['function restoreOverlayMaximize(', 'function forgetOverlayMaximize('],
    ];
    for (const [start, end] of writers) {
      const body = block(SRC, start, end);
      expect(body, start).toContain('writeOverlayBounds(entry,');
      expect(body, start).not.toContain('win.setBounds(');
      expect(body, start).not.toContain('win.setSize(');
    }
  });

  it('최대화를 풀며 잡은 지점을 다시 잡을 때도 장부를 읽는다', () => {
    const start = block(SRC, 'export function startOverlayDragByWindowId(', 'function startOverlayFollow(');
    expect(start).toContain('offX = Math.round(ratioX * entry.size.width);');
    expect(start).not.toContain('win.getBounds().width');
  });
});

describe('(H-19) 창이 알려 오는 크기는 순수 함수가 가른다', () => {
  it('`resize` 는 `acceptReportedSize` 를 지나고, 끌기 중은 무시한다', () => {
    const on = block(SRC, "win.on('resize', () => {", "win.on('close', () => {");
    expect(on).toContain('acceptReportedSize({');
    expect(on).toContain('following: overlayDrags.has(entry.id),');
    expect(on).toContain('if (next) entry.size = next;');
  });

  it('장부의 첫 값은 태어난 크기이고, 그 크기와 자리는 격자에 맞춘다', () => {
    const spawn = block(SRC, 'const dipStep = dipStepFor(dropDisp.scaleFactor);', 'overlayCascade += 1;');
    expect(count(spawn, 'snapDip(')).toBeGreaterThanOrEqual(4);
    expect(SRC).toContain('size: { width: winW, height: winH },');
  });
});

// §5.5 #17-6 (H-19) — 같은 규칙은 **본체 창의 타이틀바 드래그**에도 걸린다. 헤더 로고 덮개
// (`Header.tsx` 의 `app-nodrag` 덮개)가 `pointermove` 마다 `vibisual:window:move-self` 를 부르는데,
// 그 핸들러만 `setPosition` 에 남아 있어서 잡고 끄는 동안 본체 창이 계속 커졌다(사용자 보고 —
// "여기를 잡고 잡아 끌면 에디터가 점점 커진다"). 오버레이 창과 **같은 규칙**을 여기서 함께 집행한다.
const IPC = readFileSync(join(HERE, 'ipc.ts'), 'utf8');

/** move-self 핸들러 본문만 — 파일의 다른 창 채널과 섞이지 않게. */
function moveSelfBody(): string {
  return block(
    IPC,
    "ipcMain.handle('vibisual:window:move-self'",
    "ipcMain.handle('vibisual:window:minimize-self'",
  );
}

describe('(H-19) 본체 창의 타이틀바 드래그도 크기를 되묻지 않는다', () => {
  it('`ipc.ts` 의 `setPosition` 호출은 0건 — 그 호출이 끄는 동안 본체 창을 키웠다', () => {
    expect(count(IPC, '.setPosition(')).toBe(0);
  });

  it('끌기 판이 크기 장부를 든다 — 손짓을 시작할 때 한 번만 재고, 그 값을 늘 쓴다', () => {
    const ledger = block(IPC, 'const titlebarDrags = new WeakMap<', "ipcMain.handle('vibisual:window:move-self'");
    expect(ledger).toContain('size: OverlaySize;');
    expect(moveSelfBody()).toContain('size: { width: bounds.width, height: bounds.height },');
  });

  it('옮길 때는 장부 크기를 자리와 **함께**, 그 화면의 배율 격자에 맞춰 쓴다', () => {
    const move = moveSelfBody();
    expect(move).toContain('win.setBounds(movedBounds(drag.size, x, y, dipStepAt(x, y)), false);');
    expect(move).not.toContain('win.setSize(');
  });

  it('매 이동이 쓰는 줄에는 창에 되묻는 호출이 없다 — 되물으면 배율 반올림이 그대로 누적된다', () => {
    const move = moveSelfBody();
    // 최대화 해제는 한 판에 한 번뿐이라 그 안에서 되물어도 쌓이지 않는다. 쌓이는 것은 그 뒤,
    // `pointermove` 마다 지나는 이 꼬리다 — 여기에 `getBounds()` 가 들어오면 자람이 되살아난다.
    const tail = move.slice(move.indexOf('const x = drag.x + cursor.x - drag.cursorX;'));
    expect(tail.length, '꼬리 앵커를 못 찾음').toBeGreaterThan(0);
    expect(tail).not.toContain('getBounds()');
  });
});
