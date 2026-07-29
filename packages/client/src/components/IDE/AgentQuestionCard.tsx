import { memo, useCallback, useMemo, useRef, useState } from 'react';
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

/** 안정 참조용 빈 Set — 선택 없는 질문에 새 Set 을 매번 만들어 리렌더 유발하지 않게. */
const EMPTY_SET: Set<number> = new Set();

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

/** 질문만 복사 (물음표) */
function QuestionsIcon(): React.JSX.Element {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/**
 * §4 v3.42 — 카드 상단 복사 버튼(카드 전체 / 질문만). 클릭 시 `getText()` 로 만든 문자열을
 * 클립보드에 넣고, 1.4s 동안 체크 아이콘으로 피드백. 헤더 톤(작은 sky 글리프)을 유지한다.
 */
const HeaderCopyButton = memo(function HeaderCopyButton({
  label,
  title,
  icon,
  getText,
}: {
  label: string;
  title: string;
  icon: React.JSX.Element;
  getText: () => string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  const onCopy = useCallback(() => {
    const text = getText();
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1400);
    }).catch(() => { /* clipboard 권한 거부 — 조용히 무시 */ });
  }, [getText]);

  return (
    <button
      type="button"
      onClick={onCopy}
      title={copied ? t('ide.question.copied') : title}
      aria-label={copied ? t('ide.question.copied') : title}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
        copied
          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
          : 'border-sky-500/30 bg-sky-500/10 text-sky-200 hover:border-sky-400/50 hover:bg-sky-500/20 hover:text-sky-100'
      }`}
    >
      {copied ? <CheckIcon /> : icon}
      <span>{copied ? t('ide.question.copied') : label}</span>
    </button>
  );
});

/** 체크박스 (답지 선택 — 종합 전송용). 사각 박스 + 선택 시 체크 글리프. */
function SelectCheckbox({
  checked,
  disabled,
  onToggle,
  label,
}: {
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  label: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onToggle}
      disabled={disabled}
      className={`mt-2 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors ${
        disabled
          ? 'cursor-not-allowed border-white/5 bg-gray-900/40 text-gray-700'
          : checked
            ? 'border-sky-400/60 bg-sky-500/25 text-sky-200'
            : 'border-white/20 bg-gray-900/60 text-transparent hover:border-sky-400/50 hover:bg-gray-800/80'
      }`}
    >
      <CheckIcon />
    </button>
  );
}

/**
 * §4 v2.60 — 제안 프롬프트 1개 박스. 본문 text 의 코드 복사 박스(StreamRenderer CodeBlock)와 같은 톤.
 * 우상단에 복사 버튼 + 즉시 전송 버튼. 즉시 = 그 프롬프트를 해당 세션에 새 명령으로 바로 전송.
 *
 * 한 질문에서 한 후보를 즉시 전송하면 그 질문의 나머지 후보 박스는 `disabled` 로 회색 잠금
 * (전송 = 에이전트가 그 답으로 시작 → 다른 후보는 무의미). 선택된 박스는 `wasSent` 로 emerald 유지.
 *
 * §4 v3.42 — 다중 질문 카드에서는 왼쪽에 체크박스(`selectable`)를 달아 여러 답을 골라
 * 하단 "선택 항목 전송" 버튼으로 한 번에 보낼 수 있게 한다.
 */
const PromptBox = memo(function PromptBox({
  prompt,
  onInstant,
  disabled,
  wasSent,
  selectable,
  checked,
  onToggle,
}: {
  prompt: string;
  onInstant: () => void;
  disabled: boolean;
  wasSent: boolean;
  selectable: boolean;
  checked: boolean;
  onToggle: () => void;
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
    <div className="group/prompt mt-1.5 flex items-start gap-2">
      {selectable && (
        <SelectCheckbox
          checked={checked}
          disabled={inert}
          onToggle={onToggle}
          label={t('ide.question.selectAnswer')}
        />
      )}
      <div className="relative min-w-0 flex-1">
        <pre className={`scrollbar-thin overflow-x-auto whitespace-pre-wrap break-words rounded border py-2 pl-2.5 pr-20 font-mono text-[12px] leading-relaxed transition-opacity ${
          dimmed
            ? 'border-gray-700/40 bg-gray-800/30 text-gray-500 opacity-50'
            : checked
              ? 'border-sky-500/40 bg-sky-500/10 text-gray-100'
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
    </div>
  );
});

/**
 * 질문 1개 + 제안 프롬프트들. 한 후보를 즉시 전송하면 카드가 이 질문을 `answeredIdx` 로 잠가
 * 다른 후보 박스를 비활성화한다(질문 단위 잠금 — 같은 카드의 다른 질문은 독립적으로 답 가능).
 *
 * §4 v3.42 — 다중 질문 카드에서는 선택/잠금 상태를 카드가 소유하고 이 컴포넌트로 내려준다
 * (종합 전송이 여러 질문을 가로질러 잠가야 하기 때문).
 */
const QuestionItem = memo(function QuestionItem({
  item,
  index,
  multi,
  selectable,
  answeredIdx,
  selectedSet,
  onInstant,
  onToggle,
}: {
  item: AgentQuestions['items'][number];
  index: number;
  multi: boolean;
  selectable: boolean;
  answeredIdx: number | null;
  selectedSet: Set<number>;
  onInstant: (promptIdx: number, prompt: string) => void;
  onToggle: (promptIdx: number) => void;
}): React.JSX.Element {
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
              disabled={answeredIdx !== null}
              wasSent={answeredIdx === j}
              selectable={selectable}
              checked={selectedSet.has(j)}
              onToggle={() => onToggle(j)}
              onInstant={() => onInstant(j, p)}
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
 *
 * §4 v3.42 — 다중 질문 편의 기능: 헤더에 "카드 전체 복사"·"질문만 복사" 버튼, 질문이 2개 이상이면
 * 각 답지에 체크박스 + 하단 "선택 항목 전송"(고른 답들을 한 번에 새 명령으로 전송)을 단다.
 */
export const AgentQuestionCard = memo(function AgentQuestionCard({ questions, onSendPrompt }: AgentQuestionCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const addCommand = useGraphStore((s) => s.addCommand);

  const sendPrompt = useCallback((prompt: string) => {
    if (onSendPrompt) { onSendPrompt(prompt); return; }
    addCommand(questions.agentId, prompt, questions.subAgentId);
  }, [onSendPrompt, addCommand, questions.agentId, questions.subAgentId]);

  const multi = questions.items.length > 1;

  // 질문 단위 잠금: questionIdx → 확정(전송)된 promptIdx. 즉시 전송·종합 전송 양쪽에서 설정.
  const [answered, setAnswered] = useState<Record<number, number>>({});
  // 체크박스 선택: questionIdx → 선택된 promptIdx 들의 Set. (다중 질문에서만 사용.)
  const [selected, setSelected] = useState<Record<number, Set<number>>>({});

  const handleInstant = useCallback((qi: number, pi: number, prompt: string) => {
    setAnswered((prev) => (prev[qi] !== undefined ? prev : { ...prev, [qi]: pi }));
    sendPrompt(prompt);
  }, [sendPrompt]);

  const toggleSelect = useCallback((qi: number, pi: number) => {
    setSelected((prev) => {
      const cur = new Set(prev[qi] ?? []);
      if (cur.has(pi)) cur.delete(pi); else cur.add(pi);
      return { ...prev, [qi]: cur };
    });
  }, []);

  // 아직 답하지 않은 질문에 대해 선택된 답의 총 개수.
  const selectedCount = useMemo(() => {
    let n = 0;
    for (const [qiStr, set] of Object.entries(selected)) {
      if (answered[Number(qiStr)] !== undefined) continue;
      n += set.size;
    }
    return n;
  }, [selected, answered]);

  // 종합 전송: 아직 답 안 한 질문들의 선택된 답을 질문/답 순서대로 모아 한 번에 새 명령으로 전송.
  const handleSendSelected = useCallback(() => {
    const chosen: string[] = [];
    const lockNext: Record<number, number> = {};
    questions.items.forEach((item, qi) => {
      if (answered[qi] !== undefined) return;
      const set = selected[qi];
      if (!set || set.size === 0) return;
      item.prompts.forEach((p, pi) => {
        if (!set.has(pi)) return;
        chosen.push(p);
        if (lockNext[qi] === undefined) lockNext[qi] = pi; // 질문 잠금은 첫 선택 답 기준.
      });
    });
    if (chosen.length === 0) return;
    sendPrompt(chosen.join('\n\n'));
    setAnswered((prev) => ({ ...lockNext, ...prev }));
    setSelected({});
  }, [questions.items, answered, selected, sendPrompt]);

  const clearSelection = useCallback(() => setSelected({}), []);

  // 카드 전체 복사: note + 각 질문(헤더/본문) + 제안 답들.
  const buildCardText = useCallback((): string => {
    const lines: string[] = [];
    if (questions.note) { lines.push(questions.note, ''); }
    questions.items.forEach((item, i) => {
      const prefix = multi ? `${i + 1}. ` : '';
      const header = item.header ? `[${item.header}] ` : '';
      lines.push(`${prefix}${header}${item.question}`);
      item.prompts.forEach((p) => lines.push(`  - ${p}`));
      if (i < questions.items.length - 1) lines.push('');
    });
    return lines.join('\n').trim();
  }, [questions.note, questions.items, multi]);

  // 질문만 복사: 제안 답 없이 질문 텍스트(헤더 포함)만.
  const buildQuestionsText = useCallback((): string => {
    return questions.items
      .map((item, i) => {
        const prefix = multi ? `${i + 1}. ` : '';
        const header = item.header ? `[${item.header}] ` : '';
        return `${prefix}${header}${item.question}`;
      })
      .join('\n');
  }, [questions.items, multi]);

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
        <div className="flex items-center gap-1">
          <HeaderCopyButton
            label={t('ide.question.copyCard')}
            title={t('ide.question.copyCard')}
            icon={<CopyIcon />}
            getText={buildCardText}
          />
          <HeaderCopyButton
            label={t('ide.question.copyQuestions')}
            title={t('ide.question.copyQuestions')}
            icon={<QuestionsIcon />}
            getText={buildQuestionsText}
          />
        </div>
        <span className="select-none text-[10px] text-gray-500">{formatTime(questions.createdAt)}</span>
      </div>

      <div className="px-3 py-2">
        {questions.note && (
          <p className="mb-2 text-[12.5px] leading-relaxed text-gray-300">{questions.note}</p>
        )}

        <ul className="flex flex-col gap-3">
          {questions.items.map((item, i) => (
            <QuestionItem
              key={i}
              item={item}
              index={i}
              multi={multi}
              selectable={multi}
              answeredIdx={answered[i] ?? null}
              selectedSet={selected[i] ?? EMPTY_SET}
              onInstant={(pi, prompt) => handleInstant(i, pi, prompt)}
              onToggle={(pi) => toggleSelect(i, pi)}
            />
          ))}
        </ul>

        {/* §4 v3.42 — 다중 질문: 선택한 답들을 한 번에 전송하는 종합 바 */}
        {multi && (
          <div className="mt-3 flex items-center justify-end gap-2 border-t border-sky-500/15 pt-2">
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={clearSelection}
                className="rounded border border-white/10 bg-gray-900/60 px-2 py-1 text-[10px] font-medium text-gray-400 transition-colors hover:border-white/20 hover:text-gray-200"
              >
                {t('ide.question.selectNone')}
              </button>
            )}
            <button
              type="button"
              onClick={handleSendSelected}
              disabled={selectedCount === 0}
              className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                selectedCount === 0
                  ? 'cursor-not-allowed border-white/5 bg-gray-900/40 text-gray-600'
                  : 'border-sky-500/50 bg-sky-500/20 text-sky-200 hover:border-sky-400/70 hover:bg-sky-500/30 hover:text-sky-100'
              }`}
            >
              <ZapIcon />
              <span>{t('ide.question.sendSelected', { n: selectedCount })}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
