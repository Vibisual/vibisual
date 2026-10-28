/**
 * §5.11 — 집행 전수 검사: 켜면 카드가 프로젝트에 실제로 영향을 줘야 하므로 모든 카드가 집행 블록을 낸다.
 * 카드를 새로 만들고 집행을 빼먹으면 이 파일이 실패한다(배럴이 짧아도 다른 검사는 실패하지 않는다).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_MANIFESTS } from './registry.js';
import { PLUGIN_PROMPT_MODULES } from './prompt.js';
import { ENFORCEMENT_RULE_MAX } from './framework/enforcement.js';
import type { PluginPromptContext } from './types.js';

const SRC = path.resolve(__dirname);
const ids = PLUGIN_MANIFESTS.map((m) => m.id);

// 모든 카드가 지켜야 하는 실행 범위는 카드 고유 규칙의 중복에 포함하지 않는다.
const VERIFICATION_SCOPE = 'Vibisual 검증 정책이 켜져 있으면 최신 [검증 권한] 범위 안에서만, 꺼져 있으면 사용자의 직접 지시와 작업 범위에 맞춰';
const STOP = new Set(['그', '것', '수', '때', '더', '이', '하라', '마라', '하고', '있으면', '있는', '함께']);
function ruleWords(s: string): Set<string> {
  return new Set(
    s.replaceAll(VERIFICATION_SCOPE, '').replace(/\*\*|`|—|·/g, ' ')
      .split(/[\s,.·—()"']+/)
      .map((w) => w.replace(/(을|를|은|는|이|가|에|의|로|으로|과|와|도|만|까지|부터|처럼|보다)$/, ''))
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}
function overlap(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * 아무 프로젝트나 하나 — 집행 블록은 프로젝트 사정과 무관하게 낼 말이 있어야 한다.
 * §5.5 #17-44 ⑧ 이후 `spec-driven` 은 켠 뒤에만 말하므로(기본 꺼짐) 그 스위치를 켜 둔다 — 안 켜면 그 카드만 늘 침묵해 검사가 물음을 못 던진다.
 */
const ctx: PluginPromptContext = {
  projectPath: 'C:/repo/x',
  cwd: 'C:/repo/x',
  agentId: 'agent-1',
  agentLabel: 'Agent',
  customCreated: true,
  specSettings: { strength: 'observe', enabledProject: true },
  fileExists: () => false,
  readFile: () => null,
};

describe('집행 전수', () => {
  it('등록된 플러그인 전부가 집행 모듈을 갖는다 — 하나라도 빠지면 그 카드는 켜도 아무 일이 없다', () => {
    const have = new Set(PLUGIN_PROMPT_MODULES.map((m) => m.id));
    expect(ids.filter((id) => !have.has(id))).toEqual([]);
  });

  it('집행 모듈은 전부 등록된 플러그인이다 — 등록부에 없는 id 는 영원히 안 켜진다', () => {
    const known = new Set(ids);
    expect(PLUGIN_PROMPT_MODULES.map((m) => m.id).filter((id) => !known.has(id))).toEqual([]);
  });

  it('매니페스트가 agentPrompt 를 선언하고 clientOnly 가 아니다', () => {
    const bad = PLUGIN_MANIFESTS.filter((m) => !m.contributes.includes('agentPrompt') || m.clientOnly);
    expect(bad.map((m) => m.id)).toEqual([]);
  });

  it('플러그인마다 자기 폴더에 enforce.ts 를 들고 있다 — 집행도 폴더와 함께 복사돼야 한다', () => {
    expect(ids.filter((id) => !fs.existsSync(path.join(SRC, id, 'enforce.ts')))).toEqual([]);
  });
});

describe('집행 블록의 모양', () => {
  it('아무 맥락에서도 던지지 않는다 — 프롬프트 조립은 실행 경로 한복판이다', () => {
    for (const mod of PLUGIN_PROMPT_MODULES) {
      expect(() => mod.buildBlock(ctx), mod.id).not.toThrow();
    }
  });

  it('빈 블록을 내는 카드가 없다 — 켰는데 아무 말도 안 하면 집행이 아니다', () => {
    const silent = PLUGIN_PROMPT_MODULES.filter((m) => (m.buildBlock(ctx) ?? '').trim() === '');
    expect(silent.map((m) => m.id)).toEqual([]);
  });

  it('카드마다 규칙이 상한을 넘지 않는다 — 길어진 지시는 읽히지 않는다', () => {
    const tooLong: string[] = [];
    for (const mod of PLUGIN_PROMPT_MODULES) {
      const lines = (mod.buildBlock(ctx) ?? '').split('\n').filter((l) => l.startsWith('- '));
      if (lines.length > ENFORCEMENT_RULE_MAX) tooLong.push(`${mod.id}:${lines.length}`);
    }
    expect(tooLong).toEqual([]);
  });

  it('규칙은 "보라"가 아니라 "하라"로 쓴다 — 관측 문구를 옮겨 적으면 행동이 안 바뀐다', () => {
    // 카드가 재는 것을 그대로 옮겨 적었는지 보는 최소한의 자: 서술형 종결(…이다/…있다)만으로 끝나는 규칙.
    const observational: string[] = [];
    for (const mod of PLUGIN_PROMPT_MODULES) {
      for (const line of (mod.buildBlock(ctx) ?? '').split('\n')) {
        if (!line.startsWith('- ')) continue;
        const body = line.slice(2).trim();
        if (/(보여 준다|센다|표시한다)\.?$/.test(body)) observational.push(`${mod.id}: ${body}`);
      }
    }
    expect(observational).toEqual([]);
  });

  it('카드마다 블록이 서로 다르다 — 같은 문구를 복사했으면 그건 집행이 아니라 장식이다', () => {
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const mod of PLUGIN_PROMPT_MODULES) {
      const block = (mod.buildBlock(ctx) ?? '').trim();
      const owner = seen.get(block);
      if (owner) dup.push(`${mod.id} = ${owner}`);
      else seen.set(block, mod.id);
    }
    expect(dup).toEqual([]);
  });

  /**
   * 같은 블록만이 아니라 한 낱말만 바꾼 같은 말도 잡는다 — 함께 켜면 같은 지시가 매 턴 두 번 실려 무게만 나눠 가진다.
   * 문턱 0.55 는 실측: 정리 전 최대 0.58, 정리 후 최대 0.45(허용 목록↔포트 열기 · 되돌릴 수 없는 일↔구체적 위험 명령 — 대상이 실제로 다르다).
   * 더 낮추면 여러 카드가 공유하는 "…실행 전에 물어라" 뼈대가 걸린다.
   */
  it('다른 카드가 한 낱말만 바꾼 같은 말을 하지 않는다', () => {
    const rules: { id: string; text: string; bag: Set<string> }[] = [];
    for (const mod of PLUGIN_PROMPT_MODULES) {
      for (const line of (mod.buildBlock(ctx) ?? '').split('\n')) {
        if (!line.startsWith('- ')) continue;
        const text = line.slice(2).trim();
        rules.push({ id: mod.id, text, bag: ruleWords(text) });
      }
    }

    const tooClose: string[] = [];
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const a = rules[i];
        const b = rules[j];
        if (!a || !b || a.id === b.id) continue;
        const s = overlap(a.bag, b.bag);
        if (s >= 0.55) tooClose.push(`${a.id} ↔ ${b.id} (${s.toFixed(2)})\n    ${a.text}\n    ${b.text}`);
      }
    }
    expect(tooClose).toEqual([]);
  });

  it('공통 검증 범위를 제외해도 같은 핵심 규칙은 잡는다', () => {
    const core = '실패 원인을 기록하고 다음 시도에서 같은 실수를 반복하지 마라.';
    expect(overlap(ruleWords(core), ruleWords(`${core} ${VERIFICATION_SCOPE} 하라.`))).toBe(1);
    expect(overlap(ruleWords(`접근 키를 마스킹하라. ${VERIFICATION_SCOPE}`), ruleWords(`색상 대비를 측정하라. ${VERIFICATION_SCOPE}`))).toBeLessThan(0.55);
  });
});
