/**
 * §5.3 #10-4 — 오케스트라 지휘 규칙. 지휘 턴 한 번에 `appendSystemPrompt` 로 붙는 글이다.
 *
 * 사용자 지시는 "내가 입력하면 자동이 아닌 에이전트가 스스로 알맞는거 선택해서 하게"였다. 그래서 이 글은
 * 방안을 **적용하라**고 하지 않고 **고르라**고 한다 — 의도·편성·방안·멤버를 요청마다 지휘자가 정하고,
 * 고른 이유와 건너뛴 이유를 계획 신고(`POST /api/orchestra/runs/:runId/plan`)로 남긴다.
 * 분석 원문은 `orchestraAnalysisMarkdown` 그대로 싣는다(사용자가 꺼 둔 방안의 표 행만 빠진다).
 *
 * 토큰 값은 본문에 굽지 않는다 — 절차는 환경변수 `VIBISUAL_TOKEN` 을 읽는다(#10-2 빌더와 같은 규약).
 * 이 파일은 `node:fs`·시간을 모르고 플랫폼은 인자(`platform`)로만 받는다 — 서버가 값을 넣어 부르고,
 * 테스트는 세 OS 의 글을 그대로 읽는다.
 */
import {
  AGENT_CARD_ENV_BASE,
  AGENT_CARD_ENV_TOKEN,
  AUTO_AGENT_LAYOUT_RADIUS,
  ORCHESTRA_PLAN_NOTE_MAX,
  ORCHESTRA_PLAN_REASON_MAX,
  harnessIntentGateRowsMarkdown,
} from './constants.js';
import { ORCHESTRA_STRATEGIES, orchestraAnalysisMarkdown, type OrchestraKnob, type OrchestraStrategy } from './orchestraCatalog.js';
import { orchestraAllowedStrategies, resolveOrchestraMaxMembers, resolveOrchestraMemberEngine } from './orchestraScope.js';
import type { PlatformName } from './pathCase.js';
import { agentRuleShell, agentPowershellHead, AGENT_AUTH_POSIX, type AgentRuleShell } from './agentRuleShell.js';
import type { OrchestraSettings } from './types.js';

/** 지휘자가 절차(①~⑤)를 돌리는 셸의 문법. */
export type OrchestraConductorShell = AgentRuleShell;

/**
 * 지휘자가 절차를 돌릴 셸 — 플랫폼 분기라 `platform` 을 인자로 받는다(세 OS 를 한 PC 에서 테스트하려고).
 * - Claude 지휘자는 셸 도구가 `Bash` 하나이고 Windows 에서도 Git Bash 로 돈다 → 세 OS 모두 POSIX.
 * - Codex 는 Windows 에서 셸 명령을 `powershell.exe`(Windows PowerShell 5.1)로 돌린다(2026-09-19 `codex sandbox`
 *   실측 `5.1 Desktop`). 거기서는 `curl` 이 `Invoke-WebRequest` 의 별칭이고 heredoc·`${VAR:-기본}` 이 없어
 *   bash 절차가 첫 줄부터 깨진다. mac·linux 의 Codex 는 POSIX 셸이다.
 */
export function orchestraConductorShell(engine: 'claude' | 'codex', platform: PlatformName): OrchestraConductorShell {
  return agentRuleShell(engine, platform);
}

/** 규칙에 싣는 기존 멤버 — **이전 런이 만든 멤버** 중 아직 프로젝트에 있는 것. 지휘자 자신은 부르는 쪽이 뺀다. */
export interface OrchestraMemberRef {
  id: string;
  label: string;
  /** 세션 경로(킥오프 대상). */
  path: string;
  engine: 'claude' | 'codex' | 'local';
  model?: string;
}

/** 규칙에 싣는 기존 엣지 — 위 멤버끼리 이미 이어져 있는 것(다시 만들지 않게). */
export interface OrchestraEdgeRef {
  id: string;
  sourceAgentId: string;
  targetAgentId: string;
  kind?: string;
  command: string;
}

export interface OrchestraConductorRulesArgs {
  /** hook loopback 베이스(`http://127.0.0.1:<port>`). 환경변수 `VIBISUAL_BASE` 가 없을 때의 폴백으로만 쓰인다. */
  serverBase: string;
  projectName: string | null;
  runId: string;
  /** 배치 중심 = 지휘자 버블 위치. */
  centerX: number;
  centerY: number;
  settings: OrchestraSettings | null | undefined;
  existingMembers: readonly OrchestraMemberRef[];
  existingEdges: readonly OrchestraEdgeRef[];
  /** 지휘자 엔진 — 그 에이전트를 따른다(§5.3 #10-4 "지휘자 엔진은 그 에이전트를 따른다"). */
  conductorEngine: 'claude' | 'codex';
  /** 서버가 도는 플랫폼 — 엔진과 함께 절차의 셸 문법을 정한다(`orchestraConductorShell`). */
  platform: PlatformName;
}

/** 엣지 명령 요약 길이 — 규칙이 엣지 목록 때문에 부풀지 않게. */
const EDGE_COMMAND_PREVIEW_MAX = 80;

/**
 * 방안이 가리키는 손잡이의 뜻(Claude 멤버 기준). 규칙에는 **허용된 방안이 실제로 쓰는 칸만** 싣는다.
 * 값의 범위는 `AgentConfig` 문서 주석과 같다 — 거기가 바뀌면 여기도 바꾼다.
 */
const KNOB_GUIDE: Record<OrchestraKnob, string> = {
  model: '`model` — `opus`·`sonnet`·`haiku`. Codex 멤버는 이 칸이 아니라 만들 때의 `provider.modelId` 로 정한다.',
  effort: '`effort` — `low`·`medium`·`high`·`xhigh`·`max`. 되돌리기 비싼 판단을 하는 멤버만 높인다.',
  maxTurns: '`maxTurns` — 에이전트 루프 횟수 상한(정수).',
  subagentDepth: '`subagentDepth` — 이 멤버 아래로 스폰할 수 있는 층 수. `1` = 중첩 없음.',
  rules: '`rules` — 멤버 지시문(마크다운, 줄바꿈은 `\\n`). 방안의 "멤버 지시문 조항"을 여기에 넣는다.',
  maxThinkingTokens: '`maxThinkingTokens` — 확장 사고 토큰 상한(정수).',
  maxOutputTokens: '`maxOutputTokens` — 한 턴 출력 토큰 상한(정수).',
  autoCompact: '`autoCompact` — 자동 압축 창. `"auto"` 또는 토큰 수 문자열(`"100000"`~`"1000000"`).',
  autoCompactPct: '`autoCompactPct` — 압축이 발동하는 창 점유율(1~100). CLI 기본보다 낮추는 쪽만 먹는다.',
  settingSources: '`settingSources` — 읽을 설정 계층. `"user"`·`"project"`·`"local"` 의 부분집합.',
  bashMaxOutputChars: '`bashMaxOutputChars` — Bash 출력이 문맥에 들어올 때의 글자 수 상한(CLI 기본 30,000).',
  mcpServers: '`mcpServers` — 붙일 MCP 서버 프리셋 id 목록. 이 일에 필요 없는 것을 뺀다(더하지 않는다).',
  skills: '`skills` — 스킬 이름 목록. 이 일에 필요 없는 것을 뺀다(더하지 않는다).',
  excludeDynamicSystemPromptSections: '`excludeDynamicSystemPromptSections` — `true` 면 기기마다 다른 절을 첫 메시지로 옮겨 캐시 적중을 올린다.',
  edgeReturnFormat: '엣지 `returnFormat` — `"summary"`(기본)·`"full"`·`"both"`. 설정 칸이 아니라 ③ 엣지를 만들 때 정한다.',
};

/** 표 칸 안의 `|` 는 칸 경계로 읽힌다 — 원문 조항에 파이프 명령이 들어 있다. */
function cell(text: string): string {
  const t = text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
  return t === '' ? '—' : t;
}

function oneLine(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 설정 칸이 비었으면 "정하지 않음"이다(지휘자가 고른다). */
function setValue(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function strategyTableRow(s: OrchestraStrategy): string {
  const knobs = s.apply.knobs.map((k) => `\`${k}\``).join(' ');
  return `| \`${s.id}\` | ${s.no} | ${cell(knobs)} | ${cell(s.apply.memberRule)} | ${cell(s.apply.topology)} |`;
}

/** 멤버 엔진 절 — 설정에 따라 한 가지(또는 auto 면 둘 다)만 싣는다. */
function memberEngineSection(settings: OrchestraSettings | null | undefined): string[] {
  const engine = resolveOrchestraMemberEngine(settings);
  const claudeModel = setValue(settings?.memberClaudeModel);
  const claudeEffort = setValue(settings?.memberClaudeEffort);
  const codexModel = setValue(settings?.memberCodexModel);
  const codexReasoning = setValue(settings?.memberCodexReasoning);

  const claude: string[] = [
    '- **Claude 멤버** — ① 본문에 `provider` 를 넣지 않는다.',
    claudeModel
      ? `  - 모델은 \`${claudeModel}\` 로 둔다(사용자 설정). ② PATCH 의 \`model\` 도 이 값이다.`
      : '  - 모델은 역할마다 고른다 — `opus` = 설계·원인 분석·리뷰처럼 되돌리기 비싼 판단 · `sonnet` = 구현·테스트 기본 · `haiku` = 단순·반복·조사.',
    claudeEffort
      ? `  - effort 는 \`${claudeEffort}\` 로 둔다(사용자 설정).`
      : '  - effort 는 역할마다 고른다 — 실행 역할은 `medium`~`high`, 되돌리기 비싼 판단만 더 높인다.',
  ];

  const codexProvider = `{"kind":"codex-cli","modelId":"${codexModel ?? ''}"${codexReasoning ? `,"reasoningEffort":"${codexReasoning}"` : ''}}`;
  const codex: string[] = [
    `- **Codex 멤버** — ① 본문에 \`"provider":${codexProvider}\` 를 넣는다. provider 는 **만들 때만** 정할 수 있다(나중의 설정 저장으로는 바뀌지 않는다).`,
    codexModel
      ? `  - 모델은 \`${codexModel}\` 로 둔다(사용자 설정).`
      : '  - `modelId` 를 비워 두면 그 PC 의 Codex 기본 모델이다.',
    codexReasoning
      ? `  - 추론 강도는 \`${codexReasoning}\` 로 둔다(사용자 설정).`
      : '  - `reasoningEffort` 는 빼면 Codex 기본값이다. 깊은 판단이 필요한 역할에만 `"reasoningEffort":"high"` 를 더한다.',
    '  - Codex 멤버에 먹는 설정 칸은 `rules` 뿐이다(엣지 `returnFormat` 은 엣지 쪽). effort·maxTurns·토큰 상한·압축·설정 계층·MCP·스킬 칸은 Claude CLI 의 플래그·환경변수라 Codex 에는 효과가 없다 — Codex 멤버에 대고 그런 방안을 골랐다고 신고하지 않는다.',
  ];

  if (engine === 'claude') return ['멤버는 **Claude** 로 만든다(사용자 설정).', ...claude];
  if (engine === 'codex') return ['멤버는 **Codex** 로 만든다(사용자 설정).', ...codex];
  return [
    '멤버 엔진은 **역할마다 당신이 고른다**(사용자 설정 `auto`). 고른 이유를 ⑤ 계획 신고의 `note` 에 한 줄로 적는다.',
    ...claude,
    ...codex,
  ];
}

/** ② 설정 PATCH 예시 — 셸이 달라도 같은 JSON 이다. */
const CONFIG_PATCH_SAMPLE =
  '{"model":"sonnet","effort":"medium","maxTurns":30,"subagentDepth":1,"rules":"# 역할: Researcher\\n답할 질문: <한 줄>\\n보고: 결론 먼저, 경로+줄번호, 1,000~2,000 토큰"}';
/** ③ 엣지 본문 예시. */
const EDGE_BODY_SAMPLE =
  '{"sourceAgentId":"<SOURCE_ID>","targetAgentId":"<TARGET_ID>","command":"<이 엣지로 넘길 일의 용도>","forwardMode":"manual","kind":"command","returnFormat":"summary"}';
/** ④ 킥오프 본문 자리. */
const KICKOFF_TEXT_SAMPLE = ['<사용자 원문 요청 전문 — escape 불필요, 여러 줄 OK>', '---', '<(필요하면) 당신의 분담 지시>'];
/** ⑤ 계획 신고 예시. */
const PLAN_BODY_SAMPLE =
  '{"intent":"research","topology":"single","chosen":[{"id":"subagents","reason":"<한 줄>"}],"skipped":[{"id":"autoCompact","reason":"<한 줄>"}],"reusedAgentIds":[],"entryAgentId":"<ENTRY_ID>","note":"<사용자에게 남길 말>"}';

/** 절차 조각이 받는 값 — 셸이 달라도 같다. */
interface ProcedureValues {
  serverBase: string;
  runId: string;
  /** ① 멤버 만들기 본문(한 줄 JSON). */
  createBody: string;
}

/** 셸마다 다른 부분 — ①~⑤ 의 코드 조각과 그 셸로 적은 안내·금지 줄. 조각 뒤의 설명 줄은 셸과 무관해 한 벌이다. */
interface ProcedureText {
  lang: 'bash' | 'powershell';
  heading: string;
  intro: string[];
  create: string[];
  config: string[];
  edge: string[];
  kickoff: string[];
  plan: string[];
  noWrite: string;
  oneBase: string;
}

/** Bash + curl — Claude 지휘자(세 OS, Windows 는 Git Bash)와 mac·linux 의 Codex 지휘자. */
function posixProcedure(v: ProcedureValues): ProcedureText {
  const base = `\${${AGENT_CARD_ENV_BASE}:-${v.serverBase}}`;
  const auth = `-H "x-vibisual-hook-token: ${AGENT_AUTH_POSIX}"`;
  const postJson = (route: string, body: string): string[] => [
    `RESP=$(curl -s -X POST "${base}${route}" \\`,
    `  ${auth} \\`,
    "  -H 'Content-Type: application/json' --data-binary @- <<'JSON'",
    body,
    'JSON',
    ')',
  ];
  // 응답을 한 줄로 보여 준다. 기대한 칸이 없으면(4xx 등) 응답 원문을 그대로 내보낸다 — 이유(`error`)가 보이게.
  const show = (expr: string) =>
    `printf '%s' "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);process.stdout.write((${expr})+'\\n')})"`;
  return {
    lang: 'bash',
    heading: '## 2. 절차 (Bash 로 curl)',
    intro: [
      `서버 베이스는 \`${base}\`, 인증 헤더는 \`${auth}\` 다(없으면 401). 값은 환경변수에 이미 있으니 아래 예시를 그대로 쓰고, **토큰 값을 본문에 옮겨 적지 않는다**(대화 기록에 남는다). JSON 본문은 heredoc 으로 보내고 응답은 node 로 읽는다.`,
      '- 셸 변수는 호출 사이에 남지 않는다 — 앞 단계가 출력한 id·path 는 다음 호출에 **값으로** 적어 넣는다.',
    ],
    create: [
      ...postJson('/api/create-custom-agent', v.createBody),
      show(`o.agent?'AGENT_ID='+o.agent.id+' AGENT_PATH='+o.agent.path:s`),
    ],
    config: [
      "AGENT_ID='<① 에서 받은 AGENT_ID>'",
      `CFG=$(curl -s "${base}/api/agent-config/$AGENT_ID" ${auth})`,
      `{ printf '%s\\n' "$CFG"; cat <<'JSON'`,
      CONFIG_PATCH_SAMPLE,
      'JSON',
      "} | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const i=s.indexOf('\\n');const o=JSON.parse(s.slice(0,i));const p=JSON.parse(s.slice(i+1));process.stdout.write(JSON.stringify({...(o.config||{}),...p}))})\" \\",
      `  | curl -s -X PUT "${base}/api/agent-config/$AGENT_ID" ${auth} -H 'Content-Type: application/json' --data-binary @-`,
    ],
    edge: [...postJson('/api/task-edges', EDGE_BODY_SAMPLE), show(`o.data?'EDGE_ID='+o.data.id:s`)],
    kickoff: [
      `curl -s -X POST "${base}/api/commands/<ENTRY_AGENT_PATH>?orchestraRunId=${v.runId}" \\`,
      `  ${auth} \\`,
      "  -H 'Content-Type: text/plain; charset=utf-8' --data-binary @- <<'EOF'",
      ...KICKOFF_TEXT_SAMPLE,
      'EOF',
    ],
    plan: [
      `curl -s -X POST "${base}/api/orchestra/runs/${v.runId}/plan" \\`,
      `  ${auth} \\`,
      "  -H 'Content-Type: application/json' --data-binary @- <<'JSON'",
      PLAN_BODY_SAMPLE,
      'JSON',
    ],
    noWrite: '- 파일 쓰기·수정 ❌(Write·Edit·NotebookEdit, Bash 로 쓰는 것 포함).',
    oneBase: '- 모든 curl 의 베이스는 위 서버 베이스 하나다(이 주소만 앱 안 서버에 닿는다).',
  };
}

/**
 * Windows PowerShell 5.1 + `Invoke-RestMethod` — Windows 의 Codex 지휘자.
 * 5.1 에서 지킬 것(2026-09-20 이 PC 의 `powershell.exe` 5.1.26100 으로 ①~⑤ 조각을 임시 서버에 그대로 돌려 확인):
 *  · 본문은 UTF-8 **바이트**로 보낸다 — 문자열 `-Body` 는 한글이 `??` 로 바뀌어 도착했다.
 *  · 4xx 는 `ErrorDetails.Message` 가 비어 있어 기본 오류 줄에 응답 본문이 없다 — `Send` 가 응답 스트림을 읽어
 *    `HTTP <코드> <본문>` 으로 다시 던진다(PowerShell 7 은 `ErrorDetails` 가 차 있어 그쪽을 먼저 쓴다).
 *  · 토큰은 `"$env:…"` 로 감싼다 — 변수가 없을 때 `$null` 헤더는 NullReference 로 죽고, 빈 문자열이면 401 로 이유가 보인다.
 *  · 출력은 OEM 코드 페이지로 나가 한글이 깨진다 — `[Console]::OutputEncoding` 을 UTF-8 로 둔다.
 *  · 합치기는 `[ordered]` 사전으로 하고 `ConvertTo-Json -Depth` 를 준다(기본 깊이 2 는 중첩을 문자열로 뭉갠다). 빈·한 개 배열도 배열로 남았다.
 *  · 조각마다 머리 네 줄을 다시 적는다 — Codex 는 명령마다 새 셸이다.
 */
function powershellProcedure(v: ProcedureValues): ProcedureText {
  const head = agentPowershellHead(v.serverBase);
  const send = (method: 'Post' | 'Put', uri: string, contentType: string, bodyVar: string) =>
    `Send ${method} "${uri}" '${contentType}' ${bodyVar}`;
  const json = 'application/json';
  return {
    lang: 'powershell',
    heading: '## 2. 절차 (PowerShell 로 Invoke-RestMethod)',
    intro: [
      '이 셸은 **Windows PowerShell** 이다 — bash 문법(heredoc·`${VAR:-기본}`)과 `curl` 플래그는 먹지 않는다(`curl` 은 `Invoke-WebRequest` 의 별칭이다). 아래 조각을 그대로 쓴다.',
      `- 서버 베이스는 \`$B\`(환경변수 \`${AGENT_CARD_ENV_BASE}\`, 없으면 \`${v.serverBase}\`), 인증 헤더는 \`$H\`(값은 \`$env:${AGENT_CARD_ENV_TOKEN}\`) 다(없으면 401). **토큰 값을 본문에 옮겨 적지 않는다**(대화 기록에 남는다).`,
      '- 셸 변수·함수는 호출 사이에 남지 않는다 — 그래서 조각마다 머리 네 줄을 다시 적고, 앞 단계가 출력한 id·path 는 다음 호출에 **값으로** 적어 넣는다.',
      "- 본문은 작은따옴표 here-string(`@'` … `'@`)에 넣는다. 안쪽은 이스케이프가 필요 없고, 닫는 `'@` 는 **줄 맨 앞**에 있어야 한다.",
      '- 호출은 머리의 `Send` 로만 한다 — 본문을 UTF-8 바이트로 보낸다(문자열 `-Body` 는 한글이 `??` 로 바뀐다).',
      '- 4xx 면 예외로 멈추고, 오류 줄에 `HTTP <코드> <응답 본문>`(`error`·`ids`)이 찍힌다.',
    ],
    create: [
      ...head,
      "$Body = @'",
      v.createBody,
      "'@",
      `$R = ${send('Post', '$B/api/create-custom-agent', json, '$Body')}`,
      '"AGENT_ID=$($R.agent.id) AGENT_PATH=$($R.agent.path)"',
    ],
    config: [
      ...head,
      "$AgentId = '<① 에서 받은 AGENT_ID>'",
      '$Cfg = (Send Get "$B/api/agent-config/$AgentId").config',
      "$Patch = @'",
      CONFIG_PATCH_SAMPLE,
      "'@ | ConvertFrom-Json",
      '$M = [ordered]@{}',
      'if ($Cfg) { foreach ($p in $Cfg.PSObject.Properties) { $M[$p.Name] = $p.Value } }',
      'foreach ($p in $Patch.PSObject.Properties) { $M[$p.Name] = $p.Value }',
      '$Json = ConvertTo-Json -InputObject $M -Depth 32 -Compress',
      send('Put', '$B/api/agent-config/$AgentId', json, '$Json'),
    ],
    edge: [
      ...head,
      "$Body = @'",
      EDGE_BODY_SAMPLE,
      "'@",
      `$R = ${send('Post', '$B/api/task-edges', json, '$Body')}`,
      '"EDGE_ID=$($R.data.id)"',
    ],
    kickoff: [
      ...head,
      "$Text = @'",
      ...KICKOFF_TEXT_SAMPLE,
      "'@",
      send('Post', `$B/api/commands/<ENTRY_AGENT_PATH>?orchestraRunId=${v.runId}`, 'text/plain', '$Text'),
    ],
    plan: [
      ...head,
      "$Body = @'",
      PLAN_BODY_SAMPLE,
      "'@",
      send('Post', `$B/api/orchestra/runs/${v.runId}/plan`, json, '$Body'),
    ],
    noWrite: '- 파일 쓰기·수정 ❌(셸로 쓰는 것 포함 — `Set-Content`·`Out-File`·`>` 도 쓰기다).',
    oneBase: '- 모든 호출의 베이스는 위 `$B` 하나다(이 주소만 앱 안 서버에 닿는다).',
  };
}

/**
 * 지휘 턴에 붙는 규칙 전문. 서버 `processNextCommand` 가 오케스트라 명령일 때만 부른다.
 * 같은 입력이면 같은 글이다(시간·난수를 읽지 않는다).
 */
export function buildOrchestraConductorRules(args: OrchestraConductorRulesArgs): string {
  const { serverBase, projectName, runId, centerX, centerY, settings, existingMembers, existingEdges, conductorEngine, platform } = args;
  const projectField = projectName ? JSON.stringify(projectName) : 'null';
  const radius = AUTO_AGENT_LAYOUT_RADIUS;
  const cx = Math.round(centerX);
  const cy = Math.round(centerY);
  const maxMembers = resolveOrchestraMaxMembers(settings);
  const allowed = orchestraAllowedStrategies(settings);
  const disabled = new Set(settings?.disabledStrategies ?? []);
  const referenceOnly = ORCHESTRA_STRATEGIES.filter((s) => !s.apply.selectable);
  const userDisabled = ORCHESTRA_STRATEGIES.filter((s) => s.apply.selectable && disabled.has(s.id));
  const knobsInUse = [...new Set(allowed.flatMap((s) => s.apply.knobs))];
  const values: ProcedureValues = {
    serverBase,
    runId,
    createBody: `{"label":"Researcher","x":${Math.round(cx + radius)},"y":${cy},"project":${projectField},"orchestraRunId":"${runId}"}`,
  };
  const proc = orchestraConductorShell(conductorEngine, platform) === 'powershell'
    ? powershellProcedure(values)
    : posixProcedure(values);
  const code = (lines: string[]) => ['```' + proc.lang, ...lines, '```'];

  const labelOf = new Map(existingMembers.map((m) => [m.id, m.label]));

  const out: string[] = [
    `# 오케스트라 지휘 — 이번 요청 한 건 (런 \`${runId}\`)`,
    '',
    '이 턴에 한해 당신은 **지휘자**다. 사용자가 방금 보낸 요청을 **어떻게 처리할지 스스로 고르는 것**이 이번 턴의 일이다.',
    '- **직접 파일을 고치지 않는다.** 코드를 바꾸는 일은 멤버가 한다.'
      + (conductorEngine === 'codex' ? ' (Codex 엔진에서는 쓰기가 도구로 막혀 있지 않다 — 이 줄이 유일한 선이다.)' : ''),
    '- 아래 절감 방안을 **전부 적용하지 않는다.** 이 요청에 맞는 것만 고르고, 고른 이유와 건너뛴 이유를 계획 신고에 적는다. 하나도 고르지 않는 것도 올바른 답일 수 있다.',
    '- 편성하지 않는 것(`none`)도 올바른 선택이다. 작은 질문에 머릿수를 늘리는 것 자체가 아래 분석 1번이 말하는 낭비다 — 멤버마다 고정 비용이 붙는다.',
    '- 계획 신고(⑤)는 **어떤 편성이든 꼭 한 번** 한다. 신고 없이 끝난 턴은 사용자 화면에 "신고 없음"으로 남는다.',
    '',
    '## 1. 먼저 고른다 (순서대로)',
    '1. **의도(intent)** — 아래 표에서 하나. 범위를 잡는 데 필요하면 Read·Grep·Glob 을 짧게 쓴다(깊은 조사는 멤버의 일이다).',
    '2. **편성(topology)** — 하나.',
    '   - `none` — 멤버 없이 당신이 직접 답한다. ⑤ 계획 신고만 하고 답한다.',
    '   - `single` — 멤버 하나에게 넘긴다.',
    '   - `pipeline` — 앞 결과가 다음 입력인 차례 작업. 멤버를 엣지로 잇고 첫 멤버에게 킥오프한다.',
    '   - `parallel` — 서로 **독립된** 일을 나눠 동시에 돌리고 허브 멤버 하나가 모은다. 허브에서 각 워커로 엣지를 깔고 허브에게 킥오프한다. 독립이 아니면 고르지 않는다.',
    `3. **방안(chosen·skipped)** — 아래 "고를 수 있는 방안"에서 이 요청에 맞는 것만, 각각 한 줄 이유(≤${ORCHESTRA_PLAN_REASON_MAX}자)와 함께. 관련이 있어 보였지만 고르지 않은 것은 \`skipped\` 에 이유와 함께 적는다(전부 적을 필요는 없다).`,
    `4. **멤버** — 아래 "기존 멤버"를 먼저 다시 쓴다. 새로 만드는 것은 이 런에서 최대 **${maxMembers}개**다.`,
    '',
    '### 의도 표 (#10-2 하네스 빌더와 같은 표 + question)',
    '| 의도 | 신호 | 출발 형태 |',
    '|---|---|---|',
    '| question | 설명·확인·짧은 질의, 파일 변경 없음 | none (직접 답) |',
    harnessIntentGateRowsMarkdown(),
    '형태는 출발점일 뿐이다 — 요청 규모에 비례하게 줄이거나 늘린다.',
    '',
    proc.heading,
    ...proc.intro,
    '',
    '### ① 멤버 만들기 — 새 멤버가 필요할 때만',
    ...code(proc.create),
    '- 출력 한 줄 `AGENT_ID=… AGENT_PATH=…` — `id` 는 설정·엣지용, `path` 는 킥오프용. 실패면 응답의 `error` 가 보인다.',
    `- \`"orchestraRunId":"${runId}"\` 를 **반드시** 넣는다. 그래야 이 런의 멤버로 기록되고, 그 멤버는 스스로 지휘하지 않는다.`,
    '- 429 `orchestra-member-limit` 이면 더 만들지 말고 기존 멤버를 다시 쓰거나 편성을 줄인다. 429 `custom-agent-limit` 은 프로젝트 전체 상한이다.',
    '',
    '### ② 멤버 설정 — 지금 값을 읽어 합친 뒤 통째로 저장',
    ...code(proc.config),
    '- 일부 칸만 보내면 보내지 않은 칸이 지워진다. 위처럼 **읽고 → 합치고 → 통째로** 보낸다.',
    '- 권한 축(`permissionMode`·`tools`·`disallowedTools`·`askTools`)은 PATCH 에 넣지 않는다 — 사용자만 바꾸는 칸이라 이 통로의 저장에서는 무시된다. 그 강도가 일에 안 맞으면 `note` 로 사용자에게 말한다.',
    '- PATCH 에는 **고른 방안이 가리키는 칸만** 넣는다. 고르지 않은 방안의 칸을 만지지 않는다.',
    '',
    '### ③ 엣지 — `pipeline`·`parallel` 일 때',
    ...code(proc.edge),
    '- 엣지는 source 멤버의 **위임 도구**가 된다 — source 멤버가 스스로 판단해 target 에게 일을 넘기고 결과를 받는다. 킥오프를 받은 멤버부터 차례로 흐른다.',
    '- 필수: `sourceAgentId`·`targetAgentId`·`command`·`forwardMode`(명령 엣지는 `"manual"`, 검증 엣지는 `"auto"`). 선택: `kind`(`command`|`artifact`|`request`|`critique`)·`returnFormat`(`summary`|`full`|`both`)·`critiqueAuthority`(`force-rework`|`comment-only`, `critique` 한정).',
    '- **코드를 바꾸는 편성**이면 검증 엣지를 최소 하나 깐다 — reviewer/tester → coder, `"kind":"critique","critiqueAuthority":"force-rework","forwardMode":"auto"`. 서버가 재작업 짝 엣지를 만들고, 재작업 횟수는 엣지마다 상한이 있다.',
    '- **지휘자 자신을 엣지의 source·target 으로 쓰지 않는다.** 엣지는 멤버끼리만 잇는다 — 지휘자에게 엣지가 붙으면 오케스트라를 끈 뒤의 평범한 턴에도 위임 안내가 따라붙는다.',
    '- 아래 "이미 있는 엣지"에 있는 것은 다시 만들지 않는다.',
    '',
    '### ④ 킥오프 — 엔트리 멤버(pipeline 의 첫 멤버·parallel 의 허브)에게 넘기기',
    ...code(proc.kickoff),
    `- \`?orchestraRunId=${runId}\` 를 **반드시** 붙인다 — 이 런의 토큰으로 묶이고, 덧말 합치기에 섞이지 않는다.`,
    '- `<ENTRY_AGENT_PATH>` = ① 이 출력한 `AGENT_PATH`(다시 쓰는 멤버면 아래 목록의 path).',
    '',
    '### ⑤ 계획 신고 — 어떤 편성이든 꼭 한 번',
    ...code(proc.plan),
    '- `intent`·`topology` 필수. `chosen`·`skipped` 는 `[{"id":"<방안 id>","reason":"<한 줄>"}]`.',
    `- \`reusedAgentIds\` = 이번에 다시 쓴 기존 멤버 id(새로 만든 멤버는 서버가 이미 안다). \`entryAgentId\` = 킥오프를 받은 멤버 id. \`note\`(≤${ORCHESTRA_PLAN_NOTE_MAX}자) = 사용자에게 남길 말 — 엔진을 고른 이유, 참고 전용 방안 권고, 권한이 일에 안 맞는다는 알림 등.`,
    '- 400 이면 응답의 `error`·`ids` 를 보고 고쳐 다시 보낸다(예: `strategy-not-allowed` = 그 id 는 지금 고를 수 없다). 409 는 이미 신고했다는 뜻이니 다시 보내지 않는다.',
    '- 순서: 편성이 있으면 ①~④ 를 마친 뒤에, `none` 이면 답하기 전에 신고한다.',
    '',
    '## 3. 마무리',
    '- 편성했으면: 고른 의도·편성·방안·멤버를 2~5줄로 사용자에게 알리고 턴을 끝낸다. 실제 작업은 멤버가 이어 간다(결과를 기다리지 않는다).',
    '- `none` 이면: 신고한 뒤 요청에 직접 답한다.',
    '',
    '## 멤버 엔진',
    ...memberEngineSection(settings),
    '',
    `## 고를 수 있는 방안 (${allowed.length}개)`,
  ];

  if (allowed.length === 0) {
    out.push('사용자가 방안을 모두 꺼 두었다 — `chosen` 은 비워 신고한다.');
  } else {
    out.push(
      '방안 id 의 # 는 아래 분석 원문 표의 # 와 같다. 원문의 몫·절감 수치는 한 세션의 실측과 그 추정이다 — 사용자에게 절감을 약속하지 않는다.',
      '',
      '| id | # | 만질 칸 | 멤버 지시문(rules)에 넣을 조항 | 편성 원칙 |',
      '|---|---|---|---|---|',
      ...allowed.map(strategyTableRow),
      '',
      '### 칸 설명 (Claude 멤버 기준)',
      ...knobsInUse.map((k) => `- ${KNOB_GUIDE[k]}`),
    );
  }

  if (referenceOnly.length > 0) {
    out.push(
      '',
      '### 참고 전용 — 고를 수 없다(`chosen` 에 담으면 400). 필요하면 `note` 로 사용자에게 권한다',
      ...referenceOnly.map((s) => `- \`${s.id}\`(${s.no}) — ${s.element.replace(/<br>/g, ' ')}`),
    );
  }
  if (userDisabled.length > 0) {
    out.push(
      '',
      '### 사용자가 꺼 둔 방안 — 고를 수 없다(`chosen` 에 담으면 400)',
      userDisabled.map((s) => `\`${s.id}\`(${s.no})`).join(' · '),
    );
  }

  out.push('', '## 기존 멤버 (이전 런이 만든 것 — 다시 쓰기 우선)');
  if (existingMembers.length === 0) {
    out.push('없음 — 필요하면 ① 로 새로 만든다.');
  } else {
    out.push(
      '| label | id | path | engine | model |',
      '|---|---|---|---|---|',
      ...existingMembers.map((m) => `| ${cell(m.label)} | \`${m.id}\` | \`${m.path}\` | ${m.engine} | ${cell(m.model ?? '')} |`),
    );
  }

  if (existingEdges.length > 0) {
    out.push(
      '',
      '### 이미 있는 엣지',
      '| id | source → target | kind | 용도 |',
      '|---|---|---|---|',
      ...existingEdges.map((e) => {
        const src = labelOf.get(e.sourceAgentId) ?? e.sourceAgentId;
        const dst = labelOf.get(e.targetAgentId) ?? e.targetAgentId;
        return `| \`${e.id}\` | ${cell(src)} → ${cell(dst)} | ${e.kind ?? 'command'} | ${cell(oneLine(e.command, EDGE_COMMAND_PREVIEW_MAX))} |`;
      }),
    );
  }

  out.push(
    '',
    '## 배치 좌표',
    `- 중심(당신의 버블) = (${cx}, ${cy}). 새 멤버는 이 점 주위 반지름 ${radius}px 안에 겹치지 않게 놓는다 — N개면 360/N 도 간격으로 \`x = ${cx} + ${radius}*cos(θ)\`, \`y = ${cy} - ${radius}*sin(θ)\`.`,
    '',
    '## 금지',
    proc.noWrite,
    '- 이 턴에서 오케스트라 설정(`/api/orchestra/scope`·`/api/orchestra/settings`)을 바꾸지 않는다 — 사용자의 스위치다.',
    '- `orchestraRunId` 없이 멤버를 만들거나 킥오프하지 않는다.',
    proc.oneBase,
    '',
    '## 지난 분석 원문 (2026-09-16 토큰 감사 — 고치지 않은 원문)',
    `방안 id ↔ 표의 #: ${ORCHESTRA_STRATEGIES.map((s) => `${s.id}=${s.no}`).join(' · ')}`,
    '',
    orchestraAnalysisMarkdown({ exclude: [...disabled] }),
  );

  return out.join('\n');
}
