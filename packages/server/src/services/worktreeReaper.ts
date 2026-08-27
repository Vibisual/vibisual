/**
 * worktreeReaper.ts — §7.10 (판올림 번호 발급 대기) —
 * **워크트리를 지우기 전에, 그 안에서 돌던 것을 강제로 끝낸다.**
 *
 * 사용자 지시: "강제 종료시키고 지우는 게 맞는 것 같은데 팝업으로 물어보잖아."
 * 삭제 팝업(`WorktreeDeleteDialog`)이 이미 동의를 받는 자리다 — 여기서 한 번 더 망설이면
 * 남는 것은 **반만 지워진 폴더**뿐이다. 그래서 이 단계는 묻지 않고 회수한다.
 *
 * 두 가지를 끝낸다. 둘 다 "안 하면 어떻게 되는가"가 실측으로 확인된 것들이다.
 *
 * ① **프로세스** — 워크트리 안에서 띄운 dev 서버·빌드·CLI 가 파일을 잡고 있으면 Windows 에서
 *    `git worktree remove` 와 폴더 삭제가 반만 성공한다. 사용자에게는 `node_modules` 만 남은
 *    좀비 폴더가 돌아오고, git 은 이미 그 워크트리를 모른다(v3.71 부분 삭제의 직접 원인).
 *
 * ② **에이전트** — 워크트리 프로젝트 등록이 사라지면 `getProjectForCwd` 가 **가장 긴 접두사**로
 *    떨어져 부모를 고른다. 그래서 워크트리를 지운 순간 그 안에서 일하던 커스텀 에이전트들이
 *    **부모 캔버스에 나타나고, 다음 명령부터 부모 트리에서 돈다**(실측). 격리하려고 만든 워크트리를
 *    정리했더니 그 에이전트가 본체를 고치기 시작하는 셈이라, 함께 휴지통으로 보낸다.
 *    지우지 않고 휴지통을 쓰는 이유는 대화·설정·개별 기억이 그 안에 있어서다 — 되돌릴 수 있어야 한다.
 *
 * 효과(프로세스 종료·휴지통 이동)는 전부 **주입**받는다. 그래야 프로세스를 띄우지 않고도
 * "누구를 고르는가"를 시험할 수 있다 — 고르는 규칙이 이 파일의 전부이고, 잘못 고르면
 * 남의 터미널을 죽이거나 엉뚱한 에이전트를 치운다.
 */
import { logger } from '../logger.js';

/** 고를 때 보는 최소한의 에이전트 모양 — 스냅샷의 버블에서 그대로 온다. */
export interface ReapableAgent {
  id: string;
  /** 이 에이전트가 속한 프로젝트 **표시명**(`GraphSnapshot.agentProjects`). */
  project: string | null | undefined;
  /** 우리가 만든 커스텀 버블인가. 훅 버블(외부 Claude Code 세션)은 우리 자식이 아니다. */
  customCreated?: boolean | undefined;
  /** 이미 휴지통에 있는가. */
  trashed?: boolean | undefined;
}

export interface WorktreeReapInput {
  /** 워크트리 루트 절대경로 — 터미널 소유 판정의 기준. */
  worktreePath: string;
  /** 워크트리 프로젝트의 표시명 — 에이전트 소유 판정의 기준. */
  worktreeProjectName: string;
  /** 지금 그래프에 있는 에이전트 전부(스냅샷). */
  agents: readonly ReapableAgent[];
  /** 그 에이전트의 살아 있는 세션을 전부 중지하고 중지한 id 목록을 돌려준다. */
  stopAllSessions: (agentId: string) => string[];
  /** 그 에이전트를 휴지통으로. 성공하면 true. */
  trashAgent: (agentId: string) => boolean;
  /** 그 폴더 안에서 도는 PTY 를 전부 죽이고 개수를 돌려준다. 주입이 없으면(웹·테스트) null. */
  killTerminalsUnder: ((rootPath: string) => number) | null;
}

export interface WorktreeReapResult {
  /** 대상이 된 에이전트 수. */
  agents: number;
  /** 강제 중지한 세션 수. */
  sessions: number;
  /** 강제 종료한 터미널 수. */
  terminals: number;
  /** 휴지통으로 옮긴 에이전트 수. */
  trashed: number;
}

/** 아무것도 안 한 결과 — 호출부가 분기 없이 쓸 수 있게 상수로 둔다. */
export const EMPTY_REAP: WorktreeReapResult = { agents: 0, sessions: 0, terminals: 0, trashed: 0 };

/**
 * 그 워크트리에 **우리가 만들어 넣은** 에이전트들.
 *
 * 훅 버블은 제외한다 — 사용자가 자기 VS Code 에서 직접 연 세션이라 우리 자식이 아니고,
 * 그것을 죽이는 것은 §5.5 #17-29 의 읽기 전용 경계를 넘는다(관측 대상에는 손대지 않는다).
 * 이미 휴지통에 있는 것도 제외한다(두 번 옮길 것이 없다).
 */
export function selectWorktreeAgents(
  agents: readonly ReapableAgent[],
  worktreeProjectName: string,
): string[] {
  if (!worktreeProjectName) return [];
  return agents
    .filter((a) => a.customCreated === true && a.trashed !== true && a.project === worktreeProjectName)
    .map((a) => a.id);
}

/**
 * 워크트리 삭제 직전 회수. 순서가 뜻을 갖는다:
 *   ① 터미널(파일을 잡고 있는 주범) → ② 에이전트 세션 → ③ 휴지통 이동.
 * 세션을 먼저 끊으면 그 에이전트가 마지막 순간에 파일을 다시 만들 수 있고, 휴지통을 먼저
 * 옮기면 소유 판정에 쓸 `project` 가 사라진다.
 */
export function reapWorktree(input: WorktreeReapInput): WorktreeReapResult {
  const agentIds = selectWorktreeAgents(input.agents, input.worktreeProjectName);

  let terminals = 0;
  if (input.killTerminalsUnder && input.worktreePath) {
    try {
      terminals = input.killTerminalsUnder(input.worktreePath) || 0;
    } catch (err) {
      // 회수 실패로 삭제 자체를 막지 않는다 — 남은 잠금은 아래 부분 삭제 보고로 사용자에게 간다.
      logger.warn(`worktree reap: killTerminalsUnder failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let sessions = 0;
  for (const id of agentIds) {
    try {
      sessions += input.stopAllSessions(id).length;
    } catch (err) {
      logger.warn(`worktree reap: stopAll failed for ${id} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let trashed = 0;
  for (const id of agentIds) {
    try {
      if (input.trashAgent(id)) trashed += 1;
    } catch (err) {
      logger.warn(`worktree reap: trash failed for ${id} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (agentIds.length > 0 || terminals > 0) {
    logger.info(
      `Worktree reap: path="${input.worktreePath}" agents=${agentIds.length} sessions=${sessions} terminals=${terminals} trashed=${trashed}`,
    );
  }
  return { agents: agentIds.length, sessions, terminals, trashed };
}
