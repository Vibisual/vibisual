/**
 * §5.10 v3.81 단계 ① — dry-run 감사기 단위 테스트.
 *
 * 이 감사기는 **사람이 이행 여부를 판단할 근거**를 만드는 물건이라, 분류 규칙(정규식·키 제안)이
 * 조용히 틀리면 잘못된 근거로 이행 결정을 내리게 된다. 그래서 코드를 다시 읽는 대신 테스트로 잡는다
 * (기억 카드 [card-ms5uhpz6-rapr] — 분류 패턴 오류는 테스트가 훨씬 신뢰할 수 있게 발견한다).
 *
 * 디스크가 필요한 것은 출처(연결 파일) 판정뿐이라 그 테스트에서만 임시 폴더를 쓴다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrainCard } from '@vibisual/shared';
import { analyzeBrainMigration, subjectFromFile, suggestCanonicalKey } from './brainMigration.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-brainmig-'));
});

afterEach(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

/** 테스트용 카드 1장 — 필요한 필드만 덮어쓴다. */
function card(over: Partial<BrainCard> & Pick<BrainCard, 'id' | 'title'>): BrainCard {
  return {
    type: 'fact',
    scope: 'project',
    body: '',
    files: [],
    createdAt: 1_000,
    updatedAt: 1_000,
    refCount: 0,
    status: 'active',
    topic: 'brain-memory',
    ...over,
  } as BrainCard;
}

describe('subjectFromFile — 파일 경로 → canonicalKey subject', () => {
  it('카멜케이스 파일명을 kebab 으로 편다', () => {
    expect(subjectFromFile('packages/server/src/services/brainService.ts')).toBe('brain-service');
    expect(subjectFromFile('packages/client/src/components/Panel/BrainCardDetail.tsx')).toBe('brain-card-detail');
  });

  it('윈도우 역슬래시 경로도 처리한다', () => {
    expect(subjectFromFile('packages\\server\\src\\services\\projectGraph.ts')).toBe('project-graph');
  });

  it('의미 없는 일반 파일명은 subject 로 쓰지 않는다', () => {
    expect(subjectFromFile('packages/server/src/index.ts')).toBeNull();
    expect(subjectFromFile('packages/shared/src/types.ts')).toBeNull();
    expect(subjectFromFile('packages/shared/src/constants.ts')).toBeNull();
  });

  it('문서·스크립트·설정에서는 subject 를 뽑지 않는다(실측 오탐 재현 — SCENARIO.md → client.scenario)', () => {
    expect(subjectFromFile('docs/SCENARIO.md')).toBeNull();
    expect(subjectFromFile('scripts/reinstall.mjs')).toBeNull();
    expect(subjectFromFile('package.json')).toBeNull();
    expect(subjectFromFile('packages/desktop/electron.vite.config.ts')).toBeNull();
  });
});

describe('suggestCanonicalKey — 키 제안(자동 확정 ❌)', () => {
  it('정본 후보 + 주제 area 힌트 + 파일이 다 있으면 제안한다', () => {
    const s = suggestCanonicalKey(card({
      id: 'card-a', title: '앵커는 저장 시점 해시를 박는다', type: 'fact',
      topic: 'brain-memory', files: ['packages/server/src/services/brainService.ts'],
    }));
    expect(s?.suggestedKey).toBe('server.brain-service');
    expect(s?.confidence).toBe('high');
  });

  it('경험 계층(lesson/mistake)은 정본 후보가 아니라 제안하지 않는다', () => {
    expect(suggestCanonicalKey(card({
      id: 'card-b', title: '같은 실수를 반복했다', type: 'lesson',
      topic: 'brain-memory', files: ['packages/server/src/services/brainService.ts'],
    }))).toBeNull();
  });

  it('출처가 없으면 제안하지 않는다(한국어 제목에서 키를 만들지 않는다)', () => {
    expect(suggestCanonicalKey(card({
      id: 'card-c', title: '패키지 매니저는 pnpm 이다', type: 'fact', topic: 'runapp-build', files: [],
    }))).toBeNull();
  });

  it('area 는 주제가 아니라 파일의 패키지에서 뽑는다(실측 어긋남 재현 — DetailPanel 은 클라다)', () => {
    // 주제는 usage-statusline(서버 냄새)이지만 파일은 클라 컴포넌트 → area 는 client 여야 한다.
    const s = suggestCanonicalKey(card({
      id: 'card-g', title: 'rate limits 는 두 축만 표시 가능', type: 'fact', topic: 'usage-statusline',
      files: ['packages/client/src/components/Panel/DetailPanel.tsx'],
    }));
    expect(s?.suggestedKey).toBe('client.detail-panel');
  });

  it('주제가 미분류(misc)면 신뢰도를 high 로 올리지 않는다', () => {
    const s = suggestCanonicalKey(card({
      id: 'card-d', title: '무언가', type: 'fact', topic: 'misc',
      files: ['packages/server/src/services/brainService.ts'],
    }));
    expect(s?.suggestedKey).toBe('server.brain-service');
    expect(s?.confidence).toBe('medium');
  });

  it('파일이 여러 개면 신뢰도가 낮아진다', () => {
    const s = suggestCanonicalKey(card({
      id: 'card-e', title: '여러 파일에 걸친 사실', type: 'decision', topic: 'ui-client',
      files: [
        'packages/client/src/fooBar.ts', 'packages/client/src/bazQux.ts',
        'packages/client/src/quuxCorge.ts', 'packages/client/src/graultGarply.ts',
      ],
    }));
    expect(s?.confidence).toBe('low');
    expect(s?.suggestedKey).toBe('client.foo-bar');
  });

  it('문서만 연결된 카드는 제안 없이 사람 판단으로 넘어간다', () => {
    const r = analyzeBrainMigration([card({
      id: 'card-f', title: 'SCENARIO 는 offset/limit 로 읽어야 한다', type: 'fact',
      topic: 'tooling-pitfalls', files: ['docs/SCENARIO.md'],
    })], root);
    expect(r.keySuggestions).toHaveLength(0);
    expect(r.needsHuman[0]?.reason).toBe('key-undecidable');
    expect(r.needsHuman[0]?.detail).toContain('문서·스크립트');
  });

  it('같은 키를 제안받은 카드들을 같은 슬롯 후보로 묶는다', () => {
    const files = ['packages/client/src/hooks/useCaptureRemoteControl.ts'];
    const r = analyzeBrainMigration([
      card({ id: 'card-1', title: '고배율에서 좌표 오류', type: 'fact', topic: 'capture-remote', files }),
      card({ id: 'card-2', title: 'DPI 혼합에서 좌표 오류', type: 'fact', topic: 'capture-remote', files }),
      card({ id: 'card-3', title: '커서는 손 위치에 그린다', type: 'fact', topic: 'capture-remote', files }),
    ], root);
    expect(r.keyCollisions).toHaveLength(1);
    expect(r.keyCollisions[0]?.key).toBe('client.use-capture-remote-control');
    expect(r.keyCollisions[0]?.cards).toHaveLength(3);
    // 접두가 겹치면 그대로 확정할 수 없다 — aspect 필요 표시 + 신뢰도 강등.
    expect(r.keySuggestions.every((s) => s.needsAspect)).toBe(true);
    expect(r.keySuggestions.every((s) => s.confidence === 'low')).toBe(true);
  });
});

describe('중복·충돌 후보', () => {
  it('같은 진실 3장을 한 묶음으로 잡는다(실측 /runapp 계열 재현)', () => {
    const cards = [
      card({ id: 'card-1', title: '/runapp 실행 후 1회만 출력 확인으로 완료' }),
      card({ id: 'card-2', title: '/runapp 실행 후 한 번만 출력 확인하고 종료' }),
      card({ id: 'card-3', title: '/runapp 후 한 번만 확인하고 즉시 종료' }),
      card({ id: 'card-9', title: '전혀 다른 이야기 — 좌표 변환과 DPI' }),
    ];
    const r = analyzeBrainMigration(cards, root);
    expect(r.duplicateGroups).toHaveLength(1);
    expect(r.duplicateGroups[0]?.cards.map((c) => c.id)).toEqual(['card-1', 'card-2', 'card-3']);
  });

  it('겹치지만 지시가 뒤집힌 쌍은 중복이 아니라 충돌로 보고한다', () => {
    const cards = [
      card({ id: 'card-1', title: '워크트리 방식으로 격리해야 한다', body: '워크트리를 쓰자' }),
      card({ id: 'card-2', title: '워크트리 방식으로 격리하지 마라', body: '워크트리는 금지다' }),
    ];
    const r = analyzeBrainMigration(cards, root);
    expect(r.duplicateGroups).toHaveLength(0);
    expect(r.conflictPairs).toHaveLength(1);
    expect(r.conflictPairs[0]?.reason).toBe('negation-flip');
  });

  it('층이 다르면 중복으로 묶지 않는다(프로젝트 vs 에이전트)', () => {
    const cards = [
      card({ id: 'card-1', title: '/runapp 후 한 번만 확인하고 종료' }),
      card({ id: 'card-2', title: '/runapp 후 한 번만 확인하고 종료함', scope: 'agent', agentId: 'agent-1' }),
    ];
    expect(analyzeBrainMigration(cards, root).duplicateGroups).toHaveLength(0);
  });
});

describe('출처 상태 분류', () => {
  it('연결 파일이 없으면 noSource', () => {
    const r = analyzeBrainMigration([card({ id: 'card-1', title: '출처 없는 사실' })], root);
    expect(r.noSource.map((n) => n.id)).toEqual(['card-1']);
    expect(r.reVerifiable).toHaveLength(0);
  });

  it('파일이 사라졌으면 brokenSource(source-missing)', () => {
    const r = analyzeBrainMigration([card({ id: 'card-1', title: '사라진 파일', files: ['gone.ts'] })], root);
    expect(r.brokenSource[0]?.reason).toBe('source-missing');
  });

  it('앵커 해시가 어긋나면 brokenSource(anchor-mismatch)', () => {
    fs.writeFileSync(path.join(root, 'live.ts'), 'export const a = 2;');
    const r = analyzeBrainMigration([card({
      id: 'card-1', title: '내용이 바뀐 파일', files: ['live.ts'],
      anchors: [{ path: 'live.ts', sha: 'deadbeefdeadbeef', at: 1_000 }],
    })], root);
    expect(r.brokenSource[0]?.reason).toBe('anchor-mismatch');
  });

  it('파일이 온전한 정본 후보는 reVerifiable, 경험 계층은 아니다', () => {
    fs.writeFileSync(path.join(root, 'live.ts'), 'export const a = 1;');
    const r = analyzeBrainMigration([
      card({ id: 'card-1', title: '온전한 사실', type: 'fact', files: ['live.ts'] }),
      card({ id: 'card-2', title: '온전한 교훈', type: 'lesson', files: ['live.ts'] }),
    ], root);
    expect(r.reVerifiable.map((n) => n.id)).toEqual(['card-1']);
    expect(r.excludeNow.map((n) => n.id)).toContain('card-2');
  });
});

describe('범위 분리 · 미분류 · 즉시 제외', () => {
  it('본문에 범위 축이 언급되면 needsScopeSplit', () => {
    const r = analyzeBrainMigration([
      card({ id: 'card-1', title: 'Windows 에서는 커서가 하나뿐이다' }),
      card({ id: 'card-2', title: '일반적인 사실' }),
    ], root);
    expect(r.needsScopeSplit.map((n) => n.id)).toEqual(['card-1']);
  });

  it('misc 주제는 분류 검토 큐로, 모르는 주제는 unknownTopics 로', () => {
    const r = analyzeBrainMigration([
      card({ id: 'card-1', title: '미분류', topic: 'misc' }),
      card({ id: 'card-2', title: '수기 편집 주제', topic: 'made-up-topic' }),
    ], root);
    expect(r.unclassified.misc.map((n) => n.id)).toEqual(['card-1']);
    expect(r.unclassified.unknownTopics).toEqual(['made-up-topic']);
  });

  it('needs-check·ghost·경험 계층은 즉시 제외 대상이며 사유가 붙는다', () => {
    const r = analyzeBrainMigration([
      card({ id: 'card-1', title: '확인 필요', verifyState: 'needs-check' }),
      card({ id: 'card-2', title: '유령', status: 'ghost' }),
      card({ id: 'card-3', title: '교훈', type: 'lesson' }),
      card({ id: 'card-4', title: '멀쩡한 사실' }),
    ], root);
    expect(r.excludeNow.map((n) => n.id)).toEqual(['card-1', 'card-2', 'card-3']);
    expect(r.excludeNow.find((n) => n.id === 'card-1')?.reason).toBe('needs-check');
  });

  it('pinned·always 라는 이유로 제외에서 빠지지 않는다', () => {
    const r = analyzeBrainMigration([
      card({ id: 'card-1', title: '고정된 확인 필요', verifyState: 'needs-check', pinned: true }),
      card({ id: 'card-2', title: '상시 규칙인데 확인 필요', type: 'rule', verifyState: 'needs-check', always: true }),
    ], root);
    expect(r.excludeNow.map((n) => n.id)).toEqual(['card-1', 'card-2']);
  });
});

describe('집계와 이행 계획', () => {
  it('닫힌 카드·보관 카드는 live 에서 빠지되 total 에는 남는다', () => {
    const r = analyzeBrainMigration([
      card({ id: 'card-1', title: '현재' }),
      card({ id: 'card-2', title: '닫힘', validUntil: 2_000 }),
      card({ id: 'card-3', title: '보관', status: 'archived' }),
    ], root);
    expect(r.counts).toMatchObject({ total: 3, live: 1, closed: 1, archived: 1 });
  });

  it('정본 후보와 경험 계층을 갈라 센다', () => {
    const r = analyzeBrainMigration([
      card({ id: 'card-1', title: 'a', type: 'fact' }),
      card({ id: 'card-2', title: 'b', type: 'rule' }),
      card({ id: 'card-3', title: 'c', type: 'lesson' }),
      card({ id: 'card-4', title: 'd', type: 'mistake' }),
    ], root);
    expect(r.counts.canonicalCandidates).toBe(2);
    expect(r.counts.experienceLayer).toBe(2);
  });

  it('이행 계획은 엄격안(candidate 시작) + 추가만 한다는 것을 명시한다', () => {
    const r = analyzeBrainMigration([card({ id: 'card-1', title: 'a' })], root);
    expect(r.plan.initialVerifyState).toBe('candidate');
    expect(r.plan.willAddFields).toContain('canonicalKey');
    expect(r.plan.willNotTouch.join(' ')).toContain('본문');
  });

  it('결정·규칙은 키를 제안했더라도 사람 승인 대상으로 남는다', () => {
    const r = analyzeBrainMigration([
      card({ id: 'card-1', title: '결정', type: 'decision', topic: 'brain-memory', files: ['packages/server/src/services/fooBar.ts'] }),
      card({ id: 'card-2', title: '키를 못 만드는 사실', type: 'fact', files: [] }),
    ], root);
    // 키는 제안되지만(자동 확정 ❌) 승인 관문은 그대로 남는다.
    expect(r.keySuggestions.map((s) => s.id)).toEqual(['card-1']);
    expect(r.needsHuman.find((n) => n.id === 'card-1')?.reason).toBe('policy-needs-approval');
    expect(r.needsHuman.find((n) => n.id === 'card-2')?.reason).toBe('key-undecidable');
    // 카드 1장에 지적 1건 — 같은 카드가 두 사유로 두 번 실리지 않는다.
    expect(r.needsHuman).toHaveLength(2);
  });
});

describe('재실행 멱등 · 읽기 전용', () => {
  const sample = (): BrainCard[] => [
    card({ id: 'card-1', title: '/runapp 후 한 번만 확인하고 종료' }),
    card({ id: 'card-2', title: '/runapp 실행 후 한 번만 출력 확인하고 종료' }),
    card({ id: 'card-3', title: '앵커 사실', type: 'fact', files: ['packages/server/src/services/brainService.ts'] }),
    card({ id: 'card-4', title: 'Windows 전용 사실', type: 'rule' }),
    card({ id: 'card-5', title: '닫힌 카드', validUntil: 5_000 }),
  ];

  it('같은 입력이면 몇 번을 돌려도 같은 보고서다', () => {
    const a = analyzeBrainMigration(sample(), root);
    const b = analyzeBrainMigration(sample(), root);
    const c = analyzeBrainMigration(sample(), root);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('입력 순서가 달라도 같은 보고서다(Map 순회 순서에 흔들리지 않는다)', () => {
    const a = analyzeBrainMigration(sample(), root);
    const shuffled = analyzeBrainMigration([...sample()].reverse(), root);
    expect(shuffled).toEqual(a);
  });

  it('입력 카드를 변경하지 않는다(읽기 전용)', () => {
    const cards = sample();
    const snapshot = JSON.parse(JSON.stringify(cards)) as BrainCard[];
    analyzeBrainMigration(cards, root);
    expect(cards).toEqual(snapshot);
  });

  it('디스크에 아무것도 쓰지 않는다', () => {
    const before = fs.readdirSync(root);
    analyzeBrainMigration(sample(), root);
    expect(fs.readdirSync(root)).toEqual(before);
  });
});
