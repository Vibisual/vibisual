/**
 * editorLauncher.ts — 멀티플랫폼 에디터/탐색기 실행 모듈
 *
 * 모든 "외부 앱으로 파일/폴더 열기" 로직을 이 모듈에서 처리한다.
 * 엔드포인트에서 직접 spawn하지 않고, 이 모듈의 함수를 호출한다.
 *
 * 에디터 감지 우선순위:
 *   1. VISUAL / EDITOR 환경변수
 *   2. PATH에서 에디터 자동 탐색 (인기순)
 *   3. 플랫폼 기본 앱 (notepad / open / xdg-open)
 */

import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../logger.js';

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

/** 커맨드가 PATH에 존재하는지 확인 */
function commandExists(cmd: string): boolean {
  // Validate cmd contains only safe characters before passing as an argument.
  if (!/^[a-zA-Z0-9_\-.]+$/.test(cmd)) return false;
  try {
    if (IS_WIN) {
      // where.exe exits 0 when found, 1 when not found — no shell interpolation.
      execFileSync('where.exe', [cmd], { stdio: 'ignore' });
    } else {
      // `which` is universally available on POSIX; no shell needed.
      execFileSync('which', [cmd], { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 에디터 감지 — 우선순위:
 * 1. VISUAL / EDITOR 환경변수
 * 2. EDITOR_TABLE 순서대로 PATH 스캔
 * 3. null (폴백 필요)
 */
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

    if (commandExists(cmd)) {
      cachedEditor = { bin: cmd, config };
      logger.info(`Editor detected (PATH): ${cmd}`);
      return cachedEditor;
    }
  }

  logger.info('No editor detected, will use platform fallback');
  return null;
}

// ─── 스폰 헬퍼 ───

/**
 * Windows: PowerShell 경유 spawn
 * @param bin 실행 파일
 * @param args 인자
 * @param hideLauncher .cmd 같은 래퍼의 cmd.exe 창 숨김 (실제 앱은 별도 프로세스라 보임)
 * @param activateHint AppActivate로 창을 포그라운드로 가져올 윈도우 타이틀 힌트
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

/**
 * 파일을 에디터에서 열기 (특정 위치로 이동)
 * @param absPath 절대 경로
 * @param line 줄 번호 (1-based)
 * @param col 컬럼 번호 (1-based)
 */
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
 * 폴더를 시스템 탐색기에서 열기
 * @param absPath 절대 경로 (파일이면 상위 폴더를 염)
 */
export function openFolder(absPath: string): void {
  let dirPath = absPath;
  try {
    if (fs.existsSync(absPath) && !fs.statSync(absPath).isDirectory()) {
      dirPath = path.dirname(absPath);
    }
  } catch {
    dirPath = path.dirname(absPath);
  }

  // Windows: 슬래시 → 역슬래시 정규화 (explorer가 선호, 일부 경로에서 인자 파싱 오류 회피).
  const native = IS_WIN ? path.win32.normalize(dirPath) : dirPath;
  logger.info(`openFolder: ${native}`);

  if (IS_WIN) {
    // 백그라운드 Node 서버가 explorer.exe 를 직접 spawn 하면 Windows 포그라운드 잠금
    // (SetForegroundWindow 제한)에 걸려 새 탐색기 창이 VSCode/브라우저 뒤로 열리고
    // 작업표시줄만 깜빡인다. → PowerShell 로 (1) 폴더 열고 (2) 해당 경로의
    // 탐색기 창 HWND 를 찾아 AttachThreadInput 우회로 강제 포그라운드 한다.
    // 폴더 오픈(Start-Process)은 스크립트 맨 앞에서 먼저 수행되므로, 뒤의
    // Add-Type/창탐색이 실패해도 "열리긴 한다" 는 보장됨.
    const targetEsc = native.replace(/'/g, "''");
    const psCmd = [
      "$ErrorActionPreference='SilentlyContinue'",
      `$target='${targetEsc}'`,
      'Start-Process explorer.exe -ArgumentList @($target)',
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
      "  if($p -and ($p.TrimEnd('\\\\') -ieq $target.TrimEnd('\\\\'))){ $hwnd=[IntPtr]$w.HWND; break }",
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
    spawnUnix('open', [native]);
  } else {
    spawnUnix('xdg-open', [native]);
  }
}

/**
 * 파일에서 searchText를 찾아 해당 위치에서 에디터 열기
 * @param absPath 절대 경로
 * @param searchText 파일 내 검색할 텍스트 (없으면 1:1)
 */
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
