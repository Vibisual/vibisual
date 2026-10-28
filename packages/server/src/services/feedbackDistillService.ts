/**
 * §4 — 싫어요(+사유) 피드백을 one-shot `claude -p`(haiku)로 요약해 `AgentConfig.rules` 규칙 제안을 만든다. 스폰은 §5.7 sessionDiscovery 와 같다(shell:false, 트리 kill).
 * **제안만 반환** — 적용은 클라 확인 모달 승인 뒤 `PUT /api/agent-config/:agentId`(자동 append 금지 — 일회성 싫어요가 영구 규칙이 된다).
 */
import { spawn } from 'child_process';
import { AGENT_FEEDBACK_DISTILL_MAX, type AgentFeedback } from '@vibisual/shared';
import { claudeSpawnEnv, getClaudeBin, noteClaudeSpawnFailure } from './claudeBin.js';
import { killTree, processGroupSpawnOptions } from './processTree.js';
import { logger } from '../logger.js';

const CLAUDE_BIN = (): string => getClaudeBin().binPath;

/** one-shot 증류 상한 — haiku 가 이 시간 안에 못 끝내면 실패 처리(무한 대기 방지). */
const DISTILL_TIMEOUT_MS = 60_000;

/** 증류 대상이 되는 싫어요 피드백만 추려 프롬프트 재료 문자열로 변환. */
export function collectDownFeedbackLines(feedbacks: AgentFeedback[]): string[] {
  return [...feedbacks]
    .filter((f) => f.verdict === 'down')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, AGENT_FEEDBACK_DISTILL_MAX)
    .map((f) => {
      const what = f.summary.slice(0, 3).join(' / ');
      return f.reason ? `- 작업: ${what}\n  사유: ${f.reason}` : `- 작업: ${what}`;
    });
}

function buildDistillPrompt(downLines: string[]): string {
  return [
    '너는 AI 에이전트 운영 규칙 편집자다. 아래는 사용자가 한 AI 에이전트의 과거 작업 결과에',
    '"싫어요"를 준 목록(작업 내용 + 사유)이다. 이를 근거로, 그 에이전트가 앞으로 같은 실수를',
    '반복하지 않도록 시스템 규칙(Agent Rules)에 추가할 규칙 문장을 만들어라.',
    '',
    '요구사항:',
    '- 규칙 2~6줄, 각 줄은 "- " 로 시작하는 한 문장 명령형.',
    '- 개별 사건 재서술이 아니라 일반화된 행동 규칙으로. 중복·유사 사유는 한 줄로 합쳐라.',
    '- 사유가 없는 항목은 작업 내용에서 추정하되 과잉 일반화하지 마라.',
    '- 규칙 줄 외의 서론·결론·설명은 출력하지 마라.',
    '',
    '싫어요 목록:',
    ...downLines,
  ].join('\n');
}

/** 규칙 텍스트(줄바꿈 구분)를 낸다. CLI 부재·타임아웃·빈 출력은 모두 null — 호출부(REST)가 502 로 답한다. */
export function distillFeedbackToRules(feedbacks: AgentFeedback[]): Promise<string | null> {
  const downLines = collectDownFeedbackLines(feedbacks);
  if (downLines.length === 0) return Promise.resolve(null);
  const prompt = buildDistillPrompt(downLines);
  const t0 = Date.now();
  logger.info(`[feedback-distill] SPAWN downs=${downLines.length}`);
  return new Promise((resolve) => {
    let settled = false;
    let out = '';
    // 보안: shell:false — 프롬프트는 argv 로 전달되어 셸 재파싱 없음(sessionDiscovery 선례).
    const child = spawn(
      CLAUDE_BIN(),
      ['-p', prompt, '--model', 'haiku', '--output-format', 'text'],
      {
        shell: false,
        windowsHide: true,
        // POSIX 한정 detached — 아래 finish() 가 killTree 로 회수한다. 그룹 리더가 아니면 `-pid` 가
        //   ESRCH 로 실패해 haiku 세션이 띄운 손자(MCP 서버·worker)가 mac/linux 에서 남는다.
        ...processGroupSpawnOptions(),
        // §4 (앱 전용 엔진) ⑤ — 앱 전용 실행본이면 엔진 자체 갱신을 끈다.
        env: claudeSpawnEnv(),
      },
    );
    const finish = (result: string | null, reason: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 이전엔 win32=taskkill / else=child.kill() 을 여기서 **재구현**했다. POSIX 쪽은 트리 킬을
      //   시도조차 안 해 손자가 남았다 — 플랫폼 분기는 processTree.killTree 한 곳으로 통합한다.
      if (child.exitCode === null && child.signalCode === null) killTree(child.pid);
      logger.info(`[feedback-distill] RESULT ok=${result != null} dur=${Date.now() - t0}ms via=${reason}`);
      resolve(result);
    };
    const timer = setTimeout(() => finish(null, 'timeout'), DISTILL_TIMEOUT_MS);
    child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    child.on('error', (err) => {
      logger.warn('[feedback-distill] spawn error', err);
      noteClaudeSpawnFailure(err);
      finish(null, 'spawn-error');
    });
    child.on('close', (code) => {
      const text = out.trim();
      if (code === 0 && text.length > 0) finish(text, 'close');
      else finish(null, `close(code=${code},empty=${text.length === 0})`);
    });
  });
}
