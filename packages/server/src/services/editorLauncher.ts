/**
 * 멀티플랫폼 에디터/탐색기 실행 모듈 — "외부 앱으로 파일/폴더 열기"는 전부 여기서 한다(엔드포인트에서 직접 spawn 하지 않는다).
 * 에디터 감지 우선순위: 1. VISUAL / EDITOR 환경변수 2. PATH 에서 인기순 탐색 3. 플랫폼 기본 앱(notepad / open / xdg-open).
 */

import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { logger } from '../logger.js';
import { resolveBinary } from './binLocator.js';

// ─── 플랫폼 감지 ───

type Platform = 'win32' | 'darwin' | 'linux';

const PLATFORM = process.platform as Platform;
const IS_WIN = PLATFORM === 'win32';
const IS_MAC = PLATFORM === 'darwin';

// ─── 에디터 Config 테이블 ───

interface EditorConfig {
  /** PATH에서 찾을 커맨드 이름 */
  command: string;
  /** Windows에서의 대체 커맨드 (.cmd 래퍼 등) */
  winCommand?: string;
  /** file:line:col 형식 goto 인자 생성 */
  buildArgs: (filePath: string, line: number, col: number) => string[];
}

/**
 * 에디터 감지 순서 — 인기순.
 * 새 에디터 추가 시 여기 한 줄만 추가하면 됨.
 */
const EDITOR_TABLE: EditorConfig[] = [
  {
    command: 'code',
    winCommand: 'code.cmd',
    buildArgs: (f, l, c) => ['-g', `${f}:${l}:${c}`],
  },
  {
    command: 'cursor',
    winCommand: 'cursor.cmd',
    buildArgs: (f, l, c) => ['-g', `${f}:${l}:${c}`],
  },
  {
    command: 'nvim',
    buildArgs: (f, l) => [`+${l}`, f],
  },
  {
    command: 'vim',
    buildArgs: (f, l) => [`+${l}`, f],
  },
  {
    command: 'webstorm',
    buildArgs: (f, l, c) => ['--line', String(l), '--column', String(c), f],
  },
  {
    command: 'idea',
    buildArgs: (f, l, c) => ['--line', String(l), '--column', String(c), f],
  },
  {
    command: 'subl',
    buildArgs: (f, l, c) => [`${f}:${l}:${c}`],
  },
  {
    command: 'zed',
    buildArgs: (f, l, c) => [`${f}:${l}:${c}`],
  },
];

// ─── 에디터 탐색 ───

/** 캐시: 한 번 탐색하면 프로세스 수명 동안 재사용 */
let cachedEditor: { bin: string; config: EditorConfig } | null = null;
let cacheChecked = false;

/** Windows에서 VS Code의 풀 경로 탐색 */
function resolveWinFullPath(cmd: string): string | null {
  if (cmd === 'code.cmd' || cmd === 'code') {
    const localAppData = process.env['LOCALAPPDATA'] ?? '';
    const candidate = path.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd');
    if (fs.existsSync(candidate)) return candidate;
  }
  if (cmd === 'cursor.cmd' || cmd === 'cursor') {
    const localAppData = process.env['LOCALAPPDATA'] ?? '';
    const candidate = path.join(localAppData, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * mac/Linux 에서 PATH 에 안 들어가는 에디터 CLI 런처 자리. macOS VS Code·Cursor 는 `code` 를 `.app` 번들 안에 두고 "Install 'code' command in PATH" 를 눌러야 `/usr/local/bin` 에 생긴다.
 * 게다가 Finder 로 띄운 앱의 PATH 는 launchd 최소값이라 눌렀어도 안 보인다 — 이 자리가 없으면 "VS Code 로 열기"가 TextEdit(`open -t`) 폴백으로 떨어진다.
 */
export function knownEditorPaths(
  command: string,
  platform: NodeJS.Platform = PLATFORM,
  home: string = os.homedir(),
): string[] {
  const p = path.posix;
  if (platform === 'darwin') {
    const apps = ['/Applications', p.join(home, 'Applications')];
    switch (command) {
      case 'code':
        return apps.map((a) => `${a}/Visual Studio Code.app/Contents/Resources/app/bin/code`);
      case 'cursor':
        return apps.map((a) => `${a}/Cursor.app/Contents/Resources/app/bin/cursor`);
      case 'zed':
        return apps.map((a) => `${a}/Zed.app/Contents/MacOS/cli`);
      case 'subl':
        return apps.map((a) => `${a}/Sublime Text.app/Contents/SharedSupport/bin/subl`);
      case 'webstorm':
      case 'idea':
        return [
          // JetBrains Toolbox 가 만드는 CLI 스크립트 폴더(PATH 등록은 사용자 선택).
          p.join(home, 'Library', 'Application Support', 'JetBrains', 'Toolbox', 'scripts', command),
          ...apps.map((a) => `${a}/${command === 'idea' ? 'IntelliJ IDEA' : 'WebStorm'}.app/Contents/MacOS/${command}`),
        ];
      default:
        return [];
    }
  }
  // Windows 는 `resolveWinFullPath` 가 이미 고정 경로를 보고 있어 여기서 더할 것이 없다.
  if (platform === 'win32') return [];
  // Linux — 배포판 패키지 / snap / flatpak 설치 자리.
  switch (command) {
    case 'code':
      return ['/snap/bin/code', '/usr/share/code/bin/code', '/opt/visual-studio-code/bin/code', '/usr/bin/code'];
    case 'cursor':
      return ['/opt/Cursor/resources/app/bin/cursor', '/usr/share/cursor/bin/cursor', p.join(home, '.local', 'bin', 'cursor')];
    case 'zed':
      return [p.join(home, '.local', 'bin', 'zed'), '/usr/bin/zed'];
    case 'subl':
      return ['/opt/sublime_text/subl', '/snap/bin/subl'];
    case 'webstorm':
    case 'idea':
      return [
        p.join(home, '.local', 'share', 'JetBrains', 'Toolbox', 'scripts', command),
        `/snap/bin/${command === 'idea' ? 'intellij-idea-community' : 'webstorm'}`,
      ];
    default:
      return [];
  }
}

/**
 * 커맨드의 절대경로(못 찾으면 null). `where`/`which` 를 쓰지 마라 — 우리 PATH 만 보므로 PATH 가 잘린 바로 그 상황(Finder 로 띄운 macOS 앱)에서 못 찾는다.
 * `binLocator` 가 보강된 PATH + 알려진 위치를 본다.
 */
function findEditorBin(cmd: string, command: string): string | null {
  // 인자로 넘길 값이라 이름에 안전한 문자만 허용한다(종전 가드 유지).
  if (!/^[a-zA-Z0-9_\-.]+$/.test(cmd)) return null;
  return resolveBinary(cmd, knownEditorPaths(command));
}

/** 에디터 감지: VISUAL / EDITOR 환경변수 → EDITOR_TABLE 순서로 PATH 스캔 → null(폴백 필요). */
function detectEditor(): { bin: string; config: EditorConfig } | null {
  if (cacheChecked) return cachedEditor;
  cacheChecked = true;

  // 1. 환경변수 (VISUAL > EDITOR)
  const envEditor = process.env['VISUAL'] || process.env['EDITOR'] || '';
  if (envEditor && !/notepad/i.test(envEditor)) {
    // 환경변수 에디터를 테이블에서 매칭
    const baseName = path.basename(envEditor).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
    const matched = EDITOR_TABLE.find((e) => e.command === baseName);
    if (matched) {
      cachedEditor = { bin: envEditor, config: matched };
      logger.info(`Editor detected (env): ${envEditor}`);
      return cachedEditor;
    }
    // 테이블에 없는 에디터 — file:line:col goto 형식으로 시도
    cachedEditor = {
      bin: envEditor,
      config: {
        command: baseName,
        buildArgs: (f, l, c) => [`${f}:${l}:${c}`],
      },
    };
    logger.info(`Editor detected (env, generic): ${envEditor}`);
    return cachedEditor;
  }

  // 2. PATH 스캔 (테이블 순서대로)
  for (const config of EDITOR_TABLE) {
    const cmd = IS_WIN ? (config.winCommand ?? config.command) : config.command;

    // Windows: 풀 경로 우선 확인
    if (IS_WIN) {
      const fullPath = resolveWinFullPath(cmd);
      if (fullPath) {
        cachedEditor = { bin: fullPath, config };
        logger.info(`Editor detected (full path): ${fullPath}`);
        return cachedEditor;
      }
    }

    // mac/Linux 도 여기서 알려진 설치 위치까지 본다 — 종전엔 `which` 한 번뿐이라
    //   `.app` 번들 안의 `code` 를 못 찾아 아래 `open -t`(TextEdit) 폴백으로 떨어졌다.
    const found = findEditorBin(cmd, config.command);
    if (found) {
      cachedEditor = { bin: found, config };
      logger.info(`Editor detected: ${found}`);
      return cachedEditor;
    }
  }

  logger.info('No editor detected, will use platform fallback');
  return null;
}

// ─── 스폰 헬퍼 ───

/**
 * Windows: PowerShell 경유 spawn.
 * @param hideLauncher .cmd 같은 래퍼의 cmd.exe 창 숨김(실제 앱은 별도 프로세스라 보인다)
 * @param activateHint AppActivate 로 창을 포그라운드로 가져올 윈도우 타이틀 힌트
 */
function spawnWin(bin: string, args: string[], hideLauncher: boolean, activateHint?: string): void {
  const safeBin = bin.replace(/'/g, "''");
  const safeArgs = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',');
  const hideFlag = hideLauncher ? ' -WindowStyle Hidden' : '';
  let psCmd = `Start-Process '${safeBin}'${hideFlag} -ArgumentList ${safeArgs}`;
  if (activateHint) {
    const safeHint = activateHint.replace(/'/g, "''");
    psCmd += `; Start-Sleep -Milliseconds 500; (New-Object -ComObject WScript.Shell).AppActivate('${safeHint}')`;
  }
  const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psCmd], {
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  child.on('error', (err) => logger.warn(`spawnWin failed: ${err.message}`));
}

/** macOS/Linux: detached spawn */
function spawnUnix(bin: string, args: string[]): void {
  const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
  child.unref();
  child.on('error', (err) => logger.warn(`spawn failed: ${bin} ${args.join(' ')} — ${err.message}`));
}

// ─── Public API ───

/** 파일을 에디터에서 그 위치로 연다. `line`·`col` 은 1-based. */
export function openFile(absPath: string, line = 1, col = 1): void {
  const editor = detectEditor();
  const titleHint = path.basename(absPath);

  if (editor) {
    const args = editor.config.buildArgs(absPath, line, col);
    logger.info(`openFile: ${editor.bin} ${args.join(' ')}`);
    if (IS_WIN) {
      // .cmd 래퍼(code.cmd 등)의 cmd.exe 창을 숨김. 실제 에디터(VS Code electron)는 별도 프로세스라 보임.
      const isCmdWrapper = /\.cmd$/i.test(editor.bin);
      spawnWin(editor.bin, args, isCmdWrapper, titleHint);
    } else {
      spawnUnix(editor.bin, args);
    }
    return;
  }

  // 폴백: 플랫폼 기본 앱
  logger.info(`openFile (fallback): ${absPath}`);
  if (IS_WIN) {
    spawnWin('notepad.exe', [absPath], false, titleHint);
  } else if (IS_MAC) {
    spawnUnix('open', ['-t', absPath]);
  } else {
    spawnUnix('xdg-open', [absPath]);
  }
}

/**
 * §5.13 (R-6) — OS 연결 프로그램으로 연다(에디터가 아니라). `openFile` 은 코드를 고치러 가는 길이라 VS Code·Cursor 를 찾고 못 찾으면 메모장으로 떨어진다 —
 * zip·폰트·xlsx 를 그리로 보내면 메모장에 이진 바이트가 쏟아진다. 여기서는 확장자에 물린 프로그램을 부른다(Windows `Start-Process` · macOS `open` · 그 밖 `xdg-open`, 탐색기 더블클릭과 같게).
 * `openFile` 과 병행이다(대체가 아니다).
 */
export function openWithDefaultApp(absPath: string): void {
  logger.info(`openWithDefaultApp: ${absPath}`);

  if (IS_WIN) {
    // `Start-Process <파일>` 은 확장자 연결(association)을 따른다. explorer.exe 에 인자로 넘기는
    // 방식과 달리 공백·괄호가 든 경로에서도 인자 파싱이 어긋나지 않는다.
    const target = absPath.replace(/'/g, "''");
    const psCmd = `$ErrorActionPreference='Stop'; Start-Process -FilePath '${target}'`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psCmd], {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    child.on('error', (err) => logger.warn(`openWithDefaultApp failed: ${err.message}`));
    return;
  }

  if (IS_MAC) {
    // `-t`(텍스트 편집기로) 를 주지 않는다 — 그 플래그가 바로 `openFile` 쪽 규약이다.
    spawnUnix('open', [absPath]);
    return;
  }

  spawnUnix('xdg-open', [absPath]);
}

/**
 * 폴더를 시스템 탐색기에서 열기
 * @param absPath 절대 경로 (파일이면 상위 폴더에서 해당 파일을 선택)
 */
export function openFolder(absPath: string): void {
  const paths = IS_WIN ? path.win32 : path.posix;
  const target = IS_WIN ? paths.normalize(absPath) : absPath;
  let dirPath = target;
  let selectFile = false;
  try {
    if (fs.existsSync(target) && !fs.statSync(target).isDirectory()) {
      selectFile = true;
      dirPath = paths.dirname(target);
    }
  } catch {
    dirPath = paths.dirname(target);
  }

  logger.info(`openFolder: ${target}${selectFile ? ' (select)' : ''}`);

  if (IS_WIN) {
    // 백그라운드 Node 서버가 explorer.exe 를 직접 spawn 하면 Windows 포그라운드 잠금(SetForegroundWindow 제한)으로 새 창이 뒤에 열리고 작업표시줄만 깜빡인다.
    // 그래서 PowerShell 로 (1) 폴더를 열고 (2) 그 탐색기 창 HWND 를 찾아 AttachThreadInput 우회로 포그라운드로 올린다. 폴더 열기(Start-Process)가 맨 앞이라 뒤가 실패해도 열리긴 한다.
    // 경로는 데이터다 — 스마트 따옴표도 PowerShell 구분자라 파일 이름을 스크립트에 직접 끼우지 마라.
    const psPath = (value: string): string =>
      `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(value, 'utf8').toString('base64')}'))`;
    const psCmd = [
      "$ErrorActionPreference='SilentlyContinue'",
      `$target=${psPath(target)}`,
      `$folder=${psPath(dirPath)}`,
      `$itemName=${psPath(paths.basename(target))}`,
      `$select=$${selectFile ? 'true' : 'false'}`,
      // Start-Process joins ArgumentList, so quote the path inside the argument itself.
      `if($select){ $explorerArgs='/select,"'+$target+'"' }else{ $explorerArgs='"'+$folder+'"' }`,
      'Start-Process explorer.exe -ArgumentList $explorerArgs',
      'Add-Type @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public static class VbFg {',
      ' [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
      ' [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);',
      ' [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);',
      ' [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
      ' [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);',
      ' [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);',
      ' [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();',
      ' public static void Force(IntPtr h){',
      '  IntPtr fg=GetForegroundWindow();',
      '  uint ftid=GetWindowThreadProcessId(fg,IntPtr.Zero);',
      '  uint cur=GetCurrentThreadId();',
      '  AttachThreadInput(cur,ftid,true);',
      '  ShowWindow(h,9); BringWindowToTop(h); SetForegroundWindow(h);',
      '  AttachThreadInput(cur,ftid,false);',
      ' }',
      '}',
      '"@',
      "$deadline=(Get-Date).AddSeconds(4); $hwnd=[IntPtr]::Zero",
      'while((Get-Date) -lt $deadline -and $hwnd -eq [IntPtr]::Zero){',
      ' Start-Sleep -Milliseconds 150',
      ' $sh=New-Object -ComObject Shell.Application',
      ' foreach($w in $sh.Windows()){ try{',
      '  $p=$w.Document.Folder.Self.Path',
      "  if($p -and ($p.TrimEnd('\\\\') -ieq $folder.TrimEnd('\\\\'))){",
      // Select, deselect others, scroll into view, and focus (1 | 4 | 8 | 16).
      '   if($select){ $item=$w.Document.Folder.ParseName($itemName); if($null -eq $item){ continue }; $w.Document.SelectItem($item,29) }',
      '   $hwnd=[IntPtr]$w.HWND; break',
      '  }',
      ' }catch{} }',
      '}',
      'if($hwnd -ne [IntPtr]::Zero){ [VbFg]::Force($hwnd) }',
    ].join('\n');
    // -EncodedCommand (UTF-16LE base64): 멀티라인 here-string/쿼팅 파싱 함정을 전부 우회.
    const encoded = Buffer.from(psCmd, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    child.on('error', (err) => logger.warn(`openFolder spawn failed: ${err.message}`));
  } else if (IS_MAC) {
    spawnUnix('open', selectFile ? ['-R', target] : [dirPath]);
  } else if (selectFile) {
    // FileManager1 reveals and selects files across supporting Linux file managers.
    // dbus-send uses commas to delimit array elements, including inside a URI.
    const uri = pathToFileURL(target, { windows: false }).href.replace(/,/g, '%2C');
    const child = spawn('dbus-send', [
      '--session', '--print-reply', '--reply-timeout=3000',
      '--dest=org.freedesktop.FileManager1',
      '/org/freedesktop/FileManager1',
      'org.freedesktop.FileManager1.ShowItems',
      `array:string:${uri}`, 'string:',
    ], { detached: true, stdio: 'ignore' });
    let fellBack = false;
    const openParent = (): void => {
      if (fellBack) return;
      fellBack = true;
      spawnUnix('xdg-open', [dirPath]);
    };
    child.once('error', openParent);
    child.once('close', (code) => { if (code !== 0) openParent(); });
    child.unref();
  } else {
    spawnUnix('xdg-open', [dirPath]);
  }
}

/** 파일에서 `searchText` 를 찾아 그 위치로 에디터를 연다(없으면 1:1). */
export function openFileAtSearch(absPath: string, searchText?: string): void {
  let line = 1;
  let col = 1;

  if (searchText && searchText.length > 0) {
    try {
      const content = fs.readFileSync(absPath, 'utf8');
      const idx = content.indexOf(searchText);
      if (idx >= 0) {
        const before = content.substring(0, idx);
        line = before.split('\n').length;
        const lastNewline = before.lastIndexOf('\n');
        col = idx - lastNewline;
      }
      logger.info(`openFileAtSearch: idx=${idx} line=${line} col=${col} searchLen=${searchText.length}`);
    } catch (err) {
      logger.warn(`openFileAtSearch readFile failed: ${absPath} — ${err instanceof Error ? err.message : err}`);
    }
  }

  openFile(absPath, line, col);
}

/** 에디터 캐시 초기화 (테스트용) */
export function resetEditorCache(): void {
  cachedEditor = null;
  cacheChecked = false;
}
