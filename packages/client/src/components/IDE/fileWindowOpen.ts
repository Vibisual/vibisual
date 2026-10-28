/**
 * §5.5 #17-27 ⑳ 파일 창(IDE [오른쪽에 표시] 판을 밖에 세운 창, 캔버스 파일 버블 더블클릭 §5.1 #2-1 (A))을 여닫는 문.
 * IDE 와 같은 슬롯 규약(`ideOverlays[슬롯키]`)·`openIDEEditorFile` 이라 `IDEEditorPane` 이 그대로 선다. 주인은 지금 탭의 프로젝트, 루트 밖은 절대경로 탭(보기만 — ⑥).
 */
import { useGraphStore } from '../../stores/graphStore.js';
import { fileWindowSlotKey, useFileWindowsStore } from '../../stores/fileWindows.js';
import { guardIDEEditorClose } from '../../stores/ideEditorClose.js';
import { editorFileFromAbsPath } from './editorModel.js';
import type { EditorLineRange } from './editorLineRange.js';

/**
 * 파일 창에 연다(없으면 세우고, 있으면 탭을 더해 — 열린 파일이면 그 탭 — 앞으로).
 * @returns 열었으면 true, 지금 탭의 프로젝트 경로를 모르면 false(부르는 쪽이 연결 프로그램으로).
 */
export function openFileInFileWindow(absPath: string, lines?: EditorLineRange | null): boolean {
  const graph = useGraphStore.getState();
  const projectName = graph.activeProject;
  if (!projectName || absPath === '') return false;
  const projectRoot = graph.projects[projectName]?.path ?? graph.stubProjects[projectName]?.project.path ?? null;
  if (!projectRoot) return false;
  const slotKey = fileWindowSlotKey(projectName);
  graph.ensureFileWindowSlot(slotKey, projectName);
  useGraphStore.getState().openIDEEditorFile(editorFileFromAbsPath(absPath, projectRoot), slotKey, lines ?? null);
  useFileWindowsStore.getState().show({ id: slotKey, projectName, projectRoot });
  return true;
}

/** 창과 판 자리를 함께 걷는다(확인 없이 — 확인은 부르는 쪽이 이미 거쳤다). */
export function dropFileWindow(id: string): void {
  useGraphStore.getState().dropFileWindowSlot(id);
  useFileWindowsStore.getState().close(id);
}

/** 파일 창 [닫기] — 초안이 있으면 IDE 창과 같은 확인(`guardIDEEditorClose`)을 거친다. 확인하는 사이 창이 닫혔으면 아무것도 안 한다. */
export function closeFileWindow(id: string): void {
  guardIDEEditorClose(id, () => {
    const slot = useGraphStore.getState().ideOverlays[id];
    if (!slot) return {};
    const files = [...slot.editorFiles, ...Object.values(slot.editorTabsBySession).flatMap((stash) => stash.files)];
    return Object.fromEntries(files.filter((file) => file.dirty).map((file) => [file.relPath, file.absPath]));
  }, () => !!useGraphStore.getState().ideOverlays[id], () => dropFileWindow(id));
}
