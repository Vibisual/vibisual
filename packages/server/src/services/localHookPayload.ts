/**
 * localHookPayload.ts — §5.19 (H) 로컬 도구 이벤트 → 훅 페이로드 **한 곳**.
 *
 * 러너는 페이로드를 짓지 않는다(지으면 러너가 그래프 스키마를 알게 된다). 그래서 옮기는 일은
 * 여기서만 한다. 종전에는 이 변환이 `index.ts` 안에 인라인으로 있고 시험이 그 모양을 **베껴**
 * 갖고 있어서, 둘이 어긋나는 순간 시험은 통과하고 화면만 비는 구조였다.
 *
 * 2026-08-24 실측이 정확히 그 사고였다 — All Model 세션이 `Glob`·`Read`·`Edit`·`Write` 를
 * 16번 돌아 **감사 원장에는 줄이 남았는데 캔버스의 파일 노드는 0개**였다. 뿌리는 인자 이름
 * 하나다: 로컬 도구 스키마는 파일 자리를 `path`(루트 상대)라 부르고, 그래프가 파일을 꺼내는
 * 열쇠는 `file_path` 다(`projectGraph` 의 `FILE_PATH_KEYS`). 이름이 어긋나면 추출이 조용히
 * `null` 이 되어 노드도, 수정 기록도, 에이전트-파일 엣지도 **아무 오류 없이** 안 생긴다.
 *
 * 이름만 고치는 것이 아니라 **절대 경로로 승격**까지 해서 넘긴다(아래 `absolutize` 주석 참고).
 */
import path from 'node:path';
import type { HookEventPayload } from '@vibisual/shared';
import type { LocalHookToolEvent } from './localRunner.js';

/**
 * 그래프가 파일 경로를 `file_path` 에서 꺼내는 도구들 — `projectGraph` 의 `FILE_PATH_KEYS` 중
 * 파일(디렉터리 ❌) 쪽과 같은 목록이다. `Glob`·`Grep` 은 그쪽에서도 열쇠가 `path` 라 손대지
 * 않는다(로컬 스키마에는 그 인자가 아예 없어 종전대로 노드를 만들지 않는다 — 클로드 경로가
 * `path` 없이 부를 때와 같은 그림이다).
 */
const FILE_PATH_TOOLS: ReadonlySet<string> = new Set(['Read', 'Write', 'Edit']);

/**
 * 루트 상대 경로를 절대 경로로 올린다.
 *
 * 노드를 세우는 쪽은 그래프가 `payload.cwd` 로 알아서 승격하지만, **수정 기록(`recordFileEdit`)
 * 은 승격하지 않는다** — 거기서 `Write` 의 이전 본문을 디스크에서 직접 읽으므로 상대 경로를
 * 그대로 넘기면 서버 프로세스의 cwd 를 기준으로 엉뚱한 자리를 보고 diff 가 통째로 빈다.
 * 그래서 두 쪽 모두가 맞는 값, 즉 절대 경로를 여기서 만들어 준다.
 */
function absolutize(cwd: string, raw: string): string {
  if (path.isAbsolute(raw)) return raw;
  if (!cwd) return raw; // cwd 를 모르면 올릴 근거가 없다 — 그래프의 상대경로 승격에 맡긴다.
  return path.resolve(cwd, raw);
}

/**
 * 로컬 도구의 인자를 **그래프가 읽는 이름**으로 옮긴 사본. 원본 인자는 지우지 않고 `file_path`
 * 를 얹기만 한다 — 스트림의 도구 카드·러너 이력이 종전대로 짧은 상대 경로를 계속 쓰게 둔다.
 */
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
 * 도구 이벤트 한 건을 훅 페이로드로. **`index.ts` 의 방출기와 시험이 같이 쓰는 유일한 변환**이라
 * 여기만 고치면 두 곳이 함께 따라온다(베껴 둔 사본이 어긋나 생기던 거짓 안심을 없앤다).
 */
export function toLocalHookPayload(sessionId: string, event: LocalHookToolEvent): HookEventPayload {
  return {
    session_id: sessionId,
    hook_event_name: event.phase === 'pre' ? 'PreToolUse' : 'PostToolUse',
    tool_name: event.toolName,
    tool_input: localToolInputForGraph(event.toolName, event.toolInput, event.cwd),
    tool_use_id: event.toolUseId,
    cwd: event.cwd,
    // 결과 모양은 클로드 도구 응답과 같은 `content` 배열로 맞춘다 — `extractBashOutput` 이
    //   그 모양을 먼저 보므로, 여기서 다른 모양을 쓰면 Bash 출력이 이력에 안 붙는다.
    ...(event.toolResponse !== undefined
      ? { tool_response: { content: [{ type: 'text', text: event.toolResponse }] } }
      : {}),
    ...(typeof event.durationMs === 'number' ? { duration_ms: event.durationMs } : {}),
  };
}
