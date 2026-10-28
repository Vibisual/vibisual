import type { ServerEntry } from '@vibisual/shared';

/**
 * §7.11 포트 인계 — Restart/Start 가능 여부·이유. `ServerList`·`IframeServerCard` 가 같은 판정을 쓰도록 한 곳에 둔다.
 * `reportedOnly` 도 프로세스가 살아 있으면 연다(서버가 OS 프로세스 표에서 기동 명령을 읽어 인계한다). 영구 불가는 이미 꺼짐 · 읽기 실패 둘뿐.
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
