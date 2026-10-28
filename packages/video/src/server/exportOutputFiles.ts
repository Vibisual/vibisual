/** Output names belong to the video and its optional subtitle together (§5.13 42-2). */
import fs from 'node:fs';
import path from 'node:path';
import { numberedName } from '../exportNames.js';

export function subtitlePath(videoPath: string): string {
  return path.join(path.dirname(videoPath), `${path.basename(videoPath, path.extname(videoPath))}.srt`);
}

function isFileExists(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'EEXIST';
}

/** Never fall back from EEXIST to a copy that truncates somebody else's file. */
export async function linkOrCopy(src: string, dst: string): Promise<void> {
  try {
    await fs.promises.link(src, dst);
  } catch (error) {
    if (isFileExists(error)) throw error;
    await fs.promises.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
  }
}

/** A failed new write owns only the file that its exclusive open created. */
export async function writeNewFile(file: string, bytes: Uint8Array | string): Promise<void> {
  const handle = await fs.promises.open(file, 'wx');
  try {
    await handle.writeFile(bytes);
  } catch (error) {
    await handle.close();
    await fs.promises.unlink(file);
    throw error;
  }
  await handle.close();
}

/**
 * Reserve by creating the files, not by checking existence — video formats can race on the same .srt; on collision remove only
 * this attempt's new files and try the next pair.
 */
export async function placeNumberedPair(
  dir: string, base: string, ext: string, hasSubtitle: boolean,
  create: (file: string, subtitle: boolean) => Promise<void>,
): Promise<string> {
  for (let number = 1; ; number += 1) {
    const target = path.join(dir, `${numberedName(base, number)}.${ext}`);
    const files = hasSubtitle ? [target, subtitlePath(target)] : [target];
    if (files.some((file) => fs.existsSync(file))) continue;
    const created: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        await create(file, index > 0);
        created.push(file);
      }
      return target;
    } catch (error) {
      for (const file of created.reverse()) await fs.promises.unlink(file);
      if (!isFileExists(error)) throw error;
    }
  }
}
