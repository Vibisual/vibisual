import { describe, it, expect } from 'vitest';
import { parseStreamPathCandidate } from './streamPathLinks.js';

/**
 * §5.5 #17-27 ⑬ — 본문 속 경로 손잡이의 1차 체.
 *
 * 여기서 잡고 싶은 사고는 셋이다 — ⓐ 진짜 위치(`assets/test/gpt-image/`)를 놓쳐 손잡이가 안 생기는 것,
 * ⓑ 명령·코드 조각(`pnpm build` · `foo()`)까지 후보로 올려 본문이 가짜 링크로 뒤덮이는 것,
 * ⓒ (d) 개정 후 **루트 안과 밖이 섞이는 것** — 밖이 `inside` 로 잘못 읽히면 그 경로가 편집창·실행으로
 * 가 버린다(열려서는 안 되는 갈래다).
 */

const ROOT = 'C:/repo';

describe('parseStreamPathCandidate — 루트 안(inside)', () => {
  it('상대 경로를 그대로 후보로 올린다', () => {
    expect(parseStreamPathCandidate('packages/client/src/App.tsx', ROOT))
      .toEqual({ scope: 'inside', relPath: 'packages/client/src/App.tsx', line: null });
  });

  it('폴더의 끝 슬래시를 떼어 낸다 — 같은 폴더가 두 경로로 갈리지 않게', () => {
    expect(parseStreamPathCandidate('assets/test/gpt-image/', ROOT))
      .toEqual({ scope: 'inside', relPath: 'assets/test/gpt-image', line: null });
  });

  it('확장자가 있으면 폴더 없이 이름만 있어도 후보다', () => {
    expect(parseStreamPathCandidate('README.md', ROOT))
      .toEqual({ scope: 'inside', relPath: 'README.md', line: null });
  });

  it('`경로:줄`·`경로:줄:열` 은 뒤를 떼고 경로만 본다', () => {
    expect(parseStreamPathCandidate('src/App.tsx:42', ROOT))
      .toEqual({ scope: 'inside', relPath: 'src/App.tsx', line: 42 });
    expect(parseStreamPathCandidate('src/App.tsx:42:7', ROOT))
      .toEqual({ scope: 'inside', relPath: 'src/App.tsx', line: 42 });
  });

  it('루트 안 절대 경로는 상대 경로로 되돌린다 (역슬래시·대소문자 차이 흡수)', () => {
    expect(parseStreamPathCandidate('C:\\repo\\docs\\SCENARIO.md', ROOT))
      .toEqual({ scope: 'inside', relPath: 'docs/SCENARIO.md', line: null });
    expect(parseStreamPathCandidate('c:/REPO/docs/SCENARIO.md', ROOT))
      .toEqual({ scope: 'inside', relPath: 'docs/SCENARIO.md', line: null });
  });

  it('`./` 머리는 떼어 낸다', () => {
    expect(parseStreamPathCandidate('./docs/rules', ROOT))
      .toEqual({ scope: 'inside', relPath: 'docs/rules', line: null });
  });

  it('루트 자신은 빈 상대 경로 — 폴더 열기의 정상 대상이다', () => {
    expect(parseStreamPathCandidate('C:/repo', ROOT))
      .toEqual({ scope: 'inside', relPath: '', line: null });
  });
});

/**
 * ⑬ (d) 개정 — 루트 밖 절대 경로도 후보가 된다. 다만 **절대 경로 그대로** 들고 가야 한다:
 * 상대 경로로 접어 버리면 기준이 없어 엉뚱한 곳이 열린다.
 */
describe('parseStreamPathCandidate — 루트 밖(outside)', () => {
  it('다른 드라이브의 절대 경로', () => {
    expect(parseStreamPathCandidate('D:/other/note.md', ROOT))
      .toEqual({ scope: 'outside', absPath: 'D:/other/note.md', line: null });
  });

  it('같은 드라이브라도 루트 밖이면 밖이다', () => {
    expect(parseStreamPathCandidate('C:\\tools\\AppData\\Local\\pip', ROOT))
      .toEqual({ scope: 'outside', absPath: 'C:/tools/AppData/Local/pip', line: null });
  });

  it('POSIX 절대 경로', () => {
    expect(parseStreamPathCandidate('/etc/hosts', ROOT))
      .toEqual({ scope: 'outside', absPath: '/etc/hosts', line: null });
  });

  it('끝 구분자는 안쪽과 같은 규칙으로 떨어낸다', () => {
    expect(parseStreamPathCandidate('D:\\models\\', ROOT))
      .toEqual({ scope: 'outside', absPath: 'D:/models', line: null });
  });

  it('`경로:줄` 규칙도 안쪽과 같다', () => {
    expect(parseStreamPathCandidate('D:/other/note.md:12', ROOT))
      .toEqual({ scope: 'outside', absPath: 'D:/other/note.md', line: 12 });
  });
});

/**
 * 공백은 **절대 경로에서만** 허용한다. `Unreal Projects` 처럼 공백이 든 폴더는 흔하고,
 * `C:\` 로 시작하는 명령은 사실상 없다. 상대 조각의 공백은 거의 언제나 명령이다.
 */
describe('parseStreamPathCandidate — 공백은 절대 경로에서만', () => {
  it('공백이 든 루트 밖 절대 경로', () => {
    expect(parseStreamPathCandidate('C:\\games\\Documents\\Unreal Projects\\Sample Game\\Saved', ROOT))
      .toEqual({ scope: 'outside', absPath: 'C:/games/Documents/Unreal Projects/Sample Game/Saved', line: null });
  });

  it('공백이 든 루트 안 절대 경로도 같은 규칙', () => {
    expect(parseStreamPathCandidate('C:/repo/my docs/a.txt', ROOT))
      .toEqual({ scope: 'inside', relPath: 'my docs/a.txt', line: null });
  });

  it('공백이 든 상대 조각은 종전대로 경로가 아니다 — 명령이 파랗게 칠해지지 않게', () => {
    expect(parseStreamPathCandidate('pnpm build', ROOT)).toBeNull();
    expect(parseStreamPathCandidate('git status', ROOT)).toBeNull();
    expect(parseStreamPathCandidate('docs/rules a.md', ROOT)).toBeNull();
  });

  it('절대 경로라도 탭·줄바꿈은 여전히 경로가 아니다', () => {
    expect(parseStreamPathCandidate('C:/repo\tdocs', ROOT)).toBeNull();
    expect(parseStreamPathCandidate('C:/repo\ndocs', ROOT)).toBeNull();
  });
});

describe('parseStreamPathCandidate — 경로가 아닌 것', () => {
  it('프로젝트 루트를 모르면 아무것도 손잡이가 되지 않는다', () => {
    expect(parseStreamPathCandidate('packages/client/src/App.tsx', null)).toBeNull();
    expect(parseStreamPathCandidate('D:/other/note.md', null)).toBeNull();
  });

  it('코드 문법 문자가 든 조각', () => {
    expect(parseStreamPathCandidate('foo()', ROOT)).toBeNull();
    expect(parseStreamPathCandidate('a=b/c', ROOT)).toBeNull();
    expect(parseStreamPathCandidate('Record<string,number>', ROOT)).toBeNull();
  });

  it('URL · CLI 플래그 · npm 스코프 · 앵커', () => {
    expect(parseStreamPathCandidate('https://example.com/a.txt', ROOT)).toBeNull();
    expect(parseStreamPathCandidate('--effort', ROOT)).toBeNull();
    expect(parseStreamPathCandidate('@vibisual/shared', ROOT)).toBeNull();
    expect(parseStreamPathCandidate('#17-27', ROOT)).toBeNull();
  });

  it('구분자도 확장자도 없는 낱말', () => {
    expect(parseStreamPathCandidate('pnpm', ROOT)).toBeNull();
    expect(parseStreamPathCandidate('StreamRenderer', ROOT)).toBeNull();
  });

  it('판올림 번호는 확장자가 아니다', () => {
    expect(parseStreamPathCandidate('v4.87', ROOT)).toBeNull();
    expect(parseStreamPathCandidate('0.1.8', ROOT)).toBeNull();
  });

  it('드라이브가 아닌 콜론이 남으면 경로가 아니다', () => {
    expect(parseStreamPathCandidate('http:8080/x', ROOT)).toBeNull();
  });

  it('상위로 거슬러 오르는 표기는 밖으로도 넘기지 않는다 — 어느 절대 경로인지 확정할 수 없다', () => {
    expect(parseStreamPathCandidate('../secret/key.pem', ROOT)).toBeNull();
    expect(parseStreamPathCandidate('..', ROOT)).toBeNull();
  });

  it('상한을 넘는 긴 조각', () => {
    expect(parseStreamPathCandidate(`a/${'b'.repeat(300)}.ts`, ROOT)).toBeNull();
  });
});
