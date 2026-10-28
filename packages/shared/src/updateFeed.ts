/**
 * 업데이트 피드를 어디서 받을지 정하는 순수 판정. GitHub 직행이면 `latest.yml` 다운로드 수만 남아 1대인지 여럿인지 못 가린다(상시 켜 둔 1대가 4시간 주기로 하루 6회).
 * 그래서 사이에 프록시 한 겹을 둔다(이미 있는 확인 요청이라 새 수집이 아니다) — yml 은 그대로, 설치 파일은 GitHub 자산으로 302 라 파일·sha512 검사·설치 경로·비용이 그대로다.
 * ① 비어 있으면 `setFeedURL` 을 부르지 않는다(배포 전 기본) ② https 만 — 평문 피드가 바꿔치기되면 sha512 도 바뀐 yml 을 검사해 못 막는다(예외 `localhost`·`127.0.0.1`)
 * ③ 닿지 않으면(`reachable: false`) 기본 GitHub 피드로 되돌아간다.
 */

import type { PlatformName } from './pathCase.js';

/** 이 플랫폼의 업데이트 피드 파일 이름(electron-builder 가 올리는 이름). 플랫폼은 인자로 받는다(shared 는 브라우저에서도 로드된다). */
export function updateFeedFileName(platform: PlatformName): string {
  if (platform === 'darwin') return 'latest-mac.yml';
  if (platform === 'win32') return 'latest.yml';
  return 'latest-linux.yml';
}

export interface UpdateFeedInput {
  /** 빌드에 박아 두는 프록시 주소(`UPDATE_FEED_URL`). 비어 있으면 GitHub 기본 피드. */
  configured?: string | undefined;
  /** 실행 시 덮어쓰는 값(`VIBISUAL_UPDATE_FEED_URL`) — 자체 호스팅·시험용. 있으면 이쪽이 이긴다. */
  override?: string | undefined;
  /** 프록시가 실제로 응답했는가. 확인하지 않았으면 `undefined`(= 아직 모름 → 채택). */
  reachable?: boolean | undefined;
}

export type UpdateFeedChoice =
  /** 종전 그대로 — `app-update.yml` 에 구워진 GitHub 프로바이더를 쓴다(`setFeedURL` 호출 ❌). */
  | { kind: 'default'; reason: 'not-configured' | 'invalid' | 'insecure' | 'unreachable' }
  /** 우리 프록시를 generic 프로바이더로 건다. */
  | { kind: 'generic'; url: string };

/** 뒤 슬래시를 떼어 `<base>/latest.yml` 조립이 항상 한 가지 모양이 되게 한다. */
function normalize(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

export function resolveUpdateFeed(input: UpdateFeedInput): UpdateFeedChoice {
  const raw = normalize(input.override ?? '') || normalize(input.configured ?? '');
  if (!raw) return { kind: 'default', reason: 'not-configured' };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { kind: 'default', reason: 'invalid' };
  }

  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback(parsed.hostname))) {
    return { kind: 'default', reason: 'insecure' };
  }

  // `reachable` 을 재 보고 안 되면 기본 피드로. 안 재 봤으면(undefined) 그대로 채택한다.
  if (input.reachable === false) return { kind: 'default', reason: 'unreachable' };

  return { kind: 'generic', url: normalize(parsed.toString()) };
}
