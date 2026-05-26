import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ClaudeBinSource = 'vscode-extension' | 'path' | 'unknown';

export interface ClaudeBinInfo {
  binPath: string;
  source: ClaudeBinSource;
}

const IS_WIN = process.platform === 'win32';
/** 확장 번들/네이티브 바이너리 파일명 — Windows 만 `.exe`. */
const BIN_FILE = IS_WIN ? 'claude.exe' : 'claude';

/**
 * VS Code 본체 + 변종 IDE 의 `extensions` 디렉터리 후보.
 * 존재하는 것만 스캔하므로 다 넣어도 비용 없음. (mac/Linux/Win 모두 home 기준 동일 레이아웃)
 */
function vscodeExtensionDirs(): string[] {
  const home = os.homedir();
  return [
    '.vscode',           // VS Code stable
    '.vscode-insiders',  // VS Code Insiders
    '.vscode-oss',       // VSCodium
    '.vscode-server',    // Remote-SSH / devcontainer / code-server
    '.cursor',           // Cursor (VS Code fork — Claude Code 사용자 다수)
    '.windsurf',         // Windsurf (VS Code fork)
  ].map((b) => path.join(home, b, 'extensions'));
}

/** VS Code(및 변종) 확장이 번들한 claude 바이너리 절대경로 — 없으면 null. */
function findVscodeExtensionBin(): string | null {
  for (const extDir of vscodeExtensionDirs()) {
    let entries: string[];
    try {
      entries = fs.readdirSync(extDir);
    } catch {
      continue; // 해당 IDE 미설치
    }
    const match = entries
      .filter((d) => d.startsWith('anthropic.claude-code-'))
      .sort()
      .pop();
    if (!match) continue;
    // 확장 번들 레이아웃: <ext>/resources/native-binary/claude(.exe) — OS 무관 동일.
    const bin = path.join(extDir, match, 'resources', 'native-binary', BIN_FILE);
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

/**
 * PATH + 잘 알려진 네이티브/패키지 설치 위치에서 claude 절대경로 탐색 (sync).
 * GUI 런치 앱은 사용자 셸 PATH 를 상속하지 않을 수 있어(특히 macOS) 알려진 위치로 보완한다.
 */
function findOnPathOrKnownLocations(): string | null {
  const home = os.homedir();
  const candidates: string[] = [];

  // 1) PATH 디렉터리 스캔
  const pathEntries = (process.env.PATH ?? '').split(IS_WIN ? ';' : ':').filter(Boolean);
  if (IS_WIN) {
    const exts = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.trim()).filter(Boolean);
    for (const dir of pathEntries) {
      for (const ext of exts) candidates.push(path.join(dir, `claude${ext.toLowerCase()}`));
    }
  } else {
    for (const dir of pathEntries) candidates.push(path.join(dir, 'claude'));
  }

  // 2) 잘 알려진 설치 위치 (PATH 미상속 GUI 앱 보완)
  const known = IS_WIN
    ? [
        path.join(home, '.local', 'bin', 'claude.exe'),
        path.join(home, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
        path.join(home, '.claude', 'local', 'claude.exe'),
        path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'npm', 'claude.cmd'),
      ]
    : [
        path.join(home, '.local', 'bin', 'claude'),       // 공식 네이티브 인스톨러
        path.join(home, '.claude', 'local', 'claude'),    // migrate-installer
        '/opt/homebrew/bin/claude',                       // Apple Silicon Homebrew
        '/usr/local/bin/claude',                          // Intel Homebrew / 수동
        '/usr/bin/claude',
        path.join(home, '.npm-global', 'bin', 'claude'),  // npm prefix 커스텀
      ];
  candidates.push(...known);

  for (const c of candidates) {
    try {
      const st = fs.statSync(c);
      if (!st.isFile()) continue;
      if (IS_WIN) return c;
      // posix: 실행 권한 있는 것만
      try {
        fs.accessSync(c, fs.constants.X_OK);
        return c;
      } catch {
        /* 실행권한 없음 — 스킵 */
      }
    } catch {
      /* 존재 안 함 — 다음 후보 */
    }
  }
  return null;
}

/**
 * §5.7 #23-1 v1.81 — `claude` CLI 바이너리 위치 + 출처 판정 SSOT (멀티플랫폼).
 * `subAgentManager`(spawn) 와 `claudeVersionService`(--version / 업데이트) 가 동일 경로를 쓰도록 단일화.
 *
 * **동기 함수 유지** — 여러 서비스가 모듈 로드 시 top-level (`const X = resolveClaudeBin().binPath`)
 * 로 호출하므로 async 화 금지. 모든 탐색은 sync fs.
 *
 * 우선순위:
 *  1) VS Code(및 Insiders/VSCodium/Remote/Cursor/Windsurf) 확장 번들 바이너리 → 'vscode-extension'
 *     (Windows `claude.exe` / mac·Linux `claude` 둘 다 처리)
 *  2) PATH / 알려진 네이티브·패키지 설치 위치의 절대경로 → 'path' (절대경로 회수 = mac GUI PATH 갭 보완)
 *  3) 모두 실패해도 'claude' 문자열 반환(spawn 이 ENOENT 던지게) + source='path'(낙관)
 *     → `claudeVersionService` 가 `--version` 검증 실패 시 'unknown' 으로 격하한다.
 */
export function resolveClaudeBin(): ClaudeBinInfo {
  const ext = findVscodeExtensionBin();
  if (ext) return { binPath: ext, source: 'vscode-extension' };

  const found = findOnPathOrKnownLocations();
  if (found) return { binPath: found, source: 'path' };

  // 낙관적 폴백 — bare 'claude'. spawn PATH 해석에 맡기고, --version 검증 실패 시 호출 측이 'unknown' 격하.
  return { binPath: 'claude', source: 'path' };
}
