import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentQuestions } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { CardLiveBadge } from './AgentCardParts.js';
import { useCardSelectionCopy } from './cardSelection.js';
import { promptOverlayReserve, PROMPT_RESERVE_FALLBACK_PX } from './promptOverlayReserve.js';
import {
  buildQuestionCardText,
  buildQuestionsOnlyText,
  buildSingleQuestionText,
  collectCheckedAnswers,
  formatCheckedAnswers,
} from './questionCardText.js';

interface AgentQuestionCardProps {
  questions: AgentQuestions;
  /**
   * §4 v2.89 — "즉시 전송" 동작 주입(선택). 미지정이면 기존 동작: chat 세션에 `addCommand` 로 새 명령.
   * CMD(인터랙티브 터미널) 카드는 이 콜백으로 프롬프트를 터미널 PTY 에 prefill 한다(사람이 Enter — ToS 인루프).
   */
  onSendPrompt?: (prompt: string) => void;
  /** §5.5 #17-18 ⑦-2 — 이 카드가 속한 턴이 아직 도는 중(헤더에 `작업 중` 배지). */
  live?: boolean;
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

/** 선택 복사 (드래그 선택 표식 — 모서리 마키 + 글줄) */
function SelectionIcon(): React.JSX.Element {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7V5a1 1 0 0 1 1-1h2" />
      <path d="M17 4h2a1 1 0 0 1 1 1v2" />
      <path d="M20 17v2a1 1 0 0 1-1 1h-2" />
      <path d="M7 20H5a1 1 0 0 1-1-1v-2" />
      <path d="M8 9.5h8" />
      <path d="M8 14h5" />
    </svg>
  );
}

/**
 * 복사 동작 한 벌(클립보드 쓰기 + 1.4s 체크 피드백). 카드 안 복사 버튼이 셋(헤더 / 질문 하나 /
 * 답지)이라 각자 타이머·상태를 따로 들면 피드백 시간이 제각각이 된다 — 한 곳에 둔다.
 * `getText()` 가 빈 문자열이면 아무 일도 하지 않는다(복사할 게 없을 때 헛된 체크 표시 ❌).
 */
function useCopyAction(getText: () => string): { copied: boolean; onCopy: () => void } {
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
  return { copied, onCopy };
}

/**
 * §4 v3.42 — 카드 상단 복사 버튼(카드 전체 / 질문만 / 선택 복사). 클릭 시 `getText()` 로 만든 문자열을
 * 클립보드에 넣고, 1.4s 동안 체크 아이콘으로 피드백. 헤더 톤(작은 sky 글리프)을 유지한다.
 *
 * ⚠ `onMouseDown` 에서 기본 동작을 막는다 — mousedown 은 **사용자가 방금 드래그한 선택을 풀어 버린다**.
 *   선택 복사 버튼은 그 선택이 살아 있어야 일할 수 있고, 나머지 버튼도 누를 때 포커스를 뺏지 않는 편이
 *   낫다(입력창에 쓰던 자리를 지키기 위해).
 */
const HeaderCopyButton = memo(function HeaderCopyButton({
  label,
  title,
  icon,
  getText,
  disabled,
}: {
  label: string;
  title: string;
  icon: React.JSX.Element;
  getText: () => string;
  /** 지금은 복사할 것이 없음(선택 복사 — 고른 부분이 없을 때). 버튼은 남고 회색으로 잠긴다. */
  disabled?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { copied, onCopy } = useCopyAction(getText);

  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onCopy}
      disabled={disabled === true}
      title={copied ? t('ide.question.copied') : title}
      aria-label={copied ? t('ide.question.copied') : title}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[12px] font-medium transition-colors ${
        disabled === true
          ? 'cursor-not-allowed border-white/5 bg-gray-900/40 text-gray-600'
          : copied
            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
            : 'border-sky-500/30 bg-sky-500/10 text-sky-200 hover:border-sky-400/50 hover:bg-sky-500/20 hover:text-sky-100'
      }`}
    >
      {copied ? <CheckIcon /> : icon}
      <span>{copied ? t('ide.question.copied') : label}</span>
    </button>
  );
});

/**
 * 질문 한 줄만 복사 — 질문 행에 호버(또는 키보드 포커스)했을 때만 드러나는 작은 글리프.
 *
 * 헤더의 통짜 복사(전체/질문 전부)와 드래그 선택 복사 사이의 빈칸을 메운다. 질문이 여럿인 카드에서
 * "이 질문 + 그 답지"만 인용하고 싶은 것이 가장 흔한데, 그걸 매번 정확히 드래그하게 두는 건 손이 많이
 * 간다. 상시 노출하면 카드가 시끄러워지므로 `CardHoverControls` 와 같은 감각으로 호버 때만 보인다.
 */
const QuestionCopyButton = memo(function QuestionCopyButton({ getText }: { getText: () => string }): React.JSX.Element {
  const { t } = useTranslation();
  const { copied, onCopy } = useCopyAction(getText);
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onCopy}
      title={copied ? t('ide.question.copied') : t('ide.question.copyOne')}
      aria-label={copied ? t('ide.question.copied') : t('ide.question.copyOne')}
      className={`mt-0.5 inline-flex flex-shrink-0 items-center rounded border p-1 transition-all focus-visible:opacity-100 group-hover/q:opacity-100 ${
        copied
          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 opacity-100'
          : 'border-white/10 bg-gray-900/60 text-gray-400 opacity-0 hover:border-white/20 hover:bg-gray-800/80 hover:text-gray-100'
      }`}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
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

  // 답이 확정된 질문에서는 더 이상 상호작용 ❌ (선택된 박스든 흐려진 박스든 모두 잠금).
  const inert = disabled || wasSent;
  // 선택되지 않은 다른 후보 → 흐리게.
  const dimmed = disabled && !wasSent;

  const getPromptText = useCallback(() => (inert ? '' : prompt), [prompt, inert]);
  const { copied, onCopy } = useCopyAction(getPromptText);

  // 우상단 버튼 묶음이 실제로 먹는 폭을 재서 본문이 그만큼 비켜 가게 한다.
  //
  // 종전엔 `pr-20`(80px) 상수로 잡았는데 즉시 전송 버튼에는 번역되는 글자 라벨이 붙는다 — 라벨이
  // 길면 묶음이 80px 을 넘어 프롬프트 **첫 줄이 버튼 밑으로 파고들어 글자가 가려졌다**. 폭을 흔드는
  // 것은 언어만이 아니라 전송 뒤 라벨 교체·글꼴 뒤늦은 로드까지라 상수로는 못 맞춘다(→ 실측).
  const boxRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [reserve, setReserve] = useState(PROMPT_RESERVE_FALLBACK_PX);
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const box = boxRef.current;
    if (!overlay || !box) return undefined;
    const apply = (): void => {
      setReserve(promptOverlayReserve(
        overlay.getBoundingClientRect().width,
        box.getBoundingClientRect().width,
      ));
    };
    apply(); // 라벨 교체(즉시 전송→전송됨)·언어 전환은 리렌더로 여기서 다시 잡힌다.
    if (typeof ResizeObserver === 'undefined') return undefined;
    // 글꼴 로드·창/분할 폭 변화는 리렌더 없이 폭만 바꾸므로 관측이 따로 필요하다.
    // (예약 폭이 바뀌면 상자 높이가 변해 관측이 한 번 더 돌지만, 같은 값이면 setState 가 멈춘다.)
    const ro = new ResizeObserver(apply);
    ro.observe(overlay);
    ro.observe(box);
    return () => ro.disconnect();
  }, [copied, wasSent, inert, t]);

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
      <div ref={boxRef} className="relative min-w-0 flex-1">
        <pre
          style={{ paddingRight: reserve }}
          className={`scrollbar-thin overflow-x-auto whitespace-pre-wrap break-words rounded border py-2 pl-2.5 font-mono text-[12px] leading-relaxed transition-opacity ${
            dimmed
              ? 'border-gray-700/40 bg-gray-800/30 text-gray-500 opacity-50'
              : checked
                ? 'border-sky-500/40 bg-sky-500/10 text-gray-100'
                : 'border-gray-700/60 bg-gray-800/60 text-gray-200'
          }`}
        >
          {prompt}
        </pre>
        <div ref={overlayRef} className="absolute right-1.5 top-1.5 flex items-center gap-1">
          <button
            type="button"
            onClick={onCopy}
            disabled={inert}
            title={copied ? t('ide.question.copied') : t('ide.question.copy')}
            aria-label={copied ? t('ide.question.copied') : t('ide.question.copy')}
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[12px] font-medium transition-colors ${
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
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[12px] font-semibold transition-colors ${
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
  const getOwnText = useCallback(() => buildSingleQuestionText(item, index, multi), [item, index, multi]);
  return (
    <li className="group/q flex flex-col">
      {/* 질문 */}
      <div className="flex items-start gap-1.5">
        {multi && (
          <span className="mt-0.5 flex-shrink-0 rounded bg-sky-500/20 px-1.5 py-0.5 text-[12px] font-bold text-sky-300">
            {index + 1}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {item.header && (
            <div className="text-[12px] font-semibold uppercase tracking-wide text-sky-400/80">{item.header}</div>
          )}
          <p className="whitespace-pre-wrap break-words text-[13px] font-medium leading-relaxed text-gray-100">
            {item.question}
          </p>
        </div>
        <QuestionCopyButton getText={getOwnText} />
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
export const AgentQuestionCard = memo(function AgentQuestionCard({ questions, onSendPrompt, live }: AgentQuestionCardProps): React.JSX.Element {
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

  // 체크박스로 고른 답 한 벌 — **개수도 전송도 복사도 이 하나를 본다.** 따로 세면 `선택한 N개 전송` 이
  // 말하는 수와 실제로 가는 답이 어긋난다(이미 답한 질문에 남은 체크가 그 자리다).
  const checkedAnswers = useMemo(
    () => collectCheckedAnswers(questions, selected, answered),
    [questions, selected, answered],
  );
  const selectedCount = checkedAnswers.prompts.length;

  // 종합 전송: 고른 답들을 질문/답 순서대로 한 번에 새 명령으로 전송(질문 잠금은 질문마다 첫 선택 답 기준).
  const handleSendSelected = useCallback(() => {
    if (checkedAnswers.prompts.length === 0) return;
    sendPrompt(formatCheckedAnswers(checkedAnswers));
    setAnswered((prev) => ({ ...checkedAnswers.lockNext, ...prev }));
    setSelected({});
  }, [checkedAnswers, sendPrompt]);

  const clearSelection = useCallback(() => setSelected({}), []);

  // 카드 전체 복사: note + 각 질문(헤더/본문) + 제안 답들. 형식은 questionCardText 한 곳에만 둔다.
  const buildCardText = useCallback((): string => buildQuestionCardText(questions), [questions]);

  // 질문만 복사: 제안 답 없이 질문 텍스트(헤더 포함)만.
  const buildQuestionsText = useCallback((): string => buildQuestionsOnlyText(questions), [questions]);

  // 선택 복사: 사용자가 이 카드 안에서 **고른 것**. 원천이 둘이다 —
  //   ① 드래그 선택(카드 경계에서 자름, 줄바꿈 보존). 고른 그 순간에 텍스트를 떠 두므로, 스트림이
  //      다시 그려져 선택이 풀린 뒤에 눌러도 그때 고른 부분이 그대로 복사된다.
  //   ② 답지 체크박스. 체크는 화면에 그대로 남아 있는 선택인데도 이 버튼의 사정권 밖이라, 체크를
  //      해 놓고도 버튼이 회색이었다 — 전송과 **같은 함수**로 찍어 붙여넣은 것과 보낸 것을 일치시킨다.
  const rootRef = useRef<HTMLDivElement>(null);
  const buildCheckedText = useCallback(() => formatCheckedAnswers(checkedAnswers), [checkedAnswers]);
  const { enabled: canCopySelection, getText: buildSelectionText } = useCardSelectionCopy(
    rootRef,
    questions.id,
    { present: selectedCount > 0, getText: buildCheckedText },
  );

  // 버튼이 잠겨 있을 때는 **켜는 방법**을, 켜져 있을 때는 **무엇이 복사되는지**를 말한다.
  const selectionTitle = selectedCount > 0
    ? t('ide.question.copySelectionChecked', { n: selectedCount })
    : canCopySelection
      ? t('ide.question.copySelection')
      : t(multi ? 'ide.question.copySelectionHintCheckable' : 'ide.question.copySelectionHint');

  return (
    <div ref={rootRef} className="mx-2 my-1.5 overflow-hidden rounded-md border border-sky-500/40 bg-sky-500/5">
      {/* 헤더 */}
      <div className="flex items-center gap-2 border-b border-sky-500/20 bg-sky-500/10 px-3 py-1.5">
        <svg className="h-3.5 w-3.5 flex-shrink-0 text-sky-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
        <span className="flex-1 text-[12px] font-semibold uppercase tracking-wide text-sky-300">
          {t('ide.question.title')}
        </span>
        <div className="flex flex-wrap items-center justify-end gap-1">
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
          {/* 선택 복사 — 고른 것이 없으면 회색으로 남겨 "고르면 이걸 쓸 수 있다"를 알린다(숨기면 못 찾는다). */}
          <HeaderCopyButton
            label={t('ide.question.copySelection')}
            title={selectionTitle}
            icon={<SelectionIcon />}
            getText={buildSelectionText}
            disabled={!canCopySelection}
          />
        </div>
        {live && <CardLiveBadge />}
        <span className="select-none text-[12px] text-gray-500">{formatTime(questions.createdAt)}</span>
      </div>

      <div className="px-3 py-2">
        {questions.note && (
          <p className="mb-2 text-[13px] leading-relaxed text-gray-300">{questions.note}</p>
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
                className="rounded border border-white/10 bg-gray-900/60 px-2 py-1 text-[12px] font-medium text-gray-400 transition-colors hover:border-white/20 hover:text-gray-200"
              >
                {t('ide.question.selectNone')}
              </button>
            )}
            <button
              type="button"
              onClick={handleSendSelected}
              disabled={selectedCount === 0}
              className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-[12px] font-semibold transition-colors ${
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
