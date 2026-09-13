import { describe, expect, it } from 'vitest';
import type { IDEViewType } from '../../stores/graphStore.js';
import {
  LOCAL_PROVIDER_VIEWS, CODEX_PROVIDER_VIEWS, viewsForProviderKind,
  fallbackViewForProvider, isViewAllowedForProvider, providerBadgeOf,
} from './ideProviderViews.js';

/**
 * §5.19 (G) · §5.25 (M) — 활동바 항목이 **엔진마다** 무엇이 남는가를 목록으로 못 박는다.
 * 나중에 항목이 하나 늘 때 "이건 어느 엔진에 뜻이 있나"를 여기서 한 번 더 묻게 하는 것이 목적이다.
 *
 * **판정이 `kind` 를 보는 것은 의도다.** 한때 이 파일은 반대로("엔진을 가르지 않는 것이 옳다")
 * 적혀 있었는데, 그것은 로컬 모델에서 참인 문장을 코덱스에 그대로 옮긴 실수였다 — 코덱스에는
 * MCP·스킬·플러그인·훅·규칙 문서가 전부 있고, 감추면 사용자가 자기 것을 우리 창에서 못 본다.
 */

const CLAUDE = undefined;
const LOCAL = 'local-llama';
const CODEX = 'codex-cli';
/**
 * 어느 엔진에도 대응물이 없는 것 — 클로드 SDK 가 백단에 띄운 자식 목록과, 재료가 클로드 도구 이력인
 * §5.11 정독(`Read`/`Grep` 영수증). 다른 엔진에 열어 주면 늘 빈 원장을 "안 읽었다"로 그린다.
 */
const CLAUDE_ONLY: IDEViewType[] = ['subagents', 'specReading'];
/** 로컬에는 없지만 **코덱스에는 대응물이 있는** 여섯. 이 배열이 이 회차의 요점이다. */
const CODEX_HAS_TOO: IDEViewType[] = ['mcp', 'context', 'skills', 'hooks', 'plugins', 'verify'];

describe('§5.19 (G) · §5.25 (M) 엔진별 활동바', () => {
  it('클로드 버블은 종전 그대로 전부 보인다', () => {
    for (const v of [...CLAUDE_ONLY, ...CODEX_HAS_TOO, ...LOCAL_PROVIDER_VIEWS]) {
      expect(isViewAllowedForProvider(v, CLAUDE)).toBe(true);
    }
    expect(viewsForProviderKind(CLAUDE)).toBeNull();
  });

  it('로컬 버블에서는 클로드 CLI 에 매인 항목이 전부 빠진다(§5.19 (G) 그대로)', () => {
    for (const v of [...CLAUDE_ONLY, ...CODEX_HAS_TOO]) {
      expect(isViewAllowedForProvider(v, LOCAL)).toBe(false);
    }
    // §5.10 (P) — `autoGoal`(절차 감지)이 `goal` 에서 갈라져 나와 여기도 한 칸 늘었다.
    expect([...LOCAL_PROVIDER_VIEWS].sort()).toEqual(['autoGoal', 'bookmarks', 'debug', 'files', 'goal', 'loop']);
  });

  it('코덱스 버블에는 다섯이 **되살아난다** — 코덱스에 실제로 있는 기능이다', () => {
    for (const v of CODEX_HAS_TOO) expect(isViewAllowedForProvider(v, CODEX)).toBe(true);
  });

  it('코덱스에도 대응물이 없는 것은 여전히 빠진다', () => {
    // `codex agents` 는 자기 데몬에 붙는 대화형 TUI 라 우리 헤드리스 집계에 대응물이 없다.
    expect(isViewAllowedForProvider('subagents', CODEX)).toBe(false);
    // 로컬에는 그 여섯이 정말 없으므로 §5.19 (G) 는 그대로다.
    expect(isViewAllowedForProvider('verify', LOCAL)).toBe(false);
  });

  it('검증 칸은 코덱스에 **남는다** — 화면만 `codex review` 로 갈아 끼운다(§5.25 (N))', () => {
    expect(isViewAllowedForProvider('verify', CODEX)).toBe(true);
    expect(fallbackViewForProvider('verify', CODEX)).toBe('verify');
  });

  it('중립 항목은 두 엔진에 똑같이 남는다', () => {
    for (const v of LOCAL_PROVIDER_VIEWS) {
      expect(isViewAllowedForProvider(v, LOCAL)).toBe(true);
      expect(isViewAllowedForProvider(v, CODEX)).toBe(true);
    }
  });

  it('코덱스 목록은 로컬 목록을 **품는다**(중립 항목이 한쪽에서만 빠지지 않게)', () => {
    for (const v of LOCAL_PROVIDER_VIEWS) expect(CODEX_PROVIDER_VIEWS).toContain(v);
    expect(CODEX_PROVIDER_VIEWS.length).toBe(LOCAL_PROVIDER_VIEWS.length + CODEX_HAS_TOO.length);
  });

  it('없는 뷰가 열려 있으면 파일로 떨어뜨린다(빈 사이드바 ❌)', () => {
    expect(fallbackViewForProvider('mcp', LOCAL)).toBe('files');
    expect(fallbackViewForProvider('plugins', LOCAL)).toBe('files');
    expect(fallbackViewForProvider('debug', LOCAL)).toBe('debug');
    expect(fallbackViewForProvider('mcp', CLAUDE)).toBe('mcp');
    // 코덱스에서는 MCP 가 남으므로 **떨어뜨리지 않는다** — 여기가 뒤집힌 자리다.
    expect(fallbackViewForProvider('mcp', CODEX)).toBe('mcp');
    expect(fallbackViewForProvider('subagents', CODEX)).toBe('files');
  });

  it('모르는 엔진은 가장 좁은 쪽(로컬 목록)으로 읽는다', () => {
    // 새 엔진이 붙었는데 이 파일을 안 고쳤을 때, 없는 기능의 입구를 여는 쪽으로 기울지 않게.
    expect(isViewAllowedForProvider('mcp', 'some-future-engine')).toBe(false);
    expect(isViewAllowedForProvider('files', 'some-future-engine')).toBe(true);
  });
});

/**
 * §5.25 (B) — 하단 상태바 정체 뱃지. **`!!provider` 로 묶으면 코덱스 버블이 `All Model` 이라고
 * 말하고, 눌리면 로컬 모델 설치 창을 연다** — 실제로 그렇게 돼 있던 자리라 여기 못 박는다.
 */
describe('§5.25 (B) 프로바이더 정체 뱃지', () => {
  it('클로드 버블에는 뱃지가 없다', () => {
    expect(providerBadgeOf(undefined)).toBeNull();
    expect(providerBadgeOf(null)).toBeNull();
  });

  it('코덱스 버블은 코덱스라고 말하고, 로컬 모델 창으로 가지 않는다', () => {
    const badge = providerBadgeOf({ kind: 'codex-cli', modelId: 'gpt-5-codex', modelName: 'GPT-5 Codex' });
    expect(badge).toEqual({ engine: 'codex', model: 'GPT-5 Codex', switchable: false });
  });

  it('코덱스는 표시명이 없으면 slug 라도 적는다(빈 뱃지 ❌)', () => {
    expect(providerBadgeOf({ kind: 'codex-cli', modelId: 'gpt-5-codex' })?.model).toBe('gpt-5-codex');
  });

  it('아직 모델을 안 문 코덱스 버블은 엔진 이름만 남는다', () => {
    expect(providerBadgeOf({ kind: 'codex-cli', modelId: '' })).toEqual({
      engine: 'codex', model: '', switchable: false,
    });
  });

  it('로컬 버블은 종전 그대로 — All Model 이고 여기서 모델을 바꾼다', () => {
    expect(providerBadgeOf({ kind: 'local-llama', modelId: 'q4.gguf', modelName: 'Qwen 7B' })).toEqual({
      engine: 'local', model: 'Qwen 7B', switchable: true,
    });
  });
});


/**
 * §5.25 (M) — **입구를 열었으면 그 안이 코덱스 것이어야 한다.**
 *
 * 위 블록은 "코덱스 활동바에 어느 칸이 서는가"를 못 박는다. 그런데 칸이 서는 것과 그 칸이
 * **코덱스 내용을 그리는 것**은 다른 문제다: `CODEX_PROVIDER_VIEWS` 에만 이름을 넣고
 * `IDESidebar` 의 `CODEX_VIEW_MAP` 에 짝을 안 넣으면, 그 칸은 **클로드 목록을 그대로 그린다** —
 * 감추는 거짓말을 고치려다 더 나쁜 거짓말(이 대화에 실리지도 않는 것을 보여 주기)을 하게 된다.
 * `IDECodexViews.tsx` 머리말이 스스로 경고해 둔 사고이고, 그 어긋남을 여기서 잡는다.
 *
 * 컴포넌트를 import 하면 React 트리가 통째로 딸려 오므로(클라 테스트에는 DOM 이 없다)
 * **소스를 문자열로 읽어** 표의 키만 본다 — `popupDismissContract.test.ts` 가 쓰는 방식 그대로다.
 */
const sidebarSource = import.meta.glob('./IDESidebar.tsx', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

/** 엔진과 무관한 칸 — 우리 기능이거나 폴더라 코덱스도 같은 화면을 쓴다(갈아 끼울 것이 없다). */
const ENGINE_NEUTRAL: IDEViewType[] = ['files', 'debug', 'bookmarks', 'goal', 'autoGoal', 'loop'];

describe('§5.25 (M) 코덱스 칸은 코덱스 화면을 그린다', () => {
  /** `CODEX_VIEW_MAP` 리터럴 안의 키 이름들. */
  function codexMappedViews(): string[] {
    const src = Object.values(sidebarSource)[0] ?? '';
    const start = src.indexOf('CODEX_VIEW_MAP');
    expect(start).toBeGreaterThan(-1);
    const open = src.indexOf('{', start);
    const close = src.indexOf('\n};', open);
    expect(close).toBeGreaterThan(open);
    const body = src.slice(open, close);
    return [...body.matchAll(/^\s{2}(\w+):\s*IDECodex/gm)].map((m) => m[1] ?? '');
  }

  it('코덱스에 열어 준 칸은 **중립 칸을 빼고 전부** 코덱스 화면으로 갈아 끼워져 있다', () => {
    const mapped = new Set(codexMappedViews());
    const needsOwnView = CODEX_PROVIDER_VIEWS.filter((v) => !ENGINE_NEUTRAL.includes(v));
    for (const v of needsOwnView) {
      // 여기서 걸리면: 활동바에는 칸이 섰는데 그 안은 **클로드 목록**이 뜨고 있다.
      expect(mapped.has(v), `'${v}' 칸이 CODEX_VIEW_MAP 에 없다 — 클로드 화면이 그대로 뜬다`).toBe(true);
    }
  });

  it('코덱스에 없는 칸을 갈아 끼우지 않는다 — 열지도 않은 문의 화면을 만들어 두지 않는다', () => {
    for (const v of codexMappedViews()) {
      expect(CODEX_PROVIDER_VIEWS, `'${v}' 는 코덱스 활동바에 없는데 화면만 있다`)
        .toContain(v as IDEViewType);
    }
  });

  it('중립 칸은 갈아 끼우지 않는다 — 두 벌이 되면 한쪽만 고쳐지는 날이 온다', () => {
    const mapped = new Set(codexMappedViews());
    for (const v of ENGINE_NEUTRAL) expect(mapped.has(v)).toBe(false);
  });
});
