import { memo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { DEFAULT_AGENT_CONFIG } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { ThumbsUpIcon, ThumbsDownIcon } from '../IDE/FeedbackButtons.js';

const API_BASE = '';

/**
 * §4 v3.21 — DetailPanel 에이전트 섹션: 좋아요/싫어요 집계 + "규칙으로 승격".
 *
 * 이 에이전트에 남긴 피드백 up/down 카운트를 보여주고, 싫어요가 있으면 distill(one-shot haiku)로
 * 규칙 문장 제안을 받아 **확인 모달**에서 사용자가 검토·수정 후 승인해야 `AgentConfig.rules` 에
 * append 한다(자동 append 금지 — rulesHistory 로 롤백 가능). 피드백이 없으면 렌더하지 않음.
 */
export const AgentFeedbackSection = memo(function AgentFeedbackSection({ agentId }: { agentId: string }): React.JSX.Element | null {
  const { t } = useTranslation();
  const feedbacks = useGraphStore((s) => s.agentFeedbacks[agentId]);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'error'>('idle');
  const [proposal, setProposal] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  if (!feedbacks || feedbacks.length === 0) return null;
  const ups = feedbacks.filter((f) => f.verdict === 'up').length;
  const downs = feedbacks.length - ups;

  const requestDistill = async (): Promise<void> => {
    setPhase('loading');
    try {
      const r = await fetch(`${API_BASE}/api/agent-feedback/${agentId}/distill`, { method: 'POST' });
      const json = (await r.json()) as { ok?: boolean; proposal?: string };
      if (!r.ok || !json.ok || !json.proposal) {
        setPhase('error');
        return;
      }
      setProposal(json.proposal);
      setPhase('idle');
    } catch {
      setPhase('error');
    }
  };

  const applyProposal = async (): Promise<void> => {
    if (!proposal?.trim()) return;
    setApplying(true);
    try {
      // PUT 은 config 를 body 에서 새로 빌드하므로(누락 필드=기본값 강등) 전체 현재 설정을 스프레드해 보낸다.
      const cfg = useGraphStore.getState().agentConfigs[agentId];
      const base = { ...DEFAULT_AGENT_CONFIG, ...(cfg ?? {}) };
      const prevRules = (base.rules ?? '').trim();
      const nextRules = prevRules ? `${prevRules}\n\n${proposal.trim()}` : proposal.trim();
      await fetch(`${API_BASE}/api/agent-config/${agentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, rules: nextRules }),
      });
      setProposal(null);
    } catch {
      /* snapshot 권위 — 실패 시 모달 유지, 사용자가 재시도/취소 */
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-gray-700 bg-gray-800/40 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-gray-500">
          {t('panel.feedback.title')}
        </span>
        <span className="flex items-center gap-2 text-xs font-medium">
          <span className="flex items-center gap-0.5 text-emerald-400"><ThumbsUpIcon className="h-3 w-3" />{ups}</span>
          <span className="flex items-center gap-0.5 text-rose-400"><ThumbsDownIcon className="h-3 w-3" />{downs}</span>
        </span>
      </div>
      {downs > 0 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void requestDistill()}
            disabled={phase === 'loading'}
            className="flex items-center gap-1.5 rounded bg-rose-500/15 px-2 py-1 text-[11px] font-medium text-rose-300 transition-colors hover:bg-rose-500/25 disabled:opacity-50"
          >
            {phase === 'loading' ? (
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
              </svg>
            ) : (
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            )}
            {phase === 'loading' ? t('panel.feedback.distilling') : t('panel.feedback.promote')}
          </button>
          {phase === 'error' && (
            <span className="text-[10.5px] text-amber-300">{t('panel.feedback.distillFailed')}</span>
          )}
        </div>
      )}

      {/* 승인 모달 — 제안 미리보기(수정 가능) + 취소/추가. 승인 전엔 절대 rules 미변경. */}
      {proposal !== null && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-6">
          <div className="flex max-h-[80vh] w-[520px] max-w-full flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl">
            <div className="border-b border-gray-800 px-4 py-3">
              <h3 className="text-[13px] font-semibold text-gray-100">{t('panel.feedback.proposalTitle')}</h3>
              <p className="mt-0.5 text-[11px] leading-relaxed text-gray-400">{t('panel.feedback.proposalHint')}</p>
            </div>
            <textarea
              value={proposal}
              onChange={(e) => setProposal(e.target.value)}
              spellCheck={false}
              className="m-4 min-h-[160px] flex-1 resize-y rounded border border-gray-700 bg-gray-950/70 p-2.5 font-mono text-[12px] leading-relaxed text-gray-200 outline-none scrollbar-thin focus:border-rose-400/40"
            />
            <div className="flex justify-end gap-2 border-t border-gray-800 px-4 py-3">
              <button
                type="button"
                onClick={() => setProposal(null)}
                disabled={applying}
                className="rounded px-3 py-1.5 text-[12px] font-medium text-gray-300 transition-colors hover:bg-gray-700/60 disabled:opacity-50"
              >
                {t('panel.feedback.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void applyProposal()}
                disabled={applying || !proposal.trim()}
                className="rounded bg-rose-500/20 px-3 py-1.5 text-[12px] font-semibold text-rose-200 transition-colors hover:bg-rose-500/30 disabled:opacity-50"
              >
                {applying ? t('panel.feedback.applying') : t('panel.feedback.apply')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
});
