/**
 * 편집 도구 입력 모양을 아는 유일한 자리(순수, 서버·클라 공용) — 두 번째 파서를 세우지 마라(한쪽만 고쳐진다 — §2.1 #3 과 같은 규율).
 * `Edit` `{file_path, old_string, new_string}` · `MultiEdit` `{file_path, edits[]}` · `Write` `{file_path, content}` → create · `NotebookEdit` `{notebook_path, new_source, old_source?}` → 셀 하나.
 * 코덱스 `apply_patch` 는 `parseApplyPatch` 가 따로 푼다(§5.25 (F), 머리줄 정규식은 §5.22 감사와 한 벌).
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

/** 객체 `tool_input` → 정규화된 편집(모르면 `null`). 성립 조각이 없는 `MultiEdit` 은 `null`, 없는 `old_source` 는 `''`(이전 본문을 지어내지 않는다). */
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
 * 여러 조각을 이력 한 줄로 접는다(호출 하나 = 한 줄). 조각마다 쌓으면 `MAX_FILE_EDITS` 를 한 호출이 먹고 §3.2.3 D축 병합이 없는 diff 를 만든다.
 * 줄바꿈으로 이으면 라인 LCS 가 조각별로 그린다.
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

/** 이력 한쪽 본문을 `MAX_WRITE_DIFF_BYTES` 로 자르고 표식을 남긴다. 모든 이력 경로(`Edit`/`Write`·Bash 쓰기·코덱스 패치)가 이 한 벌을 쓴다(두 벌이면 표식이 갈리거나 두 번 붙는다). */
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
 * §5.25 (F) — 코덱스 `apply_patch` 본문을 파일별 덩어리로 푼다(이력이 `MultiEdit` 과 같은 모양 — `joinEditHunks`).
 * 문법(공개 도구 설명): `*** Begin Patch` … `*** End Patch` 안에 `*** Update File:`(+`*** Move to:`, `@@ 닻`, ` `/`-`/`+` 줄, `*** End of File`) · `*** Add File:`(`+` 줄) · `*** Delete File:`.
 * 머리줄은 §5.22 감사와 같은 정규식. 빈 줄 = 빈 문맥 줄(코덱스 파서와 같다), 닻 글자·End of File 은 본문 아님. 모르는 줄은 건너뛰고 바뀐 줄 없는 덩어리는 버린다.
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
