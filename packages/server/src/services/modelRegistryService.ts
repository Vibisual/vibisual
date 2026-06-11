/**
 * §4 v2.38 — 동적 모델 레지스트리.
 *
 * 부팅 시 (1) shared `MODEL_SEED_ENTRIES` 로드 → (2) `ANTHROPIC_API_KEY` 가 있으면
 * `GET https://api.anthropic.com/v1/models` 호출 → (3) id prefix 로 family 추론·머지 →
 * (4) 패밀리별 `createdAt desc` 정렬 → 첫 entry `isLatestOfFamily=true` 셋.
 *
 * 캐시: `~/.vibisual/model-registry.json` (12h TTL). 부팅 시 캐시가 유효하면 페치 생략.
 *
 * v1.96 에서 `@anthropic-ai/sdk` 가 제거됐으므로 raw `fetch` (node 20+ 글로벌) 사용.
 * `ANTHROPIC_API_KEY` 미설정 시 sourceMix='seed-only' 로 시드만 반환.
 *
 * 콜사이트:
 * - `projectGraphManager.getSnapshot()` → `snapshot.modelRegistry`
 * - `subAgentManager.buildConfigArgs()` → `resolveAliasToLatest('opus', registry)` 로 alias 해소
 * - REST `GET /api/models` → 클라 즉시 페치(WS 도착 전 빈 화면 방지)
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  MODEL_SEED_ENTRIES,
  parseFamilyFromFullId,
  parseModelSemver,
  type ModelRegistry,
  type ModelRegistryEntry,
} from '@vibisual/shared';
import { logger } from '../logger.js';
import { resolveClaudeBin } from './claudeBin.js';

const IS_WIN = process.platform === 'win32';
const PLATFORM_BIN_NAME = IS_WIN ? 'claude.exe' : 'claude';

/**
 * §4 v2.41 — Claude Code 바이너리에서 발견되는 정상 모델 ID 패턴.
 * `claude-<family>-X[-Y]` 형태만 채택. 변형(`-date`, `-v1`, `-fast`) 은 제외 — UI 노이즈.
 * X(-Y) 가 패밀리 내 semver(major, optional minor).
 *
 * §4 v2.77 — opus/sonnet/haiku 화이트리스트 제거 → 임의 패밀리(fable/mythos 등) 수용. minor 도 옵션화
 * (`claude-fable-5` 같은 단일 숫자 패밀리 + `claude-opus-4-8` 같은 major-minor 둘 다 매칭).
 * `[a-z]+` 다음에 숫자가 와야 하므로 `claude-code-…` 류 비모델 문자열은 자연 제외(2차 CLEAN 필터로도 차단).
 */
const CLEAN_MODEL_RE = /^claude-[a-z]+-\d+(?:-\d{1,2})?$/;
const ANY_MODEL_RE = /claude-[a-z]+-\d[0-9a-zA-Z\-]*/g;

/**
 * §4 v2.77 — 패밀리 화이트리스트 해제로 잡힐 수 있는 **비모델** 토큰의 패밀리명.
 * `claude-code` 패키지/버전 문자열(`claude-code-2-1` 등)이 가짜 'code' 패밀리로 새지 않게 거른다.
 * (모델 패밀리는 opus/sonnet/haiku/fable/mythos … 처럼 제품 라인명. 'code' 는 CLI 패키지명.)
 */
const NON_MODEL_FAMILIES = new Set<string>(['code', 'cli', 'agent']);

const CACHE_DIR = path.join(os.homedir(), '.vibisual');
const CACHE_FILE = path.join(CACHE_DIR, 'model-registry.json');
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const API_URL = 'https://api.anthropic.com/v1/models';
const API_VERSION = '2023-06-01';
const FETCH_TIMEOUT_MS = 8_000;

interface ApiModelEntry {
  id: string;
  display_name?: string;
  created_at?: string; // ISO 8601
  type?: string;
}

interface ApiResponse {
  data?: ApiModelEntry[];
}

interface CachedRegistry {
  registry: ModelRegistry;
  fetchedAt: number;
}

class ModelRegistryService {
  private registry: ModelRegistry;
  private listeners = new Set<(reg: ModelRegistry) => void>();

  constructor() {
    this.registry = this.buildFromSeed();
  }

  /** 시드만으로 빌드된 초기 레지스트리. (v2.40 이후 시드 빈 배열이라 entries=[]) */
  private buildFromSeed(): ModelRegistry {
    const entries: ModelRegistryEntry[] = MODEL_SEED_ENTRIES.map((e) => ({ ...e }));
    this.markLatestOfFamily(entries);
    return {
      entries,
      updatedAt: Date.now(),
      sourceMix: 'seed-only',
    };
  }

  /**
   * §4 v2.41 — Claude Code 바이너리에서 모델 ID raw scan.
   *
   * 0 하드코딩·0 API 키·0 원격호출. 바이너리 내부 문자열 테이블에 박혀 있는 모델 ID 패턴을 정규식으로 추출.
   * 사용자가 `npm i -g @anthropic-ai/claude-code@latest` 로 CLI 만 업데이트하면 신규 모델이 자동 발견됨.
   *
   * 후보 경로(빈 결과 시 다음 후보로):
   *  (1) `resolveClaudeBin().binPath` — VS Code 확장 번들 또는 PATH 의 `claude` 본체
   *  (2) `<binPath>/../node_modules/@anthropic-ai/claude-code-{platform}/claude(.exe)` — 플랫폼 패키지
   *  (3) `<global npm root>/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-{platform}/claude(.exe)`
   *
   * 정상 ID 만 채택(`claude-X-N-M` 형태) — 날짜/v1/fast 변형은 UI 노이즈로 제외.
   */
  private scanClaudeBinaryForModels(): ModelRegistryEntry[] {
    const candidates: string[] = [];
    try {
      const bin = resolveClaudeBin();
      if (bin?.binPath) candidates.push(bin.binPath);
    } catch { /* PATH 미발견 — 다른 후보 시도 */ }

    // (2) 같은 트리 안의 플랫폼 패키지
    for (const cand of [...candidates]) {
      try {
        const dir = path.dirname(cand);
        const platRoot = path.join(dir, '..', 'node_modules', '@anthropic-ai');
        if (fsSync.existsSync(platRoot)) {
          for (const sub of fsSync.readdirSync(platRoot)) {
            if (sub.startsWith('claude-code-') && sub !== 'claude-code') {
              const subBin = path.join(platRoot, sub, PLATFORM_BIN_NAME);
              if (fsSync.existsSync(subBin)) candidates.push(subBin);
            }
          }
        }
      } catch { /* ignore */ }
    }

    // (3) 글로벌 npm root 의 패키지
    try {
      const globalNpm = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code');
      const platRoot = path.join(globalNpm, 'node_modules', '@anthropic-ai');
      if (fsSync.existsSync(platRoot)) {
        for (const sub of fsSync.readdirSync(platRoot)) {
          if (sub.startsWith('claude-code-')) {
            const subBin = path.join(platRoot, sub, PLATFORM_BIN_NAME);
            if (fsSync.existsSync(subBin) && !candidates.includes(subBin)) candidates.push(subBin);
          }
        }
      }
    } catch { /* ignore */ }

    const found = new Set<string>();
    for (const candidate of candidates) {
      try {
        const buf = fsSync.readFileSync(candidate);
        const text = buf.toString('latin1');
        const matches = text.match(ANY_MODEL_RE);
        if (!matches) continue;
        for (const m of matches) {
          if (!CLEAN_MODEL_RE.test(m)) continue;
          // §4 v2.77 — 비모델 패밀리(claude-code 버전 문자열 등) 제외.
          const fam = parseFamilyFromFullId(m);
          if (fam && NON_MODEL_FAMILIES.has(fam)) continue;
          found.add(m);
        }
        if (found.size > 0) {
          logger.info(`[modelRegistry] cli-scan: ${found.size} clean model IDs from ${path.basename(candidate)}`);
          break;
        }
      } catch (err) {
        logger.warn(`[modelRegistry] cli-scan read failed for ${candidate}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return [...found].map((id): ModelRegistryEntry => {
      const family = parseFamilyFromFullId(id);
      return {
        id,
        family: family ?? 'opus',
        source: 'cli-scan',
      };
    });
  }

  /**
   * `claude-<family>-A[-B]` 의 (A,B) 숫자 파싱. 비교 시 큰 게 신규. minor 없으면 0.
   * 패밀리 내 latest 결정에 사용. §4 v2.77 — shared `parseModelSemver` 위임(클라와 규칙 일치).
   */
  private parseSemverPair(id: string): [number, number] {
    return parseModelSemver(id);
  }

  /**
   * 패밀리별 latest 표시.
   * §4 v2.41 — semver(`A-B`) 비교를 1순위로. createdAt(API) 2순위. source 3순위(api > cli-scan > seed). id 4순위.
   * cli-scan 으로 발견한 `claude-opus-4-8` 가 자동으로 latest 가 되도록.
   *
   * §4 v2.77 — 패밀리 목록을 entries 에서 동적 수집(opus/sonnet/haiku 하드코딩 제거) → 신규 패밀리(fable/mythos)도
   * 각자 latest 가 셋됨.
   */
  private markLatestOfFamily(entries: ModelRegistryEntry[]): void {
    const families = [...new Set(entries.map((e) => e.family).filter(Boolean))];
    for (const e of entries) e.isLatestOfFamily = false;
    const sourceRank: Record<ModelRegistryEntry['source'], number> = { api: 3, 'cli-scan': 2, seed: 1 };
    for (const family of families) {
      const fams = entries.filter((e) => e.family === family);
      if (fams.length === 0) continue;
      fams.sort((a, b) => {
        const [aMaj, aMin] = this.parseSemverPair(a.id);
        const [bMaj, bMin] = this.parseSemverPair(b.id);
        if (aMaj !== bMaj) return bMaj - aMaj;
        if (aMin !== bMin) return bMin - aMin;
        const aT = a.createdAt ?? 0;
        const bT = b.createdAt ?? 0;
        if (aT !== bT) return bT - aT;
        const aR = sourceRank[a.source] ?? 0;
        const bR = sourceRank[b.source] ?? 0;
        if (aR !== bR) return bR - aR;
        return b.id.localeCompare(a.id);
      });
      fams[0]!.isLatestOfFamily = true;
    }
  }

  /** 현재 레지스트리 — 항상 즉시 반환(부팅 직후엔 시드, refresh 완료 후엔 머지). */
  getRegistry(): ModelRegistry {
    return this.registry;
  }

  /** 변경 시 listener 호출 (WS broadcast 등). */
  subscribe(fn: (reg: ModelRegistry) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try { fn(this.registry); } catch (err) { logger.error('[modelRegistry] listener error', err); }
    }
  }

  /**
   * 부팅 시 호출 — (1) 캐시 hit 시 사용, (2) 아니면 `/v1/models` fetch + 머지, (3) 실패 시 시드만 유지.
   * fetch 는 비동기 — 호출자(서버 부트 시퀀스)는 await 없이 시작 가능. 완료 시 listener push.
   */
  async refreshIfStale(): Promise<void> {
    // §4 v2.41 — 모든 부팅에서 CLI 바이너리 raw scan 실행 (빠르고 결정적, 캐시 무관).
    // CLI 업데이트가 즉시 반영되도록 캐시 의존 ❌. API 결과만 캐시.
    const cliEntries = this.scanClaudeBinaryForModels();

    // 캐시에서 API 결과만 추출 (시드/cli-scan entry 는 매 부팅 재생성)
    let cachedApiEntries: ModelRegistryEntry[] = [];
    try {
      const cached = await this.loadCache();
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        cachedApiEntries = (cached.registry?.entries ?? [])
          .filter((e) => e?.source === 'api')
          .map((e) => ({ ...e }));
      }
    } catch (err) {
      logger.warn(`[modelRegistry] cache load failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // CLI scan + 캐시 API 결과 머지로 임시 레지스트리 구성
    this.registry = this.buildMerged(cliEntries, cachedApiEntries);
    this.markLatestOfFamily(this.registry.entries);
    this.emit();
    logger.info(`[modelRegistry] initial: cli-scan=${cliEntries.length} cached-api=${cachedApiEntries.length} total=${this.registry.entries.length} mix=${this.registry.sourceMix}`);

    // 캐시 fresh 면 API 재fetch 생략
    if (cachedApiEntries.length > 0) return;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      logger.info('[modelRegistry] ANTHROPIC_API_KEY not set — cli-scan only mode (no api enrichment)');
      return;
    }

    try {
      const apiEntries = await this.fetchFromApi(apiKey);
      this.registry = this.buildMerged(cliEntries, apiEntries);
      this.markLatestOfFamily(this.registry.entries);
      await this.saveCache();
      this.emit();
      logger.info(`[modelRegistry] api-fresh: cli-scan=${cliEntries.length} api=${apiEntries.length} total=${this.registry.entries.length} mix=${this.registry.sourceMix}`);
    } catch (err) {
      logger.warn(`[modelRegistry] /v1/models fetch failed — staying on cli-scan: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * §4 v2.41 — CLI scan + API entries 머지.
   * 같은 id 는 API 가 displayName/createdAt 으로 enrich, source 우선순위는 API > cli-scan.
   * 시드(`MODEL_SEED_ENTRIES`) 는 v2.40 이후 빈 배열이므로 사실상 미참여.
   */
  private buildMerged(cliEntries: ModelRegistryEntry[], apiEntries: ModelRegistryEntry[]): ModelRegistry {
    const byId = new Map<string, ModelRegistryEntry>();
    for (const seed of MODEL_SEED_ENTRIES) byId.set(seed.id, { ...seed });
    for (const cli of cliEntries) {
      const prev = byId.get(cli.id);
      byId.set(cli.id, prev ? { ...prev, ...cli, source: 'cli-scan' } : { ...cli });
    }
    for (const api of apiEntries) {
      const prev = byId.get(api.id);
      if (prev) {
        byId.set(api.id, {
          ...prev,
          displayName: api.displayName ?? prev.displayName,
          createdAt: api.createdAt ?? prev.createdAt,
          source: 'api',
        });
      } else {
        byId.set(api.id, api);
      }
    }
    const sourceMix: ModelRegistry['sourceMix'] =
      apiEntries.length > 0 && cliEntries.length > 0 ? 'cli-scan+api'
      : apiEntries.length > 0 ? 'api-merged'
      : cliEntries.length > 0 ? 'cli-scan'
      : 'seed-only';
    return {
      entries: [...byId.values()],
      updatedAt: Date.now(),
      sourceMix,
    };
  }

  /** `/v1/models` 호출 — family 추론 가능한 항목만 채택. */
  private async fetchFromApi(apiKey: string): Promise<ModelRegistryEntry[]> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(API_URL, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': API_VERSION,
        },
        signal: ctl.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as ApiResponse;
      const out: ModelRegistryEntry[] = [];
      for (const m of json.data ?? []) {
        const family = parseFamilyFromFullId(m.id);
        if (!family || NON_MODEL_FAMILIES.has(family)) continue;
        const createdAt = m.created_at ? Date.parse(m.created_at) : undefined;
        out.push({
          id: m.id,
          family,
          displayName: m.display_name,
          createdAt: Number.isNaN(createdAt) ? undefined : createdAt,
          source: 'api',
        });
      }
      return out;
    } finally {
      clearTimeout(timer);
    }
  }


  private async loadCache(): Promise<CachedRegistry | null> {
    try {
      const raw = await fs.readFile(CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as CachedRegistry;
      if (!parsed?.registry?.entries || !parsed.fetchedAt) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async saveCache(): Promise<void> {
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      const payload: CachedRegistry = { registry: this.registry, fetchedAt: Date.now() };
      await fs.writeFile(CACHE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      logger.warn(`[modelRegistry] cache save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const modelRegistryService = new ModelRegistryService();
