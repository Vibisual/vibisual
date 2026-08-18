import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectPlayRecipes } from './playRecipeDetector.js';

/**
 * §5.14 v4.62 — 4단 계단 1~3단의 계약.
 *
 * 여기서 지키는 약속은 두 가지다: **실측이 추측을 이긴다**(실제로 떠 있던 명령이 1등),
 * 그리고 **probe 는 서버가 아니다**(curl 이 서버 기동 명령으로 둔갑하면 §7.11 v2.20 이
 * 겪은 사고가 이 기능에서 재현된다).
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'play-detect-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('detectPlayRecipes — 정적(1단)', () => {
  it('index.html 만 있으면 명령 없이 정적 후보를 낸다', () => {
    fs.writeFileSync(path.join(dir, 'index.html'), '<h1>hi</h1>');

    const [top] = detectPlayRecipes(dir);
    expect(top?.kind).toBe('static');
    expect(top?.root).toBe(dir);
    expect(top?.openPath).toBe('/index.html');
    expect(top?.command).toBeUndefined();
  });

  it('하위 폴더(public)의 index.html 도 잡는다', () => {
    fs.mkdirSync(path.join(dir, 'public'));
    fs.writeFileSync(path.join(dir, 'public', 'index.html'), '<h1>hi</h1>');

    const found = detectPlayRecipes(dir).find((c) => c.kind === 'static');
    expect(found?.root).toBe(path.join(dir, 'public'));
  });

  it('아무것도 없으면 빈손으로 돌아온다 (4단 = 에이전트 위임으로 넘어가는 조건)', () => {
    expect(detectPlayRecipes(dir)).toEqual([]);
  });
});

describe('detectPlayRecipes — 명령 탐지(2단)', () => {
  it('package.json scripts.dev 를 최우선으로 고르고 락파일로 매니저를 정한다', () => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'vite --port 5173', build: 'vite build' } }),
    );
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');

    const [top] = detectPlayRecipes(dir);
    expect(top?.kind).toBe('command');
    expect(top?.command).toBe('pnpm run dev');
    expect(top?.cwd).toBe(dir);
    expect(top?.port).toBe(5173);
    expect(top?.reason).toBe('package.json scripts.dev');
  });

  it('락파일이 없으면 npm 으로 돈다', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }));
    expect(detectPlayRecipes(dir)[0]?.command).toBe('npm run start');
  });

  it('python 진입점도 후보가 된다', () => {
    fs.writeFileSync(path.join(dir, 'manage.py'), 'print(1)');
    const found = detectPlayRecipes(dir).find((c) => c.reason === 'manage.py');
    expect(found?.command).toBe('python manage.py runserver');
  });
});

describe('detectPlayRecipes — 관찰 학습(3단)', () => {
  it('실제로 떠 있던 명령이 탐지 결과보다 앞선다', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));

    const [top] = detectPlayRecipes(dir, [{ command: 'python -m http.server 8777', port: 8777 }]);
    expect(top?.command).toBe('python -m http.server 8777');
    expect(top?.source).toBe('observed');
    expect(top?.port).toBe(8777);
  });

  it('probe 명령(curl)과 URL 전용 항목은 후보가 아니다', () => {
    const found = detectPlayRecipes(dir, [
      { command: 'curl http://localhost:3000' },
      { command: 'http://127.0.0.1:8777/index.html' },
    ]);
    expect(found).toEqual([]);
  });

  it('같은 명령이 여러 번 떠 있었어도 한 번만 제안한다', () => {
    const found = detectPlayRecipes(dir, [
      { command: 'node server.js', port: 3000 },
      { command: 'node server.js', port: 3000 },
    ]);
    expect(found).toHaveLength(1);
  });
});
