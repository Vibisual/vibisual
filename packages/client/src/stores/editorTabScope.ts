import { IDE_EDITOR_MAX_TABS, IDE_EDITOR_TAB_SCOPE_MAX } from '@vibisual/shared';
import type { IDEEditorFile } from './graphStore.js';

// §5.5 #17-27 ⑯ — 탭 줄은 그 세션의 것이다. 세션을 옮기면 떠나는 세션 것은 접고(stash) 가는 세션 것을 편다(restore).
// [고정] 이 켜져 있으면 접지도 펴지도 않고 지금 탭이 따라간다. 전부 순수 함수다.

/** 한 세션이 접어 둔 탭 묶음. 지금 보고 있는 세션 것은 여기 없다 — 그것은 `editorFiles` 다. */
export interface EditorTabStash {
  files: IDEEditorFile[];
  activePath: string | null;
}

/** 이 계산이 읽고 쓰는 창 상태의 최소 모양(창 전체를 알 필요가 없다). */
export interface EditorTabScopeState {
  editorFiles: IDEEditorFile[];
  activeEditorPath: string | null;
  editorPinned: boolean;
  editorTabsBySession: Record<string, EditorTabStash>;
}

/** 접어 둘 때 쓰는 키. 세션 탭이 없는 **전체 보기**(`null`)도 자기 칸을 가진다(#17-27 ⑪ (g) 와 같은 규약). */
export function editorTabScopeKey(sessionId: string | null): string {
  return sessionId ?? 'main';
}

/** 상한은 `openIDEEditorFile` 과 같은 규율 — 저장할 것이 없는 가장 오래된 탭부터 버리고, 전부 고치던 중이면 아무것도 안 버린다. */
function capTabs(files: readonly IDEEditorFile[]): IDEEditorFile[] {
  let kept = [...files];
  while (kept.length > IDE_EDITOR_MAX_TABS) {
    const victim = kept.find((f) => !f.dirty);
    if (!victim) break;
    kept = kept.filter((f) => f.relPath !== victim.relPath);
  }
  return kept;
}

/** 접어 둔 세션 수를 상한 안으로 — 넘으면 **가장 오래전에 접은 것**부터 버린다(키 순서 = 접은 순서). */
function capStashes(stashes: Record<string, EditorTabStash>): Record<string, EditorTabStash> {
  const keys = Object.keys(stashes);
  if (keys.length <= IDE_EDITOR_TAB_SCOPE_MAX) return stashes;
  const next = { ...stashes };
  for (let i = 0; i < keys.length - IDE_EDITOR_TAB_SCOPE_MAX; i += 1) delete next[keys[i]!];
  return next;
}

/** 접어 둘 값을 쓴다. 빈 묶음은 **키 자체를 지운다** — 아무것도 없는 세션이 자리를 먹지 않게. */
function writeStash(
  stashes: Record<string, EditorTabStash>,
  key: string,
  files: readonly IDEEditorFile[],
  activePath: string | null,
): Record<string, EditorTabStash> {
  const next = { ...stashes };
  // 다시 쓰는 키는 **맨 뒤로** 보낸다(방금 떠난 세션이 가장 최근이 되도록 — 상한 정리의 기준).
  delete next[key];
  if (files.length === 0) return next;
  next[key] = { files: files.map((f) => ({ ...f })), activePath };
  return capStashes(next);
}

/** [고정] 이면 지금 탭이 따라가되 떠나는 세션 것은 그래도 접어 둔다 — 안 접으면 그 세션이 빈 편집창으로 돌아온다. */
export function switchEditorTabScope(
  pane: EditorTabScopeState,
  fromSessionId: string | null,
  toSessionId: string | null,
): EditorTabScopeState {
  const fromKey = editorTabScopeKey(fromSessionId);
  const toKey = editorTabScopeKey(toSessionId);
  if (fromKey === toKey) return pane;

  const stashed = writeStash(pane.editorTabsBySession, fromKey, pane.editorFiles, pane.activeEditorPath);
  if (pane.editorPinned) {
    return { ...pane, editorTabsBySession: stashed };
  }

  const restored = stashed[toKey];
  const rest = { ...stashed };
  // 편 묶음은 접어 둔 자리에서 뺀다 — 두 곳에 같은 탭이 살면 어느 쪽이 진짜인지 알 수 없다.
  delete rest[toKey];
  const files = restored ? restored.files.map((f) => ({ ...f })) : [];
  const activePath = restored && files.some((f) => f.relPath === restored.activePath)
    ? restored.activePath
    : (files[0]?.relPath ?? null);
  return { ...pane, editorFiles: files, activeEditorPath: activePath, editorTabsBySession: rest };
}

/**
 * [고정] 을 끌 때는 지금 탭이 이 세션의 것이 되고(입양) 이 세션이 접어 둔 탭은 뒤에 이어 붙는다(합집합 — 저장 안 한 편집을 버리지 않게).
 * 상한을 넘으면 ③ 규율로 안 고친 것부터 밀린다.
 */
export function setEditorTabsPinned(pane: EditorTabScopeState, pinned: boolean, sessionId: string | null): EditorTabScopeState {
  if (pane.editorPinned === pinned) return pane;
  if (pinned) return { ...pane, editorPinned: true };

  const key = editorTabScopeKey(sessionId);
  const mine = pane.editorTabsBySession[key];
  const rest = { ...pane.editorTabsBySession };
  delete rest[key];
  if (!mine) return { ...pane, editorPinned: false, editorTabsBySession: rest };

  const open = new Set(pane.editorFiles.map((f) => f.relPath));
  const merged = capTabs([...pane.editorFiles, ...mine.files.filter((f) => !open.has(f.relPath))]);
  const kept = new Set(merged.map((f) => f.relPath));
  const activePath = pane.activeEditorPath !== null && kept.has(pane.activeEditorPath)
    ? pane.activeEditorPath
    : (merged[0]?.relPath ?? null);
  return { ...pane, editorPinned: false, editorFiles: merged, activeEditorPath: activePath, editorTabsBySession: rest };
}

/** 사라진 세션이 접어 둔 탭은 걷는다 — 남으면 다시는 펴지지 않고 자리만 먹는다(#17-34 ⑧ 과 같은 결). */
export function pruneEditorTabScopes(
  stashes: Record<string, EditorTabStash>,
  liveSessionIds: readonly string[],
): Record<string, EditorTabStash> {
  const live = new Set<string>(liveSessionIds.map((id) => editorTabScopeKey(id)));
  live.add(editorTabScopeKey(null)); // 전체 보기 칸은 세션 목록과 무관하게 언제나 살아 있다.
  const next: Record<string, EditorTabStash> = {};
  let dropped = false;
  for (const [key, value] of Object.entries(stashes)) {
    if (live.has(key)) next[key] = value;
    else dropped = true;
  }
  return dropped ? next : stashes;
}
