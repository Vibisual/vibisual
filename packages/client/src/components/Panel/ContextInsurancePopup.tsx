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
  scopedFailedCompacts,
  scopedNotCarriedRows,
  showsVaultSize,
  skipReasonKey,
  type InsuranceScopeLevel,
  type InsuranceSessionScope,
  type InsuranceTab,
} from '../../utils/insuranceView.js';

// SCENARIO.md §5.26 / §7.23 — 컨텍스트 보험 팝업(압축 이력·요약 누락·파일 사본·부활 한 창). 서버 값을 그대로 그리고 판정은 `utils/insuranceView.ts`.

interface ContextInsurancePopupProps {
  onClose: () => void;
  /** 이 창을 연 버블 = 부활 세션이 앉을 자리. 디스크에서만 찾은 세션은 소유 버블이 없어 이 값이 없으면 손잡이가 잠긴다. */
  agentId: string;
  /** §7.23 — 상태바가 세운 세션 좌표를 그대로 받는다(따로 찾으면 두 칸의 주어가 갈린다). */
  scope: InsuranceSessionScope;
}

/** 전문 원장 응답 — 방송 스냅샷과 달리 부활 후보까지 채워져 온다. */
interface LedgerResponse {
  ok: boolean;
  ledger: ProjectInsuranceLedger | null;
}

/**
 * §5.26 (I) ⑤ — 칩 색은 셋(`warn`·`ok`·`mute`)뿐, 빨강 ❌ — 압축 실패는 세션의 일이지 앱 오류가 아니다. 빨강은 앱이 깨졌을 때를 위해 비워 둔다.
 * 글자가 무슨 일인지, 색은 봐야 하나만 말한다.
 */
function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'mute'; children: React.ReactNode }): React.JSX.Element {
  const cls = tone === 'warn'
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
  /** §7.23 — 범위 기본은 가장 좁은 세션이다(여는 자리가 IDE 상태바 컨텍스트 칸이라 물음이 "이 세션이 뭘 잃었나"다). */
  const [wantedScope, setWantedScope] = useState<InsuranceScopeLevel>('session');
  /** 전문 원장 — 스냅샷엔 최근분만·부활 후보 없음이라 열 때 한 번 받는다. 실패하면 스냅샷 몫으로. */
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

  /* §7.23 — 네 갈피가 같은 눈금을 따른다. 고른 눈금을 쓸 수 없으면 한 칸 넓힌다(세션 탭 없는 훅 버블: `session` → `agent`). */
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
  /** §5.26 (I) ⑤ — 지금 눈금의 실패 압축 건수(상태바가 아니라 이 창에). 세는 것은 서버 집계다. */
  const failedCompacts = scopedFailedCompacts(led, scopeLevel, scope);

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
        className="mx-4 flex max-h-[80dvh] w-full max-w-2xl flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-gray-700 px-4 py-3">
          <svg className="h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <span className="text-sm font-semibold text-gray-100">{t('panel.insurance.title')}</span>
          {/* 금고 크기는 프로젝트 눈금에서만 — 저장고 전체라 세션 몫으로 쪼갤 근거가 없다(§5.26 (A)). */}
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
            className="rounded p-1 text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-200 pointer-coarse:p-2"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* 범위 줄은 갈피 위에 둔다(눈금이 정해져야 갈피 줄 수가 뜻을 갖는다). 이름 옆 숫자는 지금 갈피 기준. */}
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-700 px-3 py-2">
          <span className="mr-1 text-[12px] text-gray-500">{t('panel.insurance.scopeLabel')}</span>
          {scopeLevels.map((lv) => {
            const count = scopeRowCount(led, tab, lv, scope);
            return (
              <button
                key={lv}
                type="button"
                onClick={() => setWantedScope(lv)}
                title={t(`${INSURANCE_SCOPE_LABEL_KEY[lv]}Tip`)}
                className={`rounded px-2 py-0.5 text-[12px] transition-colors pointer-coarse:min-h-8 pointer-coarse:px-2.5 ${
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

        {/* 갈피 — 줄이 넘치면 다음 줄로 내린다(칩이 붙은 갈피는 긴 로케일에서 창 폭을 넘는다). */}
        <div className="flex flex-wrap gap-1 border-b border-gray-700 px-3 py-2">
          {INSURANCE_TABS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded px-2.5 py-1 text-xs transition-colors pointer-coarse:min-h-8 ${
                tab === id ? 'bg-blue-600/80 font-semibold text-white' : 'text-gray-400 hover:bg-white/[0.06]'
              }`}
            >
              {t(INSURANCE_TAB_LABEL_KEY[id])}
              {/* §5.26 (I) ⑤ — 실패 건수는 갈피 이름에 낱말과 함께 단다(다른 갈피에서도 보이게). 색은 경고색 + 테두리·바탕(빨강 ❌). 0 이면 없음. */}
              {id === 'compacts' && failedCompacts > 0 && (
                <span
                  className="ml-1.5 rounded border border-amber-500/50 bg-amber-500/15 px-1 text-[12px] font-semibold tabular-nums text-amber-300"
                  title={t('panel.insurance.failedBadgeTip', {
                    scope: t(INSURANCE_SCOPE_LABEL_KEY[scopeLevel]),
                    count: failedCompacts,
                  })}
                >
                  {t('panel.insurance.failedBadge', { count: failedCompacts })}
                </span>
              )}
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
                      {/* 같은 파일 여러 줄일 때의 판 번호. `1` 이 가장 최근. */}
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
                      className="shrink-0 rounded border border-gray-700 px-2 py-0.5 text-[12px] text-gray-300 disabled:opacity-40 hover:bg-white/[0.06] pointer-coarse:min-h-8"
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
                      className={`shrink-0 rounded px-2 py-0.5 text-[12px] font-semibold text-white disabled:opacity-40 pointer-coarse:min-h-8 ${
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
                  {/* 제목이 줄의 주인 — id 앞 8자로는 대화를 못 알아본다. id 는 아래 줄에 작게. */}
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
                      className="shrink-0 rounded bg-blue-600/80 px-2 py-0.5 text-[12px] font-semibold text-white disabled:opacity-40 hover:bg-blue-500 pointer-coarse:min-h-8"
                    >
                      {t('panel.insurance.resumeMode')}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === s.sessionId || !(s.agentId ?? agentId)}
                    onClick={() => { void resurrect(s, 'fresh'); }}
                    className="shrink-0 rounded border border-gray-700 px-2 py-0.5 text-[12px] text-gray-300 disabled:opacity-40 hover:bg-white/[0.06] pointer-coarse:min-h-8"
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
                className="shrink-0 rounded border border-gray-700 px-2 py-0.5 text-[12px] text-gray-300 hover:bg-white/[0.06] pointer-coarse:min-h-8"
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

/** §7.23 — 좁은 눈금의 빈 목록은 "없음"과 "가려짐"이 다르다. 넓은 눈금에 줄이 있으면 그리 가는 버튼을 그 자리에 세운다(없다고 믿고 닫지 않게). */
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
        className="rounded border border-gray-700 px-2.5 py-1 text-[12px] text-gray-300 transition-colors hover:bg-white/[0.06] pointer-coarse:min-h-8"
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
        {/* **무엇을 하던 중의 압축인가**가 첫 줄이다(시각만으로는 구별이 안 된다). 모르면 지어내지 않고 시각·트리거만. */}
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
      {/* 실패 사유는 **글자로** 적는다("요약 없음" · "트랜스크립트 없음"). 색으로 가르지 않는다. */}
      {state === 'failed' && (
        <Chip tone="warn">{t(`panel.insurance.failed.${m.outcome?.failed ?? 'no-summary'}`)}</Chip>
      )}
      {/* 못 읽음도 같은 색이다 — 실패와의 차이는 **무엇을 모르는가**이고, 그건 글자가 말한다. */}
      {state === 'unreadable' && <Chip tone="warn">{t('panel.insurance.unreadable')}</Chip>}
      {/* 되살렸는데 문맥이 안 실렸다(#43696). 압축과 무관한 사건이라 칸을 따로 세운다. */}
      {m.resumeShortfall && <Chip tone="warn">{t('panel.insurance.resumeShortfall')}</Chip>}
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
