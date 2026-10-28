/**
 * §5.11 — **CMD(인터랙티브 터미널) 세션에 집행이 실리는가.**
 * 헤드리스는 프롬프트를 우리가 조립하지만 CMD 는 사람이 REPL 을 몰아, 끼어들 자리가 `~/.vibisual/cmd-agents/<agentId>/CLAUDE.md`(+ `--add-dir`) 하나뿐이다 — rules 와 같은 통로로 넣는다(새 채널 ❌).
 * 여기는 "블록이 그 파일에 들어갔는가"만 본다. "무엇이 블록인가"(켬/끔·프로젝트 격리)는 `pluginHost.test.ts` 가 고정한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_AGENT_CONFIG } from '@vibisual/shared';
import { prepareInteractiveRulesDir } from './subAgentManager.js';

const AGENT = 'agent-cmd-test';
const rulesFile = (): string => path.join(os.homedir(), '.vibisual', 'cmd-agents', AGENT, 'CLAUDE.md');

function read(): string {
  return fs.readFileSync(rulesFile(), 'utf-8');
}

describe('CMD rules 파일 — 집행 블록 동봉', () => {
  beforeEach(() => {
    fs.rmSync(path.dirname(rulesFile()), { recursive: true, force: true });
  });
  afterEach(() => {
    fs.rmSync(path.dirname(rulesFile()), { recursive: true, force: true });
  });

  it('집행 블록을 주면 rules 파일에 함께 쓴다 — 그래야 CMD 세션도 그 규율로 일한다', () => {
    const dir = prepareInteractiveRulesDir(AGENT, DEFAULT_AGENT_CONFIG, {
      enforcementBlock: '\n\n# SSOT (단일 진실 공급원)\n\n> 이 프로젝트의 SSOT = `docs/SCENARIO.md`\n',
    });
    expect(dir).not.toBeNull();
    const body = read();
    expect(body).toContain('docs/SCENARIO.md');
    expect(body).toContain('SSOT');
  });

  it('집행이 없으면 그 절을 만들지 않는다 — 안 켠 프로젝트의 파일은 종전과 같다', () => {
    prepareInteractiveRulesDir(AGENT, DEFAULT_AGENT_CONFIG, { enforcementBlock: '' });
    const withoutArg = read();
    fs.rmSync(path.dirname(rulesFile()), { recursive: true, force: true });
    prepareInteractiveRulesDir(AGENT, DEFAULT_AGENT_CONFIG);
    expect(read()).toBe(withoutArg);
  });

  it('공백만 든 블록도 절을 만들지 않는다', () => {
    prepareInteractiveRulesDir(AGENT, DEFAULT_AGENT_CONFIG, { enforcementBlock: '   \n  \n' });
    const body = read();
    // 사용자 rules 도 없으므로 남는 것은 머리글 + 카드 신고 프로토콜뿐이다.
    expect(body).toContain('# Agent Rules (Vibisual CMD agent)');
    expect(body.split('\n\n').filter((s) => s.trim() === '')).toEqual([]);
  });

  it('사용자 rules 와 집행이 함께 있으면 둘 다 실린다 — 하나가 다른 하나를 덮지 않는다', () => {
    prepareInteractiveRulesDir(
      AGENT,
      { ...DEFAULT_AGENT_CONFIG, rules: '한국어로 답하라' },
      { enforcementBlock: '# SSOT\n\n문서를 먼저 읽어라' },
    );
    const body = read();
    expect(body).toContain('한국어로 답하라');
    expect(body).toContain('문서를 먼저 읽어라');
    // 카드 신고 프로토콜(항상 주입)도 여전히 살아 있어야 한다 — CMD 는 터미널 한 줄 인쇄 방식이다.
    expect(body).toContain('::VIBISUAL-CARD::');
  });

  it('세션을 다시 열면 최신 집행으로 다시 쓴다 — 켜고 끈 것이 다음 세션에 반영된다', () => {
    prepareInteractiveRulesDir(AGENT, DEFAULT_AGENT_CONFIG, { enforcementBlock: '# SSOT\n\n첫 판' });
    expect(read()).toContain('첫 판');
    prepareInteractiveRulesDir(AGENT, DEFAULT_AGENT_CONFIG, { enforcementBlock: '' });
    expect(read()).not.toContain('첫 판');
  });
});
