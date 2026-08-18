/**
 * §5.14 v4.62 — 실행 레시피 탐지기 (4단 계단의 1~3단).
 *
 * "이 프로젝트는 어떻게 켜는가" 를 프로젝트 안의 흔적만 보고 답한다. 규칙은 하나다 —
 * **추측을 확신처럼 굴지 않는다.** 후보에는 신뢰도와 근거가 붙어 오고, 화면에는 그 근거가
 * 그대로 보인다(사용자가 "무엇이 실행되는지" 읽고 누르게).
 *
 * 4단(에이전트 위임)은 여기 없다 — 여기서 후보가 0개일 때 비로소 사람이 아닌 에이전트에게
 * 묻는 것이고, 그건 명령 큐의 일이다.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { PlayRecipeCandidate } from '@vibisual/shared';
import { PLAY_STATIC_INDEX_FILES, PLAY_STATIC_ROOT_DIRS } from '@vibisual/shared';

import { extractPort, extractPortFromScriptFile, isProbeCommand, isVibisualLauncherCommand } from './processChecker.js';

/** package.json scripts 중 "사용자가 눈으로 볼 화면" 에 가까운 순서. */
const SCRIPT_PRIORITY: readonly { name: string; confidence: number }[] = [
  { name: 'dev', confidence: 0.95 },
  { name: 'start', confidence: 0.88 },
  { name: 'serve', confidence: 0.84 },
  { name: 'preview', confidence: 0.8 },
  { name: 'dev:web', confidence: 0.78 },
  { name: 'storybook', confidence: 0.5 },
];

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** 락파일로 패키지 매니저를 고른다 — 없는 매니저를 부르면 그 자리에서 죽는다. */
function detectPackageManager(projectPath: string): 'pnpm' | 'yarn' | 'bun' | 'npm' {
  if (exists(path.join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(path.join(projectPath, 'yarn.lock'))) return 'yarn';
  if (exists(path.join(projectPath, 'bun.lockb')) || exists(path.join(projectPath, 'bun.lock'))) return 'bun';
  return 'npm';
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 1단 — 정적 서빙 후보. index.html 이 있으면 명령이 아예 필요 없다. */
function detectStatic(projectPath: string): PlayRecipeCandidate[] {
  const out: PlayRecipeCandidate[] = [];
  for (const dir of PLAY_STATIC_ROOT_DIRS) {
    const root = dir ? path.join(projectPath, dir) : projectPath;
    for (const indexFile of PLAY_STATIC_INDEX_FILES) {
      if (!exists(path.join(root, indexFile))) continue;
      out.push({
        kind: 'static',
        root,
        openPath: `/${indexFile}`,
        source: 'detected',
        label: dir ? `${dir}/${indexFile}` : indexFile,
        // 빌드 산출물(dist/build)보다 사람이 직접 여는 자리(루트·public)를 앞에 둔다.
        confidence: dir === '' ? 0.72 : dir === 'public' ? 0.7 : 0.55,
        reason: `${dir ? `${dir}/` : ''}${indexFile}`,
      });
      break;
    }
  }
  return out;
}

/** 2단 — 명령 탐지. package.json → python → go/rust 순. */
function detectCommands(projectPath: string): PlayRecipeCandidate[] {
  const out: PlayRecipeCandidate[] = [];

  const pkgPath = path.join(projectPath, 'package.json');
  const pkg = exists(pkgPath) ? readJson(pkgPath) : null;
  if (pkg) {
    const scripts = (pkg['scripts'] ?? {}) as Record<string, unknown>;
    const pm = detectPackageManager(projectPath);
    for (const { name, confidence } of SCRIPT_PRIORITY) {
      const body = scripts[name];
      if (typeof body !== 'string' || body.trim().length === 0) continue;
      const command = pm === 'npm' ? `npm run ${name}` : `${pm} run ${name}`;
      const port = extractPort(body) ?? extractPortFromScriptFile(body, projectPath);
      out.push({
        kind: 'command',
        command,
        cwd: projectPath,
        ...(port !== undefined ? { port } : {}),
        source: 'detected',
        label: `${command} — ${body.length > 60 ? `${body.slice(0, 57)}…` : body}`,
        confidence,
        reason: `package.json scripts.${name}`,
      });
    }
  }

  // python — 흔한 진입점 세 가지. 포트는 파일 안의 listen 선언에서 뽑아 본다.
  const pyEntries: readonly { file: string; command: string; confidence: number }[] = [
    { file: 'manage.py', command: 'python manage.py runserver', confidence: 0.86 },
    { file: 'app.py', command: 'python app.py', confidence: 0.8 },
    { file: 'main.py', command: 'python main.py', confidence: 0.74 },
    { file: 'server.py', command: 'python server.py', confidence: 0.74 },
  ];
  for (const entry of pyEntries) {
    if (!exists(path.join(projectPath, entry.file))) continue;
    const port = extractPortFromScriptFile(`python ${path.join(projectPath, entry.file)}`, projectPath);
    out.push({
      kind: 'command',
      command: entry.command,
      cwd: projectPath,
      ...(port !== undefined ? { port } : {}),
      source: 'detected',
      label: entry.command,
      confidence: entry.confidence,
      reason: entry.file,
    });
  }

  if (exists(path.join(projectPath, 'Cargo.toml'))) {
    out.push({
      kind: 'command',
      command: 'cargo run',
      cwd: projectPath,
      source: 'detected',
      label: 'cargo run',
      confidence: 0.7,
      reason: 'Cargo.toml',
    });
  }
  if (exists(path.join(projectPath, 'go.mod'))) {
    out.push({
      kind: 'command',
      command: 'go run .',
      cwd: projectPath,
      source: 'detected',
      label: 'go run .',
      confidence: 0.7,
      reason: 'go.mod',
    });
  }

  return out;
}

/**
 * 3단 — 관찰 학습. 이 프로젝트에서 **실제로 떴던** 명령이 가장 정확한 답이다.
 *
 * 에이전트가 한 번 켜 준 적이 있으면 그다음부터는 사용자의 클릭만으로 켜진다.
 */
function detectObserved(projectPath: string, observed: readonly { command: string; port?: number }[]): PlayRecipeCandidate[] {
  const out: PlayRecipeCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of observed) {
    const command = entry.command.trim();
    if (!command || seen.has(command)) continue;
    // probe(curl 등)·Vibisual 자기 런처는 "이 앱을 켜는 명령" 이 아니다.
    if (isProbeCommand(command) || isVibisualLauncherCommand(command)) continue;
    // URL 만 남은 신고 전용 entry(§7.11 reportedOnly) 는 명령이 아니다.
    if (/^https?:\/\//i.test(command)) continue;
    seen.add(command);
    const port = entry.port ?? extractPort(command);
    out.push({
      kind: 'command',
      command,
      cwd: projectPath,
      ...(port !== undefined ? { port } : {}),
      source: 'observed',
      label: command.length > 70 ? `${command.slice(0, 67)}…` : command,
      // 실측이라 탐지보다 세게 믿는다.
      confidence: 0.97,
      reason: 'previously running in this project',
    });
  }
  return out;
}

/**
 * 후보 전부를 신뢰도 순으로. 첫 번째가 곧 "플레이를 누르면 실행될 것" 이다.
 *
 * @param observed 이 프로젝트에서 실제로 떠 있던 명령(runningServers/bashHistory).
 */
export function detectPlayRecipes(
  projectPath: string,
  observed: readonly { command: string; port?: number }[] = [],
): PlayRecipeCandidate[] {
  if (!projectPath || !exists(projectPath)) return [];
  const all = [...detectObserved(projectPath, observed), ...detectCommands(projectPath), ...detectStatic(projectPath)];
  return all.sort((a, b) => b.confidence - a.confidence);
}
