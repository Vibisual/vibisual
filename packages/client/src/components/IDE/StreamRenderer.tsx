/**
 * StreamRenderer — Sub 탭 전용 CLI 스타일 스트림 렌더러.
 *
 * Hook 에이전트의 Agent 탭(기존 TerminalLine)과 분리.
 * assistant text → 마크다운 렌더링, tool_use/tool_result → 접이식 그룹.
 */
import { memo, useState, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import type { SubAgentStreamEvent, QueuedCommand, AgentReport, AgentQuestions, AgentReview } from '@vibisual/shared';
import { SystemNode, parseSystemSubtype } from './SystemNode.js';
import { ThinkingDots, ThinkingLiveLine } from './ThinkingIndicator.js';
import { AgentReportCard } from './AgentReportCard.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { AgentQuestionCard } from './AgentQuestionCard.js';
import { AgentReviewCard } from './AgentReviewCard.js';
import { CollapsiblePrompt } from './CollapsiblePrompt.js';

/** SDK 가 생각 중 반복 송출하는 system 펄스 subtype — 본문에 쌓이지 않게 라이브 1줄로 대체. */
const THINKING_PULSE_SUBTYPE = 'thinking_tokens';
function isThinkingPulse(evt: { eventType: string; content: string }): boolean {
  return evt.eventType === 'system' && parseSystemSubtype(evt.content) === THINKING_PULSE_SUBTYPE;
}

// ─── 타입 ───

interface StreamRendererProps {
  events: SubAgentStreamEvent[];
  /** 완료된 명령 (스트림 없을 때 폴백 표시용) */
  commands?: QueuedCommand[];
  /** §4 v2.53 — 이 세션의 작업 신고. createdAt 기준으로 스트림에 인라인 합류(맨 아래 고정 ❌). */
  reports?: AgentReport[];
  /** §4 v2.60 — 이 세션의 질문 카드. reports 와 동일하게 턴 끝에 합류. */
  questions?: AgentQuestions[];
  /** §4 v2.70 — 이 세션의 검수 요청 카드. reports/questions 와 동일하게 턴 끝에 합류. */
  reviews?: AgentReview[];
}

interface StreamGroup {
  kind: 'tool';
  id: string;
  toolName: string;
  input: string;
  output: string;
  timestamp: number;
  isActive: boolean;
}

interface StreamText {
  kind: 'text';
  id: string;
  content: string;
  timestamp: number;
}

interface StreamThinking {
  kind: 'thinking';
  id: string;
  content: string;
  timestamp: number;
  /** 아직 생각 중(에이전트 작동 중 + 마지막 항목) → 도트 애니메이션 */
  isActive?: boolean;
}

interface StreamSystem {
  kind: 'system';
  id: string;
  content: string;
  timestamp: number;
}

interface StreamResult {
  kind: 'result';
  id: string;
  content: string;
  timestamp: number;
}

/** 생각 중 라이브 1줄 — 실제 thinking 중일 때만 본문 하단에 1개 등장 */
interface StreamThinkingLive {
  kind: 'thinking-live';
  id: string;
  timestamp: number;
}

/** §4 v2.53 — 작업 신고 카드 (createdAt 을 timestamp 로 삼아 스트림에 시간순 합류) */
interface StreamReport {
  kind: 'report';
  id: string;
  report: AgentReport;
  timestamp: number;
}

/** §4 v2.60 — 질문 카드 (createdAt 을 timestamp 로 삼아 스트림에 시간순 합류) */
interface StreamQuestion {
  kind: 'question';
  id: string;
  questions: AgentQuestions;
  timestamp: number;
}

/** §4 v2.70 — 검수 요청 카드 (createdAt 을 timestamp 로 삼아 스트림에 시간순 합류) */
interface StreamReview {
  kind: 'review';
  id: string;
  review: AgentReview;
  timestamp: number;
}

type StreamItem = StreamText | StreamThinking | StreamGroup | StreamSystem | StreamResult | StreamThinkingLive | StreamReport | StreamQuestion | StreamReview;

// ─── 이벤트 → 아이템 변환 ───

/** 명령어 프롬프트 블록 */
interface StreamCommand {
  kind: 'command';
  id: string;
  prompt: string;
  result: string;
  status: string;
  timestamp: number;
  /** v2.61 — 전송한 paste 이미지 첨부의 절대경로(완료 후에도 보존). basename 으로 blob preview 조회. */
  attachments?: string[];
}

type StreamItemFull = StreamItem | StreamCommand;

function buildStreamItems(events: SubAgentStreamEvent[], commands?: QueuedCommand[], reports?: AgentReport[], questions?: AgentQuestions[], reviews?: AgentReview[]): StreamItemFull[] {
  const items: StreamItemFull[] = [];

  // 사용자 프롬프트(완료/진행/큐 전부) → 각 명령마다 프롬프트 블록으로 앞부분에 삽입.
  // 결과(result)는 스트림 이벤트로 별도 표시되므로 여기선 prompt만 보여준다.
  // 스트림이 전혀 없는 레거시 세션(서버 restart 전 생성분)은 cmd.result를 폴백으로 보여줌.
  const hasStream = events.length > 0;
  if (commands && commands.length > 0) {
    for (const cmd of commands) {
      items.push({
        kind: 'command',
        id: `cmd-${cmd.id}`,
        prompt: cmd.text,
        result: hasStream ? '' : (cmd.result ?? ''), // 스트림이 있으면 결과는 스트림에서 렌더
        status: cmd.status,
        timestamp: cmd.timestamp,
        attachments: cmd.attachments,
      });
    }
  }

  // 에이전트 작동 중인지 — executing/queued 명령이 하나라도 있으면 "live", 아니면 모든 미페어 tool_use를 비활성으로 표시
  const agentBusy = !!commands && commands.some((c) => c.status === 'executing' || c.status === 'queued');

  // 1차 패스: tool_use ↔ tool_result FIFO 페어링 (서버가 tool_use_id를 노출하지 않으므로 발생 순서 기반)
  const resultByToolIdx = new Map<number, number>(); // tool_use 인덱스 → tool_result 인덱스
  const pendingToolIdxs: number[] = [];
  for (let k = 0; k < events.length; k++) {
    const e = events[k]!;
    if (e.eventType === 'tool_use') {
      pendingToolIdxs.push(k);
    } else if (e.eventType === 'tool_result') {
      const toolIdx = pendingToolIdxs.shift();
      if (toolIdx !== undefined) resultByToolIdx.set(toolIdx, k);
    }
  }
  const consumedResultIdxs = new Set<number>(resultByToolIdx.values());

  // "지금 실행 중" 판정 경계 — Anthropic 턴은 (assistant text/thinking) → tool_use 배치 → tool_result 배치
  // 순으로 흐른다. 따라서 실제로 돌고 있을 수 있는 도구는 **마지막 비-도구 이벤트(text/thinking/result/
  // system) 이후에 나온, 짝 없는 tool_use(= 현재 배치)뿐**이다. 그 경계 앞의 미페어 tool_use 는 (서버가
  // tool_result 에 toolUseId 를 안 실어 FIFO 페어링이 어긋났거나 결과가 유실돼) 남은 잔여물 → 비활성.
  // 이 경계가 없으면 과거에 끝난 도구들까지 agentBusy 동안 전부 스피너가 돌고, 정지→재실행 시 한꺼번에
  // 다시 "동작중"으로 살아난다. 펄스(thinking_tokens)는 투명 처리해 경계로 치지 않는다(스트레이 펄스가
  // 실제로 도는 도구의 스피너를 꺼뜨리지 않도록).
  let lastNonToolIdx = -1;
  for (let k = 0; k < events.length; k++) {
    const e = events[k]!;
    if (isThinkingPulse(e)) continue;
    if (e.eventType !== 'tool_use' && e.eventType !== 'tool_result') lastNonToolIdx = k;
  }

  let i = 0;
  // 연속 text 이벤트를 하나의 블록으로 합치기 — thinking도 동일. 단 사용자 프롬프트(command)
  // 타임스탬프가 버퍼 사이에 끼어들면 거기서 끊어 별도 블록으로 분리한다(프롬프트별 응답 구분).
  const sortedCmdTs = (commands ?? []).map((c) => c.timestamp).sort((a, b) => a - b);
  function crossesCommand(prevTs: number, nextTs: number): boolean {
    for (const t of sortedCmdTs) {
      if (t > prevTs && t <= nextTs) return true;
      if (t > nextTs) break;
    }
    return false;
  }

  let textBuf: { ids: string[]; chunks: string[]; ts: number; lastTs: number } | null = null;
  let thinkBuf: { ids: string[]; chunks: string[]; ts: number; lastTs: number } | null = null;

  function flushText(): void {
    if (!textBuf) return;
    items.push({ kind: 'text', id: textBuf.ids[0]!, content: textBuf.chunks.join(''), timestamp: textBuf.ts });
    textBuf = null;
  }
  function flushThink(): void {
    if (!thinkBuf) return;
    items.push({ kind: 'thinking', id: thinkBuf.ids[0]!, content: thinkBuf.chunks.join(''), timestamp: thinkBuf.ts });
    thinkBuf = null;
  }
  function flushAll(): void { flushThink(); flushText(); }

  while (i < events.length) {
    const evt = events[i]!;

    // 생각 중 펄스(thinking_tokens)는 본문에 쌓지 않는다. text/thinking 버퍼도 끊지 않아
    // 펄스를 사이에 두고도 앞뒤 텍스트가 한 블록으로 유지된다. 라이브 1줄은 아래에서 별도 처리.
    if (isThinkingPulse(evt)) {
      i++;
      continue;
    }

    if (evt.eventType === 'text') {
      flushThink();
      if (textBuf && crossesCommand(textBuf.lastTs, evt.timestamp)) flushText();
      if (!textBuf) textBuf = { ids: [evt.id], chunks: [evt.content], ts: evt.timestamp, lastTs: evt.timestamp };
      else { textBuf.ids.push(evt.id); textBuf.chunks.push(evt.content); textBuf.lastTs = evt.timestamp; }
      i++;
      continue;
    }

    if (evt.eventType === 'thinking') {
      flushText();
      if (thinkBuf && crossesCommand(thinkBuf.lastTs, evt.timestamp)) flushThink();
      if (!thinkBuf) thinkBuf = { ids: [evt.id], chunks: [evt.content], ts: evt.timestamp, lastTs: evt.timestamp };
      else { thinkBuf.ids.push(evt.id); thinkBuf.chunks.push(evt.content); thinkBuf.lastTs = evt.timestamp; }
      i++;
      continue;
    }

    flushAll();

    if (evt.eventType === 'tool_use') {
      const resultIdx = resultByToolIdx.get(i);
      if (resultIdx !== undefined) {
        const resultEvt = events[resultIdx]!;
        items.push({
          kind: 'tool',
          id: evt.id,
          toolName: evt.toolName ?? 'Tool',
          input: evt.content,
          output: resultEvt.content,
          timestamp: evt.timestamp,
          isActive: false,
        });
      } else {
        // 미페어 tool_use — 에이전트 작동 중이고 **현재 배치(마지막 비-도구 이벤트 이후)** 에 속할 때만
        // 활성. 그 앞쪽 미페어 tool_use 는 이미 끝났는데 결과가 못 짝지어진 잔여물이므로 비활성(orphaned).
        items.push({
          kind: 'tool',
          id: evt.id,
          toolName: evt.toolName ?? 'Tool',
          input: evt.content,
          output: '',
          timestamp: evt.timestamp,
          isActive: agentBusy && i > lastNonToolIdx,
        });
      }
      i++;
      continue;
    }

    if (evt.eventType === 'tool_result') {
      // 1차 패스에서 짝지어진 tool_result는 tool 블록 내부로 흡수됨 → 별도 표시 생략
      if (consumedResultIdxs.has(i)) {
        i++;
        continue;
      }
      // 짝 없는 tool_result (드문 케이스)
      items.push({
        kind: 'system',
        id: evt.id,
        content: `${evt.toolName ? `[${evt.toolName}] ` : ''}${evt.content}`,
        timestamp: evt.timestamp,
      });
      i++;
      continue;
    }

    if (evt.eventType === 'result') {
      items.push({
        kind: 'result',
        id: evt.id,
        content: evt.content,
        timestamp: evt.timestamp,
      });
      i++;
      continue;
    }

    // system 등 나머지
    items.push({
      kind: 'system',
      id: evt.id,
      content: evt.content,
      timestamp: evt.timestamp,
    });
    i++;
  }

  flushAll();

  // §4 v2.53/v2.57 — 작업 신고 카드 배치. createdAt 위치에 그대로 꽂으면 같은 턴의 최종 답변(신고 직후
  //   이어 오는 text/result)보다 카드가 위에 와 "작업 중간에 갑자기 낀" 모양이 된다. 대신 **그 신고가
  //   속한 턴의 끝**(= createdAt 이후 첫 사용자 프롬프트 직전, 없으면 현재 맨 끝)으로 민다. 다음 턴 대화가
  //   오면 그 프롬프트 경계 덕에 카드가 이전 턴 끝에 고정돼 자연스럽게 위로 밀려 올라간다.
  const cmdTsAsc = (commands ?? []).map((c) => c.timestamp).sort((a, b) => a - b);
  const turnEndSortTs = (createdAt: number): number => {
    for (const ts of cmdTsAsc) { if (ts > createdAt) return ts - 0.5; }
    return Number.MAX_SAFE_INTEGER;
  };
  for (const r of reports ?? []) {
    items.push({ kind: 'report', id: `report-${r.id}`, report: r, timestamp: turnEndSortTs(r.createdAt) });
  }
  // §4 v2.60 — 질문 카드도 동일하게 턴 끝 배치.
  for (const q of questions ?? []) {
    items.push({ kind: 'question', id: `question-${q.id}`, questions: q, timestamp: turnEndSortTs(q.createdAt) });
  }
  // §4 v2.70 — 검수 요청 카드도 동일하게 턴 끝 배치.
  for (const rv of reviews ?? []) {
    items.push({ kind: 'review', id: `review-${rv.id}`, review: rv, timestamp: turnEndSortTs(rv.createdAt) });
  }

  // 타임스탬프 기준 안정 정렬 — 프롬프트(command)가 항상 최상단에 오도록 유지하되,
  // 스트림 이벤트들끼리는 발생 순서 유지.
  items.sort((a, b) => a.timestamp - b.timestamp);

  // 마지막 항목이 thinking 이고 에이전트가 작동 중이면 = 아직 생각 중 → 활성(도트 애니메이션).
  // 이후 text/tool 이 따라붙으면 생각이 끝난 것이므로 정적 1줄(접힘)로 남는다.
  if (agentBusy) {
    const last = items[items.length - 1];
    if (last && last.kind === 'thinking') last.isActive = true;
  }

  // 라이브 "생각 중 …" 1줄 — 에이전트 작동 중이고 가장 최근 스트림 이벤트가 thinking 펄스면
  // (= 지금 실제로 생각 중) 본문 하단에 1개만 띄운다. 출력이 시작되면(최근 이벤트가 text 등)
  // 사라진다. 펄스가 아무리 쏟아져도 화면엔 항상 이 1줄만.
  const lastRaw = events[events.length - 1];
  if (agentBusy && lastRaw && isThinkingPulse(lastRaw)) {
    items.push({ kind: 'thinking-live', id: 'thinking-live', timestamp: lastRaw.timestamp });
  }

  return items;
}

// ─── 마크다운 커스텀 렌더러 ───

/** 펜스드/인덴트 코드 블록 — 우상단 호버 시 복사 버튼.
 *  react-markdown 의 `pre` 슬롯 교체. 내부 `<code>` 는 그대로 children 으로 받는다.
 *  텍스트 추출은 ref 의 `textContent` 로 — 중첩 syntax 토큰까지 한 번에 잡힌다. */
function CodeBlock({ children, ...rest }: React.HTMLAttributes<HTMLPreElement>): React.JSX.Element {
  const { t } = useTranslation();
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  const onCopy = useCallback(() => {
    const text = preRef.current?.textContent ?? '';
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1400);
    }).catch(() => { /* clipboard 권한 거부 — 조용히 무시 */ });
  }, []);

  return (
    <div className="group/code relative">
      <pre ref={preRef} {...rest}>{children}</pre>
      <button
        type="button"
        onClick={onCopy}
        title={copied ? t('ide.streamRenderer.copied') : t('ide.streamRenderer.copy')}
        aria-label={copied ? t('ide.streamRenderer.copied') : t('ide.streamRenderer.copy')}
        className={`absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] font-medium transition-opacity ${
          copied
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 opacity-100'
            : 'border-white/10 bg-gray-900/70 text-gray-300 opacity-0 group-hover/code:opacity-100 hover:border-white/20 hover:bg-gray-800/80 hover:text-gray-100 focus:opacity-100'
        }`}
      >
        {copied ? (
          // check
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          // copy (overlapping squares)
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        )}
      </button>
    </div>
  );
}

const mdComponents: Components = { pre: CodeBlock };

// ─── 개별 렌더러 ───

/** assistant 텍스트 → 마크다운 */
const TextBlock = memo(function TextBlock({ item }: { item: StreamText }): React.JSX.Element {
  return (
    <div className="px-4 py-2">
      <div className="ide-md prose prose-invert prose-sm max-w-none leading-relaxed prose-p:my-1.5 prose-p:leading-relaxed prose-pre:my-2 prose-headings:text-gray-100 prose-headings:text-[15px] prose-li:my-1 prose-strong:text-gray-100">
        <Markdown components={mdComponents}>{item.content}</Markdown>
      </div>
    </div>
  );
});

/** tool_use + tool_result 접이식 그룹 */
const ToolBlock = memo(function ToolBlock({ item }: { item: StreamGroup }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const accentColor = item.isActive ? 'border-blue-500/70' : 'border-amber-500/40';
  const headerBg = item.isActive ? 'bg-blue-500/5 hover:bg-blue-500/10' : 'bg-gray-800/30 hover:bg-gray-800/60';

  // input 미리보기
  const preview = useMemo(() => {
    if (!item.input) return '';
    try {
      const obj = JSON.parse(item.input) as Record<string, unknown>;
      // 주요 필드만 추출
      const file = obj['file_path'] ?? obj['path'] ?? obj['pattern'] ?? obj['command'];
      if (typeof file === 'string') return file.length > 80 ? `${file.slice(0, 80)}...` : file;
    } catch { /* not JSON */ }
    return item.input.length > 80 ? `${item.input.slice(0, 80)}...` : item.input;
  }, [item.input]);

  return (
    <div className={`mx-2 my-1 overflow-hidden rounded-md border-l-2 ${accentColor} transition-colors`}>
      {/* 헤더 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`group/hdr flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${headerBg}`}
        title={open ? t('ide.streamRenderer.clickToCollapse') : t('ide.streamRenderer.clickToExpand')}
      >
        {/* 셰브론 */}
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded transition-colors group-hover/hdr:bg-gray-700/50">
          <svg
            className={`h-2.5 w-2.5 text-gray-500 transition-transform group-hover/hdr:text-gray-300 ${open ? 'rotate-90' : ''}`}
            viewBox="0 0 24 24" fill="currentColor"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>

        {/* 도구 이름 */}
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-bold text-amber-400/90">
          {item.toolName}
        </span>

        {/* 미리보기 */}
        {!open && preview && (
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-gray-400">
            {preview}
          </span>
        )}

        {/* 스피너 or hover 힌트 */}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {item.isActive && (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-blue-400 border-t-transparent" />
          )}
          <span className="hidden text-[10px] text-gray-500 group-hover/hdr:inline">
            {open ? t('ide.streamRenderer.collapse') : t('ide.streamRenderer.expand')}
          </span>
        </div>
      </button>

      {/* 펼친 내용 */}
      {open && (
        <div className="border-t border-gray-800/60 bg-gray-950/50 px-3 py-2">
          {item.input && (
            <div className="mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('ide.streamRenderer.input')}</span>
              <pre className="scrollbar-thin mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-gray-800/60 p-2.5 font-mono text-[12.5px] leading-relaxed text-gray-200">
                {item.input}
              </pre>
            </div>
          )}
          {item.output && (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('ide.streamRenderer.output')}</span>
              <pre className="scrollbar-thin mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-gray-800/60 p-2.5 font-mono text-[12.5px] leading-relaxed text-gray-300">
                {item.output}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* 활성 프로그레스 바 */}
      {item.isActive && (
        <div className="h-[2px] w-full overflow-hidden bg-gray-800/30">
          <div className="h-full w-1/3 rounded-full bg-blue-500/60" style={{ animation: 'slide 1.5s ease-in-out infinite' }} />
        </div>
      )}
    </div>
  );
});

/** assistant thinking — VS Code 스타일 1줄 "생각 중 …" + 접이식 전체 보기 (연보라·이탤릭) */
const ThinkingBlock = memo(function ThinkingBlock({ item }: { item: StreamThinking }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const preview = item.content.replace(/\s+/g, ' ').trim().slice(0, 100);
  return (
    <div className="mx-2 my-1 overflow-hidden rounded-md border-l-2 border-violet-500/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group/hdr flex w-full items-center gap-2 px-2.5 py-1 text-left transition-colors hover:bg-violet-500/10"
      >
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          <svg className={`h-2.5 w-2.5 text-violet-400/70 transition-transform group-hover/hdr:text-violet-300 ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
        {/* "생각 중" 라벨 — 진행 중이면 도트 애니메이션 */}
        <span className="flex flex-shrink-0 items-center gap-0.5 text-[12px] italic text-violet-300/85">
          {t('ide.streamRenderer.thinking')}
          {item.isActive && <ThinkingDots />}
        </span>
        {/* 완료 후 접힘 상태일 때만 첫 문장 미리보기 */}
        {!open && !item.isActive && preview && (
          <span className="min-w-0 flex-1 truncate text-[12px] italic text-violet-300/50">
            {preview}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-violet-500/20 bg-gray-950/50 px-4 py-2.5">
          <div className="whitespace-pre-wrap break-words text-[13px] italic leading-relaxed text-violet-200/90">
            {item.content}
          </div>
        </div>
      )}
    </div>
  );
});

/** system 메시지 — SDK subtype([task_started] 등)은 깔끔한 칩, 그 외 임의 본문은 텍스트 폴백 */
function SystemLine({ item }: { item: StreamSystem }): React.JSX.Element {
  const subtype = parseSystemSubtype(item.content);
  if (subtype) return <SystemNode subtype={subtype} />;
  return (
    <div className="px-4 py-1">
      <span className="font-mono text-[12px] text-gray-400">{item.content}</span>
    </div>
  );
}

/** 최종 결과 */
function ResultBlock({ item }: { item: StreamResult }): React.JSX.Element {
  return (
    <div className="mx-2 my-1 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5">
      <div className="ide-md prose prose-invert prose-sm max-w-none leading-relaxed prose-p:my-1.5 prose-p:leading-relaxed prose-strong:text-gray-100">
        <Markdown components={mdComponents}>{item.content}</Markdown>
      </div>
    </div>
  );
}

/** 명령 폴백 (스트림 없을 때). 실행 중 인디케이터는 하단 StreamStatusBar 가 담당 — 여기선 프롬프트/결과만. */
function CommandBlock({ item }: { item: StreamCommand }): React.JSX.Element {
  const isError = item.status === 'error';
  // v2.61 — 전송한 첨부 이미지를 사용자 프롬프트 아래 썸네일로 표시. blob preview 를 basename 으로 조회.
  //          클릭 시 전역 라이트박스로 확대 → "전송 후 사라져 뭘 보냈는지 확인 불가" 해소.
  const attachmentPreviews = useGraphStore((s) => s.attachmentPreviews);
  const openImageLightbox = useGraphStore((s) => s.openImageLightbox);
  const thumbs = (item.attachments ?? [])
    .map((p) => {
      const parts = p.split(/[/\\]/);
      const basename = parts[parts.length - 1] ?? '';
      return { basename, url: attachmentPreviews[basename] };
    })
    .filter((a): a is { basename: string; url: string } => !!a.url);
  return (
    <div className="px-4 py-2" data-cmd-id={item.id}>
      {/* 프롬프트 — 사용자 입력은 길이와 무관하게 항상 "내 메시지" 말풍선으로. */}
      <CollapsiblePrompt prompt={item.prompt} />
      {/* 전송한 첨부 이미지 썸네일 (클릭 → 라이트박스) */}
      {thumbs.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-2 pl-5">
          {thumbs.map((a) => (
            <button
              key={a.basename}
              type="button"
              onClick={() => openImageLightbox(a.url)}
              className="h-16 w-16 flex-shrink-0 overflow-hidden rounded border border-gray-700 bg-gray-800 transition-opacity hover:opacity-80"
            >
              <img src={a.url} alt="" className="h-full w-full cursor-zoom-in object-cover" />
            </button>
          ))}
        </div>
      )}
      {/* 결과 */}
      {item.result && (
        <div className={`rounded-md border px-3 py-2 ${
          isError ? 'border-red-500/20 bg-red-500/5' : 'border-emerald-500/20 bg-emerald-500/5'
        }`}>
          <div className="ide-md prose prose-invert prose-sm max-w-none leading-relaxed prose-p:my-1.5 prose-p:leading-relaxed">
            <Markdown components={mdComponents}>{item.result}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 메인 렌더러 ───

export const StreamRenderer = memo(function StreamRenderer({ events, commands, reports, questions, reviews }: StreamRendererProps): React.JSX.Element {
  const { t } = useTranslation();
  const items = useMemo(() => buildStreamItems(events, commands, reports, questions, reviews), [events, commands, reports, questions, reviews]);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-500">{t('ide.streamRenderer.noActivity')}</p>
      </div>
    );
  }

  return (
    <div className="py-2">
      {items.map((item) => {
        switch (item.kind) {
          case 'text':     return <TextBlock key={item.id} item={item} />;
          case 'thinking': return <ThinkingBlock key={item.id} item={item} />;
          case 'tool':     return <ToolBlock key={item.id} item={item} />;
          case 'result':   return <ResultBlock key={item.id} item={item} />;
          case 'system':   return <SystemLine key={item.id} item={item} />;
          case 'command':  return <CommandBlock key={item.id} item={item} />;
          case 'thinking-live': return <ThinkingLiveLine key={item.id} label={t('ide.streamRenderer.thinking')} />;
          case 'report':   return <AgentReportCard key={item.id} report={item.report} />;
          case 'question': return <AgentQuestionCard key={item.id} questions={item.questions} />;
          case 'review':   return <AgentReviewCard key={item.id} review={item.review} />;
        }
      })}
    </div>
  );
});
