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
  TASK_EDGE_TEMPLATES,
  harnessIntentGateRowsMarkdown,
} from './constants.js';
import { ORCHESTRA_STRATEGIES, orchestraAnalysisMarkdown, type OrchestraKnob, type OrchestraStrategy } from './orchestraCatalog.js';
import { findAgentToolTemplate } from './agentToolTemplates.js';
import {
  orchestraAllowedStrategies,
  resolveOrchestraMaxMembers,
  resolveOrchestraMemberEngine,
  resolveOrchestraMemberIsolation,
  resolveOrchestraMemberToolTemplate,
} from './orchestraScope.js';
import type { PlatformName } from './pathCase.js';
import { agentRuleShell, agentPowershellHead, AGENT_AUTH_POSIX, type AgentRuleShell } from './agentRuleShell.js';
import type { OrchestraSettings } from './types.js';

/** 지휘자가 절차(①~⑥)를 돌리는 셸의 문법. */
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

/**
 * 규칙에 싣는 **재사용 후보** — 이 프로젝트에 있는 손수 만든 버블 중 엔진·준비 관문을 통과한 것.
 * 지휘자 자신은 부르는 쪽이 뺀다.
 */
export interface OrchestraMemberRef {
  id: string;
  label: string;
  /** 세션 경로(킥오프 대상). */
  path: string;
  engine: 'claude' | 'codex' | 'local';
  model?: string;
  /**
   * 이 지휘자가 **이전 런에서 직접 만든** 멤버인가. 거짓이면 같은 프로젝트의 다른 후보다
   * (사용자가 손으로 만든 버블·다른 지휘자의 멤버).
   *
   * 둘 다 다시 쓸 수 있다 — ④ 계획 신고의 재사용 검사(`reused-agent-not-in-project`)는 **프로젝트
   * 소속**만 본다. 그래서 표에 내 이전 런의 것만 실으면 *서버가 받아 줄 후보*를 지휘자에게 감추는
   * 셈이 되고, 지휘자는 이미 있는 검수자 곁에 똑같은 것을 또 만든다. 순서만 내 것이 앞이다.
   */
  own?: boolean;
}

/** 규칙에 싣는 기존 엣지 — 지휘자·멤버 사이에 이미 이어져 있는 것(다시 만들지 않게). */
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
  /** 이번 요청을 끝까지 책임지는 지휘자와 실행 세션. */
  conductorAgentId: string;
  conductorSubAgentId: string;
  /** 배치 중심 = 지휘자 버블 위치. */
  centerX: number;
  centerY: number;
  settings: OrchestraSettings | null | undefined;
  existingMembers: readonly OrchestraMemberRef[];
  existingEdges: readonly OrchestraEdgeRef[];
  /** 지휘자 엔진 — 그 에이전트를 따른다(§5.3 #10-4 "지휘자 엔진은 그 에이전트를 따른다"). */
  conductorEngine: 'claude' | 'codex';
  /** Auto 선택은 설치·로그인이 확인된 엔진 안에서만 한다. */
  readyEngines?: readonly ('claude' | 'codex')[];
  /** 서버가 도는 플랫폼 — 엔진과 함께 절차의 셸 문법을 정한다(`orchestraConductorShell`). */
  platform: PlatformName;
}

/** 엣지 명령 요약 길이 — 규칙이 엣지 목록 때문에 부풀지 않게. */
const EDGE_COMMAND_PREVIEW_MAX = 80;

/**
 * "이미 있는 엣지" 표의 줄 수 상한. 재사용 후보가 프로젝트 전체로 넓어지면서 이 표도 같이 넓어졌다 —
 * 상한이 없으면 오래 쓴 프로젝트에서 규칙 길이가 그래프 크기를 따라 자란다. 넘친 것은 수만 알린다.
 */
const EDGE_TABLE_MAX = 30;
/** 한 번의 조회 대기 — 응답이 진행 중이면 같은 cmdId 로 이어 받는다. */
const RESULT_WAIT_MS = 60_000;

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
  // 딸려 오는 대가를 같이 적는다 — 이 칸을 넣으면 그 멤버는 세션 재사용을 잃는다(`--max-budget-usd`
  //   가 `--print` 전용이라 매 턴 새 스폰이다). 모르고 모든 멤버에 박으면 편성 전체가 느려지고,
  //   문맥이 턴을 넘어 이어지지 않아 오히려 토큰이 는다.
  maxBudgetUsd: '`maxBudgetUsd` — 그 멤버 한 세션의 API 비용 상한(달러, 양수). `0`/미설정 = 무제한. 넣으면 그 멤버는 매 턴 새로 스폰돼 **세션 재사용을 잃는다** — 되돌리기 힘든 폭주를 막을 멤버에만 둔다.',
  // 값 셋은 `TaskEdgeReturnFormat` 그대로다 — `createTaskEdge` 는 이 칸을 검사하지 않아, 없는 값을
  //   적어 주면 조용히 저장되고 회수 경로만 빠진다.
  edgeReturnFormat: '엣지 `returnFormat` — `"summary"`(기본)·`"artifact"`·`"both"`. 설정 칸이 아니라 ③ 엣지를 만들 때 정한다.',
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

/**
 * ① 멤버 색 — `create-custom-agent` 의 `color` 칸(`AgentConfig.color`, 자유 hex).
 *
 * **왜 규칙에 싣는가.** 편성이 커지면 사용자가 보는 것은 캔버스의 버블 무더기다. 색이 다 같으면
 * 어느 것이 검수자이고 어느 것이 구현자인지 이름표를 하나씩 읽어야 알 수 있다 — 지휘자는 역할을
 * 알고 만드는 유일한 자리이므로, 그 자리에서 칠해 두는 것이 가장 싸다.
 *
 * 값은 우리가 고른 것이다(고정 팔레트 상수가 없다). 서로 구별되는 색상환 간격으로 골랐고,
 * 시스템이 이미 쓰는 색은 피했다 — 초록 계열은 Codex(`CODEX_AGENT_COLOR`)·CMD(`CMD_AGENT_COLOR`),
 * 회청색은 로컬 엔진(`LOCAL_AGENT_COLOR`)의 자리다.
 */
function roleColorSection(): string[] {
  return [
    '- `color` 로 역할을 구별해 칠한다(자유 hex). 편성이 커지면 사용자가 캔버스에서 역할을 색으로 읽는다 — 다 같은 색이면 이름표를 하나씩 눌러 봐야 안다.',
    '- 권하는 값: 탐색 `#6366f1` · 설계 `#a855f7` · 구현 `#f59e0b` · 검증 `#ef4444` · 문서 `#0ea5e9` · 허브(엔트리) `#eab308`.',
    '- 같은 역할이 여럿이면 **같은 색**으로 둔다 — 색은 낱개가 아니라 역할을 가리킨다. 초록 계열은 쓰지 않는다(Codex·CMD 버블의 자리다).',
  ];
}

/**
 * ③ 엣지의 **역할 짝 프리셋** — 화면의 "Template" 선택기가 쓰는 표(`TASK_EDGE_TEMPLATES`) 그대로다.
 *
 * **왜 값까지 펼쳐 적는가.** 서버는 `templateId` 를 **기록만** 한다 — 프리셋의 기본값을 대신 채워
 * 주지 않는다(채우는 쪽은 화면의 폼이다). 그래서 지휘자가 `templateId` 만 보내면 그 엣지는 이름표만
 * 붙은 기본 엣지가 되고, 프리셋이 약속한 `forwardMode`·`returnFormat` 은 아무 데도 없다.
 *
 * `generic`(Custom)은 뺀다 — 역할 짝이 없어 고를 자리가 없을뿐더러, 그 프리셋의 `defaultCommandMode`
 * 는 `tool-delegation` 이라 대상 멤버의 도구를 위임 한 벌로 갈아 끼운다. 일하는 멤버의 손을 뺏는다.
 */
function edgePresetSection(): string[] {
  const rows = TASK_EDGE_TEMPLATES.filter((tmpl) => tmpl.sourceRole !== null && tmpl.targetRole !== null);
  return [
    '',
    '#### 역할 짝 프리셋 — 값을 그대로 옮겨 적는다',
    '| templateId | 쓰는 자리 | kind | forwardMode | messageFormat | returnFormat | priority |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((tmpl) => `| \`${tmpl.id}\` | ${cell(tmpl.label)} | ${tmpl.defaultKind ?? 'command'} | ${tmpl.defaultForwardMode} | ${tmpl.defaultMessageFormat ?? 'free'} | ${tmpl.defaultReturnFormat ?? 'summary'} | ${tmpl.defaultPriority ?? 'normal'} |`),
    '- `templateId` 는 **기록만** 된다 — 서버가 나머지 칸을 대신 채우지 않는다. 고른 줄의 값을 같은 본문에 **함께** 적는다.',
    '- 위임 결과를 지휘자가 직접 기다리는 엣지는 `returnFormat` 을 `"both"` 로 올린다. 표의 `artifact` 는 받는 쪽이 산출물만 가져가는 자리다.',
    '- 목록에 없는 짝이면 `templateId` 를 빼고 칸을 직접 정한다. `"generic"` 은 쓰지 않는다 — 대상 멤버의 도구를 위임 한 벌로 갈아 끼운다.',
  ];
}

/**
 * 멤버가 **태어날 때 이미 받아 둔 것** — 사용자 스위치라 지휘자가 바꿀 수 없다. 편성 판단에 쓰라고 싣는다.
 *
 * 싣지 않으면 지휘자는 워커 셋이 한 워킹트리를 동시에 고친다는 것도, 자기가 만든 멤버에게 `Write` 가
 * 없다는 것도 모른 채 편성한다 — 둘 다 조용히 실패하고 원인이 규칙 밖에 있어 스스로 못 고친다.
 */
function memberBirthSection(settings: OrchestraSettings | null | undefined): string[] {
  const isolation = resolveOrchestraMemberIsolation(settings);
  const templateId = resolveOrchestraMemberToolTemplate(settings);
  const template = templateId ? findAgentToolTemplate(templateId) : undefined;
  const out: string[] = [
    '새 멤버는 아래 상태로 **태어난다**(사용자 스위치다 — ② PATCH 로 바꾸려 해도 무시된다).',
  ];
  out.push(isolation === 'worktree'
    ? '- **작업 폴더: 별도 git worktree.** 멤버마다 자기 워크트리에서 돌아 서로의 파일을 덮지 않는다. `parallel` 로 코드를 나눠 고쳐도 안전하다. 대신 **멤버의 변경은 지휘자의 워킹트리에 바로 보이지 않는다** — 결과 보고에 바뀐 파일과 브랜치를 적게 하고, 합치는 일은 사용자 몫으로 남긴다(당신이 합치지 않는다). Codex 멤버에는 이 격리가 걸리지 않는다.'
    : '- **작업 폴더: 지휘자와 같은 워킹트리.** 멤버들이 같은 파일을 동시에 고치면 서로 덮어쓴다. 그래서 `parallel` 은 **파일이 겹치지 않을 때만** 고른다 — 겹치면 `pipeline` 으로 차례를 준다. (사용자가 오케스트라 설정에서 "멤버 작업 폴더"를 워크트리로 바꾸면 이 제약이 풀린다 — 필요하면 `note` 로 권한다.)');
  if (template) {
    out.push(
      `- **도구: \`${templateId}\` 템플릿** (${template.tools.length}개) — \`${template.tools.join('`, `')}\`.`,
      '  - 이 목록에 없는 도구는 그 멤버에게 **존재하지 않는다.** 목록에 `Write`·`Edit` 가 없으면 파일을 고치는 일을 그 멤버에게 넘기지 말고, `Bash`·`PowerShell` 이 없으면 명령을 돌리는 일을 넘기지 않는다. 역할과 도구가 안 맞으면 `note` 로 사용자에게 말한다.',
    );
  } else {
    out.push('- **도구: 설정 창 기본값 그대로**(공식 표 전체). 멤버가 그 일에 필요 없는 도구까지 들고 돈다 — 도구가 많을수록 선택 품질이 떨어지고 시스템 프롬프트가 무거워진다는 것이 아래 분석 8번이다. 좁히고 싶으면 `note` 로 오케스트라 설정의 "멤버 도구 목록"을 권한다(사용자만 바꿀 수 있다).');
  }
  return out;
}

/** 멤버 엔진 절 — 설정에 따라 한 가지(또는 auto 면 둘 다)만 싣는다. */
function memberEngineSection(settings: OrchestraSettings | null | undefined, conductorEngine: 'claude' | 'codex', readyEngines?: readonly ('claude' | 'codex')[]): string[] {
  const engine = resolveOrchestraMemberEngine(settings, conductorEngine);
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
    '멤버 엔진은 **아래 준비된 엔진 안에서 역할마다 당신이 고른다**(사용자 설정 `auto`). 고른 이유를 ④ 계획 신고의 `note` 에 한 줄로 적는다. 목록에 없는 엔진은 설치·로그인이 준비되지 않았으므로 만들거나 재사용하지 않는다.',
    ...(readyEngines === undefined || readyEngines.includes('claude') ? claude : []),
    ...(readyEngines === undefined || readyEngines.includes('codex') ? codex : []),
  ];
}

/** ② 설정 PATCH 예시 — 셸이 달라도 같은 JSON 이다. */
const CONFIG_PATCH_SAMPLE =
  '{"model":"sonnet","effort":"medium","maxTurns":30,"subagentDepth":1,"rules":"# 역할: Researcher\\n답할 질문: <한 줄>\\n보고: 결론 먼저, 경로+줄번호, 1,000~2,000 토큰"}';
/**
 * ③ 엣지 본문 예시 — 프리셋(`templateId`)과 그 값을 **함께** 적는 모양을 그대로 보인다.
 * 서버는 `templateId` 를 기록만 하고 나머지를 대신 채우지 않으므로, 예시가 id 만 들고 있으면
 * 지휘자가 이름표만 붙은 기본 엣지를 만든다.
 */
const EDGE_BODY_SAMPLE =
  '{"sourceAgentId":"<SOURCE_ID>","targetAgentId":"<TARGET_ID>","command":"<이 엣지로 넘길 일의 용도>","templateId":"implementer-to-verifier","forwardMode":"auto","kind":"command","messageFormat":"schema","messageSchema":"{\\"changedFiles\\":[\\"<경로>\\"],\\"testsRun\\":\\"<명령>\\",\\"failures\\":[{\\"file\\":\\"<경로>\\",\\"why\\":\\"<한 줄>\\"}]}","returnFormat":"both"}';
/** ⑤ 킥오프 본문 자리 — 엔트리도 하위 결과를 기다려야 지휘자에게 전체 결과가 돌아온다. */
const KICKOFF_TEXT_SAMPLE = [
  '<사용자 원문 요청 전문 — escape 불필요, 여러 줄 OK>',
  '---',
  '<(필요하면) 당신의 분담 지시>',
  '당신은 이번 편성의 엔트리입니다. 하위 위임의 cmdId를 보관하고 모든 작업·검증·재작업의 끝난 결과를 회수한 뒤 통합 보고하세요. 접수·queued·executing·pending·대기 시간 초과는 완료가 아닙니다. 같은 일을 다시 위임하지 말고 같은 cmdId로 조회를 이어가세요. 변경 내용, 검증 근거, 남은 실패·차단을 분리해 보고하세요.',
];
/** ④ 계획 신고 예시. */
const PLAN_BODY_SAMPLE =
  '{"intent":"research","topology":"single","chosen":[{"id":"subagents","reason":"<한 줄>"}],"skipped":[{"id":"autoCompact","reason":"<한 줄>"}],"reusedAgentIds":[],"entryAgentId":"<ENTRY_ID>","note":"<사용자에게 남길 말>"}';

/** 절차 조각이 받는 값 — 셸이 달라도 같다. */
interface ProcedureValues {
  serverBase: string;
  runId: string;
  conductorAgentId: string;
  conductorSubAgentId: string;
  /** ① 멤버 만들기 본문(한 줄 JSON). */
  createBody: string;
}

/** 셸마다 다른 부분 — ①~⑥ 의 코드 조각과 그 셸로 적은 안내·금지 줄. 조각 뒤의 설명 줄은 셸과 무관해 한 벌이다. */
interface ProcedureText {
  lang: 'bash' | 'powershell';
  heading: string;
  intro: string[];
  create: string[];
  config: string[];
  edge: string[];
  kickoff: string[];
  plan: string[];
  collect: string[];
  noWrite: string;
  oneBase: string;
}

/** Bash + curl — Claude 지휘자(세 OS, Windows 는 Git Bash)와 mac·linux 의 Codex 지휘자. */
function posixProcedure(v: ProcedureValues): ProcedureText {
  const base = `\${${AGENT_CARD_ENV_BASE}:-${v.serverBase}}`;
  const auth = `-H "x-vibisual-hook-token: ${AGENT_AUTH_POSIX}"`
    + ` -H "x-vibisual-source-agent: ${v.conductorAgentId}"`
    + ` -H "x-vibisual-source-subagent: \${VIBISUAL_SUBAGENT_ID:-${v.conductorSubAgentId}}"`;
  const requester = encodeURIComponent(v.conductorAgentId);
  const requestKey = encodeURIComponent(`${v.runId}:entry`);
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
      `curl -s -X POST "${base}/api/task-edges/dispatch?edgeId=<DISPATCH_EDGE_ID>&agentId=${requester}&wait=false&requestKey=${requestKey}" \\`,
      `  ${auth} \\`,
      "  -H 'Content-Type: text/plain; charset=utf-8' --data-binary @- <<'EOF'",
      ...KICKOFF_TEXT_SAMPLE,
      'EOF',
    ],
    plan: [
      ...postJson(`/api/orchestra/runs/${v.runId}/plan`, PLAN_BODY_SAMPLE),
      show(`o.ok?'DISPATCH_EDGE_ID='+(o.dispatchEdgeId||'none'):s`),
    ],
    collect: [
      `curl -s "${base}/api/task-edges/dispatch/<CMD_ID>?agentId=${requester}&waitMs=${RESULT_WAIT_MS}" \\`,
      `  ${auth}`,
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
  const head = [
    ...agentPowershellHead(v.serverBase),
    `$H['x-vibisual-source-agent'] = '${v.conductorAgentId.replace(/'/g, "''")}'`,
    `$H['x-vibisual-source-subagent'] = if ($env:VIBISUAL_SUBAGENT_ID) { "$env:VIBISUAL_SUBAGENT_ID" } else { '${v.conductorSubAgentId.replace(/'/g, "''")}' }`,
  ];
  const requester = encodeURIComponent(v.conductorAgentId);
  const requestKey = encodeURIComponent(`${v.runId}:entry`);
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
      `${send('Post', `$B/api/task-edges/dispatch?edgeId=<DISPATCH_EDGE_ID>&agentId=${requester}&wait=false&requestKey=${requestKey}`, 'text/plain', '$Text')} | ConvertTo-Json -Depth 32`,
    ],
    plan: [
      ...head,
      "$Body = @'",
      PLAN_BODY_SAMPLE,
      "'@",
      `$R = ${send('Post', `$B/api/orchestra/runs/${v.runId}/plan`, json, '$Body')}`,
      'if ($R.ok) { "DISPATCH_EDGE_ID=$($R.dispatchEdgeId)" } else { $R | ConvertTo-Json -Depth 32 }',
    ],
    collect: [
      ...head,
      `Send Get "$B/api/task-edges/dispatch/<CMD_ID>?agentId=${requester}&waitMs=${RESULT_WAIT_MS}" | ConvertTo-Json -Depth 32`,
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
  const { serverBase, projectName, runId, conductorAgentId, conductorSubAgentId, centerX, centerY, settings, existingMembers, existingEdges, conductorEngine, platform } = args;
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
    conductorAgentId,
    conductorSubAgentId,
    // `color` 는 예시에 넣어 둔다 — 아래 "역할 색" 줄만으로는 **본문 어디에 넣는 칸인지**가 안 보인다.
    createBody: `{"label":"Researcher","x":${Math.round(cx + radius)},"y":${cy},"project":${projectField},"color":"#6366f1","orchestraRunId":"${runId}"}`,
  };
  const proc = orchestraConductorShell(conductorEngine, platform) === 'powershell'
    ? powershellProcedure(values)
    : posixProcedure(values);
  const code = (lines: string[]) => ['```' + proc.lang, ...lines, '```'];

  const labelOf = new Map(existingMembers.map((m) => [m.id, m.label]));
  labelOf.set(conductorAgentId, '지휘자(당신)');

  const out: string[] = [
    `# 오케스트라 지휘 — 이번 요청 한 건 (런 \`${runId}\`)`,
    '',
    '이 턴에 한해 당신은 **지휘자**다. 사용자가 방금 보낸 요청의 편성을 고르고, 위임 결과와 검증을 회수해 **최종 답변까지 책임지는 것**이 이번 턴의 일이다.',
    `- 지휘자 agentId = \`${conductorAgentId}\`, 실행 subAgentId = \`${conductorSubAgentId}\`. 연결과 결과 조회의 소유자는 당신이다.`,
    '- **직접 파일을 고치지 않는다.** 코드를 바꾸는 일은 멤버가 한다.'
      + (conductorEngine === 'codex' ? ' (Codex 엔진에서는 쓰기가 도구로 막혀 있지 않다 — 이 줄이 유일한 선이다.)' : ''),
    '- 아래 절감 방안을 **전부 적용하지 않는다.** 이 요청에 맞는 것만 고르고, 고른 이유와 건너뛴 이유를 계획 신고에 적는다. 하나도 고르지 않는 것도 올바른 답일 수 있다.',
    '- 편성하지 않는 것(`none`)도 올바른 선택이다. 작은 질문에 머릿수를 늘리는 것 자체가 아래 분석 1번이 말하는 낭비다 — 멤버마다 고정 비용이 붙는다.',
    '- 계획 신고(④)는 **어떤 편성이든 킥오프 전에 꼭 한 번** 한다. 신고 없이 끝난 턴은 사용자 화면에 "신고 없음"으로 남는다.',
    '',
    '## 1. 먼저 고른다 (순서대로)',
    '1. **의도(intent)** — 아래 표에서 하나. 범위를 잡는 데 필요하면 Read·Grep·Glob 을 짧게 쓴다(깊은 조사는 멤버의 일이다).',
    '2. **편성(topology)** — 하나.',
    '   - `none` — 멤버 없이 당신이 직접 답한다. ④ 계획 신고만 하고 답한다.',
    '   - `single` — 멤버 하나에게 넘긴다.',
    '   - `pipeline` — 앞 결과가 다음 입력인 차례 작업. 멤버를 엣지로 잇고 첫 멤버에게 킥오프한다. 첫 멤버는 뒤 단계의 결과·검증까지 회수해 당신에게 통합 보고한다.',
    '   - `parallel` — 서로 **독립된** 일을 나눠 동시에 돌리고 허브 멤버 하나가 모은다. 허브에서 각 워커로 엣지를 깔고 허브에게 킥오프한다. 허브는 모든 워커의 결과·검증까지 회수해 당신에게 통합 보고한다. 독립이 아니면 고르지 않는다.',
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
    '- 출력 한 줄 `AGENT_ID=… AGENT_PATH=…` — `id` 는 설정·엣지·계획 신고용이다. 실패면 응답의 `error` 가 보인다.',
    `- \`"orchestraRunId":"${runId}"\` 를 **반드시** 넣는다. 그래야 이 런의 멤버로 기록되고, 그 멤버는 스스로 지휘하지 않는다.`,
    '- 429 `orchestra-member-limit` 이면 더 만들지 말고 기존 멤버를 다시 쓰거나 편성을 줄인다. 429 `custom-agent-limit` 은 프로젝트 전체 상한이다.',
    ...roleColorSection(),
    '',
    '### ② 멤버 설정 — 지금 값을 읽어 합친 뒤 통째로 저장',
    ...code(proc.config),
    '- 일부 칸만 보내면 보내지 않은 칸이 지워진다. 위처럼 **읽고 → 합치고 → 통째로** 보낸다.',
    '- 권한 축(`permissionMode`·`tools`·`disallowedTools`·`askTools`)은 PATCH 에 넣지 않는다 — 사용자만 바꾸는 칸이라 이 통로의 저장에서는 무시된다. 그 강도가 일에 안 맞으면 `note` 로 사용자에게 말한다.',
    '- 절감 설정은 **고른 방안이 가리키는 칸만** 바꾼다. 역할·아래 결과 회수 계약을 적는 `rules` 는 방안 선택과 무관하게 필요하다.',
    '- 엔트리(첫 멤버·허브)의 `rules` 에는 반드시 **모든 하위 위임 결과·검증·재작업을 회수한 뒤 통합 보고한다**고 넣는다. 접수 직후 끝내거나 일을 넘겼다는 말만 보고하지 않는다.',
    '',
    '### ③ 엣지 — `pipeline`·`parallel` 일 때',
    ...code(proc.edge),
    '- 엣지는 source 멤버의 **위임 도구**가 된다 — source 멤버가 스스로 판단해 target 에게 일을 넘기고 결과를 받는다. 킥오프를 받은 멤버부터 차례로 흐른다.',
    '- 필수: `sourceAgentId`·`targetAgentId`·`command`·`forwardMode`(명령 엣지는 `"manual"`, 검증 엣지는 `"auto"`).',
    '- 선택: `kind`(`command`|`artifact`|`request`|`critique`)·`returnFormat`(`summary`|`artifact`|`both`)·`messageFormat`(`free`|`schema`)·`messageSchema`·`templateId`·`critiqueAuthority`(`force-rework`|`comment-only`, `critique` 한정).',
    '- `returnFormat` 은 저 셋뿐이다. 다른 낱말을 적으면 **막히지 않고 그대로 저장돼** 결과 회수 경로만 조용히 빠진다.',
    '- 상한 칸: `timeoutMs`(그 엣지 한 번의 실행 시간 상한, 미설정 = 무제한)·`priority`(`low`|`normal`|`high`, 동시에 여럿이 돌 때의 차례)·`maxReworkCount`(`critique` + `force-rework` 한정, 같은 일을 몇 번까지 되돌려 보낼지).',
    '- **끝을 모르는 자리에 `timeoutMs` 를 둔다** — 바깥을 훑거나 오래 도는 명령을 맡기는 엣지다. 상한이 없으면 그 한 칸이 끝나지 않아 ⑥ 회수가 영영 돌아오지 않는다.',
    '- `maxReworkCount` 는 서버 상한 안에서만 줄일 수 있다. 검수자와 작업자가 서로에게 되돌려 보내며 맴도는 것을 끊는 칸이다.',
    '- **코드를 바꾸는 편성**이면 검증 엣지를 최소 하나 깐다 — reviewer/tester → coder, `"kind":"critique","critiqueAuthority":"force-rework","forwardMode":"auto"`. 서버가 재작업 짝 엣지를 만들고, 재작업 횟수는 엣지마다 상한이 있다.',
    '- 위임 결과를 기다리는 명령 엣지는 **`returnFormat:"both"`** 로 만든다. 서버가 반환 엣지를 함께 만들고, 받지 못한 결과를 실행 세션에 묶는다.',
    '- **넘기는 말의 양식(`messageFormat`).** `"schema"` 로 두고 `messageSchema` 에 받고 싶은 **칸 이름과 뜻**을 적으면 source 멤버가 그 양식으로 넘긴다. 줄글로 넘기면 받는 쪽이 무엇을 읽어야 할지 매번 새로 정한다 — 검증·재작업처럼 **같은 칸을 되풀이해 읽는** 엣지일수록 양식을 정해 둔다.',
    '- `messageSchema` 는 자유 텍스트다(JSON 본보기도, 항목 목록도 된다). 예: `{"changedFiles":["<경로>"],"testsRun":"<명령>","failures":[{"file":"<경로>","why":"<한 줄>"}],"notDone":"<남은 일>"}`. 빈 값이거나 `messageFormat:"free"` 면 양식을 강제하지 않는다.',
    '- 양식은 **엣지에 저장된다** — 그 엣지가 살아 있는 동안 계속 먹고, 엣지를 지우면 같이 사라진다. 받는 쪽 `rules` 에 같은 말을 또 적지 않는다.',
    ...edgePresetSection(),
    '- **지휘자 → 엔트리 연결은 필수**다. ④ 계획 신고가 이 명령 엣지와 반환 엣지를 만들거나 재사용하므로 여기서 중복으로 만들지 않는다. 멤버끼리의 연결도 아래 "이미 있는 엣지"를 먼저 재사용한다.',
    '- 기존 연결은 사용자 산출물이다. 이번에 쓰지 않는다고 삭제하지 않는다. 예전 런의 엣지가 남아 있어도 현재 계획의 엔트리와 필요한 작업만 명시적으로 실행한다.',
    '',
    '### ④ 계획 신고 — 어떤 편성이든 킥오프 전에 꼭 한 번',
    ...code(proc.plan),
    '- `intent`·`topology` 필수. `chosen`·`skipped` 는 `[{"id":"<방안 id>","reason":"<한 줄>"}]`.',
    `- \`reusedAgentIds\` = 이번에 다시 쓴 기존 멤버 id(새로 만든 멤버는 서버가 이미 안다). \`entryAgentId\` = 이제 킥오프할 멤버 id. \`note\`(≤${ORCHESTRA_PLAN_NOTE_MAX}자) = 사용자에게 남길 말 — 엔진을 고른 이유, 참고 전용 방안 권고, 권한이 일에 안 맞는다는 알림 등.`,
    '- `none` 이면 `entryAgentId` 는 빼고 `reusedAgentIds` 는 빈 배열로 보낸다. 이때 연결도 킥오프도 결과 대기도 필요 없다.',
    '- 편성이 있으면 응답의 `dispatchEdgeId` 를 보관한다. 서버가 지휘자 → 엔트리의 primary command 엣지(`returnFormat:"both"`)와 반환 엣지를 보장한다.',
    '- 계획 등록은 이번에 참여하는 멤버 사이의 기존 command 엣지도 `returnFormat:"both"` 로 보정한다. 기존 멤버·연결을 재사용해도 결과 회수 경로가 빠지지 않는다.',
    '- 400 이면 응답의 `error`·`ids` 를 보고 고쳐 다시 보낸다(예: `strategy-not-allowed` = 그 id 는 지금 고를 수 없다). 409 이면 오류 이유를 확인한다. 등록된 계획은 바꾸지 말고 기존 응답의 `dispatchEdgeId` 로 이어 간다.',
    '- 순서: 편성이 있으면 ①~③ → **④ 계획 등록 성공** → ⑤ 킥오프 → ⑥ 결과 회수 → 최종 답변이다.',
    '',
    '### ⑤ 킥오프 — 계획의 엔트리에게 결과를 요청하기',
    ...code(proc.kickoff),
    '- `<DISPATCH_EDGE_ID>` 는 ④ 응답의 `dispatchEdgeId` 다. `/api/commands` 로 직접 보내면 감독의 결과 회수 장부를 우회하므로 쓰지 않는다.',
    `- 요청 키는 \`${runId}:entry\` 로 고정한다. 응답의 \`cmdId\` 를 즉시 보관하고 ⑥ 에서 이어 받는다. 통신이 끊겨 cmdId 를 못 받았을 때만 **같은 키·같은 본문**으로 접수를 복구한다. 다른 키로 같은 일을 재위임하지 않는다.`,
    '- `x-vibisual-source-agent`·`x-vibisual-source-subagent` 를 지우지 않는다. 두 헤더가 지휘자의 현재 턴과 위임 결과를 잇는다.',
    '',
    '### ⑥ 결과 회수 — 같은 cmdId 로 끝날 때까지 조회',
    ...code(proc.collect),
    '- `<CMD_ID>` 는 ⑤ 에서 받은 `cmdId` 다. 조회 응답의 `job.status`·`job.result` 를 읽는다(접수 응답은 최상위 `status`·`result`).',
    '- `queued`·`executing`·`pending:true`·`timedOut:true` 는 진행 중이다. `ok:false` 만 보고 실패나 완료로 결론내리지 말고 같은 cmdId 로 ⑥ 을 반복한다. 기다리는 동안에도 사용자에게 진행 상황을 간단히 알린다.',
    '- `completed` 이고 `usageLimit`·`errorMessage` 가 없으면 결과를 읽고 요청 충족과 검증 근거를 확인한다. `error`·`cancelled`·한도 중단은 성공이 아니며, 회수한 오류와 아직 못 한 일을 분명히 보고한다.',
    '- 조회 실패·도구 대기 제한은 위임 종료가 아니다. 같은 cmdId 로 복구하고, 401/403/404 등으로 더 진행할 수 없으면 cmdId 와 차단 원인을 남긴다. 실패를 감추거나 같은 작업을 새로 실행하지 않는다.',
    '',
    '## 3. 마무리',
    '- 편성했으면: **끝난 결과를 회수하기 전에는 턴을 완료하지 않는다.** 편성·접수 보고는 중간 안내일 뿐이다. 최종 답변에는 실제 변경/결과, 수행한 검증, 남은 실패·차단을 정리한다.',
    '- `none` 이면: 신고한 뒤 요청에 직접 답한다.',
    '',
    '## 멤버가 태어날 때 받는 것 (사용자 스위치 — 바꿀 수 없다)',
    ...memberBirthSection(settings),
    '',
    '## 멤버 엔진',
    ...memberEngineSection(settings, conductorEngine, args.readyEngines),
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

  out.push('', '## 다시 쓸 수 있는 멤버 (① 로 새로 만들기 전에 먼저 본다)');
  if (existingMembers.length === 0) {
    out.push('없음 — 필요하면 ① 로 새로 만든다.');
  } else {
    out.push(
      '| label | id | path | engine | model | 출처 |',
      '|---|---|---|---|---|---|',
      ...existingMembers.map((m) => `| ${cell(m.label)} | \`${m.id}\` | \`${m.path}\` | ${m.engine} | ${cell(m.model ?? '')} | ${m.own ? '내 이전 런' : '프로젝트'} |`),
      '- **내 이전 런**이 1순위, **프로젝트**(사용자가 손으로 만들었거나 다른 지휘자가 만든 버블)가 2순위다. 둘 다 ④ 의 `reusedAgentIds` 에 넣을 수 있다.',
      '- 다시 쓰는 멤버도 ② 로 이번 일에 맞게 `rules` 를 고쳐 준다. 앞 런의 역할 문구가 남아 있으면 엉뚱한 일을 한다.',
      '- **프로젝트** 쪽은 사용자 산출물이다 — 이번 일에 맞지 않으면 고치려 들지 말고 그냥 두고 ① 로 새로 만든다.',
    );
  }

  if (existingEdges.length > 0) {
    // 후보가 프로젝트 전체로 넓어지면 이 표도 같이 넓어진다 — 규칙 길이가 그래프 크기를 따라가지 않게 자른다.
    const shown = existingEdges.slice(0, EDGE_TABLE_MAX);
    out.push(
      '',
      '### 이미 있는 엣지',
      '| id | source → target | kind | 용도 |',
      '|---|---|---|---|',
      ...shown.map((e) => {
        const src = labelOf.get(e.sourceAgentId) ?? e.sourceAgentId;
        const dst = labelOf.get(e.targetAgentId) ?? e.targetAgentId;
        return `| \`${e.id}\` | ${cell(src)} → ${cell(dst)} | ${e.kind ?? 'command'} | ${cell(oneLine(e.command, EDGE_COMMAND_PREVIEW_MAX))} |`;
      }),
    );
    if (existingEdges.length > shown.length) {
      out.push(`- 그 밖에 ${existingEdges.length - shown.length}개가 더 있다 — 필요하면 \`GET /api/task-edges\` 로 전부 본다.`);
    }
  }

  out.push(
    '',
    '## 배치 좌표',
    `- 중심(당신의 버블) = (${cx}, ${cy}). 새 멤버는 이 점 주위 반지름 ${radius}px 안에 겹치지 않게 놓는다 — N개면 360/N 도 간격으로 \`x = ${cx} + ${radius}*cos(θ)\`, \`y = ${cy} - ${radius}*sin(θ)\`.`,
    '',
    '## 금지',
    proc.noWrite,
    '- 이 턴에서 오케스트라 설정(`/api/orchestra/scope`·`/api/orchestra/settings`)을 바꾸지 않는다 — 사용자의 스위치다.',
    '- `orchestraRunId` 없이 멤버를 만들거나 계획 등록 없이 킥오프하지 않는다.',
    proc.oneBase,
    '',
    '## 지난 분석 원문 (2026-09-16 토큰 감사 — 고치지 않은 원문)',
    `방안 id ↔ 표의 #: ${ORCHESTRA_STRATEGIES.map((s) => `${s.id}=${s.no}`).join(' · ')}`,
    '',
    orchestraAnalysisMarkdown({ exclude: [...disabled] }),
  );

  return out.join('\n');
}
