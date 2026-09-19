/**
 * §5.3 #10-4 — 오케스트라 방안 카탈로그. **2026-09-16 토큰 감사 답변 원문 그대로다.**
 *
 * 사용자 지시는 "지난번에 분석한거 그대로 넣을수 있게"였다. 그래서 표 13행(요소·줄이는 방법·예상 절감·
 * 잃는 것·적용 지점), 합산 문장, 실측 네 가지, 우수 사례 표, 지금 바로 바꿀 수 있는 값, 출처를
 * **한 글자도 고치지 않고** 옮겼다 — 원문 문자열은 생성기가 답변 원문에서 그대로 떠 왔고, 표 행은
 * `orchestraStrategyRow` 로 다시 이으면 원문 줄과 바이트까지 같다(생성기가 확인했다).
 *
 * **원문을 고치지 마라.** 고칠 것이 생기면 원문은 두고 `apply` 칸을 고친다. `apply` 는 원문이 아니라
 * 지휘자가 이 방안을 고른 뒤 실제로 만질 수 있는 손잡이다 — `AgentConfig` 칸·멤버 지시문 조항·편성 원칙.
 *
 * 원문의 몫·절감 수치는 한 세션의 실측과 그 추정이다. 화면·규칙은 그것을 **원문의 추정**으로만 보인다
 * (수치 절감을 약속하는 표시 ❌ — SSOT #10-4 금지·경계).
 *
 * 이 파일은 `node:fs`·플랫폼·시간을 모른다 — 서버(지휘 규칙)·클라(방안 표)가 같은 상수를 읽는다.
 */
import type { OrchestraStrategyId } from './types.js';

/** 지휘자가 멤버에게 실제로 만질 수 있는 손잡이 — `AgentConfig` 칸 이름 + 엣지 `returnFormat`. */
export type OrchestraKnob =
  | 'model'
  | 'effort'
  | 'maxTurns'
  | 'subagentDepth'
  | 'rules'
  | 'maxThinkingTokens'
  | 'maxOutputTokens'
  | 'autoCompact'
  | 'autoCompactPct'
  | 'settingSources'
  | 'bashMaxOutputChars'
  | 'mcpServers'
  | 'skills'
  | 'excludeDynamicSystemPromptSections'
  | 'edgeReturnFormat';

/** 원문 옆에 붙는 "이렇게 적용" 칸. 원문이 아니다 — 지휘자가 고른 뒤 할 수 있는 일이다. */
export interface OrchestraStrategyApply {
  /** 이 방안을 고르면 멤버 설정에서 만질 수 있는 칸. */
  knobs: readonly OrchestraKnob[];
  /** 멤버 지시문(rules)에 덧붙일 조항. 빈 문자열 = 지시문으로 할 일이 없다. */
  memberRule: string;
  /** 편성을 짤 때의 원칙. 빈 문자열 = 편성과 무관하다. */
  topology: string;
  /**
   * 지휘자가 고를 수 있는가. 11·12·13 은 지휘자가 만질 손잡이가 없어 `false` 다(참고 전용 —
   * 지휘자는 note 로 사용자에게 권할 수만 있다). 계획 신고에 담기면 400.
   */
  selectable: boolean;
}

/** 방안 하나 = 원문 표의 한 행 + "이렇게 적용". */
export interface OrchestraStrategy {
  id: OrchestraStrategyId;
  /** 원문 표의 # 칸. */
  no: number;
  /** 원문 "요소 (현재 몫)" 칸 — `<br>` 까지 원문 그대로. */
  element: string;
  /** 원문 "줄이는 방법" 칸. */
  methods: string;
  /** 원문 "예상 절감" 칸. */
  saving: string;
  /** 원문 "잃는 것·위험" 칸. */
  risk: string;
  /** 원문 "적용 지점" 칸. */
  applyAt: string;
  apply: OrchestraStrategyApply;
}

/** 원문 표 제목 줄. */
export const ORCHESTRA_ANALYSIS_TABLE_TITLE = "## 요소별 절감표 (몫은 지난 실측, 절감은 전체 대비 %p)";

/** 원문 표 머리 두 줄. */
export const ORCHESTRA_ANALYSIS_TABLE_HEADER = "| # | 요소 (현재 몫) | 줄이는 방법 | 예상 절감 | 잃는 것·위험 | 적용 지점 |";
export const ORCHESTRA_ANALYSIS_TABLE_RULE = "|---|---|---|---|---|---|";

/** 원문 표 13행 — 순서가 곧 원문의 # 이다. */
export const ORCHESTRA_STRATEGIES: readonly OrchestraStrategy[] = [
  {
    id: "subagents",
    no: 1,
    element: "**서브에이전트 20.0%**",
    methods: "① Explore 를 **Sonnet/Haiku** 로(현재 opus-5) ② `maxTurns` 로 호출 수 상한 — 캐시읽기는 호출수의 **제곱**으로 늘어납니다 ③ 질문을 좁혀 에이전트 문맥이 170k 까지 자라지 않게 ④ 겹치는 관점은 한 에이전트로 합치기",
    saving: "**−10~16%p**",
    risk: "탐색 품질 저하, 얕은 조사",
    applyAt: "Vibisual 설정창 Model·Effort·Max Turns / Agent 지시문",
    apply: {
      knobs: ["model", "effort", "maxTurns", "subagentDepth", "rules"],
      memberRule: "조사·탐색 멤버는 sonnet 이나 haiku 로 만들고 maxTurns 상한을 둔다. 지시문 첫 줄에 이 멤버가 답할 질문을 한 줄로 좁혀 적는다. 멤버가 다시 서브에이전트를 부르지 않게 subagentDepth 를 1 로 둔다.",
      topology: "독립된 일일 때만 멤버를 늘린다. 겹치는 관점은 한 멤버로 합친다 — 머릿수마다 고정 비용이 붙는다.",
      selectable: true,
    },
  },
  {
    id: "output",
    no: 2,
    element: "**출력 14.9%**<br>(thinking 5.9 · Edit·Write 인자 4.6 · 명령 인자 3.6 · 본문 0.9)",
    methods: "① `effort` xhigh→high/medium(현재 xhigh=650) ② 파일 전체 Write ❌ → 좁은 Edit, 반복 편집은 스크립트 1개로 ③ 긴 heredoc 을 매번 출력하지 말고 스크립트를 **파일로 한 번** 쓰고 재실행 ④ 보고 본문은 파악에 필요한 만큼만",
    saving: "**−4~6%p**",
    risk: "낮은 effort 는 어려운 문제에서 품질 하락",
    applyAt: "`/effort` · `MAX_THINKING_TOKENS`(고정예산 모델) · 작업 습관",
    apply: {
      knobs: ["effort", "maxThinkingTokens", "maxOutputTokens", "rules"],
      memberRule: "파일 전체를 Write 하지 말고 좁은 Edit 로 고친다. 같은 편집을 되풀이하면 스크립트 하나로 묶는다. 긴 명령은 파일로 한 번 쓰고 그 파일을 다시 실행한다. 보고 본문은 파악에 필요한 만큼만 쓴다.",
      topology: "되돌리기 비싼 판단(설계·원인 분석)을 맡은 멤버만 effort 를 높이고, 실행 멤버는 medium~high 로 둔다.",
      selectable: true,
    },
  },
  {
    id: "autoCompact",
    no: 3,
    element: "**자동 컴팩트 13.4%**<br>(요약 생성 5.1 · 요약 재독 4.2 · 재첨부 4.1)",
    methods: "① 무관한 작업은 `/clear` — **컴팩트는 비싸고 `/clear` 는 0원**입니다 ② 컴팩트 창 확대(우리 앱 기본 400k, 모델은 1M) ③ 한계 전에 `/compact 지시문` 으로 미리 · ④ 세션을 작업 단위로 쪼개 컴팩트 0회",
    saving: "**−8~13%p**",
    risk: "창을 키우면 호출마다 캐시읽기 증가 · 맥락 연속성 상실",
    applyAt: "Options 창 `autoCompact` · `/autocompact` · `CLAUDE_CODE_AUTO_COMPACT_WINDOW`",
    apply: {
      knobs: ["autoCompact", "autoCompactPct"],
      memberRule: "맡은 한 가지를 끝내면 보고하고 멈춘다. 다른 일로 넘어가지 않는다.",
      topology: "일을 멤버 단위로 잘라 어느 멤버도 컴팩트 한계까지 자라지 않게 한다. 긴 조사는 새 멤버(새 세션)에게 맡긴다.",
      selectable: true,
    },
  },
  {
    id: "read",
    no: 4,
    element: "**Read 11.1%**",
    methods: "실측: 고유 파일 **16개를 72회** 읽어 재독이 **9.2%p**(완전 동일 범위 재독은 0.99%p). ① 읽은 절을 `.private/` 노트에 요약해 두고 다시 안 읽기(구조화 메모) ② 컴팩트 직후 재독을 노트로 대체 ③ Grep→줄번호→`offset/limit` ④ 코드 인텔리전스 플러그인으로 정의 이동", // privacy-ok
    saving: "**−5~7%p**",
    risk: "노트가 낡으면 오래된 정보로 판단",
    applyAt: "SSOT 읽기 계약(CLAUDE.md 기획 연속성 1번) · 노트 파일",
    apply: {
      knobs: ["rules"],
      memberRule: "Grep 으로 줄 번호를 먼저 찾고 Read 는 offset/limit 로 그 절만 읽는다. 읽은 절은 요점 몇 줄로 보고에 남겨 다음 멤버가 같은 파일을 다시 열지 않게 한다.",
      topology: "같은 파일을 여러 멤버가 따로 읽지 않게 한다 — 읽는 멤버 하나가 요점을 엣지로 넘긴다.",
      selectable: true,
    },
  },
  {
    id: "memoryFiles",
    no: 5,
    element: "**CLAUDE.md+MEMORY.md 9.9%**<br>(MEMORY 5.9 · CLAUDE 4.2)",
    methods: "MEMORY.md 160행·11.8k토큰, CLAUDE.md 181행·8.2k토큰이 **모든 호출에** 실립니다. ① 인덱스 한 줄을 짧게(현재 한 줄이 길어 행수는 규정을 지켜도 토큰이 큽니다) ② 작업별 규칙 본문은 **스킬로 이관**(호출 때만 로드) ③ 서브에이전트에는 `settingSources` 로 층을 좁혀 미주입",
    saving: "**−3~4%p**",
    risk: "규칙 누락 → 기획 파괴 위험. 절대 규칙은 남겨야 합니다",
    applyAt: "`memory/MEMORY.md` · `CLAUDE.md` · `.claude/skills/` · 설정창 `settingSources`",
    apply: {
      knobs: ["settingSources"],
      memberRule: "",
      topology: "프로젝트 규칙이 필요 없는 멤버(웹 조사·요약)만 settingSources 를 좁힌다. 코드를 고치는 멤버는 project 층을 남긴다 — 원문 위험 칸(규칙 누락)이 그 이유다.",
      selectable: true,
    },
  },
  {
    id: "prevOutput",
    no: 6,
    element: "**이전 턴 출력 재독 9.7%**<br>(thinking 3.8 · 편집 인자 2.8 · 명령 2.6 · 본문 0.5)",
    methods: "2번을 줄이면 **그만큼 곱해서** 줄어듭니다(한 번 낸 출력은 남은 턴 내내 다시 실림). 추가로 ① 긴 턴을 짧게 끊기 ② 오래된 thinking 은 harness 가 걷어내므로 `/clear` 로 확정 정리",
    saving: "**−3~5%p**",
    risk: "이전 판단 근거가 사라져 되짚기 어려움",
    applyAt: "2번과 동일(원인이 같습니다)",
    apply: {
      knobs: ["effort", "maxThinkingTokens", "maxOutputTokens", "rules"],
      memberRule: "한 턴을 길게 끌지 않는다. 한 일을 끝내면 보고하고 멈춘다.",
      topology: "2번과 원인이 같다 — 2번을 고르면 함께 고른다.",
      selectable: true,
    },
  },
  {
    id: "shell",
    no: 7,
    element: "**셸 탐색 8.1%**",
    methods: "실측: 출력 상한 **없는** 명령이 7.3%p, 있는 명령은 0.5%p. 같은 명령 재실행 2.2%p(69회). ① `head`·`-c`·`wc -l`·`grep -c/-l` 기본화 ② 결과를 파일로 쓰고 **요약만** 읽기 ③ `PreToolUse` 훅으로 테스트·로그 출력 자동 필터(공식 예시)",
    saving: "**−4~6%p**",
    risk: "잘린 출력 탓에 한 번 더 실행할 수 있음",
    applyAt: "명령 습관 · `~/.claude/hooks/` 필터 훅",
    apply: {
      knobs: ["bashMaxOutputChars", "rules"],
      memberRule: "탐색 명령에는 출력 상한(`| head -50`, `grep -c`, `wc -l`)을 먼저 붙인다. 긴 출력은 파일로 쓰고 요약만 읽는다.",
      topology: "",
      selectable: true,
    },
  },
  {
    id: "systemPrompt",
    no: 8,
    element: "**시스템 프롬프트·도구 정의 7.5%**",
    methods: "① 안 쓰는 MCP 서버 끄기(`/mcp`) — 지금 Atlassian 27개는 지연 로딩이라 이름만 들어옵니다 ② 등록 스킬·커스텀 에이전트 수 줄이기(시작 주입 2.8%p) ③ `excludeDynamicSystemPromptSections` 로 기기별 절을 뒤로 밀어 캐시 재적중 올리기(재기록 4.0%p 중 일부 회수)",
    saving: "**−1~3%p**",
    risk: "MCP 기능 상실 · 스킬 자동 로드 실패",
    applyAt: "`/mcp` · `/context` · 설정창 `excludeDynamicSystemPromptSections`",
    apply: {
      knobs: ["mcpServers", "skills", "excludeDynamicSystemPromptSections"],
      memberRule: "",
      topology: "멤버마다 그 일에 필요한 MCP 서버·스킬만 준다.",
      selectable: true,
    },
  },
  {
    id: "subagentReports",
    no: 9,
    element: "**서브에이전트 보고 2.0%**",
    methods: "보고 계약을 지시문에 박기: **결론 1,000~2,000 토큰**, 파일 덤프 금지, 경로+줄번호만",
    saving: "**−1%p**",
    risk: "근거가 얇아 부모가 다시 읽을 수 있음",
    applyAt: "Agent 지시문 · `.claude/agents/*.md`",
    apply: {
      knobs: ["rules", "edgeReturnFormat"],
      memberRule: "보고는 결론 1,000~2,000 토큰으로 쓴다. 파일 내용을 옮겨 적지 말고 경로+줄번호만 적는다.",
      topology: "엣지를 만들 때 returnFormat 을 \"summary\" 로 둔다.",
      selectable: true,
    },
  },
  {
    id: "web",
    no: 10,
    element: "**웹 조회 1.4%**",
    methods: "WebFetch 질문을 한 항목으로 좁히기, 같은 URL 재조회 금지(15분 캐시), 검색은 `allowed_domains` 로 공식 문서만",
    saving: "**−0.5%p**",
    risk: "놓친 근거",
    applyAt: "조사 습관",
    apply: {
      knobs: ["rules"],
      memberRule: "WebFetch 질문은 한 항목으로 좁힌다. 같은 URL 을 다시 조회하지 않는다. 검색은 allowed_domains 로 공식 문서만 본다.",
      topology: "",
      selectable: true,
    },
  },
  {
    id: "reminders",
    no: 11,
    element: "**매 턴 reminder 0.8%**",
    methods: "308회 주입. 훅 응답 본문 축소, Vibisual **주입원 게이트**에서 안 쓰는 주입 끄기(끄면 실행까지 꺼집니다)",
    saving: "**−0.3%p**",
    risk: "규칙 상기 약화",
    applyAt: "`hooks/handler.mjs` · 컨텍스트 주입원 설정",
    apply: {
      knobs: [],
      memberRule: "",
      topology: "",
      selectable: false,
    },
  },
  {
    id: "preamble",
    no: 12,
    element: "**Vibisual 프리앰블 0.6%**",
    methods: "1,385 토큰 규약(의도 선언 + 목표 창)을 압축, 목표 창 상태는 변경 시에만",
    saving: "**−0.3%p**",
    risk: "규약 집행력 약화",
    applyAt: "`packages/shared/src/constants.ts` 규약 문자열",
    apply: {
      knobs: [],
      memberRule: "",
      topology: "",
      selectable: false,
    },
  },
  {
    id: "other",
    no: 13,
    element: "**기타 0.6%**",
    methods: "손댈 여지 없음(사용자 지시 원문·Skill 본문·ToolSearch 스키마)",
    saving: "—",
    risk: "—",
    applyAt: "—",
    apply: {
      knobs: [],
      memberRule: "",
      topology: "",
      selectable: false,
    },
  },
];

/** 원문 합산 문장 — 표 바로 아래 한 줄. */
export const ORCHESTRA_ANALYSIS_SUM = "합산하면 **−35~45%p**(대략 절반)이지만, 2·6번처럼 원인이 겹치는 항목이 있어 단순 덧셈은 과대평가입니다. 겹침을 감안한 현실적 기대치는 **−30% 안팎**으로 보시면 맞습니다.";

/** 원문 "실측으로 새로 드러난 네 가지" — 제목 + 번호 붙은 네 줄. */
export const ORCHESTRA_ANALYSIS_INSIGHTS_TITLE = "## 실측으로 새로 드러난 네 가지";
export const ORCHESTRA_ANALYSIS_INSIGHTS: readonly string[] = [
  "1. **서브에이전트 비용은 보고가 아니라 자기 문맥 재독입니다.** Explore 2개가 49회·42회 돌며 자기 문맥을 19k→177k 까지 키웠고, 캐시읽기 누적이 **7.6M 토큰**인데 부모로 돌려준 출력은 **1,455·1,064 토큰**뿐이었습니다. 호출 수를 절반으로 줄이면 캐시읽기는 대략 4분의 1이 됩니다.",
  "2. **Read 문제는 \"같은 범위 중복\"이 아니라 \"같은 파일 반복 방문\"입니다.** 완전 동일 범위 재독은 0.99%p뿐이고, 고유 16개 파일을 72회 나눠 읽은 것이 9.2%p입니다. 컴팩트 7회가 재방문을 강제한 몫이 큽니다.",
  "3. **출력 본문 텍스트는 이미 0.88% 입니다.** 말씀하신 \"딱 파악할 부분만 출력\"은 방향이 맞지만, 보고 길이만 줄이면 1%p 미만입니다. 같은 원칙을 **thinking(5.9%)·편집 인자(4.6%)·명령 인자(3.6%)** 에 적용해야 −5%p 가 나옵니다.",
  "4. **셸은 상한 하나로 갈립니다.** 출력 상한을 붙인 명령은 0.48%p, 안 붙인 명령은 7.28%p 였습니다.",
];

/** 원문 "모은 우수 사례" 표의 한 행. */
export interface OrchestraBestPractice {
  /** 원문 "출처" 칸. */
  source: string;
  /** 원문 "핵심 권고" 칸. */
  advice: string;
  /** 원문 "우리 적용" 칸(방안 번호). */
  ourUse: string;
}

export const ORCHESTRA_BEST_PRACTICES_TITLE = "## 모은 우수 사례";
export const ORCHESTRA_BEST_PRACTICES_HEADER = "| 출처 | 핵심 권고 | 우리 적용 |";
export const ORCHESTRA_BEST_PRACTICES_RULE = "|---|---|---|";
export const ORCHESTRA_BEST_PRACTICES: readonly OrchestraBestPractice[] = [
  {
    source: "Anthropic 공식 비용 문서",
    advice: "`/clear` 로 작업 사이 정리(“컴팩트는 요약할 대화를 읽으므로 큰 요청, `/clear` 는 0원”) · 서브에이전트에 `model: haiku` · 훅으로 전처리 · CLAUDE.md 는 200행 이하·상세 규칙은 스킬 · `/effort`·`MAX_THINKING_TOKENS` · MCP 대신 CLI",
    ourUse: "3·1·7·5·2·8번",
  },
  {
    source: "Anthropic 엔지니어링(문맥 설계)",
    advice: "도구 결과 비우기가 가장 안전한 압축 · **구조화 메모**(NOTES.md)로 문맥 밖 저장 · 서브에이전트는 **1,000~2,000 토큰**만 반환 · 필요할 때 당겨오는 검색",
    ourUse: "4·6·9번",
  },
  {
    source: "Claude Cookbook(memory·compaction·tool clearing)",
    advice: "API 쪽 `clear_tool_uses_20250919` / `clear_thinking_20251015` 로 오래된 도구 결과·thinking 삭제",
    ourUse: "6번(우리 앱이 SDK 로 스폰할 때 쓸 수 있는 손잡이)",
  },
  {
    source: "서브에이전트 비용 실측(dev.to)",
    advice: "고정 비용이 커서 “머릿수는 비싸고 내용 실어주기는 싸다” · 겹치는 관점은 합치고, 독립 병렬일 때만 스폰",
    ourUse: "1번",
  },
  {
    source: "다중 에이전트 비용 보고(Anthropic 인용)",
    advice: "에이전트는 대화의 4배, 다중 에이전트는 15배 · 서브에이전트는 부모 캐시를 물려받지 못함",
    ourUse: "1번",
  },
  {
    source: "컴팩트 조율 가이드",
    advice: "`CLAUDE_CODE_AUTO_COMPACT_WINDOW`(100K~1M) · `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`(1~100, 낮추기만) · `/autocompact 500k` · `DISABLE_AUTO_COMPACT`",
    ourUse: "3번",
  },
  {
    source: "실무 절감 글(KDnuggets 등)",
    advice: "구체적 프롬프트로 탐색 범위 줄이기 · `.claudeignore` · `/context` 로 상시 확인",
    ourUse: "7·8번",
  },
];

/** 원문 "지금 바로 바꿀 수 있는 값" — 제목 + 번호 붙은 여섯 줄. */
export const ORCHESTRA_IMMEDIATE_VALUES_TITLE = "## 지금 바로 바꿀 수 있는 값";
export const ORCHESTRA_IMMEDIATE_VALUES: readonly string[] = [
  "1. **Explore·조사용 서브에이전트 모델을 Sonnet 으로**(설정창 Model) + `Max Turns` 상한 — 가장 큰 한 방입니다.",
  "2. **작업이 바뀔 때 `/clear`**, 이어갈 필요가 있을 때만 `/compact <남길 것>`.",
  "3. **`autoCompact`** 를 400k 유지하되, 긴 조사 세션은 아예 새 세션으로 시작.",
  "4. **탐색 명령에 출력 상한 기본 부착**(`| head -50`, `grep -c` 먼저).",
  "5. **MEMORY.md 인덱스 한 줄 압축**(현 11.8k 토큰) — 항목 수는 유지하고 설명 꼬리만 줄이기.",
  "6. **effort 를 작업 난이도에 맞춰**: 조사·정리는 high, 설계·디버깅은 xhigh 유지.",
];

/** 원문 출처 8건. */
export interface OrchestraSource {
  title: string;
  url: string;
}

export const ORCHESTRA_SOURCES_TITLE = "Sources:";
export const ORCHESTRA_SOURCES: readonly OrchestraSource[] = [
  { title: "Manage costs effectively — Claude Code Docs", url: "https://code.claude.com/docs/en/costs" },
  { title: "Effective context engineering for AI agents — Anthropic", url: "https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents" },
  { title: "Context engineering: memory, compaction, and tool clearing — Claude Cookbook", url: "https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools" },
  { title: "What a Claude Code subagent actually costs — dev.to", url: "https://dev.to/rulestack/what-a-claude-code-subagent-actually-costs-measuring-the-436k-token-fixed-overhead-46g6" },
  { title: "Why Claude Subagents Cost 4x More Tokens", url: "https://www.carlosaragon.online/blog/claude-subagent-token-cost" },
  { title: "Tune auto-compaction — Claude Code Guide", url: "https://bogdanmatasaru.github.io/claude-code-guide/guides/auto-compact" },
  { title: "7 Practical Ways to Reduce Claude Code Token Usage — KDnuggets", url: "https://www.kdnuggets.com/7-practical-ways-to-reduce-claude-code-token-usage" },
  { title: "Claude Code Context Buffer: The 33K-45K Token Problem", url: "https://claudefa.st/blog/guide/mechanics/context-buffer-management" },
];

/** 카탈로그 id 전부 — 원문 순서. */
export const ORCHESTRA_STRATEGY_IDS: readonly OrchestraStrategyId[] = ORCHESTRA_STRATEGIES.map((s) => s.id);

/** 바깥에서 온 문자열이 방안 id 인가(계획 신고·설정 정규화가 부른다). */
export function isOrchestraStrategyId(x: unknown): x is OrchestraStrategyId {
  return typeof x === 'string' && ORCHESTRA_STRATEGIES.some((s) => s.id === x);
}

/** id → 방안. 없으면 `undefined`. */
export function findOrchestraStrategy(id: string): OrchestraStrategy | undefined {
  return ORCHESTRA_STRATEGIES.find((s) => s.id === id);
}

/** 원문 표의 한 줄을 다시 잇는다 — 결과는 원문 답변의 그 줄과 같다. */
export function orchestraStrategyRow(s: OrchestraStrategy): string {
  return `| ${s.no} | ${s.element} | ${s.methods} | ${s.saving} | ${s.risk} | ${s.applyAt} |`;
}

/** 우수 사례 표의 한 줄을 다시 잇는다. */
export function orchestraBestPracticeRow(b: OrchestraBestPractice): string {
  return `| ${b.source} | ${b.advice} | ${b.ourUse} |`;
}

/** 출처 한 줄을 원문 모양으로. */
export function orchestraSourceLine(s: OrchestraSource): string {
  return `- [${s.title}](${s.url})`;
}

/**
 * 분석 원문 전체를 원문 모양 그대로 다시 잇는다 — 지휘 규칙에 이 글이 그대로 실린다.
 *
 * `exclude` 에 든 방안은 **표에서 그 행만** 빠진다(사용자가 꺼 둔 방안 — 지휘 규칙에서 빠진다는 SSOT 계약).
 * 빼는 것이 없으면 결과는 원문 답변의 해당 구간과 바이트까지 같다(서버 테스트가 해시로 고정한다).
 */
export function orchestraAnalysisMarkdown(opts?: { exclude?: readonly string[] }): string {
  const skip = new Set(opts?.exclude ?? []);
  return [
    ORCHESTRA_ANALYSIS_TABLE_TITLE,
    '',
    ORCHESTRA_ANALYSIS_TABLE_HEADER,
    ORCHESTRA_ANALYSIS_TABLE_RULE,
    ...ORCHESTRA_STRATEGIES.filter((s) => !skip.has(s.id)).map(orchestraStrategyRow),
    '',
    ORCHESTRA_ANALYSIS_SUM,
    '',
    ORCHESTRA_ANALYSIS_INSIGHTS_TITLE,
    '',
    ...ORCHESTRA_ANALYSIS_INSIGHTS,
    '',
    ORCHESTRA_BEST_PRACTICES_TITLE,
    '',
    ORCHESTRA_BEST_PRACTICES_HEADER,
    ORCHESTRA_BEST_PRACTICES_RULE,
    ...ORCHESTRA_BEST_PRACTICES.map(orchestraBestPracticeRow),
    '',
    ORCHESTRA_IMMEDIATE_VALUES_TITLE,
    '',
    ...ORCHESTRA_IMMEDIATE_VALUES,
    '',
    ORCHESTRA_SOURCES_TITLE,
    ...ORCHESTRA_SOURCES.map(orchestraSourceLine),
  ].join('\n');
}
