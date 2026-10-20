/**
 * §5.13 (AA) 42-2 — 렌더 결과를 놓는다.
 *
 * 1. **종전 자리(`.vibisual/video/out/`)에 먼저** 쓴다 — 캔버스 노드 담기(프로젝트 안 파일만)·판 기록·[받기]가 그 파일에 기댄다.
 *    이름 규칙이 있으면 그 이름(겹치면 번호), 없으면 종전 이름(`<문서id>-<시각>`).
 * 2. 사용자가 고른 폴더가 있으면 그 파일을 **하드 링크**(같은 디스크 — 용량을 두 번 쓰지 않는다), 안 되면 **복사**한다.
 * 3. 자막 따로 내기면 같은 이름의 `.srt` 를 옆에 둔다(구간 렌더면 그 구간의 큐를 0 부터).
 *
 * 전부 비동기다 — 서버가 앱 본체 스레드에서 돌아(§3.7) 큰 파일을 동기로 쓰면 창이 멎는다. 고른 폴더에 쓰지 못해도 렌더는
 * 성공이다(종전 자리에 남아 있다) — 그 사실을 `exportNote` 로 돌려준다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathKey, type PlatformName } from '@vibisual/shared';

import { buildRenderFileName, sanitizeFileName } from '../exportNames.js';
import { renderExtension, scaledSize, type RenderOutputSpec, type RenderSpec } from '../renderSpec.js';
import { formatOfSize } from '../formats.js';
import { resolveTimeline } from '../resolveTimeline.js';
import { buildSrt } from '../srt.js';
import type { VideoDoc } from '../types.js';
import { linkOrCopy, placeNumberedPair, subtitlePath, writeNewFile } from './exportOutputFiles.js';

export { linkOrCopy } from './exportOutputFiles.js';

export interface PlaceInput {
  readonly outDir: string;
  readonly docId: string;
  readonly title: string | null;
  readonly spec: RenderSpec | null;
  readonly output: RenderOutputSpec | null;
  /** 투명 배경 렌더(설정 없이 걸린 종전 일감 — 확장자만 가른다). */
  readonly legacyExt: 'mp4' | 'webm';
  readonly bytes: Uint8Array;
  readonly doc: VideoDoc | null;
  readonly now: Date;
}

export interface PlaceResult {
  /** 종전 자리의 파일(일감 `result`). */
  readonly result: string;
  /** 사용자가 보는 파일 — 고른 폴더의 것, 없으면 `result`. */
  readonly exported: string;
  readonly exportNote?: { code: 'export-failed' | 'overwrite-fallback'; detail?: string };
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

/** 자막 따로 내기 — 영상 옆 같은 이름의 SRT. 큐가 없으면 쓰지 않는다. */
function subtitleText(doc: VideoDoc | null, spec: RenderSpec | null): string | null {
  if (!doc || spec?.captions !== 'separate') return null;
  const text = buildSrt(doc, resolveTimeline(doc), spec.range);
  if (text.trim() === '') return null;
  return text;
}

export async function placeRenderOutput(input: PlaceInput, platform: PlatformName): Promise<PlaceResult> {
  const ext = input.spec ? renderExtension(input.spec) : input.legacyExt;
  await fs.promises.mkdir(input.outDir, { recursive: true });
  const base = templatedBase(input);
  const text = subtitleText(input.doc, input.spec);
  const result = await placeNumberedPair(input.outDir, base ?? `${input.docId}-${input.now.getTime()}`, ext,
    text !== null, (file, subtitle) => writeNewFile(file, subtitle ? text ?? '' : input.bytes));
  const srt = text === null ? null : subtitlePath(result);

  const dirRaw = input.output?.dir ?? null;
  if (!dirRaw) return { result, exported: result };
  if (!path.isAbsolute(dirRaw)) return { result, exported: result, exportNote: { code: 'export-failed', detail: 'not an absolute folder' } };
  const dir = path.resolve(dirRaw);
  if (pathKey(dir, platform) === pathKey(path.resolve(input.outDir), platform)) return { result, exported: result };

  const exportBase = base ?? stemOf(path.basename(result));
  let note: PlaceResult['exportNote'];
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    let target = path.join(dir, `${exportBase}.${ext}`);
    const placeNumbered = (): Promise<string> => placeNumberedPair(dir, exportBase, ext, srt !== null,
      (file, subtitle) => linkOrCopy(subtitle ? srt ?? result : result, file));
    if (input.output?.conflict === 'overwrite') {
      try {
        await fs.promises.rm(target, { force: true });
        if (srt) await fs.promises.rm(subtitlePath(target), { force: true });
      } catch (err) {
        // 번호로 물러설 때는 자막도 함께 옮긴다(기존 자막을 조용히 생략하지 않는다).
        note = { code: 'overwrite-fallback', detail: String(err).slice(0, 300) };
      }
      if (note) target = await placeNumbered();
      else {
        await linkOrCopy(result, target);
        if (srt) await linkOrCopy(srt, subtitlePath(target));
      }
    } else {
      target = await placeNumbered();
    }
    return note ? { result, exported: target, exportNote: note } : { result, exported: target };
  } catch (err) {
    return { result, exported: result, exportNote: { code: 'export-failed', detail: String(err).slice(0, 300) } };
  }
}
