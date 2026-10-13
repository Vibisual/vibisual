/**
 * appWindowFocus.test.ts — §5.13 (S-11) **밖에 이미 떠 있는 앱 창은 다시 열지 않고 앞으로 세운다.**
 *
 * 캔버스에서 그 문서를 다시 열면 앱 안에 같은 편집기가 한 벌 더 섰다(밖으로 끌어낸 창은 앱 안 목록에서 빠지므로).
 * IDE 창(§5.5 #17-6 (H-13)(H-16))과 같은 규율로 고친다 — 본체는 main 이 미는 목록으로 "이미 밖에 있다"를 알고,
 * main 은 그 창을 앞으로 세운 뒤 한 번 비추게 한다. 세우기는 Electron 창이 있어야 하는 일이라 여기서는
 * `overlaySlot.test.ts` 와 같은 수법으로 **원문**을 확인한다(순서표 자체는 그쪽이 세 OS 로 고정한다).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// Windows 체크아웃은 줄 끝을 CRLF 로 바꾼다 — 여러 줄 표식이 어긋나지 않게 LF 로 맞춰 읽는다.
function source(name: string): string {
  return readFileSync(join(HERE, name), 'utf8').replace(/\r\n/g, '\n');
}

/** 그 함수의 본문만 잘라 본다 — 파일의 다른 자리와 섞이지 않게. */
function block(src: string, startMarker: string, endMarker: string): string {
  const from = src.indexOf(startMarker);
  expect(from, `시작점을 못 찾음: ${startMarker}`).toBeGreaterThan(-1);
  const to = src.indexOf(endMarker, from);
  expect(to, `끝점을 못 찾음: ${endMarker}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

describe('(S-11) 밖의 앱 창을 앞으로 세운다', () => {
  const wm = source('windowManager.ts');
  const focus = block(wm, 'export async function focusAppWindow(', '\n}');

  it('IDE 창과 같은 순서표를 쓰고 `process.platform` 을 **인자로 넘긴다** — 함수 안에서 읽으면 세 OS 가 검증되지 않는다', () => {
    expect(focus).toContain('overlayRaiseSteps({ platform: process.platform');
    for (const call of ['win.restore()', 'win.show()', 'win.focus()', 'win.moveTop()']) {
      expect(focus, call).toContain(call);
    }
    // mac 은 창 하나를 포커스해도 앱이 앞으로 오지 않는다 — 앱 활성화가 따로다.
    expect(focus).toContain('app.focus({ steal: true })');
  });

  it('본체가 본 **그 창**일 때만 세운다 — 그 사이 다른 문서로 새로 선 창을 대신 세우지 않는다', () => {
    expect(focus).toContain('if (windowId !== undefined && entry.id !== windowId) return false;');
  });

  it('대상을 다시 밀어 넣지 않는다 — 보고 있던 편집기를 새로 세우면 부른 보람이 없다', () => {
    expect(focus).not.toContain('requestTarget');
  });

  it('세운 뒤 그 창이 한 번 대답한다 — 이미 보이던 창이면 앞으로 오는 것만으로는 화면이 그대로다', () => {
    expect(focus).toContain("win.webContents.send('vibisual:app:attention'");
  });

  it('목록은 창이 서고 닫히거나 보는 문서가 바뀔 때마다 모든 창에 민다', () => {
    expect(wm).toContain('changed: () => broadcastAppWindowList(),');
    const broadcast = block(wm, 'function broadcastAppWindowList(', '\n}');
    expect(broadcast).toContain('BrowserWindow.getAllWindows()');
    expect(broadcast).toContain("'vibisual:app:list'");
  });

  it('목록 묻기·앞으로 세우기 두 길이 열리고, 내릴 때 함께 닫힌다', () => {
    const ipc = source('apps/index.ts');
    expect(ipc).toContain("ipcMain.handle('vibisual:app:list'");
    expect(ipc).toContain("ipcMain.handle('vibisual:app:focus'");
    expect(ipc).toContain("ipcMain.removeHandler('vibisual:app:list');");
    expect(ipc).toContain("ipcMain.removeHandler('vibisual:app:focus');");
  });
});
