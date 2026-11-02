import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserDefaults } from '@vibisual/shared';

// 실제 ~/.vibisual/user-defaults.json 을 건드리지 않게 저장소를 메모리로 바꾼다.
const store = vi.hoisted(() => {
  let defaults: UserDefaults = { updatedAt: 0 };
  const listeners = new Set<(d: UserDefaults) => void>();
  return {
    set(next: Omit<UserDefaults, 'updatedAt'>) { defaults = { ...next, updatedAt: defaults.updatedAt + 1 }; for (const fn of listeners) fn(defaults); },
    reset() { defaults = { updatedAt: 0 }; listeners.clear(); },
    service: {
      get: () => defaults,
      subscribe: (fn: (d: UserDefaults) => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    },
  };
});
vi.mock('./userDefaultsService.js', () => ({ userDefaultsService: store.service }));

const { FolderContextMenuService } = await import('./folderContextMenuService.js');

describe('폴더 우클릭 메뉴 — 서버가 main 에 넘기는 바람', () => {
  beforeEach(() => store.reset());

  it('미설정이면 켬 · 언어는 user-defaults 가 먼저(없으면 graphManager 값)', () => {
    const svc = new FolderContextMenuService(() => 'ja');
    expect(svc.wish()).toEqual({ enabled: true, locale: 'ja' });
    store.set({ advanced: { folderContextMenu: false }, appearance: { uiLocale: 'ko' } });
    expect(svc.wish()).toEqual({ enabled: false, locale: 'ko' });
  });

  it('켬·언어가 바뀐 때만 알린다 — 다른 설정 저장마다 메뉴를 다시 적지 않는다', () => {
    const svc = new FolderContextMenuService(() => 'en');
    const seen: unknown[] = [];
    const off = svc.subscribe((w) => seen.push(w));
    store.set({ advanced: { terminalScrollbackLines: 5000 } });
    expect(seen).toEqual([]);
    store.set({ advanced: { folderContextMenu: false } });
    store.set({ advanced: { folderContextMenu: false }, notifications: { cmdBlocked: false } });
    store.set({ advanced: { folderContextMenu: false }, appearance: { uiLocale: 'de' } });
    expect(seen).toEqual([{ enabled: false, locale: 'en' }, { enabled: false, locale: 'de' }]);
    off();
    store.set({});
    expect(seen).toHaveLength(2);
  });

  it('상태는 main 이 적기 전엔 null', () => {
    const svc = new FolderContextMenuService(() => 'en');
    expect(svc.getStatus()).toBeNull();
    svc.setStatus({ enabled: true, installed: true, targets: ['windows-explorer'], appliedAt: 1 });
    expect(svc.getStatus()?.targets).toEqual(['windows-explorer']);
  });
});

describe('POST /api/projects/open-path — 경로 계약', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.ts'), 'utf8');
  const at = src.indexOf("app.post('/api/projects/open-path'");
  const body = src.slice(at, src.indexOf('app.get(', at));

  it('루프백 유입은 403 · 절대경로 · 실제 폴더만', () => {
    expect(at).toBeGreaterThan(-1);
    expect(body).toContain('req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE');
    expect(body).toContain('path.isAbsolute(');
    expect(body).toContain('.isDirectory()');
  });

  it('[폴더 열기]와 같은 꼬리 — 닫힌 탭도 되살린다(showProject)', () => {
    expect(body).toContain('openUserFolderAsProject(target, { exact: true })');
    const tailAt = src.indexOf('const openUserFolderAsProject');
    const tail = src.slice(tailAt, src.indexOf('};', tailAt));
    expect(tail).toContain('graphManager.registerChosenFolder(selected)');
    expect(tail).toContain('graphManager.registerProject(selected)');
    expect(tail).toContain('graphManager.showProject(info.name)');
    expect(tail).toContain('broadcastSnapshot()');
    const folder = src.indexOf("app.post('/api/projects/open-folder'");
    expect(src.slice(folder, folder + 1200)).toContain('openUserFolderAsProject(selected)');
  });

  it('두 길 모두 탭 표시명을 함께 돌려준다 — 같은 이름 폴더가 열려 있어도 그 탭으로 바뀐다', () => {
    expect(body).toContain('displayName: openedTabName(info)');
    const folder = src.indexOf("app.post('/api/projects/open-folder'");
    expect(src.slice(folder, folder + 1200)).toContain('displayName: openedTabName(info)');
    const desktop = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'desktop', 'src', 'main', 'index.ts'), 'utf8');
    expect(desktop).toContain('body.displayName');
  });

  it('바깥 리스너 허용 목록에 없다', () => {
    const desktop = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'desktop', 'src', 'main', 'index.ts'), 'utf8');
    const listener = desktop.slice(desktop.indexOf('async function startHookListener'), desktop.indexOf('function registerIframeProxyProtocol'));
    expect(listener.length).toBeGreaterThan(0);
    expect(listener).not.toContain('open-path');
    expect(listener).not.toContain('folder-context-menu');
  });
});
