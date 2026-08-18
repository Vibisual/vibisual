import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ContextSourceItem } from '@vibisual/shared';
import { aboutKeyCandidates, type ContextAboutField } from './contextSourceAbout.js';

/**
 * §5.5 #17-28 ⑦ — 주입원 한 줄의 설명을 **번역해서** 꺼내 주는 자리.
 *
 * 후보 키를 앞에서부터 훑어 있는 첫 것을 쓴다(전용 설명 → 분류 설명). 목록의 호버 툴팁과 상세창이
 * 같은 문장을 보게 하려면 이 판정이 한 곳이어야 한다 — 두 벌이면 같은 줄이 자리마다 다른 말을 한다.
 */
export function useContextAbout(): (item: Pick<ContextSourceItem, 'id' | 'category' | 'title'>, field: ContextAboutField) => string {
  const { t, i18n } = useTranslation();
  return useCallback(
    (item, field) => {
      for (const key of aboutKeyCandidates(item.id, item.category, field)) {
        if (i18n.exists(key)) return t(key, { name: item.title });
      }
      return '';
    },
    [t, i18n],
  );
}
