import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SpecCitation, SpecGateStrength, SpecReadSpan, SpecReadingSettings, SpecReadingState, SpecRequiredEntry } from '@vibisual/shared';
import { SPEC_DOC_ROOT_CANDIDATES, SPEC_GATE_STRENGTHS } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useIDEPaneValue, useIDEPaneActions } from './idePane.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';
import { editorFileFromRelPath } from './editorModel.js';
import { followSessionKey } from './editorFollow.js';
import { ScrollFade } from '../ScrollFade.js';
// 토큰 표기는 컨텍스트 창과 같은 산식 — 같은 숫자가 창마다 다르게 보이면 안 된다.
import { formatTokens } from './contextInventoryView.js';
// §5.5 #17-44 ⑧(c) — 켬/끔 3층 스위치가 사는 **유일한 자리**(활동바 팝오버는 폐기, 클릭은 이 뷰를 연다).
import { SpecScopeRows, SpecScopeSummary, useSpecScope } from './specReadingScope.js';

/**
 * §5.11 정독 게이트 — **정독** 뷰 (`IDEViewType='specReading'`).
 *
 * 이 화면이 답하는 물음은 하나다: **"에이전트가 기획을 진짜로 읽었는가."**
 *
 * 그 답을 하나의 점수로 뭉개지 않는다. "83%" 는 무엇이 부족한지 말하지 못하고, 말하지 못하는 숫자는
 * 신뢰의 근거가 되지 못한다 — 그래서 네 축(열람·인용·깊이·최신)을 따로 세우고, 그 아래에 **어느 절을
 * 몇 줄 열었는지**까지 그린다. 사용자가 의심스러우면 절을 눌러 그 문서의 그 자리로 바로 갈 수 있어야
 * 이 화면이 근거가 된다(#17-27 내장 편집창).
 *
 * **여기서 다시 재지 않는다(§3.1).** 필수 절·커버율·신뢰도·게이트 이력은 전부 서버가 낸 값이고, 그것은
 * 프롬프트에 실린 판단·게이트가 막는 근거와 **같은 함수 하나**에서 나온다. 화면이 자기 산식을 따로
 * 들면 "화면은 초록인데 막힌다"가 만들어지고, 그 순간 이 기능은 믿을 수 없는 것이 된다.
 */

/** 신뢰도 축 하나 — 이름·값(0~1)·색. */
interface TrustAxis {
  key: 'coverage' | 'citation' | 'depth' | 'freshness';
  value: number;
  tone: string;
}

const PERCENT_DIGITS = 0;
/** 히트맵 막대 하나의 최소 폭(%) — 한 줄짜리 구간도 보이긴 해야 한다. */
const HEAT_MIN_WIDTH = 0.6;
/** 뿌리 편집칸 줄 수 — 보통 한두 폴더라 두 줄이면 다 보인다(늘리기는 사용자가 끈다). */
const ROOTS_EDITOR_ROWS = 2;

const pct = (v: number): string => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(PERCENT_DIGITS)}%`;

/** 축 값이 낮을수록 붉게 — 색은 판정이 아니라 **읽는 속도**를 위한 것이다. */
function toneOf(value: number): string {
  if (value >= 0.8) return 'bg-emerald-400';
  if (value >= 0.4) return 'bg-amber-400';
  return 'bg-rose-400';
}

function statusTone(status: SpecRequiredEntry['status']): string {
  if (status === 'satisfied') return 'text-emerald-400';
  if (status === 'waived') return 'text-gray-500';
  if (status === 'blocked') return 'text-rose-400';
  return 'text-amber-400';
}

/** 절 하나의 상태 글리프 — 이모지 ❌, lucide 톤 stroke SVG. */
function StatusGlyph({ status }: { status: SpecRequiredEntry['status'] }): React.JSX.Element {
  const common = { className: `h-3.5 w-3.5 flex-shrink-0 ${statusTone(status)}`, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (status === 'satisfied') return <svg {...common}><path d="M20 6 9 17l-5-5" /></svg>;
  if (status === 'waived') return <svg {...common}><path d="M5 12h14" /></svg>;
  if (status === 'blocked') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /></svg>;
}

/**
 * 한 문서의 **정독 궤적** 한 줄.
 *
 * 축척(총 줄 수)을 모르면 막대를 그리지 않는다 — 없는 자로 그린 그림은 그 자체가 거짓말이고,
 * 이 화면에서 거짓말 한 번이면 나머지 숫자도 못 믿게 된다.
 */
function HeatBar({ spans, total }: { spans: readonly SpecReadSpan[]; total: number | undefined }): React.JSX.Element | null {
  if (!total || total <= 0) return null;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded bg-gray-800">
      {spans.map((s, i) => {
        const left = Math.max(0, Math.min(100, ((s.fromLine - 1) / total) * 100));
        const width = Math.max(HEAT_MIN_WIDTH, Math.min(100 - left, ((s.toLine - s.fromLine + 1) / total) * 100));
        return (
          <span
            key={`${s.fromLine}-${s.toLine}-${i}`}
            className={`absolute inset-y-0 rounded-sm ${s.partial ? 'bg-amber-400/40' : 'bg-emerald-400/80'}`}
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        );
      })}
    </div>
  );
}

export const IDEReadingView = memo(function IDEReadingView({ agentId }: { agentId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  const state = useGraphStore((s) => (activeSessionId ? s.specReading[activeSessionId] : undefined));
  const rootPath = useIDEProjectRoot();
  // 켜고 끄는 자리는 **여기 하나**다(#17-44 ⑧(c) — 활동바 팝오버 폐기). 세 갈래 화면 중 세션이 없는
  //   화면만 빼고 전부 스위치를 세운다 — 어느 화면에 서 있든 끄는 길이 눈앞에 있어야 한다.
  const scope = useSpecScope(rootPath, agentId, activeSessionId);
  const { openEditorFile } = useIDEPaneActions();
  const setFollowSignal = useGraphStore((s) => s.setIdeEditorFollowSignal);

  /**
   * 프로젝트 설정 한 벌 — **전량 교체**가 규약이라(부분 페이로드 강등 사고) 바꾸기 전에 먼저 받아 둔다.
   * 화면에 보이는 강도는 스냅샷의 것이고(그것이 게이트가 실제로 쓰는 값), 여기 것은 저장할 때의 재료다.
   */
  const [settings, setSettings] = useState<SpecReadingSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!rootPath) return;
    let alive = true;
    void fetch(`/api/spec-reading/settings?projectPath=${encodeURIComponent(rootPath)}`)
      .then((r) => r.json())
      .then((body: { ok?: boolean; settings?: SpecReadingSettings | null }) => {
        if (alive && body.ok) setSettings(body.settings ?? null);
      })
      .catch(() => { /* 스냅샷이 권위 — 설정을 못 받아도 화면은 그대로 그린다 */ });
    return () => { alive = false; };
  }, [rootPath]);

  /** 강도를 바꾼다 — 나머지 칸은 받아 둔 설정을 그대로 실어 보낸다(한 칸만 보내면 나머지가 강등된다). */
  const changeStrength = useCallback((strength: SpecGateStrength) => {
    if (!rootPath || saving) return;
    setSaving(true);
    void fetch('/api/spec-reading/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: rootPath, settings: { ...(settings ?? {}), strength } }),
    })
      .then((r) => r.json())
      .then((body: { ok?: boolean; settings?: SpecReadingSettings }) => {
        if (body.ok && body.settings) setSettings(body.settings);
      })
      .catch(() => { /* 실패하면 다음 스냅샷이 종전 값을 그대로 말한다 */ })
      .finally(() => setSaving(false));
  }, [rootPath, saving, settings]);

  /** 절 하나를 면제하거나 되돌린다 — **사용자만** 할 수 있다(에이전트에게는 이 경로가 없다). */
  const toggleWaive = useCallback((unitId: string, waived: boolean) => {
    if (!rootPath) return;
    void fetch('/api/spec-reading/waive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: rootPath, unitId, waived }),
    })
      .then((r) => r.json())
      .then((body: { ok?: boolean; settings?: SpecReadingSettings }) => {
        if (body.ok && body.settings) setSettings(body.settings);
      })
      .catch(() => { /* 스냅샷이 권위 */ });
  }, [rootPath]);

  /**
   * 인용 대조를 펼친 절 — 「인용 일치/어긋남」 한 마디로는 무엇이 어긋났는지 모른다. 에이전트가 적은 문장과
   * 파일의 그 자리 원문을 **나란히** 보여야 사용자가 판정할 수 있다(§5.5 #17-44 ③-1 (d)).
   */
  const [compared, setCompared] = useState<ReadonlySet<string>>(() => new Set());
  const toggleCompare = useCallback((unitId: string) => {
    setCompared((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  }, []);

  /**
   * 뿌리 편집 초안 — 재료는 **설정**의 뿌리다(색인이 실제로 훑은 자리는 스냅샷 `state.roots` 로 따로 보인다).
   * 비워 두면 기본 후보(`SPEC_DOC_ROOT_CANDIDATES`)로 돌아간다 — 서버 정규화가 빈 목록을 "없음"으로 접는다.
   */
  const [rootsDraft, setRootsDraft] = useState('');
  useEffect(() => {
    setRootsDraft((settings?.roots ?? []).join('\n'));
  }, [settings?.roots]);
  const rootsDirty = rootsDraft.trim() !== (settings?.roots ?? []).join('\n').trim();
  const saveRoots = useCallback(() => {
    if (!rootPath || saving) return;
    const roots = rootsDraft.split(/[\n,]/).map((r) => r.trim()).filter((r) => r !== '');
    setSaving(true);
    void fetch('/api/spec-reading/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      // 전량 교체 규약 — 받아 둔 한 벌에 뿌리만 얹어 보낸다(한 칸만 보내면 나머지가 강등된다).
      body: JSON.stringify({ projectPath: rootPath, settings: { ...(settings ?? {}), roots } }),
    })
      .then((r) => r.json())
      .then((body: { ok?: boolean; settings?: SpecReadingSettings }) => {
        if (body.ok && body.settings) setSettings(body.settings);
      })
      .catch(() => { /* 실패하면 초안이 그대로 남고 다음 스냅샷이 종전 뿌리를 말한다 */ })
      .finally(() => setSaving(false));
  }, [rootPath, saving, settings, rootsDraft]);

  /**
   * 절을 누르면 **내장 편집창**에서 그 문서를 연다(#17-27).
   *
   * 줄로 데려가는 것은 추종 신호가 이미 하는 일이라 그 길을 그대로 쓴다 — 제목 글자를 실마리로 주면
   * 편집창이 본문에서 찾아 그 줄로 스크롤한다. 새 기전을 만들지 않는다.
   */
  const openUnit = useCallback((entry: SpecRequiredEntry) => {
    if (!rootPath) return;
    const file = editorFileFromRelPath(entry.file, rootPath);
    openEditorFile(file);
    setFollowSignal({
      sessionKey: followSessionKey(agentId, activeSessionId),
      relPath: file.relPath,
      absPath: file.absPath,
      newString: entry.title,
      at: Date.now(),
    });
  }, [rootPath, openEditorFile, setFollowSignal, agentId, activeSessionId]);

  const axes: TrustAxis[] = useMemo(() => {
    const trust = state?.trust;
    if (!trust) return [];
    return ([
      { key: 'coverage', value: trust.coverage },
      { key: 'citation', value: trust.citation },
      { key: 'depth', value: trust.depth },
      { key: 'freshness', value: trust.freshness },
    ] as const).map((a) => ({ ...a, tone: toneOf(a.value) }));
  }, [state?.trust]);

  const heatFiles = useMemo(() => {
    if (!state) return [] as { file: string; spans: readonly SpecReadSpan[]; total: number | undefined }[];
    return Object.keys(state.spans).sort().map((file) => ({
      file,
      spans: state.spans[file] ?? [],
      total: state.fileLines[file],
    }));
  }, [state]);

  // 세션 탭이 아니면 **잴 대상**이 없다 — 원장은 세션 하나의 도구 이력이다. 그렇다고 이 화면이
  //   막다른 길이 되면 안 된다: 프로젝트·에이전트 두 층은 세션 없이도 켤 수 있고, 활동바 팝오버를
  //   걷어낸 지금(#17-44 ⑧(c)) 여기 말고는 켤 자리가 없다. 세션 줄만 스스로 잠긴 채 선다.
  if (activeSessionId === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
        <Header t={t} />
        <p className="px-2 pt-2 text-center text-[12px] leading-relaxed text-gray-500">{t('ide.specReading.pickSession')}</p>
        <div className="flex flex-col gap-1.5 px-2 py-3">
          <SpecScopeSummary on={scope.effective} />
          <p className="text-[12px] font-semibold text-gray-300">{t('ide.specReading.scope.title')}</p>
          <SpecScopeRows control={scope} agentId={agentId} subAgentId={null} />
          <p className="text-[12px] leading-relaxed text-gray-600">{t('ide.specReading.scope.hint')}</p>
        </div>
      </div>
    );
  }

  // 꺼져 있거나(#17-44 ⑧) 아직 아무것도 안 잰 세션 — 빈칸 대신 **이 자리가 무엇인지 + 켜는 손잡이**.
  if (!state) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
        <Header t={t} />
        <div className="flex flex-col gap-1.5 px-2 py-3">
          <p className="text-[12px] leading-relaxed text-gray-500">
            {scope.effective ? t('ide.specReading.empty') : t('ide.specReading.scope.effectiveOff')}
          </p>
          <p className="text-[12px] font-semibold text-gray-300">{t('ide.specReading.scope.title')}</p>
          <SpecScopeRows control={scope} agentId={agentId} subAgentId={activeSessionId} />
          <p className="text-[12px] leading-relaxed text-gray-600">{t('ide.specReading.scope.hint')}</p>
          <p className="text-[12px] leading-relaxed text-gray-600">{t('ide.specReading.hint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
      <Header t={t} count={state.required.length} />

      {/* §5.5 #17-44 ⑧ — 켜져 있을 때도 **끄는 길이 같은 화면에** 있어야 한다(읽히지 않는 스위치 방지). */}
      <SpecScopeSummary on={scope.effective} />

      {/* 색인 한 줄 — 무엇을 기준으로 재고 있는지 먼저 밝힌다. 상한 밖으로 밀린 문서·일부러 뺀 백업도 여기서
          말한다(③-1) — "문서 120개를 색인했다"만으로는 무엇이 빠졌는지 모르고, 빠진 것을 모르면 아래 숫자를 못 믿는다. */}
      <p className="px-1 text-[12px] leading-snug text-gray-600">
        {t('ide.specReading.indexSummary', { docs: state.indexDocs, units: state.indexUnits })}
        {state.indexSkipped > 0
          ? ` · ${t('ide.specReading.indexSkipped', { count: state.indexSkipped })}`
          : state.indexTruncated ? ` · ${t('ide.specReading.indexTruncated')}` : ''}
        {state.indexExcluded > 0 ? ` · ${t('ide.specReading.indexExcluded', { count: state.indexExcluded })}` : ''}
      </p>

      <ScrollFade fill className="flex-1">
        {/*
          ⓪ 켬/끔 3층 스위치 — §5.5 #17-44 ⑧(c).

          **켜져 있을 때도 끄는 길이 같은 화면에 있어야 한다.** 종전에는 이 화면이 켜졌을 때
          위 요약 한 줄만 두고 스위치는 활동바 팝오버에만 뒀는데, 그 팝오버를 없앤 지금 여기가
          유일한 손잡이다 — 없으면 "켜고 나면 끌 자리가 화면에 없다"는 종전 결함이 그대로 돌아온다.
          맨 위에 세우는 이유도 같다: 손잡이를 계측 아래로 내리면 스크롤해야 나오는 스위치가 된다.
        */}
        <section className="mb-2 flex flex-col gap-1 rounded border border-gray-800 bg-gray-900/40 p-2">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
            {t('ide.specReading.scope.title')}
          </span>
          <SpecScopeRows control={scope} agentId={agentId} subAgentId={activeSessionId} />
          <p className="text-[12px] leading-snug text-gray-600">{t('ide.specReading.scope.hint')}</p>
        </section>

        {/* ① 신뢰도 네 축 — 하나로 뭉개지 않는 이유가 이 화면의 요점이다. */}
        <section className="mb-2 flex flex-col gap-1 rounded border border-gray-800 bg-gray-900/40 p-2">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
            {t('ide.specReading.trustTitle')}
          </span>
          {axes.map((a) => (
            <div key={a.key} className="flex items-center gap-1.5">
              <span className="w-16 flex-shrink-0 text-[12px] text-gray-400">{t(`ide.specReading.axis.${a.key}`)}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-gray-800">
                <div className={`h-full rounded ${a.tone}`} style={{ width: pct(a.value) }} />
              </div>
              <span className="w-9 flex-shrink-0 text-right text-[12px] tabular-nums text-gray-400">{pct(a.value)}</span>
            </div>
          ))}
          <p className="text-[12px] leading-snug text-gray-600">
            {t('ide.specReading.trustDetail', {
              satisfied: state.trust.satisfied,
              total: state.trust.requiredTotal,
              verified: state.trust.citationsVerified,
              failed: state.trust.citationsFailed,
              stale: state.trust.staleDocs,
            })}
          </p>
        </section>

        {/* ② 필수 절 체크리스트 — 누르면 그 문서의 그 자리로 간다. */}
        <section className="mb-2 flex flex-col gap-1">
          <span className="px-1 text-[12px] font-semibold uppercase tracking-wider text-gray-500">
            {t('ide.specReading.requiredTitle')}
          </span>
          {state.required.length === 0 ? (
            <p className="px-1 text-[12px] leading-snug text-gray-600">{t('ide.specReading.requiredNone')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {state.required.map((entry) => (
                <li key={entry.unitId} className="rounded border border-gray-800 bg-gray-900/40 p-1.5">
                  <div className="flex items-start gap-1.5">
                    <StatusGlyph status={entry.status} />
                    <button
                      type="button"
                      onClick={() => openUnit(entry)}
                      className="min-w-0 flex-1 text-left"
                      title={t('ide.specReading.openInEditor', { file: entry.file, from: entry.startLine, to: entry.endLine })}
                    >
                      <span className="block truncate text-[12px] text-gray-200 hover:text-sky-300">{entry.title}</span>
                      <span className="block truncate text-[12px] text-gray-600">
                        {entry.file}:{entry.startLine}-{entry.endLine}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleWaive(entry.unitId, entry.status !== 'waived')}
                      className="flex-shrink-0 rounded px-1 text-[12px] text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                    >
                      {entry.status === 'waived' ? t('ide.specReading.unwaive') : t('ide.specReading.waive')}
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="rounded bg-gray-800 px-1 text-[12px] text-gray-400">
                      {t(`ide.specReading.via.${entry.via}`)}
                    </span>
                    <span className={`text-[12px] tabular-nums ${statusTone(entry.status)}`}>
                      {t('ide.specReading.covered', { pct: pct(entry.covered) })}
                    </span>
                    {typeof entry.tokens === 'number' && (
                      <span className="text-[12px] tabular-nums text-gray-600">
                        {t('ide.specReading.tokens', { n: formatTokens(entry.tokens) })}
                      </span>
                    )}
                    {entry.partial && (
                      <span className="text-[12px] text-amber-400">{t('ide.specReading.partial')}</span>
                    )}
                    {entry.oversized && (
                      <span className="rounded bg-amber-500/15 px-1 text-[12px] text-amber-400">{t('ide.specReading.oversized')}</span>
                    )}
                    {entry.citation && (
                      <button
                        type="button"
                        onClick={() => toggleCompare(entry.unitId)}
                        title={compared.has(entry.unitId) ? t('ide.specReading.citationHide') : t('ide.specReading.citationShow')}
                        className={`text-[12px] hover:underline ${entry.citation.verified ? 'text-emerald-400' : 'text-rose-400'}`}
                      >
                        {entry.citation.verified ? t('ide.specReading.citationOk') : t('ide.specReading.citationBad')}
                      </button>
                    )}
                  </div>
                  {entry.reason && (
                    <p className="mt-0.5 text-[12px] leading-snug text-gray-500">{entry.reason}</p>
                  )}
                  {entry.citation && compared.has(entry.unitId) && (
                    <CitationCompare t={t} citation={entry.citation} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ③ 정독 궤적 — "어디를 얼마나 열었나"를 문서 한 줄짜리 막대로. */}
        <section className="mb-2 flex flex-col gap-1">
          <span className="px-1 text-[12px] font-semibold uppercase tracking-wider text-gray-500">
            {t('ide.specReading.heatTitle')}
          </span>
          {heatFiles.length === 0 ? (
            <p className="px-1 text-[12px] leading-snug text-gray-600">{t('ide.specReading.heatNone')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {heatFiles.map(({ file, spans, total }) => (
                <li key={file} className="flex flex-col gap-0.5 px-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-gray-400">{file}</span>
                    <span className="flex-shrink-0 text-[12px] tabular-nums text-gray-600">
                      {total ? t('ide.specReading.lineTotal', { count: total }) : t('ide.specReading.scaleUnknown')}
                    </span>
                  </div>
                  <HeatBar spans={spans} total={total} />
                </li>
              ))}
            </ul>
          )}
          <p className="px-1 text-[12px] leading-snug text-gray-600">{t('ide.specReading.heatLegend')}</p>
        </section>

        {/* ④ 게이트가 실제로 한 일 — 막은 적이 없으면 그렇게 적는다(빈칸으로 두면 고장처럼 읽힌다). */}
        <section className="flex flex-col gap-1">
          <span className="px-1 text-[12px] font-semibold uppercase tracking-wider text-gray-500">
            {t('ide.specReading.gateTitle')}
          </span>
          {state.gate.length === 0 ? (
            <p className="px-1 text-[12px] leading-snug text-gray-600">{t('ide.specReading.gateNone')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {[...state.gate].reverse().map((g, i) => (
                <li key={`${g.at}-${i}`} className="rounded border border-gray-800 bg-gray-900/40 p-1.5">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[12px] text-amber-400">{t(`ide.specReading.gateKind.${g.kind}`)}</span>
                    <span className="text-[12px] tabular-nums text-gray-600">
                      {new Date(g.at).toLocaleTimeString()}
                    </span>
                  </div>
                  {g.unitIds.length > 0 && (
                    <p className="truncate text-[12px] text-gray-500">{g.unitIds.join(', ')}</p>
                  )}
                  {g.detail && <p className="text-[12px] leading-snug text-gray-500">{g.detail}</p>}
                </li>
              ))}
            </ul>
          )}
          {state.stopRetries > 0 && (
            <p className="px-1 text-[12px] leading-snug text-gray-600">
              {t('ide.specReading.stopRetries', { count: state.stopRetries })}
            </p>
          )}
        </section>

        {/* ⑥ 색인 — 어디를 훑었고 무엇이 밀렸는지(§5.5 #17-44 ③-1). 뿌리는 여기서 고친다 — 설정은 전량 교체 규약이라
            받아 둔 한 벌에 얹어 보내고, 색인은 다음 턴에 다시 선다. */}
        <section className="mt-2 flex flex-col gap-1">
          <span className="px-1 text-[12px] font-semibold uppercase tracking-wider text-gray-500">
            {t('ide.specReading.indexTitle')}
          </span>
          <p className="px-1 text-[12px] leading-snug text-gray-500">
            {t('ide.specReading.rootsUsed', { roots: state.roots.length > 0 ? state.roots.join(' · ') : '—' })}
          </p>
          <textarea
            value={rootsDraft}
            onChange={(e) => setRootsDraft(e.target.value)}
            rows={ROOTS_EDITOR_ROWS}
            spellCheck={false}
            placeholder={t('ide.specReading.rootsPlaceholder', { defaults: SPEC_DOC_ROOT_CANDIDATES.join(', ') })}
            className="mx-1 resize-y rounded border border-gray-800 bg-gray-950/60 px-1.5 py-1 font-mono text-[12px] leading-snug text-gray-300 placeholder:text-gray-600 focus:border-sky-500/50 focus:outline-none"
          />
          <div className="flex items-center gap-1.5 px-1">
            <button
              type="button"
              disabled={saving || !rootsDirty}
              onClick={saveRoots}
              className="rounded px-1.5 py-0.5 text-[12px] text-sky-300 hover:bg-gray-800 disabled:cursor-default disabled:text-gray-600 disabled:hover:bg-transparent"
            >
              {t('ide.specReading.rootsSave')}
            </button>
            <span className="text-[12px] text-gray-600">{t('ide.specReading.rootsHint')}</span>
          </div>
          {state.indexSkippedDocs.length > 0 && (
            <div className="flex flex-col gap-0.5 pt-1">
              <span className="px-1 text-[12px] text-gray-500">
                {t('ide.specReading.skippedTitle', { count: state.indexSkipped })}
              </span>
              <ul className="flex flex-col">
                {state.indexSkippedDocs.map((doc) => (
                  <li key={doc} className="truncate px-1 text-[12px] text-gray-600" title={doc}>{doc}</li>
                ))}
              </ul>
              {state.indexSkipped > state.indexSkippedDocs.length && (
                <p className="px-1 text-[12px] text-gray-600">
                  {t('ide.specReading.skippedMore', { count: state.indexSkipped - state.indexSkippedDocs.length })}
                </p>
              )}
            </div>
          )}
        </section>
      </ScrollFade>

      {/* ⑤ 강도 — 이 기능의 유일한 스위치다. 무엇이 달라지는지 한 줄로 함께 적는다. */}
      <div className="flex-shrink-0 border-t border-gray-800 pt-1">
        <div className="flex items-center gap-1 px-1">
          <span className="text-[12px] text-gray-500">{t('ide.specReading.strengthTitle')}</span>
          {SPEC_GATE_STRENGTHS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={saving}
              onClick={() => changeStrength(s)}
              className={`rounded px-1.5 py-0.5 text-[12px] transition-colors ${
                state.strength === s
                  ? 'bg-sky-500/20 text-sky-300'
                  : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
              }`}
            >
              {t(`ide.specReading.strength.${s}`)}
            </button>
          ))}
        </div>
        <p className="px-1 pt-0.5 text-[12px] leading-snug text-gray-600">
          {t(`ide.specReading.strengthHint.${state.strength}`)}
        </p>
      </div>
    </div>
  );
});

/** 제목 줄 — 세 갈래 화면(세션 없음·잰 것 없음·본문)이 같은 머리를 쓴다. */
function Header({ t, count }: { t: (k: string, o?: Record<string, unknown>) => string; count?: number }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 px-1">
      <span className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
        {t('ide.specReading.title')}
      </span>
      {typeof count === 'number' && count > 0 && (
        <span className="rounded bg-sky-500/20 px-1 text-[12px] font-semibold tabular-nums text-sky-300">{count}</span>
      )}
    </div>
  );
}

/**
 * 인용 대조 — 에이전트가 적은 문장과 파일의 그 자리 원문을 **나란히**. 어느 쪽이 맞는지는 사용자가 본다 —
 * 판정 한 마디(일치/어긋남)는 서버 것이고, 여기서는 그 근거 두 원문을 그대로 보일 뿐이다.
 */
function CitationCompare({ t, citation }: { t: (k: string, o?: Record<string, unknown>) => string; citation: SpecCitation }): React.JSX.Element {
  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="min-w-0 rounded border border-gray-800 bg-gray-950/60 p-1.5">
        <span className="block text-[12px] text-gray-500">{t('ide.specReading.citationQuote')}</span>
        <p className="whitespace-pre-wrap break-words text-[12px] leading-snug text-gray-300">{citation.quote}</p>
      </div>
      <div className="min-w-0 rounded border border-gray-800 bg-gray-950/60 p-1.5">
        <span className="block text-[12px] text-gray-500">
          {t('ide.specReading.citationActual', { from: citation.fromLine, to: citation.toLine })}
        </span>
        <p className={`whitespace-pre-wrap break-words text-[12px] leading-snug ${citation.actual === undefined ? 'text-gray-600' : 'text-gray-300'}`}>
          {citation.actual ?? t('ide.specReading.citationActualMissing')}
        </p>
      </div>
    </div>
  );
}
