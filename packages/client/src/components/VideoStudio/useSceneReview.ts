import { useCallback, useEffect, useRef, useState } from 'react';
import { sceneRestoreOps, sceneSignature, type PatchFix, type VideoDoc } from '@vibisual/video';

import { checkPatch, decideScene, readSceneFilePlan, restoreScene, type SceneFilePlan } from './studioApi.js';
import type { PassChange } from './usePassChange.js';
import { readDoc, VersionConflictError } from './videoApi.js';

/**
 * §5.13 (V) 37-23 — 장면 단위 받기·되돌리기의 화면 상태. 되돌리기는 두 번 누른다: 먼저 쓰지 않는 검사(`patch/check` + 파일 계획)를
 * 확인 띠로 보이고, 한 번 더 누르면 서버가 연산을 다시 계산해 적용한다. 판본이 어긋나면(409) 덮어쓰지 않고 문서를 다시 읽는다.
 */
export interface SceneConfirm {
  readonly chapterId: string;
  readonly phase: 'checking' | 'ready' | 'applying';
  /** 되돌리기를 막는 첫 오류의 영문 이유(`fix[].hint`). */
  readonly blocked: string | null;
  readonly warnings: number;
  readonly plan: SceneFilePlan | null;
  /** 시작 판과 이 장면이 같아 되돌릴 것이 없다. */
  readonly nothing: boolean;
}

export interface SceneReview {
  readonly confirm: SceneConfirm | null;
  readonly busy: string | null;
  readonly keep: (chapterId: string) => void;
  readonly reopen: (chapterId: string) => void;
  readonly askRestore: (chapterId: string) => void;
  readonly confirmRestore: () => void;
  readonly cancel: () => void;
}

export interface SceneReviewDeps {
  readonly project: string;
  readonly doc: VideoDoc | null;
  readonly passChange: PassChange;
  readonly setDoc: (doc: VideoDoc) => void;
  readonly refreshHistory: () => void;
  readonly onError: (err: unknown) => void;
  readonly onInfo: (key: string, values?: Readonly<Record<string, string | number>>) => void;
  readonly onSuccess: (key: string, values?: Readonly<Record<string, string | number>>) => void;
}

/** 검사 결과 → 확인 띠 값. 오류가 하나라도 있으면 되돌리기를 막는다. */
export function confirmOf(chapterId: string, fix: readonly PatchFix[], plan: SceneFilePlan | null, opsCount: number): SceneConfirm {
  const firstError = fix.find((f) => f.level === 'error');
  return {
    chapterId, phase: 'ready',
    blocked: firstError ? firstError.hint : null,
    warnings: fix.filter((f) => f.level === 'warn').length,
    plan,
    nothing: opsCount === 0 && (plan?.changed ?? 0) === 0,
  };
}

export function useSceneReview(d: SceneReviewDeps): SceneReview {
  const [confirm, setConfirm] = useState<SceneConfirm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const latest = useRef(d);
  latest.current = d;
  const passId = d.passChange.pass?.id ?? null;
  const startRev = d.passChange.pass?.startRev ?? null;

  // 바퀴가 바뀌거나 문서 판본이 오르면 검사 결과는 낡았다 — 확인 띠를 걷는다(적용 중이면 그대로 둔다).
  const version = d.doc?.version ?? -1;
  useEffect(() => { setConfirm((c) => (c && c.phase !== 'applying' ? null : c)); }, [passId, version]);

  const reload = useCallback(async (): Promise<void> => {
    const { project, doc, setDoc, onInfo, onError } = latest.current;
    if (!doc) return;
    try { setDoc((await readDoc(project, doc.id)).doc); onInfo('panel.videoStudio.reloaded'); }
    catch (err) { onError(err); }
  }, []);

  const decide = useCallback((chapterId: string, decision: 'keep' | 'reopen'): void => {
    const { project, doc, passChange, refreshHistory, onError } = latest.current;
    const pass = passChange.pass;
    if (!doc || !pass) return;
    setBusy(chapterId);
    const signature = decision === 'keep' ? sceneSignature(doc, chapterId) : undefined;
    decideScene(project, doc.id, pass.id, chapterId, decision, signature)
      .then(() => refreshHistory())
      .catch((err: unknown) => (err instanceof VersionConflictError ? reload() : onError(err)))
      .finally(() => setBusy(null));
  }, [reload]);

  const askRestore = useCallback((chapterId: string): void => {
    const { project, doc, passChange, onError } = latest.current;
    const start = passChange.start;
    const revId = passChange.pass?.startRev;
    if (!doc || !start || !revId) return;
    const ops = sceneRestoreOps(doc, start, chapterId);
    setConfirm({ chapterId, phase: 'checking', blocked: null, warnings: 0, plan: null, nothing: false });
    const check = ops.length > 0 ? checkPatch(project, doc.id, doc.version, ops) : Promise.resolve({ ok: true, conflict: false, fix: [] as PatchFix[] });
    Promise.all([check, readSceneFilePlan(project, doc.id, revId, chapterId).catch(() => null)])
      .then(([result, plan]) => {
        if (result.conflict) { setConfirm(null); void reload(); return; }
        setConfirm((c) => (c?.chapterId === chapterId ? confirmOf(chapterId, result.fix, plan, ops.length) : c));
      })
      .catch((err: unknown) => { setConfirm(null); onError(err); });
  }, [reload]);

  const confirmRestore = useCallback((): void => {
    const c = confirm;
    const { project, doc, passChange, setDoc, refreshHistory, onError, onSuccess } = latest.current;
    const revId = passChange.pass?.startRev;
    if (!c || c.phase !== 'ready' || c.blocked || !doc || !revId) return;
    setConfirm({ ...c, phase: 'applying' });
    restoreScene(project, doc.id, revId, c.chapterId, doc.version)
      .then((result) => {
        setDoc(result.doc);
        refreshHistory();
        onSuccess(result.filesRestored > 0 ? 'panel.videoStudio.sceneReview.restoredFiles' : 'panel.videoStudio.sceneReview.restored', { count: result.filesRestored });
        setConfirm(null);
      })
      .catch((err: unknown) => {
        setConfirm(null);
        if (err instanceof VersionConflictError) void reload();
        else onError(err);
      });
  }, [confirm, reload]);

  return {
    confirm, busy,
    keep: useCallback((id: string) => decide(id, 'keep'), [decide]),
    reopen: useCallback((id: string) => decide(id, 'reopen'), [decide]),
    askRestore: startRev ? askRestore : () => undefined,
    confirmRestore,
    cancel: useCallback(() => setConfirm((c) => (c?.phase === 'applying' ? c : null)), []),
  };
}
