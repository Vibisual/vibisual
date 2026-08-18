import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readWorkspaceFile, writeWorkspaceFile, detectEol } from './workspaceFile.js';

/**
 * §5.5 #17-27 v4.87 — 내장 편집창의 파일 읽기·쓰기 테스트.
 *
 * 지키는 것 넷 — (a) 루트 밖으로 새지 않는다, (b) 원본 줄바꿈이 저장으로 뒤바뀌지 않는다,
 * (c) 읽은 뒤 디스크가 바뀌었으면 덮어쓰지 않는다, (d) 잘린 본문·이진 파일은 읽기 전용 신호를 단다.
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-file-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'const a = 1;\nconst b = 2;\n');
  fs.writeFileSync(path.join(root, 'crlf.txt'), 'one\r\ntwo\r\n');
  fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0x50, 0x00, 0x4b, 0x03]));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('detectEol', () => {
  it('\\r\\n 이 하나라도 있으면 crlf', () => {
    expect(detectEol('a\r\nb')).toBe('crlf');
    expect(detectEol('a\nb')).toBe('lf');
    expect(detectEol('한 줄')).toBe('lf');
  });
});

describe('readWorkspaceFile', () => {
  it('본문·크기·수정시각을 함께 준다', () => {
    const file = readWorkspaceFile(root, 'src/app.ts');
    expect(file?.text).toBe('const a = 1;\nconst b = 2;\n');
    expect(file?.path).toBe('src/app.ts');
    expect(file?.size).toBeGreaterThan(0);
    expect(file?.mtimeMs).toBeGreaterThan(0);
    expect(file?.truncated).toBe(false);
    expect(file?.binary).toBe(false);
  });

  it('crlf 파일은 본문을 \\n 으로 정규화하되 원본 형식을 기억한다', () => {
    const file = readWorkspaceFile(root, 'crlf.txt');
    expect(file?.text).toBe('one\ntwo\n');
    expect(file?.eol).toBe('crlf');
  });

  it('이진 파일은 본문 없이 binary 로 알린다(읽기 전용 신호)', () => {
    const file = readWorkspaceFile(root, 'bin.dat');
    expect(file?.binary).toBe(true);
    expect(file?.text).toBe('');
  });

  it('상한을 넘으면 앞부분만 담고 truncated', () => {
    const file = readWorkspaceFile(root, 'src/app.ts', 5);
    expect(file?.truncated).toBe(true);
    expect(file?.text).toBe('const');
  });

  it('디렉터리·없는 파일·루트 자신은 null — 파일 한 개 창구다', () => {
    expect(readWorkspaceFile(root, 'src')).toBeNull();
    expect(readWorkspaceFile(root, 'nope.ts')).toBeNull();
    expect(readWorkspaceFile(root, '')).toBeNull();
  });

  it('[보안] 루트를 벗어나는 경로는 null', () => {
    expect(readWorkspaceFile(root, '../outside.ts')).toBeNull();
  });
});

describe('writeWorkspaceFile', () => {
  it('lf 파일은 lf 그대로 저장한다', () => {
    const base = readWorkspaceFile(root, 'src/app.ts')!;
    const out = writeWorkspaceFile(root, 'src/app.ts', 'const a = 9;\n', 'lf', base.mtimeMs);
    expect(out.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, 'src', 'app.ts'), 'utf8')).toBe('const a = 9;\n');
  });

  it('crlf 파일은 저장할 때 crlf 로 되돌린다(줄바꿈 오염 금지)', () => {
    const base = readWorkspaceFile(root, 'crlf.txt')!;
    const out = writeWorkspaceFile(root, 'crlf.txt', 'one\ntwo\nthree\n', base.eol, base.mtimeMs);
    expect(out.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, 'crlf.txt'), 'utf8')).toBe('one\r\ntwo\r\nthree\r\n');
  });

  it('읽은 뒤 디스크가 바뀌었으면 덮어쓰지 않고 conflict', () => {
    const base = readWorkspaceFile(root, 'src/app.ts')!;
    fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'agent wrote this\n');
    fs.utimesSync(path.join(root, 'src', 'app.ts'), new Date(), new Date(Date.now() + 5_000));

    const out = writeWorkspaceFile(root, 'src/app.ts', 'user text\n', 'lf', base.mtimeMs);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toBe('conflict');
    expect(fs.readFileSync(path.join(root, 'src', 'app.ts'), 'utf8')).toBe('agent wrote this\n');
  });

  it('baseMtimeMs 0 = 대조 건너뛰기("그래도 저장")', () => {
    fs.utimesSync(path.join(root, 'src', 'app.ts'), new Date(), new Date(Date.now() + 5_000));
    const out = writeWorkspaceFile(root, 'src/app.ts', 'forced\n', 'lf', 0);
    expect(out.ok).toBe(true);
  });

  it('상한을 넘는 본문은 저장하지 않는다', () => {
    const base = readWorkspaceFile(root, 'src/app.ts')!;
    const out = writeWorkspaceFile(root, 'src/app.ts', 'x'.repeat(50), 'lf', base.mtimeMs, 10);
    expect(out.ok === false && out.error).toBe('too-large');
  });

  it('없는 파일에는 쓰지 않는다(편집창은 이미 열린 파일만 저장한다)', () => {
    const out = writeWorkspaceFile(root, 'nope.ts', 'x', 'lf', 0);
    expect(out.ok === false && out.error).toBe('not-found');
  });

  it('[보안] 루트를 벗어나는 저장은 거부', () => {
    const out = writeWorkspaceFile(root, '../outside.ts', 'x', 'lf', 0);
    expect(out.ok === false && out.error).toBe('outside');
  });
});

/**
 * §5.5 #17-27 ⑫ — 디스크가 잠근 파일(Perforce 체크아웃 전 파일 등)을 풀고 저장한다.
 *
 * 지키는 것 셋 — (a) 잠긴 것은 잠겼다고 말한다, (b) 잠금 해제 없이는 덮어쓰지 않는다,
 * (c) 사용자가 풀라고 했을 때만 쓰기 비트를 켜고 저장하며 잠금을 되돌려 걸지 않는다.
 */
describe('읽기 전용 잠금(⑫)', () => {
  /** 잠긴 파일 하나 — 윈도우에서는 읽기 전용 속성, POSIX 에서는 쓰기 비트가 꺼진다. */
  function lock(rel: string): string {
    const abs = path.join(root, rel);
    fs.chmodSync(abs, 0o444);
    return abs;
  }

  it('읽기가 잠금을 함께 알린다(본문은 그대로 온전하다)', () => {
    lock('src/app.ts');
    const file = readWorkspaceFile(root, 'src/app.ts');
    expect(file?.readOnly).toBe(true);
    expect(file?.binary).toBe(false);
    expect(file?.truncated).toBe(false);
    expect(file?.text).toBe('const a = 1;\nconst b = 2;\n');
  });

  it('잠기지 않은 파일은 readOnly=false', () => {
    expect(readWorkspaceFile(root, 'src/app.ts')?.readOnly).toBe(false);
  });

  it('잠긴 파일을 그냥 저장하면 readonly 로 갈라 답한다(내용 보존)', () => {
    const base = readWorkspaceFile(root, 'src/app.ts')!;
    lock('src/app.ts');

    const out = writeWorkspaceFile(root, 'src/app.ts', 'user text\n', 'lf', base.mtimeMs);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toBe('readonly');
    expect(fs.readFileSync(path.join(root, 'src', 'app.ts'), 'utf8')).toBe('const a = 1;\nconst b = 2;\n');
  });

  it('clearReadOnly 면 잠금을 풀고 저장하며, 되돌려 걸지 않는다', () => {
    const base = readWorkspaceFile(root, 'src/app.ts')!;
    lock('src/app.ts');

    const out = writeWorkspaceFile(root, 'src/app.ts', 'user text\n', 'lf', base.mtimeMs, undefined, true);
    expect(out.ok).toBe(true);
    expect(out.ok === true && out.result.readOnly).toBe(false);
    expect(fs.readFileSync(path.join(root, 'src', 'app.ts'), 'utf8')).toBe('user text\n');
    expect(readWorkspaceFile(root, 'src/app.ts')?.readOnly).toBe(false);
  });

  it('잠금 해제 저장도 충돌 대조를 그대로 지난다(남의 편집을 덮지 않는다)', () => {
    const base = readWorkspaceFile(root, 'src/app.ts')!;
    fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'agent wrote this\n');
    fs.utimesSync(path.join(root, 'src', 'app.ts'), new Date(), new Date(Date.now() + 5_000));
    lock('src/app.ts');

    const out = writeWorkspaceFile(root, 'src/app.ts', 'user text\n', 'lf', base.mtimeMs, undefined, true);
    expect(out.ok === false && out.error).toBe('conflict');
    expect(fs.readFileSync(path.join(root, 'src', 'app.ts'), 'utf8')).toBe('agent wrote this\n');
  });
});
