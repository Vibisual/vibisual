import { AGENT_AUTH_POSIX, agentPowershellHead } from '@vibisual/shared';
import { describe, it, expect } from 'vitest';
import {
  ORCHESTRA_STRATEGIES,
  ORCHESTRA_STRATEGY_IDS,
  buildOrchestraConductorRules,
  findOrchestraStrategy,
  orchestraAnalysisMarkdown,
  orchestraConductorShell,
  orchestraStrategyRow,
} from '@vibisual/shared';
import type { OrchestraConductorRulesArgs, OrchestraStrategyId } from '@vibisual/shared';

/**
 * §5.3 #10-4 — 지휘 규칙(지휘 턴 한 번에 붙는 글).
 *
 * 못 박는 계약:
 *  ① 멤버 만들기·계획 신고·킥오프 요청 키에 이 런의 id 가 실린다 — 빠지면 멤버가 런에 묶이지 않고
 *     멤버 자신이 다시 지휘한다(재귀).
 *  ② 토큰 값은 본문에 없다 — 환경변수 참조뿐이다(대화 기록에 남는다).
 *  ③ 지난 분석 원문이 그대로 실린다. 사용자가 꺼 둔 방안은 고를 수 있는 표와 원문 표 **양쪽에서** 빠진다.
 *  ④ 같은 입력이면 같은 글이다(캐시 적중 · 테스트 재현).
 *  ⑤ 절차는 지휘자가 명령을 돌리는 셸의 말로 적힌다 — Windows 의 Codex 지휘자는 `powershell.exe` 5.1 이라
 *     bash 조각(heredoc·`${VAR:-}`·curl 플래그)이 한 줄도 돌지 않는다. 플랫폼은 인자라 세 OS 를 여기서 다 본다.
 */

function args(partial: Partial<OrchestraConductorRulesArgs> = {}): OrchestraConductorRulesArgs {
  return {
    serverBase: 'http://127.0.0.1:5555',
    projectName: 'demo',
    runId: 'orc-test-1',
    conductorAgentId: 'conductor-1',
    conductorSubAgentId: 'conductor-sub-1',
    centerX: 400.4,
    centerY: 299.6,
    settings: {},
    existingMembers: [],
    existingEdges: [],
    conductorEngine: 'claude',
    platform: 'linux',
    ...partial,
  };
}

const allowedRow = (id: string) => `| \`${id}\` |`;

/** 규칙 안의 그 언어 코드 조각들(여닫이 ``` 사이). */
const codeBlocks = (text: string, lang: 'bash' | 'powershell') =>
  [...text.matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)\\n```', 'g'))].map((m) => m[1] ?? '');

/** 인덱스 접근 — 없으면 그 자리에서 실패한다. */
function nth<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`missing item ${i}`);
  return x;
}

describe('buildOrchestraConductorRules — 런 id', () => {
  const rules = buildOrchestraConductorRules(args());

  it('멤버 만들기 본문·킥오프 요청 키·계획 신고 주소에 런 id 가 실린다', () => {
    expect(rules).toContain('"orchestraRunId":"orc-test-1"');
    expect(rules).toContain('/api/task-edges/dispatch?edgeId=<DISPATCH_EDGE_ID>&agentId=conductor-1&wait=false&requestKey=orc-test-1%3Aentry"');
    expect(rules).toContain('/api/orchestra/runs/orc-test-1/plan"');
    expect(rules.split('\n')[0]).toBe('# 오케스트라 지휘 — 이번 요청 한 건 (런 `orc-test-1`)');
  });

  it('프로젝트 이름은 JSON 으로, 없으면 null', () => {
    expect(rules).toContain('"project":"demo"');
    expect(buildOrchestraConductorRules(args({ projectName: 'a "b"' }))).toContain('"project":"a \\"b\\""');
    expect(buildOrchestraConductorRules(args({ projectName: null }))).toContain('"project":null');
  });

  it('좌표는 반올림한 지휘자 위치가 중심이다', () => {
    expect(rules).toContain('중심(당신의 버블) = (400, 300)');
  });
});

describe('buildOrchestraConductorRules — 토큰', () => {
  const rules = buildOrchestraConductorRules(args());

  it('베이스와 인증은 환경변수 참조뿐이다', () => {
    expect(rules).toContain('${VIBISUAL_BASE:-http://127.0.0.1:5555}');
    expect(rules).toContain(`-H "x-vibisual-hook-token: ${AGENT_AUTH_POSIX}"`);
    const headers = rules.match(/x-vibisual-hook-token:[^"]*/g) ?? [];
    expect(headers.length).toBeGreaterThanOrEqual(5);
    for (const h of headers) expect(h).toBe(`x-vibisual-hook-token: ${AGENT_AUTH_POSIX}`);
  });

  it('curl 은 전부 같은 베이스를 쓴다', () => {
    const urls = rules.match(/curl -s(?: -X \w+)? "([^"]+)"/g) ?? [];
    expect(urls.length).toBeGreaterThanOrEqual(5);
    for (const u of urls) expect(u).toContain('"${VIBISUAL_BASE:-http://127.0.0.1:5555}/api/');
  });
});

describe('buildOrchestraConductorRules — 지난 분석 원문', () => {
  it('끈 방안이 없으면 원문 전체가 그대로 실린다', () => {
    const rules = buildOrchestraConductorRules(args());
    expect(rules).toContain('## 지난 분석 원문 (2026-09-16 토큰 감사 — 고치지 않은 원문)');
    expect(rules.endsWith(orchestraAnalysisMarkdown())).toBe(true);
    expect(rules).toContain(`방안 id ↔ 표의 #: ${ORCHESTRA_STRATEGIES.map((s) => `${s.id}=${s.no}`).join(' · ')}`);
  });

  it('사용자가 꺼 둔 방안은 고를 수 있는 표와 원문 표 양쪽에서 빠진다', () => {
    const rules = buildOrchestraConductorRules(args({ settings: { disabledStrategies: ['web'] } }));
    const web = findOrchestraStrategy('web');
    if (!web) throw new Error('catalog lost web');
    expect(rules).toContain('## 고를 수 있는 방안 (9개)');
    expect(rules).not.toContain(allowedRow('web'));
    expect(rules).not.toContain(orchestraStrategyRow(web));
    expect(rules.endsWith(orchestraAnalysisMarkdown({ exclude: ['web'] }))).toBe(true);
    expect(rules).toContain('### 사용자가 꺼 둔 방안 — 고를 수 없다(`chosen` 에 담으면 400)\n`web`(10)');
  });

  it('참고 전용(11·12·13)은 고를 수 있는 표에 없고 따로 적힌다 — 원문 표에는 남는다', () => {
    const rules = buildOrchestraConductorRules(args());
    expect(rules).toContain('## 고를 수 있는 방안 (10개)');
    for (const id of ['reminders', 'preamble', 'other']) {
      expect(rules).not.toContain(allowedRow(id));
      expect(rules).toMatch(new RegExp(`- \`${id}\`\\(\\d+\\) — `));
      const s = findOrchestraStrategy(id);
      if (!s) throw new Error(`catalog lost ${id}`);
      expect(rules).toContain(orchestraStrategyRow(s));
    }
    for (const id of ORCHESTRA_STRATEGY_IDS.slice(0, 10)) expect(rules).toContain(allowedRow(id));
    expect(rules).not.toContain('### 사용자가 꺼 둔 방안');
  });

  it('모두 꺼 두면 chosen 을 비워 신고하라고 적는다', () => {
    const all = ORCHESTRA_STRATEGY_IDS.filter((id) => findOrchestraStrategy(id)?.apply.selectable) as OrchestraStrategyId[];
    const rules = buildOrchestraConductorRules(args({ settings: { disabledStrategies: all } }));
    expect(rules).toContain('## 고를 수 있는 방안 (0개)\n사용자가 방안을 모두 꺼 두었다 — `chosen` 은 비워 신고한다.');
    expect(rules).not.toContain('### 칸 설명');
  });

  it('칸 설명은 허용된 방안이 실제로 쓰는 칸만 싣는다', () => {
    const others = ORCHESTRA_STRATEGY_IDS.filter((id) => id !== 'subagents');
    const rules = buildOrchestraConductorRules(args({ settings: { disabledStrategies: others } }));
    expect(rules).toContain('## 고를 수 있는 방안 (1개)');
    for (const k of ['model', 'effort', 'maxTurns', 'subagentDepth', 'rules']) expect(rules).toContain(`- \`${k}\` — `);
    expect(rules).not.toContain('- `bashMaxOutputChars` — ');
    expect(rules).not.toContain('- `autoCompactPct` — ');
  });
});

describe('buildOrchestraConductorRules — 엔진', () => {
  it('Codex 지휘자에게만 "쓰기는 이 줄이 유일한 선" 을 붙인다', () => {
    const line = '(Codex 엔진에서는 쓰기가 도구로 막혀 있지 않다 — 이 줄이 유일한 선이다.)';
    expect(buildOrchestraConductorRules(args({ conductorEngine: 'codex' }))).toContain(line);
    expect(buildOrchestraConductorRules(args())).not.toContain(line);
  });

  it('멤버 엔진 claude(기본) — Claude 절만', () => {
    const rules = buildOrchestraConductorRules(args());
    expect(rules).toContain('멤버는 **Claude** 로 만든다(사용자 설정).');
    expect(rules).toContain('- **Claude 멤버**');
    expect(rules).not.toContain('- **Codex 멤버**');
    expect(rules).toContain('모델은 역할마다 고른다');
  });

  it('멤버 엔진 codex — Codex 절만, 설정한 모델·강도가 provider 본문에 들어간다', () => {
    const rules = buildOrchestraConductorRules(
      args({ settings: { memberEngine: 'codex', memberCodexModel: 'gpt-5.1-codex', memberCodexReasoning: 'high' } }),
    );
    expect(rules).toContain('멤버는 **Codex** 로 만든다(사용자 설정).');
    expect(rules).not.toContain('- **Claude 멤버**');
    expect(rules).toContain('`"provider":{"kind":"codex-cli","modelId":"gpt-5.1-codex","reasoningEffort":"high"}`');
    expect(rules).toContain('모델은 `gpt-5.1-codex` 로 둔다(사용자 설정).');
    expect(rules).toContain('추론 강도는 `high` 로 둔다(사용자 설정).');
  });

  it('멤버 엔진 codex 에 칸을 비우면 기본 모델 안내', () => {
    const rules = buildOrchestraConductorRules(args({ settings: { memberEngine: 'codex' } }));
    expect(rules).toContain('`"provider":{"kind":"codex-cli","modelId":""}`');
    expect(rules).toContain('`modelId` 를 비워 두면 그 PC 의 Codex 기본 모델이다.');
  });

  it('멤버 엔진 auto — 두 절 다, 고른 이유를 note 에', () => {
    const rules = buildOrchestraConductorRules(args({ settings: { memberEngine: 'auto', memberClaudeModel: 'sonnet', memberClaudeEffort: 'medium' } }));
    expect(rules).toContain('멤버 엔진은 **아래 준비된 엔진 안에서 역할마다 당신이 고른다**(사용자 설정 `auto`).');
    expect(rules).toContain('- **Claude 멤버**');
    expect(rules).toContain('- **Codex 멤버**');
    expect(rules).toContain('모델은 `sonnet` 로 둔다(사용자 설정).');
    expect(rules).toContain('effort 는 `medium` 로 둔다(사용자 설정).');
  });
});

describe('buildOrchestraConductorRules — 기존 멤버·엣지·상한', () => {
  it('멤버가 없으면 새로 만들라는 한 줄, 엣지 표는 싣지 않는다', () => {
    const rules = buildOrchestraConductorRules(args());
    expect(rules).toContain('## 다시 쓸 수 있는 멤버 (① 로 새로 만들기 전에 먼저 본다)\n없음 — 필요하면 ① 로 새로 만든다.');
    expect(rules).not.toContain('### 이미 있는 엣지');
  });

  it('멤버·엣지 표 — 칸 안의 파이프는 이스케이프, 엣지 끝은 라벨로, 긴 용도는 줄인다', () => {
    const rules = buildOrchestraConductorRules(
      args({
        existingMembers: [
          { id: 'a1', label: 'Research|er', path: 'a1', engine: 'claude', model: 'sonnet' },
          { id: 'b2', label: 'Coder', path: 'b2', engine: 'codex' },
        ],
        existingEdges: [
          { id: 'e1', sourceAgentId: 'a1', targetAgentId: 'b2', command: 'grep x | head\nthen fix', kind: 'critique' },
          { id: 'e2', sourceAgentId: 'b2', targetAgentId: 'gone', command: 'y'.repeat(120) },
        ],
      }),
    );
    expect(rules).toContain('| Research\\|er | `a1` | `a1` | claude | sonnet | 프로젝트 |');
    expect(rules).toContain('| Coder | `b2` | `b2` | codex | — | 프로젝트 |');
    expect(rules).toContain('| `e1` | Research\\|er → Coder | critique | grep x \\| head then fix |');
    expect(rules).toContain(`| \`e2\` | Coder → gone | command | ${'y'.repeat(80)}… |`);
  });

  /*
   * 재사용 후보가 **프로젝트 전체**로 넓어진 자리(격차 5). 서버가 ④ 계획 신고에서 받아 주는 집합이
   * 프로젝트 소속 전부인데 표에는 내 이전 런의 것만 실려서, 지휘자가 쓸 수 있는 버블을 못 보고
   * 똑같은 것을 또 만들었다. 표는 둘을 **갈라서** 보여야 한다 — 감추지도, 뒤섞지도 않는다.
   */
  it('재사용 후보는 내 이전 런과 프로젝트를 갈라 적고, 내 것이 먼저다', () => {
    const rules = buildOrchestraConductorRules(
      args({
        existingMembers: [
          { id: 'a1', label: 'Mine', path: 'a1', engine: 'claude', own: true },
          { id: 'b2', label: 'Theirs', path: 'b2', engine: 'claude' },
        ],
      }),
    );
    expect(rules).toContain('| Mine | `a1` | `a1` | claude | — | 내 이전 런 |');
    expect(rules).toContain('| Theirs | `b2` | `b2` | claude | — | 프로젝트 |');
    expect(rules.indexOf('| Mine |')).toBeLessThan(rules.indexOf('| Theirs |'));
    expect(rules).toContain('둘 다 ④ 의 `reusedAgentIds` 에 넣을 수 있다.');
  });

  /* 표가 그래프 크기를 따라 자라지 않게 자른다 — 넘친 것은 수만 알리고 전체는 REST 로 보게 한다. */
  it('엣지 표는 30줄에서 자르고 남은 수를 알린다', () => {
    const many = Array.from({ length: 34 }, (_, i) => ({
      id: `e${i}`, sourceAgentId: 'a1', targetAgentId: 'a1', command: 'x',
    }));
    const rules = buildOrchestraConductorRules(
      args({ existingMembers: [{ id: 'a1', label: 'M', path: 'a1', engine: 'claude' }], existingEdges: many }),
    );
    expect(rules).toContain('| `e29` |');
    expect(rules).not.toContain('| `e30` |');
    expect(rules).toContain('그 밖에 4개가 더 있다');
  });

  it('멤버 상한은 설정값(없으면 기본)', () => {
    expect(buildOrchestraConductorRules(args({ settings: { maxMembers: 3 } }))).toContain('최대 **3개**');
    expect(buildOrchestraConductorRules(args())).toContain('최대 **6개**');
  });
});

describe('orchestraConductorShell — 세 OS × 두 엔진', () => {
  it.each([
    ['claude', 'win32', 'posix'],
    ['claude', 'darwin', 'posix'],
    ['claude', 'linux', 'posix'],
    ['codex', 'win32', 'powershell'],
    ['codex', 'darwin', 'posix'],
    ['codex', 'linux', 'posix'],
  ] as const)('%s 지휘자 on %s → %s', (engine, platform, shell) => {
    expect(orchestraConductorShell(engine, platform)).toBe(shell);
  });
});

describe('buildOrchestraConductorRules — 위임과 결과 회수 계약', () => {
  it.each([['claude', 'linux', 'bash'], ['codex', 'win32', 'powershell']] as const)('%s: 계획 등록 → 감독 엣지로 위임 → 같은 작업 결과 회수', (conductorEngine, platform, shell) => {
    const rules = buildOrchestraConductorRules(args({ conductorEngine, platform }));
    const blocks = codeBlocks(rules, shell);
    expect(nth(blocks, 3)).toContain('/api/orchestra/runs/orc-test-1/plan');
    expect(nth(blocks, 3)).toContain('DISPATCH_EDGE_ID=');
    expect(nth(blocks, 4)).toContain('/api/task-edges/dispatch?edgeId=<DISPATCH_EDGE_ID>&agentId=conductor-1&wait=false&requestKey=orc-test-1%3Aentry');
    expect(nth(blocks, 5)).toContain('/api/task-edges/dispatch/<CMD_ID>?agentId=conductor-1&waitMs=60000');
    expect(blocks.join('\n')).not.toContain('/api/commands');
    expect(nth(blocks, 2)).toContain('"returnFormat":"both"');
    expect(rules).toContain('**지휘자 → 엔트리 연결은 필수**');
    expect(rules).toContain('모든 하위 위임 결과·검증·재작업을 회수한 뒤 통합 보고한다');
    expect(nth(blocks, 4)).toContain('모든 작업·검증·재작업의 끝난 결과를 회수한 뒤 통합 보고하세요');
    expect(rules).toContain('`job.status`·`job.result`');
    expect(rules).toContain('`queued`·`executing`·`pending:true`·`timedOut:true` 는 진행 중');
    expect(rules).toContain('다른 키로 같은 일을 재위임하지 않는다');
    expect(rules).toContain('**끝난 결과를 회수하기 전에는 턴을 완료하지 않는다.**');
    expect(rules).not.toContain('결과를 기다리지 않는다');
    expect(rules).not.toContain('지휘자 자신을 엣지의 source·target 으로 쓰지 않는다');
    expect(rules).toContain('기존 연결은 사용자 산출물이다. 이번에 쓰지 않는다고 삭제하지 않는다');
  });

  it('none 은 entry 를 생략하고 계획만 신고한다', () => {
    const rules = buildOrchestraConductorRules(args());
    expect(rules).toContain('`none` 이면 `entryAgentId` 는 빼고 `reusedAgentIds` 는 빈 배열');
    expect(rules).toContain('이때 연결도 킥오프도 결과 대기도 필요 없다');
  });

  it('지휘자의 기존 엣지를 알아보고 재사용한다', () => {
    const rules = buildOrchestraConductorRules(args({
      existingMembers: [{ id: 'entry', label: 'Hub', path: 'entry-path', engine: 'claude' }],
      existingEdges: [{ id: 'dispatch-existing', sourceAgentId: 'conductor-1', targetAgentId: 'entry', kind: 'command', command: 'delegate' }],
    }));
    expect(rules).toContain('| `dispatch-existing` | 지휘자(당신) → Hub | command | delegate |');
  });
});

describe('buildOrchestraConductorRules — PowerShell 판(Windows 의 Codex 지휘자)', () => {
  const ps = buildOrchestraConductorRules(args({ conductorEngine: 'codex', platform: 'win32' }));
  const blocks = codeBlocks(ps, 'powershell');

  it('여섯 조각 모두 PowerShell 이고 bash 문법은 한 줄도 없다', () => {
    expect(ps).toContain('## 2. 절차 (PowerShell 로 Invoke-RestMethod)');
    expect(blocks).toHaveLength(6);
    expect(codeBlocks(ps, 'bash')).toHaveLength(0);
    for (const s of ["<<'JSON'", "<<'EOF'", '${VIBISUAL_BASE:-', 'curl -s', '--data-binary']) expect(ps).not.toContain(s);
  });

  it('런 id·프로젝트가 bash 판과 같은 자리에 실린다', () => {
    expect(ps).toContain('"orchestraRunId":"orc-test-1"');
    expect(ps).toContain('/api/task-edges/dispatch?edgeId=<DISPATCH_EDGE_ID>&agentId=conductor-1&wait=false&requestKey=orc-test-1%3Aentry"');
    expect(ps).toContain('/api/orchestra/runs/orc-test-1/plan"');
    expect(ps).toContain('"project":"demo"');
    expect(ps).toContain("$AgentId = '<① 에서 받은 AGENT_ID>'");
  });

  it('조각마다 같은 머리 네 줄로 시작한다 — Codex 는 명령마다 새 셸이다', () => {
    const head = nth(blocks, 0).split('\n').slice(0, 4);
    expect(head[0]).toBe("$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.Encoding]::UTF8");
    expect(head[1]).toBe("$B = if ($env:VIBISUAL_BASE) { $env:VIBISUAL_BASE } else { 'http://127.0.0.1:5555' }");
    // 따옴표로 감싸야 변수가 없을 때 NullReference 대신 401 이 이유와 함께 보인다(5.1 실측).
    expect(head[2]).toBe(agentPowershellHead('')[2]);
    expect(nth(head, 3).startsWith('function Send($Method, $Uri, $Type, $Text) {')).toBe(true);
    for (const b of blocks) expect(b.split('\n').slice(0, 4)).toEqual(head);
  });

  it('호출은 전부 Send 로, 같은 베이스로 — 직접 Invoke-RestMethod 는 Send 안에만 있다', () => {
    const calls = blocks.flatMap((b) => b.match(/Send (?:Get|Post|Put) "[^"]+"/g) ?? []);
    expect(calls).toHaveLength(7); // ① · ② 읽기+저장 · ③ · ④ · ⑤ · ⑥
    for (const c of calls) expect(c).toMatch(/^Send \w+ "\$B\/api\//);
    for (const b of blocks) {
      for (const line of b.split('\n').filter((l) => l.includes('Invoke-RestMethod'))) {
        expect(line.startsWith('function Send(')).toBe(true);
      }
    }
  });

  it('4xx 는 응답 본문을 오류 줄에 싣는다 — 5.1 은 ErrorDetails 가 비어 스트림을 읽는다', () => {
    const send = nth(nth(blocks, 0).split('\n'), 3);
    expect(send).toContain('$_.ErrorDetails.Message');
    expect(send).toContain('(New-Object IO.StreamReader $r.GetResponseStream()).ReadToEnd()');
    expect(send).toContain('throw "HTTP $([int]$r.StatusCode) $d"');
    expect(send).toContain('[Text.Encoding]::UTF8.GetBytes($Text)');
  });

  it('본문 있는 조각의 here-string 은 한 쌍이고 닫는 `\'@` 는 줄 맨 앞이다', () => {
    for (const b of blocks.slice(0, 5)) {
      const lines = b.split('\n');
      expect(lines.filter((l) => /@'$/.test(l))).toHaveLength(1);
      expect(lines.filter((l) => l.startsWith("'@"))).toHaveLength(1);
      expect(lines.some((l) => /^\s+'@/.test(l))).toBe(false);
    }
    expect(nth(blocks, 5)).not.toContain("@'");
  });

  it('설정 합치기는 순서 사전 + 깊이를 준 ConvertTo-Json(기본 깊이 2 는 중첩을 뭉갠다)', () => {
    const config = nth(blocks, 1);
    expect(config).toContain('$M = [ordered]@{}');
    expect(config).toContain('$Json = ConvertTo-Json -InputObject $M -Depth 32 -Compress');
    expect(config).toContain("'@ | ConvertFrom-Json");
  });

  it('토큰 값은 본문에 없다 — 머리의 환경변수 참조 여섯 번뿐', () => {
    expect(ps.split('\n').filter((line) => line.startsWith('$H ='))).toEqual(Array(6).fill(agentPowershellHead('')[2]));
    expect(ps).not.toMatch(/x-vibisual-hook-token: /);
  });

  it('모든 조각에 지휘자의 소유자와 실행 세션 헤더가 남는다', () => {
    for (const block of blocks) {
      expect(block).toContain("$H['x-vibisual-source-agent'] = 'conductor-1'");
      expect(block).toContain('$env:VIBISUAL_SUBAGENT_ID');
      expect(block).toContain("else { 'conductor-sub-1' }");
    }
    expect(nth(blocks, 4)).toContain('| ConvertTo-Json -Depth 32');
    expect(nth(blocks, 5)).toContain('| ConvertTo-Json -Depth 32');
  });

  it('금지 줄도 그 셸의 말로 — 절차 밖의 글은 bash 판과 같다', () => {
    const psNoWrite = '- 파일 쓰기·수정 ❌(셸로 쓰는 것 포함 — `Set-Content`·`Out-File`·`>` 도 쓰기다).';
    const psOneBase = '- 모든 호출의 베이스는 위 `$B` 하나다(이 주소만 앱 안 서버에 닿는다).';
    const shNoWrite = '- 파일 쓰기·수정 ❌(Write·Edit·NotebookEdit, Bash 로 쓰는 것 포함).';
    const shOneBase = '- 모든 curl 의 베이스는 위 서버 베이스 하나다(이 주소만 앱 안 서버에 닿는다).';
    expect(ps).toContain(psNoWrite);
    expect(ps).toContain(psOneBase);
    expect(ps).not.toContain(shOneBase);
    const sh = buildOrchestraConductorRules(args({ conductorEngine: 'codex', platform: 'linux' }));
    const before = (t: string) => t.slice(0, t.indexOf('## 2. 절차'));
    const after = (t: string) => t.slice(t.indexOf('## 3. 마무리'));
    expect(before(ps)).toBe(before(sh));
    expect(after(ps).replace(psNoWrite, shNoWrite).replace(psOneBase, shOneBase)).toBe(after(sh));
  });
});

describe('buildOrchestraConductorRules — Bash 판(Claude 지휘자 세 OS · mac/linux 의 Codex 지휘자)', () => {
  it.each([
    ['claude', 'win32'],
    ['claude', 'darwin'],
    ['claude', 'linux'],
    ['codex', 'darwin'],
    ['codex', 'linux'],
  ] as const)('%s 지휘자 on %s', (engine, platform) => {
    const rules = buildOrchestraConductorRules(args({ conductorEngine: engine, platform }));
    expect(rules).toContain('## 2. 절차 (Bash 로 curl)');
    expect(codeBlocks(rules, 'bash')).toHaveLength(6);
    expect(codeBlocks(rules, 'powershell')).toHaveLength(0);
    expect(rules).not.toContain('Invoke-RestMethod');
    expect(rules).toContain('-H "x-vibisual-source-agent: conductor-1"');
    expect(rules).toContain('-H "x-vibisual-source-subagent: ${VIBISUAL_SUBAGENT_ID:-conductor-sub-1}"');
    expect(rules).toContain('- 모든 curl 의 베이스는 위 서버 베이스 하나다(이 주소만 앱 안 서버에 닿는다).');
  });

  it('셸 변수는 호출 사이에 남지 않는다 — ② 는 ① 이 출력한 id 를 값으로 받는다', () => {
    const rules = buildOrchestraConductorRules(args());
    const bash = codeBlocks(rules, 'bash');
    const [create, config, edge] = [nth(bash, 0), nth(bash, 1), nth(bash, 2)];
    expect(rules).toContain('- 셸 변수는 호출 사이에 남지 않는다 — 앞 단계가 출력한 id·path 는 다음 호출에 **값으로** 적어 넣는다.');
    expect(create).toContain("o.agent?'AGENT_ID='+o.agent.id+' AGENT_PATH='+o.agent.path:s");
    expect(nth(config.split('\n'), 0)).toBe("AGENT_ID='<① 에서 받은 AGENT_ID>'");
    expect(edge).toContain("o.data?'EDGE_ID='+o.data.id:s");
  });
});

/**
 * 멤버가 **태어날 때** 받는 두 축(사용자 스위치)이 규칙에 실리는가.
 *
 * 싣지 않으면 지휘자는 워커 셋이 한 워킹트리를 동시에 고친다는 것도, 자기가 만든 멤버에게 `Write`
 * 가 없다는 것도 모른 채 편성한다 — 둘 다 조용히 실패하고 원인이 규칙 밖이라 스스로 못 고친다.
 */
describe('buildOrchestraConductorRules — 멤버 태생 상태', () => {
  it('기본값 — 같은 워킹트리라고 말하고 parallel 을 파일 겹침으로 제한한다', () => {
    const rules = buildOrchestraConductorRules(args());
    expect(rules).toContain('새 멤버는 아래 상태로 **태어난다**');
    expect(rules).toContain('- **작업 폴더: 지휘자와 같은 워킹트리.**');
    expect(rules).toContain('`parallel` 은 **파일이 겹치지 않을 때만** 고른다');
    expect(rules).toContain('- **도구: 설정 창 기본값 그대로**');
    expect(rules).not.toContain('별도 git worktree');
  });

  it('작업 폴더를 워크트리로 켜면 제약이 풀리고, 합치는 일은 사용자 몫으로 남는다', () => {
    const rules = buildOrchestraConductorRules(args({ settings: { memberIsolation: 'worktree' } }));
    expect(rules).toContain('- **작업 폴더: 별도 git worktree.**');
    expect(rules).toContain('`parallel` 로 코드를 나눠 고쳐도 안전하다');
    expect(rules).toContain('합치는 일은 사용자 몫으로 남긴다(당신이 합치지 않는다)');
    // `--worktree` 는 Claude CLI 의 플래그다 — Codex 멤버에는 안 걸린다는 것을 같이 말한다.
    expect(rules).toContain('Codex 멤버에는 이 격리가 걸리지 않는다.');
    expect(rules).not.toContain('지휘자와 같은 워킹트리');
  });

  it('도구 템플릿을 고르면 목록을 펼쳐 싣고, 없는 도구는 없다고 못 박는다', () => {
    const rules = buildOrchestraConductorRules(args({ settings: { memberToolTemplate: 'review' } }));
    expect(rules).toContain('- **도구: `review` 템플릿** (6개) — `Read`, `Glob`, `Grep`, `Bash`, `PowerShell`, `LSP`.');
    expect(rules).toContain('이 목록에 없는 도구는 그 멤버에게 **존재하지 않는다.**');
    expect(rules).not.toContain('- **도구: 설정 창 기본값 그대로**');
  });

  /* `all` 은 기본값과 같은 목록이라 못 박지 않는다 — 규칙도 "기본값 그대로"로 남아야 한다. */
  it("'all' 은 템플릿 절을 만들지 않는다", () => {
    const rules = buildOrchestraConductorRules(args({ settings: { memberToolTemplate: 'all' } }));
    expect(rules).toContain('- **도구: 설정 창 기본값 그대로**');
    expect(rules).not.toContain('템플릿** (');
  });
});

/** ③ 엣지에 실리는 프리셋 표·상한 칸·구조화 인계, 그리고 ① 의 역할 색. */
describe('buildOrchestraConductorRules — 엣지 프리셋·상한·역할 색', () => {
  const rules = buildOrchestraConductorRules(args());

  it('역할 짝 프리셋 표를 값까지 펼쳐 싣고, generic 은 뺀다', () => {
    expect(rules).toContain('#### 역할 짝 프리셋 — 값을 그대로 옮겨 적는다');
    for (const id of ['explore-to-architect', 'architect-to-implementer', 'implementer-to-verifier', 'verifier-to-implementer']) {
      expect(rules).toContain(`| \`${id}\` |`);
    }
    // `generic` 의 `defaultCommandMode` 는 대상 멤버의 도구를 위임 한 벌로 갈아 끼운다 — 권하지 않는다.
    expect(rules).not.toContain('| `generic` |');
    expect(rules).toContain('`"generic"` 은 쓰지 않는다');
    expect(rules).toContain('- `templateId` 는 **기록만** 된다 — 서버가 나머지 칸을 대신 채우지 않는다.');
  });

  /* `TaskEdgeReturnFormat` 에 없는 값을 적어도 `createTaskEdge` 는 막지 않는다 — 조용히 저장되고 회수만 빠진다. */
  it('returnFormat 은 실재하는 세 값만 가르친다', () => {
    expect(rules).toContain('`"summary"`(기본)·`"artifact"`·`"both"`');
    expect(rules).not.toContain('"full"');
  });

  it('상한 칸 셋과 구조화 인계를 싣는다', () => {
    for (const field of ['timeoutMs', 'priority', 'maxReworkCount', 'messageFormat', 'messageSchema']) {
      expect(rules).toContain(`\`${field}\``);
    }
    expect(rules).toContain('"messageFormat":"schema"');
  });

  it('비용 상한 손잡이는 세션 재사용을 잃는다고 경고한다', () => {
    expect(rules).toContain('`maxBudgetUsd`');
    expect(rules).toContain('**세션 재사용을 잃는다**');
  });

  it('역할 색을 권하되 초록 계열은 비워 둔다', () => {
    expect(rules).toContain('- `color` 로 역할을 구별해 칠한다');
    expect(rules).toContain('탐색 `#6366f1`');
    expect(rules).toContain('초록 계열은 쓰지 않는다(Codex·CMD 버블의 자리다).');
    expect(nth(codeBlocks(rules, 'bash'), 0)).toContain('"color":"#6366f1"');
  });
});

describe('buildOrchestraConductorRules — 결정성', () => {
  it('같은 입력이면 같은 글이다', () => {
    const a = args({ settings: { memberEngine: 'auto', disabledStrategies: ['web', 'shell'] }, conductorEngine: 'codex' });
    expect(buildOrchestraConductorRules(a)).toBe(buildOrchestraConductorRules({ ...a }));
  });
});
