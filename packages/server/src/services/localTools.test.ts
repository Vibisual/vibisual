/**
 * §5.19 (H) 로컬 도구 — 프로젝트 밖으로 못 나가고, 엉뚱한 곳을 고치지 않는다.
 *
 * 이 도구들은 **모델이 시키는 대로** 파일을 연다. 그래서 경계가 코드로 서 있어야 한다 —
 * 프롬프트 한 줄로 홈 디렉터리가 열리면 그건 기능이 아니라 사고다.
 *
 * 조건은 넷 —
 *  **루트 밖은 거절할 것**(`..`·절대경로·링크 전부), **유일하지 않은 앵커로 고치지 말 것**
 *  (조용히 첫 번째를 바꾸면 엉뚱한 코드가 사라진다), **실패를 던지지 말 것**(모델이 읽고
 *  고쳐 쓸 수 있게 결과로 준다), **자를 때는 잘랐다고 말할 것**.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runLocalTool, resolveInRoot, globToRegExp, clipToolResult } from './localTools.js';
import { augmentedPath } from './binLocator.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-tools-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'const x = 1;\nconst y = 2;\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'export const twice = 2;\nexport const also = 2;\n', 'utf8');
  fs.writeFileSync(path.join(root, 'readme.md'), '# hello\n', 'utf8');
});

afterEach(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ─────────────────────────────────────────────────────────────
describe('resolveInRoot — 프로젝트 밖은 없다', () => {
  it('루트 안의 상대 경로는 절대경로로 풀린다', () => {
    expect(resolveInRoot(root, 'src/a.ts')).toBe(path.join(fs.realpathSync(root), 'src', 'a.ts'));
  });

  it('`..` 로 기어 나가면 거절한다', () => {
    expect(resolveInRoot(root, '../../etc/passwd')).toBeNull();
    expect(resolveInRoot(root, 'src/../../outside.txt')).toBeNull();
  });

  it('루트 밖 절대경로는 거절한다', () => {
    const outside = process.platform === 'win32' ? 'C:/Windows/system32/drivers/etc/hosts' : '/etc/passwd';
    expect(resolveInRoot(root, outside)).toBeNull();
  });

  it('아직 없는 파일도 부모가 루트 안이면 허용한다 — 새로 쓰는 경우', () => {
    expect(resolveInRoot(root, 'src/new-file.ts')).not.toBeNull();
  });

  /**
   * 루트가 **링크 위에 놓여 있어도** 그 안의 파일은 안이다.
   *
   * mac 의 `/tmp`·`/var` 는 `/private/…` 로 가는 링크다. 대상만 realpath 하고 루트는 안 풀면
   * 루트(`/var/…`)와 대상(`/private/var/…`)이 어긋나 **루트 안의 파일이 전부 거부된다** —
   * 2026-08-28 CI 에서 mac 러너만 이 파일 8건이 죽고 win 은 초록이었다(win 의 tmp 는 링크가
   * 아니라서). 개발기 한 대로는 영영 안 보이는 종류라, 여기서 링크를 직접 만들어 세 OS 에서 잰다.
   * (Windows 는 디렉터리 junction 이라 관리자 권한이 필요 없다.)
   */
  it('루트가 링크 위에 있어도 안쪽 파일을 연다', () => {
    const linkParent = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-link-'));
    const linkRoot = path.join(linkParent, 'root-link');
    fs.symlinkSync(root, linkRoot, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const hit = resolveInRoot(linkRoot, 'src/a.ts');
      expect(hit).not.toBeNull();
      expect(fs.readFileSync(hit as string, 'utf8')).toContain('const x = 1;');
    } finally {
      try { fs.unlinkSync(linkRoot); } catch { /* best effort */ }
      try { fs.rmSync(linkParent, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });

  /**
   * 반대쪽 — 링크가 루트 **밖**을 가리키면 여전히 막는다. 위 완화가 경계를 뚫지 않았는지
   * 같은 자리에서 함께 잰다. 한쪽만 두면 다음 사람이 realpath 를 통째로 걷어낸다.
   */
  it('루트 안의 링크가 밖을 가리키면 거절한다', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-out-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope\n', 'utf8');
    const escape = path.join(root, 'escape');
    fs.symlinkSync(outside, escape, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      expect(resolveInRoot(root, 'escape/secret.txt')).toBeNull();
    } finally {
      try { fs.unlinkSync(escape); } catch { /* best effort */ }
      try { fs.rmSync(outside, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });

  /**
   * 대소문자를 접을지는 **그 OS 파일시스템이 실제로 무시할 때만**. `platform` 을 인자로 받게
   * 만든 이유가 이것이다 — 실기 없이 세 OS 를 여기서 전부 잰다(CLAUDE.md 멀티플랫폼 규칙).
   * 없는 경로를 쓰는 것은 의도적이다: realpath 가 성공하면 Windows 가 디스크의 실제 케이스로
   * 되돌려 놓아 케이스 판정 자체가 사라진다.
   */
  it('대소문자 판정은 플랫폼을 따른다', () => {
    const real = fs.realpathSync(root);
    const ghost = path.join(real, 'no-such-dir', 'ghost.ts').toUpperCase();
    expect(resolveInRoot(real, ghost, 'win32')).not.toBeNull();
    expect(resolveInRoot(real, ghost, 'darwin')).not.toBeNull();
    expect(resolveInRoot(real, ghost, 'linux')).toBeNull();
  });
});

describe('runLocalTool — 경계를 넘으면 결과로 알린다(던지지 않는다)', () => {
  it('밖의 파일을 읽으려 하면 실패 결과가 돌아온다', async () => {
    const r = await runLocalTool('Read', { path: '../../secret.txt' }, root);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('outside the project root');
  });

  it('밖으로 쓰려 해도 마찬가지다 — 그리고 파일은 안 생긴다', async () => {
    const r = await runLocalTool('Write', { path: '../escaped.txt', content: 'x' }, root);
    expect(r.isError).toBe(true);
    expect(fs.existsSync(path.join(root, '..', 'escaped.txt'))).toBe(false);
  });

  it('모르는 도구도 던지지 않고 결과로 말한다', async () => {
    const r = await runLocalTool('DropDatabase', {}, root);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('unknown tool');
  });
});

describe('Read — 줄 번호를 붙여 준다(Edit 앵커의 근거)', () => {
  it('본문에 1-base 줄 번호가 붙는다', async () => {
    const r = await runLocalTool('Read', { path: 'src/a.ts' }, root);
    expect(r.isError).toBe(false);
    expect(r.content.split('\n')[0]).toBe('1\tconst x = 1;');
  });

  it('offset/limit 로 일부만 읽는다', async () => {
    const r = await runLocalTool('Read', { path: 'src/a.ts', offset: 2, limit: 1 }, root);
    expect(r.content).toBe('2\tconst y = 2;');
  });

  it('없는 파일은 실패 결과', async () => {
    const r = await runLocalTool('Read', { path: 'src/nope.ts' }, root);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('file not found');
  });
});

describe('Edit — 엉뚱한 곳을 고치지 않는다', () => {
  it('유일한 앵커면 고친다', async () => {
    const r = await runLocalTool('Edit', { path: 'src/a.ts', old_string: 'const x = 1;', new_string: 'const x = 42;' }, root);
    expect(r.isError).toBe(false);
    expect(fs.readFileSync(path.join(root, 'src', 'a.ts'), 'utf8')).toContain('const x = 42;');
  });

  it('앵커가 여러 번 나오면 **고치지 않고** 몇 번인지 말한다', async () => {
    const r = await runLocalTool('Edit', { path: 'src/b.ts', old_string: '= 2;', new_string: '= 3;' }, root);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('appears 2 times');
    // 파일은 그대로여야 한다 — 여기서 첫 번째만 바꾸면 사용자는 그 사실을 모른다.
    expect(fs.readFileSync(path.join(root, 'src', 'b.ts'), 'utf8')).toContain('twice = 2;');
  });

  it('replace_all 이면 전부 고친다', async () => {
    const r = await runLocalTool('Edit', { path: 'src/b.ts', old_string: '= 2;', new_string: '= 3;', replace_all: true }, root);
    expect(r.isError).toBe(false);
    const after = fs.readFileSync(path.join(root, 'src', 'b.ts'), 'utf8');
    expect(after).not.toContain('= 2;');
  });

  it('앵커가 없으면 파일을 건드리지 않는다', async () => {
    const before = fs.readFileSync(path.join(root, 'src', 'a.ts'), 'utf8');
    const r = await runLocalTool('Edit', { path: 'src/a.ts', old_string: '없는문자열', new_string: 'x' }, root);
    expect(r.isError).toBe(true);
    expect(fs.readFileSync(path.join(root, 'src', 'a.ts'), 'utf8')).toBe(before);
  });
});

describe('Write — 없는 폴더도 만들어 준다', () => {
  it('중첩 경로에 새 파일을 쓴다', async () => {
    const r = await runLocalTool('Write', { path: 'src/deep/nested/new.ts', content: 'export const ok = true;\n' }, root);
    expect(r.isError).toBe(false);
    expect(fs.readFileSync(path.join(root, 'src', 'deep', 'nested', 'new.ts'), 'utf8')).toContain('ok = true');
  });
});

describe('globToRegExp / Glob', () => {
  it('`**/` 는 폴더를 건너뛰고 `*` 는 한 칸 안에서만 움직인다', () => {
    expect(globToRegExp('src/**/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/**/*.ts').test('src/deep/b.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/deep/b.ts')).toBe(false);
    expect(globToRegExp('*.md').test('readme.md')).toBe(true);
  });

  it('Glob 이 프로젝트 파일을 찾는다', async () => {
    const r = await runLocalTool('Glob', { pattern: 'src/**/*.ts' }, root);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('src/a.ts');
    expect(r.content).toContain('src/b.ts');
  });
});

describe('Grep', () => {
  it('본문을 찾아 경로:줄번호로 돌려준다', async () => {
    const r = await runLocalTool('Grep', { pattern: 'twice' }, root);
    expect(r.isError).toBe(false);
    expect(r.content).toMatch(/src\/b\.ts:1:/);
  });

  it('깨진 정규식은 던지지 않고 사유를 준다', async () => {
    const r = await runLocalTool('Grep', { pattern: '([unclosed' }, root);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('invalid regular expression');
  });
});

describe('clipToolResult — 자를 때는 잘랐다고 말한다', () => {
  it('상한 이하는 그대로', () => {
    expect(clipToolResult('short', 100)).toBe('short');
  });

  it('넘으면 자르고 몇 글자를 버렸는지 남긴다', () => {
    const out = clipToolResult('x'.repeat(50), 10);
    expect(out.startsWith('x'.repeat(10))).toBe(true);
    expect(out).toContain('truncated 40 more characters');
  });
});

/**
 * §5.19 (H) Bash 도구가 물려주는 PATH.
 *
 * 종전에는 `spawn('/bin/sh', ['-c', cmd], { cwd })` 처럼 **env 를 아예 안 넘겼다.** 그러면 셸이
 * 우리 프로세스의 PATH 를 그대로 받는데, Finder/Dock 으로 띄운 macOS 앱의 PATH 는
 * `/usr/bin:/bin:/usr/sbin:/sbin` 넉 줄뿐이다 — 모델이 부른 `git`·`node`·`pnpm`(전부 Homebrew
 * 자리)이 죄다 `command not found` 로 돌아오고, 모델은 그걸 "이 프로젝트엔 그 도구가 없다"로
 * 읽어 엉뚱한 우회를 시작한다. 이제 `augmentedEnv()` 를 명시로 넘긴다.
 */
describe('Bash 도구의 PATH 보강', () => {
  it('자식 셸이 보는 PATH 가 보강된 PATH 와 같다', async () => {
    const isWin = process.platform === 'win32';
    const out = await runLocalTool('Bash', { command: isWin ? 'echo %PATH%' : 'echo "$PATH"' }, root);
    expect(out.isError).toBe(false);
    expect(out.content.trim()).toBe(augmentedPath());
  });

  it('알려진 설치 위치가 자식에게 실제로 보인다', async () => {
    const isWin = process.platform === 'win32';
    const out = await runLocalTool('Bash', { command: isWin ? 'echo %PATH%' : 'echo "$PATH"' }, root);
    const expected = process.platform === 'darwin'
      ? '/opt/homebrew/bin'
      : process.platform === 'linux'
        ? '/snap/bin'
        : 'WinGet';
    expect(out.content).toContain(expected);
  });
});
