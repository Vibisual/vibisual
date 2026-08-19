import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { BubbleData, SubAgent } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import {
  NODE_STATUS_RUN_STATE, SESSION_STATUS_DOT, SESSION_STATUS_LABEL_KEY, sessionRunStateOf,
} from '../../utils/sessionStatus.js';
import { followSessionKey } from './editorFollow.js';
import { buildDiffCommentPrompt } from './diffCommentPrompt.js';

interface IDEStatusBarProps {
  agent: BubbleData;
  activeSession: SubAgent | null;
  isCustom: boolean;
  sessionCount: number;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

function formatModelName(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

export const IDEStatusBar = memo(function IDEStatusBar({
  agent,
  activeSession,
  isCustom,
  sessionCount,
}: IDEStatusBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const model = activeSession?.modelName ?? agent.modelName;
  const acknowledged = useGraphStore((s) => (activeSession ? !!s.acknowledgedSubAgents[activeSession.id] : false));
  // 종전에는 여기서 `activeSession?.status ?? agent.status` 로 **값 집합이 다른 두 축**(SubAgentStatus /
  //   NodeStatus)을 한 칸에 섞어 그리고, 그 enum 원문을 번역 없이 출력했다(`awaiting_permission` 이
  //   날 문자열로 보였다). 게다가 색 규약이 나머지 화면과 **정반대**였다 — 다른 넷은 완료·미확인을
  //   초록으로 강조하고 completed 를 회색으로 죽이는데, 이 바만 그 둘을 뒤집어 칠했다.
  //   이제 두 축을 같은 표시 어휘로 접어(`sessionRunStateOf` / `NODE_STATUS_RUN_STATE`) 색·낱말을 공유한다.
  const runState = activeSession
    ? sessionRunStateOf(activeSession, acknowledged)
    : NODE_STATUS_RUN_STATE[agent.status];
  const inputTokens = activeSession?.totalInputTokens ?? agent.totalInputTokens ?? 0;
  const outputTokens = activeSession?.totalOutputTokens ?? agent.totalOutputTokens ?? 0;

  // ─── §5.5 #17-30 — 이 세션에 모인 diff 리뷰 코멘트를 한 명령으로 보낸다 ───
  const sessionKey = followSessionKey(agent.id, activeSession?.id ?? null);
  const reviewComments = useGraphStore((s) => s.diffComments[sessionKey]);
  const addCommand = useGraphStore((s) => s.addCommand);
  const clearDiffComments = useGraphStore((s) => s.clearDiffComments);
  const reviewCount = reviewComments?.length ?? 0;
  const sendReview = useCallback(() => {
    if (!reviewComments || reviewComments.length === 0) return;
    const text = buildDiffCommentPrompt(reviewComments, t('ide.diff.reviewPromptHeader'));
    if (text === '') return;
    // 전송 창구는 기존 하나뿐(`addCommand`) — 새 경로를 만들지 않는다. 보낸 뒤에만 비운다.
    addCommand(agent.id, text, activeSession?.id ?? null, []);
    clearDiffComments(sessionKey);
  }, [reviewComments, t, addCommand, agent.id, activeSession?.id, clearDiffComments, sessionKey]);

  return (
    <div className="flex h-6 flex-shrink-0 items-center gap-4 border-t border-gray-700 bg-gray-900/80 px-3 text-[10px]">
      {/* Agent type */}
      <span className={`rounded px-1.5 py-0.5 font-semibold ${
        isCustom ? 'bg-blue-500/15 text-blue-400' : 'bg-gray-600/30 text-gray-400'
      }`}>
        {isCustom ? t('ide.statusBar.custom') : t('ide.statusBar.hook')}
      </span>

      {/* Status */}
      <span className="flex items-center gap-1">
        <span className={`h-1.5 w-1.5 rounded-full ${SESSION_STATUS_DOT[runState]}`} />
        <span className={runState === 'error' ? 'text-red-400' : 'text-gray-400'}>
          {t(SESSION_STATUS_LABEL_KEY[runState])}
        </span>
      </span>

      {/* Model */}
      {model && (
        <span className="text-gray-500">
          {formatModelName(model)}
        </span>
      )}

      {/* Context usage */}
      {agent.contextMax && (
        <span className="text-gray-500">
          {t('ide.statusBar.context', { used: formatTokenCount(agent.contextUsed ?? 0), max: formatTokenCount(agent.contextMax) })}
        </span>
      )}

      {/* Token usage */}
      {inputTokens > 0 && (
        <span className="text-violet-400/70">
          {t('ide.statusBar.tokens', { in: formatTokenCount(inputTokens), out: formatTokenCount(outputTokens) })}
        </span>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* §5.5 #17-30 — 모인 리뷰 코멘트 보내기. 훅 버블(읽기 전용)에는 뜨지 않는다(#17-29). */}
      {isCustom && reviewCount > 0 && (
        <button
          type="button"
          onClick={sendReview}
          className="flex items-center gap-1 rounded bg-blue-600/80 px-2 py-0.5 text-[10px] font-semibold text-white transition-colors hover:bg-blue-500"
          title={t('ide.diff.sendReviewTip')}
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
          </svg>
          {t('ide.diff.sendReview', { count: reviewCount })}
        </button>
      )}

      {/* Session count */}
      <span className="text-gray-600">
        {sessionCount === 1
          ? t('ide.statusBar.sessionOne', { count: sessionCount })
          : t('ide.statusBar.sessionMany', { count: sessionCount })}
      </span>
    </div>
  );
});
