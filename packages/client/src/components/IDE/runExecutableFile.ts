/**
 * runExecutableFile.ts — §5.5 #17-27 ⑬ (h) 본문에 적힌 **실행 파일을 실제로 켜는 자리**.
 *
 * ⑬ 이 연 손잡이는 종전까지 둘이었다 — 파일이면 편집창(②), 폴더면 탐색기(⑩). 그런데 에이전트가
 * "빌드 결과는 여기 있습니다" 하며 적어 주는 위치는 종종 `.exe` 다. 그것을 편집창으로 보내면
 * 이진 파일 안내가 뜬 빈 창이 열릴 뿐이라, 사용자가 정작 하려던 일(그 프로그램을 켜 보는 것)은
 * 탐색기로 나가 손으로 찾아야 했다.
 *
 * **새 실행 레일은 만들지 않는다** — #17-20 ④ 의 실행 세션(`startRun` → PTY)을 그대로 탄다.
 * 그래야 [정지]·출력·종료 코드·실패를 에이전트에게 넘기기가 종전 실행과 **같은 자리**에서 돌아간다.
 * 여기서 하는 일은 "절대 경로 하나" 를 그 레일이 받는 모양(`RunConfig`)으로 옮기는 것뿐이고,
 * 명령 문자열을 만드는 계산은 셸을 띄우지 않고도 검증할 수 있게 **순수 함수로 갈라 두었다**
 * (`streamPathLinks`·`editorModel` 과 같은 규율 — 눈으로 확인하기 어려운 것은 단위 테스트가 잡는다).
 */
import { DEFAULT_AGENT_CONFIG } from '@vibisual/shared';
import type { AgentConfig, RunConfig } from '@vibisual/shared';

import { useGraphStore, selectIDEPane } from '../../stores/graphStore.js';
import { noteRunLine, runIdFor, startRun, useRunSessions } from '../../stores/runSessions.js';

/** `C:\…` · `D:/…` — 윈도우 절대 경로. 명령을 어떻게 감쌀지가 여기서 갈린다. */
const WIN_ABS = /^[A-Za-z]:[\\/]/;

/**
 * 본문에서 띄운 실행의 구성 id 접두사.
 *
 * 구성 스캔(#17-20 ②)이 만든 id 와 한 이름 공간을 쓰므로, 사이드바가 "이건 목록에 없는 실행"을
 * 가려낼 수 있도록 접두사로 표를 낸다(그 묶음이 [본문에서 실행] 이다).
 */
export const ADHOC_RUN_PREFIX = 'exec:';

/** 같은 파일을 다시 누르면 같은 id → ④ 의 규칙대로 **재시작**(먼저 죽이고 새로 띄운다). */
export function executableConfigId(absPath: string): string {
  return `${ADHOC_RUN_PREFIX}${absPath.replace(/\\/g, '/').toLowerCase()}`;
}

/** 경로의 마지막 조각(파일 이름) — 출력 패널·목록에 이 이름으로 선다. */
export function executableName(absPath: string): string {
  const parts = absPath.replace(/\\/g, '/').split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? absPath;
}

/**
 * 실행 작업 폴더 = **그 파일이 있는 폴더**.
 *
 * 프로젝트 루트가 아니라 파일 옆을 잡는 이유는 실행 파일이 자기 옆에 둔 자원을 상대 경로로 찾기
 * 때문이다(패키징된 게임의 `Saved/`·`Content/` 가 정확히 그런 배치다). 폴더를 못 가르면 null —
 * 호출부가 프로젝트 루트로 떨어진다.
 */
export function executableWorkDir(absPath: string): string | null {
  const norm = absPath.replace(/\\/g, '/');
  const cut = norm.lastIndexOf('/');
  if (cut < 0) return null;
  // `C:/game.exe` 처럼 드라이브 바로 아래면 `C:` 가 아니라 `C:/` 여야 그 드라이브의 루트를 가리킨다.
  const dir = cut === 0 ? '/' : norm.slice(0, cut).replace(/^([A-Za-z]:)$/, '$1/');
  if (!dir) return null;
  return WIN_ABS.test(absPath) ? dir.replace(/\//g, '\\') : dir;
}

/**
 * 절대 경로 하나 → PTY 에 실제로 실행될 **명령 한 줄**.
 *
 * 셸이 셋이므로 감싸는 법도 셋이다 — 윈도우(cmd)는 큰따옴표, macOS 앱 번들은 `open`(폴더를
 * 그대로 실행할 수 있는 유일한 창구), 그 밖 POSIX 는 작은따옴표. 경로에 공백이 든 경우가
 * 기본값이라(`C:\Program Files\…`) 따옴표는 선택이 아니다.
 */
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
 * 본문에서 누른 실행 파일을 띄운다.
 *
 * 스토어를 **구독하지 않고 누른 순간에 읽는다** — 이 함수를 부르는 곳은 본문의 인라인 코드 조각
 * 하나하나라, 화면에 수십 개가 떠 있어도 구독이 늘어서는 안 된다(§9 — 스트림이 길어질수록
 * 비용이 오르지 않아야 한다).
 *
 * @param failNote 시작하지 못했을 때 출력 패널에 남길 한 줄(번역은 부르는 화면이 한다).
 * @param paneKey 어느 창에서 눌렀는지(§5.5 #17-1). 안 주면 맨 앞 창 — 창이 여럿이면 실행이 옆 창의
 *        에이전트로 갈 수 있으므로 화면에서 부를 때는 반드시 자기 슬롯 키를 넘긴다.
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

  const projectName = overlay.projectId ?? state.activeProject;
  const projectRoot = projectName
    ? state.projects[projectName]?.path ?? state.stubProjects[projectName]?.project.path ?? null
    : null;

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
