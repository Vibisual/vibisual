/**
 * §3.2.4 G축 — 청크 순회가 전량 읽기와 **같은 결과**인지 고정한다.
 *
 * 이 테스트가 지키는 것 하나: **최적화가 데이터를 바꾸면 안 된다.**
 * 종전 경로(`readFileSync(p,'utf8').split('\n')` · `Buffer.allocUnsafe(구간 전체)`)와
 * 줄 목록이 바이트 단위로 같아야 하고, 청크 크기를 어떻게 잡아도 결과가 흔들리면 안 된다.
 *
 * 특히 조심한 것: **UTF-8 멀티바이트가 청크 경계에 걸리는 경우.** 청크를 그대로 `toString()`
 * 하면 한글이 깨진다 — 그래서 마지막 개행까지만 디코드하고 남은 바이트는 다음 청크로 넘긴다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findTailLineOffset, scanFileLines, scanTailLines, scanWholeFileLines } from './jsonlChunkReader.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-chunk-'));
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 무시 */ }
});

function write(name: string, content: string): string {
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, content, 'utf8');
  return fp;
}

/** 종전 구현 — 비교 기준. */
function legacyLines(filePath: string): string[] {
  return fs.readFileSync(filePath, 'utf8').split('\n').filter((l) => l !== '');
}

function collect(filePath: string, chunkBytes: number): string[] {
  const out: string[] = [];
  scanWholeFileLines(filePath, (line) => { out.push(line); }, chunkBytes);
  return out;
}

describe('scanWholeFileLines — 전량 읽기와의 등가성', () => {
  it('청크 크기를 바꿔도 줄 목록이 같다', () => {
    const content = Array.from({ length: 200 }, (_, i) => JSON.stringify({ i, pad: 'x'.repeat(i % 37) })).join('\n') + '\n';
    const fp = write('a.jsonl', content);
    const expected = legacyLines(fp);

    for (const chunk of [1, 2, 3, 7, 16, 64, 512, 4096, 1 << 20]) {
      expect(collect(fp, chunk), `chunk=${chunk}`).toEqual(expected);
    }
  });

  it('한글(UTF-8 3바이트)이 청크 경계에 걸려도 깨지지 않는다', () => {
    // 줄마다 길이를 달리해 경계가 문자 중간에 오도록 강제한다.
    const lines = Array.from({ length: 80 }, (_, i) => JSON.stringify({ msg: '가나다라마'.repeat((i % 5) + 1), i }));
    const fp = write('ko.jsonl', lines.join('\n') + '\n');
    const expected = legacyLines(fp);

    for (const chunk of [1, 2, 3, 5, 8, 13, 64]) {
      const got = collect(fp, chunk);
      expect(got, `chunk=${chunk}`).toEqual(expected);
      // 깨졌다면 대체 문자가 섞인다.
      expect(got.join('').includes('�'), `chunk=${chunk} replacement char`).toBe(false);
    }
  });

  it('이모지(4바이트 서로게이트)도 경계에서 온전하다', () => {
    const lines = Array.from({ length: 40 }, (_, i) => JSON.stringify({ e: '🙂🚀🧠'.repeat((i % 3) + 1) }));
    const fp = write('emoji.jsonl', lines.join('\n') + '\n');
    const expected = legacyLines(fp);
    for (const chunk of [1, 3, 7, 11]) {
      expect(collect(fp, chunk), `chunk=${chunk}`).toEqual(expected);
    }
  });

  it('개행으로 끝나지 않는 파일도 마지막 줄을 먹인다', () => {
    const fp = write('tail.jsonl', '{"a":1}\n{"b":2}\n{"c":3}'); // 마지막에 개행 없음
    expect(collect(fp, 4)).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    expect(collect(fp, 1 << 20)).toEqual(legacyLines(fp));
  });

  it('빈 줄은 먹이지 않는다 — 종전 `if (!line) continue` 와 같은 동작', () => {
    const fp = write('blank.jsonl', '{"a":1}\n\n\n{"b":2}\n');
    expect(collect(fp, 3)).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('빈 파일·없는 파일은 조용히 아무것도 안 한다', () => {
    const empty = write('empty.jsonl', '');
    expect(collect(empty, 64)).toEqual([]);
    expect(collect(path.join(dir, 'nope.jsonl'), 64)).toEqual([]);
  });

  it('한 줄이 청크보다 길어도 온전히 전달된다', () => {
    const long = JSON.stringify({ big: 'y'.repeat(5000) });
    const fp = write('long.jsonl', `{"a":1}\n${long}\n{"b":2}\n`);
    expect(collect(fp, 64)).toEqual(['{"a":1}', long, '{"b":2}']);
  });

  it('소비자가 false 를 돌려주면 거기서 멈춘다', () => {
    const fp = write('stop.jsonl', Array.from({ length: 100 }, (_, i) => `{"i":${i}}`).join('\n') + '\n');
    const seen: string[] = [];
    scanWholeFileLines(fp, (line) => {
      seen.push(line);
      if (seen.length === 3) return false;
    }, 16);
    expect(seen).toEqual(['{"i":0}', '{"i":1}', '{"i":2}']);
  });
});

describe('scanFileLines — 증분(append) 규약', () => {
  it('구간을 나눠 읽어도 전량 1회 읽기와 결과가 같다', () => {
    const content = Array.from({ length: 120 }, (_, i) => `{"i":${i},"p":"${'z'.repeat(i % 23)}"}`).join('\n') + '\n';
    const fp = write('inc.jsonl', content);
    const size = fs.statSync(fp).size;

    const whole: string[] = [];
    scanFileLines(fp, 0, size, (l) => { whole.push(l); }, 1 << 20);

    // 임의 지점에서 끊어 두 번에 나눠 읽는다(append 를 흉내).
    const split = Math.floor(size / 3);
    const part: string[] = [];
    const first = scanFileLines(fp, 0, split, (l) => { part.push(l); }, 32);
    const second = scanFileLines(fp, first.nextOffset, size, (l) => { part.push(l); }, 32);

    expect(part).toEqual(whole);
    expect(second.pendingTail).toBe('');
  });

  it('개행이 하나도 없는 구간은 커밋하지 않고 꼬리로만 들고 간다', () => {
    const fp = write('nonl.jsonl', '{"partial":true'); // 개행 없음
    const size = fs.statSync(fp).size;
    const seen: string[] = [];
    const r = scanFileLines(fp, 0, size, (l) => { seen.push(l); }, 4);
    expect(seen).toEqual([]);
    expect(r.nextOffset).toBe(0);       // 커밋 ❌ — 다음에 뒷부분이 붙으면 그때 온전한 줄로 먹는다
    expect(r.pendingTail).toBe('{"partial":true');
  });

  it('완결된 줄 뒤의 미완결 꼬리는 pendingTail 로만 나온다', () => {
    const fp = write('mixed.jsonl', '{"a":1}\n{"b":2}\n{"half":');
    const size = fs.statSync(fp).size;
    const seen: string[] = [];
    const r = scanFileLines(fp, 0, size, (l) => { seen.push(l); }, 5);
    expect(seen).toEqual(['{"a":1}', '{"b":2}']);
    expect(r.pendingTail).toBe('{"half":');
    expect(r.nextOffset).toBe(size - '{"half":'.length);
  });

  it('빈 구간은 즉시 되돌아온다', () => {
    const fp = write('x.jsonl', '{"a":1}\n');
    const seen: string[] = [];
    const r = scanFileLines(fp, 5, 5, (l) => { seen.push(l); });
    expect(seen).toEqual([]);
    expect(r).toEqual({ nextOffset: 5, pendingTail: '' });
  });
});

/**
 * 꼬리 읽기가 지켜야 하는 것 하나: **전량 읽고 `slice(-N)` 한 것과 결과가 같아야 한다.**
 * 여기서 어긋나면 화면의 대화가 한 줄씩 밀리거나 통째로 비므로, 경계(맨 끝 개행·개행 없이 끝난
 * 파일·N 이 줄 수보다 큰 경우)를 전부 고정한다.
 */
describe('scanTailLines — 꼬리 N줄이 전량 읽기 + slice(-N) 과 같다', () => {
  function tail(filePath: string, n: number, chunkBytes: number): string[] {
    const out: string[] = [];
    scanTailLines(filePath, n, (line) => { out.push(line); }, chunkBytes);
    return out;
  }

  it('N 을 바꿔도, 청크를 바꿔도 slice(-N) 과 같다', () => {
    const content = Array.from({ length: 300 }, (_, i) => JSON.stringify({ i, pad: 'x'.repeat(i % 41) })).join('\n') + '\n';
    const fp = write('tail-a.jsonl', content);
    const all = legacyLines(fp);

    for (const n of [1, 2, 7, 50, 299, 300]) {
      for (const chunk of [1, 3, 16, 512, 1 << 20]) {
        expect(tail(fp, n, chunk), `n=${n} chunk=${chunk}`).toEqual(all.slice(-n));
      }
    }
  });

  it('N 이 줄 수보다 크면 전량과 같다', () => {
    const fp = write('tail-small.jsonl', '{"a":1}\n{"b":2}\n{"c":3}\n');
    const all = legacyLines(fp);
    expect(findTailLineOffset(fp, 10)).toBe(0); // 처음부터 읽으라는 뜻
    for (const chunk of [1, 4, 1 << 20]) expect(tail(fp, 10, chunk)).toEqual(all);
  });

  it('개행으로 끝나지 않는 파일도 마지막 줄이 꼬리에 든다', () => {
    const fp = write('tail-nonl.jsonl', '{"a":1}\n{"b":2}\n{"c":3}'); // 마지막 개행 없음
    expect(tail(fp, 2, 4)).toEqual(['{"b":2}', '{"c":3}']);
    expect(tail(fp, 1, 3)).toEqual(['{"c":3}']);
  });

  it('한글·이모지가 청크 경계에 걸려도 꼬리가 깨지지 않는다', () => {
    const lines = Array.from({ length: 60 }, (_, i) => JSON.stringify({ msg: '가나다🚀'.repeat((i % 4) + 1), i }));
    const fp = write('tail-ko.jsonl', lines.join('\n') + '\n');
    const all = legacyLines(fp);
    for (const chunk of [1, 2, 5, 13, 64]) {
      const got = tail(fp, 9, chunk);
      expect(got, `chunk=${chunk}`).toEqual(all.slice(-9));
      expect(got.join('').includes('�'), `chunk=${chunk} replacement char`).toBe(false);
    }
  });

  it('한 줄이 청크보다 길어도 온전히 나온다', () => {
    const long = JSON.stringify({ big: 'y'.repeat(5000) });
    const fp = write('tail-long.jsonl', `{"a":1}\n${long}\n{"b":2}\n`);
    expect(tail(fp, 2, 64)).toEqual([long, '{"b":2}']);
  });

  it('빈 파일·없는 파일·N<=0 은 조용히 빈 결과', () => {
    const empty = write('tail-empty.jsonl', '');
    expect(tail(empty, 5, 64)).toEqual([]);
    expect(tail(path.join(dir, 'nope.jsonl'), 5, 64)).toEqual([]);
    const fp = write('tail-zero.jsonl', '{"a":1}\n{"b":2}\n');
    expect(findTailLineOffset(fp, 0)).toBe(0);
  });

  it('꼬리 오프셋은 항상 개행 바로 뒤라 첫 줄이 반쪽으로 잘리지 않는다', () => {
    const content = Array.from({ length: 40 }, (_, i) => `{"i":${i}}`).join('\n') + '\n';
    const fp = write('tail-off.jsonl', content);
    const raw = fs.readFileSync(fp, 'utf8');
    for (const n of [1, 5, 39]) {
      const off = findTailLineOffset(fp, n);
      expect(off > 0, `n=${n}`).toBe(true);
      expect(raw[off - 1], `n=${n}`).toBe('\n');
      expect(raw.slice(off).split('\n').filter((l) => l !== '').length, `n=${n}`).toBe(n);
    }
  });
});
