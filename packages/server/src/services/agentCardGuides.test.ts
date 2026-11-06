import { describe, expect, it } from 'vitest';
import {
  AGENT_CARD_KINDS, buildAgentCardCommonGuide, buildAgentCardCommonRules, buildAgentCardGuide, buildAgentCardPromptParts,
  buildAgentIntentFirstRules, buildAgentQuestionRules, buildAgentReportRules, buildAgentReviewRules, estimateTokens,
} from '@vibisual/shared';

const args = {
  serverBase: 'http://127.0.0.1:51360', serverToken: 'secret-not-for-prompts',
  agentId: 'agent-example', subAgentId: 'sub-example',
};
const guideDir = '/home/example/.vibisual/rules/cards-v1'; // privacy-ok

describe('on-demand card rules', () => {
  it('keeps live identity only in the compact prompt and omits executable protocols until needed', () => {
    const parts = buildAgentCardPromptParts({ ...args, guideDir });
    const text = Object.values(parts).join('');
    expect(parts.common).toContain(JSON.stringify({ agentId: args.agentId, subAgentId: args.subAgentId }));
    expect(parts.common).toContain(args.serverBase);
    expect(parts.common).toContain(guideDir);
    expect(parts.common).toContain('전송 전에 common.md와 해당 파일만 한 번에 Read');
    expect(parts.common).toContain('유실되면 다시 읽는다');
    expect(text).not.toContain(args.serverToken);
    expect(text).not.toMatch(/curl -|function Send|Invoke-RestMethod|helpfulMemoryIds/);
    for (const kind of AGENT_CARD_KINDS) expect(parts[kind]).toContain(`${kind}.md`);
    expect(buildAgentCardPromptParts({ ...args, subAgentId: undefined, guideDir }).common).toContain('"subAgentId":null');
  });

  it('retains all legacy inline instructions when guides are unavailable', () => {
    expect(buildAgentCardPromptParts(args)).toEqual({
      common: buildAgentCardCommonRules(args), report: buildAgentReportRules(args),
      question: buildAgentQuestionRules(args), review: buildAgentReviewRules(args),
    });
  });

  it.each(['posix', 'powershell'] as const)('%s loads one protocol while retaining receipt and scope boundaries', (shell) => {
    const endpoints = { report: 'agent-report', question: 'agent-questions', review: 'agent-review' };
    for (const kind of AGENT_CARD_KINDS) {
      const guide = buildAgentCardGuide(kind, shell);
      expect(guide).toContain(`/api/${endpoints[kind]}`);
      for (const other of AGENT_CARD_KINDS.filter((key) => key !== kind)) {
        expect(guide).not.toContain(`/api/${endpoints[other]}`);
      }
      expect(guide).not.toContain(args.agentId);
      expect(guide).not.toContain(args.serverToken);
      expect(guide).not.toMatch(/```|curl -|function Send/);
    }
    const common = buildAgentCardCommonGuide(shell);
    expect(common).toContain(shell === 'posix' ? '```bash' : '```powershell');
    expect(common).toContain('신원 JSON을 그대로 복사(null 포함)');
    expect(common).toContain('최종 보고 형식이지 작업 종료 조건이 아니다');
    expect(common).toContain('승인된 작업·검증을 먼저 마친다');
    expect(common).toContain('HTTP 2xx 응답의 ok:true와 카드 id');
    expect(common).toContain('도구 실행·마커 인쇄 성공만으로 단정하지 마라');
    expect(common).toContain('성공 확인 후에만 "카드를 확인해 주세요."');
    expect(common).toContain('실패·시간 초과·성공 여부 불명확');
    expect(common).toContain('일반 답변으로 전달');
    expect(common).toContain('기억 관련 필드는 신고 기록에만 보존');
  });

  it('keeps complete field and approval rules in the selected guide', () => {
    const report = buildAgentCardGuide('report', 'posix');
    expect(report).toContain(buildAgentReportRules(args));
    expect(report).toContain('ID는 실제 제공받은 경우만 적고 없으면 생략');
    const questions = buildAgentCardGuide('question', 'posix');
    expect(questions).toContain(buildAgentQuestionRules(args));
    expect(questions).toContain('질문마다 2~4개 — 비우지 마라');
    expect(questions).toContain('필요한 승인·입력에 의존하는 작업은 답을 받을 때까지 실행하지 마라');
    expect(buildAgentCardGuide('review', 'posix')).toContain(buildAgentReviewRules(args));
  });

  it.each(['posix', 'powershell'] as const)('%s reduces both default and first-use input, including the selected guide', (shell) => {
    const compact = Object.values(buildAgentCardPromptParts({ ...args, shell, guideDir: `${guideDir}/${shell}` })).join('');
    const inline = Object.values(buildAgentCardPromptParts({ ...args, shell })).join('');
    const intent = buildAgentIntentFirstRules(false);
    expect(estimateTokens(compact + intent)).toBeLessThan(1_000);
    expect(estimateTokens(compact)).toBeLessThan(estimateTokens(inline) * 0.3);
    for (const kind of AGENT_CARD_KINDS) {
      expect(estimateTokens(compact + buildAgentCardCommonGuide(shell) + buildAgentCardGuide(kind, shell))).toBeLessThan(estimateTokens(inline));
    }
    const allKinds = AGENT_CARD_KINDS.map((kind) => buildAgentCardGuide(kind, shell)).join('');
    expect((allKinds.match(/function Send|curl -/g) ?? []).length).toBe(0);
  });
});
