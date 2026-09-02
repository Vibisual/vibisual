import { describe, expect, it } from 'vitest';
import type { BubbleData, BubbleType } from '@vibisual/shared';

import { ancestorPaths, folderCandidates, resolveSatelliteFolderId } from './satelliteNavigate.js';

/**
 * §2.1 #5 — **외부 위성 파일을 더블클릭하면 그 파일이 있는 폴더로 들어간다.**
 *
 * 내부 위성은 예전부터 그렇게 움직였는데 외부 위성은 눌러도 아무 일이 없었다. 이유는 비교하는
 * 두 값의 모양이 애초에 달랐기 때문이다 — 외부 **파일** 노드의 `path` 에는 `__ext__` 네임스페이스가
 * 붙고, 외부 **폴더** 노드의 `path` 는 순수 절대경로다. 부모 경로를 잘라 봐야 영원히 안 맞았다.
 *
 * 여기서 고정하는 것은 셋이다: ① 외부도 내부와 같은 규칙으로 폴더를 찾는다 ② 깊은 조상이
 * 아직 안 실려 왔으면 있는 것 중 가장 깊은 데까지 들어간다(§9 폴더 스코프 스냅샷과 공존)
 * ③ 폴더가 아닌 버블로는 들어가지 않는다.
 */

function folder(id: string, path: string, opts?: { abs?: string; type?: BubbleType }): BubbleData {
  return {
    id,
    label: path,
    bubbleType: opts?.type ?? 'external_folder',
    path,
    absolutePath: opts?.abs ?? path,
    status: 'idle',
    activity: 1,
    lastActivity: 0,
    childCount: 0,
  } as BubbleData;
}

describe('ancestorPaths — 깊은 것부터', () => {
  it('프로젝트 상대경로', () => {
    expect(ancestorPaths('docs/rules/coding.md')).toEqual(['docs/rules', 'docs']);
  });

  it('윈도우 절대경로 — 드라이브까지 내려간다', () => {
    expect(ancestorPaths('c:/a/b/out.json')).toEqual(['c:/a/b', 'c:/a', 'c:']);
  });

  it('POSIX 절대경로 — 루트(`/`) 하나만 남는 빈 조상은 만들지 않는다', () => {
    expect(ancestorPaths('/srv/work/one.txt')).toEqual(['/srv/work', '/srv']);
  });

  it('부모가 없으면 빈 목록 (최상위 파일 · 빈 값)', () => {
    expect(ancestorPaths('README.md')).toEqual([]);
    expect(ancestorPaths(undefined)).toEqual([]);
    expect(ancestorPaths(null)).toEqual([]);
  });
});

describe('외부 위성 파일 → 폴더 찾기 (눌러도 아무 일이 없던 자리)', () => {
  const tasks = folder('folder-tasks', 'c:/users/aa/tmp/claude/sess-1/tasks');
  const work = folder('folder-work', 'c:/users/aa/tmp/claude');

  it('노드 키(`__ext__`)가 아니라 절대경로로 부모를 찾는다', () => {
    const file = {
      path: '__ext__c:/users/aa/tmp/claude/sess-1/tasks/out.json',
      absolutePath: 'c:/users/aa/tmp/claude/sess-1/tasks/out.json',
    };
    expect(resolveSatelliteFolderId(file, [work, tasks])).toBe('folder-tasks');
  });

  it('종전 규칙(노드 키 부모 비교)만 있었다면 못 찾았다는 사실을 함께 고정', () => {
    const keyParent = '__ext__c:/users/aa/tmp/claude/sess-1/tasks';
    expect([work, tasks].some((f) => f.path === keyParent)).toBe(false);
  });

  it('직속 부모가 아직 안 실려 왔으면 있는 것 중 가장 깊은 조상으로 들어간다', () => {
    const file = {
      path: '__ext__c:/users/aa/tmp/claude/sess-1/tasks/out.json',
      absolutePath: 'c:/users/aa/tmp/claude/sess-1/tasks/out.json',
    };
    // §9 폴더 스코프 — 최상위 캔버스에는 "한 칸 앞"까지만 온다.
    expect(resolveSatelliteFolderId(file, [work])).toBe('folder-work');
  });

  it('워크트리 네임스페이스가 붙은 키도 같다', () => {
    const file = {
      path: 'wt1a2b__ext__c:/users/aa/tmp/claude/sess-1/tasks/out.json',
      absolutePath: 'c:/users/aa/tmp/claude/sess-1/tasks/out.json',
    };
    expect(resolveSatelliteFolderId(file, [work, tasks])).toBe('folder-tasks');
  });

  it('아무 조상도 없으면 null — 엉뚱한 폴더로 튀지 않는다', () => {
    const file = { path: '__ext__d:/other/out.json', absolutePath: 'd:/other/out.json' };
    expect(resolveSatelliteFolderId(file, [work, tasks])).toBeNull();
  });
});

describe('내부 위성은 종전 그대로 움직인다', () => {
  const docs = folder('folder-docs', 'docs', { abs: 'c:/proj/docs', type: 'internal_folder' });
  const rules = folder('folder-rules', 'docs/rules', { abs: 'c:/proj/docs/rules', type: 'internal_folder' });

  it('상대 경로의 직속 부모를 먼저 고른다', () => {
    const file = { path: 'docs/rules/coding.md', absolutePath: 'c:/proj/docs/rules/coding.md' };
    expect(resolveSatelliteFolderId(file, [docs, rules])).toBe('folder-rules');
  });

  it('최상위 파일(부모 없음)은 아무 데도 안 간다', () => {
    expect(resolveSatelliteFolderId({ path: 'README.md' }, [docs, rules])).toBeNull();
  });
});

describe('들어갈 수 있는 자리만 고른다', () => {
  it('파일·에이전트 버블은 후보가 아니다', () => {
    const file = folder('file-1', 'docs/rules', { type: 'file' });
    const agent = folder('agent-1', 'docs/rules', { type: 'agent' });
    expect(resolveSatelliteFolderId({ path: 'docs/rules/x.md' }, [file, agent])).toBeNull();
  });

  it('워크트리 버블은 후보다 (그 안으로 들어갈 수 있다)', () => {
    const wt = folder('wt-1', 'docs/rules', { type: 'worktree' });
    expect(resolveSatelliteFolderId({ path: 'docs/rules/x.md' }, [wt])).toBe('wt-1');
  });
});

describe('folderCandidates — 최상위를 먼저 흘린다', () => {
  it('같은 경로가 양쪽에 있으면 최상위 id 를 쓴다', () => {
    const top = folder('top-1', 'c:/a/b');
    const child = folder('child-1', 'c:/a/b');
    const file = { path: '__ext__c:/a/b/x.json', absolutePath: 'c:/a/b/x.json' };
    expect(resolveSatelliteFolderId(file, folderCandidates([top], { 'p': [child] }))).toBe('top-1');
  });

  it('children 만 있어도 찾는다', () => {
    const child = folder('child-1', 'c:/a/b');
    const file = { path: '__ext__c:/a/b/x.json', absolutePath: 'c:/a/b/x.json' };
    expect(resolveSatelliteFolderId(file, folderCandidates([], { 'p': [child] }))).toBe('child-1');
  });
});
