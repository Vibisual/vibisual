import type { AgentEngineKind, EngineChoice, UserDefaults } from '@vibisual/shared';
import type { ProjectPresenceInput } from '../Auth/projectFolderGateFlow.js';
import { hasProjectFolder } from '../Auth/projectFolderGateFlow.js';

/**
 * §5.25 (C) — **첫 진입 엔진 선택 관문의 판정만** 모아 둔 곳.
 *
 * `setupGateFlow.ts`·`projectFolderGateFlow.ts` 와 같은 자리·같은 이유다: 게이트 발화 조건은
 * `useEffect` 의존성에 얽히기 쉽고, 얽힌 판정은 렌더 없이 검사할 수 없어 회귀를 두 번 잡게 된다.
 *
 * **이 관문은 기본값만 정한다.** 고른 엔진이 새 에이전트의 기본이 될 뿐, 나머지 둘이 잠기지
 * 않는다 — 셋 다 언제든 병행해 쓸 수 있고, 옵션창에서 나중에 다른 엔진도 준비할 수 있다.
 */

/**
 * 게이트 판정에 쓰는 "지금 이 사람의 엔진".
 *
 * **기록이 없으면 클로드다.** 이 앱은 클로드 전용으로 시작했으므로, 이미 쓰고 있던 사용자에게
 * `engineChoice` 가 없는 것은 "안 골랐다"가 아니라 "고를 이유가 없던 시절부터 클로드였다"는 뜻이다.
 * 여기서 `undefined` 를 "미정"으로 읽으면 그 사람들의 설치·로그인 게이트가 전부 침묵한다.
 */
export function engineForGating(choice: EngineChoice | undefined): AgentEngineKind {
  return choice?.kind ?? 'claude';
}

/**
 * 관문이 화면에 있어야 하는가.
 *
 * 자동으로 뜨는 조건이 **첫 진입 한 번**으로 좁혀져 있다:
 *  - `userDefaults` 가 아직 안 왔으면 뜨지 않는다(모르는 상태로 물으면 이미 고른 사람에게도 뜬다).
 *  - 이미 고른 기록이 있으면 뜨지 않는다(켤 때마다 묻는 창은 두 번째부터 방해다).
 *  - **프로젝트 폴더가 이미 있으면 뜨지 않는다.** 쓰고 있던 사람에게 난데없이 엔진을 고르라고
 *    묻는 화면이 되기 때문이다 — 그 사람들에게 이 관문은 옵션창의 [엔진] 칸으로 존재한다.
 *
 * `forced`(옵션창에서 직접 열기)는 위 조건을 전부 건너뛴다.
 */
export function isEngineChooserOpen(input: {
  userDefaults: UserDefaults | null;
  presence: ProjectPresenceInput;
  forced: boolean;
  dismissed: boolean;
}): boolean {
  const { userDefaults, presence, forced, dismissed } = input;
  if (forced) return true;
  if (!userDefaults) return false;
  if (userDefaults.engineChoice) return false;
  if (dismissed) return false;
  return !hasProjectFolder(presence);
}

/**
 * 엔진을 고른 뒤 **어느 관문으로 넘길 것인가**.
 *
 * 셋 다 "설치 → 로그인 → 폴더" 라는 같은 계단을 쓰되 첫 칸이 다르다:
 *  - 클로드·코덱스는 각자의 설치 게이트로(그 게이트가 로그인으로 이어 준다).
 *  - 로컬은 앱 차원의 설치·로그인 칸이 없다. 엔진 받기와 모델 고르기는 **버블에 매인** All Model
 *    창 안에서 일어나는데(§5.19 (B)), 첫 진입에는 아직 버블이 없다 — 버블을 만들려면 폴더가
 *    먼저다. 그래서 로컬은 마지막 칸(폴더)으로 바로 넘긴다. 거기서 우클릭 한 번이면 그 창이 뜬다.
 */
export type EngineHandoff = 'claude-setup' | 'codex-setup' | 'project-folder';

export function handoffForEngine(engine: AgentEngineKind): EngineHandoff {
  if (engine === 'codex') return 'codex-setup';
  if (engine === 'local') return 'project-folder';
  return 'claude-setup';
}

/**
 * 클로드 설치·로그인 게이트가 **저절로** 떠도 되는가.
 *
 * 코덱스나 로컬을 고른 사람에게 클로드 설치 창이 뜨면, 방금 "이걸 쓰겠다"고 답한 것을 무시하고
 * 다른 제품을 깔라고 막아서는 화면이 된다. 그렇다고 클로드를 못 쓰게 막지는 않는다 — 배너와
 * 옵션창은 그대로 남아 있어 언제든 직접 열 수 있다(그때는 `forced` 라 이 판정을 타지 않는다).
 */
export function claudeGatesMayAutoOpen(choice: EngineChoice | undefined): boolean {
  return engineForGating(choice) === 'claude';
}

/**
 * 코덱스 설치·로그인 게이트가 **저절로** 떠도 되는가. 위 판정의 짝이다.
 *
 * 클로드와 달리 "기록 없음"은 코덱스가 아니다 — 코덱스는 사용자가 고른 적이 있을 때만 관문을
 * 세운다. 안 그러면 코덱스를 모르는 사람에게 새 설치 창이 하나 더 생긴다.
 */
export function codexGatesMayAutoOpen(choice: EngineChoice | undefined): boolean {
  return choice?.kind === 'codex';
}
