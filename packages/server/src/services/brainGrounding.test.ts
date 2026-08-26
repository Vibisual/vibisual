/**
 * §5.10 v2 (E) — 근거 검증 회귀.
 *
 * 이 축의 존재 이유는 하나다: 카드 327장 중 `verified` 가 1장이었던 것은 **기계가 통과시킬 수
 * 있는 문이 없었기 때문**이고, 그 문을 여는 것. 그래서 여기서 못 박는 것도 하나다 —
 * **아무거나 통과시키지 않으면서 통과할 것은 통과시키는가.**
 *
 * 정책(decision·rule)이 이 문으로 못 지나간다는 것도 함께 고정한다. 그 가드가 풀리면
 * "코드에 그 이름이 있다"는 이유로 프로젝트 정책이 자동 승인돼 버린다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrainService, dropBrainService } from './brainService.js';
import { applyGrounding, extractEvidenceTerms, groundCard } from './brainGrounding.js';

let root: string;
let svc: BrainService;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-ground-'));
  svc = new BrainService(root);
});

afterEach(() => {
  dropBrainService(root);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writeFile(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe('근거 토막 추출 — 무엇을 파일과 맞춰 볼 것인가', () => {
  it('백틱 인용과 식별자를 뽑는다', () => {
    const terms = extractEvidenceTerms({
      title: '`scheduleCheckpoint` 를 되살리면 프리즈가 재발한다',
      body: 'projectGraph.ts 의 saveCheckpoint 가 동기라 그렇다',
    });
    expect(terms).toContain('scheduleCheckpoint');
    expect(terms).toContain('projectGraph.ts');
    expect(terms).toContain('saveCheckpoint');
  });

  it('평범한 산문 낱말은 뽑지 않는다 (아무 단어나 맞으면 검증이 무의미해진다)', () => {
    const terms = extractEvidenceTerms({ title: '이 기능은 매우 느리다', body: 'slow and heavy work' });
    expect(terms).toEqual([]);
  });

  it('백틱 안이 문장이면 코드로 치지 않는다', () => {
    const terms = extractEvidenceTerms({ title: '`이건 그냥 설명 문장 입니다`', body: '' });
    expect(terms).toEqual([]);
  });
});

describe('대조 판정', () => {
  it('연결 파일이 없으면 판정 불가다 (실패가 아니라 근거 없음)', () => {
    const r = groundCard(root, { title: '`foo` 어쩌고', body: '', files: [] });
    expect(r.grounded).toBe(false);
    expect(r.reason).toBe('no-files');
  });

  it('연결 파일이 사라졌으면 통과시키지 않는다', () => {
    const r = groundCard(root, { title: '`foo` 어쩌고', body: '', files: ['없는파일.ts'] });
    expect(r.grounded).toBe(false);
    expect(r.reason).toBe('anchors-missing');
  });

  it('파일은 있는데 맞춰 볼 토막이 없으면 통과시키지 않는다', () => {
    writeFile('a.ts', 'export const x = 1;');
    const r = groundCard(root, { title: '이건 그냥 느낌입니다', body: '아무 근거 없음', files: ['a.ts'] });
    expect(r.grounded).toBe(false);
    expect(r.reason).toBe('no-terms');
  });

  it('토막이 파일에 없으면 통과시키지 않는다 (존재만으로는 부족하다)', () => {
    writeFile('a.ts', 'export const x = 1;');
    const r = groundCard(root, { title: '`buildAnchors` 가 여기 있다', body: '', files: ['a.ts'] });
    expect(r.grounded).toBe(false);
    expect(r.reason).toBe('no-evidence');
  });

  it('토막이 파일에 실제로 있으면 통과시킨다', () => {
    writeFile('a.ts', 'function buildAnchors() { return 1; }');
    const r = groundCard(root, { title: '`buildAnchors` 가 앵커를 만든다', body: '', files: ['a.ts'] });
    expect(r.grounded).toBe(true);
    expect(r.matched).toContain('buildAnchors');
  });

  it('연결 파일 절반 이상이 사라지면 통과시키지 않는다', () => {
    writeFile('a.ts', 'function buildAnchors() {}');
    const r = groundCard(root, {
      title: '`buildAnchors`', body: '', files: ['a.ts', '없음1.ts', '없음2.ts'],
    });
    expect(r.grounded).toBe(false);
    expect(r.reason).toBe('anchors-missing');
  });
});

describe('승격 — 기존 관문을 그대로 쓴다', () => {
  it('fact 카드는 대조를 통과하면 verified 로 올라간다', () => {
    writeFile('a.ts', 'export function buildAnchors() {}');
    const c = svc.saveCard({
      type: 'fact', scope: 'project',
      title: '`buildAnchors` 가 앵커를 만든다',
      body: '저장 경로에서 불린다',
      files: ['a.ts'],
    });
    const r = applyGrounding(root, c.id);
    expect(r?.grounded).toBe(true);
    const after = svc.getCard(c.id);
    expect(after?.verifyState).toBe('verified');
    expect(after?.authority).toBe('repository-source');
  });

  it('정책(rule)은 이 문으로 못 지나간다 — 코드 대조로 참·거짓을 가릴 수 없다', () => {
    writeFile('a.ts', 'export function buildAnchors() {}');
    const c = svc.saveCard({
      type: 'rule', scope: 'project',
      title: '`buildAnchors` 는 저장 경로에서만 불러라',
      body: '핫패스에서 부르지 마라',
      files: ['a.ts'],
    });
    applyGrounding(root, c.id);
    expect(svc.getCard(c.id)?.verifyState).not.toBe('verified');
  });

  it('대조에 실패해도 강등하지 않는다 (증거 없음 ≠ 틀림)', () => {
    writeFile('a.ts', 'export const x = 1;');
    const c = svc.saveCard({
      type: 'fact', scope: 'project',
      title: '`존재하지않는함수` 가 있다', body: '', files: ['a.ts'],
    });
    const before = svc.getCard(c.id)?.verifyState;
    applyGrounding(root, c.id);
    expect(svc.getCard(c.id)?.verifyState).toBe(before);
  });

  it('없는 카드면 null 이다', () => {
    expect(applyGrounding(root, 'card-없음')).toBeNull();
  });
});
