/**
 * §5.10 Project Brain — brainService 단위 테스트.
 * save/중복 갱신, 검색 랭킹, 승격(파일 이동), 파일 매칭, 부분 업데이트 필드 보존.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrainCard } from '@vibisual/shared';
import { BrainService } from './brainService.js';

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

describe('중복 검사(dedup) — 유사 카드는 갱신', () => {
  it('토큰 겹침이 높으면 새 카드 대신 기존 카드를 갱신한다', () => {
    const a = svc.saveCard({
      type: 'mistake', scope: 'project',
      title: '데이터베이스 연결 풀 고갈 실수',
      body: '커넥션 풀을 닫지 않아 고갈되는 실수가 있었다',
    });
    const b = svc.saveCard({
      type: 'mistake', scope: 'project',
      title: '데이터베이스 연결 풀 고갈 실수',
      body: '커넥션 풀을 닫지 않아 고갈되는 실수가 또 났다',
    });
    expect(b.id).toBe(a.id); // 갱신 — 같은 id
    expect(svc.listCards().length).toBe(1);
    expect(b.body).toContain('갱신');
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
