import { prepareVideoImports } from './videoImportFiles.js';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  VIDEO_FORMATS,
  findRecipe,
  resolveTimeline,
  type VideoAsset,
  type VideoDoc,
  type VideoDocOp,
  type VideoFormatId,
} from '@vibisual/video';

import { captionOpsFromFile } from './videoCaptions.js';
import { measureAssets } from './useVideoRenderer.js';
import { importVideoAsset, patchDoc } from './videoApi.js';
import { uploadMaterial } from './studioApi.js';
import { withStudioAgentContext } from './studioAgentMessage.js';
import { importProjectScreens } from './captureScreens.js';
import type { StudioDoc } from './useStudioDoc.js';
import type { StudioAgent } from './useStudioAgent.js';
import type { RailDrawer } from './StudioRail.js';
import { MEDIA_IMPORT_LIMIT } from './useStudioEditing.js';

/**
 * §5.13 (V) 37-2 — 시작 화면의 상태와 보내기: 문서가 없으면 만들고(판형·제목) 빈 문서면 그것을 쓴다 → 끌어 놓은 재료를 들인다(미디어는 소재, SRT 는 자막, CSV·JSON·SVG 는 프로젝트 안 재료)
 * → '이 앱 소개'면 이 프로젝트의 실제 화면도 소재로 → 영상용 에이전트를 잇고 기획 바퀴를 보낸다(`useStudioAgent.send`). '빈 문서' 레시피는 AI 를 부르지 않고 부품 서랍을 연다.
 * 시작 준비(판형·재료)는 되돌리기 이력에 넣지 않는다 — 되돌릴 앞 판이 없고, `useVideoEdits` 는 새 문서가 그려지기 전까지 옛 문서를 봐 그 길로 쓰면 "문서가 바뀌었다"로 끝난다.
 * 받은 판본으로 서버 패치를 직접 잇고(낙관적 잠금 그대로) 끝에 한 번 화면에 앉힌다.
 */
export interface StartMaterialFile {
  readonly id: string;
  readonly file: File;
}

const MEDIA_RE = /\.(mp4|webm|mov|m4v|mp3|wav|ogg|m4a|flac|aac|png|jpe?g|webp|gif|avif|glb|gltf|vibi3d|vibimage)$/i;
/** 제목으로 쓸 첫 줄의 길이 상한(글자). */
const TITLE_MAX = 40;

function titleFrom(text: string): string {
  const first = text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1)}…` : first;
}

function isEmptyDoc(doc: VideoDoc): boolean {
  return doc.tracks.every((t) => t.items.length === 0) && (doc.chapters?.length ?? 0) === 0;
}

export function useStudioStart(d: {
  projectName: string;
  projectRoot: string;
  studio: StudioDoc;
  agent: StudioAgent;
  onError: (err: unknown) => void;
  /** 보냈다 — 그 문서의 편집 화면으로 넘어간다(기획이 올 때까지 빈 미리보기가 "기획 중" 을 말한다). */
  onSent: (docId: string) => void;
  /** 빈 문서 레시피 — 시작 화면을 거두고 그 문서의 편집 화면을 서랍과 함께 연다. */
  openEditor: (docId: string, drawer: RailDrawer) => void;
}) {
  const { t } = useTranslation();
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [format, setFormat] = useState<VideoFormatId>('landscape');
  const [length, setLength] = useState(30);
  const [materials, setMaterials] = useState<readonly StartMaterialFile[]>([]);
  const [busy, setBusy] = useState(false);

  const onRecipe = useCallback((id: string | null): void => {
    setRecipeId(id);
    const recipe = findRecipe(id ?? undefined);
    if (recipe) { setFormat(recipe.defaultFormat); setLength(recipe.defaultLength); }
  }, []);

  const addMaterials = useCallback((files: readonly File[]): void => {
    setMaterials((prev) => [...prev, ...files.map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}`, file }))]
      .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i));
  }, []);

  /** 끌어 놓은 재료를 그 문서에 들일 연산과, 들인 소재·재료 경로를 만든다. */
  const ingest = useCallback(async (doc: VideoDoc): Promise<{ assets: VideoAsset[]; paths: string[]; ops: VideoDocOp[] }> => {
    const assets: VideoAsset[] = [];
    const paths: string[] = [];
    const ops: VideoDocOp[] = [];
    if (materials.reduce((sum, material) => sum + material.file.size, 0) > MEDIA_IMPORT_LIMIT) throw new Error(t('panel.videoStudio.editor.fileTooLarge'));
    for (const file of await prepareVideoImports(materials.map(material => material.file))) {
      // §5.13 (W) 38-6 — SRT·VTT·낱말 시각 JSON 은 자막으로(JSON 이 낱말 모양이 아니면 아래에서 재료로).
      const captionOps = await captionOpsFromFile(doc, file);
      if (captionOps) { ops.push(...captionOps); continue; }
      if (!MEDIA_RE.test(file.name)) { paths.push(await uploadMaterial(d.projectName, file)); continue; }
      if (file.size > MEDIA_IMPORT_LIMIT) throw new Error(t('panel.videoStudio.editor.fileTooLarge'));
      const imported = await importVideoAsset(d.projectName, file);
      const measured = imported.kind === 'image' ? undefined : (await measureAssets(d.projectName, [imported]))[imported.id];
      const asset: VideoAsset = {
        ...imported,
        ...(measured?.duration ? { duration: measured.duration } : {}),
        ...(measured?.width ? { width: measured.width } : {}),
        ...(measured?.height ? { height: measured.height } : {}),
        ...(measured?.hasAudio !== undefined ? { hasAudio: measured.hasAudio } : {}),
      };
      assets.push(asset);
      ops.push({ op: 'setAsset', asset });
    }
    return { assets, paths, ops };
  }, [materials, d.projectName, t]);

  const submit = useCallback(async (live?: string): Promise<void> => {
    const text = (live ?? prompt).trim();
    const recipe = findRecipe(recipeId ?? undefined);
    if (busy || (!recipe && text === '')) return;
    setBusy(true);
    const pending = d.studio.pendingWork;
    pending.current += 1;
    try {
      const size = VIDEO_FORMATS[format];
      const recipeName = recipe ? t(`panel.videoStudio.recipes.${recipe.id}.name`) : '';
      const title = titleFrom(text) || recipeName || t('panel.videoStudio.untitled');
      let doc = d.studio.doc;
      if (doc && isEmptyDoc(doc)) {
        // 비어 있는 문서(빈 문서로 연 창 등)는 그대로 쓴다 — 판형과(아직 기본 이름이면) 제목만 맞춘다.
        const patch = { size: { width: size.width, height: size.height }, ...(doc.title === t('panel.videoStudio.untitled') ? { title } : {}) };
        doc = (await patchDoc(d.projectName, doc.id, doc.version, [{ op: 'setDoc', patch }])).doc;
      } else {
        doc = await d.studio.createDoc(title, [{ op: 'setDoc', patch: { size: { width: size.width, height: size.height } } }]);
      }
      if (!doc) return;
      if (recipe?.direct) {
        d.studio.setDoc(doc);
        d.openEditor(doc.id, 'parts');
        setPrompt(''); setRecipeId(null);
        return;
      }
      const ingested = await ingest(doc);
      const ops = [...ingested.ops];
      const assets = [...ingested.assets];
      // '이 앱 소개' — 이 프로젝트의 실제 화면(캡처 버블·loopback 프리뷰)을 소재로 함께 들인다(못 찍으면 건너뛴다).
      if (recipe?.wants.includes('screens')) {
        const screens = await importProjectScreens(d.projectName, d.projectRoot);
        for (const asset of screens) { assets.push(asset); ops.push({ op: 'setAsset', asset }); }
      }
      if (ops.length > 0) doc = (await patchDoc(d.projectName, doc.id, doc.version, ops)).doc;
      d.studio.setDoc(doc);
      const target = doc;
      const note = text !== '' ? text : recipeName;
      await d.agent.send({
        request: note,
        mode: 'plan',
        doc: { id: target.id, title: target.title },
        compose: (passId) => withStudioAgentContext(note, {
          projectName: d.projectName,
          doc: { id: target.id, title: target.title, version: target.version, size: target.size },
          playhead: 0,
          duration: resolveTimeline(target).duration,
          passId,
          mode: 'plan',
          attached: assets,
          materials: ingested.paths,
          format,
          lengthSec: length,
          ...(recipe ? { recipe: { id: recipe.id, prompt: recipe.prompt } } : {}),
        }),
      });
      setPrompt(''); setMaterials([]); setRecipeId(null);
      d.onSent(target.id);
    } catch (err) {
      d.onError(err);
    } finally {
      pending.current -= 1;
      setBusy(false);
    }
  }, [prompt, recipeId, busy, format, length, d, t, ingest]);

  return {
    recipeId, onRecipe, prompt, setPrompt, format, setFormat, length, setLength, materials, addMaterials,
    removeMaterial: (id: string) => setMaterials((prev) => prev.filter((m) => m.id !== id)), busy, submit,
  };
}

export type StudioStartState = ReturnType<typeof useStudioStart>;
