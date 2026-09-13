/**
 * §5.25 (F) — `codex exec --json` 의 JSONL 한 줄을 우리 스트림 이벤트로 옮긴다.
 *
 * **여기가 이 기능의 유일한 해석 지점이다.** 화면마다 따로 해석하면 한쪽만 고쳐지는 날이 오고,
 * §5.19 (G) 가 `localModelEntry.ts` 로 판정을 모은 것과 같은 이유로 여기 한 곳에 둔다.
 * 순수 함수라 단위 테스트로 고정한다(`codexStreamMap.test.ts`).
 *
 * 실측한 줄(2026-09-07 · codex-cli 0.152.1):
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"turn.started"}
 *   {"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","status":"in_progress"}}
 *   {"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"..."}}
 *   {"type":"turn.completed","usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122,"reasoning_output_tokens":0}}
 *   {"type":"error","message":"You've hit your usage limit..."}
 *   {"type":"turn.failed","error":{"message":"..."}}
 *
 * **모르는 줄은 버린다.** 코덱스는 빠르게 바뀌는 CLI 라 새 `item.type` 이 언제든 생기고,
 * 그것을 억지로 `text` 로 흘리면 화면에 정체 모를 원문이 쏟아진다(§2.1 이 Bash 추출에서
 * 세운 "모르는 것을 넘겨짚지 않는다"와 같은 규율).
 */

/** 우리 `SubAgentStreamEvent.eventType` 중 이 매퍼가 낼 수 있는 것. */
export type CodexEventType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'system' | 'error' | 'result';

export interface CodexMappedEvent {
  eventType: CodexEventType;
  content: string;
  /** 도구 카드용 — `tool_use`/`tool_result` 에만 실린다. */
  toolName?: string;
  /** 도구 카드 짝짓기 키. 코덱스 item id 를 그대로 쓴다(§5.5 #17-27 ⑪). */
  toolUseId?: string;
  /** §5.25 (O) — 이 줄이 그림 한 장이면 그 파일의 절대경로. `text` 에만 실린다. */
  imagePath?: string;
}

export interface CodexUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
}

export interface CodexMapResult {
  /** 이 줄이 만든 화면 이벤트들(대개 0~1개). */
  events: CodexMappedEvent[];
  /** `thread.started` 가 준 세션 id. 우리 `SubAgent.sessionId` 에 박는다. */
  threadId?: string;
  /** `turn.completed` 의 사용량. */
  usage?: CodexUsage;
  /** 이 턴이 끝났는가(성공·실패 무관). */
  turnEnded?: boolean;
  /** 턴이 실패로 끝났으면 사유. */
  error?: string;
  /** 이 줄이 최종 답변이면 그 본문(턴 결과로 남긴다). */
  finalText?: string;
}

const EMPTY: CodexMapResult = { events: [] };

/**
 * §5.25 (O) — 그림으로 그릴 확장자. 여기 없는 것은 **그림으로 그리지 않고 글로만 남긴다.**
 *
 * `svg` 는 일부러 뺐다 — 스크립트를 품을 수 있는 문서라, 우리 창 안에서 열어 줄 것이 아니다.
 * 코덱스가 실제로 준 것은 `png`·`jpg` 뿐이었지만(1,063건 실측), 엔진이 늘리는 쪽을 막지 않으려
 * 흔한 래스터 형식은 미리 받아 둔다.
 */
export const CODEX_IMAGE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

/** 확장자가 우리가 그릴 수 있는 그림인가. 대소문자는 접어서 본다(비교용이라 접는 것이 맞다). */
export function isCodexImageFile(pathOrUrl: string): boolean {
  const clean = pathOrUrl.split('?')[0]?.split('#')[0] ?? '';
  const dot = clean.lastIndexOf('.');
  if (dot < 0) return false;
  return CODEX_IMAGE_EXTENSIONS.includes(clean.slice(dot + 1).toLowerCase());
}

/**
 * §5.25 (O) — 코덱스가 준 `path` 를 파일 경로로 옮긴다. **플랫폼을 인자로 받는다**(멀티플랫폼 4축) —
 * `process.platform` 을 안에서 읽으면 윈도우 개발기에서 mac/linux 갈래를 영영 시험하지 못한다.
 *
 * 실측(1,063건): 값은 **항상 `file:///…` URL** 이었지 평범한 경로가 아니었다. 그대로 `fs` 에 넘기면
 * 세 OS 모두에서 "그런 파일 없음"이 된다. 갈리는 자리는 하나 — 윈도우의 `file:///C:/x` 는 본문이
 * `/C:/x` 로 시작해 **앞 슬래시를 떼야** 하고, posix 의 `file:///home/x` 는 그 슬래시가 경로의 뿌리라
 * **떼면 안 된다.** 퍼센트 인코딩(`%20`)은 두 쪽 다 푼다.
 *
 * URL 이 아닌 값이 오면 그대로 돌려준다 — 엔진이 표기를 바꾸는 날 조용히 빈 값이 되지 않게.
 */
export function codexImagePathFromUrl(raw: string, platform: NodeJS.Platform): string {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return '';
  if (!/^file:\/\//i.test(v)) return v;
  let body = v.slice('file://'.length);
  try {
    body = decodeURIComponent(body);
  } catch {
    // 잘못 인코딩된 값은 원문 그대로 둔다(여는 쪽이 없다고 답하는 편이 낫다).
  }
  // `/C:/…` → `C:/…`. 드라이브 문자가 아닌 앞 슬래시는 posix 경로의 뿌리라 손대지 않는다.
  if (platform === 'win32' && /^\/[A-Za-z]:/.test(body)) body = body.slice(1);
  return body;
}

/** 경로의 파일 이름. 그림을 못 그리는 자리에서 이 이름이 대신 말한다. */
export function codexImageBasename(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const cut = norm.lastIndexOf('/');
  return cut >= 0 ? norm.slice(cut + 1) : norm;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * 명령 실행 item 을 사람이 읽는 한 줄로 접는다.
 * 도구 카드의 제목이 되므로 원문을 통째로 싣지 않는다.
 */
function commandSummary(item: Record<string, unknown>): string {
  const command = str(item['command']);
  if (command) return command;
  const argv = item['argv'];
  if (Array.isArray(argv)) return argv.map((a) => String(a)).join(' ');
  return '(command)';
}

/** 파일 변경 item 의 경로 목록. 파일·폴더 버블은 이 경로들을 먹는다(§5.25 (F)). */
export function codexFileChangePaths(item: Record<string, unknown>): string[] {
  const out: string[] = [];
  const changes = item['changes'];
  if (Array.isArray(changes)) {
    for (const c of changes) {
      if (c && typeof c === 'object') {
        const p = str((c as Record<string, unknown>)['path']);
        if (p) out.push(p);
      } else if (typeof c === 'string') {
        out.push(c);
      }
    }
  }
  // 코덱스가 단일 경로만 주는 모양도 받아 둔다.
  const single = str(item['path']);
  if (single && !out.includes(single)) out.push(single);
  return out;
}

/**
 * JSONL 한 줄 → 매핑 결과. JSON 이 아니거나 모르는 모양이면 `null`.
 *
 * `null` 과 "이벤트 0개인 결과"는 다르다 — 전자는 우리가 못 알아본 줄이고(로그로만 남긴다),
 * 후자는 알아봤지만 화면에 낼 것이 없는 줄이다(`turn.started` 등).
 */
export function mapCodexLine(line: string, platform: NodeJS.Platform = process.platform): CodexMapResult | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  const type = str(o['type']);
  if (!type) return null;

  switch (type) {
    case 'thread.started': {
      const threadId = str(o['thread_id']) || str(o['threadId']);
      return threadId ? { events: [], threadId } : EMPTY;
    }

    case 'turn.started':
      return EMPTY;

    case 'turn.completed': {
      const usageRaw = o['usage'];
      const result: CodexMapResult = { events: [], turnEnded: true };
      if (usageRaw && typeof usageRaw === 'object') {
        const u = usageRaw as Record<string, unknown>;
        result.usage = {
          inputTokens: num(u['input_tokens']),
          outputTokens: num(u['output_tokens']),
          cachedInputTokens: num(u['cached_input_tokens']),
          reasoningOutputTokens: num(u['reasoning_output_tokens']),
        };
      }
      return result;
    }

    case 'turn.failed': {
      const errRaw = o['error'];
      const message =
        errRaw && typeof errRaw === 'object'
          ? str((errRaw as Record<string, unknown>)['message'])
          : str(errRaw);
      return { events: [], turnEnded: true, error: message || 'turn failed' };
    }

    case 'error': {
      // 턴을 끝내지는 않는다 — 사용량 한도처럼 곧이어 `turn.failed` 가 따라오는 경우가 있고,
      //   경고성 error(모델 메타데이터 없음 등)만 오고 턴은 계속되는 경우도 있다.
      const message = str(o['message']) || 'error';
      return { events: [{ eventType: 'error', content: message }] };
    }

    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      return mapItem(type, o['item'], platform);

    default:
      return null;
  }
}

function mapItem(envelope: string, itemRaw: unknown, platform: NodeJS.Platform): CodexMapResult | null {
  if (!itemRaw || typeof itemRaw !== 'object') return null;
  const item = itemRaw as Record<string, unknown>;
  const itemType = str(item['type']);
  const id = str(item['id']) || undefined;
  const completed = envelope === 'item.completed';

  switch (itemType) {
    case 'agent_message': {
      // 최종 본문은 완료 줄에만 낸다 — started/updated 까지 흘리면 같은 말이 두 번 찍힌다.
      if (!completed) return EMPTY;
      const text = str(item['text']);
      return text ? { events: [{ eventType: 'text', content: text }], finalText: text } : EMPTY;
    }

    case 'reasoning': {
      if (!completed) return EMPTY;
      const text = str(item['text']) || str(item['summary']);
      return text ? { events: [{ eventType: 'thinking', content: text }] } : EMPTY;
    }

    case 'command_execution': {
      const summary = commandSummary(item);
      if (!completed) {
        // 시작 줄이 도구 카드를 세운다(started 만 — updated 는 같은 카드의 갱신이라 흘리지 않는다).
        if (envelope !== 'item.started') return EMPTY;
        return {
          events: [{ eventType: 'tool_use', content: summary, toolName: 'Bash', ...(id ? { toolUseId: id } : {}) }],
        };
      }
      const exitCode = item['exit_code'];
      const output = str(item['aggregated_output']) || str(item['output']);
      const head = typeof exitCode === 'number' ? `exit ${exitCode}` : 'done';
      return {
        events: [
          {
            eventType: 'tool_result',
            content: output ? `${head}\n${output}` : head,
            toolName: 'Bash',
            ...(id ? { toolUseId: id } : {}),
          },
        ],
      };
    }

    case 'file_change': {
      if (envelope !== 'item.started' && !completed) return EMPTY;
      const paths = codexFileChangePaths(item);
      const label = paths.length > 0 ? paths.join(', ') : '(file change)';
      if (!completed) {
        return {
          events: [{ eventType: 'tool_use', content: label, toolName: 'Write', ...(id ? { toolUseId: id } : {}) }],
        };
      }
      return {
        events: [
          {
            eventType: 'tool_result',
            content: paths.length > 0 ? `updated ${paths.length} file(s)\n${label}` : 'updated',
            toolName: 'Write',
            ...(id ? { toolUseId: id } : {}),
          },
        ],
      };
    }

    case 'mcp_tool_call': {
      const server = str(item['server']);
      const tool = str(item['tool']) || str(item['name']) || 'mcp';
      const toolName = server ? `${server}:${tool}` : tool;
      if (envelope === 'item.started') {
        const args = item['arguments'];
        const content = args === undefined ? toolName : safeJson(args);
        return { events: [{ eventType: 'tool_use', content, toolName, ...(id ? { toolUseId: id } : {}) }] };
      }
      if (!completed) return EMPTY;
      const res = item['result'];
      return {
        events: [
          {
            eventType: 'tool_result',
            content: res === undefined ? 'done' : safeJson(res),
            toolName,
            ...(id ? { toolUseId: id } : {}),
          },
        ],
      };
    }

    case 'web_search': {
      if (envelope !== 'item.started') return EMPTY;
      const query = str(item['query']);
      return {
        events: [
          { eventType: 'tool_use', content: query || '(web search)', toolName: 'WebSearch', ...(id ? { toolUseId: id } : {}) },
        ],
      };
    }

    case 'todo_list': {
      // 계획 갱신은 완료 줄 하나만 시스템 줄로 남긴다(매 갱신을 흘리면 스트림이 계획으로 덮인다).
      if (!completed) return EMPTY;
      const items = item['items'];
      if (!Array.isArray(items) || items.length === 0) return EMPTY;
      const lines = items
        .map((t) => {
          if (!t || typeof t !== 'object') return '';
          const rec = t as Record<string, unknown>;
          const text = str(rec['text']) || str(rec['title']);
          const done = rec['completed'] === true || str(rec['status']) === 'completed';
          return text ? `${done ? '[x]' : '[ ]'} ${text}` : '';
        })
        .filter(Boolean);
      return lines.length > 0 ? { events: [{ eventType: 'system', content: lines.join('\n') }] } : EMPTY;
    }

    /**
     * §5.25 (O) — 엔진이 대화에 **그림 한 장을 내건** 줄.
     *
     * 이름이 `ImageView` 인 것이 그대로 뜻이다 — **"만든 그림"이 아니라 "보여 주는 그림"이다.**
     * 실측 1,063건의 경로는 프로젝트 폴더 877 · `~/.codex/generated_images` 81 · `skills` 11 ·
     * `visualizations` 9 로 흩어져 있었다. 그래서 폴더 하나를 정해 두고 거르지 않는다 —
     * **엔진이 보여 준 것을 그대로 옮기는 것**이 이 자리의 일이다.
     *
     * `text` 로 낸다(새 종류를 만들지 않는 이유는 `SubAgentStreamEvent.imagePath` 주석 참조).
     * `content` 에는 파일 이름을 적어, 그림을 못 그리는 자리에서도 무엇이 있었는지는 남게 한다.
     */
    case 'ImageView': {
      // 시작 줄은 오지 않는다(실측 1,063건 전부 완료 줄) — 와도 같은 그림을 두 번 걸지 않는다.
      if (!completed) return EMPTY;
      const filePath = codexImagePathFromUrl(str(item['path']), platform);
      if (!filePath) return EMPTY;
      const name = codexImageBasename(filePath);
      // 그릴 수 없는 형식이면 **그림 없이 이름만** 남긴다. 열지 못할 것을 열 수 있는 척하지 않는다.
      if (!isCodexImageFile(filePath)) {
        return { events: [{ eventType: 'text', content: name }] };
      }
      return { events: [{ eventType: 'text', content: name, imagePath: filePath }] };
    }

    case 'error': {
      const message = str(item['message']) || 'error';
      return { events: [{ eventType: 'error', content: message }] };
    }

    default:
      return null;
  }
}

function safeJson(value: unknown): string {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    return s ?? '';
  } catch {
    return String(value);
  }
}
