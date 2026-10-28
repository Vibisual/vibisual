import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentReport, AgentQuestions, AgentReview, AgentList } from '@vibisual/shared';
import type { TerminalCard } from './terminalCardSniffer.js';
import { AgentReportCard } from './AgentReportCard.js';
import { AgentQuestionCard } from './AgentQuestionCard.js';
import { AgentReviewCard } from './AgentReviewCard.js';
import { AgentListCard } from './AgentListCard.js';

// §4 — CMD 카드 패널. 스니퍼가 숨긴 마커 줄의 `TerminalCard` 를 xterm 밖 DOM 에 그린다 — 터미널 안(ANSI 박스)에 그리면 TUI 가 다시 그릴 때 깨진다.

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
  /**
   * 좁은 칸(`terminalRailOverlays`)에선 레일을 접힌 띠로 시작해 펼치면 터미널 위에 뜬다(옆에 세우면 360px 이 터미널을 0 까지 누른다).
   * 띠는 덮는 동안도 제자리다 — 빠지면 폭이 바뀌어 PTY 가 화면을 다시 그린다.
   */
  overlay?: boolean;
}

/** 레일 헤더의 작은 아이콘 단추 — 터치에서는 손가락 크기로 키운다. */
const RAIL_ICON_BUTTON = 'rounded p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-100 pointer-coarse:p-2.5';

/** 카드 헤더 글리프 — 겹친 카드(layers). */
function CardsIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="13" height="13" rx="2" />
      <path d="M8 21h10a2 2 0 0 0 2-2V9" />
    </svg>
  );
}

/**
 * §5.5 #17-12 — 한 턴에 카드는 한 장. 신고 바로 뒤에 붙어 온 검수는 별도 카드로 쌓지 않고
 * 그 신고 카드 안쪽 구획으로 합친다(같은 보고에서 연달아 방출되므로 인접이 곧 같은 턴이다).
 */
export interface PairedTerminalCard {
  card: TerminalCard;
  review?: TerminalCard;
}
export function pairTerminalCards(cards: TerminalCard[]): PairedTerminalCard[] {
  const out: PairedTerminalCard[] = [];
  for (let i = 0; i < cards.length; i++) {
    const cur = cards[i]!;
    const next = cards[i + 1];
    if (cur.kind === 'report' && next && next.kind === 'review') {
      out.push({ card: cur, review: next });
      i++;
      continue;
    }
    out.push({ card: cur });
  }
  return out;
}

/** 단일 TerminalCard → 알맞은 기존 카드 컴포넌트로 렌더. */
function TerminalCardItem({ card, review, agentId, sessionId, onSendPrompt }: {
  card: TerminalCard;
  review?: TerminalCard;
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
    const mergedReview: AgentReview | undefined = review && review.kind === 'review'
      ? {
          id: review.id, agentId, subAgentId,
          instruction: review.instruction, changes: review.changes, checkpoints: review.checkpoints,
          note: review.note, createdAt: review.createdAt,
        }
      : undefined;
    return <AgentReportCard report={report} review={mergedReview} />;
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
  cards, agentId, sessionId, onSendPrompt, onClear, overlay = false,
}: IDETerminalCardRailProps): React.JSX.Element {
  const { t } = useTranslation();
  // 넓은 칸에서 사용자가 접어 둔 것.
  const [collapsed, setCollapsed] = useState(false);
  // 좁은 칸에서 펼쳐 덮은 것 — 넓은 칸의 접힘과 따로 든다. 넓어지면 내려 두어, 다시 좁아질 때는 접힌 띠로 시작한다.
  const [overlayOpen, setOverlayOpen] = useState(false);
  useEffect(() => {
    if (!overlay) setOverlayOpen(false);
  }, [overlay]);

  // 접힘 — 얇은 세로 스트립(개수 배지 + 펼치기).
  const strip = (
    <button
      type="button"
      onClick={() => { if (overlay) setOverlayOpen(true); else setCollapsed(false); }}
      title={t('ide.terminal.cards.expand')}
      aria-label={t('ide.terminal.cards.expand')}
      className="flex w-9 flex-shrink-0 flex-col items-center gap-2 border-l border-gray-800 bg-gray-900/60 py-2 text-gray-400 transition-colors hover:bg-gray-800/60 hover:text-gray-200"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      <span className="rounded bg-violet-500/20 px-1 py-0.5 text-[12px] font-bold tabular-nums text-violet-300">
        {cards.length}
      </span>
      <span className="[writing-mode:vertical-rl] text-[12px] font-semibold uppercase tracking-wide">
        {t('ide.terminal.cards.title')}
      </span>
    </button>
  );

  if (overlay) {
    // 좁은 칸 — 띠는 늘 제자리, 펼치면 터미널 위에 덮는다(칸보다 넓어지지 않는다).
    return (
      <>
        {strip}
        {overlayOpen && (
          <div className="absolute inset-y-0 right-0 z-30 flex w-[min(360px,100%)] flex-col border-l border-gray-800 bg-gray-950 shadow-2xl shadow-black/60">
            <CardRailBody
              cards={cards} agentId={agentId} sessionId={sessionId}
              onSendPrompt={onSendPrompt} onClear={onClear} onCollapse={() => setOverlayOpen(false)}
            />
          </div>
        )}
      </>
    );
  }

  if (collapsed) return strip;

  return (
    <div className="flex w-[360px] flex-shrink-0 flex-col border-l border-gray-800 bg-gray-950">
      <CardRailBody
        cards={cards} agentId={agentId} sessionId={sessionId}
        onSendPrompt={onSendPrompt} onClear={onClear} onCollapse={() => setCollapsed(true)}
      />
    </div>
  );
});

/** 펼친 레일의 속 — 헤더(제목·개수·비우기·접기) + 카드 목록. 자리(옆에 서느냐 덮느냐)는 감싸는 쪽이 정한다. */
function CardRailBody({ cards, agentId, sessionId, onSendPrompt, onClear, onCollapse }: {
  cards: TerminalCard[];
  agentId: string;
  sessionId: string | null;
  onSendPrompt: (prompt: string) => void;
  onClear: () => void;
  onCollapse: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      {/* 헤더 */}
      <div className="flex items-center gap-2 border-b border-gray-800 bg-gray-900/70 px-3 py-1.5">
        <span className="text-violet-300"><CardsIcon /></span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-wide text-gray-300">
          {t('ide.terminal.cards.title')}
        </span>
        <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-violet-300">
          {pairTerminalCards(cards).length}
        </span>
        <button
          type="button"
          onClick={onClear}
          title={t('ide.terminal.cards.clear')}
          aria-label={t('ide.terminal.cards.clear')}
          className={RAIL_ICON_BUTTON}
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
          onClick={onCollapse}
          title={t('ide.terminal.cards.collapse')}
          aria-label={t('ide.terminal.cards.collapse')}
          className={RAIL_ICON_BUTTON}
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
            <span className="text-[12px] text-gray-600">{t('ide.terminal.cards.empty')}</span>
          </div>
        ) : (
          pairTerminalCards(cards).map(({ card, review }) => (
            <TerminalCardItem
              key={card.id}
              card={card}
              review={review}
              agentId={agentId}
              sessionId={sessionId}
              onSendPrompt={onSendPrompt}
            />
          ))
        )}
      </div>
    </>
  );
}
