import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EXTERNAL_FOLDER_MERGE_DEPTH_BOUNDS,
  EXTERNAL_FOLDER_MERGE_DEPTH_DEFAULT,
  EXTERNAL_TOP_BUDGET_BOUNDS,
  EXTERNAL_TOP_BUDGET_DEFAULT,
  normalizeExternalFolderMergeDepth,
} from '@vibisual/shared';
import { NumberStepper } from './NumberStepper.js';

/**
 * 외부 폴더 전용 경로 통합 깊이와 활동 승격 예산. 머신 단위(`AppState`)로 함께 저장한다.
 * 깊이가 0이면 경로 통합을 끄고 기존 활동 예산을 사용한다. 핀 폴더는 예산과 무관하게 표시한다.
 */

const API_BASE = '';

interface ExternalFolderSectionProps {
  /** 미저장 여부를 옵션창에 올린다 — "저장 안 하고 나가기" 가드에 이 값도 걸리게. */
  onDirtyChange?: (dirty: boolean) => void;
}

interface ExternalFolderSettings {
  budget: number;
  mergeDepth?: number;
}

export function ExternalFolderSection({ onDirtyChange }: ExternalFolderSectionProps = {}): React.JSX.Element {
  const { t } = useTranslation();
  const [budget, setBudget] = useState<number>(EXTERNAL_TOP_BUDGET_DEFAULT);
  const [saved, setSaved] = useState<number>(EXTERNAL_TOP_BUDGET_DEFAULT);
  const [mergeDepth, setMergeDepth] = useState<number>(EXTERNAL_FOLDER_MERGE_DEPTH_DEFAULT);
  const [savedMergeDepth, setSavedMergeDepth] = useState<number>(EXTERNAL_FOLDER_MERGE_DEPTH_DEFAULT);
  const [busy, setBusy] = useState<'load' | 'save' | null>(null);
  const [error, setError] = useState<'load' | 'save' | null>(null);

  const dirty = budget !== saved || mergeDepth !== savedMergeDepth;

  const applySaved = useCallback((data: ExternalFolderSettings) => {
    const depth = normalizeExternalFolderMergeDepth(data.mergeDepth);
    setBudget(data.budget);
    setSaved(data.budget);
    setMergeDepth(depth);
    setSavedMergeDepth(depth);
  }, []);

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/external-folder-budget`);
      if (!res.ok) throw new Error(String(res.status));
      applySaved(await res.json() as ExternalFolderSettings);
    } catch {
      setError('load');
    } finally {
      setBusy(null);
    }
  }, [applySaved]);

  const save = useCallback(async () => {
    setBusy('save');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/external-folder-budget`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budget, mergeDepth }),
      });
      if (!res.ok) throw new Error(String(res.status));
      // 서버가 범위 밖 값을 접어 돌려줄 수 있다 — 화면은 **저장된 그 값**을 따라간다.
      applySaved(await res.json() as ExternalFolderSettings);
    } catch {
      setError('save');
    } finally {
      setBusy(null);
    }
  }, [applySaved, budget, mergeDepth]);

  useEffect(() => { void load(); }, [load]);
  // 편집분은 이 컴포넌트 state 에만 있다 — 언마운트되면 함께 사라지므로 dirty 도 반드시 내린다.
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  const budgetLabel = t('panel.options.advanced.externalBudgetLabel', {
    defaultValue: 'External folders shown at the top level',
  });
  const mergeDepthLabel = t('panel.options.advanced.externalMergeDepthLabel', {
    defaultValue: 'External folder merge depth',
  });

  return (
    <div className="flex flex-col gap-2 border-t border-gray-700/50 pt-4">
      <h4 className="text-sm font-semibold text-gray-200">
        {t('panel.options.advanced.externalBudgetTitle', { defaultValue: 'Folders outside the project' })}
      </h4>
      <p className="text-[12px] leading-snug text-gray-500">
        {t('panel.options.advanced.externalBudgetIntro', {
          defaultValue: 'Group external folder bubbles whose paths share the first few folder levels. These settings apply only to folders outside the project.',
        })}
      </p>

      <div className="flex flex-col gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5">
        <label className="text-xs text-gray-200">{mergeDepthLabel}</label>
        <NumberStepper
          value={mergeDepth}
          onChange={(value) => setMergeDepth(normalizeExternalFolderMergeDepth(value))}
          min={EXTERNAL_FOLDER_MERGE_DEPTH_BOUNDS.MIN}
          max={EXTERNAL_FOLDER_MERGE_DEPTH_BOUNDS.MAX}
          step={1}
          disabled={busy !== null}
          widthClassName="w-20"
          ariaLabel={mergeDepthLabel}
        />
        <p className="text-[12px] leading-snug text-gray-500">
          {t('panel.options.advanced.externalMergeDepthDesc', {
            defaultValue: 'Default: 3 levels. A smaller number groups more folders together; 0 turns path merging off. Count folder names after the root, drive, or network share. For example, C:/Users/<name>/.codex/... shares 3 levels through .codex. Files remain accessible inside the merged bubble.',
          })}
        </p>
      </div>

      <div className="flex flex-col gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5">
        <label className="text-xs text-gray-200">{budgetLabel}</label>
        <NumberStepper
          value={budget}
          onChange={setBudget}
          min={EXTERNAL_TOP_BUDGET_BOUNDS.MIN}
          max={EXTERNAL_TOP_BUDGET_BOUNDS.MAX}
          step={1}
          disabled={busy !== null || mergeDepth > 0}
          widthClassName="w-20"
          ariaLabel={budgetLabel}
        />
        <p className="text-[12px] leading-snug text-gray-500">
          {t('panel.options.advanced.externalBudgetDesc', {
            defaultValue: 'Used when merge depth is 0: the most active and recent folders appear at the top level within this budget. Pinned folders do not count against it. While path merging is on, activity does not split merged groups. No files are deleted.',
          })}
        </p>
      </div>

      {error && (
        <p className="rounded border border-rose-700/40 bg-rose-900/20 px-3 py-2 text-[12px] text-rose-200">
          {error === 'load'
            ? t('panel.options.advanced.externalBudgetLoadError', { defaultValue: 'Could not read the current setting.' })
            : t('panel.options.advanced.externalBudgetSaveError', { defaultValue: 'Could not save. Nothing was changed.' })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button
          type="button"
          disabled={!dirty || busy !== null}
          onClick={() => { void save(); }}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 hover:bg-blue-500"
        >
          {busy === 'save'
            ? t('panel.options.storage.saving', { defaultValue: 'Saving…' })
            : t('panel.options.storage.save', { defaultValue: 'Save' })}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            setBudget(EXTERNAL_TOP_BUDGET_DEFAULT);
            setMergeDepth(EXTERNAL_FOLDER_MERGE_DEPTH_DEFAULT);
          }}
          className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300 disabled:opacity-40 hover:bg-white/[0.04]"
        >
          {t('panel.options.storage.reset', { defaultValue: 'Restore defaults' })}
        </button>
        {dirty && (
          <span className="text-[12px] text-amber-400">
            {t('panel.options.storage.unsaved', { defaultValue: 'Not applied yet' })}
          </span>
        )}
      </div>
    </div>
  );
}
