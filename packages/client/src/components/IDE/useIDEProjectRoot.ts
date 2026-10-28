import { useGraphStore, selectPaneProjectPath } from '../../stores/graphStore.js';
import { useIDEPaneKey } from './idePane.js';

/**
 * §5.5 #17-19 ① / #17-27 — IDE 프로젝트의 절대 경로(탐색기·편집창이 같은 뿌리를 보게 한 곳에, stub 도 경로로 폴백).
 * §5.7 #26 — 뿌리는 탭(`pane.projectId`)이 아니라 **에이전트의 소속 프로젝트**다 — 섞으면 워크트리 버블이 부모 트리 파일을 연다.
 */
export function useIDEProjectRoot(): string | null {
  const paneKey = useIDEPaneKey();
  return useGraphStore((s) => selectPaneProjectPath(s, paneKey));
}
