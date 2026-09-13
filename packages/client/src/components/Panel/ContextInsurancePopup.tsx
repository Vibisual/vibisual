import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CompactMarker, FilePreimage, ProjectInsuranceLedger, ResurrectableSession } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { ScrollFade } from '../ScrollFade.js';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import {
  INSURANCE_SCOPE_LABEL_KEY,
  INSURANCE_TABS,
  INSURANCE_TAB_LABEL_KEY,
  availableScopeLevels,
  canPreviewPreimage,
  canRestorePreimage,
  filterByScope,
  findInsuranceLedger,
  formatBytes,
  formatInsuranceTime,
  markerCopyState,
  markerOutcomeState,
  markerSubject,
  preimageActionKey,
  preimageFileName,
  preimageRevisions,
  resolveScopeLevel,
  restoreLabelKey,
  resurrectTitle,
  shortSessionId,
  scopeRowCount,
  scopedNotCarriedRows,
  showsVaultSize,
  skipReasonKey,
  type InsuranceScopeLevel,
  type InsuranceSessionScope,
  type InsuranceTab,
} from '../../utils/insuranceView.js';

// SCENARIO.md §5.26 / §7.23 — 컨텍스트 보험 팝업.
//
// 갈피 넷이 한 창에 있다: **압축 이력 · 요약이 안 실은 것 · 파일 사본 · 부활.** 넷을 따로 띄우면
// 사용자가 "압축 때문에 뭘 잃었나"를 알아보려고 창 세 개를 오가게 된다 — 같은 사건의 네 얼굴이다.
//
// 화면은 서버가 접어 준 것을 **그대로** 그린다(§3.1). 여기서 다시 세거나 다시 판정하지 않는다.
// 판정처럼 보이는 것(손잡이를 내줄지·낱말이 무엇인지)은 전부 `utils/insuranceView.ts` 의 순수
// 함수에 있고 시험으로 고정돼 있다.

interface ContextInsurancePopupProps {
  onClose: () => void;
  /**
   * 이 창을 연 버블. **부활한 세션이 앉을 자리**다.
   *
   * 디스크만 훑어 찾은 세션에는 소유 버블 기록이 없다(마커가 남기 전에 죽은 대화라서). 그때
   * 이 값이 없으면 목록은 보이는데 손잡이가 전부 잠긴 창이 된다 — 사용자가 창을 연 그 버블이
   * 곧 그 자리라, 여기서 물려받으면 그 상태가 생기지 않는다.
   */
  agentId: string;
  /**
   * §7.23 범위 축 — **지금 보고 있는 세션의 좌표**. 상태바가 세운 것을 그대로 받는다.
   *
   * 팝업이 여기서 세션을 다시 찾지 않는 이유: 상태바와 팝업이 각자 고르면 같은 화면의 두
   * 칸이 서로 다른 세션을 주어로 삼게 된다(§5.26 (I) 가 상태바에서 이미 겪은 부류의 사고).
   */
  scope: InsuranceSessionScope;
}

/** 전문 원장 응답 — 방송 스냅샷과 달리 부활 후보까지 채워져 온다. */
interface LedgerResponse {
  ok: boolean;
  ledger: ProjectInsuranceLedger | null;
}

function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'mute'; children: React.ReactNode }): React.JSX.Element {
  const cls = tone === 'danger'
    ? 'border-red-500/40 bg-red-500/10 text-red-300'
    : tone === 'warn'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
      : tone === 'ok'
        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
        : 'border-gray-600/60 bg-gray-700/40 text-gray-400';
  return <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[12px] font-semibold ${cls}`}>{children}</span>;
}

export function ContextInsurancePopup({ onClose, agentId, scope }: ContextInsurancePopupProps): React.JSX.Element {
  const { t } = useTranslation();
  const backdrop = useBackdropDismiss(onClose);
  const activeProject = useGraphStore((s) => s.activeProject);
  const snapshotLedgers = useGraphStore((s) => s.contextInsurance);
  const [tab, setTab] = useState<InsuranceTab>('compacts');
  /**
   * §7.23 범위 축 — **이 세션 / 이 에이전트 / 이 프로젝트**.
   *
   * 기본은 **가장 좁은 것**이다. 이 창을 여는 자리가 IDE 상태바의 컨텍스트 칸이라(§5.5),
   * 누른 사람의 질문은 언제나 "지금 이 세션이 뭘 잃었나"로 시작한다 — 프로젝트 전량으로
   * 열면 그 답을 여덟 세션의 줄 사이에서 찾아야 한다(사용자 보고: "다 통합인 것 같다").
   * 넓히고 싶으면 한 번 누르면 되고, 넓힌 쪽은 종전 화면과 정확히 같다.
   */
  const [wantedScope, setWantedScope] = useState<InsuranceScopeLevel>('session');
  /**
   * 전문 원장. 방송 스냅샷은 최근분만 싣고 부활 후보는 아예 안 싣는다(디스크를 훑어야 해서) —
   * 그래서 창을 열 때 한 번 받아 온다. 못 받으면 스냅샷 몫으로 물러선다(빈 창보다 낫다).
   */
  const [full, setFull] = useState<ProjectInsuranceLedger | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ p: FilePreimage; text: string | null } | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (!activeProject) return;
    try {
      const res = await fetch(`/api/insurance/${encodeURIComponent(activeProject)}`);
      if (!res.ok) return;
      const data = await res.json() as LedgerResponse;
      setFull(data.ledger);
    } catch {
      // 못 받아도 스냅샷 몫이 남아 있다 — 이 창은 그것만으로도 세 갈피를 그릴 수 있다.
    }
  }, [activeProject]);

  useEffect(() => { void reload(); }, [reload]);

  const led = full ?? findInsuranceLedger(snapshotLedgers, activeProject);

  /*
   * §7.23 범위 축 — 네 갈피가 **같은 눈금**을 따른다.
   *
   * 갈피마다 주어가 다르면(압축은 세션인데 사본은 프로젝트) 사용자가 지금 무엇을 보고 있는지
   * 갈피를 옮길 때마다 다시 판단해야 한다. 눈금은 창 전체에 하나 — 그 대신 눈금 이름 옆에
   * 각 갈피의 줄 수를 적어, 좁힌 눈금에서 빈 갈피를 봐도 "저쪽엔 있다"를 바로 안다.
   *
   * 고른 눈금은 쓸 수 없으면 한 칸 넓혀 쓴다(세션 탭이 없는 훅 버블에서 `session` → `agent`).
   */
  const scopeLevels = useMemo(() => availableScopeLevels(scope), [scope]);
  const scopeLevel = resolveScopeLevel(wantedScope, scope);

  const markers = useMemo(() => filterByScope(led?.markers, scopeLevel, scope), [led, scopeLevel, scope]);
  const preimages = useMemo(() => filterByScope(led?.preimages, scopeLevel, scope), [led, scopeLevel, scope]);
  const resurrectable: ResurrectableSession[] = useMemo(
    () => filterByScope(led?.resurrectable, scopeLevel, scope),
    [led, scopeLevel, scope],
  );
  const ncRows = useMemo(() => scopedNotCarriedRows(led, scopeLevel, scope), [led, scopeLevel, scope]);
  /** 같은 파일의 몇 번째 판인가 — 보이는 목록 기준으로 센다(눈금을 좁히면 번호도 그 안에서 다시 매겨진다). */
  const revisions = useMemo(() => preimageRevisions(preimages), [preimages]);

  const restore = useCallback(async (p: FilePreimage): Promise<void> => {
    if (!activeProject) return;
    setBusyId(p.id);
    try {
      await fetch('/api/insurance/restore-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: activeProject, id: p.id }),
      });
      await reload();
    } catch {
      // 실패는 조용히 넘긴다 — 다음 스냅샷이 사실을 다시 말해 준다.
    } finally {
      setBusyId(null);
    }
  }, [activeProject, reload]);

  const openPreview = useCallback(async (p: FilePreimage): Promise<void> => {
    if (!activeProject) return;
    setBusyId(p.id);
    try {
      const res = await fetch(`/api/insurance/${encodeURIComponent(activeProject)}/preimage/${encodeURIComponent(p.id)}`);
      if (!res.ok) return;
      const data = await res.json() as { preimage: FilePreimage; text: string | null };
      setPreview({ p: data.preimage, text: data.text });
    } catch {
      // 무시 — 미리보기는 편의다.
    } finally {
      setBusyId(null);
    }
  }, [activeProject]);

  const resurrect = useCallback(async (s: ResurrectableSession, mode: 'resume' | 'fresh'): Promise<void> => {
    // 원장이 소유 버블을 기억하면 그쪽, 아니면 이 창을 연 버블에 앉힌다.
    const owner = s.agentId ?? agentId;
    if (!owner) return;
    setBusyId(s.sessionId);
    try {
      await fetch('/api/insurance/resurrect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: owner, sessionId: s.sessionId, mode }),
      });
      await reload();
    } catch {
      // 무시 — 실패하면 목록이 그대로 남는다.
    } finally {
      setBusyId(null);
    }
  }, [reload, agentId]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" {...backdrop}>
      <div
        className="mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-gray-700 px-4 py-3">
          <svg className="h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <span className="text-sm font-semibold text-gray-100">{t('panel.insurance.title')}</span>
          {/*
            금고 크기는 **프로젝트 눈금에서만** 적는다. 디스크에서 잰 저장고 전체 크기라
            세션 몫으로 쪼갤 근거가 없고(blob 은 내용 해시로 여러 세션이 공유한다), 좁힌
            칸에 프로젝트 합계를 적으면 그건 그냥 틀린 숫자다(§5.26 (A)).
          */}
          {led && showsVaultSize(scopeLevel) && (
            <span className="text-[12px] text-gray-500" title={t('panel.insurance.vaultSizeTip')}>
              {t('panel.insurance.vaultSize', { size: formatBytes(led.counts.vaultBytes) })}
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            title={t('panel.insurance.close')}
            aria-label={t('panel.insurance.close')}
            className="rounded p-1 text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/*
          범위 — **이 세션 / 이 에이전트 / 이 프로젝트**. 갈피보다 위에 둔다: 눈금이 먼저 정해져야
          갈피의 줄 수가 뜻을 갖는다("압축 3건"이 누구의 3건인지가 눈금에 달려 있다).
          이름 옆 숫자는 **지금 갈피** 기준이라, 갈피를 옮기면 숫자도 따라 바뀐다 — 좁힌 눈금에서
          빈 목록을 봐도 넓은 쪽에 몇 줄이 있는지 누르기 전에 안다.
        */}
        <div className="flex items-center gap-1 border-b border-gray-700 px-3 py-2">
          <span className="mr-1 text-[12px] text-gray-500">{t('panel.insurance.scopeLabel')}</span>
          {scopeLevels.map((lv) => {
            const count = scopeRowCount(led, tab, lv, scope);
            return (
              <button
                key={lv}
                type="button"
                onClick={() => setWantedScope(lv)}
                title={t(`${INSURANCE_SCOPE_LABEL_KEY[lv]}Tip`)}
                className={`rounded px-2 py-0.5 text-[12px] transition-colors ${
                  scopeLevel === lv
                    ? 'bg-gray-600/70 font-semibold text-gray-100'
                    : 'text-gray-500 hover:bg-white/[0.06] hover:text-gray-300'
                }`}
              >
                {t(INSURANCE_SCOPE_LABEL_KEY[lv])}
                {/* 0 도 적는다 — 숫자가 사라지면 "센 적이 없다"와 "세어 보니 0"이 같아 보인다. */}
                <span className="ml-1 tabular-nums text-gray-500">{count}</span>
              </button>
            );
          })}
        </div>

        {/* 갈피 */}
        <div className="flex gap-1 border-b border-gray-700 px-3 py-2">
          {INSURANCE_TABS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${
                tab === id ? 'bg-blue-600/80 font-semibold text-white' : 'text-gray-400 hover:bg-white/[0.06]'
              }`}
            >
              {t(INSURANCE_TAB_LABEL_KEY[id])}
            </button>
          ))}
        </div>

        <ScrollFade className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-1.5 px-4 py-3">
            {/* ── 압축 이력 ── */}
            {tab === 'compacts' && (markers.length === 0
              ? <ScopedEmpty tab="compacts" emptyKey="panel.insurance.emptyCompacts" led={led} level={scopeLevel} scope={scope} levels={scopeLevels} onWiden={setWantedScope} />
              : markers.map((m) => <CompactRow key={m.id} m={m} />))}

            {/* ── 요약이 안 실은 것 ── */}
            {tab === 'notCarried' && (ncRows.length === 0
              ? <ScopedEmpty tab="notCarried" emptyKey="panel.insurance.emptyNotCarried" led={led} level={scopeLevel} scope={scope} levels={scopeLevels} onWiden={setWantedScope} />
              : ncRows.map((m) => <NotCarriedRow key={m.id} m={m} />))}

            {/* ── 파일 사본 ── */}
            {tab === 'preimages' && (preimages.length === 0
              ? <ScopedEmpty tab="preimages" emptyKey="panel.insurance.emptyPreimages" led={led} level={scopeLevel} scope={scope} levels={scopeLevels} onWiden={setWantedScope} />
              : preimages.map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded border border-gray-700/50 bg-gray-900/40 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-xs text-gray-200">{preimageFileName(p)}</span>
                      {/*
                        같은 파일이 여러 줄일 때 **몇 번째 판인가**. 한 파일을 네 번 고치면
                        `projectgraph.ts` 가 네 줄 서는데 종전에는 시각 말고 구별할 것이 없었다.
                        `1` 이 가장 최근이다(목록이 최신 순).
                      */}
                      {revisions.get(p.id) && (
                        <span className="shrink-0 rounded bg-gray-700/50 px-1 text-[12px] tabular-nums text-gray-400">
                          {t('panel.insurance.revisionOf', {
                            index: revisions.get(p.id)?.index,
                            total: revisions.get(p.id)?.total,
                          })}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[12px] text-gray-500" title={p.path}>{p.path}</span>
                    <span className="text-[12px] text-gray-600">
                      {/* 도구 이름(`Edit`)이 아니라 **무엇을 했나**를 적는다 — 도구 이름은 우리 말이지 사용자 말이 아니다. */}
                      {formatInsuranceTime(p.at)} · {t(preimageActionKey(p))} · {formatBytes(p.size)}
                      {p.restoredAt ? ` · ${t('panel.insurance.restoredAt', { at: formatInsuranceTime(p.restoredAt) })}` : ''}
                    </span>
                  </span>
                  {/* 못 뜬 이유는 **반드시 적는다** — 조용히 건너뛴 줄이 있으면 목록 전체가 못 믿을 것이 된다. */}
                  {p.skipped && <Chip tone="mute">{t(skipReasonKey(p) ?? '')}</Chip>}
                  {canPreviewPreimage(p) && (
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      onClick={() => { void openPreview(p); }}
                      className="shrink-0 rounded border border-gray-700 px-2 py-0.5 text-[12px] text-gray-300 disabled:opacity-40 hover:bg-white/[0.06]"
                    >
                      {t('panel.insurance.preview')}
                    </button>
                  )}
                  {/* ⚠ 못 뜬 줄에는 이 버튼이 **아예 서지 않는다**(§7.23) — 눌러서 실패하게 두지 않는다. */}
                  {canRestorePreimage(p) && (
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      onClick={() => { void restore(p); }}
                      className={`shrink-0 rounded px-2 py-0.5 text-[12px] font-semibold text-white disabled:opacity-40 ${
                        p.sha256 ? 'bg-blue-600/80 hover:bg-blue-500' : 'bg-red-600/70 hover:bg-red-500'
                      }`}
                    >
                      {t(restoreLabelKey(p))}
                    </button>
                  )}
                </div>
              )))}

            {/* ── 부활 ── */}
            {tab === 'resurrect' && (resurrectable.length === 0
              ? <ScopedEmpty tab="resurrect" emptyKey="panel.insurance.emptyResurrect" led={led} level={scopeLevel} scope={scope} levels={scopeLevels} onWiden={setWantedScope} />
              : resurrectable.map((s) => (
                <div key={s.sessionId} className="flex items-center gap-2 rounded border border-gray-700/50 bg-gray-900/40 px-3 py-2">
                  {/*
                    제목이 이 줄의 주인이다 — 종전에는 `39f5680d` 처럼 세션 id 앞 8자만 적어
                    "무슨 대화였는지" 알 길이 없었다(사용자 보고). id 는 제목 자리를 뺏지 않게
                    아래 줄에 작게 곁들이고, 제목을 못 뽑았을 때만 그 자리를 대신한다.
                  */}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-gray-200" title={resurrectTitle(s) ?? undefined}>
                      {resurrectTitle(s) ?? t('panel.insurance.untitledSession')}
                    </span>
                    <span className="text-[12px] text-gray-600">
                      {formatInsuranceTime(s.lastActivityAt)} · {formatBytes(s.transcriptBytes)}
                      {' · '}
                      <span className="font-mono">{shortSessionId(s.sessionId)}</span>
                    </span>
                  </span>
                  {s.mirroredOnly && <Chip tone="warn">{t('panel.insurance.mirroredOnly')}</Chip>}
                  {s.resumeRisky && !s.mirroredOnly && <Chip tone="warn">{t('panel.insurance.resumeRisky')}</Chip>}
                  {/* 사본만 남은 것은 `--resume` 이 볼 자리가 없다 — 이어붙이기 손잡이를 내주지 않는다. */}
                  {!s.mirroredOnly && (
                    <button
                      type="button"
                      disabled={busyId === s.sessionId || !(s.agentId ?? agentId)}
                      onClick={() => { void resurrect(s, 'resume'); }}
                      className="shrink-0 rounded bg-blue-600/80 px-2 py-0.5 text-[12px] font-semibold text-white disabled:opacity-40 hover:bg-blue-500"
                    >
                      {t('panel.insurance.resumeMode')}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === s.sessionId || !(s.agentId ?? agentId)}
                    onClick={() => { void resurrect(s, 'fresh'); }}
                    className="shrink-0 rounded border border-gray-700 px-2 py-0.5 text-[12px] text-gray-300 disabled:opacity-40 hover:bg-white/[0.06]"
                  >
                    {t('panel.insurance.freshMode')}
                  </button>
                </div>
              )))}
          </div>
        </ScrollFade>

        {/* 미리보기 — 사본의 그때 내용. 다시 읽히기 전에 무엇이 들어갈지 눈으로 본다. */}
        {preview && (
          <div className="flex max-h-64 min-h-0 flex-col border-t border-gray-700 bg-gray-950/60">
            <div className="flex items-center gap-2 px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-[12px] text-gray-400">{preview.p.path}</span>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded border border-gray-700 px-2 py-0.5 text-[12px] text-gray-300 hover:bg-white/[0.06]"
              >
                {t('panel.insurance.closePreview')}
              </button>
            </div>
            <ScrollFade className="min-h-0 flex-1 overflow-auto px-4 pb-3">
              {preview.text === null
                ? <p className="text-[12px] text-gray-500">{t('panel.insurance.previewUnavailable')}</p>
                : <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-gray-300">{preview.text}</pre>}
            </ScrollFade>
          </div>
        )}
      </div>
    </div>
  );
}

/** 아직 아무것도 안 겪은 자리 — "고장났다"가 아니라 "아직 겪지 않았다"로 읽히게 적는다. */
function EmptyNote({ text }: { text: string }): React.JSX.Element {
  return <p className="px-1 py-6 text-center text-[12px] leading-relaxed text-gray-500">{text}</p>;
}

/**
 * §7.23 범위 축 — **빈 목록이 왜 비었는지**를 가른다.
 *
 * 좁힌 눈금에서 빈 화면은 두 가지 뜻이다: 정말 아무 일도 없었거나, **넓은 쪽에는 있는데 지금
 * 눈금이 가리고 있거나.** 둘을 같은 문장으로 적으면 사용자가 있는 사본을 없다고 믿고 창을 닫는다
 * — 보험 화면에서 그건 그냥 데이터를 잃는 것이다.
 *
 * 그래서 넓은 눈금에 줄이 있으면 **그리로 가는 버튼을 그 자리에 세운다.** 눈금 줄까지 눈을
 * 올려 다시 판단하게 하지 않는다(빈 화면을 본 사람은 이미 "없구나"로 결론을 냈다).
 */
function ScopedEmpty({
  tab, emptyKey, led, level, scope, levels, onWiden,
}: {
  tab: InsuranceTab;
  emptyKey: string;
  led: ProjectInsuranceLedger | undefined;
  level: InsuranceScopeLevel;
  scope: InsuranceSessionScope;
  levels: readonly InsuranceScopeLevel[];
  onWiden: (lv: InsuranceScopeLevel) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  // 지금보다 **넓은** 눈금 중 줄이 있는 첫 칸. 눈금 배열은 좁은 것부터라 뒤쪽이 넓은 쪽이다.
  const wider = levels
    .slice(levels.indexOf(level) + 1)
    .find((lv) => scopeRowCount(led, tab, lv, scope) > 0);

  if (!wider) return <EmptyNote text={t(emptyKey)} />;

  return (
    <div className="flex flex-col items-center gap-2 px-1 py-6">
      <p className="text-center text-[12px] leading-relaxed text-gray-500">
        {t('panel.insurance.emptyInScope', { scope: t(INSURANCE_SCOPE_LABEL_KEY[level]) })}
      </p>
      <button
        type="button"
        onClick={() => onWiden(wider)}
        className="rounded border border-gray-700 px-2.5 py-1 text-[12px] text-gray-300 transition-colors hover:bg-white/[0.06]"
      >
        {t('panel.insurance.widenTo', {
          scope: t(INSURANCE_SCOPE_LABEL_KEY[wider]),
          count: scopeRowCount(led, tab, wider, scope),
        })}
      </button>
    </div>
  );
}

function CompactRow({ m }: { m: CompactMarker }): React.JSX.Element {
  const { t } = useTranslation();
  const copy = markerCopyState(m);
  const state = markerOutcomeState(m);
  const subject = markerSubject(m);
  return (
    <div className="flex items-center gap-2 rounded border border-gray-700/50 bg-gray-900/40 px-3 py-2">
      <span className="min-w-0 flex-1">
        {/*
          **무엇을 하던 중의 압축인가**가 첫 줄이다. 종전에는 시각·트리거만 적어 압축 이력
          다섯 줄이 서로 구별되지 않았다 — 되살릴 세션을 고르는 화면에서 고를 근거가 없었다.
          우리가 모르면(작업 묶음이 비었으면) 지어내지 않고 종전 그대로 시각·트리거만 적는다.
        */}
        {subject
          ? (
            <>
              <span className="block truncate text-xs text-gray-200" title={subject}>{subject}</span>
              <span className="block truncate text-[12px] text-gray-500">
                {formatInsuranceTime(m.at)} · {t(`panel.insurance.trigger.${m.trigger}`)}
              </span>
            </>
          )
          : (
            <span className="block truncate text-xs text-gray-200">
              {formatInsuranceTime(m.at)} · {t(`panel.insurance.trigger.${m.trigger}`)}
            </span>
          )}
        <span className="text-[12px] text-gray-600">
          {formatBytes(m.transcriptBytes)}
          {m.contextUsed && m.contextMax ? ` · ${Math.round((m.contextUsed / m.contextMax) * 100)}%` : ''}
          {m.outcome ? ` · ${t('panel.insurance.carried', { count: m.outcome.carriedCount })}` : ''}
        </span>
      </span>
      {/* 사본이 실제로 있는지 없는지를 **말로** 적는다 — 이 칸이 이 기능의 정직함이다. */}
      <Chip tone={copy === 'mirrored' ? 'ok' : 'mute'}>
        {t(copy === 'mirrored' ? 'panel.insurance.copyMirrored' : 'panel.insurance.copyIndexOnly')}
      </Chip>
      {state === 'failed' && (
        <Chip tone="danger">{t(`panel.insurance.failed.${m.outcome?.failed ?? 'no-summary'}`)}</Chip>
      )}
      {/* 못 읽음은 **경고 색**이다 — 실패(빨강)도 정상(무색)도 아니라는 것이 이 칸의 전부다. */}
      {state === 'unreadable' && <Chip tone="warn">{t('panel.insurance.unreadable')}</Chip>}
      {/* 되살렸는데 문맥이 안 실렸다(#43696). 압축과 무관한 사건이라 칸을 따로 세운다. */}
      {m.resumeShortfall && <Chip tone="danger">{t('panel.insurance.resumeShortfall')}</Chip>}
      {state === 'pending' && <Chip tone="mute">{t('panel.insurance.pending')}</Chip>}
    </div>
  );
}

function NotCarriedRow({ m }: { m: CompactMarker }): React.JSX.Element {
  const { t } = useTranslation();
  const nc = m.outcome?.notCarried;
  if (!nc) return <></>;
  const groups: { key: string; items: string[] }[] = [
    { key: 'panel.insurance.nc.goal', items: nc.goal ? [nc.goal] : [] },
    { key: 'panel.insurance.nc.goalSteps', items: nc.goalSteps },
    { key: 'panel.insurance.nc.openFiles', items: nc.openFiles },
    { key: 'panel.insurance.nc.recentEdits', items: nc.recentEdits },
    { key: 'panel.insurance.nc.runningTasks', items: nc.runningTasks },
    { key: 'panel.insurance.nc.teammates', items: nc.teammates },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-1 rounded border border-gray-700/50 bg-gray-900/40 px-3 py-2">
      <span className="text-[12px] text-gray-500">{formatInsuranceTime(m.at)}</span>
      {groups.map((g) => (
        <div key={g.key} className="flex gap-2">
          <span className="w-20 shrink-0 text-[12px] text-gray-500">{t(g.key)}</span>
          <span className="min-w-0 flex-1 break-words text-[12px] text-gray-300">{g.items.join(', ')}</span>
        </div>
      ))}
      {/* 낱말이 규율이다 — "잃었다"가 아니라 "요약에 안 보인다"까지가 우리가 아는 전부다. */}
      <span className="text-[12px] leading-relaxed text-gray-600">{t('panel.insurance.ncNote')}</span>
    </div>
  );
}
