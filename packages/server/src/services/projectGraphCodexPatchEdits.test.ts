/**
 * §5.25 (F) "쓴 내용도 남는다" — 코덱스가 고친 파일을 눌렀을 때 **쓴 내용이 보이는가**(그래프 끝까지).
 *
 * 사고(사용자 보고 2026-10-20, 스크린샷): `components` 폴더에서 `pathlin…nu.ts` 로 쓰기 화살표가 서 있는데
 * 그 파일을 눌러도 상세 칸의 수정 기록이 비어 있었다. 실측 — 노드는 `lastTool: Write`·`writeCount: 1` 인데
 * `fileEdits` 에는 그 파일이 한 줄도 없었다. 코덱스의 `file_change` 는 경로만 싣고, 우리는 그것을 내용 없는
 * 사후 `Write` 로 옮겨 `recordFileEdit` 이 버렸다.
 *
 * 여기서는 방출기(`index.ts` `setLocalHookEmitter`)의 순서를 그대로 밟는다 — 사후 쓰기를 `toLocalHookPayload`
 * 로 바꿔 `processHookEvent`(버블·화살표) → 같은 세션으로 `recordProviderFileEdit`(이력). 장부는 실제 것을 써서
 * "사전 훅이 적고 → 완료가 꺼내고 → 그 버블의 이력이 된다"를 한 사슬로 고정한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BubbleData, FileEdit, ProjectCheckpoint } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { CodexPatchEditLedger } from './codexPatchEdits.js';
import { toLocalHookPayload } from './localHookPayload.js';
import type { LocalHookToolEvent } from './localRunner.js';

let projRoot: string;
let projName: string;

const SESSION = 'sess-codex-patch-1';
const SUB = 'sub-codex-patch-1';

/** 사진 속 실제 변경 — 주석 한 줄. */
const OLD_LINE = '  /** `POST /api/reveal-path` — 파일이면 그 파일이 든 폴더. */';
const NEW_LINE = '  /** `POST /api/reveal-path` — 파일이면 상위 폴더에서 해당 파일 선택. */';

beforeEach(() => {
  projRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-codexpatch-')));
  projName = path.basename(projRoot);
  fs.mkdirSync(path.join(projRoot, 'src', 'components', 'IDE'), { recursive: true });
});

afterEach(() => {
  try { fs.rmSync(projRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

function makeGraph(): ProjectGraph {
  const graph = new ProjectGraph();
  graph.registerProject(projRoot);
  return graph;
}

/** index.ts 방출기와 같은 순서 — 노드를 세운 **뒤에** 이력을 붙인다. */
function emit(graph: ProjectGraph, event: LocalHookToolEvent): boolean {
  const payload = toLocalHookPayload(SESSION, event);
  graph.processHookEvent(payload);
  const filePath = payload.tool_input?.['file_path'];
  if (event.phase !== 'post' || !event.fileEdit || typeof filePath !== 'string') return false;
  return graph.recordProviderFileEdit(SESSION, filePath, event.fileEdit);
}

/** subAgentManager `onFileWrites` 와 같은 모양의 사후 쓰기(경로만). */
function fileWrite(abs: string, seq: number, fileEdit?: LocalHookToolEvent['fileEdit']): LocalHookToolEvent {
  return {
    phase: 'post',
    toolName: 'Write',
    toolInput: { path: abs },
    toolUseId: `codex-file-${SUB}-${seq}`,
    cwd: projRoot,
    toolResponse: '',
    ...(fileEdit ? { fileEdit } : {}),
  };
}

function patchOf(...files: { rel: string; minus: string; plus: string }[]): string {
  const body: string[] = ['*** Begin Patch'];
  for (const f of files) body.push(`*** Update File: ${f.rel}`, '@@', ' export interface OutsidePathLinkMenuHandlers {', `-${f.minus}`, `+${f.plus}`);
  body.push('*** End Patch');
  return body.join('\n');
}

function fileNode(cp: ProjectCheckpoint, name: string): BubbleData {
  const node = Object.values(cp.graph.nodes)
    .find((n) => n.bubbleType === 'file' && n.label.toLowerCase() === name.toLowerCase());
  if (!node) throw new Error(`파일 노드가 없다: ${name}`);
  return node;
}

function editsOf(graph: ProjectGraph, node: BubbleData): FileEdit[] {
  return graph.getSnapshot().fileEdits?.[node.id] ?? [];
}

describe('사고의 모양 — 경로만 실린 쓰기', () => {
  it('버블과 쓰기 표시는 서지만 이력은 비어 있다(장부가 비면 지어내지 않는다)', () => {
    const graph = makeGraph();
    const target = path.join(projRoot, 'src', 'components', 'IDE', 'pathLinkContextMenu.ts');
    fs.writeFileSync(target, 'after\n', 'utf8');

    expect(emit(graph, fileWrite(target, 1))).toBe(false);

    const node = fileNode(graph.toProjectCheckpoint(projName), 'pathLinkContextMenu.ts');
    expect(node.lastTool).toBe('Write');
    expect(editsOf(graph, node)).toEqual([]);
  });
});

describe('§5.25 (F) 쓴 내용도 남는다', () => {
  it('사전 훅이 적은 덩어리가 그 파일 버블의 수정 이력이 되고 체크포인트에도 실린다', () => {
    const graph = makeGraph();
    const ledger = new CodexPatchEditLedger();
    const target = path.join(projRoot, 'src', 'components', 'IDE', 'pathLinkContextMenu.ts');
    fs.writeFileSync(target, 'after\n', 'utf8');

    // 사전 훅(적용 전) — 머리줄은 상대경로로 와도 그 턴의 작업 폴더로 올라간다.
    ledger.note(SUB, {
      cwd: projRoot,
      toolName: 'apply_patch',
      toolInput: { command: patchOf({ rel: 'src/components/IDE/pathLinkContextMenu.ts', minus: OLD_LINE, plus: NEW_LINE }) },
      toolUseId: 'call-40f1',
    });
    // 완료(`file_change`) — 코덱스는 절대경로로 알린다.
    expect(emit(graph, fileWrite(target, 1, ledger.take(SUB, target, projRoot) ?? undefined))).toBe(true);

    const cp = graph.toProjectCheckpoint(projName);
    const node = fileNode(cp, 'pathLinkContextMenu.ts');
    expect(node.lastTool).toBe('Write');
    const edits = editsOf(graph, node);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      oldString: `export interface OutsidePathLinkMenuHandlers {\n${OLD_LINE}`,
      newString: `export interface OutsidePathLinkMenuHandlers {\n${NEW_LINE}`,
      filePath: target.replace(/\\/g, '/'),
    });
    expect(edits[0]!.id.startsWith('call-40f1:')).toBe(true);
    // 껐다 켜도 남는다 — 이력은 다른 이력과 같은 영속 자리(activity)를 탄다.
    const persisted = Object.values(cp.activity.fileEdits ?? {}).flat();
    expect(persisted.some((e) => e.id === edits[0]!.id)).toBe(true);
  });

  it('한 패치가 두 파일을 고치면 파일마다 자기 이력만 붙는다', () => {
    const graph = makeGraph();
    const ledger = new CodexPatchEditLedger();
    const a = path.join(projRoot, 'src', 'components', 'IDE', 'pathLinkContextMenu.ts');
    const b = path.join(projRoot, 'src', 'components', 'IDE', 'useWorkspaceExplorer.ts');
    fs.writeFileSync(a, 'a\n', 'utf8');
    fs.writeFileSync(b, 'b\n', 'utf8');
    ledger.note(SUB, {
      cwd: projRoot,
      toolName: 'apply_patch',
      toolInput: {
        command: patchOf(
          { rel: a, minus: 'old-a', plus: 'new-a' },
          { rel: b, minus: 'old-b', plus: 'new-b' },
        ),
      },
      toolUseId: 'call-two',
    });
    emit(graph, fileWrite(a, 1, ledger.take(SUB, a, projRoot) ?? undefined));
    emit(graph, fileWrite(b, 2, ledger.take(SUB, b, projRoot) ?? undefined));

    const cp = graph.toProjectCheckpoint(projName);
    const ea = editsOf(graph, fileNode(cp, 'pathLinkContextMenu.ts'));
    const eb = editsOf(graph, fileNode(cp, 'useWorkspaceExplorer.ts'));
    expect(ea.map((e) => e.newString)).toEqual(['export interface OutsidePathLinkMenuHandlers {\nnew-a']);
    expect(eb.map((e) => e.newString)).toEqual(['export interface OutsidePathLinkMenuHandlers {\nnew-b']);
  });

  it('같은 id 는 두 번 붙지 않고, 바뀐 것이 없는 덩어리는 적지 않는다', () => {
    const graph = makeGraph();
    const target = path.join(projRoot, 'src', 'components', 'IDE', 'pathLinkContextMenu.ts');
    fs.writeFileSync(target, 'x\n', 'utf8');
    const edit = { id: 'call-dup:k', oldString: 'x', newString: 'y' };
    expect(emit(graph, fileWrite(target, 1, edit))).toBe(true);
    expect(graph.recordProviderFileEdit(SESSION, target, edit)).toBe(false);
    expect(graph.recordProviderFileEdit(SESSION, target, { id: 'call-same:k', oldString: 'same', newString: 'same' })).toBe(false);
    expect(editsOf(graph, fileNode(graph.toProjectCheckpoint(projName), 'pathLinkContextMenu.ts'))).toHaveLength(1);
  });
});
