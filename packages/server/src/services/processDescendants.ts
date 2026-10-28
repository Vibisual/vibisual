/**
 * §5.5 #17-9 ⑭(e) — 그 작업의 프로세스를 찾아 끊는다(장부만 지우면 셸이 계속 산다 — 실측 2026-09-01 `tail`/`grep` 6개).
 * `killTree` 로는 부족하다 — msys2 fork 흉내로 손자의 PPID 가 없는 번호라 `taskkill /T` 가 못 찾는다. 그래서 목록을 통째로 떠 자손을 직접 모은다.
 * 대상은 둘뿐: ① 세션 claude 자식의 자손 중 명령줄에 작업 명령이 통째로 든 것 ② 고아 중 명령줄이 작업 명령의 일부인 것(`ORPHAN_MIN_MATCH` 하한으로 우연 매칭을 막는다).
 * 판정은 순수 함수 — `process.platform` 을 안에서 읽지 않는다.
 */
import { spawn } from 'node:child_process';
import { killTree } from './processTree.js';
import { logger } from '../logger.js';

/** 프로세스 목록 한 줄. */
export interface ProcessRow {
  pid: number;
  ppid: number;
  /** 전체 명령줄(개행은 공백으로 접힌 상태). 못 읽으면 빈 문자열. */
  command: string;
}

/** 목록을 뜨는 데 허용하는 시간. 넘으면 "모른다"(= 아무것도 안 죽인다). */
export const PROCESS_LIST_TIMEOUT_MS = 8_000;

/** 고아 매칭에 요구하는 최소 정규화 길이 — 짧은 조각의 우연한 일치를 막는다. */
export const ORPHAN_MIN_MATCH = 25;

/** 공백·따옴표·역슬래시를 지운다 — 하니스가 명령을 `eval '…'` 로 감싸며 `"` → `\"`·줄바꿈 접기를 해서 글자 그대로는 어긋난다. */
export function normalizeForMatch(s: string): string {
  return s.replace(/[\s"'`\\]+/g, '').toLowerCase();
}

/**
 * Windows PowerShell 한 줄 출력(`pid\tppid\tcmd`) 파서.
 * 명령줄 안의 탭은 PowerShell 쪽에서 이미 공백으로 접혀 온다.
 */
export function parseWindowsProcessLines(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const first = line.indexOf('\t');
    const second = line.indexOf('\t', first + 1);
    if (first < 0 || second < 0) continue;
    const pid = Number.parseInt(line.slice(0, first), 10);
    const ppid = Number.parseInt(line.slice(first + 1, second), 10);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    rows.push({ pid, ppid, command: line.slice(second + 1).trim() });
  }
  return rows;
}

/** 실행본 경로를 떼고 인자만 남긴다 — OS 명령줄엔 `"C:\…\tail.exe"` 같은 절대경로가 붙어 원문(`tail -f …`)과 통째로는 안 겹친다. 고아 매칭(②)의 전제다(실측 확인). */
export function stripProgramPath(command: string): string {
  const s = command.trim();
  if (s.startsWith('"')) {
    const close = s.indexOf('"', 1);
    return close < 0 ? '' : s.slice(close + 1).trim();
  }
  const sp = s.search(/\s/);
  return sp < 0 ? '' : s.slice(sp + 1).trim();
}

/** POSIX `ps -eo pid=,ppid=,args=` 파서 — 앞 두 칸은 숫자, 나머지가 통째로 명령줄. */
export function parsePosixPsLines(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m?.[1] || !m[2]) continue;
    rows.push({ pid: Number.parseInt(m[1], 10), ppid: Number.parseInt(m[2], 10), command: (m[3] ?? '').trim() });
  }
  return rows;
}

/** 그 OS 에서 프로세스 목록을 뜨는 명령. `platform` 은 **인자로 받는다**. */
export function processListCommand(platform: NodeJS.Platform): { file: string; args: string[] } {
  if (platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command',
        "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CommandLine -replace '[\\r\\n\\t]+',' ')\" }"],
    };
  }
  return { file: 'ps', args: ['-eo', 'pid=,ppid=,args='] };
}

/** 목록을 실제로 뜬다. 실패하면 `null` — **모른다는 뜻이고, 그때는 아무것도 죽이지 않는다.** */
export function listProcesses(
  platform: NodeJS.Platform = process.platform,
  timeoutMs: number = PROCESS_LIST_TIMEOUT_MS,
): Promise<ProcessRow[] | null> {
  const { file, args } = processListCommand(platform);
  return new Promise((resolve) => {
    let out = '';
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 이미 없음 */ }
      resolve(null);
    }, timeoutMs);
    child.stdout?.on('data', (c) => { out += String(c); });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', () => {
      clearTimeout(timer);
      const rows = platform === 'win32' ? parseWindowsProcessLines(out) : parsePosixPsLines(out);
      resolve(rows.length > 0 ? rows : null);
    });
  });
}

/** `rootPid` 아래 **모든** 자손(자기 자신 제외). 목록 스냅샷으로 직접 걷는다. */
export function descendantsOf(rows: readonly ProcessRow[], rootPid: number): ProcessRow[] {
  const byParent = new Map<number, ProcessRow[]>();
  for (const r of rows) {
    const list = byParent.get(r.ppid);
    if (list) list.push(r);
    else byParent.set(r.ppid, [r]);
  }
  const out: ProcessRow[] = [];
  const seen = new Set<number>([rootPid]);
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    for (const child of byParent.get(pid) ?? []) {
      if (seen.has(child.pid)) continue; // PPID 재사용으로 생기는 고리 방어
      seen.add(child.pid);
      out.push(child);
      queue.push(child.pid);
    }
  }
  return out;
}

/**
 * @param rows 전체 목록(부모가 목록에 없으면 고아다)
 * @param sessionPid 그 세션의 claude 자식 PID — 이 나무 밖은 ①에서 손대지 않는다.
 */
export function matchTaskProcesses(
  rows: readonly ProcessRow[],
  sessionPid: number,
  command: string,
): ProcessRow[] {
  const needle = normalizeForMatch(command);
  if (needle.length < ORPHAN_MIN_MATCH) return [];
  const live = new Set(rows.map((r) => r.pid));
  const picked = new Map<number, ProcessRow>();

  // ① 세션 나무 안에서 명령을 통째로 담은 것 + 그 아래 자손 전부.
  const tree = descendantsOf(rows, sessionPid);
  for (const r of tree) {
    if (!normalizeForMatch(r.command).includes(needle)) continue;
    picked.set(r.pid, r);
    for (const d of descendantsOf(rows, r.pid)) picked.set(d.pid, d);
  }

  // ② 부모가 죽은 고아 중 **인자 부분**이 그 명령의 일부인 것.
  //    msys2 의 fork 흉내는 중간 셸이 먼저 사라져 손자의 PPID 가 없는 번호를 가리키므로,
  //    ①(사슬 타기)도 `taskkill /T` 도 이들에게 영영 닿지 못한다(실측 고아 7건).
  for (const r of rows) {
    if (picked.has(r.pid) || live.has(r.ppid)) continue;
    const hay = normalizeForMatch(stripProgramPath(r.command));
    if (hay.length < ORPHAN_MIN_MATCH || !needle.includes(hay)) continue;
    picked.set(r.pid, r);
    for (const d of descendantsOf(rows, r.pid)) picked.set(d.pid, d);
  }
  return [...picked.values()];
}

/**
 * 깊은 것부터 끊는다 — 부모를 먼저 죽이면 그 순간 자식이 고아가 되어 다음 회차에 못 찾는다.
 * @returns 실제로 kill 을 시도한 개수.
 */
export function killMatchedProcesses(rows: readonly ProcessRow[], victims: readonly ProcessRow[]): number {
  const depth = new Map<number, number>();
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const depthOf = (pid: number, guard = 0): number => {
    if (guard > 64) return guard;
    const cached = depth.get(pid);
    if (cached !== undefined) return cached;
    const parent = byPid.get(pid)?.ppid;
    const d = parent === undefined || !byPid.has(parent) ? 0 : depthOf(parent, guard + 1) + 1;
    depth.set(pid, d);
    return d;
  };
  const ordered = [...victims].sort((a, b) => depthOf(b.pid) - depthOf(a.pid));
  let killed = 0;
  for (const v of ordered) {
    try {
      killTree(v.pid);
      killed += 1;
    } catch {
      /* 이미 사라졌다 — 원하던 결과다 */
    }
  }
  return killed;
}

/**
 * 그 작업의 프로세스를 찾아 끊는다. 목록을 못 뜨면 **아무것도 하지 않고 `null`**(모른다 ≠ 없다).
 */
export async function terminateTaskProcesses(
  sessionPid: number | undefined,
  command: string,
  platform: NodeJS.Platform = process.platform,
): Promise<number | null> {
  if (!sessionPid || !command) return null;
  const rows = await listProcesses(platform);
  if (!rows) return null;
  const victims = matchTaskProcesses(rows, sessionPid, command);
  if (victims.length === 0) return 0;
  const killed = killMatchedProcesses(rows, victims);
  logger.info(`[bg-probe] 프로세스 ${killed}개 회수 (pid=${victims.map((v) => v.pid).join(',')})`);
  return killed;
}
