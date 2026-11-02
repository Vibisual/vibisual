import { describe, expect, it } from 'vitest';
import { createShellFolderOpener, type ShellFolderOpenerDeps } from './shellFolderOpen';

function harness(over: Partial<ShellFolderOpenerDeps> = {}) {
  const registered: string[] = [];
  const sent: string[] = [];
  let receiver = false;
  const opener = createShellFolderOpener({
    isDirectory: (p) => !p.endsWith('.txt'),
    register: async (p) => { registered.push(p); return p.split(/[\\/]/).pop() ?? null; },
    send: (name) => { if (!receiver) return false; sent.push(name); return true; },
    log: () => {},
    ...over,
  });
  return { opener, registered, sent, setReceiver: (v: boolean) => { receiver = v; } };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('폴더 우클릭으로 받은 폴더의 줄', () => {
  it('서버가 뜨기 전에 온 폴더는 기다렸다가 순서대로 연다', async () => {
    const h = harness();
    h.opener.request(['/w/a', '/w/b', '/w/a']);
    await flush();
    expect(h.registered).toEqual([]);
    h.opener.backendReady();
    await flush();
    expect(h.registered).toEqual(['/w/a', '/w/b']);
  });

  it('렌더러가 준비되기 전에 연 탭은 준비를 알릴 때 돌려준다 — 같은 이름은 한 번', async () => {
    const h = harness();
    h.opener.backendReady();
    h.opener.request(['/w/a', '/w/b', '/w/a']);
    await flush();
    expect(h.opener.takePending()).toEqual(['b', 'a']);
    expect(h.opener.takePending()).toEqual([]);
  });

  it('준비된 렌더러에는 바로 보낸다', async () => {
    const h = harness();
    h.opener.backendReady();
    h.setReceiver(true);
    h.opener.request(['/w/a']);
    await flush();
    expect(h.sent).toEqual(['a']);
    expect(h.opener.takePending()).toEqual([]);
  });

  it('단계마다 기록을 남긴다 — 기다림 · 연 탭 · 아직 창이 없어 미룬 탭', async () => {
    const lines: string[] = [];
    const h = harness({ log: (m) => lines.push(m) });
    h.opener.request(['/w/a']);
    h.opener.backendReady();
    await flush();
    h.setReceiver(true);
    h.opener.request(['/w/b']);
    await flush();
    expect(lines).toEqual([
      '[shell-open] waiting for the app to start: /w/a',
      '[shell-open] opened /w/a → tab "a" (switches when the window is ready)',
      '[shell-open] opened /w/b → tab "b"',
    ]);
  });

  it('폴더가 아니면(mac Dock 에 놓은 파일) 열지 않는다 · 등록 실패는 줄을 막지 않는다', async () => {
    const h = harness({ register: async (p) => { if (p === '/w/bad') throw new Error('boom'); return p.split('/').pop() ?? null; } });
    h.opener.backendReady();
    h.opener.request(['/w/notes.txt', '/w/bad', '/w/ok']);
    await flush();
    expect(h.opener.takePending()).toEqual(['ok']);
  });
});
