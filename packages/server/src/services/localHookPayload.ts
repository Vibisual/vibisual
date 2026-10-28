/**
 * localHookPayload.ts — §5.19 (H) 로컬 도구 이벤트 → 훅 페이로드 변환 **한 곳**(방출기와 시험이 함께 쓴다).
 * 러너는 페이로드를 짓지 않는다(지으면 러너가 그래프 스키마를 알게 된다).
 * 로컬 도구 스키마는 파일 인자를 `path`(루트 상대)라 부르고, 그래프는 `file_path` 에서 꺼낸다(`projectGraph` 의 `FILE_PATH_KEYS`).
 * 이름이 어긋나면 추출이 조용히 `null` 이 되어 노드·수정 기록·에이전트-파일 엣지가 오류 없이 안 생긴다(2026-08-24 실측: 원장 16줄, 파일 노드 0개).
 * 이름만 바꾸지 않고 절대 경로로 올려서 넘긴다(`absolutize` 참고).
 */
import path from 'node:path';
import type { HookEventPayload } from '@vibisual/shared';
import type { LocalHookToolEvent } from './localRunner.js';

/**
 * 그래프가 `file_path` 에서 경로를 꺼내는 도구 — `projectGraph` `FILE_PATH_KEYS` 의 파일(디렉터리 ❌) 쪽과 같은 목록이다.
 * `Glob`·`Grep` 은 그쪽 열쇠도 `path` 라 손대지 않는다(로컬 스키마엔 그 인자가 없어 노드를 만들지 않는다 — 클로드 경로가 `path` 없이 부를 때와 같다).
 */
const FILE_PATH_TOOLS: ReadonlySet<string> = new Set(['Read', 'Write', 'Edit']);

/**
 * 루트 상대 경로를 절대 경로로 올린다. 노드 쪽은 그래프가 `payload.cwd` 로 승격하지만 **`recordFileEdit` 는 승격하지 않는다** —
 * `Write` 의 이전 본문을 디스크에서 바로 읽으므로 상대 경로면 서버 cwd 기준으로 엉뚱한 자리를 보고 diff 가 통째로 빈다.
 */
function absolutize(cwd: string, raw: string): string {
  if (path.isAbsolute(raw)) return raw;
  if (!cwd) return raw; // cwd 를 모르면 올릴 근거가 없다 — 그래프의 상대경로 승격에 맡긴다.
  return path.resolve(cwd, raw);
}

/** 로컬 도구 인자를 **그래프가 읽는 이름**으로 옮긴 사본. 원본 인자는 두고 `file_path` 만 얹는다 — 스트림 도구 카드·러너 이력은 짧은 상대 경로를 계속 쓴다. */
export function localToolInputForGraph(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string,
): Record<string, unknown> {
  if (!FILE_PATH_TOOLS.has(toolName)) return toolInput;
  // 이미 맞는 이름으로 왔으면 그대로 둔다(모델이 클로드식 인자를 부를 때도 있다).
  if (typeof toolInput['file_path'] === 'string' && toolInput['file_path']) return toolInput;
  const raw = toolInput['path'];
  if (typeof raw !== 'string' || !raw) return toolInput;
  return { ...toolInput, file_path: absolutize(cwd, raw) };
}

/**
 * 도구 이벤트 한 건 → 훅 페이로드. `index.ts` 방출기와 시험이 함께 쓰는 유일한 변환이다.
 * @param opts.subAgentId §5.1 #1-1 (D) — 그 일을 한 sub. `sessionId` 는 주인 버블의 세션 키라 그래프가 sub 를
 *   거꾸로 찾을 수 없다 — 싣지 않으면 로컬·코덱스의 앱 작업 꼬리표가 붙지 않는다.
 */
export function toLocalHookPayload(sessionId: string, event: LocalHookToolEvent, opts?: { subAgentId?: string }): HookEventPayload {
  return {
    ...(opts?.subAgentId ? { _vibisualSubAgentId: opts.subAgentId } : {}),
    session_id: sessionId,
    hook_event_name: event.phase === 'pre' ? 'PreToolUse' : event.toolIsError === true ? 'PostToolUseFailure' : 'PostToolUse',
    tool_name: event.toolName,
    tool_input: localToolInputForGraph(event.toolName, event.toolInput, event.cwd),
    tool_use_id: event.toolUseId,
    cwd: event.cwd,
    // 결과 모양은 클로드 도구 응답과 같은 `content` 배열로 맞춘다 — `extractBashOutput` 이
    //   그 모양을 먼저 보므로, 여기서 다른 모양을 쓰면 Bash 출력이 이력에 안 붙는다.
    ...(event.toolResponse !== undefined || event.toolIsError !== undefined
      ? {
          tool_response: {
            ...(event.toolResponse !== undefined ? { content: [{ type: 'text', text: event.toolResponse }] } : {}),
            ...(event.toolIsError !== undefined ? { is_error: event.toolIsError } : {}),
          },
        }
      : {}),
    ...(typeof event.durationMs === 'number' ? { duration_ms: event.durationMs } : {}),
  };
}
