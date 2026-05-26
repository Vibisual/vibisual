/**
 * StreamRenderer — Sub 탭 전용 CLI 스타일 스트림 렌더러.
 *
 * Hook 에이전트의 Agent 탭(기존 TerminalLine)과 분리.
 * assistant text → 마크다운 렌더링, tool_use/tool_result → 접이식 그룹.
 */
import { memo, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import type { SubAgentStreamEvent, QueuedCommand } from '@vibisual/shared';

// ─── 타입 ───

interface StreamRendererProps {
  events: SubAgentStreamEvent[];
  /** 완료된 명령 (스트림 없을 때 폴백 표시용) */
  commands?: QueuedCommand[];
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

type StreamItem = StreamText | StreamThinking | StreamGroup | StreamSystem | StreamResult;

// ─── 이벤트 → 아이템 변환 ───

/** 명령어 프롬프트 블록 */
interface StreamCommand {
  kind: 'command';
  id: string;
  prompt: string;
  result: string;
  status: string;
  timestamp: number;
}

type StreamItemFull = StreamItem | StreamCommand;

function buildStreamItems(events: SubAgentStreamEvent[], commands?: QueuedCommand[]): StreamItemFull[] {
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
        // 미페어 tool_use — 에이전트가 작동 중일 때만 활성, 아니면 비활성(orphaned)으로 표시
        items.push({
          kind: 'tool',
          id: evt.id,
          toolName: evt.toolName ?? 'Tool',
          input: evt.content,
          output: '',
          timestamp: evt.timestamp,
          isActive: agentBusy,
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
  // 타임스탬프 기준 안정 정렬 — 프롬프트(command)가 항상 최상단에 오도록 유지하되,
  // 스트림 이벤트들끼리는 발생 순서 유지.
  items.sort((a, b) => a.timestamp - b.timestamp);
  return items;
}

// ─── 개별 렌더러 ───

/** assistant 텍스트 → 마크다운 */
const TextBlock = memo(function TextBlock({ item }: { item: StreamText }): React.JSX.Element {
  return (
    <div className="px-4 py-2">
      <div className="ide-md prose prose-invert prose-sm max-w-none leading-relaxed prose-p:my-1.5 prose-p:leading-relaxed prose-pre:my-2 prose-pre:bg-gray-800/80 prose-pre:text-[12px] prose-headings:text-gray-100 prose-headings:text-[15px] prose-li:my-1 prose-strong:text-gray-100">
        <Markdown>{item.content}</Markdown>
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

/** assistant thinking — 접어둔 사고 과정 블록 (Claude CLI 스타일, 연보라·이탤릭) */
const ThinkingBlock = memo(function ThinkingBlock({ item }: { item: StreamThinking }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const preview = item.content.replace(/\s+/g, ' ').slice(0, 100);
  return (
    <div className="mx-2 my-1 overflow-hidden rounded-md border-l-2 border-violet-500/40 bg-violet-500/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group/hdr flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-violet-500/10"
      >
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          <svg className={`h-2.5 w-2.5 text-violet-400/70 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
        <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[11px] font-bold uppercase text-violet-300">
          {t('ide.streamRenderer.thinking')}
        </span>
        {!open && (
          <span className="min-w-0 flex-1 truncate text-[12px] italic text-violet-300/75">
            {preview}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-violet-500/20 bg-gray-950/50 px-4 py-2.5">
          <div className="whitespace-pre-wrap text-[13px] italic leading-relaxed text-violet-200/90">
            {item.content}
          </div>
        </div>
      )}
    </div>
  );
});

/** system 메시지 (hook_started 등) */
function SystemLine({ item }: { item: StreamSystem }): React.JSX.Element {
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
        <Markdown>{item.content}</Markdown>
      </div>
    </div>
  );
}

/** 명령 폴백 (스트림 없을 때). 실행 중 인디케이터는 하단 StreamStatusBar 가 담당 — 여기선 프롬프트/결과만. */
function CommandBlock({ item }: { item: StreamCommand }): React.JSX.Element {
  const isError = item.status === 'error';
  return (
    <div className="px-4 py-2" data-cmd-id={item.id}>
      {/* 프롬프트 */}
      <div className="mb-1.5 flex items-start gap-2">
        <span className="flex-shrink-0 text-[13px] font-bold text-blue-400">{'>'}</span>
        <span className="text-[13px] leading-relaxed text-blue-200">{item.prompt}</span>
      </div>
      {/* 결과 */}
      {item.result && (
        <div className={`rounded-md border px-3 py-2 ${
          isError ? 'border-red-500/20 bg-red-500/5' : 'border-emerald-500/20 bg-emerald-500/5'
        }`}>
          <div className="ide-md prose prose-invert prose-sm max-w-none leading-relaxed prose-p:my-1.5 prose-p:leading-relaxed">
            <Markdown>{item.result}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 메인 렌더러 ───

export const StreamRenderer = memo(function StreamRenderer({ events, commands }: StreamRendererProps): React.JSX.Element {
  const { t } = useTranslation();
  const items = useMemo(() => buildStreamItems(events, commands), [events, commands]);

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
        }
      })}
    </div>
  );
});
