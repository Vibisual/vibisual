/**
 * Mach-O 실행본의 아키텍처 판정 SSOT — macOS `self-install` 업데이트의 안전장치.
 *
 * **왜 파일 이름을 안 믿는가.** 우리 릴리스는 아키텍처마다 다른 러너에서 지어지고, 두 mac 잡이
 * `latest-mac.yml` 이라는 **같은 이름의 피드를 각자 올려 서로 덮는다** — 그래서 발행된 피드에는
 * 한쪽 아키텍처만 남는다(실측: v0.1.14 피드에 arm64 두 파일이 통째로 없다). 이름·피드를 믿고
 * 받으면 Apple Silicon 에 Intel 빌드가 깔리는데, 그 앱은 `koffi` 가 제 바이너리를 못 찾아
 * **뜨자마자 죽는다**(빌드는 초록, 앱은 실행 불가 — 이 저장소가 한 번 겪은 사고다).
 * 그래서 교체를 시작하기 전에 **받은 번들의 실행본을 직접 열어** cputype 을 확인한다.
 *
 * ⚠️ shared 는 브라우저에서도 로드되므로 `process.arch` 를 함수 안에서 읽지 않는다
 * (`pathCase.ts`·`updateDelivery.ts` 와 같은 규약) — **아키텍처를 인자로 받는다.** 그래야
 * 실기(mac)가 없는 개발기 한 대에서 thin x64 · thin arm64 · universal 세 경우를 전부 잰다.
 */

/** 우리가 배포하는 아키텍처. `process.arch` 가 주는 값과 같은 표기. */
export type ProcessArch = 'x64' | 'arm64';

/** 바이너리에서 읽어 낸 아키텍처. 우리가 모르는 cputype 은 `other` 로 접는다. */
export type MachoArch = ProcessArch | 'other';

/**
 * 헤더 판정에 필요한 앞부분 바이트 수.
 * thin 은 8바이트면 끝나고, fat 은 `nfat_arch × 32바이트`가 더 필요하다. 실제 universal 빌드의
 * 아키텍처 수는 한 자리라 4KB 면 남는다 — 170MB 를 통째로 읽지 않기 위한 상한이다.
 */
export const MACHO_HEADER_PROBE_BYTES = 4096;

// Mach-O 매직. thin 헤더의 바이트 순서는 매직 자체가 알려 준다 — 앞 4바이트를 **두 순서로 다 읽어**
// 어느 쪽이 매직과 맞는지 보면 되므로(아래 참조) 뒤집힌 상수(MH_CIGAM 계열)는 따로 두지 않는다.
// fat 헤더는 **항상 빅엔디언**이라 뒤집어 읽지 않는다.
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

/**
 * Mach-O 실행본 앞부분에서 담긴 아키텍처 목록을 읽는다.
 *
 * - thin  : 한 개 (`['arm64']`)
 * - fat   : 담긴 만큼 (`['x64','arm64']` — universal)
 * - Mach-O 가 아니거나 헤더가 잘렸으면 **빈 배열**. 빈 배열은 "모른다"이고,
 *   `isArchCompatible` 은 모르는 것을 통과시키지 않는다.
 */
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
 * 이 번들을 지금 도는 아키텍처에 설치해도 되는가.
 *
 * **정확히 일치할 때만 통과한다.** Rosetta 로 x64 를 arm64 기기에서 돌릴 수는 있지만, 그건
 * 우리가 노릴 상태가 아니다 — 네이티브 모듈(`koffi`)이 설치 시점 아키텍처 것만 들어 있어
 * 어긋나면 main 프로세스가 즉사한다. 판정 기준을 "돌아가기는 하는가"가 아니라
 * "우리가 지은 그 짝인가"로 둔다.
 *
 * ⚠️ Rosetta 로 도는 앱의 `process.arch` 는 `'x64'` 다 — 그 사용자는 x64 빌드를 받아 x64 로
 * 계속 간다. 아키텍처를 바꿔 태우는 것은 업데이트가 할 일이 아니라 재설치가 할 일이다.
 */
export function isArchCompatible(binaryArchs: readonly MachoArch[], runningArch: ProcessArch): boolean {
  if (binaryArchs.length === 0) return false; // 모르면 통과시키지 않는다
  return binaryArchs.includes(runningArch);
}

/** `process.arch` 문자열 → 우리가 다루는 아키텍처. 그 외는 null(= 설치 대상 아님). */
export function toProcessArch(raw: string): ProcessArch | null {
  return raw === 'x64' || raw === 'arm64' ? raw : null;
}
