/**
 * localRunner.ts — §5.19 (D)(F) All Model 로컬 턴 러너.
 *
 * **우리가 턴 루프를 돈다.** 외부 CLI 를 빌리지 않고, 설치해 둔 `llama-server` 를 우리가
 * 띄우고 우리가 말을 건다. 그래서 화면·세션·중지·카드가 전부 기존 IDE 의 것을 그대로 쓴다.
 *
 * **엔진은 자식 프로세스로 격리한다.** 메인 프로세스가 곧 서버 코어라, 모델 로드 실패나
 * 메모리 부족이 앱 전체를 끌고 내려가면 안 된다.
 *
 * **자원은 한 벌뿐이다.** 클로드 버블은 무한히 병렬이지만 로컬 모델은 아니다 — 동시 로드
 * 상한을 두고, 넘으면 거절이 아니라 앞의 모델을 내리고 자리를 만든다. 유휴 모델은 스스로
 * 내려간다. 같은 모델을 문 버블들은 한 인스턴스를 공유한다.
 *
 * **대화 이력의 주인이 바뀐다.** claude 경로는 CLI 가 `--resume` 으로 들고 있지만 여기서는
 * 우리가 `messages[]` 를 들고 있어야 한다 — 세션 단위 파일로 남겨 앱을 껐다 켜도 이어진다.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  LOCAL_CHARS_PER_TOKEN,
  LOCAL_DEFAULT_CONTEXT_SIZE,
  localAnswerBudget,
  localHistoryBudget,
  localThinkingBudget,
  localToolResultBudget,
  LOCAL_TOOL_DEFS,
  LOCAL_TOOL_MAX_ROUNDS,
  LOCAL_TOOL_NAMES,
  LOCAL_HOST_TOOLS,
  LOCAL_TOOL_REPEAT_LIMIT,
  LOCAL_COMPACT_MAX_TOKENS,
  LOCAL_ENGINE_CACHE_REUSE,
  LOCAL_ENGINE_BOOT_TIMEOUT_MS,
  LOCAL_ENGINE_PORT_BASE,
  LOCAL_MODEL_IDLE_UNLOAD_MS,
  LOCAL_MODEL_MAX_LOADED,
  type StreamEventType,
} from '@vibisual/shared';
import { logger } from '../logger.js';
import { getEngineState, truncatedImages } from './localEngineService.js';
import { readLocalArchitecture, readLocalGgufMeta, recordArchVerdict } from './localArchService.js';
import { findModel, recordOutputCheck } from './localModelService.js';
import { clipToolResult, runLocalTool, summarizeToolInput } from './localTools.js';

/** 스트림 조각을 이만큼 모으면 내보낸다 — 빠르게 뽑는 모델에서 이벤트 폭주를 막는다. */
const STREAM_FLUSH_CHARS = 240;
/** 이만큼 지났으면 짧아도 내보낸다 — 느린 모델에서 화면이 멈춘 것처럼 보이지 않게. */
const STREAM_FLUSH_MS = 120;

/**
 * §5.19 (D) — 문맥 초과로 이력을 잘라 내고 되던지는 횟수의 상한.
 * 끝을 안 두면 더 줄지 않는 이력 앞에서 같은 요청을 무한히 맴돈다.
 */
const CONTEXT_TRIM_MAX_RETRIES = 4;

/**
 * §5.19 (H) — 스트림으로 오는 도구 호출 조각. 이름과 인자는 **여러 줄에 걸쳐** 나뉘어 오고,
 * 어느 호출의 조각인지는 `index` 가 말해 준다(id 는 첫 조각에만 실린다).
 */
export interface ToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  /** 인자 JSON 의 **조각**. 이어 붙여야 온전한 JSON 이 된다. */
  argumentsFragment?: string;
}

/** SSE 한 줄에서 우리가 쓰는 것만 뽑아낸 결과. */
export interface ChatDelta {
  /** 최종 답으로 쌓일 본문. */
  text: string;
  /** 추론 모델이 따로 보내는 생각. */
  thinking: string;
  finishReason: string | null;
  /** 이 줄에 실려 온 도구 호출 조각들(없으면 빈 배열). */
  toolCalls: ToolCallDelta[];
  /**
   * 이 요청의 **프롬프트가 실제로 몇 토큰이었나**(엔진이 마지막 줄에 실어 준다).
   *
   * `timings.prompt_n` 을 쓰면 안 된다 — 캐시가 맞으면 그건 **새로 평가한 양**만 말한다
   * (2026-08-21 실측: 같은 11토큰 프롬프트가 캐시 적중 시 `prompt_n=4` / `prompt_tokens=11`).
   */
  promptTokens: number | null;
  /** 같은 자리에서 오는 **뱉은 토큰** 수(답 + 생각). 사용량 누적이 이 값을 먹는다. */
  completionTokens: number | null;
}

/**
 * `data:` 한 줄을 읽는다. 조각난 줄이면 `null`(다음 청크에서 이어진다).
 *
 * **`content` 만 읽으면 안 된다.** 추론 모델은 생각을 `reasoning_content` 로 따로 보내므로,
 * 생각만 하다 끝난 턴이 한 글자도 없는 빈 말풍선 + "완료" 가 된다 — 사용자에겐 아무 일도
 * 일어나지 않은 것으로 보인다(2026-08-20 실측: content 0자 / reasoning_content 4,096자).
 *
 * **`tool_calls` 도 같은 자리에 온다**(§5.19 (H)). 이걸 놓치면 모델이 파일을 고치겠다고
 * 말해도 우리 쪽에서는 아무 일도 일어나지 않는다.
 */
export function parseChatDelta(payload: string): ChatDelta | null {
  try {
    const j = JSON.parse(payload) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      choices?: Array<{
        delta?: {
          content?: string;
          reasoning_content?: string;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string | null;
      }>;
    };
    const choice = j.choices?.[0];
    const rawCalls = choice?.delta?.tool_calls ?? [];
    const toolCalls: ToolCallDelta[] = rawCalls.map((c, i) => {
      const out: ToolCallDelta = { index: typeof c.index === 'number' ? c.index : i };
      if (c.id) out.id = c.id;
      if (c.function?.name) out.name = c.function.name;
      if (typeof c.function?.arguments === 'string') out.argumentsFragment = c.function.arguments;
      return out;
    });
    return {
      text: choice?.delta?.content ?? '',
      thinking: choice?.delta?.reasoning_content ?? '',
      finishReason: choice?.finish_reason ?? null,
      toolCalls,
      promptTokens: typeof j.usage?.prompt_tokens === 'number' ? j.usage.prompt_tokens : null,
      completionTokens: typeof j.usage?.completion_tokens === 'number' ? j.usage.completion_tokens : null,
    };
  } catch {
    return null;
  }
}

/**
 * §5.19 (H) — 흩어져 오는 도구 호출 조각을 온전한 호출로 모은다.
 *
 * 인자 JSON 이 **여러 줄에 걸쳐** 쪼개져 오므로 중간에 파싱하면 늘 실패한다 — 끝까지 모으고
 * 한 번만 읽는다. 끝내 못 읽는 JSON 이면 버리지 않고 **빈 인자로** 넘긴다(도구 쪽이 "무엇이
 * 없다"고 말해 주면 모델이 고쳐 쓴다 — 우리가 조용히 삼키면 모델은 영영 모른다).
 */
export function createToolCallAccumulator(): {
  push(deltas: readonly ToolCallDelta[]): void;
  collect(): ChatToolCall[];
} {
  const byIndex = new Map<number, { id: string; name: string; args: string }>();
  return {
    push(deltas) {
      for (const d of deltas) {
        const cur = byIndex.get(d.index) ?? { id: '', name: '', args: '' };
        if (d.id) cur.id = d.id;
        if (d.name) cur.name = d.name;
        if (d.argumentsFragment) cur.args += d.argumentsFragment;
        byIndex.set(d.index, cur);
      }
    },
    collect() {
      return [...byIndex.entries()]
        .sort((a, b) => a[0] - b[0])
        .filter(([, c]) => c.name.length > 0)
        .map(([index, c]) => ({
          // id 를 안 주는 엔진도 있다 — 짝을 지을 키가 없으면 우리가 만든다.
          id: c.id || `call_${String(index)}_${Date.now().toString(36)}`,
          type: 'function' as const,
          function: { name: c.name, arguments: c.args },
        }));
    },
  };
}

/** 모아 둔 인자 JSON 을 읽은 결과. */
export interface ToolArguments {
  args: Record<string, unknown>;
  /** 끝내 못 읽었을 때 **모델에게 돌려줄** 한 줄. 없으면 온전히 읽은 것이다. */
  error?: string;
}

/**
 * 깨진 JSON 을 고쳐 볼 후보들을 만든다. 앞에서부터 시도해 처음 읽히는 것이 답이다.
 *
 * 스트림으로 조각조각 오는 인자 JSON 은 흔하게 깨진다 — 코드펜스로 감싸 보내거나, 앞뒤에
 * 설명을 붙이거나, 마지막 쉼표를 남기거나, 창이 끝나 **중간에서 잘린다**. 이 흠들은 전부
 * 기계적으로 고칠 수 있는 것이라, 고쳐 보지도 않고 버리면 왕복 한 번(로컬에선 수십 초)을
 * 그냥 태운다.
 */
export function repairJsonCandidates(raw: string): string[] {
  const out: string[] = [];
  const push = (s: string): void => {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(raw);

  // ① 코드펜스로 감싸 보내는 모델이 있다.
  push(raw.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, ''));

  // ② 앞뒤에 말을 붙이는 모델이 있다 — 바깥 중괄호만 남긴다.
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) push(raw.slice(first, last + 1));

  // ③ 마지막 쉼표.
  const base = first >= 0 ? raw.slice(first) : raw;
  push(base.replace(/,\s*([}\]])/g, '$1'));

  // ④ 중간에서 잘린 것 — 열린 것을 닫아 준다. 끝이 값 없는 키나 쉼표면 그 마지막 조각을
  //    버리고 닫는다(반쪽 값을 지어내지 않는다).
  const closed = closeTruncated(base);
  if (closed) push(closed);
  const trimmedTail = base.replace(/[,:]\s*$/, '').replace(/,\s*"[^"]*"\s*:?\s*$/, '');
  const closedTail = closeTruncated(trimmedTail);
  if (closedTail) push(closedTail);

  return out;
}

/** 열린 문자열·괄호를 닫아 온전한 JSON 모양으로 만든다. 닫을 것이 없으면 `null`. */
function closeTruncated(src: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of src) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (!inString && stack.length === 0) return null;
  let out = src;
  if (escaped) out = out.slice(0, -1); // 백슬래시로 끝났다 — 그 반쪽은 버린다
  if (inString) out += '"';
  return out + stack.reverse().join('');
}

/**
 * 모아 둔 인자 JSON 을 읽는다. 한 번에 안 되면 **흔한 흠부터 고쳐 보고** 다시 읽는다.
 *
 * 끝내 못 읽으면 빈 인자에 **사유를 함께** 돌려준다 — 종전에는 조용히 `{}` 만 줘서, 도구는
 * "path 가 없다"고 말하고 모델은 자기가 보낸 JSON 이 깨졌다는 사실을 **영영 모른 채** 같은
 * 모양으로 다시 보냈다. 무엇이 잘못됐는지 알려 주면 모델이 고쳐 쓴다.
 */
export function parseToolArguments(raw: string): ToolArguments {
  if (!raw.trim()) return { args: {} };
  for (const candidate of repairJsonCandidates(raw)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { args: parsed as Record<string, unknown> };
    }
    // 객체가 아닌 온전한 JSON(배열·숫자)은 인자로 쓸 수 없다 — 그 사실을 말해 준다.
    return {
      args: {},
      error: `tool arguments must be a JSON object, got ${Array.isArray(parsed) ? 'an array' : typeof parsed}`,
    };
  }
  return {
    args: {},
    error: `could not parse the tool arguments as JSON (even after repair): ${raw.slice(0, 200)}`,
  };
}

/**
 * §5.19 (H) — **같은 도구를 같은 인자로** 되풀이하고 있는가. 실행 **전에** 부르고, 문자열이
 * 돌아오면 실행하지 말고 그 문자열을 결과로 준다.
 *
 * 한 번만 허용하면 "고치고 다시 돌려 보는" 정당한 재실행까지 막히므로 몇 번은 그대로 실행하고,
 * 그 뒤로는 실행 대신 사실을 알린다. 상한이 없으면 왕복 상한을 전부 헛돌린다.
 */
export function repeatedCallNotice(
  seen: Map<string, number>,
  toolName: string,
  rawArgs: string,
  limit: number = LOCAL_TOOL_REPEAT_LIMIT,
): string | null {
  const key = `${toolName} ${rawArgs.trim()}`;
  const n = (seen.get(key) ?? 0) + 1;
  seen.set(key, n);
  if (n <= limit) return null;
  return `repeated call: you already ran ${toolName} with these exact arguments ${String(limit)} times in this turn, so it was not run again. Use the earlier result, change the arguments, or try a different tool.`;
}

export interface StreamCoalescer {
  push(type: 'text' | 'thinking', piece: string): void;
  /** 붙잡아 둔 조각을 마저 내보낸다. 끝맺기 전에 **반드시** 한 번 부른다. */
  flush(): void;
}

/**
 * 엔진은 토큰 하나마다 SSE 한 줄을 보낸다. 그대로 이벤트로 옮기면 한 턴이 수천 건이 되어
 * 전선·디스크·복원 예산을 잔조각으로 채운다(복원은 마지막 N 이벤트라, 잔조각이 그 자리를 다
 * 먹으면 정작 본문이 화면에서 사라진다).
 *
 * 그래서 **빠를 때는 모으고 느릴 때는 바로 내보낸다** — 시간 조건이 있어서, 초당 몇 토큰짜리
 * 로컬 모델에서는 사실상 조각마다 흘러가고 빠른 모델에서만 뭉친다.
 * `now` 를 받는 것은 시험에서 시간을 쥐기 위해서다.
 */
export function createStreamCoalescer(
  emit: (type: 'text' | 'thinking', content: string) => void,
  now: () => number = Date.now,
): StreamCoalescer {
  let pendingType: 'text' | 'thinking' | null = null;
  let pending = '';
  let pendingAt = 0;
  const flush = (): void => {
    if (pendingType && pending) emit(pendingType, pending);
    pendingType = null;
    pending = '';
  };
  return {
    flush,
    push(type, piece) {
      if (!piece) return;
      // 종류가 바뀌면 섞이지 않게 먼저 흘려보낸다(생각과 본문은 다른 자리에 그려진다).
      if (pendingType && pendingType !== type) flush();
      if (!pending) pendingAt = now();
      pendingType = type;
      pending += piece;
      if (pending.length >= STREAM_FLUSH_CHARS || now() - pendingAt >= STREAM_FLUSH_MS) flush();
    },
  };
}

/** 한 세션의 대화 한 줄. OpenAI 호환 스키마 그대로 — 엔진에 그대로 실어 보낸다. */
/**
 * §5.19 (H) — 도구가 붙으면서 이력이 **네 종류**가 됐다. 도구 왕복은 `assistant`(무엇을
 * 부르겠다) → `tool`(그 결과) 짝으로 남고, 다음 턴이 그 짝을 그대로 다시 싣는다 —
 * 짝을 깨서 하나만 실으면 엔진이 "결과 없는 호출" 이라며 요청을 통째로 거절한다.
 */
interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant 가 이 턴에 부른 도구들(있을 때만). */
  tool_calls?: ChatToolCall[];
  /** `role: 'tool'` 이 어느 호출의 결과인지. */
  tool_call_id?: string;
}

// ─── 대화 이력 (세션 단위 파일) ───

function historyDir(): string {
  return path.join(os.homedir(), '.vibisual', 'local-sessions');
}

function historyPath(subAgentId: string): string {
  const safe = subAgentId.replace(/[^\w.-]/g, '_');
  return path.join(historyDir(), `${safe}.json`);
}

function loadHistory(subAgentId: string): ChatMessage[] {
  try {
    const raw = fs.readFileSync(historyPath(subAgentId), 'utf8');
    const j = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function saveHistory(subAgentId: string, messages: ChatMessage[]): void {
  try {
    fs.mkdirSync(historyDir(), { recursive: true });
    fs.writeFileSync(historyPath(subAgentId), JSON.stringify(messages), 'utf8');
  } catch (err) {
    logger.warn(`[localRunner] history save failed for ${subAgentId}`, err);
  }
}

/** 세션을 지울 때 함께 지운다(버블이 사라졌는데 이력만 남을 이유가 없다). */
export function clearLocalHistory(subAgentId: string): void {
  try {
    fs.rmSync(historyPath(subAgentId), { force: true });
  } catch {
    /* 없으면 그만 */
  }
}

// ─── 엔진이 거절했을 때 (§5.19 (D) "컨텍스트를 넘기면 잘라 주는 일도 우리 몫이다") ───

/** 엔진이 요청을 거절한 이유 — **이 값만이** 폴백·재시도의 근거다. */
export interface EngineErrorInfo {
  /**
   * `no-tools` = 이 모델의 채팅 서식이 도구를 모른다(§5.19 (H) 의 강등 조건).
   * `context-overflow` = 보낸 프롬프트가 문맥 창보다 크다.
   * `other` = 그 밖 — 지어내지 말고 엔진이 한 말을 그대로 옮긴다.
   */
  kind: 'no-tools' | 'context-overflow' | 'other';
  /** 사용자에게 보일 한 줄. 엔진 원문을 살린다. */
  message: string;
  /** 문맥 초과일 때 엔진이 알려 준 수치(없을 수도 있다). */
  promptTokens?: number;
  contextTokens?: number;
}

/**
 * 엔진의 오류 응답을 읽어 **무엇이 잘못됐는지** 가른다.
 *
 * **왜 갈라야 하나 (2026-08-21 실측)**: 종전에는 도구를 실은 요청이 거절되면 이유를 묻지 않고
 * 전부 "이 모델은 도구를 못 쓴다"로 읽어 `toolSupport='none'` 을 설정에 박았다. 그런데 실제로
 * 온 것은 문맥 초과였다 — `{"error":{"message":"request (17300 tokens) exceeds the available
 * context size (16384 tokens), try increasing it","type":"exceed_context_size_error"}}`.
 * 그래서 ① 도구를 잘 쓰던 모델이 화면에서 "도구 미지원"으로 낙인찍히고(그 낙인은 설정에 남아
 * 다음 턴까지 간다) ② 도구만 뺀 같은 요청이 같은 이유로 또 거절돼 `engine responded 400`
 * 한 줄로 죽었다. 엔진은 이유를 또박또박 말하고 있었는데 우리가 버린 것이다.
 */
export function classifyEngineError(status: number, rawBody: string): EngineErrorInfo {
  let message = rawBody.trim().slice(0, 400);
  let type = '';
  let promptTokens: number | undefined;
  let contextTokens: number | undefined;
  try {
    const j = JSON.parse(rawBody) as {
      error?: { message?: string; type?: string; n_prompt_tokens?: number; n_ctx?: number };
      message?: string;
    };
    const e = j.error;
    if (typeof e?.message === 'string') message = e.message;
    else if (typeof j.message === 'string') message = j.message;
    if (typeof e?.type === 'string') type = e.type;
    if (typeof e?.n_prompt_tokens === 'number') promptTokens = e.n_prompt_tokens;
    if (typeof e?.n_ctx === 'number') contextTokens = e.n_ctx;
  } catch {
    /* JSON 이 아니면 본문 그대로 쓴다 */
  }

  // 수치를 따로 안 주는 빌드도 있으므로 문장에서도 한 번 건져 본다.
  if (promptTokens === undefined || contextTokens === undefined) {
    const m = /request \((\d+) tokens\) exceeds the available context size \((\d+) tokens\)/i.exec(message);
    if (m) {
      promptTokens ??= Number(m[1]);
      contextTokens ??= Number(m[2]);
    }
  }

  const isOverflow =
    type === 'exceed_context_size_error' || /exceeds the available context size|context size has been exceeded/i.test(message);
  // 좁게 잡는다 — 여기 걸리는 것만이 "도구를 못 쓰는 모델"이다. 넓히면 다른 사고가 전부
  //   도구 미지원으로 둔갑해 멀쩡한 모델의 파일 접근을 영영 끊는다.
  const isNoTools = /tools param|tool_choice param|requires --jinja|does not support tool|tools are not supported/i.test(message);

  const kind: EngineErrorInfo['kind'] = isOverflow ? 'context-overflow' : isNoTools ? 'no-tools' : 'other';
  const info: EngineErrorInfo = {
    kind,
    message: message || `engine responded ${String(status)}`,
  };
  if (promptTokens !== undefined) info.promptTokens = promptTokens;
  if (contextTokens !== undefined) info.contextTokens = contextTokens;
  return info;
}

/** 이 메시지들이 프롬프트에서 차지하는 글자 수(도구 호출 인자까지 센다). */
export function estimateMessageChars(messages: readonly ChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    n += m.content.length;
    if (m.tool_calls) n += JSON.stringify(m.tool_calls).length;
  }
  return n;
}

/**
 * `from` 에서 시작하는 **한 덩이**의 끝(배타적 인덱스)을 찾는다.
 *
 * 덩이 = `assistant`(도구를 부른 것) + 그 뒤에 붙는 `tool` 결과들, 또는 낱개 메시지 하나.
 * 짝을 반쪽만 남기면 다음 요청에서 엔진이 "결과 없는 호출"이라며 통째로 거절하므로,
 * 자를 때는 **반드시 덩이 단위**로 자른다.
 */
function groupEnd(messages: readonly ChatMessage[], from: number, limit: number): number {
  let i = from + 1;
  if (messages[from]?.role === 'assistant' && (messages[from]?.tool_calls?.length ?? 0) > 0) {
    while (i < limit && messages[i]?.role === 'tool') i += 1;
  }
  // 앞 덩이가 사라져 홀로 남은 `tool` 이 머리에 오면 서식이 깨진다 — 함께 데려간다.
  while (i < limit && messages[i]?.role === 'tool') i += 1;
  return i;
}

/**
 * §5.19 (D) — 문맥을 넘겼을 때 **오래된 쪽부터 덩이째** 덜어 낸 사본을 돌려준다.
 * 더 덜 것이 없으면 `null`(그때는 이번 턴 하나가 이미 창보다 크다는 뜻이라 사람에게 말해야 한다).
 *
 * - `system` 은 건드리지 않는다 — 규칙을 잃은 채로 이어 가면 다른 사람이 답하는 것과 같다.
 * - `keepFrom` 부터는 **이번 턴**이다. 방금 사용자가 친 질문과 그에 딸린 도구 왕복을 잘라 내면
 *   무엇에 답하는지를 모르게 되므로 절대 손대지 않는다.
 */
export function trimHistoryForRetry(
  messages: readonly ChatMessage[],
  keepFrom: number,
  dropChars: number,
): ChatMessage[] | null {
  const head = messages[0]?.role === 'system' ? 1 : 0;
  const limit = Math.max(head, Math.min(keepFrom, messages.length));
  if (head >= limit) return null; // 덜어 낼 지난 이력이 없다

  let cut = head;
  let dropped = 0;
  while (cut < limit && dropped < Math.max(1, dropChars)) {
    const end = groupEnd(messages, cut, limit);
    dropped += estimateMessageChars(messages.slice(cut, end));
    cut = end;
  }
  if (cut <= head) return null;
  return [...messages.slice(0, head), ...messages.slice(cut)];
}

/**
 * §5.19 (D) — **저장할 때** 이력을 예산 안으로 접는다.
 *
 * 되돌아가서 자르는 것(위 `trimHistoryForRetry`)만으로는 부족하다 — 그건 이미 400 을 한 번
 * 맞은 뒤의 수습이고, 그 한 번은 사용자에게 수십 초의 프롬프트 재평가로 돌아온다. 이력이
 * 예산을 넘긴 채로 디스크에 앉으면 **다음 턴은 첫 요청부터** 넘긴 상태로 출발한다.
 */
export function capHistoryForContext(messages: readonly ChatMessage[], budgetChars: number): ChatMessage[] {
  let out = [...messages];
  while (out.length > 1 && estimateMessageChars(out) > budgetChars) {
    const end = groupEnd(out, 0, out.length);
    if (end >= out.length) break; // 마지막 한 덩이는 남긴다
    out = out.slice(end);
  }
  return out;
}

/**
 * 문맥 초과 한 번에 **몇 글자를 덜어낼 것인가.**
 *
 * 한 덩이씩 깎으면서 매번 되던지면 안 된다 — 로컬 모델은 되던짐 한 번이 곧 프롬프트 전체
 * 재평가라 사용자가 그 수십 초를 고스란히 본다. 엔진이 준 수치(넘긴 토큰 / 창 크기)가 있으면
 * **한 번에** 넘긴 만큼을 덜고, 없으면 지난 이력의 4분의 1을 덜어 낸다.
 *
 * 창의 9할까지만 되돌리는 것은 여유를 남기기 위함이다 — 딱 맞게 자르면 다음 왕복의 도구 결과
 * 한 줄에 또 넘쳐서 같은 일을 되풀이한다.
 */
export function overflowDropChars(
  info: Pick<EngineErrorInfo, 'promptTokens' | 'contextTokens'>,
  historyChars: number,
  contextSize: number,
): number {
  const ctx = info.contextTokens ?? (contextSize > 0 ? contextSize : LOCAL_DEFAULT_CONTEXT_SIZE);
  const prompt = info.promptTokens;
  if (prompt !== undefined && prompt > 0 && ctx > 0) {
    const over = prompt - Math.floor(ctx * 0.9);
    if (over > 0) return over * LOCAL_CHARS_PER_TOKEN;
  }
  return Math.max(1, Math.floor(historyChars / 4));
}

/**
 * §5.19 (H) — **이 앱을 켠 동안** 도구 판정을 이미 물어본 모델들.
 *
 * 판정은 설정에 남아 다음 실행까지 가는데, 그 판정이 틀렸을 때 되돌릴 손잡이가 화면에 없다
 * (2026-08-21 사고: 문맥 초과를 도구 미지원으로 오독해 멀쩡한 모델에 `none` 이 박혔고, 그
 * 버블은 그때부터 파일을 못 봤다). 그래서 **`none` 은 앱을 켠 동안만 믿는다** — 다시 켜면
 * 한 번 더 물어본다. 진짜로 도구를 모르는 모델이면 그 한 번은 생성 없이 즉시 거절되므로
 * 값이 거의 들지 않고, 판정이 틀렸던 모델은 스스로 회복한다.
 */
const toolsProbedThisRun = new Set<string>();

/**
 * 이 턴에 도구를 실을 것인가. **판정은 여기 한 곳에서만.**
 *
 * 루트를 알아야 하고(어디를 만질지 모르면 도구를 줄 수 없다), 사람에게 물을 창구가 있어야
 * 하고(권한 브로커 없이 파일을 고치게 두지 않는다), `none` 판정은 **이번 실행에서 확인한
 * 것일 때만** 가로막는다.
 */
export function shouldOfferTools(opts: {
  hasRoot: boolean;
  hasBroker: boolean;
  verdict?: 'unknown' | 'ok' | 'none';
  probedThisRun: boolean;
}): boolean {
  if (!opts.hasRoot || !opts.hasBroker) return false;
  if (opts.verdict === 'none' && opts.probedThisRun) return false;
  return true;
}

// ─── §5.19 (D) 로컬 세션의 시스템 프롬프트 · 슬래시 명령 ───

/**
 * §5.19 (D) — 이 턴의 시스템 프롬프트를 짓는다.
 *
 * **왜 순서가 중요한가**: 엔진은 프롬프트의 **앞부분이 같으면** 지난 계산을 이어 쓴다
 * (`--cache-reuse`). 그래서 턴마다 안 변하는 것(프로젝트 안내·규칙·카드 지시문·기억 브리핑)을
 * **앞에**, 턴마다 바뀌는 것(엣지·목표·의도 선언 같은 live preamble)을 **뒤에** 둔다. 순서를
 * 뒤집으면 매 턴 프롬프트 전체를 다시 계산하게 되고, 로컬에서 그건 곧 수십 초다.
 *
 * `rules` 는 보통 `contextSummary` 안에 이미 들어 있다(§5.5 주입원 표의 `agentRules` 조각).
 * 주입선이 없는 경로(시험·옛 호출)에서만 따로 붙여 **규칙이 통째로 사라지는 일**을 막는다.
 */
export function buildLocalSystemPrompt(
  contextSummary?: string,
  livePreamble?: string,
  rules?: string,
): string {
  const stable = contextSummary?.trim() ?? '';
  const volatile = livePreamble?.trim() ?? '';
  const fallbackRules = stable ? '' : (rules?.trim() ?? '');
  return [stable, fallbackRules, volatile].filter((s) => s.length > 0).join('\n\n');
}

/** §5.19 (D) — 로컬 세션이 **자기가 처리하는** 슬래시 명령. */
export interface LocalSlashCommand {
  kind: 'clear' | 'compact' | 'context' | 'unsupported';
  /** `/compact 결정만 남겨라` 처럼 뒤에 붙은 말. 없으면 빈 문자열. */
  arg: string;
  /** 원문 — `unsupported` 를 사람에게 말해 줄 때 쓴다. */
  name: string;
}

/**
 * 이 명령이 우리가 처리할 슬래시인가. 슬래시가 아니면 `null`(그대로 모델에게 간다).
 *
 * **왜 필요한가**: 클로드 경로는 `composeTurnPrompt` 가 슬래시를 가로채 CLI 에 넘기는데, 로컬
 * 갈림은 그 앞에서 빠져나가므로 지금까지 `/clear` 조차 **그냥 사용자 말로** 모델에게 갔다.
 * 대화가 꽉 찼을 때 사용자가 쓸 손잡이가 하나도 없었다는 뜻이다.
 *
 * 모르는 슬래시는 모델에게 넘기지 않고 **모른다고 말한다** — 넘기면 모델이 그것을 지시문으로
 * 읽고 엉뚱한 일을 한다(로컬 모델일수록 그렇다).
 */
export function parseLocalSlash(text: string): LocalSlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const m = /^\/([a-zA-Z][\w-]*)\s*([\s\S]*)$/.exec(trimmed);
  if (!m) return null;
  const name = (m[1] ?? '').toLowerCase();
  const arg = (m[2] ?? '').trim();
  if (name === 'clear' || name === 'reset') return { kind: 'clear', arg, name };
  if (name === 'compact') return { kind: 'compact', arg, name };
  if (name === 'context') return { kind: 'context', arg, name };
  return { kind: 'unsupported', arg, name };
}

/** 모르는 슬래시에 대한 답 — 되는 것을 함께 말해 준다(막다른 답을 주지 않는다). */
export function unsupportedSlashMessage(name: string): string {
  return `[local] /${name} is a Claude CLI command and does not exist for local models. Available here: /clear (start over), /compact (fold the conversation into a summary), /context (what is loaded right now).`;
}

// ─── §5.19 (D) 접기 — 버리기 전에 요약한다 ───

/**
 * 요약을 시킬 때 쓰는 말. **무엇을 남겨야 하는지**를 못 박는다 — 그냥 "요약해"라고 하면
 * 작은 모델은 줄거리만 쓰고 결정·파일 경로·미해결 과제를 버린다. 그건 접은 게 아니라 잃은 것이다.
 */
const COMPACT_PROMPT = [
  'Summarize the conversation below so that another assistant can continue the work without reading it.',
  'Keep, in this order: (1) what the user asked for and any constraints they set,',
  '(2) decisions already made, (3) files and paths that were read or changed,',
  '(4) what is still unfinished or was about to happen next.',
  'Drop pleasantries and tool output that no longer matters. Write plain prose, no headings, under 400 words.',
  '',
  '--- conversation ---',
].join('\n');

/** 접은 결과가 이력에 앉을 때의 모양. 사람이 봐도 "여기부터는 요약"임이 보여야 한다. */
function foldedMessage(summary: string, foldedCount: number): ChatMessage {
  return {
    role: 'user',
    content: `[summary of the earlier ${String(foldedCount)} messages in this conversation]\n${summary.trim()}`,
  };
}

/**
 * 엔진에게 이 대화를 한 문단으로 접게 시킨다. 못 접으면 `null`(그때는 부르는 쪽이 버린다).
 *
 * 스트림을 쓰지 않는다 — 이건 사용자에게 보여 줄 말이 아니라 **이력에 앉힐 값**이라,
 * 조각으로 흘릴 이유가 없고 한 번에 받는 편이 단순하다.
 */
async function summarizeMessages(
  port: number,
  messages: readonly ChatMessage[],
  contextSize: number,
  signal?: AbortSignal,
): Promise<string | null> {
  if (messages.length === 0) return null;
  // 접을 대상 자체가 창보다 크면 접기도 못 한다 — 뒤쪽(최근)을 남기고 잘라서 넣는다.
  const room = Math.floor(contextSize * 0.5) * LOCAL_CHARS_PER_TOKEN;
  const kept = capHistoryForContext(messages, room);
  const transcript = kept
    .map((m) => {
      const calls = m.tool_calls?.length ? ` [called ${m.tool_calls.map((c) => c.function.name).join(', ')}]` : '';
      return `${m.role}:${calls} ${m.content}`.trim();
    })
    .join('\n');
  try {
    const res = await fetch(`http://127.0.0.1:${String(port)}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: `${COMPACT_PROMPT}\n${transcript}` }],
        stream: false,
        max_tokens: LOCAL_COMPACT_MAX_TOKENS,
      }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content?.trim() ?? '';
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/**
 * §5.19 (D) — 문맥이 넘쳤을 때 **지난 이력을 한 문단으로 접은** 사본을 돌려준다. 못 접으면 `null`
 * (그때는 부르는 쪽이 종전대로 덜어 낸다 — 접기는 더 나은 길이지 유일한 길이 아니다).
 *
 * 덜어 내기와 다른 점은 하나다: 덜면 그 대화는 **없던 일**이 되고, 접으면 줄어든 채로 남는다.
 * 사용자가 "아까 말한 그거"라고 했을 때 답할 수 있느냐가 여기서 갈린다.
 */
export async function compactMessagesForRetry(
  port: number,
  messages: readonly ChatMessage[],
  keepFrom: number,
  contextSize: number,
  signal?: AbortSignal,
): Promise<ChatMessage[] | null> {
  const head = messages[0]?.role === 'system' ? 1 : 0;
  const limit = Math.max(head, Math.min(keepFrom, messages.length));
  if (limit - head < 2) return null; // 접을 만한 지난 이력이 없다
  const summary = await summarizeMessages(port, messages.slice(head, limit), contextSize, signal);
  if (!summary) return null;
  return [...messages.slice(0, head), foldedMessage(summary, limit - head), ...messages.slice(limit)];
}

/**
 * §5.19 (D) — `/compact`. 사용자가 직접 접으라고 했을 때. 결과는 **사람에게 보일 한 줄**이다.
 * 접을 것이 없거나 모델이 못 접으면 그 사실을 그대로 말한다(조용히 아무 일도 안 하지 않는다).
 */
export async function compactLocalSession(
  subAgentId: string,
  modelId: string,
  contextSize: number,
  instructions?: string,
): Promise<string> {
  const history = loadHistory(subAgentId);
  if (history.length < 2) return '[local] nothing to compact yet — this conversation is still short';
  let inst: LoadedModel | null = null;
  try {
    inst = await ensureLoaded(modelId, contextSize);
    inst.busy += 1;
    const want = instructions?.trim();
    // 사용자가 "무엇을 남겨라"를 덧붙이면 그 말이 기본 지침보다 뒤에 와서 마지막 말이 된다.
    const source: ChatMessage[] = want
      ? [...history, { role: 'user', content: `When summarizing, pay special attention to: ${want}` }]
      : history;
    const summary = await summarizeMessages(inst.port, source, inst.contextSize);
    if (!summary) return '[local] could not compact — the model did not produce a summary. Nothing was lost.';
    saveHistory(subAgentId, [foldedMessage(summary, history.length)]);
    return `[local] compacted ${String(history.length)} messages into one summary (${String(summary.length)} chars). The conversation continues from here.`;
  } catch (err) {
    return `[local] could not compact — ${err instanceof Error ? err.message : String(err)}. Nothing was lost.`;
  } finally {
    if (inst) inst.busy = Math.max(0, inst.busy - 1);
  }
}

/**
 * §5.19 (D) — `/context`. **지금 이 대화에 무엇이 실려 있는가.** 클로드 경로의 같은 이름 명령이
 * 하는 일을 로컬에서도 한다 — 다만 세는 것은 우리가 실제로 보내는 것들이다.
 */
export function describeLocalContext(subAgentId: string, systemPrompt: string, contextSize: number): string {
  const ctx = contextSize > 0 ? contextSize : LOCAL_DEFAULT_CONTEXT_SIZE;
  const history = loadHistory(subAgentId);
  const sysChars = systemPrompt.length;
  const histChars = estimateMessageChars(history);
  const toolChars = JSON.stringify(LOCAL_TOOL_DEFS).length;
  const total = sysChars + histChars + toolChars;
  const approxTokens = Math.round(total / LOCAL_CHARS_PER_TOKEN);
  const pct = Math.round((approxTokens / ctx) * 100);
  return [
    `[local] context window ${String(ctx)} tokens · roughly ${String(approxTokens)} in use (~${String(pct)}%)`,
    `  instructions (rules, cards, goal, memory): ${String(sysChars)} chars`,
    `  conversation so far (${String(history.length)} messages): ${String(histChars)} chars`,
    `  tool definitions: ${String(toolChars)} chars`,
    '  (characters are exact; token counts are an estimate — the gauge in the status bar uses the engine\'s own number)',
  ].join('\n');
}

/** `/clear`. 이력을 지운다 — 지운 양을 말해 주지 않으면 사용자는 먹었는지 모른다. */
export function clearLocalSession(subAgentId: string): string {
  const had = loadHistory(subAgentId).length;
  clearLocalHistory(subAgentId);
  return had > 0
    ? `[local] cleared ${String(had)} messages. This conversation starts fresh from the next prompt.`
    : '[local] this conversation was already empty';
}

// ─── 모델 인스턴스 풀 ───

interface LoadedModel {
  modelId: string;
  modelPath: string;
  port: number;
  /**
   * 이 인스턴스가 **실제로** 뜬 문맥 크기. 요청값과 다를 수 있다 — 모델의 학습 문맥보다 크게
   * 잡으면 엔진이 조용히 깎기 때문에(`exceeds the training context of the model - capping`),
   * 우리가 먼저 깎아 두고 그 값을 예산·게이지의 진실로 쓴다.
   */
  contextSize: number;
  child: ChildProcess;
  lastUsedAt: number;
  /** 준비될 때까지 기다릴 약속. 여러 버블이 동시에 물어도 한 번만 띄운다. */
  ready: Promise<void>;
  /** 지금 이 인스턴스를 쓰고 있는 턴 수 — 0 이 아니면 내리지 않는다. */
  busy: number;
}

const loaded = new Map<string, LoadedModel>();

/** 지금 메모리에 올라가 있는 모델 id 들(§5.19 (F) 표시용). */
export function listLoadedModels(): string[] {
  return [...loaded.keys()];
}

async function freePort(from: number): Promise<number> {
  for (let p = from; p < from + 200; p += 1) {
    const ok = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen(p, '127.0.0.1');
    });
    if (ok) return p;
  }
  throw new Error('no free port for local engine');
}

/**
 * 뜨자마자 죽었을 때, 16진수 대신 **사람이 읽을 수 있는 원인과 할 일**을 붙인다.
 *
 * Windows 는 이미지를 못 매핑하면 프로세스 종료 코드로 NTSTATUS 를 그대로 돌려준다.
 * 그중 `0xC000007B` 는 사실상 "설치가 반쯤 풀렸다"는 뜻이라(2026-08-20 실측 —
 * `llama-server-impl.dll` 이 9,982,976B 중 6,361,270B 만 남아 있었다), 사용자가 할 일인
 * "엔진 다시 설치"까지 문장 안에 들어가야 한다. `code=3221225595` 만으로는 아무도 모른다.
 */
function describeExit(code: number | null): string {
  if (code === null) return 'engine exited before ready';
  const status = code >>> 0; // NTSTATUS 는 부호 없는 32비트로 읽어야 뜻이 보인다
  const hex = `0x${status.toString(16).toUpperCase().padStart(8, '0')}`;
  if (status === 0xc000007b) {
    return `engine executable is damaged (${hex}) — the engine install is incomplete, remove and reinstall the engine`;
  }
  if (status === 0xc0000135 || status === 0xc0000139) {
    return `engine is missing a required library (${hex}) — remove and reinstall the engine`;
  }
  return `engine exited before ready (code=${String(code)} ${hex})`;
}

async function waitHealthy(port: number, child: ChildProcess, deadline: number, stderrTail: () => string): Promise<void> {
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      // 엔진이 남긴 마지막 말을 함께 싣는다 — 지금까지 이건 debug 로그로만 흘러
      //   사용자에게는 닿지 않았다(모델 로드 실패 사유가 대부분 여기 적힌다).
      const tail = stderrTail();
      throw new Error(`${describeExit(child.exitCode)}${tail ? ` — ${tail}` : ''}`);
    }
    if (Date.now() > deadline) throw new Error('engine boot timeout');
    // 준비 판정은 한 엔드포인트에 걸지 않는다 — `/health` 는 `--help` 에 문서화돼 있지 않아
    //   빌드에 따라 사라질 수 있고(실측 b10502 의 --help 에 없다), 모델 로딩 중에는 503 을 준다.
    //   우리가 실제로 쓸 OpenAI 호환 표면(`/v1/models`)이 200 이면 그때가 진짜 준비된 때다.
    for (const probe of ['/health', '/v1/models']) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}${probe}`);
        if (res.ok) return;
      } catch {
        /* 아직 안 떴다 */
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

function unload(modelId: string): void {
  const m = loaded.get(modelId);
  if (!m) return;
  loaded.delete(modelId);
  try {
    m.child.kill();
  } catch {
    /* 이미 죽었으면 그만 */
  }
  logger.info(`[localRunner] unloaded ${modelId}`);
}

/** 전부 내린다(앱 종료 시). */
export function unloadAllLocalModels(): void {
  for (const id of [...loaded.keys()]) unload(id);
}

// 유휴 언로드 — 30초마다 훑어 오래 안 쓴 인스턴스를 내린다.
const idleTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, m] of loaded) {
    if (m.busy === 0 && now - m.lastUsedAt > LOCAL_MODEL_IDLE_UNLOAD_MS) unload(id);
  }
}, 30_000);
if (typeof idleTimer.unref === 'function') idleTimer.unref();

/**
 * 엔진이 그 인자를 **몰라서** 죽은 것인가.
 *
 * 모르는 CLI 플래그는 무시가 아니라 **즉시 종료**다. 옛 빌드로 설치해 둔 사용자의 엔진이
 * `--reasoning-budget` 를 모르면 모델이 통째로 안 뜬다 — 새 플래그를 더할 때마다 옛 설치를
 * 죽이는 그 사고를 여기서 막는다.
 */
function isUnknownArgError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid argument|unknown argument|unrecognized|error while handling argument/i.test(msg);
}

/**
 * §5.19 (D) — 엔진에 **얹기만 하는** 선택 플래그들. 없어도 모델은 돌고, 있으면 더 낫다.
 *
 * 순서가 곧 **버리는 순서**다(앞이 먼저 버려진다). 옛 빌드가 모르는 플래그를 만나면 무시가
 * 아니라 즉시 종료하므로, 가치가 낮은 것부터 하나씩 빼면서 다시 띄운다 — 캐시 재사용은
 * 빠르기의 문제지만 사고 상한은 **빈 답이냐 아니냐**의 문제라 마지막까지 붙들고 간다.
 */
export interface EngineExtraFlag {
  id: string;
  flag: string;
  value: (contextSize: number) => string;
}

export const ENGINE_EXTRA_FLAGS: readonly EngineExtraFlag[] = [
  { id: 'cache-reuse', flag: '--cache-reuse', value: () => String(LOCAL_ENGINE_CACHE_REUSE) },
  { id: 'thinking-cap', flag: '--reasoning-budget', value: (ctx) => String(localThinkingBudget(ctx)) },
];

/** 이 조합으로 엔진을 띄울 때의 인자. **인자를 만드는 곳은 여기 한 곳뿐이다.** */
export function buildEngineArgs(
  modelPath: string,
  port: number,
  contextSize: number,
  gpuLayers: number,
  extras: readonly EngineExtraFlag[],
): string[] {
  const args = [
    '-m', modelPath,
    '--host', '127.0.0.1',
    '--port', String(port),
    '-c', String(contextSize),
    '-ngl', String(gpuLayers),
  ];
  for (const e of extras) args.push(e.flag, e.value(contextSize));
  return args;
}

/**
 * 선택 플래그를 전부 얹어 띄워 보고, 이 엔진이 **모르는 플래그**를 만나면 앞에서부터 하나씩
 * 빼며 다시 띄운다. 마지막까지 안 되면 그때는 플래그 문제가 아니므로 그대로 올린다.
 *
 * 새 플래그를 더할 때 옛 설치를 죽이는 사고(§4 CLI 플래그 소실과 같은 계열)를 여기서 막는다.
 */
async function bootWithFlagFallback(
  boot: (gpuLayers: number, extras: readonly EngineExtraFlag[]) => Promise<ChildProcess>,
  gpuLayers: number,
  modelName: string,
): Promise<ChildProcess> {
  let extras: readonly EngineExtraFlag[] = ENGINE_EXTRA_FLAGS;
  for (;;) {
    try {
      return await boot(gpuLayers, extras);
    } catch (err) {
      if (!isUnknownArgError(err) || extras.length === 0) throw err;
      const dropped = extras[0];
      extras = extras.slice(1);
      logger.warn(
        `[localRunner] engine does not know ${dropped?.flag ?? '?'} — rebooting ${modelName} without it`,
      );
    }
  }
}

/**
 * 모델을 올려 둔 인스턴스를 얻는다. 이미 올라가 있으면 그대로 쓰고, 상한을 넘으면
 * 가장 오래 안 쓴 것을 내려 자리를 만든다.
 *
 * `-ngl` 사다리: 먼저 전부 GPU 로 올려 보고, 그 프로세스가 못 뜨면 CPU 로 떨어져 다시
 * 띄운다. 사용자 장비를 재지 않고도 "되면 빠르게, 안 되면 느리게라도" 가 성립하는 자리다.
 */
async function ensureLoaded(modelId: string, requestedContext: number): Promise<LoadedModel> {
  const cur = loaded.get(modelId);
  if (cur) {
    await cur.ready;
    cur.lastUsedAt = Date.now();
    return cur;
  }

  const engine = getEngineState();
  if (!engine.installed || !engine.serverBin) throw new Error('local engine is not installed');
  // 띄우기 전에 실물을 본다 — 잘린 이미지를 그냥 spawn 하면 Windows 가 돌려주는 것은
  //   `0xC000007B` 한 줄뿐이라 어느 파일이 반쪽인지 아무도 모른다. 이 검사가 이름을 준다.
  //   (이 fix 이전에 설치한 사용자는 설치 검증을 거치지 않았으므로 여기가 유일한 그물이다.)
  const damaged = truncatedImages(path.dirname(engine.serverBin));
  if (damaged.length > 0) {
    throw new Error(
      `engine install is incomplete: ${damaged.slice(0, 5).join(', ')} — remove and reinstall the engine`,
    );
  }
  const model = findModel(modelId);
  if (!model) throw new Error(`model not found: ${modelId}`);
  // 쪼개진 모델은 조각이 다 있어야 열린다. 여기서 막지 않으면 엔진이 `code=1` 로 죽는 것
  //   말고는 사용자가 무엇이 없는지 알 길이 없다(2026-08-20 실측).
  // 부속 파일(mmproj·MTP 헤드)은 본체와 함께 쓰라고 있는 것이라 혼자 열면 엔진이 뻗는다
  //   (2026-08-20 실측: 텐서 18개짜리 MTP 헤드 → `0xC0000005` 액세스 위반).
  if (model.companion === true) {
    throw new Error(
      `"${model.name}" is a companion file (projector / draft head), not a standalone model — pick a full model instead`,
    );
  }
  if (model.missingParts && model.missingParts.length > 0) {
    throw new Error(
      `model is incomplete — missing ${String(model.missingParts.length)} of ${String(model.partCount ?? 0)} parts (${model.missingParts.slice(0, 3).join(', ')}). Download the model again so every part is fetched.`,
    );
  }

  while (loaded.size >= LOCAL_MODEL_MAX_LOADED) {
    const victim = [...loaded.values()].filter((m) => m.busy === 0).sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (!victim) throw new Error('all loaded models are busy');
    unload(victim.modelId);
  }

  // 학습 문맥보다 크게 잡아 봐야 엔진이 깎는다 — 우리가 먼저 깎아 두면 화면 숫자가 사실이 된다.
  const trained = readLocalGgufMeta(model.path).contextLength;
  const contextSize = trained && trained > 0 ? Math.min(requestedContext, trained) : requestedContext;
  if (contextSize !== requestedContext) {
    logger.info(`[localRunner] ${model.name} trained context is ${String(trained ?? 0)} — using it instead of ${String(requestedContext)}`);
  }

  const port = await freePort(LOCAL_ENGINE_PORT_BASE);
  const serverBin = engine.serverBin;

  const boot = async (gpuLayers: number, extras: readonly EngineExtraFlag[]): Promise<ChildProcess> => {
    // 생각 상한(빈 답 방지)·캐시 재사용(앞을 자른 뒤 재평가 방지)은 **얹기만 하는** 것이라
    //   모르는 빌드에서는 위 사다리가 하나씩 빼 준다.
    const args = buildEngineArgs(model.path, port, contextSize, gpuLayers, extras);
    logger.info(
      `[localRunner] booting ${model.name} port=${port} ngl=${gpuLayers} extras=${extras.map((e) => e.id).join(',') || 'none'}`,
    );
    const child = spawn(serverBin, args, {
      cwd: path.dirname(serverBin),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let tail = '';
    child.stderr?.on('data', (d: Buffer) => {
      const s = d.toString();
      if (s.trim()) logger.debug(`[llama-server] ${s.trim().slice(0, 400)}`);
      tail = (tail + s).slice(-600); // 꼬리만 붙잡는다 — 무한히 모으지 않는다
    });
    await waitHealthy(port, child, Date.now() + LOCAL_ENGINE_BOOT_TIMEOUT_MS, () => tail.trim().slice(-300));
    return child;
  };

  let resolveReady: () => void = () => undefined;
  let rejectReady: (e: Error) => void = () => undefined;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  // 이 약속을 아무도 지켜보지 않는 경우가 있다 — 처음 부른 쪽이 예외로 빠져나가면 거절이
  //   주인 없이 남아 `unhandledRejection` 으로 튀고, 그건 서버 코어(=메인 프로세스)를
  //   흔든다(앱 크래시 로그에 실제로 남아 있던 그 오류다). 빈 catch 하나로 못을 박는다.
  //   진짜 실패는 아래에서 그대로 throw 되므로 삼켜지는 것이 아니다.
  ready.catch(() => undefined);

  const placeholder: LoadedModel = {
    modelId,
    modelPath: model.path,
    port,
    contextSize,
    child: null as unknown as ChildProcess,
    lastUsedAt: Date.now(),
    ready,
    busy: 0,
  };
  loaded.set(modelId, placeholder);

  try {
    let child: ChildProcess;
    try {
      child = await bootWithFlagFallback(boot, 999, model.name);
    } catch (err) {
      logger.warn(`[localRunner] GPU boot failed for ${model.name}, falling back to CPU`, err);
      child = await bootWithFlagFallback(boot, 0, model.name);
    }
    placeholder.child = child;
    child.on('close', () => {
      if (loaded.get(modelId) === placeholder) loaded.delete(modelId);
    });
    resolveReady();
    return placeholder;
  } catch (err) {
    loaded.delete(modelId);
    const e = err instanceof Error ? err : new Error(String(err));
    rejectReady(e);
    throw e;
  }
}

// ─── 턴 실행 ───

/** §5.19 (H) — 도구 한 건을 실행해도 되는지 물었을 때의 답. */
export interface LocalToolVerdict {
  allowed: boolean;
  /** 거절 사유 — 모델에게 그대로 돌려줘 다음 수를 고르게 한다. */
  reason?: string;
}

export interface LocalTurnArgs {
  subAgentId: string;
  /** 사용자가 이번 턴에 친 말. */
  prompt: string;
  modelId: string;
  /** 에이전트 규칙 등 — 대화 맨 앞의 system 한 줄. */
  systemPrompt?: string;
  contextSize?: number;
  temperature?: number;
  /**
   * §5.19 (H) — 도구가 일할 **프로젝트 루트**. 없으면 도구를 아예 싣지 않는다
   * (어디를 고칠지 모르는 채로 파일 도구를 주는 것이 가장 위험하다).
   */
  projectRoot?: string;
  /**
   * §5.19 (H) — 이 모델이 도구를 쓰는지에 대한 **지금까지의 판정**. `'none'` 이면 이번 턴은
   * 도구 없이 간다(못 쓰는 모델에 매 턴 도구를 실어 보내 매번 거절당하지 않게).
   */
  toolSupport?: 'unknown' | 'ok' | 'none';
  /** 판정이 바뀌었을 때 한 번 — 호출자가 `AgentConfig.provider` 에 남긴다. */
  onToolSupport?: (support: 'ok' | 'none') => void;
  /**
   * §5.19 (H) — 도구 실행 **직전**에 부른다. 여기서 기존 권한 브로커가 팝업을 띄운다.
   * 없으면 도구를 싣지 않는다 — 아무도 안 묻는 채로 파일을 고치게 두지 않는다.
   */
  onToolRequest?: (toolName: string, toolInput: Record<string, unknown>) => Promise<LocalToolVerdict>;
  /** 스트림 한 조각이 나올 때마다. 화면은 이 이벤트만 보고 그린다. */
  onEvent: (eventType: StreamEventType, content: string) => void;
  /**
   * §5.19 (H) — 도구 카드용. `tool_use`/`tool_result` 는 `toolUseId` 로 짝지어야 화면이
   * 호출과 결과를 맞춰 그린다(§5.5 #17-27 ⑪ — 짝이 없으면 FIFO 로 밀린다).
   */
  onToolEvent?: (
    eventType: 'tool_use' | 'tool_result',
    content: string,
    toolName: string,
    toolUseId: string,
  ) => void;
  /**
   * §5.19 (D) — 이 왕복의 프롬프트가 몇 토큰이었나. 창이 얼마나 찼는지를 **넘치기 전에**
   * 보여 주기 위한 자리다(엔진이 공짜로 알려 주는 값이라 따로 세지 않는다).
   */
  onUsage?: (promptTokens: number, completionTokens: number, contextSize: number) => void;
  /**
   * §5.19 (H) — **서버가 대신 처리하는** 도구(`LOCAL_HOST_TOOLS`). 파일이 아니라 우리 화면·설정을
   * 움직이므로 러너가 직접 하지 않고 밖으로 넘긴다 — 러너는 엔진과 파일만 알면 되고, 목표창·질문
   * 카드·권한 모드가 어디 사는지는 몰라도 된다(그 지식이 여기 들어오면 러너가 서버 전체를 문다).
   *
   * 돌려주는 문자열이 그대로 도구 결과가 되어 모델에게 간다.
   */
  onHostTool?: (toolName: string, input: Record<string, unknown>) => Promise<string>;
  /**
   * §5.19 (H) — 이 도구 호출을 **훅 이벤트로도** 흘린다.
   *
   * 클로드 세션의 도구 호출은 훅을 타고 그래프에 닿아 캔버스의 파일 노드·감사 원장·Bash 이력·
   * 서버 포트 감지를 만든다. 로컬 세션은 그 통로가 없어 **화면에 아무 자국도 남기지 않았다** —
   * 같은 일을 하는데 한쪽만 보이지 않는 것은 "에이전트가 생각하는 것을 보여 준다"는 이 앱의
   * 약속을 로컬에서만 깨는 일이다.
   *
   * 도구 이벤트만 보낸다. 생명주기(활성·종료)는 로컬 턴이 **이미 자기가** 관리하므로 여기서
   * 또 보내면 주인이 둘이 되어 상태가 서로를 덮어쓴다.
   */
  onHookEvent?: (event: LocalHookToolEvent) => void;
  /** 턴이 끝나면 한 번. `error` 가 있으면 실패. */
  onDone: (error?: string) => void;
}

/**
 * §5.19 (D) — 이 이벤트를 **화면 스트림에 실어 보낼 것인가.**
 *
 * `result` 는 이 턴의 최종 본문인데, 같은 본문은 이미 `text` 델타로 흘러 말풍선에 쌓여 있다.
 * 그것을 한 번 더 흘리면 초록 결과 상자(`ResultBlock`)가 **같은 답을 두 번째로** 그린다
 * (2026-08-21 사용자 보고: "답변 내용이 2개씩 뜬다"). 클로드 경로도 같은 이유로 `result`
 * 라인을 스트림에서 버리므로(`parseStreamLine`: "UI에 다시 그리지 않는다 — assistant text가
 * 동일 본문을 이미 스트리밍으로 렌더"), 로컬도 같은 규약을 탄다. 프로바이더마다 화면 규칙이
 * 갈라지면 그때부터 사용자는 둘 다 안 믿는다.
 *
 * 본문이 사라지는 것이 아니다 — 호출자가 `result` 를 받아 `cmd.result`·`sub.lastResult` 에
 * 남기므로, 스트림이 없는 화면(명령 말풍선 인라인 결과)은 그 값을 그대로 쓴다.
 */
export function isRenderableLocalEvent(eventType: StreamEventType): boolean {
  return eventType !== 'result';
}

/**
 * §5.19 (H) — 훅으로 흘릴 도구 이벤트 한 건. 훅 페이로드로 옮기기 쉬운 모양 그대로 둔다
 * (여기서 페이로드를 짓지 않는다 — 그러면 러너가 그래프 스키마를 알게 된다).
 */
export interface LocalHookToolEvent {
  phase: 'pre' | 'post';
  toolName: string;
  toolInput: Record<string, unknown>;
  /** 사후에만. 실행 결과 본문(거절 사유도 결과다). */
  toolResponse?: string;
  /** 호출과 결과를 짝짓는 키. 화면의 도구 카드가 쓰는 것과 같은 값. */
  toolUseId: string;
  cwd: string;
  /** 사후에만. 이 도구가 걸린 시간(ms). */
  durationMs?: number;
}

/** 진행 중인 턴 — [중지]가 자식 kill 이 아니라 생성 중단이라 여기서 붙잡는다. */
const running = new Map<string, AbortController>();

/** §5.19 (D) — [중지]. 자식을 죽이지 않는다(모델은 다음 턴에 다시 쓴다). */
export function stopLocalTurn(subAgentId: string): boolean {
  const ac = running.get(subAgentId);
  if (!ac) return false;
  ac.abort();
  return true;
}

export function isLocalTurnRunning(subAgentId: string): boolean {
  return running.has(subAgentId);
}

/**
 * 한 턴을 돈다 — 이력을 싣고, 스트림을 받아 조각마다 `onEvent` 를 부르고, 끝에 이력을 저장한다.
 * 예외는 던지지 않는다(호출자는 `onDone(error)` 로만 판단하면 된다).
 *
 * **§5.19 (H) 한 턴 = 여러 왕복.** 모델이 도구를 부르면 그 자리에서 실행하고 결과를 돌려준
 * 뒤 **다시 물어본다** — 그래야 "파일을 읽고 → 고치고 → 확인하는" 일이 한 턴 안에서 끝난다.
 * 왕복 수는 `LOCAL_TOOL_MAX_ROUNDS` 에서 끊는다(끝을 안 정하면 사람이 못 끊는다).
 */
export function runLocalTurn(args: LocalTurnArgs): void {
  const { subAgentId, prompt, modelId, onEvent, onDone } = args;
  // 요청값. 실제 창은 모델의 학습 문맥에 눌릴 수 있어, 인스턴스가 뜨면 **그 값으로 갈아탄다**.
  let contextSize = args.contextSize && args.contextSize > 0 ? args.contextSize : LOCAL_DEFAULT_CONTEXT_SIZE;

  const ac = new AbortController();
  running.set(subAgentId, ac);

  void (async (): Promise<void> => {
    let assistant = '';
    let inst: LoadedModel | null = null;

    // 중지 경로에서도 붙잡힌 조각을 흘려보내야 하므로 try 바깥에 둔다.
    const stream = createStreamCoalescer((type, content) => onEvent(type, content));

    // 이 턴에서 새로 쌓인 이력(도구 왕복 포함). 끝에 통째로 이어 붙인다.
    const turnMessages: ChatMessage[] = [{ role: 'user', content: prompt }];
    const persist = (): void => {
      // §5.19 (D) — 이력은 스스로 줄지 않는다. 예산 안으로 접어 두지 않으면 **다음 턴이 첫
      //   요청부터** 문맥을 넘긴 채로 출발한다(그 순간 그 버블은 무엇을 쳐도 400 이 된다).
      const merged = [...loadHistory(subAgentId), ...turnMessages];
      saveHistory(subAgentId, capHistoryForContext(merged, localHistoryBudget(contextSize)));
    };

    try {
      inst = await ensureLoaded(modelId, contextSize);
      // 예산·게이지·절단이 전부 이 값을 먹는다 — 요청값이 아니라 **실제로 뜬 창**이 진실이다.
      contextSize = inst.contextSize;
      inst.busy += 1;
      inst.lastUsedAt = Date.now();

      const history = loadHistory(subAgentId);
      // 문맥을 넘기면 **잘라 낸 사본으로 갈아탄다**(§5.19 (D)) — 그래서 const 가 아니다.
      let messages: ChatMessage[] = [];
      const sys = args.systemPrompt?.trim();
      if (sys) messages.push({ role: 'system', content: sys });
      messages.push(...history, { role: 'user', content: prompt });

      // 직전 왕복의 프롬프트 토큰 수. 답 예산과 문맥 게이지가 이 값을 쓴다(모르면 undefined).
      let lastPromptTokens: number | null = null;
      // 옛 엔진은 `stream_options` 를 모를 수 있다 — 그때만 한 번 빼고 다시 던진다.
      let askUsage = true;
      // 빈 답 안내가 "얼마를 다 썼는지"를 말하려면 마지막으로 실제 요청한 값이 루프 밖에도 있어야 한다.
      let lastAnswerBudget = localAnswerBudget(contextSize);

      // §5.19 (H) — 도구를 실을 조건: 루트를 알고, 물어볼 곳이 있고, 못 쓴다고 판정되지 않았을 것.
      const root = args.projectRoot?.trim() ?? '';
      const probedThisRun = toolsProbedThisRun.has(modelId);
      let useTools = shouldOfferTools({
        hasRoot: root.length > 0,
        hasBroker: !!args.onToolRequest,
        ...(args.toolSupport ? { verdict: args.toolSupport } : {}),
        probedThisRun,
      });
      // 판정 통지는 **턴에 한 번**이다. 왕복마다 부르면 같은 값으로 방송이 여러 번 나간다
      //   (한 턴에 세 번 나가는 것을 실측 — 도구를 세 번 왕복하면 세 번).
      // 이번 실행에서 아직 안 물어봤으면 **결과를 알려야 한다** — 설정에 남은 지난 판정이
      //   틀렸을 수 있고, 그것을 바로잡는 유일한 통지가 이 한 번이다.
      let supportReported = (args.toolSupport === 'ok' || args.toolSupport === 'none') && probedThisRun;
      // **이 모델에서 도구가 실제로 통한 적이 있는가.** 통한 뒤에 온 오류는 "도구를 못 쓴다"의
      //   근거가 될 수 없다 — 그때 강등하면 멀쩡한 모델의 파일 접근을 영영 끊는다.
      let toolsProven = args.toolSupport === 'ok';
      // 이 턴에서 **같은 도구를 같은 인자로** 몇 번 돌렸나. 왕복을 넘어 살아야 하므로 루프 밖이다.
      const repeatSeen = new Map<string, number>();
      // 문맥 초과로 되돌아가 자른 횟수. 끝을 안 두면 못 줄이는 이력 앞에서 무한히 맴돈다.
      let trims = 0;
      // §5.19 (D) ⑥ — 이 턴에 **이미 접었는가.** 접기는 왕복 한 번을 더 쓰므로 한 턴에 한 번만
      //   시도하고, 그래도 넘치면 그때부터는 덜어 낸다.
      let compacted = false;
      let finishReason: string | null = null;

      for (let round = 0; round < LOCAL_TOOL_MAX_ROUNDS; round += 1) {
        // 답 예산은 **왕복마다 다시 잡는다** — 도구 결과가 쌓여 프롬프트가 커진 만큼 답의 몫이
        //   줄어야 창 끝에 닿아 답이 잘리지 않는다(§5.19 (D) `localAnswerBudget`).
        const answerBudget = localAnswerBudget(contextSize, lastPromptTokens ?? undefined);
        lastAnswerBudget = answerBudget;
        const body: Record<string, unknown> = {
          messages,
          stream: true,
          max_tokens: answerBudget,
        };
        // 이 요청의 프롬프트가 몇 토큰이었는지 받아 온다 — 문맥 게이지와 답 예산이 이걸 먹는다.
        if (askUsage) body['stream_options'] = { include_usage: true };
        if (typeof args.temperature === 'number') body['temperature'] = args.temperature;
        if (useTools) body['tools'] = LOCAL_TOOL_DEFS;

        const res = await fetch(`http://127.0.0.1:${inst.port}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const raw = await res.text().catch(() => '');
          const info = classifyEngineError(res.status, raw);
          logger.info(
            `[localRunner] ${modelId} engine ${String(res.status)} (${info.kind}): ${info.message.slice(0, 200)}`,
          );

          // ① 문맥 초과 — §5.19 (D) "컨텍스트를 넘기면 잘라 주는 일도 우리 몫이다."
          //   모델의 흠도 도구의 흠도 아니다. 오래된 이력을 덩이째 덜고 같은 요청을 다시 던진다.
          if (info.kind === 'context-overflow') {
            const keepFrom = messages.length - turnMessages.length;

            // ⑥ **버리기 전에 접는다.** 덜어 내면 그 대화는 없던 일이 되지만, 접으면 줄어든 채로
            //   남아 "아까 말한 그거"에 답할 수 있다. 접기가 안 되면 아래 덜어 내기로 내려간다.
            if (!compacted) {
              const folded = await compactMessagesForRetry(inst.port, messages, keepFrom, contextSize, ac.signal);
              compacted = true;
              if (folded && estimateMessageChars(folded) < estimateMessageChars(messages)) {
                const before = messages.length;
                messages = folded;
                onEvent(
                  'system',
                  `[local] the conversation outgrew the ${String(info.contextTokens ?? contextSize)}-token context — folded the earlier ${String(before - folded.length + 1)} messages into a summary to keep going`,
                );
                logger.info(`[localRunner] ${modelId} folded ${String(before - folded.length + 1)} messages into a summary`);
                continue;
              }
            }
            const trimmed =
              trims < CONTEXT_TRIM_MAX_RETRIES
                ? trimHistoryForRetry(messages, keepFrom, overflowDropChars(info, estimateMessageChars(messages), contextSize))
                : null;
            if (trimmed) {
              const freed = estimateMessageChars(messages) - estimateMessageChars(trimmed);
              trims += 1;
              messages = trimmed;
              // 말은 **한 번만** 한다 — 되던질 때마다 같은 줄을 흘리면 화면이 그것으로 찬다.
              if (trims === 1) {
                onEvent(
                  'system',
                  `[local] the conversation still does not fit the ${String(info.contextTokens ?? contextSize)}-token context — dropping the oldest turns to continue`,
                );
              }
              logger.info(`[localRunner] ${modelId} trimmed ${String(freed)} chars of history (trim ${String(trims)})`);
              continue;
            }
            // 더 덜 것이 없다 = 이번 턴 하나가 이미 창보다 크다. 사람이 할 수 있는 일을 말해 준다.
            throw new Error(
              `${info.message} — this single turn already fills the context window; raise this bubble's context size or ask for less at once`,
            );
          }

          // ② 도구를 모르는 모델 — §5.19 (H) 의 강등. **엔진이 그렇게 말했을 때만** 내린다.
          //   도구가 한 번이라도 통한 뒤에 온 오류는 도구 탓이 아니므로 낙인을 찍지 않는다.
          if (useTools && (info.kind === 'no-tools' || (!toolsProven && info.kind === 'other'))) {
            toolsProbedThisRun.add(modelId);
            useTools = false;
            args.onToolSupport?.('none');
            supportReported = true;
            onEvent('system', '[local] this model does not support tools — continuing without file access');
            continue;
          }

          // ③ `stream_options` 를 모르는 옛 엔진일 수 있다 — 얹기만 하는 것이라 빼고 다시 던진다
          //   (CLI 플래그 사다리와 같은 규율: 새로 더한 것이 옛 설치를 죽이면 안 된다).
          if (askUsage) {
            askUsage = false;
            logger.warn(`[localRunner] ${modelId} rejected stream_options — retrying without usage reporting`);
            continue;
          }

          // ④ 그 밖 — 지어내지 않고 엔진이 한 말을 그대로 올린다. `engine responded 400` 한 줄로는
          //   사용자도 우리도 무엇이 잘못됐는지 알 길이 없었다.
          throw new Error(`engine responded ${String(res.status)} — ${info.message}`);
        }
        if (useTools && !supportReported) {
          args.onToolSupport?.('ok');
          supportReported = true;
        }
        // 여기까지 왔다 = 도구를 실은 요청을 엔진이 받아 줬다. 다음 오류는 도구 탓이 아니다.
        if (useTools) {
          toolsProven = true;
          toolsProbedThisRun.add(modelId);
        }

        // SSE — `data: {...}` 줄 단위. `[DONE]` 이 끝 신호다.
        const calls = createToolCallAccumulator();
        let roundText = '';
        finishReason = null;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl = buf.indexOf('\n');
          while (nl >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            nl = buf.indexOf('\n');
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') continue;
            const delta = parseChatDelta(payload);
            if (!delta) continue; // 조각난 줄은 다음 청크에서 이어진다
            stream.push('thinking', delta.thinking);
            if (delta.text) {
              roundText += delta.text;
              assistant += delta.text;
              stream.push('text', delta.text);
            }
            if (delta.toolCalls.length > 0) calls.push(delta.toolCalls);
            if (delta.finishReason) finishReason = delta.finishReason;
            if (delta.promptTokens !== null) {
              lastPromptTokens = delta.promptTokens;
              args.onUsage?.(delta.promptTokens, delta.completionTokens ?? 0, contextSize);
            }
          }
        }
        stream.flush();
        inst.lastUsedAt = Date.now();

        const toolCalls = calls.collect();
        if (toolCalls.length === 0) break; // 도구를 안 불렀으면 이 턴은 여기서 끝이다

        // 이 왕복의 assistant 를 이력·문맥 양쪽에 남긴다 — 짝(assistant→tool)이 깨지면
        //   다음 요청에서 엔진이 "결과 없는 호출" 이라며 통째로 거절한다.
        const assistantMsg: ChatMessage = { role: 'assistant', content: roundText, tool_calls: toolCalls };
        messages.push(assistantMsg);
        turnMessages.push(assistantMsg);

        for (const call of toolCalls) {
          if (ac.signal.aborted) break;
          const toolName = call.function.name;
          const parsedArgs = parseToolArguments(call.function.arguments);
          const toolInput = parsedArgs.args;
          args.onToolEvent?.('tool_use', summarizeToolInput(toolName, toolInput), toolName, call.id);

          const repeated = repeatedCallNotice(repeatSeen, toolName, call.function.arguments);

          // 훅 사전 이벤트 — 권한 판정 전에 낸다. 거절된 호출도 **시도된 일**이라 원장에 남아야
          //   하고, Bash 이력 엔트리도 여기서 만들어져야 사후 결과가 그 자리에 붙는다.
          const hookStartedAt = Date.now();
          args.onHookEvent?.({ phase: 'pre', toolName, toolInput, toolUseId: call.id, cwd: root });

          let resultBody: string;
          if (parsedArgs.error) {
            // 인자를 못 읽었으면 **그 사실**을 결과로 준다 — 빈 인자로 실행하면 모델은 도구가
            //   이상하다고 여기고 같은 깨진 JSON 을 다시 보낸다.
            resultBody = parsedArgs.error;
          } else if (!LOCAL_TOOL_NAMES.includes(toolName)) {
            // 없는 도구를 부르면 그 사실을 **결과로** 알린다(턴을 죽이지 않는다).
            resultBody = `unknown tool: ${toolName}. Available tools: ${LOCAL_TOOL_NAMES.join(', ')}`;
          } else if (repeated) {
            // 같은 호출을 되풀이하는 중 — 실행도 승인 요청도 하지 않는다(사람을 같은 팝업으로 괴롭히지 않는다).
            resultBody = repeated;
          } else {
            const verdict = await (args.onToolRequest?.(toolName, toolInput)
              ?? Promise.resolve<LocalToolVerdict>({ allowed: false, reason: 'no permission broker' }));
            if (!verdict.allowed) {
              resultBody = `permission denied: ${verdict.reason ?? 'the user did not allow this tool call'}`;
            } else {
              if (LOCAL_HOST_TOOLS.includes(toolName)) {
                // 호스트 도구는 파일을 안 건드리므로 잘라 낼 것도 없다(돌아오는 건 짧은 확인 한 줄).
                resultBody = args.onHostTool
                  ? await args.onHostTool(toolName, toolInput)
                  : `${toolName} is not available in this session`;
                args.onHookEvent?.({
                  phase: 'post', toolName, toolInput, toolResponse: resultBody,
                  toolUseId: call.id, cwd: root, durationMs: Date.now() - hookStartedAt,
                });
                args.onToolEvent?.('tool_result', resultBody, toolName, call.id);
                const hostMsg: ChatMessage = { role: 'tool', content: resultBody, tool_call_id: call.id };
                messages.push(hostMsg);
                turnMessages.push(hostMsg);
                continue;
              }
              const outcome = await runLocalTool(toolName, toolInput, root, ac.signal);
              // 고정 상한(24,000자)은 16K 문맥의 절반을 한 번에 삼킨다 — 이 창이 감당할 몫으로
              //   한 번 더 접는다. 자른 사실은 `clipToolResult` 가 본문에 남긴다.
              resultBody = clipToolResult(outcome.content, localToolResultBudget(contextSize));
            }
          }

          args.onHookEvent?.({
            phase: 'post', toolName, toolInput, toolResponse: resultBody,
            toolUseId: call.id, cwd: root, durationMs: Date.now() - hookStartedAt,
          });
          args.onToolEvent?.('tool_result', resultBody, toolName, call.id);
          const toolMsg: ChatMessage = { role: 'tool', content: resultBody, tool_call_id: call.id };
          messages.push(toolMsg);
          turnMessages.push(toolMsg);
        }

        if (ac.signal.aborted) break;
        if (round === LOCAL_TOOL_MAX_ROUNDS - 1) {
          onEvent('system', `[local] stopped after ${String(LOCAL_TOOL_MAX_ROUNDS)} tool rounds — ask again to continue`);
        }
      }

      if (!assistant) {
        // 답이 비었는데 조용히 "완료"로 끝내면 사용자는 **아무 일도 안 일어난 것**으로 본다.
        //   왜 비었는지를 말해 주는 것이 최소한이다.
        onEvent(
          'system',
          finishReason === 'length'
            ? `[local] no answer — the model spent the whole ${String(lastAnswerBudget)}-token budget without finishing an answer`
            : `[local] no answer — the model produced no output (finish_reason=${finishReason ?? 'unknown'})`,
        );
        // 도구만 돌고 말이 없던 턴이라도 **도구 왕복은 남긴다** — 다음 턴이 무엇을 했는지 알아야 한다.
        if (turnMessages.length > 1) persist();
      } else {
        // 빈 답을 이력에 남기면 다음 턴이 "아무 말도 안 한 나"를 문맥으로 물고 간다.
        turnMessages.push({ role: 'assistant', content: assistant });
        persist();
      }
      onEvent('result', assistant);
      onDone();
    } catch (err) {
      const aborted = ac.signal.aborted;
      stream.flush(); // 붙잡아 둔 마지막 조각까지 화면에 보낸 뒤에 끝맺는다
      if (aborted) {
        // 중지는 실패가 아니다 — 여기까지 나온 말과 **도구 왕복**을 이력에 남겨 다음 턴이 이어지게 한다.
        if (assistant) turnMessages.push({ role: 'assistant', content: assistant });
        if (turnMessages.length > 1) persist();
        onDone();
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[localRunner] turn failed for ${subAgentId}`, err);
        // ⚠ 여기서 `onEvent('error', msg)` 를 **직접 뱉지 않는다.** 실패 카드는 `onDone(error)` 를 받은
        //   호출자(`failCommand`)가 `[local] 원문` 봉투로 한 장만 낸다. 원문을 여기서 한 번 더 흘리면
        //   ① 같은 카드가 두 장 뜨고 ② 봉투가 없어 클라가 그 줄을 CLI 종료로 폴백해 로컬 모델 실패를
        //   "Claude CLI 가 예기치 않게 종료됐습니다" 로 잘못 말한다(2026-08-20 사용자 보고).
        onDone(msg);
      }
    } finally {
      running.delete(subAgentId);
      if (inst) inst.busy = Math.max(0, inst.busy - 1);
    }
  })();
}

// ─── 받은 모델이 실제로 말을 하는지 (§5.19 (E)) ───

/** 점검용 생성 길이. 깨진 출력은 첫 줄부터 깨져 있으므로 길게 뽑을 이유가 없다. */
const OUTPUT_CHECK_TOKENS = 48;
/** 어떤 모델이든 답할 수 있고, 답이 사람 말인지 바로 보이는 질문. */
const OUTPUT_CHECK_PROMPT = 'Reply with one short sentence: what is 2 plus 3?';

/**
 * 뽑아낸 몇 마디가 **사람이 읽을 수 있는 말**인지 본다.
 *
 * 2026-08-21 실측 — 엔진이 못 다루는 아키텍처는 파일이 온전해도 이런 것을 뱉는다:
 * `????????????????` (한 글자 반복) · `GGGGGGGG` · `<=@F75D=4:)%B!52F%` (기호 나열).
 * 반대로 멀쩡한 답은 `2 더하기 3은 5입니다.` 처럼 **낱말과 사이 띄움**이 있다.
 *
 * 넘겨짚어 멀쩡한 모델을 못 쓰게 만들지 않도록 **좁게** 잡는다 — 여기서 `true` 가 나와도
 * 막지 않고 알리기만 한다.
 */
export function looksDegenerate(sample: string): boolean {
  const text = sample.trim();
  if (text.length < 4) return true; // 아예 아무 말도 못 했다
  if (new Set(text).size <= 3) return true; // 같은 글자만 되풀이한다
  if (text.length >= 40) {
    // 사람 글에는 소문자·한글·가나·한자·띄어쓰기·문장부호가 섞인다. 기호 나열에는 없다.
    const friendly = text.match(/[a-z가-힣ぁ-んァ-ヶ一-龥\s.,!?'"]/gu)?.length ?? 0;
    if (friendly / text.length < 0.2) return true;
  }
  return false;
}

/** 이 모델의 구조를 읽어 판정을 장부에 남긴다 — 같은 구조는 두 번 확인할 필요가 없다. */
function rememberArch(modelPath: string, verdict: 'ok' | 'broken'): void {
  const arch = readLocalArchitecture(modelPath);
  if (!arch) return;
  recordArchVerdict(getEngineState().build ?? 'unknown', arch, verdict);
}

/**
 * §5.19 (E) — 받자마자 한 번 말을 시켜 보고 그 결과를 남긴다.
 * **받았다는 것과 쓸 수 있다는 것은 다르다** — 이 확인이 없으면 사용자는 프롬프트를 치고
 * 빈 답을 받은 뒤에야 그 사실을 알게 된다.
 */
export async function verifyModelOutput(modelId: string): Promise<'ok' | 'broken' | 'skipped'> {
  const model = findModel(modelId);
  if (!model || model.companion === true || (model.missingParts?.length ?? 0) > 0) return 'skipped';
  let inst: LoadedModel | null = null;
  try {
    inst = await ensureLoaded(modelId, LOCAL_DEFAULT_CONTEXT_SIZE);
    inst.busy += 1;
    const res = await fetch(`http://127.0.0.1:${inst.port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: OUTPUT_CHECK_PROMPT }],
        stream: false,
        max_tokens: OUTPUT_CHECK_TOKENS,
      }),
    });
    if (!res.ok) return 'skipped';
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
    };
    const message = body.choices?.[0]?.message;
    // 생각만 하고 끝난 모델도 있으므로 둘을 합쳐서 본다.
    const sample = `${message?.content ?? ''}${message?.reasoning_content ?? ''}`;
    const verdict = looksDegenerate(sample) ? 'broken' : 'ok';
    recordOutputCheck(modelId, model.sizeBytes, verdict);
    // 판정을 **구조 단위로도** 남긴다 — 같은 구조의 다른 양자화는 받아 보나 마나 같다.
    //   덕분에 다음부터는 받기 목록에서 미리 거를 수 있다.
    rememberArch(model.path, verdict);
    logger.info(`[localRunner] output check ${model.name} -> ${verdict}`);
    return verdict;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // **못 여는 것도 못 쓰는 것이다.** 엔진이 이 파일을 모델로 읽지 못하면(예: 음성인식용
    //   GGUF) 사용자에게는 결국 안 되는 모델이므로 그대로 알려 준다. 다만 우리 쪽 사정
    //   (엔진 미설치·자리 없음)은 모델 탓이 아니니 아무 말도 하지 않는다.
    const ourProblem = /engine is not installed|no free port|all loaded models are busy/i.test(message);
    if (!ourProblem) {
      recordOutputCheck(modelId, model.sizeBytes, 'broken');
      rememberArch(model.path, 'broken');
      logger.info(`[localRunner] output check ${model.name} -> broken (${message.slice(0, 120)})`);
      return 'broken';
    }
    logger.warn(`[localRunner] output check skipped for ${modelId}`, err);
    return 'skipped';
  } finally {
    if (inst) inst.busy = Math.max(0, inst.busy - 1);
  }
}

/** 모델 파일 경로를 미리 확인해 둔다(설정 화면이 "지금 고른 모델이 실제로 있는지"를 물을 때). */
export async function probeModelReadable(modelId: string): Promise<boolean> {
  const m = findModel(modelId);
  if (!m) return false;
  try {
    await fsp.access(m.path, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
