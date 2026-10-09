import { describe, expect, it } from 'vitest';
import {
  EDITOR_PANE_FILE_KINDS,
  WORKSPACE_FIND_PATH,
  editorPaneKindOf,
  isEditorPaneFileKind,
  isEditorPaneListable,
  parseClaimedExtensions,
  serializeClaimedExtensions,
  workspaceFindUrl,
} from '@vibisual/shared';
import type { WorkspaceEntry, WorkspaceFindResult } from '@vibisual/shared';
import type { RunSession } from '../../stores/runSessions.js';
import {
  OPENER_FIND_CACHE_MAX,
  OPENER_FOCUS_WINDOW_MS,
  agentRunsNewestFirst,
  cachedFindResult,
  filterOpenerEntries,
  openerExtensionsOf,
  rememberFindResult,
  requestOpenerFocus,
  subscribeOpenerFocus,
  takeOpenerFocus,
} from './paneOpenerModel.js';

/**
 * §5.5 #17-27 ⑱ — 우측 판 갈래 판정(shared 한 벌)과 빈 탭 고르기의 순수 계산.
 */

const entry = (relPath: string, mtimeMs?: number): WorkspaceEntry => ({
  name: relPath.split('/').pop() ?? relPath,
  relPath,
  isDirectory: false,
  ...(mtimeMs === undefined ? {} : { mtimeMs }),
});

describe('editorPaneKindOf — 판이 그리는 갈래는 resolveWorkspaceOpen 위에 선다', () => {
  it('HTML 은 웹 페이지, 그 밖 텍스트는 코드', () => {
    expect(editorPaneKindOf('site/index.html')).toBe('html');
    expect(editorPaneKindOf('a.HTM')).toBe('html');
    expect(editorPaneKindOf('src/App.tsx')).toBe('code');
    expect(editorPaneKindOf('README')).toBe('code');
  });

  it('그림 · PDF 는 그대로, .svg 는 텍스트라 코드(⑭ — 서버가 이진+이미지일 때만 그림으로 그린다)', () => {
    expect(editorPaneKindOf('shot.png')).toBe('image');
    expect(editorPaneKindOf('doc/manual.pdf')).toBe('pdf');
    expect(editorPaneKindOf('icon.svg')).toBe('code');
  });

  it('판에 오지 않는 것은 null — 연결 프로그램 · 변환', () => {
    expect(editorPaneKindOf('bundle.zip')).toBeNull();
    expect(editorPaneKindOf('clip.avi')).toBeNull();
  });

  it('앱이 받겠다고 선언한 확장자는 판에 오지 않는다(선언을 넘겨야 빠진다)', () => {
    expect(editorPaneKindOf('clip.mp4')).toBe('code');
    expect(editorPaneKindOf('clip.mp4', [{ appId: 'video', opens: ['.mp4'] }])).toBeNull();
  });

  it('바깥 값은 우리 갈래만 받는다', () => {
    for (const kind of EDITOR_PANE_FILE_KINDS) expect(isEditorPaneFileKind(kind)).toBe(true);
    expect(isEditorPaneFileKind('video')).toBe(false);
    expect(isEditorPaneFileKind(undefined)).toBe(false);
  });
});

describe('isEditorPaneListable — 코드 목록은 컴파일 산출물을 뺀다', () => {
  it('.dll 은 탐색기에서는 편집창으로 가지만(판정 그대로) 고르기 목록에는 서지 않는다', () => {
    expect(editorPaneKindOf('bin/x.dll')).toBe('code');
    expect(isEditorPaneListable('bin/x.dll', 'code')).toBe(false);
    expect(isEditorPaneListable('src/a.ts', 'code')).toBe(true);
  });

  it('갈래가 다르면 목록에 서지 않는다', () => {
    expect(isEditorPaneListable('a.html', 'code')).toBe(false);
    expect(isEditorPaneListable('a.html', 'html')).toBe(true);
  });
});

describe('앱 선언을 조회 한 칸으로 — 화면 조립과 서버 해석이 한 파일', () => {
  it('접고 다시 펴면 같은 판정이 나온다', () => {
    const raw = serializeClaimedExtensions([{ appId: 'a', opens: ['.MP4', '.webm'] }, { appId: 'b', opens: ['.mp4', '.glb'] }]);
    expect(raw).toBe('.glb,.mp4,.webm');
    const apps = parseClaimedExtensions(raw);
    expect(editorPaneKindOf('x.mp4', apps)).toBeNull();
    expect(editorPaneKindOf('x.ts', apps)).toBe('code');
  });

  it('모양이 틀린 조각은 버린다(통째로 거절하지 않는다)', () => {
    expect(parseClaimedExtensions('.mp4,mp3,.a b,../x,.webm')).toEqual([{ appId: 'claimed', opens: ['.mp4', '.webm'] }]);
    expect(parseClaimedExtensions(undefined)).toEqual([]);
    expect(parseClaimedExtensions(['.mp4'])).toEqual([]);
  });

  it('조회 주소는 창구 경로 + root · kind · claimed', () => {
    const url = workspaceFindUrl('C:/repo', 'html', [{ appId: 'a', opens: ['.mp4'] }]);
    expect(url.startsWith(`${WORKSPACE_FIND_PATH}?`)).toBe(true);
    const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(q.get('root')).toBe('C:/repo');
    expect(q.get('kind')).toBe('html');
    expect(q.get('claimed')).toBe('.mp4');
    // 선언이 없으면 칸 자체를 싣지 않는다.
    expect(workspaceFindUrl('/r', 'pdf', [])).not.toContain('claimed');
  });
});

describe('filterOpenerEntries — 이름으로 좁히기', () => {
  const list = [
    entry('docs/report/index.html', 30),
    entry('report.html', 20),
    entry('site/main.html', 10),
  ];

  it('빈 검색어는 그대로(받은 차례 = 최근 고친 순)', () => {
    expect(filterOpenerEntries(list, '  ').map((e) => e.relPath)).toEqual(list.map((e) => e.relPath));
  });

  it('파일 이름에 든 것이 앞, 폴더에만 걸린 것이 뒤', () => {
    expect(filterOpenerEntries(list, 'report').map((e) => e.relPath)).toEqual(['report.html', 'docs/report/index.html']);
  });

  it('낱말은 전부 들어 있어야 한다 · 대소문자는 접는다', () => {
    expect(filterOpenerEntries(list, 'SITE main').map((e) => e.relPath)).toEqual(['site/main.html']);
    expect(filterOpenerEntries(list, 'site report')).toEqual([]);
  });
});

describe('openerExtensionsOf — 머리에 적는 확장자도 판정 한 벌로 거른다', () => {
  it('그림에 .svg 가 없다(열면 코드로 그려지므로)', () => {
    const exts = openerExtensionsOf('image');
    expect(exts).toContain('.png');
    expect(exts).not.toContain('.svg');
  });

  it('웹 페이지 · PDF', () => {
    expect(openerExtensionsOf('html')).toEqual(['.html', '.htm', '.xhtml']);
    expect(openerExtensionsOf('pdf')).toEqual(['.pdf']);
  });

  it('코드는 빈 목록 — 모르는 확장자가 전부 코드라 끝이 없다', () => {
    expect(openerExtensionsOf('code')).toEqual([]);
  });

  it('앱이 받은 확장자는 빠진다', () => {
    expect(openerExtensionsOf('image', [{ appId: 'x', opens: ['.png'] }])).not.toContain('.png');
  });
});

describe('agentRunsNewestFirst — 목록의 실행 줄은 그 버블의 것만, 최근 것부터', () => {
  const run = (runId: string, agentId: string, startedAt: number): RunSession => ({
    runId, agentId, configId: runId, name: runId, command: runId,
    debugMode: false, debugApplied: false, status: 'running', startedAt,
  });

  it('다른 버블의 실행은 서지 않는다', () => {
    const sessions = { a: run('a', 'agent-1', 1), b: run('b', 'agent-2', 2), c: run('c', 'agent-1', 3) };
    expect(agentRunsNewestFirst(sessions, 'agent-1').map((r) => r.runId)).toEqual(['c', 'a']);
    expect(agentRunsNewestFirst(sessions, null)).toEqual([]);
  });
});

describe('받아 둔 목록 — 먼저 그리고 뒤에서 새로 받는다', () => {
  const result = (n: number): WorkspaceFindResult => ({
    root: '/r', kind: 'html', entries: [entry(`f${String(n)}.html`, n)], total: 1, truncated: false,
  });

  it('조회 주소마다 마지막에 받은 것을 돌려준다', () => {
    rememberFindResult('/api/workspace-find?kind=html&root=%2Fa', result(1));
    expect(cachedFindResult('/api/workspace-find?kind=html&root=%2Fa')?.entries[0]?.relPath).toBe('f1.html');
    expect(cachedFindResult('/api/workspace-find?kind=pdf&root=%2Fa')).toBeNull();
  });

  it('다시 받으면 갈아 끼운다', () => {
    rememberFindResult('u-replace', result(1));
    rememberFindResult('u-replace', result(2));
    expect(cachedFindResult('u-replace')?.entries[0]?.relPath).toBe('f2.html');
  });

  it('상한을 넘으면 가장 오래 안 쓴 조회부터 버린다 — 꺼내 쓴 것은 최근이 된다', () => {
    for (let i = 0; i < OPENER_FIND_CACHE_MAX; i += 1) rememberFindResult(`u-${String(i)}`, result(i));
    // 가장 오래된 것을 한 번 꺼내 쓰면 맨 뒤(최근)로 간다.
    expect(cachedFindResult('u-0')).not.toBeNull();
    rememberFindResult('u-new', result(99));
    expect(cachedFindResult('u-1'), '꺼내 쓰지 않은 가장 오래된 것이 밀린다').toBeNull();
    expect(cachedFindResult('u-0')).not.toBeNull();
    expect(cachedFindResult('u-new')).not.toBeNull();
  });
});

describe('방금 연 빈 탭만 초점을 가져간다', () => {
  it('요청은 그 창의 그 빈 탭이 한 번만 가져간다', () => {
    requestOpenerFocus('pane-1', '//opener/html', 1_000);
    expect(takeOpenerFocus('pane-2', '//opener/html', 1_000)).toBe(false);
    expect(takeOpenerFocus('pane-1', '//opener/code', 1_000)).toBe(false);
    expect(takeOpenerFocus('pane-1', '//opener/html', 1_100)).toBe(true);
    expect(takeOpenerFocus('pane-1', '//opener/html', 1_100)).toBe(false);
  });

  it('오래된 요청은 초점을 주지 않는다 — 늦게 선 탭이 엉뚱한 때 입력창을 뺏지 않게', () => {
    requestOpenerFocus(null, '//opener/pdf', 0);
    expect(takeOpenerFocus(null, '//opener/pdf', OPENER_FOCUS_WINDOW_MS + 1)).toBe(false);
  });

  it('이미 떠 있는 빈 탭은 요청을 듣는다', () => {
    let heard = 0;
    const off = subscribeOpenerFocus(() => { heard += 1; });
    requestOpenerFocus(null, '//opener/image');
    off();
    requestOpenerFocus(null, '//opener/image');
    expect(heard).toBe(1);
    // 남은 요청은 비워 둔다(다른 시험에 새지 않게).
    takeOpenerFocus(null, '//opener/image');
  });
});
