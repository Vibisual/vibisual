/**
 * §5.10 v2 (B) — 스킬 자산 회귀.
 *
 * 이 축의 값어치는 "카드처럼 읽히기를 기다리지 않고 **작업 시작 시점에 자동으로 걸린다**"는 데 있다.
 * 그래서 여기서 못 박는 것은 세 가지다 — ① 디스크 왕복(agentskills.io 호환 형식이 유지되는가)
 * ② 개정 시 **옛 절차가 사라지지 않는가** ③ 집행 선택이 한국어에서도 맞는가.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrainCard } from '@vibisual/shared';
import { BrainSkillService, parseSkill, serializeSkill, toSkillId } from './brainSkillService.js';

let root: string;
let svc: BrainSkillService;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-skill-'));
  svc = new BrainSkillService(root);
});

afterEach(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

function make(over: Partial<Parameters<BrainSkillService['createSkill']>[0]> = {}) {
  return svc.createSkill({
    name: '캡처 버블 좌표 변환',
    description: '화면 캡처 버블에서 마우스 좌표를 대상 모니터 좌표로 옮길 때 쓴다',
    body: '1. DPI 배율을 먼저 읽는다\n2. 모니터 원점을 뺀다',
    scope: 'project',
    ...over,
  });
}

describe('디스크 왕복 — agentskills.io 호환 형식', () => {
  it('SKILL.md 를 폴더 규약대로 쓴다', () => {
    const s = make();
    const fp = path.join(root, '.vibisual/brain/skills', s.id, 'SKILL.md');
    expect(fs.existsSync(fp)).toBe(true);
  });

  it('frontmatter 맨 앞 두 줄이 name·description 이다 (남의 도구가 앞부분만 읽어도 성립)', () => {
    const s = make();
    const text = fs.readFileSync(path.join(root, '.vibisual/brain/skills', s.id, 'SKILL.md'), 'utf8');
    const lines = text.split('\n');
    expect(lines[0]).toBe('---');
    expect(lines[1]?.startsWith('name: ')).toBe(true);
    expect(lines[2]?.startsWith('description: ')).toBe(true);
  });

  it('직렬화 → 파싱 왕복에서 필드가 보존된다', () => {
    const s = make({ topic: 'capture-remote', files: ['a.ts', 'b.ts'] });
    const back = parseSkill(serializeSkill(s), { id: s.id, scope: 'project' });
    expect(back).not.toBeNull();
    expect(back?.name).toBe(s.name);
    expect(back?.description).toBe(s.description);
    expect(back?.body.trim()).toBe(s.body.trim());
    expect(back?.files).toEqual(['a.ts', 'b.ts']);
    expect(back?.topic).toBe('capture-remote');
  });

  it('name·description 이 없는 파일은 스킬이 아니다 (null 로 돌려 호출부가 건너뛴다)', () => {
    expect(parseSkill('---\nid: x\n---\n본문', { id: 'x', scope: 'project' })).toBeNull();
    expect(parseSkill('frontmatter 가 아예 없음', { id: 'x', scope: 'project' })).toBeNull();
  });

  it('새 인스턴스가 디스크에서 다시 읽어 온다', () => {
    const s = make();
    const fresh = new BrainSkillService(root);
    expect(fresh.getSkill(s.id)?.name).toBe(s.name);
  });

  it('새 절차는 초안으로 시작한다 — 한 번 써 보기 전에는 규칙이 아니다', () => {
    expect(make().status).toBe('draft');
  });
});

describe('개정 — 옛 절차를 잃지 않는다', () => {
  it('개정하면 version 이 오르고 supersedes 가 이전 판을 가리킨다', () => {
    const s = make();
    const next = svc.reviseSkill(s.id, { body: '1. 바뀐 절차' });
    expect(next?.version).toBe(2);
    expect(next?.supersedes).toBe(`${s.id}-v1`);
    expect(next?.body).toContain('바뀐 절차');
  });

  it('옛 판이 .archive 아래에 남는다 (덮어쓰기로 사라지지 않는다)', () => {
    const s = make();
    svc.reviseSkill(s.id, { body: '새 절차' });
    const old = path.join(root, '.vibisual/brain/skills/.archive', `${s.id}-v1`, 'SKILL.md');
    expect(fs.existsSync(old)).toBe(true);
    expect(fs.readFileSync(old, 'utf8')).toContain('DPI 배율');
  });

  it('.archive 는 목록에 섞이지 않는다', () => {
    const s = make();
    svc.reviseSkill(s.id, { body: '새 절차' });
    const fresh = new BrainSkillService(root);
    expect(fresh.listSkills().map((x) => x.id)).toEqual([s.id]);
  });

  it('같은 id 로 다시 만들면 덮어쓰지 않고 개정으로 넘어간다', () => {
    const s = make();
    const again = svc.createSkill({
      id: s.id, name: s.name, description: s.description, body: '또 다른 절차', scope: 'project',
    });
    expect(again.version).toBe(2);
  });

  it('없는 스킬 개정은 null 이다', () => {
    expect(svc.reviseSkill('없는-스킬', { body: 'x' })).toBeNull();
  });
});

describe('집행 선택 — 지금 작업과 맞는 절차만', () => {
  it('맞는 작업이면 고른다', () => {
    make();
    const picked = svc.selectForTask('캡처 버블 좌표 변환이 틀어졌다');
    expect(picked.map((s) => s.name)).toContain('캡처 버블 좌표 변환');
  });

  it('한국어 조사가 붙어도 고른다 (어절 토큰만으로는 놓치는 자리)', () => {
    make();
    const picked = svc.selectForTask('캡처버블의 좌표변환을 고쳐라');
    expect(picked.length).toBeGreaterThan(0);
  });

  it('무관한 작업이면 아무것도 안 고른다 (아무 절차나 실리지 않는다)', () => {
    make();
    expect(svc.selectForTask('릴리스 태그를 올려라')).toEqual([]);
  });

  it('빈 작업 문장이면 아무것도 안 고른다', () => {
    make();
    expect(svc.selectForTask('   ')).toEqual([]);
  });

  it('보관·대체된 스킬은 고르지 않는다', () => {
    const s = make();
    svc.archiveSkill(s.id);
    expect(svc.selectForTask('캡처 버블 좌표 변환')).toEqual([]);
  });

  it('다른 에이전트의 개인 스킬은 고르지 않는다', () => {
    make({ scope: 'agent', agentId: 'agent-A', id: 'a-skill' });
    expect(svc.selectForTask('캡처 버블 좌표 변환', { agentId: 'agent-B' })).toEqual([]);
    expect(svc.selectForTask('캡처 버블 좌표 변환', { agentId: 'agent-A' }).length).toBe(1);
  });

  it('상한(limit)을 넘겨 싣지 않는다', () => {
    make({ id: 's1' });
    make({ id: 's2', name: '캡처 버블 좌표 보정' });
    make({ id: 's3', name: '캡처 버블 좌표 검산' });
    expect(svc.selectForTask('캡처 버블 좌표', { limit: 2 }).length).toBeLessThanOrEqual(2);
  });
});

describe('노출·도움됨', () => {
  it('touchReferences 가 노출 횟수를 올린다', () => {
    const s = make();
    svc.touchReferences([s.id]);
    svc.touchReferences([s.id]);
    expect(svc.getSkill(s.id)?.refCount).toBe(2);
  });

  it('도움됐다고 신고된 초안은 그 자리에서 실제 절차로 올라간다', () => {
    const s = make();
    expect(s.status).toBe('draft');
    const next = svc.markHelpful(s.id);
    expect(next?.helpfulCount).toBe(1);
    expect(next?.status).toBe('active');
  });

  it('없는 스킬에 대한 신고는 null 이고 조용히 넘어간다', () => {
    expect(svc.markHelpful('없음')).toBeNull();
    expect(() => svc.touchReferences(['없음'])).not.toThrow();
  });
});

describe('lesson 승급 후보 — 209장을 끌어올리는 경로', () => {
  const card = (id: string, topic: string, over: Partial<BrainCard> = {}): BrainCard => ({
    id, type: 'lesson', scope: 'project', title: id, body: '', files: [],
    createdAt: 1, updatedAt: 1, refCount: 0, status: 'active', seen: true, topic,
    ...over,
  } as BrainCard);

  it('같은 주제 lesson 이 문턱 이상이면 후보로 올린다', () => {
    const cands = svc.promotionCandidates([
      card('a', 'capture-remote'), card('b', 'capture-remote'), card('c', 'capture-remote'),
    ]);
    expect(cands.length).toBe(1);
    expect(cands[0]?.topic).toBe('capture-remote');
    expect(cands[0]?.cards.length).toBe(3);
  });

  it('문턱 미만이면 권하지 않는다', () => {
    expect(svc.promotionCandidates([card('a', 'ui-client'), card('b', 'ui-client')])).toEqual([]);
  });

  it('lesson 이 아닌 카드는 세지 않는다', () => {
    const cards = [
      card('a', 'ui-client', { type: 'rule' }),
      card('b', 'ui-client', { type: 'fact' }),
      card('c', 'ui-client', { type: 'decision' }),
    ];
    expect(svc.promotionCandidates(cards)).toEqual([]);
  });

  it('그 주제로 이미 스킬이 있으면 다시 권하지 않는다', () => {
    make({ topic: 'capture-remote' });
    const cands = svc.promotionCandidates([
      card('a', 'capture-remote'), card('b', 'capture-remote'), card('c', 'capture-remote'),
    ]);
    expect(cands).toEqual([]);
  });

  it('보관된 카드는 세지 않는다', () => {
    const cards = [
      card('a', 'misc'), card('b', 'misc'), card('c', 'misc', { status: 'archived' }),
    ];
    expect(svc.promotionCandidates(cards)).toEqual([]);
  });
});

describe('slug 정규화', () => {
  it('경로 문자를 남기지 않는다', () => {
    expect(toSkillId('캡처/버블 좌표 변환')).not.toContain('/');
    expect(toSkillId('a  b')).toBe('a-b');
  });

  it('빈 이름이어도 쓸 수 있는 id 를 만든다', () => {
    expect(toSkillId('   ').length).toBeGreaterThan(0);
  });
});
