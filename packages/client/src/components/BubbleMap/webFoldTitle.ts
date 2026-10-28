import type { TFunction } from 'i18next';
import type { WebFoldInfo } from '@vibisual/shared';

/**
 * §5.23 — 접힌 웹 버블의 제목. 캔버스(`BubbleNode`)와 패널 머리(`DetailPanel`)가 이 한 함수를 본다(§7.22 — 따로면 이름이 갈린다).
 * 사이트 묶음의 사이트명은 고유명이라 번역하지 않는다.
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
