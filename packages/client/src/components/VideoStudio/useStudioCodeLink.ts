import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sourceLineOf, sourceTargetsAtLine, type PickedSource, type SourceLine, type SourceTarget, type VideoDoc } from '@vibisual/video';
import type { StageLocated } from '@vibisual/video/render';

import { openWorkspaceFile } from '../IDE/useWorkspaceExplorer.js';
import { createSourceCache, type LoadedSource, type SourceCache } from './codeLinkSource.js';
import type { PreviewRing } from './StudioPreview.js';

/**
 * §5.13 (V) 37-20 — 화면 요소 ↔ 코드 줄(읽기 전용). 고른 줄·보는 파일·그 줄의 화면 자리를 쥔다(창 세션 동안만 — 저장하지 않는다).
 * - 화면 → 코드: 집은 요소의 자리(`pick{src}`)를 원본 색인과 맞춰 줄을 낸다. 못 찾으면 null — 줄을 지어내지 않는다.
 * - 코드 → 화면: 고른 줄의 요소를 무대에 물어 실버 테로 세운다. 재생 중에는 묻지 않는다(물으면 스스로 재생이 멎는다).
 */

/** 줄 찾기가 원본을 기다리는 상한(ms) — 넘으면 줄 없이 가리킨 것만 붙는다(가리키기를 붙잡지 않는다). */
const SOURCE_LINE_WAIT_MS = 1500;

export interface CodeFocus {
  readonly assetId: string;
  /** `pick` = 화면에서 집었다(원본이 바뀌면 그 요소를 다시 찾는다) · `code` = 줄을 눌렀다(번호를 지킨다). */
  readonly origin: 'pick' | 'code';
  readonly line: number;
  readonly endLine: number;
  /** false 면 요소 자신의 줄이 아니라 그것을 런타임에 만든 자리의 줄. */
  readonly exact: boolean;
  readonly picked?: PickedSource;
  /** 같은 줄을 다시 골라도 코드 칸이 그 줄로 다시 간다. */
  readonly seq: number;
}

export type CodeLocateState = 'idle' | 'shown' | 'hidden' | 'notElement';

export interface CodeLinkAsset {
  readonly id: string;
  readonly path: string;
}

export interface StudioCodeLink {
  /** 이 문서의 코드 컴포지션들(없으면 코드 칸이 서지 않는다). */
  readonly assets: readonly CodeLinkAsset[];
  readonly assetId: string | null;
  /** 지금 보는 파일(프로젝트 기준 경로). */
  readonly path: string | null;
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly source: LoadedSource | null;
  /** 지금 보는 파일에 줄 연결이 있는가(그 소재의 HTML). */
  readonly linked: boolean;
  /** 지금 보는 파일에 걸린 고른 줄(다른 파일이면 null). */
  readonly focus: CodeFocus | null;
  readonly locate: { readonly state: CodeLocateState; readonly count: number };
  /** 코드에서 고른 줄의 화면 자리(가리키기와 같은 테). */
  readonly rings: readonly PreviewRing[];
  readonly selectAsset: (assetId: string) => void;
  readonly selectFile: (path: string) => void;
  readonly selectLine: (line: number) => void;
  readonly openInEditor: () => void;
  /**
   * 집은 요소의 원본 줄. `reveal` 이면 코드 칸도 그 줄로 간다. `wait` 가 false 면 원본을 기다리지 않는다 — 읽어 둔 것이 없으면
   * null 을 곧바로 내고 뒤에서 읽어 둔다(Alt 인스펙터 복사가 늦지 않게).
   */
  readonly resolvePick: (assetId: string | undefined, picked: PickedSource | undefined, reveal: boolean, wait?: boolean) => Promise<SourceLine | null>;
  /** '가리킨 것' 칩을 눌렀을 때 — 그 파일의 그 줄로 코드 칸을 연다. */
  readonly revealLine: (file: string, line: number, exact: boolean) => void;
}

function compositionAssets(doc: VideoDoc | null): CodeLinkAsset[] {
  const out: CodeLinkAsset[] = [];
  for (const asset of Object.values(doc?.assets ?? {})) {
    if (asset.kind === 'composition' && asset.source.kind === 'file') out.push({ id: asset.id, path: asset.source.path.replace(/\\/g, '/') });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function withTimeout<T>(pending: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    pending.then((value) => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(null); });
  });
}

const IDLE = { state: 'idle', count: 0, rects: [] } as const;

export function useStudioCodeLink(d: {
  readonly projectName: string;
  readonly projectRoot: string;
  /** 저장된 문서(지문은 저장된 문서에 적힌다). */
  readonly doc: VideoDoc | null;
  /** 코드 칸이 열려 있는가(닫혀 있으면 읽지도 묻지도 않는다 — 집은 요소의 줄 찾기만 한다). */
  readonly open: boolean;
  readonly selectedItemId: string | null;
  readonly playhead: number;
  readonly playing: boolean;
  /** 미리보기의 첫 그림이 섰는가(서기 전에는 물어도 답이 없다). */
  readonly ready: boolean;
  readonly locateSource: (assetId: string, targets: readonly SourceTarget[]) => Promise<StageLocated[] | null>;
  /** 코드 칸을 연다. `force` 가 아니면 다른 서랍을 밀어내지 않는다. */
  readonly onReveal: (force: boolean) => void;
  /** 시험용 — 원본 읽기를 갈아 끼운다. */
  readonly cache?: SourceCache;
}): StudioCodeLink {
  const cache = useMemo(() => d.cache ?? createSourceCache(), [d.cache]);
  const dRef = useRef(d);
  dRef.current = d;
  const docId = d.doc?.id ?? '';
  const assets = useMemo(() => compositionAssets(d.doc), [d.doc]);
  const [view, setView] = useState<{ readonly assetId: string; readonly file: string | null } | null>(null);
  const [focus, setFocus] = useState<CodeFocus | null>(null);
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly status: 'loading' | 'ready' | 'error'; readonly source: LoadedSource | null }>({ key: '', status: 'loading', source: null });
  const [located, setLocated] = useState<{ readonly state: CodeLocateState; readonly count: number; readonly rects: StageLocated['rects'] }>(IDLE);
  const focusSeq = useRef(0);
  const askSeq = useRef(0);

  useEffect(() => { setView(null); setFocus(null); setLocated(IDLE); cache.clear(); }, [docId, cache]);

  // 보는 소재 — 고른 것 → 지금 고른 아이템의 컴포지션 → 첫 컴포지션.
  const selectedAssetId = useMemo(() => {
    if (!d.doc || !d.selectedItemId) return null;
    for (const track of d.doc.tracks) {
      const item = track.items.find((entry) => entry.id === d.selectedItemId);
      if (item) return item.assetId ?? null;
    }
    return null;
  }, [d.doc, d.selectedItemId]);
  const asset = assets.find((a) => a.id === view?.assetId) ?? assets.find((a) => a.id === selectedAssetId) ?? assets[0] ?? null;
  const file = asset && view?.assetId === asset.id ? view.file : null;
  const path = asset ? file ?? asset.path : null;
  const linked = !!asset && path === asset.path;
  const contentHash = asset ? d.doc?.assets[asset.id]?.contentHash ?? '' : '';
  const loadKey = asset ? [d.projectName, docId, asset.id, file ?? '', contentHash].join('\u0000') : '';

  useEffect(() => {
    if (!d.open || !asset || loadKey === '') return undefined;
    let alive = true;
    // 같은 파일을 다시 읽는 동안에는 보이던 글을 그대로 둔다(깜빡이지 않게).
    setLoaded((prev) => (prev.key === loadKey ? prev : { key: loadKey, status: 'loading', source: prev.source && prev.source.path === path ? prev.source : null }));
    cache.load(d.projectName, docId, asset.id, file, contentHash).then(
      (source) => { if (alive) setLoaded({ key: loadKey, status: 'ready', source }); },
      () => { if (alive) setLoaded({ key: loadKey, status: 'error', source: null }); },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.open, loadKey, cache]);

  const source = d.open && asset && loaded.source && loaded.source.path === path ? loaded.source : null;
  const index = linked ? source?.index ?? null : null;
  const viewFocus = focus && asset && focus.assetId === asset.id && linked ? focus : null;

  // 원본이 바뀌면: 집어서 고른 줄은 그 요소를 다시 찾고(못 찾으면 번호를 지킨다), 줄 수를 넘는 번호는 끝줄로.
  useEffect(() => {
    if (!index) return;
    setFocus((cur) => {
      if (!cur || !asset || cur.assetId !== asset.id) return cur;
      const again = cur.origin === 'pick' && cur.picked ? sourceLineOf(index, cur.picked) : null;
      const line = Math.min(again?.line ?? cur.line, index.lineCount);
      const endLine = Math.min(Math.max(line, again?.endLine ?? cur.endLine), index.lineCount);
      const exact = again ? again.exact : cur.exact;
      return line === cur.line && endLine === cur.endLine && exact === cur.exact ? cur : { ...cur, line, endLine, exact };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // 코드 → 화면: 눌러 고른 줄의 요소가 지금 그림에서 어디인가.
  const codeLine = viewFocus && viewFocus.origin === 'code' ? viewFocus.line : 0;
  const assetId = asset?.id ?? '';
  const { playhead, playing, ready, locateSource } = d;
  useEffect(() => {
    const seq = (askSeq.current += 1);
    if (!index || codeLine <= 0 || assetId === '') { setLocated(IDLE); return; }
    const at = sourceTargetsAtLine(index, codeLine);
    if (at.kind === 'none') { setLocated({ state: 'notElement', count: 0, rects: [] }); return; }
    // 재생 중에는 테를 걷고 묻지 않는다(그 시각의 자리가 아니게 되고, 물으면 스스로 재생이 멎는다).
    if (playing || !ready) { setLocated(IDLE); return; }
    void locateSource(assetId, at.targets).then((found) => {
      if (seq !== askSeq.current) return;
      const rects = (found ?? []).flatMap((entry) => entry.rects);
      setLocated(rects.length > 0 ? { state: 'shown', count: rects.length, rects } : { state: 'hidden', count: 0, rects: [] });
    }, () => { if (seq === askSeq.current) setLocated({ state: 'hidden', count: 0, rects: [] }); });
  }, [index, codeLine, assetId, playhead, playing, ready, locateSource]);

  const nextSeq = (): number => (focusSeq.current += 1);

  const selectAsset = useCallback((id: string): void => { setView({ assetId: id, file: null }); }, []);
  const selectFile = useCallback((next: string): void => {
    if (!asset) return;
    setView({ assetId: asset.id, file: next === asset.path ? null : next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id, asset?.path]);

  const selectLine = useCallback((line: number): void => {
    if (!asset || !index || line < 1 || line > index.lineCount) return;
    const at = sourceTargetsAtLine(index, line);
    setFocus({ assetId: asset.id, origin: 'code', line, endLine: at.kind === 'none' ? line : Math.max(line, at.endLine), exact: true, seq: nextSeq() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id, index]);

  const openInEditor = useCallback((): void => {
    if (!path) return;
    openWorkspaceFile(dRef.current.projectRoot, path, viewFocus?.line);
  }, [path, viewFocus?.line]);

  const resolvePick = useCallback(async (pickedAssetId: string | undefined, picked: PickedSource | undefined, reveal: boolean, wait = true): Promise<SourceLine | null> => {
    const cur = dRef.current;
    const target = pickedAssetId ? cur.doc?.assets[pickedAssetId] : undefined;
    if (!cur.doc || !picked || !target || target.kind !== 'composition' || target.source.kind !== 'file') return null;
    const key = [cur.projectName, cur.doc.id, target.id, null, target.contentHash ?? ''] as const;
    let loadedSource: LoadedSource | null;
    if (wait) loadedSource = await withTimeout(cache.load(...key), SOURCE_LINE_WAIT_MS);
    else {
      loadedSource = cache.peek(...key);
      if (!loadedSource) cache.load(...key).catch(() => undefined);
    }
    const found = loadedSource?.index ? sourceLineOf(loadedSource.index, picked) : null;
    if (!found) return null;
    if (reveal) {
      setView({ assetId: target.id, file: null });
      setFocus({ assetId: target.id, origin: 'pick', line: found.line, endLine: found.endLine, exact: found.exact, picked, seq: nextSeq() });
      cur.onReveal(false);
    }
    return found;
  }, [cache]);

  const revealLine = useCallback((target: string, line: number, exact: boolean): void => {
    const key = target.replace(/\\/g, '/');
    const owner = compositionAssets(dRef.current.doc).find((a) => a.path === key);
    if (!owner) return;
    setView({ assetId: owner.id, file: null });
    setFocus({ assetId: owner.id, origin: 'pick', line, endLine: line, exact, seq: nextSeq() });
    dRef.current.onReveal(true);
  }, []);

  const rings = useMemo<readonly PreviewRing[]>(
    () => (d.open ? located.rects.map((rect, i) => ({ id: `code-${i}`, rect, tone: 'pointed' as const })) : []),
    [d.open, located.rects],
  );

  return {
    assets,
    assetId: asset?.id ?? null,
    path,
    status: !d.open || !asset ? 'idle' : loaded.key === loadKey ? loaded.status : 'loading',
    source,
    linked,
    focus: viewFocus,
    locate: { state: d.open ? located.state : 'idle', count: located.count },
    rings,
    selectAsset, selectFile, selectLine, openInEditor, resolvePick, revealLine,
  };
}
