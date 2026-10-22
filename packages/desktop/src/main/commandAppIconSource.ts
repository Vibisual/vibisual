import { open, stat } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import { COMMAND_APP_ICON_LIMITS as LIMITS } from './commandAppIconConfig';
import { findLinuxAppIcon, linuxIconNames } from './linuxAppIcon';
import { isPng, readPeIcon, type IconFileReader, type PeIconResult } from './peIcon';

/**
 * Where an app's own icon lives differs per OS, and the OS shell icon alone is wrong on all three:
 * Windows returns the generic program picture for PNG-framed icons, macOS returns the generic "exec"
 * picture for a bare Unix executable, and Linux returns only MIME-type pictures. "No icon" is reported as
 * null so the renderer can fall back to a bundled mark or its glyph instead of a misleading generic one.
 */

export interface IconImage { mime: 'image/png' | 'image/svg+xml'; data: Buffer }

export interface IconTarget {
  /** Verified real path of the executable. */
  file: string;
  /** The command as written — Linux launchers realpath to the launcher (`/snap/bin/x` → `/usr/bin/snap`). */
  command: string;
  /** macOS bundle whose executable was verified. */
  bundle?: string;
  /** Icon image inside the same verified installation (Unreal on Linux). */
  iconFile?: string;
}

export interface IconFileHandle extends IconFileReader { close(): Promise<void> }

export interface IconSourceDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  /** OS shell icon (Electron `app.getFileIcon`) — asked only where it returns the app's own picture. */
  shellIcon(file: string): Promise<Buffer | null>;
  openFile?(file: string): Promise<IconFileHandle>;
  isFile?(file: string): Promise<boolean>;
  /** Whole file, or null when missing or larger than `maxBytes`. */
  readBounded?(file: string, maxBytes: number): Promise<Buffer | null>;
}

const PE_OPTIONS = {
  targetPx: LIMITS.targetIconPx,
  maxImageBytes: LIMITS.maxImageBytes,
  maxFrameBytes: LIMITS.maxPeFrameBytes,
  maxEntries: LIMITS.maxPeResourceEntries,
  maxFrameAttempts: LIMITS.maxPeFrameAttempts,
};

async function openFileDefault(file: string): Promise<IconFileHandle> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    return {
      size,
      read: async (offset, length) => {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        return buffer.subarray(0, bytesRead);
      },
      close: () => handle.close(),
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function isFileDefault(file: string): Promise<boolean> {
  try { return (await stat(file)).isFile(); } catch { return false; }
}

async function readBoundedDefault(file: string, maxBytes: number): Promise<Buffer | null> {
  let handle;
  try { handle = await open(file, 'r'); } catch { return null; }
  try {
    const { size } = await handle.stat();
    if (!size || size > maxBytes) return null;
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Outermost `.app` bundle holding a resolved path (`…/Visual Studio Code.app/Contents/Resources/app/bin/code`). */
export function macAppBundleOf(file: string): string | null {
  return /^(\/(?:[^/]+\/)*?[^/]+\.app)\/Contents\//.exec(file)?.[1] ?? null;
}

function imageMime(file: string): IconImage['mime'] | null {
  const ext = posix.extname(file).toLowerCase();
  return ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : null;
}

/** Scripts, embedded documents, entities, event handlers and any reference that is not a local `#id`. */
const ACTIVE_SVG = /<(?:script|foreignObject|iframe|object|embed)\b|\son[a-z]+\s*=|javascript:|<!ENTITY|@import|href\s*=\s*(?:"|')?(?!["'#\s])|url\(\s*(?:"|')?\s*(?!["'#\s])/i;

/** Icons only ever render through <img>, where SVG cannot script; still refuse active or external content. */
export function isPlainSvg(text: string): boolean {
  return /<svg[\s>]/i.test(text) && !ACTIVE_SVG.test(text);
}

/** The renderer accepts only bounded PNG/SVG data URLs — anything else becomes "no icon". */
export function iconDataUrl(image: IconImage | null): string | null {
  if (!image || image.data.length < 8 || image.data.length > LIMITS.maxImageBytes) return null;
  if (image.mime === 'image/png') return isPng(image.data) ? `data:image/png;base64,${image.data.toString('base64')}` : null;
  return isPlainSvg(image.data.toString('utf8')) ? `data:image/svg+xml;base64,${image.data.toString('base64')}` : null;
}

export function createCommandAppIconSource(deps: IconSourceDeps): (target: IconTarget, canceled: () => boolean) => Promise<IconImage | null> {
  const openFile = deps.openFile ?? openFileDefault;
  const isFile = deps.isFile ?? isFileDefault;
  const readBounded = deps.readBounded ?? readBoundedDefault;

  const imageFile = async (file: string): Promise<IconImage | null> => {
    const mime = imageMime(file);
    const data = mime ? await readBounded(file, LIMITS.maxImageBytes) : null;
    return mime && data ? { mime, data } : null;
  };
  const shell = async (file: string): Promise<IconImage | null> => {
    const png = await deps.shellIcon(file);
    return png ? { mime: 'image/png', data: png } : null;
  };
  const windows = async (file: string): Promise<IconImage | null> => {
    const ext = win32.extname(file).toLowerCase();
    // Scripts only ever show their file-type picture (Build.bat's gears), never an app icon.
    if (ext !== '.exe' && ext !== '.com') return null;
    let result: PeIconResult | null;
    try {
      const handle = await openFile(file);
      try { result = await readPeIcon(handle, PE_OPTIONS); } finally { await handle.close(); }
    } catch {
      // Unreadable (app execution alias, locked file) or a broken resource tree: let the shell decide.
      result = { kind: 'unsupported' };
    }
    if (result?.kind === 'image') return { mime: 'image/png', data: result.png };
    // No icon group (git.exe) or not a PE image: the shell would only answer with the generic picture.
    return result?.kind === 'unsupported' ? shell(file) : null;
  };

  return async (target, canceled) => {
    if (target.iconFile) return imageFile(target.iconFile);
    if (deps.platform === 'win32') return windows(target.file);
    if (deps.platform === 'darwin') {
      const bundle = target.bundle ?? macAppBundleOf(target.file);
      return bundle ? shell(bundle) : null;
    }
    const icon = await findLinuxAppIcon(linuxIconNames(target.command, target.file), {
      env: deps.env,
      home: deps.home,
      isFile,
      readText: async (file, maxBytes) => (await readBounded(file, maxBytes))?.toString('utf8') ?? null,
    }, canceled);
    return icon && !canceled() ? imageFile(icon) : null;
  };
}
