import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentReport, AgentQuestions, AgentReview, AgentList } from '@vibisual/shared';
import type { TerminalCard } from './terminalCardSniffer.js';
import { AgentReportCard } from './AgentReportCard.js';
import { AgentQuestionCard } from './AgentQuestionCard.js';
import { AgentReviewCard } from './AgentReviewCard.js';
import { AgentListCard } from './AgentListCard.js';

// §4 v2.89 — CMD(인터랙티브 터미널) 카드 패널.
//
// terminalCardSniffer 가 마커 줄을 숨기며 방출한 TerminalCard 들을 xterm 그리드 **밖** DOM 패널에서
// 기존 카드 컴포넌트(AgentReportCard/AgentQuestionCard/AgentReviewCard/AgentListCard)로 그대로 렌더한다.
// 터미널 캔버스를 한 줄도 안 건드리므로 폰트 확대·창 리사이즈로 claude REPL TUI 가 다시 그려져도
// 카드가 깨지거나 복제되지 않는다(v2.83 인라인 ANSI 박스 방식의 근본 결함 해소).

interface IDETerminalCardRailProps {
  cards: TerminalCard[];
  /** 카드가 귀속될 터미널 에이전트 — 카드 컴포넌트 타입 충족용(렌더 필터엔 미사용, 패널이 이미 세션 스코프). */
  agentId: string;
  /** 세션(탭) id — 카드의 subAgentId 로 매핑. */
  sessionId: string | null;
  /** 질문 카드 "즉시 전송" → 터미널 PTY 에 프롬프트 prefill(사람이 Enter — ToS 인루프). */
  onSendPrompt: (prompt: string) => void;
  /** 패널 비우기. */
  onClear: () => void;
}

/** 카드 헤더 글리프 — 겹친 카드(layers). */
function CardsIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="13" height="13" rx="2" />
      <path d="M8 21h10a2 2 0 0 0 2-2V9" />
    </svg>
  );
}

/** 단일 TerminalCard → 알맞은 기존 카드 컴포넌트로 렌더. */
function TerminalCardItem({ card, agentId, sessionId, onSendPrompt }: {
  card: TerminalCard;
  agentId: string;
  sessionId: string | null;
  onSendPrompt: (prompt: string) => void;
}): React.JSX.Element | null {
  const subAgentId = sessionId ?? undefined;
  if (card.kind === 'report') {
    const report: AgentReport = {
      id: card.id, agentId, subAgentId,
      did: card.did, userActions: card.userActions, nextSteps: card.nextSteps,
      note: card.note, createdAt: card.createdAt,
    };
    return <AgentReportCard report={report} />;
  }
  if (card.kind === 'questions') {
    const questions: AgentQuestions = {
      id: card.id, agentId, subAgentId,
      items: card.items.map((it) => ({ question: it.question, header: it.header, prompts: it.prompts })),
      note: card.note, createdAt: card.createdAt,
    };
    return <AgentQuestionCard questions={questions} onSendPrompt={onSendPrompt} />;
  }
  if (card.kind === 'review') {
    const review: AgentReview = {
      id: card.id, agentId, subAgentId,
      instruction: card.instruction, changes: card.changes, checkpoints: card.checkpoints,
      note: card.note, createdAt: card.createdAt,
    };
    return <AgentReviewCard review={review} />;
  }
  const list: AgentList = {
    id: card.id, agentId, subAgentId,
    title: card.title, items: card.items, note: card.note, createdAt: card.createdAt,
  };
  return <AgentListCard list={list} />;
}

export const IDETerminalCardRail = memo(function IDETerminalCardRail({
  cards, agentId, sessionId, onSendPrompt, onClear,
}: IDETerminalCardRailProps): React.JSX.Element {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    // 접힘 — 얇은 세로 스트립(개수 배지 + 펼치기).
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        title={t('ide.terminal.cards.expand')}
        aria-label={t('ide.terminal.cards.expand')}
        className="flex w-9 flex-shrink-0 flex-col items-center gap-2 border-l border-gray-800 bg-gray-900/60 py-2 text-gray-400 transition-colors hover:bg-gray-800/60 hover:text-gray-200"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        <span className="rounded bg-violet-500/20 px-1 py-0.5 text-[10px] font-bold tabular-nums text-violet-300">
          {cards.length}
        </span>
        <span className="[writing-mode:vertical-rl] text-[10px] font-semibold uppercase tracking-wide">
          {t('ide.terminal.cards.title')}
        </span>
      </button>
    );
  }

  return (
    <div className="flex w-[360px] flex-shrink-0 flex-col border-l border-gray-800 bg-gray-950">
      {/* 헤더 */}
      <div className="flex items-center gap-2 border-b border-gray-800 bg-gray-900/70 px-3 py-1.5">
        <span className="text-violet-300"><CardsIcon /></span>
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-gray-300">
          {t('ide.terminal.cards.title')}
        </span>
        <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-violet-300">
          {cards.length}
        </span>
        <button
          type="button"
          onClick={onClear}
          title={t('ide.terminal.cards.clear')}
          aria-label={t('ide.terminal.cards.clear')}
          className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-100"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title={t('ide.terminal.cards.collapse')}
          aria-label={t('ide.terminal.cards.collapse')}
          className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-100"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* 카드 목록 */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto py-1.5">
        {cards.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <span className="text-[11px] text-gray-600">{t('ide.terminal.cards.empty')}</span>
          </div>
        ) : (
          cards.map((card) => (
            <TerminalCardItem
              key={card.id}
              card={card}
              agentId={agentId}
              sessionId={sessionId}
              onSendPrompt={onSendPrompt}
            />
          ))
        )}
      </div>
    </div>
  );
});
