import { useTranslation } from 'react-i18next';
import type { AgentEngineKind } from '@vibisual/shared';
import { ProviderTabs } from '../Engine/ProviderTabs.js';

/** §5.25 (C) — 메인 제공자 고르기("프로젝트 설정" 탭 본문). 칸 안에 저장 버튼 없음 — 옵션창이 들고 있다가 [적용]으로 `engineChoice` 에 남긴다. */
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
