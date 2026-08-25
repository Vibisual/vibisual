/**
 * localModelService.ts — §5.19 (E) All Model 로컬 모델 카탈로그·내려받기·목록.
 *
 * **카탈로그를 코드에 박지 않는다.** 모델 목록을 상수 배열로 들고 있으면 그 항목이 사라지거나
 * 새 모델이 나올 때마다 앱을 새로 내야 하고, 그 사이 화면은 거짓말을 한다. 그래서 검색은
 * 그때그때 조회해서 만든다(§5.19 (D) 빌드 번호를 안 박는 것과 같은 이유).
 *
 * **고르는 것은 사용자다.** "당신 PC 엔 이게 맞습니다" 식 추천을 하지 않는다 — 배포되는
 * 제품이라 우리는 사용자 장비를 모르고, 올라마도 7B 옆에 70B 를 그냥 같이 놓는다.
 * 이름·용량·양자화를 정직하게 보여 주는 것까지가 우리 몫이다.
 *
 * 받아 둔 모델의 진실도 **디스크**다 — 별도 색인 파일을 두면 사용자가 파일을 지웠을 때
 * 목록만 남아 첫 대화에서 죽는다. 매번 폴더를 훑는다.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  HF_EXPAND_FIELDS,
  HF_MODEL_API,
  HF_SORT_FIELD,
  LOCAL_MODEL_DIR_NAME,
  LOCAL_MODEL_FILE_LIMIT,
  LOCAL_MODEL_SEARCH_LIMIT,
  isChatCapablePipelineTag,
  quantRank,
  type LocalModelCatalogEntry,
  type LocalModelCatalogRepo,
  type LocalModelCatalogSort,
  type LocalModelDownloadProgress,
  type LocalModelEntry,
  type WSMessage,
} from '@vibisual/shared';
import { broadcast } from '../broadcastBus.js';
import { logger } from '../logger.js';
import { archBrokenReason, getArchVerdict, probeRemoteArchitecture } from './localArchService.js';
import { getEngineState } from './localEngineService.js';

/** 모델이 놓이는 폴더(`~/.vibisual/models`). 지우는 것도 여기 한 곳. */
export function modelsDir(): string {
  return path.join(os.homedir(), '.vibisual', LOCAL_MODEL_DIR_NAME);
}

/** 파일명에서 양자화 라벨을 읽는다(`…-Q4_K_M.gguf` → `Q4_K_M`). 못 읽으면 undefined. */
function parseQuant(fileName: string): string | undefined {
  const m = /[-.]((?:IQ|Q)\d+(?:_[A-Z0-9]+)*|F16|BF16|F32)\.gguf$/i.exec(fileName);
  return m?.[1]?.toUpperCase();
}

/** 파일명 → 안정 id. 경로 주입을 막기 위해 안전 문자만 남긴다. */
function fileToId(fileName: string): string {
  return fileName.replace(/\.gguf$/i, '').replace(/[^\w.-]/g, '_');
}

/**
 * 큰 모델은 `…-00002-of-00003.gguf` 처럼 쪼개져 배포된다. 그 조각 정보를 읽는다.
 * 쪼개진 파일이 아니면 `null`.
 *
 * **조각은 모델이 아니다.** 하나만 받으면 못 쓰고, 엔진에는 **첫 조각**을 줘야 나머지를
 * 스스로 따라간다 — 다른 조각을 주면 그대로 죽는다(2026-08-20 실측: 둘째 조각만 받힌
 * 상태로 고를 수 있어서 `engine exited before ready (code=1)` 만 남았다).
 */
function parseSplitPart(fileName: string): { base: string; index: number; total: number } | null {
  const m = /^(.+)-(\d{5})-of-(\d{5})\.gguf$/i.exec(fileName);
  if (!m) return null;
  const base = m[1] ?? '';
  const index = Number(m[2]);
  const total = Number(m[3]);
  if (!base || !Number.isFinite(index) || !Number.isFinite(total) || total < 1 || index < 1 || index > total) {
    return null;
  }
  return { base, index, total };
}

/** 조각 파일명을 만든다(llama.cpp 규약 그대로 다섯 자리 0채움). */
function splitPartName(base: string, index: number, total: number): string {
  const pad = (n: number): string => String(n).padStart(5, '0');
  return `${base}-${pad(index)}-of-${pad(total)}.gguf`;
}

/**
 * **부속 파일은 모델이 아니다.** 저장소에는 본체와 함께 쓰라고 있는 GGUF 가 섞여 있다 —
 * `mmproj-…`(시각 투영기), `mtp-…`/`MTP/`(투기적 디코딩용 보조 헤드). 이름만 같은 `.gguf`
 * 라서 목록에 그대로 내놓으면 사용자가 그걸 본체로 알고 받는다. 그리고 그걸 열면 엔진이
 * 그냥 뻗는다(2026-08-20 실측: 27B 라면서 1.37GB 인 MTP 헤드 → `0xC0000005`).
 */
function isCompanionName(fileOrPath: string): boolean {
  const name = (fileOrPath.split('/').pop() ?? fileOrPath).toLowerCase();
  // `mmproj-…` 시각 투영기 · `mtp-…` 보조 헤드 · `imatrix…` 양자화 교정표.
  //   셋 다 `.gguf` 를 쓰지만 셋 다 혼자서는 한 마디도 못 한다.
  if (/^mmproj[-_.]/.test(name) || /^mtp[-_.]/.test(name) || /imatrix/.test(name)) return true;
  // 저장소가 폴더로 갈라 두기도 한다(`MTP/mtp-….gguf`).
  return /(^|\/)mtp\//i.test(fileOrPath);
}

/**
 * 이름이 아니라 **파일 스스로**에게 묻는다 — GGUF 머리 24바이트에 텐서 개수가 들어 있다.
 * 진짜 언어모델은 아무리 작아도 텐서가 수백 개다(0.5B 도 200개 이상). 스물 몇 개짜리는
 * 본체가 아니라 부속이다. 24바이트만 읽으므로 목록을 훑는 비용에 영향을 주지 않는다.
 *
 * 못 읽으면 `null` — 여기서 단정하지 않는다(이름 규칙이 따로 판단한다).
 */
function ggufTensorCount(file: string): number | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(24);
    if (fs.readSync(fd, head, 0, 24, 0) < 24) return null;
    if (head.toString('latin1', 0, 4) !== 'GGUF') return null;
    return Number(head.readBigUInt64LE(8));
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* 이미 닫혔으면 그만 */
      }
    }
  }
}

/** 이보다 텐서가 적으면 언어모델 본체일 수 없다(실측 MTP 헤드 = 18개). */
const MIN_MODEL_TENSORS = 24;

// ─── 받은 모델이 실제로 말을 하는지 (§5.19 (E)) ───

/**
 * 점검 결과를 두는 곳. 모델 폴더 안에 숨은 파일 하나로 둔다 — 모델을 지우면 함께
 * 정리되고, 새 영속 저장소를 발명하지 않는다.
 */
function outputCheckPath(): string {
  return path.join(modelsDir(), '.output-check.json');
}

interface OutputCheckRecord {
  /** 파일이 바뀌면 옛 판정은 버린다 — 같은 이름으로 다른 것을 받았을 수 있다. */
  sizeBytes: number;
  verdict: 'ok' | 'broken';
  at: number;
}

function readOutputChecks(): Record<string, OutputCheckRecord> {
  try {
    const raw = fs.readFileSync(outputCheckPath(), 'utf8');
    const j = JSON.parse(raw) as Record<string, OutputCheckRecord>;
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

/** 점검 결과를 남긴다. 실패해도 조용히 넘어간다 — 표시용 정보가 기능을 막으면 안 된다. */
export function recordOutputCheck(modelId: string, sizeBytes: number, verdict: 'ok' | 'broken'): void {
  try {
    const all = readOutputChecks();
    all[modelId] = { sizeBytes, verdict, at: Date.now() };
    fs.mkdirSync(modelsDir(), { recursive: true });
    fs.writeFileSync(outputCheckPath(), JSON.stringify(all), 'utf8');
  } catch (err) {
    logger.warn('[localModel] output check record failed', err);
  }
}

/**
 * 내려받기가 끝났을 때 부를 자리. **여기서 러너를 직접 부르지 않는다** — 러너가 이 모듈을
 * 이미 물고 있어서 서로 물면 순환이 된다. 배선은 `index.ts` 가 한다.
 */
let downloadedHook: ((modelId: string) => void) | null = null;
export function setModelDownloadedHook(fn: ((modelId: string) => void) | null): void {
  downloadedHook = fn;
}

/**
 * §5.19 (E) — 받아 둔 모델 목록. 폴더를 훑어 만든다.
 * 아직 받는 중인 `.part` 파일은 목록에 넣지 않는다(반쪽 모델을 고를 수 있으면 안 된다).
 */
export function listModels(): LocalModelEntry[] {
  const dir = modelsDir();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const found = new Map<string, { size: number; mtime: number }>();
  for (const name of names) {
    if (!/\.gguf$/i.test(name)) continue;
    let st: fs.Stats;
    try {
      st = fs.statSync(path.join(dir, name));
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    found.set(name, { size: st.size, mtime: st.mtimeMs });
  }

  const out: LocalModelEntry[] = [];
  const seenGroups = new Set<string>();
  for (const [name, stat] of found) {
    const split = parseSplitPart(name);
    if (!split) {
      const entry: LocalModelEntry = {
        id: fileToId(name),
        name: name.replace(/\.gguf$/i, ''),
        path: path.join(dir, name),
        sizeBytes: stat.size,
        downloadedAt: stat.mtime,
      };
      const quant = parseQuant(name);
      if (quant) entry.quant = quant;
      // 이름과 파일 스스로에게 둘 다 묻는다 — 어느 쪽이든 부속이면 고르지 못하게 한다.
      const tensors = ggufTensorCount(path.join(dir, name));
      if (isCompanionName(name) || (tensors !== null && tensors < MIN_MODEL_TENSORS)) entry.companion = true;
      out.push(entry);
      continue;
    }

    // 쪼개진 모델은 **한 항목**으로 묶는다. 조각을 따로 고를 수 있으면 반드시 잘못 고른다.
    const key = `${split.base}|${String(split.total)}`;
    if (seenGroups.has(key)) continue;
    seenGroups.add(key);

    const missingParts: string[] = [];
    let sizeBytes = 0;
    let downloadedAt = 0;
    for (let i = 1; i <= split.total; i += 1) {
      const partName = splitPartName(split.base, i, split.total);
      const got = found.get(partName);
      if (!got) {
        missingParts.push(partName);
        continue;
      }
      sizeBytes += got.size;
      downloadedAt = Math.max(downloadedAt, got.mtime);
    }
    const entry: LocalModelEntry = {
      id: fileToId(`${split.base}.gguf`),
      name: split.base,
      // 엔진에 주는 것은 언제나 **첫 조각**이다.
      path: path.join(dir, splitPartName(split.base, 1, split.total)),
      sizeBytes,
      downloadedAt,
      partCount: split.total,
    };
    const quant = parseQuant(`${split.base}.gguf`);
    if (quant) entry.quant = quant;
    if (missingParts.length > 0) entry.missingParts = missingParts;
    if (isCompanionName(split.base)) entry.companion = true;
    out.push(entry);
  }
  // 받은 뒤 실제로 말을 시켜 본 결과가 있으면 함께 싣는다. 크기가 달라졌으면 같은 이름이라도
  //   다른 파일이므로 옛 판정은 버린다.
  const checks = readOutputChecks();
  for (const entry of out) {
    const record = checks[entry.id];
    if (record && record.sizeBytes === entry.sizeBytes) entry.outputCheck = record.verdict;
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** id 로 받아 둔 모델 하나 찾기. 없으면 null. */
export function findModel(modelId: string): LocalModelEntry | null {
  return listModels().find((m) => m.id === modelId) ?? null;
}

/** §5.19 (E) — 받아 둔 모델 삭제. 사용자가 명시적으로 고른 것만 지운다. */
export async function deleteModel(modelId: string): Promise<boolean> {
  const found = findModel(modelId);
  if (!found) return false;
  // 쪼개진 모델은 조각을 남기면 목록에 반쪽으로 되살아난다 — 한 벌을 통째로 지운다.
  const total = found.partCount ?? 0;
  const targets =
    total > 1
      ? Array.from({ length: total }, (_, i) => path.join(modelsDir(), splitPartName(found.name, i + 1, total)))
      : [found.path];
  for (const target of targets) await fsp.rm(target, { force: true });
  logger.info(`[localModel] deleted ${found.name}${total > 1 ? ` (${String(total)} parts)` : ''}`);
  return true;
}

// ─── 카탈로그 조회 (Hugging Face) ───

interface HfModelSummary {
  id?: string;
  modelId?: string;
  downloads?: number;
  /** 하트 수 — 받아 간 사람이 아니라 좋다고 남긴 사람의 수다. */
  likes?: number;
  /** 요즘 얼마나 뜨는가. **달라고 해야 온다**(`expand[]`) — 기본 응답에는 없다(2026-08-24 실측). */
  trendingScore?: number;
  /** 마지막 갱신 시각(ISO 문자열). */
  lastModified?: string;
  /** §5.19 (E) — 저장소가 스스로 밝힌 작업 종류. 없는 경우가 흔하다(그래서 없으면 통과). */
  pipeline_tag?: string;
}

interface HfSibling {
  rfilename?: string;
  size?: number;
}

function downloadUrl(repo: string, file: string): string {
  const parts = file.split('/').map((s) => encodeURIComponent(s)).join('/');
  return `https://huggingface.co/${repo}/resolve/main/${parts}?download=true`;
}

/**
 * §5.19 (E) — 저장소 검색. 검색어가 비면 그 정렬 축의 인기 목록을 준다.
 * 실패하면 빈 배열 — 화면은 "찾지 못했습니다"로 떨어지고 앱은 계속 돈다.
 *
 * **정렬은 카탈로그에 맡긴다.** 받아 온 스무 건을 우리가 다시 줄 세우면 "하트순 1위"가
 * 그 스무 건 안에서만 1위가 되어, 화면이 말하는 순위와 실제 순위가 갈린다.
 */
export async function searchCatalog(
  query: string,
  sort: LocalModelCatalogSort = 'downloads',
): Promise<LocalModelCatalogRepo[]> {
  const url = new URL(HF_MODEL_API);
  url.searchParams.set('filter', 'gguf');
  url.searchParams.set('sort', HF_SORT_FIELD[sort]);
  url.searchParams.set('direction', '-1');
  url.searchParams.set('limit', String(LOCAL_MODEL_SEARCH_LIMIT));
  // 하트·트렌딩·갱신시각은 **달라고 해야 온다** — 기본 응답에는 트렌딩이 빠져 있다.
  for (const field of HF_EXPAND_FIELDS) url.searchParams.append('expand[]', field);
  const q = query.trim();
  if (q) url.searchParams.set('search', q);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'vibisual' } });
    if (!res.ok) throw new Error(`hf search ${res.status}`);
    const list = (await res.json()) as HfModelSummary[];
    return list
      // §5.19 (E) — 대화용이 아니라고 **스스로 밝힌** 저장소는 애초에 내놓지 않는다(음성인식·
      //   임베딩·이미지 생성). 태그가 없으면 통과시킨다 — 좋은 저장소일수록 태그를 안 단다
      //   (실측: 인기 40건 중 `text-generation` 은 6건뿐이고 Qwen3.8-27B 은 태그가 없다).
      .filter((m) => isChatCapablePipelineTag(m.pipeline_tag))
      .map((m) => {
        const repo = m.id ?? m.modelId ?? '';
        const updated = m.lastModified ? Date.parse(m.lastModified) : Number.NaN;
        return {
          repo,
          downloads: m.downloads ?? 0,
          likes: m.likes ?? 0,
          trending: m.trendingScore ?? 0,
          // 날짜를 못 읽으면 0 — 화면은 그 자리에 아무것도 적지 않는다(엉뚱한 날짜보다 낫다).
          updatedAt: Number.isFinite(updated) ? updated : 0,
          files: [] as LocalModelCatalogEntry[],
        };
      })
      .filter((r) => r.repo.length > 0);
  } catch (err) {
    logger.warn('[localModel] catalog search failed', err);
    return [];
  }
}

/**
 * §5.19 (E) — 저장소 하나가 들고 있는 GGUF(=양자화 선택지) 목록.
 * 크기를 모르면 0 으로 둔다 — 화면이 "크기 미상"이라고 정직하게 말하면 된다.
 */
export async function listRepoFiles(repo: string): Promise<LocalModelCatalogEntry[]> {
  try {
    const res = await fetch(`${HF_MODEL_API}/${repo}?blobs=true`, {
      headers: { accept: 'application/json', 'user-agent': 'vibisual' },
    });
    if (!res.ok) throw new Error(`hf repo ${res.status}`);
    const j = (await res.json()) as { siblings?: HfSibling[] };
    const files = (j.siblings ?? [])
      .map((s) => s.rfilename ?? '')
      // 부속 파일은 애초에 내놓지 않는다 — 고를 수 있으면 반드시 누군가 고르고, 그 대가는
      //   "27B 라는데 1.37GB" 를 받은 뒤의 엔진 크래시다.
      .filter((n) => /\.gguf$/i.test(n) && !isCompanionName(n));
    const sizes = new Map<string, number>();
    for (const s of j.siblings ?? []) {
      if (s.rfilename && typeof s.size === 'number') sizes.set(s.rfilename, s.size);
    }
    // 쪼개진 모델은 조각이 아니라 **한 벌**로 내놓는다 — 조각을 따로 고를 수 있게 두면
    //   사용자는 한 조각만 받고 못 쓰게 된다(그리고 그 사실을 엔진이 죽고서야 알게 된다).
    const singles: LocalModelCatalogEntry[] = [];
    const groups = new Map<string, { base: string; parts: string[] }>();
    for (const file of files) {
      const name = file.split('/').pop() ?? file;
      const split = parseSplitPart(name);
      if (!split) {
        const entry: LocalModelCatalogEntry = {
          id: fileToId(name),
          repo,
          file,
          url: downloadUrl(repo, file),
          sizeBytes: sizes.get(file) ?? 0,
        };
        const quant = parseQuant(name);
        if (quant) entry.quant = quant;
        singles.push(entry);
        continue;
      }
      const folder = file.slice(0, file.length - name.length);
      const key = `${folder}${split.base}|${String(split.total)}`;
      const group = groups.get(key) ?? { base: split.base, parts: [] };
      group.parts.push(file);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      // 다섯 자리 0채움이라 사전순 정렬이 곧 조각 순서다.
      const parts = [...group.parts].sort();
      const first = parts[0];
      if (!first) continue;
      const entry: LocalModelCatalogEntry = {
        id: fileToId(`${group.base}.gguf`),
        repo,
        file: first,
        url: downloadUrl(repo, first),
        sizeBytes: parts.reduce((sum, p) => sum + (sizes.get(p) ?? 0), 0),
        partFiles: parts,
      };
      const quant = parseQuant(`${group.base}.gguf`);
      if (quant) entry.quant = quant;
      singles.push(entry);
    }
    // §5.19 (E) — **많이 쓰이는 양자화가 앞에 선다**(화면은 앞의 몇만 펴 놓고 나머지는 접는다).
    //   종전에는 파일명 사전순이라 첫 줄이 51GB `BF16` 이었다 — 목록의 첫 줄이 이 PC 로는
    //   무리인 항목이면 사용자는 무엇을 받아야 할지 알 길이 없다. 순위가 같으면 큰 쪽이
    //   대개 품질이 낫고, 그마저 같으면 이름순으로 고정해 목록이 조회마다 흔들리지 않게 한다.
    singles.sort((a, b) => {
      const byRank = quantRank(a.quant) - quantRank(b.quant);
      if (byRank !== 0) return byRank;
      if (a.sizeBytes !== b.sizeBytes) return b.sizeBytes - a.sizeBytes;
      return a.id.localeCompare(b.id);
    });
    const listed = singles.slice(0, LOCAL_MODEL_FILE_LIMIT);

    // 한 저장소의 GGUF 들은 같은 모델의 양자화 갈래라 **구조가 같다** — 조회는 한 번이면
    //   된다. 앞 64KB 만 받아 구조를 알아내고, 그 구조가 이 엔진에서 도는지 장부에 묻는다.
    //   여기서 걸러야 사용자가 수 GB 를 받고서야 못 쓴다는 걸 아는 일이 없어진다.
    const first = listed[0];
    if (first) {
      const arch = await probeRemoteArchitecture(first.url, `${repo}|${first.file}`);
      if (arch) {
        const build = getEngineState().build ?? 'unknown';
        const verdict = getArchVerdict(build, arch);
        const reason = verdict === 'broken' ? archBrokenReason(arch) : '';
        for (const entry of listed) {
          entry.arch = arch;
          entry.archVerdict = verdict;
          if (reason) entry.archReason = reason;
        }
      }
    }
    return listed;
  } catch (err) {
    logger.warn(`[localModel] repo listing failed: ${repo}`, err);
    return [];
  }
}

// ─── 내려받기 ───

interface DownloadSession extends LocalModelDownloadProgress {
  abort: AbortController;
  destPath: string;
  partPath: string;
}

const downloads = new Map<string, DownloadSession>();

function toProgress(s: DownloadSession): LocalModelDownloadProgress {
  return {
    downloadId: s.downloadId,
    modelId: s.modelId,
    name: s.name,
    status: s.status,
    receivedBytes: s.receivedBytes,
    totalBytes: s.totalBytes,
    ...(s.error ? { error: s.error } : {}),
  };
}

function pushDownload(s: DownloadSession): void {
  const msg: WSMessage = { type: 'local_model_progress', timestamp: Date.now(), payload: toProgress(s) };
  broadcast(msg);
}

/** 진행 중이거나 방금 끝난 내려받기들(화면이 목록 아래에 그대로 그린다). */
export function listDownloads(): LocalModelDownloadProgress[] {
  return [...downloads.values()].map(toProgress);
}

/**
 * §5.19 (E) — 모델 내려받기. **재개 가능**하다 — 수 GB 를 받다 앱이 꺼지면 처음부터 다시
 * 받게 만들 수 없다. 받다 만 것은 `.part` 로 두고 다음에 `Range` 로 이어 받는다.
 */
export function downloadModel(repo: string, file: string, partFiles?: readonly string[]): LocalModelDownloadProgress {
  // 쪼개진 모델은 조각 전부가 한 벌이다 — 하나만 받아 두면 그 모델은 쓸 수 없다.
  const targets = partFiles && partFiles.length > 0 ? [...partFiles] : [file];
  const firstName = (targets[0] ?? file).split('/').pop() ?? file;
  const split = parseSplitPart(firstName);
  const groupName = split ? split.base : firstName.replace(/\.gguf$/i, '');
  const modelId = fileToId(split ? `${split.base}.gguf` : firstName);

  const existing = [...downloads.values()].find(
    (d) => d.modelId === modelId && (d.status === 'starting' || d.status === 'downloading'),
  );
  if (existing) return toProgress(existing);

  const dir = modelsDir();
  const destPath = path.join(dir, firstName);
  const session: DownloadSession = {
    downloadId: randomUUID(),
    modelId,
    name: groupName,
    status: 'starting',
    receivedBytes: 0,
    totalBytes: 0,
    abort: new AbortController(),
    destPath,
    partPath: `${destPath}.part`,
  };
  downloads.set(session.downloadId, session);
  pushDownload(session);

  void (async (): Promise<void> => {
    try {
      await fsp.mkdir(dir, { recursive: true });

      // 조각이 여럿이면 전체 크기를 먼저 물어 둔다 — 진행률이 조각마다 0 으로 되감기면
      //   사용자는 몇 십 GB 를 받는 동안 얼마나 남았는지 알 수 없다.
      if (targets.length > 1) {
        let sum = 0;
        for (const target of targets) {
          try {
            const head = await fetch(downloadUrl(repo, target), {
              method: 'HEAD',
              redirect: 'follow',
              headers: { 'user-agent': 'vibisual' },
              signal: session.abort.signal,
            });
            sum += Number(head.headers.get('content-length') ?? 0);
          } catch {
            sum = 0; // 하나라도 모르면 합계를 말하지 않는다 — 거짓 진행률보다 미상이 낫다
            break;
          }
        }
        session.totalBytes = sum;
      }

      let doneBytes = 0;
      for (const [index, target] of targets.entries()) {
        const name = target.split('/').pop() ?? target;
        const dest = path.join(dir, name);
        const partPath = `${dest}.part`;
        session.destPath = dest;
        session.partPath = partPath;
        session.name =
          targets.length > 1 ? `${groupName} (${String(index + 1)}/${String(targets.length)})` : groupName;

        // 이미 제자리에 있는 조각은 건너뛴다 — 이어받기의 연장이다.
        try {
          const settled = await fsp.stat(dest);
          if (settled.size > 0) {
            doneBytes += settled.size;
            session.receivedBytes = doneBytes;
            pushDownload(session);
            continue;
          }
        } catch {
          /* 아직 없으면 받는다 */
        }

        // 이어 받기 — 남아 있는 조각만큼 건너뛰고 요청한다.
        let already = 0;
        try {
          already = (await fsp.stat(partPath)).size;
        } catch {
          already = 0;
        }

        const headers: Record<string, string> = { 'user-agent': 'vibisual' };
        if (already > 0) headers['range'] = `bytes=${already}-`;

        const res = await fetch(downloadUrl(repo, target), {
          headers,
          redirect: 'follow',
          signal: session.abort.signal,
        });
        if (!res.ok || !res.body) throw new Error(`download ${res.status} (${name})`);

        // 206 이면 이어 받는 중이고, 200 이면 서버가 범위를 무시한 것이라 처음부터 다시 쓴다.
        const resumed = res.status === 206 && already > 0;
        const startAt = resumed ? already : 0;
        const len = Number(res.headers.get('content-length') ?? 0);
        const fileTotal = len > 0 ? startAt + len : 0;
        if (targets.length === 1) session.totalBytes = fileTotal;
        session.receivedBytes = doneBytes + startAt;
        session.status = 'downloading';
        pushDownload(session);

        const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
        let lastPush = 0;
        body.on('data', (chunk: Buffer) => {
          session.receivedBytes += chunk.length;
          const now = Date.now();
          if (now - lastPush >= 250) {
            lastPush = now;
            pushDownload(session);
          }
        });
        await pipeline(body, fs.createWriteStream(partPath, resumed ? { flags: 'a' } : { flags: 'w' }));

        // 스트림이 끝났다는 것은 "다 받았다"가 아니다 — 중간에 끊긴 응답도 정상 종료로 보인다.
        //   여기서 대조하지 않으면 반쪽 GGUF 가 그대로 제자리에 놓여, 목록에는 멀쩡히 뜨고
        //   쓰는 순간에야 이상해진다(§5.19 엔진 내려받기와 같은 계열의 사고).
        //   `.part` 는 남긴다 — 다음 시도가 이어받을 수 있는 자산이지 쓰레기가 아니다.
        const gotBytes = session.receivedBytes - doneBytes;
        if (fileTotal > 0 && gotBytes !== fileTotal) {
          throw new Error(
            `download truncated (${String(gotBytes)}/${String(fileTotal)} bytes on ${name}) — start it again to resume`,
          );
        }

        await fsp.rename(partPath, dest);
        doneBytes += gotBytes;
      }

      session.name = groupName;
      session.receivedBytes = doneBytes;
      if (session.totalBytes === 0) session.totalBytes = doneBytes;
      session.status = 'done';
      pushDownload(session);
      logger.info(
        `[localModel] downloaded ${groupName} (${String(doneBytes)} bytes, ${String(targets.length)} file(s))`,
      );
      // 받았다고 끝이 아니다 — 실제로 말을 하는지 여기서 확인해야 사용자가 프롬프트를 치고
      //   빈 답을 받은 뒤에야 알게 되는 일이 없다(§5.19 (E) "받기 하나가 곧 동작").
      downloadedHook?.(modelId);
    } catch (err) {
      if (session.abort.signal.aborted) {
        session.status = 'canceled';
      } else {
        session.status = 'error';
        session.error = err instanceof Error ? err.message : String(err);
        logger.error(`[localModel] download failed: ${groupName}`, err);
      }
      pushDownload(session);
    }
  })();

  return toProgress(session);
}

/** 내려받기 중단. 받다 만 조각은 남겨 둔다 — 다음에 이어 받으라고. */
export function cancelDownload(downloadId: string): boolean {
  const s = downloads.get(downloadId);
  if (!s) return false;
  if (s.status === 'starting' || s.status === 'downloading') s.abort.abort();
  return true;
}
