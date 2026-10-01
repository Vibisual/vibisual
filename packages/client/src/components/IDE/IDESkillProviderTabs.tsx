/**
 * §5.5 #17-4 · §5.25 (M-1) — 스킬 칸의 엔진 탭.
 *
 * 스킬 칸에는 목록이 둘 있다. 이 에이전트의 엔진이 실제로 싣는 스킬, 그리고 상대 엔진에서
 * 가져와 공유할 수 있는 사용자 스킬이다. 종전에는 둘을 한 스크롤에 이어 붙였고, 클로드 칸에서는
 * 공유 구역이 **자기 스킬보다 위에** 서서 칸을 열면 남의 엔진 목록부터 보였다.
 *
 * 이제 탭 하나에 목록 하나다(사용자 지시 2026-09-26).
 *   ① 자기 엔진 탭이 늘 첫째이고 기본이다.
 *   ② 에이전트를 바꾸면 자기 엔진 탭으로 돌아온다 — 고른 탭은 고른 그 에이전트에서만 산다.
 *      기억은 **창 슬롯에 에이전트마다** 있다(`IDEOverlayState.skillTabs`): 칸이 내려가도(좁은 창의 서랍이
 *      세션 이동에 닫힘·사이드바 접기·다른 칸 다녀오기) 남고, 다른 에이전트에 다녀와도 이 에이전트의 것이 남는다.
 *   ③ 탭에 개수를 적는다. 아직 모르는 개수(읽는 중·읽기 실패)는 0 으로 적지 않고 비워 둔다.
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

/**
 * 이 에이전트에서 고른 탭 — 고른 적 없으면 자기 엔진 탭이다.
 *
 * 종전에는 칸 하나에 `{scope, tab}` 한 벌만 기억해, A 에서 고른 뒤 B 에 다녀오면 B 에서 탭을 골랐는지에
 * 따라 A 의 탭이 살아나기도 사라지기도 했다. 이제 에이전트마다 따로라 다녀온 곳과 무관하다.
 */
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

/**
 * 고른 탭은 칸의 로컬 상태가 아니라 **창 슬롯**에 적는다 — 칸 컴포넌트는 서랍·사이드바 접기·칸 전환마다
 * 내려가므로, 로컬에 두면 "같은 에이전트의 세션 탭 이동은 유지"(②)를 지킬 수 없었다(좁은 창은 세션을
 * 바꾸면 서랍을 닫는다).
 */
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
