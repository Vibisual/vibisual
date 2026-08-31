/**
 * 업데이트 전달 방식 판정 SSOT.
 *
 * §4 v2.44 자동 업데이트는 오랫동안 **전 플랫폼 동일 경로**였다 — `autoDownload=true`,
 * `autoInstallOnAppQuit=true` 를 하드코딩하고 macOS 도 같은 길을 탔다. 그런데 두 OS 의
 * 서명 요건이 다르다:
 *
 * - **Windows**: electron-updater 의 `publisherName` 검증이 **선택**이다. 설정하지 않으면
 *   검증을 건너뛰므로 무서명 빌드도 자동 업데이트가 정상 동작한다(SmartScreen 경고는
 *   설치 시점의 별개 문제라 업데이트 동작을 막지 않는다).
 * - **macOS**: electron-updater 의 백엔드인 Squirrel.Mac 이 코드 서명 검증을 **강제**한다.
 *   서명이 없으면 새 빌드를 **다운로드까지 성공한 뒤 적용 단계에서 반드시 실패**하고,
 *   사용자에게는 "업데이트 오류"만 남는다. 설정으로 우회할 수 없다.
 *
 * 그런데 그 강제 검증은 **Squirrel 의 적용 경로 안**에 있고, Gatekeeper 의 첫 실행 차단을
 * 발동시키는 것은 서명이 아니라 `com.apple.quarantine` **속성**이며 그 속성은 **파일을 받은
 * 프로그램이 붙인다**(브라우저는 붙이고 CLI·Node 는 안 붙인다). 그래서 **받는 것도 적용하는
 * 것도 우리가 하면 둘 다 발동하지 않는다** — 무서명 macOS 는 `self-install` 로 간다.
 * 종전 `notify-only`(알리고 릴리스 페이지 열기)는 걷어냈다(사용자 명시 결정 — 대체).
 * Developer ID 서명 + 공증을 붙이면 `macCodeSigned` 를 켜서 `auto-install` 로 승격한다.
 *
 * ⚠️ shared 는 브라우저에서도 로드되므로 `process.platform` 을 직접 읽지 않는다
 * (`pathCase.ts` 머리말과 같은 규약) — **플랫폼을 인자로 받는다.** 그래야 개발기 한 대에서
 * 세 OS 판정을 전부 단위 테스트할 수 있다(CLAUDE.md 멀티플랫폼 규칙).
 */

import type { PlatformName } from './pathCase.js';
import type { ProcessArch } from './machoArch.js';
import type { UpdateDelivery } from './types.js';

/**
 * GitHub Releases 페이지 베이스.
 * ⚠️ `packages/desktop/electron-builder.yml` 의 `publish`(owner=Vibisual, repo=vibisual)와 **짝**이다.
 * 저장소를 옮기면(예: 개인 User → Organization 전환으로 소유자가 바뀌면) 두 곳을 함께 고쳐야 한다.
 */
export const RELEASES_PAGE_BASE = 'https://github.com/Vibisual/vibisual/releases';

export interface UpdateDeliveryInput {
  /** `process.platform` 값. 함수 안에서 직접 읽지 않는다 — 위 머리말 참조. */
  platform: PlatformName;
  /**
   * 이 빌드의 macOS 바이너리에 **Developer ID 서명 + 공증**이 붙어 있는가.
   * 기본 `false` — `electron-builder.yml` 의 mac 섹션에 서명 설정이 없는 한 그대로 둔다.
   * 서명을 배선하는 라운드에서 이 값을 켜야 mac 이 `auto-install` 로 돌아온다.
   */
  macCodeSigned?: boolean;
}

/**
 * 이 플랫폼에서 업데이트를 어떻게 적용할지 판정한다.
 *
 * - 무서명 macOS → `'self-install'` (우리가 직접 받아 직접 교체 — Squirrel 을 타지 않는다)
 * - 그 외(Windows·Linux·서명된 macOS) → `'auto-install'`
 */
export function resolveUpdateDelivery({
  platform,
  macCodeSigned = false,
}: UpdateDeliveryInput): UpdateDelivery {
  if (platform === 'darwin' && !macCodeSigned) return 'self-install';
  return 'auto-install';
}

/**
 * 릴리스 페이지 URL. 버전을 주면 그 태그로, 없으면 `latest` 로.
 * `self-install` 이 실패했을 때 **복구 손잡이**가 여는 주소다(전달 방식이 아니다).
 */
export function releasesPageUrl(version?: string | null): string {
  const raw = (version ?? '').trim();
  if (!raw) return `${RELEASES_PAGE_BASE}/latest`;
  const tag = raw.startsWith('v') ? raw : `v${raw}`;
  return `${RELEASES_PAGE_BASE}/tag/${encodeURIComponent(tag)}`;
}

/**
 * 상태에 실린 `delivery` 를 읽는 단일 창구.
 * 신규 전송 필드는 항상 optional 이므로(§3 하위 호환) **미설정이면 `auto-install`** 로 본다 —
 * 구버전 main 이 보낸 상태를 신버전 renderer 가 읽어도 종전 동작 그대로다.
 */
export function readUpdateDelivery(delivery: UpdateDelivery | undefined): UpdateDelivery {
  return delivery ?? 'auto-install';
}


/**
 * 릴리스 자산 직접 다운로드 베이스. `RELEASES_PAGE_BASE` 와 **짝**이다.
 * (GitHub 규약: `.../releases/download/<tag>/<asset>`)
 */
export const RELEASES_DOWNLOAD_BASE = `${RELEASES_PAGE_BASE}/download`;

/**
 * 이 아키텍처가 받아야 할 macOS dmg 파일 이름.
 *
 * ⚠️ **`latest-mac.yml` 의 `files` 목록을 쓰지 않는 이유.** 우리 릴리스는 아키텍처마다 다른
 * 러너에서 지어지고 두 mac 잡이 **같은 이름의 피드를 각자 올려 서로 덮는다** — 그래서 발행된
 * 피드에는 늦게 끝난 쪽 아키텍처만 남는다(실측: v0.1.14 피드에 arm64 두 파일이 통째로 없다).
 * 피드는 **버전 감지에만** 쓰고 파일은 여기서 규약으로 고른다.
 *
 * ⚠️ 이름 규약은 `packages/desktop/electron-builder.yml` 의 mac 타깃 기본값과 **짝**이다 —
 * arm64 는 `-arm64` 접미사가 붙고 x64 는 **접미사가 없다**. 그쪽을 고치면 여기도 고쳐야 한다.
 * 그래도 이름만 믿지 않는다 — 받은 번들은 `readMachoArchs` 로 다시 검사한다.
 */
export function macUpdateAssetName(version: string, arch: ProcessArch): string {
  const v = version.trim().replace(/^v/, '');
  return arch === 'arm64' ? `Vibisual-${v}-arm64.dmg` : `Vibisual-${v}.dmg`;
}

/** 그 dmg 의 다운로드 주소. */
export function macUpdateAssetUrl(version: string, arch: ProcessArch): string {
  const v = version.trim().replace(/^v/, '');
  return `${RELEASES_DOWNLOAD_BASE}/v${v}/${macUpdateAssetName(v, arch)}`;
}