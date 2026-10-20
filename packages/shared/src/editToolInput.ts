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
 * - 코덱스 `apply_patch` 는 입력이 **패치 본문** 하나라 위 모양으로 접히지 않는다 — 파일별로 푸는
 *   `parseApplyPatch` 가 따로 있다(§5.25 (F)). 머리줄 정규식은 §5.22 감사 원장과 한 벌이다.
 */
import {
  AUDIT_PATCH_FILE_HEADER_PATTERN,
  AUDIT_PATCH_MOVE_HEADER_PATTERN,
  MAX_WRITE_DIFF_BYTES,
} from './constants.js';

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

/**
 * 수정 이력 한 쪽 본문을 상한(`MAX_WRITE_DIFF_BYTES`)으로 자른다 — 넘친 만큼은 표식으로 남긴다.
 *
 * 서버의 모든 이력 경로(`Edit`/`Write` · §2.1 Bash 쓰기 축 · §5.25 (F) 코덱스 패치 장부)가 **이 한 벌**을
 * 쓴다. 두 벌이면 표식 모양이 갈리고, 이미 자른 본문을 다른 쪽이 또 자르면 표식이 두 번 붙는다.
 */
export function clampEditSide(text: string, max: number = MAX_WRITE_DIFF_BYTES): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

/** 코덱스 `apply_patch` 한 파일의 조작 — 머리줄 하나와 그 아래 바뀐 덩어리. */
export interface ApplyPatchFileEdit {
  op: 'add' | 'update' | 'delete';
  /** 머리줄에 적힌 그대로의 경로(절대·상대가 모두 온다 — 올리는 일은 부르는 쪽 몫이다). */
  path: string;
  /** `*** Move to:` 가 붙은 Update 의 새 경로. */
  movePath?: string;
  /**
   * 바뀐 덩어리. 한 덩어리 = 문맥·지운 줄(`oldText`) → 문맥·넣은 줄(`newText`).
   * Add 는 하나(`oldText=''`), Delete 는 비어 있다 — 패치에 지운 본문이 없으므로 지어내지 않는다.
   */
  hunks: EditToolHunk[];
}

/**
 * §5.25 (F) — 코덱스 `apply_patch` 본문을 **파일별 바뀐 덩어리**로 푼다. 수정 이력이 클로드 `MultiEdit`
 * 과 같은 모양(덩어리를 `joinEditHunks` 로 한 줄에 잇는다)으로 남게 하려는 것이다.
 *
 * 문법(공개 도구 설명):
 * ```
 * *** Begin Patch
 * *** Update File: <경로>
 * *** Move to: <새 경로>      (있을 때만)
 * @@ <닻 글자>                (첫 덩어리는 없을 수 있다)
 *  문맥 줄
 * -지운 줄
 * +넣은 줄
 * *** End of File            (있을 때만)
 * *** Add File: <경로>
 * +새 파일의 줄
 * *** Delete File: <경로>
 * *** End Patch
 * ```
 * - 머리줄은 §5.22 감사 원장과 **같은 정규식**으로 읽는다(본문 줄은 접두 문자가 있어 머리줄로 오인되지 않는다).
 * - 빈 줄은 빈 문맥 줄이다(코덱스 파서와 같은 해석). `@@` 의 닻 글자·`*** End of File` 은 본문이 아니다.
 * - 모르는 줄은 건너뛴다(넘겨짚지 않는다). 바뀐 줄이 하나도 없는 덩어리는 이력이 아니라 버린다.
 */
export function parseApplyPatch(patch: string): ApplyPatchFileEdit[] {
  const out: ApplyPatchFileEdit[] = [];
  let file: ApplyPatchFileEdit | null = null;
  let oldLines: string[] = [];
  let newLines: string[] = [];
  let changed = false;

  const flushHunk = (): void => {
    if (file && changed) {
      // 본문 끝 개행이 만든 빈 문맥 줄은 양쪽에서 같이 걷는다 — 이력 끝에 빈 줄이 덧붙지 않게.
      while (oldLines.length > 0 && newLines.length > 0 && oldLines[oldLines.length - 1] === '' && newLines[newLines.length - 1] === '') {
        oldLines.pop();
        newLines.pop();
      }
      file.hunks.push({ oldText: oldLines.join('\n'), newText: newLines.join('\n') });
    }
    oldLines = [];
    newLines = [];
    changed = false;
  };
  const flushFile = (): void => {
    flushHunk();
    if (file) out.push(file);
    file = null;
  };

  for (const rawLine of patch.split(/\r?\n/)) {
    const header = rawLine.trimEnd().match(AUDIT_PATCH_FILE_HEADER_PATTERN);
    if (header && header[1] && header[2]?.trim()) {
      flushFile();
      file = { op: header[1].toLowerCase() as ApplyPatchFileEdit['op'], path: header[2].trim(), hunks: [] };
      continue;
    }
    const current: ApplyPatchFileEdit | null = file;
    if (!current) continue; // `*** Begin Patch` 와 그 앞
    const moved = rawLine.trimEnd().match(AUDIT_PATCH_MOVE_HEADER_PATTERN);
    if (moved && moved[1]?.trim()) {
      if (current.op === 'update') current.movePath = moved[1].trim();
      continue;
    }
    if (rawLine.startsWith('*** ')) {
      // `*** End Patch` 는 파일을 닫고, `*** End of File` 은 덩어리 끝을 붙드는 닻일 뿐이다.
      if (rawLine.trimEnd() === '*** End Patch') flushFile();
      continue;
    }
    if (current.op === 'delete') continue;
    if (current.op === 'add') {
      if (rawLine.startsWith('+')) {
        newLines.push(rawLine.slice(1));
        changed = true;
      }
      continue;
    }
    if (rawLine.startsWith('@@')) {
      flushHunk();
      continue;
    }
    const mark = rawLine.charAt(0);
    if (mark === '+') {
      newLines.push(rawLine.slice(1));
      changed = true;
    } else if (mark === '-') {
      oldLines.push(rawLine.slice(1));
      changed = true;
    } else if (mark === ' ') {
      oldLines.push(rawLine.slice(1));
      newLines.push(rawLine.slice(1));
    } else if (rawLine === '') {
      oldLines.push('');
      newLines.push('');
    }
  }
  flushFile();
  return out;
}
