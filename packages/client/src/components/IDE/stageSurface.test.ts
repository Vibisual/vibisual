/**
 * §5.5 #17-17 ⑪(i)(j)·⑭(a) — **무대가 무엇을 비출지 고르는 계산**을 못 박는 시험.
 *
 * 비출 단계를 한 칸 잘못 고르면 화면은 그럴듯하다 — 남의 단계가 이 단계인 것처럼 서 있을 뿐
 * 오류는 나지 않는다. 그래서 눈이 아니라 여기서 지킨다.
 *
 * ⑭(a) 로 아래 화면 골격 칸이 회수되면서 그 칸만 쓰던 계산(시각 구간·로그 줄·문서 확장자·짧은
 * 경로)은 모듈에서 함께 걷었다 — 그 시험도 함께 걷는다(부르는 곳 없는 계산을 지키는 시험은
 * 다음 사람에게 "그 화면이 아직 있다"고 말한다).
 *
 * ㉒ 로 그 칸이 **실황**으로 돌아왔고, 걷었던 계산도 함께 돌아왔다 — 이번에는 아래 절반이 그것을
 * 지킨다. 구간이 한 칸 어긋나도 화면에는 아무 실패가 남지 않는다(남의 기록이 이 단계의 것으로
 * 보일 뿐이다). 확장자 판정은 **여기서 새로 만들지 않는다** — 워크스페이스 클릭이 쓰는 shared
 * 함수(`resolveWorkspaceOpen`)를 그대로 태우고, 그 한 벌인지를 `.svg` 예외로 확인한다.
 *
 * 화면은 건드리지 않는다(클라 테스트에는 DOM 이 없다) — 순수 함수만 본다.
 */
import { describe, it, expect } from 'vitest';
import {
  STAGE_WINDOW_FALLBACK_MS,
  VISUAL_KIND_SURFACES,
  type FileEdit,
  type SessionGoalStep,
  type VisualKindCard,
} from '@vibisual/shared';
import {
  STAGE_SURFACE_CHROME,
  bashInWindow,
  editsInWindow,
  effectiveSurface,
  focusStep,
  inWindow,
  isArtifactSurface,
  runningStep,
  stageArtifact,
  stepWindow,
  surfaceAppId,
  surfaceOf,
  webInWindow,
} from './stageSurface.js';

/** 단계 하나 — 시험이 신경 쓰는 칸만 채우고 나머지는 기본값. */
function step(over: Partial<SessionGoalStep> & { id: string }): SessionGoalStep {
  return { text: over.id, status: 'pending', updatedAt: 0, ...over };
}

const S = [
  step({ id: 'a', status: 'done', updatedAt: 1_000 }),
  step({ id: 'b', status: 'done', updatedAt: 2_000 }),
  step({ id: 'c', status: 'in_progress', updatedAt: 3_000 }),
  step({ id: 'd', status: 'pending', updatedAt: 0 }),
];

describe('⑪(j) runningStep · focusStep — 무대가 비출 단계', () => {
  it('도는 단계가 있으면 그것', () => {
    expect(runningStep(S)?.id).toBe('c');
    expect(focusStep(S)?.id).toBe('c');
  });

  it('도는 단계가 여럿이면 맨 앞(목록 순서가 진행 순서다)', () => {
    const two = [
      step({ id: 'x', status: 'in_progress', updatedAt: 1 }),
      step({ id: 'y', status: 'in_progress', updatedAt: 2 }),
    ];
    expect(runningStep(two)?.id).toBe('x');
  });

  it('다 끝났으면 마지막으로 끝낸 단계 — 빈 무대를 띄우지 않는다', () => {
    const done = [
      step({ id: 'a', status: 'done', updatedAt: 1 }),
      step({ id: 'b', status: 'done', updatedAt: 2 }),
    ];
    expect(runningStep(done)).toBeNull();
    expect(focusStep(done)?.id).toBe('b');
  });

  it('아무것도 손대지 않았으면 없다', () => {
    expect(focusStep([step({ id: 'a' })])).toBeNull();
    expect(focusStep([])).toBeNull();
  });
});

describe('⑪(i) surfaceOf — 종류 카드가 미리 표현할 한 줄을 고른다', () => {
  const kinds: Record<string, VisualKindCard> = {
    git: { key: 'git', label: 'Git', surface: 'diff', refCount: 0, status: 'active', createdAt: 0, updatedAt: 0 },
    bare: { key: 'bare', label: 'Bare', refCount: 0, status: 'active', createdAt: 0, updatedAt: 0 },
  };

  it('카드가 고른 골격을 그대로 쓴다', () => {
    expect(surfaceOf(step({ id: 'a', kind: 'git' }), kinds)).toBe('diff');
  });

  it('종류가 없거나 카드가 없거나 골격을 안 골랐으면 none', () => {
    expect(surfaceOf(step({ id: 'a' }), kinds)).toBe('none');
    expect(surfaceOf(step({ id: 'a', kind: 'gone' }), kinds)).toBe('none');
    expect(surfaceOf(step({ id: 'a', kind: 'bare' }), kinds)).toBe('none');
    expect(surfaceOf(null, kinds)).toBe('none');
  });
});

// ─── ㉒ 실황 — 그 단계가 지금 만들고 있는 것을 고르는 계산 ─────────────────────────────

describe('㉒(c) stepWindow — 한 단계가 차지하는 시각 구간', () => {
  it('도는 단계는 시작한 때부터 지금까지(끝이 열려 있다)', () => {
    const win = stepWindow(S, 'c');
    expect(win).not.toBeNull();
    expect(win!.from).toBe(3_000);
    expect(win!.to).toBe(Number.POSITIVE_INFINITY);
  });

  it('끝난 단계는 앞 단계가 끝난 때부터 자기가 끝난 때까지', () => {
    expect(stepWindow(S, 'b')).toEqual({ from: 1_000, to: 2_000 });
  });

  it('아직인 단계는 null — 일어나지 않은 일에 실황을 붙이지 않는다', () => {
    expect(stepWindow(S, 'd')).toBeNull();
  });

  it('없는 단계·빈 id 도 null', () => {
    expect(stepWindow(S, 'nope')).toBeNull();
    expect(stepWindow(S, null)).toBeNull();
  });

  it('앞 단계가 없으면 되돌림 창만큼 뒤로 연다 — 첫 단계가 늘 빈 화면이 되지 않게', () => {
    const win = stepWindow(S, 'a');
    expect(win).toEqual({ from: 1_000 - STAGE_WINDOW_FALLBACK_MS, to: 1_000 });
  });

  it('목록 순서가 손으로 섞였어도 값으로 견준다 — 뒤 단계의 시각이 앞에 있어도 안전하다', () => {
    const mixed = [
      step({ id: 'late', status: 'done', updatedAt: 9_000 }),
      step({ id: 'early', status: 'done', updatedAt: 1_000 }),
      step({ id: 'mid', status: 'done', updatedAt: 5_000 }),
    ];
    // 'mid' 앞에 놓인 것 중 5_000 보다 이른 것은 1_000 하나다(9_000 은 이 단계보다 늦다).
    expect(stepWindow(mixed, 'mid')).toEqual({ from: 1_000, to: 5_000 });
  });
});

describe('㉒(c) 구간으로 자르기 — 장부를 새로 만들지 않는다', () => {
  const edits: Record<string, FileEdit[]> = {
    n1: [
      { id: 'e1', filePath: 'c:/p/a.ts', oldString: 'x', newString: 'y', timestamp: 1_500 },
      { id: 'e2', filePath: 'c:/p/a.ts', oldString: 'y', newString: 'z', timestamp: 1_900 },
      { id: 'e3', filePath: 'c:/p/b.png', oldString: '', newString: '', timestamp: 1_800 },
    ],
    n2: [{ id: 'e4', filePath: 'c:/p/old.ts', oldString: '', newString: '', timestamp: 500 }],
  };

  it('구간 안의 것만, 파일 하나당 가장 최근 것 한 줄로 접어 최신순', () => {
    const out = editsInWindow(edits, { from: 1_000, to: 2_000 }, 8);
    expect(out.map((e) => e.id)).toEqual(['e2', 'e3']);
  });

  it('구간 밖의 파일은 고르지 않는다', () => {
    expect(editsInWindow(edits, { from: 1_000, to: 2_000 }, 8).some((e) => e.id === 'e4')).toBe(false);
  });

  it('구간이 없으면 빈 목록 — 아직인 단계에 남의 기록을 붙이지 않는다', () => {
    expect(editsInWindow(edits, null, 8)).toEqual([]);
    expect(bashInWindow({ n: [{ id: 'b', command: 'ls', timestamp: 1_500 }] }, null, 8)).toEqual([]);
    expect(webInWindow({ d: [{ id: 'w', kind: 'fetch', url: 'https://a/b', at: 1_500 }] }, null, 8)).toEqual([]);
  });

  it('경계 시각은 포함이다 — 같은 ms 에 찍힌 기록을 버리지 않는다', () => {
    expect(inWindow(2_000, { from: 1_000, to: 2_000 })).toBe(true);
    expect(inWindow(1_000, { from: 1_000, to: 2_000 })).toBe(true);
    expect(inWindow(2_001, { from: 1_000, to: 2_000 })).toBe(false);
  });

  it('명령·웹도 같은 구간 규칙으로 최신순', () => {
    const shells = bashInWindow(
      { n: [
        { id: 'b1', command: 'a', timestamp: 1_100 },
        { id: 'b2', command: 'b', timestamp: 1_900 },
        { id: 'b3', command: 'c', timestamp: 9_000 },
      ] },
      { from: 1_000, to: 2_000 },
      8,
    );
    expect(shells.map((s) => s.id)).toEqual(['b2', 'b1']);
    const webs = webInWindow(
      { d: [
        { id: 'w1', kind: 'search', query: 'q', at: 1_200 },
        { id: 'w2', kind: 'fetch', url: 'https://h/p', at: 1_800 },
      ] },
      { from: 1_000, to: 2_000 },
      8,
    );
    expect(webs.map((w) => w.id)).toEqual(['w2', 'w1']);
  });
});

describe('㉒(c) stageArtifact — 확장자 표를 무대가 들지 않는다', () => {
  /** 앱이 스스로 선언한 것을 그대로 넘기는 모양(§5.13 (R-1) `workspaceOpenClaims`). */
  const claims = [
    { appId: 'vibi3d', opens: ['.glb', '.gltf'] },
    { appId: 'vibistudio', opens: ['.mp4'] },
    { appId: 'vibisound', opens: ['.wav'] },
  ];
  const edits: FileEdit[] = [
    { id: 'e1', filePath: 'c:/p/notes.md', oldString: '', newString: '', timestamp: 9 },
    { id: 'e2', filePath: 'c:/p/hero.GLB', oldString: '', newString: '', timestamp: 8 },
    { id: 'e3', filePath: 'c:/p/shot.png', oldString: '', newString: '', timestamp: 7 },
  ];

  it('그 골격이 여는 확장자를 처음 만나는 파일 하나(대소문자 무관)', () => {
    expect(stageArtifact('model3d', edits, claims)).toBe('c:/p/hero.GLB');
  });

  it('그림은 앱이 아니라 **워크스페이스 클릭과 같은 판정**으로 고른다', () => {
    expect(stageArtifact('image', edits, claims)).toBe('c:/p/shot.png');
  });

  it('그쪽 예외까지 함께 따른다 — `.svg` 는 그림이 아니라 편집창으로 간다', () => {
    const svg: FileEdit[] = [{ id: 's', filePath: 'c:/p/icon.svg', oldString: '', newString: '', timestamp: 1 }];
    // 판정이 두 벌이면 "무대에는 보이는데 눌러도 안 열리는 파일"이 생긴다 — 한 벌이라 여기서 같이 막힌다.
    expect(stageArtifact('image', svg, claims)).toBeNull();
  });

  it('없으면 null — 빈 뷰어를 세우지 않는다', () => {
    expect(stageArtifact('video', edits, claims)).toBeNull();
    expect(stageArtifact('audio', edits, claims)).toBeNull();
  });

  it('산출물 골격이 아니면 애초에 고르지 않는다', () => {
    expect(stageArtifact('source', edits, claims)).toBeNull();
    expect(stageArtifact('none', edits, claims)).toBeNull();
  });

  it('앱이 청구를 안 냈으면 null — 표를 무대가 지어내지 않는다', () => {
    expect(stageArtifact('model3d', edits, [])).toBeNull();
  });

  it('산출물 골격 판정 · 앱 이름은 표에서만 온다', () => {
    expect(isArtifactSurface('model3d')).toBe(true);
    expect(isArtifactSurface('image')).toBe(true);
    expect(isArtifactSurface('source')).toBe(false);
    expect(surfaceAppId('model3d')).toBe('vibi3d');
    expect(surfaceAppId('image')).toBeNull();
  });
});

describe('㉒(d) 골격 표 — 유니온 전부를 덮는다', () => {
  it('골격마다 색과 그림이 있다 — 빠지면 그 골격만 무채색으로 서는데 원래 증상과 구별되지 않는다', () => {
    for (const key of VISUAL_KIND_SURFACES) {
      const chrome = STAGE_SURFACE_CHROME[key];
      expect(chrome, `골격 ${key} 가 표에 없다`).toBeDefined();
      expect(chrome.accent).toMatch(/^#[0-9A-Fa-f]{6}$/u);
      expect(chrome.glyph.length).toBeGreaterThan(4);
    }
  });

  it('표에 유니온 밖의 골격이 섞여 있지 않다', () => {
    expect(Object.keys(STAGE_SURFACE_CHROME).sort()).toEqual([...VISUAL_KIND_SURFACES].sort());
  });

  it('산출물 넷이 유니온에 있다 — ㉒(a) 가 늘린 축', () => {
    for (const key of ['image', 'model3d', 'video', 'audio'] as const) {
      expect(VISUAL_KIND_SURFACES).toContain(key);
    }
  });

  it('글리프는 stroke path 문자열이다 — 웹 이미지 ❌(⑪(b) 규율)', () => {
    for (const key of VISUAL_KIND_SURFACES) {
      expect(STAGE_SURFACE_CHROME[key].glyph).not.toContain('http');
      expect(STAGE_SURFACE_CHROME[key].glyph).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]+$/u);
    }
  });
});

describe('㉒(d) effectiveSurface — none 은 "안 골랐다"이지 "볼 것이 없다"가 아니다', () => {
  it('종류를 안 골랐어도 고친 파일이 있으면 소스로 읽는다 — [추종]을 켜고도 빈 화면이 되지 않게', () => {
    expect(effectiveSurface('none', true)).toBe('source');
  });

  it('고친 것이 없으면 종전대로 none — 칸이 서지 않는다(⑭(a) 가 걷어낸 그 빈 안내 한 줄 ❌)', () => {
    expect(effectiveSurface('none', false)).toBe('none');
  });

  it('카드가 고른 골격은 그대로 둔다 — 파일이 없다고 골격을 바꾸지 않는다', () => {
    for (const key of VISUAL_KIND_SURFACES) {
      if (key === 'none') continue;
      expect(effectiveSurface(key, false)).toBe(key);
      expect(effectiveSurface(key, true)).toBe(key);
    }
  });
});
