/**
 * §5.13 (V) 37-23 (H) — 장면 하나를 되돌릴 때 걸리는 컴포지션 코드 파일: 어느 폴더가 그 장면만의 것이고, 무엇이 되돌아가며 무엇이
 * 안 되는가. 쓰지 않는다(계획만) — 화면이 되돌리기 전에 이 계획을 말로 보인다.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isPathWithin, pathKey, type PlatformName } from '@vibisual/shared';

import { sceneCompositionPaths } from '../sceneChange.js';
import type { VideoDoc } from '../types.js';
import { listCompositionWebFiles } from './composition.js';
import type { FilesManifest } from './historyStore.js';

export interface SceneFolders {
  /** 그 장면만 쓰는 컴포지션 폴더(프로젝트 기준, `/`) — 파일을 되돌린다. */
  readonly own: readonly string[];
  /** 다른 장면도 쓰는 폴더 — 되돌리면 그 장면의 그림도 바뀌므로 건드리지 않는다. */
  readonly shared: readonly string[];
}

export interface SceneFilePlan {
  readonly folders: readonly string[];
  /** 되돌려 쓸 파일 수(그 판과 내용이 다르거나 지금 없는 것). */
  readonly changed: number;
  readonly shared: readonly string[];
  /** 함께 쓰는 폴더라 되돌리지 않는 파일 수(그 판과 내용이 다른 것). */
  readonly sharedChanged: number;
  /** 그 판에 없던 파일(바퀴가 새로 만든 것) — 지우지 않고 남긴다. */
  readonly extra: number;
  /** 판 기록에 덩어리가 없어 되돌릴 수 없는 파일 수. */
  readonly missing: number;
  /** 크기 상한으로 그 판에 못 남긴 파일이 있었다. */
  readonly partial: boolean;
  /** 그 판에 파일 기록이 아예 없다(옛 판). */
  readonly noSnapshot: boolean;
}

/** 컴포지션 HTML 경로 → 그 폴더(판의 파일 목록이 쓰는 모양과 같다). 프로젝트 뿌리면 빈 문자열. */
function folderOf(relHtml: string): string {
  const dir = path.posix.dirname(relHtml.replace(/\\/g, '/'));
  return dir === '.' ? '' : dir;
}

function unique(folders: readonly string[], platform: PlatformName): string[] {
  const seen = new Map<string, string>();
  for (const folder of folders) if (folder !== '' && !seen.has(pathKey(folder, platform))) seen.set(pathKey(folder, platform), folder);
  return [...seen.values()];
}

/**
 * 그 장면(시작 판 기준)의 컴포지션 폴더를 '혼자 쓰는 것'과 '함께 쓰는 것'으로 가른다. 함께 쓰는지는 시작 판과 지금 문서 양쪽에서 보고,
 * 한 폴더가 다른 폴더 안에 있어도 함께 쓰는 것이다. 같은 폴더인지는 `pathKey` 로(대소문자를 가리지 않는 파일 시스템).
 */
export function sceneFolders(start: VideoDoc, current: VideoDoc, chapterId: string, platform: PlatformName): SceneFolders {
  const mine = unique(sceneCompositionPaths(start, chapterId).mine.map(folderOf), platform);
  const others = unique([...sceneCompositionPaths(start, chapterId).others, ...sceneCompositionPaths(current, chapterId).others].map(folderOf), platform);
  const touches = (a: string, b: string): boolean => isPathWithin(a, b, platform) || isPathWithin(b, a, platform);
  const own: string[] = [];
  const shared: string[] = [];
  for (const folder of mine) (others.some((other) => touches(folder, other)) ? shared : own).push(folder);
  return { own, shared };
}

/** 그 경로가 폴더들 가운데 하나 안에 있나. */
export function inFolders(rel: string, folders: readonly string[], platform: PlatformName): boolean {
  return folders.some((folder) => isPathWithin(rel, folder, platform));
}

function sha256(file: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

/** 파일 계획 — 판의 파일 목록과 지금 디스크를 맞대 센다. `hasBlob` 은 그 내용 덩어리가 판 기록에 남아 있는가. */
export function sceneFilePlan(
  projectPath: string,
  manifest: FilesManifest | null,
  folders: SceneFolders,
  hasBlob: (sha: string) => boolean,
  platform: PlatformName,
): SceneFilePlan {
  const touched = folders.own.length + folders.shared.length > 0;
  const root = path.resolve(projectPath);
  let changed = 0;
  let sharedChanged = 0;
  let missing = 0;
  const snapshotted = new Set<string>();
  for (const [rel, sha] of Object.entries(manifest?.files ?? {})) {
    const own = inFolders(rel, folders.own, platform);
    if (!own && !inFolders(rel, folders.shared, platform)) continue;
    snapshotted.add(pathKey(rel, platform));
    const target = path.resolve(root, rel);
    if (!isPathWithin(target, root, platform)) continue;
    if (sha256(target) === sha) continue;
    if (!own) sharedChanged += 1;
    else if (hasBlob(sha)) changed += 1;
    else missing += 1;
  }
  let extra = 0;
  for (const folder of folders.own) {
    const abs = path.resolve(root, folder);
    if (!isPathWithin(abs, root, platform)) continue;
    for (const rel of listCompositionWebFiles(abs)) if (!snapshotted.has(pathKey(`${folder}/${rel}`, platform))) extra += 1;
  }
  return {
    folders: folders.own,
    changed,
    shared: folders.shared,
    sharedChanged,
    extra,
    missing,
    partial: touched && manifest?.partial === true,
    noSnapshot: touched && manifest === null,
  };
}
