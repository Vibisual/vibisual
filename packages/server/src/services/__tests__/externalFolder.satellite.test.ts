import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { ProjectGraph } from '../projectGraph.js';

/**
 * 외부 폴더 satellite invariant 검증.
 *
 * 사용자 invariant: 외부 폴더 버블이 생성된다는 건 그 안에서 tool 활동이 있었다는 뜻 →
 * satellite (위성 파일) 가 최소 1개는 같이 떠야 한다. "폴더만 있고 위성 0" 은 위반.
 *
 * 모든 가능한 외부 폴더 생성 경로를 시뮬레이션해서 어디서 invariant 가 깨지는지 잡는다.
 */
describe('외부 폴더 satellite invariant — 모든 생성 경로', () => {
  const PROJECT = path.join(os.tmpdir(), `vib-sat-proj-${process.pid}-${Date.now()}`).replace(/\\/g, '/');
  const EXT_DIR = path.join(os.tmpdir(), `vib-sat-ext-${process.pid}-${Date.now()}`).replace(/\\/g, '/');
  const EXT_SUB = `${EXT_DIR}/sub`;
  const EXT_FILE_A = `${EXT_DIR}/foo.ts`;
  const EXT_FILE_B = `${EXT_DIR}/bar.ts`;
  const EXT_FILE_SUB = `${EXT_SUB}/deep.ts`;

  let graph: ProjectGraph;
  const SESSION = 's-ext-test';

  beforeEach(() => {
    fs.mkdirSync(PROJECT, { recursive: true });
    fs.mkdirSync(EXT_DIR, { recursive: true });
    fs.mkdirSync(EXT_SUB, { recursive: true });
    fs.writeFileSync(EXT_FILE_A, 'foo content');
    fs.writeFileSync(EXT_FILE_B, 'bar content');
    fs.writeFileSync(EXT_FILE_SUB, 'deep content');

    graph = new ProjectGraph();
    graph.setCompletedCommandArchiveRef(new Map());
    graph.setCommandQueuesRef(new Map());
    graph.registerProject(PROJECT);
  });

  afterEach(() => {
    try { fs.rmSync(EXT_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(PROJECT, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function hook(input: Record<string, unknown>): void {
    graph.processHookEvent({
      session_id: SESSION,
      cwd: PROJECT,
      hook_event_name: 'PostToolUse',
      ...input,
    } as never);
  }

  function findExtFolder(absPath: string): { id: string; satelliteFileCount?: number } | undefined {
    const snap = graph.getSnapshot();
    // Windows: 서버 내부 normalize() 가 lowercase + forward-slash → 비교도 같은 정규화.
    const norm = absPath.replace(/\\/g, '/').toLowerCase();
    return snap.topFolders.find(
      (f) => f.bubbleType === 'external_folder' && (f.absolutePath ?? '').toLowerCase() === norm,
    ) as { id: string; satelliteFileCount?: number } | undefined;
  }

  function satelliteCount(folderId: string): number {
    const snap = graph.getSnapshot();
    return (snap.satellites[folderId] ?? []).length;
  }

  // ─── 케이스 1: Read ───
  it('1. Read 외부 파일 → 폴더 + 위성 1개', () => {
    hook({ tool_name: 'Read', tool_input: { file_path: EXT_FILE_A } });
    const f = findExtFolder(EXT_DIR);
    expect(f, `폴더 생성됨? path=${EXT_DIR}`).toBeDefined();
    expect(satelliteCount(f!.id), '위성 1개여야').toBe(1);
  });

  // ─── 케이스 2: Edit ───
  it('2. Edit 외부 파일 → 폴더 + 위성 1개', () => {
    hook({
      tool_name: 'Edit',
      tool_input: { file_path: EXT_FILE_A, old_string: 'foo', new_string: 'baz' },
    });
    const f = findExtFolder(EXT_DIR);
    expect(f).toBeDefined();
    expect(satelliteCount(f!.id)).toBe(1);
  });

  // ─── 케이스 3: Write ───
  it('3. Write 외부 파일 → 폴더 + 위성 1개', () => {
    hook({
      tool_name: 'Write',
      tool_input: { file_path: EXT_FILE_A, content: 'new content' },
    });
    const f = findExtFolder(EXT_DIR);
    expect(f).toBeDefined();
    expect(satelliteCount(f!.id)).toBe(1);
  });

  // ─── 케이스 4: Grep — 결과 N개 (matched files) ───
  it('4. Grep 외부 폴더 (결과 N개, files_with_matches) → 폴더 + 위성 N개', () => {
    // Grep tool_input 의 path 는 외부 폴더, tool_response 는 매치된 파일 경로 목록 (절대경로)
    hook({
      tool_name: 'Grep',
      tool_input: { path: EXT_DIR, pattern: 'content', output_mode: 'files_with_matches' },
      tool_response: {
        content: `${EXT_FILE_A}\n${EXT_FILE_B}\nFound 2 files`,
      },
    });
    const f = findExtFolder(EXT_DIR);
    expect(f, `폴더 생성됨?`).toBeDefined();
    expect(satelliteCount(f!.id), '위성 2개여야').toBe(2);
  });

  // ─── 케이스 5: Grep — 결과 0개 ───
  it('5. Grep 외부 폴더 (결과 0) → §2.1 v2.28 invariant: 외부 폴더 버블 자체가 생성되지 않음', () => {
    hook({
      tool_name: 'Grep',
      tool_input: { path: EXT_DIR, pattern: 'nomatch-pattern', output_mode: 'files_with_matches' },
      tool_response: { content: 'No files found' },
    });
    const f = findExtFolder(EXT_DIR);
    expect(f, '결과 0이면 외부 폴더 버블도 생성하지 않음 (invariant 강제)').toBeUndefined();
  });

  // ─── 케이스 6: Glob — 결과 N개 ───
  it('6. Glob 외부 폴더 (결과 N개) → 폴더 + 위성 N개', () => {
    hook({
      tool_name: 'Glob',
      tool_input: { path: EXT_DIR, pattern: '*.ts' },
      tool_response: { content: `${EXT_FILE_A}\n${EXT_FILE_B}` },
    });
    const f = findExtFolder(EXT_DIR);
    expect(f).toBeDefined();
    expect(satelliteCount(f!.id)).toBe(2);
  });

  // ─── 케이스 7: Glob — 결과 0개 ───
  it('7. Glob 외부 폴더 (결과 0) → §2.1 v2.28 invariant: 외부 폴더 버블 자체가 생성되지 않음', () => {
    hook({
      tool_name: 'Glob',
      tool_input: { path: EXT_DIR, pattern: '*.nomatch' },
      tool_response: { content: 'No files found' },
    });
    const f = findExtFolder(EXT_DIR);
    expect(f, '결과 0이면 외부 폴더 버블도 생성하지 않음 (invariant 강제)').toBeUndefined();
  });

  // ─── 케이스 8: Grep — 결과 경로가 backslash + 상대경로 (Windows native) ───
  it('8. Grep 결과가 backslash 상대경로 (cwd 기준)', () => {
    // 실제 Claude Code Grep on Windows 이 backslash + cwd 상대경로 리턴하는 경우 시뮬레이션
    const relA = path.relative(PROJECT, EXT_FILE_A).replace(/\//g, '\\');
    const relB = path.relative(PROJECT, EXT_FILE_B).replace(/\//g, '\\');
    hook({
      tool_name: 'Grep',
      tool_input: { path: EXT_DIR, pattern: 'content', output_mode: 'files_with_matches' },
      tool_response: { content: `${relA}\n${relB}` },
    });
    const f = findExtFolder(EXT_DIR);
    expect(f, `폴더 생성됨?`).toBeDefined();
    expect(satelliteCount(f!.id), `backslash 상대경로 위성 파싱`).toBe(2);
  });

  // ─── 케이스 9: Grep — 결과가 외부 폴더 하위가 아닌 경로 (extractDirToolFiles 거름) ───
  it('9. Grep 결과 경로 해석이 전부 실패 → §2.1 v2.28 invariant: 폴더 자체 미생성', () => {
    hook({
      tool_name: 'Grep',
      tool_input: { path: EXT_DIR, pattern: 'content', output_mode: 'files_with_matches' },
      tool_response: { content: 'unrelated/file/path/that/does-not-exist.ts' },
    });
    const f = findExtFolder(EXT_DIR);
    expect(f, '파싱 실패 = 결과 0 → 폴더 미생성').toBeUndefined();
  });

  // ─── 케이스 10: Grep content 모드 (path:line:text) ───
  it('10. Grep content 모드 (path:line:text 형식) → 위성 N개', () => {
    hook({
      tool_name: 'Grep',
      tool_input: { path: EXT_DIR, pattern: 'content', output_mode: 'content' },
      tool_response: {
        content: `${EXT_FILE_A}:1:foo content\n${EXT_FILE_B}:1:bar content`,
      },
    });
    const f = findExtFolder(EXT_DIR);
    expect(f).toBeDefined();
    expect(satelliteCount(f!.id)).toBe(2);
  });

  // ─── 케이스 11: 동일 폴더 다른 파일 누적 Read ───
  it('11. 동일 외부 폴더 다른 파일 Read 누적 → 위성 2개', () => {
    hook({ tool_name: 'Read', tool_input: { file_path: EXT_FILE_A } });
    hook({ tool_name: 'Read', tool_input: { file_path: EXT_FILE_B } });
    const f = findExtFolder(EXT_DIR);
    expect(f).toBeDefined();
    expect(satelliteCount(f!.id)).toBe(2);
  });

  // ─── 케이스 12: 외부 디렉토리 자체에 Read (디렉토리 path) ───
  it('12. Read 의 file_path 가 외부 디렉토리 자체 (오용 케이스)', () => {
    hook({ tool_name: 'Read', tool_input: { file_path: EXT_DIR } });
    // Read 는 DIRECTORY_PATH_TOOLS 가 아니라 isDirectory=false 로 처리됨
    // → path.dirname(EXT_DIR) 의 부모 폴더가 external_folder 가 됨, EXT_DIR 자체는 file 노드
    const snap = graph.getSnapshot();
    // EXT_DIR 부모 폴더 (= os.tmpdir 영역) 가 만들어졌는지
    const parentAbs = path.dirname(EXT_DIR).replace(/\\/g, '/');
    const parentFolder = snap.topFolders.find(
      (f) => f.bubbleType === 'external_folder' && f.absolutePath === parentAbs,
    ) as { id: string } | undefined;
    if (parentFolder) {
      expect(satelliteCount(parentFolder.id), '부모 폴더 + 위성 (EXT_DIR 자체)').toBeGreaterThan(0);
    }
  });

  // ─── 케이스 13: tool_response 없는 Grep (legacy / 누락) ───
  it('13. Grep 인데 tool_response 가 비어 있음 → §2.1 v2.28 invariant: 폴더 자체 미생성', () => {
    hook({
      tool_name: 'Grep',
      tool_input: { path: EXT_DIR, pattern: 'foo' },
      // tool_response 없음
    });
    const f = findExtFolder(EXT_DIR);
    expect(f, 'tool_response 누락 = 결과 0 → 폴더 미생성').toBeUndefined();
  });

  // ─── 케이스 14: Bash + cwd 가 외부 폴더 (외부 폴더가 cwd) ───
  it('14. Bash 의 cwd 가 외부 폴더면? (외부 폴더 생성 경로 확인)', () => {
    // Bash 는 SPECIAL_TOOL_TYPES → file path 기반 외부폴더 생성 path 안 거침
    // 외부폴더 버블 안 생성될 것으로 예상
    hook({
      tool_name: 'Bash',
      tool_input: { command: 'ls', cwd: EXT_DIR },
      tool_response: { content: 'foo.ts\nbar.ts' },
    });
    const f = findExtFolder(EXT_DIR);
    expect(f, `Bash 는 외부폴더 안 만들 것으로 예상`).toBeUndefined();
  });
});
