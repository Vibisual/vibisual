/**
 * §5.19 (B) 엔진 설치 무결성 — 잘린 실행 이미지 탐지 테스트.
 *
 * 회귀 방지 대상 — 2026-08-20 실측 사고. `llama-server-impl.dll` 이 9,982,976B 중
 * 6,361,270B 만 풀린 채 남았는데 설치는 "완료"로 끝났다. 판정을 9KB 짜리 실행 껍데기
 * `llama-server.exe` 의 **존재**에만 걸어 둔 탓이다. 잘린 이미지는 실행 순간 Windows 가
 * `0xC000007B`(STATUS_INVALID_IMAGE_FORMAT) 로 되돌려보내, 모델을 다 받아 둔 사용자에게는
 * 정체 모를 16진수만 남는다.
 *
 * 그래서 검사의 조건은 두 가지다 — **잘린 것을 반드시 잡을 것**, 그리고 **멀쩡한 것을
 * 잘못 잡지 말 것**(오탐이 나면 정상 설치가 통째로 지워진다).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { truncatedImages } from './localEngineService.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-engine-integrity-'));
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

const PE_OFFSET = 0x80;
const OPT_SIZE = 240; // PE32+ 통상값 — 섹션 테이블 위치를 정하는 데만 쓴다
const RAW_OFFSET = 512;
const RAW_SIZE = 1024;
/** 섹션 테이블이 선언하는 이미지의 끝 = 이 파일이 온전하려면 있어야 하는 최소 길이. */
const DECLARED_END = RAW_OFFSET + RAW_SIZE;

/** 섹션 하나짜리 최소 PE 헤더를 만든다(파서가 보는 필드만 진짜로 채운다). */
function peHeader(): Buffer {
  const buf = Buffer.alloc(RAW_OFFSET);
  buf.writeUInt16LE(0x5a4d, 0); // 'MZ'
  buf.writeUInt32LE(PE_OFFSET, 0x3c);
  buf.writeUInt32LE(0x00004550, PE_OFFSET); // 'PE\0\0'
  buf.writeUInt16LE(0x8664, PE_OFFSET + 4); // machine = x64
  buf.writeUInt16LE(1, PE_OFFSET + 6); // NumberOfSections
  buf.writeUInt16LE(OPT_SIZE, PE_OFFSET + 20); // SizeOfOptionalHeader
  const table = PE_OFFSET + 24 + OPT_SIZE;
  buf.write('.text\0\0\0', table, 8, 'latin1');
  buf.writeUInt32LE(RAW_SIZE, table + 16); // SizeOfRawData
  buf.writeUInt32LE(RAW_OFFSET, table + 20); // PointerToRawData
  return buf;
}

/** `size` 바이트짜리 가짜 실행 이미지를 쓴다. `DECLARED_END` 보다 짧으면 잘린 것이다. */
function writeImage(name: string, size: number): string {
  const full = Buffer.alloc(Math.max(size, RAW_OFFSET));
  peHeader().copy(full);
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, full.subarray(0, size));
  return file;
}

// ─────────────────────────────────────────────────────────────
describe('truncatedImages — 잘린 엔진 파일 탐지', () => {
  it('선언된 길이를 채운 이미지는 잡지 않는다', () => {
    writeImage('llama-server-impl.dll', DECLARED_END);
    expect(truncatedImages(tmpDir)).toEqual([]);
  });

  it('잘린 이미지를 이름과 부족한 바이트 수로 잡는다', () => {
    writeImage('llama-server-impl.dll', DECLARED_END - 536);
    const bad = truncatedImages(tmpDir);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toContain('llama-server-impl.dll');
    expect(bad[0]).toContain('-536B');
  });

  it('멀쩡한 파일 여럿 사이에서 잘린 하나만 골라낸다 — 실제 사고의 모양', () => {
    writeImage('llama-server.exe', DECLARED_END); // 9KB 껍데기 자리 — 이건 늘 멀쩡했다
    writeImage('ggml-base.dll', DECLARED_END);
    writeImage('llama.dll', DECLARED_END);
    writeImage('llama-server-impl.dll', DECLARED_END - 700);
    const bad = truncatedImages(tmpDir);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toContain('llama-server-impl.dll');
    expect(bad[0]).toContain('-700B');
  });

  it('선언보다 긴 파일은 잡지 않는다 — 서명·부가 데이터가 뒤에 붙는 재배포 DLL 이 그렇다', () => {
    writeImage('libomp140.x86_64.dll', DECLARED_END + 10_080);
    expect(truncatedImages(tmpDir)).toEqual([]);
  });

  it('실행 이미지가 아닌 파일은 건드리지 않는다', () => {
    fs.writeFileSync(path.join(tmpDir, '.vibisual-engine.json'), '{"build":"b10509"}', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'model.gguf'), Buffer.alloc(64));
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'hello', 'utf8');
    expect(truncatedImages(tmpDir)).toEqual([]);
  });

  it('PE 가 아닌 dll 은 단정하지 않는다 — 못 읽는 것과 잘린 것은 다르다', () => {
    fs.writeFileSync(path.join(tmpDir, 'weird.dll'), Buffer.alloc(128));
    expect(truncatedImages(tmpDir)).toEqual([]);
  });

  it('없는 폴더는 조용히 빈 결과 — 검사가 설치 흐름을 깨뜨리면 안 된다', () => {
    expect(truncatedImages(path.join(tmpDir, 'nope'))).toEqual([]);
  });
});
