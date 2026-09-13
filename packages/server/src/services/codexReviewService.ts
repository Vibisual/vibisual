import { randomUUID } from 'node:crypto';
import { resolveCodexPermission } from '@vibisual/shared';
import type { CodexReviewMode, CodexReviewRun } from '@vibisual/shared';
import { runCodexCli } from './codexCli.js';
import { logger } from '../logger.js';

/**
 * §5.25 (N) — `codex review`. 검증(Verify) 칸의 **코덱스 대응물**.
 *
 * 클로드의 `/verify`(§5.5 #17-35)와 **하는 일이 다르다.** 그쪽은 "앱을 띄워 실제로 돌려 보고
 * 됐는지 판정한다"이고, `codex review` 는 "**git 변경분을 읽고 문제를 짚는다**"이다. 그래서 같은
 * 자리에 서되 같은 화면을 쓰지 않는다 — 판정(pass/fail/held)·시연·재시도 같은 칸을 빌려 오면
 * 그 칸들이 거짓말을 한다(이 리뷰는 앱을 띄운 적이 없다).
 *
 * **사용자가 누를 때만 돈다.** 모델을 부르는 일이라 자동 실행하지 않는다(§5.5 #17-35 가 검증
 * 자동 실행을 일부러 뺀 것과 같은 판단 — 비용이 사용자 것이다).
 */

/** 한 번에 담아 둘 리뷰 이력 수. 넘으면 오래된 것부터 버린다(용량 폭증 감사 규약). */
const CODEX_REVIEW_HISTORY_MAX = 20;
/** 리뷰 한 번에 주는 시간. 변경분을 읽고 답까지 쓰는 일이라 목록 조회보다 훨씬 길다. */
const CODEX_REVIEW_TIMEOUT_MS = 10 * 60 * 1000;
/** 보관하는 출력 길이 상한 — 스냅샷은 WS 로 흐르므로 무한정 실을 수 없다. */
const CODEX_REVIEW_OUTPUT_MAX = 200_000;

/**
 * `codex review` 인자 조립.
 *
 * **`--dangerously-*` 는 쓰지 않는다**(§5.25 안전선). 샌드박스·승인 정책은 스폰 경로와 **같은
 * 표**(`resolveCodexPermission`)에서 나온다 — 두 벌이 되면 한쪽만 고쳐지는 날이 온다.
 *
 * `--commit` 과 `--base` 는 값이 필요하고 `--uncommitted` 는 아니다. 값이 있어야 하는데 없으면
 * **미커밋 변경으로 떨어뜨린다** — 빈 문자열을 브랜치 이름이라고 넘기면 코덱스가 엉뚱한 것을 본다.
 */
export function buildCodexReviewArgs(args: {
  cwd: string;
  mode: CodexReviewMode;
  target?: string;
  permissionMode?: string;
}): string[] {
  const { sandbox, approval } = resolveCodexPermission(args.permissionMode);
  const out: string[] = ['review'];
  const target = args.target?.trim() ?? '';
  if (args.mode === 'base' && target) out.push('--base', target);
  else if (args.mode === 'commit' && target) out.push('--commit', target);
  else out.push('--uncommitted');
  out.push('-C', args.cwd);
  out.push('-s', sandbox);
  // `review` 에도 `--ask-for-approval` 은 없다(루트 명령 전용) — `exec` 와 같이 오버라이드로 싣는다.
  //   사용자의 `config.toml` 은 건드리지 않는다.
  out.push('-c', `approval_policy=${approval}`);
  return out;
}

/** 실제 대상이 무엇이 됐는지(인자 조립이 떨어뜨린 뒤의 값). 화면이 "무엇을 봤는지"를 정직하게 적게 한다. */
export function effectiveReviewTarget(mode: CodexReviewMode, target: string | undefined): {
  mode: CodexReviewMode; target?: string;
} {
  const t = target?.trim() ?? '';
  if ((mode === 'base' || mode === 'commit') && t) return { mode, target: t };
  return { mode: 'uncommitted' };
}

class CodexReviewService {
  /** 최근 것이 앞. 에이전트별로 나누지 않는다 — 화면이 `agentId` 로 걸러 본다. */
  private runs: CodexReviewRun[] = [];

  list(): CodexReviewRun[] {
    return this.runs;
  }

  /**
   * 리뷰 한 번 시작. **기다리지 않는다** — 몇 분이 걸릴 수 있어 REST 응답은 즉시 돌려주고,
   * 끝나면 스냅샷으로 알린다(호출자가 `onChange` 로 방송한다).
   */
  start(args: {
    agentId: string;
    cwd: string;
    mode: CodexReviewMode;
    target?: string;
    permissionMode?: string;
    onChange: () => void;
  }): CodexReviewRun {
    const eff = effectiveReviewTarget(args.mode, args.target);
    const run: CodexReviewRun = {
      id: randomUUID(),
      agentId: args.agentId,
      mode: eff.mode,
      ...(eff.target ? { target: eff.target } : {}),
      status: 'running',
      startedAt: Date.now(),
    };
    this.runs = [run, ...this.runs].slice(0, CODEX_REVIEW_HISTORY_MAX);

    const cliArgs = buildCodexReviewArgs({
      cwd: args.cwd,
      mode: eff.mode,
      ...(eff.target ? { target: eff.target } : {}),
      ...(args.permissionMode ? { permissionMode: args.permissionMode } : {}),
    });
    logger.info(`[codexReview] start ${run.id} ${cliArgs.join(' ')}`);

    void runCodexCli(cliArgs, CODEX_REVIEW_TIMEOUT_MS, { cwd: args.cwd })
      .then((res) => {
        this.finish(run.id, res.failure
          ? { status: 'failed', error: res.failure }
          : res.code === 0
            ? { status: 'done', output: res.out.slice(0, CODEX_REVIEW_OUTPUT_MAX) }
            // 0 이 아니어도 출력은 남긴다 — 왜 실패했는지가 대개 거기 적혀 있다.
            : { status: 'failed', error: `exit ${String(res.code)}`, output: res.out.slice(0, CODEX_REVIEW_OUTPUT_MAX) });
        args.onChange();
      })
      .catch((err: unknown) => {
        this.finish(run.id, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
        args.onChange();
      });

    return run;
  }

  private finish(id: string, patch: Partial<CodexReviewRun>): void {
    this.runs = this.runs.map((r) => (r.id === id ? { ...r, ...patch, finishedAt: Date.now() } : r));
  }
}

export const codexReviewService = new CodexReviewService();
