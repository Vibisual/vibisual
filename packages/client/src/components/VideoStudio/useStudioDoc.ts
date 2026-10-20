import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  FILE_DOC_ASSET_ID,
  assetsNeedingMeasurement,
  buildFileDocOps,
  buildMeasurementOps,
  diffDoc,
  diffTargets,
  isUntouchedDoc,
  stableHash,
  summarizeDiff,
  type DiffLine,
  type DocActivity,
  type VideoDoc,
  type VideoDocOp,
} from '@vibisual/video';

import { measureAssets } from './useVideoRenderer.js';
import { createDoc, listDocs, patchDoc, readDoc, readDocVersion, type DocSummary } from './videoApi.js';
import { STUDIO_APP_ID } from './studioAppId.js';
import { onAppEvent } from '../../apps/appEvents.js';
import { GLOW_ONCE_MS } from './studioMotion.js';

/**
 * §5.13 (V) 37-1·37-3 — 스튜디오의 **문서**: 목록 · 열기 · 새로 만들기 · 파일을 눌러 연 창 · 저절로 다시 읽기.
 *
 * 다시 읽을 때 옛 문서와 새 문서를 견준다(`diffDoc` — 순수). 바뀐 장면·아이템은 화면에서 **한 번** 빛나고(`glow`), 사람이 읽는
 * 줄(`lastChange.lines`)은 AI 패널의 "이번에 바뀐 것" 카드가 그린다. 판본 응답에 실린 **지금 하는 일**(`activity` — 바퀴·만지는
 * 장면)도 여기서 받는다. 종전 셸(`VideoStudioShell`)이 들던 문서 수명은 그대로 옮겼다(측정값 채우기·파일 문서·열기 순번).
 */

/**
 * 에이전트가 고친 것을 알아채려고 문서 판본을 묻는 간격(ms). 판본만 묻는 가벼운 요청이다. §5.13 (Y) 40-7 ② — 주 신호는 서버의 앱
 * 알림(판이 올랐다·지금 하는 일이 바뀌었다 — 받는 즉시 묻는다)이고, 이 간격은 소켓이 끊겼을 때의 안전망이다(종전 2초).
 */
const DOC_POLL_MS = 10_000;

export interface StudioChange {
  readonly before: VideoDoc;
  readonly after: VideoDoc;
  readonly lines: readonly DiffLine[];
  readonly at: number;
}

export interface StudioGlow {
  readonly chapters: ReadonlySet<string>;
  readonly items: ReadonlySet<string>;
}

const NO_GLOW: StudioGlow = { chapters: new Set(), items: new Set() };

/**
 * §5.13 (Y) 40-10 ③ — 창 안 문서 기억(영속 ❌ — 창이 사는 동안만). 다시 열 때 지난번 상태로 **먼저 그리고** 뒤에서 새로 읽는다
 * (새로 읽은 판이 같으면 바꾸지 않는다 — 화면 전체가 같은 값으로 다시 그려지지 않게).
 */
const DOC_MEMORY_MAX = 8;
const docMemory = new Map<string, VideoDoc>();

function docMemoryKey(project: string, docId: string): string {
  return `${project}\u0000${docId}`;
}

function rememberDoc(project: string, doc: VideoDoc): void {
  const key = docMemoryKey(project, doc.id);
  docMemory.delete(key);
  docMemory.set(key, doc);
  while (docMemory.size > DOC_MEMORY_MAX) docMemory.delete(docMemory.keys().next().value as string);
}

/** 시험 전용 — 기억을 비운다. */
export function __clearStudioDocMemoryForTest(): void {
  docMemory.clear();
}

export interface StudioDoc {
  readonly docs: readonly DocSummary[];
  readonly doc: VideoDoc | null;
  readonly setDoc: (doc: VideoDoc) => void;
  readonly openDoc: (docId: string) => Promise<void>;
  readonly closeDoc: () => void;
  readonly createDoc: (title: string, setup?: readonly VideoDocOp[]) => Promise<VideoDoc | null>;
  readonly refreshDocs: () => Promise<void>;
  readonly activity: DocActivity | null;
  readonly lastChange: StudioChange | null;
  readonly glow: StudioGlow;
  /** 판본을 묻다가 바뀐 문서를 받았을 때(에이전트가 고쳤다) — 판 기록 목록 등이 따라 새로 읽는다. */
  readonly reloadTick: number;
  readonly pendingWork: MutableRefObject<number>;
  readonly openSequence: MutableRefObject<number>;
}

export function useStudioDoc(opts: {
  projectName: string;
  docParam: string;
  fileParam: string;
  onError: (err: unknown) => void;
  onFileUnreadable: (name: string) => void;
  /** 다른 문서로 갈아탈 때(되돌리기 이력·선택을 비운다). */
  onSwitch: () => void;
  /**
   * §5.13 (X) 39-8 — 화면이 숨었다(다른 탭으로 가려진 앱 안 창·최소화된 창). 그동안 판본을 묻지 않고, 돌아오면 간격을 기다리지
   * 않고 한 번 묻는다. 종전에는 숨은 스튜디오도 2초마다 계속 물었다.
   */
  paused?: boolean;
}): StudioDoc {
  const { projectName, docParam, fileParam, onError, onFileUnreadable, onSwitch } = opts;
  const paused = opts.paused === true;
  const pausedBefore = useRef(false);
  const [docs, setDocs] = useState<readonly DocSummary[]>([]);
  const [doc, setDocState] = useState<VideoDoc | null>(null);
  const [activity, setActivity] = useState<DocActivity | null>(null);
  const [lastChange, setLastChange] = useState<StudioChange | null>(null);
  const [glow, setGlow] = useState<StudioGlow>(NO_GLOW);
  const [reloadTick, setReloadTick] = useState(0);
  const pendingWork = useRef(0);
  const openSequence = useRef(0);
  const docRef = useRef(doc);
  docRef.current = doc;
  const cb = useRef({ onError, onFileUnreadable, onSwitch });
  cb.current = { onError, onFileUnreadable, onSwitch };
  const glowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (glowTimer.current) clearTimeout(glowTimer.current); }, []);

  const setDoc = useCallback((next: VideoDoc): void => setDocState(next), []);
  useEffect(() => { if (doc && projectName) rememberDoc(projectName, doc); }, [doc, projectName]);

  const refreshDocs = useCallback(async (): Promise<void> => {
    try {
      // `_` 로 시작하는 문서는 앱이 쓰는 숨은 문서(부품 미리보기 등)다 — 목록에 보이지 않는다.
      setDocs((await listDocs(projectName)).filter((d) => !d.id.startsWith('_')));
    } catch (err) {
      cb.current.onError(err);
    }
  }, [projectName]);

  /** 길이가 비어 있는 영상·소리 소재를 재서 문서에 적는다(§5.13 (R-3)) — 못 재면 원래 문서 그대로. */
  const fillMeasurements = useCallback(async (current: VideoDoc): Promise<VideoDoc> => {
    const pending = assetsNeedingMeasurement(current);
    if (pending.length === 0) return current;
    const ops = buildMeasurementOps(current, await measureAssets(projectName, pending));
    if (ops.length === 0) return current;
    try {
      return (await patchDoc(projectName, current.id, current.version, ops)).doc;
    } catch {
      return current;
    }
  }, [projectName]);

  const openDoc = useCallback(async (docId: string): Promise<void> => {
    const sequence = ++openSequence.current;
    cb.current.onSwitch();
    pendingWork.current += 1;
    // 40-10 ③ — 지난번 상태로 먼저 그린다(뒤에서 새로 읽는다).
    const remembered = docMemory.get(docMemoryKey(projectName, docId));
    if (remembered) { setDocState(remembered); setLastChange(null); setGlow(NO_GLOW); }
    try {
      const env = await readDoc(projectName, docId);
      const next = await fillMeasurements(env.doc);
      if (sequence !== openSequence.current) return;
      if (!remembered || remembered.version !== next.version || remembered.updatedAt !== next.updatedAt) setDocState(next);
      setLastChange(null);
      setGlow(NO_GLOW);
    } catch (err) {
      if (sequence === openSequence.current) cb.current.onError(err);
    } finally { pendingWork.current -= 1; }
  }, [projectName, fillMeasurements]);

  const closeDoc = useCallback((): void => {
    openSequence.current += 1;
    cb.current.onSwitch();
    setDocState(null);
    setLastChange(null);
    setActivity(null);
  }, []);

  /** 새 문서 — `setup` 연산(판형·스타일 등)을 곧바로 한 번에 적는다. */
  const create = useCallback(async (title: string, setup: readonly VideoDocOp[] = []): Promise<VideoDoc | null> => {
    const sequence = ++openSequence.current;
    cb.current.onSwitch();
    pendingWork.current += 1;
    try {
      let created = await createDoc(projectName, title);
      if (setup.length > 0) created = (await patchDoc(projectName, created.id, created.version, setup)).doc;
      void refreshDocs();
      if (sequence === openSequence.current) { setDocState(created); setLastChange(null); }
      return created;
    } catch (err) {
      if (sequence === openSequence.current) cb.current.onError(err);
      return null;
    } finally { pendingWork.current -= 1; }
  }, [projectName, refreshDocs]);

  useEffect(() => { void refreshDocs(); }, [refreshDocs]);
  useEffect(() => {
    if (docParam && projectName) void openDoc(docParam);
    return () => { openSequence.current += 1; };
  }, [docParam, projectName, openDoc]);

  /** §5.13 (R-3) — 파일을 눌러 열린 창: 그 영상을 담은 문서(`file-<해시>` 안정 id)로 바로 들어간다. */
  const fileHandledRef = useRef('');
  const file = docParam ? '' : fileParam;
  useEffect(() => {
    if (file === '' || projectName === '' || fileHandledRef.current === file) return;
    fileHandledRef.current = file;
    const sequence = ++openSequence.current;
    pendingWork.current += 1;
    let alive = true;
    void (async () => {
      try {
        const name = file.split('/').pop() ?? file;
        let current = await createDoc(projectName, name, `file-${stableHash(file)}`);
        if (isUntouchedDoc(current)) {
          const measured = await measureAssets(projectName, [{ id: FILE_DOC_ASSET_ID, kind: 'video', source: { kind: 'file', path: file } }]);
          const probe = measured[FILE_DOC_ASSET_ID];
          const ops = probe ? buildFileDocOps(current, { path: file, label: name }, probe) : [];
          if (ops.length === 0) {
            fileHandledRef.current = '';
            if (alive) cb.current.onFileUnreadable(name);
          } else {
            current = (await patchDoc(projectName, current.id, current.version, ops)).doc;
          }
        } else {
          current = await fillMeasurements(current);
        }
        if (!alive || sequence !== openSequence.current) return;
        setDocState(current);
        void refreshDocs();
      } catch (err) {
        if (alive && sequence === openSequence.current) cb.current.onError(err);
      } finally { pendingWork.current -= 1; }
    })();
    return () => { alive = false; };
  }, [file, projectName, refreshDocs, fillMeasurements]);

  /**
   * 에이전트가 고친 것을 **저절로** 다시 읽는다 — 판본만 묻고, 이 창이 고치는 중이면 묻지 않는다(편집을 덮지 않게). 다시 읽으면
   * 옛 문서와 견줘 바뀐 것을 한 번 빛내고 카드 줄을 만든다.
   */
  const docId = doc?.id ?? '';
  useEffect(() => {
    if (paused) { pausedBefore.current = true; return; }
    if (docId === '' || projectName === '') return;
    let active = true;
    let polling = false;
    const poll = async (): Promise<void> => {
      if (polling || pendingWork.current > 0) return;
      polling = true;
      try {
        const version = await readDocVersion(projectName, docId);
        if (!active) return;
        setActivity((prev) => (JSON.stringify(prev) === JSON.stringify(version.activity ?? null) ? prev : version.activity ?? null));
        const current = docRef.current;
        if (!current || current.id !== docId || version.version <= current.version || pendingWork.current > 0) return;
        const fresh = (await readDoc(projectName, docId)).doc;
        if (!active || docRef.current?.id !== docId || pendingWork.current > 0) return;
        const before = docRef.current;
        if (before) {
          const diff = diffDoc(before, fresh);
          if (!diff.empty) {
            setLastChange({ before, after: fresh, lines: summarizeDiff(diff, before, fresh), at: Date.now() });
            setGlow(diffTargets(diff, fresh));
            if (glowTimer.current) clearTimeout(glowTimer.current);
            glowTimer.current = setTimeout(() => setGlow(NO_GLOW), GLOW_ONCE_MS);
          }
        }
        setDocState(fresh);
        setReloadTick((n) => n + 1);
      } catch {
        // 다음 물음이 다시 본다 — 판본 확인 실패로 화면을 막지 않는다.
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => void poll(), DOC_POLL_MS);
    // 40-7 ② — 이 문서의 판이 올랐다·지금 하는 일이 바뀌었다는 알림이 오면 간격을 기다리지 않고 묻는다.
    const offEvent = onAppEvent(STUDIO_APP_ID, (event) => { if (event.key === docId) void poll(); });
    // 숨었다 돌아왔다 — 그 사이 AI 가 고친 것을 간격을 기다리지 않고 바로 본다.
    if (pausedBefore.current) { pausedBefore.current = false; void poll(); }
    return () => { active = false; clearInterval(timer); offEvent(); };
  }, [docId, projectName, paused]);

  return {
    docs, doc, setDoc, openDoc, closeDoc, createDoc: create, refreshDocs, activity, lastChange, glow, reloadTick, pendingWork, openSequence,
  };
}
