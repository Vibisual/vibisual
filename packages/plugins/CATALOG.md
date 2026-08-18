# Plugin Catalog

Vibisual 플러그인 커널(§5.11)의 구현 대장. 2026년 에이전트 엔지니어링 어휘 **110개를 전부 플러그인
후보로** 세운 표이며, 한 줄 = 플러그인 하나다.

- **모든 플러그인은 기본 비활성**으로 시작한다. File › Plugins 에서 하나씩 켠다.
- `[x]` 구현 완료. **110 / 110 — 카탈로그 전 항목이 플러그인으로 존재한다.**
- `mcp-server` 는 카드로만 존재한다 — 실제 외부 노출은 SSOT §10 Out of Scope 이므로 켜지 않았고, 카드는 "열려 있지 않다" 를 보여준다.
- 원칙·개념에 해당하는 항목도 **점검 카드(Inspector)** 형태로 만든다 — "지금 이 에이전트/프로젝트가
  그 원칙을 지키고 있는가"를 항목으로 환산하면 화면에 그릴 것이 생긴다.
- 코어가 이미 하는 일(체크포인트·워크트리·검수 관문 등)도 플러그인으로 만든다. 단 **기능을 옮기지 않고
  상태를 보여주는 카드**로만 만든다 — 코어 동작을 플러그인이 대체하지 않는다(§5.11 금지 항목).

진행: **110 / 110 구현** (+ 파생 1종 `mcp-client-inventory` = 등록 플러그인 111종)
문자열: **12개 로케일 100퍼센트** (en 키 1,099개 × 12 = 13,188개 — 실측).

> **원문 대조는 이제 이 문서가 아니라 `src/glossaryTerms.ts` 가 기준이다.** 원문에서 뽑은 용어 110개를 그 파일에 고정해 두고
> `glossaryCoverage.test.ts` 가 등록부와 맞대 본다 — 이 카탈로그도 사람이 쓴 것이라, 원문에서 빠뜨린 항목은 카탈로그에도 없어서
> 카탈로그끼리 대조하면 사이좋게 틀린 채 통과한다(실제로 29번 `Agent Registry` 가 그렇게 빠져 있었다).
>
> `Overthinking`(45)은 `reasoning-effort` 에 통합돼 있고,
> `Audit Trail & Autonomy Level`(100)은 성격이 달라 `audit-trail` · `autonomy-level` 두 카드로 갈랐다. 나머지는 1:1 로 대응한다.
>
> **이 표는 이제 손으로만 관리하지 않는다.** `src/catalog.test.ts` 가 카탈로그 id 와 등록부를 양방향으로 대조하고,
> 한 줄에 항목을 여럿 묶는 포장과 `[ ]` 잔여 항목도 막는다 — 실제로 그 검사를 넣는 과정에서 `react` → `react-pattern`
> 오기와 다섯 항목이 한 줄로 묶여 개수가 108개로 보이던 문제를 잡았다.

## 1. 아키텍처 · 설계 원칙 (1~10)

- [x] **ssot-drift** — 같은 사실이 두 곳에 다르게 적혀 있는지 점검
- [x] **adr-presence** — 결정 기록이 있는지, 기각 이유가 남았는지
- [x] **idempotency** — 재시도 안전한 도구/명령인지 표시
- [x] **separation-of-concerns** — 한 에이전트가 건드리는 관심사 폭
- [x] **event-driven** — 훅 이벤트 흐름 가시화
- [x] **backpressure** — 이벤트 유입 대비 처리 지연
- [x] **graceful-degradation** — 실패 시 열림/닫힘 정책 표시
- [x] **atomic-write** — 원자적 쓰기·백업 세대 상태(코어 상태 표시)
- [x] **schema-evolution** — 체크포인트 스키마 하위호환 상태
- [x] **durable-execution** — 체크포인트·재개 상태(코어 상태 표시)

## 2. 하네스 · 오케스트레이션 (11~20)

- [x] **agent-harness** — 이 에이전트를 감싸는 장치 요약
- [x] **scaffold** — 프롬프트·규칙·도구 배선 상태
- [x] **agent-loop** — 루프 한 회차의 비용·시간
- [x] **long-horizon** — 턴 수·경과·할일 진행률
- [x] **subagent** — 서브에이전트 격리 상태
- [x] **orchestrator** — 감독자·하위 구조 시각화
- [x] **fan-out** — 병렬 분기와 병합 지점
- [x] **handoff-packet** — 인계 5칸(목표·시도·제약·산출물·확인 못한 것)
- [x] **tool-use** — 도구 정의가 먹는 컨텍스트 몫
- [x] **hook-lifecycle** — 훅 발화 빈도와 동기 I/O 경고

## 3. 프로토콜 · 상호운용 (21~30)

- [x] **mcp-server** — 우리 노출 상태 표시(노출은 §10 Out of Scope 이므로 켜지 않음)
- [x] **agent-registry** — 등록·승격·폐기 생애주기(누가 만들었고·무슨 권한이고·마지막 활동)
- [x] **mcp-client-inventory** — 물린 MCP 서버 목록·출처 점검 *(용어집 110개 밖의 파생 카드)*
- [x] **a2a** — 에이전트 간 위임 규약 상태
- [x] **acp-anp** — 상호운용 규약 사용 여부
- [x] **agents-md** — AGENTS.md/CLAUDE.md 길이·링크 구조 점검(150줄 문턱)
- [x] **agent-card** — 이 에이전트의 능력·비용·실패 모드 명세
- [x] **agent-skills** — 스킬 상시 비용과 로드 시점
- [x] **structured-output** — 구조화 신고(작업/질문/검수/목록) 사용률
- [x] **tool-search** — 도구를 다 싣는가, 찾아 부르는가
- [x] **computer-use** — 화면 조작 에이전트 상태(캡처 버블 상태 표시)

## 4. 컨텍스트 엔지니어링 (31~40)

- [x] **context-engineering** — 매 추론에 무엇이 실리는지 구획별 요약
- [x] **context-rot** — 창 채움 비율과 절벽 경고
- [x] **context-pollution** — 하위 작업 잔여 맥락
- [x] **compaction-watch** — 컴팩션 횟수와 압축 손실
- [x] **context-editing** — 오래된 도구 결과 정리 상태
- [x] **progressive-disclosure** — 주입 대신 색인으로 준 비율
- [x] **token-budget** — 구획별 상한과 초과
- [x] **prompt-caching** — 캐시 프리픽스가 깨진 지점
- [x] **system-prompt** — 상시 지시층의 크기
- [x] **instruction-drift** — 초반 지시의 희석

## 5. 추론 · 에이전트 패턴 (41~50)

- [x] **context-window** — 유효 창을 실측으로 재기
- [x] **test-time-compute** — 사고량 대비 결과
- [x] **extended-thinking** — 사고 블록의 컨텍스트 점유
- [x] **reasoning-effort** — 사고 깊이 + 과잉 사고 경고 (45번 Overthinking 포함)
- [x] *(45 Overthinking — reasoning-effort 에 통합)*
- [x] **react-pattern** — 도구 반복 호출·맴돔 감지
- [x] **reflexion** — 실패 근거 기반 재시도
- [x] **plan-and-execute** — 계획 파일과 진행 대조
- [x] **verifier-critic** — 작성자·비평자 분리
- [x] **model-routing** — 모델 승급·강등 제안

## 6. 에이전트 기억 (51~60)

- [x] **working-memory** — 지금 활성 컨텍스트의 몫
- [x] **episodic-memory** — 원 세션 로그 보존 상태
- [x] **semantic-memory** — 추출된 사실의 출처
- [x] **procedural-memory** — 스킬·규칙 파일 상태
- [x] **memory-tool** — 파일로 남긴 메모 사용률
- [x] **memory-consolidation** — 통합 주기와 손실률
- [x] **forgetting-policy** — 총량 예산과 보관 이동
- [x] **memory-invalidation** — 낡음 표시("확인 필요") 상태
- [x] **supersede** — 대체 이력과 현재 진실
- [x] **memory-drift** — 재작성으로 원본에서 멀어짐

## 7. 검색 · 그라운딩 (61~70)

- [x] **rag** — 검색으로 끌어온 근거의 출처
- [x] **agentic-rag** — 에이전트가 스스로 검색한 궤적
- [x] **grounding** — 주장과 근거 파일의 연결
- [x] **chunking** — 카드 하나가 한 조각, 즉 카드 크기가 곧 품질 손잡이
- [x] **reranking** — 상위 몇 장만 주입하는 그 상한이 곧 재순위 결과
- [x] **hybrid-search** — 키워드 축만 쓰는 선택이 아직 유효한지
- [x] **multi-hop** — 근거가 모자라 다시 검색하러 간 횟수
- [x] **query-rewriting** — 저장된 말과 묻는 말이 겹치는지
- [x] **vector-db** — 저장 방식이 규모에 맞는지(수백 건이면 파일)
- [x] **agentic-file-search** — grep 우선 탐색 패턴

## 8. 평가 · 관측 · 비용 (71~80)

- [x] **eval** — 같은 입력 반복 실행의 분포
- [x] **eval-driven-development** — 평가 먼저 만들었는지
- [x] **llm-as-judge** — 심판 채점과 사람 채점의 대조
- [x] **trajectory-eval** — 도구 호출 순서·낭비한 단계
- [x] **golden-set** — 실패 사례가 기준 데이터에 적립됐는지
- [x] **benchmark-hygiene** — 자체 평가 셋 사용 여부
- [x] **trace-span** — 트레이스/스팬 뷰
- [x] **observability** — 관측이 앱을 죽이지 않는지(동기 I/O 경고)
- [x] **hallucination-guard** — 존재하지 않는 파일·API 참조
- [x] **cost-per-task** — 작업당 비용과 턴당 토큰

## 9. 보안 — 공격면 (81~90)

- [x] **prompt-injection** — 외부에서 읽어들인 텍스트의 출처
- [x] **lethal-trifecta** — 유출로 이어지는 세 다리
- [x] **owasp-asi** — 10대 위험 자가 점검 카드
- [x] **goal-hijack** — 목표에서 벗어난 행동 탐지
- [x] **tool-misuse** — 실행된 명령에서 되돌릴 수 없는 형태 표시
- [x] **memory-poisoning** — 기억 카드의 출처 신뢰도
- [x] **agentic-supply-chain** — 도구·스킬·MCP 출처 고정
- [x] **data-exfiltration** — 바깥으로 나가는 명령이 실제로 쓰였는지
- [x] **cascading-failure** — 인계 경계의 확신도·미확인 항목
- [x] **rogue-agent** — 살아 있는데 오래 조용한 에이전트

## 10. 봉쇄 · 거버넌스 (91~100)

- [x] **containment** — 뚫렸을 때 무엇까지 가능한가
- [x] **blast-radius** — 닿고·바꾸고·보낼 수 있는 범위
- [x] **least-privilege** — 도구를 성격별로 갈라 과잉 부여 표시
- [x] **non-human-identity** — 이 하나만 끊을 수 있는가
- [x] **sandboxing** — 격리 실행(네트워크 미격리 명시)
- [x] **guardrails** — 도구 호출 직전 관문
- [x] **allowlist** — "이것만 된다"에 얼마나 가까운가
- [x] **human-in-the-loop** — 되돌릴 수 없는 동작 앞의 확인
- [x] **kill-switch** — 예약을 먼저 끊고 살아 있는 세션을 정지(헤더 항목)
- [x] **audit-trail** — 사후에 "누가 했나"에 답할 수 있는가
- [x] **autonomy-level** — 제안만 / 승인 후 / 자율 (100번의 자율성 등급)

## 11. AI 개발 워크플로 (101~110)

- [x] **vibe-coding** — 이 코드가 얼마나 오래 살아야 하는지 물음
- [x] **spec-driven** — 명세와 구현의 어긋남
- [x] **agentic-engineering** — 감독·검증이 붙어 있는지
- [x] **hybrid-workflow** — 어디까지 명세, 어디부터 자유인지
- [x] **rescue-engineering** — 급조된 코드의 사후 부채
- [x] **worktree-isolation** — 워크트리 상태(코어 상태 표시)
- [x] **pre-commit-gate** — 커밋 전 관문 통과 상태
- [x] **review-gate** — 검수 카드 사용률
- [x] **regression-suite** — 사고 하나 → 회귀 테스트 하나 적립
- [x] **scope-creep** — 합의 범위 대비 확장/축소

---

## 구현 메모

- 점검 카드형 플러그인은 `framework/inspector.tsx` 의 `defineInspector` 로 만든다 — 배지·섹션·등급·행
  목록이 공통이라, 플러그인마다 남는 것은 **선언 20~40줄**뿐이다.
- 새 데이터 축이 필요하면 `PluginDataNeed` 유니온 + 호스트 `usePluginData` 에 한 줄씩. 선언하지 않은
  플러그인에는 데이터를 채우지 않는다. **호스트에 한 줄을 빠뜨리면** 카드는 던지지 않고 빈 값을 그린다
  (`needs.test.ts` 가 그 짝을 대조한다).
- 키 이름은 여전히 `panel.plugins.<camelId>.*` 다. 다만 **정본은 `en.json` 이 아니라 각 폴더의
  `strings.ts`** 이고, 12개 로케일을 그 파일이 통째로 들고 있다(v4.58 자립 규약 ④ — 폴더를 복사하면
  번역도 함께 간다). 로케일 JSON 에 카드 문자열을 남기면 `portability.test.ts` 가 잡는다.
  카드를 새로 만드는 절차는 `ADDING_A_CARD.md` 가 정본이다.

---

## 열린 결정 (사용자 몫)

111종 전수 점검에서 **측정은 끝났고 판단만 남은** 항목이다. 코드로 해결할 수 있는 것이 아니라 여기 적어
둔다 — 다음 사람이 같은 측정을 처음부터 반복하지 않도록.

- **경고 카드를 접을 것인가.** 111종을 다 켜면 한 버블에 경고가 **최대 32장** 겹친다(실측 — 전 도구 허용 +
  승인 없음처럼 흔한 조합에서 가장 크다. `panelLoad.test.tsx` 가 그 수를 래칫으로 고정해 둔다). 비용은
  카드 수에 선형이라(장당 0.04ms) 성능 문제가 아니고 **신호 농도**만 문제다. 다만 `panelOrder.ts` 는
  "경고는 몇 장이든 절대 접지 않는다"를 이유까지 적어 명시했고 SSOT Change Log(v4.04)에도 그렇게
  기록돼 있다 — 바꾸려면 그 결정을 뒤집는 승인이 필요하다. 카드 단위로 줄일 여지는 이미 없다(기본 상태
  경고 10장은 심사 뒤 의도적으로 남긴 것으로 같은 파일에 적혀 있다).
- **판올림 번호.** 자립 규약 ⑤⑥ 신설, `ssot-drift` 서버 창구 폴더 이관(`PluginServerHost` 계약) 등
  최근 변경이 아직 `docs/SCENARIO.md` Change Log 에 미기재다. 번호는 그 문서가 발급한다 — 코드 주석에서
  임의로 지어 붙이면 이미 다른 절이 쓰는 번호와 충돌한다(실제로 그렇게 12곳을 오염시킨 적이 있다).
