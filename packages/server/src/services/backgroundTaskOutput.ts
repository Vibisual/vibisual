/**
 * §5.5 #17-9 ⑬ — **끝났다고 적힌 것은 걷는다.**
 *
 * ⑩ 은 "유령은 시간이 아니라 프로세스 유무로 걷는다"를 세웠고, 그 판정 근거는 하나였다 — *그 세션에
 * 프로세스가 없으면 그 자식인 작업도 없다*. 그런데 세션은 `--input-format stream-json` 상주 프로세스라
 * **탭이 열려 있는 한 그 근거는 결코 성립하지 않는다.** 그래서 끝 통지(`task_notification`)를 못 받은
 * 작업은 영영 목록에 남았다(실측 2026-09-01 — 목적을 다한 `tail -f` 두 개가 10·16분째 "실행 중").
 *
 * 여기서 여는 것은 **세 번째 근거**다: 하니스가 작업 출력 파일 끝에 **종료를 직접 적는다.**
 *
 * ```text
 * PKG_DONE exit=0
 *                       ← 빈 줄
 * [exited with code 0]  ← 하니스가 쓴 마지막 줄
 * ```
 *
 * 이것은 추측이 아니라 **선언**이다. 그래서 SSOT 가 금지한 축(조용하다·오래됐다는 이유로 걷기)과
 * 부딪히지 않는다 — 조용함은 판정에 쓰지 않고, 표식이 있을 때만 내린다. 한쪽으로만 틀리는 것도
 * 중요하다: 표식이 **있으면** 확실히 끝난 것, **없으면** "모름"이라 종전 동작 그대로 둔다.
 * 도는 작업을 끝난 것으로 만드는 방향으로는 틀릴 수 없다.
 *
 * ⚠ **문서화된 규약이 아니다.** 판올림에서 경로·문구가 조용히 바뀔 수 있으므로 **못 읽으면 조용히
 * 종전 동작으로 떨어진다**(기능 손실 ❌ — 잃는 것은 이 힌트 하나뿐). 우리가 이미 트랜스크립트
 * JSONL 을 같은 방식으로 읽고 있고(`sessionDiscovery`·`subagentResultRescue`), 이 파일 역시
 * `backgroundShellWatcher` 가 포트 탐지용으로 이미 tail 하고 있던 그 파일이다 — 새 경계가 아니다.
 *
 * ⚠ **읽기 전용이다.** 이 모듈은 지우지도 쓰지도 않는다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { capMapSize, SESSION_KEYED_MAP_MAX } from '@vibisual/shared';

/** 표식은 언제나 마지막 줄이라 끝에서 이만큼만 읽으면 된다. */
const TAIL_BYTES = 512;
/** 폴더를 못 찾았을 때 다시 훑기까지의 최소 간격 — 5초 리컨사일이 매번 readdir 하지 않게. */
const DIR_MISS_RETRY_MS = 30_000;

/** 하니스가 출력 파일 끝에 남기는 종료 표식. */
export type TaskEndMarker =
  | { kind: 'exited'; exitCode: number }
  | { kind: 'killed' };

/**
 * 출력 꼬리에서 종료 표식을 읽는다. **마지막 줄일 때만** 인정한다.
 *
 * 왜 마지막 줄로 못 박는가 — 실측 조사에서 `[reinstall]`·`[release]` 처럼 **작업 자신의 출력**에
 * 대괄호 낱말이 흔했다(로그 접두사). 느슨하게 잡으면 도는 작업을 끝난 것으로 만든다.
 * 표식은 하니스가 파일을 닫으며 쓰는 마지막 한 줄이므로 그 자리만 본다.
 *
 * 순수 함수 — 파일을 읽지 않는다(테스트가 세 갈래를 전부 고정한다).
 */
export function parseTaskEndMarker(tail: string): TaskEndMarker | null {
  const text = tail.replace(/\r/g, '').replace(/\n+$/, '');
  const lastLine = text.slice(text.lastIndexOf('\n') + 1);
  if (lastLine === '[killed]') return { kind: 'killed' };
  const m = /^\[exited with code (-?\d+)\]$/.exec(lastLine);
  if (!m?.[1]) return null;
  const exitCode = Number.parseInt(m[1], 10);
  return Number.isFinite(exitCode) ? { kind: 'exited', exitCode } : null;
}

/** 한 작업 출력 파일의 지금 상태. */
export interface TaskOutputState {
  /** 종료 표식(있으면 그 작업은 끝난 것이다). 없으면 `null` = 모름 → 종전 동작 유지. */
  end: TaskEndMarker | null;
  /** 파일이 마지막으로 바뀐 시각(ms) = 그 작업이 **마지막으로 무언가를 낸** 시각. */
  lastOutputAtMs: number;
}

/** (경로 → 마지막 판독) 캐시. 파일이 그대로면 디스크를 다시 읽지 않는다. */
interface OutputProbe { size: number; mtimeMs: number; end: TaskEndMarker | null }
const probeCache = new Map<string, OutputProbe>();
/** (sessionId → tasks 폴더). 못 찾은 것은 `null` + 시각으로 재시도를 묶는다. */
const tasksDirCache = new Map<string, { dir: string | null; at: number }>();

/** 테스트·재기동용 — 캐시를 비운다. */
export function resetBackgroundTaskOutputCache(): void {
  probeCache.clear();
  tasksDirCache.clear();
}

/**
 * 그 세션의 작업 출력 폴더 — `<tmp>/claude/<프로젝트 슬러그>/<sessionId>/tasks`.
 *
 * **슬러그 규칙을 재현하지 않는다.** 경로를 우리가 조립하면 대문자·구분자 규칙이 판올림마다
 * 어긋나고 OS 마다 또 갈린다. 세션 id 는 UUID 라 전역 유일하므로 `<tmp>/claude` 를 한 겹 훑어
 * 그 UUID 폴더를 찾는다 — 찾으면 영구 캐시, 못 찾으면 {@link DIR_MISS_RETRY_MS} 뒤에 재시도.
 * `os.tmpdir()` 이 win/mac/linux 를 알아서 가른다(win `%LOCALAPPDATA%\Temp` · mac `/var/folders/…`
 * · linux `/tmp`).
 *
 * @param tmpRoot 테스트 주입점. 기본값은 실제 임시 폴더.
 */
export function resolveSessionTasksDir(
  sessionId: string,
  tmpRoot: string = path.join(os.tmpdir(), 'claude'),
  now: number = Date.now(),
): string | null {
  if (!sessionId) return null;
  const hit = tasksDirCache.get(sessionId);
  if (hit && (hit.dir !== null || now - hit.at < DIR_MISS_RETRY_MS)) return hit.dir;

  let found: string | null = null;
  let slugs: string[];
  try { slugs = fs.readdirSync(tmpRoot); } catch { slugs = []; }
  for (const slug of slugs) {
    const dir = path.join(tmpRoot, slug, sessionId, 'tasks');
    try { if (fs.statSync(dir).isDirectory()) { found = dir; break; } } catch { /* 다음 후보 */ }
  }
  tasksDirCache.set(sessionId, { dir: found, at: now });
  capMapSize(tasksDirCache, SESSION_KEYED_MAP_MAX);
  return found;
}

/**
 * 작업 하나의 출력 상태. 파일이 없으면 `null`(= 모름, 종전 동작 유지).
 *
 * 비용은 평소 `statSync` 한 번이다 — 크기·mtime 이 그대로면 꼬리를 다시 읽지 않는다.
 * 멈춘 `tail -f` 의 파일은 영영 안 바뀌므로, 그런 항목이 5초마다 물어봐도 디스크 읽기는 0 이다.
 */
export function readTaskOutputState(tasksDir: string, taskId: string): TaskOutputState | null {
  const file = path.join(tasksDir, `${taskId}.output`);
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return null; }
  if (!st.isFile()) return null;

  const cached = probeCache.get(file);
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
    return { end: cached.end, lastOutputAtMs: st.mtimeMs };
  }

  let end: TaskEndMarker | null = null;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const len = Math.min(TAIL_BYTES, st.size);
      const buf = Buffer.allocUnsafe(len);
      fs.readSync(fd, buf, 0, len, Math.max(0, st.size - len));
      end = parseTaskEndMarker(buf.toString('utf8'));
    } finally { fs.closeSync(fd); }
  } catch { return null; }

  probeCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, end });
  capMapSize(probeCache, SESSION_KEYED_MAP_MAX);
  return { end, lastOutputAtMs: st.mtimeMs };
}
