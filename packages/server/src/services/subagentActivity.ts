/**
 * §5.5 #17-9 ⑦ — 백그라운드 서브에이전트의 "지금 무엇을" · "무엇이 나왔나" 를 훅 페이로드에서 뽑는 순수 함수 두 벌.
 *
 * 둘 다 **표시 전용**이다 — 대차대조 증감(§5.3 #12-1)이나 완료 판정에는 한 글자도 관여하지 않는다.
 * 순수 함수로 떼어 둔 이유는 판본마다 흔들리는 것이 바로 이 페이로드 모양이기 때문이다(도구 인자 이름,
 * `tool_response` 가 문자열인지 블록 배열인지). 모양이 바뀌면 여기 한 곳과 그 테스트만 고치면 된다.
 */

/** 화면 한 줄에 실을 대상 설명의 최대 길이. 넘치면 말줄임. */
const TARGET_MAX = 120;
/** 보관하는 결과 발췌의 최대 길이(§5.5 #17-9 ⑦(b)). */
export const SUBAGENT_RESULT_MAX = 1200;

function clamp(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** 경로는 꼬리 두 토막만 — 좁은 `w-52` 카드에서 앞쪽 긴 절대경로는 정작 파일 이름을 밀어낸다. */
function tailPath(value: string): string {
  const parts = value.split(/[\\/]/).filter((p) => p !== '');
  if (parts.length <= 2) return parts.join('/');
  return parts.slice(-2).join('/');
}

function str(input: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = input?.[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** 이름을 모르는 도구에서도 뭔가 말하기 위한 순회 순서. 앞쪽일수록 "무엇을 하는지"에 가깝다. */
const FALLBACK_KEYS = ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt'];
/** 경로로 취급해 꼬리만 남길 인자 이름. */
const PATH_KEYS = new Set(['file_path', 'notebook_path', 'path']);

/**
 * §5.5 #17-9 ⑦(a) — 자식이 지금 쓰는 도구의 **대상** 한 줄.
 * 도구 이름은 호출부가 따로 들고 있으므로 여기서는 붙이지 않는다(`Bash` + `npm test` 처럼 합쳐 그린다).
 */
export function describeToolTarget(toolName: string, toolInput: unknown): string | undefined {
  const input = (toolInput && typeof toolInput === 'object') ? toolInput as Record<string, unknown> : undefined;
  if (!input) return undefined;

  switch (toolName) {
    case 'Bash':
    case 'BashOutput':
      return clampOr(str(input, 'command') ?? str(input, 'description'));
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit': {
      const p = str(input, 'file_path') ?? str(input, 'notebook_path');
      return p ? clamp(tailPath(p), TARGET_MAX) : undefined;
    }
    case 'Grep':
    case 'Glob': {
      const pattern = str(input, 'pattern');
      const where = str(input, 'path');
      if (!pattern) return where ? clamp(tailPath(where), TARGET_MAX) : undefined;
      return clamp(where ? `${pattern} — ${tailPath(where)}` : pattern, TARGET_MAX);
    }
    case 'WebFetch':
      return clampOr(str(input, 'url'));
    case 'WebSearch':
      return clampOr(str(input, 'query'));
    case 'Task':
    case 'Agent':
      return clampOr(str(input, 'description') ?? str(input, 'subagent_type'));
    default: {
      for (const key of FALLBACK_KEYS) {
        const v = str(input, key);
        if (v) return clamp(PATH_KEYS.has(key) ? tailPath(v) : v, TARGET_MAX);
      }
      return undefined;
    }
  }
}

function clampOr(value: string | undefined): string | undefined {
  return value ? clamp(value, TARGET_MAX) : undefined;
}

/**
 * §5.5 #17-9 ⑦(b) — `PostToolUse(Task|Agent)` 의 `tool_response` 에서 자식의 최종 보고 본문을 뽑는다.
 *
 * 판본에 따라 문자열 그대로 오기도 하고, `{ content: [{ type:'text', text }] }` 블록 배열로도 온다.
 * 어느 쪽도 아니면 **아무것도 돌려주지 않는다** — 못 읽은 것을 JSON 덩어리로 화면에 뱉느니 비워 둔다.
 */
export function extractTaskResultText(toolResponse: unknown): string | undefined {
  const text = collectText(toolResponse);
  if (!text) return undefined;
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  return trimmed.length <= SUBAGENT_RESULT_MAX ? trimmed : `${trimmed.slice(0, SUBAGENT_RESULT_MAX - 1)}…`;
}

function collectText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value.map((v) => collectText(v)).filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    return parts.length > 0 ? parts.join('\n') : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  if (typeof obj['text'] === 'string') return obj['text'];
  if (obj['content'] !== undefined) return collectText(obj['content']);
  for (const key of ['output', 'result', 'stdout', 'message']) {
    if (typeof obj[key] === 'string') return obj[key] as string;
  }
  return undefined;
}
