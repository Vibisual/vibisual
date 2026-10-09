/**
 * §5.3 #12-3 자물쇠 — shared `pathLock.ts` 고정 시험.
 *
 * 판정기는 shared 순수 함수지만 shared 패키지에는 러너가 없어 여기서 고정한다(`bashWritePaths.test.ts`
 * 와 같은 자리). **플랫폼은 인자로 넘긴다** — 개발기 한 대에서 세 OS 를 전부 재기 위함이다(멀티플랫폼 1축).
 */
import { describe, it, expect } from 'vitest';
import {
  buildPathLock,
  findPathLockCover,
  findToolLockHits,
  mergePathLocks,
  normalizePathLockTarget,
  normalizePathLocks,
  pathLockId,
  pathLockTargetOf,
  resolveLockPath,
  type PathLock,
  type PathLockKind,
  type PlatformName,
} from '@vibisual/shared';

function lock(kind: PathLockKind, target: string, platform: PlatformName = 'win32', label?: string): PathLock {
  const built = buildPathLock({ kind, target, ...(label ? { label } : {}) }, platform, 1);
  if (!built) throw new Error(`bad lock ${kind} ${target}`);
  return built;
}

const WIN_ROOT = 'C:/work/proj';
const winLocks = (platform: PlatformName = 'win32') => ({
  proj: [
    lock('file', `${WIN_ROOT}/secret.env`, platform),
    lock('folder', `${WIN_ROOT}/private`, platform),
    lock('folder', `${WIN_ROOT}/build/keep`, platform),
  ],
});

const win = (locks = winLocks()) => ({ locks, cwd: WIN_ROOT, platform: 'win32' as const, homeDir: 'C:/Users/me' }); // privacy-ok — 실제 홈이 아니라 테스트 픽스처

function hitTargets(hits: ReturnType<typeof findToolLockHits>): string[] {
  return hits.map((h) => h.target).sort();
}

describe('pathLockTargetOf — 버블이 가리키는 잠글 대상', () => {
  it('파일·폴더·워크트리는 절대경로, 도메인은 호스트', () => {
    expect(pathLockTargetOf({ bubbleType: 'file', path: 'src/a.ts', absolutePath: 'C:\\work\\proj\\src\\a.ts', label: 'a.ts' }))
      .toEqual({ kind: 'file', target: 'C:/work/proj/src/a.ts', label: 'a.ts' });
    expect(pathLockTargetOf({ bubbleType: 'internal_folder', path: 'src', absolutePath: 'C:/work/proj/src/', label: 'src' }))
      .toEqual({ kind: 'folder', target: 'C:/work/proj/src', label: 'src' });
    expect(pathLockTargetOf({ bubbleType: 'external_folder', path: '/home/me/notes', label: '(ext) /home/me/notes' })) // privacy-ok — 실제 홈이 아니라 테스트 픽스처
      .toEqual({ kind: 'folder', target: '/home/me/notes', label: '(ext) /home/me/notes' }); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    expect(pathLockTargetOf({ bubbleType: 'worktree', path: 'C:/work/proj/.claude/worktrees/a', label: 'a' }))
      .toEqual({ kind: 'folder', target: 'C:/work/proj/.claude/worktrees/a', label: 'a' });
    expect(pathLockTargetOf({ bubbleType: 'domain', path: '__web__github.com', label: 'github.com' }))
      .toEqual({ kind: 'host', target: 'github.com', label: 'github.com' });
  });

  it('Ghost 는 원래 종류를 따른다', () => {
    const base = { changeType: 'deleted', fromPath: 'x', ghostedAt: 1, pinned: false } as const;
    expect(pathLockTargetOf({
      bubbleType: 'ghost', path: 'x.txt', absolutePath: 'C:/p/x.txt', label: 'x.txt',
      ghostInfo: { ...base, originalBubbleType: 'file' } as never,
    })?.kind).toBe('file');
    expect(pathLockTargetOf({
      bubbleType: 'ghost', path: 'd', absolutePath: 'C:/p/d', label: 'd',
      ghostInfo: { ...base, originalBubbleType: 'internal_folder' } as never,
    })?.kind).toBe('folder');
  });

  it('잠글 수 없는 버블은 null — 에이전트·골격·접힌 웹 버블·절대경로 없는 파일', () => {
    expect(pathLockTargetOf({ bubbleType: 'agent', path: 'sess', label: 'Agent' })).toBeNull();
    expect(pathLockTargetOf({ bubbleType: 'root', path: '__root__', label: 'root' })).toBeNull();
    expect(pathLockTargetOf({ bubbleType: 'domain', path: '__web__/agent-1', label: 'web' })).toBeNull();
    expect(pathLockTargetOf({ bubbleType: 'file', path: 'src/a.ts', label: 'a.ts' })).toBeNull();
  });
});

describe('자물쇠 한 개 — id · 검증 · 합치기', () => {
  it('id 는 플랫폼 경로 키 — win32·darwin 은 대소문자를 접고 linux 는 접지 않는다', () => {
    expect(pathLockId('file', 'C:/Work/A.txt', 'win32')).toBe(pathLockId('file', 'c:/work/a.txt', 'win32'));
    // mac 기본 APFS 도 대소문자를 무시한다 — 접지 않으면 케이스만 다른 같은 파일이 두 자물쇠가 된다.
    expect(pathLockId('file', '/Users/Me/A.txt', 'darwin')).toBe(pathLockId('file', '/users/me/a.txt', 'darwin')); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    expect(pathLockId('file', '/w/A.txt', 'linux')).not.toBe(pathLockId('file', '/w/a.txt', 'linux'));
    expect(pathLockId('host', 'GitHub.com', 'linux')).toBe('host:github.com');
  });

  it('상대경로·모르는 종류는 받지 않는다 — 기준 없는 자물쇠는 나중에 다른 곳을 잠근다', () => {
    expect(normalizePathLockTarget({ kind: 'file', target: 'src/a.ts' })).toBeNull();
    expect(normalizePathLockTarget({ kind: 'drive', target: 'C:/' })).toBeNull();
    expect(normalizePathLockTarget({ kind: 'host', target: 'https://www.Example.com/path' }))
      .toEqual({ kind: 'host', target: 'example.com' });
    expect(normalizePathLockTarget({ kind: 'folder', target: 'C:\\a\\b\\..\\c\\', label: '  c  ' }))
      .toEqual({ kind: 'folder', target: 'C:/a/c', label: 'c' });
  });

  it('저장분 복원 — 못 쓰는 항목은 버리고 같은 대상은 하나로 접는다', () => {
    const restored = normalizePathLocks([
      { kind: 'file', target: 'C:/p/a.txt', lockedAt: 5, id: 'stale' },
      { kind: 'file', target: 'c:/P/A.txt', lockedAt: 9 },
      { kind: 'file', target: 'relative.txt' },
      'garbage',
    ], 'win32');
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe(pathLockId('file', 'C:/p/a.txt', 'win32'));
    expect(restored[0]!.lockedAt).toBe(5);
  });

  it('합집합은 앞 목록을 우선하고 빠진 것만 보탠다', () => {
    const a = lock('file', 'C:/p/a.txt');
    const b = lock('folder', 'C:/p/d');
    expect(mergePathLocks([a], [a, b]).map((l) => l.id)).toEqual([a.id, b.id]);
    expect(mergePathLocks(undefined, [b])).toEqual([b]);
  });
});

describe('findPathLockCover — 버블에 자물쇠 글리프를 그릴지', () => {
  it('자기 자신이 먼저, 없으면 가장 가까운 상위 폴더', () => {
    const locks = { proj: [lock('folder', 'C:/p'), lock('folder', 'C:/p/inner')], other: [lock('file', 'C:/p/inner/x.txt')] };
    expect(findPathLockCover({ kind: 'file', target: 'C:/p/inner/x.txt' }, locks, 'win32'))
      .toMatchObject({ relation: 'self', projectName: 'other' });
    const inherited = findPathLockCover({ kind: 'file', target: 'C:/P/Inner/y.txt' }, locks, 'win32');
    expect(inherited).toMatchObject({ relation: 'inherited' });
    expect(inherited!.lock.target).toBe('C:/p/inner');
    expect(findPathLockCover({ kind: 'file', target: 'C:/q/y.txt' }, locks, 'win32')).toBeNull();
  });

  it('linux 는 대소문자가 다르면 다른 폴더다', () => {
    const locks = { proj: [lock('folder', '/w/Secret', 'linux')] };
    expect(findPathLockCover({ kind: 'file', target: '/w/Secret/a' }, locks, 'linux')).not.toBeNull();
    expect(findPathLockCover({ kind: 'file', target: '/w/secret/a' }, locks, 'linux')).toBeNull();
  });

  it('호스트는 하위 도메인까지 덮는다', () => {
    const locks = { proj: [lock('host', 'example.com')] };
    expect(findPathLockCover({ kind: 'host', target: 'api.example.com' }, locks, 'linux')).toMatchObject({ relation: 'inherited' });
    expect(findPathLockCover({ kind: 'host', target: 'notexample.com' }, locks, 'linux')).toBeNull();
  });
});

describe('resolveLockPath — 호출 안의 낱말을 절대경로로', () => {
  it('상대경로는 cwd 에, msys 경로는 드라이브로, ~ 는 홈으로', () => {
    expect(resolveLockPath('src/../secret.env', 'C:/work/proj', 'win32')).toBe('C:/work/proj/secret.env');
    expect(resolveLockPath('/c/work/proj/a', null, 'win32')).toBe('c:/work/proj/a');
    expect(resolveLockPath('/c/work/proj/a', null, 'linux')).toBe('/c/work/proj/a');
    expect(resolveLockPath('~/.ssh/id_rsa', null, 'linux', '/home/me')).toBe('/home/me/.ssh/id_rsa'); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    expect(resolveLockPath('~/.ssh/id_rsa', null, 'linux')).toBeNull();
    expect(resolveLockPath('a.txt', null, 'linux')).toBeNull();
  });
});

describe('findToolLockHits — 파일 도구', () => {
  it('자물쇠가 없으면 바로 빈 목록', () => {
    expect(findToolLockHits('Read', { file_path: 'C:/x' }, { locks: {}, platform: 'win32' })).toEqual([]);
  });

  it('Read 는 잠긴 파일·잠긴 폴더 안을 센다(상대경로는 cwd 기준)', () => {
    const hits = findToolLockHits('Read', { file_path: 'secret.env' }, win());
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ access: 'read', kind: 'file', projectName: 'proj' });
    expect(hitTargets(findToolLockHits('Read', { file_path: 'C:\\Work\\Proj\\private\\notes.md' }, win())))
      .toEqual([`${WIN_ROOT}/private`]);
    expect(findToolLockHits('Read', { file_path: 'src/app.ts' }, win())).toEqual([]);
  });

  it('linux 는 대소문자가 다르면 다른 파일이다', () => {
    const locks = { proj: [lock('file', '/w/Secret.env', 'linux')] };
    const scope = { locks, cwd: '/w', platform: 'linux' as const };
    expect(findToolLockHits('Read', { file_path: 'Secret.env' }, scope)).toHaveLength(1);
    expect(findToolLockHits('Read', { file_path: 'secret.env' }, scope)).toEqual([]);
  });

  it('mac 은 대소문자만 다른 경로도 같은 파일이다 — 그리고 msys 변환은 win32 에서만', () => {
    const locks = { proj: [lock('file', '/Users/me/Secret.env', 'darwin')] }; // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    const scope = { locks, cwd: '/Users/me', platform: 'darwin' as const, homeDir: '/Users/me' };
    expect(findToolLockHits('Read', { file_path: 'secret.env' }, scope)).toHaveLength(1);
    expect(findToolLockHits('Bash', { command: 'cat ~/SECRET.ENV' }, scope)).toHaveLength(1);
    // `/c/...` 는 mac 에서 그대로 POSIX 경로다(드라이브로 바꾸지 않는다).
    expect(findToolLockHits('Read', { file_path: '/c/Users/me/Secret.env' }, scope)).toEqual([]); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
  });

  it('쓰기 도구는 write — 잠긴 폴더 안에 새 파일을 만드는 것도 센다', () => {
    const hits = findToolLockHits('Write', { file_path: 'private/new.md', content: 'x' }, win());
    expect(hits[0]).toMatchObject({ access: 'write' });
    expect(findToolLockHits('NotebookEdit', { notebook_path: 'C:/work/proj/private/a.ipynb' }, win())).toHaveLength(1);
  });

  it('Grep 은 범위가 자물쇠를 덮어도 센다 — 경로가 없으면 cwd 가 범위다', () => {
    expect(hitTargets(findToolLockHits('Grep', { pattern: 'TODO' }, win()))).toHaveLength(3);
    expect(findToolLockHits('Grep', { pattern: 'TODO', path: 'src' }, win())).toEqual([]);
    expect(findToolLockHits('Grep', { pattern: 'x', path: 'private/sub' }, win())[0]).toMatchObject({ access: 'search' });
  });

  it('Glob·LS 는 잠긴 곳 안을 가리킬 때만 — 상위를 훑는 것은 이름뿐이다', () => {
    expect(findToolLockHits('Glob', { pattern: '**/*.ts' }, win())).toEqual([]);
    expect(findToolLockHits('Glob', { pattern: 'private/**' }, win())[0]).toMatchObject({ access: 'list' });
    expect(findToolLockHits('Glob', { pattern: '*.md', path: 'C:/work/proj/private' }, win())).toHaveLength(1);
    expect(findToolLockHits('LS', { path: 'C:/work/proj' }, win())).toEqual([]);
    expect(findToolLockHits('LS', { path: 'C:/work/proj/private' }, win())).toHaveLength(1);
  });

  it('모르는 도구의 경로 칸도 본다(MCP)', () => {
    expect(findToolLockHits('mcp__fs__read_file', { path: 'C:/work/proj/secret.env' }, win())).toHaveLength(1);
  });

  it('apply_patch 는 머리줄 경로 — 본문 줄은 보지 않는다', () => {
    const patch = '*** Begin Patch\n*** Update File: private/a.md\n+cat secret.env\n*** End Patch';
    const hits = findToolLockHits('apply_patch', { command: patch }, win());
    expect(hitTargets(hits)).toEqual([`${WIN_ROOT}/private`]);
    expect(hits[0]).toMatchObject({ access: 'write' });
  });
});

describe('findToolLockHits — 셸 명령', () => {
  const bash = (command: string, scope = win()) => findToolLockHits('Bash', { command }, scope);

  it('낱말이 잠긴 곳을 가리키면 센다 — 상대·절대·백슬래시·msys', () => {
    expect(bash('cat secret.env')).toHaveLength(1);
    expect(bash('sed -n 1,20p C:\\work\\proj\\private\\a.md')).toHaveLength(1);
    expect(bash('head /c/work/proj/secret.env')).toHaveLength(1);
    expect(bash('cat src/app.ts')).toEqual([]);
  });

  it('cd 를 따라간다', () => {
    expect(bash('cd private && cat notes.md')).toHaveLength(1);
    expect(bash('cd src && cat ../secret.env')).toHaveLength(1);
  });

  it('글롭은 펼쳐져 자물쇠에 닿을 때만', () => {
    expect(bash('cat *.env')).toHaveLength(1);
    expect(bash('ls *.ts')).toEqual([]);
    expect(bash('cat private/*')).toHaveLength(1);
  });

  it('폴더째 지우고·옮기는 명령은 상위 폴더도 센다', () => {
    expect(hitTargets(bash('rm -rf build'))).toEqual([`${WIN_ROOT}/build/keep`]);
    expect(hitTargets(bash('rm -rf build/*'))).toEqual([`${WIN_ROOT}/build/keep`]);
    expect(hitTargets(bash('cp -r build backup'))).toEqual([`${WIN_ROOT}/build/keep`]);
    // 목적지가 상위 폴더인 것은 그 안에 새 이름이 생길 뿐이다.
    expect(bash('cp notes.txt build/')).toEqual([]);
    expect(bash('ls build')).toEqual([]);
  });

  it('트리 내용을 읽는 검색 — 경로가 없으면 cwd', () => {
    expect(bash('grep -rn TODO .')).toHaveLength(3);
    expect(bash('rg TODO')).toHaveLength(3);
    expect(bash('rg TODO src')).toEqual([]);
    expect(bash('grep TODO src/app.ts')).toEqual([]);
    expect(bash('find . -name "*.md"')).toEqual([]);
    expect(bash('find . -name "*.md" -exec cat {} +')).toHaveLength(3);
  });

  it('인라인 스크립트·환경변수 값 안의 경로도 본다', () => {
    expect(bash(`node -e "require('fs').readFileSync('secret.env','utf8')"`)).toHaveLength(1);
    expect(bash('CONFIG=secret.env node app.js')).toHaveLength(1);
    expect(bash('cat src/a.ts > private/out.txt')).toHaveLength(1);
  });

  it('URL 의 // 를 경로로 오독하지 않는다', () => {
    expect(bash('curl https://example.com/secret.env')).toEqual([]);
  });

  it('~ 는 홈으로 편다', () => {
    const locks = { proj: [lock('folder', '/home/me/.ssh', 'linux')] }; // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    const scope = { locks, cwd: '/w', platform: 'linux' as const, homeDir: '/home/me' };
    expect(findToolLockHits('Bash', { command: 'cat ~/.ssh/id_rsa' }, scope)).toHaveLength(1);
  });

  it('Windows 스위치(/s /q)는 경로가 아니다', () => {
    expect(bash('del /s /q tmp')).toEqual([]);
    expect(bash('del /s /q build')).toHaveLength(1);
  });

  it('같은 자물쇠는 한 번만 말한다', () => {
    expect(bash('cat secret.env && cat ./secret.env')).toHaveLength(1);
  });
});

describe('findToolLockHits — 호스트', () => {
  const locks = { proj: [lock('host', 'example.com'), lock('host', 'localhost:5173')] };
  const scope = { locks, cwd: WIN_ROOT, platform: 'win32' as const };

  it('WebFetch 의 url — 같은 호스트와 하위 도메인', () => {
    expect(findToolLockHits('WebFetch', { url: 'https://api.example.com/v1' }, scope)[0]).toMatchObject({ access: 'network' });
    expect(findToolLockHits('WebFetch', { url: 'https://www.example.com/' }, scope)).toHaveLength(1);
    expect(findToolLockHits('WebFetch', { url: 'https://example.org/' }, scope)).toEqual([]);
  });

  it('포트가 붙은 자물쇠는 그 서버 하나만', () => {
    expect(findToolLockHits('WebFetch', { url: 'http://localhost:5173/x' }, scope)).toHaveLength(1);
    expect(findToolLockHits('WebFetch', { url: 'http://localhost:3000/x' }, scope)).toEqual([]);
  });

  it('셸 명령 안의 주소', () => {
    expect(findToolLockHits('Bash', { command: 'curl -s https://example.com/a | jq .' }, scope)).toHaveLength(1);
  });
});

describe('다른 탭이 건 자물쇠', () => {
  it('접촉은 그 자물쇠를 건 프로젝트 이름을 싣는다', () => {
    const locks = { a: [lock('file', 'C:/shared/key.pem')], b: [] };
    const hits = findToolLockHits('Read', { file_path: 'C:/shared/key.pem' }, { locks, platform: 'win32' });
    expect(hits[0]).toMatchObject({ projectName: 'a' });
  });
});
