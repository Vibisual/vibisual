/**
 * §5.5 #17-6 (H-28) — 떼어 낸 IDE 창을 **다른 앱 위에 고정**하는 배선.
 *
 * 렌더(`setPinnedSelf`/`getPinnedSelf`) → preload → ipc → windowManager 네 자리 중 하나라도
 * 이름이 어긋나면 호출은 조용히 `undefined` 로 사라지고, 버튼은 눌리는데 창은 여전히 뒤로
 * 깔린다. 그래서 채널 이름과 등록·해제, 그리고 기억이 사는 자리를 한 번에 고정한다.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

function source(name: string): string {
  return readFileSync(join(HERE, name), 'utf8').replace(/\r\n/g, '\n');
}

function block(src: string, startMarker: string, endMarker: string): string {
  const from = src.indexOf(startMarker);
  expect(from, `시작점을 못 찾음: ${startMarker}`).toBeGreaterThan(-1);
  const to = src.indexOf(endMarker, from);
  expect(to, `끝점을 못 찾음: ${endMarker}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

const CHANNELS = ['vibisual:overlay:set-pinned-self', 'vibisual:overlay:get-pinned-self'];

describe('(H-28) 독립 창 항상 위에 고정 — IPC 배선', () => {
  it('preload 가 두 채널을 부르고, ipc 가 같은 이름으로 받고 해제한다', () => {
    const preload = source('../preload/index.ts');
    const ipc = source('ipc.ts');
    expect(preload).toContain('setPinnedSelf: (pinned: boolean): Promise<boolean> =>');
    expect(preload).toContain('getPinnedSelf: (): Promise<boolean> =>');
    for (const ch of CHANNELS) {
      expect(preload).toContain(`ipcRenderer.invoke('${ch}'`);
      expect(ipc).toContain(`ipcMain.handle('${ch}'`);
      expect(ipc).toContain(`ipcMain.removeHandler('${ch}');`);
    }
  });

  it('set 은 불리언만 받는다 — 다른 값이 오면 아무것도 바꾸지 않고 false', () => {
    const ipc = source('ipc.ts');
    const handler = block(ipc, "ipcMain.handle('vibisual:overlay:set-pinned-self'", ');\n');
    expect(handler).toContain("typeof pinned === 'boolean' ? setOverlayPinnedSelfByWindowId(event.sender.id, pinned) : false");
    // 자기 창만 바꾼다 — 창 id 를 렌더가 고르게 하면 남의 창을 고정할 수 있다.
    expect(ipc).toContain('isOverlayPinnedByWindowId(event.sender.id)');
  });
});

describe('(H-28) 고정 기억 — main 의 창 장부 하나', () => {
  const wm = source('windowManager.ts');

  it('갓 태어난 창은 고정돼 있지 않다 — 고정은 사용자가 그 창의 제목줄에서만 켠다', () => {
    const entry = block(wm, 'const entry: OverlayEntry = {', 'overlaysByAgentId.set(opts.agentId, entry);');
    expect(entry).toContain('pinned: false,');
  });

  it('켜고 끄기는 멱등 set 이고, 기억을 바꾼 뒤 층을 그 자리에서 다시 세운다', () => {
    const set = block(wm, 'export function setOverlayPinnedSelfByWindowId(', '\n}');
    expect(set).toContain('entry.pinned = pinned;');
    expect(set).toContain('keepOverlayOnTop(entry.window, entry.expanded, entry.pinned);');
    // 토글이면 더블클릭 두 번이 main 과 버튼을 어긋나게 한다.
    expect(set).not.toMatch(/entry\.pinned = !entry\.pinned/);
    expect(set).toContain('return entry.pinned;');
  });

  it('물어보기는 기억만 읽는다 — 창이 없으면 고정돼 있지 않은 것으로 답한다', () => {
    const get = block(wm, 'export function isOverlayPinnedByWindowId(', '\n}');
    expect(get).toContain('?.pinned ?? false');
  });

  it('버블로 접거나 최대화·복원해도 고정을 지우지 않는다 — 다시 펴면 그대로 위에 선다', () => {
    const touched = [
      block(wm, 'export function collapseOverlayByWindowId(', '\n}'),
      block(wm, 'export function expandOverlayByWindowId(', '\n}'),
      block(wm, 'export function toggleMaximizeOverlaySelfByWindowId(', '\n}'),
      block(wm, 'function forgetOverlayMaximize(', '\n}'),
    ];
    for (const fn of touched) expect(fn).not.toMatch(/entry\.pinned\s*=/);
    // 기억을 바꾸는 자리는 set 하나뿐이다.
    expect(wm.match(/entry\.pinned\s*=[^=]/g)).toHaveLength(1);
  });
});
