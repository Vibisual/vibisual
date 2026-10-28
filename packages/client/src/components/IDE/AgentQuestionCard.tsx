import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentQuestions } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useScrollReveal } from '../../hooks/useScrollReveal.js';
import { CardLiveBadge } from './AgentCardParts.js';
import { useCardSelectionCopy } from './cardSelection.js';
import { promptOverlayReserve, PROMPT_RESERVE_FALLBACK_PX } from './promptOverlayReserve.js';
import { QUESTION_ANSWER_MAX_LENGTH, useQuestionCardState } from './questionCardState.js';
import {
  buildQuestionCardText,
  buildCustomAnswerText,
  CUSTOM_ANSWER_INDEX,
  buildQuestionsOnlyText,
  buildSingleQuestionText,
  collectCheckedAnswers,
  formatCheckedAnswers,
} from './questionCardText.js';

interface AgentQuestionCardProps {
  questions: AgentQuestions;
  /** §4 — "즉시 전송" 주입(선택). 없으면 chat 세션에 `addCommand`. CMD 카드는 PTY 에 prefill 만 한다(Enter 는 사람이 — ToS 인루프). */
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

/** 직접 입력 (연필) */
function PencilIcon(): React.JSX.Element {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
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
 * §4 — 즉시 전송은 두 번 눌러야 나간다(모델이 쓴 글이라 빗맞은 클릭 한 번에 나가면 안 된다 — 사람이 한 번 더 보내겠다고 해야 한다).
 * 첫 클릭은 겨눔(모달 ❌ — 스트림 스크롤을 뺏는다), `INSTANT_ARM_MS` 뒤 풀린다.
 */
const INSTANT_ARM_MS = 4000;

function useInstantArm(onInstant: () => void, prompt: string): { armed: boolean; onArmOrSend: () => void } {
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<number | null>(null);
  // 확인한 답을 고치면 다시 확인한다. 사라진 카드의 타이머도 회수한다.
  useEffect(() => {
    setArmed(false);
    return () => {
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
    };
  }, [prompt]);
  const onArmOrSend = useCallback(() => {
    if (armTimer.current !== null) window.clearTimeout(armTimer.current);
    if (!armed) {
      setArmed(true);
      armTimer.current = window.setTimeout(() => setArmed(false), INSTANT_ARM_MS);
      return;
    }
    setArmed(false);
    onInstant();
  }, [armed, onInstant]);
  return { armed, onArmOrSend };
}

/** 복사 동작 한 벌(클립보드 + 1.4s 체크) — 카드 안 복사 버튼 셋의 피드백을 맞춘다. 빈 문자열이면 무동작. */
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

/** §4 — 카드 상단 복사 버튼(전체 / 질문만 / 선택). ⚠ `onMouseDown` 기본 동작을 막는다 — mousedown 이 방금 드래그한 선택을 풀어 선택 복사가 죽는다. */
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

/** 질문 하나(+ 답지)만 복사 — 행 호버·포커스 때만 보이는 글리프(`CardHoverControls` 감각). */
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
      // 터치에는 hover 가 없다 — 늘 보이고 손가락 크기로 키운다(그래야 이 질문만 복사하는 길이 남는다).
      className={`mt-0.5 inline-flex flex-shrink-0 items-center rounded border p-1 transition-all focus-visible:opacity-100 group-hover/q:opacity-100 pointer-coarse:mt-0 pointer-coarse:p-2.5 ${
        copied
          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 opacity-100'
          : 'border-white/10 bg-gray-900/60 text-gray-400 opacity-0 hover:border-white/20 hover:bg-gray-800/80 hover:text-gray-100 pointer-coarse:opacity-100'
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
      // 터치에서는 보이는 크기는 그대로 두고 누르는 자리만 손가락 크기로 넓힌다(투명 ::before).
      className={`relative mt-2 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-[''] ${
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
 * §4 — 제안 프롬프트 박스(CodeBlock 톤): 복사 + 즉시 전송. 보내면 그 질문의 다른 후보는 `disabled`, 보낸 박스는 `wasSent`(emerald).
 * 다중 질문이면 체크박스(`selectable`)로 골라 한 번에 보낸다.
 */
const PromptBox = memo(function PromptBox({
  prompt,
  onInstant,
  disabled,
  wasSent,
  selectable,
  checked,
  onToggle,
  editable,
}: {
  prompt: string;
  onInstant: () => void;
  disabled: boolean;
  wasSent: boolean;
  selectable: boolean;
  checked: boolean;
  onToggle: () => void;
  editable?: {
    value: string;
    onChange: (value: string) => void;
    /** 버튼으로 막 연 입력칸 — 바로 쓸 수 있게 초점을 준다. */
    autoFocus?: boolean;
    onFocus?: () => void;
    onBlur?: () => void;
  };
}): React.JSX.Element {
  const { t } = useTranslation();
  const inputId = useId();
  const scrollReveal = useScrollReveal();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoFocus = editable?.autoFocus === true;
  // 칸은 사용자가 방금 누른 버튼 자리에 열리므로 이미 보인다 — 초점이 스트림 스크롤을 흔들지 않게 한다.
  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  // 답이 확정된 질문에서는 더 이상 상호작용 ❌ (선택된 박스든 흐려진 박스든 모두 잠금).
  const inert = disabled || wasSent;
  const actionDisabled = inert || !prompt.trim();
  // 선택되지 않은 다른 후보 → 흐리게.
  const dimmed = disabled && !wasSent;

  const getPromptText = useCallback(() => (inert ? '' : prompt), [prompt, inert]);
  const { copied, onCopy } = useCopyAction(getPromptText);
  const { armed, onArmOrSend } = useInstantArm(onInstant, prompt);

  // 버튼 묶음의 실제 폭을 재 본문을 비킨다 — 상수(`pr-20`)면 번역 라벨·라벨 교체·늦은 글꼴로 넓어져 첫 줄이 가려진다.
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
  }, [copied, wasSent, armed, inert, t]);

  // 버튼은 **누르면 벌어지는 일**을 적는다 — 겨눔 상태에서는 "한 번 더 누르면 나간다"를 말한다.
  const instantLabel = wasSent
    ? t('ide.question.instantSent')
    : armed
      ? t('ide.question.instantConfirm')
      : t('ide.question.instant');

  return (
    <div className="group/prompt mt-1.5 flex items-start gap-2">
      {selectable && (
        <SelectCheckbox
          checked={checked}
          disabled={actionDisabled}
          onToggle={onToggle}
          label={t('ide.question.selectAnswer')}
        />
      )}
      <div className="min-w-0 flex-1">
        {editable && (
          <label htmlFor={inputId} className="mb-1 block text-[12px] font-medium text-sky-300">
            {t('ide.askQuestion.otherLabel')}
          </label>
        )}
        <div ref={boxRef} className="relative">
          {editable ? (
            <textarea
              ref={textareaRef}
              id={inputId}
              value={editable.value}
              onChange={(e) => editable.onChange(e.target.value)}
              onFocus={editable.onFocus}
              onBlur={editable.onBlur}
              disabled={inert}
              rows={2}
              maxLength={QUESTION_ANSWER_MAX_LENGTH}
              placeholder={t('ide.askQuestion.otherAnswerPlaceholder')}
              style={{ paddingRight: reserve }}
              className="scrollbar-thin block w-full resize-y rounded border border-gray-700/60 bg-gray-800/60 py-2 pl-2.5 text-[12px] leading-relaxed text-gray-100 outline-none focus:border-sky-400/60 disabled:opacity-50"
              {...scrollReveal}
            />
          ) : <pre
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
          </pre>}
          <div ref={overlayRef} className="absolute right-1.5 top-1.5 flex items-center gap-1">
            <button
              type="button"
              onClick={onCopy}
              disabled={actionDisabled}
              title={copied ? t('ide.question.copied') : t('ide.question.copy')}
              aria-label={copied ? t('ide.question.copied') : t('ide.question.copy')}
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[12px] font-medium transition-colors ${
                actionDisabled
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
              onClick={onArmOrSend}
              disabled={actionDisabled}
              title={instantLabel}
              aria-label={instantLabel}
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[12px] font-semibold transition-colors ${
                wasSent
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : actionDisabled
                    ? 'cursor-not-allowed border-white/5 bg-gray-900/40 text-gray-600'
                    : armed
                      ? 'border-amber-400/60 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                      : 'border-sky-500/40 bg-sky-500/15 text-sky-300 hover:border-sky-400/60 hover:bg-sky-500/25 hover:text-sky-200'
              }`}
            >
              {wasSent ? <CheckIcon /> : <ZapIcon />}
              <span>{instantLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

/**
 * 직접 입력 열기 — 접힌 보조 칸(§4). 카드의 본체는 고를 답이라 늘 펼친 입력칸은 "직접 쓰는 칸"으로 읽힌다 —
 * 제안 아래 점선 버튼 한 줄로만 선다(다중 질문은 체크박스 폭만큼 들인다).
 */
const CustomAnswerToggle = memo(function CustomAnswerToggle({
  indent,
  disabled,
  onOpen,
}: {
  indent: boolean;
  /** 다른 답으로 이미 답한 질문 — 열 수 없다. */
  disabled: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const label = t('ide.askQuestion.otherLabel');
  return (
    <div className={`mt-1.5 ${indent ? 'pl-6' : ''}`}>
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        title={label}
        aria-label={label}
        aria-expanded={false}
        className={`inline-flex items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-[12px] font-medium transition-colors ${
          disabled
            ? 'cursor-not-allowed border-white/5 text-gray-600'
            : 'border-gray-600/70 text-gray-400 hover:border-sky-400/50 hover:bg-sky-500/10 hover:text-sky-200'
        }`}
      >
        <PencilIcon />
        <span>{label}</span>
      </button>
    </div>
  );
});

/**
 * 질문 1개 + 제안들. 보내면 이 질문만 `answeredIdx` 로 잠긴다. §4 다중 질문은 선택/잠금을 카드가 소유한다(종합 전송이 질문을 가로질러 잠근다).
 * 직접 입력은 비운 채 초점을 떠나면 접히고 답이 있으면 열린 채 — 판정이 카드 캐시의 답 문자열이라 가상 목록이 다시 그려도 같다.
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
  customAnswer,
  onCustomAnswer,
}: {
  item: AgentQuestions['items'][number];
  index: number;
  multi: boolean;
  selectable: boolean;
  answeredIdx: number | null;
  selectedSet: Set<number>;
  onInstant: (promptIdx: number, prompt: string) => void;
  onToggle: (promptIdx: number) => void;
  customAnswer: string;
  onCustomAnswer: (value: string) => void;
}): React.JSX.Element {
  const getOwnText = useCallback(() => buildSingleQuestionText(item, index, multi), [item, index, multi]);
  const customPrompt = buildCustomAnswerText(item, index, multi, customAnswer);
  // 사용자가 열었거나 그 칸에서 쓰는 중이면 열려 있다. 쓰는 도중 글을 다 지워도 접히지 않게 초점도 연다.
  const [customOpen, setCustomOpen] = useState(false);
  const customShown = customOpen || customAnswer.trim() !== '' || answeredIdx === CUSTOM_ANSWER_INDEX;
  const openCustom = useCallback(() => setCustomOpen(true), []);
  const foldCustomIfEmpty = useCallback(() => {
    if (!customAnswer.trim()) setCustomOpen(false);
  }, [customAnswer]);
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
      {customShown ? (
        <PromptBox
          prompt={customPrompt}
          disabled={answeredIdx !== null}
          wasSent={answeredIdx === CUSTOM_ANSWER_INDEX}
          selectable={selectable}
          checked={selectedSet.has(CUSTOM_ANSWER_INDEX)}
          onToggle={() => onToggle(CUSTOM_ANSWER_INDEX)}
          onInstant={() => onInstant(CUSTOM_ANSWER_INDEX, customPrompt)}
          editable={{
            value: customAnswer,
            onChange: onCustomAnswer,
            autoFocus: customOpen,
            onFocus: openCustom,
            onBlur: foldCustomIfEmpty,
          }}
        />
      ) : (
        <CustomAnswerToggle indent={selectable} disabled={answeredIdx !== null} onOpen={openCustom} />
      )}
    </li>
  );
});

/**
 * §4 — 에이전트 질문 인라인 카드(`POST /api/agent-questions` — 질문 1~N + 제안 프롬프트). AskQuestionCard(동기 hold)와 별개로 비차단이다.
 * 본체는 고를 답 — 직접 입력은 접힌 보조 칸(`CustomAnswerToggle`).
 */
export const AgentQuestionCard = memo(function AgentQuestionCard({ questions, onSendPrompt, live }: AgentQuestionCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const addCommand = useGraphStore((s) => s.addCommand);

  const sendPrompt = useCallback((prompt: string) => {
    if (onSendPrompt) { onSendPrompt(prompt); return; }
    addCommand(questions.agentId, prompt, questions.subAgentId);
  }, [onSendPrompt, addCommand, questions.agentId, questions.subAgentId]);

  const multi = questions.items.length > 1;

  // 질문별 선택·전송 잠금·작성 중 답변은 스크롤로 카드가 재마운트돼도 함께 보존한다.
  const [{ answered, selected, customAnswers }, updateState] = useQuestionCardState(questions.id);

  const updateCustomAnswer = useCallback((qi: number, value: string) => {
    updateState((prev) => {
      const cur = new Set(prev.selected[qi] ?? []);
      if (value.trim()) cur.add(CUSTOM_ANSWER_INDEX); else cur.delete(CUSTOM_ANSWER_INDEX);
      return {
        ...prev,
        customAnswers: { ...prev.customAnswers, [qi]: value },
        selected: { ...prev.selected, [qi]: cur },
      };
    });
  }, [updateState]);

  const handleInstant = useCallback((qi: number, pi: number, prompt: string) => {
    if (!prompt.trim() || answered[qi] !== undefined) return;
    sendPrompt(prompt);
    updateState((prev) => ({ ...prev, answered: { ...prev.answered, [qi]: pi } }));
  }, [sendPrompt, answered, updateState]);

  const toggleSelect = useCallback((qi: number, pi: number) => {
    updateState((prev) => {
      const cur = new Set(prev.selected[qi] ?? []);
      if (cur.has(pi)) cur.delete(pi); else cur.add(pi);
      return { ...prev, selected: { ...prev.selected, [qi]: cur } };
    });
  }, [updateState]);

  // 체크박스로 고른 답 한 벌 — **개수도 전송도 복사도 이 하나를 본다.** 따로 세면 `선택한 N개 전송` 이
  // 말하는 수와 실제로 가는 답이 어긋난다(이미 답한 질문에 남은 체크가 그 자리다).
  const checkedAnswers = useMemo(
    () => collectCheckedAnswers(questions, selected, answered, customAnswers),
    [questions, selected, answered, customAnswers],
  );
  const selectedCount = checkedAnswers.prompts.length;

  // 종합 전송: 고른 답들을 질문/답 순서대로 한 번에 새 명령으로 전송(질문 잠금은 질문마다 첫 선택 답 기준).
  const handleSendSelected = useCallback(() => {
    if (checkedAnswers.prompts.length === 0) return;
    sendPrompt(formatCheckedAnswers(checkedAnswers));
    updateState((prev) => ({ ...prev, answered: { ...checkedAnswers.lockNext, ...prev.answered }, selected: {} }));
  }, [checkedAnswers, sendPrompt, updateState]);

  const clearSelection = useCallback(() => updateState((prev) => ({ ...prev, selected: {} })), [updateState]);

  // 카드 전체 복사: note + 각 질문(헤더/본문) + 제안 답들. 형식은 questionCardText 한 곳에만 둔다.
  const buildCardText = useCallback((): string => buildQuestionCardText(questions), [questions]);

  // 질문만 복사: 제안 답 없이 질문 텍스트(헤더 포함)만.
  const buildQuestionsText = useCallback((): string => buildQuestionsOnlyText(questions), [questions]);

  // 선택 복사의 원천 둘 — ① 드래그 선택(고른 순간 떠 둬 다시 그려져도 남는다) ② 답지 체크(전송과 같은 함수 — 붙여넣은 것 = 보낸 것).
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
              key={`${questions.id}:${i}`}
              item={item}
              index={i}
              multi={multi}
              selectable={multi}
              answeredIdx={answered[i] ?? null}
              selectedSet={selected[i] ?? EMPTY_SET}
              onInstant={(pi, prompt) => handleInstant(i, pi, prompt)}
              onToggle={(pi) => toggleSelect(i, pi)}
              customAnswer={customAnswers[i] ?? ''}
              onCustomAnswer={(value) => updateCustomAnswer(i, value)}
            />
          ))}
        </ul>

        {/* §4 — 다중 질문 종합 전송 바 */}
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
