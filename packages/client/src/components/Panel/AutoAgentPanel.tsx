/**
 * §5.3 #10-2 v2.37 — Auto Agent Panel.
 *
 * `bubbleType === 'auto'` 버블 선택 시 DetailPanel 안에 렌더되는 간이 UI.
 * - 채팅 입력 (자연어 요청)
 * - "질문하기" 토글
 * - 진행 상태 인디케이터 (idle/analyzing/asking/spawning/dispatching/running/completed/error)
 * - 명확화 질문 폼 (phase==='asking' 일 때만)
 * - 최종 요약 표시 (phase==='completed' 일 때만)
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BubbleData, AutoAgentSummary, AutoAgentClarifyingQuestion, SubAgentStreamEvent, QueuedCommand } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { StreamRenderer } from '../IDE/StreamRenderer.js';

const EMPTY_COMMANDS: QueuedCommand[] = [];

interface AutoAgentPanelProps {
  node: BubbleData;
}

export const AutoAgentPanel = memo(function AutoAgentPanel({ node }: AutoAgentPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const summary = useGraphStore((s) => s.autoAgentSummaries[node.path]) as AutoAgentSummary | undefined;
  const sendMessage = useGraphStore((s) => s.sendMessageToAutoAgent);
  const toggleQuestions = useGraphStore((s) => s.toggleAutoAgentQuestions);
  const answerQuestions = useGraphStore((s) => s.answerAutoAgentQuestions);

  const [draft, setDraft] = useState('');
  const sessionId = node.path;
  const phase = summary?.phase ?? 'idle';
  const askQuestionsEnabled = summary?.askQuestionsEnabled ?? true;
  const isBusy = phase !== 'idle' && phase !== 'completed' && phase !== 'error';

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || isBusy) return;
    sendMessage(sessionId, text);
    setDraft('');
  }, [draft, isBusy, sendMessage, sessionId]);

  const handleToggle = useCallback(() => {
    toggleQuestions(sessionId, !askQuestionsEnabled);
  }, [toggleQuestions, sessionId, askQuestionsEnabled]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const phaseLabel = useMemo(() => {
    switch (phase) {
      case 'analyzing': return t('panel.autoAgent.phase.analyzing');
      case 'asking': return t('panel.autoAgent.phase.asking');
      case 'building': return t('panel.autoAgent.phase.building');
      case 'spawning': return t('panel.autoAgent.phase.spawning');
      case 'dispatching': return t('panel.autoAgent.phase.dispatching');
      case 'running': return t('panel.autoAgent.phase.running');
      case 'completed': return t('panel.autoAgent.phase.completed');
      case 'error': return t('panel.autoAgent.phase.error');
      default: return t('panel.autoAgent.phase.idle');
    }
  }, [phase, t]);

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      {/* 헤더 — 제목 + 질문 토글 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-blue-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M8 9.5a4 4 0 0 1 8 0" />
            <circle cx="12" cy="13.5" r="2.2" />
          </svg>
          <span className="text-sm font-semibold text-gray-200">{t('panel.autoAgent.title')}</span>
        </div>
        <button
          type="button"
          onClick={handleToggle}
          className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
            askQuestionsEnabled
              ? 'bg-amber-900/30 text-amber-300 hover:bg-amber-900/50'
              : 'bg-gray-800 text-gray-500 hover:bg-gray-700'
          }`}
          title={t('panel.autoAgent.toggleQuestionsTip')}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18h6" />
            <path d="M10 21h4" />
            <path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z" />
          </svg>
          <span>{askQuestionsEnabled ? t('panel.autoAgent.questionsOn') : t('panel.autoAgent.questionsOff')}</span>
        </button>
      </div>

      {/* 설명 — 하네스 설정 전용 자동 툴 */}
      <p className="text-[11px] leading-relaxed text-gray-500">{t('panel.autoAgent.description')}</p>

      {/* 진행 상태 라인 */}
      <div className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs ${
        phase === 'completed' ? 'border-emerald-700 bg-emerald-950/30 text-emerald-300'
          : phase === 'error' ? 'border-red-700 bg-red-950/30 text-red-300'
          : isBusy ? 'border-blue-700 bg-blue-950/30 text-blue-300'
          : 'border-gray-700 bg-gray-900 text-gray-400'
      }`}>
        {isBusy && (
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" strokeDasharray="40 60" />
          </svg>
        )}
        <span className="font-medium">{phaseLabel}</span>
        {summary?.complexity && phase !== 'idle' && (
          <span className="ml-auto text-[10px] text-gray-500">
            {t(`panel.autoAgent.complexity.${summary.complexity}`)} · {t(`panel.autoAgent.topology.${summary.topology}`)}
          </span>
        )}
      </div>

      {/* building 단계 — 빌더가 하네스를 구축 중. 출력은 버블 IDE 오버레이로 확인. */}
      {phase === 'building' && (
        <div className="rounded border border-blue-900 bg-blue-950/20 px-3 py-2 text-xs text-blue-200">
          {t('panel.autoAgent.buildingHint')}
        </div>
      )}

      {/* 빌더 동작 창 — 헤드리스 빌더(=auto-agent 자기 세션)의 라이브 스트림을 패널 안에 임베드.
          building/dispatching/running/completed 동안 "어떻게 동작 중인지" 한눈에. (StreamRenderer 재사용) */}
      <BuilderActivityWindow agentId={node.id} phase={phase} />

      {/* asking 단계 — 질문 폼 */}
      {phase === 'asking' && summary?.questionsAsked && (
        <ClarifyingQuestionsForm
          questions={summary.questionsAsked}
          onSubmit={(answers) => answerQuestions(sessionId, answers)}
        />
      )}

      {/* completed — 최종 요약 */}
      {phase === 'completed' && summary?.finalSummary && (
        <div className="rounded border border-emerald-800 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-100">
          <div className="mb-1 font-semibold text-emerald-300">{t('panel.autoAgent.summary')}</div>
          <div className="whitespace-pre-wrap leading-relaxed">{summary.finalSummary}</div>
        </div>
      )}

      {/* error */}
      {phase === 'error' && summary?.errorMessage && (
        <div className="rounded border border-red-800 bg-red-950/20 px-3 py-2 text-xs text-red-200">
          {summary.errorMessage}
        </div>
      )}

      {/* spawn 된 서브 군 요약 (running/completed 시) */}
      {summary && summary.spawnedAgentIds.length > 0 && (phase === 'running' || phase === 'dispatching' || phase === 'completed') && (
        <div className="rounded border border-gray-800 bg-gray-950/50 px-3 py-2 text-xs text-gray-400">
          <div className="mb-1 font-semibold text-gray-300">
            {t('panel.autoAgent.spawnedCount', { count: summary.spawnedAgentIds.length })}
          </div>
          <div className="text-gray-500">{t('panel.autoAgent.entryHint')}</div>
        </div>
      )}

      {/* 채팅 입력 */}
      <div className="flex flex-col gap-1.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('panel.autoAgent.placeholder')}
          disabled={isBusy}
          rows={3}
          className="scrollbar-thin w-full resize-y rounded border border-gray-700 bg-gray-950 px-2.5 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-blue-700 focus:outline-none disabled:opacity-50"
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-600">{t('panel.autoAgent.shortcutHint')}</span>
          <button
            type="button"
            onClick={handleSend}
            disabled={!draft.trim() || isBusy}
            className="rounded bg-blue-900 px-3 py-1 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-40"
          >
            {t('panel.autoAgent.send')}
          </button>
        </div>
      </div>
    </div>
  );
});

// ─── 빌더 동작 창 ───

interface BuilderActivityWindowProps {
  /** auto-agent 버블의 agentId (= subAgentStreams/queuedCommands 의 키) */
  agentId: string;
  phase: AutoAgentSummary['phase'];
}

/**
 * 헤드리스 빌더의 라이브 동작을 패널 안에 보여주는 작은 창.
 *
 * 빌더는 별도 인프라가 아니라 **auto-agent 버블 자기 세션**에서 도는 에이전트라(§SCENARIO 271·275),
 * 그 활동(text/thinking/tool_use/tool_result)이 일반 에이전트와 동일하게 `subAgentStreams`
 * (parentAgentId = 이 버블의 agentId) 로 흐른다. 그 스트림을 모아 기존 `StreamRenderer` 로 렌더한다.
 * IDE 오버레이를 열지 않아도 "지금 빌더가 무엇을 하는지" 패널에서 바로 확인.
 */
const BuilderActivityWindow = memo(function BuilderActivityWindow({ agentId, phase }: BuilderActivityWindowProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const subAgentStreams = useGraphStore((s) => s.subAgentStreams);
  const commands = useGraphStore((s) => s.queuedCommands[agentId] ?? EMPTY_COMMANDS);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 이 버블(=빌더 세션)에 속한 모든 스트림 이벤트를 시간순으로 병합.
  const events = useMemo<SubAgentStreamEvent[]>(() => {
    const out: SubAgentStreamEvent[] = [];
    for (const evts of Object.values(subAgentStreams)) {
      if (evts.length > 0 && evts[0]!.parentAgentId === agentId) out.push(...evts);
    }
    out.sort((a, b) => a.timestamp - b.timestamp);
    return out;
  }, [subAgentStreams, agentId]);

  const isBuilding = phase === 'building';
  // building 이면 이벤트가 아직 없어도 창을 띄워 "기동 중"을 보여준다. 이후 단계는 기록이 있을 때만.
  const show = isBuilding
    || ((phase === 'dispatching' || phase === 'running' || phase === 'completed') && events.length > 0);

  // building 진입 시 서버에 버퍼된 스트림을 1회 로드(라이브분은 WS append 로 들어옴) — IDE 오버레이와 동일.
  useEffect(() => {
    if (!isBuilding) return;
    fetch(`/api/subagent-streams/${agentId}`)
      .then((r) => r.json())
      .then((data: { streams?: Record<string, SubAgentStreamEvent[]> }) => {
        if (data.streams) useGraphStore.getState().loadStreamBuffers(data.streams);
      })
      .catch(() => {});
  }, [agentId, isBuilding]);

  // 새 이벤트가 붙으면 맨 아래로 스크롤(라이브 추종).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  if (!show) return null;

  return (
    <div className="overflow-hidden rounded-md border border-gray-700 bg-gray-950/60">
      {/* 타이틀 바 */}
      <div className="flex items-center gap-2 border-b border-gray-800 bg-[#1a2236] px-2.5 py-1.5">
        <svg className="h-3.5 w-3.5 text-blue-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
        <span className="text-[11px] font-semibold text-gray-300">{t('panel.autoAgent.activityTitle')}</span>
        {isBuilding && (
          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-blue-300">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
            {t('panel.autoAgent.activityLive')}
          </span>
        )}
      </div>
      {/* 스트림 본문 */}
      <div ref={scrollRef} className="scrollbar-thin max-h-72 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-4 text-[11px] text-gray-500">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-blue-400 border-t-transparent" />
            {t('panel.autoAgent.activityWaiting')}
          </div>
        ) : (
          <StreamRenderer events={events} commands={commands} />
        )}
      </div>
    </div>
  );
});

// ─── 명확화 질문 폼 ───

interface ClarifyingQuestionsFormProps {
  questions: AutoAgentClarifyingQuestion[];
  onSubmit: (answers: { questionIndex: number; selectedLabels: string[]; note?: string }[]) => void;
}

const ClarifyingQuestionsForm = memo(function ClarifyingQuestionsForm({ questions, onSubmit }: ClarifyingQuestionsFormProps): React.JSX.Element {
  const { t } = useTranslation();
  // 각 질문별 selected labels + optional note
  const [selections, setSelections] = useState<Record<number, Set<string>>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});

  const toggle = useCallback((qIdx: number, label: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const current = prev[qIdx] ?? new Set<string>();
      const next = new Set(multiSelect ? current : []);
      if (current.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return { ...prev, [qIdx]: next };
    });
  }, []);

  const allAnswered = questions.every((_, i) => (selections[i]?.size ?? 0) > 0);

  const handleSubmit = useCallback(() => {
    const answers = questions.map((_, i) => ({
      questionIndex: i,
      selectedLabels: Array.from(selections[i] ?? new Set<string>()),
      ...(notes[i]?.trim() ? { note: notes[i]!.trim() } : {}),
    }));
    onSubmit(answers);
  }, [questions, selections, notes, onSubmit]);

  return (
    <div className="flex flex-col gap-2.5 rounded border border-amber-800 bg-amber-950/20 px-3 py-2.5">
      <div className="text-xs font-semibold text-amber-300">{t('panel.autoAgent.clarifying')}</div>
      {questions.map((q, qIdx) => (
        <div key={qIdx} className="flex flex-col gap-1.5">
          <div className="text-sm text-gray-200">{q.question}</div>
          <div className="flex flex-col gap-1">
            {q.options.map((opt) => {
              const checked = selections[qIdx]?.has(opt.label) ?? false;
              return (
                <label key={opt.label} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-xs text-gray-300 hover:bg-gray-900/50">
                  <input
                    type={q.multiSelect ? 'checkbox' : 'radio'}
                    name={`q-${qIdx}`}
                    checked={checked}
                    onChange={() => toggle(qIdx, opt.label, q.multiSelect)}
                    className="mt-0.5"
                  />
                  <div className="flex flex-col">
                    <span>{opt.label}</span>
                    {opt.description && <span className="text-[10px] text-gray-500">{opt.description}</span>}
                  </div>
                </label>
              );
            })}
          </div>
          <input
            type="text"
            value={notes[qIdx] ?? ''}
            onChange={(e) => setNotes((prev) => ({ ...prev, [qIdx]: e.target.value }))}
            placeholder={t('panel.autoAgent.notePlaceholder')}
            className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200 placeholder-gray-600"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!allAnswered}
        className="self-end rounded bg-amber-700 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-40"
      >
        {t('panel.autoAgent.submitAnswers')}
      </button>
    </div>
  );
});
