import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCmdCardGuide, buildCmdCardCommonGuide, buildCmdCardProtocolRules, CMD_CARD_GUIDE_KINDS, estimateTokens } from '@vibisual/shared';
import { ensureCmdCardRulesDocs, resetCmdCardRulesDocsCache } from './cmdCardRulesDoc.js';

const homes: string[] = [];
const tempRoot = fs.realpathSync(os.tmpdir());
function home(): string {
  const dir = fs.mkdtempSync(path.join(tempRoot, 'vibisual-cmd-guides-'));
  homes.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  resetCmdCardRulesDocsCache();
  for (const dir of homes.splice(0)) {
    const target = fs.realpathSync(dir);
    const relative = path.relative(tempRoot, target);
    if (!relative.startsWith('vibisual-cmd-guides-') || relative.includes(path.sep) || path.isAbsolute(relative)) {
      throw new Error('Refusing to remove a directory outside the generated test homes');
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe('CMD card guides', () => {
  it('keeps all triggers while loading only the selected protocol', () => {
    const rules = buildCmdCardProtocolRules('/home/demo/.vibisual/rules/cards-v1/cmd'); // privacy-ok
    for (const kind of CMD_CARD_GUIDE_KINDS) expect(rules).toContain(`\`${kind}\``);
    expect(rules).toContain('/home/demo/.vibisual/rules/cards-v1/cmd'); // privacy-ok
    expect(rules).toContain('common.md와 <종류>.md');
    expect(rules).toContain('전송 전에');
    expect(rules).toContain('한 번의 Read로 함께 읽고');
    expect(rules).toContain('이미 읽은 규칙이 문맥에 남아 있으면 재사용');
    expect(rules).toContain('유실되면 다시 읽는다');
    expect(rules).toContain('한 턴에 카드는 하나');
    expect(rules).toContain('::VIBISUAL-CARD::');
    expect(rules).not.toContain('curl -');
    expect(estimateTokens(rules)).toBeLessThan(600);
  });

  it.each(CMD_CARD_GUIDE_KINDS)('%s preserves its transport and reduces total tokens after one read', (kind) => {
    const guide = buildCmdCardGuide(kind);
    const common = buildCmdCardCommonGuide();
    expect(guide).toContain(`/api/agent-${kind}`);
    expect(guide).toContain(`"kind":"${kind}"`);
    expect(common).toContain('VIBISUAL_HOOK_TOKEN');
    expect(common).toContain('$VIBISUAL_AGENT_ID');
    expect(common).toContain('$VIBISUAL_SUB_AGENT_ID');
    expect(common).toContain('HTTP와 마커를 함께 보내지 마라');
    expect(common).toContain('마커 인쇄나 도구 실행 성공만으로는 접수를 확인할 수 없다');
    expect(guide).not.toContain('curl -');
    for (const other of CMD_CARD_GUIDE_KINDS.filter((value) => value !== kind)) {
      expect(guide).not.toContain(`/api/agent-${other}`);
      expect(guide).not.toContain(`"kind":"${other}"`);
    }
    if (kind === 'iframe') {
      expect(guide).toContain('일반 답변에 확인한 URL');
      expect(guide).not.toContain('카드를 확인해 주세요.');
      expect(common).toContain('iframe은 위 종료 규칙에서 제외');
    } else {
      expect(common).toContain('HTTP 2xx 응답의 `ok:true`와 카드 `id`');
      expect(common).toContain('실패·시간 초과·성공 여부 불명확');
    }
    const combined = buildCmdCardProtocolRules('/home/demo/.vibisual/rules/cards-v1/cmd') + common + guide; // privacy-ok
    expect(estimateTokens(combined)).toBeLessThan(estimateTokens(buildCmdCardProtocolRules()) * 0.8);
  });

  it('does not repeat common instructions when multiple card kinds are read', () => {
    const prefix = buildCmdCardProtocolRules('/home/demo/.vibisual/rules/cards-v1/cmd') + buildCmdCardCommonGuide(); // privacy-ok
    for (const kinds of [CMD_CARD_GUIDE_KINDS.slice(0, 2), CMD_CARD_GUIDE_KINDS.slice(0, 3), CMD_CARD_GUIDE_KINDS]) {
      const combined = prefix + kinds.map(buildCmdCardGuide).join('');
      expect(estimateTokens(combined)).toBeLessThan(estimateTokens(buildCmdCardProtocolRules()));
    }
  });

  it('keeps question alternatives and the authorization boundary in the selected guide', () => {
    const guide = buildCmdCardGuide('questions');
    expect(guide).toContain('질문마다 2~4개 — 비우지 마라');
    expect(guide).toContain('이미 승인된 작업 범위 안에서만');
    expect(guide).toContain('필요한 승인·입력에 의존하는 작업은 답을 받을 때까지 실행하지 마라');
  });

  it('generates static guides outside the project and refreshes outdated content without rewriting unchanged files', () => {
    const root = home();
    const dir = ensureCmdCardRulesDocs(root)!;
    expect(dir).toBe(path.join(root, '.vibisual', 'rules', 'cards-v1', 'cmd').replace(/\\/g, '/'));
    expect(fs.readFileSync(path.join(dir, 'common.md'), 'utf8')).toBe(buildCmdCardCommonGuide());
    for (const kind of CMD_CARD_GUIDE_KINDS) {
      expect(fs.readFileSync(path.join(dir, `${kind}.md`), 'utf8')).toBe(buildCmdCardGuide(kind));
    }
    const report = path.join(dir, 'report.md');
    const review = path.join(dir, 'review.md');
    fs.writeFileSync(report, 'outdated', 'utf8');
    fs.utimesSync(review, 1, 1);
    const previousMtime = fs.statSync(review).mtimeMs;
    resetCmdCardRulesDocsCache();
    expect(ensureCmdCardRulesDocs(root)).toBe(dir);
    expect(fs.readFileSync(report, 'utf8')).toBe(buildCmdCardGuide('report'));
    expect(fs.statSync(review).mtimeMs).toBe(previousMtime);
    const read = vi.spyOn(fs, 'readFileSync');
    expect(ensureCmdCardRulesDocs(root)).toBe(dir);
    expect(read).not.toHaveBeenCalled();
  });

  it('retains the full inline protocol when any guide cannot be written', () => {
    const root = home();
    fs.mkdirSync(path.join(root, '.vibisual', 'rules', 'cards-v1', 'cmd', 'review.md'), { recursive: true });
    const dir = ensureCmdCardRulesDocs(root);
    expect(dir).toBeUndefined();
    const rules = buildCmdCardProtocolRules(dir);
    expect(rules).toBe(buildCmdCardProtocolRules());
    for (const kind of CMD_CARD_GUIDE_KINDS) expect(rules).toContain(`"kind":"${kind}"`);
    expect(rules).toContain('curl -sS --fail-with-body');
    expect(rules).not.toContain('<종류>.md');
  });
});
