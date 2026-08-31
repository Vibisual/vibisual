// §5.5 v4.92 — 스트림 "복원 예산" 판정 — 서버·클라 공용 SSOT.
//
// 왜 있나: IDE 가 되살리는 대화는 `sub-streams/<agentId>/<subId>.jsonl` 의 **마지막 N 이벤트**가
// 전부다(사용자 말풍선·카드는 체크포인트에 따로 남아 사실상 무제한). 그래서 그 N 슬롯을 무엇이
// 먹느냐가 곧 "며칠 전 대화까지 보이는가"다. 실측 세션(1시간·1,015 이벤트)에서는 **38%** 가
// `[task_progress]`·`[thinking_tokens]` 같은 **내용 없는 SDK 상태 칩**이었고, 정작 AI 본문은 4.6%
// 뿐이었다 — 화면에 한 글자도 안 그려지는 것들이 대화를 밀어내고 있었다.
//
// 무엇을 하나: "어느 밀도에서도 볼 내용이 없는 이벤트"를 한 곳에서 판정해, 서버가 버퍼·디스크에
// 남기지 않게 한다(라이브 중계는 그대로 — 진행 표시는 이 칩들로 움직인다). 클라의 표시 필터도
// 같은 판정을 재사용해 두 쪽 규칙이 갈라지지 않게 한다.
//
// ⚠ 여기 넣어도 되는 것은 **밀도 `원문` 에서도 안 그려지는 것**뿐이다. `[task_started]` 처럼 원문에서
//   뜻이 보이는 한 줄(SystemNode)로 그려지는 칩은 저장에서 빼면 안 된다 — 되살린 화면만 조용히
//   달라진다. 새 subtype 을 뺄 때는 클라가 정말 안 그리는지부터 확인할 것.

/**
 * §5.5 #17-13 ⑤-3 — 칩 한 줄의 형태. `[subtype]` 단독, 또는 `[subtype] {json}`(작업 칩의 payload).
 * `.` 은 줄바꿈에 안 걸리지만 payload 는 `JSON.stringify` 가 개행을 `\n` 으로 escape 하므로 항상 한 줄이다.
 */
const SYSTEM_CHIP_RE = /^\[([a-z0-9_]+)\](?:\s+(\{.*\}))?$/;

/** payload 접미사를 객체로. JSON 이 아니거나 객체가 아니면 null. */
function parseChipPayload(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * `[task_started]` 처럼 **소문자 subtype 단독** 패턴이면 subtype 문자열을, 아니면 null.
 * §5.5 #17-13 ⑤-3 부터는 뒤에 `{json}` payload 가 붙은 작업 칩도 같은 subtype 을 돌려준다.
 *
 * 권한 승인 결정 같은 임의 본문(`emitSystemMessage`)이나 짝 없는 tool_result(`[ToolName] ...`)는
 * 뒤에 내용이 붙어 이 패턴에 걸리지 않는다 — 그런 줄은 사용자가 읽어야 하는 내용이라 남겨야 한다.
 * payload 자리가 JSON 으로 안 읽히면 칩이 아니라 **본문**으로 본다(임의 글을 삼키지 않기 위해).
 */
export function parseSystemSubtype(content: string): string | null {
  const m = SYSTEM_CHIP_RE.exec(content.trim());
  if (!m) return null;
  if (m[2] !== undefined && parseChipPayload(m[2]) === null) return null;
  return m[1]!;
}

// ─── §5.5 #17-13 ⑤-3 작업 칩(task_started / task_notification) ───
//
// CLI 실행본 스키마(claude.exe 2.1.223):
//   task_started      : task_id · description · subagent_type? · task_type? · prompt? · skip_transcript?
//   task_notification : task_id · status(completed|failed|stopped) · summary · usage.duration_ms · skip_transcript?
// CLI 자신이 이 둘을 "edge bookends"(한 작업의 시작·끝 한 쌍)라 부른다 — 그래서 화면에서도 한 줄이다.

/** 작업이 끝난 방식. CLI `task_notification.status` 그대로. */
export type StreamTaskStatus = 'completed' | 'failed' | 'stopped';

/** 작업 칩이 싣고 다니는 것 — 화면이 실제로 그리는 필드만 남긴다. */
export interface StreamTaskInfo {
  /** CLI 가 발급한 작업 id. 시작·끝 두 칩을 한 줄로 묶는 열쇠. */
  id: string;
  /** 사람이 읽는 작업 이름(`task_started.description`). */
  description?: string;
  /** Task 도구 서브에이전트면 그 종류(`task_started.subagent_type`). 이름이 없을 때의 대타. */
  subagentType?: string;
  /** 끝났으면 그 결과(`task_notification.status`). */
  status?: StreamTaskStatus;
  /** 끝의 한 줄 요약(`task_notification.summary`). 짝 없는 끝은 이게 라벨이 된다. */
  summary?: string;
  /** 소요 시간 ms(`task_notification.usage.duration_ms`). */
  durationMs?: number;
}

/** payload 로 싣는 글자의 상한 — 칩 하나가 복원 예산을 많이 먹지 않게 자른다. */
export const SYSTEM_CHIP_TEXT_MAX = 200;

function clampChipText(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  if (t === '') return undefined;
  return t.length > SYSTEM_CHIP_TEXT_MAX ? `${t.slice(0, SYSTEM_CHIP_TEXT_MAX)}…` : t;
}

/**
 * 칩 한 줄을 찍는다 — 서버(CLI 줄 변환)와 클라(시작·끝 합치기)가 **같은 함수**를 쓴다.
 * payload 가 없으면 종전과 완전히 같은 `[subtype]` 이라 옛 이벤트와 섞여도 문제가 없다.
 */
export function formatSystemChip(subtype: string, task?: StreamTaskInfo | null): string {
  if (!task || !task.id) return `[${subtype}]`;
  const payload: StreamTaskInfo = {
    id: task.id,
    description: clampChipText(task.description),
    subagentType: clampChipText(task.subagentType),
    status: task.status,
    summary: clampChipText(task.summary),
    durationMs: typeof task.durationMs === 'number' && Number.isFinite(task.durationMs) ? Math.round(task.durationMs) : undefined,
  };
  return `[${subtype}] ${JSON.stringify(payload)}`;
}

const TASK_STATUSES: ReadonlySet<string> = new Set<StreamTaskStatus>(['completed', 'failed', 'stopped']);

/** 칩 한 줄에서 작업 payload 를 꺼낸다. payload 가 없거나 id 가 없으면 null(= 종전의 민 칩). */
export function parseSystemTaskInfo(content: string): StreamTaskInfo | null {
  const m = SYSTEM_CHIP_RE.exec(content.trim());
  if (!m || m[2] === undefined) return null;
  const obj = parseChipPayload(m[2]);
  if (!obj) return null;
  const id = typeof obj['id'] === 'string' ? obj['id'] : '';
  if (!id) return null;
  const str = (k: string): string | undefined => (typeof obj[k] === 'string' && obj[k] !== '' ? (obj[k] as string) : undefined);
  const status = typeof obj['status'] === 'string' && TASK_STATUSES.has(obj['status'])
    ? (obj['status'] as StreamTaskStatus)
    : undefined;
  const durationMs = typeof obj['durationMs'] === 'number' && Number.isFinite(obj['durationMs'])
    ? (obj['durationMs'] as number)
    : undefined;
  return {
    id,
    description: str('description'),
    subagentType: str('subagentType'),
    status,
    summary: str('summary'),
    durationMs,
  };
}

/**
 * 시작 칩 + 끝 칩 → 한 줄. **시작 쪽 이름을 지키고** 결과·요약·소요 시간을 얹는다
 * (끝 칩에는 작업 이름이 없다 — CLI 가 `task_notification` 에 `description` 을 싣지 않는다).
 */
export function foldTaskBookend(start: StreamTaskInfo, end: StreamTaskInfo): StreamTaskInfo {
  return {
    ...start,
    status: end.status ?? start.status,
    summary: end.summary ?? start.summary,
    durationMs: end.durationMs ?? start.durationMs,
  };
}

/** 작업 칩인 subtype — payload 를 싣고 시작·끝을 합치는 대상. */
export const TASK_CHIP_START_SUBTYPE = 'task_started';
export const TASK_CHIP_END_SUBTYPE = 'task_notification';

/**
 * §4 (CLI 사양 추종) — `--include-hook-events` 가 스트림에 흘리는 훅 줄의 subtype.
 *
 * 공식 문서가 이름을 셋으로 못 박았다: `hook_started`(훅 시작) · `hook_progress`(1초 넘게 도는
 * command 훅이 뱉는 중간 출력) · `hook_response`(배경 훅이 끝났을 때). `hook_completed` 는
 * 실행본이 함께 흘리던 이름이라 같이 든다 — 이름이 하나 늘어도 여기 한 줄이면 된다.
 *
 * **기본은 소음이다.** 플래그를 안 켠 세션에서도 일부가 흘러들어와 대화록을 채우던 자리라
 * 종전부터 버려 왔고, 사용자가 `includeHookEvents` 로 **일부러 켰을 때만** 화면에 세운다.
 */
export const HOOK_STREAM_SUBTYPES: ReadonlySet<string> = new Set([
  'hook_started', 'hook_progress', 'hook_response', 'hook_completed',
]);

/** 그 줄이 훅 줄인가. 화면 표시 판정(SystemNode `^hook_` 패턴)과 같은 갈래를 서버가 재사용한다. */
export function isHookStreamSubtype(subtype: string): boolean {
  return HOOK_STREAM_SUBTYPES.has(subtype);
}
/** 이벤트가 "내용 없는 SDK 상태 칩"인가 — 판정에 필요한 최소 모양만 받는다(타입 결합 회피). */
export interface StreamNoiseProbe {
  eventType: string;
  content: string;
}

/** SDK 가 생각 중 반복 송출하는 펄스 — 파싱 단계가 아이템 자체를 안 만든다(라이브 1줄이 유일한 표면). */
export const THINKING_PULSE_SUBTYPE = 'thinking_tokens';

/**
 * IDE 에서 아예 숨기는 subtype — 노드 점도 라벨도 그리지 않는다(밀도 `원문` 에서도).
 *
 * §5.5 #17-13 ⑤-5 — `task_progress` 는 **새 작업이 아니라 이미 화면에 선 작업의 심장박동**이다.
 * CLI 실행본(2.1.228)은 `task_id`·`description`·`last_tool_name`·`usage` 를 실어 **주기적으로** 쏘는데,
 * 그 `task_id` 는 `task_started` 로 이미 한 줄을 차지한 그 작업의 것이라 작업 하나가 도는 동안 같은
 * 자리에 같은 줄이 N 개 겹친다. 게다가 우리 서버는 payload 를 `task_started`·`task_notification` 에만
 * 붙이므로(⑤-3) 실제로 오는 것은 전부 민 칩 `[task_progress]` — 화면엔 고정 라벨 한 낱말뿐이다
 * (실측: 저장분 2,454건 전부). CLI 자신도 이 subtype 을 `status`·`thinking_tokens`·`*_changed` 와 같은
 * **상태 프레임** 바구니로 분류해 흘린다.
 */
export const HIDDEN_SYSTEM_SUBTYPES: ReadonlySet<string> = new Set(['status', 'task_progress']);

/**
 * §5.5 #17-13 ⑤-4 — **살림성 통지**(`_changed`)도 숨긴다. `commands_changed`·`background_tasks_changed`
 * 처럼 "CLI 안쪽 목록이 다시 훑였다"만 알리는 칩으로, 무엇이 어떻게 바뀌었는지도 안 싣는다 — 화면에
 * 남길 뜻이 0 인데 한 줄씩 자리를 먹는다. 실측(사용자 스크린샷)에서는 유휴 시간대에 이 칩만 몇 시간
 * 간격으로 들어와 대화록 끝에 **똑같은 줄 7개가 연달아** 쌓였다(다른 이벤트가 사이에 없어서다).
 *
 * 이름 하나가 아니라 어미로 잡는 이유: CLI 판올림마다 `*_changed` 가 늘어난다(`commands` →
 * `background_tasks` → …). 하나씩 등록하면 다음 판올림에서 같은 줄이 또 새 이름으로 뜬다.
 */
const HOUSEKEEPING_SUBTYPE_RE = /_changed$/;

/** 이 subtype 은 어느 밀도에서도 안 그린다 — 이름표(HIDDEN_SYSTEM_SUBTYPES) 또는 살림성 어미. */
export function isHiddenSystemSubtype(subtype: string): boolean {
  return HIDDEN_SYSTEM_SUBTYPES.has(subtype) || HOUSEKEEPING_SUBTYPE_RE.test(subtype);
}

/**
 * **어느 밀도에서도** 화면에 안 그려지는 system subtype — 복원 예산에서 뺄 대상의 전부.
 *
 * 실측(이 저장소 `sub-streams` 328파일 164,214줄): `thinking_tokens` 68,059 + `status` 6,479 +
 * `task_progress` 2,282(⑤-5) = 전체의 46%(+ 살림성 `*_changed` 95). 작업 1건당 한 줄이 되는
 * `task_started`·`task_notification`(⑤-3) 은 원문 밀도에서 뜻이 보이는 줄로 그려지므로 뺀다.
 */
export function isNeverRenderedSystemSubtype(subtype: string): boolean {
  return subtype === THINKING_PULSE_SUBTYPE || isHiddenSystemSubtype(subtype);
}

/**
 * 화면에 **그릴 내용이 하나도 없는** 이벤트인가 — 복원 예산에서 뺄 대상.
 *
 * 사고(`thinking`)는 본문으로 안 그려지지만 **텍스트 런의 경계** 역할을 하므로(사고를 사이에 둔
 * 앞뒤 설명이 두 말풍선) 여기에 넣지 않는다 — 빼면 복원된 대화의 문단이 살아있는 화면과 다르게 뭉친다.
 */
export function isNeverRenderedStreamEvent(evt: StreamNoiseProbe): boolean {
  if (evt.eventType !== 'system') return false;
  const subtype = parseSystemSubtype(evt.content);
  return subtype !== null && isNeverRenderedSystemSubtype(subtype);
}
