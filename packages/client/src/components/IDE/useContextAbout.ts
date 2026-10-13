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
        if (i18n.exists(key)) {
          return t(key, {
            name: item.title,
            // §5.3 #12-4 (J) — 다른 화면을 가리키는 설명(검증 정책 줄의 "실행 전 차단은 옵션창 권한 칸")은 그 화면
            //   라벨을 받아 적는다. 이름을 글자로 박으면 12 로케일에서 화면과 어긋난다(`uiLabelReference.test.ts`).
            options: t('panel.options.title'),
            permissions: t('panel.options.categories.permissions'),
          });
        }
      }
      return '';
    },
    [t, i18n],
  );
}
