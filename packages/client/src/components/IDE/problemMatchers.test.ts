import { describe, expect, it } from 'vitest';

import { matchProblemLine } from '@vibisual/shared';

/**
 * §5.5 #17-20 ⑪ v4.94 — 출력 한 줄에서 문제를 뽑는 공통 매처.
 *
 * 이 표의 값어치는 **한 표가 모든 런타임을 덮는다**는 데 있으므로, 테스트도 언리얼 한 줄만
 * 보지 않고 런타임마다 실제 도구가 내는 모양을 하나씩 세워 둔다. 어느 표에도 안 걸리는 줄이
 * 평문으로 남는지도 함께 못 박는다(모르는 것을 아는 척 칠하지 않는다).
 */
describe('matchProblemLine — 런타임별 대표 한 줄', () => {
  it('TypeScript 진단에서 파일·줄·열·심각도를 뽑는다', () => {
    const m = matchProblemLine("src/app.ts(12,5): error TS2304: Cannot find name 'foo'.");
    expect(m?.matcher).toBe('tsc');
    expect(m?.file).toBe('src/app.ts');
    expect(m?.line).toBe(12);
    expect(m?.column).toBe(5);
    expect(m?.severity).toBe('error');
  });

  it('MSVC(언리얼 C++ 빌드 포함) 오류를 잡는다', () => {
    const m = matchProblemLine('D:/Game/Source/Foo.cpp(88): error C2065: undeclared identifier');
    expect(m?.matcher).toBe('msvc');
    expect(m?.file).toBe('D:/Game/Source/Foo.cpp');
    expect(m?.line).toBe(88);
    expect(m?.severity).toBe('error');
  });

  it('gcc/clang 경고의 심각도를 warning 으로 읽는다', () => {
    const m = matchProblemLine('src/a.c:3:7: warning: unused variable');
    expect(m?.matcher).toBe('gcc-clang');
    expect(m?.severity).toBe('warning');
    expect(m?.line).toBe(3);
    expect(m?.column).toBe(7);
  });

  it('Go 는 심각도 단어가 없어도 오류로 본다', () => {
    const m = matchProblemLine('./main.go:10:2: undefined: foo');
    expect(m?.matcher).toBe('go');
    expect(m?.file).toBe('./main.go');
    expect(m?.severity).toBe('error');
  });

  it('Rust 는 머리 줄과 위치 줄이 따로 잡힌다', () => {
    const head = matchProblemLine('error[E0425]: cannot find value `x` in this scope');
    expect(head?.matcher).toBe('rust-head');
    expect(head?.severity).toBe('error');
    const loc = matchProblemLine('  --> src/main.rs:5:9');
    expect(loc?.matcher).toBe('rust-loc');
    expect(loc?.file).toBe('src/main.rs');
    expect(loc?.line).toBe(5);
  });

  it('ESLint stylish 본문에서 줄·열·심각도를 뽑는다(파일은 위 줄에 있다)', () => {
    const m = matchProblemLine("  3:5  error  'x' is not defined  no-undef");
    expect(m?.matcher).toBe('eslint');
    expect(m?.line).toBe(3);
    expect(m?.severity).toBe('error');
    expect(m?.file).toBeUndefined();
  });

  it('Node 스택 프레임에서 파일과 줄을 뽑는다(열 수 있는 자리)', () => {
    const m = matchProblemLine('    at run (C:/p/server.js:12:5)');
    expect(m?.matcher).toBe('node-stack');
    expect(m?.file).toBe('C:/p/server.js');
    expect(m?.line).toBe(12);
    expect(m?.severity).toBe('info');
  });

  it('Python 트레이스백 프레임을 잡는다', () => {
    const m = matchProblemLine('  File "app.py", line 42, in <module>');
    expect(m?.matcher).toBe('python-frame');
    expect(m?.file).toBe('app.py');
    expect(m?.line).toBe(42);
  });

  it('Java 스택 프레임을 잡는다', () => {
    const m = matchProblemLine('\tat com.foo.Bar.run(Bar.java:42)');
    expect(m?.matcher).toBe('java-frame');
    expect(m?.file).toBe('Bar.java');
    expect(m?.line).toBe(42);
  });

  it('언리얼 로그는 이 표의 한 줄일 뿐이다(타임스탬프 유무 모두)', () => {
    const withStamp = matchProblemLine('[2026.08.06-12.00.00:000][  0]LogTemp: Error: 무언가 잘못됨');
    expect(withStamp?.matcher).toBe('unreal-log');
    expect(withStamp?.severity).toBe('error');
    expect(withStamp?.message).toBe('무언가 잘못됨');

    const bare = matchProblemLine('LogNet: Warning: connection dropped');
    expect(bare?.matcher).toBe('unreal-log');
    expect(bare?.severity).toBe('warning');
  });

  it('예외 이름만 있는 줄도 오류로 잡는다', () => {
    const m = matchProblemLine('TypeError: x is not a function');
    expect(m?.severity).toBe('error');
    expect(m?.matcher).toBe('exception');
  });

  it('심각도 단어만 있는 줄은 마지막 그물에 걸린다', () => {
    const m = matchProblemLine('[WARN] cache miss');
    expect(m?.matcher).toBe('bare-severity');
    expect(m?.severity).toBe('warning');
  });

  it('평범한 줄은 어느 표에도 걸리지 않는다(아는 척 ❌)', () => {
    expect(matchProblemLine('Server listening on 3000')).toBeNull();
    expect(matchProblemLine('')).toBeNull();
  });

  it('아주 긴 줄은 보지 않는다(로그 폭주 시 정규식 비용 가드)', () => {
    expect(matchProblemLine(`error: ${'x'.repeat(2100)}`)).toBeNull();
  });
});
