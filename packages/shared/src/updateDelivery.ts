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
 * 그래서 무서명 macOS 에서는 헛다운로드 대신 **알리기만** 하고 릴리스 페이지로 보낸다.
 * Developer ID 서명 + 공증을 붙이면 `macCodeSigned` 를 켜서 `auto-install` 로 승격한다.
 *
 * ⚠️ shared 는 브라우저에서도 로드되므로 `process.platform` 을 직접 읽지 않는다
 * (`pathCase.ts` 머리말과 같은 규약) — **플랫폼을 인자로 받는다.** 그래야 개발기 한 대에서
 * 세 OS 판정을 전부 단위 테스트할 수 있다(CLAUDE.md 멀티플랫폼 규칙).
 */

import type { PlatformName } from './pathCase.js';
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
 * - 무서명 macOS → `'notify-only'` (Squirrel.Mac 이 적용을 거부하므로 알리기만)
 * - 그 외(Windows·Linux·서명된 macOS) → `'auto-install'`
 */
export function resolveUpdateDelivery({
  platform,
  macCodeSigned = false,
}: UpdateDeliveryInput): UpdateDelivery {
  if (platform === 'darwin' && !macCodeSigned) return 'notify-only';
  return 'auto-install';
}

/**
 * 릴리스 페이지 URL. 버전을 주면 그 태그로, 없으면 `latest` 로.
 * `notify-only` 플랫폼에서 "업데이트" 버튼이 여는 주소다.
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
