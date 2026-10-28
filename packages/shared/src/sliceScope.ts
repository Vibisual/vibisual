/**
 * §9 슬라이스 스코프드 스냅샷 — 어떤 화면도 읽지 않는 슬라이스는 전선에 올리지 않는다(프로젝트 축·폴더 축 `folderScope.ts` 에 이은 세 번째 축).
 * 함정 셋: ① 창 선언의 합집합이어야 한다 — 기준점 `broadcastBus.lastSentSlices` 가 전역 하나라 창마다 갈리면 증분이 틀린 값을 복원한다.
 * ② 안 온 슬라이스를 `{}` 로 덮지 마라(`applyGraphSnapshot` 의 `?? {}`) — `carryForwardScopedSlices()` 가 직전 값을 잇는다.
 * ③ 뺄 수 있는 것은 `SLICE_SCOPE_GROUPS`, 못 빼는 것은 `ALWAYS_SHIPPED_SLICES` — 겹치면 컴파일 실패(`SLICE_TABLES_ARE_DISJOINT`).
 * 미선언 창이 하나라도 있으면 전량, 적용한 범위는 `GraphSnapshot.scopedSlices` 로 돌려준다. 전역 집계(`activeAgentCount`·`agentPhase`·`projects`·`stubProjects` …)는 늘 전량(§9 ④).
 */

/**
 * 뺄 수 있는 슬라이스 — 그룹(화면 상태) → 코드로 확인한 독자 목록. 확증 못 한 것은 넣지 않는다.
 * ⚠ 넣기 전에 읽는 화면을 전부 찾아라 — 하나라도 그룹 밖이면 데이터가 영영 안 온다(빈 목록으로만 보인다).
 * ⚠ 서버에 되돌려 쓰는(전량 PUT) 슬라이스는 넣지 마라 — 이어받은 옛 값이 저장분을 강등시킨다(`agentMemos`).
 */
export const SLICE_SCOPE_GROUPS = {
  /**
   * IDE 레인이 열려 있다(`selectRenderedIDEPaneKeys(state).length > 0`). 아래 일곱의 독자는 전부 `AgentIDEOverlay` 안이다(2026-09-02 전수 확인 —
   * IDEMainArea·IDETabSortMenu·IDEActivityBar·IDESidebar·IDEVerifyView·VerifyRecorderHost). 앞의 셋은 지휘통제실(`CommandCenterBoard`)도 읽지만
   * 그 창은 선언을 안 해서, 열려 있는 동안 합집합이 전량이 된다(안전 기본값).
   */
  ideLane: [
    'agentReports',
    'agentReviews',
    'agentQuestions',
    'agentLists',
    'sessionGoals',
    'verificationRuns',
    'verificationDemos',
  ],
  /** 켠 플러그인의 `needs` 가 에이전트 신고·리뷰를 읽는다 — 그 슬롯(`usePluginData`)은 버블 배지·DetailPanel 이라 IDE 레인이 닫혀도 읽혀 별도 그룹이다. */
  pluginAgentData: [
    'agentReports',
    'agentReviews',
  ],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** `SLICE_SCOPE_GROUPS` 의 그룹 이름 하나(= 클라이언트가 선언하는 값). */
export type SliceScopeGroup = keyof typeof SLICE_SCOPE_GROUPS;

/** 스코프로 **뺄 수 있는** 슬라이스 키 하나. 어느 그룹에도 없는 슬라이스는 이 타입에 들어오지 못한다. */
export type ScopableSliceKey = (typeof SLICE_SCOPE_GROUPS)[SliceScopeGroup][number];

/** 그룹 이름 전량(선언 검증·테스트용). */
export const SLICE_SCOPE_GROUP_NAMES: readonly SliceScopeGroup[] =
  Object.keys(SLICE_SCOPE_GROUPS) as SliceScopeGroup[];

function collectScopableSliceKeys(): ScopableSliceKey[] {
  const out: ScopableSliceKey[] = [];
  const seen = new Set<string>();
  for (const group of SLICE_SCOPE_GROUP_NAMES) {
    for (const key of SLICE_SCOPE_GROUPS[group]) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/** 스코프로 뺄 수 있는 슬라이스 전량(그룹 합집합, 선언 순서). 서버는 이 목록만 지우고 클라는 이 목록만 잇는다(한 벌이라 갈릴 수 없다). */
export const SCOPABLE_SLICE_KEYS: readonly ScopableSliceKey[] = collectScopableSliceKeys();

/** 절대 못 빼는 슬라이스와 근거 — 기능상 필수는 아니지만 "큰데 왜 안 빼나"를 다시 조사하지 않게 둔다. 그룹 표와 겹치면 컴파일이 막는다. */
export const ALWAYS_SHIPPED_SLICES = {
  // ── 전역 집계·탭 표시 — §9 ④ "범위와 무관하게 항상 전량" ────────────────────────
  projects: '탭 목록. 사라지면 최적화가 아니라 기능 손상이다',
  stubProjects: '내려간 탭의 메타 — 위와 같은 칸',
  projectAgentCounts: '탭 배지(안 보는 프로젝트의 숫자도 보여야 한다)',
  activeAgentCount: '헤더의 "지금 몇 개 돌고 있나"',
  agentPhase: '헤더 상태 — 전역 집계',
  appState: '탭 라이프사이클 SSOT',
  fileSizeRange: '전량으로 잰 상대 척도(좁히면 버블 크기가 흔들린다)',
  readCountMaxByProject: '전량으로 잰 히트맵 척도(읽기 축) — 위와 같은 이유',
  writeCountMaxByProject: '전량으로 잰 히트맵 척도(쓰기 축) — 읽기 축과 한 쌍이라 같은 칸이다',
  readCountQuantilesByProject: '전량으로 잰 히트 분포 표본(읽기 축) — 좁히면 순위가 뒤집혀 색이 통째로 바뀐다',
  writeCountQuantilesByProject: '전량으로 잰 히트 분포 표본(쓰기 축) — 읽기 축과 한 쌍이라 같은 칸이다',

  // ── 캔버스 골격 — 버블·엣지가 사라지면 화면이 빈다 ────────────────────────────
  agents: '캔버스의 에이전트 버블',
  topFolders: '캔버스의 최상위 폴더 버블',
  children: '폴더 축이 이미 좁힌다 — 두 축이 같은 슬라이스를 자르면 서로를 못 본다',
  edges: '캔버스 화살표',
  innerEdges: '폴더 축 소관 — children 과 같은 칸',
  satellites: '폴더 축 소관 — 에이전트 위성은 폴더 안에서도 메인 캔버스에 그려진다',
  nodeProjects: '노드 → 프로젝트 귀속. 캔버스 필터의 입력이라 빠지면 버블이 통째로 안 그려진다',
  agentProjects: '위와 같은 칸(에이전트 판)',
  subAgents: '버블 안 세션 목록 — 캔버스 배지가 읽는다',
  agentEvents: '버블 활동 표시 · DetailPanel',
  brainInjections: 'BubbleNode 가 직접 읽는다(캔버스) — IDE 와 무관',

  // ── 화면이 항상 켜져 있거나, 켜짐을 스토어에서 읽을 수 없는 것 ─────────────────
  auditLogs: 'AuditPill 이 헤더에 상시 마운트돼 늘 읽는다',
  costMaps:
    '독자는 UsagePopup 안(CostPill·CostMapPopup)뿐이지만 그 팝업의 열림이 UsagePill 의 **컴포넌트 지역 상태**라 ' +
    '스토어에서 읽을 수 없다 — 확증 못 한 것은 스코프 대상에서 뺀다(안전 기본값)',
  agentFeedbacks: 'DetailPanel 의 AgentFeedbackSection(캔버스 패널)이 읽는다 — IDE 전용이 아니다',
  agentMemos:
    '독자는 IDE 안(IDEMainArea·SessionMemoLayer)뿐이라 뺄 수 있어 보이지만, **클라가 이 슬라이스를 ' +
    '서버에 되돌려 쓴다** — `PUT /api/session-memos` 는 스토어의 목록 **전량**을 그대로 덮는다. ' +
    '범위 밖에 있던 동안의 값을 이어받은 채로 그 PUT 이 나가면 서버 저장분이 옛 목록으로 강등된다 ' +
    '(이 레포에 `/api/agent-config/:agentId` 부분 페이로드 사고 전례가 있다). **읽기만 하는 슬라이스만 ' +
    '스코프 대상이 된다** — 되돌려 쓰는 슬라이스는 여기 남긴다',
  fileEdits: 'Bash·파일 버블이 캔버스에서 읽는다',
  bashHistory: '위와 같은 칸',
  domainEntries: 'DetailPanel(캔버스 패널)이 읽는다',
} as const satisfies Readonly<Record<string, string>>;

/** `ALWAYS_SHIPPED_SLICES` 의 키 하나. */
export type AlwaysShippedSliceKey = keyof typeof ALWAYS_SHIPPED_SLICES;

/**
 * **컴파일 타임 교차 검사.** 두 표에 같은 슬라이스가 들어가면 이 줄이 `never` 로 좁혀져 빌드가 깨진다 —
 * "절대 못 뺀다"고 적어 둔 것을 뺄 수 있는 표에 넣는 사고를 문서가 아니라 타입이 막는다.
 */
export const SLICE_TABLES_ARE_DISJOINT: Extract<AlwaysShippedSliceKey, ScopableSliceKey> extends never
  ? true
  : never = true;

/** 그룹 이름 조회용 집합. `in` 연산자를 쓰지 않는 이유는 바로 아래 주석. */
const GROUP_NAME_SET: ReadonlySet<string> = new Set<string>(SLICE_SCOPE_GROUP_NAMES);

/**
 * 전선 값이 아는 그룹 이름인가(모르면 버린다). ⚠ `in` 으로 쓰지 마라 — 프로토타입 체인까지 봐 `'toString'`·`'__proto__'` 가 통과하고
 * 합집합 계산이 던져 스냅샷이 멈춘다.
 */
export function isSliceScopeGroup(value: unknown): value is SliceScopeGroup {
  return typeof value === 'string' && GROUP_NAME_SET.has(value);
}

/** 창들의 선언 → 실을 슬라이스 집합(`null` = 전부 실어라). 선언이 `null` 인 창(구버전 클라 등)이 하나라도 있으면 전량이다. */
export function resolveSliceShipSet(
  declarations: Iterable<Iterable<SliceScopeGroup> | null>,
): ReadonlySet<ScopableSliceKey> | null {
  const ship = new Set<ScopableSliceKey>();
  let declaredAny = false;
  for (const declared of declarations) {
    // 선언 안 한 창이 하나라도 있으면 좁히지 않는다 — 그 창은 자기가 읽는 것을 말할 수 없다.
    if (declared === null) return null;
    declaredAny = true;
    for (const group of declared) {
      // 전선을 건너온 값이 여기까지 올 수 있다 — 모르는 이름은 조용히 버린다(던지면 스냅샷이 멈춘다).
      if (!isSliceScopeGroup(group)) continue;
      for (const key of SLICE_SCOPE_GROUPS[group]) ship.add(key);
    }
  }
  // 아무 창도 선언하지 않았다(부팅 직후 · 붙은 창이 없음) — 침묵은 축소가 아니다.
  if (!declaredAny) return null;
  return ship;
}

/**
 * 조립이 끝난 스냅샷에서 범위 밖 슬라이스를 지우는 유일한 자리(여러 곳에서 빼면 한 곳만 빠져도 조용히 실리거나 사라진다).
 * 돌려주는 것은 지운 사본(원본은 서버가 캐시해 재사용한다)과 실제로 실은 `scopedSlices`(클라에 그대로 돌려준다).
 */
export function stripScopedOutSlices<T extends object>(
  snapshot: T,
  ship: ReadonlySet<ScopableSliceKey>,
): { snapshot: T; scopedSlices: ScopableSliceKey[] } {
  const out: Record<string, unknown> = { ...(snapshot as unknown as Record<string, unknown>) };
  const scopedSlices: ScopableSliceKey[] = [];
  for (const key of SCOPABLE_SLICE_KEYS) {
    if (ship.has(key)) {
      scopedSlices.push(key);
      continue;
    }
    delete out[key];
  }
  return { snapshot: out as unknown as T, scopedSlices };
}

/**
 * §9 함정 ② — 범위로 빠진 슬라이스는 직전 값을 같은 참조로 잇는다. `materializeSnapshot` 이 구조적 공유 직전에 불러 `?? {}` 폴백에 안 닿고 리렌더도 없다.
 * `scopedSlices` 가 있을 때만 — 없으면(구버전 서버 포함) 없는 것은 진짜 없는 것이라 이으면 지운 값이 되살아난다.
 * `prev` 가 `null` 이면 첫 스냅샷, `next` 는 증분을 이미 푼 것, `scopedSlices` 가 `undefined` 면 범위 미적용. 메울 것이 없으면 `next` 그대로.
 */
export function carryForwardScopedSlices<T extends object>(
  prev: T | null,
  next: T,
  scopedSlices: readonly string[] | undefined,
): T {
  if (scopedSlices === undefined || prev === null) return next;
  const shipped = new Set<string>(scopedSlices);
  const prevRec = prev as unknown as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const key of SCOPABLE_SLICE_KEYS) {
    if (shipped.has(key)) continue;
    const carried = prevRec[key];
    if (carried === undefined) continue; // 직전에도 없던 것 — 이어받을 값이 없다
    if (out === null) out = { ...(next as unknown as Record<string, unknown>) };
    out[key] = carried;
  }
  return out === null ? next : (out as unknown as T);
}
