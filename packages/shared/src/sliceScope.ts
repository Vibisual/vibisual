/**
 * §9 **슬라이스 스코프드 스냅샷 — "지금 화면이 읽을 수 없는 슬라이스는 전선에 올리지 않는다."**
 * 규칙 단일 소유.
 *
 * 스코프드 구독의 **세 번째 축**이다. 앞의 둘과 자르는 방향만 다르고 규약은 그대로 상속한다.
 *  · 프로젝트 축(§9 스코프드 스냅샷 구독) — "아무도 안 보는 **프로젝트**는 보내지 않는다"
 *  · 폴더 축(`server/services/folderScope.ts`) — "한 프로젝트 안에서 안 그리는 **폴더**는 보내지 않는다"
 *  · **이 축** — 그 프로젝트·그 폴더를 보고 있어도 **아무 화면도 읽지 않는 슬라이스**는 보내지 않는다.
 *
 * 실측 근거(2026-09-02 라운드 뒤 전선 408.9KB): IDE 레인을 한 번도 안 열었으면 `agentReports`(240KB)·
 * `agentReviews`(153KB)·`agentQuestions`·`sessionGoals`(171KB) 를 **읽는 컴포넌트가 화면에 하나도 없다**.
 * 그런데도 그것들은 서버에서 만들어지고 → Electron IPC 의 동기 structuredClone 을 타고 → 렌더러에서
 * 역직렬화되고 → `structuralShare` 비교까지 받은 뒤 아무도 안 보는 채로 스토어에 앉는다.
 *
 * ── 함정 셋 (이걸 놓치면 데이터가 사라진다) ───────────────────────────────────────
 *
 * ① **반드시 창 선언의 합집합이어야 한다.** 창마다 다른 슬라이스를 보내고 싶어질 것이다 —
 *    그러면 증분이 깨진다. 서버 `broadcastBus.lastSentSlices` 는 **모듈 전역 기준점 하나**이고,
 *    모든 창에 같은 페이로드 한 벌이 나가는 것이 그 기준점이 성립하는 전제다. 창마다 페이로드가
 *    갈리는 순간 그 기준점이 어긋나 **증분이 틀린 값을 복원한다**(게임 네트워킹에서 매 패킷에 전
 *    객체를 싣지 않게 되면 기준점을 객체마다 따로 지정해야 한다고 경고하는 것과 같은 자리다).
 *    창별로 가르려면 기준점을 창마다 두는 훨씬 큰 작업이 먼저다 — 그건 이 축의 범위 밖이다.
 *
 * ② **받는 쪽은 "안 온 슬라이스"를 `{}` 로 덮으면 안 된다.** 클라 `useWebSocket.applyGraphSnapshot`
 *    은 `snap.bashHistory ?? {}` 처럼 없는 슬라이스를 빈 객체로 채워 넘긴다. 범위로 뺀 슬라이스가
 *    거기 걸리면 사용자 눈에는 **데이터가 날아간 것**으로 보인다. 그래서 이 파일이
 *    `carryForwardScopedSlices()` 를 함께 소유한다 — 안 온 슬라이스는 **직전 값을 그대로 이어받는다**.
 *
 * ③ **뺄 수 없는 슬라이스를 실수로 빼는 일이 구조적으로 불가능해야 한다.** 그래서 "뺄 수 있는 것"은
 *    아래 `SLICE_SCOPE_GROUPS` 에 **명시적으로 적힌 것뿐**이고, 그 표에 없는 슬라이스는 자동으로
 *    항상 실린다(빠뜨림이 곧 안전 쪽이다). 반대로 절대 빼면 안 되는 것은 `ALWAYS_SHIPPED_SLICES` 에
 *    근거와 함께 적어 두고, 두 표가 겹치면 **컴파일이 실패한다**(`SLICE_TABLES_ARE_DISJOINT`).
 *
 * ── 안전 기본값(앞의 두 축에서 그대로 상속) ──────────────────────────────────────
 *
 * · **아무도 선언하지 않았으면 전부 보낸다** — 구버전 클라·부팅 직후·모바일 접속. 침묵이 곧 축소가
 *   되면 그 창이 읽는 데이터가 영영 안 온다.
 * · **필드를 안 보내는 창이 하나라도 있으면 합집합이 통째로 전량**이 된다. 그 창은 자기가 무엇을
 *   읽는지 말할 방법이 없기 때문이다(폴더 축의 `folders` 미선언과 정확히 같은 규칙).
 * · 서버는 **적용한 범위를 스냅샷에 되돌려 준다**(`GraphSnapshot.scopedSlices`). 범위를 적용하지
 *   않았으면 싣지 않는다 — 구버전 클라에게는 종전과 한 글자도 다르지 않은 스냅샷이다.
 * · 전역 집계(`activeAgentCount`·`agentPhase`·`projects`·`stubProjects` …)는 **범위와 무관하게
 *   항상 전량**이다. 그것이 줄어드는 것은 최적화가 아니라 기능 손상이다(§9 ④).
 */

/**
 * **뺄 수 있는 슬라이스** — 그룹(= 화면 상태) → 그 상태가 실제로 읽는 슬라이스.
 *
 * 그룹 이름은 "어떤 화면이 켜져 있는가"이고, 값은 **코드로 확인한 독자 목록**이다. 확증하지 못한
 * 슬라이스는 여기 넣지 않는다 — 안 넣으면 종전대로 항상 실리므로 빠뜨림이 안전 쪽이다.
 *
 * ⚠ 새 슬라이스를 여기 넣기 전에 **그 슬라이스를 읽는 화면을 전부 찾아라**(`grep`). 한 곳이라도
 *   이 그룹 밖에 있으면 그 화면은 데이터가 영영 안 오고, 증상은 조용하다(빈 목록으로만 보인다).
 *
 * ⚠ 그리고 **읽기만 하는 슬라이스만 넣어라.** 클라가 스토어 값을 그대로 서버에 되돌려 쓰는
 *   슬라이스(전량 덮어쓰기 PUT)를 넣으면, 범위 밖에서 이어받은 값이 그 PUT 을 타고 나가 서버
 *   저장분을 옛것으로 강등시킨다. `agentMemos` 가 정확히 그 경우라 뺐다(`ALWAYS_SHIPPED_SLICES` 참조).
 */
export const SLICE_SCOPE_GROUPS = {
  /**
   * **IDE 레인이 열려 있다**(`selectRenderedIDEPaneKeys(state).length > 0`).
   *
   * 아래 여덟은 독자가 전부 `AgentIDEOverlay` 안쪽이다(2026-09-02 전수 확인):
   *  · `agentReports`      — IDEMainArea · IDESessionSummaryView · IDETabSortMenu
   *  · `agentReviews`      — 위와 같은 셋
   *  · `agentQuestions`    — 위와 같은 셋
   *  · `agentLists`        — IDEMainArea · IDESessionSummaryView
   *  · `sessionGoals`      — IDEActivityBar · IDESidebar
   *  · `verificationRuns`  — IDEActivityBar · IDEVerifyView · VerifyRecorderHost(VerifyDemoLayer)
   *  · `verificationDemos` — IDEVerifyView
   *
   * 앞의 셋은 지휘통제실(`CommandCenterBoard`)도 읽지만 그 창은 **선언 자체를 안 한다**(아래
   * `pluginAgentData` 주석의 창 구분 참조) — 미선언 창이 하나라도 있으면 합집합이 전량이 되므로
   * 지휘통제실을 열어 둔 동안에는 이 축이 아무것도 좁히지 않는다. 그것이 이 축의 안전 기본값이다.
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
  /**
   * **켠 플러그인이 에이전트 신고·리뷰를 읽는다**(`useActivePluginModules()` 의 `needs`).
   *
   * `plugins/host.tsx` 의 `usePluginData` 는 모듈이 `needs` 로 선언한 것만 스토어에서 꺼내는데,
   * 그 슬롯은 **캔버스 버블 배지**와 **DetailPanel 섹션**에 들어간다 — IDE 레인이 닫혀 있어도
   * 읽힐 수 있다는 뜻이다. 그래서 IDE 축과 **별도 그룹**으로 둔다: 플러그인을 안 켰거나 켠
   * 플러그인이 이 둘을 안 읽으면 IDE 축만으로 뺄 수 있다.
   */
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

/**
 * 스코프로 뺄 수 있는 슬라이스 **전량**(그룹 합집합, 선언 순서).
 *
 * 서버는 이 목록만 지우고, 클라는 이 목록만 이어받는다 — 한 벌이라 양쪽이 갈릴 수 없다.
 */
export const SCOPABLE_SLICE_KEYS: readonly ScopableSliceKey[] = collectScopableSliceKeys();

/**
 * **절대 뺄 수 없는 슬라이스와 그 근거.**
 *
 * 위 그룹 표에 없으면 어차피 안 빠지므로 이 표는 기능상 필수는 아니다 — 그런데도 두는 이유는,
 * 다음 사람이 "부피가 큰데 왜 안 빼나"를 물었을 때 **매번 다시 조사하지 않게** 하기 위해서다.
 * 여기 적힌 것을 그룹 표에 넣으면 `SLICE_TABLES_ARE_DISJOINT` 가 컴파일을 막는다.
 */
export const ALWAYS_SHIPPED_SLICES = {
  // ── 전역 집계·탭 표시 — §9 ④ "범위와 무관하게 항상 전량" ────────────────────────
  projects: '탭 목록. 사라지면 최적화가 아니라 기능 손상이다',
  stubProjects: '내려간 탭의 메타 — 위와 같은 칸',
  projectAgentCounts: '탭 배지(안 보는 프로젝트의 숫자도 보여야 한다)',
  activeAgentCount: '헤더의 "지금 몇 개 돌고 있나"',
  agentPhase: '헤더 상태 — 전역 집계',
  appState: '탭 라이프사이클 SSOT',
  fileSizeRange: '전량으로 잰 상대 척도(좁히면 버블 크기가 흔들린다)',
  readCountMaxByProject: '전량으로 잰 히트맵 척도 — 위와 같은 이유',

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
 * 전선에서 온 값이 우리가 아는 그룹 이름인가(모르는 값은 조용히 버린다 — 신뢰 경계).
 *
 * ⚠ `value in SLICE_SCOPE_GROUPS` 로 쓰면 안 된다 — `in` 은 **프로토타입 체인까지** 본다.
 *   그러면 `'toString'`·`'__proto__'` 같은 값이 통과하고, 그 뒤 `SLICE_SCOPE_GROUPS[group]` 이
 *   배열이 아닌 것을 돌려줘 합집합 계산이 던진다(= 전선에서 온 문자열 하나로 스냅샷이 멈춘다).
 */
export function isSliceScopeGroup(value: unknown): value is SliceScopeGroup {
  return typeof value === 'string' && GROUP_NAME_SET.has(value);
}

/**
 * 창들의 선언 → **이번 스냅샷에 실을 슬라이스 집합**.
 *
 * @param declarations 창마다 하나. `null` = "이 창은 슬라이스 축을 선언하지 않았다"(구버전 클라 ·
 *   자기가 무엇을 읽는지 말할 수 없는 창). 하나라도 있으면 **통째로 전량**이다.
 * @returns 실을 슬라이스 집합. `null` 이면 "전부 실어라"(범위 미적용).
 */
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
 * 조립이 끝난 스냅샷에서 **범위 밖 슬라이스를 지운다**(제거 지점을 한 곳으로 모으는 함수).
 *
 * 여러 자리에서 조금씩 빼면 한 곳만 빠져도 그 슬라이스가 조용히 계속 실린다(또는 반대로 조용히
 * 사라진다). 조립이 전부 끝난 **마지막 한 곳**에서 이 함수 하나로 자른다.
 *
 * @returns `snapshot` — 지운 사본(원본은 건드리지 않는다. 서버가 스냅샷 객체를 캐시해 재사용한다),
 *   `scopedSlices` — 실제로 실은 스코프 대상 슬라이스 목록(그대로 클라에 되돌려 준다).
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
 * §9 함정 ② 의 해소 — **범위로 빠진 슬라이스는 직전 값을 그대로 이어받는다.**
 *
 * 받는 쪽(`useWebSocket.materializeSnapshot`)이 구조적 공유를 태우기 **직전**에 부른다. 직전 값을
 * 그대로(같은 참조로) 넣으므로 ① 스토어의 `?? {}` 폴백에 닿지 않고 ② 이어지는 `structuralShare`
 * 가 같은 참조를 보고 그대로 흘려보내 **리렌더도 나지 않는다**.
 *
 * "범위를 적용했다"는 신고(`scopedSlices`)가 **있을 때만** 동작한다 — 그 필드가 없으면 서버가
 * 범위를 안 쓴 것이므로(구버전 서버 포함) 없는 슬라이스는 진짜로 없는 것이고, 이어받으면 오히려
 * 지워진 값이 되살아난다.
 *
 * @param prev 직전에 반영한 전체 스냅샷(`null` = 첫 스냅샷)
 * @param next 이번에 온 스냅샷(증분을 이미 푼 것)
 * @param scopedSlices 서버가 되돌려 준 "이번에 실은 스코프 대상 슬라이스". `undefined` = 범위 미적용
 * @returns 메울 것이 없으면 `next` **그대로**(사본을 만들지 않는다)
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
