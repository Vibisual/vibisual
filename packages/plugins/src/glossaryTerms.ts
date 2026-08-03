/**
 * §5.11 v4.33 — 원문 용어 ↔ 카드 대응표.
 *
 * `catalog.test.ts` 는 `CATALOG.md` 와 등록부를 맞대 본다. 그런데 **그 카탈로그도 내가 쓴 것**이라,
 * 원문에서 용어 하나를 통째로 빠뜨렸다면 양쪽이 사이좋게 틀린 채로 통과한다. 실제로 그런 적이 있다 —
 * 29번(Agent Registry)이 빠져 있었는데 카탈로그도 같이 빠져 있어서 "110/110 완료"로 보였다.
 *
 * 그래서 대조 기준을 **원문에서 직접 뽑아** 여기 고정한다. 이 표는 카탈로그에서 유도하지 않았다.
 * 용어 번호와 이름만 담는다 — 원문의 정의·설명 문장은 담지 않는다(공개 저장소).
 *
 * 한 용어가 두 카드가 되기도, 두 용어가 한 카드를 나눠 쓰기도 한다. 그 예외는 표 안에 그대로 드러난다.
 */

export interface GlossaryTerm {
  /** 원문 번호(1~110). */
  n: number;
  /** 원문 표제어. */
  term: string;
  /** 이 용어를 담당하는 플러그인 id. 보통 하나, 성격이 갈리면 둘. */
  cards: string[];
}

/**
 * 등록돼 있지만 원문 용어에서 나오지 않은 카드.
 * 늘리기 전에 한 번 더 생각할 것 — 여기 넣으면 원문 대조에서 빠진다.
 */
export const DERIVED_CARDS: readonly string[] = ['mcp-client-inventory'];

export const GLOSSARY_TERMS: readonly GlossaryTerm[] = [
  { n:   1, term: "SSOT",                                        cards: ['ssot-drift'] },
  { n:   2, term: "ADR",                                         cards: ['adr-presence'] },
  { n:   3, term: "Idempotency",                                 cards: ['idempotency'] },
  { n:   4, term: "Separation of Concerns",                      cards: ['separation-of-concerns'] },
  { n:   5, term: "Event-Driven Architecture",                   cards: ['event-driven'] },
  { n:   6, term: "Backpressure",                                cards: ['backpressure'] },
  { n:   7, term: "Graceful Degradation",                        cards: ['graceful-degradation'] },
  { n:   8, term: "Atomic Write",                                cards: ['atomic-write'] },
  { n:   9, term: "Schema Evolution",                            cards: ['schema-evolution'] },
  { n:  10, term: "Durable Execution",                           cards: ['durable-execution'] },
  { n:  11, term: "Agent Harness",                               cards: ['agent-harness'] },
  { n:  12, term: "Scaffold",                                    cards: ['scaffold'] },
  { n:  13, term: "Agent Loop",                                  cards: ['agent-loop'] },
  { n:  14, term: "Long-Horizon Task",                           cards: ['long-horizon'] },
  { n:  15, term: "Subagent",                                    cards: ['subagent'] },
  { n:  16, term: "Orchestrator / Supervisor",                   cards: ['orchestrator'] },
  { n:  17, term: "Fan-out / Parallel Orchestration",            cards: ['fan-out'] },
  { n:  18, term: "Handoff",                                     cards: ['handoff-packet'] },
  { n:  19, term: "Tool Use / Function Calling",                 cards: ['tool-use'] },
  { n:  20, term: "Hook",                                        cards: ['hook-lifecycle'] },
  { n:  21, term: "MCP",                                         cards: ['mcp-server'] },
  { n:  22, term: "A2A",                                         cards: ['a2a'] },
  { n:  23, term: "ACP / ANP",                                   cards: ['acp-anp'] },
  { n:  24, term: "AGENTS.md",                                   cards: ['agents-md'] },
  { n:  25, term: "Agent Card",                                  cards: ['agent-card'] },
  { n:  26, term: "Agent Skills",                                cards: ['agent-skills'] },
  { n:  27, term: "Structured Output",                           cards: ['structured-output'] },
  { n:  28, term: "Tool Search / Programmatic Tool Calling",     cards: ['tool-search'] },
  { n:  29, term: "Agent Registry",                              cards: ['agent-registry'] },
  { n:  30, term: "Computer Use / GUI Agent",                    cards: ['computer-use'] },
  { n:  31, term: "Context Engineering",                         cards: ['context-engineering'] },
  { n:  32, term: "Context Rot",                                 cards: ['context-rot'] },
  { n:  33, term: "Context Pollution",                           cards: ['context-pollution'] },
  { n:  34, term: "Compaction",                                  cards: ['compaction-watch'] },
  { n:  35, term: "Context Editing / Tool Result Clearing",      cards: ['context-editing'] },
  { n:  36, term: "Progressive Disclosure",                      cards: ['progressive-disclosure'] },
  { n:  37, term: "Token Budget",                                cards: ['token-budget'] },
  { n:  38, term: "Prompt Caching",                              cards: ['prompt-caching'] },
  { n:  39, term: "System Prompt",                               cards: ['system-prompt'] },
  { n:  40, term: "Instruction Drift",                           cards: ['instruction-drift'] },
  { n:  41, term: "Context Window",                              cards: ['context-window'] },
  { n:  42, term: "Test-Time Compute",                           cards: ['test-time-compute'] },
  { n:  43, term: "Extended Thinking",                           cards: ['extended-thinking'] },
  { n:  44, term: "Reasoning Effort",                            cards: ['reasoning-effort'] },
  { n:  45, term: "Overthinking",                                cards: ['reasoning-effort'] },
  { n:  46, term: "ReAct",                                       cards: ['react-pattern'] },
  { n:  47, term: "Reflexion / Self-Critique",                   cards: ['reflexion'] },
  { n:  48, term: "Plan-and-Execute",                            cards: ['plan-and-execute'] },
  { n:  49, term: "Verifier–Critic",                             cards: ['verifier-critic'] },
  { n:  50, term: "Model Routing / Cascade",                     cards: ['model-routing'] },
  { n:  51, term: "Working Memory",                              cards: ['working-memory'] },
  { n:  52, term: "Episodic Memory",                             cards: ['episodic-memory'] },
  { n:  53, term: "Semantic Memory",                             cards: ['semantic-memory'] },
  { n:  54, term: "Procedural Memory",                           cards: ['procedural-memory'] },
  { n:  55, term: "Memory Tool",                                 cards: ['memory-tool'] },
  { n:  56, term: "Memory Consolidation",                        cards: ['memory-consolidation'] },
  { n:  57, term: "Forgetting Policy",                           cards: ['forgetting-policy'] },
  { n:  58, term: "Memory Invalidation",                         cards: ['memory-invalidation'] },
  { n:  59, term: "Supersede / Validity Window",                 cards: ['supersede'] },
  { n:  60, term: "Memory Drift",                                cards: ['memory-drift'] },
  { n:  61, term: "RAG",                                         cards: ['rag'] },
  { n:  62, term: "Agentic RAG",                                 cards: ['agentic-rag'] },
  { n:  63, term: "Grounding",                                   cards: ['grounding'] },
  { n:  64, term: "Chunking",                                    cards: ['chunking'] },
  { n:  65, term: "Reranking",                                   cards: ['reranking'] },
  { n:  66, term: "Hybrid Search",                               cards: ['hybrid-search'] },
  { n:  67, term: "Multi-hop Retrieval",                         cards: ['multi-hop'] },
  { n:  68, term: "Query Rewriting",                             cards: ['query-rewriting'] },
  { n:  69, term: "Vector Database",                             cards: ['vector-db'] },
  { n:  70, term: "Agentic File Search",                         cards: ['agentic-file-search'] },
  { n:  71, term: "Eval",                                        cards: ['eval'] },
  { n:  72, term: "Eval-Driven Development",                     cards: ['eval-driven-development'] },
  { n:  73, term: "LLM-as-Judge",                                cards: ['llm-as-judge'] },
  { n:  74, term: "Trajectory Eval",                             cards: ['trajectory-eval'] },
  { n:  75, term: "Golden Set",                                  cards: ['golden-set'] },
  { n:  76, term: "Benchmark Saturation / Contamination",        cards: ['benchmark-hygiene'] },
  { n:  77, term: "Trace / Span",                                cards: ['trace-span'] },
  { n:  78, term: "Observability",                               cards: ['observability'] },
  { n:  79, term: "Hallucination",                               cards: ['hallucination-guard'] },
  { n:  80, term: "Cost per Task",                               cards: ['cost-per-task'] },
  { n:  81, term: "Prompt Injection (Indirect)",                 cards: ['prompt-injection'] },
  { n:  82, term: "Lethal Trifecta",                             cards: ['lethal-trifecta'] },
  { n:  83, term: "OWASP ASI Top 10",                            cards: ['owasp-asi'] },
  { n:  84, term: "Agent Goal Hijack",                           cards: ['goal-hijack'] },
  { n:  85, term: "Tool Misuse",                                 cards: ['tool-misuse'] },
  { n:  86, term: "Memory Poisoning",                            cards: ['memory-poisoning'] },
  { n:  87, term: "Agentic Supply Chain",                        cards: ['agentic-supply-chain'] },
  { n:  88, term: "Data Exfiltration",                           cards: ['data-exfiltration'] },
  { n:  89, term: "Cascading Failure",                           cards: ['cascading-failure'] },
  { n:  90, term: "Rogue Agent",                                 cards: ['rogue-agent'] },
  { n:  91, term: "Containment",                                 cards: ['containment'] },
  { n:  92, term: "Blast Radius",                                cards: ['blast-radius'] },
  { n:  93, term: "Least Privilege",                             cards: ['least-privilege'] },
  { n:  94, term: "Non-Human Identity",                          cards: ['non-human-identity'] },
  { n:  95, term: "Sandboxing",                                  cards: ['sandboxing'] },
  { n:  96, term: "Guardrails",                                  cards: ['guardrails'] },
  { n:  97, term: "Allowlist",                                   cards: ['allowlist'] },
  { n:  98, term: "Human-in-the-Loop / Reversibility",           cards: ['human-in-the-loop'] },
  { n:  99, term: "Kill Switch",                                 cards: ['kill-switch'] },
  { n: 100, term: "Audit Trail & Autonomy Level",                cards: ['audit-trail', 'autonomy-level'] },
  { n: 101, term: "Vibe Coding",                                 cards: ['vibe-coding'] },
  { n: 102, term: "Spec-Driven Development",                     cards: ['spec-driven'] },
  { n: 103, term: "Agentic Engineering",                         cards: ['agentic-engineering'] },
  { n: 104, term: "Hybrid Workflow",                             cards: ['hybrid-workflow'] },
  { n: 105, term: "Rescue Engineering",                          cards: ['rescue-engineering'] },
  { n: 106, term: "Worktree Isolation",                          cards: ['worktree-isolation'] },
  { n: 107, term: "Pre-commit Gate",                             cards: ['pre-commit-gate'] },
  { n: 108, term: "Review Gate",                                 cards: ['review-gate'] },
  { n: 109, term: "Regression Suite",                            cards: ['regression-suite'] },
  { n: 110, term: "Scope Creep (and Scope Shrink)",              cards: ['scope-creep'] },
];
