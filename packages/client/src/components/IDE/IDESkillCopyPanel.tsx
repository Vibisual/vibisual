/**
 * §5.5 #17-4 — 스킬을 다른 프로젝트로 복사하는 인라인 대상 선택.
 *
 * 스킬 행 아래에서 그대로 펼쳐진다(삭제 확인 2-step 과 같은 자리·같은 규약) — 사이드바 폭 `w-52`
 * 에서 덮개 팝업을 띄우면 정작 어떤 스킬을 복사하는지가 가려지기 때문. 대상은 다중 선택이고,
 * **이미 있는 곳은 조용히 덮지 않는다** — 결과가 "이미 있음" 으로 돌아온 뒤 [덮어쓰기] 를 눌러야
 * 그 대상만 다시 보낸다.
 */
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../stores/graphStore.js';
import { copySkill, type SkillInfo, type SkillCopyResult } from '../../hooks/useAvailableSkills.js';
import { buildSkillCopyTargets, summarizeSkillCopy, type SkillCopySummary, type SkillCopyTarget } from './skillCopy.js';
import { ScrollFade } from '../ScrollFade.js';

interface IDESkillCopyPanelProps {
  skill: SkillInfo;
  agentId: string;
  /** 지금 보고 있는 프로젝트의 path — 프로젝트 스킬이면 원본 자신을 대상에서 뺀다. */
  currentProjectPath: string | null;
  onClose: () => void;
}

const TARGET_GLYPH: Record<SkillCopyTarget['kind'], React.JSX.Element> = {
  global: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 flex-shrink-0 text-sky-400/80">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18" />
    </svg>
  ),
  project: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 flex-shrink-0 text-emerald-400/70">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  ),
};

export function IDESkillCopyPanel({ skill, agentId, currentProjectPath, onClose }: IDESkillCopyPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const projects = useGraphStore((s) => s.projects);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<SkillCopySummary | null>(null);

  const targets = useMemo(
    () => buildSkillCopyTargets(projects, { source: skill.source, currentProjectPath }),
    [projects, skill.source, currentProjectPath],
  );

  const handleToggle = useCallback((ref: string) => {
    setSummary(null);
    setSelected((prev) => (prev.includes(ref) ? prev.filter((r) => r !== ref) : [...prev, ref]));
  }, []);

  const handleToggleAll = useCallback(() => {
    setSummary(null);
    setSelected((prev) => (prev.length === targets.length ? [] : targets.map((target) => target.ref)));
  }, [targets]);

  const run = useCallback(async (refs: string[], overwrite: boolean): Promise<void> => {
    if (refs.length === 0) return;
    setBusy(true);
    try {
      const results = await copySkill({ name: skill.name, source: skill.source, agentId, targets: refs, overwrite });
      setSummary(summarizeSkillCopy(results));
    } catch {
      const failed: SkillCopyResult[] = refs.map((target) => ({ target, status: 'error' }));
      setSummary(summarizeSkillCopy(failed));
    } finally {
      setBusy(false);
    }
  }, [skill.name, skill.source, agentId]);

  const handleCopy = useCallback(() => { void run(selected, false); }, [run, selected]);
  const handleOverwrite = useCallback(() => { void run(summary?.existsTargets ?? [], true); }, [run, summary]);

  // 결과 한 줄 — 실제로 일어난 것만 적는다(0 인 칸은 말하지 않는다).
  const summaryText = useMemo(() => {
    if (!summary) return '';
    const parts: string[] = [];
    const written = summary.copied + summary.overwritten;
    if (written > 0) parts.push(t('ide.sidebar.copySkillDone', { count: written }));
    if (summary.exists > 0) parts.push(t('ide.sidebar.copySkillExists', { count: summary.exists }));
    if (summary.same > 0) parts.push(t('ide.sidebar.copySkillSame', { count: summary.same }));
    if (summary.failed > 0) parts.push(t('ide.sidebar.copySkillFailed', { count: summary.failed }));
    return parts.join(' · ');
  }, [summary, t]);

  const canOverwrite = (summary?.existsTargets.length ?? 0) > 0;

  return (
    <div
      className="mt-1 flex flex-col gap-1 rounded bg-gray-900/70 p-1.5 ring-1 ring-gray-700/60"
      draggable={false}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDragStart={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-1">
        <span className="min-w-0 truncate text-[12px] font-semibold text-gray-300">{t('ide.sidebar.copySkillHeader')}</span>
        {targets.length > 0 && (
          <button
            type="button"
            onClick={handleToggleAll}
            className="ml-auto flex-shrink-0 rounded px-1 py-0.5 text-[12px] font-medium text-gray-400 transition-colors hover:bg-gray-700/60 hover:text-gray-200"
          >
            {t('ide.sidebar.copySkillAll')}
          </button>
        )}
      </div>

      {targets.length === 0 ? (
        <span className="px-1 py-1 text-[12px] text-gray-500">{t('ide.sidebar.copySkillNoTargets')}</span>
      ) : (
        <ScrollFade maxHeight={140}>
          <ul className="flex flex-col gap-0.5">
            {targets.map((target) => {
              const on = selected.includes(target.ref);
              return (
                <li key={target.ref}>
                  <button
                    type="button"
                    onClick={() => handleToggle(target.ref)}
                    title={target.kind === 'project' ? target.ref : t('ide.sidebar.copySkillGlobal')}
                    className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-gray-700/60"
                  >
                    <span
                      className={`flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-sm border transition-colors ${on ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300' : 'border-gray-600 text-transparent'}`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-2 w-2">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </span>
                    {TARGET_GLYPH[target.kind]}
                    <span className={`min-w-0 truncate text-[12px] ${on ? 'text-gray-200' : 'text-gray-400'}`}>
                      {target.kind === 'global' ? t('ide.sidebar.copySkillGlobal') : target.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollFade>
      )}

      {summaryText && (
        <span className={`px-1 text-[12px] leading-tight ${summary && summary.failed > 0 ? 'text-red-300/90' : 'text-emerald-300/90'}`}>
          {summaryText}
        </span>
      )}

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={busy || selected.length === 0}
          onClick={handleCopy}
          className="flex-shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[12px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:bg-gray-700/40 disabled:text-gray-500"
        >
          {busy ? t('ide.sidebar.copySkillBusy') : t('ide.sidebar.copySkillDo')}
        </button>
        {canOverwrite && (
          <button
            type="button"
            disabled={busy}
            onClick={handleOverwrite}
            className="flex-shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[12px] font-semibold text-amber-300 transition-colors hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:bg-gray-700/40 disabled:text-gray-500"
          >
            {t('ide.sidebar.copySkillOverwrite')}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto flex-shrink-0 rounded bg-gray-600/40 px-1.5 py-0.5 text-[12px] font-medium text-gray-300 transition-colors hover:bg-gray-600/60"
        >
          {summary ? t('ide.sidebar.copySkillClose') : t('ide.sidebar.copySkillCancel')}
        </button>
      </div>
    </div>
  );
}
