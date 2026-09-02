/**
 * editToolInput.ts — 편집 계열 도구(`Edit`/`MultiEdit`/`Write`/`NotebookEdit`) 의 **입력 모양**을
 * 아는 유일한 자리. 순수 함수라 서버·클라 양쪽이 같은 답을 본다.
 *
 * 왜 shared 인가 — 이 지식은 원래 클라 `IDE/diffTool.ts` 한 곳에만 있었다. 그래서 서버 그래프는
 * `MultiEdit`/`NotebookEdit` 를 아예 모르는 채로 살았고(§2.1 #3 `FILE_PATH_KEYS` 에 두 도구가
 * 빠져 있었다 — 파일 버블도 쓰기 화살표도 수정 이력도 0), 감사·IDE 는 보는데 캔버스만 못 보는
 * 어긋남이 생겼다. 서버에 두 번째 파서를 세우면 도구 입력 모양이 바뀔 때 **한쪽만 고쳐진다** —
 * §2.1 #3 셸 토크나이저를 한 벌로 묶은 것과 같은 규율이다.
 *
 * 모양(공식 도구 입력):
 * - `Edit`         `{ file_path, old_string, new_string }`
 * - `MultiEdit`    `{ file_path, edits: [{ old_string, new_string }] }`
 * - `Write`        `{ file_path, content }`                     → `create`
 * - `NotebookEdit` `{ notebook_path, new_source, old_source? }` → 셀 하나
 */

/** 한 편집 조각 — 이전 텍스트 → 이후 텍스트. `Write` 는 `oldText=''`(전량 추가). */
export interface EditToolHunk {
  oldText: string;
  newText: string;
}

/** `create` = 새 파일 전량 쓰기(`Write`), `edit` = 기존 파일 부분 수정. */
export type EditToolMode = 'edit' | 'create';

/** 편집 계열 도구 입력을 diff·이력 공용으로 정규화한 표현. */
export interface ParsedEditToolInput {
  toolName: string;
  filePath: string;
  mode: EditToolMode;
  hunks: EditToolHunk[];
}

/** 이 파서가 아는 도구 이름. 여기 없는 이름은 `null` 을 돌려준다(모르는 것을 넘겨짚지 않는다). */
export const EDIT_INPUT_TOOLS: ReadonlySet<string> = new Set([
  'Edit', 'MultiEdit', 'Write', 'NotebookEdit',
]);

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}

/**
 * 이미 객체로 풀린 `tool_input` → 정규화된 편집. 모르는 도구·모양이 안 맞으면 `null`.
 *
 * `MultiEdit` 은 조각이 **하나도 성립하지 않으면** `null` 이다(빈 이력 한 줄을 남기지 않는다).
 * `NotebookEdit` 의 `old_source` 는 도구가 돌려주지 않는 일이 잦아 없으면 `''` 로 둔다 —
 * 없는 이전 본문을 지어내지 않는다(전량 추가로 보이는 편이 거짓 diff 보다 낫다).
 */
export function parseEditToolObject(
  toolName: string,
  obj: Record<string, unknown>,
): ParsedEditToolInput | null {
  switch (toolName) {
    case 'Edit': {
      const filePath = readString(obj, 'file_path');
      const oldText = readString(obj, 'old_string');
      const newText = readString(obj, 'new_string');
      if (filePath === null || oldText === null || newText === null) return null;
      return { toolName, filePath, mode: 'edit', hunks: [{ oldText, newText }] };
    }
    case 'MultiEdit': {
      const filePath = readString(obj, 'file_path');
      const editsRaw = obj['edits'];
      if (filePath === null || !Array.isArray(editsRaw)) return null;
      const hunks: EditToolHunk[] = [];
      for (const e of editsRaw) {
        if (typeof e !== 'object' || e === null) continue;
        const rec = e as Record<string, unknown>;
        const oldText = readString(rec, 'old_string');
        const newText = readString(rec, 'new_string');
        if (oldText === null || newText === null) continue;
        hunks.push({ oldText, newText });
      }
      if (hunks.length === 0) return null;
      return { toolName, filePath, mode: 'edit', hunks };
    }
    case 'Write': {
      const filePath = readString(obj, 'file_path');
      const content = readString(obj, 'content');
      if (filePath === null || content === null) return null;
      return { toolName, filePath, mode: 'create', hunks: [{ oldText: '', newText: content }] };
    }
    case 'NotebookEdit': {
      const filePath = readString(obj, 'notebook_path') ?? readString(obj, 'file_path');
      const newText = readString(obj, 'new_source');
      if (filePath === null || newText === null) return null;
      const oldText = readString(obj, 'old_source') ?? '';
      return { toolName, filePath, mode: 'edit', hunks: [{ oldText, newText }] };
    }
    default:
      return null;
  }
}

/**
 * 도구 이름 + input **JSON 문자열** → 정규화된 편집. 스트리밍 중 미완성 JSON 이면 `null`.
 * (IDE 스트림은 도구 입력을 문자열로 들고 있고, 훅 경로는 이미 객체다 — 입구만 둘이고 규칙은 하나.)
 */
export function parseEditToolInputJson(toolName: string, input: string): ParsedEditToolInput | null {
  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(input);
    if (typeof parsed !== 'object' || parsed === null) return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  return parseEditToolObject(toolName, obj);
}

/**
 * 여러 조각을 **수정 이력 한 줄**(`FileEdit.oldString`/`newString`)로 접는다.
 *
 * 호출 하나 = 이력 한 줄이 규칙이다. 조각마다 한 줄씩 쌓으면 조각 12개짜리 `MultiEdit` 하나가
 * `MAX_FILE_EDITS`(20) 를 거의 다 먹어 그 파일의 지난 이력이 통째로 밀려나고, §3.2.3 D축
 * 병합창이 서로 다른 조각을 "연속 수정"으로 오인해 (조각1의 이전 → 조각N의 이후) 라는 없는
 * diff 를 만든다. 줄바꿈으로 이어 붙이면 렌더러의 라인 LCS 가 조각별 변화를 그대로 그린다.
 */
export function joinEditHunks(hunks: readonly EditToolHunk[]): { oldString: string; newString: string } {
  if (hunks.length === 1) {
    const only = hunks[0]!;
    return { oldString: only.oldText, newString: only.newText };
  }
  return {
    oldString: hunks.map((h) => h.oldText).join('\n'),
    newString: hunks.map((h) => h.newText).join('\n'),
  };
}
