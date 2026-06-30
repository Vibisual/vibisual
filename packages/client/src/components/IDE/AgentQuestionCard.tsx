import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentQuestions } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

interface AgentQuestionCardProps {
  questions: AgentQuestions;
  /**
   * §4 v2.89 — "즉시 전송" 동작 주입(선택). 미지정이면 기존 동작: chat 세션에 `addCommand` 로 새 명령.
   * CMD(인터랙티브 터미널) 카드는 이 콜백으로 프롬프트를 터미널 PTY 에 prefill 한다(사람이 Enter — ToS 인루프).
   */
  onSendPrompt?: (prompt: string) => void;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** 복사 (겹친 사각형) */
function CopyIcon(): React.JSX.Element {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

/** 체크 (복사/전송 완료) */
function CheckIcon(): React.JSX.Element {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** 즉시 전송 (번개) */
function ZapIcon(): React.JSX.Element {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

/**
 * §4 v2.60 — 제안 프롬프트 1개 박스. 본문 text 의 코드 복사 박스(StreamRenderer CodeBlock)와 같은 톤.
 * 우상단에 복사 버튼 + 즉시 전송 버튼. 즉시 = 그 프롬프트를 해당 세션에 새 명령으로 바로 전송.
 *
 * 한 질문에서 한 후보를 즉시 전송하면 그 질문의 나머지 후보 박스는 `disabled` 로 회색 잠금
 * (전송 = 에이전트가 그 답으로 시작 → 다른 후보는 무의미). 선택된 박스는 `wasSent` 로 emerald 유지.
 */
const PromptBox = memo(function PromptBox({
  prompt,
  onInstant,
  disabled,
  wasSent,
}: {
  prompt: string;
  onInstant: () => void;
  disabled: boolean;
  wasSent: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  // 답이 확정된 질문에서는 더 이상 상호작용 ❌ (선택된 박스든 흐려진 박스든 모두 잠금).
  const inert = disabled || wasSent;
  // 선택되지 않은 다른 후보 → 흐리게.
  const dimmed = disabled && !wasSent;

  const onCopy = useCallback(() => {
    if (inert) return;
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1400);
    }).catch(() => { /* clipboard 권한 거부 — 조용히 무시 */ });
  }, [prompt, inert]);

  return (
    <div className="group/prompt relative mt-1.5">
      <pre className={`scrollbar-thin overflow-x-auto whitespace-pre-wrap break-words rounded border py-2 pl-2.5 pr-20 font-mono text-[12px] leading-relaxed transition-opacity ${
        dimmed
          ? 'border-gray-700/40 bg-gray-800/30 text-gray-500 opacity-50'
          : 'border-gray-700/60 bg-gray-800/60 text-gray-200'
      }`}>
        {prompt}
      </pre>
      <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
        <button
          type="button"
          onClick={onCopy}
          disabled={inert}
          title={copied ? t('ide.question.copied') : t('ide.question.copy')}
          aria-label={copied ? t('ide.question.copied') : t('ide.question.copy')}
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] font-medium transition-colors ${
            inert
              ? 'cursor-not-allowed border-white/5 bg-gray-900/40 text-gray-600'
              : copied
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-white/10 bg-gray-900/70 text-gray-300 hover:border-white/20 hover:bg-gray-800/80 hover:text-gray-100'
          }`}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
        <button
          type="button"
          onClick={onInstant}
          disabled={inert}
          title={wasSent ? t('ide.question.instantSent') : t('ide.question.instant')}
          aria-label={wasSent ? t('ide.question.instantSent') : t('ide.question.instant')}
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] font-semibold transition-colors ${
            wasSent
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
              : dimmed
                ? 'cursor-not-allowed border-white/5 bg-gray-900/40 text-gray-600'
                : 'border-sky-500/40 bg-sky-500/15 text-sky-300 hover:border-sky-400/60 hover:bg-sky-500/25 hover:text-sky-200'
          }`}
        >
          {wasSent ? <CheckIcon /> : <ZapIcon />}
          <span>{wasSent ? t('ide.question.instantSent') : t('ide.question.instant')}</span>
        </button>
      </div>
    </div>
  );
});

/**
 * 질문 1개 + 제안 프롬프트들. 한 후보를 즉시 전송하면 `sentIdx` 를 잠가 이 질문의
 * 다른 후보 박스를 비활성화한다(질문 단위 잠금 — 같은 카드의 다른 질문은 독립적으로 답 가능).
 */
const QuestionItem = memo(function QuestionItem({
  item,
  index,
  multi,
  onSend,
}: {
  item: AgentQuestions['items'][number];
  index: number;
  multi: boolean;
  onSend: (prompt: string) => void;
}): React.JSX.Element {
  const [sentIdx, setSentIdx] = useState<number | null>(null);

  const handleInstant = useCallback((j: number, prompt: string) => {
    if (sentIdx !== null) return; // 이미 이 질문에 답함 — 무시.
    onSend(prompt);
    setSentIdx(j);
  }, [sentIdx, onSend]);

  return (
    <li className="flex flex-col">
      {/* 질문 */}
      <div className="flex items-start gap-1.5">
        {multi && (
          <span className="mt-0.5 flex-shrink-0 rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-bold text-sky-300">
            {index + 1}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {item.header && (
            <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-400/80">{item.header}</div>
          )}
          <p className="whitespace-pre-wrap break-words text-[13px] font-medium leading-relaxed text-gray-100">
            {item.question}
          </p>
        </div>
      </div>

      {/* 제안 프롬프트들 */}
      {item.prompts.length > 0 && (
        <div className="mt-1">
          {item.prompts.map((p, j) => (
            <PromptBox
              key={j}
              prompt={p}
              disabled={sentIdx !== null}
              wasSent={sentIdx === j}
              onInstant={() => handleInstant(j, p)}
            />
          ))}
        </div>
      )}
    </li>
  );
});

/**
 * §4 v2.60 — 에이전트 질문 인라인 카드.
 *
 * 커스텀/스폰 에이전트가 `POST /api/agent-questions` 로 보낸 질문(1~N) + 제안 프롬프트를 렌더.
 * 자연어 본문에 묻히기 쉬운 "사용자에게 묻는 질문"을 눈에 띄게 카드로 보여주고, 각 제안 프롬프트는
 * 복사 박스로 감싸 복사 / 즉시 전송(그 세션에 새 명령) 버튼을 단다. 기존 AskQuestionCard(선택지+동기
 * hold)와 별개 — 이쪽은 비차단.
 */
export const AgentQuestionCard = memo(function AgentQuestionCard({ questions, onSendPrompt }: AgentQuestionCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const addCommand = useGraphStore((s) => s.addCommand);

  const sendPrompt = useCallback((prompt: string) => {
    if (onSendPrompt) { onSendPrompt(prompt); return; }
    addCommand(questions.agentId, prompt, questions.subAgentId);
  }, [onSendPrompt, addCommand, questions.agentId, questions.subAgentId]);

  const multi = questions.items.length > 1;

  return (
    <div className="mx-2 my-1.5 overflow-hidden rounded-md border border-sky-500/40 bg-sky-500/5">
      {/* 헤더 */}
      <div className="flex items-center gap-2 border-b border-sky-500/20 bg-sky-500/10 px-3 py-1.5">
        <svg className="h-3.5 w-3.5 flex-shrink-0 text-sky-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-sky-300">
          {t('ide.question.title')}
        </span>
        <span className="select-none text-[10px] text-gray-500">{formatTime(questions.createdAt)}</span>
      </div>

      <div className="px-3 py-2">
        {questions.note && (
          <p className="mb-2 text-[12.5px] leading-relaxed text-gray-300">{questions.note}</p>
        )}

        <ul className="flex flex-col gap-3">
          {questions.items.map((item, i) => (
            <QuestionItem key={i} item={item} index={i} multi={multi} onSend={sendPrompt} />
          ))}
        </ul>
      </div>
    </div>
  );
});
