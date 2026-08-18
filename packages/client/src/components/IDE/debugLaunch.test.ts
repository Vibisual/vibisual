/**
 * §5.5 #17-20 ③ v4.74 — 디버그 인자 변환 테스트.
 *
 * 이 표의 규율은 하나다 — **얹지 못했으면 얹은 척하지 않는다**. 변환 실패를 조용히 성공으로
 * 넘기면 사용자는 디버거가 붙기를 기다리며 평범하게 도는 프로세스를 쳐다보게 된다.
 */
import { describe, expect, it } from 'vitest';

import { DEBUG_PORT_BASE, buildDebugCommand, detectRunRuntime } from '@vibisual/shared';
import type { RunConfig } from '@vibisual/shared';

function cfg(command: string, extra: Partial<RunConfig> = {}): Pick<RunConfig, 'command' | 'debugCommand' | 'runtime'> {
  return { command, runtime: detectRunRuntime(command), ...extra };
}

describe('detectRunRuntime', () => {
  it('명령에서 런타임을 고른다', () => {
    expect(detectRunRuntime('node server.js')).toBe('node');
    expect(detectRunRuntime('pnpm run dev')).toBe('node');
    expect(detectRunRuntime('python manage.py runserver')).toBe('python');
    expect(detectRunRuntime('go run ./cmd/api')).toBe('go');
    expect(detectRunRuntime('cargo run')).toBe('rust');
    expect(detectRunRuntime('MyGame.uproject')).toBe('unreal');
  });

  it('모르는 명령은 other', () => {
    expect(detectRunRuntime('./run-everything.sh')).toBe('other');
  });
});

describe('buildDebugCommand', () => {
  it('node 는 실행 파일 바로 뒤에 --inspect-brk 를 끼운다', () => {
    const out = buildDebugCommand(cfg('node server.js --port 3000'), DEBUG_PORT_BASE);
    expect(out.applied).toBe(true);
    expect(out.command).toBe(`node --inspect-brk=${DEBUG_PORT_BASE} server.js --port 3000`);
  });

  it('패키지 매니저 경유는 셸 문법 대신 env 로 건다(윈도우·POSIX 공용)', () => {
    const out = buildDebugCommand(cfg('pnpm run dev'), 9300);
    expect(out.applied).toBe(true);
    // 명령 문자열은 그대로 — 셸마다 다른 `set X=` / `X=` 문법을 쓰지 않는다.
    expect(out.command).toBe('pnpm run dev');
    expect(out.env).toEqual({ NODE_OPTIONS: '--inspect-brk=9300' });
  });

  it('python 은 debugpy 를 끼우고 클라이언트를 기다린다', () => {
    const out = buildDebugCommand(cfg('python app.py'), 5678);
    expect(out.command).toBe('python -m debugpy --listen 5678 --wait-for-client app.py');
    expect(out.applied).toBe(true);
  });

  it('go 는 dlv 로 바꿔 띄운다', () => {
    const out = buildDebugCommand(cfg('go run ./cmd/api'), 2345);
    expect(out.command).toBe('dlv debug --headless --listen=:2345 --api-version=2 ./cmd/api');
  });

  it('rust 는 변환할 수 없으므로 원본을 그대로 두고 applied=false 를 알린다', () => {
    const out = buildDebugCommand(cfg('cargo run'), DEBUG_PORT_BASE);
    expect(out.applied).toBe(false);
    expect(out.command).toBe('cargo run');
    expect(out.noteKey).toBe('ide.debug.note.rust');
  });

  it('모르는 명령도 조용히 실패하지 않는다 — unsupported 로 표시', () => {
    const out = buildDebugCommand(cfg('./run-everything.sh'), DEBUG_PORT_BASE);
    expect(out.applied).toBe(false);
    expect(out.noteKey).toBe('ide.debug.note.unsupported');
  });

  it('구성이 직접 쓴 debugCommand 가 표보다 우선한다', () => {
    const out = buildDebugCommand(cfg('node server.js', { debugCommand: 'node --inspect=1234 server.js' }), DEBUG_PORT_BASE);
    expect(out.command).toBe('node --inspect=1234 server.js');
    expect(out.applied).toBe(true);
    expect(out.noteKey).toBeNull();
  });

  it('언리얼은 디버거를 기다리며 서고 로그를 우리 출력으로 보낸다', () => {
    const once = buildDebugCommand(cfg('MyGame.uproject'), DEBUG_PORT_BASE);
    expect(once.applied).toBe(true);
    // `-WaitForDebugger` 가 있어야 붙일 시간이 생기고, `-stdout -FullStdOutLogOutput` 이라야
    // 로그가 별창이 아니라 출력 패널로 흐른다.
    expect(once.command).toBe('MyGame.uproject -WaitForDebugger -stdout -FullStdOutLogOutput -log');
  });

  it('이미 붙어 있는 인자는 다시 붙이지 않는다(재실행해도 명령이 자라지 않는다)', () => {
    const already = 'MyGame.uproject -WaitForDebugger -stdout -FullStdOutLogOutput -log';
    expect(buildDebugCommand(cfg(already), DEBUG_PORT_BASE).command).toBe(already);
    // 일부만 있던 경우에는 빠진 것만 채운다.
    expect(buildDebugCommand(cfg('MyGame.uproject -log'), DEBUG_PORT_BASE).command).toBe(
      'MyGame.uproject -log -WaitForDebugger -stdout -FullStdOutLogOutput',
    );
  });

  it('Build.bat 도 언리얼로 알아본다 — 에디터 타깃 빌드가 디버깅의 전제다', () => {
    const out = buildDebugCommand(cfg('"C:/UE_5.8/Engine/Build/BatchFiles/Build.bat" MyGameEditor Win64 Development'), DEBUG_PORT_BASE);
    expect(out.noteKey).toBe('ide.debug.note.unreal');
  });
});
