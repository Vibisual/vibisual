// §4 폴더 우클릭으로 프로젝트 열기 — OS 파일 관리자 메뉴에 항목을 적고 걷는다. 짓는 것은 순수 함수(플랫폼을 인자로 받는다),
// 디스크·프로세스는 `FolderMenuIo` 로 받아 세 OS 를 Windows 개발기에서 시험한다.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import koffi from 'koffi';
import type { FolderContextMenuStatus, FolderContextMenuTarget } from '@vibisual/shared';
import { FOLDER_OPEN_ARG } from './folderOpenArgs';

/** electron-builder.yml `appId` 와 같아야 한다 — mac 빠른 동작이 `open -b` 로 이 앱을 찾는다. */
export const VIBISUAL_BUNDLE_ID = 'com.vibisual.app';

/** 메뉴가 부를 실행본. AppImage 는 실행 중 임시로 풀린 자리에서 돈다 — 사용자가 둔 파일을 적는다. */
export function folderMenuExePath(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, execPath: string): string {
  return platform === 'linux' && env.APPIMAGE ? env.APPIMAGE : execPath;
}

/** 폴더 위 · 폴더 안 빈 곳. 드라이브(`Drive\shell`)는 넣지 않는다 — 드라이브 전체를 프로젝트로 여는 것은 사고다. */
export const WINDOWS_MENU_KEYS = [
  'HKEY_CURRENT_USER\\Software\\Classes\\Directory\\shell\\Vibisual',
  'HKEY_CURRENT_USER\\Software\\Classes\\Directory\\Background\\shell\\Vibisual',
] as const;

/** 우리가 적은 파일임을 알리는 줄. 스크립트는 파일 이름이 곧 메뉴 글자라(언어마다 다르다) 이 줄로 찾아 걷는다. */
export const LINUX_SCRIPT_MARKER = '# vibisual-folder-menu';
export const MAC_WORKFLOW_DIR = 'Open in Vibisual.workflow';
const DESKTOP_FILE = 'vibisual-open-folder.desktop';
const NEMO_FOLDER_ACTION = 'vibisual-open-folder.nemo_action';
const NEMO_HERE_ACTION = 'vibisual-open-here.nemo_action';

function regString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * `reg import` 로 먹일 .reg 본문. 먼저 두 키를 지우고(옛 값이 남지 않게) `entry` 가 있으면 다시 적는다 — null 이면 걷기만.
 * 파일은 UTF-16LE + BOM 이어야 한글 글자가 깨지지 않는다(`windowsRegFileBytes`).
 */
export function windowsMenuRegFile(entry: { exePath: string; label: string } | null): string {
  const lines = ['Windows Registry Editor Version 5.00', ''];
  for (const key of WINDOWS_MENU_KEYS) lines.push(`[-${key}]`, '');
  if (entry) {
    const command = `"${entry.exePath}" "${FOLDER_OPEN_ARG}=%V"`;
    for (const key of WINDOWS_MENU_KEYS) {
      lines.push(`[${key}]`, `@=${regString(entry.label)}`, `"Icon"=${regString(`"${entry.exePath}",0`)}`);
      // 여러 폴더를 함께 골랐을 때는 숨긴다 — 한 번에 프로젝트 하나다.
      if (key.includes('\\Directory\\shell\\')) lines.push(`"MultiSelectModel"="Single"`);
      lines.push('', `[${key}\\command]`, `@=${regString(command)}`, '');
    }
  }
  return lines.join('\r\n');
}

export function windowsRegFileBytes(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Finder 빠른 동작(`~/Library/Services`). 실행 파일을 직접 부르지 않고 `open -b` 로 앱에 폴더를 넘긴다 —
 * 켜져 있으면 그 앱이 `open-file` 을 받고, 꺼져 있으면 켜면서 받는다(앱을 옮겨도 깨지지 않는다).
 */
export function macWorkflowFiles(opts: { label: string; bundleId: string }): Array<{ rel: string; content: string }> {
  const script = `for f in "$@"; do\n  /usr/bin/open -b ${opts.bundleId} "$f"\ndone\n`;
  const plistHead = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n';
  const info = `${plistHead}<dict>
  <key>NSServices</key>
  <array>
    <dict>
      <key>NSMenuItem</key>
      <dict>
        <key>default</key>
        <string>${xmlEscape(opts.label)}</string>
      </dict>
      <key>NSMessage</key>
      <string>runWorkflowAsService</string>
      <key>NSRequiredContext</key>
      <dict>
        <key>NSApplicationIdentifier</key>
        <string>com.apple.finder</string>
      </dict>
      <key>NSSendFileTypes</key>
      <array>
        <string>public.folder</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
`;
  const wflow = `${plistHead}<dict>
  <key>AMApplicationBuild</key>
  <string>523</string>
  <key>AMApplicationVersion</key>
  <string>2.10</string>
  <key>AMDocumentVersion</key>
  <string>2</string>
  <key>actions</key>
  <array>
    <dict>
      <key>action</key>
      <dict>
        <key>AMAccepts</key>
        <dict>
          <key>Container</key>
          <string>List</string>
          <key>Optional</key>
          <true/>
          <key>Types</key>
          <array>
            <string>com.apple.cocoa.path</string>
          </array>
        </dict>
        <key>AMActionVersion</key>
        <string>2.0.3</string>
        <key>AMApplication</key>
        <array>
          <string>Automator</string>
        </array>
        <key>AMParameterProperties</key>
        <dict>
          <key>COMMAND_STRING</key>
          <dict/>
          <key>CheckedForUserDefaultShell</key>
          <dict/>
          <key>inputMethod</key>
          <dict/>
          <key>shell</key>
          <dict/>
          <key>source</key>
          <dict/>
        </dict>
        <key>AMProvides</key>
        <dict>
          <key>Container</key>
          <string>List</string>
          <key>Types</key>
          <array>
            <string>com.apple.cocoa.string</string>
          </array>
        </dict>
        <key>ActionBundlePath</key>
        <string>/System/Library/Automator/Run Shell Script.action</string>
        <key>ActionName</key>
        <string>Run Shell Script</string>
        <key>ActionParameters</key>
        <dict>
          <key>COMMAND_STRING</key>
          <string>${xmlEscape(script)}</string>
          <key>CheckedForUserDefaultShell</key>
          <true/>
          <key>inputMethod</key>
          <integer>1</integer>
          <key>shell</key>
          <string>/bin/sh</string>
          <key>source</key>
          <string></string>
        </dict>
        <key>BundleIdentifier</key>
        <string>com.apple.RunShellScript</string>
        <key>CFBundleVersion</key>
        <string>2.0.3</string>
        <key>CanShowSelectedItemsWhenRun</key>
        <false/>
        <key>CanShowWhenRun</key>
        <true/>
        <key>Category</key>
        <array>
          <string>AMCategoryUtilities</string>
        </array>
        <key>Class Name</key>
        <string>RunShellScriptAction</string>
        <key>InputUUID</key>
        <string>6F1F6A2E-3C1B-4C55-9B0E-1C3A5E6B7D01</string>
        <key>Keywords</key>
        <array>
          <string>Shell</string>
          <string>Script</string>
        </array>
        <key>OutputUUID</key>
        <string>6F1F6A2E-3C1B-4C55-9B0E-1C3A5E6B7D02</string>
        <key>UUID</key>
        <string>6F1F6A2E-3C1B-4C55-9B0E-1C3A5E6B7D03</string>
        <key>UnlocalizedApplications</key>
        <array>
          <string>Automator</string>
        </array>
        <key>isViewVisible</key>
        <integer>1</integer>
      </dict>
      <key>isViewVisible</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>connectors</key>
  <dict/>
  <key>workflowMetaData</key>
  <dict>
    <key>inputTypeIdentifier</key>
    <string>com.apple.Automator.fileSystemObject.folder</string>
    <key>outputTypeIdentifier</key>
    <string>com.apple.Automator.nothing</string>
    <key>presentationMode</key>
    <integer>15</integer>
    <key>processesInput</key>
    <integer>0</integer>
    <key>serviceApplicationBundleID</key>
    <string>com.apple.finder</string>
    <key>serviceApplicationPath</key>
    <string>/System/Library/CoreServices/Finder.app</string>
    <key>serviceInputTypeIdentifier</key>
    <string>com.apple.Automator.fileSystemObject.folder</string>
    <key>serviceOutputTypeIdentifier</key>
    <string>com.apple.Automator.nothing</string>
    <key>serviceProcessesInput</key>
    <integer>0</integer>
    <key>systemImageName</key>
    <string>NSActionTemplate</string>
    <key>useAutomaticInputType</key>
    <integer>0</integer>
    <key>workflowTypeIdentifier</key>
    <string>com.apple.Automator.servicesMenu</string>
  </dict>
</dict>
</plist>
`;
  return [
    { rel: path.posix.join(MAC_WORKFLOW_DIR, 'Contents', 'Info.plist'), content: info },
    { rel: path.posix.join(MAC_WORKFLOW_DIR, 'Contents', 'document.wflow'), content: wflow },
  ];
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** .desktop Exec 의 한 인자. 따옴표 안에서는 `"` `` ` `` `$` `\` 를 escape 하고, 파일 수준에서 `\` 가 한 번 더 겹친다. */
function desktopExecArg(s: string): string {
  if (/^[A-Za-z0-9_./+-]+$/.test(s)) return s;
  const inner = s.replace(/[\\"`$]/g, (c) => `\\${c}`);
  return `"${inner.replace(/\\/g, '\\\\')}"`;
}

/** 메뉴 글자를 파일 이름으로 쓸 수 있게(스크립트 메뉴는 파일 이름이 곧 글자다). */
function scriptFileName(label: string): string {
  const s = label.replace(/[/\0]/g, ' ').trim();
  return s || 'Vibisual';
}

/**
 * Nautilus·Caja 스크립트 — 고른 폴더(없으면 지금 연 폴더). 파일 관리자가 넘기는 환경 변수 이름만 다르다.
 * 실행본은 `=` 한 토큰으로 넘긴다(Chromium 이 두 번째 실행 인자를 다시 조립해도 짝이 안 깨진다).
 */
export function linuxScript(exePath: string, envPrefix: 'NAUTILUS' | 'CAJA'): string {
  const sel = `${envPrefix}_SCRIPT_SELECTED_FILE_PATHS`;
  const cur = `${envPrefix}_SCRIPT_CURRENT_URI`;
  return `#!/bin/sh
${LINUX_SCRIPT_MARKER} — written by Vibisual. Turn it off in Vibisual Options > Advanced instead of editing.
exe=${shQuote(exePath)}
if [ -n "$${sel}" ]; then
  printf '%s\\n' "$${sel}" | while IFS= read -r p; do
    if [ -d "$p" ]; then "$exe" "${FOLDER_OPEN_ARG}=$p" >/dev/null 2>&1 & fi
  done
else
  "$exe" "${FOLDER_OPEN_ARG}=$${cur}" >/dev/null 2>&1 &
fi
`;
}

export interface LinuxMenuFile {
  target: FolderContextMenuTarget;
  file: string;
  content: string;
  /** 스크립트·KDE 서비스 메뉴는 실행 권한이 있어야 메뉴에 뜬다(KF 5.85+ 는 사용자 폴더의 서비스 메뉴도). */
  mode: number;
}

export interface LinuxMenuDirs {
  nautilusScripts: string;
  cajaScripts: string;
  kioServiceMenus: string;
  kservices5ServiceMenus: string;
  nemoActions: string;
}

export function linuxMenuDirs(home: string, env: NodeJS.ProcessEnv): LinuxMenuDirs {
  const abs = (v: string | undefined): string | null => (v && path.posix.isAbsolute(v) ? v : null);
  const data = abs(env.XDG_DATA_HOME) ?? path.posix.join(home, '.local', 'share');
  const config = abs(env.XDG_CONFIG_HOME) ?? path.posix.join(home, '.config');
  return {
    nautilusScripts: path.posix.join(data, 'nautilus', 'scripts'),
    cajaScripts: path.posix.join(config, 'caja', 'scripts'),
    kioServiceMenus: path.posix.join(data, 'kio', 'servicemenus'),
    kservices5ServiceMenus: path.posix.join(data, 'kservices5', 'ServiceMenus'),
    nemoActions: path.posix.join(data, 'nemo', 'actions'),
  };
}

/** 설치된 파일 관리자에만 적는다. `inode/directory` MIME 연결은 하지 않는다 — 폴더 기본 앱을 빼앗는다. */
export function linuxMenuFiles(opts: {
  exePath: string;
  label: string;
  dirs: LinuxMenuDirs;
  has: (bin: string) => boolean;
}): LinuxMenuFile[] {
  const { exePath, label, dirs } = opts;
  const out: LinuxMenuFile[] = [];
  const name = scriptFileName(label);
  if (opts.has('nautilus')) {
    out.push({ target: 'nautilus', file: path.posix.join(dirs.nautilusScripts, name), content: linuxScript(exePath, 'NAUTILUS'), mode: 0o755 });
  }
  if (opts.has('caja')) {
    out.push({ target: 'caja', file: path.posix.join(dirs.cajaScripts, name), content: linuxScript(exePath, 'CAJA'), mode: 0o755 });
  }
  if (opts.has('dolphin')) {
    // 따옴표 안에는 %f 를 못 쓴다(데스크톱 항목 규격) — 맨 플래그 + 위치 인자로 넘긴다(`folderPathsFromArgv` ②).
    const service = `[Desktop Entry]
Type=Service
MimeType=inode/directory;
Actions=openInVibisual;
X-KDE-ServiceTypes=KonqPopupMenu/Plugin
X-KDE-Priority=TopLevel

[Desktop Action openInVibisual]
Name=${label.replace(/[\r\n]/g, ' ')}
Icon=vibisual
Exec=${desktopExecArg(exePath)} ${FOLDER_OPEN_ARG} %f
`;
    out.push({ target: 'dolphin', file: path.posix.join(dirs.kioServiceMenus, DESKTOP_FILE), content: service, mode: 0o755 });
    out.push({ target: 'dolphin', file: path.posix.join(dirs.kservices5ServiceMenus, DESKTOP_FILE), content: service, mode: 0o755 });
  }
  if (opts.has('nemo')) {
    const exec = `${desktopExecArg(exePath)} ${FOLDER_OPEN_ARG}`;
    const nemo = (selection: string, field: string, extra: string): string => `[Nemo Action]
Name=${label.replace(/[\r\n]/g, ' ')}
Comment=${label.replace(/[\r\n]/g, ' ')}
Exec=${exec} ${field}
Icon-Name=vibisual
Selection=${selection}
${extra}`;
    out.push({ target: 'nemo', file: path.posix.join(dirs.nemoActions, NEMO_FOLDER_ACTION), content: nemo('s', '%F', 'Extensions=dir;\n'), mode: 0o644 });
    out.push({ target: 'nemo', file: path.posix.join(dirs.nemoActions, NEMO_HERE_ACTION), content: nemo('none', '%P', 'Extensions=any;\n'), mode: 0o644 });
  }
  return out;
}

/** 디스크·프로세스 손. 실제 구현은 index.ts 가 node:fs·execFile 로 채운다. */
export interface FolderMenuIo {
  writeFile(file: string, data: string | Buffer, mode?: number): void;
  removeFile(file: string): void;
  removeDir(dir: string): void;
  listDir(dir: string): string[];
  readText(file: string): string | null;
  run(cmd: string, args: string[]): Promise<void>;
  has(bin: string): boolean;
  /** Windows — 떠 있는 탐색기는 이 알림 전까지 예전 우클릭 동사를 들고 있다(키를 적어도 안 보인다, 2026-10-29 실측). */
  notifyAssocChanged(): void;
}

export interface ApplyFolderMenuOptions {
  platform: NodeJS.Platform;
  enabled: boolean;
  /** 패키지 설치본만 적는다 — 개발 실행이 설치본의 항목을 자기 실행본으로 덮으면 안 된다. */
  packaged: boolean;
  label: string;
  exePath: string;
  home: string;
  env: NodeJS.ProcessEnv;
  tmpDir: string;
  bundleId: string;
  io: FolderMenuIo;
  now?: () => number;
}

/** 켜져 있으면 적고 꺼져 있으면 걷는다. 어느 쪽이든 결과를 상태로 돌려준다(던지지 않는다). */
export async function applyFolderContextMenu(o: ApplyFolderMenuOptions): Promise<FolderContextMenuStatus> {
  const appliedAt = (o.now ?? Date.now)();
  const base = { enabled: o.enabled, appliedAt };
  if (o.platform !== 'win32' && o.platform !== 'darwin' && o.platform !== 'linux') {
    return { ...base, installed: false, targets: [], reason: 'unsupported-platform' };
  }
  if (!o.packaged) return { ...base, installed: false, targets: [], reason: 'dev-build' };
  try {
    if (o.platform === 'win32') {
      const text = windowsMenuRegFile(o.enabled ? { exePath: o.exePath, label: o.label } : null);
      const file = path.win32.join(o.tmpDir, `vibisual-folder-menu-${process.pid}.reg`);
      o.io.writeFile(file, windowsRegFileBytes(text));
      try {
        const systemRoot = o.env.SystemRoot ?? o.env.SYSTEMROOT ?? 'C:\\Windows';
        await o.io.run(path.win32.join(systemRoot, 'System32', 'reg.exe'), ['import', file]);
      } finally {
        o.io.removeFile(file);
      }
      // 알림이 실패해도 항목은 적혔다 — 탐색기를 다시 열면 보인다.
      try { o.io.notifyAssocChanged(); } catch { /* 위 주석 */ }
      return { ...base, installed: o.enabled, targets: o.enabled ? ['windows-explorer'] : [] };
    }
    if (o.platform === 'darwin') {
      const services = path.posix.join(o.home, 'Library', 'Services');
      o.io.removeDir(path.posix.join(services, MAC_WORKFLOW_DIR));
      if (o.enabled) {
        for (const f of macWorkflowFiles({ label: o.label, bundleId: o.bundleId })) {
          o.io.writeFile(path.posix.join(services, f.rel), f.content);
        }
      }
      // 서비스 목록을 다시 읽게 한다. 실패해도 다음 로그인 때 읽는다.
      await o.io.run('/System/Library/CoreServices/pbs', ['-update']).catch(() => {});
      return { ...base, installed: o.enabled, targets: o.enabled ? ['macos-finder'] : [] };
    }
    const dirs = linuxMenuDirs(o.home, o.env);
    removeLinuxMenu(dirs, o.io);
    if (!o.enabled) return { ...base, installed: false, targets: [] };
    const files = linuxMenuFiles({ exePath: o.exePath, label: o.label, dirs, has: o.io.has });
    for (const f of files) o.io.writeFile(f.file, f.content, f.mode);
    const targets = [...new Set(files.map((f) => f.target))];
    if (targets.length === 0) return { ...base, installed: false, targets, reason: 'no-file-manager' };
    return { ...base, installed: true, targets };
  } catch (err) {
    return { ...base, installed: false, targets: [], reason: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

/** 이름이 고정인 파일은 그대로, 스크립트는 표시 줄이 있는 것만 지운다(사용자가 둔 다른 스크립트는 건드리지 않는다). */
function removeLinuxMenu(dirs: LinuxMenuDirs, io: FolderMenuIo): void {
  for (const dir of [dirs.nautilusScripts, dirs.cajaScripts]) {
    for (const name of io.listDir(dir)) {
      const file = path.posix.join(dir, name);
      if (io.readText(file)?.includes(LINUX_SCRIPT_MARKER)) io.removeFile(file);
    }
  }
  io.removeFile(path.posix.join(dirs.kioServiceMenus, DESKTOP_FILE));
  io.removeFile(path.posix.join(dirs.kservices5ServiceMenus, DESKTOP_FILE));
  io.removeFile(path.posix.join(dirs.nemoActions, NEMO_FOLDER_ACTION));
  io.removeFile(path.posix.join(dirs.nemoActions, NEMO_HERE_ACTION));
}

const SHCNE_ASSOCCHANGED = 0x08000000;
const SHCNF_IDLIST = 0;
type ShChangeNotify = (eventId: number, flags: number, item1: null, item2: null) => void;
let shChangeNotify: ShChangeNotify | null = null;

/** 실제 디스크·프로세스 손. 없는 파일·폴더를 지우는 것은 오류가 아니다. */
export function nodeFolderMenuIo(env: NodeJS.ProcessEnv): FolderMenuIo {
  return {
    notifyAssocChanged() {
      // Windows 가지에서만 불린다 — 다른 OS 에서 shell32 를 읽지 않게 처음 부를 때 묶는다.
      shChangeNotify ??= koffi.load('shell32.dll').func(
        'void __stdcall SHChangeNotify(int32_t wEventId, uint32_t uFlags, const void *dwItem1, const void *dwItem2)',
      ) as unknown as ShChangeNotify;
      shChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, null, null);
    },
    writeFile(file, data, mode) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data);
      if (mode !== undefined && process.platform !== 'win32') fs.chmodSync(file, mode);
    },
    removeFile(file) {
      fs.rmSync(file, { force: true });
    },
    removeDir(dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    },
    listDir(dir) {
      try { return fs.readdirSync(dir); } catch { return []; }
    },
    readText(file) {
      try {
        // 사용자가 둔 큰 파일을 통째로 읽지 않는다 — 표시 줄은 머리에 있다.
        if (fs.statSync(file).size > 64 * 1024) return null;
        return fs.readFileSync(file, 'utf8');
      } catch {
        return null;
      }
    },
    run(cmd, args) {
      return new Promise((resolve, reject) => {
        execFile(cmd, args, { windowsHide: true, timeout: 20_000 }, (err) => (err ? reject(err) : resolve()));
      });
    },
    has(bin) {
      // Finder·데스크톱 런처로 띄운 앱은 PATH 가 짧을 수 있다 — 표준 자리도 본다.
      const dirs = [...(env.PATH ?? '').split(path.delimiter), '/usr/bin', '/usr/local/bin', '/bin'];
      return dirs.some((d) => d !== '' && fs.existsSync(path.join(d, bin)));
    },
  };
}
