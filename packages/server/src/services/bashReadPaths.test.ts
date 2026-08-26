import { describe, it, expect } from 'vitest';
import { extractBashReadPaths, BASH_READ_PATH_LIMIT } from './bashReadPaths.js';

/** 테스트는 플랫폼에 흔들리지 않게 MSYS 변환을 명시로 고정한다. */
const win = { windowsDrivePaths: true };
const posix = { windowsDrivePaths: false };

describe('extractBashReadPaths — 읽는 명령에서 경로를 뽑는다', () => {
  it('sed -n 의 -n 은 값을 먹지 않는다 (스크립트는 파일이 아니다)', () => {
    expect(
      extractBashReadPaths("sed -n '680,730p' Source/Diag/SessionDebugConsoleCommands.cpp", 4, posix),
    ).toEqual(['Source/Diag/SessionDebugConsoleCommands.cpp']);
  });

  it('따옴표 안의 공백 있는 절대 경로를 한 토큰으로 읽는다', () => {
    expect(
      extractBashReadPaths(
        `sed -n '1,140p' "C:/Program Files/Epic Games/UE_5.8/Engine/Classes/GameplayStatics.h"`,
        4,
        win,
      ),
    ).toEqual(['C:/Program Files/Epic Games/UE_5.8/Engine/Classes/GameplayStatics.h']);
  });

  it('선행 cd 가 이후 세그먼트의 상대 경로 기준이 된다', () => {
    expect(
      extractBashReadPaths(
        `cd "C:/work/projects/app" && sed -n '680,730p' Source/Private/Foo.cpp && echo ok`,
        4,
        win,
      ),
    ).toEqual(['C:/work/projects/app/Source/Private/Foo.cpp']);
  });

  it('git bash 의 /c/ 경로를 네이티브 드라이브로 바꾼다', () => {
    expect(extractBashReadPaths('cd /c/work/proj && cat Source/Foo.cpp', 4, win))
      .toEqual(['c:/work/proj/Source/Foo.cpp']);
  });

  it('windowsDrivePaths 를 끄면 /c/ 경로를 그대로 둔다', () => {
    expect(extractBashReadPaths('cat /c/tmp/a.txt', 4, posix)).toEqual(['/c/tmp/a.txt']);
  });

  it('head -n 20 의 20 은 파일이 아니다', () => {
    expect(extractBashReadPaths('head -n 20 a.txt', 4, posix)).toEqual(['a.txt']);
  });

  it('tail -20 처럼 숫자가 붙은 플래그도 파일로 세지 않는다', () => {
    expect(extractBashReadPaths('tail -20 b.log', 4, posix)).toEqual(['b.log']);
  });

  it('rg 는 첫 인자가 패턴이고 나머지가 경로다', () => {
    expect(extractBashReadPaths('rg -n "Anim_Creature" Source/Private', 4, posix))
      .toEqual(['Source/Private']);
  });

  it('-e 로 패턴을 주면 첫 비-플래그 인자부터 경로다', () => {
    expect(extractBashReadPaths('rg -e "foo" src/a.ts', 4, posix)).toEqual(['src/a.ts']);
  });

  it('cat 은 인자 전부가 파일이다', () => {
    expect(extractBashReadPaths('cat a.ts b.ts', 4, posix)).toEqual(['a.ts', 'b.ts']);
  });

  it('wc -l 의 -l 은 값을 먹지 않는다', () => {
    expect(extractBashReadPaths('wc -l docs/SCENARIO.md', 4, posix)).toEqual(['docs/SCENARIO.md']);
  });

  it('무해한 stderr 리다이렉트는 읽기를 막지 않는다', () => {
    expect(extractBashReadPaths('cat a.txt 2>/dev/null', 4, posix)).toEqual(['a.txt']);
  });

  it('파이프 앞 읽기는 살리고 뒤 패턴만 있는 grep 은 경로를 안 만든다', () => {
    expect(extractBashReadPaths('cat a.txt | grep foo', 4, posix)).toEqual(['a.txt']);
  });

  it('같은 파일을 여러 번 읽어도 한 번만 센다', () => {
    expect(extractBashReadPaths('cat a.txt && cat a.txt', 4, posix)).toEqual(['a.txt']);
  });

  it('상한을 넘기면 거기서 끊는다', () => {
    const cmd = 'cat a.ts b.ts c.ts d.ts e.ts f.ts';
    expect(extractBashReadPaths(cmd, BASH_READ_PATH_LIMIT, posix)).toHaveLength(BASH_READ_PATH_LIMIT);
  });
});

describe('extractBashReadPaths — 바꾸는 낌새가 있으면 버린다', () => {
  it('출력 리다이렉트가 있으면 그 세그먼트를 버린다', () => {
    expect(extractBashReadPaths('cat a.txt > b.txt', 4, posix)).toEqual([]);
    expect(extractBashReadPaths('cat a.txt >> b.txt', 4, posix)).toEqual([]);
  });

  it('sed -i 는 읽기가 아니다', () => {
    expect(extractBashReadPaths("sed -i 's/a/b/' file.ts", 4, posix)).toEqual([]);
  });

  it('파일을 바꾸는 명령은 아예 보지 않는다', () => {
    expect(extractBashReadPaths('rm -f Intermediate/Build/x.obj', 4, posix)).toEqual([]);
    expect(extractBashReadPaths('cp a.ts b.ts', 4, posix)).toEqual([]);
    expect(extractBashReadPaths('mv a.ts b.ts', 4, posix)).toEqual([]);
  });

  it('읽기 화이트리스트 밖 명령은 경로를 만들지 않는다', () => {
    expect(extractBashReadPaths('ls -la Intermediate/Build', 4, posix)).toEqual([]);
    expect(extractBashReadPaths('git diff -- Source/Foo.cpp', 4, posix)).toEqual([]);
    expect(extractBashReadPaths('find Intermediate/Build -maxdepth 6', 4, posix)).toEqual([]);
  });

  it('heredoc 을 낀 인터프리터 호출은 통째로 버린다', () => {
    const cmd = `cd "C:/p" && python - <<'PY'\nimport io,re\np='Source/Private/Foo.cpp'\nPY`;
    expect(extractBashReadPaths(cmd, 4, win)).toEqual([]);
  });

  it('powershell 안의 내용은 우리가 판정하지 않는다', () => {
    expect(
      extractBashReadPaths(`powershell -NoProfile -Command "Get-Content x.txt"`, 4, posix),
    ).toEqual([]);
  });
});

describe('extractBashReadPaths — 경로가 아닌 인자를 걸러낸다', () => {
  it('셸 빌트인 type 은 경로처럼 생긴 인자만 채택한다', () => {
    expect(extractBashReadPaths('type node', 4, posix)).toEqual([]);
    expect(extractBashReadPaths('type ./scripts/run.sh', 4, posix)).toEqual(['./scripts/run.sh']);
  });

  it('stdin·널 장치·변수·글롭은 파일이 아니다', () => {
    expect(extractBashReadPaths('cat -', 4, posix)).toEqual([]);
    expect(extractBashReadPaths('cat /dev/null', 4, posix)).toEqual([]);
    expect(extractBashReadPaths('cat $FILE', 4, posix)).toEqual([]);
    expect(extractBashReadPaths('cat src/*.ts', 4, posix)).toEqual([]);
  });

  it('빈 명령·비문자열은 조용히 빈 배열', () => {
    expect(extractBashReadPaths('', 4, posix)).toEqual([]);
    expect(extractBashReadPaths(undefined as unknown as string, 4, posix)).toEqual([]);
  });
});
