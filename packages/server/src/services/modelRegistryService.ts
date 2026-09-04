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
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import {
  EFFORT_LEVEL_PROBE_CANDIDATES,
  MODEL_SEED_ENTRIES,
  parseFamilyFromFullId,
  parseModelSemver,
  type ModelRegistry,
  type ModelRegistryEntry,
} from '@vibisual/shared';
import { logger } from '../logger.js';
import { getClaudeBin, noteClaudeSpawnFailure } from './claudeBin.js';
import { buildCliInvocation } from './claudeCliRun.js';
import {
  EFFORT_PROBE_SENTINEL,
  isEffortValueRejected,
  isUsableProbeOutput,
  mergeProbedEffortLevels,
  planEffortProbeCandidates,
} from './effortLevelProbe.js';

/**
 * §4 v2.77 — 패밀리 화이트리스트 해제로 잡힐 수 있는 **비모델** 토큰의 패밀리명.
 * `/v1/models` 응답에 섞여 오는 비모델 id 가 가짜 패밀리로 새지 않게 거른다.
 * (모델 패밀리는 opus/sonnet/haiku/fable/mythos … 처럼 제품 라인명. 'code' 는 CLI 패키지명.)
 */
const NON_MODEL_FAMILIES = new Set<string>(['code', 'cli', 'agent']);

const CACHE_DIR = path.join(os.homedir(), '.vibisual');
const CACHE_FILE = path.join(CACHE_DIR, 'model-registry.json');
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const API_URL = 'https://api.anthropic.com/v1/models';
const API_VERSION = '2023-06-01';
const FETCH_TIMEOUT_MS = 8_000;
/**
 * §4 — CLI probe 실행 타임아웃(정상 응답 수백 ms).
 * `--help`(등급 목록 파싱)와 `--effort <값> --version`(값 수락 여부) 두 probe 가 함께 쓴다.
 */
const HELP_PROBE_TIMEOUT_MS = 4_000;
/**
 * §4 — `claude --help` 에서 `--effort <level>` 의 허용 등급을 뽑는 정규식.
 * 출력 예(줄바꿈됨):
 *   `--effort <level>   Effort level for the current session (low, medium, high, xhigh, max)`
 * `--effort` 뒤 가장 가까운 괄호 그룹을 non-greedy 로 캡처.
 */
const EFFORT_HELP_RE = /--effort\b[\s\S]{0,240}?\(([^)]+)\)/i;

export interface ApiModelEntry {
  id: string;
  display_name?: string;
  created_at?: string; // ISO 8601
  type?: string;
  /**
   * 컨텍스트 한도(입력 토큰). `/v1/models` 가 2026-03 부터 내려 준다.
   * ⚠ 필드 이름은 `context_window` 가 **아니다** — 그런 필드는 응답에 없다.
   */
  max_input_tokens?: number;
}

interface ApiResponse {
  data?: ApiModelEntry[];
}

/**
 * `/v1/models` 응답 한 건 → 레지스트리 entry. 패밀리를 못 읽거나 모델이 아닌 것(`claude-code-…`)은 `null`.
 *
 * **순수 함수로 떼어 둔 이유**: 이 매핑이 조용히 한 필드를 안 읽으면 화면에는 폴백값이 그럴듯하게
 * 계속 뜨고 아무도 모른다(컨텍스트를 안 읽어 Fable 게이지가 5배 일찍 찼던 자리가 정확히 그것이다).
 * 네트워크·API 키 없이 단위 테스트로 고정할 수 있어야 한다.
 */
export function mapApiModelEntry(m: ApiModelEntry): ModelRegistryEntry | null {
  const family = parseFamilyFromFullId(m.id);
  if (!family || NON_MODEL_FAMILIES.has(family)) return null;
  const parsed = m.created_at ? Date.parse(m.created_at) : undefined;
  // 컨텍스트 한도는 **API 가 주는 유일한 사양값**이다(가격은 안 준다). 안 받으면 시드에도 없는
  // 신규 풀ID 가 패밀리 디폴트로 떨어져, 한 패밀리에 여러 세대가 섞이면 반드시 한쪽이 틀린다
  // (Sonnet 5 = 1M vs Sonnet 4.5 = 200K). 0·음수·비수치는 값이 아니므로 버리고 시드에 맡긴다.
  const ctx = m.max_input_tokens;
  return {
    id: m.id,
    family,
    displayName: m.display_name,
    createdAt: parsed !== undefined && Number.isNaN(parsed) ? undefined : parsed,
    contextWindow: typeof ctx === 'number' && Number.isFinite(ctx) && ctx > 0 ? ctx : undefined,
    source: 'api',
  };
}

/**
 * 공개 문서 시드 + `/v1/models` entries 머지 (id 기준).
 *
 * 필드마다 `api ?? seed` 인 이유: API 가 그 필드를 **안 준 것**과 **비운 것**을 구분하지 않고 덮으면,
 * 응답에 없는 필드 하나 때문에 시드가 갖고 있던 정확한 값이 지워진다. 가격(`pricing`)은 API 가
 * 아예 주지 않으므로 항상 시드/패밀리 디폴트가 살아남는다.
 */
export function mergeSeedAndApiEntries(apiEntries: readonly ModelRegistryEntry[]): ModelRegistryEntry[] {
  const byId = new Map<string, ModelRegistryEntry>();
  for (const seed of MODEL_SEED_ENTRIES) byId.set(seed.id, { ...seed });
  for (const api of apiEntries) {
    const prev = byId.get(api.id);
    if (prev) {
      byId.set(api.id, {
        ...prev,
        displayName: api.displayName ?? prev.displayName,
        createdAt: api.createdAt ?? prev.createdAt,
        contextWindow: api.contextWindow ?? prev.contextWindow,
        source: 'api',
      });
    } else {
      byId.set(api.id, api);
    }
  }
  return [...byId.values()];
}

interface CachedRegistry {
  registry: ModelRegistry;
  fetchedAt: number;
}

class ModelRegistryService {
  private registry: ModelRegistry;
  private listeners = new Set<(reg: ModelRegistry) => void>();
  /**
   * §4 — 설치된 `claude --help` 에서 파싱한 `--effort` 등급(예: ['low','medium','high','xhigh','max']).
   * refreshIfStale 초입에서 1회 채워지고, 이후 모든 buildMerged 결과에 실린다. undefined = 파싱 실패(클라 폴백).
   */
  private cliEffortLevels: string[] | undefined;

  constructor() {
    this.registry = this.buildFromSeed();
  }

  /** 시드만으로 빌드된 초기 레지스트리 — 공개 문서에서 옮겨 둔 `MODEL_SEED_ENTRIES` 가 전부. */
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
   * §4 — 설치된 `claude --help` 를 실행해 `--effort` 가 받아들이는 등급 목록을 파싱.
   *
   * 모델 raw-scan 과 같은 "0 하드코딩 · CLI 진실" 철학. CLI 가 새 등급을 추가/제거하면 코드 수정 없이 반영된다.
   * 실패(미발견/타임아웃/파싱불가) 시 undefined → 클라 `listEffortLevels` 가 `AVAILABLE_EFFORT_LEVELS` 로 폴백.
   */
  private async scanEffortLevelsFromCli(): Promise<string[] | undefined> {
    let binPath: string | undefined;
    try {
      binPath = getClaudeBin()?.binPath;
    } catch { /* PATH 미발견 */ }
    if (!binPath) return undefined;

    const help = await this.runCliCapture(binPath, ['--help']);

    if (!help) return undefined;
    const m = EFFORT_HELP_RE.exec(help);
    if (!m?.[1]) return undefined;
    const levels = m[1]
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[a-z][a-z0-9-]*$/.test(s) && s !== 'default');
    // 중복 제거, 최소 1개 이상일 때만 채택.
    const uniq = [...new Set(levels)];
    if (uniq.length === 0) return undefined;

    // §4 — 도움말은 CLI 가 받는 값을 **전부 적어 두지 않는다**(`ultracode` 가 그 자리). 도움말 밖
    //   후보만 실측으로 찔러 받아들여지는 것을 뒤에 붙인다. 도움말이 이미 적은 값은 안 찌른다.
    const extra = await this.probeExtraEffortLevels(binPath, uniq);
    const merged = mergeProbedEffortLevels(uniq, extra);
    logger.info(`[modelRegistry] cli effort levels: ${merged.join(', ')} (help=${uniq.length}, probed=${extra.length})`);
    return merged;
  }

  /**
   * §4 — 도움말에 없는 effort 등급 후보를 **설치본에 직접 물어** 수락되는 것만 돌려준다.
   *
   * 순서가 곧 안전장치다. **보정 먼저** — 무효값(`EFFORT_PROBE_SENTINEL`)이 거절당하는 것을 확인해야
   * "경고가 없다"를 "수락했다"로 읽을 수 있다. 값 검증을 하지 않는 판올림에서는 무효값도 조용히
   * 지나가므로 그때는 후보를 통째로 버린다(모르는 것을 수락으로 넘겨짚지 않는다).
   *
   * probe 는 `--effort <값> --version` 이다 — 세션도 네트워크도 타지 않고 즉시 끝나며,
   * 값 검증은 그보다 먼저 돌아 경고가 출력에 남는다(실측 2.1.259). 순차 실행이라 부팅 때
   * 자식이 몰리지 않고, 후보가 없으면(=도움말이 이미 다 적었으면) **한 번도 뜨지 않는다.**
   */
  private async probeExtraEffortLevels(binPath: string, helpLevels: readonly string[]): Promise<string[]> {
    const candidates = planEffortProbeCandidates(helpLevels, EFFORT_LEVEL_PROBE_CANDIDATES);
    if (candidates.length === 0) return [];

    const sentinelOut = await this.runCliCapture(binPath, ['--effort', EFFORT_PROBE_SENTINEL, '--version']);
    if (!isUsableProbeOutput(sentinelOut) || !isEffortValueRejected(sentinelOut, EFFORT_PROBE_SENTINEL)) {
      logger.info('[modelRegistry] effort value probe skipped — installed CLI does not reject an invalid --effort value');
      return [];
    }

    const accepted: string[] = [];
    for (const level of candidates) {
      const out = await this.runCliCapture(binPath, ['--effort', level, '--version']);
      if (!isUsableProbeOutput(out) || isEffortValueRejected(out, level)) continue;
      accepted.push(level);
    }
    return accepted;
  }

  /**
   * CLI 를 인자 그대로 한 번 띄우고 stdout+stderr 를 합쳐 돌려준다(실패·타임아웃이면 빈 문자열).
   *
   * `--help`(등급 목록)와 `--effort <값> --version`(값 수락 여부) 두 probe 가 **같은 창구**를 쓴다 —
   * 갈라 두면 셸 경유·타임아웃·spawn 실패 처리를 한쪽만 고치는 날이 온다.
   */
  private runCliCapture(binPath: string, args: readonly string[]): Promise<string> {
    return new Promise<string>((resolve) => {
      let done = false;
      let out = '';
      const finish = (text: string): void => { if (!done) { done = true; resolve(text); } };
      let child: ReturnType<typeof spawn>;
      try {
        // detached 를 **일부러 안 붙인다** — 이 probe 들은 손자를 만들지 않고 즉시 끝난다
        //   (단일 kill 로 회수하므로 프로세스 그룹이 필요 없다).
        // 셸 경유 여부는 공용 창구가 정한다(공백 든 설치 경로 대응).
        const invocation = buildCliInvocation(binPath, [...args], process.platform);
        child = spawn(invocation.file, invocation.args, {
          shell: invocation.shell,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        return finish('');
      }
      const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } finish(out); }, HELP_PROBE_TIMEOUT_MS);
      child.stdout?.on('data', (c) => { out += c.toString(); });
      child.stderr?.on('data', (c) => { out += c.toString(); });
      child.on('error', (err) => { clearTimeout(timer); noteClaudeSpawnFailure(err); finish(''); });
      child.on('close', () => { clearTimeout(timer); finish(out); });
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
   * semver(`A-B`) 비교를 1순위로. createdAt(API) 2순위. source 3순위(api > seed). id 4순위.
   * `claude-opus-5` 처럼 판올림이 높은 쪽이 자동으로 latest 가 되도록.
   *
   * §4 v2.77 — 패밀리 목록을 entries 에서 동적 수집(opus/sonnet/haiku 하드코딩 제거) → 신규 패밀리(fable/mythos)도
   * 각자 latest 가 셋됨.
   */
  private markLatestOfFamily(entries: ModelRegistryEntry[]): void {
    const families = [...new Set(entries.map((e) => e.family).filter(Boolean))];
    for (const e of entries) e.isLatestOfFamily = false;
    const sourceRank: Record<ModelRegistryEntry['source'], number> = { api: 2, seed: 1 };
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
    // §4 — effort 등급은 CLI(`claude --help`)에서 동적 파싱(하드코딩 폐기). 실패 시 undefined→클라 폴백.
    // `--help` 는 CLI 가 공개한 인터페이스라 그대로 둔다(실행본을 뜯어 읽던 모델 raw scan 과 다르다).
    try {
      this.cliEffortLevels = await this.scanEffortLevelsFromCli();
    } catch (err) {
      logger.warn(`[modelRegistry] effort --help scan failed: ${err instanceof Error ? err.message : String(err)}`);
      this.cliEffortLevels = undefined;
    }

    // 캐시에서 API 결과만 추출 (시드 entry 는 매 부팅 재생성)
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

    // 공개 문서 시드 + 캐시 API 결과 머지로 임시 레지스트리 구성
    this.registry = this.buildMerged(cachedApiEntries);
    this.markLatestOfFamily(this.registry.entries);
    this.emit();
    logger.info(`[modelRegistry] initial: seed=${MODEL_SEED_ENTRIES.length} cached-api=${cachedApiEntries.length} total=${this.registry.entries.length} mix=${this.registry.sourceMix}`);

    // 캐시 fresh 면 API 재fetch 생략
    if (cachedApiEntries.length > 0) return;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      logger.info('[modelRegistry] ANTHROPIC_API_KEY not set — seed only mode (no api enrichment)');
      return;
    }

    try {
      const apiEntries = await this.fetchFromApi(apiKey);
      this.registry = this.buildMerged(apiEntries);
      this.markLatestOfFamily(this.registry.entries);
      await this.saveCache();
      this.emit();
      logger.info(`[modelRegistry] api-fresh: seed=${MODEL_SEED_ENTRIES.length} api=${apiEntries.length} total=${this.registry.entries.length} mix=${this.registry.sourceMix}`);
    } catch (err) {
      logger.warn(`[modelRegistry] /v1/models fetch failed — staying on seed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 공개 문서 시드 + `/v1/models` API entries 머지 — 규칙은 `mergeSeedAndApiEntries`(순수·테스트됨). */
  private buildMerged(apiEntries: ModelRegistryEntry[]): ModelRegistry {
    const sourceMix: ModelRegistry['sourceMix'] =
      apiEntries.length > 0 ? 'api-merged' : 'seed-only';
    return {
      entries: mergeSeedAndApiEntries(apiEntries),
      updatedAt: Date.now(),
      sourceMix,
      // §4 — CLI --help 에서 파싱한 effort 등급을 registry 에 실어 같은 WS/REST 경로로 전파.
      effortLevels: this.cliEffortLevels,
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
        const entry = mapApiModelEntry(m);
        if (entry) out.push(entry);
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
