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
 *  ① 절차의 세 줄(멤버 만들기·킥오프·계획 신고)에 이 런의 id 가 실린다 — 빠지면 멤버가 런에 묶이지 않고
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

  it('멤버 만들기 본문·킥오프 주소·계획 신고 주소에 런 id 가 실린다', () => {
    expect(rules).toContain('"orchestraRunId":"orc-test-1"');
    expect(rules).toContain('/api/commands/<ENTRY_AGENT_PATH>?orchestraRunId=orc-test-1"');
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
    expect(rules).toContain('멤버 엔진은 **역할마다 당신이 고른다**(사용자 설정 `auto`).');
    expect(rules).toContain('- **Claude 멤버**');
    expect(rules).toContain('- **Codex 멤버**');
    expect(rules).toContain('모델은 `sonnet` 로 둔다(사용자 설정).');
    expect(rules).toContain('effort 는 `medium` 로 둔다(사용자 설정).');
  });
});

describe('buildOrchestraConductorRules — 기존 멤버·엣지·상한', () => {
  it('멤버가 없으면 새로 만들라는 한 줄, 엣지 표는 싣지 않는다', () => {
    const rules = buildOrchestraConductorRules(args());
    expect(rules).toContain('## 기존 멤버 (이전 런이 만든 것 — 다시 쓰기 우선)\n없음 — 필요하면 ① 로 새로 만든다.');
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
    expect(rules).toContain('| Research\\|er | `a1` | `a1` | claude | sonnet |');
    expect(rules).toContain('| Coder | `b2` | `b2` | codex | — |');
    expect(rules).toContain('| `e1` | Research\\|er → Coder | critique | grep x \\| head then fix |');
    expect(rules).toContain(`| \`e2\` | Coder → gone | command | ${'y'.repeat(80)}… |`);
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

describe('buildOrchestraConductorRules — PowerShell 판(Windows 의 Codex 지휘자)', () => {
  const ps = buildOrchestraConductorRules(args({ conductorEngine: 'codex', platform: 'win32' }));
  const blocks = codeBlocks(ps, 'powershell');

  it('다섯 조각 모두 PowerShell 이고 bash 문법은 한 줄도 없다', () => {
    expect(ps).toContain('## 2. 절차 (PowerShell 로 Invoke-RestMethod)');
    expect(blocks).toHaveLength(5);
    expect(codeBlocks(ps, 'bash')).toHaveLength(0);
    for (const s of ["<<'JSON'", "<<'EOF'", '${VIBISUAL_BASE:-', 'curl -s', '--data-binary']) expect(ps).not.toContain(s);
  });

  it('런 id·프로젝트가 bash 판과 같은 자리에 실린다', () => {
    expect(ps).toContain('"orchestraRunId":"orc-test-1"');
    expect(ps).toContain('/api/commands/<ENTRY_AGENT_PATH>?orchestraRunId=orc-test-1"');
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
    expect(calls).toHaveLength(6); // ① · ② 읽기+저장 · ③ · ④ · ⑤
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

  it('here-string 은 조각마다 한 쌍이고 닫는 `\'@` 는 줄 맨 앞이다', () => {
    for (const b of blocks) {
      const lines = b.split('\n');
      expect(lines.filter((l) => /@'$/.test(l))).toHaveLength(1);
      expect(lines.filter((l) => l.startsWith("'@"))).toHaveLength(1);
      expect(lines.some((l) => /^\s+'@/.test(l))).toBe(false);
    }
  });

  it('설정 합치기는 순서 사전 + 깊이를 준 ConvertTo-Json(기본 깊이 2 는 중첩을 뭉갠다)', () => {
    const config = nth(blocks, 1);
    expect(config).toContain('$M = [ordered]@{}');
    expect(config).toContain('$Json = ConvertTo-Json -InputObject $M -Depth 32 -Compress');
    expect(config).toContain("'@ | ConvertFrom-Json");
  });

  it('토큰 값은 본문에 없다 — 머리의 환경변수 참조 다섯 번뿐', () => {
    expect(ps.split('\n').filter((line) => line.startsWith('$H ='))).toEqual(Array(5).fill(agentPowershellHead('')[2]));
    expect(ps).not.toMatch(/x-vibisual-hook-token: /);
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
    expect(codeBlocks(rules, 'bash')).toHaveLength(5);
    expect(codeBlocks(rules, 'powershell')).toHaveLength(0);
    expect(rules).not.toContain('Invoke-RestMethod');
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

describe('buildOrchestraConductorRules — 결정성', () => {
  it('같은 입력이면 같은 글이다', () => {
    const a = args({ settings: { memberEngine: 'auto', disabledStrategies: ['web', 'shell'] }, conductorEngine: 'codex' });
    expect(buildOrchestraConductorRules(a)).toBe(buildOrchestraConductorRules({ ...a }));
  });
});
