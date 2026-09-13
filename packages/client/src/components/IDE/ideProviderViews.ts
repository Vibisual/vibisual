import type { IDEViewType } from '../../stores/graphStore.js';

/**
 * §5.19 (G) · §5.25 (M) — **프로바이더 버블**의 IDE 좌측 활동바에 남는 항목. **엔진마다 다르다.**
 *
 * 같은 IDE 를 쓰되 같은 얼굴을 하지는 않는다. 규율은 하나다 — **화면이 사실을 말한다.** 그 하나가
 * 두 방향으로 작동한다: 없는 기능의 입구는 거짓말이고(눌러 봐야 빈 화면), **있는 기능을 감추는
 * 것도 같은 거짓말**이다(사용자가 자기 엔진에 깔아 둔 것을 우리 창에서 못 본다).
 *
 * 그래서 목록은 `kind` 로 갈린다. 한때 이 파일은 "엔진별로 갈리지 않는 것이 옳다"고 적혀 있었는데,
 * 그것은 **로컬 모델에서 참인 문장을 코덱스에 그대로 옮긴** 실수였다 — 코덱스에는 MCP·스킬·
 * 플러그인·훅·규칙 문서가 **전부 있다**(`codex mcp` · `~/.codex/skills` · `codex plugin` ·
 * `~/.codex/hooks.json` · `AGENTS.md`). 확인은 그 CLI 의 공개 인터페이스로 했다.
 */

/** 어느 엔진에서도 뜻이 통하는 항목 — 우리 기능이거나 폴더처럼 엔진과 무관한 것들. */
// `goal`(세션 목표)과 `autoGoal`(§5.10 절차 감지)은 **우리 기능**이다 — 되풀이 관찰도 스킬 파일도
// 우리가 쌓고 우리가 읽는다. 어느 엔진의 버블이든 그 프로젝트에서 같은 자리에 같은 것이 쌓이므로 중립이다.
// 둘은 §5.10 (P) 에서 칸이 갈렸고, 갈린 뒤에도 둘 다 중립이다(엔진이 아니라 우리가 재는 것이므로).
const NEUTRAL_VIEWS: readonly IDEViewType[] = ['files', 'debug', 'bookmarks', 'goal', 'autoGoal', 'loop'];

/**
 * All Model(로컬 LLM) 버블에 남는 항목.
 *
 * 로컬 모델에는 MCP·스킬·플러그인·훅·주입원이 **정말로 없다** — 우리 러너가 프롬프트를 조립해
 * 직접 도는 것이 전부다. 그래서 중립 항목만 남는다(§5.19 (G) 원문 그대로).
 */
export const LOCAL_PROVIDER_VIEWS: readonly IDEViewType[] = NEUTRAL_VIEWS;

/**
 * 코덱스 버블에 남는 항목 — 중립 항목 + **코덱스가 실제로 들고 있는 다섯**.
 *
 * 다섯은 클로드 것을 빌려 그리지 않는다. 각각 코덱스 쪽 실물을 읽어 그린다(§5.25 (M)):
 * MCP=`codex mcp list --json` · 스킬=`~/.codex/skills/<이름>/` · 플러그인=`codex plugin list --json` ·
 * 훅=`~/.codex/hooks.json` · 컨텍스트=`AGENTS.md`(홈 + 이 프로젝트).
 *
 * **`subagents` 와 `reading` 이 빠진다.** 앞은 클로드 SDK 가 백단에 띄운 자식들을 보는 곳인데, 코덱스의
 * `codex agents` 는 자기 데몬에 붙는 **대화형 TUI** 라 우리 헤드리스 집계에 대응물이 없다.
 * 뒤(§5.11 정독 `specReading`)는 우리 기능이지만 재료가 **클로드 Code 의 `Read`/`Grep` 도구 이력**이다 — 다른 엔진은
 * 그 이름으로 열지 않으므로 원장이 영원히 비고, 그러면 이 칸은 "하나도 안 읽었다"를 늘 띄우는 거짓 화면이
 * 된다. 없는 것을 그리지 않는 쪽이 여기서는 여전히 옳다.
 *
 * **`verify` 는 자리만 같고 내용이 다르다(§5.25 (N)).** `/verify` 는 Claude Code 번들 스킬이라
 * 코덱스에는 없지만, 그 칸이 답하는 물음("이 변경 괜찮은가")에는 코덱스의 `codex review` 가
 * 대응한다. 그래서 칸은 남기되 **화면을 통째로 갈아 끼운다**(`IDECodexReviewView`) — 판정
 * (pass/fail/held)·시연·재시도는 앱을 띄워 본 클로드 검증의 것이라 빌려 오지 않는다.
 */
export const CODEX_PROVIDER_VIEWS: readonly IDEViewType[] = [
  ...NEUTRAL_VIEWS, 'mcp', 'hooks', 'plugins', 'skills', 'context', 'verify',
];

/** 이 엔진에 뜻이 있는 항목 목록. `undefined`(=클로드)면 `null` — 종전 그대로 전부 보인다. */
export function viewsForProviderKind(kind: string | undefined): readonly IDEViewType[] | null {
  if (kind === undefined) return null;
  if (kind === 'codex-cli') return CODEX_PROVIDER_VIEWS;
  return LOCAL_PROVIDER_VIEWS;
}

/** 이 항목이 지금 에이전트에게 뜻이 있는가. 프로바이더가 없으면(=클로드) 종전 그대로 전부 보인다. */
export function isViewAllowedForProvider(view: IDEViewType, providerKind: string | undefined): boolean {
  const allowed = viewsForProviderKind(providerKind);
  return allowed === null || allowed.includes(view);
}

/**
 * 지금 열려 있는 뷰가 이 에이전트에게 없는 것이면 대신 열 뷰.
 * 클로드 버블을 보다가 프로바이더 버블(All Model·코덱스)로 갈아탔을 때 사이드바가 빈 화면으로 남지 않게 한다.
 */
export function fallbackViewForProvider(view: IDEViewType, providerKind: string | undefined): IDEViewType {
  return isViewAllowedForProvider(view, providerKind) ? view : 'files';
}

/**
 * §5.25 (B) — 하단 상태바의 **정체 뱃지**가 무엇을 말할지. 위 목록과 마찬가지로 `kind` 로 갈린다 —
 * 여기서 하는 말이 곧 "이 창이 누구의 것인가"이기 때문이다.
 *
 * `switchable` — 로컬은 이 자리에서 바로 모델을 바꿀 창(`localModelWindow`)이 있지만, 코덱스 모델은
 * 버블 설정 창에서 고른다. 없는 창을 약속하는 손잡이를 두느니 누를 수 없게 둔다.
 */
export interface ProviderBadge {
  engine: 'local' | 'codex';
  /** 표시할 모델 이름. 아직 안 고른 버블은 빈 문자열이라 화면이 엔진 이름만 적는다. */
  model: string;
  switchable: boolean;
}

export function providerBadgeOf(
  provider: { kind?: string; modelId?: string; modelName?: string } | undefined | null,
): ProviderBadge | null {
  if (!provider) return null;
  if (provider.kind === 'codex-cli') {
    // 표시명이 없으면 slug 라도 적는다 — 빈 뱃지는 "모델이 없다"로 읽힌다.
    return { engine: 'codex', model: provider.modelName || provider.modelId || '', switchable: false };
  }
  return { engine: 'local', model: provider.modelName || '', switchable: true };
}
