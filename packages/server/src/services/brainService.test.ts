/**
 * §5.10 Project Brain — brainService 단위 테스트.
 * save/중복 갱신, 검색 랭킹, 승격(파일 이동), 파일 매칭, 부분 업데이트 필드 보존.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrainCard } from '@vibisual/shared';
import { BRAIN_ALWAYS_RULE_MAX, BRAIN_TOPIC_CARD_BUDGET } from '@vibisual/shared';
import { BrainService, classifyTopic } from './brainService.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let root: string;
let svc: BrainService;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-brain-'));
  svc = new BrainService(root);
});

afterEach(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('saveCard + 디스크 영속', () => {
  it('새 카드를 프로젝트 폴더에 마크다운 파일로 쓴다', () => {
    const card = svc.saveCard({ type: 'rule', scope: 'project', title: '규칙 하나', body: '본문입니다' });
    expect(card.id).toMatch(/^card-/);
    const fp = path.join(root, '.vibisual/brain/project', `${card.id}.md`);
    expect(fs.existsSync(fp)).toBe(true);
    const text = fs.readFileSync(fp, 'utf8');
    expect(text).toContain('type: rule');
    expect(text).toContain('본문입니다');
  });

  it('agent 카드는 agents/<agentId> 폴더에 쓴다', () => {
    const card = svc.saveCard({ type: 'lesson', scope: 'agent', agentId: 'agent-x', title: '교훈', body: 'b' });
    const fp = path.join(root, '.vibisual/brain/agents/agent-x', `${card.id}.md`);
    expect(fs.existsSync(fp)).toBe(true);
    expect(card.agentId).toBe('agent-x');
  });

  it('디스크에서 lazy 로드 — 새 인스턴스가 기존 파일을 읽는다', () => {
    const card = svc.saveCard({ type: 'fact', scope: 'project', title: '사실 카드', body: 'x' });
    const svc2 = new BrainService(root);
    expect(svc2.getCard(card.id)?.title).toBe('사실 카드');
    expect(svc2.listCards().length).toBe(1);
  });
});

describe('중복 검사(dedup) — 동일 카드는 참조만 갱신(v3.78: 본문 append 폐기)', () => {
  it('토큰 겹침이 높으면 새 카드를 만들지 않고 기존 카드의 참조 시각만 올린다', () => {
    const a = svc.saveCard({
      type: 'mistake', scope: 'project',
      title: '데이터베이스 연결 풀 고갈 실수',
      body: '커넥션 풀을 닫지 않아 고갈되는 실수가 있었다',
    });
    const before = a.body;
    const r = svc.saveCardDetailed({
      type: 'mistake', scope: 'project',
      title: '데이터베이스 연결 풀 고갈 실수',
      body: '커넥션 풀을 닫지 않아 고갈되는 실수가 또 났다',
    });
    expect(r.outcome).toBe('same');
    expect(r.card.id).toBe(a.id);
    expect(svc.listCards().length).toBe(1);
    // v3.78 핵심 — 본문은 **불변**. 종전의 `— 갱신(날짜):` append 가 Jaccard 분모를 키워
    //   다음번엔 같은 지식이 문턱을 못 넘고 새 카드로 분기하던 자기모순을 없앤 자리.
    expect(r.card.body).toBe(before);
    expect(r.card.body).not.toContain('갱신');
    expect(r.card.lastReferencedAt).toBeGreaterThan(0);
    // 재추출은 "노출(임프레션)"이 아니다 — refCount 를 올리면 자주 배우는 지식일수록 랭킹이 강등된다.
    expect(r.card.refCount).toBe(0);
  });

  it('같은 지식을 여러 번 저장해도 카드가 1장으로 유지된다(append 로 인한 분기 회귀 방지)', () => {
    const input = {
      type: 'mistake' as const, scope: 'project' as const,
      title: '데이터베이스 연결 풀 고갈 실수',
      body: '커넥션 풀을 닫지 않아 고갈되는 실수가 있었다',
    };
    const first = svc.saveCard(input);
    for (let i = 0; i < 5; i++) svc.saveCard({ ...input, body: `${input.body} (${i}회차)` });
    expect(svc.listCards().length).toBe(1);
    expect(svc.getCard(first.id)?.body).toBe(input.body);
  });

  it('전혀 다른 내용은 새 카드로 저장한다', () => {
    svc.saveCard({ type: 'rule', scope: 'project', title: '탭 대신 스페이스', body: '들여쓰기는 스페이스 두 칸' });
    svc.saveCard({ type: 'decision', scope: 'project', title: '포트는 4800 사용', body: '개발 서버 포트 결정' });
    expect(svc.listCards().length).toBe(2);
  });

  it('scope 가 다르면 별개로 취급(프로젝트 vs 에이전트)', () => {
    svc.saveCard({ type: 'lesson', scope: 'project', title: '동일 제목 카드', body: '같은 내용 같은 내용' });
    svc.saveCard({ type: 'lesson', scope: 'agent', agentId: 'a1', title: '동일 제목 카드', body: '같은 내용 같은 내용' });
    expect(svc.listCards().length).toBe(2);
  });
});

describe('search — 랭킹', () => {
  it('title 매치가 body 매치보다 높은 점수', () => {
    const titleHit = svc.saveCard({ type: 'fact', scope: 'project', title: '웹소켓 재연결 전략', body: '무관한 본문' });
    svc.saveCard({ type: 'fact', scope: 'project', title: '무관한 제목', body: '여기에 웹소켓 언급이 있다' });
    const results = svc.search('웹소켓');
    expect(results.length).toBe(2);
    expect(results[0]!.id).toBe(titleHit.id);
  });

  it('매치 없으면 빈 배열', () => {
    svc.saveCard({ type: 'fact', scope: 'project', title: 'foo', body: 'bar' });
    expect(svc.search('존재하지않는검색어xyz').length).toBe(0);
  });
});

describe('promoteCard — agent → project 이동', () => {
  it('개별 카드를 프로젝트로 승격하면 파일이 이동한다', () => {
    const card = svc.saveCard({ type: 'lesson', scope: 'agent', agentId: 'agent-y', title: '승격 대상', body: 'z' });
    const agentPath = path.join(root, '.vibisual/brain/agents/agent-y', `${card.id}.md`);
    expect(fs.existsSync(agentPath)).toBe(true);

    const promoted = svc.promoteCard(card.id);
    expect(promoted?.scope).toBe('project');
    expect(promoted?.agentId).toBeUndefined();
    const projectPath = path.join(root, '.vibisual/brain/project', `${card.id}.md`);
    expect(fs.existsSync(projectPath)).toBe(true);
    expect(fs.existsSync(agentPath)).toBe(false); // 이동 — 원본 삭제(복사 ❌)
  });
});

describe('getCardsForFiles — 파일 접근 경고 매칭', () => {
  it('연결 파일 경로가 일치하는 실수/교훈 카드만 반환', () => {
    svc.saveCard({
      type: 'mistake', scope: 'project', title: 'foo.ts 관련 실수', body: 'b',
      files: ['packages/server/src/foo.ts'],
    });
    svc.saveCard({
      type: 'fact', scope: 'project', title: '무관 사실', body: 'b',
      files: ['packages/server/src/foo.ts'],
    }); // fact 는 경고 대상 아님
    svc.saveCard({
      type: 'lesson', scope: 'project', title: '다른 파일', body: 'b',
      files: ['packages/client/src/bar.ts'],
    });
    // 절대경로로 조회 — 상대 경로 카드가 suffix 로 매칭돼야.
    const hits = svc.getCardsForFiles(['C:/proj/packages/server/src/foo.ts']);
    expect(hits.length).toBe(1);
    expect(hits[0]!.title).toBe('foo.ts 관련 실수');
  });
});

describe('updateCard — 부분 업데이트(PUT-wipe 회피)', () => {
  it('undefined 필드는 기존값을 유지한다', () => {
    const card = svc.saveCard({
      type: 'rule', scope: 'project', title: '원제목', body: '원본문',
      files: ['a.ts'],
    });
    const updated = svc.updateCard(card.id, { title: '새제목' });
    expect(updated?.title).toBe('새제목');
    expect(updated?.body).toBe('원본문');   // 유지
    expect(updated?.files).toEqual(['a.ts']); // 유지
    expect(updated?.type).toBe('rule');       // 유지
  });
});

describe('sweepStaleCards — 신선도', () => {
  it('연결 파일이 없으면 active → ghost', () => {
    svc.saveCard({
      type: 'mistake', scope: 'project', title: '소실 파일', body: 'b',
      files: ['does/not/exist.ts'],
    });
    const changed = svc.sweepStaleCards();
    expect(changed).toBe(true);
    expect(svc.listCards()[0]!.status).toBe('ghost');
  });

  it('실제 존재 파일이면 active 유지', () => {
    const realRel = 'real-file.ts';
    fs.writeFileSync(path.join(root, realRel), 'x');
    svc.saveCard({ type: 'lesson', scope: 'project', title: '존재 파일', body: 'b', files: [realRel] });
    svc.sweepStaleCards();
    expect(svc.listCards()[0]!.status).toBe('active');
  });
});

describe('getSummary + markSeen', () => {
  it('요약이 카드 수/미확인 수/에이전트별 수를 집계', () => {
    svc.saveCard({ type: 'rule', scope: 'project', title: 'p1', body: 'x', seen: false });
    const a = svc.saveCard({ type: 'lesson', scope: 'agent', agentId: 'a1', title: 'a1c', body: 'x', seen: false });
    const s1 = svc.getSummary();
    expect(s1.cardCount).toBe(2);
    expect(s1.unseenCount).toBe(2);
    expect(s1.agentCardCounts.a1).toBe(1);

    svc.markSeen(a.id);
    expect(svc.getSummary().unseenCount).toBe(1);
  });
});

describe('markHelpful — v3.49 도움됨 집계 + frontmatter roundtrip', () => {
  it('helpfulCount++·lastHelpfulAt 갱신 후 frontmatter 로 영속(새 인스턴스가 읽음)', () => {
    vi.useFakeTimers();
    try {
      const card = svc.saveCard({ type: 'lesson', scope: 'project', title: '도움 카드', body: 'x' });
      expect(svc.markHelpful(card.id)?.helpfulCount).toBe(1);
      const after = svc.markHelpful(card.id);
      expect(after?.helpfulCount).toBe(2);
      expect(after?.lastHelpfulAt).toBeGreaterThan(0);
      // 디바운스 flush 발화 → 디스크 기록
      vi.advanceTimersByTime(10_000);
      const fp = path.join(root, '.vibisual/brain/project', `${card.id}.md`);
      const text = fs.readFileSync(fp, 'utf8');
      expect(text).toContain('helpfulCount: 2');
      expect(text).toMatch(/lastHelpfulAt: \d+/);
      const svc2 = new BrainService(root);
      expect(svc2.getCard(card.id)?.helpfulCount).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('미지 id 는 null', () => {
    expect(svc.markHelpful('card-does-not-exist')).toBeNull();
  });
});

describe('rankCards — v3.49 유튜브식 랭킹', () => {
  it('도움됨이 높은 카드가 상위로(관련도 동률일 때)', () => {
    const a = svc.saveCard({ type: 'fact', scope: 'project', title: 'A 카드', body: 'aaa' });
    const b = svc.saveCard({ type: 'fact', scope: 'project', title: 'B 카드', body: 'bbb' });
    for (let i = 0; i < 5; i++) svc.markHelpful(b.id);
    const ranked = svc.rankCards(svc.listCards({ scope: 'project' }), {});
    expect(ranked[0]!.card.id).toBe(b.id);
  });

  it('노출(refCount) 많은데 도움 0 이면 강등되어 신선한 카드보다 아래', () => {
    const stale = svc.saveCard({ type: 'fact', scope: 'project', title: '낡은 카드', body: 'x' });
    svc.touchReferences(Array(8).fill(stale.id)); // refCount=8, helpful=0 → 강등 대상
    const fresh = svc.saveCard({ type: 'fact', scope: 'project', title: '새 카드', body: 'y' });
    const ranked = svc.rankCards(svc.listCards({ scope: 'project' }), {});
    const staleScore = ranked.find((r) => r.card.id === stale.id)!.score;
    const freshScore = ranked.find((r) => r.card.id === fresh.id)!.score;
    expect(freshScore).toBeGreaterThan(staleScore);
    expect(ranked[0]!.card.id).toBe(fresh.id);
  });

  it('신선도 — 최근 갱신 카드가 오래된 카드보다 상위', () => {
    const now = Date.now();
    const base: BrainCard = {
      id: 'c-fresh', type: 'fact', scope: 'project', title: 'fresh', body: '', files: [],
      createdAt: now, updatedAt: now, refCount: 0, status: 'active',
    };
    const fresh: BrainCard = { ...base };
    const old: BrainCard = { ...base, id: 'c-old', title: 'old', createdAt: now - 60 * DAY_MS, updatedAt: now - 60 * DAY_MS };
    const ranked = svc.rankCards([old, fresh], {});
    expect(ranked[0]!.card.id).toBe('c-fresh');
  });

  it('ghost/archived 는 기본 제외, includeHidden 로 포함', () => {
    const g: BrainCard = {
      id: 'c-ghost', type: 'fact', scope: 'project', title: 'g', body: '', files: [],
      createdAt: Date.now(), updatedAt: Date.now(), refCount: 0, status: 'ghost',
    };
    expect(svc.rankCards([g], {}).length).toBe(0);
    expect(svc.rankCards([g], {}, { includeHidden: true }).length).toBe(1);
  });
});

describe('getFeed — v3.49 피드 섹션', () => {
  it('섹션 상한·교차 dedupe(중복 없음)·totalCount', () => {
    for (let i = 0; i < 20; i++) {
      svc.saveCard({ type: 'fact', scope: 'project', title: `카드${i}`, body: `본문 ${i}` });
    }
    const feed = svc.getFeed({ scope: 'project' });
    expect(feed.totalCount).toBe(20);
    expect(feed.sections.related.length).toBeLessThanOrEqual(8);
    expect(feed.sections.related.length).toBeGreaterThan(0);
    const all = [
      ...feed.sections.related, ...feed.sections.recent,
      ...feed.sections.frequent, ...feed.sections.resurface,
    ].map((c) => c.id);
    expect(new Set(all).size).toBe(all.length); // 섹션 간 중복 제거됨
  });

  it('frequent 은 helpfulCount>0 만 담는다', () => {
    // pool 을 충분히 키워 related 가 전부 흡수하지 않도록(>8)
    const hot = svc.saveCard({ type: 'fact', scope: 'project', title: '도움 카드', body: 'h' });
    for (let i = 0; i < 12; i++) svc.saveCard({ type: 'fact', scope: 'project', title: `기타${i}`, body: `x${i}` });
    for (let i = 0; i < 3; i++) svc.markHelpful(hot.id);
    const feed = svc.getFeed({ scope: 'project' });
    for (const c of feed.sections.frequent) expect((c.helpfulCount ?? 0)).toBeGreaterThan(0);
  });

  it('resurface — 오래 미참조 + 낮은 랭킹 카드가 재노출 슬롯에', () => {
    const R = svc.saveCard({ type: 'fact', scope: 'project', title: '오랜만 카드', body: 'z' });
    svc.touchReferences(Array(8).fill(R.id));               // 강등(노출 많고 도움 0)
    svc.updateCard(R.id, { lastReferencedAt: Date.now() - 30 * DAY_MS }); // 21일 초과 → 재노출 후보
    for (let i = 0; i < 16; i++) svc.saveCard({ type: 'fact', scope: 'project', title: `신선${i}`, body: `b${i}` });
    const feed = svc.getFeed({ scope: 'project' });
    expect(feed.sections.resurface.some((c) => c.id === R.id)).toBe(true);
    expect(feed.sections.related.some((c) => c.id === R.id)).toBe(false);
    expect(feed.sections.recent.some((c) => c.id === R.id)).toBe(false);
  });

  it('agent scope — related 에 프로젝트 카드도 합류, 풀은 그 에이전트 카드만', () => {
    svc.saveCard({ type: 'rule', scope: 'project', title: '프로젝트 규칙', body: 'p' });
    svc.saveCard({ type: 'lesson', scope: 'agent', agentId: 'a1', title: '에이전트 교훈', body: 'q' });
    const feed = svc.getFeed({ scope: 'agent', agentId: 'a1' });
    expect(feed.totalCount).toBe(1); // 풀은 a1 카드만
    // related 후보에 프로젝트 카드가 합류(둘 다 노출될 수 있음)
    const relatedIds = feed.sections.related.map((c) => c.scope);
    expect(relatedIds).toContain('agent');
    expect(relatedIds).toContain('project');
  });
});

describe('search — v3.49 랭킹 정렬 유지', () => {
  it('관련도가 도움됨보다 우세(title 매치가 body 매치를 이긴다)', () => {
    const titleHit = svc.saveCard({ type: 'fact', scope: 'project', title: '캐시 전략 문서', body: '무관' });
    const bodyHit = svc.saveCard({ type: 'fact', scope: 'project', title: '무관 제목', body: '여기 캐시 언급' });
    for (let i = 0; i < 10; i++) svc.markHelpful(bodyHit.id); // 도움됨 부스트에도 불구하고
    const results = svc.search('캐시');
    expect(results[0]!.id).toBe(titleHit.id);
  });
});

describe('deleteAgentCards — 영구 삭제 cascade', () => {
  it('특정 에이전트의 개별 기억 파일 디렉토리를 삭제', () => {
    svc.saveCard({ type: 'lesson', scope: 'agent', agentId: 'gone', title: 'c1', body: 'x' });
    svc.saveCard({ type: 'lesson', scope: 'agent', agentId: 'gone', title: 'c2', body: 'y' });
    svc.saveCard({ type: 'rule', scope: 'project', title: 'keep', body: 'z' });
    const n = svc.deleteAgentCards('gone');
    expect(n).toBe(2);
    expect(fs.existsSync(path.join(root, '.vibisual/brain/agents/gone'))).toBe(false);
    expect(svc.listCards().length).toBe(1); // project 카드는 남음
  });
});

// ─── §5.10 v3.74 주제 축 — 색인 + 주제 문서 + 상시 규칙 ───

describe('v3.74 주제 자동 분류(classifyTopic)', () => {
  it('제목의 주제어로 분류한다', () => {
    expect(classifyTopic({ title: '캡처 원격 조작은 손을 뗀 뒤 재생 방식 필수' })).toBe('capture-remote');
    expect(classifyTopic({ title: '워크트리 병합 시 EOL LF 정규화 필수' })).toBe('worktree-isolation');
    expect(classifyTopic({ title: 'Renderer HMR 없음 — /runapp 재실행으로만 반영' })).toBe('runapp-build');
    expect(classifyTopic({ title: 'statusLine 은 렌더마다 실행된다' })).toBe('usage-statusline');
  });

  it('어느 패턴에도 안 걸리면 misc', () => {
    expect(classifyTopic({ title: '점심은 김치찌개' })).toBe('misc');
  });

  it('제목이 비어도 본문·연결 파일로 분류한다', () => {
    expect(classifyTopic({ title: '', body: '체크포인트 복원 시 주의' })).toBe('persistence-checkpoint');
    expect(classifyTopic({ title: '', files: ['packages/server/src/services/brainService.ts'] })).toBe('brain-memory');
  });
});

describe('v3.74 saveCard 주제 부여', () => {
  it('프로젝트 카드는 topic 을 자동으로 갖는다', () => {
    const c = svc.saveCard({ type: 'lesson', scope: 'project', title: 'DPI 배율 혼합 좌표 오류', body: 'x' });
    expect(c.topic).toBe('capture-remote');
    const text = fs.readFileSync(path.join(root, '.vibisual/brain/project', `${c.id}.md`), 'utf8');
    expect(text).toContain('topic: capture-remote');
  });

  it('입력이 topic 을 지정하면 자동 분류보다 우선한다', () => {
    const c = svc.saveCard({ type: 'fact', scope: 'project', title: '캡처 이야기', body: 'x', topic: 'ui-client' });
    expect(c.topic).toBe('ui-client');
  });

  // v3.75 — 에이전트 층에도 주제 축을 적용하도록 정책이 바뀌었다(구 v3.74 기대값 폐기).
  it('에이전트 카드에도 주제를 붙인다(v3.75 두 층 대칭)', () => {
    const c = svc.saveCard({ type: 'lesson', scope: 'agent', agentId: 'agent-1', title: '캡처 교훈', body: 'x' });
    expect(c.topic).toBe('capture-remote');
  });

  it('구버전 카드(topic 없음)는 로드 시 백필된다', () => {
    const dir = path.join(root, '.vibisual/brain/project');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'card-legacy-1.md'),
      ['---', 'id: card-legacy-1', 'type: rule', 'scope: project', 'title: 워크트리 격리 규칙',
       'createdAt: 1', 'updatedAt: 1', 'refCount: 0', 'status: active', 'seen: true', '---', '', '본문'].join('\n'),
    );
    const fresh = new BrainService(root);
    expect(fresh.getCard('card-legacy-1')?.topic).toBe('worktree-isolation');
    // 백필은 파일에도 남아 다음 부팅엔 재분류가 필요 없다.
    expect(fs.readFileSync(path.join(dir, 'card-legacy-1.md'), 'utf8')).toContain('topic: worktree-isolation');
  });
});

describe('v3.74 주제 색인(listTopicIndex)', () => {
  it('카드가 있는 주제만 BRAIN_TOPICS 정의 순서로 돌려준다', () => {
    svc.saveCard({ type: 'fact', scope: 'project', title: 'statusLine 수집기', body: 'x' });
    svc.saveCard({ type: 'lesson', scope: 'project', title: '캡처 커서 복원', body: 'x' });
    svc.saveCard({ type: 'lesson', scope: 'project', title: '캡처 DPI 좌표', body: 'x' });
    const idx = svc.listTopicIndex();
    expect(idx.map((e) => e.slug)).toEqual(['capture-remote', 'usage-statusline']);
    expect(idx[0]?.cardCount).toBe(2);
    expect(idx[0]?.docPath).toContain('/topics/capture-remote.md');
    expect(idx[0]?.whenToRead).toBeTruthy();
  });

  it('에이전트 카드는 색인에 들어가지 않는다', () => {
    svc.saveCard({ type: 'lesson', scope: 'agent', agentId: 'a1', title: '캡처 교훈', body: 'x' });
    expect(svc.listTopicIndex()).toEqual([]);
  });

  it('archived 카드는 세지 않는다', () => {
    const c = svc.saveCard({ type: 'fact', scope: 'project', title: '캡처 사실', body: 'x' });
    svc.updateCard(c.id, { status: 'archived' });
    expect(svc.listTopicIndex()).toEqual([]);
  });
});

describe('v3.74 주제 문서(renderTopicDoc / rebuildTopicDocs)', () => {
  it('문서에 카드 id·타입·제목·본문이 실린다', () => {
    const c = svc.saveCard({ type: 'lesson', scope: 'project', title: '캡처 교훈', body: '손 뗀 뒤 주입' });
    const doc = svc.renderTopicDoc('capture-remote');
    expect(doc).toContain(`## [${c.id}] (lesson) 캡처 교훈`);
    expect(doc).toContain('손 뗀 뒤 주입');
    expect(doc).toContain('언제 읽나');
  });

  it('원본이 카드임을 문서 머리에 명시한다(사람이 고쳤다 덮어써지는 사고 방지)', () => {
    svc.saveCard({ type: 'fact', scope: 'project', title: '캡처 사실', body: 'x' });
    expect(svc.renderTopicDoc('capture-remote')).toContain('자동 생성');
  });

  it('저장 시 주제 문서 파일이 만들어진다', () => {
    svc.saveCard({ type: 'fact', scope: 'project', title: '워크트리 격리', body: 'x' });
    expect(fs.existsSync(path.join(root, '.vibisual/brain/topics/worktree-isolation.md'))).toBe(true);
  });

  it('카드가 0이 된 주제의 문서는 지운다(옛 내용을 읽지 않도록)', () => {
    const c = svc.saveCard({ type: 'fact', scope: 'project', title: '워크트리 격리', body: 'x' });
    const docPath = path.join(root, '.vibisual/brain/topics/worktree-isolation.md');
    expect(fs.existsSync(docPath)).toBe(true);
    svc.deleteCard(c.id);
    expect(fs.existsSync(docPath)).toBe(false);
  });
});

describe('v3.74 상시 규칙(listAlwaysRules)', () => {
  it('always=true 인 프로젝트 rule 만 돌려준다', () => {
    const a = svc.saveCard({ type: 'rule', scope: 'project', title: '상시 규칙', body: 'x', always: true });
    svc.saveCard({ type: 'rule', scope: 'project', title: '보통 규칙', body: 'x' });
    svc.saveCard({ type: 'lesson', scope: 'project', title: '교훈인데 상시', body: 'x', always: true });
    const rules = svc.listAlwaysRules();
    expect(rules.map((c) => c.id)).toEqual([a.id]);
  });

  it('토글로 켜고 끌 수 있다(updateCard)', () => {
    const c = svc.saveCard({ type: 'rule', scope: 'project', title: '규칙', body: 'x' });
    expect(svc.listAlwaysRules()).toHaveLength(0);
    svc.updateCard(c.id, { always: true });
    expect(svc.listAlwaysRules().map((x) => x.id)).toEqual([c.id]);
    svc.updateCard(c.id, { always: false });
    expect(svc.listAlwaysRules()).toHaveLength(0);
  });

  it('상한(BRAIN_ALWAYS_RULE_MAX)을 넘지 않는다', () => {
    for (let i = 0; i < BRAIN_ALWAYS_RULE_MAX + 3; i++) {
      svc.saveCard({ type: 'rule', scope: 'project', title: `상시 규칙 ${i} 서로 다른 낱말 ${i}`, body: `본문 ${i}`, always: true });
    }
    expect(svc.listAlwaysRules().length).toBeLessThanOrEqual(BRAIN_ALWAYS_RULE_MAX);
  });
});

// ─── §5.10 v3.75 에이전트 층 주제 축 ───

describe('v3.75 에이전트 층 주제', () => {
  it('에이전트 카드도 주제를 갖는다(두 층 대칭)', () => {
    const c = svc.saveCard({ type: 'lesson', scope: 'agent', agentId: 'a1', title: 'DPI 좌표 오류', body: 'x' });
    expect(c.topic).toBe('capture-remote');
  });

  it('색인이 층별로 갈린다 — 프로젝트 색인에 에이전트 카드가 섞이지 않는다', () => {
    svc.saveCard({ type: 'fact', scope: 'project', title: '워크트리 격리', body: 'x' });
    svc.saveCard({ type: 'lesson', scope: 'agent', agentId: 'a1', title: '캡처 커서', body: 'x' });
    expect(svc.listTopicIndex().map((e) => e.slug)).toEqual(['worktree-isolation']);
    expect(svc.listTopicIndex('a1').map((e) => e.slug)).toEqual(['capture-remote']);
  });

  it('에이전트가 다르면 색인도 다르다', () => {
    svc.saveCard({ type: 'lesson', scope: 'agent', agentId: 'a1', title: '캡처 커서', body: 'x' });
    svc.saveCard({ type: 'lesson', scope: 'agent', agentId: 'a2', title: 'statusLine 수집', body: 'x' });
    expect(svc.listTopicIndex('a1').map((e) => e.slug)).toEqual(['capture-remote']);
    expect(svc.listTopicIndex('a2').map((e) => e.slug)).toEqual(['usage-statusline']);
  });

  it('에이전트 주제 문서는 topics/agents/<agentId>/ 아래에 쓴다', () => {
    svc.saveCard({ type: 'lesson', scope: 'agent', agentId: 'a1', title: '캡처 커서', body: 'x' });
    expect(fs.existsSync(path.join(root, '.vibisual/brain/topics/agents/a1/capture-remote.md'))).toBe(true);
    // 프로젝트 문서 폴더는 오염되지 않는다.
    expect(fs.existsSync(path.join(root, '.vibisual/brain/topics/capture-remote.md'))).toBe(false);
  });

  it('승격하면 에이전트 문서에서 빠지고 프로젝트 문서로 옮겨간다', () => {
    const c = svc.saveCard({ type: 'lesson', scope: 'agent', agentId: 'a1', title: '캡처 커서', body: 'x' });
    svc.promoteCard(c.id);
    expect(svc.listTopicIndex('a1')).toEqual([]);
    expect(svc.listTopicIndex().map((e) => e.slug)).toEqual(['capture-remote']);
    expect(fs.existsSync(path.join(root, '.vibisual/brain/topics/agents/a1/capture-remote.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.vibisual/brain/topics/capture-remote.md'))).toBe(true);
  });

  it('rebuildAllTopicDocs 는 두 층 문서를 모두 만든다', () => {
    svc.saveCard({ type: 'fact', scope: 'project', title: '워크트리 격리', body: 'x' });
    svc.saveCard({ type: 'lesson', scope: 'agent', agentId: 'a1', title: '캡처 커서', body: 'x' });
    fs.rmSync(path.join(root, '.vibisual/brain/topics'), { recursive: true, force: true });
    svc.rebuildAllTopicDocs();
    expect(fs.existsSync(path.join(root, '.vibisual/brain/topics/worktree-isolation.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.vibisual/brain/topics/agents/a1/capture-remote.md'))).toBe(true);
  });
});

// ─── §5.10 v3.78 수명주기 재설계 ───────────────────────────────────────────────

describe('v3.78 B — 유효기간 2축(모순은 삭제가 아니라 닫는다)', () => {
  it('부정 극성이 뒤집힌 유사 카드는 모순으로 보고 옛 카드를 닫는다', () => {
    const old = svc.saveCard({
      type: 'rule', scope: 'project',
      title: 'statusLine 수집기는 폴링으로 붙여라',
      body: 'statusLine 수집기는 폴링으로 붙여야 값이 안정적이다',
    });
    const r = svc.saveCardDetailed({
      type: 'rule', scope: 'project',
      title: 'statusLine 수집기는 폴링으로 붙이지 마라',
      body: 'statusLine 수집기는 폴링으로 붙이면 안 된다 — 훅 푸시를 써라',
    });
    expect(r.outcome).toBe('superseded');
    expect(r.closedIds).toContain(old.id);
    const closed = svc.getCard(old.id);
    expect(closed?.validUntil).toBe(r.card.createdAt);
    expect(closed?.supersededBy).toBe(r.card.id);
    expect(r.card.supersedes).toEqual([old.id]);
    expect(r.card.supersededNote).toContain('폴링');
  });

  it('닫힌 카드는 목록·검색·요약 어디에도 나오지 않는다(파일은 남는다)', () => {
    const old = svc.saveCard({
      type: 'rule', scope: 'project',
      title: '워크트리 병합은 자동으로 하라',
      body: '워크트리 병합은 자동으로 처리하면 편하다',
    });
    svc.saveCard({
      type: 'rule', scope: 'project',
      title: '워크트리 병합은 자동으로 하지 마라',
      body: '워크트리 병합은 자동으로 처리하면 안 된다',
    });
    expect(svc.listCards().map((c) => c.id)).not.toContain(old.id);
    expect(svc.search('워크트리 병합').map((c) => c.id)).not.toContain(old.id);
    expect(svc.getSummary().cardCount).toBe(1);
    // 파일은 그대로 — 이력이지 삭제가 아니다.
    expect(fs.existsSync(path.join(root, '.vibisual/brain/project', `${old.id}.md`))).toBe(true);
  });

  it('contradicts 로 명시 지목하면 유사도와 무관하게 그 카드를 닫는다', () => {
    const old = svc.saveCard({ type: 'fact', scope: 'project', title: '포트는 4800', body: '개발 서버 포트' });
    const r = svc.saveCardDetailed({
      type: 'fact', scope: 'project', title: '이제 포트는 동적 할당', body: '완전히 다른 문장',
      contradicts: old.id,
    });
    expect(r.closedIds).toEqual([old.id]);
    expect(svc.getCard(old.id)?.validUntil).toBeGreaterThan(0);
  });

  it('겹치지 않는 새 지식은 보완으로 보고 아무것도 닫지 않는다', () => {
    svc.saveCard({ type: 'rule', scope: 'project', title: '탭 대신 스페이스', body: '들여쓰기 규칙' });
    const r = svc.saveCardDetailed({ type: 'decision', scope: 'project', title: '캡처는 nut.js', body: '원격 주입 결정' });
    expect(r.outcome).toBe('new');
    expect(r.closedIds).toEqual([]);
    expect(svc.listCards().length).toBe(2);
  });

  it('대체 체인을 양방향으로 되짚을 수 있다', () => {
    const v1 = svc.saveCard({ type: 'rule', scope: 'project', title: '캡처 주입은 즉시 하라', body: '캡처 주입은 즉시 처리한다' });
    const v2 = svc.saveCard({ type: 'rule', scope: 'project', title: '캡처 주입은 즉시 하지 마라', body: '캡처 주입은 즉시 처리하면 안 된다' });
    expect(svc.getSupersedeChain(v2.id).older.map((c) => c.id)).toEqual([v1.id]);
    expect(svc.getSupersedeChain(v1.id).newer.map((c) => c.id)).toEqual([v2.id]);
  });

  it('재시작(디스크 재로드) 후에도 닫힘 상태가 보존된다', () => {
    const old = svc.saveCard({ type: 'rule', scope: 'project', title: '엣지 dispatch 는 허용하라', body: '엣지 dispatch 는 허용한다' });
    svc.saveCard({ type: 'rule', scope: 'project', title: '엣지 dispatch 는 허용하지 마라', body: '엣지 dispatch 는 허용하면 안 된다' });
    const svc2 = new BrainService(root);
    expect(svc2.getCard(old.id)?.validUntil).toBeGreaterThan(0);
    expect(svc2.listCards().length).toBe(1);
  });
});

describe('v3.78 C — 코드 변경 기반 무효화(앵커)', () => {
  const writeFile = (rel: string, text: string): string => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
    return rel;
  };

  it('저장 시 연결 파일의 내용 해시를 앵커로 박는다', () => {
    const rel = writeFile('src/foo.ts', 'export const a = 1;');
    const card = svc.saveCard({ type: 'lesson', scope: 'project', title: 'foo 규칙', body: 'x', files: [rel] });
    expect(card.anchors?.[0]?.path).toBe(rel);
    expect(card.anchors?.[0]?.sha).toMatch(/^[0-9a-f]{16}$/);
  });

  it('그 파일이 실제로 바뀌면 확인 필요로 전이하고 편집 횟수를 센다', () => {
    const rel = writeFile('src/foo.ts', 'export const a = 1;');
    const card = svc.saveCard({ type: 'lesson', scope: 'project', title: 'foo 규칙', body: 'x', files: [rel] });
    writeFile('src/foo.ts', 'export const a = 2;');
    expect(svc.noteFilesEdited([rel])).toBe(1);
    const after = svc.getCard(card.id);
    expect(after?.verifyState).toBe('needs-check');
    expect(after?.anchors?.[0]?.editedSince).toBe(1);
    expect(svc.staleHint(after as BrainCard)).toContain('1회 수정됨');
  });

  it('내용이 그대로면(포맷터가 훑고 지나간 저장) 확인 필요로 만들지 않는다', () => {
    const rel = writeFile('src/foo.ts', 'export const a = 1;');
    const card = svc.saveCard({ type: 'lesson', scope: 'project', title: 'foo 규칙', body: 'x', files: [rel] });
    expect(svc.noteFilesEdited([rel])).toBe(0);
    // v3.81 — 저장 직후 기본값은 `candidate`(저장됐다 ≠ 검증됐다). 확인 필요로 **전이하지 않았다**는 것이 요지.
    expect(svc.getCard(card.id)?.verifyState).toBe('candidate');
  });

  // v3.81 에서 이 규약은 뒤집혔다 — 아래 'v3.81 G' 블록이 후신이다(확인 필요는 기본 주입에서 빠진다).
  it('확인 필요 카드도 목록·검색에는 남는다(이력·검토용 — 기본 주입은 v3.81 에서 제외)', () => {
    const rel = writeFile('src/foo.ts', 'export const a = 1;');
    const card = svc.saveCard({ type: 'rule', scope: 'project', title: '렌더러 HMR 없음', body: '재기동 필요', files: [rel], always: true });
    writeFile('src/foo.ts', 'export const a = 2;');
    svc.noteFilesEdited([rel]);
    expect(svc.listAlwaysRules().map((c) => c.id)).toContain(card.id);
    expect(svc.search('렌더러').map((c) => c.id)).toContain(card.id);
    expect(svc.listNeedsCheck().map((c) => c.id)).toContain(card.id);
  });

  it('재검증(맞음)은 앵커를 다시 박고 확인 필요를 해제한다', () => {
    const rel = writeFile('src/foo.ts', 'export const a = 1;');
    const card = svc.saveCard({ type: 'lesson', scope: 'project', title: 'foo 규칙', body: 'x', files: [rel] });
    writeFile('src/foo.ts', 'export const a = 2;');
    svc.noteFilesEdited([rel]);
    // v3.81 — 재검증은 `undefined`(옛 'ok')가 아니라 **verified** 로 올린다. 권위가 함께 기록된다.
    const back = svc.reverifyCard(card.id);
    expect(back?.verifyState).toBe('verified');
    expect(back?.authority).toBe('user-explicit');
    expect(back?.verifiedAt).toBeGreaterThan(0);
    expect(back?.anchors?.[0]?.editedSince).toBeUndefined();
    expect(svc.listNeedsCheck()).toEqual([]);
  });

  it('사람이 본문을 편집하면 앵커가 갱신되고 확인 필요가 풀린다', () => {
    const rel = writeFile('src/foo.ts', 'export const a = 1;');
    const card = svc.saveCard({ type: 'lesson', scope: 'project', title: 'foo 규칙', body: 'x', files: [rel] });
    writeFile('src/foo.ts', 'export const a = 2;');
    svc.noteFilesEdited([rel]);
    // v3.81 — 편집은 앵커를 다시 박아 "확인 필요"를 풀지만 **검증을 자동 회복시키지는 않는다**
    //   (편집 ≠ 확인 — 손대기만 해도 진실이 되던 구멍을 막았다). 후보로 되돌아가 사용자 확인을 기다린다.
    const edited = svc.updateCard(card.id, { body: '지금 코드 기준으로 다시 씀' });
    expect(edited?.verifyState).toBe('candidate');
    expect(svc.listNeedsCheck()).toEqual([]);
  });
});

describe('v3.78 D — 재검증 1비트(낡음 신고)', () => {
  it('낡음 신고가 누적되면 자동 보관된다(파일은 archive 로 이동 — 삭제 ❌)', () => {
    const card = svc.saveCard({ type: 'fact', scope: 'project', title: '낡은 사실', body: 'x' });
    svc.markStale(card.id);
    expect(svc.getCard(card.id)?.verifyState).toBe('needs-check');
    expect(svc.getCard(card.id)?.status).toBe('active');
    svc.markStale(card.id);
    expect(svc.getCard(card.id)?.status).toBe('archived');
    expect(fs.existsSync(path.join(root, '.vibisual/brain/project', `${card.id}.md`))).toBe(false);
    expect(fs.existsSync(path.join(root, '.vibisual/brain/archive/project', `${card.id}.md`))).toBe(true);
  });

  it('pinned 카드는 낡음 신고가 쌓여도 보관되지 않는다', () => {
    const card = svc.saveCard({ type: 'fact', scope: 'project', title: '고정 사실', body: 'x', pinned: true });
    svc.markStale(card.id);
    svc.markStale(card.id);
    svc.markStale(card.id);
    expect(svc.getCard(card.id)?.status).toBe('active');
  });

  it('되돌리기로 보관 카드를 원래 자리로 복구한다', () => {
    const card = svc.saveCard({ type: 'fact', scope: 'project', title: '되살릴 사실', body: 'x' });
    svc.archiveCard(card.id);
    expect(svc.listArchived().map((c) => c.id)).toEqual([card.id]);
    svc.restoreCard(card.id);
    expect(svc.getCard(card.id)?.status).toBe('active');
    expect(svc.listArchived()).toEqual([]);
    expect(fs.existsSync(path.join(root, '.vibisual/brain/project', `${card.id}.md`))).toBe(true);
  });

  it('보관 카드는 재시작 후에도 보관 상태로 다시 읽힌다', () => {
    const card = svc.saveCard({ type: 'fact', scope: 'project', title: '보관 사실', body: 'x' });
    svc.archiveCard(card.id);
    const svc2 = new BrainService(root);
    expect(svc2.listArchived().map((c) => c.id)).toEqual([card.id]);
    expect(svc2.listCards().map((c) => c.id)).not.toContain(card.id);
  });
});

describe('v3.78 E — 예산제 강등', () => {
  it('주제 정원을 넘으면 하위부터 보관으로 내려간다(pinned 는 면제)', () => {
    const pinned = svc.saveCard({ type: 'rule', scope: 'project', topic: 'misc', title: '고정 규칙', body: '고정', pinned: true });
    for (let i = 0; i < 40; i++) {
      // 토큰이 실제로 달라야 한다 — `사실 ${i}` 처럼 숫자만 다르면 1글자 토큰이 버려져
      // 전부 같은 토큰 집합이 되고, 그러면 dedup 이 전부 1장으로 합쳐 예산 테스트가 무의미해진다.
      svc.saveCard({ type: 'fact', scope: 'project', topic: 'misc', title: `주제어${i}번카드`, body: `본문내용${i}번 세부설명${i}` });
    }
    const open = svc.listCards({ scope: 'project' }).filter((c) => (c.topic ?? 'misc') === 'misc');
    expect(open.length).toBeLessThanOrEqual(BRAIN_TOPIC_CARD_BUDGET);
    expect(svc.getCard(pinned.id)?.status).toBe('active');
    expect(svc.listArchived().length).toBeGreaterThan(0);
  });

  it('확인 필요 카드가 랭킹만 낮은 카드보다 먼저 강등된다', () => {
    const stale = svc.saveCard({ type: 'fact', scope: 'project', topic: 'misc', title: '낡은 후보', body: '고유한 본문 하나' });
    svc.markStale(stale.id); // needs-check (1회 — 아직 보관 아님)
    for (let i = 0; i < 30; i++) {
      svc.saveCard({ type: 'fact', scope: 'project', topic: 'misc', title: `주제어${i}번카드`, body: `본문내용${i}번 세부설명${i}` });
    }
    expect(svc.getCard(stale.id)?.status).toBe('archived');
  });
});

describe('v3.78 — 주제 문서 핵심 N장 + 접기', () => {
  it('핵심 정원을 넘는 카드는 details 로 접힌다', () => {
    for (let i = 0; i < 20; i++) {
      svc.saveCard({ type: 'fact', scope: 'project', topic: 'misc', title: `주제어${i}번카드`, body: `본문내용${i}번 세부설명${i}` });
    }
    const doc = svc.renderTopicDoc('misc');
    expect(doc).toContain('<details>');
    expect(doc).toMatch(/그 외 \d+장/);
  });
});

describe('v3.78 — 승격 시 원 에이전트 링크 잔류', () => {
  it('승격된 카드는 promotedFrom 으로 원 소유자를 기억한다', () => {
    const c = svc.saveCard({ type: 'lesson', scope: 'agent', agentId: 'a1', title: '캡처 커서', body: 'x' });
    const promoted = svc.promoteCard(c.id);
    expect(promoted?.scope).toBe('project');
    expect(promoted?.promotedFrom).toBe('a1');
    expect(new BrainService(root).getCard(c.id)?.promotedFrom).toBe('a1');
  });
});

// ─── §5.10 v2 (C) 한국어 검색 승격 ───

describe('search — 한국어 조사·어미 (v2 커버리지 승격)', () => {
  it('조사가 붙은 본문을 어간으로 찾는다 (종전 어절 Jaccard 로는 못 찾던 자리)', () => {
    svc.saveCard({
      type: 'fact', scope: 'project',
      title: '사용량 수집기는 statusLine 으로 밀어 넣는다',
      body: '수집기는 외부 프로세스라 loopback 이 유일한 도달 경로다',
    });
    expect(svc.search('수집기').length).toBe(1);
  });

  it('어미가 달라도 찾는다', () => {
    svc.saveCard({
      type: 'lesson', scope: 'project',
      title: '체크포인트를 저장할 때 프리즈가 났다',
      body: '훅 경로에서 동기 저장을 코얼레스했다',
    });
    expect(svc.search('체크포인트 저장').length).toBe(1);
  });

  it('그래도 무관한 질의는 안 걸린다 (느슨해진 만큼 오탐이 늘지 않았는가)', () => {
    svc.saveCard({
      type: 'fact', scope: 'project',
      title: '사용량 수집기는 statusLine 으로 밀어 넣는다',
      body: '수집기는 외부 프로세스다',
    });
    expect(svc.search('릴리스 태그 발행 절차')).toEqual([]);
  });

  it('어절이 정확히 맞는 카드가 bigram 으로만 걸린 카드보다 앞선다', () => {
    svc.saveCard({ type: 'fact', scope: 'project', title: '수집기 정의', body: '수집기 라는 말의 뜻' });
    svc.saveCard({ type: 'fact', scope: 'project', title: '수집기는 무엇인가', body: '수집기는 이런 것' });
    const hits = svc.search('수집기');
    expect(hits.length).toBe(2);
    expect(hits[0]?.title).toBe('수집기 정의');
  });
});

// ─── §5.10 v2 (G) 운영자 프로필 층 ───

describe('user 층 — 3층째 저장·복원', () => {
  it('user 카드는 전용 폴더에 쓰인다 (프로젝트 층과 섞이지 않는다)', () => {
    const c = svc.saveCard({ type: 'fact', scope: 'user', title: '결론을 먼저 원한다', body: '근거' });
    expect(fs.existsSync(path.join(root, '.vibisual/brain/user', `${c.id}.md`))).toBe(true);
    expect(fs.existsSync(path.join(root, '.vibisual/brain/project', `${c.id}.md`))).toBe(false);
  });

  it('새 인스턴스가 user 층을 다시 읽어 온다', () => {
    const c = svc.saveCard({ type: 'fact', scope: 'user', title: '높임말을 원한다', body: '근거' });
    const fresh = new BrainService(root);
    expect(fresh.getCard(c.id)?.scope).toBe('user');
  });

  it('층 필터가 user 를 갈라낸다', () => {
    svc.saveCard({ type: 'fact', scope: 'project', title: '프로젝트 사실', body: '' });
    svc.saveCard({ type: 'fact', scope: 'user', title: '사용자 관찰', body: '' });
    expect(svc.listCards({ scope: 'user' }).map((c) => c.title)).toEqual(['사용자 관찰']);
    expect(svc.listCards({ scope: 'project' }).map((c) => c.title)).toEqual(['프로젝트 사실']);
  });

  it('user 카드를 보관하면 전용 보관 폴더로 간다', () => {
    const c = svc.saveCard({ type: 'fact', scope: 'user', title: '보관될 관찰', body: '' });
    svc.archiveCard(c.id);
    expect(fs.existsSync(path.join(root, '.vibisual/brain/archive/user', `${c.id}.md`))).toBe(true);
  });
});
