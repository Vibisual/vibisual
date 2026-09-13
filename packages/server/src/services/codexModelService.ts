import * as fs from 'node:fs';
import * as path from 'node:path';
import { CODEX_MODELS_CACHE_FILENAME } from '@vibisual/shared';
import type { CodexModelEntry, CodexModelCatalog } from '@vibisual/shared';
import { codexHome } from './codexCli.js';
import { logger } from '../logger.js';

/**
 * §5.25 (G) — 코덱스가 캐시해 둔 모델 목록을 **읽기만** 한다.
 *
 * 우리가 모델 표를 들지 않는 이유는 §4 v2.38(동적 모델 레지스트리)이 클로드에 대해 세운 것과
 * 같다 — 박아 두면 그 모델이 사라진 날 선택지가 거짓이 되고, 새로 나온 모델은 영영 안 뜬다.
 *
 * **없으면 빈 목록이다.** 지어내지 않는다 — 화면은 "아직 못 읽었다"고 말하고, 사용자가 코덱스를
 * 한 번 돌리면 CLI 가 캐시를 만든다.
 */

/** 캐시 파일 원문 → 목록. 모양이 다르면 빈 배열(우리가 채워 넣지 않는다). */
export function parseCodexModelsCache(raw: string): CodexModelEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const models = (parsed as Record<string, unknown>)['models'];
  if (!Array.isArray(models)) return [];

  const out: CodexModelEntry[] = [];
  for (const m of models) {
    if (!m || typeof m !== 'object') continue;
    const rec = m as Record<string, unknown>;
    const slug = typeof rec['slug'] === 'string' ? rec['slug'].trim() : '';
    if (!slug) continue;

    const displayName =
      typeof rec['display_name'] === 'string' && rec['display_name'].trim() ? rec['display_name'].trim() : slug;

    const levels: string[] = [];
    const supported = rec['supported_reasoning_levels'];
    if (Array.isArray(supported)) {
      for (const lv of supported) {
        if (lv && typeof lv === 'object') {
          const effort = (lv as Record<string, unknown>)['effort'];
          if (typeof effort === 'string' && effort.trim()) levels.push(effort.trim());
        } else if (typeof lv === 'string' && lv.trim()) {
          levels.push(lv.trim());
        }
      }
    }

    const entry: CodexModelEntry = { slug, displayName, reasoningLevels: levels };
    if (typeof rec['description'] === 'string' && rec['description'].trim()) {
      entry.description = rec['description'].trim();
    }
    const def = rec['default_reasoning_level'];
    if (typeof def === 'string' && def.trim()) entry.defaultReasoningLevel = def.trim();
    out.push(entry);
  }
  return out;
}

/** 캐시 파일 절대 경로. 홈 판정은 `codexCli` 한 곳이 소유한다. */
export function codexModelsCachePath(): string {
  return path.join(codexHome(), CODEX_MODELS_CACHE_FILENAME);
}

class CodexModelService {
  private cached: CodexModelCatalog | null = null;

  get(): CodexModelCatalog | null {
    return this.cached;
  }

  /**
   * 캐시 파일을 다시 읽는다. 파일이 없거나 못 읽어도 throw 하지 않는다 —
   * 그때는 빈 목록 + 사유가 실린 결과를 돌려준다.
   */
  refresh(): CodexModelCatalog {
    const file = codexModelsCachePath();
    const now = Date.now();
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 없는 것은 흔한 정상 상태다(코덱스를 한 번도 안 돌린 기계) — 경고로만 남긴다.
      logger.debug(`[codexModels] cache unreadable: ${message}`);
      this.cached = { models: [], checkedAt: now, error: 'models cache not found' };
      return this.cached;
    }
    const models = parseCodexModelsCache(raw);
    this.cached = { models, checkedAt: now, ...(models.length === 0 ? { error: 'no models in cache' } : {}) };
    return this.cached;
  }

  /**
   * 이 slug 가 신고한 추론 단계. 모르는 slug 면 빈 배열 —
   * 화면은 그때 강도 칸을 아예 그리지 않는다(고를 수 없는 값을 보이지 않는다).
   */
  reasoningLevelsOf(slug: string): string[] {
    const found = (this.cached ?? this.refresh()).models.find((m: CodexModelEntry) => m.slug === slug);
    return found ? found.reasoningLevels : [];
  }
}

export const codexModelService = new CodexModelService();
