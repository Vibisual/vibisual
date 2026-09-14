/**
 * §4 v2.38 — 동적 모델 레지스트리.
 *
 * 부팅 시 (1) shared `MODEL_SEED_ENTRIES` 로드 → (2) `ANTHROPIC_API_KEY` 가 있으면
 * `GET https://api.anthropic.com/v1/models` 호출 → (3) id prefix 로 family 추론·머지 →
 * (4) 패밀리별 `createdAt desc` 정렬 → 첫 entry `isLatestOfFamily=true` 셋.
 *
 * 캐시: `~/.vibisual/model-registry.json` (`MODEL_REGISTRY_API_TTL_MS`). 부팅 시 캐시가 유효하면 페치 생략.
 *
 * §4 (상태바 모델 칸 ③) — **목록은 저절로 최신이어야 한다.** 종전에는 위 흐름이 부팅 1회뿐이라 앱을
 * 켜 둔 채 새 모델이 나오면 재시작 전까지 몰랐고, 키가 없는 사용자(구독 로그인 대다수)는 시드가
 * 목록의 전부였다. 이제 셋이 더 붙는다 — 모두 법적 안전선 안의 출처다(문서 HTML 긁기·실행본 문자열 ❌).
 *  - `refreshIfDue()` — 기존 20초 비용 스윕이 부른다. API 는 TTL 이 지났을 때만, 실행본은 바뀌었을 때만.
 *  - `refreshNow()` — 모델 창을 열 때 한 번 더 확인(API 는 하한 안이면 건너뜀).
 *  - `noteObservedModel()` — 자기 PC 대화록에 **실제 API 응답으로 찍힌** 모델 ID 를 배운다(`source: 'observed'`).
 *
 * v1.96 에서 `@anthropic-ai/sdk` 가 제거됐으므로 raw `fetch` (node 20+ 글로벌) 사용.
 * `ANTHROPIC_API_KEY` 미설정 시 sourceMix='seed-only' 로 시드(+관측)만 반환.
 *
 * 콜사이트:
 * - `projectGraphManager.getSnapshot()` → `snapshot.modelRegistry`
 * - `subAgentManager.buildConfigArgs()` → `resolveAliasToLatest('opus', registry)` 로 alias 해소
 * - `sessionDiscovery.readContextInfo()` → `noteObservedModel(lastModel)` (한도를 묻던 그 자리가 배운다)
 * - REST `GET /api/models` · `POST /api/models/refresh` → 클라 즉시 페치(WS 도착 전 빈 화면 방지)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import {
  EFFORT_LEVEL_PROBE_CANDIDATES,
  MODEL_REGISTRY_API_TTL_MS,
  MODEL_REGISTRY_MANUAL_REFRESH_FLOOR_MS,
  MODEL_REGISTRY_OBSERVED_MAX,
  MODEL_REGISTRY_RETRY_MS,
  MODEL_SEED_ENTRIES,
  normalizeModelId,
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
/**
 * `limit` 은 문서화된 쿼리 인자다(기본 20). 기본값이면 목록이 20개에서 잘리는데, 응답이 최신순이라
 * 새 모델은 잡히지만 옛 판(버전 드롭다운의 "직전 판")이 빠질 수 있어 넉넉히 받는다.
 */
const API_URL = 'https://api.anthropic.com/v1/models?limit=100';
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
/**
 * §4 (상태바 모델 칸 ③(다)) — 관측으로 배운 모델 ID 의 **정규 모양**. `claude-<패밀리>-<주>[-<부>]`.
 * `<synthetic>` · 옛 명명(`claude-3-5-sonnet`) · 꼬리 변형(`…-fast` 같은 것)은 여기서 떨어진다 —
 * 모양이 다른 ID 는 판 비교(`parseModelSemver`)가 `[0,0]` 으로 읽어 목록을 어지럽히기만 한다.
 */
const OBSERVED_MODEL_ID_RE = /^claude-[a-z]+-\d+(?:-\d{1,2})?$/;
/** 한 번 판정한 원문(대화록의 `message.model` 그대로)은 다시 정규화하지 않는다 — 스냅샷마다 불리는 자리다. */
const OBSERVED_RAW_MEMO_MAX = 256;
/** 관측 반영 방송을 한 박자 미룬다 — `readContextInfo` 는 스냅샷 조립 **안**에서 불린다(재진입 방지). */
const OBSERVED_EMIT_DELAY_MS = 250;
/** 관측분 캐시 저장 디바운스 — 첫 스캔에서 여러 ID 가 한꺼번에 들어와도 파일은 한 번만 쓴다. */
const OBSERVED_SAVE_DELAY_MS = 2_000;

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

/**
 * §4 (상태바 모델 칸 ③(다)) — 대화록의 `message.model` 원문 → 레지스트리가 배울 풀ID. 배울 것이 아니면 `null`.
 *
 * 정규화(`normalizeModelId` — 날짜 꼬리·`[1m]` 변형 제거) 뒤 **정규 모양**이고 모델 패밀리일 때만 통과한다.
 * 대화록에는 모델이 아닌 값(`<synthetic>`)과 옛 명명이 섞여 오므로, 여기서 떨어뜨리지 않으면 드롭다운이
 * 판 번호를 읽을 수 없는 항목으로 어지러워진다.
 */
export function normalizeObservedModelId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = normalizeModelId(raw.trim());
  if (!OBSERVED_MODEL_ID_RE.test(id)) return null;
  const family = parseFamilyFromFullId(id);
  if (!family || NON_MODEL_FAMILIES.has(family)) return null;
  return id;
}

/**
 * §4 (상태바 모델 칸 ③(다)) — 관측분을 시드+API 결과 위에 얹는다.
 *
 * **이미 아는 ID 는 건드리지 않는다** — 시드·API 쪽이 더 많이 안다(가격·컨텍스트·표시명). 관측은
 * "이런 모델이 실제로 있다"는 사실 하나만 보탠다.
 */
export function mergeObservedEntries(
  base: readonly ModelRegistryEntry[],
  observed: readonly ModelRegistryEntry[],
): ModelRegistryEntry[] {
  const out = base.map((e) => ({ ...e }));
  const known = new Set(out.map((e) => e.id));
  for (const o of observed) {
    if (known.has(o.id)) continue;
    known.add(o.id);
    out.push({ ...o });
  }
  return out;
}

/** §4 (상태바 모델 칸 ③(다)) — 관측분 상한. 최근 관측 순으로 `max` 개만 남긴다(§9 키 개수 캡). */
export function capObservedEntries(observed: readonly ModelRegistryEntry[], max: number): ModelRegistryEntry[] {
  return [...observed]
    .sort((a, b) => (b.observedAt ?? 0) - (a.observedAt ?? 0))
    .slice(0, Math.max(0, max));
}

/** `/v1/models` 를 지금 부를 때가 됐는가 — 판정에 필요한 시각들. */
export interface ApiRefreshClock {
  now: number;
  /** `ANTHROPIC_API_KEY` 가 있는가. 없으면 언제나 부르지 않는다. */
  hasKey: boolean;
  /** 마지막으로 **성공한** 조회 시각(0 = 없음). 신선도는 이 값으로 잰다. */
  fetchedAt: number;
  /** 마지막으로 **시도한** 시각(0 = 없음). 실패 뒤 재시도 간격과 수동 확인 하한은 이 값으로 잰다. */
  lastAttemptAt: number;
}

/**
 * §4 (상태바 모델 칸 ③(나)) — 지금 `/v1/models` 를 부를 차례인가.
 *
 * - `periodic`(20초 스윕): 성공한 결과가 `MODEL_REGISTRY_API_TTL_MS` 보다 낡았을 때만. 방금 실패했으면
 *   `MODEL_REGISTRY_RETRY_MS` 를 기다린다 — 네트워크가 끊긴 PC 에서 20초마다 두드리지 않게.
 * - `manual`(모델 창 열기): 마지막 시도가 `MODEL_REGISTRY_MANUAL_REFRESH_FLOOR_MS` 보다 오래됐으면.
 *   창을 연달아 열고 닫아도 API 는 그 간격 안에서 한 번이다.
 */
export function isApiRefreshDue(clock: ApiRefreshClock, mode: 'periodic' | 'manual'): boolean {
  if (!clock.hasKey) return false;
  if (mode === 'manual') return clock.now - clock.lastAttemptAt >= MODEL_REGISTRY_MANUAL_REFRESH_FLOOR_MS;
  if (clock.fetchedAt > 0 && clock.now - clock.fetchedAt < MODEL_REGISTRY_API_TTL_MS) return false;
  return clock.now - clock.lastAttemptAt >= MODEL_REGISTRY_RETRY_MS;
}

interface CachedRegistry {
  registry: ModelRegistry;
  /** 마지막으로 **성공한** `/v1/models` 조회 시각. 0 = 한 번도 없음(관측분만 저장된 파일). */
  fetchedAt: number;
  /** §4 (상태바 모델 칸 ③(다)) — 대화록에서 배운 모델. TTL 과 무관하게 부팅 때 되살린다. */
  observed?: ModelRegistryEntry[];
}

class ModelRegistryService {
  private registry: ModelRegistry;
  private listeners = new Set<(reg: ModelRegistry) => void>();
  /**
   * §4 — 설치된 `claude --help` 에서 파싱한 `--effort` 등급(예: ['low','medium','high','xhigh','max']).
   * refreshIfStale 초입에서 1회 채워지고, 이후 모든 buildMerged 결과에 실린다. undefined = 파싱 실패(클라 폴백).
   */
  private cliEffortLevels: string[] | undefined;
  /**
   * §4 (상태바 모델 칸 ③) — 강도 등급을 긁을 때의 실행본 정체(경로 + 수정 시각). 스윕·창 열기가
   * 이 값과 지금 실행본을 대조해 **바뀌었을 때만** `--help` 를 다시 띄운다(확장 자동 갱신 대응).
   */
  private effortBinIdentity: string | null = null;
  /** 지금 레지스트리에 머지돼 있는 `/v1/models` 결과. 관측 한 건으로 다시 짤 때 재조회 없이 쓴다. */
  private apiEntries: ModelRegistryEntry[] = [];
  private apiFetchedAt = 0;
  private lastApiAttemptAt = 0;
  /** 출처를 마지막으로 확인한 시각 — `ModelRegistry.checkedAt` 으로 나간다. */
  private checkedAt = 0;
  /** 대화록에서 배운 모델(id → entry). 상한은 `MODEL_REGISTRY_OBSERVED_MAX`. */
  private observed = new Map<string, ModelRegistryEntry>();
  /** 이미 판정한 원문 — 스냅샷마다 같은 문자열이 들어오므로 정규화를 한 번만 한다. */
  private observedRawSeen = new Set<string>();
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** 스윕·창 열기가 겹쳐도 확인은 한 줄로 — 돌고 있는 확인이 있으면 그것을 기다린다. */
  private inFlight: Promise<void> | null = null;
  /** 부팅 확인이 캐시를 한 번 읽었는가. 그 전의 저장은 미룬다(`savePending`). */
  private cacheLoaded = false;
  private savePending = false;

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
   * §4 (상태바 모델 칸 ③) — 지금 쓰는 `claude` 실행본의 정체. **경로 + 수정 시각**.
   *
   * 확장 자동 갱신은 새 판을 **다른 폴더**에 풀고, 공식 인스톨러는 같은 런처 경로 뒤의 실체를 바꾼다 —
   * 경로만 보면 뒤엣것을, 판 번호를 물으면 매번 자식을 띄워야 한다. 수정 시각은 `stat` 한 번이라
   * 20초 스윕에서 불러도 싸다. 못 찾으면 빈 문자열(= "실행본 없음"도 하나의 정체다).
   */
  private async currentBinIdentity(): Promise<string> {
    let binPath: string | undefined;
    try {
      binPath = getClaudeBin()?.binPath;
    } catch { /* PATH 미발견 */ }
    if (!binPath) return '';
    try {
      const st = await fs.stat(binPath);
      return `${binPath}|${Math.round(st.mtimeMs)}`;
    } catch {
      // bare `claude`(PATH 해석 위임)나 사라진 경로 — 경로만으로 정체를 삼는다.
      return `${binPath}|0`;
    }
  }

  /** 강도 등급을 다시 긁고, 그때의 실행본 정체를 기억한다. 등급이 바뀌었으면 true. */
  private async rescanEffortLevels(identity?: string): Promise<boolean> {
    const before = JSON.stringify(this.cliEffortLevels ?? null);
    try {
      this.cliEffortLevels = await this.scanEffortLevelsFromCli();
    } catch (err) {
      logger.warn(`[modelRegistry] effort --help scan failed: ${err instanceof Error ? err.message : String(err)}`);
      this.cliEffortLevels = undefined;
    }
    this.effortBinIdentity = identity ?? await this.currentBinIdentity();
    return JSON.stringify(this.cliEffortLevels ?? null) !== before;
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
   * semver(`A-B`) 비교를 1순위로. createdAt(API) 2순위. source 3순위(api > seed > observed). id 4순위.
   * `claude-opus-5` 처럼 판올림이 높은 쪽이 자동으로 latest 가 되도록.
   *
   * §4 v2.77 — 패밀리 목록을 entries 에서 동적 수집(opus/sonnet/haiku 하드코딩 제거) → 신규 패밀리(fable/mythos)도
   * 각자 latest 가 셋됨.
   * §4 (상태바 모델 칸 ③(다)) — 관측으로 들어온 **더 높은 판**은 시드를 기다리지 않고 latest 가 된다.
   * 같은 판이면 더 많이 아는 출처(api > seed)가 이긴다.
   */
  private markLatestOfFamily(entries: ModelRegistryEntry[]): void {
    const families = [...new Set(entries.map((e) => e.family).filter(Boolean))];
    for (const e of entries) e.isLatestOfFamily = false;
    const sourceRank: Record<ModelRegistryEntry['source'], number> = { api: 3, seed: 2, observed: 1 };
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

  /** 지금 가진 재료(API 결과 · 관측분 · 강도 등급)로 레지스트리를 다시 짠다. 네트워크·자식 ❌. */
  private rebuild(): void {
    this.registry = this.buildMerged(this.apiEntries);
    this.markLatestOfFamily(this.registry.entries);
  }

  /**
   * 부팅 시 호출 — (1) 캐시 hit 시 사용, (2) 아니면 `/v1/models` fetch + 머지, (3) 실패 시 시드만 유지.
   * fetch 는 비동기 — 호출자(서버 부트 시퀀스)는 await 없이 시작 가능. 완료 시 listener push.
   *
   * CLI 가 새로 깔렸을 때(`reprimeClaudeDerivedCaches`)도 이것을 부른다. 주기·수동 확인이 돌고 있으면
   * **그 뒤에 이어서** 돈다(합치지 않는다) — 이쪽은 "처음부터 다시 긁는다"는 뜻이라 건너뛰면 안 된다.
   */
  refreshIfStale(): Promise<void> {
    return this.runSerialized(() => this.refreshIfStaleCore());
  }

  private async refreshIfStaleCore(): Promise<void> {
    // §4 — effort 등급은 CLI(`claude --help`)에서 동적 파싱(하드코딩 폐기). 실패 시 undefined→클라 폴백.
    // `--help` 는 CLI 가 공개한 인터페이스라 그대로 둔다(실행본을 뜯어 읽던 모델 raw scan 과 다르다).
    await this.rescanEffortLevels();

    // 캐시에서 API 결과만 추출 (시드 entry 는 매 부팅 재생성)
    let cachedApiEntries: ModelRegistryEntry[] = [];
    try {
      const cached = await this.loadCache();
      if (cached) {
        // §4 (상태바 모델 칸 ③(다)) — 관측분은 **TTL 과 무관하게** 되살린다(한 번 본 모델은 낡지 않는다).
        this.absorbObserved(cached.observed ?? []);
        if (cached.fetchedAt > 0 && Date.now() - cached.fetchedAt < MODEL_REGISTRY_API_TTL_MS) {
          cachedApiEntries = (cached.registry?.entries ?? [])
            .filter((e) => e?.source === 'api')
            .map((e) => ({ ...e }));
          if (cachedApiEntries.length > 0) {
            this.apiFetchedAt = cached.fetchedAt;
            this.lastApiAttemptAt = Math.max(this.lastApiAttemptAt, cached.fetchedAt);
          }
        }
      }
    } catch (err) {
      logger.warn(`[modelRegistry] cache load failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    // 캐시를 한 번 읽기 전까지는 저장을 미뤄 두었다 — 먼저 쓰면 아직 안 읽은 API 결과를 덮어 버린다.
    this.cacheLoaded = true;
    if (this.savePending) {
      this.savePending = false;
      this.scheduleSave();
    }

    // 공개 문서 시드 + 캐시 API 결과(+관측분) 머지로 임시 레지스트리 구성
    this.apiEntries = cachedApiEntries;
    this.checkedAt = Date.now();
    this.rebuild();
    this.emit();
    logger.info(`[modelRegistry] initial: seed=${MODEL_SEED_ENTRIES.length} cached-api=${cachedApiEntries.length} observed=${this.observed.size} total=${this.registry.entries.length} mix=${this.registry.sourceMix}`);

    // 캐시 fresh 면 API 재fetch 생략
    if (cachedApiEntries.length > 0) return;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      logger.info('[modelRegistry] ANTHROPIC_API_KEY not set — seed + observed mode (no api enrichment)');
      return;
    }

    if (await this.fetchApiAndMerge(apiKey)) this.emit();
  }

  /**
   * `/v1/models` 를 한 번 부르고 성공하면 머지·캐시 저장까지 한다. 성공 여부를 돌려준다.
   * 시각 둘을 여기서만 갱신한다 — 신선도(`apiFetchedAt`)는 성공만, 재시도 간격(`lastApiAttemptAt`)은 시도마다.
   */
  private async fetchApiAndMerge(apiKey: string): Promise<boolean> {
    this.lastApiAttemptAt = Date.now();
    try {
      const apiEntries = await this.fetchFromApi(apiKey);
      this.apiEntries = apiEntries;
      this.apiFetchedAt = Date.now();
      this.checkedAt = this.apiFetchedAt;
      this.rebuild();
      await this.saveCache();
      logger.info(`[modelRegistry] api-fresh: seed=${MODEL_SEED_ENTRIES.length} api=${apiEntries.length} observed=${this.observed.size} total=${this.registry.entries.length} mix=${this.registry.sourceMix}`);
      return true;
    } catch (err) {
      logger.warn(`[modelRegistry] /v1/models fetch failed — keeping current list: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * §4 (상태바 모델 칸 ③(나)) — **주기 확인.** 기존 20초 비용 스윕이 기다리지 않고 부른다.
   *
   * 할 일이 없으면 `stat` 한 번으로 끝난다: 실행본이 그대로면 `--help` 를 안 띄우고, API 는
   * `isApiRefreshDue` 가 허락할 때만 부른다. 바뀐 것이 있을 때만 방송한다(20초마다 스냅샷을 흔들지 않게).
   */
  refreshIfDue(): Promise<void> {
    return this.runCoalesced(() => this.refreshCore('periodic'));
  }

  /**
   * §4 (상태바 모델 칸 ③) — **모델 창을 열 때 한 번 더 확인.** 끝난 뒤의 레지스트리를 돌려준다.
   * 바뀐 것이 없어도 `checkedAt` 은 지금으로 옮긴다 — 창 머리의 "목록 확인 N분 전" 이 방금 확인한 사실을 말하게.
   */
  async refreshNow(): Promise<ModelRegistry> {
    await this.runCoalesced(() => this.refreshCore('manual'));
    return this.registry;
  }

  /** 앞선 확인이 끝난 뒤에 이어서 돈다(부팅·CLI 재설치 — 건너뛰면 안 되는 확인). */
  private runSerialized(task: () => Promise<void>): Promise<void> {
    const prev = this.inFlight ?? Promise.resolve();
    const run: Promise<void> = prev
      .then(task)
      .catch((err) => {
        logger.warn(`[modelRegistry] refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        if (this.inFlight === run) this.inFlight = null;
      });
    this.inFlight = run;
    return run;
  }

  /** 이미 확인이 돌고 있으면 **그것을 기다린다**(주기·수동 — 같은 확인을 겹쳐 돌릴 이유가 없다). */
  private runCoalesced(task: () => Promise<void>): Promise<void> {
    if (this.inFlight) return this.inFlight;
    return this.runSerialized(task);
  }

  private async refreshCore(mode: 'periodic' | 'manual'): Promise<void> {
    let changed = false;

    const identity = await this.currentBinIdentity();
    if (identity !== this.effortBinIdentity) {
      logger.info(`[modelRegistry] claude binary changed (${this.effortBinIdentity ?? 'none'} -> ${identity || 'none'}) — rescanning effort levels`);
      if (await this.rescanEffortLevels(identity)) changed = true;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    const due = isApiRefreshDue({
      now: Date.now(),
      hasKey: !!apiKey,
      fetchedAt: this.apiFetchedAt,
      lastAttemptAt: this.lastApiAttemptAt,
    }, mode);
    if (due && apiKey && await this.fetchApiAndMerge(apiKey)) changed = true;

    if (changed) {
      this.checkedAt = Date.now();
      this.rebuild();
      this.emit();
      return;
    }
    if (mode === 'manual') {
      this.checkedAt = Date.now();
      // 내용은 그대로라 방송하지 않는다 — REST 응답이 이 값을 싣고, 다음 스냅샷이 나머지 창에 나른다.
      this.registry = { ...this.registry, checkedAt: this.checkedAt };
    }
  }

  /**
   * §4 (상태바 모델 칸 ③(다)) — **대화록에서 본 모델 ID 를 배운다.**
   *
   * `readContextInfo` 가 세션마다 마지막 모델의 한도를 레지스트리에 묻는 바로 그 자리에서 부른다 — 그
   * 모델은 이 PC 에서 **실제 API 응답으로 돌아온** 것이라(합성 응답은 `<synthetic>` 이라 모양에서 걸러진다)
   * 가짜가 없다. 스냅샷마다 불리므로 이미 본 원문은 Set 조회 한 번으로 끝난다.
   *
   * 시드·API 가 이미 아는 ID 는 더하지 않는다. 새 ID 면 레지스트리를 다시 짜고(패밀리 latest 재산정),
   * 방송·저장은 한 박자 미룬다 — 이 호출은 스냅샷 조립 **안**이라 곧장 방송하면 조립 중에 또 조립이 돈다.
   */
  noteObservedModel(raw: unknown): void {
    if (typeof raw !== 'string' || raw.length === 0) return;
    if (this.observedRawSeen.has(raw)) return;
    if (this.observedRawSeen.size >= OBSERVED_RAW_MEMO_MAX) this.observedRawSeen.clear();
    this.observedRawSeen.add(raw);

    const id = normalizeObservedModelId(raw);
    if (!id || this.observed.has(id)) return;
    if (this.registry.entries.some((e) => e.id === id && e.source !== 'observed')) return;
    const family = parseFamilyFromFullId(id);
    if (!family) return;

    this.observed.set(id, { id, family, source: 'observed', observedAt: Date.now() });
    this.trimObserved();
    this.rebuild();
    logger.info(`[modelRegistry] learned model id from local transcripts: ${id}`);
    this.scheduleEmit();
    this.scheduleSave();
  }

  /** 캐시에서 읽은 관측분을 합친다 — 부팅 전에 이미 배운 것이 있으면 그것을 지우지 않는다. */
  private absorbObserved(entries: readonly ModelRegistryEntry[]): void {
    for (const e of entries) {
      const id = normalizeObservedModelId(e?.id);
      if (!id || this.observed.has(id)) continue;
      const family = parseFamilyFromFullId(id);
      if (!family) continue;
      this.observed.set(id, {
        id,
        family,
        source: 'observed',
        observedAt: typeof e.observedAt === 'number' && Number.isFinite(e.observedAt) ? e.observedAt : 0,
      });
    }
    this.trimObserved();
  }

  private trimObserved(): void {
    if (this.observed.size <= MODEL_REGISTRY_OBSERVED_MAX) return;
    const kept = capObservedEntries([...this.observed.values()], MODEL_REGISTRY_OBSERVED_MAX);
    this.observed = new Map(kept.map((e) => [e.id, e]));
  }

  private scheduleEmit(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit();
    }, OBSERVED_EMIT_DELAY_MS);
    this.emitTimer.unref?.();
  }

  private scheduleSave(): void {
    if (!this.cacheLoaded) {
      this.savePending = true;
      return;
    }
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveCache();
    }, OBSERVED_SAVE_DELAY_MS);
    this.saveTimer.unref?.();
  }

  /** 공개 문서 시드 + `/v1/models` API entries(+관측분) 머지 — 규칙은 순수 함수 둘(테스트됨). */
  private buildMerged(apiEntries: ModelRegistryEntry[]): ModelRegistry {
    const sourceMix: ModelRegistry['sourceMix'] =
      apiEntries.length > 0 ? 'api-merged' : 'seed-only';
    return {
      entries: mergeObservedEntries(mergeSeedAndApiEntries(apiEntries), [...this.observed.values()]),
      updatedAt: Date.now(),
      ...(this.checkedAt > 0 ? { checkedAt: this.checkedAt } : {}),
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
      const parsed = JSON.parse(raw) as Partial<CachedRegistry>;
      if (!parsed?.registry?.entries) return null;
      // `fetchedAt` 이 없거나 0 이면 API 결과가 없는 파일(관측분만 저장된 것) — 버리지 않고 0 으로 읽는다.
      const fetchedAt = typeof parsed.fetchedAt === 'number' && Number.isFinite(parsed.fetchedAt) ? parsed.fetchedAt : 0;
      return {
        registry: parsed.registry,
        fetchedAt,
        observed: Array.isArray(parsed.observed) ? parsed.observed : [],
      };
    } catch {
      return null;
    }
  }

  private async saveCache(): Promise<void> {
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      const payload: CachedRegistry = {
        registry: this.registry,
        // 관측분 저장이 API 신선도를 늘리면 안 된다 — 성공한 조회 시각을 그대로 적는다.
        fetchedAt: this.apiFetchedAt,
        observed: capObservedEntries([...this.observed.values()], MODEL_REGISTRY_OBSERVED_MAX),
      };
      await fs.writeFile(CACHE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      logger.warn(`[modelRegistry] cache save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const modelRegistryService = new ModelRegistryService();
