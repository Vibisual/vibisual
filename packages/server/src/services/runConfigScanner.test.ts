/**
 * §5.5 #17-20 ② v4.74 — 실행 구성 스캐너 테스트.
 *
 * 핵심은 **JSONC**다. `launch.json`·`tasks.json` 에는 거의 항상 주석이 있고, `JSON.parse` 를
 * 그대로 쓰면 사용자의 진짜 구성이 통째로 "없음" 이 된다 — 그 회귀를 여기서 잡는다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseJsonc, scanRunConfigs } from './runConfigScanner.js';

let tmpDir: string;

function write(rel: string, body: string): void {
  const file = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-run-scan-'));
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* 정리 실패는 테스트 결과와 무관 */
  }
});

describe('parseJsonc', () => {
  it('줄 주석과 블록 주석을 걷어낸다', () => {
    const parsed = parseJsonc(`{
      // 줄 주석
      "a": 1,
      /* 블록
         주석 */
      "b": 2
    }`);
    expect(parsed).toEqual({ a: 1, b: 2 });
  });

  it('후행 쉼표를 허용한다', () => {
    expect(parseJsonc('{ "a": [1, 2, ], }')).toEqual({ a: [1, 2] });
  });

  it('문자열 안의 // 는 주석이 아니다 (URL 이 잘리면 안 된다)', () => {
    expect(parseJsonc('{ "url": "https://example.com/x" }')).toEqual({ url: 'https://example.com/x' });
  });

  it('이스케이프된 따옴표를 문자열 종료로 오인하지 않는다', () => {
    expect(parseJsonc('{ "q": "a\\"b // not comment" }')).toEqual({ q: 'a"b // not comment' });
  });

  it('망가진 JSON 은 null 을 준다(예외를 던지지 않는다)', () => {
    expect(parseJsonc('{ nope')).toBeNull();
  });
});

describe('scanRunConfigs', () => {
  it('주석이 든 launch.json 에서 구성을 읽는다', () => {
    write(
      '.vscode/launch.json',
      `{
        // VS Code 가 만들어 주는 그대로의 모양
        "version": "0.2.0",
        "configurations": [
          {
            "name": "Launch Server",
            "type": "node",
            "request": "launch",
            "program": "\${workspaceFolder}/server.js",
            "args": ["--port", "4000"],
          },
        ],
      }`,
    );

    const { configs, scanned } = scanRunConfigs(tmpDir);
    expect(scanned).toContain('.vscode/launch.json');
    const found = configs.find((c) => c.name === 'Launch Server');
    expect(found).toBeDefined();
    expect(found?.source).toBe('launch.json');
    expect(found?.runtime).toBe('node');
    // ${workspaceFolder} 는 실제 경로로 치환된다.
    expect(found?.command).toContain('server.js');
    expect(found?.command).not.toContain('${workspaceFolder}');
    expect(found?.command).toContain('--port 4000');
  });

  it('request:attach 는 우리가 띄우지 않는 구성으로 표시된다', () => {
    write(
      '.vscode/launch.json',
      `{ "configurations": [ { "name": "Attach", "type": "node", "request": "attach", "port": 9229 } ] }`,
    );
    const { configs } = scanRunConfigs(tmpDir);
    const attach = configs.find((c) => c.name === 'Attach');
    expect(attach?.attachOnly).toBe(true);
    expect(attach?.kind).toBe('attach');
  });

  it('tasks.json 의 command + args 를 한 줄로 합친다', () => {
    write(
      '.vscode/tasks.json',
      `{ "version": "2.0.0", "tasks": [ { "label": "build", "type": "shell", "command": "pnpm", "args": ["build"] } ] }`,
    );
    const { configs } = scanRunConfigs(tmpDir);
    const build = configs.find((c) => c.name === 'build');
    expect(build?.command).toBe('pnpm build');
    expect(build?.source).toBe('tasks.json');
    expect(build?.kind).toBe('build');
  });

  it('package.json scripts 를 락파일이 가리키는 매니저로 부른다', () => {
    write('package.json', JSON.stringify({ scripts: { dev: 'vite', test: 'vitest' } }));
    write('pnpm-lock.yaml', 'lockfileVersion: 9.0');
    const { configs } = scanRunConfigs(tmpDir);
    const dev = configs.find((c) => c.name === 'dev');
    expect(dev?.command).toBe('pnpm run dev');
    expect(configs.find((c) => c.name === 'test')?.kind).toBe('test');
  });

  it('.vibisual/run.json 의 사용자 구성과 debugCommand 를 읽는다', () => {
    write(
      '.vibisual/run.json',
      JSON.stringify({ configs: [{ name: 'Unreal', command: 'MyGame.uproject', debugCommand: 'MyGame.uproject -log -debug' }] }),
    );
    const { configs } = scanRunConfigs(tmpDir);
    const unreal = configs.find((c) => c.name === 'Unreal');
    expect(unreal?.source).toBe('vibisual');
    expect(unreal?.debugCommand).toBe('MyGame.uproject -log -debug');
    expect(unreal?.runtime).toBe('unreal');
  });

  it('같은 명령이 두 출처에서 나오면 사용자가 쓴 파일 쪽을 남긴다', () => {
    // tasks.json 과 scripts 가 같은 명령을 낸다 → 앞선 tasks.json 이 이긴다.
    write('.vscode/tasks.json', `{ "tasks": [ { "label": "dev task", "command": "npm", "args": ["run", "dev"] } ] }`);
    write('package.json', JSON.stringify({ scripts: { dev: 'vite' } }));
    const { configs } = scanRunConfigs(tmpDir);
    const matches = configs.filter((c) => c.command === 'npm run dev');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.source).toBe('tasks.json');
  });

  it('없는 경로는 빈 결과 — 예외를 던지지 않는다', () => {
    const { configs, scanned } = scanRunConfigs(path.join(tmpDir, 'nope'));
    expect(configs).toEqual([]);
    expect(scanned).toEqual([]);
  });
});
