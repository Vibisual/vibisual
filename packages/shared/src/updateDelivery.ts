/**
 * 업데이트 전달 방식 판정 SSOT. Windows 는 `publisherName` 검증이 선택이라 무서명도 자동 업데이트가 된다.
 * macOS 는 Squirrel.Mac 이 적용 단계에서 서명을 강제해 무서명 빌드가 반드시 실패한다. 그런데 Gatekeeper 를 부르는 `com.apple.quarantine` 은 받은 프로그램이 붙이는 속성이라
 * (브라우저는 붙이고 CLI·Node 는 안 붙인다) 받기·적용을 우리가 하면 둘 다 피한다 — 무서명 macOS 는 `self-install`, 서명 + 공증이면 `macCodeSigned` 로 `auto-install`.
 * ⚠️ shared 는 브라우저에서도 로드되므로 `process.platform` 을 읽지 않고 플랫폼을 인자로 받는다(세 OS 판정을 단위 테스트하려고).
 */

import type { PlatformName } from './pathCase.js';
import type { ProcessArch } from './machoArch.js';
import type { UpdateDelivery } from './types.js';

/** GitHub Releases 페이지 베이스. ⚠️ `packages/desktop/electron-builder.yml` 의 `publish`(owner/repo)와 짝 — 저장소를 옮기면 두 곳을 함께 고친다. */
export const RELEASES_PAGE_BASE = 'https://github.com/Vibisual/vibisual/releases';

export interface UpdateDeliveryInput {
  /** `process.platform` 값. 함수 안에서 직접 읽지 않는다 — 위 머리말 참조. */
  platform: PlatformName;
  /** 이 빌드의 macOS 바이너리에 Developer ID 서명 + 공증이 붙었는가. 기본 `false` — 서명을 배선할 때 켜야 mac 이 `auto-install` 로 돌아온다. */
  macCodeSigned?: boolean;
}

/** 무서명 macOS → `'self-install'`(Squirrel 을 타지 않는다), 그 외 → `'auto-install'`. */
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
 * 이 아키텍처가 받을 macOS dmg 이름. ⚠️ `latest-mac.yml` 의 `files` 는 쓰지 않는다 — 두 mac 잡이 같은 이름의 피드를 덮어 늦게 끝난 쪽만 남는다(실측 v0.1.14: arm64 없음).
 * ⚠️ 이름 규약은 `electron-builder.yml` mac 타깃 기본값과 짝(arm64 `-arm64`, x64 접미사 없음). 그래도 받은 번들을 `readMachoArchs` 로 다시 검사한다.
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