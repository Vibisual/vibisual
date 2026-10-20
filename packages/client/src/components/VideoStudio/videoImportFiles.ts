/**
 * §5.13 (Y) 40-4 — 가져온 파일 묶음을 스튜디오 소재로 고르기 전에 다듬는다. **모델 파일이 있을 때만** 모델 해독기(three.js ·
 * glTF/FBX 읽개 — 약 2MB)를 불러온다. 종전에는 가져오기 손잡이 셋이 `videoModelImport.ts` 를 정적으로 불러 그 2MB 가 스튜디오의
 * 첫 청크에 묶였다(모델을 한 번도 안 쓰는 문서도 그 비용을 냈다).
 */
const MODEL_FILE = /\.(glb|gltf)$/i;

export async function prepareVideoImports(files: readonly File[]): Promise<File[]> {
  if (!files.some((file) => MODEL_FILE.test(file.name))) return [...files];
  const { prepareVideoImports: prepareWithModels } = await import('./videoModelImport.js');
  return prepareWithModels(files);
}
