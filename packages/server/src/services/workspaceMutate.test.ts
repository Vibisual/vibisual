import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workspaceEntryNameError } from '@vibisual/shared';
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  isWorkspaceTrashAvailable,
  moveWorkspaceEntry,
  renameWorkspaceEntry,
  setWorkspaceTrash,
} from './workspaceMutate.js';

/**
 * §5.5 #17-19 ⑦ — 탐색기 우클릭이 내는 쓰기 셋의 테스트.
 *
 * 되돌릴 수 없는 동작이라 지키는 것이 넷이다 — (a) **루트 밖으로 새지 않는다**, (b) 루트 자신을
 * 건드리지 않는다, (c) 있는 것을 조용히 덮어쓰지 않는다, (d) 삭제는 **휴지통 통로가 꽂혀 있으면
 * 그리로만** 간다(거절당했다고 몰래 영구 삭제로 떨어지지 않는다).
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-mutate-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'export {}\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# hi\n');
});

afterEach(() => {
  setWorkspaceTrash(null);
  fs.rmSync(root, { recursive: true, force: true });
});

describe('createWorkspaceEntry', () => {
  it('루트 바로 아래에 파일을 만든다', () => {
    const outcome = createWorkspaceEntry(root, '', 'notes.md', 'file');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.path).toBe('notes.md');
    expect(outcome.result.parent).toBe('');
    expect(fs.readFileSync(path.join(root, 'notes.md'), 'utf8')).toBe('');
  });

  it('하위 폴더 안에 폴더를 만든다', () => {
    const outcome = createWorkspaceEntry(root, 'src', 'hooks', 'directory');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.path).toBe('src/hooks');
    expect(outcome.result.isDirectory).toBe(true);
    expect(fs.statSync(path.join(root, 'src', 'hooks')).isDirectory()).toBe(true);
  });

  it('[안전] 이미 있는 이름은 덮어쓰지 않고 exists 로 거절 — 있던 내용이 그대로다', () => {
    const outcome = createWorkspaceEntry(root, '', 'README.md', 'file');
    expect(outcome).toEqual({ ok: false, error: 'exists' });
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toBe('# hi\n');
  });

  it('[보안] 이름에 경로를 실어 루트 밖으로 나가려는 시도는 막힌다', () => {
    expect(createWorkspaceEntry(root, '', '../escape.txt', 'file')).toEqual({ ok: false, error: 'invalid-name' });
    expect(createWorkspaceEntry(root, '', 'a/b.txt', 'file')).toEqual({ ok: false, error: 'invalid-name' });
    expect(createWorkspaceEntry(root, '..', 'x.txt', 'file')).toEqual({ ok: false, error: 'outside' });
    expect(fs.existsSync(path.join(root, '..', 'escape.txt'))).toBe(false);
  });

  it('없는 부모 폴더에는 만들지 않는다', () => {
    expect(createWorkspaceEntry(root, 'nope', 'a.txt', 'file')).toEqual({ ok: false, error: 'not-found' });
  });

  it('파일을 부모로 지목하면 거절한다', () => {
    expect(createWorkspaceEntry(root, 'README.md', 'a.txt', 'file')).toEqual({ ok: false, error: 'not-found' });
  });
});

describe('renameWorkspaceEntry', () => {
  it('같은 폴더 안에서 이름만 바뀐다', () => {
    const outcome = renameWorkspaceEntry(root, 'src/App.tsx', 'Main.tsx');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.path).toBe('src/Main.tsx');
    expect(outcome.result.parent).toBe('src');
    expect(fs.existsSync(path.join(root, 'src', 'App.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'src', 'Main.tsx'))).toBe(true);
  });

  it('폴더도 이름이 바뀐다(안의 것은 따라온다)', () => {
    const outcome = renameWorkspaceEntry(root, 'src', 'source');
    expect(outcome.ok).toBe(true);
    expect(fs.existsSync(path.join(root, 'source', 'App.tsx'))).toBe(true);
  });

  it('[안전] 이미 있는 이름으로는 바꾸지 않는다 — 그 파일을 지우지 않는다', () => {
    expect(renameWorkspaceEntry(root, 'src', 'README.md')).toEqual({ ok: false, error: 'exists' });
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toBe('# hi\n');
  });

  it('[안전] 루트 자신은 바꿀 수 없다', () => {
    expect(renameWorkspaceEntry(root, '', 'other')).toEqual({ ok: false, error: 'root' });
  });

  it('[보안] 새 이름에 경로를 실어 다른 폴더로 옮기려는 시도는 막힌다', () => {
    expect(renameWorkspaceEntry(root, 'README.md', '../README.md')).toEqual({ ok: false, error: 'invalid-name' });
    expect(fs.existsSync(path.join(root, 'README.md'))).toBe(true);
  });

  it('대소문자만 바꾸는 이름도 통과한다(자기 자신을 겹침으로 오판하지 않는다)', () => {
    const outcome = renameWorkspaceEntry(root, 'README.md', 'readme.md');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.path).toBe('readme.md');
    expect(fs.readdirSync(root).filter((n) => n.toLowerCase() === 'readme.md')).toEqual(['readme.md']);
  });

  it('없는 대상은 not-found', () => {
    expect(renameWorkspaceEntry(root, 'nope.txt', 'a.txt')).toEqual({ ok: false, error: 'not-found' });
  });
});

describe('deleteWorkspaceEntry', () => {
  it('휴지통 통로가 없으면 영구 삭제이고, 그 사실을 trashed:false 로 알린다', async () => {
    expect(isWorkspaceTrashAvailable()).toBe(false);
    const outcome = await deleteWorkspaceEntry(root, 'README.md');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.trashed).toBe(false);
    expect(fs.existsSync(path.join(root, 'README.md'))).toBe(false);
  });

  it('폴더는 안의 것까지 함께 사라진다', async () => {
    const outcome = await deleteWorkspaceEntry(root, 'src');
    expect(outcome.ok).toBe(true);
    expect(fs.existsSync(path.join(root, 'src'))).toBe(false);
  });

  it('휴지통 통로가 꽂혀 있으면 그리로 보내고 우리가 지우지 않는다', async () => {
    const sent: string[] = [];
    setWorkspaceTrash(async (abs) => { sent.push(abs); });
    expect(isWorkspaceTrashAvailable()).toBe(true);

    const outcome = await deleteWorkspaceEntry(root, 'README.md');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.trashed).toBe(true);
    expect(sent).toEqual([path.resolve(root, 'README.md')]);
    // 휴지통이 옮기는 일까지 하므로(테스트 대역은 아무것도 안 한다) 우리가 rm 하지 않았음을 본다.
    expect(fs.existsSync(path.join(root, 'README.md'))).toBe(true);
  });

  it('[안전] 휴지통이 거절하면 실패로 답한다 — 몰래 영구 삭제로 떨어지지 않는다', async () => {
    setWorkspaceTrash(async () => { throw new Error('nope'); });
    const outcome = await deleteWorkspaceEntry(root, 'README.md');
    expect(outcome).toEqual({ ok: false, error: 'failed' });
    expect(fs.existsSync(path.join(root, 'README.md'))).toBe(true);
  });

  it('[안전] 루트 자신은 지울 수 없다', async () => {
    expect(await deleteWorkspaceEntry(root, '')).toEqual({ ok: false, error: 'root' });
    expect(fs.existsSync(root)).toBe(true);
  });

  it('[보안] 루트 밖은 지울 수 없다', async () => {
    expect(await deleteWorkspaceEntry(root, '../')).toEqual({ ok: false, error: 'outside' });
  });

  it('없는 대상은 not-found', async () => {
    expect(await deleteWorkspaceEntry(root, 'nope.txt')).toEqual({ ok: false, error: 'not-found' });
  });
});

describe('moveWorkspaceEntry — §5.5 #17-19 ⑧ 끌어다 폴더에 놓기', () => {
  it('파일을 다른 폴더로 옮긴다 — 이름은 그대로', () => {
    const outcome = moveWorkspaceEntry(root, 'README.md', 'src');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.path).toBe('src/README.md');
    expect(outcome.result.parent).toBe('src');
    expect(outcome.result.name).toBe('README.md');
    expect(fs.existsSync(path.join(root, 'src', 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'README.md'))).toBe(false);
  });

  it('루트로도 옮긴다(toDir = 빈 문자열)', () => {
    const outcome = moveWorkspaceEntry(root, 'src/App.tsx', '');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.path).toBe('App.tsx');
    expect(outcome.result.parent).toBe('');
  });

  it('폴더도 통째로 옮긴다 — 안의 것이 함께 간다', () => {
    fs.mkdirSync(path.join(root, 'pkg'));
    const outcome = moveWorkspaceEntry(root, 'src', 'pkg');
    expect(outcome.ok).toBe(true);
    expect(fs.existsSync(path.join(root, 'pkg', 'src', 'App.tsx'))).toBe(true);
  });

  it('제자리로 놓으면 디스크를 건드리지 않고 성공 — 헛손질은 실패가 아니다', () => {
    const before = fs.statSync(path.join(root, 'src', 'App.tsx')).mtimeMs;
    const outcome = moveWorkspaceEntry(root, 'src/App.tsx', 'src');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.path).toBe('src/App.tsx');
    expect(fs.statSync(path.join(root, 'src', 'App.tsx')).mtimeMs).toBe(before);
  });

  it('폴더를 자기 자신·자기 하위로는 못 옮긴다 — 트리가 스스로를 삼킨다', () => {
    fs.mkdirSync(path.join(root, 'src', 'deep'), { recursive: true });
    expect(moveWorkspaceEntry(root, 'src', 'src')).toEqual({ ok: false, error: 'into-self' });
    expect(moveWorkspaceEntry(root, 'src', 'src/deep')).toEqual({ ok: false, error: 'into-self' });
  });

  it('이름이 접두사만 같은 이웃 폴더는 "자기 하위"가 아니다', () => {
    fs.mkdirSync(path.join(root, 'srcery'));
    const outcome = moveWorkspaceEntry(root, 'src', 'srcery');
    expect(outcome.ok).toBe(true);
    expect(fs.existsSync(path.join(root, 'srcery', 'src', 'App.tsx'))).toBe(true);
  });

  it('목적지에 같은 이름이 있으면 덮어쓰지 않고 exists', () => {
    fs.writeFileSync(path.join(root, 'src', 'README.md'), '# 먼저 있던 것\n');
    expect(moveWorkspaceEntry(root, 'README.md', 'src')).toEqual({ ok: false, error: 'exists' });
    expect(fs.readFileSync(path.join(root, 'src', 'README.md'), 'utf8')).toBe('# 먼저 있던 것\n');
  });

  it('[보안] 루트 밖으로는 못 내보내고, 루트 밖에서 못 끌어온다', () => {
    expect(moveWorkspaceEntry(root, 'README.md', '../')).toEqual({ ok: false, error: 'outside' });
    expect(moveWorkspaceEntry(root, '../secret.txt', 'src')).toEqual({ ok: false, error: 'outside' });
  });

  it('루트 자신은 옮길 수 없다 — 탐색기가 서 있는 땅이다', () => {
    expect(moveWorkspaceEntry(root, '', 'src')).toEqual({ ok: false, error: 'root' });
  });

  it('없는 대상·폴더가 아닌 목적지는 not-found', () => {
    expect(moveWorkspaceEntry(root, 'nope.txt', 'src')).toEqual({ ok: false, error: 'not-found' });
    expect(moveWorkspaceEntry(root, 'README.md', 'src/App.tsx')).toEqual({ ok: false, error: 'not-found' });
  });
});

describe('workspaceEntryNameError — 세 OS 를 함께 지키는 이름 규칙(shared)', () => {
  it('평범한 이름은 통과', () => {
    for (const name of ['App.tsx', '.env', 'my folder', 'a-b_c.2.ts', '한글이름.md']) {
      expect(workspaceEntryNameError(name), name).toBeNull();
    }
  });

  it('빈 이름·공백뿐인 이름은 거절', () => {
    expect(workspaceEntryNameError('')).toBe('empty');
    expect(workspaceEntryNameError('   ')).toBe('empty');
  });

  it('경로 조각은 이름이 아니다', () => {
    expect(workspaceEntryNameError('a/b')).toBe('separator');
    expect(workspaceEntryNameError('a\\b')).toBe('separator');
    expect(workspaceEntryNameError('.')).toBe('traversal');
    expect(workspaceEntryNameError('..')).toBe('traversal');
  });

  it('Windows 금지 글자·예약 이름은 linux 에서도 막는다(그 저장소를 받는 다음 사람을 위해)', () => {
    expect(workspaceEntryNameError('a:b.txt')).toBe('invalid-char');
    expect(workspaceEntryNameError('what?.txt')).toBe('invalid-char');
    expect(workspaceEntryNameError('CON')).toBe('reserved');
    expect(workspaceEntryNameError('com1.txt')).toBe('reserved');
    expect(workspaceEntryNameError('name.')).toBe('trailing');
    expect(workspaceEntryNameError(' name')).toBe('trailing');
    expect(workspaceEntryNameError('a'.repeat(256))).toBe('too-long');
  });
});
