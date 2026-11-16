/**
 * §5.13 (AA) 42-2 — 먼저 `.vibisual/video/out/` 에 쓴다(캔버스 노드 담기·판 기록·[받기]가 그 파일에 기댄다). 고른 폴더는 하드 링크(같은 디스크 — 용량을 두 번 쓰지 않는다), 안 되면 복사.
 * 전부 비동기다(§3.7 — 큰 동기 쓰기는 창을 멈춘다). 고른 폴더에 못 써도 렌더는 성공 — `exportNote` 로 알린다.
 * §5.13 (AA) 42-13 — 딸림 파일(썸네일·챕터 목록·자막)은 영상과 같은 줄기로 한 묶음이다(이름 번호·옮기기·덮어쓰기를 함께).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathKey, type PlatformName } from '@vibisual/shared';

import { EXPORT_COMPANION_SUFFIX } from '../constants.js';
import { buildChapterList, wantsSubtitleFile, type CompanionKind, type CompanionNote } from '../exportExtras.js';
import { buildRenderFileName, sanitizeFileName } from '../exportNames.js';
import { renderExtension, scaledSize, type RenderOutputSpec, type RenderSpec } from '../renderSpec.js';
import { formatOfSize } from '../formats.js';
import { resolveTimeline } from '../resolveTimeline.js';
import { buildSrt } from '../srt.js';
import type { VideoDoc } from '../types.js';
import { companionPath, linkOrCopy, placeNumberedSet, writeNewFile } from './exportOutputFiles.js';

export { linkOrCopy } from './exportOutputFiles.js';

export type PlaceInput = {
  readonly outDir: string;
  readonly docId: string;
  readonly title: string | null;
  readonly spec: RenderSpec | null;
  readonly output: RenderOutputSpec | null;
  /** 투명 배경 렌더(설정 없이 걸린 종전 일감 — 확장자만 가른다). */
  readonly legacyExt: 'mp4' | 'webm';
  readonly doc: VideoDoc | null;
  readonly now: Date;
  /** §5.13 (AA) 42-13 — 일꾼이 찍어 온 썸네일(PNG). 켰는데 없으면 그 사실을 `companionNotes` 에 남긴다. */
  readonly thumbnail?: Uint8Array | null;
} & ({ readonly bytes: Uint8Array; readonly sourceFile?: never } | { readonly bytes?: never; readonly sourceFile: string });

export interface PlaceResult {
  /** 종전 자리의 파일(일감 `result`). */
  readonly result: string;
  /** 사용자가 보는 파일 — 고른 폴더의 것, 없으면 `result`. */
  readonly exported: string;
  readonly exportNote?: { code: 'export-failed' | 'overwrite-fallback'; detail?: string };
  /** §5.13 (AA) 42-13 — 함께 나온 딸림 파일(사용자가 보는 자리의 경로). */
  readonly companions?: Partial<Record<CompanionKind, string>>;
  /** 켰지만 나오지 않은 딸림 파일의 까닭. */
  readonly companionNotes?: readonly CompanionNote[];
}

function stemOf(fileName: string): string {
  const ext = path.extname(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

/** 이름 규칙을 풀어 다듬은 이름(확장자 앞). 규칙이 없으면 null(종전 이름). */
function templatedBase(input: PlaceInput): string | null {
  if (!input.output) return null;
  const doc = input.doc;
  const size = doc ? scaledSize(doc.size, input.spec?.scale ?? 1) : { width: 0, height: 0 };
  const title = doc?.title ?? input.title ?? input.docId;
  const name = buildRenderFileName(input.output.fileName, {
    title,
    docId: input.docId,
    format: doc ? formatOfSize(doc.size) : null,
    width: size.width,
    height: size.height,
    fps: input.spec?.fps ?? doc?.fps ?? 0,
    scene: input.output.scene,
    index: input.output.index,
    at: input.now,
  });
  return sanitizeFileName(name, title);
}

interface Companion {
  readonly kind: CompanionKind;
  readonly suffix: string;
  readonly data: string | Uint8Array;
}

/** 이 렌더가 함께 낼 딸림 파일과, 켰지만 낼 것이 없는 까닭. 빈 파일은 만들지 않는다. */
function gatherCompanions(input: PlaceInput): { files: Companion[]; notes: CompanionNote[] } {
  const extras = input.output?.extras ?? null;
  const range = input.spec?.range ?? null;
  const files: Companion[] = [];
  const notes: CompanionNote[] = [];
  const timeline = input.doc ? resolveTimeline(input.doc) : null;
  if (wantsSubtitleFile(extras, input.spec?.captions)) {
    const text = input.doc && timeline ? buildSrt(input.doc, timeline, range) : '';
    if (text.trim() === '') notes.push('subtitles-empty');
    else files.push({ kind: 'subtitles', suffix: EXPORT_COMPANION_SUFFIX.subtitles, data: text });
  }
  if (extras?.thumbnail === true) {
    if (input.thumbnail && input.thumbnail.length > 0) files.push({ kind: 'thumbnail', suffix: EXPORT_COMPANION_SUFFIX.thumbnail, data: input.thumbnail });
    else notes.push('thumbnail-failed');
  }
  if (extras?.chapters === true) {
    const text = timeline ? buildChapterList(timeline, range, input.output?.chapterLabel ?? null) : '';
    if (text === '') notes.push('chapters-empty');
    else files.push({ kind: 'chapters', suffix: EXPORT_COMPANION_SUFFIX.chapters, data: text });
  }
  return { files, notes };
}

/** 결과에 싣는 딸림 파일 자리(사용자가 보는 영상 옆). */
function companionResult(exported: string, files: readonly Companion[], notes: readonly CompanionNote[]): Pick<PlaceResult, 'companions' | 'companionNotes'> {
  const companions: Partial<Record<CompanionKind, string>> = {};
  for (const file of files) companions[file.kind] = companionPath(exported, file.suffix);
  return { ...(files.length > 0 ? { companions } : {}), ...(notes.length > 0 ? { companionNotes: notes } : {}) };
}

export async function placeRenderOutput(input: PlaceInput, platform: PlatformName): Promise<PlaceResult> {
  const ext = input.spec ? renderExtension(input.spec) : input.legacyExt;
  await fs.promises.mkdir(input.outDir, { recursive: true });
  const base = templatedBase(input);
  const { files, notes } = gatherCompanions(input);
  const suffixes = files.map((file) => file.suffix);
  const result = await placeNumberedSet(input.outDir, base ?? `${input.docId}-${input.now.getTime()}`, ext, suffixes, (file, index) => {
    const companion = files[index - 1];
    if (companion) return writeNewFile(file, companion.data);
    return input.sourceFile === undefined ? writeNewFile(file, input.bytes) : linkOrCopy(input.sourceFile, file);
  });
  /** 종전 자리에 놓인 딸림 파일(고른 폴더로 옮길 원본). */
  const local = suffixes.map((suffix) => companionPath(result, suffix));
  const here: PlaceResult = { result, exported: result, ...companionResult(result, files, notes) };

  const dirRaw = input.output?.dir ?? null;
  if (!dirRaw) return here;
  if (!path.isAbsolute(dirRaw)) return { ...here, exportNote: { code: 'export-failed', detail: 'not an absolute folder' } };
  const dir = path.resolve(dirRaw);
  if (pathKey(dir, platform) === pathKey(path.resolve(input.outDir), platform)) return here;

  const exportBase = base ?? stemOf(path.basename(result));
  let note: PlaceResult['exportNote'];
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    let target = path.join(dir, `${exportBase}.${ext}`);
    const placeNumbered = (): Promise<string> => placeNumberedSet(dir, exportBase, ext, suffixes,
      (file, index) => linkOrCopy(local[index - 1] ?? result, file));
    if (input.output?.conflict === 'overwrite') {
      try {
        await fs.promises.rm(target, { force: true });
        for (const suffix of suffixes) await fs.promises.rm(companionPath(target, suffix), { force: true });
      } catch (err) {
        // 번호로 물러설 때는 딸림 파일도 함께 옮긴다(기존 것을 조용히 생략하지 않는다).
        note = { code: 'overwrite-fallback', detail: String(err).slice(0, 300) };
      }
      if (note) target = await placeNumbered();
      else {
        await linkOrCopy(result, target);
        for (const [index, suffix] of suffixes.entries()) await linkOrCopy(local[index] ?? result, companionPath(target, suffix));
      }
    } else {
      target = await placeNumbered();
    }
    return { result, exported: target, ...(note ? { exportNote: note } : {}), ...companionResult(target, files, notes) };
  } catch (err) {
    return { ...here, exportNote: { code: 'export-failed', detail: String(err).slice(0, 300) } };
  }
}
