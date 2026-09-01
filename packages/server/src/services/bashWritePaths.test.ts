/**
 * §2.1 #3 쓰기 축 — shared `bashCommandPaths.ts` 의 `extractBashWritePaths` 고정 시험.
 *
 * 추출기는 shared 순수 함수지만 shared 패키지에는 러너가 없으므로(읽기 축 `bashReadPaths.test.ts`
 * 와 같은 자리에서 돌린다) 여기서 고정한다. **플랫폼은 인자로 넘긴다** — 개발기 한 대에서 세 OS 를
 * 전부 재기 위함이고, 그것이 이 모듈이 `process.platform` 을 읽지 않는 이유다(멀티플랫폼 1축).
 */
import { describe, it, expect } from 'vitest';
import { extractBashWritePaths, BASH_WRITE_PATH_LIMIT } from '@vibisual/shared';

const posix = { platform: 'linux' as const };
const win = { platform: 'win32' as const };

describe('extractBashWritePaths — 고치는 명령에서 경로를 뽑는다', () => {
  it('리다이렉트 대상 — 붙어 온 모양과 떨어져 온 모양 둘 다', () => {
    expect(extractBashWritePaths('echo hi > out.txt', 4, posix)).toEqual(['out.txt']);
    expect(extractBashWritePaths('echo hi >out.txt', 4, posix)).toEqual(['out.txt']);
    expect(extractBashWritePaths('echo hi >> logs/app.log', 4, posix)).toEqual(['logs/app.log']);
  });

  it('heredoc 으로 파일을 짓는다 — 목적지는 여는 세그먼트에 있다', () => {
    const cmd = "cat > src/a.ts <<'EOF'\nconst x = 1;\nEOF";
    expect(extractBashWritePaths(cmd, 4, posix)).toEqual(['src/a.ts']);
  });

  it('heredoc **본문**은 명령으로 읽지 않는다', () => {
    // 본문 줄이 그대로 파싱되면 남의 글이 우리 판정이 된다.
    const cmd = "cat > note.md <<'EOF'\necho hacked > /etc/passwd\nsed -i 's/a/b/' /etc/hosts\nEOF";
    expect(extractBashWritePaths(cmd, 4, posix)).toEqual(['note.md']);
  });

  it('heredoc 이 끝난 뒤의 명령은 다시 본다', () => {
    const cmd = "cat > a.txt <<'EOF'\nbody\nEOF\necho done > b.txt";
    expect(extractBashWritePaths(cmd, 4, posix)).toEqual(['a.txt', 'b.txt']);
  });

  it('tee — 인자 전부가 대상', () => {
    expect(extractBashWritePaths('echo x | tee a.log b.log', 4, posix)).toEqual(['a.log', 'b.log']);
    expect(extractBashWritePaths('echo x | tee -a a.log', 4, posix)).toEqual(['a.log']);
  });

  it('sed -i — 제자리 수정만 쓰기다', () => {
    expect(extractBashWritePaths("sed -i 's/a/b/' src/a.ts", 4, posix)).toEqual(['src/a.ts']);
    expect(extractBashWritePaths("sed -i.bak 's/a/b/' src/a.ts", 4, posix)).toEqual(['src/a.ts']);
    // `-n` 은 읽기다 — 읽기 축(`extractBashReadPaths`)이 가져간다.
    expect(extractBashWritePaths("sed -n '1,20p' src/a.ts", 4, posix)).toEqual([]);
  });

  it('cp/mv — **목적지**만 센다(원본은 읽기다)', () => {
    expect(extractBashWritePaths('cp src/a.ts src/b.ts', 4, posix)).toEqual(['src/b.ts']);
    expect(extractBashWritePaths('mv old.txt new.txt', 4, posix)).toEqual(['new.txt']);
    // 인자가 하나뿐이면 목적지가 없다.
    expect(extractBashWritePaths('cp a.ts', 4, posix)).toEqual([]);
  });

  it('touch 는 파일을 만든다', () => {
    expect(extractBashWritePaths('touch src/new.ts', 4, posix)).toEqual(['src/new.ts']);
  });

  it('여러 세그먼트를 이어 붙여도 각각 본다', () => {
    expect(extractBashWritePaths('echo a > a.txt && echo b > b.txt', 4, posix))
      .toEqual(['a.txt', 'b.txt']);
  });

  it('선행 cd 는 이후 상대 경로의 기준이 된다', () => {
    expect(extractBashWritePaths('cd /c/work/proj && echo x > Source/Foo.cpp', 4, win))
      .toEqual(['c:/work/proj/Source/Foo.cpp']);
  });

  it('같은 경로는 한 번만', () => {
    expect(extractBashWritePaths('echo a > x.txt && echo b >> x.txt', 4, posix)).toEqual(['x.txt']);
  });

  it('상한을 넘기지 않는다', () => {
    const cmd = Array.from({ length: 10 }, (_, i) => `echo x > f${i}.txt`).join(' && ');
    expect(extractBashWritePaths(cmd, BASH_WRITE_PATH_LIMIT, posix)).toHaveLength(BASH_WRITE_PATH_LIMIT);
  });
});

describe('extractBashWritePaths — 쓰기가 아닌 것은 세지 않는다', () => {
  it('읽기 전용 명령', () => {
    expect(extractBashWritePaths('cat a.txt', 4, posix)).toEqual([]);
    expect(extractBashWritePaths('head -n 20 a.txt', 4, posix)).toEqual([]);
    expect(extractBashWritePaths('rg -n "foo" src/', 4, posix)).toEqual([]);
  });

  it('무해한 리다이렉트 — 널 장치·fd 복제', () => {
    expect(extractBashWritePaths('cat a.txt 2>/dev/null', 4, posix)).toEqual([]);
    expect(extractBashWritePaths('make 2>&1', 4, posix)).toEqual([]);
    expect(extractBashWritePaths('build.sh > /dev/null 2>&1', 4, posix)).toEqual([]);
  });

  it('지우는 명령은 이 축이 아니다 — 사라진 파일은 존재 확인 스윕이 Ghost 로 돌린다', () => {
    expect(extractBashWritePaths('rm -f src/a.ts', 4, posix)).toEqual([]);
    expect(extractBashWritePaths('rm -rf build', 4, posix)).toEqual([]);
  });

  it('폴더를 만드는 것은 이 축이 아니다 — 외부 폴더 invariant 와 부딪힌다', () => {
    expect(extractBashWritePaths('mkdir -p src/new', 4, posix)).toEqual([]);
  });

  it('따옴표 안의 `>` 는 리다이렉트가 아니다', () => {
    expect(extractBashWritePaths('grep -n "a > b" src/a.ts', 4, posix)).toEqual([]);
    expect(extractBashWritePaths(`sed -n 's/>/x/p' src/a.ts`, 4, posix)).toEqual([]);
  });

  it('변수·글롭·널 장치·숫자는 경로가 아니다', () => {
    expect(extractBashWritePaths('echo x > $OUT', 4, posix)).toEqual([]);
    expect(extractBashWritePaths('echo x > *.log', 4, posix)).toEqual([]);
    expect(extractBashWritePaths('echo x > NUL', 4, posix)).toEqual([]);
  });

  it('빈 명령·빈 상한', () => {
    expect(extractBashWritePaths('', 4, posix)).toEqual([]);
    expect(extractBashWritePaths('echo x > a.txt', 0, posix)).toEqual([]);
  });
});

describe('extractBashWritePaths — 플랫폼', () => {
  it('win32 에서만 MSYS 경로를 드라이브 경로로 되돌린다', () => {
    expect(extractBashWritePaths('echo x > /c/tmp/a.txt', 4, win)).toEqual(['c:/tmp/a.txt']);
    expect(extractBashWritePaths('echo x > /c/tmp/a.txt', 4, posix)).toEqual(['/c/tmp/a.txt']);
  });

  it('linux 에서는 대소문자만 다른 두 경로가 서로 다른 파일이다', () => {
    const cmd = 'echo a > src/Foo.ts && echo b > src/foo.ts';
    expect(extractBashWritePaths(cmd, 4, posix)).toEqual(['src/Foo.ts', 'src/foo.ts']);
    // win32/darwin 은 같은 파일이라 한 번만 센다.
    expect(extractBashWritePaths(cmd, 4, win)).toEqual(['src/Foo.ts']);
    expect(extractBashWritePaths(cmd, 4, { platform: 'darwin' as const })).toEqual(['src/Foo.ts']);
  });
});
