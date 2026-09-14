import { useTranslation } from 'react-i18next';
import type { AgentEngineKind } from '@vibisual/shared';
import { ProviderTabs } from '../Engine/ProviderTabs.js';

/**
 * §5.25 (C) — 메인 제공자(주 작업자) 고르기. 옵션창 "프로젝트 설정" 탭의 본문 전체.
 *
 * 이 탭의 주된 설정이라 테두리 상자를 치지 않고 다른 탭과 같은 제목 머리로 바로 놓는다.
 * 저장 버튼도 칸 안에 두지 않는다(사용자 지시 2026-09-14) — 고른 값은 옵션창이 들고 있다가
 * 창 아래 [적용]으로 `engineChoice` 에 남긴다. 그래서 이 컴포넌트는 값만 보여 주고 고른 것을 올린다.
 */
export function MainProviderSelect({ value, onChange, disabled = false }: { value: AgentEngineKind; onChange: (engine: AgentEngineKind) => void; disabled?: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  return <div className="flex flex-col gap-4">
    <div className="border-b border-gray-700/50 pb-2">
      <h4 className="text-sm font-semibold text-gray-200">{t('providers.main')}</h4>
      <p className="mt-1 text-[12px] text-gray-500">{t('providers.mainHint')}</p>
    </div>
    <ProviderTabs value={value} onChange={onChange} disabled={disabled} />
  </div>;
}
