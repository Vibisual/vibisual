/**
 * §5.5 #17-4 · §5.25 (M-1) — 스킬 칸 엔진 탭(자기 엔진 스킬 / 상대 엔진에서 가져올 사용자 스킬).
 * ① 자기 엔진 탭이 첫째·기본 ② 고른 탭은 창 슬롯에 에이전트마다(`IDEOverlayState.skillTabs`) ③ 모르는 개수는 0 이 아니라 빈칸.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { SkillSharingEntry } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { EngineIcon } from '../Engine/engineIcons.js';
import { useIDEPaneKey, useIDEPaneValue } from './idePane.js';

export type SkillProvider = SkillSharingEntry['sourceProvider'];

/** 엔진 이름은 고유명사라 번역하지 않는다(i18n 규칙 — `Codex` 는 어느 언어에서나 그대로). */
export const SKILL_PROVIDER_LABELS: Record<SkillProvider, string> = { claude: 'Claude', codex: 'Codex' };

export function otherSkillProvider(own: SkillProvider): SkillProvider {
  return own === 'claude' ? 'codex' : 'claude';
}

/** 탭 순서 — 자기 엔진이 늘 첫째. */
export function skillProviderTabs(own: SkillProvider): [SkillProvider, SkillProvider] {
  return [own, otherSkillProvider(own)];
}

/** 고른 탭 — 없으면 자기 엔진 탭. */
export function resolveSkillProviderTab(
  picks: Readonly<Record<string, SkillProvider>> | undefined, agentId: string, own: SkillProvider,
): SkillProvider {
  return picks?.[agentId] ?? own;
}

/** 공유 목록의 탭 개수. 읽는 중이거나 못 읽었으면 모른다 — "0개"라고 적으면 거짓이 된다. */
export function skillSharingCount(state: {
  loading: boolean;
  error: { action: 'load' | 'share' } | null;
  skills: readonly unknown[];
}): number | null {
  return state.loading || state.error?.action === 'load' ? null : state.skills.length;
}

/** 고른 탭은 창 슬롯에 적는다 — 칸은 서랍·사이드바 접기·칸 전환마다 내려가 로컬이면 ② 가 깨진다. */
export function useSkillProviderTab(
  own: SkillProvider, agentId: string,
): [SkillProvider, (tab: SkillProvider) => void] {
  const paneKey = useIDEPaneKey();
  const picks = useIDEPaneValue((pane) => pane.skillTabs);
  const select = useCallback((tab: SkillProvider) => {
    // 자기 탭을 고르면 기억을 지운다 — 기본값을 적어 둘 까닭이 없다.
    useGraphStore.getState().setIDESkillTab(agentId, tab === own ? null : tab, paneKey);
  }, [agentId, own, paneKey]);
  return [resolveSkillProviderTab(picks, agentId, own), select];
}

export function IDESkillProviderTabs({
  own, active, counts, onChange, className = '',
}: {
  own: SkillProvider;
  active: SkillProvider;
  counts: Record<SkillProvider, number | null>;
  onChange: (tab: SkillProvider) => void;
  className?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const tabs = skillProviderTabs(own);
  // 탭이 둘뿐이라 좌우 화살표는 곧 "다른 탭으로" 다(WAI-ARIA tablist 키보드 규약).
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = otherSkillProvider(active);
    onChange(next);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-skill-tab="${next}"]`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={t('ide.skillTabs.label')}
      onKeyDown={handleKeyDown}
      className={`flex flex-shrink-0 gap-0.5 rounded-md border border-gray-700/60 bg-gray-900/40 p-0.5 ${className}`}
    >
      {tabs.map((provider) => {
        const selected = provider === active;
        const label = SKILL_PROVIDER_LABELS[provider];
        const count = counts[provider];
        return (
          <button
            key={provider}
            type="button"
            role="tab"
            data-skill-tab={provider}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => { onChange(provider); }}
            title={provider === own
              ? t('ide.skillTabs.own', { provider: label })
              : t('ide.skillSharing.title', { provider: label })}
            className={`app-nodrag flex min-w-0 flex-1 items-center justify-center gap-1 rounded px-1.5 py-1 text-[12px] transition-colors ${selected ? 'bg-sky-500/20 text-sky-300' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
          >
            <EngineIcon kind={provider} className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate font-medium">{label}</span>
            {count !== null && (
              <span className={`flex-shrink-0 tabular-nums ${selected ? 'text-sky-300/70' : 'text-gray-500'}`}>{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
