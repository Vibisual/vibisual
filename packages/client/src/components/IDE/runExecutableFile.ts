/**
 * §5.5 #17-27 ⑬ (h) — 본문에 적힌 실행 파일(`.exe` 같은 빌드 결과)을 켠다. 새 실행 레일 ❌ — #17-20 ④ 실행 세션(`startRun` → PTY)을 타서
 * [정지]·출력·종료 코드·실패 넘기기가 기존 실행과 같다. 명령 문자열 계산은 순수 함수로 갈라 시험한다.
 */
import { DEFAULT_AGENT_CONFIG } from '@vibisual/shared';
import type { AgentConfig, RunConfig } from '@vibisual/shared';

import { useGraphStore, selectIDEPane, selectPaneProjectPath } from '../../stores/graphStore.js';
import { noteRunLine, runIdFor, startRun, useRunSessions } from '../../stores/runSessions.js';
import { clientPathKey } from '../../utils/platform.js';

/** `C:\…` · `D:/…` — 윈도우 절대 경로. 명령을 어떻게 감쌀지가 여기서 갈린다. */
const WIN_ABS = /^[A-Za-z]:[\\/]/;

/** 본문에서 띄운 실행의 구성 id 접두사 — 구성 스캔(#17-20 ②) id 와 한 이름 공간이라 사이드바가 이것으로 [본문에서 실행] 묶음을 가린다. */
export const ADHOC_RUN_PREFIX = 'exec:';

/** 같은 파일을 다시 누르면 같은 id → ④ 의 규칙대로 **재시작**(먼저 죽이고 새로 띄운다). */
export function executableConfigId(absPath: string): string {
  // 실행 구성 id = 경로. 대소문자 접기는 플랫폼이 정한다 — Linux 에서 접으면 케이스만 다른
  //   두 실행 파일이 같은 구성으로 뭉개져 한쪽을 띄우면 다른 쪽이 죽는다.
  return `${ADHOC_RUN_PREFIX}${clientPathKey(absPath)}`;
}

/** 경로의 마지막 조각(파일 이름) — 출력 패널·목록에 이 이름으로 선다. */
export function executableName(absPath: string): string {
  const parts = absPath.replace(/\\/g, '/').split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? absPath;
}

/** 작업 폴더 = 파일이 있는 폴더(실행 파일은 옆 자원을 상대 경로로 찾는다 — 게임의 `Saved/`·`Content/`). 못 가르면 null → 프로젝트 루트. */
export function executableWorkDir(absPath: string): string | null {
  const norm = absPath.replace(/\\/g, '/');
  const cut = norm.lastIndexOf('/');
  if (cut < 0) return null;
  // `C:/game.exe` 처럼 드라이브 바로 아래면 `C:` 가 아니라 `C:/` 여야 그 드라이브의 루트를 가리킨다.
  const dir = cut === 0 ? '/' : norm.slice(0, cut).replace(/^([A-Za-z]:)$/, '$1/');
  if (!dir) return null;
  return WIN_ABS.test(absPath) ? dir.replace(/\//g, '\\') : dir;
}

/** 절대 경로 → PTY 명령 한 줄. cmd 는 큰따옴표, macOS 앱 번들은 `open`(폴더를 실행하는 유일한 창구), 그 밖 POSIX 는 작은따옴표 — 공백 든 경로가 흔해 따옴표는 필수. */
export function buildExecutableRunCommand(absPath: string): string {
  if (WIN_ABS.test(absPath)) return `"${absPath.replace(/\//g, '\\')}"`;
  // POSIX 작은따옴표 안의 작은따옴표는 닫고-이스케이프하고-다시 여는 방식으로만 넣을 수 있다.
  const quoted = `'${absPath.replace(/'/g, `'\\''`)}'`;
  return absPath.toLowerCase().endsWith('.app') ? `open ${quoted}` : quoted;
}

/** 실행 세션이 받는 구성 — 스캔해서 만든 것이 아니라 **본문의 경로 하나**로 세운 구성이다. */
export function buildExecutableRunConfig(absPath: string): RunConfig {
  const cwd = executableWorkDir(absPath);
  return {
    id: executableConfigId(absPath),
    name: executableName(absPath),
    command: buildExecutableRunCommand(absPath),
    ...(cwd ? { cwd } : {}),
    // 사용자가 쓴 설정에서 온 것이 아니므로 출처는 "우리가 알아본 것" — §5.14 와 같은 정직함.
    source: 'detected',
    kind: 'run',
    runtime: 'other',
    reason: absPath,
  };
}

export interface RunExecutableResult {
  ok: boolean;
  /** 실행 세션 id(에이전트를 못 찾아 시작조차 못 했으면 null). */
  runId: string | null;
  error?: string;
}

/**
 * 본문에서 누른 실행 파일을 띄운다. 스토어는 구독하지 않고 누른 순간 읽는다(인라인 코드마다 부르므로, §9).
 * @param failNote 시작 실패 때 출력 패널에 남길 한 줄(번역된 것).
 * @param paneKey 누른 창(§5.5 #17-1) — 안 주면 맨 앞 창이라 창이 여럿이면 옆 창 에이전트로 간다. 화면에서는 반드시 넘긴다.
 */
export async function runExecutableFile(
  absPath: string,
  opts: { failNote: string; paneKey?: string | null },
): Promise<RunExecutableResult> {
  const state = useGraphStore.getState();
  const overlay = selectIDEPane(state, opts.paneKey ?? null);
  const agentId = overlay.agentId;
  if (!agentId) return { ok: false, runId: null, error: 'no-agent' };

  // 설정이 아직 안 들어온 버블(훅 버블 등)이라고 실행을 접지 않는다 — PTY 가 쓰는 것은 셸 환경뿐이라
  // 기본 설정으로도 프로그램은 그대로 돈다(여기서 조용히 아무 일도 안 하면 "눌러도 반응 없음"이 된다).
  const config = (state.agentConfigs[agentId] as AgentConfig | undefined) ?? DEFAULT_AGENT_CONFIG;

  // §5.7 #26 — cwd 는 **그 버블의 소속 프로젝트**다. 창이 앉은 슬롯(`overlay.projectId`)은 워크트리로
  //   들어가도 부모 탭에 남으므로, 그 값을 쓰면 워크트리 버블에서 누른 실행이 부모 트리에서 돌았다.
  const projectRoot = selectPaneProjectPath(state, opts.paneKey ?? null);

  const runConfig = buildExecutableRunConfig(absPath);
  const runId = runIdFor(agentId, runConfig.id);

  // 누르는 즉시 그 실행의 출력 패널을 연다 — 무엇이 도는지와 어떻게 멈추는지가 한 자리에 있어야
  // 사용자가 "눌렀는데 아무 일도 안 일어났다" 로 읽지 않는다.
  useRunSessions.getState().openOutput(runId);

  const result = await startRun({
    agentId,
    cwd: projectRoot ?? executableWorkDir(absPath) ?? absPath,
    config,
    runConfig,
    command: runConfig.command,
    debugMode: false,
    debugApplied: false,
  });

  // PTY 가 없으면 바이트가 한 톨도 오지 않는다 — 적지 않으면 빈 화면에 종료 코드만 남는다.
  if (!result.ok) noteRunLine(runId, opts.failNote);

  return { ok: result.ok, runId, ...(result.error ? { error: result.error } : {}) };
}
