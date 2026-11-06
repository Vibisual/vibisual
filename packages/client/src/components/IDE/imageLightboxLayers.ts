import type { ImageLightboxState } from '../../stores/graphStore.js';
import { mediaFileName } from '../../utils/workspaceMedia.js';
import { openInLayerEditor, type LayerEditPicture } from '../Vibimage/layerEditHandoff.js';

/**
 * §5.5 #17-25 ④-3 — IDE 쪽 빠른 편집의 [레이어 편집]. 원본 루트는 그 파일의 루트 → 없으면 그 칸의 프로젝트이고, 둘 다 없으면
 * 단추를 그리지 않는다(`undefined`). 넘기는 것은 늘 구운 PNG 다 — 첨부·보낸 그림은 프로젝트 파일이 아니라 가져갈 원본이 없다.
 */
export function lightboxLayerOpener(
  state: ImageLightboxState,
  projectRoot: string | null,
  fallbackName: string,
  open: (projectId: string, picture: LayerEditPicture) => boolean = openInLayerEditor,
): ((png: Blob) => void) | undefined {
  const root = state.workspace?.root ?? projectRoot;
  if (!root) return undefined;
  const file = state.workspace?.path;
  const name = file ? mediaFileName(file) : fallbackName;
  return (png) => { open(root, { blob: png, name, ...(file ? { original: file } : {}) }); };
}
