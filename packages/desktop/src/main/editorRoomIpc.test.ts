/**
 * §5.5 #17-27 ①-1 — 독립 창이 편집창 자리를 내려고 **오른쪽으로 넓히는** 배선.
 *
 * 렌더(`growEditorRoomSelf`/`restoreEditorRoomSelf`) → preload → ipc → windowManager 네 자리 중
 * 하나라도 이름이 어긋나면 호출은 조용히 `undefined` 로 사라지고, 독립 창에서만 편집창이 다시
 * 대화를 덮는다. 그래서 채널 이름과 등록·해제를 한 번에 고정한다.
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

const CHANNELS = ['vibisual:overlay:grow-editor-room-self', 'vibisual:overlay:restore-editor-room-self'];

describe('독립 창 편집창 자리 — IPC 배선', () => {
  it('preload 가 두 채널을 부르고, ipc 가 같은 이름으로 받고 해제한다', () => {
    const preload = source('../preload/index.ts');
    const ipc = source('ipc.ts');
    expect(preload).toContain('growEditorRoomSelf: (dx: number): Promise<boolean> =>');
    expect(preload).toContain('restoreEditorRoomSelf: (): Promise<boolean> =>');
    for (const ch of CHANNELS) {
      expect(preload).toContain(`ipcRenderer.invoke('${ch}'`);
      expect(ipc).toContain(`ipcMain.handle('${ch}'`);
      expect(ipc).toContain(`ipcMain.removeHandler('${ch}');`);
    }
  });

  it('넓히기는 버블·최대화 창을 건드리지 않고, 앱 안 창과 같은 규칙(growSpanRight)으로 작업영역 안에 앉힌다', () => {
    const wm = source('windowManager.ts');
    const grow = block(wm, 'export function growOverlayEditorRoomByWindowId(', '\n}');
    expect(grow).toContain('!entry.expanded || entry.maximized');
    expect(grow).toContain('growSpanRight(');
    expect(grow).toContain('.workArea');
    // (H-19) 폭은 장부 값에서 출발한다 — 창에 되물은 폭은 배율 반올림으로 자란다.
    expect(grow).toContain('w: entry.size.width');
    expect(grow).toContain('entry.editorGrowth = { before, after };');
    // 기록은 창이 실제로 앉는 자리로 — writeOverlayBounds 와 같은 격자(125·175% 에서 "옮겼다" 오판 방지).
    expect(grow).toContain('const after = landedSpan(grown, dipStepAt(grown.x, cur.y));');
  });

  it('되돌리기는 기록을 한 번만 쓰고, 사용자가 폭을 바꿨는지는 shrinkSpanBack 이 가른다', () => {
    const wm = source('windowManager.ts');
    const restore = block(wm, 'export function restoreOverlayEditorRoomByWindowId(', '\n}');
    expect(restore).toContain('entry.editorGrowth = null;');
    expect(restore).toContain('shrinkSpanBack(');
    const entry = block(wm, 'const entry: OverlayEntry = {', 'overlaysByAgentId.set(opts.agentId, entry);');
    expect(entry).toContain('editorGrowth: null,');
    // 버블로 접히면 넓혔던 기억도 끝난다 — 다시 펼 때 엉뚱한 폭으로 되돌리지 않게.
    const collapse = block(wm, 'export function collapseOverlayByWindowId(', '\n}');
    expect(collapse).toContain('entry.editorGrowth = null;');
  });
});
