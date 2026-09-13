/**
 * §3.7 v2.10 — **창이 돌아오면 드래그 영역을 다시 신고시킨다.**
 *
 * 되돌아가면 증상이 그대로 되살아나는 두 가지를 고정한다.
 *   ① 계기 목록 — `restore` 가 빠지면 최소화 복원에서 다시 못 잡는다. `move` 가 들어오면
 *      **창을 끄는 중에** 신고가 나가 우리가 고치려던 그 손짓을 우리가 방해한다.
 *   ② 배선 전수 — 창을 만드는 자리마다 걸려 있어야 한다. 하나 빠지면 그 창만 조용히 옛 증상.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BrowserWindow } from 'electron';
import {
  DRAG_REGIONS_REFRESH_CHANNEL,
  DRAG_REGION_WINDOW_EVENTS,
  keepDragRegionsFresh,
} from './dragRegions';

function source(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');
}

/** `BrowserWindow` 흉내 — 이 배선이 실제로 만지는 것만 있다. */
function stubWindow(opts: { destroyed?: boolean; contentsDestroyed?: boolean } = {}): {
  win: BrowserWindow;
  fire: (event: string) => void;
  sent: string[];
} {
  const handlers = new Map<string, Array<() => void>>();
  const sent: string[] = [];
  const win = {
    isDestroyed: () => opts.destroyed ?? false,
    on(event: string, listener: () => void) {
      const list = handlers.get(event) ?? [];
      list.push(listener);
      handlers.set(event, list);
      return this;
    },
    webContents: {
      isDestroyed: () => opts.contentsDestroyed ?? false,
      send: (channel: string) => { sent.push(channel); },
    },
  };
  return {
    win: win as unknown as BrowserWindow,
    fire: (event: string) => { for (const h of handlers.get(event) ?? []) h(); },
    sent,
  };
}

describe('드래그 영역 재신고 계기', () => {
  it('최소화 복원(restore)과 첫 보임(show)이 계기에 있다', () => {
    expect(DRAG_REGION_WINDOW_EVENTS).toContain('restore');
    expect(DRAG_REGION_WINDOW_EVENTS).toContain('show');
  });

  it('창을 끄는 중에 쏟아지는 전이는 계기가 아니다 — 넣으면 그 드래그를 우리가 끊는다', () => {
    expect(DRAG_REGION_WINDOW_EVENTS).not.toContain('move');
    expect(DRAG_REGION_WINDOW_EVENTS).not.toContain('moved');
    // resize 는 레이아웃이 실제로 바뀌어 Chromium 이 알아서 보낸다(우리가 흔들 이유가 없다).
    expect(DRAG_REGION_WINDOW_EVENTS).not.toContain('resize');
  });

  it('계기마다 그 창에 재신고 요청이 정확히 한 번 나간다', () => {
    const { win, fire, sent } = stubWindow();
    keepDragRegionsFresh(win);
    for (const event of DRAG_REGION_WINDOW_EVENTS) fire(event);
    expect(sent).toHaveLength(DRAG_REGION_WINDOW_EVENTS.length);
    expect(new Set(sent)).toEqual(new Set([DRAG_REGIONS_REFRESH_CHANNEL]));
  });

  it('죽은 창·죽은 webContents 에는 보내지 않는다(창 정리가 이 예외로 끊기면 안 된다)', () => {
    const dead = stubWindow({ destroyed: true });
    keepDragRegionsFresh(dead.win);
    expect(() => dead.fire('restore')).not.toThrow();
    expect(dead.sent).toHaveLength(0);

    const gone = stubWindow({ contentsDestroyed: true });
    keepDragRegionsFresh(gone.win);
    expect(() => gone.fire('restore')).not.toThrow();
    expect(gone.sent).toHaveLength(0);
  });
});

describe('배선 전수 — 창을 만드는 자리마다 걸려 있다', () => {
  it('windowManager 의 모든 창에 걸려 있다', () => {
    const src = source('windowManager.ts');
    const created = (src.match(/new BrowserWindow\(/g) ?? []).length;
    const wired = (src.match(/keepDragRegionsFresh\(/g) ?? []).length;
    expect(created, '창 생성 자리가 사라졌습니다 — 이 검사가 헛돕니다').toBeGreaterThan(0);
    expect(wired, `창 ${created}개 중 ${wired}개에만 걸려 있습니다`).toBe(created);
  });

  it('본체 창에도 걸려 있다', () => {
    expect(source('index.ts')).toMatch(/keepDragRegionsFresh\(mainWindow\)/);
  });
});
