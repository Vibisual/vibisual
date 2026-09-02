/**
 * §2.1 #3 — shared `editToolInput.ts` 고정 시험 (편집 계열 도구 입력 모양).
 *
 * 이 파서는 **서버 그래프(`recordFileEdit`)와 클라 IDE 스트림(`diffTool.ts`)이 함께 쓰는 한 벌**이다.
 * shared 패키지에는 러너가 없으므로(읽기·쓰기 축 시험과 같은 자리에서 돌린다) 여기서 고정한다.
 */
import { describe, it, expect } from 'vitest';
import {
  EDIT_INPUT_TOOLS,
  parseEditToolObject,
  parseEditToolInputJson,
  joinEditHunks,
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
