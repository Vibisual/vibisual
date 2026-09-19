import { describe, it, expect, vi } from 'vitest';
import type { ContextMenuItem } from './IDEContextMenu.js';
import {
  buildOutsidePathLinkMenuItems,
  buildPathLinkMenuItems,
  pathLinkOpenLabel,
  type PathLinkMenuHandlers,
} from './pathLinkContextMenu.js';

/**
 * §5.5 #17-27 ⑬ (j) — 본문 경로 링크 우클릭 메뉴 목록 테스트.
 *
 * 지키는 것 넷 — (a) HTML 은 웹(내부)·웹(외부) 두 줄로 시작하고 여는 줄이 겹치지 않는다,
 * (b) HTML 이 아닌 파일에는 **연결 프로그램 항목이 서지 않는다**(스크립트가 연결 프로그램으로 실행되는 길 ❌),
 * (c) 루트 밖 경로는 탐색기·복사뿐이고 웹 두 줄은 흐린 채 까닭을 단다(⑬ (d)),
 * (d) 각 항목이 제 손잡이를 부른다.
 */

/** 키를 그대로 돌려주는 t — 라벨이 어느 키에서 왔는지 그대로 확인한다. */
const t = (key: string, opts?: Record<string, unknown>): string => (opts ? `${key}:${JSON.stringify(opts)}` : key);

function handlers(): PathLinkMenuHandlers {
  return {
    open: vi.fn(), openPage: vi.fn(), openBrowser: vi.fn(),
    reveal: vi.fn(), copyPath: vi.fn(), copyRelativePath: vi.fn(),
  };
}

const ids = (items: ContextMenuItem[]): string[] => items.map((i) => i.id ?? '');

function find(items: ContextMenuItem[], id: string): ContextMenuItem {
  const item = items.find((i) => i.id === id);
  expect(item, `menu item ${id}`).toBeDefined();
  return item!;
}

describe('buildPathLinkMenuItems — 루트 안', () => {
  it('HTML — 웹(내부)·웹(외부)로 시작하고, 왼쪽 클릭과 같은 여는 줄은 따로 서지 않는다', () => {
    const items = buildPathLinkMenuItems({ kind: 'file', isHtml: true, openLabel: 'OPEN' }, handlers(), t);
    expect(ids(items)).toEqual(['openPage', 'openBrowser', 'reveal', 'copyPath', 'copyRelativePath']);
    expect(find(items, 'openPage').label).toBe('ide.streamRenderer.pathLink.menu.openPage');
    expect(find(items, 'openBrowser').label).toBe('ide.streamRenderer.pathLink.menu.openBrowser');
    expect(find(items, 'reveal').label).toBe('ide.streamRenderer.pathLink.menu.revealFile');
  });

  it('HTML 이 아닌 파일 — 여는 줄은 호출부가 준 이름 하나, 연결 프로그램·웹 항목은 없다', () => {
    const items = buildPathLinkMenuItems({ kind: 'file', isHtml: false, openLabel: 'OPEN' }, handlers(), t);
    expect(ids(items)).toEqual(['open', 'reveal', 'copyPath', 'copyRelativePath']);
    expect(find(items, 'open').label).toBe('OPEN');
  });

  it('폴더 — 여는 줄이 곧 탐색기라 "폴더 열기" 한 줄, 파일 위치 열기는 없다', () => {
    const items = buildPathLinkMenuItems({ kind: 'directory', isHtml: false, openLabel: 'OPEN' }, handlers(), t);
    expect(ids(items)).toEqual(['reveal', 'copyPath', 'copyRelativePath']);
    expect(find(items, 'reveal').label).toBe('ide.explorer.ctx.revealFolder');
  });

  it('묶음 사이에 구분선 — 여는 것 | 위치 | 복사', () => {
    const items = buildPathLinkMenuItems({ kind: 'file', isHtml: true, openLabel: 'OPEN' }, handlers(), t);
    expect(find(items, 'openPage').separatorBefore).toBeFalsy();
    expect(find(items, 'reveal').separatorBefore).toBe(true);
    expect(find(items, 'copyPath').separatorBefore).toBe(true);
    expect(find(items, 'copyRelativePath').separatorBefore).toBeFalsy();
  });

  it('각 항목은 제 손잡이를 부른다', () => {
    const h = handlers();
    const items = buildPathLinkMenuItems({ kind: 'file', isHtml: true, openLabel: 'OPEN' }, h, t);
    for (const it of items) it.onClick();
    expect(h.openPage).toHaveBeenCalledTimes(1);
    expect(h.openBrowser).toHaveBeenCalledTimes(1);
    expect(h.reveal).toHaveBeenCalledTimes(1);
    expect(h.copyPath).toHaveBeenCalledTimes(1);
    expect(h.copyRelativePath).toHaveBeenCalledTimes(1);
    expect(h.open).not.toHaveBeenCalled();

    const h2 = handlers();
    for (const it of buildPathLinkMenuItems({ kind: 'file', isHtml: false, openLabel: 'OPEN' }, h2, t)) it.onClick();
    expect(h2.open).toHaveBeenCalledTimes(1);
    expect(h2.openBrowser).not.toHaveBeenCalled();
  });
});

describe('buildOutsidePathLinkMenuItems — 루트 밖(⑬ (d))', () => {
  it('파일 — 파일 위치 열기와 경로 복사뿐(상대 경로는 기준이 없다)', () => {
    const items = buildOutsidePathLinkMenuItems({ kind: 'file', isHtml: false }, { reveal: vi.fn(), copyPath: vi.fn() }, t);
    expect(ids(items)).toEqual(['reveal', 'copyPath']);
    expect(find(items, 'reveal').label).toBe('ide.streamRenderer.pathLink.menu.revealFile');
  });

  it('HTML — 웹 두 줄은 서되 흐리고, 누를 수 없는 까닭이 붙는다', () => {
    const reveal = vi.fn();
    const items = buildOutsidePathLinkMenuItems({ kind: 'file', isHtml: true }, { reveal, copyPath: vi.fn() }, t);
    expect(ids(items)).toEqual(['openPage', 'openBrowser', 'reveal', 'copyPath']);
    for (const id of ['openPage', 'openBrowser']) {
      const it = find(items, id);
      expect(it.disabled).toBe(true);
      expect(it.disabledTitle).toBe('ide.streamRenderer.pathLink.menu.outsideRoot');
    }
    expect(find(items, 'reveal').disabled).toBeFalsy();
  });

  it('폴더 — "폴더 열기"', () => {
    const items = buildOutsidePathLinkMenuItems({ kind: 'directory', isHtml: false }, { reveal: vi.fn(), copyPath: vi.fn() }, t);
    expect(ids(items)).toEqual(['reveal', 'copyPath']);
    expect(find(items, 'reveal').label).toBe('ide.explorer.ctx.revealFolder');
  });
});

describe('pathLinkOpenLabel — 왼쪽 클릭이 여는 곳의 이름', () => {
  it('판정 갈래마다 이름이 갈린다(이미 있는 문구는 그 키를 그대로)', () => {
    expect(pathLinkOpenLabel({ action: 'editor' }, undefined, t)).toBe('ide.explorer.drop.editor');
    expect(pathLinkOpenLabel({ action: 'image' }, undefined, t)).toBe('ide.explorer.drop.editor');
    expect(pathLinkOpenLabel({ action: 'pdf' }, undefined, t)).toBe('ide.explorer.drop.editor');
    expect(pathLinkOpenLabel({ action: 'run' }, undefined, t)).toBe('ide.streamRenderer.pathLink.menu.run');
    expect(pathLinkOpenLabel({ action: 'external' }, undefined, t)).toBe('panel.mediaConvert.openExternal');
    expect(pathLinkOpenLabel({ action: 'folder' }, undefined, t)).toBe('ide.explorer.ctx.revealFolder');
    expect(pathLinkOpenLabel({ action: 'convert', convertTo: 'video' }, undefined, t)).toBe('ide.explorer.ctx.open');
  });

  it('내부 앱은 앱 이름을 싣고, 이름을 모르면 appId 로 떨어진다', () => {
    expect(pathLinkOpenLabel({ action: 'app', appId: 'sample-app' }, 'Sample App', t))
      .toBe('ide.streamRenderer.pathLink.menu.openApp:{"app":"Sample App"}');
    expect(pathLinkOpenLabel({ action: 'app', appId: 'sample-app' }, undefined, t))
      .toBe('ide.streamRenderer.pathLink.menu.openApp:{"app":"sample-app"}');
  });
});
