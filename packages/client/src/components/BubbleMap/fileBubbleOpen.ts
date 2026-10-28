import type { BubbleData } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { activeProjectRoot, faceSourcePath, fileFaceOf, fileFaceOpenPlan, fileMediaTarget } from '../../utils/fileFaceView.js';
import { openAppWindow } from '../../apps/appWindows.js';
import { openExternally, openWorkspaceTarget } from '../IDE/openWorkspaceTarget.js';
import { openFileInFileWindow } from '../IDE/fileWindowOpen.js';

/**
 * §5.1 #2-1 (A) — 파일 버블 더블클릭은 그 파일을 우리 앱 안에서 연다(어디 있든 같고, 폴더·묶음 안으로 들어가지 않는다). 캔버스와 IDE 세션 지도(§5.5 #17-50)가 같이 쓴다.
 * 순서는 `fileFaceOpenPlan`: 받는 앱(`openAppWindow` — 프로젝트 밖은 보기 전용 앱만) → 변환이 필요한 영상·소리(§5.13 (R-8)) → 판(코드·웹·그림·PDF)
 * → OS 연결 프로그램(못 열면 여기로 — 무반응보다 낫다). 판 자리만 부르는 쪽이 고른다(`openPane`): 캔버스는 따로 선 파일 창(§5.5 #17-27 ⑳), IDE 지도는 오른쪽 편집 판.
 */
export function openFileBubble(
  data: Pick<BubbleData, 'bubbleType' | 'absolutePath' | 'path' | 'label'>,
  openPane: (absPath: string) => boolean = openFileInFileWindow,
): void {
  const store = useGraphStore.getState();
  const face = fileFaceOf(data);
  const target = fileMediaTarget(data.absolutePath, Object.values(store.projects).map((p) => p.path), activeProjectRoot(store));
  const plan = fileFaceOpenPlan(face, target, faceSourcePath(data));
  if (plan.route === 'app' && target !== null
    && openAppWindow({ appId: plan.appId, projectId: target.root, file: target.rel })) return;
  if (plan.route === 'convert' && target !== null && data.absolutePath) {
    // 실행 여부를 싣지 않으므로 실행 갈래로 가지 않는다 — 실행 실패 안내 문구는 쓰일 일이 없다.
    void openWorkspaceTarget({ relPath: target.rel, absPath: data.absolutePath, kind: 'file' }, target.root, '');
    return;
  }
  if (plan.route === 'pane' && data.absolutePath && openPane(data.absolutePath)) return;
  if (data.absolutePath) void openExternally(data.absolutePath);
}
