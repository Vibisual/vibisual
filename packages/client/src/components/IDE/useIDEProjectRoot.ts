import { useGraphStore, selectIDEPane } from '../../stores/graphStore.js';
import { useIDEPaneKey } from './idePane.js';

/**
 * useIDEProjectRoot.ts — §5.5 #17-19 ① / #17-27 — 지금 IDE 가 열려 있는 프로젝트의 **절대 경로**.
 *
 * 탐색기(트리 루트)와 편집창(파일 열기·저장의 `root`)이 **같은 뿌리**를 봐야 한다 — 둘이 서로 다른
 * 프로젝트를 가리키면 같은 상대 경로가 다른 파일이 된다. 그래서 판정을 한 곳에 둔다.
 * stub 상태(아직 hydrate 전) 프로젝트도 경로는 알고 있으므로 그쪽을 폴백으로 쓴다.
 */
export function useIDEProjectRoot(): string | null {
  const paneKey = useIDEPaneKey();
  return useGraphStore((s) => {
    const name = selectIDEPane(s, paneKey).projectId ?? s.activeProject;
    if (!name) return null;
    return s.projects[name]?.path ?? s.stubProjects[name]?.project.path ?? null;
  });
}
