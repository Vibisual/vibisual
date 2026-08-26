import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  archToken,
  assetBackendToken,
  extractAttempts,
  isTarGzName,
  pickAsset,
  pickRelease,
  platformToken,
  truncatedImages,
  type ReleaseAsset,
  type ReleaseEntry,
} from './localEngineService.js';

/**
 * 이 파일이 없어서 P0 가 안 잡혔다.
 *
 * llama.cpp 가 릴리스 체계를 바꾸면서 `…/releases/latest` 자리에 **자산이 `nightly-tag.txt`
 * 하나뿐인** `v0.3.0` 이 앉았고(2026-08-26 실측), 그 순간부터 로컬 엔진 설치가 **전 플랫폼에서
 * 100% 실패**했다. 자산 이름은 우리가 어쩌지 못하는 남의 규약이라, 아래 픽스처는 실제 릴리스
 * 목록을 그대로 베껴 둔 것이다 — 규약이 또 바뀌면 이 픽스처부터 갱신하고 테스트를 다시 세운다.
 */

/** b10631(2026-08-26) 실측 자산 목록 — 이름만 그대로. */
const B10631_ASSET_NAMES = [
  'cudart-llama-bin-win-cuda-12.4-x64.zip',
  'cudart-llama-bin-win-cuda-13.3-x64.zip',
  'cudart-llama-bin-win-cuda-13.4-arm64.zip',
  'llama-b10631-bin-android-arm64.tar.gz',
  'llama-b10631-bin-macos-arm64.tar.gz',
  'llama-b10631-bin-macos-x64.tar.gz',
  'llama-b10631-bin-ubuntu-arm64.tar.gz',
  'llama-b10631-bin-ubuntu-openvino-2026.3-x64.tar.gz',
  'llama-b10631-bin-ubuntu-rocm-7.14-x64.tar.gz',
  'llama-b10631-bin-ubuntu-s390x.tar.gz',
  'llama-b10631-bin-ubuntu-sycl-fp16-x64.tar.gz',
  'llama-b10631-bin-ubuntu-sycl-fp32-x64.tar.gz',
  'llama-b10631-bin-ubuntu-vulkan-arm64.tar.gz',
  'llama-b10631-bin-ubuntu-vulkan-x64.tar.gz',
  'llama-b10631-bin-ubuntu-x64.tar.gz',
  'llama-b10631-bin-win-cpu-arm64.zip',
  'llama-b10631-bin-win-cpu-x64.zip',
  'llama-b10631-bin-win-cuda-12.4-x64.zip',
  'llama-b10631-bin-win-cuda-13.3-x64.zip',
  'llama-b10631-bin-win-cuda-13.4-arm64.zip',
  'llama-b10631-bin-win-opencl-adreno-arm64.zip',
  'llama-b10631-bin-win-openvino-2026.3-x64.zip',
  'llama-b10631-bin-win-rocm-7.14-x64.zip',
  'llama-b10631-bin-win-sycl-x64.zip',
  'llama-b10631-bin-win-vulkan-x64.zip',
  'llama-b10631-ui.tar.gz',
  'llama-b10631-xcframework.zip',
];

function asset(name: string): ReleaseAsset {
  return { name, browser_download_url: `https://example.invalid/${name}`, size: 1234 };
}

const B10631: ReleaseEntry = { tag_name: 'b10631', assets: B10631_ASSET_NAMES.map(asset) };
/** `latest` 가 가리키던 그 릴리스 — 자산이 `nightly-tag.txt` 하나뿐이다. */
const V030: ReleaseEntry = { tag_name: 'v0.3.0', assets: [asset('nightly-tag.txt')] };
const B10630: ReleaseEntry = {
  tag_name: 'b10630',
  assets: B10631_ASSET_NAMES.map((n) => asset(n.replace('b10631', 'b10630'))),
};

/** GitHub 이 실제로 돌려주는 순서(created_at 내림차순) — v0.3.0 이 두 번째에 낀다. */
const RELEASES: ReleaseEntry[] = [B10631, V030, B10630];

describe('pickRelease — nightly-tag.txt 뿐인 릴리스를 건너뛴다 (P0)', () => {
  it('windows/x64', () => {
    expect(pickRelease(RELEASES, 'win', 'x64')?.tag_name).toBe('b10631');
  });

  it('macos/arm64', () => {
    expect(pickRelease(RELEASES, 'macos', 'arm64')?.tag_name).toBe('b10631');
  });

  it('linux/x64', () => {
    expect(pickRelease(RELEASES, 'ubuntu', 'x64')?.tag_name).toBe('b10631');
  });

  it('v0.3.0 만 있으면 null — "자산 없음"을 조용한 성공으로 만들지 않는다', () => {
    expect(pickRelease([V030], 'win', 'x64')).toBeNull();
  });

  it('첫 릴리스에 이 플랫폼 자산이 없으면 다음 릴리스로 내려간다', () => {
    const macOnly: ReleaseEntry = { tag_name: 'b99999', assets: [asset('llama-b99999-bin-macos-arm64.tar.gz')] };
    expect(pickRelease([macOnly, B10631], 'win', 'x64')?.tag_name).toBe('b10631');
  });

  it('빈 목록은 null', () => {
    expect(pickRelease([], 'win', 'x64')).toBeNull();
  });
});

describe('pickAsset — 플랫폼별로 올바른 자산 하나', () => {
  const assets = B10631.assets ?? [];

  it('windows x64 vulkan (기본 백엔드)', () => {
    expect(pickAsset(assets, 'vulkan', 'win', 'x64')?.name).toBe('llama-b10631-bin-win-vulkan-x64.zip');
  });

  it('windows x64 cpu', () => {
    expect(pickAsset(assets, 'cpu', 'win', 'x64')?.name).toBe('llama-b10631-bin-win-cpu-x64.zip');
  });

  it('windows x64 cuda — 런타임 판올림이 붙은 이름에서 최신을 고른다', () => {
    expect(pickAsset(assets, 'cuda', 'win', 'x64')?.name).toBe('llama-b10631-bin-win-cuda-13.3-x64.zip');
  });

  it('windows arm64 cpu', () => {
    expect(pickAsset(assets, 'cpu', 'win', 'arm64')?.name).toBe('llama-b10631-bin-win-cpu-arm64.zip');
  });

  it('macOS arm64 — 이름에 백엔드가 없어 기본 빌드(Metal 포함)로 떨어진다', () => {
    expect(pickAsset(assets, 'vulkan', 'macos', 'arm64')?.name).toBe('llama-b10631-bin-macos-arm64.tar.gz');
  });

  it('macOS x64', () => {
    expect(pickAsset(assets, 'cpu', 'macos', 'x64')?.name).toBe('llama-b10631-bin-macos-x64.tar.gz');
  });

  it('macOS 는 vulkan·cpu 가 같은 자산으로 떨어진다 — 중복 다운로드 가드가 필요한 이유', () => {
    const a = pickAsset(assets, 'vulkan', 'macos', 'arm64')?.name;
    const b = pickAsset(assets, 'cpu', 'macos', 'arm64')?.name;
    expect(a).toBe(b);
  });

  it('linux x64 vulkan', () => {
    expect(pickAsset(assets, 'vulkan', 'ubuntu', 'x64')?.name).toBe('llama-b10631-bin-ubuntu-vulkan-x64.tar.gz');
  });

  it('linux x64 cpu — openvino/rocm/sycl 이 아니라 **기본 빌드**를 고른다', () => {
    // 종전 느슨한 폴백은 목록 앞머리의 openvino(100MB)를 집었다.
    expect(pickAsset(assets, 'cpu', 'ubuntu', 'x64')?.name).toBe('llama-b10631-bin-ubuntu-x64.tar.gz');
  });

  it('linux arm64 vulkan', () => {
    expect(pickAsset(assets, 'vulkan', 'ubuntu', 'arm64')?.name).toBe('llama-b10631-bin-ubuntu-vulkan-arm64.tar.gz');
  });

  it('linux arm64 cpu', () => {
    expect(pickAsset(assets, 'cpu', 'ubuntu', 'arm64')?.name).toBe('llama-b10631-bin-ubuntu-arm64.tar.gz');
  });

  it('자산이 nightly-tag.txt 뿐이면 null', () => {
    expect(pickAsset(V030.assets ?? [], 'cpu', 'win', 'x64')).toBeNull();
  });
});

describe('assetBackendToken — 남의 자산을 우리 것으로 착각하지 않는다', () => {
  it('cudart 재배포판은 절대 고르지 않는다(엔진이 아니다)', () => {
    expect(assetBackendToken('cudart-llama-bin-win-cuda-13.3-x64.zip', 'win', 'x64')).toBeNull();
  });

  it('android 자산은 linux 것이 아니다', () => {
    expect(assetBackendToken('llama-b10631-bin-android-arm64.tar.gz', 'ubuntu', 'arm64')).toBeNull();
  });

  it('ui / xcframework 처럼 os 토큰이 없는 자산은 제외', () => {
    expect(assetBackendToken('llama-b10631-ui.tar.gz', 'ubuntu', 'x64')).toBeNull();
    expect(assetBackendToken('llama-b10631-xcframework.zip', 'macos', 'arm64')).toBeNull();
  });

  it('아키텍처가 다르면 제외 (s390x 를 x64 로 읽지 않는다)', () => {
    expect(assetBackendToken('llama-b10631-bin-ubuntu-s390x.tar.gz', 'ubuntu', 'x64')).toBeNull();
    expect(assetBackendToken('llama-b10631-bin-win-cpu-arm64.zip', 'win', 'x64')).toBeNull();
  });

  it('백엔드 토큰이 없는 기본 빌드는 빈 문자열', () => {
    expect(assetBackendToken('llama-b10631-bin-ubuntu-x64.tar.gz', 'ubuntu', 'x64')).toBe('');
    expect(assetBackendToken('llama-b10631-bin-macos-arm64.tar.gz', 'macos', 'arm64')).toBe('');
  });

  it('압축 파일이 아니면 제외', () => {
    expect(assetBackendToken('llama-b10631-bin-win-vulkan-x64.exe', 'win', 'x64')).toBeNull();
    expect(assetBackendToken('nightly-tag.txt', 'win', 'x64')).toBeNull();
  });
});

describe('platformToken / archToken', () => {
  it('플랫폼 토큰', () => {
    expect(platformToken('win32')).toBe('win');
    expect(platformToken('darwin')).toBe('macos');
    expect(platformToken('linux')).toBe('ubuntu');
  });

  it('아키텍처 토큰 — arm64 아니면 전부 x64', () => {
    expect(archToken('arm64')).toBe('arm64');
    expect(archToken('x64')).toBe('x64');
    expect(archToken('ia32')).toBe('x64');
  });
});

describe('extractAttempts — .tar.gz 도 풀 수 있어야 한다', () => {
  it('tar.gz 판정', () => {
    expect(isTarGzName('llama-b10631-bin-macos-arm64.tar.gz')).toBe(true);
    expect(isTarGzName('x.tgz')).toBe(true);
    expect(isTarGzName('llama-b10631-bin-win-vulkan-x64.zip')).toBe(false);
  });

  it('macOS 는 tar 하나 — tar.gz 는 -xzf', () => {
    const a = extractAttempts('/tmp/x.tar.gz', '/dest', 'darwin');
    expect(a).toHaveLength(1);
    expect(a[0]?.cmd).toBe('tar');
    expect(a[0]?.args).toEqual(['-xzf', '/tmp/x.tar.gz', '-C', '/dest']);
  });

  it('linux 의 tar.gz 는 unzip 을 후보에 넣지 않는다(못 읽는다)', () => {
    const a = extractAttempts('/tmp/x.tar.gz', '/dest', 'linux');
    expect(a.map((x) => x.cmd)).toEqual(['tar']);
    expect(a[0]?.args?.[0]).toBe('-xzf');
  });

  it('linux 의 zip 은 unzip 먼저, tar 폴백', () => {
    const a = extractAttempts('/tmp/x.zip', '/dest', 'linux');
    expect(a.map((x) => x.cmd)).toEqual(['unzip', 'tar']);
    expect(a[1]?.args?.[0]).toBe('-xf');
  });

  it('windows 의 zip 은 System32 bsdtar → Expand-Archive → PATH tar', () => {
    const a = extractAttempts('C:/tmp/x.zip', 'C:/dest', 'win32', 'C:/Windows/System32/tar.exe');
    expect(a.map((x) => x.cmd)).toEqual(['C:/Windows/System32/tar.exe', 'powershell', 'tar']);
  });

  it('windows 의 tar.gz 는 Expand-Archive 를 건너뛴다(zip 전용이라 못 읽는다)', () => {
    const a = extractAttempts('C:/tmp/x.tar.gz', 'C:/dest', 'win32', 'C:/Windows/System32/tar.exe');
    expect(a.map((x) => x.cmd)).toEqual(['C:/Windows/System32/tar.exe', 'tar']);
    expect(a[0]?.args?.[0]).toBe('-xzf');
  });
});

// ─── 손상 파일 탐지 (mac/linux 는 종전에 **항상 빈 배열**이었다) ───

/** ELF64 리틀엔디언 헤더 — 섹션 테이블 끝이 `shoff + shentsize*shnum`. */
function elf64Header(shoff: number, shentsize: number, shnum: number): Buffer {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(0x7f454c46, 0);
  b[4] = 2; // ELF64
  b[5] = 1; // little-endian
  b[6] = 1; // version
  b.writeUInt16LE(2, 16);   // e_type = ET_EXEC
  b.writeUInt16LE(0x3e, 18); // e_machine = x86-64
  b.writeUInt32LE(1, 20);
  b.writeBigUInt64LE(BigInt(shoff), 40);
  b.writeUInt16LE(64, 52);
  b.writeUInt16LE(shentsize, 58);
  b.writeUInt16LE(shnum, 60);
  return b;
}

/** Mach-O 64 thin 헤더 + LC_SEGMENT_64 하나(`fileoff+filesize` 가 파일 끝을 말한다). */
function macho64Header(fileoff: number, filesize: number): Buffer {
  const b = Buffer.alloc(32 + 72);
  b.writeUInt32LE(0xfeedfacf, 0);
  b.writeUInt32LE(0x0100000c, 4);  // cputype = arm64
  b.writeUInt32LE(0, 8);
  b.writeUInt32LE(2, 12);          // MH_EXECUTE
  b.writeUInt32LE(1, 16);          // ncmds
  b.writeUInt32LE(72, 20);         // sizeofcmds
  const at = 32;
  b.writeUInt32LE(0x19, at);       // LC_SEGMENT_64
  b.writeUInt32LE(72, at + 4);     // cmdsize
  b.write('__TEXT', at + 8, 'ascii');
  b.writeBigUInt64LE(BigInt(fileoff), at + 40);
  b.writeBigUInt64LE(BigInt(filesize), at + 48);
  return b;
}

/** 헤더 + 뒤를 0 으로 채워 `total` 바이트짜리 파일을 만든다. */
function writeImage(dir: string, name: string, header: Buffer, total: number): void {
  const buf = Buffer.alloc(Math.max(total, header.length));
  header.copy(buf, 0);
  fs.writeFileSync(path.join(dir, name), buf.subarray(0, total));
}

describe('truncatedImages — mac/linux 반쪽 파일을 실제로 잡는다', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-engine-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('온전한 ELF 는 신고하지 않는다', () => {
    writeImage(dir, 'libggml.so', elf64Header(1000, 64, 4), 1256);
    expect(truncatedImages(dir)).toEqual([]);
  });

  it('잘린 ELF 는 부족한 바이트와 함께 신고한다', () => {
    writeImage(dir, 'libggml.so', elf64Header(1000, 64, 4), 1200);
    expect(truncatedImages(dir)).toEqual(['libggml.so (-56B)']);
  });

  it('온전한 Mach-O 는 신고하지 않는다', () => {
    writeImage(dir, 'libggml.dylib', macho64Header(0, 900), 900);
    expect(truncatedImages(dir)).toEqual([]);
  });

  it('잘린 Mach-O 는 신고한다 — 확장자가 .dylib 라도 본다', () => {
    writeImage(dir, 'libggml.dylib', macho64Header(0, 900), 800);
    expect(truncatedImages(dir)).toEqual(['libggml.dylib (-100B)']);
  });

  it('확장자 없는 POSIX 실행본(llama-server)도 본다', () => {
    writeImage(dir, 'llama-server', macho64Header(0, 900), 800);
    expect(truncatedImages(dir)).toEqual(['llama-server (-100B)']);
  });

  it('우리가 모르는 형식(텍스트·메타)은 손대지 않는다', () => {
    fs.writeFileSync(path.join(dir, '.vibisual-engine.json'), JSON.stringify({ build: 'b10631' }));
    fs.writeFileSync(path.join(dir, 'README.md'), 'hello'.repeat(100));
    expect(truncatedImages(dir)).toEqual([]);
  });

  it('없는 폴더는 빈 배열', () => {
    expect(truncatedImages(path.join(dir, 'nope'))).toEqual([]);
  });
});
