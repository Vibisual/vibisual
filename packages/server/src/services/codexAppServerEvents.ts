import { mapCodexLine, type CodexMapResult, type CodexUsage } from './codexStreamMap.js';

/** Native notifications retain their turn boundary; an assistant item alone never ends a turn. */
export interface CodexAppServerMapResult extends CodexMapResult {
  fileWrites?: string[];
  progress?: { kind: 'compaction' | 'agentWait'; active: boolean; toolUseId?: string };
}

type RecordValue = Record<string, unknown>;
const EMPTY: CodexAppServerMapResult = { events: [] };
const ZERO_USAGE: CodexUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0 };
const USAGE_KEYS = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningOutputTokens'] as const;

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined;
}

function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []; }

function usage(value: unknown): CodexUsage | undefined {
  const data = record(value);
  if (!data || USAGE_KEYS.some(key => typeof data[key] !== 'number' || !Number.isSafeInteger(data[key]) || Number(data[key]) < 0)) return undefined;
  return {
    inputTokens: Number(data.inputTokens), outputTokens: Number(data.outputTokens),
    cachedInputTokens: Number(data.cachedInputTokens), reasoningOutputTokens: Number(data.reasoningOutputTokens),
  };
}

function failureStatus(status: unknown): unknown {
  return status === 'declined' || status === 'interrupted' ? 'failed' : status;
}

/** Reuse the existing display/tool interpretation after translating the native field names. */
function legacyItem(item: RecordValue): RecordValue | undefined {
  const status = failureStatus(item.status);
  switch (item.type) {
    case 'agentMessage': return { ...item, type: 'agent_message' };
    case 'reasoning': return { ...item, text: strings(item.summary).join('\n') || strings(item.content).join('\n') };
    case 'commandExecution': return { ...item, type: 'command_execution', status, exit_code: item.exitCode, aggregated_output: item.aggregatedOutput };
    case 'fileChange': return { ...item, type: 'file_change', status };
    case 'mcpToolCall': return { ...item, type: 'mcp_tool_call', status, result: item.result ?? undefined };
    case 'webSearch': return { ...item, type: 'web_search' };
    case 'imageView': return { ...item, type: 'ImageView' };
    default: return undefined;
  }
}

/** One mapper per live thread connection. Call with all scoped notifications, including turn/started. */
export function createCodexAppServerEventMapper(platform: NodeJS.Platform = process.platform): {
  map(method: string, params: unknown): CodexAppServerMapResult | null;
} {
  const startedItems = new Set<string>();
  const completedItems = new Set<string>();
  const startedCommands = new Map<string, string>();
  let totalUsage: CodexUsage | undefined;
  let turnUsage: CodexUsage | undefined;
  let activeTurn = false;
  let currentTurnId: string | undefined;
  const completedTurns = new Set<string>();
  let finalText: string | undefined;

  function mapItem(method: string, item: RecordValue): CodexAppServerMapResult | null {
    const completed = method === 'item/completed';
    const id = text(item.id);
    const seen = completed ? completedItems : startedItems;
    if (id && seen.has(id)) return EMPTY;
    if (id) seen.add(id);
    if (item.type === 'contextCompaction') {
      return { events: [], progress: { kind: 'compaction', active: !completed } };
    }
    if (item.type === 'collabAgentToolCall') {
      const tool = text(item.tool);
      return {
        events: [{ eventType: completed ? 'tool_result' : 'tool_use', toolName: `collaboration.${tool || 'agent'}`,
          ...(id ? { toolUseId: id } : {}),
          content: completed ? JSON.stringify(item.agentsStates ?? {}) : text(item.prompt) || strings(item.receiverThreadIds).join(', ') || tool }],
        ...(tool === 'wait' ? { progress: { kind: 'agentWait' as const, active: !completed, ...(id ? { toolUseId: id } : {}) } } : {}),
      };
    }
    if (item.type === 'plan') {
      return completed && text(item.text) ? { events: [{ eventType: 'system', content: text(item.text) }] } : EMPTY;
    }
    if (item.type === 'userMessage' || item.type === 'hookPrompt' || item.type === 'subAgentActivity') return EMPTY;
    const converted = legacyItem(item);
    if (!converted) return null;
    if (item.type === 'commandExecution' && id) {
      if (!completed && typeof item.command === 'string') startedCommands.set(id, item.command);
      if (completed) {
        if (typeof item.command !== 'string') converted.command = startedCommands.get(id);
        startedCommands.delete(id);
      }
    }
    const mapped = mapCodexLine(JSON.stringify({ type: completed ? 'item.completed' : 'item.started', item: converted }), platform);
    if (!mapped) return null;
    if (item.type === 'agentMessage' && completed && mapped.finalText !== undefined) {
      // Missing phase is a documented legacy case. Known commentary/partial answers are never terminal answers.
      if ((item.phase != null && item.phase !== 'final_answer') || item.delivery === 'async') delete mapped.finalText;
      else finalText = mapped.finalText;
    }
    const result: CodexAppServerMapResult = mapped;
    if (item.type === 'fileChange' && completed && item.status === 'completed') {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const paths = changes.flatMap(change => {
        const value = record(change);
        const path = text(value?.path);
        const movedTo = text(record(value?.kind)?.move_path);
        return [path, movedTo].filter(Boolean);
      });
      if (paths.length) result.fileWrites = [...new Set(paths)];
    }
    return result;
  }

  function noteUsage(params: RecordValue): CodexAppServerMapResult {
    const tokenUsage = record(params.tokenUsage);
    const total = usage(tokenUsage?.total);
    if (!total) return EMPTY;
    // Replayed/out-of-order totals must not increment only their larger counters.
    const baseline = totalUsage;
    if (baseline && USAGE_KEYS.some(key => total[key] < baseline[key])) return EMPTY;
    if (activeTurn) {
      let delta = usage(tokenUsage?.last);
      if (baseline) {
        delta = { ...ZERO_USAGE };
        for (const key of USAGE_KEYS) delta[key] = total[key] - baseline[key];
      }
      if (delta) {
        const accumulated = turnUsage ?? { ...ZERO_USAGE };
        for (const key of USAGE_KEYS) accumulated[key] += delta[key];
        turnUsage = accumulated;
      }
    }
    totalUsage = total;
    return EMPTY;
  }

  function map(method: string, raw: unknown): CodexAppServerMapResult | null {
    const params = record(raw);
    if (!params) return null;
    switch (method) {
      case 'thread/started': {
        const threadId = text(record(params.thread)?.id);
        return threadId ? { events: [], threadId } : EMPTY;
      }
      case 'turn/started': {
        const turnId = text(record(params.turn)?.id);
        if (turnId && (completedTurns.has(turnId) || (activeTurn && currentTurnId === turnId))) return EMPTY;
        startedItems.clear(); completedItems.clear(); startedCommands.clear();
        currentTurnId = turnId || undefined;
        activeTurn = true; finalText = undefined; turnUsage = undefined;
        return EMPTY;
      }
      case 'thread/tokenUsage/updated': return noteUsage(params);
      case 'item/started':
      case 'item/completed': {
        const item = record(params.item);
        return item ? mapItem(method, item) : null;
      }
      case 'turn/plan/updated': {
        const plan = Array.isArray(params.plan) ? params.plan : [];
        const lines = plan.flatMap(rawStep => {
          const step = record(rawStep);
          const label = text(step?.step);
          const marker = step?.status === 'completed' ? '[x]' : step?.status === 'inProgress' ? '[~]' : '[ ]';
          return label ? [`${marker} ${label}`] : [];
        });
        return lines.length ? { events: [{ eventType: 'system', content: lines.join('\n') }] } : EMPTY;
      }
      case 'error': {
        if (params.willRetry === true) {
          return { events: [{ eventType: 'system', content: text(record(params.error)?.message) || 'Retrying Codex request' }] };
        }
        return mapCodexLine(JSON.stringify({ type: 'error', error: params.error }), platform);
      }
      case 'turn/completed': {
        const turn = record(params.turn);
        if (!turn || !['completed', 'failed', 'interrupted'].includes(text(turn.status))) return null;
        const turnId = text(turn.id);
        if (turnId && completedTurns.has(turnId)) return EMPTY;
        if (turnId) completedTurns.add(turnId);
        const events: CodexAppServerMapResult['events'] = [];
        const fileWrites: string[] = [];
        // Some servers include completed items only in the terminal snapshot. Dedup against streamed items.
        for (const rawItem of Array.isArray(turn.items) ? turn.items : []) {
          const item = record(rawItem);
          // Interrupted/failed turns can retain unfinished tools. A snapshot is not
          // evidence that these calls returned; the runner closes pending calls explicitly.
          if (item?.status === 'inProgress') continue;
          const mapped = item ? mapItem('item/completed', item) : null;
          if (mapped) { events.push(...mapped.events); fileWrites.push(...(mapped.fileWrites ?? [])); }
        }
        activeTurn = false;
        const error = turn.status === 'completed' ? undefined
          : text(record(turn.error)?.message) || (turn.status === 'interrupted' ? 'Codex turn interrupted' : 'Codex turn failed');
        return { events, turnEnded: true, ...(error ? { error } : {}),
          ...(turnUsage ? { usage: { ...turnUsage } } : {}), ...(finalText !== undefined ? { finalText } : {}),
          ...(fileWrites.length ? { fileWrites: [...new Set(fileWrites)] } : {}) };
      }
      default:
        // These notifications remain activity evidence even though the display commits whole items.
        return method.endsWith('/delta') || method === 'thread/status/changed' || method === 'item/reasoning/summaryPartAdded' ? EMPTY : null;
    }
  }
  return { map };
}
