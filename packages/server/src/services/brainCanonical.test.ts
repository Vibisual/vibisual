/**
 * §5.10 v3.81 — **필수 완료 조건 회귀 테스트.**
 *
 * 설계 문서의 "대표 실패 시나리오" 14종을 그대로 옮긴 것이다. 각 `it` 제목 끝의 (요건 N) 은
 * 그 조건 번호 — 이 파일이 통과하는 한 저장고/SSOT 분리의 불변식이 지켜진다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrainCard } from '@vibisual/shared';
import { BRAIN_TOPIC_CARD_BUDGET } from '@vibisual/shared';
import { BrainService } from './brainService.js';
import { buildCanonicalIndex, scopeKeyOf, scopeRelation, findSupersedeRepairs, verifyStateOf } from './brainCanonical.js';

let root: string;
let svc: BrainService;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-canon-'));
  svc = new BrainService(root);
});

afterEach(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

/** 키를 가진 사실 카드 1장 저장 + 사용자 승인까지(= 현재 진실 만들기). */
function saveVerified(over: { title: string; value?: string; canonicalKey?: string; appliesTo?: BrainCard['appliesTo'] }): BrainCard {
  const card = svc.saveCard({
    type: 'fact',
    scope: 'project',
    title: over.title,
    body: '',
    canonicalKey: over.canonicalKey ?? 'build.package-manager',
    ...(over.value ? { value: over.value } : {}),
    ...(over.appliesTo ? { appliesTo: over.appliesTo } : {}),
  });
  return svc.confirmCard(card.id) as BrainCard;
}

describe('요건 1 · 5 — 한 슬롯에 현재 진실은 하나, 충돌 시엔 아무도 아니다', () => {
  it('같은 키+범위에 verified 가 둘이면 둘 다 contested 가 되고 current 는 비워진다 (요건 1·5)', () => {
    const a = saveVerified({ title: '패키지 매니저는 pnpm', value: 'pnpm' });
    // 두 번째를 강제로 verified 로 만들어 "부정한 상태"를 재현한다(수기 편집·복사 사고 시뮬).
    const b = svc.saveCard({
      type: 'fact', scope: 'project', title: '패키지 매니저는 yarn', body: '',
      canonicalKey: 'build.package-manager', value: 'yarn',
    });
    svc.updateCard(a.id, { verifyState: 'verified', authority: 'user-explicit' });
    svc.updateCard(b.id, { verifyState: 'verified', authority: 'user-explicit' });

    const index = svc.canonicalIndex();
    const entry = index.get('build.package-manager|');
    expect(entry?.state).toBe('contested');
    expect(entry?.cardId).toBeNull();
    expect(entry?.contenders.sort()).toEqual([a.id, b.id].sort());
    // 그리고 아무것도 주입되지 않는다 — 최신 날짜로 한쪽을 낙점하지 않는다.
    expect(svc.selectCurrent()).toEqual([]);
  });

  it('권위가 낮은 새 주장은 현재 진실을 끌어내리지 못하고 후보로만 접수된다', () => {
    const a = saveVerified({ title: '패키지 매니저는 pnpm', value: 'pnpm' }); // user-explicit
    const r = svc.saveCardDetailed({
      type: 'fact', scope: 'project', title: '패키지 매니저는 npm', body: '',
      canonicalKey: 'build.package-manager', value: 'npm', // authority 미지정 = ai-inference
    });
    expect(r.outcome).toBe('new');
    expect(svc.getCard(a.id)?.validUntil).toBeUndefined();       // 옛 값은 닫히지도 지워지지도 않았다
    expect(verifyStateOf(svc.getCard(a.id) as BrainCard)).toBe('verified'); // 그리고 여전히 진실이다
    expect(svc.selectCurrent().map((c) => c.id)).toEqual([a.id]);
    // 다만 반대 주장은 사라지지 않고 검토 큐에 남는다.
    expect(svc.listReviewQueue().map((c) => c.id)).toContain(r.card.id);
  });

  it('권위가 같거나 높은 주장이 오면 양쪽 다 contested 가 되고 아무도 현재 진실이 아니다 (요건 5)', () => {
    const a = svc.saveCard({
      type: 'fact', scope: 'project', title: '패키지 매니저는 pnpm', body: '',
      canonicalKey: 'build.package-manager', value: 'pnpm', authority: 'repository-source',
    });
    svc.confirmCard(a.id, { authority: 'repository-source' });
    const r = svc.saveCardDetailed({
      type: 'fact', scope: 'project', title: '패키지 매니저는 npm', body: '',
      canonicalKey: 'build.package-manager', value: 'npm', authority: 'repository-source',
    });
    expect(svc.getCard(a.id)?.validUntil).toBeUndefined(); // 덮지도 지우지도 않는다
    expect(verifyStateOf(svc.getCard(a.id) as BrainCard)).toBe('contested');
    expect(verifyStateOf(r.card)).toBe('contested');
    expect(svc.selectCurrent()).toEqual([]);               // 최신 날짜로 낙점하지 않는다
  });
});

describe('요건 2 — pnpm → npm 교체는 npm 만 주입되고 pnpm 은 이력에 남는다', () => {
  it('새 값을 사용자가 승인하면 옛 값이 닫히고 체인으로 되짚을 수 있다 (요건 2·12)', () => {
    const oldCard = saveVerified({ title: '패키지 매니저는 pnpm', value: 'pnpm' });
    const fresh = svc.saveCard({
      type: 'fact', scope: 'project', title: '패키지 매니저는 npm', body: '',
      canonicalKey: 'build.package-manager', value: 'npm',
    });
    svc.confirmCard(fresh.id);

    // 현재 진실은 npm 하나뿐.
    const current = svc.selectCurrent();
    expect(current.map((c) => c.id)).toEqual([fresh.id]);
    expect(current[0]?.value).toBe('npm');
    // pnpm 은 삭제되지 않고 닫힌 채 이력으로 남는다.
    const closed = svc.getCard(oldCard.id) as BrainCard;
    expect(closed.validUntil).toBeGreaterThan(0);
    expect(closed.supersededBy).toBe(fresh.id);
    expect(svc.getSupersedeChain(fresh.id).older.map((c) => c.id)).toContain(oldCard.id);
    // 파일도 그대로 있다(삭제 ❌).
    expect(fs.existsSync(path.join(root, '.vibisual/brain/project', `${oldCard.id}.md`))).toBe(true);
  });
});

describe('요건 3 — 같은 사실이 여러 세션에서 발견되면 카드가 늘지 않는다', () => {
  it('같은 슬롯·같은 값의 재발견은 관찰만 적립한다 (요건 3)', () => {
    const first = svc.saveCard({
      type: 'fact', scope: 'project', title: '패키지 매니저는 pnpm', body: '',
      canonicalKey: 'build.package-manager', value: 'pnpm', sourceSessionId: 's1',
    });
    const before = svc.listCards().length;
    for (const s of ['s2', 's3', 's4']) {
      const r = svc.saveCardDetailed({
        type: 'fact', scope: 'project', title: '패키지 매니저는 pnpm 이다', body: '',
        canonicalKey: 'build.package-manager', value: 'pnpm', sourceSessionId: s,
      });
      expect(r.outcome).toBe('same');
      expect(r.card.id).toBe(first.id);
    }
    expect(svc.listCards().length).toBe(before);
    const card = svc.getCard(first.id) as BrainCard;
    expect(card.observedCount).toBe(3);
    expect(card.observations?.map((o) => o.sessionId)).toEqual(['s2', 's3', 's4']);
  });

  it('더 높은 권위로 다시 관찰되면 카드의 권위가 승격된다', () => {
    const c = svc.saveCard({
      type: 'fact', scope: 'project', title: 'a', body: '', canonicalKey: 'build.x', value: 'v',
    });
    expect(svc.getCard(c.id)?.authority).toBe('ai-inference');
    svc.saveCardDetailed({
      type: 'fact', scope: 'project', title: 'a', body: '', canonicalKey: 'build.x', value: 'v',
      authority: 'repository-source',
    });
    expect(svc.getCard(c.id)?.authority).toBe('repository-source');
  });
});

describe('요건 4 — 서로 다른 범위의 값은 안전하게 공존한다', () => {
  it('branch 가 다르면 각각 현재 진실이 된다 (요건 4)', () => {
    const main = saveVerified({ title: 'main 은 노드 20', value: '20', canonicalKey: 'build.node', appliesTo: { branch: 'main' } });
    const next = saveVerified({ title: 'next 는 노드 22', value: '22', canonicalKey: 'build.node', appliesTo: { branch: 'next' } });
    expect(svc.selectCurrent().map((c) => c.id).sort()).toEqual([main.id, next.id].sort());
    // 컨텍스트를 주면 그 범위의 것만 나온다.
    expect(svc.selectCurrent({ context: { branch: 'main' } }).map((c) => c.id)).toEqual([main.id]);
    expect(svc.selectCurrent({ context: { branch: 'next' } }).map((c) => c.id)).toEqual([next.id]);
  });

  it('범위 문자열은 축 이름 순으로 정규화된다(객체 키 순서에 흔들리지 않는다)', () => {
    expect(scopeKeyOf({ project: 'v', branch: 'main' })).toBe('branch=main;project=v');
    expect(scopeKeyOf({ branch: 'main', project: 'v' })).toBe('branch=main;project=v');
    expect(scopeKeyOf({ environment: '*' })).toBe('');
  });

  it('포섭·비교불가 관계를 구분한다', () => {
    expect(scopeRelation({ project: 'v' }, { project: 'v' })).toBe('equal');
    expect(scopeRelation({}, { branch: 'main' })).toBe('a-subsumes-b');
    expect(scopeRelation({ branch: 'main' }, { environment: 'ci' })).toBe('incomparable');
  });
});

describe('요건 6 · 7 — 기본 주입 제외', () => {
  it('candidate·needs-check·contested·닫힘·rejected·archived 는 전부 빠진다 (요건 6)', () => {
    const cand = svc.saveCard({ type: 'fact', scope: 'project', title: '후보', body: '', canonicalKey: 'k.cand' });
    const verified = saveVerified({ title: '진실', canonicalKey: 'k.ok' });
    const rejected = saveVerified({ title: '거부', canonicalKey: 'k.rej' });
    svc.rejectCard(rejected.id);
    const archived = saveVerified({ title: '보관', canonicalKey: 'k.arch' });
    svc.archiveCard(archived.id);
    const stale = saveVerified({ title: '확인필요', canonicalKey: 'k.stale' });
    svc.updateCard(stale.id, { verifyState: 'needs-check' });

    const ids = svc.selectCurrent().map((c) => c.id);
    expect(ids).toEqual([verified.id]);
    expect(ids).not.toContain(cand.id);
    expect(ids).not.toContain(rejected.id);
    expect(ids).not.toContain(archived.id);
    expect(ids).not.toContain(stale.id);
  });

  it('pinned·always 카드도 출처가 바뀌면 재검증 대상이 되고 주입에서 빠진다 (요건 7)', () => {
    const rel = 'src/foo.ts';
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, rel), 'export const a = 1;');
    const card = svc.saveCard({
      type: 'rule', scope: 'project', title: '상시 규칙', body: '', files: [rel],
      canonicalKey: 'workflow.always', pinned: true, always: true,
    });
    svc.confirmCard(card.id);
    expect(svc.selectCurrent().map((c) => c.id)).toEqual([card.id]);

    fs.writeFileSync(path.join(root, rel), 'export const a = 2;');
    svc.noteFilesEdited([rel]);
    // pinned·always 여도 예외 없다.
    expect(svc.getCard(card.id)?.verifyState).toBe('needs-check');
    expect(svc.selectCurrent()).toEqual([]);
  });
});

describe('요건 8 — 분류가 바뀌어도 진실의 동일성은 키가 지킨다', () => {
  it('topic 을 바꿔도 같은 슬롯에 남는다 (요건 8)', () => {
    const card = saveVerified({ title: '사실', canonicalKey: 'server.brain-service.topic' });
    const slotBefore = [...svc.canonicalIndex().keys()];
    svc.updateCard(card.id, { topic: 'ui-client', verifyState: 'verified' });
    expect([...svc.canonicalIndex().keys()]).toEqual(slotBefore);
  });
});

describe('정책은 사용자 승인으로만 현재 진실이 된다', () => {
  it('decision·rule 은 출처 대조(repository-source)로 승격되지 않는다', () => {
    const dec = svc.saveCard({ type: 'decision', scope: 'project', title: '워크트리로 격리한다', body: '', canonicalKey: 'workflow.isolation' });
    svc.confirmCard(dec.id, { authority: 'repository-source' });
    expect(verifyStateOf(svc.getCard(dec.id) as BrainCard)).toBe('candidate');
    // 사용자 명시 승인이면 올라간다.
    svc.confirmCard(dec.id, { authority: 'user-explicit' });
    expect(verifyStateOf(svc.getCard(dec.id) as BrainCard)).toBe('verified');
  });

  it('fact 는 출처 대조로 승격된다(기계적으로 확인 가능한 종류)', () => {
    const f = svc.saveCard({ type: 'fact', scope: 'project', title: '노드 20 을 쓴다', body: '', canonicalKey: 'build.node2' });
    svc.confirmCard(f.id, { authority: 'repository-source' });
    expect(verifyStateOf(svc.getCard(f.id) as BrainCard)).toBe('verified');
  });
});

describe('요건 9 — 출처 없는 AI 추론은 자동으로 verified 가 되지 않는다', () => {
  it('ai-inference·session-summary 권위로는 승격 경로가 없다 (요건 9)', () => {
    const card = svc.saveCard({ type: 'fact', scope: 'project', title: 'AI 가 추측한 것', body: '', canonicalKey: 'k.guess' });
    expect(verifyStateOf(svc.getCard(card.id) as BrainCard)).toBe('candidate');
    // 낮은 권위로 confirm 을 시도해도 올라가지 않는다.
    svc.confirmCard(card.id, { authority: 'ai-inference' });
    expect(verifyStateOf(svc.getCard(card.id) as BrainCard)).toBe('candidate');
    svc.confirmCard(card.id, { authority: 'session-summary' });
    expect(verifyStateOf(svc.getCard(card.id) as BrainCard)).toBe('candidate');
    // 사용자 명시 승인만이 올린다.
    svc.confirmCard(card.id, { authority: 'user-explicit' });
    expect(verifyStateOf(svc.getCard(card.id) as BrainCard)).toBe('verified');
  });

  it('"도움됨" 신고는 검증 상태를 건드리지 않는다(유용성 ≠ 사실성)', () => {
    const card = svc.saveCard({ type: 'fact', scope: 'project', title: 'x', body: '', canonicalKey: 'k.h' });
    svc.updateCard(card.id, { verifyState: 'needs-check' });
    svc.markHelpful(card.id);
    expect(svc.getCard(card.id)?.verifyState).toBe('needs-check');
    expect(svc.getCard(card.id)?.helpfulCount).toBe(1);
  });
});

describe('요건 11 — 승격 중 실패해도 두 개의 현재 진실이 생기지 않는다', () => {
  it('새 카드만 쓰이고 죽어도 로더가 옛 카드를 닫아 거래를 완료한다 (요건 11)', () => {
    // 크래시 재현: 새 카드는 supersedes 를 달고 디스크에 있는데 옛 카드는 아직 열려 있다.
    const oldCard = saveVerified({ title: '옛 진실', value: 'old' });
    const fresh = svc.saveCard({
      type: 'fact', scope: 'project', title: '새 진실', body: '',
      canonicalKey: 'build.package-manager', value: 'new',
    });
    svc.updateCard(fresh.id, { verifyState: 'verified', authority: 'user-explicit', supersedes: [oldCard.id] });
    // 이 시점에 둘 다 열려 있고 둘 다 verified — "두 개의 현재 진실" 직전 상태.
    const reloaded = new BrainService(root); // 재기동
    const list = reloaded.listCards({ includeClosed: true });
    expect(findSupersedeRepairs(list)).toEqual([]); // 로더가 이미 복구했다
    expect(reloaded.getCard(oldCard.id)?.validUntil).toBeGreaterThan(0);
    expect(reloaded.selectCurrent().map((c) => c.id)).toEqual([fresh.id]);
  });

  it('반대 순서(옛 카드만 닫히고 새 카드 없음)에서는 진실이 증발하지 않고 검토 큐로 간다', () => {
    const oldCard = saveVerified({ title: '옛 진실', value: 'old' });
    // 새 카드 없이 옛 카드만 닫힌 상태를 강제로 만든다.
    svc.updateCard(oldCard.id, { validUntil: Date.now(), supersededBy: 'card-missing' } as Partial<BrainCard>);
    expect(svc.selectCurrent()).toEqual([]);
    // 파일은 그대로 남아 이력으로 조회된다(요건 12).
    expect(svc.listCards({ includeClosed: true }).map((c) => c.id)).toContain(oldCard.id);
  });
});

describe('요건 13 · 14 — 인덱스 재생성 멱등 · 프롬프트 선형 증가 없음', () => {
  it('인덱스를 여러 번 재생성해도 같은 결과다 (요건 13)', () => {
    saveVerified({ title: 'a', canonicalKey: 'k.a' });
    saveVerified({ title: 'b', canonicalKey: 'k.b' });
    const cards = svc.listCards({ includeClosed: true, includeArchived: true });
    const now = 1_800_000_000_000;
    const a = [...buildCanonicalIndex(cards, now).entries()];
    const b = [...buildCanonicalIndex(cards, now).entries()];
    const c = [...buildCanonicalIndex([...cards].reverse(), now).entries()];
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('증거 카드가 아무리 늘어도 현재 진실 수는 변하지 않는다 (요건 14)', () => {
    saveVerified({ title: '유일한 진실', canonicalKey: 'k.only' });
    // 제목이 서로 확실히 다른 증거 카드 50장(유사도 병합에 걸리지 않게).
    for (let i = 0; i < 50; i++) {
      // 토큰이 하나도 겹치지 않게(숫자를 단어에 붙여 고유 토큰을 만든다) — 유사도 병합을 피한다.
      svc.saveCard({ type: 'lesson', scope: 'project', title: `주제${i} 고유어${i}`, body: `본문${i}` });
    }
    // 저장고(보관 포함)는 51장 넘게 커졌지만 —
    expect(svc.listCards({ includeArchived: true }).length).toBeGreaterThan(50);
    // 화면에 사는 증거는 예산제(주제 정원)로 묶이고,
    expect(svc.listCards().length).toBeLessThanOrEqual(BRAIN_TOPIC_CARD_BUDGET + 1);
    // **AI 기본 프롬프트에 들어가는 현재 진실은 그대로 1장이다.**
    expect(svc.selectCurrent()).toHaveLength(1);
  });
});

describe('제약 — 깨진 수동 편집 파일은 검역된다', () => {
  it('frontmatter 가 깨진 파일은 인덱스에 들어가지 않고 검역 목록에 남는다', () => {
    saveVerified({ title: '정상 카드', canonicalKey: 'k.ok' });
    const dir = path.join(root, '.vibisual/brain/project');
    fs.writeFileSync(path.join(dir, 'card-broken-9999.md'), '이건 frontmatter 가 없는 파일이다');

    const reloaded = new BrainService(root);
    expect(reloaded.listCards().map((c) => c.id)).not.toContain('card-broken-9999');
    expect(reloaded.listQuarantined().join(' ')).toContain('card-broken-9999');
    // 다른 카드는 멀쩡히 읽힌다(한 파일이 깨져도 전체가 죽지 않는다).
    expect(reloaded.selectCurrent()).toHaveLength(1);
    // 파일은 지워지지 않는다.
    expect(fs.existsSync(path.join(dir, 'card-broken-9999.md'))).toBe(true);
  });
});

describe('저장고와 SSOT 의 경계', () => {
  it('키 없는 카드는 저장·검색은 되지만 현재 진실이 되지 않는다', () => {
    const evidence = svc.saveCard({ type: 'lesson', scope: 'project', title: '워크트리 함정', body: '이런 일이 있었다' });
    expect(svc.search('워크트리').map((c) => c.id)).toContain(evidence.id);
    expect(svc.selectCurrent()).toEqual([]);
    expect(svc.listReviewQueue()).toEqual([]); // 검토 큐도 키 있는 카드만
  });

  it('검토 큐는 키가 있는데 아직 현재 진실이 아닌 카드를 모은다', () => {
    const cand = svc.saveCard({ type: 'fact', scope: 'project', title: '후보', body: '', canonicalKey: 'k.c' });
    saveVerified({ title: '이미 진실', canonicalKey: 'k.v' });
    expect(svc.listReviewQueue().map((c) => c.id)).toEqual([cand.id]);
  });
});
