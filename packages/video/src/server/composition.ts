/**
 * §5.13 (T-1)(T-3)(T-5) — 컴포지션의 서버 몫(탐침·지문·내줄 뿌리): 실제 디스크를 본다(문자열 판정은 순수 층 `composition/`).
 * 프로젝트 안인지는 `realpath` 까지 본다(`assets.ts` 와 같은 규칙). 탐침은 창 없이 meta·소스 문자열만 읽어, 스튜디오가 닫혀도 에이전트가 바로 받는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isPathWithin, type PlatformName } from '@vibisual/shared';

import {
  COMPOSITION_SCAN_MAX_BYTES,
  COMPOSITION_SCAN_MAX_FILES,
  VIDEO_ASSETS_DIR,
  VIDEO_COMPOSITIONS_DIR,
  VIDEO_LIBS_DIR,
} from '../constants.js';
import {
  compositionFolderOf,
  isCompositionHtmlPath,
  isCompositionWebFile,
  isProjectRelativePath,
  toPosixPath,
} from '../composition/paths.js';
import { parseCompositionMeta, parsePropsDecl } from '../composition/meta.js';
import { scanComposition } from '../composition/lint.js';
import { stableHash } from '../hashItem.js';
import type { CompositionLintEntry, CompositionPropDecl, CompositionSeekMode, VideoAsset, VideoDoc, VideoDocOp } from '../types.js';
import { taskCopyNamespaceOf } from './taskCopyPaths.js';

/** `.vibisual` 아래 자리를 프로젝트 기준 상대 경로로. */
/** §5.13 (W) 38-9 — 렌더 엔진의 Chromium 메이저. 서버가 통합 앱 main 프로세스 안이라(§3.7) 이 값이 미리보기·스틸·렌더 엔진과 같다. Electron 밖이면 undefined. */
export function engineChromium(versions: NodeJS.ProcessVersions = process.versions): number | undefined {
  const raw = (versions as Record<string, string | undefined>)['chrome'];
  const major = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(major) && major > 0 ? major : undefined;
}

export function vibisualRel(sub: string): string {
  return `.vibisual/${sub}`;
}

/** 프로젝트 안의 **실제** 경로로 푼다(정션·심볼릭 링크 포함). 밖이거나 없으면 null. */
export function resolveInsideProject(root: string, rel: string, platform: PlatformName = process.platform): string | null {
  try {
    const base = fs.realpathSync(root);
    const abs = path.resolve(base, rel);
    if (!isPathWithin(abs, base, platform)) return null;
    const real = fs.realpathSync(abs);
    return isPathWithin(real, base, platform) ? real : null;
  } catch {
    return null;
  }
}

/** 프로젝트 기준 상대 경로(`/` 구분). 밖·루트 자신이면 null. 대소문자는 입력 그대로 저장하고 비교만 `isPathWithin`(pathKey 규칙, 멀티플랫폼 1축). */
export function toProjectRelative(root: string, input: string, platform: PlatformName = process.platform): string | null {
  const raw = input.trim();
  if (raw === '') return null;
  const base = path.resolve(root);
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(base, raw);
  if (!isPathWithin(abs, base, platform)) return null;
  const rel = toPosixPath(path.relative(base, abs));
  return rel === '' || rel.startsWith('..') ? null : rel;
}

/**
 * §5.13 (Y) 40-7 ② — `resolveInsideProject` 의 비동기 판(판단은 같다). 뿌리의 실제 경로는 `REAL_ROOT_TTL_MS` 동안 기억한다 — 2초마다 지켜보는 문서마다
 * 다시 풀지 않게(폴더를 옮기면 그 안에 다시 푼다).
 */
const REAL_ROOT_TTL_MS = 30_000;
const realRoots = new Map<string, { real: string; at: number }>();

async function realRoot(root: string): Promise<string> {
  const known = realRoots.get(root);
  if (known && Date.now() - known.at < REAL_ROOT_TTL_MS) return known.real;
  const real = await fs.promises.realpath(root);
  realRoots.set(root, { real, at: Date.now() });
  return real;
}

export async function resolveInsideProjectAsync(root: string, rel: string, platform: PlatformName = process.platform): Promise<string | null> {
  try {
    const base = await realRoot(root);
    const abs = path.resolve(base, rel);
    if (!isPathWithin(abs, base, platform)) return null;
    const real = await fs.promises.realpath(abs);
    return isPathWithin(real, base, platform) ? real : null;
  } catch {
    return null;
  }
}

/** 폴더 아래 웹 형식 파일(상대 경로, 정렬) — 상한까지만. 숨김 폴더·node_modules 는 건너뛴다. */
export function listCompositionWebFiles(dirAbs: string): string[] {
  return listWebFiles(dirAbs);
}

function listWebFiles(dirAbs: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    if (out.length >= COMPOSITION_SCAN_MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (out.length >= COMPOSITION_SCAN_MAX_FILES) return;
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile() && isCompositionWebFile(entry.name)) {
        out.push(rel);
      }
    }
  };
  walk(dirAbs, '');
  return out;
}

/** `listWebFiles` 의 비동기 판(같은 순서·같은 상한·같은 건너뛰기). */
async function listWebFilesAsync(dirAbs: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    if (out.length >= COMPOSITION_SCAN_MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (out.length >= COMPOSITION_SCAN_MAX_FILES) return;
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        await walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile() && isCompositionWebFile(entry.name)) {
        out.push(rel);
      }
    }
  };
  await walk(dirAbs, '');
  return out;
}

/** 컴포지션 폴더의 절대 경로(프로젝트 안 실제 경로). 경로가 잘못됐거나 루트 자신이면 null. */
export function compositionFolderAbs(root: string, relHtml: string, platform: PlatformName = process.platform): string | null {
  if (!isProjectRelativePath(relHtml) || !isCompositionHtmlPath(relHtml)) return null;
  const folder = compositionFolderOf(relHtml);
  // T-1 — 컴포지션 폴더는 프로젝트 루트일 수 없다(그러면 내줄 범위가 프로젝트 전체가 된다).
  if (folder === '') return null;
  return resolveInsideProject(root, folder, platform);
}

/**
 * 컴포지션의 **지문** — 폴더 안 웹 형식 파일의 상대 경로·크기·수정 시각을 접은 값. 코드 한 줄을 고치면 바뀐다.
 * 내용을 통째로 읽지 않아 문서를 읽을 때마다 물어도 싸다(스튜디오가 2초마다 묻는다).
 */
export function compositionFingerprint(root: string, relHtml: string, platform: PlatformName = process.platform): string | null {
  const folder = compositionFolderAbs(root, relHtml, platform);
  if (!folder) return null;
  const parts: string[] = [];
  for (const rel of listWebFiles(folder)) {
    try {
      const st = fs.statSync(path.join(folder, rel));
      parts.push(`${rel}:${st.size}:${Math.round(st.mtimeMs)}`);
    } catch {
      // 훑는 사이 지워진 파일 — 지문에서 빠진다(그것도 변화다).
    }
  }
  return fingerprintOf(relHtml, parts);
}

function fingerprintOf(relHtml: string, parts: readonly string[]): string {
  return stableHash(`${toPosixPath(relHtml)}\n${parts.join('\n')}`);
}

/** §5.13 (Y) 40-7 ② — 지문의 비동기 판(같은 값 — 시험이 둘을 맞댄다). 지켜보는 문서마다 2초마다 재므로 메인 스레드(패키지 앱은 창 스레드)를 막지 않게. */
export async function compositionFingerprintAsync(root: string, relHtml: string, platform: PlatformName = process.platform): Promise<string | null> {
  if (!isProjectRelativePath(relHtml) || !isCompositionHtmlPath(relHtml)) return null;
  const folderRel = compositionFolderOf(relHtml);
  if (folderRel === '') return null;
  const folder = await resolveInsideProjectAsync(root, folderRel, platform);
  if (!folder) return null;
  const files = await listWebFilesAsync(folder);
  const stats = await Promise.all(files.map(async (rel) => {
    try {
      const st = await fs.promises.stat(path.join(folder, rel));
      return `${rel}:${st.size}:${Math.round(st.mtimeMs)}`;
    } catch {
      return null; // 훑는 사이 지워진 파일 — 지문에서 빠진다(그것도 변화다).
    }
  }));
  return fingerprintOf(relHtml, stats.filter((s): s is string => s !== null));
}

export interface CompositionProbeResult {
  /** 프로젝트 기준 상대 경로(`/` 구분). */
  readonly path: string;
  readonly duration?: number;
  readonly width?: number;
  readonly height?: number;
  readonly mode: CompositionSeekMode;
  readonly lint: readonly CompositionLintEntry[];
  readonly contentHash: string;
  /** §5.13 (V) 37-5 — 값 선언(순서 보존). 선언이 없거나 틀리면 비운다(lint 가 이유를 말한다). */
  readonly propsDecl?: readonly CompositionPropDecl[];
  /** §5.13 (V) 37-15 — 상자 크기에 맞춰 다시 짜는 컴포지션. */
  readonly responsive?: boolean;
  /** §5.13 (T-8) — 소스가 `__vibi.cue` 를 부른다(표지를 모아야 한다). */
  readonly usesCues?: boolean;
}

/** §5.13 (T-8) — 표지를 알리는 호출이 있는가. */
const CUE_CALL = /__vibi\s*\.\s*cue\s*\(/;

/** 표지를 (다시) 모아야 하는 컴포지션 소재인가 — 코드가 표지를 부르는데 모은 판이 지금 코드와 다르다. */
export function needsCues(asset: VideoAsset): boolean {
  return asset.kind === 'composition' && asset.usesCues === true && asset.cuesHash !== asset.contentHash;
}

function readCapped(file: string): string {
  try {
    const st = fs.statSync(file);
    if (st.size > COMPOSITION_SCAN_MAX_BYTES) {
      const fd = fs.openSync(file, 'r');
      try {
        const buf = Buffer.alloc(COMPOSITION_SCAN_MAX_BYTES);
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        return buf.subarray(0, n).toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    }
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * 탐침 — meta 셋을 읽고(길이·판형) 소스를 훑어(결정성 검사·시각 맞춤 방식) 지문을 잰다.
 * 실패하면 이유 한 줄(영문 — 에이전트가 읽는다)을 돌려준다.
 */
export function probeComposition(
  root: string,
  input: string,
  platform: PlatformName = process.platform,
): { ok: true; probe: CompositionProbeResult } | { ok: false; error: string } {
  const rel = toProjectRelative(root, input, platform);
  if (!rel) return { ok: false, error: 'The composition path must be inside the project.' };
  if (!isCompositionHtmlPath(rel)) return { ok: false, error: 'The composition path must point to an .html file.' };
  const folder = compositionFolderAbs(root, rel, platform);
  if (!folder) return { ok: false, error: 'The composition must live in its own folder inside the project (not the project root).' };
  const htmlAbs = resolveInsideProject(root, rel, platform);
  if (!htmlAbs) return { ok: false, error: 'The composition file does not exist.' };
  try {
    if (!fs.statSync(htmlAbs).isFile()) return { ok: false, error: 'The composition path is not a file.' };
  } catch {
    return { ok: false, error: 'The composition file does not exist.' };
  }

  const html = readCapped(htmlAbs);
  const scripts: string[] = [];
  const styles: string[] = [];
  for (const file of listWebFiles(folder)) {
    const lower = file.toLowerCase();
    if (lower.endsWith('.js') || lower.endsWith('.mjs')) scripts.push(readCapped(path.join(folder, file)));
    else if (lower.endsWith('.css')) styles.push(readCapped(path.join(folder, file)));
  }
  const declared = parseCompositionMeta(html);
  // §5.13 (W) 38-9 — 렌더 엔진(이 실행본의 Chromium)이 모르는 기능을 미리 알린다. 엔진을 모르면(서버만·시험) 검사하지 않는다.
  const chromium = engineChromium();
  const scan = scanComposition({ html, scripts, styles }, chromium === undefined ? {} : { chromium });
  const props = parsePropsDecl(html);
  const contentHash = compositionFingerprint(root, rel, platform) ?? stableHash(html);
  return {
    ok: true,
    probe: {
      path: rel,
      ...(declared.duration === undefined ? {} : { duration: declared.duration }),
      ...(declared.width === undefined ? {} : { width: declared.width }),
      ...(declared.height === undefined ? {} : { height: declared.height }),
      mode: scan.mode,
      lint: scan.lint,
      contentHash,
      ...(props.decl.length > 0 ? { propsDecl: props.decl } : {}),
      ...(declared.responsive === true ? { responsive: true } : {}),
      ...(CUE_CALL.test([html, ...scripts].join('\n')) ? { usesCues: true } : {}),
    },
  };
}

/**
 * 탐침 결과를 소재에 덧입힌다. 선언이 없는 칸(길이·크기)은 지금 값을 남긴다(사람·에이전트가 직접 적은 길이를 지우지 않는다).
 * 값 선언·반응형은 **코드가 정본**이라 코드에서 지우면 소재에서도 걷는다.
 */
export function assetWithProbe(asset: VideoAsset, probe: CompositionProbeResult): VideoAsset {
  const { propsDecl: _oldDecl, responsive: _oldResponsive, usesCues: _oldUsesCues, ...rest } = asset;
  return {
    ...rest,
    kind: 'composition',
    source: { kind: 'file', path: probe.path },
    ...(probe.duration === undefined ? {} : { duration: probe.duration }),
    ...(probe.width === undefined ? {} : { width: probe.width }),
    ...(probe.height === undefined ? {} : { height: probe.height }),
    mode: probe.mode,
    lint: probe.lint,
    contentHash: probe.contentHash,
    ...(probe.propsDecl ? { propsDecl: probe.propsDecl } : {}),
    ...(probe.responsive ? { responsive: true } : {}),
    // 표지 모으기는 코드가 바뀌면 다시 돈다(cuesHash ≠ contentHash) — 모은 표지는 그때까지 그대로 둔다(흐리게 보인다).
    ...(probe.usesCues ? { usesCues: true } : {}),
  };
}

/** 새 소재 id — 폴더 이름에서 파생한다(사람이 읽을 수 있게). 이미 있으면 뒤에 번호를 붙인다. */
export function compositionAssetId(doc: VideoDoc, relHtml: string): string {
  const folder = compositionFolderOf(relHtml).split('/').pop() ?? 'comp';
  const base = `comp-${folder.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'comp'}`;
  if (!(base in doc.assets)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const id = `${base}-${i}`;
    if (!(id in doc.assets)) return id;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** 지문이 바뀐 composition 소재만 다시 탐침한다. 바뀐 게 없으면 빈 배열 — 버전만 올리는 헛패치를 만들지 않는다. */
export function compositionRefreshOps(root: string, doc: VideoDoc, platform: PlatformName = process.platform): VideoDocOp[] {
  const ops: VideoDocOp[] = [];
  for (const asset of Object.values(doc.assets)) {
    if (asset.kind !== 'composition' || asset.source.kind !== 'file') continue;
    const fingerprint = compositionFingerprint(root, asset.source.path, platform);
    if (fingerprint === null || fingerprint === asset.contentHash) continue;
    const probed = probeComposition(root, asset.source.path, platform);
    if (!probed.ok) continue;
    ops.push({ op: 'setAsset', asset: assetWithProbe(asset, probed.probe) });
  }
  return ops;
}

/**
 * §5.13 (T-3) ① — 컴포지션 콘텐츠를 **내줄 뿌리**(절대 경로): 그 문서가 가리키는 컴포지션 폴더들 + 기본 자리 +
 * 라이브러리 자리. 문서가 없으면(`_`) 기본 자리와 라이브러리 자리만이다. 그 밖은 404.
 */
export function compositionRoots(root: string, doc: VideoDoc | null, platform: PlatformName = process.platform): string[] {
  const roots = new Set<string>();
  // §5.13 (V) 37-5 — 가져온 소재 자리도(그림 값이 문서 소재를 가리킨다). 내주는 형식은 웹 형식뿐이라 영상·소리는 안 나간다.
  for (const sub of [VIDEO_COMPOSITIONS_DIR, VIDEO_LIBS_DIR, VIDEO_ASSETS_DIR]) {
    const abs = resolveInsideProject(root, vibisualRel(sub), platform);
    if (abs) roots.add(abs);
  }
  if (doc) {
    for (const asset of Object.values(doc.assets)) {
      if (asset.kind !== 'composition' || asset.source.kind !== 'file') continue;
      const folder = compositionFolderAbs(root, asset.source.path, platform);
      if (folder) roots.add(folder);
      const namespace = taskCopyNamespaceOf(asset.source.path);
      const copyRoot = namespace ? resolveInsideProject(root, namespace, platform) : null;
      if (copyRoot) roots.add(copyRoot);
    }
  }
  return [...roots];
}
