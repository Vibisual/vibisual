/** §2.1 #3 — shared `editToolInput.ts`(편집 계열 도구 입력 모양) 시험. 서버 그래프(`recordFileEdit`)와 클라 IDE 스트림(`diffTool.ts`)이 함께 쓰는 한 벌이고, shared 엔 러너가 없어 여기서 돈다. */
import { describe, it, expect } from 'vitest';
import {
  EDIT_INPUT_TOOLS,
  MAX_WRITE_DIFF_BYTES,
  parseEditToolObject,
  parseEditToolInputJson,
  joinEditHunks,
  clampEditSide,
  parseApplyPatch,
} from '@vibisual/shared';

describe('parseEditToolObject — 네 도구의 입력 모양', () => {
  it('Edit', () => {
    expect(parseEditToolObject('Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' }))
      .toEqual({ toolName: 'Edit', filePath: 'a.ts', mode: 'edit', hunks: [{ oldText: 'x', newText: 'y' }] });
  });

  it('MultiEdit — 조각 배열', () => {
    const parsed = parseEditToolObject('MultiEdit', {
      file_path: 'a.ts',
      edits: [{ old_string: 'x', new_string: 'y' }, { old_string: 'p', new_string: 'q' }],
    });
    expect(parsed?.mode).toBe('edit');
    expect(parsed?.hunks).toEqual([{ oldText: 'x', newText: 'y' }, { oldText: 'p', newText: 'q' }]);
  });

  it('MultiEdit — 모양이 깨진 조각은 건너뛰고, 하나도 안 남으면 null', () => {
    const partial = parseEditToolObject('MultiEdit', {
      file_path: 'a.ts',
      edits: [{ old_string: 'x' }, null, { old_string: 'p', new_string: 'q' }],
    });
    expect(partial?.hunks).toEqual([{ oldText: 'p', newText: 'q' }]);
    expect(parseEditToolObject('MultiEdit', { file_path: 'a.ts', edits: [{ old_string: 'x' }] })).toBeNull();
    expect(parseEditToolObject('MultiEdit', { file_path: 'a.ts', edits: 'nope' })).toBeNull();
  });

  it('Write — mode=create, 이전 본문은 비어 있다(디스크는 서버가 뜬다)', () => {
    expect(parseEditToolObject('Write', { file_path: 'a.ts', content: 'body' }))
      .toEqual({ toolName: 'Write', filePath: 'a.ts', mode: 'create', hunks: [{ oldText: '', newText: 'body' }] });
  });

  it('NotebookEdit — notebook_path 우선, file_path 폴백', () => {
    expect(parseEditToolObject('NotebookEdit', { notebook_path: 'n.ipynb', new_source: 's' })?.filePath)
      .toBe('n.ipynb');
    expect(parseEditToolObject('NotebookEdit', { file_path: 'n.ipynb', new_source: 's' })?.filePath)
      .toBe('n.ipynb');
    // 둘 다 오면 정규 칸이 이긴다.
    expect(parseEditToolObject('NotebookEdit', { notebook_path: 'a.ipynb', file_path: 'b.ipynb', new_source: 's' })?.filePath)
      .toBe('a.ipynb');
  });

  it('NotebookEdit — old_source 가 없으면 이전 본문을 지어내지 않는다', () => {
    expect(parseEditToolObject('NotebookEdit', { notebook_path: 'n.ipynb', new_source: 's' })?.hunks)
      .toEqual([{ oldText: '', newText: 's' }]);
  });

  it('모르는 도구·빠진 칸은 null — 넘겨짚지 않는다', () => {
    expect(parseEditToolObject('Bash', { command: 'echo hi' })).toBeNull();
    expect(parseEditToolObject('Read', { file_path: 'a.ts' })).toBeNull();
    expect(parseEditToolObject('Edit', { file_path: 'a.ts', old_string: 'x' })).toBeNull();
    expect(parseEditToolObject('Write', { file_path: 'a.ts' })).toBeNull();
    expect(parseEditToolObject('NotebookEdit', { notebook_path: 'n.ipynb' })).toBeNull();
  });

  it('EDIT_INPUT_TOOLS 는 파서가 실제로 다루는 이름과 일치한다', () => {
    for (const t of ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']) {
      expect(EDIT_INPUT_TOOLS.has(t)).toBe(true);
    }
    expect(EDIT_INPUT_TOOLS.has('Read')).toBe(false);
    expect(EDIT_INPUT_TOOLS.has('Bash')).toBe(false);
  });
});

describe('parseEditToolInputJson — 스트리밍 중 미완성 JSON', () => {
  it('정상 JSON 은 객체 파서와 같은 답', () => {
    expect(parseEditToolInputJson('Edit', JSON.stringify({ file_path: 'a.ts', old_string: 'x', new_string: 'y' })))
      .toEqual(parseEditToolObject('Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' }));
  });

  it('깨진 JSON·비객체는 null', () => {
    expect(parseEditToolInputJson('Edit', '{"file_path": "a.ts"')).toBeNull();
    expect(parseEditToolInputJson('Edit', '"just a string"')).toBeNull();
    expect(parseEditToolInputJson('Edit', 'null')).toBeNull();
  });
});

describe('joinEditHunks — 호출 하나 = 이력 한 줄', () => {
  it('조각이 하나면 그대로', () => {
    expect(joinEditHunks([{ oldText: 'x', newText: 'y' }]))
      .toEqual({ oldString: 'x', newString: 'y' });
  });

  it('조각이 여럿이면 줄바꿈으로 이어 붙인다 — 라인 LCS 가 조각별 변화를 그린다', () => {
    expect(joinEditHunks([
      { oldText: 'const a = 1;', newText: 'const a = 10;' },
      { oldText: 'const b = 2;', newText: 'const b = 20;' },
    ])).toEqual({
      oldString: 'const a = 1;\nconst b = 2;',
      newString: 'const a = 10;\nconst b = 20;',
    });
  });

  it('여러 줄짜리 조각도 줄 경계가 깨지지 않는다', () => {
    expect(joinEditHunks([
      { oldText: 'a\nb', newText: 'A\nB' },
      { oldText: 'c', newText: 'C' },
    ])).toEqual({ oldString: 'a\nb\nc', newString: 'A\nB\nC' });
  });
});

describe('clampEditSide — 이력 본문 상한은 한 벌', () => {
  it('상한 이하는 그대로, 넘치면 자르고 넘친 글자 수를 표식으로 남긴다', () => {
    expect(clampEditSide('short')).toBe('short');
    const long = 'x'.repeat(MAX_WRITE_DIFF_BYTES + 7);
    expect(clampEditSide(long)).toBe(`${'x'.repeat(MAX_WRITE_DIFF_BYTES)}\n…[truncated 7 chars]`);
    expect(clampEditSide('abcdef', 4)).toBe('abcd\n…[truncated 2 chars]');
  });
});

/** §5.25 (F) "쓴 내용도 남는다" — 코덱스 `apply_patch` 본문 → 파일별 바뀐 덩어리. 픽스처는 실제 패치(`pathLinkContextMenu.ts` 주석 한 줄)다. */
describe('parseApplyPatch — 코덱스 패치 본문을 파일별 덩어리로', () => {
  const REAL = [
    '*** Begin Patch',
    '*** Update File: C:/Work/Proj/packages/client/src/components/IDE/pathLinkContextMenu.ts',
    '@@',
    ' export interface OutsidePathLinkMenuHandlers {',
    '-  /** `POST /api/reveal-path` — 파일이면 그 파일이 든 폴더. */',
    '+  /** `POST /api/reveal-path` — 파일이면 상위 폴더에서 해당 파일 선택. */',
    '   reveal: () => void;',
    '*** Update File: C:/Work/Proj/packages/client/src/components/IDE/useWorkspaceExplorer.ts',
    '@@ export function openFolderByPath',
    '-/** 절대 경로가 든 폴더를 시스템 탐색기에서 연다 — 기존 폴더 열기 경로 재사용(새 열기 레일 ❌). */',
    '+/** 시스템 탐색기에서 폴더를 열거나 파일을 선택한다 — 기존 폴더 열기 경로 재사용(새 열기 레일 ❌). */',
    ' export function openFolderByPath(absolutePath: string, nodePath: string): void {',
    '*** End Patch',
  ].join('\n');

  it('실제 사례 — 파일마다 문맥·지운 줄 → 문맥·넣은 줄', () => {
    const files = parseApplyPatch(REAL);
    expect(files.map((f) => [f.op, f.path])).toEqual([
      ['update', 'C:/Work/Proj/packages/client/src/components/IDE/pathLinkContextMenu.ts'],
      ['update', 'C:/Work/Proj/packages/client/src/components/IDE/useWorkspaceExplorer.ts'],
    ]);
    expect(files[0]!.hunks).toEqual([{
      oldText: 'export interface OutsidePathLinkMenuHandlers {\n  /** `POST /api/reveal-path` — 파일이면 그 파일이 든 폴더. */\n  reveal: () => void;',
      newText: 'export interface OutsidePathLinkMenuHandlers {\n  /** `POST /api/reveal-path` — 파일이면 상위 폴더에서 해당 파일 선택. */\n  reveal: () => void;',
    }]);
    // `@@` 뒤의 닻 글자는 본문이 아니다.
    expect(files[1]!.hunks[0]!.oldText).not.toContain('@@');
    expect(files[1]!.hunks[0]!.newText.split('\n')).toHaveLength(2);
  });

  it('덩어리가 여럿이면 따로 — 첫 덩어리는 `@@` 없이 시작할 수 있다', () => {
    const files = parseApplyPatch([
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 20;',
      '@@ function tail',
      '-return 1;',
      '+return 2;',
      '*** End Patch',
    ].join('\n'));
    expect(files[0]!.hunks).toEqual([
      { oldText: 'const a = 1;\nconst b = 2;', newText: 'const a = 1;\nconst b = 20;' },
      { oldText: 'return 1;', newText: 'return 2;' },
    ]);
  });

  it('빈 줄은 빈 문맥 줄이다 — 본문 끝 개행이 만든 빈 줄은 덧붙지 않는다', () => {
    const files = parseApplyPatch('*** Begin Patch\n*** Update File: a.md\n@@\n first\n\n-old\n+new\n\n');
    expect(files[0]!.hunks).toEqual([{ oldText: 'first\n\nold', newText: 'first\n\nnew' }]);
  });

  it('CRLF 본문도 같은 답 — `*** End of File` 은 닻일 뿐이다', () => {
    const files = parseApplyPatch('*** Begin Patch\r\n*** Update File: a.ts\r\n@@\r\n-x\r\n+y\r\n*** End of File\r\n*** End Patch\r\n');
    expect(files).toEqual([{ op: 'update', path: 'a.ts', hunks: [{ oldText: 'x', newText: 'y' }] }]);
  });

  it('새 파일은 이전 본문이 비고, 지운 파일은 덩어리가 없다(지어내지 않는다)', () => {
    const files = parseApplyPatch([
      '*** Begin Patch',
      '*** Add File: src/new.ts',
      '+export const x = 1;',
      '+',
      '+export const y = 2;',
      '*** Delete File: src/old.ts',
      '*** End Patch',
    ].join('\n'));
    expect(files).toEqual([
      { op: 'add', path: 'src/new.ts', hunks: [{ oldText: '', newText: 'export const x = 1;\n\nexport const y = 2;' }] },
      { op: 'delete', path: 'src/old.ts', hunks: [] },
    ]);
  });

  it('이름 바꾸기는 새 경로를 함께 든다', () => {
    const files = parseApplyPatch('*** Begin Patch\n*** Update File: a.ts\n*** Move to: b.ts\n@@\n-x\n+y\n*** End Patch');
    expect(files[0]).toEqual({ op: 'update', path: 'a.ts', movePath: 'b.ts', hunks: [{ oldText: 'x', newText: 'y' }] });
  });

  it('바뀐 줄이 없는 덩어리·머리줄 없는 글·빈 글은 이력이 아니다', () => {
    expect(parseApplyPatch('*** Begin Patch\n*** Update File: a.ts\n@@\n same\n*** End Patch')[0]!.hunks).toEqual([]);
    expect(parseApplyPatch('-x\n+y')).toEqual([]);
    expect(parseApplyPatch('')).toEqual([]);
  });

  it('본문 줄의 `***` 는 머리줄로 오인되지 않는다 — 접두 문자가 있다', () => {
    const files = parseApplyPatch('*** Begin Patch\n*** Update File: a.md\n@@\n-*** Update File: fake.ts\n+*** Add File: fake.ts\n*** End Patch');
    expect(files).toHaveLength(1);
    expect(files[0]!.hunks).toEqual([{ oldText: '*** Update File: fake.ts', newText: '*** Add File: fake.ts' }]);
  });
});
