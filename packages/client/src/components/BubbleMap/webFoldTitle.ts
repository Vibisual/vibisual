import type { TFunction } from 'i18next';
import type { WebFoldInfo } from '@vibisual/shared';

/**
 * §5.23 웹 버블 묶기 — 접힌 웹 버블의 **제목**. 캔버스 버블(`BubbleNode`)과 패널 머리(`DetailPanel`)가 이 한 함수를
 * 본다 — 두 자리가 따로 고르면 같은 버블을 캔버스와 패널이 다른 이름으로 부른다(§7.22).
 *
 * 제목은 무엇으로 묶었는지를 말한다: 사이트 묶음은 사이트(`github.com` — 고유명이라 번역하지 않는다), 종류 묶음은 그
 * 종류("문서"), 다른 묶음 옆에 남은 나머지는 "그 밖의 웹", 그 에이전트의 전부를 품은 묶음은 종전대로 "웹".
 */
export function webFoldTitle(fold: WebFoldInfo, t: TFunction): string {
  switch (fold.scope) {
    case 'site':
      return fold.site ?? t('ide.stage.surfaceName.web');
    case 'kind':
      return fold.kind ? t(`canvas.webFold.kind.${fold.kind}`) : t('ide.stage.surfaceName.web');
    case 'rest':
      return t('canvas.webFold.rest');
    default:
      return t('ide.stage.surfaceName.web');
  }
}
