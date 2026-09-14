import { describe, it, expect } from 'vitest';
import type { ModelRegistry, ModelRegistryEntry } from '@vibisual/shared';
import {
  MODEL_SECTION_CARD_WIDTH,
  formatCheckedAgo,
  modelListCheckedAt,
  modelListSourcesOf,
  modelSectionApplyTiming,
  placeModelSectionCard,
} from './modelSectionView.js';

/**
 * §4 (상태바 모델 칸 ②③) — 설정창을 **모델 구역만** 연 카드.
 *
 * 고정하는 것 —
 *  (가) 카드는 상태바 칸 **위**에 붙고, 뷰포트 밖으로 밀려나지 않는다.
 *  (나) 머리의 "목록 확인 N분 전 · 출처"가 **실제로 실린 출처만** 말한다.
 *  (다) 바꾼 값이 언제부터 먹는지 갈래마다 맞는 말을 한다.
 *  (라) 이 카드는 새 설정창이 아니다 — 모델·강도 손잡이는 설정창 소스에 **한 벌뿐**이다.
 */

const entry = (id: string, source: ModelRegistryEntry['source']): ModelRegistryEntry => ({
  id, family: id.split('-')[1] ?? 'opus', source,
});

const registry = (entries: ModelRegistryEntry[], extra: Partial<ModelRegistry> = {}): ModelRegistry => ({
  entries,
  updatedAt: 1_000,
  sourceMix: 'seed-only',
  ...extra,
});

describe('(가) placeModelSectionCard — 칸 위에 붙는 자리', () => {
  const viewport = { w: 1600, h: 900 };
  /** 창 바닥 상태바의 모델 칸. */
  const chip = { left: 420, top: 870, right: 560, bottom: 890 };

  it('상태바 칸 위로 연다 — 카드 아래 변이 칸 바로 위에 온다', () => {
    const p = placeModelSectionCard(chip, viewport);
    expect(p.top).toBeUndefined();
    expect(p.bottom).toBe(viewport.h - chip.top + 6);
    expect(p.left).toBe(chip.left);
    expect(p.width).toBe(MODEL_SECTION_CARD_WIDTH);
    // 위로 자라는 높이는 칸 위의 남은 공간을 넘지 않는다(화면 꼭대기 밖으로 안 나간다).
    expect(p.maxHeight).toBe(chip.top - 6 - 8);
  });

  it('칸이 오른쪽 끝에 있으면 카드를 뷰포트 안으로 밀어 넣는다', () => {
    const p = placeModelSectionCard({ left: 1500, top: 870, right: 1590, bottom: 890 }, viewport);
    expect(p.left + p.width).toBeLessThanOrEqual(viewport.w - 8);
  });

  it('창이 카드보다 좁으면 카드 폭을 줄인다', () => {
    const p = placeModelSectionCard({ left: 10, top: 600, right: 80, bottom: 620 }, { w: 320, h: 640 });
    expect(p.width).toBe(320 - 16);
    expect(p.left).toBe(8);
  });

  it('화면 꼭대기에 붙은 작은 창이라 위 공간이 모자라면 아래로 뒤집는다', () => {
    const p = placeModelSectionCard({ left: 100, top: 120, right: 200, bottom: 140 }, viewport);
    expect(p.bottom).toBeUndefined();
    expect(p.top).toBe(140 + 6);
    expect(p.maxHeight).toBe(viewport.h - 140 - 6 - 8);
  });

  it('위가 충분하면 아래가 더 넓어도 위로 연다 — 상태바의 제자리는 위다', () => {
    const p = placeModelSectionCard({ left: 100, top: 400, right: 200, bottom: 420 }, viewport);
    expect(p.bottom).toBeDefined();
  });
});

describe('(나) 목록 출처·확인 시각', () => {
  it('키가 없는 PC — 공개 문서만 적는다(공식 API 를 받아 온 척하지 않는다)', () => {
    expect(modelListSourcesOf(registry([entry('claude-opus-5', 'seed')]))).toEqual(['seed']);
  });

  it('API 를 머지했으면 공식 API 를, 대화록에서 배운 항목이 있으면 사용 기록을 붙인다', () => {
    const reg = registry(
      [entry('claude-opus-5', 'api'), entry('claude-fable-9', 'observed')],
      { sourceMix: 'api-merged' },
    );
    expect(modelListSourcesOf(reg)).toEqual(['seed', 'api', 'observed']);
    expect(modelListSourcesOf(registry([entry('claude-fable-9', 'observed')]))).toEqual(['seed', 'observed']);
  });

  it('레지스트리가 아직 없으면 출처도 없다', () => {
    expect(modelListSourcesOf(null)).toEqual([]);
    expect(modelListSourcesOf(undefined)).toEqual([]);
  });

  it('확인 시각은 checkedAt, 없으면(구버전 서버) updatedAt', () => {
    expect(modelListCheckedAt(registry([], { checkedAt: 5_000 }))).toBe(5_000);
    expect(modelListCheckedAt(registry([]))).toBe(1_000);
    expect(modelListCheckedAt(registry([], { updatedAt: 0 }))).toBeNull();
    expect(modelListCheckedAt(null)).toBeNull();
  });

  // 기준 시각은 실제 날짜로 둔다 — 작은 수로 두면 "3일 전"이 음수 시각이 되어 "모름"으로 떨어진다.
  const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);

  it('상대 시각은 그 언어로 말한다 — 새 i18n 키 없이', () => {
    const now = NOW;
    expect(formatCheckedAgo(now - 5_000, now, 'en')).toBe('now');
    expect(formatCheckedAgo(now - 3 * 60_000, now, 'en')).toBe('3 minutes ago');
    expect(formatCheckedAgo(now - 2 * 3_600_000, now, 'en')).toBe('2 hours ago');
    expect(formatCheckedAgo(now - 3 * 86_400_000, now, 'en')).toBe('3 days ago');
    expect(formatCheckedAgo(now - 3 * 60_000, now, 'ko')).toBe('3분 전');
  });

  it('모르는 시각은 null, 미래 시각(시계 어긋남)은 "지금"으로 접는다', () => {
    const now = NOW;
    expect(formatCheckedAgo(null, now, 'en')).toBeNull();
    expect(formatCheckedAgo(0, now, 'en')).toBeNull();
    expect(formatCheckedAgo(Number.NaN, now, 'en')).toBeNull();
    expect(formatCheckedAgo(now + 120_000, now, 'en')).toBe('now');
  });

  it('못 알아듣는 로케일 태그에도 창이 무너지지 않는다', () => {
    expect(() => formatCheckedAgo(1_000, 61_000, 'xx-invalid-@@')).not.toThrow();
    expect(formatCheckedAgo(1_000, 61_000, 'xx-invalid-@@')).toBeTypeOf('string');
  });
});

describe('(다) 바꾼 값이 언제부터 먹는가', () => {
  it('헤드리스 클로드는 다음 턴, CMD 는 새 세션, 코덱스는 코덱스 안내문', () => {
    expect(modelSectionApplyTiming({ isLocal: false, isCodex: false, isCmdAgent: false })).toBe('nextTurn');
    expect(modelSectionApplyTiming({ isLocal: false, isCodex: false, isCmdAgent: true })).toBe('newSession');
    expect(modelSectionApplyTiming({ isLocal: false, isCodex: true, isCmdAgent: false })).toBe('codex');
  });

  it('로컬은 따로 적지 않는다 — 모델 칸 도움말이 이미 말한다', () => {
    expect(modelSectionApplyTiming({ isLocal: true, isCodex: false, isCmdAgent: false })).toBeNull();
  });
});

// ─── (라) 소스 확인 — 모델 구역 카드는 설정창의 **같은 손잡이**를 쓴다 ───

// 파일마다 따로 부른다 — 같은 폴더 파일의 키는 `./` 로 시작해 넓은 패턴 하나로 모으면 키가 갈린다.
const tsxSources = {
  ...import.meta.glob('./AgentConfigPopup.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../IDE/IDEStatusBar.tsx', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

function readSource(path: string): string {
  const text = tsxSources[path];
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error(`소스를 읽지 못했습니다: ${path}. vitest 를 packages/client 에서 실행하세요(레포 루트 ❌).`);
  }
  return text;
}

const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

describe('(라) 모델 구역 카드는 새 설정창이 아니다', () => {
  const popup = readSource('./AgentConfigPopup.tsx');

  it('모델·버전·강도·확장 사고 손잡이는 설정창 소스에 한 벌뿐이다 — 카드용 사본이 없다', () => {
    // 사본이 생기면 한쪽만 고쳐지는 날이 온다(칸 규칙·diff 점·저장 필드). 카드는 같은 조각을 부른다.
    expect(countOf(popup, 'onChange={handleModelChange}')).toBe(1);
    expect(countOf(popup, 'onChange={(e) => handleVersionChange(e.target.value)}')).toBe(1);
    expect(countOf(popup, 'onChange={setEffort}')).toBe(1);
    expect(countOf(popup, 'onChange={(e) => setThinking(e.target.checked)}')).toBe(1);
    expect(countOf(popup, 'onChange={setCodexModelId}')).toBe(1);
    expect(countOf(popup, 'onChange={setCodexEffort}')).toBe(1);
  });

  it('저장은 한 창구다 — 카드도 전량 페이로드(buildPayload) PUT 을 탄다', () => {
    // 부분 페이로드는 서버에서 나머지 축을 기본값으로 강등시킨다.
    expect(countOf(popup, 'const handleSave = useCallback(')).toBe(1);
    expect(popup).not.toMatch(/JSON\.stringify\(\{\s*model\b/);
  });

  it('상태바는 새 창을 만들지 않고 같은 설정창을 section="model" 로 연다', () => {
    const statusBar = readSource('../IDE/IDEStatusBar.tsx');
    expect(statusBar).toContain("from '../Panel/AgentConfigPopup.js'");
    expect(statusBar).toContain('section="model"');
  });
});
