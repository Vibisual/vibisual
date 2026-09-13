import type { ServerEntry } from '@vibisual/shared';

/**
 * §7.11 포트 인계 — Restart/Start 를 눌러도 되는가, 안 되면 왜 안 되는가.
 *
 * `ServerList`(목록의 작은 ⟳)와 `IframeServerCard`(버블 상세의 Restart/Start)가 **같은 규칙**을
 * 써야 한다 — 같은 서버가 한 화면에서는 눌리고 다른 화면에서는 회색이면 사용자는 둘 중 어느 쪽이
 * 진짜인지 알 수 없다. 그래서 판정을 컴포넌트 밖 한 곳에 둔다.
 *
 * 규칙: 에이전트가 신고해 알게 된 서버(`reportedOnly`)라도 **그 프로세스가 살아 있으면 연다.**
 * 서버가 OS 프로세스 테이블에서 기동 명령을 읽어 인계(takeover)한 뒤 재시작하기 때문이다.
 * 영구 불가는 둘뿐 — ① 이미 꺼져 읽어 올 프로세스가 없다 ② 읽기를 시도했다가 실패했다.
 */
export interface RespawnGate {
  canRespawn: boolean;
  /** 버튼 툴팁으로 쓸 i18n 키. */
  titleKey: string;
}

export function serverRespawnGate(
  entry: ServerEntry | null | undefined,
  action: 'restart' | 'start',
  /**
   * 그 서버 프로세스가 지금 살아 있나. 기본값은 entry 자신의 판정이고, iframe 카드는 위성의
   * `iframeAlive` 도 함께 넘긴다(위성 스윕이 entry 갱신보다 앞설 때가 있다).
   */
  processUp: boolean = entry?.alive === true,
): RespawnGate {
  if (!entry) return { canRespawn: false, titleKey: 'panel.serverList.noEntry' };
  if (entry.reportedOnly !== true) {
    return { canRespawn: true, titleKey: `panel.serverList.${action}` };
  }
  if (processUp && entry.takeoverFailed !== true) {
    return { canRespawn: true, titleKey: 'panel.serverList.takeover' };
  }
  return {
    canRespawn: false,
    titleKey: entry.takeoverFailed === true
      ? 'panel.serverList.takeoverFailed'
      : 'panel.serverList.noCommand',
  };
}
