/**
 * §5.5 #17-20 ② v4.74 — 실행 구성 스캐너.
 *
 * "이 프로젝트를 어떻게 실행하나" 를 **사용자가 이미 가진 파일**에서 읽는다. 새 설정 포맷을
 * 발명하지 않는 것이 이 모듈의 유일한 규율이다 — VS Code 를 쓰던 사람은 손대지 않고 자기
 * `launch.json` 이 그대로 목록에 뜨는 것을 본다.
 *
 * 출처는 넷 + 하나:
 *   1. `.vscode/launch.json`  — VS Code 디버그 구성(JSONC)
 *   2. `.vscode/tasks.json`   — 빌드/실행 태스크(JSONC)
 *   3. `package.json` scripts — 가장 흔한 실행법
 *   4. `.vibisual/run.json`   — 위 셋으로 표현이 안 될 때 사용자가 직접 쓰는 우리 몫
 *   + §5.14 `playRecipeDetector` 의 탐지 결과(같은 질문에 이미 답하고 있으므로 두 번 만들지 않는다)
 *
 * 디스크가 SSOT 라 상태를 들지 않는다(체크포인트·broadcast 미관여) — 매번 읽어서 만든다.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { RunConfig, RunConfigKind, RunConfigSource } from '@vibisual/shared';
import { RUN_CONFIG_MAX, detectRunRuntime } from '@vibisual/shared';

import { detectPlayRecipes } from './playRecipeDetector.js';
import { extractPort } from './processChecker.js';
import { inspectUnrealProject } from './unrealProjectService.js';

/** 스캔 대상 파일이 이보다 크면 읽지 않는다(설정 파일이 이만큼 클 리 없다 = 잘못된 파일). */
const CONFIG_FILE_MAX_BYTES = 512 * 1024;

function readTextFile(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > CONFIG_FILE_MAX_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * JSONC(주석 + 후행 쉼표) 관용 파서.
 *
 * `launch.json`·`tasks.json` 은 **VS Code 가 주석을 허용하는 포맷**이고 실제 파일에는 거의 항상
 * 주석이 들어 있다. `JSON.parse` 를 그대로 쓰면 사용자의 진짜 구성이 통째로 "없음" 이 된다.
 * 문자열 안의 `//` 와 이스케이프를 건너뛰며 훑는 상태 기계라 경로(`https://`)를 잘라먹지 않는다.
 */
export function parseJsonc(raw: string): unknown {
  let out = '';
  let i = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < raw.length) {
    const ch = raw[i] ?? '';
    const next = raw[i + 1] ?? '';

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        // 이스케이프된 다음 글자는 통째로 통과 — `\"` 를 문자열 종료로 오인하지 않게.
        out += next;
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }

  // 후행 쉼표 제거 — `,` 다음에 공백을 건너뛴 첫 글자가 닫는 괄호면 그 쉼표는 없앤다.
  const withoutTrailingCommas = out.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(withoutTrailingCommas);
  } catch {
    return null;
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function asStringRecord(v: unknown): Record<string, string> | undefined {
  const rec = asRecord(v);
  if (!rec) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(rec)) {
    if (typeof val === 'string') out[k] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 공백이 든 인자만 따옴표 — 셸 한 줄로 합칠 때. */
function quote(s: string): string {
  return /\s/.test(s) && !/^".*"$/.test(s) ? `"${s}"` : s;
}

/**
 * VS Code 변수 치환 — 최소한만. 우리가 아는 것만 바꾸고 모르는 `${...}` 는 **그대로 둔다**
 * (빈 문자열로 지우면 명령이 조용히 다른 뜻이 된다).
 */
function substituteVars(value: string, projectPath: string): string {
  return value
    .replace(/\$\{workspaceFolder\}/g, projectPath)
    .replace(/\$\{workspaceRoot\}/g, projectPath)
    .replace(/\$\{cwd\}/g, projectPath)
    .replace(/\$\{pathSeparator\}/g, path.sep);
}

/** 락파일로 패키지 매니저를 고른다(§5.14 탐지기와 같은 규칙 — 없는 매니저를 부르면 그 자리에서 죽는다). */
function detectPackageManager(projectPath: string): 'pnpm' | 'yarn' | 'bun' | 'npm' {
  const has = (f: string): boolean => {
    try {
      return fs.existsSync(path.join(projectPath, f));
    } catch {
      return false;
    }
  };
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  return 'npm';
}

/** id 는 출처+이름으로 만든다 — 다시 스캔해도 같은 구성이 같은 id 를 갖게(선택 상태가 유지된다). */
function makeId(source: RunConfigSource, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'config';
  return `${source}:${slug}`;
}

/** scripts 이름으로 이 구성이 무엇인지 짐작 — 목록 그룹 머리로만 쓰인다. */
function guessKind(name: string, command: string): RunConfigKind {
  const t = `${name} ${command}`.toLowerCase();
  if (/\btest|vitest|jest|pytest\b/.test(t)) return 'test';
  if (/\bbuild|compile|bundle\b/.test(t)) return 'build';
  return 'run';
}

function finish(partial: Omit<RunConfig, 'runtime' | 'kind' | 'id'> & { kind?: RunConfigKind }): RunConfig {
  const runtime = detectRunRuntime(partial.command);
  const port = partial.port ?? extractPort(partial.command) ?? undefined;
  return {
    ...partial,
    id: makeId(partial.source, partial.name),
    kind: partial.kind ?? guessKind(partial.name, partial.command),
    runtime,
    ...(port ? { port } : {}),
  };
}

/** 1 — `.vscode/launch.json`. `request:'attach'` 는 우리가 띄우지 않으므로 attachOnly 로 표시만 한다. */
function scanLaunchJson(projectPath: string, scanned: string[]): RunConfig[] {
  const file = path.join(projectPath, '.vscode', 'launch.json');
  const raw = readTextFile(file);
  if (raw === null) return [];
  scanned.push('.vscode/launch.json');

  const root = asRecord(parseJsonc(raw));
  const list = Array.isArray(root?.['configurations']) ? (root['configurations'] as unknown[]) : [];
  const out: RunConfig[] = [];

  for (const entry of list) {
    const cfg = asRecord(entry);
    if (!cfg) continue;
    const name = asString(cfg['name']);
    if (!name) continue;

    const request = asString(cfg['request']) ?? 'launch';
    const cwdRaw = asString(cfg['cwd']);
    const cwd = cwdRaw ? substituteVars(cwdRaw, projectPath) : undefined;
    const env = asStringRecord(cfg['env']);
    const args = asStringArray(cfg['args']).map((a) => substituteVars(a, projectPath));

    // 명령 조립 — runtimeExecutable > program > (attach 는 명령 없음).
    const runtimeExec = asString(cfg['runtimeExecutable']);
    const program = asString(cfg['program']);
    const runtimeArgs = asStringArray(cfg['runtimeArgs']).map((a) => substituteVars(a, projectPath));

    let command = '';
    if (runtimeExec) {
      command = [substituteVars(runtimeExec, projectPath), ...runtimeArgs, ...args].map(quote).join(' ');
    } else if (program) {
      const resolved = substituteVars(program, projectPath);
      // node 계열 type 이면 node 로, 그 외에는 실행 파일 자체를 부른다.
      const type = (asString(cfg['type']) ?? '').toLowerCase();
      const isNodeish = /node|pwa-node|chrome|msedge/.test(type);
      command = isNodeish
        ? ['node', ...runtimeArgs, resolved, ...args].map(quote).join(' ')
        : [resolved, ...runtimeArgs, ...args].map(quote).join(' ');
    }

    const attachOnly = request === 'attach' || command.length === 0;
    out.push(
      finish({
        name,
        command: command || name,
        source: 'launch.json',
        reason: `.vscode/launch.json › ${name}`,
        ...(cwd ? { cwd } : {}),
        ...(env ? { env } : {}),
        ...(attachOnly ? { attachOnly: true, kind: 'attach' as RunConfigKind } : {}),
        ...(typeof cfg['port'] === 'number' ? { port: cfg['port'] as number } : {}),
      }),
    );
  }
  return out;
}

/** 2 — `.vscode/tasks.json`. shell/process 태스크의 command+args 를 한 줄로 합친다. */
function scanTasksJson(projectPath: string, scanned: string[]): RunConfig[] {
  const file = path.join(projectPath, '.vscode', 'tasks.json');
  const raw = readTextFile(file);
  if (raw === null) return [];
  scanned.push('.vscode/tasks.json');

  const root = asRecord(parseJsonc(raw));
  const list = Array.isArray(root?.['tasks']) ? (root['tasks'] as unknown[]) : [];
  const out: RunConfig[] = [];

  for (const entry of list) {
    const task = asRecord(entry);
    if (!task) continue;
    const label = asString(task['label']) ?? asString(task['taskName']);
    const commandRaw = asString(task['command']);
    if (!label || !commandRaw) continue;

    const args = asStringArray(task['args']).map((a) => substituteVars(a, projectPath));
    const command = [substituteVars(commandRaw, projectPath), ...args].map(quote).join(' ');
    const options = asRecord(task['options']);
    const cwdRaw = options ? asString(options['cwd']) : undefined;
    const env = options ? asStringRecord(options['env']) : undefined;

    out.push(
      finish({
        name: label,
        command,
        source: 'tasks.json',
        reason: `.vscode/tasks.json › ${label}`,
        ...(cwdRaw ? { cwd: substituteVars(cwdRaw, projectPath) } : {}),
        ...(env ? { env } : {}),
      }),
    );
  }
  return out;
}

/** 3 — `package.json` scripts. 락파일로 고른 매니저로 부른다. */
function scanPackageScripts(projectPath: string, scanned: string[]): RunConfig[] {
  const file = path.join(projectPath, 'package.json');
  const raw = readTextFile(file);
  if (raw === null) return [];

  const pkg = asRecord(parseJsonc(raw));
  const scripts = asRecord(pkg?.['scripts']);
  if (!scripts) return [];
  scanned.push('package.json');

  const pm = detectPackageManager(projectPath);
  const out: RunConfig[] = [];
  for (const [name, value] of Object.entries(scripts)) {
    if (typeof value !== 'string') continue;
    out.push(
      finish({
        name,
        command: `${pm} run ${name}`,
        source: 'package.json',
        reason: `package.json › scripts.${name} (${value})`,
      }),
    );
  }
  return out;
}

/**
 * 4 — `.vibisual/run.json`. 위 셋으로 표현되지 않는 실행법을 사용자가 직접 적는 자리.
 * 형식은 `{ "configs": [{ "name", "command", "cwd"?, "env"?, "debugCommand"?, "port"? }] }`.
 */
function scanVibisualRunJson(projectPath: string, scanned: string[]): RunConfig[] {
  const file = path.join(projectPath, '.vibisual', 'run.json');
  const raw = readTextFile(file);
  if (raw === null) return [];
  scanned.push('.vibisual/run.json');

  const root = asRecord(parseJsonc(raw));
  const list = Array.isArray(root?.['configs']) ? (root['configs'] as unknown[]) : [];
  const out: RunConfig[] = [];
  for (const entry of list) {
    const cfg = asRecord(entry);
    if (!cfg) continue;
    const name = asString(cfg['name']);
    const command = asString(cfg['command']);
    if (!name || !command) continue;
    const cwdRaw = asString(cfg['cwd']);
    out.push(
      finish({
        name,
        command: substituteVars(command, projectPath),
        source: 'vibisual',
        reason: `.vibisual/run.json › ${name}`,
        ...(cwdRaw ? { cwd: substituteVars(cwdRaw, projectPath) } : {}),
        ...(asStringRecord(cfg['env']) ? { env: asStringRecord(cfg['env']) as Record<string, string> } : {}),
        ...(asString(cfg['debugCommand']) ? { debugCommand: asString(cfg['debugCommand']) as string } : {}),
        ...(typeof cfg['port'] === 'number' ? { port: cfg['port'] as number } : {}),
      }),
    );
  }
  return out;
}

/**
 * 5 — 언리얼(`*.uproject`). 파일이 아니라 **프로젝트 종류**에서 나오는 유일한 출처다.
 *
 * 언리얼에는 `package.json` 도 `launch.json` 도 없다(있어도 UBT 가 생성해 준 경우뿐이다).
 * 그런데 "이 프로젝트를 어떻게 여는가" 의 답은 `.uproject` 안에 이미 완전하게 적혀 있다 —
 * 그러니 추측이 아니라 **읽어서** 만든다.
 *
 * 엔진은 반드시 `EngineAssociation` 이 가리키는 그 버전이어야 한다(최신 설치본을 고르면
 * 에셋이 상향 변환돼 되돌릴 수 없다). 엔진을 못 찾으면 실행 대신 **못 찾았다는 사실**을
 * 목록에 남긴다 — 빈 목록은 사용자에게 아무것도 말해 주지 않는다.
 *
 * 패키징(쿡·BuildCookRun)은 여기 넣지 않는다. 이 자리는 "디버그로 에디터를 여는 곳" 이다.
 */
function scanUnreal(projectPath: string, scanned: string[]): RunConfig[] {
  const info = inspectUnrealProject(projectPath);
  if (!info) return [];
  scanned.push(path.basename(info.uprojectPath));

  const out: RunConfig[] = [];
  const uproject = quote(info.uprojectPath);

  if (!info.editorExe) {
    // 언리얼 프로젝트인 것은 확실한데 엔진이 없다 — 실행할 수 없으므로 누를 수 없게 두되,
    // 근거 줄에 무엇이 없는지 그대로 적는다(사용자가 그 버전을 설치하면 바로 뜬다).
    out.push(
      finish({
        name: `${info.projectName} (Unreal ${info.engineLabel})`,
        command: `${uproject}`,
        source: 'unreal',
        reason: `${path.basename(info.uprojectPath)} › engine not found (EngineAssociation="${info.engineAssociation}", lookup=${info.engineSource})`,
        attachOnly: true,
        kind: 'attach',
      }),
    );
    return out;
  }

  // ① 에디터 열기 — 디버그 모드를 켜면 `DEBUG_LAUNCH_RECIPES.unreal` 이 여기에 인자를 얹는다.
  out.push(
    finish({
      name: `${info.projectName} — Unreal Editor (${info.engineLabel})`,
      command: `${quote(info.editorExe)} ${uproject}`,
      source: 'unreal',
      reason: `${path.basename(info.uprojectPath)} › ${info.editorExe} (${info.engineSource})`,
      cwd: path.dirname(info.uprojectPath),
      kind: 'run',
    }),
  );

  // ② 에디터 타깃 빌드 — 중단점이 걸리려면 먼저 이 타깃이 최신이어야 한다.
  if (info.buildScript) {
    const platform = process.platform === 'win32' ? 'Win64' : process.platform === 'darwin' ? 'Mac' : 'Linux';
    out.push(
      finish({
        name: `${info.projectName}Editor — Build (${platform} Development)`,
        command: [
          quote(info.buildScript),
          `${info.projectName}Editor`,
          platform,
          'Development',
          `-Project=${uproject}`,
          '-WaitMutex',
          '-FromMsBuild',
        ].join(' '),
        source: 'unreal',
        reason: `${path.basename(info.uprojectPath)} › ${info.buildScript}`,
        cwd: path.dirname(info.uprojectPath),
        kind: 'build',
      }),
    );
  }

  return out;
}

/** + — §5.14 탐지기. 명령형 후보만 가져온다(정적 서빙은 플레이 버블의 몫). */
function scanDetected(projectPath: string): RunConfig[] {
  const out: RunConfig[] = [];
  for (const cand of detectPlayRecipes(projectPath)) {
    if (cand.kind !== 'command' || !cand.command) continue;
    const name = cand.label ?? cand.command;
    out.push(
      finish({
        name,
        command: cand.command,
        source: 'detected',
        reason: cand.reason,
        ...(cand.cwd ? { cwd: cand.cwd } : {}),
        ...(cand.port ? { port: cand.port } : {}),
      }),
    );
  }
  return out;
}

/**
 * 이 프로젝트의 실행 구성 전부. 명령 문자열이 같은 항목은 **먼저 온 출처를 남긴다** —
 * 사용자가 직접 쓴 파일(launch.json·tasks.json·run.json)이 우리 추측(detected)을 이긴다.
 */
export function scanRunConfigs(projectPath: string): { configs: RunConfig[]; scanned: string[] } {
  if (!projectPath) return { configs: [], scanned: [] };
  try {
    if (!fs.existsSync(projectPath)) return { configs: [], scanned: [] };
  } catch {
    return { configs: [], scanned: [] };
  }

  const scanned: string[] = [];
  const ordered = [
    ...scanLaunchJson(projectPath, scanned),
    ...scanTasksJson(projectPath, scanned),
    ...scanVibisualRunJson(projectPath, scanned),
    // 언리얼은 사용자가 직접 쓴 파일 다음, 우리 추측(detected)보다는 앞 — `.uproject` 를 읽어서
    // 만든 것이라 추측이 아니지만, 사용자가 자기 launch.json 을 썼다면 그쪽이 먼저다.
    ...scanUnreal(projectPath, scanned),
    ...scanPackageScripts(projectPath, scanned),
    ...scanDetected(projectPath),
  ];

  const seenCommand = new Set<string>();
  const seenId = new Set<string>();
  const configs: RunConfig[] = [];
  for (const cfg of ordered) {
    const key = cfg.command.trim().toLowerCase();
    if (seenCommand.has(key)) continue;
    seenCommand.add(key);
    // id 충돌(같은 출처에 같은 이름)은 뒤에 번호를 붙여 갈라 준다.
    let id = cfg.id;
    let n = 2;
    while (seenId.has(id)) {
      id = `${cfg.id}-${n}`;
      n += 1;
    }
    seenId.add(id);
    configs.push({ ...cfg, id });
    if (configs.length >= RUN_CONFIG_MAX) break;
  }

  return { configs, scanned };
}
