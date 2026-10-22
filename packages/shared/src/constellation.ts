/**
 * §5.1 #2-1 (B) — **작업물 별자리** 판정(순수). 같이 쓰이는 파일끼리 한 중심을 돌게 묶는다.
 *
 * **위성을 거느리는 중심은 앱 노드뿐이다**(호출부가 그 노드가 선언한 파일을 넘긴다). 미디어 파일(영상 > 3D > 소리 > 사진)도 아래
 * 판정에서는 중심 노릇을 하지만, 그것은 **앱 노드로 이어지는 사슬**(앱이 가져간 영상의 같은 이름 json 이 그 앱을 돈다)을 위한
 * 것이다 — 최종 중심이 파일이면 위성으로 세우지 않는다. 2026-10-21 사용자 지시 *"사진 묶음인데 … 사진만 있는게 아니라 다른
 * 파일들도 같이 있는게 문제야 … 사진 제외한 다른 앱들표현도 마찬가지"* — 파일 중심 별자리는 다른 종류(md·json·코드)를 그
 * 묶음에 넣었다. 같은 종류끼리의 묶음은 `kindBundle.ts`(`planKindBundles`)가 맡는다.
 * 근거와 세기는 `CONSTELLATION.score` 가 정본이고, 이 함수는 그 표를 그대로 적용할 뿐이다:
 *
 *   앱 선언(결과 · 소재 · 코드 소재의 폴더) > 내용 언급 > 같은 이름 > 언급 사슬 > 이름 갈래 > 같은 폴더
 *
 * 규율 셋:
 * - **코드는 같은 폴더만으로 묶지 않는다** — 같은 폴더가 근거가 되는 것은 곁 파일(데이터·문서·자막·글꼴)과 재료
 *   미디어뿐이다(`src/` 의 로고 하나가 컴포넌트 전부를 삼키지 않게).
 * - **재료는 순위가 높은 중심으로만** 간다(사진·소리·3D → 영상, 사진 → 3D). 중심이 다른 중심의 재료가 되면 그
 *   위성도 함께 간다 — 결과는 언제나 **깊이 1**(위성의 위성의 위성 ❌).
 * - **한 파일은 한 중심만** — "이 파일이 그 중심의 일부"인 근거(중심이 이 파일을 적고 있다 · 같은 이름)가 먼저, 그다음은
 *   더 큰 작업물(높은 순위) → 점수 → 최근 → id 순(`belongsTier`). 같은 입력은 언제나 같은 그림이다.
 *
 * **사진이 사진의 부모가 되지 않는다** — 같은 폴더의 사진을 가장 최근 사진 둘레에 모으던 사진 묶음(`album`)은 걷었다
 * (2026-10-21 사용자 보고 "폴더가 아닌 png 가 부모"). 근거가 "같은 폴더" 하나뿐이라 폴더 버블이 이미 말하는 관계를 가로채, 폴더
 * 대신 사진이 부모가 됐다. 사진은 사진의 재료도 아니라(`canJoin`) 어떤 근거로도 사진이 사진을 돌지 않는다 — 되살리지 마라.
 * (하위 폴더에서 올라온 같은 종류 위성은 파일이 아니라 묶음 버블이 모은다 — `kindBundle.ts`.)
 *
 * 경로 비교는 `pathKey`(플랫폼은 인자 — `process.platform` 을 읽지 않는다, 멀티플랫폼 1축). 서버(위성 상한의 "묶음은
 * 자리 하나")와 클라(화면의 위성 배치)가 이 함수 하나를 부른다 — 두 벌이 되면 서버가 남긴 묶음과 화면의 묶음이 갈린다.
 */

import {
  CONSTELLATION,
  CONSTELLATION_HUB_RANK,
  CONSTELLATION_INGREDIENT_OF,
  CONSTELLATION_SIDECAR_KINDS,
} from './constants.js';
import { fileFaceKindOf, fileStemOf, isMediaFaceKind, isMeaningfulStem, stemTokensOf } from './fileFace.js';
import { normalizePathShape, pathKey, type PlatformName } from './pathCase.js';
import type { ConstellationReason, FileFaceKind } from './types.js';

/** 판정할 파일 하나. `path` 는 같은 판정 안에서 한 가지 형식(절대 또는 루트 기준 상대)이면 된다. */
export interface ConstellationFileInput {
  readonly id: string;
  readonly path: string;
  readonly lastActivity?: number | undefined;
  /** 이 파일의 내용이 이름으로 적고 있는 다른 파일의 id(서버 내용 언급 — `BubbleData.mentions`). */
  readonly mentions?: readonly string[] | undefined;
}

/** 앱 노드 중심 하나 — 그 노드가 선언한 파일들(파일 입력과 **같은 경로 형식**으로). */
export interface ConstellationAppHubInput {
  readonly id: string;
  /** 결과·지난 결과. */
  readonly results: readonly string[];
  /** 앱이 선언한 "연결된 것"의 파일(소재). */
  readonly parts: readonly string[];
  /** 코드 소재 — 그 파일의 **폴더째** 한 부품이다(컴포지션의 `index.html` 과 그 css·js). */
  readonly codeParts: readonly string[];
  /**
   * §5.1 #2-1 (F) ④ — 그 앱 노드의 **작업 중에 생긴 파일**(서버 `appWork` 꼬리표). 앱 작업 보기(§5.4 #36 (I))가 켜진
   * 노드만 싣는다 — 확장자를 보지 않고 묶는다(`CONSTELLATION.score.appWork`).
   */
  readonly work?: readonly string[];
}

export interface ConstellationOptions {
  readonly platform: PlatformName;
  /** 한 중심이 거느리는 위성 상한. 기본 `CONSTELLATION.moonMax`. */
  readonly moonMax?: number;
}

/** 중심을 도는 위성 하나. `via` 는 직접 근거가 된 파일(중심이 아닌 재료를 거쳐 왔을 때만). */
export interface ConstellationMoon {
  readonly id: string;
  readonly hub: string;
  readonly reason: ConstellationReason;
  readonly score: number;
  readonly via?: string | undefined;
}

export interface ConstellationPlan {
  /** 위성 id → 그 위성(중심·이유). 중심 자신과 묶이지 않은 파일은 없다. */
  readonly memberOf: ReadonlyMap<string, ConstellationMoon>;
  /** 중심 id(파일 id 또는 앱 노드 id) → 위성들(점수 높은 순 · 상한까지). */
  readonly moonsOf: ReadonlyMap<string, readonly ConstellationMoon[]>;
}

export const EMPTY_CONSTELLATION_PLAN: ConstellationPlan = { memberOf: new Map(), moonsOf: new Map() };

interface FileInfo {
  readonly id: string;
  readonly key: string;
  readonly dirKey: string;
  readonly kind: FileFaceKind;
  readonly stem: string;
  readonly tokens: readonly string[];
  readonly last: number;
  readonly mentions: Set<string>;
  readonly mentionedBy: Set<string>;
}

interface Direct {
  readonly hub: string;
  readonly reason: ConstellationReason;
  readonly score: number;
  readonly via?: string | undefined;
}

function dirOf(shaped: string): string {
  const i = shaped.lastIndexOf('/');
  return i <= 0 ? '' : shaped.slice(0, i);
}

function hubRank(kind: FileFaceKind): number {
  return isMediaFaceKind(kind) ? CONSTELLATION_HUB_RANK[kind] : 0;
}

/** 이 종류가 저 종류의 중심을 돌 수 있는가 — 미디어가 아닌 것은 어느 미디어 중심이든, 미디어는 순위가 높은 쪽으로만. */
function canJoin(member: FileFaceKind, hub: FileFaceKind): boolean {
  if (!isMediaFaceKind(hub)) return false;
  if (!isMediaFaceKind(member)) return true;
  if (member === 'video') return false;
  return (CONSTELLATION_INGREDIENT_OF[member] as readonly string[]).includes(hub);
}

/** 같은 폴더만으로 근거가 되는가 — 곁 파일과 재료 미디어뿐(코드 ❌). */
function folderCounts(member: FileFaceKind, hub: FileFaceKind): boolean {
  if (CONSTELLATION_SIDECAR_KINDS.has(member)) return true;
  return isMediaFaceKind(member) && canJoin(member, hub);
}

function sharesToken(a: readonly string[], b: readonly string[]): boolean {
  for (const t of a) if (b.includes(t)) return true;
  return false;
}

/** 두 파일 사이 가장 센 근거. 없으면 null. */
function relateTo(f: FileInfo, h: FileInfo): { score: number; reason: ConstellationReason } | null {
  const S = CONSTELLATION.score;
  let best: { score: number; reason: ConstellationReason } | null = null;
  const take = (score: number, reason: ConstellationReason): void => {
    // 같은 이름/중심의 언급도 함께 보존한다. 점수만 고르면 자기 결과를 언급한 순간 sameStem 근거가 사라져
    // 다른 최근 영상으로 옮겨 가고, 상호 언급에서는 중심 → 재료 방향의 소속 근거가 지워진다.
    if (best === null || (belongsTier(reason) - belongsTier(best.reason) || score - best.score) > 0) best = { score, reason };
  };
  if (f.mentions.has(h.id)) take(S.mention, 'mention');
  if (h.mentions.has(f.id)) take(S.mention, 'mentioned');
  if (f.stem !== '' && f.stem === h.stem && isMeaningfulStem(f.stem)) take(S.sameStem, 'sameStem');
  if (sharesToken(f.tokens, h.tokens)) take(S.stemFamily, 'stemFamily');
  if (f.dirKey === h.dirKey && folderCounts(f.kind, h.kind)) take(S.sameFolder, 'sameFolder');
  return best;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * **"이 파일이 그 중심의 일부"** 라고 말하는 근거 — 중심이 이 파일을 적고 있거나(모델이 텍스처를 적는다) 이름이 같다.
 * 집을 고를 때 이 근거가 먼저 이기고, 나머지(이 파일이 중심을 적고 있다 · 이름 갈래 · 같은 폴더)끼리는 **더 큰 작업물**
 * (높은 순위)이 이긴다. 그래서 그림을 적고 있는 컴포지션 json 은 그림이 아니라 그 그림으로 만드는 영상을 돌고, 그림은
 * 사슬로 따라온다 — 반대로 모델이 적고 있는 텍스처는 옆 폴더 영상보다 그 모델에 붙는다.
 */
function belongsTier(reason: ConstellationReason): number {
  return reason === 'mentioned' || reason === 'sameStem' ? 1 : 0;
}

/**
 * 파일들을 앱 노드 별자리로 묶는다. 앱 노드 중심이 없으면(`appHubs` 가 빈 배열 — 폴더 안 화면) 묶을 중심이 없어 빈 판정이다.
 */
export function planConstellations(
  files: readonly ConstellationFileInput[],
  appHubs: readonly ConstellationAppHubInput[],
  opts: ConstellationOptions,
): ConstellationPlan {
  // 위성을 거느리는 중심은 앱 노드뿐이다(머리 주석) — 앱 노드가 없으면 판정할 것이 없다.
  if (files.length === 0 || appHubs.length === 0) return EMPTY_CONSTELLATION_PLAN;
  const appHubIds = new Set(appHubs.map((a) => a.id));
  const S = CONSTELLATION.score;
  const moonMax = Math.max(0, opts.moonMax ?? CONSTELLATION.moonMax);
  const keyOf = (p: string): string => pathKey(normalizePathShape(p), opts.platform);
  const dirKeyOf = (p: string): string => pathKey(dirOf(normalizePathShape(p)), opts.platform);

  // 1) 판정 비용이 파일 수의 제곱으로 자라지 않게 — 넘치면 최근 것만 본다.
  const pool = files.length > CONSTELLATION.planMaxFiles
    ? [...files].sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0) || compareIds(a.id, b.id)).slice(0, CONSTELLATION.planMaxFiles)
    : files;

  const infos: FileInfo[] = [];
  const byId = new Map<string, FileInfo>();
  for (const f of pool) {
    if (f.id === '' || f.path === '' || byId.has(f.id)) continue;
    const shaped = normalizePathShape(f.path);
    const info: FileInfo = {
      id: f.id,
      key: pathKey(shaped, opts.platform),
      dirKey: pathKey(dirOf(shaped), opts.platform),
      kind: fileFaceKindOf(shaped),
      stem: fileStemOf(shaped),
      tokens: stemTokensOf(shaped),
      last: f.lastActivity ?? 0,
      mentions: new Set(),
      mentionedBy: new Set(),
    };
    infos.push(info);
    byId.set(f.id, info);
  }
  for (const f of pool) {
    const info = byId.get(f.id);
    if (!info) continue;
    for (const m of f.mentions ?? []) {
      const target = byId.get(m);
      if (!target || m === f.id) continue;
      info.mentions.add(m);
      target.mentionedBy.add(f.id);
    }
  }

  const direct = new Map<string, Direct>();

  // 2) 앱 선언 — 결과 · 작업물 · 소재 · 코드 소재의 폴더. 가장 센 근거라 다른 판정보다 먼저 자리를 잡는다.
  if (appHubs.length > 0) {
    const claims = appHubs.map((a) => ({
      id: a.id,
      results: new Set(a.results.map(keyOf)),
      work: new Set((a.work ?? []).map(keyOf)),
      parts: new Set([...a.parts, ...a.codeParts].map(keyOf)),
      codeDirs: new Set(a.codeParts.map(dirKeyOf).filter((d) => d !== '')),
    }));
    for (const info of infos) {
      let best: Direct | null = null;
      for (const c of claims) {
        const score = c.results.has(info.key)
          ? S.appResult
          : c.work.has(info.key)
            ? S.appWork
            : c.parts.has(info.key)
              ? S.appPart
              : c.codeDirs.has(info.dirKey)
                ? S.appPartFolder
                : 0;
        if (score > 0 && (best === null || score > best.score)) {
          const reason: ConstellationReason = score === S.appResult ? 'appResult' : score === S.appWork ? 'appWork' : 'appPart';
          best = { hub: c.id, reason, score };
        }
      }
      if (best) direct.set(info.id, best);
    }
  }

  // 3) 미디어 중심 — 언급 · 이름 · 갈래 · 폴더. 앱이 가져간 미디어도 중심으로 남는다(그 위성은 6) 에서 앱으로 펴진다).
  const hubs = infos.filter((i) => isMediaFaceKind(i.kind));
  for (const info of infos) {
    if (direct.has(info.id)) continue;
    let best: { d: Direct; hub: FileInfo } | null = null;
    for (const h of hubs) {
      if (h.id === info.id || !canJoin(info.kind, h.kind)) continue;
      const r = relateTo(info, h);
      if (r === null || r.score < CONSTELLATION.minScore) continue;
      // 집 고르기: "일부" 근거 → 더 큰 작업물(순위) → 점수 → 최근 → id (`belongsTier` 주석).
      const cmp = best === null
        ? 1
        : (belongsTier(r.reason) - belongsTier(best.d.reason))
          || (hubRank(h.kind) - hubRank(best.hub.kind))
          || (r.score - best.d.score)
          || (h.last - best.hub.last)
          || -compareIds(h.id, best.hub.id);
      if (cmp > 0) best = { d: { hub: h.id, reason: r.reason, score: r.score }, hub: h };
    }
    if (best) direct.set(info.id, best.d);
  }

  /** 중심을 끝까지 따라간다(재료가 된 중심은 더 큰 중심으로 펴진다). 순환은 생기지 않지만 지킨다. */
  const rootOf = (id: string): string => {
    let cur = id;
    const seen = new Set<string>([id]);
    for (;;) {
      const d = direct.get(cur);
      if (!d || seen.has(d.hub)) return cur;
      seen.add(d.hub);
      cur = d.hub;
    }
  };

  // 4) 언급 사슬 — 묶인 재료가 적고 있는(또는 그 재료를 적고 있는) 파일은 그 별자리로.
  for (const info of infos) {
    if (direct.has(info.id)) continue;
    let best: { hub: string; via: string; viaScore: number } | null = null;
    for (const m of [...info.mentions, ...info.mentionedBy]) {
      const d = direct.get(m);
      if (!d || d.reason === 'chain') continue;
      const root = rootOf(m);
      if (root === info.id) continue;
      const rootInfo = byId.get(root);
      // 파일 중심이면 그 종류를 돌 수 있어야 한다. 앱 노드 중심이면 그 노드의 작업물이다 — 무엇이든 받는다.
      if (rootInfo !== undefined && !canJoin(info.kind, rootInfo.kind)) continue;
      if (best === null || d.score > best.viaScore || (d.score === best.viaScore && compareIds(m, best.via) < 0)) {
        best = { hub: root, via: m, viaScore: d.score };
      }
    }
    if (best) direct.set(info.id, { hub: best.hub, reason: 'chain', score: S.chain, via: best.via });
  }

  // (사진 묶음은 없다 — 사진은 사진의 부모가 되지 않는다. 머리 주석 "사진이 사진의 부모가 되지 않는다".)

  // 5) 펴기 + 상한 — 위성은 모두 최종 중심을 직접 돈다(깊이 1). 점수 → 최근 → id 순으로 상한까지.
  //    최종 중심이 파일이면 세우지 않는다 — 파일은 다른 종류를 거느리지 않는다(머리 주석 · 2026-10-21 사용자 지시).
  const moonsByHub = new Map<string, ConstellationMoon[]>();
  for (const info of infos) {
    const d = direct.get(info.id);
    if (!d) continue;
    const hub = rootOf(info.id);
    if (hub === info.id || !appHubIds.has(hub)) continue;
    const via = d.via ?? (d.hub !== hub ? d.hub : undefined);
    const moon: ConstellationMoon = via === undefined
      ? { id: info.id, hub, reason: d.reason, score: d.score }
      : { id: info.id, hub, reason: d.reason, score: d.score, via };
    const list = moonsByHub.get(hub);
    if (list) list.push(moon);
    else moonsByHub.set(hub, [moon]);
  }

  const lastOf = (id: string): number => byId.get(id)?.last ?? 0;
  const memberOf = new Map<string, ConstellationMoon>();
  const moonsOf = new Map<string, readonly ConstellationMoon[]>();
  for (const [hub, list] of moonsByHub) {
    list.sort((a, b) => b.score - a.score || lastOf(b.id) - lastOf(a.id) || compareIds(a.id, b.id));
    const kept = list.slice(0, moonMax);
    if (kept.length === 0) continue;
    moonsOf.set(hub, kept);
    for (const moon of kept) memberOf.set(moon.id, moon);
  }
  return { memberOf, moonsOf };
}
