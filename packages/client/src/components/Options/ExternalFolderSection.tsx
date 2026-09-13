import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EXTERNAL_TOP_BUDGET_BOUNDS, EXTERNAL_TOP_BUDGET_DEFAULT } from '@vibisual/shared';
import { NumberStepper } from './NumberStepper.js';

/**
 * §2.1 (B) — **최상위에 동시에 세울 외부 폴더 개수**의 손잡이.
 *
 * 이 값이 화면에서 정하는 것은 하나뿐이다 — 프로젝트 밖 폴더가 캔버스에 몇 개까지 펼쳐지는가.
 * 작게 두면 지도가 조용하지만 무엇을 건드는지 덜 보이고, 크게 두면 다 보이지만 붐빈다.
 * **개수는 이 값이 고정하고 무엇이 보일지는 활동이 정한다** — 접촉이 많고 최근인 자리부터
 * 채워지고, 식으면 다시 조상 밑으로 접힌다.
 *
 * **핀을 꽂은 폴더는 이 수에 들지 않는다.** 사용자가 고정한 것이 예산 때문에 사라지면 핀이라는
 * 약속이 깨지기 때문이다(사용자 결정).
 *
 * 설정은 **머신 단위**(`AppState`)라 프로젝트를 옮겨도 같다 — `SessionProbeSection` 과 같은
 * 문법으로 자기 REST(`/api/external-folder-budget`)를 직접 읽고 쓰고, 미저장만 창에 올린다.
 */

const API_BASE = '';

interface ExternalFolderSectionProps {
  /** 미저장 여부를 옵션창에 올린다 — "저장 안 하고 나가기" 가드에 이 값도 걸리게. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function ExternalFolderSection({ onDirtyChange }: ExternalFolderSectionProps = {}): React.JSX.Element {
  const { t } = useTranslation();
  const [budget, setBudget] = useState<number>(EXTERNAL_TOP_BUDGET_DEFAULT);
  const [saved, setSaved] = useState<number>(EXTERNAL_TOP_BUDGET_DEFAULT);
  const [busy, setBusy] = useState<'load' | 'save' | null>(null);
  const [error, setError] = useState<'load' | 'save' | null>(null);

  const dirty = budget !== saved;

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/external-folder-budget`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { budget: number };
      setBudget(data.budget);
      setSaved(data.budget);
    } catch {
      setError('load');
    } finally {
      setBusy(null);
    }
  }, []);

  const save = useCallback(async () => {
    setBusy('save');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/external-folder-budget`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budget }),
      });
      if (!res.ok) throw new Error(String(res.status));
      // 서버가 범위 밖 값을 접어 돌려줄 수 있다 — 화면은 **저장된 그 값**을 따라간다.
      const data = await res.json() as { budget: number };
      setBudget(data.budget);
      setSaved(data.budget);
    } catch {
      setError('save');
    } finally {
      setBusy(null);
    }
  }, [budget]);

  useEffect(() => { void load(); }, [load]);
  // 편집분은 이 컴포넌트 state 에만 있다 — 언마운트되면 함께 사라지므로 dirty 도 반드시 내린다.
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  const budgetLabel = t('panel.options.advanced.externalBudgetLabel', {
    defaultValue: 'External folders shown at the top level',
  });

  return (
    <div className="flex flex-col gap-2 border-t border-gray-700/50 pt-4">
      <h4 className="text-sm font-semibold text-gray-200">
        {t('panel.options.advanced.externalBudgetTitle', { defaultValue: 'Folders outside the project' })}
      </h4>
      <p className="text-[12px] leading-snug text-gray-500">
        {t('panel.options.advanced.externalBudgetIntro', {
          defaultValue: 'When an agent touches a folder outside the project, that place gets its own bubble. Left alone, those bubbles either bury the map or collapse into one that says nothing. This number sets how many of them stand at the top level at once — the busiest and most recent places fill it first, and places that go quiet fold back under their parent.',
        })}
      </p>

      <div className="flex flex-col gap-1.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5">
        <label className="text-xs text-gray-200">{budgetLabel}</label>
        <NumberStepper
          value={budget}
          onChange={setBudget}
          min={EXTERNAL_TOP_BUDGET_BOUNDS.MIN}
          max={EXTERNAL_TOP_BUDGET_BOUNDS.MAX}
          step={1}
          disabled={busy !== null}
          widthClassName="w-20"
          ariaLabel={budgetLabel}
        />
        <p className="text-[12px] leading-snug text-gray-500">
          {t('panel.options.advanced.externalBudgetDesc', {
            defaultValue: 'Pinned folders do not count against this number — a folder you pinned always stays at the top level. Nothing is deleted by this setting: places that do not fit are folded under a parent bubble that tells you how many are inside.',
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

      <div className="flex items-center gap-2 pt-0.5">
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
          onClick={() => setBudget(EXTERNAL_TOP_BUDGET_DEFAULT)}
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
