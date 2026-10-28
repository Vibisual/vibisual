/**
 * Mach-O 실행본의 아키텍처 판정 — macOS `self-install` 업데이트 안전장치. 이름·피드는 믿지 않는다 — 두 mac 잡이 `latest-mac.yml` 을
 * 서로 덮어 한쪽만 남는다(실측 v0.1.14: arm64 없음). 어긋나면 `koffi` 가 바이너리를 못 찾아 앱이 뜨자마자 죽으므로 받은 실행본의 cputype 을 본다.
 * ⚠️ 브라우저에서도 로드되므로 `process.arch` 는 인자로 받는다(thin x64·thin arm64·universal 을 한 기계에서 잰다).
 */

/** 우리가 배포하는 아키텍처. `process.arch` 가 주는 값과 같은 표기. */
export type ProcessArch = 'x64' | 'arm64';

/** 바이너리에서 읽어 낸 아키텍처. 우리가 모르는 cputype 은 `other` 로 접는다. */
export type MachoArch = ProcessArch | 'other';

/** 헤더 판정용 앞부분 바이트 수 — thin 8바이트, fat 은 `nfat_arch × 32` 더. 4KB 면 universal 도 남는다(170MB 를 통째로 읽지 않게). */
export const MACHO_HEADER_PROBE_BYTES = 4096;

// 매직. thin 은 앞 4바이트를 두 바이트 순서로 다 읽어 맞는 쪽을 보므로 뒤집힌 상수(MH_CIGAM)는 없다. fat 헤더는 늘 빅엔디언.
const MH_MAGIC = 0xfeedface; // 32비트
const MH_MAGIC_64 = 0xfeedfacf; // 64비트
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;

// cputype. 64비트 비트(0x01000000)가 붙은 값이 우리가 쓰는 것이다.
const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM64 = 0x0100000c;

function u32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  if (offset + 4 > bytes.length) return -1;
  // `?? 0` — 길이는 위에서 이미 봤지만, 인덱스 접근이 undefined 를 낼 수 있다는 타입 규칙
  // (noUncheckedIndexedAccess)을 단언(`!`)으로 덮지 않고 값으로 만족시킨다.
  const a = bytes[offset] ?? 0;
  const b = bytes[offset + 1] ?? 0;
  const c = bytes[offset + 2] ?? 0;
  const d = bytes[offset + 3] ?? 0;
  // `>>> 0` — 최상위 비트가 선 값(0xfeedfacf 등)이 음수로 접히지 않게 부호를 벗긴다.
  return littleEndian ? ((d << 24) | (c << 16) | (b << 8) | a) >>> 0 : ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function cpuTypeToArch(cpuType: number): MachoArch {
  if (cpuType === CPU_TYPE_X86_64) return 'x64';
  if (cpuType === CPU_TYPE_ARM64) return 'arm64';
  return 'other';
}

/** 앞부분에서 담긴 아키텍처 목록을 읽는다(thin 하나, fat 은 담긴 만큼). Mach-O 아님·잘림 = 빈 배열 = 모름(`isArchCompatible` 이 막는다). */
export function readMachoArchs(head: Uint8Array): MachoArch[] {
  if (head.length < 8) return [];
  const magicBE = u32(head, 0, false);

  // ── fat(universal) — 헤더는 항상 빅엔디언 ────────────────────────────────
  if (magicBE === FAT_MAGIC || magicBE === FAT_MAGIC_64) {
    const is64 = magicBE === FAT_MAGIC_64;
    const count = u32(head, 4, false);
    // 터무니없는 개수는 fat 헤더가 아니거나 잘린 것이다 — 통째로 모른다고 답한다.
    if (count <= 0 || count > 64) return [];
    const entrySize = is64 ? 32 : 20;
    const archs: MachoArch[] = [];
    for (let i = 0; i < count; i++) {
      const at = 8 + i * entrySize;
      if (at + 4 > head.length) return []; // 잘렸다 — 일부만 읽고 "다 봤다"고 하면 안 된다
      archs.push(cpuTypeToArch(u32(head, at, false)));
    }
    return archs;
  }

  // ── thin ────────────────────────────────────────────────────────────────
  const magicLE = u32(head, 0, true);
  if (magicBE === MH_MAGIC || magicBE === MH_MAGIC_64) return [cpuTypeToArch(u32(head, 4, false))];
  if (magicLE === MH_MAGIC || magicLE === MH_MAGIC_64) return [cpuTypeToArch(u32(head, 4, true))];

  return [];
}

/**
 * 지금 도는 아키텍처에 설치해도 되는가 — 정확히 일치할 때만(Rosetta 로 돌아도 `koffi` 가 설치 시점 것뿐이라 main 이 즉사한다).
 * Rosetta 아래 앱의 `process.arch` 는 `'x64'` — 아키텍처 전환은 업데이트가 아니라 재설치의 일이다.
 */
export function isArchCompatible(binaryArchs: readonly MachoArch[], runningArch: ProcessArch): boolean {
  if (binaryArchs.length === 0) return false; // 모르면 통과시키지 않는다
  return binaryArchs.includes(runningArch);
}

/** `process.arch` 문자열 → 우리가 다루는 아키텍처. 그 외는 null(= 설치 대상 아님). */
export function toProcessArch(raw: string): ProcessArch | null {
  return raw === 'x64' || raw === 'arm64' ? raw : null;
}
