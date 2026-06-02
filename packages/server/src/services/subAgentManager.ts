import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ProjectInfo, SubAgent, SubAgentStatus, QueuedCommand, AgentConfig, SubAgentStreamEvent, StreamEventType, AgentViewJobState } from '@vibisual/shared';
import { DEFAULT_AGENT_CONFIG, isOpusModel } from '@vibisual/shared';
import { logger } from '../logger.js';
import { readLastAssistantMessage, readSessionTokenData, getSessionJsonlPath } from './sessionDiscovery.js';
import * as streamBufferStore from './streamBufferStore.js';
import { resolveClaudeBin } from './claudeBin.js';
import { isAgentViewEnabled, spawnBackground, stopSession, rmSession } from './claudeAgentViewService.js';
import { attach as attachWatcher, detach as detachWatcher } from './claudeAgentViewWatcher.js';

/** parentAgentId → 소속 ProjectInfo 해석. index.ts에서 graphManager 기반으로 주입. */
export type AgentProjectResolver = (parentAgentId: string) => ProjectInfo | null;

/**
 * AgentConfig → claude CLI 인자 배열 변환.
 * 기본값과 같은 항목은 CLI 인자로 넘기지 않음 (불필요한 제한 방지).
 */
function buildConfigArgs(config: AgentConfig): string[] {
  const args: string[] = [];

  // 모델 — §4 v2.40: alias 해소를 CLI 에 위임. Vibisual 측 변환 ❌.
  //   - `--model opus` → CLI 가 자체적으로 현재 latest Opus(=4.8) 로 해소
  //   - `--model opus[1m]` → alias + 1M 도 그대로 작동 (CLI 2.1.154 확인됨)
  //   - 사용자가 `modelVersion` 으로 풀ID 핀했으면 그것 우선
  //   - 정적 가드(`AVAILABLE_AGENT_MODEL_IDS.includes(...)`) 제거 — 신규 모델 출시 시 코드 수정 불필요.
  //     CLI 가 모델명 검증 담당. 잘못된 값이면 spawn 시점에 에러.
  if (config.model) {
    const base = config.modelVersion?.trim() || config.model;
    let modelArg = base;
    if (config.contextWindow !== '200k' && isOpusModel(base) && !modelArg.endsWith('[1m]')) {
      modelArg = `${modelArg}[1m]`;
    }
    args.push('--model', modelArg);
  }

  // 퍼미션 모드
  if (config.permissionMode && config.permissionMode !== 'default') {
    if (config.permissionMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions');
    } else {
      args.push('--permission-mode', config.permissionMode);
    }
  }

  // 사고 깊이 (effort)
  if (config.effort && config.effort !== 'default') {
    args.push('--effort', config.effort);
  }

  // 허용 도구 — CLI `--tools` 플래그로 에이전트 가시 툴 제한.
  // UI 에 노출된 AVAILABLE_AGENT_TOOLS 는 CLI 전체 툴셋의 부분집합일 수 있으므로
  // "전체 매칭 시 플래그 생략" 최적화는 사용 안 함 — 항상 명시해 UI 와 런타임 일치 보장.
  // 빈 배열은 `--tools ""` 로 전부 disable.
  if (config.tools) {
    args.push('--tools', config.tools.join(','));
  }

  // 차단 도구
  if (config.disallowedTools && config.disallowedTools.length > 0) {
    args.push('--disallowedTools', config.disallowedTools.join(','));
  }

  // 격리 모드 — worktree면 별도 git worktree에서 실행
  if (config.isolation && config.isolation !== 'none') {
    args.push('--isolation', config.isolation);
  }

  return args;
}

/**
 * §4 v2.63 — 인터랙티브(임베디드 PTY) 스폰용 claude CLI 인자.
 *
 * 헤드리스 경로(`buildConfigArgs` + `-p --print --input-format … --output-format …`)와 달리
 * **`-p`/stream 플래그를 붙이지 않는다** — 진짜 인터랙티브 REPL 로 띄워 사용자가 직접 몰게 한다
 * (구독 과금 + Anthropic ToS 합법선, §4 v2.63). `buildConfigArgs` 가 만드는 설정 인자
 * (model/permission/effort/tools/disallowedTools/isolation)는 그대로 공유 — "내가 설정한 세팅 그대로".
 * 헤드리스 경로는 rules 를 매 턴 프롬프트(contextSummary)에 주입하지만 인터랙티브는 그 경로가 없으므로
 * rules 를 `--append-system-prompt` 로 1회 주입한다.
 */
export function buildInteractiveClaudeArgs(
  config: AgentConfig,
  opts: { includeRules?: boolean } = {},
): string[] {
  const args = buildConfigArgs(config);
  // includeRules 기본 false — 임베디드 터미널은 셸 프롬프트에 명령을 prefill 하는데
  // 멀티라인 rules 를 한 줄 명령에 넣으면 셸 파싱이 깨진다(데스크톱 터미널 매니저 경로).
  // 직접 spawn(argv 배열) 경로에서만 includeRules:true 로 rules 를 안전히 주입.
  if (opts.includeRules) {
    const rules = config.rules?.trim();
    if (rules) args.push('--append-system-prompt', rules);
  }
  return args;
}

/** §4 v2.64 — CMD 에이전트 로컬 스토어 폴더(`~/.vibisual/cmd-agents/<agentId>/`). rules·세션맵 공용. */
function cmdAgentDir(agentId: string): string {
  // agentId 는 `agent-<hash>`(콜론/슬래시 없음)지만 방어적으로 안전한 문자만 남긴다.
  const safeId = agentId.replace(/[^\w.-]/g, '_');
  return path.join(os.homedir(), '.vibisual', 'cmd-agents', safeId);
}

/** termId(`term:<agentId>:<session>`) → { agentId, sessionToken }. 형식이 어긋나면 null. */
function parseTermId(termId: string): { agentId: string; sessionToken: string } | null {
  const parts = termId.split(':');
  if (parts.length < 3 || parts[0] !== 'term' || !parts[1]) return null;
  return { agentId: parts[1], sessionToken: parts.slice(2).join(':') || 'main' };
}

/**
 * §4 v2.63 — CMD(인터랙티브 터미널) 에이전트의 Agent Rules 를 **파일 기반**으로 claude 에 전달.
 *
 * 인터랙티브 prefill 은 셸 한 줄이라 멀티라인 rules 를 `--append-system-prompt` 인자로 못 넣는다
 * (개행이 셸 명령을 조기 제출시킴). 대신 Vibisual 관리 폴더(`~/.vibisual/cmd-agents/<agentId>/CLAUDE.md`)에
 * rules 를 써 두고, 터미널 매니저가 `--add-dir <dir>` 로 그 폴더를 물려준다. claude 는 add-dir 된 폴더의
 * CLAUDE.md 를 자동 참조(메모리/지시)하므로 멀티라인·따옴표·레포 오염 문제 없이 rules 가 적용된다.
 *   - 사용자 레포가 아니라 `~/.vibisual` 아래라 공개/커밋 위험 없음.
 *   - 에이전트 단위 폴더라 그 에이전트의 모든 CMD 세션이 같은 rules 공유. 새 세션 스폰 때마다 최신 rules 로 재기록
 *     → AgentSettings 에서 rules 수정 후 "+" 새 세션을 열면 반영(이미 떠 있는 세션엔 소급 X).
 *
 * @returns rules 가 있으면 그 폴더 절대경로, 없으면 null(=`--add-dir` 생략).
 */
export function prepareInteractiveRulesDir(agentId: string, config: AgentConfig): string | null {
  const rules = config.rules?.trim();
  if (!rules) return null;
  const dir = cmdAgentDir(agentId);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const body = `# Agent Rules (Vibisual CMD agent)\n\n${rules}\n`;
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), body, 'utf-8');
    return dir;
  } catch (err) {
    logger.warn(`[cmd-agent] rules dir write failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * §4 v2.64 — CMD(인터랙티브 터미널) 세션 연속성. 인터랙티브 claude 가 쏘는 hook 의 session_id
 * (claude 대화 UUID)를 termId 별로 `~/.vibisual/cmd-agents/<agentId>/sessions.json` 에 저장한다.
 * 앱을 완전히 종료하면 PTY(cmd.exe+claude) 자체는 죽지만 claude 는 대화를 JSONL 로 남기므로,
 * 재시작 후 같은 termId 로 터미널을 다시 열 때 `claude --resume <id>` 로 prefill 해 직전 대화를
 * 이어받는다(SCENARIO §23-2 의 헤드리스 `--resume` 연속성 패턴을 인터랙티브로 확장).
 * 그래프 상태가 아니라 터미널 프로세스 부기라 체크포인트가 아닌 CMD 로컬 스토어(rules CLAUDE.md
 * 와 같은 폴더)에 둔다. 값이 바뀔 때만 write — 같은 REPL 의 session id 는 안정적이라 사실상 1회.
 */
export function recordCmdTermSession(termId: string, claudeSessionId: string): void {
  const parsed = parseTermId(termId);
  if (!parsed || !claudeSessionId) return;
  const dir = cmdAgentDir(parsed.agentId);
  const file = path.join(dir, 'sessions.json');
  try {
    let map: Record<string, string> = {};
    if (fs.existsSync(file)) {
      try { map = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, string>; } catch { map = {}; }
    }
    if (map[parsed.sessionToken] === claudeSessionId) return; // 변화 없음 — disk write 생략
    map[parsed.sessionToken] = claudeSessionId;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(map, null, 2), 'utf-8');
  } catch (err) {
    logger.warn(`[cmd-agent] session record failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** termId 의 직전 claude 대화 sessionId 조회(없으면 null). 터미널 스폰 시 `--resume` prefill 용. */
export function getCmdResumeSession(termId: string): string | null {
  const parsed = parseTermId(termId);
  if (!parsed) return null;
  const file = path.join(cmdAgentDir(parsed.agentId), 'sessions.json');
  try {
    if (!fs.existsSync(file)) return null;
    const map = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, string>;
    const id = map[parsed.sessionToken];
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/** claude CLI 경로 — `services/claudeBin.ts` 가 SSOT (§5.7 #23-1 v1.59 버전 체크와 동일 바이너리). */
const CLAUDE_BIN = resolveClaudeBin().binPath;

/**
 * Persistent child process — VS Code Claude Code 확장과 같은 long-lived 모델.
 * 매 턴 fresh spawn (`claude -p --print --resume <id>`) 대신 에이전트당 1개 자식을 띄워두고
 * stdin 으로 다음 턴 메시지만 추가. 2턴째부터 node boot + claude init + JSONL 재로드 +
 * MCP 재연결 + hook 재초기화 비용이 0.
 *
 * 안전장치 — `VIBISUAL_PERSISTENT_CHILD=0` 으로 즉시 옛 동작(매 턴 fresh spawn) 복원.
 * claude 바이너리가 multi-turn stdin 을 지원 안 하는 버전이면 자식이 result 후 자연 종료 →
 * crash 복구 경로가 sub.sessionId 보존 → 다음 턴이 --resume 으로 자동 폴백.
 */
const PERSISTENT_CHILD_ENABLED = process.env['VIBISUAL_PERSISTENT_CHILD'] !== '0';

/** subagent 카운터 (라벨 생성용) */
let subCounter = 0;

/**
 * SubAgent 매니저 — 부모 에이전트별 독립 실행 세션 관리.
 *
 * 책임:
 * - subagent 생성/조회/상태 관리
 * - 명령 실행 (claude -p / --resume)
 * - 실행 완료 시 결과 수집 + 콜백
 */
/** 스트림 이벤트 버퍼 최대 크기 (subagent당) */
const MAX_STREAM_BUFFER = 500;

/** 이벤트 ID 생성 (나노초 수준 충돌 방지용 랜덤 suffix) */
function makeEventId(): string {
  return `se-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** stream-json 라인 → SubAgentStreamEvent 배열 변환.
 *  하나의 assistant 메시지는 thinking + text + tool_use 블록을 동시에 담을 수 있어 배열로 반환.
 *  §5.7 #23-2 v1.60 — Agent View JSONL tail 경로(`claudeAgentViewWatcher`)에서도 동일 함수 재사용
 *  하려고 export. JSONL 은 stream-json 의 상위셋(메타 라인 추가)이라 모르는 type 은 자연스럽게 [] 반환. */
export function parseStreamLine(
  obj: Record<string, unknown>,
  subAgentId: string,
  parentAgentId: string,
): SubAgentStreamEvent[] {
  const type = obj['type'] as string | undefined;
  if (!type) return [];

  const makeBase = (): Omit<SubAgentStreamEvent, 'eventType' | 'content'> => ({
    id: makeEventId(),
    subAgentId,
    parentAgentId,
    timestamp: Date.now(),
  });

  // assistant 메시지 — content[] 배열의 각 블록을 독립 이벤트로 방출
  if (type === 'assistant') {
    const msg = obj['message'] as Record<string, unknown> | undefined;
    const content = msg?.['content'];
    if (!Array.isArray(content)) return [];
    const events: SubAgentStreamEvent[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      const bt = b['type'] as string | undefined;
      if (bt === 'text' && typeof b['text'] === 'string' && b['text']) {
        events.push({ ...makeBase(), eventType: 'text', content: b['text'] as string });
      } else if (bt === 'thinking' && typeof b['thinking'] === 'string' && b['thinking']) {
        events.push({ ...makeBase(), eventType: 'thinking', content: b['thinking'] as string });
      } else if (bt === 'tool_use') {
        const name = (b['name'] ?? 'unknown') as string;
        const input = b['input'];
        const summary = input !== undefined ? JSON.stringify(input).slice(0, 300) : '';
        const toolUseId = typeof b['id'] === 'string' ? (b['id'] as string) : undefined;
        events.push({ ...makeBase(), eventType: 'tool_use', content: summary, toolName: name, toolUseId });
      }
    }
    return events;
  }

  // content_block_delta — 스트리밍 텍스트/사고 조각
  if (type === 'content_block_delta') {
    const delta = obj['delta'] as Record<string, unknown> | undefined;
    if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
      return [{ ...makeBase(), eventType: 'text', content: delta['text'] as string }];
    }
    if (delta?.['type'] === 'thinking_delta' && typeof delta['thinking'] === 'string') {
      return [{ ...makeBase(), eventType: 'thinking', content: delta['thinking'] as string }];
    }
    return [];
  }

  // 도구 사용 (stream-json의 최상위 tool_use — 드물지만 호환)
  if (type === 'tool_use') {
    const tool = obj['tool'] as Record<string, unknown> | undefined;
    const name = (tool?.['name'] ?? obj['name'] ?? 'unknown') as string;
    const input = tool?.['input'] ?? obj['input'];
    const summary = input !== undefined ? JSON.stringify(input).slice(0, 300) : '';
    return [{ ...makeBase(), eventType: 'tool_use', content: summary, toolName: name }];
  }

  // 도구 결과 — user 메시지(content 배열) 또는 최상위 tool_result 모두 커버
  if (type === 'user') {
    const msg = obj['message'] as Record<string, unknown> | undefined;
    const content = msg?.['content'];
    if (!Array.isArray(content)) return [];
    const events: SubAgentStreamEvent[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b['type'] === 'tool_result') {
        const bc = b['content'];
        const text = typeof bc === 'string'
          ? bc.slice(0, 500)
          : (Array.isArray(bc) ? JSON.stringify(bc).slice(0, 500) : '');
        events.push({ ...makeBase(), eventType: 'tool_result', content: text });
      }
    }
    return events;
  }
  if (type === 'tool_result') {
    const result = obj['tool_result'] as Record<string, unknown> | undefined;
    const content = result?.['content'];
    const text = typeof content === 'string'
      ? content.slice(0, 500)
      : (Array.isArray(content) ? JSON.stringify(content).slice(0, 500) : '');
    const name = (result?.['name'] ?? '') as string;
    return [{ ...makeBase(), eventType: 'tool_result', content: text, toolName: name || undefined }];
  }

  // 시스템 메시지 — hook_started/hook_response/init 같은 세션 메타는 UI 노이즈라 버린다.
  // session_id는 클라가 필요로 하지 않음(서버가 내부적으로 subAgent.sessionId에 저장).
  // notification: index.ts classifyNotification 이 이미 버블 뱃지 + 브라우저 알림으로 처리 → 본문 중복.
  // turn_duration: claudeAgentViewWatcher 의 "턴 종료" 내부 신호 → 사용자에게 의미 없음.
  // 나머지 subtype(task_started 등)은 [subtype] 형태로 보내고, 클라가 왼쪽 레일 노드로 렌더한다(SystemNode).
  if (type === 'system') {
    const subtype = obj['subtype'] as string | undefined;
    const noisy = new Set(['hook_started', 'hook_response', 'hook_completed', 'init', 'notification', 'turn_duration']);
    if (subtype && noisy.has(subtype)) return [];
    return [{ ...makeBase(), eventType: 'system', content: subtype ? `[${subtype}]` : 'system' }];
  }

  // 최종 결과 — UI에 다시 그리지 않는다(assistant text가 동일 본문을 이미 스트리밍으로 렌더).
  // cmd.result / sub.lastResult 저장은 child.close에서 stdout을 직접 파싱하므로 영향 없음.
  if (type === 'result') {
    return [];
  }

  return [];
}

export class SubAgentManager {
  /** agentId → SubAgent[] */
  private registry = new Map<string, SubAgent[]>();
  /** subagentId → SubAgent 빠른 조회 */
  private index = new Map<string, SubAgent>();
  /** agentId → archived SubAgent[] (탭 닫힌 이력) — 폴더 버튼 "다시 열기" 목록 소스.
   *  자식 프로세스는 kill, 레지스트리/index에서는 제거되지만 메타는 여기에 보존.
   *  disk stream buffer도 유지되어 restore 시 원 파일에서 다시 로드됨. */
  private archive = new Map<string, SubAgent[]>();
  /** 완료 콜백 (서버에서 broadcast 등 연결용) */
  private onComplete: (() => void) | null = null;
  /** 스트림 이벤트 콜백 */
  private onStreamEvent: ((event: SubAgentStreamEvent) => void) | null = null;
  /** sub.status 가 변하면 부모 에이전트 ID 와 함께 호출 — 커스텀 부모 버블의 active/completed 갱신용 */
  private onSubStatusChange: ((parentAgentId: string) => void) | null = null;
  /** v1.74 — "지금 즉시 체크포인트 저장" 요청. agent-view 매핑(agentViewShort/SessionId)을
   *  spawn 직후 영속화하기 위한 무조건 저장 훅. onSubStatusChange 는 status 변화가 없으면
   *  저장을 건너뛰어, 데몬 매핑이 디스크에 안 남는 윈도우(서버 크래시 시 reattach 불가)가 생긴다. */
  private onPersistNeeded: (() => void) | null = null;
  /** subagentId → 최근 스트림 이벤트 버퍼 (late-join용) */
  private streamBuffers = new Map<string, SubAgentStreamEvent[]>();
  /** subagentId → 실행 중인 자식 프로세스 (탭 닫기 시 종료용) */
  private runningChildren = new Map<string, ChildProcess>();
  /** §5.7 #23-2 v1.60 — subagentId → 진행 중인 agent-view watcher 메타.
   *  legacy path 의 runningChildren 와 짝. cancel/remove 시 `claude stop` + `detachWatcher` 발사. */
  private runningAgentViewWatchers = new Map<string, { short: string; sessionId: string }>();
  /** 사용자가 stop() 호출로 명시 중지한 subagentId — close 핸들러에서 '유저 중지' vs '에러' 를 구분해
   *  cmd.result 를 `[Stopped by user]` 로 채우고 sub.status 를 idle 로 복귀시키기 위함. */
  private stoppedByUser = new Set<string>();
  /** Persistent child — 자식이 turn 사이 idle(다음 stdin write 대기) 인가. true 면 reuse 가능.
   *  result 라인 도착 시 true, 새 stdin write 직전 false. */
  private persistentChildReady = new Map<string, boolean>();
  /** Persistent child — 의도적 종료 마킹(stop/remove/shutdownAll). close 핸들러에서 crash 와 구분하기 위함.
   *  마킹 없이 close 되면 crash 경로로 sub.sessionId 보존(다음 execute 가 --resume 으로 복구). */
  private intentionalKill = new Set<string>();
  /** Persistent child — 턴 사이에 살아남는 stdout line buffer. fresh spawn 에선 매번 새로 만들지만
   *  persistent child 는 같은 stdout 스트림이 여러 턴을 흘리므로 map 으로 보존. */
  private persistentLineBuf = new Map<string, string>();
  /** Persistent child — 현재 진행 중인 turn 의 cmd/turnCount/resultText/killed/maxTurns/parentCwd.
   *  fresh spawn 또는 reuse 시점에 새 값으로 set, result 라인 도착 시 delete. */
  private persistentInFlightCmd = new Map<string, {
    cmd: QueuedCommand;
    turnCount: number;
    resultText: string | undefined;
    killed: boolean;
    maxTurns: number;
    parentCwd: string;
  }>();
  /** 부모 에이전트 → 프로젝트 해석 콜백 (영속화 경로 계산용) */
  private projectResolver: AgentProjectResolver | null = null;

  setOnComplete(cb: () => void): void {
    this.onComplete = cb;
  }

  setOnStreamEvent(cb: (event: SubAgentStreamEvent) => void): void {
    this.onStreamEvent = cb;
  }

  setOnSubStatusChange(cb: (parentAgentId: string) => void): void {
    this.onSubStatusChange = cb;
  }

  setOnPersistNeeded(cb: () => void): void {
    this.onPersistNeeded = cb;
  }

  setProjectResolver(resolver: AgentProjectResolver): void {
    this.projectResolver = resolver;
  }

  /** 부모 에이전트의 sub-streams 디렉토리 해석. 프로젝트 미확정이면 null. */
  private resolveStreamDir(parentAgentId: string): string | null {
    const info = this.projectResolver?.(parentAgentId);
    if (!info) return null;
    return streamBufferStore.subStreamsDir(info, parentAgentId);
  }

  /** 특정 subagent의 버퍼된 스트림 이벤트 반환 (REST API용) */
  getStreamBuffer(subAgentId: string): SubAgentStreamEvent[] {
    return this.streamBuffers.get(subAgentId) ?? [];
  }

  /** 에이전트의 전체 subagent 스트림 버퍼 반환 */
  getStreamBuffersForAgent(agentId: string): Record<string, SubAgentStreamEvent[]> {
    const subs = this.registry.get(agentId) ?? [];
    const result: Record<string, SubAgentStreamEvent[]> = {};
    for (const sub of subs) {
      const buf = this.streamBuffers.get(sub.id);
      if (buf && buf.length > 0) result[sub.id] = buf;
    }
    return result;
  }

  /**
   * §5.3 #12-1 v1.96 — 외부에서 합성 system 라인을 sub stream 에 끼워 넣는 진입점.
   * 권한 승인 broker 가 사용자의 Allow/Deny 결정을 그 sub 의 stream 에 한 줄로 남길 때 호출.
   * 정규 emit 경로(`emitStreamEvent`)를 그대로 타서 버퍼·디스크·WS broadcast 가 일관되게 처리됨.
   */
  emitSystemMessage(parentAgentId: string, subAgentId: string, content: string): void {
    const event: SubAgentStreamEvent = {
      id: `sys-${randomUUID()}`,
      subAgentId,
      parentAgentId,
      timestamp: Date.now(),
      eventType: 'system',
      content,
    };
    this.emitStreamEvent(event);
  }

  /** 스트림 이벤트를 버퍼에 추가 + 디스크 append + 콜백 호출 */
  private emitStreamEvent(event: SubAgentStreamEvent): void {
    let buf = this.streamBuffers.get(event.subAgentId);
    if (!buf) { buf = []; this.streamBuffers.set(event.subAgentId, buf); }
    buf.push(event);
    if (buf.length > MAX_STREAM_BUFFER) buf.splice(0, buf.length - MAX_STREAM_BUFFER);
    // 거짓-완료 방지 — 스트림 이벤트가 흐르는 동안 sub 를 "살아있음" 으로 갱신.
    // lastActivityAt 은 execute() 시작·child.close 두 곳에서만 찍혀, 명령이 길어지면
    // idle sweep 이 staleness 만 보고 실행 중 sub 를 idle 로 강등 → 부모 버블이 거짓 completed.
    const liveSub = this.index.get(event.subAgentId);
    if (liveSub) liveSub.lastActivityAt = Date.now();
    // 디스크 영속화 — 프로젝트별 save 디렉토리 하위 sub-streams/<agentId>/<subId>.jsonl
    const dir = this.resolveStreamDir(event.parentAgentId);
    if (dir) streamBufferStore.appendEvent(dir, event);
    this.onStreamEvent?.(event);
  }

  /** 카운터 반환 (체크포인트 저장용) */
  getCounter(): number {
    return subCounter;
  }

  /** 체크포인트에서 복원 — SubAgent 메타 + 디스크 persist된 스트림 버퍼도 함께 로드.
   *  project 인자: 해당 체크포인트 소속 프로젝트. 프로젝트별 save 디렉토리에서 스트림 파일을 찾기 위해 필요.
   *  미지정(= 1.x 호환 호출)이면 스트림 복원을 건너뛰고 메타만 복원한다.
   *  archived 인자: 아카이브된(탭 닫힌) 서브에이전트 목록(폴더 버튼 소스). */
  restore(
    data: Record<string, SubAgent[]>,
    counter: number,
    project?: ProjectInfo,
    archived?: Record<string, SubAgent[]>,
  ): void {
    subCounter = counter;
    this.registry.clear();
    this.index.clear();
    this.streamBuffers.clear();
    this.archive.clear();
    let loadedBuffers = 0;
    for (const [agentId, subs] of Object.entries(data)) {
      // active 상태였던 건 idle로 복원 (프로세스는 이미 죽었으므로)
      const restored = subs.map((s) => ({
        ...s,
        status: (s.status === 'active' ? 'idle' : s.status) as SubAgent['status'],
      }));
      this.registry.set(agentId, restored);
      const dir = project ? streamBufferStore.subStreamsDir(project, agentId) : null;
      for (const s of restored) {
        this.index.set(s.id, s);
        if (dir) {
          const buf = streamBufferStore.loadBuffer(dir, s.id, MAX_STREAM_BUFFER);
          if (buf.length > 0) { this.streamBuffers.set(s.id, buf); loadedBuffers++; }
        }
      }
    }
    if (archived) {
      for (const [agentId, subs] of Object.entries(archived)) {
        if (subs.length === 0) continue;
        this.archive.set(agentId, subs.map((s) => ({ ...s, status: 'idle' as const })));
      }
    }
    logger.info(`SubAgents restored: ${this.index.size} sub(s), ${loadedBuffers} stream buffer(s), ${this.archive.size} archived agent(s)`);
  }

  /**
   * §5.7 #23-2 v1.60 — 서버 부팅 시 호출.
   * 영속화된 subagent 중 `agentViewShort` 가 있는 것들에 대해 supervisor roster 와 cross-reference 해서
   * 살아있으면 watcher 재부착하고 sub.status = 'active' 로 되돌린다.
   * 죽었으면 state.json 최종 상태를 마지막 결과로 흡수하고 sub.status 는 idle/error 로 마무리.
   *
   * 내부에서 `projectResolver` 로 부모 에이전트 → cwd 를 해석한다(인덱스에 set 되어 있어야 함).
   *
   * @param findExecutingCmd subAgentId → 그 sub 의 가장 최근 executing 명령. 없으면 null.
   *                         호출자(index.ts) 가 graphManager 의 commandQueues 를 스캔하는 함수 주입.
   *                         이게 있어야 terminal 시점에 cmd.status='completed' 로 마무리 가능.
   */
  async reattachAgentViewOnBoot(
    findExecutingCmd?: (subAgentId: string) => QueuedCommand | null,
  ): Promise<{ alive: number; gone: number; failed: number }> {
    const known = [...this.index.values()].filter((s) => !!s.agentViewShort && !!s.agentViewSessionId);
    if (known.length === 0) return { alive: 0, gone: 0, failed: 0 };

    const { reconcileOnBoot, readJobState } = await import('./claudeAgentViewService.js');
    const shorts = known.map((s) => s.agentViewShort!).filter(Boolean);
    const { alive } = reconcileOnBoot(shorts);
    const aliveShorts = new Set(alive.map((a) => a.short));

    let aliveCount = 0;
    let goneCount = 0;
    let failedCount = 0;

    // cmd 마무리 공용 헬퍼 — terminal state 와 sub 의 final result 로 cmd 봉합.
    const finalizeCmd = (sub: SubAgent, stateStr: string, resultText: string | undefined): void => {
      const cmd = findExecutingCmd?.(sub.id);
      if (!cmd) return;
      const isError = stateStr === 'failed';
      cmd.status = isError ? 'error' : 'completed';
      if (resultText) cmd.result = resultText;
    };

    for (const sub of known) {
      const short = sub.agentViewShort!;
      const sessionId = sub.agentViewSessionId!;
      const project = this.projectResolver?.(sub.parentAgentId);
      const cwd = project?.path ?? null;
      if (!cwd) { failedCount++; continue; }

      if (aliveShorts.has(short)) {
        // v1.60 fix: alive ≠ working. roster 에 있어도 state.json 의 state 가 'idle'/'done' 등
        // 비-working 이면 턴은 이미 끝난 것 — sub 를 'active' 로 부활시키면 부모 에이전트가
        // idle→active→completed 사이클을 타게 된다. state 가 'working' 또는 'needs-input' 일 때만
        // 실제 진행 중으로 보고 watcher 재부착. 그 외엔 gone 경로와 동일하게 cmd 봉합 + idle 마무리.
        const currentState = readJobState(short);
        const stateStr = String(currentState?.state || '');
        const stillWorking = stateStr === 'working' || stateStr === 'needs-input';

        if (stillWorking) {
          try {
            const jsonlPath = getSessionJsonlPath(cwd, sessionId);
            sub.status = 'active';
            this.runningAgentViewWatchers.set(sub.id, { short, sessionId });
            await attachWatcher({
              short,
              sessionId,
              jsonlPath,
              subAgentId: sub.id,
              parentAgentId: sub.parentAgentId,
              // 과거 라인은 이미 클라가 가지고 있으므로 새로 부착 후 추가분만 받는다.
              skipExisting: true,
              onEvents: (events) => { for (const e of events) this.emitStreamEvent(e); },
              onTerminal: (state) => {
                const ts = String(state.state || '');
                sub.status = ts === 'failed' ? 'error' : 'idle';
                sub.lastActivityAt = Date.now();
                // state.output.result 이 비어도 JSONL 의 마지막 assistant 메시지로 폴백.
                // turn_duration 발화 시점에 supervisor 가 output 을 아직 안 채웠을 수 있음.
                let resultText = (typeof state.output?.result === 'string' && state.output.result) || undefined;
                if (!resultText) {
                  try { resultText = readLastAssistantMessage(cwd, sessionId) ?? undefined; } catch { /* ignore */ }
                }
                if (resultText) sub.lastResult = resultText;
                finalizeCmd(sub, ts, resultText);
                this.runningAgentViewWatchers.delete(sub.id);
                void detachWatcher(short);
                this.onSubStatusChange?.(sub.parentAgentId);
                this.onComplete?.();
              },
            });
            aliveCount++;
            logger.info(`[agent-view reattach] sub=${sub.id} short=${short} state=${stateStr} → resumed (working)`);
          } catch (err) {
            failedCount++;
            logger.warn(`[agent-view reattach] sub=${sub.id} short=${short} failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          // alive + 비-working: 다운타임 중 턴 종료 — gone 경로와 동일하게 봉합.
          sub.status = stateStr === 'failed' ? 'error' : 'idle';
          sub.lastActivityAt = Date.now();
          let resultText = (typeof currentState?.output?.result === 'string' && currentState.output.result) || undefined;
          if (!resultText) {
            try { resultText = readLastAssistantMessage(cwd, sessionId) ?? undefined; } catch { /* ignore */ }
          }
          if (resultText && !sub.lastResult) sub.lastResult = resultText;
          finalizeCmd(sub, stateStr, resultText);
          // v1.62 fix — 다른 terminal 경로(stillWorking/finishTerminal/legacy)와 동일하게
          // 부모 커스텀 버블 재계산 + cmd 아카이브를 즉시 트리거. 누락 시 부모 배지가
          // 다음 10초 주기 sweep 까지 stale 상태로 남는다.
          this.onSubStatusChange?.(sub.parentAgentId);
          this.onComplete?.();
          aliveCount++;
          logger.info(`[agent-view reattach] sub=${sub.id} short=${short} state=${stateStr || 'unknown'} → finalized (turn ended during downtime)`);
        }
      } else {
        // supervisor 에서 사라짐 → state.json 최종 상태 흡수 + 해당 cmd 도 즉시 봉합.
        const finalState = readJobState(short);
        if (finalState) {
          const stateStr = String(finalState.state || '');
          sub.status = stateStr === 'failed' ? 'error' : 'idle';
          sub.lastActivityAt = Date.now();
          const resultText = (typeof finalState.output?.result === 'string' && finalState.output.result) || undefined;
          if (resultText && !sub.lastResult) sub.lastResult = resultText;
          finalizeCmd(sub, stateStr, resultText);
          // v1.62 fix — gone 경로도 부모 재계산 + 아카이브 즉시 트리거 (위 분기와 동일 이유).
          this.onSubStatusChange?.(sub.parentAgentId);
          this.onComplete?.();
        }
        goneCount++;
      }
    }

    if (aliveCount + goneCount > 0) {
      logger.info(`[agent-view reattach] alive=${aliveCount} gone=${goneCount} failed=${failedCount}`);
    }
    return { alive: aliveCount, gone: goneCount, failed: failedCount };
  }

  /** 부모 에이전트의 idle subagent 목록 */
  getIdleSubs(parentAgentId: string): SubAgent[] {
    const subs = this.registry.get(parentAgentId) ?? [];
    return subs.filter((s) => s.status === 'idle' || s.status === 'completed');
  }

  /** 부모 에이전트의 전체 subagent 목록 */
  getAllSubs(parentAgentId: string): SubAgent[] {
    return this.registry.get(parentAgentId) ?? [];
  }

  /** 전체 서브에이전트 flat 목록 (세션 ID 역조회용) */
  getAllSubsFlat(): SubAgent[] {
    return [...this.index.values()];
  }

  /** v1.33 — subAgentId 로 직접 조회. projectGraph reconcile 경로용. 없으면 undefined. */
  getSub(subAgentId: string): SubAgent | undefined {
    return this.index.get(subAgentId);
  }

  /** 이 sub 가 지금 실제로 실행 중인가 — 살아있는 자식 프로세스(legacy) 또는 agent-view watcher 보유.
   *  idle sweep 의 확정 진실(ground truth). lastActivityAt staleness 같은 추측이 이걸 이길 수 없다:
   *  "동작 중인 sub 를 거짓 완료/idle 처리" 의 단일 차단막. */
  isSubRunning(subId: string): boolean {
    return this.runningChildren.has(subId) || this.runningAgentViewWatchers.has(subId);
  }

  /** v1.77 (Direction A) — sessionId 가 Vibisual 이 스폰한 sub 의 세션이면 true.
   *  모든 훅 캡처 입구(session-start / liveness / processHookEvent)에서 이 술어로
   *  "managed 세션은 새 훅 버블 금지, 부모 커스텀 버블에 귀속" 을 강제 → 증식 차단.
   *  Vibisual 이 직접 스폰한 세션만 매칭하므로 사용자 인터랙티브 세션(나=Claude Code)은
   *  영향 없음. agentViewSessionId 도 포함(레거시 --bg 잔여 호환). */
  isManagedSession(sessionId: string): boolean {
    if (!sessionId) return false;
    for (const s of this.index.values()) {
      if (s.sessionId === sessionId || s.agentViewSessionId === sessionId) return true;
    }
    return false;
  }

  /** v1.77 (Direction A) — 커스텀 에이전트의 "정규(하나의) 대화 sub".
   *  이미 대화가 성립된 sub(sessionId 보유)를 최우선, 없으면 가장 오래된 sub.
   *  커스텀 에이전트는 명령마다 새 sub 를 만들지 않고 이 하나를 계속 재사용해야
   *  sub.sessionId 가 안정되고 `--resume` 연속성이 유지된다(없으면 undefined → 호출자 create). */
  getPrimarySub(parentAgentId: string): SubAgent | undefined {
    const subs = this.registry.get(parentAgentId) ?? [];
    if (subs.length === 0) return undefined;
    return subs.find((s) => !!s.sessionId) ?? subs[0];
  }

  /** 병합 복원 — 기존 데이터에 추가 (프로젝트별 체크포인트 병합용).
   *  project 인자: cp.project. 해당 프로젝트의 sub-streams 디렉토리에서만 스트림을 읽는다.
   *  archived 인자: 아카이브도 함께 병합(동일 parentAgentId가 아직 없을 때만). */
  mergeSnapshot(
    data: Record<string, SubAgent[]>,
    counter: number,
    project?: ProjectInfo,
    archived?: Record<string, SubAgent[]>,
  ): void {
    subCounter = Math.max(subCounter, counter);
    for (const [agentId, subs] of Object.entries(data)) {
      if (this.registry.has(agentId)) continue;
      const items = subs.map((s) => ({
        ...s,
        status: (s.status === 'active' ? 'idle' : s.status) as SubAgent['status'],
      }));
      this.registry.set(agentId, items);
      const dir = project ? streamBufferStore.subStreamsDir(project, agentId) : null;
      for (const s of items) {
        this.index.set(s.id, s);
        if (dir && !this.streamBuffers.has(s.id)) {
          const buf = streamBufferStore.loadBuffer(dir, s.id, MAX_STREAM_BUFFER);
          if (buf.length > 0) this.streamBuffers.set(s.id, buf);
        }
      }
    }
    if (archived) {
      for (const [agentId, subs] of Object.entries(archived)) {
        if (this.archive.has(agentId)) continue;
        if (subs.length === 0) continue;
        this.archive.set(agentId, subs.map((s) => ({ ...s, status: 'idle' as const })));
      }
    }
  }

  /**
   * 마지막 활동 시각으로부터 thresholdMs 초과한 active/completed subagent → idle 전환.
   * 변경된 sub.id 목록 반환.
   */
  sweepIdle(thresholdMs: number): string[] {
    const now = Date.now();
    const changed: string[] = [];
    for (const sub of this.index.values()) {
      if (sub.status !== 'active' && sub.status !== 'completed') continue;
      // 거짓-완료 방지 — 살아있는 자식 프로세스/watcher 를 가진 sub 는 절대 idle 로 강등하지 않는다.
      // lastActivityAt staleness 는 추측이고 isSubRunning 은 확정 진실 — 확정이 이긴다.
      // (이 가드가 없으면 5분 넘게 도는 명령이 idle 처리되고 recomputeCustomAgentStatus 가
      //  그 idle 을 부모 커스텀 버블의 'completed' 로 세탁 → 동작 중인데 완료 거짓보고.)
      if (this.isSubRunning(sub.id)) continue;
      if (now - sub.lastActivityAt > thresholdMs) {
        sub.status = 'idle';
        changed.push(sub.id);
      }
    }
    return changed;
  }

  /** 전체 subagent 목록 (agentId → SubAgent[]) — 스냅샷용 */
  getSnapshot(): Record<string, SubAgent[]> {
    const result: Record<string, SubAgent[]> = {};
    for (const [agentId, subs] of this.registry) {
      if (subs.length > 0) result[agentId] = subs.map((s) => ({ ...s }));
    }
    return result;
  }

  /** subagent 생성. preferredId 가 주어지면(클라이언트 optimistic create) 그 id 를 쓴다 — 충돌 시 무시. */
  create(parentAgentId: string, preferredId?: string): SubAgent {
    subCounter++;
    const id = preferredId && !this.index.has(preferredId)
      ? preferredId
      : `sub-${Date.now().toString(36)}`;
    const sub: SubAgent = {
      id,
      sessionId: '', // 첫 실행 시 Claude가 세션 생성
      label: `Sub #${subCounter}`,
      parentAgentId,
      status: 'idle',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    let list = this.registry.get(parentAgentId);
    if (!list) { list = []; this.registry.set(parentAgentId, list); }
    list.push(sub);
    this.index.set(sub.id, sub);

    logger.info(`SubAgent created: ${sub.id} (parent: ${parentAgentId})`);
    return sub;
  }

  /**
   * 서브에이전트 탭 닫기 — 소프트 아카이브.
   * 실행 중이면 SIGTERM으로 자식 종료 → 레지스트리/index/in-memory 스트림 버퍼에서 제거 →
   * 메타를 archive Map으로 이동. disk stream buffer는 유지(restore 시 재로드).
   * 제거(archive) 성공 시 true.
   */
  remove(subAgentId: string): boolean {
    const sub = this.index.get(subAgentId);
    if (!sub) return false;

    const child = this.runningChildren.get(subAgentId);
    if (child) {
      this.intentionalKill.add(subAgentId);
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
      this.runningChildren.delete(subAgentId);
    }
    // persistent maps cleanup — remove 시 sub 자체가 archive 되므로 turn-in-flight 추적도 폐기.
    this.persistentChildReady.delete(subAgentId);
    this.persistentLineBuf.delete(subAgentId);
    this.persistentInFlightCmd.delete(subAgentId);

    // §5.7 #23-2 v1.60 — agent-view 정리: supervisor 의 worker + worktree 도 함께 제거.
    const av = this.runningAgentViewWatchers.get(subAgentId);
    if (av) {
      void detachWatcher(av.short);
      void rmSession(av.short); // supervisor 측 worker + worktree cleanup
      this.runningAgentViewWatchers.delete(subAgentId);
    } else if (sub.agentViewShort) {
      // 진행 중이 아니지만 영속화된 short 가 있으면 supervisor 정리.
      void rmSession(sub.agentViewShort);
    }

    const list = this.registry.get(sub.parentAgentId);
    if (list) {
      const idx = list.findIndex((s) => s.id === subAgentId);
      if (idx >= 0) list.splice(idx, 1);
      if (list.length === 0) this.registry.delete(sub.parentAgentId);
    }
    this.index.delete(subAgentId);
    this.streamBuffers.delete(subAgentId);

    // archive로 이동 — sessionId·label·tokens 등 메타 보존
    const archived: SubAgent = { ...sub, status: 'idle', lastActivityAt: sub.lastActivityAt };
    let arch = this.archive.get(sub.parentAgentId);
    if (!arch) { arch = []; this.archive.set(sub.parentAgentId, arch); }
    arch.push(archived);

    logger.info(`SubAgent archived: ${subAgentId} (parent: ${sub.parentAgentId})`);
    return true;
  }

  /**
   * 실행 중인 서브에이전트를 사용자가 중지. 자식 프로세스 SIGTERM, sub/cmd 는 registry 에 그대로 둔다.
   * close 핸들러가 stoppedByUser 플래그를 보고 status/result 를 맞춘다.
   * 실행 중이 아니면 false (큐잉된 명령은 이 API 로 취소하지 않음 — CommandQueue 의 삭제 UI 로 처리).
   */
  stop(subAgentId: string): boolean {
    const sub = this.index.get(subAgentId);
    if (!sub) return false;

    // §5.7 #23-2 v1.60 — agent-view 경로: supervisor 에 stop 요청. finishTerminal 에서 후처리.
    const av = this.runningAgentViewWatchers.get(subAgentId);
    if (av) {
      this.stoppedByUser.add(subAgentId);
      void stopSession(av.short);
      logger.info(`SubAgent stop requested by user (agent-view): ${subAgentId} short=${av.short}`);
      return true;
    }

    // legacy 경로: SIGTERM. persistent child 의 경우에도 동일 — intentionalKill 마킹으로
    // close 핸들러가 crash 경로(sessionId 보존) 가 아닌 user-stop 경로로 분기한다.
    const child = this.runningChildren.get(subAgentId);
    if (!child) return false;
    this.stoppedByUser.add(subAgentId);
    this.intentionalKill.add(subAgentId);
    try { child.stdin?.end(); } catch { /* ignore */ }
    try { child.kill('SIGTERM'); } catch { /* already dead */ }
    logger.info(`SubAgent stop requested by user: ${subAgentId}`);
    return true;
  }

  /** 부모 에이전트의 archive 목록 — 폴더 팝업 소스. 최근 활동 순 정렬. */
  getArchived(parentAgentId: string): SubAgent[] {
    const list = this.archive.get(parentAgentId) ?? [];
    return [...list].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  /** archive → 레지스트리 복구. 스트림 버퍼는 disk에서 다시 로드.
   *  미존재 시 null, 이미 registry에 있으면(중복 호출) 기존 인스턴스 그대로 반환. */
  restoreFromArchive(subAgentId: string): SubAgent | null {
    // 이미 live면 그 인스턴스 반환
    const live = this.index.get(subAgentId);
    if (live) return live;

    // archive에서 찾기
    let found: SubAgent | null = null;
    let parentId = '';
    for (const [pid, list] of this.archive) {
      const idx = list.findIndex((s) => s.id === subAgentId);
      if (idx >= 0) {
        found = list[idx]!;
        parentId = pid;
        list.splice(idx, 1);
        if (list.length === 0) this.archive.delete(pid);
        break;
      }
    }
    if (!found) return null;

    // registry로 복귀
    let regList = this.registry.get(parentId);
    if (!regList) { regList = []; this.registry.set(parentId, regList); }
    const revived: SubAgent = { ...found, status: 'idle' };
    regList.push(revived);
    this.index.set(revived.id, revived);

    // 디스크 스트림 버퍼 재로드 — 프로젝트 해석 가능하면
    const info = this.projectResolver?.(parentId);
    if (info) {
      const dir = streamBufferStore.subStreamsDir(info, parentId);
      const buf = streamBufferStore.loadBuffer(dir, revived.id, MAX_STREAM_BUFFER);
      if (buf.length > 0) this.streamBuffers.set(revived.id, buf);
    }

    logger.info(`SubAgent restored from archive: ${revived.id} (parent: ${parentId})`);
    return revived;
  }

  /** 아카이브 전체 스냅샷 (체크포인트 저장용) */
  getArchiveSnapshot(): Record<string, SubAgent[]> {
    const result: Record<string, SubAgent[]> = {};
    for (const [agentId, subs] of this.archive) {
      if (subs.length > 0) result[agentId] = subs.map((s) => ({ ...s }));
    }
    return result;
  }

  /**
   * 서브에이전트 탭 순서 변경 — orderedIds가 현재 레지스트리 구성과 일치해야 함.
   * 일치(set 동등)하면 재배열 후 true, 아니면 무시하고 false.
   */
  reorder(parentAgentId: string, orderedIds: string[]): boolean {
    const list = this.registry.get(parentAgentId);
    if (!list || list.length !== orderedIds.length) return false;
    const currentIds = new Set(list.map((s) => s.id));
    if (!orderedIds.every((id) => currentIds.has(id))) return false;

    const byId = new Map(list.map((s) => [s.id, s] as const));
    const reordered = orderedIds.map((id) => byId.get(id)!);
    this.registry.set(parentAgentId, reordered);
    return true;
  }

  /** 명령 실행 — subagent 세션에서. agentConfig가 있으면 CLI 인자로 적용.
   *  v1.77 (Direction A): opts.customParent=true 면 `--bg`(Agent View) 경로를 절대 타지 않고
   *  legacy `claude -p` 로만 실행한다. 이유 — supervisor 가 spawn 마다 sessionId 를 새로
   *  발급해(=대화 연속성 상실 + 각 세션이 새 훅 버블로 증식) 커스텀 에이전트의 "하나의
   *  안정 세션" 목표와 구조적으로 충돌. legacy 는 sub.sessionId 를 첫 턴에 캡처해 이후
   *  `--resume <동일 id>` 로 같은 대화를 잇는다(서버 재시작해도 sub.sessionId 영속 → 재개). */
  execute(cmd: QueuedCommand, parentCwd: string, contextSummary: string, agentConfig?: AgentConfig, livePreamble?: string, opts?: { customParent?: boolean }): void {
    let sub: SubAgent | undefined;

    if (cmd.subAgentId) {
      sub = this.index.get(cmd.subAgentId);
    }
    if (!sub) {
      // agentId 추출 — cmd에서 역참조 필요하므로 외부에서 parentAgentId 전달
      // 이 경우 새 subagent를 create해야 함 — 호출자가 처리
      logger.warn(`SubAgent not found: ${cmd.subAgentId}`);
      return;
    }

    sub.status = 'active';
    sub.lastCommand = cmd.text;
    sub.lastActivityAt = Date.now();
    cmd.status = 'executing';
    this.onSubStatusChange?.(sub.parentAgentId);

    // 스테일 세션 자가복구 — 저장된 sessionId 에 해당하는 Claude CLI JSONL 이 사라졌으면
    // `--resume <id>` 가 exit 1 + "No conversation found" 로 확정 실패한다.
    // (원인: Claude Code 내부 세션 정리 / cwd 슬러그 매칭 실패 / worktree→master 이동 등.)
    // 여기서 sub.sessionId 를 비워 fresh-spawn 경로로 강제 전환 — 다음 프롬프트가 자동 정상화.
    if (sub.sessionId) {
      const jsonlPath = getSessionJsonlPath(parentCwd, sub.sessionId);
      if (!fs.existsSync(jsonlPath)) {
        logger.warn(`SubAgent ${sub.id} sessionId stale (${sub.sessionId}, JSONL missing: ${jsonlPath}) — clearing and re-spawning fresh`);
        sub.sessionId = '';
      }
    }

    // v1.33 — resume 경로에도 최신 "live preamble" (outbound 엣지 등 매 턴 바뀌는 정보) 은 prepend.
    // contextSummary 전체는 첫 스폰에서만, livePreamble 은 매 턴 반복 — 엣지 추가/삭제 즉시 반영.
    const preamble = (livePreamble ?? '').trim();
    const preambleBlock = preamble.length > 0 ? `${preamble}\n\n---\n\n` : '';
    // v1.35 — paste 첨부 이미지 경로를 프롬프트 말미에 append.
    // Claude CLI 는 argv 로 이미지 자체를 받지 않지만 경로를 읽어 Read 툴로 해석한다.
    // 경로는 개행으로 구분 — 공백 포함 경로(Windows 등)가 토큰 쪼개지는 것을 방지.
    const attachmentsSuffix = (cmd.attachments && cmd.attachments.length > 0)
      ? '\n\n' + cmd.attachments.join('\n')
      : '';
    const taskText = cmd.text + attachmentsSuffix;
    const prompt = sub.sessionId
      ? `${preambleBlock}${taskText}`
      : `${contextSummary}\n\n---\n\nTask: ${taskText}`;

    // AgentConfig → CLI 인자 변환
    const configArgs = agentConfig ? buildConfigArgs(agentConfig) : [];

    // ──────────────────────────────────────────────────────────────
    // maxTurns 턴 제한 — 무한루프 방지 안전장치
    //
    // - 각 execute() 호출(= 프롬프트 명령 1건)마다 독립적인 turnCount 생성
    // - 서브에이전트가 여러 개여도 각자 execute()가 호출되므로 카운트 간섭 없음
    // - assistant 메시지 = 1턴
    // - maxTurns > 0 일 때만 제한 — turnCount >= maxTurns 도달 시 강제 종료(legacy: SIGTERM / agent-view: `claude stop`)
    // - config 없으면 DEFAULT_AGENT_CONFIG.maxTurns(0=무제한) 사용. 사용자가 양수 지정 시에만 캡.
    // ──────────────────────────────────────────────────────────────
    const maxTurns = agentConfig?.maxTurns ?? DEFAULT_AGENT_CONFIG.maxTurns ?? 0;

    // v1.77 (Direction A) — 커스텀 에이전트는 Agent View 게이트를 건너뛰고 무조건 legacy.
    // (supervisor sessionId 회전 → 증식·연속성 상실. 위 docstring 참조.)
    if (opts?.customParent) {
      this._executeViaLegacy(cmd, sub!, parentCwd, prompt, configArgs, maxTurns);
      return;
    }

    // §5.7 #23-2 v1.60 — Agent View 게이트 (커스텀이 아닌 SubAgent/Team/Pipeline 전용).
    // 활성화 시 `claude --bg` 로 dispatch 후 supervisor 가 자식을 보유 → 서버 재시작 시에도 turn 보존.
    // 게이트는 캐시되므로 매 execute() 마다 호출해도 비싸지 않음(60s memoized).
    void isAgentViewEnabled().then((gate) => {
      if (gate.enabled) {
        void this._executeViaAgentView(cmd, sub!, parentCwd, prompt, configArgs, maxTurns);
      } else {
        this._executeViaLegacy(cmd, sub!, parentCwd, prompt, configArgs, maxTurns);
      }
    }).catch((err) => {
      logger.warn(`SubAgent ${sub!.id} agent-view gate check failed: ${err instanceof Error ? err.message : String(err)} — falling back to legacy`);
      this._executeViaLegacy(cmd, sub!, parentCwd, prompt, configArgs, maxTurns);
    });
  }

  /**
   * §5.7 #23-2 v1.60 — Agent View 경로: `claude --bg` dispatch + JSONL watcher.
   * supervisor 가 자식 process 를 보유하므로 Vibisual 서버 재시작 시점에도 turn 이 끊기지 않는다.
   */
  private async _executeViaAgentView(
    cmd: QueuedCommand,
    sub: SubAgent,
    parentCwd: string,
    prompt: string,
    configArgs: string[],
    maxTurns: number,
  ): Promise<void> {
    let turnCount = 0;
    let killed = false;
    let terminalProcessed = false;

    try {
      // resume 모드: 이미 sessionId 가 있으면 같은 conversation 이어붙이기.
      // `--bg --resume <id>` 는 supervisor 가 사용자에게 안내한 정식 경로(docs: "use --resume <id> to continue").
      const args = sub.sessionId
        ? ['--resume', sub.sessionId, ...configArgs]
        : [...configArgs];

      logger.info(`SubAgent ${sub.id} agent-view dispatch: "${cmd.text.slice(0, 50)}..."${args.length > 0 ? ` [args: ${args.join(' ')}]` : ''}`);

      const { short, sessionId, jsonlPath } = await spawnBackground(prompt, args, parentCwd, {
        VIBISUAL_SUBAGENT_ID: sub.id,
        VIBISUAL_PARENT_AGENT_ID: sub.parentAgentId,
      });

      sub.sessionId = sessionId;
      sub.agentViewShort = short;
      sub.agentViewSessionId = sessionId;
      this.runningAgentViewWatchers.set(sub.id, { short, sessionId });
      logger.info(`SubAgent ${sub.id} agent-view spawned: short=${short} sessionId=${sessionId}`);
      // v1.74 — 매핑을 **즉시** 영속화. 이게 없으면 spawn 후 다음 (무관한) 체크포인트
      // 트리거 전에 서버가 죽을 때 agentViewShort/SessionId 가 디스크에 안 남아
      // reattachAgentViewOnBoot 가 supervisor 의 살아있는 워커를 못 찾고 세션이 유실된다
      // (= 사용자 보고 "재시작 시 세션 먹통/연속성 없음" 의 근본 원인).
      this.onPersistNeeded?.();

      const finishTerminal = async (state: AgentViewJobState): Promise<void> => {
        if (terminalProcessed) return;
        terminalProcessed = true;

        // 결과 텍스트 — state.json output.result 우선, 폴백으로 JSONL last assistant.
        let resultText: string | undefined =
          (typeof state.output?.result === 'string' && state.output.result) || undefined;
        if (!resultText && sub.sessionId) {
          resultText = readLastAssistantMessage(parentCwd, sub.sessionId) ?? undefined;
        }
        if (resultText) {
          sub.lastResult = resultText;
          cmd.result = resultText;
        }

        // 토큰 집계 — 기존 readSessionTokenData 그대로 (같은 JSONL).
        try {
          const tokenData = sub.sessionId ? readSessionTokenData(parentCwd, sub.sessionId) : null;
          if (tokenData && tokenData.turns.length > 0) {
            const prevInput = sub.totalInputTokens ?? 0;
            const prevOutput = sub.totalOutputTokens ?? 0;
            let totalIn = 0;
            let totalOut = 0;
            for (const t of tokenData.turns) {
              totalIn += t.inputTokens + t.cacheReadTokens + t.cacheCreateTokens;
              totalOut += t.outputTokens;
            }
            sub.totalInputTokens = totalIn;
            sub.totalOutputTokens = totalOut;
            cmd.inputTokens = Math.max(0, totalIn - prevInput);
            cmd.outputTokens = Math.max(0, totalOut - prevOutput);
            const lastTurn = tokenData.turns[tokenData.turns.length - 1];
            if (lastTurn?.model) sub.modelName = lastTurn.model;
            logger.info(`SubAgent ${sub.id} agent-view tokens: in=${totalIn} out=${totalOut} delta_in=${cmd.inputTokens} delta_out=${cmd.outputTokens}`);
          }
        } catch (err) {
          logger.debug(`SubAgent ${sub.id} agent-view token read failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        // 상태 산정 — legacy 와 동일한 분류(user stop / killed / failed / done).
        const userStopped = this.stoppedByUser.delete(sub.id);
        const stateStr = String(state.state || '');
        const isFailed = stateStr === 'failed';
        sub.status = userStopped ? 'idle' : ((killed || isFailed) ? 'error' : 'idle');
        sub.lastActivityAt = Date.now();
        cmd.status = userStopped ? 'completed' : (killed ? 'error' : (isFailed ? 'error' : 'completed'));
        if (userStopped) {
          cmd.result = `[Stopped by user]${resultText ? `\n\n${resultText}` : ''}`;
        } else if (killed) {
          cmd.result = `[Stopped: max turns reached (${turnCount}/${maxTurns})]${resultText ? `\n\n${resultText}` : ''}`;
        }

        logger.info(`SubAgent ${sub.id} agent-view finished (state=${stateStr}, killed=${killed}, userStopped=${userStopped}, turns=${turnCount}, result=${resultText ? 'yes' : 'no'})`);

        this.runningAgentViewWatchers.delete(sub.id);
        try { await detachWatcher(short); } catch { /* ignore */ }
        this.onSubStatusChange?.(sub.parentAgentId);
        this.onComplete?.();
      };

      await attachWatcher({
        short,
        sessionId,
        jsonlPath,
        subAgentId: sub.id,
        parentAgentId: sub.parentAgentId,
        onEvents: (events) => {
          for (const evt of events) this.emitStreamEvent(evt);
        },
        onLine: (obj) => {
          // assistant 메시지 = 1턴. maxTurns 초과 시 supervisor 에 stop 발사.
          if (obj['type'] === 'assistant' && !killed) {
            turnCount++;
            if (maxTurns > 0 && turnCount >= maxTurns) {
              killed = true;
              void stopSession(short);
              logger.warn(`SubAgent ${sub.id} agent-view killed: max turns reached (${turnCount}/${maxTurns})`);
            }
          }
        },
        onTerminal: (state) => { void finishTerminal(state); },
      });
    } catch (err) {
      logger.warn(`SubAgent ${sub.id} agent-view dispatch failed: ${err instanceof Error ? err.message : String(err)} — falling back to legacy`);
      // dispatch 자체 실패 시 (예: supervisor down) legacy path 로 폴백.
      this._executeViaLegacy(cmd, sub, parentCwd, prompt, configArgs, maxTurns);
    }
  }

  /**
   * §5.7 #23-2 v1.60 — Legacy `claude -p` 경로(stream-json over stdin).
   *
   * v2.x persistent-child 모델 — `VIBISUAL_PERSISTENT_CHILD` 가 켜져 있고 sub.sessionId 가 있으면
   * 매 턴 fresh spawn 대신 sub 당 자식 1개를 long-lived 로 유지하고 stdin 으로 다음 턴만 추가.
   *   • 1st turn (no sessionId)            : legacy (--print) — sessionId 캡처 후 자식 종료.
   *   • 2nd turn (sessionId, no live child): persistent fresh spawn (--resume, no --print).
   *   • 3rd+ turn (live ready child)       : reuse — stdin 으로 prompt 만 write, return.
   *
   * 안전장치: VIBISUAL_PERSISTENT_CHILD=0 → 매 턴 fresh spawn 으로 즉시 폴백.
   * 크래시 복구: persistent child 가 의도치 않게 종료되면 sub.sessionId 보존 → 다음 execute 가
   * 자동으로 fresh persistent spawn 으로 복구. claude 바이너리가 multi-turn stdin 미지원이면
   * 자연히 이 경로를 타게 됨(기능적으로는 옛 매 턴 spawn 과 동등).
   */
  private _executeViaLegacy(
    cmd: QueuedCommand,
    sub: SubAgent,
    parentCwd: string,
    prompt: string,
    configArgs: string[],
    maxTurns: number,
  ): void {
    const usePersistent = PERSISTENT_CHILD_ENABLED && !!sub.sessionId;

    // ─── REUSE PATH ─────────────────────────────────────────────────────
    // 살아있는 자식 + ready=true 면 fresh spawn 없이 stdin write 만으로 다음 턴 시작.
    // node boot + claude init + JSONL 재로드 + MCP 재연결 + hook 재초기화 비용 = 0.
    const existingChild = this.runningChildren.get(sub.id);
    if (usePersistent && existingChild && this.persistentChildReady.get(sub.id) === true) {
      this.persistentChildReady.set(sub.id, false);
      this.persistentInFlightCmd.set(sub.id, {
        cmd, turnCount: 0, resultText: undefined, killed: false, maxTurns, parentCwd,
      });
      try {
        const inputLine = JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: prompt }] },
        }) + '\n';
        existingChild.stdin?.write(inputLine, 'utf8');
        logger.info(`SubAgent ${sub.id} persistent child REUSED — sending next prompt via stdin (no fresh spawn)`);
      } catch (err) {
        // stdin write 실패 — child 가 이미 죽었을 수 있음. close 핸들러가 정리할 것.
        logger.warn(`SubAgent ${sub.id} persistent stdin write failed: ${err instanceof Error ? err.message : String(err)} — child may have died, will respawn next turn`);
        this.persistentInFlightCmd.delete(sub.id);
        this.persistentChildReady.delete(sub.id);
        cmd.status = 'error';
        this.onSubStatusChange?.(sub.parentAgentId);
        this.onComplete?.();
      }
      return;
    }

    // ─── FRESH SPAWN ────────────────────────────────────────────────────
    // v1.33 Windows 인코딩 픽스 — 기존엔 prompt 를 argv(-p <prompt>) 로 넘겼으나 claude.exe 가
    // Windows 에서 argv 를 OEM(cp949) 로 해석하는 경로가 있어 한글/CJK 가 mojibake 됨.
    // 대신 `--input-format stream-json` 으로 stdin 에 user 메시지를 UTF-8 로 써 넘기면 argv 경로를
    // 완전히 우회해 UTF-8 가 보존된다. output-format 은 기존처럼 stream-json 사용.
    //
    // persistent: --print 없음. 자식이 result 후 stdin 대기 상태로 살아있어 다음 턴 재사용 가능.
    // legacy:     기존대로 --print 포함. 자식이 result 후 자연 종료.
    const args = usePersistent
      ? ['--resume', sub.sessionId, ...configArgs, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']
      : (sub.sessionId
          ? ['--resume', sub.sessionId, '--print', ...configArgs, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']
          : ['--print', ...configArgs, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']);

    logger.info(`SubAgent ${sub.id} ${usePersistent ? 'persistent spawning' : 'legacy executing'}: "${cmd.text.slice(0, 50)}..."${configArgs.length > 0 ? ` [config: ${configArgs.join(' ')}]` : ''}`);

    try {
      const child = spawn(CLAUDE_BIN, args, {
        cwd: parentCwd,
        stdio: ['pipe', 'pipe', 'pipe'], // v1.33 — stdin 으로 prompt 주입하려 pipe.
        shell: false,
        env: {
          ...process.env,
          LANG: 'en_US.UTF-8',
          LC_ALL: 'en_US.UTF-8',
          PYTHONIOENCODING: 'utf-8',
          // §5.3 #12-1 v1.43 — 글로벌 PreToolUse 훅이 Vibisual 관할 세션을 식별하기 위한 마커.
          // 세션ID 가 아직 claude 쪽에 발급되기 전(첫 실행) 에도 구분 가능.
          VIBISUAL_SUBAGENT_ID: sub.id,
          VIBISUAL_PARENT_AGENT_ID: sub.parentAgentId,
        },
      });
      this.runningChildren.set(sub.id, child);

      if (usePersistent) {
        this.persistentChildReady.set(sub.id, false);
        this.persistentLineBuf.set(sub.id, '');
        this.persistentInFlightCmd.set(sub.id, {
          cmd, turnCount: 0, resultText: undefined, killed: false, maxTurns, parentCwd,
        });
      }

      // v1.33 — prompt 를 stream-json 한 줄로 stdin 에 UTF-8 바이트로 write.
      // content 를 text block 배열로 감싸서 보내면 Claude 가 단일 user 턴으로 처리.
      // legacy: stdin.end() 로 더 이상 입력 없음을 통지 → Claude 가 응답 후 종료.
      // persistent: stdin 을 열어둔다 → 자식이 result 후 다음 user 라인을 기다리며 살아있음.
      try {
        const inputLine = JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: prompt }],
          },
        }) + '\n';
        child.stdin?.setDefaultEncoding('utf8');
        child.stdin?.write(inputLine, 'utf8');
        if (!usePersistent) child.stdin?.end();
      } catch (err) {
        logger.warn(`SubAgent ${sub.id} stdin write failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Legacy 경로 전용 closure state — persistent 경로는 persistentInFlightCmd 맵 사용.
      let stdout = '';
      let turnCount = 0;
      let killed = false;
      let lineBuf = '';

      child.stdout?.on('data', (chunk: Buffer) => {
        // v1.33 — 명시적 UTF-8 디코딩. 기본 toString() 은 보통 utf8 이지만 플랫폼/Node 버전에
        // 따라 OEM fallback 될 수 있어 안전하게 고정.
        const text = chunk.toString('utf8');

        // ── PERSISTENT 경로: 맵 기반 line 버퍼 + result 라인 인라인 검출 ──
        if (usePersistent) {
          let buf = this.persistentLineBuf.get(sub!.id) ?? '';
          buf += text;
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          this.persistentLineBuf.set(sub!.id, buf);
          for (const line of lines) {
            this._handlePersistentStdoutLine(line, sub!, child);
          }
          return;
        }

        // ── LEGACY 경로: closure 기반 ──
        stdout += text;
        lineBuf += text;
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop() ?? ''; // 마지막 불완전 라인은 다음 chunk에서 이어서 파싱
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            // 첫 system/init 라인에서 session_id 즉시 캡처.
            if (!sub!.sessionId && obj['type'] === 'system' && typeof obj['session_id'] === 'string') {
              sub!.sessionId = obj['session_id'] as string;
              logger.info(`SubAgent ${sub!.id} session assigned (stream): ${sub!.sessionId}`);
            }
            // type:"assistant" = Claude가 응답한 1턴 (도구 호출 포함)
            if (obj['type'] === 'assistant') {
              turnCount++;
              if (maxTurns > 0 && turnCount >= maxTurns && !killed) {
                killed = true;
                this.intentionalKill.add(sub!.id);
                child.kill('SIGTERM');
                logger.warn(`SubAgent ${sub!.id} killed: max turns reached (${turnCount}/${maxTurns})`);
              }
            }
            // 스트림 이벤트 파싱 + 클라이언트 중계 (한 라인이 여러 블록 가능)
            const streamEvts = parseStreamLine(obj, sub!.id, sub!.parentAgentId);
            for (const evt of streamEvts) this.emitStreamEvent(evt);
          } catch { /* 불완전 JSON — 다음 라인에서 처리 */ }
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        logger.debug(`SubAgent ${sub!.id} stderr: ${chunk.toString().slice(0, 200)}`);
      });

      child.on('error', (err) => {
        logger.warn(`SubAgent ${sub!.id} spawn error: ${err.message}`);
        sub!.status = 'error';
        cmd.status = 'error';
        this.onComplete?.();
      });

      child.on('close', (code) => {
        // ── PERSISTENT 경로: intentional vs crash 분기 ──
        if (usePersistent) {
          const wasIntentional = this.intentionalKill.delete(sub!.id);
          this.runningChildren.delete(sub!.id);
          this.persistentChildReady.delete(sub!.id);
          this.persistentLineBuf.delete(sub!.id);
          const inFlight = this.persistentInFlightCmd.get(sub!.id);
          this.persistentInFlightCmd.delete(sub!.id);

          if (!wasIntentional) {
            // 크래시 — sub.sessionId 는 의도적으로 유지(다음 execute 가 --resume 으로 자연 복구).
            logger.warn(`SubAgent ${sub!.id} persistent child exited unexpectedly (code=${code}) — preserving sessionId for resume on next turn`);
            if (inFlight) {
              inFlight.cmd.status = 'error';
              inFlight.cmd.result = `[Persistent child crashed (code=${code}); retry on next turn]`;
              sub!.status = 'error';
              sub!.lastActivityAt = Date.now();
              this.onSubStatusChange?.(sub!.parentAgentId);
              this.onComplete?.();
            }
            return;
          }

          // 의도된 종료(stop/remove/shutdown) — in-flight 가 있으면 finalize, 없으면 단순 정리.
          if (inFlight) {
            this._finalizeLegacyCommand(sub!, inFlight.cmd, inFlight.parentCwd, undefined, inFlight.turnCount, inFlight.killed, inFlight.maxTurns, code, '', /*deleteRunningChild=*/false);
          } else {
            sub!.status = 'idle';
            sub!.lastActivityAt = Date.now();
            this.onSubStatusChange?.(sub!.parentAgentId);
            this.onComplete?.();
          }
          return;
        }

        // ── LEGACY 경로: 기존 close 핸들러 ──
        this._finalizeLegacyCommand(sub!, cmd, parentCwd, undefined, turnCount, killed, maxTurns, code, stdout, /*deleteRunningChild=*/true);
      });
    } catch (err) {
      logger.warn(`SubAgent ${sub!.id} spawn failed: ${err instanceof Error ? err.message : String(err)}`);
      sub.status = 'error';
      cmd.status = 'error';
      this.onSubStatusChange?.(sub.parentAgentId);
      this.onComplete?.();
    }
  }

  /**
   * Persistent child stdout 라인 핸들러.
   * `result` 라인 도착이 turn 의 종료 신호 — child 는 죽이지 않고 다음 stdin write 대기 상태로 둔다.
   *
   * 순서 함정: `_finalizeLegacyCommand` → `onComplete` → `processNextCommand` → `execute` 가 동기 호출 체인이라,
   * 다음 execute 의 reuse 분기가 `persistentChildReady === true` 를 보려면 finalize **전** 에 ready=true 가
   * set 되어 있어야 한다. 그 다음 턴이 이미 큐에 쌓여 있으면 그 자리에서 stdin write 로 즉시 reuse 됨.
   */
  private _handlePersistentStdoutLine(line: string, sub: SubAgent, child: ChildProcess): void {
    if (!line.trim()) return;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(line) as Record<string, unknown>; } catch { return; }

    // session_id 캡처 — 첫 system 라인. persistent 경로는 --resume 이라 이미 sub.sessionId 가 있지만,
    // claude 가 새 session 으로 회전시키는 케이스가 있으면 따라간다.
    if (!sub.sessionId && obj['type'] === 'system' && typeof obj['session_id'] === 'string') {
      sub.sessionId = obj['session_id'] as string;
      logger.info(`SubAgent ${sub.id} session assigned (persistent stream): ${sub.sessionId}`);
    }

    const inFlight = this.persistentInFlightCmd.get(sub.id);

    // assistant 턴 카운트 + maxTurns 가드.
    if (obj['type'] === 'assistant' && inFlight && !inFlight.killed) {
      inFlight.turnCount++;
      if (inFlight.maxTurns > 0 && inFlight.turnCount >= inFlight.maxTurns) {
        inFlight.killed = true;
        this.intentionalKill.add(sub.id);
        try { child.kill('SIGTERM'); } catch { /* already dead */ }
        logger.warn(`SubAgent ${sub.id} killed: max turns reached (${inFlight.turnCount}/${inFlight.maxTurns})`);
      }
    }

    // 스트림 이벤트 — 클라 중계.
    const streamEvts = parseStreamLine(obj, sub.id, sub.parentAgentId);
    for (const evt of streamEvts) this.emitStreamEvent(evt);

    // ── CRITICAL: result 라인 = turn 종료. child 는 살려둔다. ──
    if (obj['type'] === 'result' && inFlight) {
      const resultText: string | undefined =
        typeof obj['result'] === 'string' ? (obj['result'] as string) : undefined;
      if (typeof obj['total_input_tokens'] === 'number') sub.totalInputTokens = obj['total_input_tokens'] as number;
      if (typeof obj['total_output_tokens'] === 'number') sub.totalOutputTokens = obj['total_output_tokens'] as number;

      // ORDER MATTERS — 함정 주석 참조.
      // 1) line 버퍼 리셋 (이 줄 이후의 다음 턴 chunk 가 들어와도 깨끗히 시작).
      this.persistentLineBuf.set(sub.id, '');
      // 2) ready=true 를 finalize **전** 에 set. finalize 가 onComplete → processNextCommand → execute 를 동기 호출
      //    하므로, ready=true 가 그 호출 전에 set 안 되면 reuse 분기가 영영 안 탄다.
      this.persistentChildReady.set(sub.id, true);
      // 3) in-flight 폐기 — 다음 턴이 fresh value 로 set.
      this.persistentInFlightCmd.delete(sub.id);
      // 4) finalize — child.kill / stdin.end 호출 ❌ (자식 살려둠).
      logger.info(`SubAgent ${sub.id} persistent result detected (turns=${inFlight.turnCount}) — finalizing turn, child stays alive`);
      this._finalizeLegacyCommand(sub, inFlight.cmd, inFlight.parentCwd, resultText, inFlight.turnCount, inFlight.killed, inFlight.maxTurns, 0, '', /*deleteRunningChild=*/false);
    }
  }

  /**
   * turn 종료 시 cmd/sub 마무리 + 콜백 트리거.
   * legacy(child 종료 후)·persistent(child 살림) 양쪽이 공유 — `deleteRunningChild` 가 분기.
   *
   * @param stdout  legacy 경로는 누적 stdout 을 줘서 init/result 라인을 재파싱하게 한다.
   *                persistent 경로는 result 라인을 이미 인라인 처리했으므로 빈 문자열 + resultText 미리 채워서 호출.
   */
  private _finalizeLegacyCommand(
    sub: SubAgent,
    cmd: QueuedCommand,
    parentCwd: string,
    initialResultText: string | undefined,
    turnCount: number,
    killed: boolean,
    maxTurns: number,
    code: number | null,
    stdout: string,
    deleteRunningChild: boolean,
  ): void {
    let resultText = initialResultText;

    // Legacy close 경로: stdout 누적분에서 session_id + result + tokens 재파싱.
    if (stdout) {
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          if (obj['type'] === 'system' && typeof obj['session_id'] === 'string' && !sub.sessionId) {
            sub.sessionId = obj['session_id'];
            logger.info(`SubAgent ${sub.id} session assigned: ${sub.sessionId}`);
          }
          if (obj['type'] === 'result' && typeof obj['result'] === 'string' && !resultText) {
            resultText = obj['result'];
            if (typeof obj['total_input_tokens'] === 'number') sub.totalInputTokens = obj['total_input_tokens'] as number;
            if (typeof obj['total_output_tokens'] === 'number') sub.totalOutputTokens = obj['total_output_tokens'] as number;
          }
        } catch { /* skip non-json */ }
      }
    }

    // stdout에서 못 읽으면 JSONL 폴백.
    if (!resultText && sub.sessionId) {
      resultText = readLastAssistantMessage(parentCwd, sub.sessionId) ?? undefined;
    }

    if (resultText) {
      sub.lastResult = resultText;
      cmd.result = resultText;
    }

    // 토큰 사용량 — JSONL 누적 read (persistent 경로도 매 턴 누적 갱신 필요).
    if (sub.sessionId) {
      try {
        const tokenData = readSessionTokenData(parentCwd, sub.sessionId);
        if (tokenData && tokenData.turns.length > 0) {
          const prevInput = sub.totalInputTokens ?? 0;
          const prevOutput = sub.totalOutputTokens ?? 0;
          let totalIn = 0;
          let totalOut = 0;
          for (const t of tokenData.turns) {
            totalIn += t.inputTokens + t.cacheReadTokens + t.cacheCreateTokens;
            totalOut += t.outputTokens;
          }
          sub.totalInputTokens = totalIn;
          sub.totalOutputTokens = totalOut;
          cmd.inputTokens = Math.max(0, totalIn - prevInput);
          cmd.outputTokens = Math.max(0, totalOut - prevOutput);
          const lastTurn = tokenData.turns[tokenData.turns.length - 1];
          if (lastTurn?.model) sub.modelName = lastTurn.model;
          logger.info(`SubAgent ${sub.id} tokens: in=${totalIn}, out=${totalOut}, delta_in=${cmd.inputTokens}, delta_out=${cmd.outputTokens}`);
        }
      } catch (err) {
        logger.debug(`SubAgent ${sub.id} token read failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const userStopped = this.stoppedByUser.delete(sub.id);
    const isErr = killed || (code !== null && code !== 0);
    sub.status = userStopped ? 'idle' : (isErr ? 'error' : 'idle');
    sub.lastActivityAt = Date.now();
    cmd.status = userStopped ? 'completed' : (killed ? 'error' : ((code === null || code === 0) ? 'completed' : 'error'));
    if (userStopped) cmd.result = `[Stopped by user]${resultText ? `\n\n${resultText}` : ''}`;
    else if (killed) cmd.result = `[Stopped: max turns reached (${turnCount}/${maxTurns})]${resultText ? `\n\n${resultText}` : ''}`;

    logger.info(`SubAgent ${sub.id} finished (code=${code === null ? 'persistent' : code}, killed=${killed}, userStopped=${userStopped}, turns=${turnCount}, result=${resultText ? 'yes' : 'no'})`);
    if (deleteRunningChild) this.runningChildren.delete(sub.id);
    this.onSubStatusChange?.(sub.parentAgentId);
    this.onComplete?.();
  }

  /**
   * 앱 종료 시(Electron before-quit) 모든 persistent child 를 깨끗이 종료.
   * intentionalKill 마킹 → stdin.end → SIGTERM → 2초 후 SIGKILL fallback.
   */
  async shutdownAllPersistentChildren(): Promise<void> {
    if (this.runningChildren.size === 0) return;
    const ids = [...this.runningChildren.keys()];
    logger.info(`shutdownAllPersistentChildren: terminating ${ids.length} child(ren) [${ids.join(', ')}]`);
    const promises: Promise<void>[] = [];
    for (const [subId, child] of this.runningChildren) {
      this.intentionalKill.add(subId);
      try { child.stdin?.end(); } catch { /* ignore */ }
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
      promises.push(new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* */ }
          resolve();
        }, 2000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      }));
    }
    await Promise.all(promises);
    logger.info('shutdownAllPersistentChildren: done');
  }

}

export const subAgentManager = new SubAgentManager();
