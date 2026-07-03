/**
 * §4 v3.21 — 에이전트 피드백 증류 (싫어요 사유 → 규칙 문장 제안).
 *
 * 사용자가 남긴 싫어요(+사유) 피드백 더미를 one-shot claude CLI(`-p`, haiku)로 요약해
 * `AgentConfig.rules` 에 append 할 규칙 문장 제안을 만든다. **제안만 반환** — 적용은
 * 클라이언트 확인 모달에서 사용자가 승인한 뒤 기존 `PUT /api/agent-config/:agentId` 경로로
 * 이뤄진다(rulesHistory 롤백 가능, 자동 append 금지 — 일회성 싫어요의 영구 규칙화 방지).
 *
 * 스폰 인프라: §5.7 sessionDiscovery 의 one-shot `-p` 선례 재사용(shell:false, 트리 kill).
 */
import { spawn } from 'child_process';
import { AGENT_FEEDBACK_DISTILL_MAX, type AgentFeedback } from '@vibisual/shared';
import { resolveClaudeBin } from './claudeBin.js';
import { logger } from '../logger.js';

const CLAUDE_BIN = resolveClaudeBin().binPath;

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

/**
 * 싫어요 피드백을 규칙 문장으로 증류한다. 성공 시 규칙 텍스트(줄바꿈 구분), 실패 시 null.
 * CLI 부재·타임아웃·빈 출력 모두 null — 호출부(REST)가 502 로 응답한다.
 */
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
      CLAUDE_BIN,
      ['-p', prompt, '--model', 'haiku', '--output-format', 'text'],
      { shell: false, windowsHide: true },
    );
    const finish = (result: string | null, reason: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (process.platform === 'win32') {
        if (child.pid != null && child.exitCode === null) {
          try {
            const tk = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
            tk.on('error', () => { /* ignore */ });
          } catch { /* ignore */ }
        }
      } else {
        try { child.kill(); } catch { /* ignore */ }
      }
      logger.info(`[feedback-distill] RESULT ok=${result != null} dur=${Date.now() - t0}ms via=${reason}`);
      resolve(result);
    };
    const timer = setTimeout(() => finish(null, 'timeout'), DISTILL_TIMEOUT_MS);
    child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    child.on('error', (err) => {
      logger.warn('[feedback-distill] spawn error', err);
      finish(null, 'spawn-error');
    });
    child.on('close', (code) => {
      const text = out.trim();
      if (code === 0 && text.length > 0) finish(text, 'close');
      else finish(null, `close(code=${code},empty=${text.length === 0})`);
    });
  });
}
