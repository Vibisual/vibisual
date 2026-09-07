/**
 * 업데이트 피드를 **어디서 받을 것인가**를 정하는 순수 판정.
 *
 * ## 왜 GitHub 을 직접 안 보고 한 겹을 두는가
 *
 * 데스크톱 앱에서 "쓰는 사람이 몇인가"를 재는 업계 통상 경로는 **업데이트 확인 요청의 서버
 * 로그**다. 앱은 어차피 주기적으로 새 버전을 물어야 하므로 그 요청은 이미 존재하고, 따라서
 * 새로 수집을 시작하는 것이 아니다(= 텔레메트리를 새로 붙이는 것과 성격이 다르다).
 *
 * 그런데 우리는 그 요청을 GitHub 에 곧장 보내고 있어서, 남는 것이 `latest.yml` 의
 * **다운로드 횟수 한 숫자**뿐이었다. 그 숫자로는 "1대가 자주 물었나, 여럿이 한 번씩 물었나"를
 * 가를 수 없다(실측 2026-09-07: 두 달간 하루 4~7회로 평평 — 상시 켜 둔 1대의 4시간 주기와
 * 구분되지 않는다). 사이에 우리 것 한 겹을 두면 그 구분이 생긴다.
 *
 * ## 실제로 바뀌는 것은 주소 한 줄뿐이다
 *
 * 프록시는 `latest*.yml` 을 그대로 넘겨주고, 설치 파일 요청은 GitHub 자산으로 302 로 돌린다.
 * 즉 **받는 파일도, 무결성 검사(`latest*.yml` 의 sha512)도, 설치 경로도 종전과 같다.**
 * 파일이 우리 대역폭을 지나가지 않으므로 비용도 늘지 않고, 자산 다운로드 수는 여전히
 * GitHub 에 남는다(그 숫자는 CI 를 걷어낸 뒤라 이제 사용자 것만 센다).
 *
 * ## 안전 규칙 셋 — 이 판정이 존재하는 이유
 *
 * 1. **비어 있으면 아무것도 하지 않는다.** 배포 전 기본값이 그것이라, 프록시를 세우기 전까지
 *    앱 동작은 종전과 **완전히 같다**(`setFeedURL` 을 아예 호출하지 않는다).
 * 2. **https 만 받는다.** 업데이트 피드는 "다음에 무엇을 설치할지"를 정하는 채널이다. 평문으로
 *    받으면 중간에서 바꿔치기할 수 있고, 그러면 sha512 검사는 **바뀐 yml 의 해시**를 검사하므로
 *    아무것도 막지 못한다. 예외는 `localhost`/`127.0.0.1` — 프록시를 손으로 시험하는 자리다.
 * 3. **닿지 않으면 GitHub 으로 되돌아간다.** 프록시가 죽어도 업데이트는 계속돼야 한다. 호출자가
 *    먼저 확인해서 `reachable: false` 를 넘기면 이 함수가 기본 피드를 고른다.
 */

import type { PlatformName } from './pathCase.js';

/**
 * 이 플랫폼의 업데이트 피드 파일 이름. electron-builder 가 릴리스에 올리는 이름과 같다.
 *
 * ⚠️ shared 는 브라우저에서도 로드되므로 `process.platform` 을 직접 읽지 않는다 —
 * 플랫폼은 인자로 받는다(`updateDelivery.ts` 와 같은 규율).
 */
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
