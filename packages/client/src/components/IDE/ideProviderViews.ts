import type { AgentEngineKind } from '@vibisual/shared';
import type { IDEViewType } from '../../stores/graphStore.js';

/**
 * §5.19 (G)·§5.25 (M) — 프로바이더 버블의 활동바 항목(엔진별). 없는 기능의 입구도, 있는 기능을 감추는 것도 거짓말이다 —
 * 코덱스엔 다 있다(`codex mcp`·`~/.codex/skills`·`codex plugin`·`~/.codex/hooks.json`·`AGENTS.md`, 공개 CLI 로 확인).
 */

/** 어느 엔진에서도 뜻이 통하는 항목 — 우리 기능이거나 폴더처럼 엔진과 무관한 것들. */
// `goal`(세션 목표)과 `autoGoal`(§5.10 절차 감지)은 **우리 기능**이다 — 되풀이 관찰도 스킬 파일도
// 우리가 쌓고 우리가 읽는다. 어느 엔진의 버블이든 그 프로젝트에서 같은 자리에 같은 것이 쌓이므로 중립이다.
// 둘은 §5.10 (P) 에서 칸이 갈렸고, 갈린 뒤에도 둘 다 중립이다(엔진이 아니라 우리가 재는 것이므로).
const NEUTRAL_VIEWS: readonly IDEViewType[] = ['files', 'debug', 'bookmarks', 'goal', 'autoGoal', 'loop'];

/** §5.3 #10-4 — 로컬 엔진에선 안 도는 우리 기능 칸(오케스트라 — 지휘자가 Bash 로 loopback REST 를 치는데 로컬엔 그 도구가 없다). 세우면 죽은 스위치다. */
const CONDUCTING_VIEWS: readonly IDEViewType[] = ['orchestra'];

/** §5.3 #10-5 — 턴 사본 설정 덜어내기 칸(클로드·코덱스만). 판단이 그 CLI·모델 원장에 매여 가로채기가 claude|codex 에서만 걸린다(로컬은 덜 것이 없다). */
const TURN_CONFIG_VIEWS: readonly IDEViewType[] = ['configTrim'];

/** All Model(로컬 LLM) 버블 — 중립 항목만(§5.19 (G)). 로컬엔 MCP·스킬·플러그인·훅·주입원이 없다. */
export const LOCAL_PROVIDER_VIEWS: readonly IDEViewType[] = NEUTRAL_VIEWS;

/**
 * 코덱스 버블 — 중립 + 코덱스 실물 다섯(§5.25 (M)): MCP `codex mcp list --json` · 스킬 `~/.codex/skills/<이름>/` · 플러그인 `codex plugin list --json` · 훅 `~/.codex/hooks.json` · 컨텍스트 `AGENTS.md`.
 * `subagents`(`codex agents` 는 대화형 TUI)·`specReading`(재료가 클로드 `Read`/`Grep` 이력)은 뺀다 — 대응물이 없어 늘 빈 화면이다.
 * `verify` uses the common app-owned execution tools; Codex's git code review is a separate tab inside it.
 */
export const CODEX_PROVIDER_VIEWS: readonly IDEViewType[] = [
  ...NEUTRAL_VIEWS, ...CONDUCTING_VIEWS, ...TURN_CONFIG_VIEWS,
  'mcp', 'hooks', 'plugins', 'skills', 'context', 'verify',
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

/** §5.25 (M)·(M-1) — 그 칸을 코덱스 것으로 갈아 끼울까(`CODEX_VIEW_MAP`). 스킬만 실제 엔진(`agentEngineOf`) — 서버 스킬 API 가 그것으로 엔진을 정한다(공급자를 보면 Codex CMD 에서 거절). 나머지는 공급자. */
export function usesCodexPane(view: IDEViewType, providerKind: string | undefined, engine: AgentEngineKind): boolean {
  return view === 'skills' ? engine === 'codex' : providerKind === 'codex-cli';
}

/** §5.25 (B) — 상태바 정체 뱃지 내용(`kind` 로). `switchable` — 로컬은 `localModelWindow` 가 있고 코덱스 모델은 버블 설정에서 고르므로 누를 수 없게 둔다. */
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
