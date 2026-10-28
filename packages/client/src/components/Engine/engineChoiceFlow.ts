import type { AgentEngineKind, EngineChoice, UserDefaults } from '@vibisual/shared';
import type { ProjectPresenceInput } from '../Auth/projectFolderGateFlow.js';
import { hasProjectFolder } from '../Auth/projectFolderGateFlow.js';

/** §5.25 (C) — 첫 진입 관문 판정만 모은 곳(`setupGateFlow.ts` 와 같은 이유 — 렌더 없이 검사). 기본값만 정한다 — 나머지 엔진은 잠기지 않는다. */

/** **기록이 없으면 클로드다** — `engineChoice` 없는 기존 사용자는 엔진 선택 이전부터 클로드였다. "미정"으로 읽으면 그들의 설치·로그인 게이트가 침묵한다. */
export function engineForGating(choice: EngineChoice | undefined): AgentEngineKind {
  return choice?.kind ?? 'claude';
}

/** 자동으로는 첫 진입 한 번만: `userDefaults` 가 아직 없거나, 고른 기록이 있거나, 프로젝트 폴더가 이미 있으면 뜨지 않는다. `forced` 는 전부 건너뛴다. */
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

/** 첫 칸만 다르다: 클로드·코덱스는 각자의 설치 게이트로. 로컬은 폴더로 바로 — 엔진·모델은 버블에 매인 All Model 창(§5.19 (B))이라 버블(그 전에 폴더)이 먼저다. */
export type EngineHandoff = 'claude-setup' | 'codex-setup' | 'project-folder';

export function handoffForEngine(engine: AgentEngineKind): EngineHandoff {
  if (engine === 'codex') return 'codex-setup';
  if (engine === 'local') return 'project-folder';
  return 'claude-setup';
}

/** 코덱스·로컬을 고른 사람에겐 저절로 뜨지 않는다(방금 고른 답을 무시하게 된다). 직접 열기는 `forced` 라 이 판정을 타지 않는다. */
export function claudeGatesMayAutoOpen(choice: EngineChoice | undefined): boolean {
  return engineForGating(choice) === 'claude';
}

/** 위 판정의 짝 — "기록 없음"은 코덱스가 아니다. 고른 적이 있을 때만 세운다. */
export function codexGatesMayAutoOpen(choice: EngineChoice | undefined): boolean {
  return choice?.kind === 'codex';
}
