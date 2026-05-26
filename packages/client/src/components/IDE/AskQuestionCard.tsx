import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AskUserQuestionRequest, AskUserQuestionAnswer } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

interface AskQuestionCardProps {
  request: AskUserQuestionRequest;
}

/** 한 step 의 사용자 입력 작업 상태 — 옵션 선택 set + note 텍스트. */
interface StepDraft {
  selected: Set<number>;
  note: string;
}

/**
 * §5.3 #12-2 v2.26 — AskUserQuestion 인라인 카드 (다중 질문 step 지원).
 *
 * claude-code 본체는 `tool_input.questions` 배열 — 한 호출에 여러 질문 가능. CLI 가 순차로
 * 물어보는 것처럼 카드도 step 으로 하나씩 surface 한다. items.length === 1 이면 step UI 가
 * 숨어 단일 질문 카드와 동일.
 *
 * "Other (직접 입력)" 옵션을 자동으로 마지막에 append. Other 선택 시 note textarea 가 primary
 * answer 입력으로 승격(required), 그렇지 않으면 supplemental(optional).
 *
 * 마지막 step 의 Send → POST /api/ask-user-question/decide (answers 배열) → broker resolve →
 * 훅이 deny + reason 합성으로 모델 transcript 도달.
 */
export function AskQuestionCard({ request }: AskQuestionCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const respond = useGraphStore((s) => s.respondAskQuestion);
  const total = request.items.length;
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<StepDraft[]>(() =>
    request.items.map(() => ({ selected: new Set<number>(), note: '' })),
  );
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(() => Math.max(0, request.expiresAt - Date.now()));
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const current = request.items[step];
  const draft = drafts[step] ?? { selected: new Set<number>(), note: '' };

  // Other 합성 옵션 인덱스 = 모델 옵션 다음.
  const otherIdx = current ? current.options.length : 0;
  const otherSelected = draft.selected.has(otherIdx);

  useEffect(() => {
    const tick = setInterval(() => {
      setRemaining(Math.max(0, request.expiresAt - Date.now()));
    }, 500);
    return () => clearInterval(tick);
  }, [request.expiresAt]);

  const updateDraft = (mut: (d: StepDraft) => StepDraft): void => {
    setDrafts((prev) => {
      const next = [...prev];
      next[step] = mut(next[step] ?? { selected: new Set<number>(), note: '' });
      return next;
    });
  };

  const toggle = (idx: number): void => {
    if (busy || !current) return;
    const multi = current.multiSelect;
    updateDraft((d) => {
      const next = new Set(d.selected);
      if (multi) {
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
      } else {
        next.clear();
        next.add(idx);
      }
      return { ...d, selected: next };
    });
    if (idx === otherIdx && !draft.selected.has(otherIdx)) {
      requestAnimationFrame(() => noteRef.current?.focus());
    }
  };

  const setNote = (value: string): void => {
    if (busy) return;
    updateDraft((d) => ({ ...d, note: value }));
  };

  const handleNoteFocus = (): void => {
    if (busy) return;
    if (draft.selected.size === 0) {
      updateDraft((d) => ({ ...d, selected: new Set([otherIdx]) }));
    }
  };

  const noteTrimmed = draft.note.trim();

  // Step 유효성: Other 면 note 필수, 그 외엔 최소 1개 옵션.
  const stepValid = otherSelected
    ? noteTrimmed.length > 0
    : draft.selected.size > 0;

  const isLast = step === total - 1;
  const canAdvance = !busy && stepValid;

  /** 현재 step draft → AskUserQuestionAnswer 컴파일. */
  const compileAnswer = (s: StepDraft, item: typeof current): AskUserQuestionAnswer => {
    if (!item) return { selectedLabels: [] };
    const otherI = item.options.length;
    const otherSel = s.selected.has(otherI);
    const noteT = s.note.trim();
    const realLabels = Array.from(s.selected)
      .filter((i) => i !== otherI)
      .sort((a, b) => a - b)
      .map((i) => item.options[i]?.label)
      .filter((l): l is string => typeof l === 'string');
    const labels = otherSel ? [...realLabels, noteT] : realLabels;
    const ans: AskUserQuestionAnswer = { selectedLabels: labels };
    if (!otherSel && noteT) ans.note = noteT;
    return ans;
  };

  const goNext = (): void => {
    if (!canAdvance) return;
    setStep((s) => Math.min(total - 1, s + 1));
  };

  const goBack = (): void => {
    if (busy) return;
    setStep((s) => Math.max(0, s - 1));
  };

  const submit = async (): Promise<void> => {
    if (!canAdvance) return;
    setBusy(true);
    const answers = request.items.map((item, i) => {
      const s = drafts[i] ?? { selected: new Set<number>(), note: '' };
      return compileAnswer(s, item);
    });
    await respond(request.requestId, answers);
  };

  const seconds = Math.ceil(remaining / 1000);

  const selectedLabels = useMemo(() => {
    if (!current) return [] as string[];
    return Array.from(draft.selected)
      .sort((a, b) => a - b)
      .map((i) => {
        if (i === otherIdx) {
          return noteTrimmed || t('ide.askQuestion.otherLabel', { defaultValue: 'Other' });
        }
        return current.options[i]?.label ?? '';
      })
      .filter(Boolean);
  }, [draft.selected, current, otherIdx, noteTrimmed, t]);

  const noteLabel = otherSelected
    ? t('ide.askQuestion.otherAnswerLabel', { defaultValue: 'Your answer (required)' })
    : t('ide.askQuestion.noteLabel', { defaultValue: 'Note (optional)' });
  const notePlaceholder = otherSelected
    ? t('ide.askQuestion.otherAnswerPlaceholder', { defaultValue: 'Type your answer here…' })
    : t('ide.askQuestion.notePlaceholder', { defaultValue: 'Add a free-form comment to send with your answer.' });

  if (!current) return <></>; // 방어 — 빈 items 는 서버에서 reject

  return (
    <div
      className="mx-3 my-2 overflow-hidden rounded-md border-2 bg-gray-900 shadow-lg"
      style={{ borderColor: request.agentColor }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-700 bg-gray-900/60 px-3 py-2">
        <span
          className="relative inline-flex h-2.5 w-2.5 flex-shrink-0 rounded-full"
          style={{ backgroundColor: request.agentColor }}
        >
          <span
            className="absolute inset-0 animate-ping rounded-full"
            style={{ backgroundColor: request.agentColor, opacity: 0.6 }}
          />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-[12px] font-bold text-gray-100">
              {current.header ?? t('ide.askQuestion.title', { defaultValue: 'Question' })}
            </h4>
            {current.multiSelect && (
              <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-sky-300">
                {t('ide.askQuestion.multiSelect', { defaultValue: 'multi' })}
              </span>
            )}
            {total > 1 && (
              <span className="rounded bg-gray-700/60 px-1.5 py-0.5 text-[9px] font-semibold text-gray-300">
                {t('ide.askQuestion.stepIndicator', { defaultValue: '{{current}} / {{total}}', current: step + 1, total })}
              </span>
            )}
          </div>
          <span className="truncate text-[10px] text-gray-500">
            {request.agentLabel}
          </span>
        </div>
        <span className="ml-2 flex-shrink-0 rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] text-gray-400">
          {seconds}s
        </span>
      </div>

      {/* Question + options — header/footer 는 고정, 이 영역만 내부 스크롤로 카드 키가 폭주하지 않게.
          options 4개 + 긴 description + multi-step 누적 시에도 Send 버튼이 화면 안에 머무름. */}
      <div className="scrollbar-thin flex max-h-[50vh] flex-col gap-2 overflow-y-auto px-3 py-3">
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-gray-200">
          {current.question}
        </p>

        <div className="mt-1 flex flex-col gap-1">
          {current.options.map((opt, idx) => {
            const isSelected = draft.selected.has(idx);
            return (
              <button
                key={idx}
                type="button"
                disabled={busy}
                onClick={() => toggle(idx)}
                className={`group flex items-start gap-2 rounded border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  isSelected
                    ? 'border-sky-500/70 bg-sky-500/10'
                    : 'border-gray-700 bg-gray-800/40 hover:border-gray-600 hover:bg-gray-800/70'
                }`}
              >
                <span className="mt-0.5 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
                  {current.multiSelect ? (
                    <svg viewBox="0 0 16 16" className={`h-full w-full ${isSelected ? 'text-sky-400' : 'text-gray-500'}`} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="12" height="12" rx="2" />
                      {isSelected && <polyline points="5 8 7 10 11 6" />}
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" className={`h-full w-full ${isSelected ? 'text-sky-400' : 'text-gray-500'}`} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="8" cy="8" r="6" />
                      {isSelected && <circle cx="8" cy="8" r="2.5" fill="currentColor" />}
                    </svg>
                  )}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={`text-[12px] ${isSelected ? 'font-semibold text-sky-200' : 'text-gray-200'}`}>
                    {opt.label}
                  </span>
                  {opt.description && (
                    <span className="text-[11px] leading-snug text-gray-500">
                      {opt.description}
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          {/* Other (직접 입력) */}
          <button
            key="__other__"
            type="button"
            disabled={busy}
            onClick={() => toggle(otherIdx)}
            className={`group flex items-start gap-2 rounded border border-dashed px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              otherSelected
                ? 'border-sky-500/70 bg-sky-500/10'
                : 'border-gray-700 bg-gray-800/40 hover:border-gray-600 hover:bg-gray-800/70'
            }`}
          >
            <span className="mt-0.5 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
              {current.multiSelect ? (
                <svg viewBox="0 0 16 16" className={`h-full w-full ${otherSelected ? 'text-sky-400' : 'text-gray-500'}`} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="12" height="12" rx="2" />
                  {otherSelected && <polyline points="5 8 7 10 11 6" />}
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" className={`h-full w-full ${otherSelected ? 'text-sky-400' : 'text-gray-500'}`} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="8" cy="8" r="6" />
                  {otherSelected && <circle cx="8" cy="8" r="2.5" fill="currentColor" />}
                </svg>
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={`text-[12px] ${otherSelected ? 'font-semibold text-sky-200' : 'text-gray-200'}`}>
                {t('ide.askQuestion.otherLabel', { defaultValue: 'Other (write your own)' })}
              </span>
              <span className="text-[11px] leading-snug text-gray-500">
                {t('ide.askQuestion.otherDescription', { defaultValue: 'Type a free-form answer below.' })}
              </span>
            </div>
          </button>
        </div>

        {/* Note / answer textarea */}
        <div className="mt-1">
          <label className={`text-[10px] ${otherSelected ? 'text-sky-300' : 'text-gray-500'}`}>
            {noteLabel}
          </label>
          <textarea
            ref={noteRef}
            value={draft.note}
            onChange={(e) => setNote(e.target.value)}
            onFocus={handleNoteFocus}
            placeholder={notePlaceholder}
            disabled={busy}
            rows={1}
            className={`mt-1 w-full resize-none rounded border px-2 py-1 text-[11px] text-gray-200 outline-none disabled:opacity-50 ${
              otherSelected
                ? 'border-sky-500/70 bg-gray-800 focus:border-sky-400'
                : 'border-gray-700 bg-gray-800 focus:border-sky-500'
            }`}
            style={{ minHeight: 24, maxHeight: 80 }}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-gray-700 bg-gray-900/40 px-3 py-2">
        <span className="truncate text-[10px] text-gray-600">
          {selectedLabels.length > 0
            ? t('ide.askQuestion.selectedPreview', { defaultValue: 'Selected: {{labels}}', labels: selectedLabels.join(', ') })
            : t('ide.askQuestion.hint', { defaultValue: 'Pick an option to answer the agent.' })}
        </span>
        <div className="flex flex-shrink-0 items-center gap-2">
          {total > 1 && step > 0 && (
            <button
              type="button"
              onClick={goBack}
              disabled={busy}
              className="flex h-7 items-center rounded border border-gray-700 bg-gray-800 px-2.5 text-[11px] font-semibold text-gray-300 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('ide.askQuestion.back', { defaultValue: 'Back' })}
            </button>
          )}
          {isLast ? (
            <button
              type="button"
              onClick={submit}
              disabled={!canAdvance}
              className="flex h-7 items-center rounded bg-sky-600 px-3 text-[11px] font-semibold text-white shadow-md transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy
                ? t('ide.askQuestion.sending', { defaultValue: 'Sending…' })
                : t('ide.askQuestion.send', { defaultValue: 'Send' })}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={!canAdvance}
              className="flex h-7 items-center rounded bg-sky-600 px-3 text-[11px] font-semibold text-white shadow-md transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('ide.askQuestion.next', { defaultValue: 'Next' })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
