import { describe, it, expect } from 'vitest';
import { parseStreamPathCandidate } from './streamPathLinks.js';

/**
 * §5.5 #17-27 ⑬ — 본문 속 경로 손잡이의 1차 체.
 *
 * 여기서 잡고 싶은 사고는 둘이다 — ⓐ 진짜 위치(`assets/test/gpt-image/`)를 놓쳐 손잡이가 안 생기는 것,
 * ⓑ 명령·코드 조각(`pnpm build` · `foo()`)까지 후보로 올려 본문이 가짜 링크로 뒤덮이는 것.
 */

const ROOT = 'C:/repo';

describe('parseStreamPathCandidate — 경로로 읽는 것', () => {
  it('상대 경로를 그대로 후보로 올린다', () => {
    expect(parseStreamPathCandidate('packages/client/src/App.tsx', ROOT))
      .toEqual({ relPath: 'packages/client/src/App.tsx', line: null });
  });

  it('폴더의 끝 슬래시를 떼어 낸다 — 같은 폴더가 두 경로로 갈리지 않게', () => {
    expect(parseStreamPathCandidate('assets/test/gpt-image/', ROOT))
      .toEqual({ relPath: 'assets/test/gpt-image', line: null });
  });

  it('확장자가 있으면 폴더 없이 이름만 있어도 후보다', () => {
    expect(parseStreamPathCandidate('README.md', ROOT))
      .toEqual({ relPath: 'README.md', line: null });
  });

  it('`경로:줄`·`경로:줄:열` 은 뒤를 떼고 경로만 본다', () => {
    expect(parseStreamPathCandidate('src/App.tsx:42', ROOT))
      .toEqual({ relPath: 'src/App.tsx', line: 42 });
    expect(parseStreamPathCandidate('src/App.tsx:42:7', ROOT))
      .toEqual({ relPath: 'src/App.tsx', line: 42 });
  });

  it('루트 안 절대 경로는 상대 경로로 되돌린다 (역슬래시·대소문자 차이 흡수)', () => {
    expect(parseStreamPathCandidate('C:\\repo\\docs\\SCENARIO.md', ROOT))
      .toEqual({ relPath: 'docs/SCENARIO.md', line: null });
    expect(parseStreamPathCandidate('c:/REPO/docs/SCENARIO.md', ROOT))
      .toEqual({ relPath: 'docs/SCENARIO.md', line: null });
  });

  it('`./` 머리는 떼어 낸다', () => {
    expect(parseStreamPathCandidate('./docs/rules', ROOT))
      .toEqual({ relPath: 'docs/rules', line: null });
  });

  it('루트 자신은 빈 상대 경로 — 폴더 열기의 정상 대상이다', () => {
    expect(parseStreamPathCandidate('C:/repo', ROOT)).toEqual({ relPath: '', line: null });
  });
});

describe('parseStreamPathCandidate — 경로가 아닌 것', () => {
  it('프로젝트 루트를 모르면 아무것도 손잡이가 되지 않는다', () => {
    expect(parseStreamPathCandidate('packages/client/src/App.tsx', null)).toBeNull();
  });

  it('공백이 든 명령 조각', () => {
    expect(parseStreamPathCandidate('pnpm build', ROOT)).toBeNull();
    expect(parseStreamPathCandidate('git status', ROOT)).toBeNull();
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

  it('루트 밖 절대 경로 · 상위로 거슬러 오르는 표기', () => {
    expect(parseStreamPathCandidate('D:/other/note.md', ROOT)).toBeNull();
    expect(parseStreamPathCandidate('/etc/hosts', ROOT)).toBeNull();
    expect(parseStreamPathCandidate('../secret/key.pem', ROOT)).toBeNull();
  });

  it('상한을 넘는 긴 조각', () => {
    expect(parseStreamPathCandidate(`a/${'b'.repeat(300)}.ts`, ROOT)).toBeNull();
  });
});
