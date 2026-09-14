import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * §5.23 접어 보기 — **에이전트마다 웹 버블 하나로 접는** 보기 옵션의 손잡이.
 *
 * 켜면 한 에이전트가 읽은 호스트들이 버블 하나로 접혀 보이고, 끄면 종전처럼 호스트마다 버블이 선다.
 * 접는 것은 서버가 스냅샷을 실어 보내기 직전에 하는 **보기**라 기록은 하나도 바뀌지 않는다 — 그래서
 * 끄는 순간 호스트별 버블이 그대로 돌아온다. 고정한 호스트는 접히지 않는다.
 *
 * 설정은 **머신 단위**(`AppState.webFoldPerAgent`, 기본 꺼짐)라 프로젝트를 옮겨도 같다 —
 * `ExternalFolderSection` 과 같은 문법으로 자기 REST(`/api/web-fold`)를 직접 읽고 쓰고, 미저장만 창에 올린다.
 */

const API_BASE = '';

interface WebFoldSectionProps {
  /** 미저장 여부를 옵션창에 올린다 — "저장 안 하고 나가기" 가드에 이 값도 걸리게. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function WebFoldSection({ onDirtyChange }: WebFoldSectionProps = {}): React.JSX.Element {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<'load' | 'save' | null>(null);
  const [error, setError] = useState<'load' | 'save' | null>(null);

  const dirty = enabled !== saved;

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/web-fold`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { enabled: boolean };
      setEnabled(data.enabled === true);
      setSaved(data.enabled === true);
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
      const res = await fetch(`${API_BASE}/api/web-fold`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error(String(res.status));
      // 화면은 **저장된 그 값**을 따라간다 — 서버가 받아들인 값이 곧 캔버스가 그리는 값이다.
      const data = await res.json() as { enabled: boolean };
      setEnabled(data.enabled === true);
      setSaved(data.enabled === true);
    } catch {
      setError('save');
    } finally {
      setBusy(null);
    }
  }, [enabled]);

  useEffect(() => { void load(); }, [load]);
  // 편집분은 이 컴포넌트 state 에만 있다 — 언마운트되면 함께 사라지므로 dirty 도 반드시 내린다.
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  return (
    <div className="flex flex-col gap-2 border-t border-gray-700/50 pt-4">
      <h4 className="text-sm font-semibold text-gray-200">
        {t('panel.options.advanced.webFoldTitle', { defaultValue: 'Web bubbles' })}
      </h4>
      <p className="text-[12px] leading-snug text-gray-500">
        {t('panel.options.advanced.webFoldIntro', {
          defaultValue: 'When an agent reads the web, every domain it reads gets its own bubble, so a single agent looking things up can cover the canvas.',
        })}
      </p>

      <label
        className={`flex items-start gap-2.5 rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2.5 ${
          busy !== null ? 'opacity-40' : 'cursor-pointer hover:border-gray-600'}`}
      >
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy !== null}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-blue-500 disabled:cursor-not-allowed"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-xs text-gray-200">
            {t('panel.options.advanced.webFoldEnabled', { defaultValue: 'Fold web bubbles into one per agent' })}
          </span>
          <span className="text-[12px] leading-snug text-gray-500">
            {t('panel.options.advanced.webFoldEnabledDesc', {
              defaultValue: 'The domains an agent read fold into a single bubble, and clicking it lists them domain by domain. Pinned domains keep their own bubbles. Nothing is deleted — turn this off and each domain gets its own bubble again.',
            })}
          </span>
        </span>
      </label>

      {/* 오류 문구는 바로 위 섹션과 원문이 같아 그 키를 그대로 쓴다 — 같은 원문에 키를 새로 파면
          로케일마다 번역이 갈린다(docs/rules/i18n.md 「같은 원문이 여러 곳에 쓰이면 단일 키」). */}
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
          onClick={() => setEnabled(false)}
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
