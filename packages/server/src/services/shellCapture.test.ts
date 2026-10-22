/**
 * §5.1 #1-1 — **셸로 내린 명령은 어느 문으로 들어와도 같은 길로 잡는다** 추출기 고정 시험(순수 함수).
 *
 * 2026-10-22 감사에서 확인한 빈자리를 시험으로 박아 둔다.
 *  (A) 셸 도구는 `Bash`·`PowerShell` 둘이다.
 *  (B) 셸 껍데기(`bash -lc`·`zsh -lc`·`pwsh -Command`·`-EncodedCommand`·`cmd /c`)는 벗겨서 안을 본다 — 코덱스는 셸 명령을
 *      늘 이 모양으로 낸다(저장된 91건이 전부 이 꼴이었고 경로 0건이었다). 아래 Windows 꼴은 그 저장본의 모양 그대로다.
 *  (E) 추출기가 놓치던 꼴 — 쓰기와 읽기.
 *
 * **플랫폼은 인자로 넘긴다** — 개발기 한 대에서 Windows·macOS·Linux 를 전부 재기 위함이다(멀티플랫폼 규칙).
 */
import { describe, it, expect } from 'vitest';
import {
  extractBashWritePaths,
  extractBashWriteTargets,
  extractBashScanAnchors,
  isShellToolName,
  shellDialectOfTool,
  readShellInvocation,
  tokenizeShellCommand,
} from '@vibisual/shared';
import { extractBashReadPaths, extractBashReadTargets } from './bashReadPaths.js';

const linux = { platform: 'linux' as const };
const darwin = { platform: 'darwin' as const };
const win = { platform: 'win32' as const };
const posixRead = { windowsDrivePaths: false };

/** 실제 코덱스(Windows) 기록의 껍데기 — `sub-streams` 의 tool_use 글자 그대로(홈 폴더 이름만 가상 값으로 바꿨다). */
const PWSH = String.raw`"C:\Users\dev\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe" -Command`; // privacy-ok — 실제 홈이 아니라 테스트 픽스처
const PS51 = String.raw`"C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -Command`;

/** PowerShell `-EncodedCommand` 값(base64 UTF-16LE). */
function encodePs(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

describe('(A) 셸 도구 판정', () => {
  it('Bash·PowerShell 이 셸 도구다 — 나머지는 아니다', () => {
    expect(isShellToolName('Bash')).toBe(true);
    expect(isShellToolName('PowerShell')).toBe(true);
    expect(isShellToolName('Read')).toBe(false);
    expect(isShellToolName(undefined)).toBe(false);
  });

  it('PowerShell 도구의 명령은 PowerShell 말씨로 자른다', () => {
    expect(shellDialectOfTool('PowerShell')).toBe('powershell');
    expect(shellDialectOfTool('Bash')).toBe('posix');
  });
});

describe('(B) 셸 껍데기를 벗겨 안을 본다', () => {
  it('코덱스 Windows 꼴(pwsh.exe -Command \'…\') — 안의 읽기가 잡힌다', () => {
    const cmd = `${PWSH} 'Get-Content .agents/skills/x/SKILL.md; Get-Content docs/SSOT.md'`;
    expect(extractBashReadPaths(cmd, 4, posixRead)).toEqual(['.agents/skills/x/SKILL.md', 'docs/SSOT.md']);
  });

  it('코덱스 Windows 꼴 — 안의 쓰기(Set-Content·리다이렉트)도 잡힌다', () => {
    expect(extractBashWritePaths(`${PS51} "Set-Content a.txt x"`, 4, win)).toEqual(['a.txt']);
    expect(extractBashWritePaths(`${PS51} "echo hi > out.txt"`, 4, win)).toEqual(['out.txt']);
  });

  it('코덱스 리눅스(bash -lc)·맥(zsh -lc) 꼴', () => {
    expect(extractBashReadPaths(`bash -lc 'cat README.md && sed -n 1,40p src/a.ts'`, 4, posixRead))
      .toEqual(['README.md', 'src/a.ts']);
    expect(extractBashReadTargets(`/bin/zsh -lc "rg -n foo src/a.ts"`, 4, posixRead))
      .toEqual([{ path: 'src/a.ts', search: true }]);
    expect(extractBashWritePaths(`bash -lc 'echo hi > out.txt'`, 4, linux)).toEqual(['out.txt']);
  });

  it('cmd /c · -EncodedCommand · 겹친 껍데기', () => {
    expect(extractBashReadPaths('cmd /c type README.md', 4, posixRead)).toEqual(['README.md']);
    expect(extractBashReadPaths(`powershell -NoProfile -EncodedCommand ${encodePs('Get-Content a.txt')}`, 4, posixRead))
      .toEqual(['a.txt']);
    expect(extractBashReadPaths(`bash -lc "pwsh -Command 'Get-Content a.txt'"`, 4, posixRead)).toEqual(['a.txt']);
  });

  it('스크립트 파일을 돌리는 꼴은 안을 볼 수 없다 — 넘겨짚지 않는다', () => {
    expect(readShellInvocation(tokenizeShellCommand('bash build.sh'))).toBeNull();
    expect(readShellInvocation(tokenizeShellCommand('pwsh -File x.ps1'))).toBeNull();
    expect(extractBashWritePaths('bash build.sh', 4, linux)).toEqual([]);
  });

  it('바깥의 cd·pwsh -WorkingDirectory 가 안쪽의 기준 폴더가 된다', () => {
    expect(extractBashReadPaths(`cd sub && bash -lc 'cat a.txt'`, 4, posixRead)).toEqual(['sub/a.txt']);
    expect(extractBashReadPaths(`pwsh -WorkingDirectory sub -Command "Get-Content a.txt"`, 4, posixRead)).toEqual(['sub/a.txt']);
  });

  it('바깥 리다이렉트는 바깥 것이다 — 껍데기 실행 파일 경로는 훑기 자리가 아니다', () => {
    expect(extractBashWritePaths(`bash -c "echo hi" > outer.txt`, 4, linux)).toEqual(['outer.txt']);
    const anchors = extractBashScanAnchors(`${PWSH} "blender -b scene.blend -o renders/frame_####"`, 8, win);
    expect(anchors).toEqual(['scene.blend', 'renders/frame_####']);
  });
});

describe('(E) 쓰기 — 놓치던 꼴', () => {
  it('붙여 쓴 `>` · `&>` · PowerShell `*>`', () => {
    expect(extractBashWritePaths('echo hi>out.txt', 4, linux)).toEqual(['out.txt']);
    expect(extractBashWritePaths('make &> all.log', 4, linux)).toEqual(['all.log']);
    expect(extractBashWritePaths('make &>all.log', 4, linux)).toEqual(['all.log']);
    expect(extractBashWritePaths('Get-Process *> all.log', 4, { ...win, dialect: 'powershell' })).toEqual(['all.log']);
    expect(extractBashWritePaths('make 2>&1 | tee build.log', 4, linux)).toEqual(['build.log']);
  });

  it('sed 제자리 수정 — GNU 묶음(-Ei·-ni·-iE)과 BSD(macOS) 접미사(-i \'\'·-i .bak)', () => {
    expect(extractBashWritePaths(`sed -Ei 's/a/b/' src/a.ts`, 4, linux)).toEqual(['src/a.ts']);
    expect(extractBashWritePaths(`sed -ni 's/a/b/p' f.txt`, 4, linux)).toEqual(['f.txt']);
    expect(extractBashWritePaths(`sed -iE 's/a/b/' f.txt`, 4, linux)).toEqual(['f.txt']);
    expect(extractBashWritePaths(`sed -i '' 's/a/b/' f.txt`, 4, darwin)).toEqual(['f.txt']);
    expect(extractBashWritePaths(`sed -i .bak 's/a/b/' f.txt`, 4, darwin)).toEqual(['f.txt']);
    expect(extractBashWritePaths(`sed -i 's/a/b/' f.txt`, 4, linux)).toEqual(['f.txt']);
    expect(extractBashWritePaths(`sed -n 's/a/b/p' f.txt`, 4, linux)).toEqual([]);
  });

  it('perl 제자리 수정 — -pi 묶음 · -i.bak · 값을 먹는 옵션 뒤의 i 는 아니다', () => {
    expect(extractBashWritePaths(`perl -pi -e 's/a/b/' f.txt`, 4, linux)).toEqual(['f.txt']);
    expect(extractBashWritePaths(`perl -i.bak -pe 's/a/b/' f.txt`, 4, linux)).toEqual(['f.txt']);
    expect(extractBashWritePaths(`perl -ne 'print' f.txt`, 4, linux)).toEqual([]);
    expect(extractBashWritePaths(`perl -Mstrict -e 'print 1' f.txt`, 4, linux)).toEqual([]);
  });

  it('cp/mv 폴더 목적지 — 끝 구분자·원본 여럿·-t 는 그 안의 이름, 원본 하나는 판정을 미룬다', () => {
    expect(extractBashWritePaths('mv a.ts dir/', 4, linux)).toEqual(['dir/a.ts']);
    expect(extractBashWritePaths('cp a.ts b.ts out', 4, linux)).toEqual(['out/a.ts', 'out/b.ts']);
    expect(extractBashWritePaths('cp -t out a.ts b.ts', 4, linux)).toEqual(['out/a.ts', 'out/b.ts']);
    expect(extractBashWritePaths('mv -T a b', 4, linux)).toEqual(['b']);
    expect(extractBashWritePaths('install -d out', 4, linux)).toEqual([]);
    expect(extractBashWriteTargets('cp a.ts b.ts', 4, linux)).toEqual([{ path: 'b.ts', intoName: 'a.ts' }]);
  });

  it('PowerShell 쓰기 cmdlet — 이름 있는 칸·자리 인자·쉼표 여럿·폴더 제외', () => {
    const ps = { ...win, dialect: 'powershell' as const };
    expect(extractBashWritePaths('Set-Content -Path a.txt -Value x', 4, ps)).toEqual(['a.txt']);
    expect(extractBashWritePaths('Set-Content a.txt,b.txt x', 4, ps)).toEqual(['a.txt', 'b.txt']);
    expect(extractBashWritePaths(`Set-Content -LiteralPath 'my file.txt' -Value x`, 4, ps)).toEqual(['my file.txt']);
    expect(extractBashWritePaths('ac log.txt line', 4, ps)).toEqual(['log.txt']);
    expect(extractBashWritePaths('Get-Process | Out-File -FilePath procs.txt', 4, ps)).toEqual(['procs.txt']);
    expect(extractBashWritePaths('Get-Process | Tee-Object -FilePath t.txt', 4, ps)).toEqual(['t.txt']);
    expect(extractBashWritePaths('New-Item -ItemType File -Path n.txt', 4, ps)).toEqual(['n.txt']);
    expect(extractBashWritePaths('New-Item -ItemType Directory -Path d', 4, ps)).toEqual([]);
    expect(extractBashWritePaths('ni -Path dir -Name f.txt', 4, ps)).toEqual(['dir/f.txt']);
    expect(extractBashWritePaths('Copy-Item -Path a.txt -Destination out/', 4, ps)).toEqual(['out/a.txt']);
    expect(extractBashWritePaths('Move-Item a.txt,b.txt out', 4, ps)).toEqual(['out/a.txt', 'out/b.txt']);
    expect(extractBashWriteTargets('Copy-Item a.txt b.txt', 4, ps)).toEqual([{ path: 'b.txt', intoName: 'a.txt' }]);
    expect(extractBashWritePaths('Invoke-WebRequest https://x.example/a.zip -OutFile a.zip', 4, ps)).toEqual(['a.zip']);
  });

  it('내려받기 — curl -o·-sSLo·--output= / wget -O·--output-document= (표준 출력은 아니다)', () => {
    expect(extractBashWritePaths('curl -o out.zip https://x.example/a.zip', 4, linux)).toEqual(['out.zip']);
    expect(extractBashWritePaths('curl -sSLo out2.zip https://x.example/a.zip', 4, linux)).toEqual(['out2.zip']);
    expect(extractBashWritePaths('curl --output=o3.zip https://x.example/a.zip', 4, linux)).toEqual(['o3.zip']);
    expect(extractBashWritePaths('curl -O https://x.example/a.zip', 4, linux)).toEqual([]);
    expect(extractBashWritePaths('wget -O w.zip https://x.example/a.zip', 4, linux)).toEqual(['w.zip']);
    expect(extractBashWritePaths('wget -qO- https://x.example/a.zip', 4, linux)).toEqual([]);
    expect(extractBashWritePaths('wget --output-document=w2.zip https://x.example/a.zip', 4, linux)).toEqual(['w2.zip']);
  });

  it('git — checkout -- 경로·restore 경로는 쓰기, 가지 전환·색인만은 아니다', () => {
    expect(extractBashWritePaths('git checkout -- src/a.ts src/b.ts', 4, linux)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(extractBashWritePaths('git checkout main', 4, linux)).toEqual([]);
    expect(extractBashWritePaths('git restore src/a.ts', 4, linux)).toEqual(['src/a.ts']);
    expect(extractBashWritePaths('git restore --staged src/a.ts', 4, linux)).toEqual([]);
    expect(extractBashWritePaths('git restore --staged --worktree src/a.ts', 4, linux)).toEqual(['src/a.ts']);
    expect(extractBashWritePaths('git -C sub restore a.ts', 4, linux)).toEqual(['sub/a.ts']);
  });

  it('단독 & 는 명령을 가른다 · # 뒤는 주석이다', () => {
    expect(extractBashWritePaths('node server.js & touch ready.flag', 4, linux)).toEqual(['ready.flag']);
    expect(extractBashWritePaths('echo hi > a.txt # > b.txt', 4, linux)).toEqual(['a.txt']);
  });

  it('줄 잇기(POSIX \\ · PowerShell 백틱 · cmd ^)와 이스케이프한 공백(macOS·Linux)', () => {
    expect(extractBashWritePaths('cp a.ts \\\n  dist/', 4, linux)).toEqual(['dist/a.ts']);
    expect(extractBashWritePaths('Set-Content `\n  -Path a.txt -Value x', 4, { ...win, dialect: 'powershell' })).toEqual(['a.txt']);
    expect(extractBashWritePaths('copy a.txt ^\r\nb.txt', 4, { ...win, dialect: 'cmd' })).toEqual(['b.txt']);
    expect(extractBashWritePaths('echo hi > Application\\ Support/x.txt', 4, darwin)).toEqual(['Application Support/x.txt']);
  });

  it('cd 는 이어 붙는다 · Set-Location 도 cd 다', () => {
    expect(extractBashWritePaths('cd a && cd b && touch c.txt', 4, linux)).toEqual(['a/b/c.txt']);
    expect(extractBashWritePaths('cd a/ && cd ../b && touch c.txt', 4, linux)).toEqual(['b/c.txt']);
    expect(extractBashWritePaths('Set-Location sub; New-Item -ItemType File x.txt', 4, { ...win, dialect: 'powershell' }))
      .toEqual(['sub/x.txt']);
  });
});

describe('(E) 읽기 — 놓치던 꼴', () => {
  it('grep -i(대소문자 무시)·-o(일치 부분만)는 읽기다 — sed -Ei 는 바꾸는 낌새다', () => {
    expect(extractBashReadPaths('grep -i foo src/a.ts', 4, posixRead)).toEqual(['src/a.ts']);
    expect(extractBashReadPaths('grep -o foo src/a.ts', 4, posixRead)).toEqual(['src/a.ts']);
    expect(extractBashReadPaths(`sed -Ei 's/a/b/' src/a.ts`, 4, posixRead)).toEqual([]);
    expect(extractBashReadPaths('less -o log.txt a.txt', 4, posixRead)).toEqual([]);
  });

  it('널 장치로 버리는 리다이렉트는 무해하다(띄어 써도 · PowerShell $null)', () => {
    expect(extractBashReadPaths('cat a.txt > /dev/null', 4, posixRead)).toEqual(['a.txt']);
    expect(extractBashReadPaths('cat a.txt 2> /dev/null', 4, posixRead)).toEqual(['a.txt']);
    expect(extractBashReadPaths('Get-Content a.txt > $null', 4, { ...posixRead, dialect: 'powershell' })).toEqual(['a.txt']);
  });

  it('단독 & 뒤의 읽기 · # 주석 · 환경변수 대입 뒤의 명령', () => {
    expect(extractBashReadPaths('npm run dev & cat log.txt', 4, posixRead)).toEqual(['log.txt']);
    expect(extractBashReadPaths('cat a.txt # b.txt', 4, posixRead)).toEqual(['a.txt']);
    expect(extractBashReadPaths('LANG=C cat a.txt', 4, posixRead)).toEqual(['a.txt']);
  });

  it('Select-String — -Path·자리 인자·쉼표 여럿, 검색 범위로 표시', () => {
    const ps = { ...posixRead, dialect: 'powershell' as const };
    expect(extractBashReadTargets('Select-String -Path a.txt -Pattern foo', 4, ps)).toEqual([{ path: 'a.txt', search: true }]);
    expect(extractBashReadPaths('Select-String foo a.txt', 4, ps)).toEqual(['a.txt']);
    expect(extractBashReadPaths('sls -Pattern foo -Path a.txt,b.txt', 4, ps)).toEqual(['a.txt', 'b.txt']);
  });

  it('grep/rg 의 경로는 검색 범위다(폴더면 그래프가 Grep 도구 길로 보낸다) — cat 은 아니다', () => {
    expect(extractBashReadTargets('rg -n foo src', 4, posixRead)).toEqual([{ path: 'src', search: true }]);
    expect(extractBashReadTargets('cat a.txt', 4, posixRead)).toEqual([{ path: 'a.txt', search: false }]);
  });
});

describe('세 OS — 같은 명령은 같은 구조로 읽힌다(다른 것은 경로 대소문자와 git bash 드라이브 변환뿐)', () => {
  const platforms = [win, darwin, linux] as const;

  it('껍데기·쓰기 꼴은 OS 와 무관하게 같은 답', () => {
    for (const p of platforms) {
      expect(extractBashWritePaths(`bash -lc 'echo hi > out.txt'`, 4, p)).toEqual(['out.txt']);
      expect(extractBashWritePaths(`${PS51} "Set-Content a.txt x"`, 4, p)).toEqual(['a.txt']);
      expect(extractBashWritePaths(`sed -i '' 's/a/b/' f.txt`, 4, p)).toEqual(['f.txt']);
      expect(extractBashWritePaths('cp a.ts b.ts out', 4, p)).toEqual(['out/a.ts', 'out/b.ts']);
    }
  });

  it('중복 제거 — Windows·macOS 는 대소문자를 접고 Linux 는 접지 않는다', () => {
    const cmd = 'touch B.ts && touch b.ts';
    expect(extractBashWritePaths(cmd, 4, win)).toEqual(['B.ts']);
    expect(extractBashWritePaths(cmd, 4, darwin)).toEqual(['B.ts']);
    expect(extractBashWritePaths(cmd, 4, linux)).toEqual(['B.ts', 'b.ts']);
  });

  it('git bash 의 /c/... 는 Windows 에서만 드라이브 경로로 바꾼다', () => {
    expect(extractBashWritePaths('echo x > /c/work/a.txt', 4, win)).toEqual(['c:/work/a.txt']);
    expect(extractBashWritePaths('echo x > /c/work/a.txt', 4, darwin)).toEqual(['/c/work/a.txt']);
    expect(extractBashWritePaths('echo x > /c/work/a.txt', 4, linux)).toEqual(['/c/work/a.txt']);
  });
});
