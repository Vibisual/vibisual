/**
 * §5.3 #10-4 · §5.5 #16-1 (H) — **오케스트라(지휘 모드)** 뷰. IDE 활동바의 제 칸(`data-activity-view="orchestra"`)이 여는 화면.
 *
 * 사용자 지시(2026-09-19): 활동바에서 프로젝트·에이전트 2단으로 켜고 끄고, 켜 둔 에이전트에 명령을 넣으면
 * 그 에이전트가 스스로 일을 나누고 엣지로 편성하며, 절감 방안은 **지난 분석 원문 그대로** 싣되 전부 자동
 * 적용이 아니라 **지휘자가 그 요청에 맞는 것만 골라** 쓰고, Claude·Codex 를 세부 설정할 수 있게.
 *
 * 화면이 하는 일은 넷이다 — 켜고 끄기(2층) · 세부 설정 · 방안 표(허용 토글 + 원문 펼침) · 런 기록.
 * **판정은 여기서 하지 않는다**: 층 접기는 shared `orchestraScopeStates`, 저장은 서버 두 창구
 * (`POST /api/orchestra/scope` · `PUT /api/orchestra/settings`)이고, 화면은 돌려받은 **저장된 값**으로 갈아 낀다
 * (낙관적 갱신 ❌ — 서버가 접은 결과와 화면이 갈린다).
 *
 * **수치 절감을 약속하지 않는다.** 원문의 예상 절감은 "원문의 추정"이라는 이름표를 달고서만 보인다 —
 * 지휘자가 무엇을 고를지는 요청마다 다르고, 여러 에이전트는 오히려 더 쓸 수 있다(분석 1번).
 *
 * 화면 규약은 절차 감지 뷰(§5.10 (P))와 같다 — 스위치는 꺼져 있을 때도 켜져 있을 때도 늘 이 자리 ·
 * 12px 하한(§9) · 아이콘은 stroke SVG(이모지 ❌) · 새 창·오버레이 ❌.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ORCHESTRA_ANALYSIS_INSIGHTS,
  ORCHESTRA_ANALYSIS_INSIGHTS_TITLE,
  ORCHESTRA_ANALYSIS_SUM,
  ORCHESTRA_ANALYSIS_TABLE_HEADER,
  ORCHESTRA_ANALYSIS_TABLE_TITLE,
  ORCHESTRA_BEST_PRACTICES,
  ORCHESTRA_BEST_PRACTICES_HEADER,
  ORCHESTRA_BEST_PRACTICES_TITLE,
  ORCHESTRA_CONDUCTOR_PERMISSIONS,
  ORCHESTRA_DEFAULT_MAX_MEMBERS,
  ORCHESTRA_IMMEDIATE_VALUES,
  ORCHESTRA_IMMEDIATE_VALUES_TITLE,
  ORCHESTRA_MAX_MEMBERS_LIMIT,
  ORCHESTRA_MEMBER_ENGINES,
  ORCHESTRA_SOURCES,
  ORCHESTRA_SOURCES_TITLE,
  ORCHESTRA_STRATEGIES,
  findOrchestraStrategy,
  isOrchestraRunSettled,
  isOrchestraStrategyAllowed,
  listEffortLevels,
  listModelFamilies,
  orchestraScopeStates,
  orchestraEnginePreparation,
  resolveOrchestraConductorPermission,
  resolveOrchestraMemberEngine,
} from '@vibisual/shared';
import type {
  CodexModelEntry,
  OrchestraPlanChoice,
  OrchestraRun,
  OrchestraRunPhase,
  OrchestraScope,
  OrchestraSettings,
  OrchestraStrategy,
  OrchestraStrategyId,
} from '@vibisual/shared';
import { useGraphStore, selectPaneOrchestraSummary } from '../../stores/graphStore.js';
import { useIDEPaneKey } from './idePane.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';
import { ScopeGlyph } from './autoGoalScope.js';
import { ScrollFade } from '../ScrollFade.js';

// ─── 저장 창구 ────────────────────────────────────────────────────────────────

/** `PUT /api/orchestra/settings` 에 싣는 칸 — 켬/끔 칸은 `/scope` 한 길이라 여기 없다. `null` = 그 칸을 지운다. */
type OrchestraPatch = {
  [K in Exclude<keyof OrchestraSettings, 'enabledProject' | 'enabledAgents' | 'updatedAt'>]?: OrchestraSettings[K] | null;
};

interface OrchestraControl {
  settings: OrchestraSettings;
  saving: boolean;
  /** 마지막 저장이 실패한 사유(서버가 짚은 칸 이름 또는 오류 코드). 다음 저장이 시작되면 지운다. */
  error: string | null;
  setScope: (scope: OrchestraScope, enabled: boolean | null) => void;
  patch: (p: OrchestraPatch) => void;
}

/**
 * 스냅샷의 설정 + 방금 저장하고 돌려받은 설정 중 **더 새것**을 쓴다(`updatedAt` — 서버가 쓸 때마다 찍는다).
 *
 * 둘을 함께 드는 이유: 저장 응답은 브로드캐스트보다 먼저 오기도 늦게 오기도 한다. 스냅샷만 보면 누른 뒤
 * 한 박자 동안 스위치가 옛 값으로 보이고, 응답만 보면 다른 창에서 바꾼 값을 영영 못 본다. 같으면 스냅샷이 이긴다.
 */
function useOrchestraControl(
  rootPath: string | null,
  agentId: string,
  snapshotSettings: OrchestraSettings | null,
): OrchestraControl {
  const [local, setLocal] = useState<OrchestraSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 겹친 저장을 막는 것은 ref 로 한다 — state 는 이 렌더의 사본이라 빠른 두 번 누름을 못 막는다.
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  // 프로젝트가 바뀌면 앞 프로젝트에서 받아 둔 값을 버린다 — 남으면 다른 프로젝트의 설정이 한 박자 보인다.
  useEffect(() => {
    setLocal(null);
    setError(null);
  }, [rootPath]);

  const settings = useMemo<OrchestraSettings>(() => {
    if (local && (!snapshotSettings || (local.updatedAt ?? 0) > (snapshotSettings.updatedAt ?? 0))) return local;
    return snapshotSettings ?? {};
  }, [local, snapshotSettings]);

  const send = useCallback((url: string, method: 'POST' | 'PUT', body: Record<string, unknown>) => {
    if (!rootPath || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    void fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: rootPath, ...body }),
    })
      .then(async (r) => {
        const res = (await r.json().catch(() => ({}))) as {
          ok?: boolean; settings?: OrchestraSettings; error?: string; field?: string;
        };
        if (!alive.current) return;
        if (r.ok && res.ok && res.settings) setLocal(res.settings);
        else setError(res.field ?? res.error ?? `HTTP ${r.status}`);
      })
      .catch((err: unknown) => {
        if (alive.current) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        busy.current = false;
        if (alive.current) setSaving(false);
      });
  }, [rootPath]);

  const setScope = useCallback((scope: OrchestraScope, enabled: boolean | null) => {
    if (scope === 'agent' && !agentId) return;
    send('/api/orchestra/scope', 'POST', { scope, ...(scope === 'agent' ? { id: agentId } : {}), enabled });
  }, [send, agentId]);

  const patch = useCallback((p: OrchestraPatch) => {
    send('/api/orchestra/settings', 'PUT', { patch: p });
  }, [send]);

  return { settings, saving, error, setScope, patch };
}

// ─── 원문 그리기 ──────────────────────────────────────────────────────────────

/**
 * 원문 칸은 마크다운 조각(`**굵게**` · `` `코드` `` · `<br>`)을 담고 있다. 글자는 한 자도 바꾸지 않고
 * **표시만** 한다 — 표시 기호를 벗기는 것이지 문장을 고치는 것이 아니다.
 */
const BOLD_OR_CODE = /(\*\*[^*]+\*\*|`[^`]+`)/;
const CODE_ONLY = /(`[^`]+`)/;

function renderCode(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(CODE_ONLY).map((p, i) => {
    if (p.length > 2 && p.startsWith('`') && p.endsWith('`')) {
      return (
        <code key={`${keyPrefix}c${i}`} className="break-all rounded bg-gray-800 px-1 font-mono text-[12px] text-amber-200/90">
          {p.slice(1, -1)}
        </code>
      );
    }
    return p === '' ? null : <span key={`${keyPrefix}t${i}`}>{p}</span>;
  });
}

function renderInline(text: string): React.ReactNode[] {
  return text.split(BOLD_OR_CODE).map((p, i) => {
    if (p.length > 4 && p.startsWith('**') && p.endsWith('**')) {
      // 굵은 글 안에도 코드가 든다(`**\`autoCompact\`**`) — 안쪽을 한 번 더 편다.
      return <strong key={`b${i}`} className="font-semibold text-gray-100">{renderCode(p.slice(2, -2), `b${i}`)}</strong>;
    }
    return <span key={`s${i}`}>{renderCode(p, `s${i}`)}</span>;
  });
}

/** 원문 한 칸 — `<br>` 은 줄바꿈으로. */
function RichText({ text, className }: { text: string; className?: string }): React.JSX.Element {
  return (
    <span className={className}>
      {text.split('<br>').map((line, i) => (
        <span key={i} className="block">{renderInline(line)}</span>
      ))}
    </span>
  );
}

/** `## 제목` → `제목`. 제목 글자는 원문 그대로다. */
function headingOf(s: string): string {
  return s.replace(/^#+\s*/, '');
}

/** 원문 표 머리 줄의 칸 이름들 — 화면의 칸 이름표도 원문에서 온다(원문 블록이 원문 말로 읽히게). */
function cellsOf(row: string): string[] {
  return row.split('|').map((c) => c.trim()).filter((c) => c !== '');
}
const STRATEGY_COLUMNS = cellsOf(ORCHESTRA_ANALYSIS_TABLE_HEADER);
const BEST_PRACTICE_COLUMNS = cellsOf(ORCHESTRA_BEST_PRACTICES_HEADER);

// ─── 작은 글리프 ─────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      className={`h-3 w-3 flex-shrink-0 text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function CheckGlyph({ on }: { on: boolean }): React.JSX.Element {
  return (
    <svg
      className={`mt-[1px] h-3.5 w-3.5 flex-shrink-0 ${on ? 'text-amber-400' : 'text-gray-600'}`}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      {on && <path d="m7 12 3.5 3.5L17 9" />}
    </svg>
  );
}

/** 주의 한 줄 앞의 삼각형(lucide triangle-alert 톤). */
function WarnGlyph(): React.JSX.Element {
  return (
    <svg
      className="mt-[2px] h-3.5 w-3.5 flex-shrink-0 text-amber-400/80" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

// ─── 설정 칸 ─────────────────────────────────────────────────────────────────

interface Opt { value: string; label: string }

/**
 * 고르기 한 칸. 지금 값이 목록에 없으면(목록이 아직 안 왔거나, 손으로 적은 값) **그 값을 목록 끝에 세운다** —
 * 없는 값을 빈칸으로 보이면 사용자는 "정하지 않음"으로 읽고, 한 번 건드리면 그 값이 사라진다.
 */
function SettingSelect({
  field, label, value, options, emptyLabel, disabled, onChange,
}: {
  field: string;
  label: string;
  value: string;
  options: readonly Opt[];
  /** 빈 값 칸의 이름. 없으면 빈 값을 고를 수 없다(늘 무엇인가 정해져 있는 칸). */
  emptyLabel?: string;
  disabled: boolean;
  onChange: (v: string) => void;
}): React.JSX.Element {
  const list = value !== '' && !options.some((o) => o.value === value) ? [...options, { value, label: value }] : options;
  return (
    <label className="flex min-w-0 flex-col gap-0.5 px-0.5">
      <span className="text-[12px] text-gray-500">{label}</span>
      <select
        data-orchestra-field={field}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 rounded border border-gray-700 bg-gray-900 px-1.5 py-1 text-[12px] text-gray-100 outline-none focus:border-amber-500/60 disabled:opacity-40"
      >
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function ToggleRow({
  field, label, hint, on, disabled, onToggle,
}: {
  field: string;
  label: string;
  hint?: string;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-orchestra-field={field}
      disabled={disabled}
      onClick={onToggle}
      className={`flex w-full items-start gap-2 rounded px-1 py-1 text-left transition-colors ${
        disabled ? 'cursor-default opacity-40' : 'hover:bg-gray-800'
      }`}
    >
      <CheckGlyph on={on} />
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-gray-300">{label}</span>
        {hint && <span className="block text-[12px] leading-snug text-gray-600">{hint}</span>}
      </span>
    </button>
  );
}

/** 한 덩어리의 틀 — 머리(이름 + 오른쪽 곁말) + 내용. */
function Section({
  title, aside, children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex min-w-0 flex-col gap-1.5 rounded border border-gray-800 bg-gray-900/40 p-1.5">
      <div className="flex min-w-0 items-center gap-2 px-0.5">
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-gray-400" title={title}>{title}</span>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** 엔진 한 벌의 칸 묶음 이름 — 이 에이전트가 쓰는 쪽에 "이 에이전트" 표를 붙인다. */
function EngineLabel({ name, mine }: { name: string; mine: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5 px-0.5 pt-0.5">
      <span className={`text-[12px] font-semibold ${mine ? 'text-gray-200' : 'text-gray-500'}`}>{name}</span>
      {mine && (
        <span className="rounded bg-amber-500/15 px-1 text-[12px] text-amber-300">{t('ide.orchestra.conductor.thisAgent')}</span>
      )}
    </div>
  );
}

/** 코덱스 추론 강도 목록 — 모델을 골랐으면 그 모델의 것, 안 골랐으면 목록 전체의 합(원래 순서). */
function codexLevelsOf(models: readonly CodexModelEntry[] | undefined, slug: string): string[] {
  const list = models ?? [];
  const picked = slug ? list.find((m) => m.slug === slug) : undefined;
  if (picked) return picked.reasoningLevels;
  const out: string[] = [];
  for (const m of list) for (const l of m.reasoningLevels) if (!out.includes(l)) out.push(l);
  return out;
}

// ─── 방안 표 ─────────────────────────────────────────────────────────────────

/** 원문 한 칸 — 이름표(원문 표 머리) + 원문. */
function OriginalField({ label, text }: { label: string; text: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[12px] text-gray-500">{label}</span>
      <RichText text={text} className="block break-words text-[12px] leading-relaxed text-gray-300" />
    </div>
  );
}

/**
 * 방안 한 줄. 왼쪽 네모 = **지휘자에게 주는가**(끄면 지휘 규칙에서 빠지고, 계획 신고에 담기면 400).
 * 가운데를 누르면 원문 여섯 칸 + 지휘자가 받는 적용 지침이 펼쳐진다.
 *
 * 11·12·13 은 지휘자가 만질 손잡이가 없어 **참고 전용**이다 — 네모를 누를 수 없게 두고 그 까닭을 표로 붙인다.
 */
const StrategyRow = memo(function StrategyRow({
  strategy, allowed, disabled, onToggle,
}: {
  strategy: OrchestraStrategy;
  allowed: boolean;
  disabled: boolean;
  onToggle: (id: OrchestraStrategyId) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selectable = strategy.apply.selectable;
  const name = t(`ide.orchestra.strategy.${strategy.id}`);
  return (
    <li data-orchestra-strategy={strategy.id} className="min-w-0 rounded border border-gray-800/80">
      <div className="flex min-w-0 items-start gap-1.5 px-1 py-1">
        <button
          type="button"
          role="switch"
          aria-checked={allowed}
          aria-label={name}
          disabled={!selectable || disabled}
          onClick={() => onToggle(strategy.id)}
          title={selectable
            ? (allowed ? t('ide.orchestra.strategies.allowedTip') : t('ide.orchestra.strategies.deniedTip'))
            : t('ide.orchestra.strategies.referenceOnlyTip')}
          className={`flex-shrink-0 rounded p-0.5 ${!selectable || disabled ? 'cursor-default opacity-40' : 'hover:bg-gray-800'}`}
        >
          <CheckGlyph on={selectable && allowed} />
        </button>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-start gap-1 rounded text-left hover:bg-gray-800/60"
        >
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
              <span className="text-[12px] tabular-nums text-gray-600">#{strategy.no}</span>
              <span className={`text-[12px] ${selectable && allowed ? 'text-gray-200' : 'text-gray-500'}`}>{name}</span>
              {!selectable && (
                <span className="rounded bg-gray-800 px-1 text-[12px] text-gray-500">{t('ide.orchestra.strategies.referenceOnly')}</span>
              )}
            </span>
            {/* 원문의 예상 절감 — **원문의 추정**이라는 이름표를 달고서만 보인다(수치 약속 ❌). */}
            <span className="block text-[12px] leading-snug text-gray-500">
              {t('ide.orchestra.strategies.estimate')} <RichText text={strategy.saving} className="inline [&>span]:inline" />
            </span>
          </span>
          <span className="pt-[3px]"><Chevron open={open} /></span>
        </button>
      </div>
      {open && (
        <div className="flex min-w-0 flex-col gap-1.5 border-t border-gray-800/80 px-2 py-1.5">
          <span className="text-[12px] font-semibold text-gray-400">{t('ide.orchestra.strategies.original')}</span>
          <OriginalField label={STRATEGY_COLUMNS[1] ?? ''} text={strategy.element} />
          <OriginalField label={STRATEGY_COLUMNS[2] ?? ''} text={strategy.methods} />
          <OriginalField label={STRATEGY_COLUMNS[3] ?? ''} text={strategy.saving} />
          <OriginalField label={STRATEGY_COLUMNS[4] ?? ''} text={strategy.risk} />
          <OriginalField label={STRATEGY_COLUMNS[5] ?? ''} text={strategy.applyAt} />
          {selectable ? (
            <>
              <span className="pt-1 text-[12px] font-semibold text-gray-400">{t('ide.orchestra.strategies.applyTitle')}</span>
              {strategy.apply.knobs.length > 0 && (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[12px] text-gray-500">{t('ide.orchestra.strategies.knobs')}</span>
                  <span className="flex flex-wrap gap-1">
                    {strategy.apply.knobs.map((k) => (
                      <code key={k} className="break-all rounded bg-gray-800 px-1 font-mono text-[12px] text-gray-300">{k}</code>
                    ))}
                  </span>
                </div>
              )}
              {strategy.apply.memberRule && (
                <OriginalField label={t('ide.orchestra.strategies.memberRule')} text={strategy.apply.memberRule} />
              )}
              {strategy.apply.topology && (
                <OriginalField label={t('ide.orchestra.strategies.topologyRule')} text={strategy.apply.topology} />
              )}
            </>
          ) : (
            <p className="pt-1 text-[12px] leading-relaxed text-gray-500">{t('ide.orchestra.strategies.referenceOnlyTip')}</p>
          )}
        </div>
      )}
    </li>
  );
});

/** 원문의 나머지(합산 · 실측 네 가지 · 우수 사례 · 바로 바꿀 값 · 출처) — 접어 둔다. 표는 위 방안 줄들이다. */
const AnalysisPanel = memo(function AnalysisPanel(): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sub = 'pt-1 text-[12px] font-semibold text-gray-300';
  const body = 'block break-words text-[12px] leading-relaxed text-gray-400';
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        data-orchestra-analysis-toggle
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-gray-800"
      >
        <Chevron open={open} />
        <span className="text-[12px] text-gray-300">
          {open ? t('ide.orchestra.analysis.hide') : t('ide.orchestra.analysis.show')}
        </span>
      </button>
      {open && (
        <div className="flex min-w-0 flex-col gap-1.5 px-1 pb-1">
          <RichText text={ORCHESTRA_ANALYSIS_SUM} className={body} />

          <span className={sub}>{headingOf(ORCHESTRA_ANALYSIS_INSIGHTS_TITLE)}</span>
          <ul className="flex flex-col gap-1">
            {ORCHESTRA_ANALYSIS_INSIGHTS.map((line) => (
              <li key={line}><RichText text={line} className={body} /></li>
            ))}
          </ul>

          <span className={sub}>{headingOf(ORCHESTRA_BEST_PRACTICES_TITLE)}</span>
          <ul className="flex flex-col gap-1">
            {ORCHESTRA_BEST_PRACTICES.map((b) => (
              <li key={b.source} className="flex min-w-0 flex-col gap-0.5 rounded border border-gray-800/80 px-1.5 py-1">
                <RichText text={b.source} className="block break-words text-[12px] font-semibold text-gray-300" />
                <OriginalField label={BEST_PRACTICE_COLUMNS[1] ?? ''} text={b.advice} />
                <OriginalField label={BEST_PRACTICE_COLUMNS[2] ?? ''} text={b.ourUse} />
              </li>
            ))}
          </ul>

          <span className={sub}>{headingOf(ORCHESTRA_IMMEDIATE_VALUES_TITLE)}</span>
          <ul className="flex flex-col gap-1">
            {ORCHESTRA_IMMEDIATE_VALUES.map((line) => (
              <li key={line}><RichText text={line} className={body} /></li>
            ))}
          </ul>

          <span className={sub}>{ORCHESTRA_SOURCES_TITLE}</span>
          <ul className="flex flex-col gap-0.5">
            {ORCHESTRA_SOURCES.map((s) => (
              <li key={s.url} className="min-w-0">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  title={s.url}
                  className="break-words text-[12px] leading-snug text-sky-400/90 hover:underline"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});

// ─── 런 기록 ─────────────────────────────────────────────────────────────────

const PHASE_TONE: Record<OrchestraRunPhase, string> = {
  conducting: 'bg-amber-500/15 text-amber-300 animate-pulse',
  dispatched: 'bg-sky-500/15 text-sky-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  answered: 'bg-emerald-500/15 text-emerald-300',
  unreported: 'bg-gray-700/60 text-gray-300',
  error: 'bg-rose-500/15 text-rose-300',
};

function ChoiceList({
  label, items, dim,
}: {
  label: string;
  items: readonly OrchestraPlanChoice[];
  dim: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[12px] text-gray-500">{label}</span>
      <ul className="flex flex-col gap-0.5 pl-1">
        {items.map((c) => (
          <li key={c.id} className="break-words text-[12px] leading-snug">
            <span className={dim ? 'text-gray-500' : 'text-amber-300/90'}>
              #{findOrchestraStrategy(c.id)?.no ?? '?'} {t(`ide.orchestra.strategy.${c.id}`)}
            </span>
            {c.reason && <span className={dim ? 'text-gray-600' : 'text-gray-400'}> — {c.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 런 하나 — 누가 지휘했고(요청) · 무엇으로 읽었고(의도) · 어떻게 짰고(편성) · 무엇을 왜 골랐고 · 무엇을 왜
 * 건너뛰었고 · 누구에게 넘겼고 · 얼마를 썼는가. 이 기능의 핵심은 "지휘자가 **스스로** 고른다"이므로 고른
 * 이유가 보이지 않으면 사용자는 그 선택을 믿을 근거가 없다.
 */
const RunRow = memo(function RunRow({
  run, mine, nameOf, locale,
}: {
  run: OrchestraRun;
  mine: boolean;
  nameOf: (id: string) => string;
  locale: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const plan = run.plan;
  const time = new Date(run.startedAt).toLocaleString(locale, {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const conductor = nameOf(run.agentId);
  const members = run.memberAgentIds.map(nameOf);
  return (
    <li
      data-orchestra-run={run.runId}
      className={`flex min-w-0 flex-col gap-1 rounded border-l-2 px-1.5 py-1 ${
        mine ? 'border-amber-400/70 bg-gray-800/30' : 'border-gray-700'
      }`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={`flex-shrink-0 rounded px-1 text-[12px] ${PHASE_TONE[run.phase]}`}>
          {t(`ide.orchestra.phase.${run.phase}`)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-gray-400" title={conductor}>{conductor}</span>
        <span className="flex-shrink-0 text-[12px] text-gray-500">{t(`ide.orchestra.engine.${run.engine}`)}</span>
        <span className="flex-shrink-0 text-[12px] tabular-nums text-gray-600">{time}</span>
      </div>
      <p
        className="line-clamp-3 whitespace-pre-wrap break-words text-[12px] leading-snug text-gray-200"
        title={run.userRequest}
      >
        {run.userRequest}
      </p>
      {plan ? (
        <>
          <p className="text-[12px] text-gray-400">
            {t(`ide.orchestra.intent.${plan.intent}`)} · {t(`ide.orchestra.topology.${plan.topology}`)}
          </p>
          {plan.chosen.length > 0 && (
            <ChoiceList label={t('ide.orchestra.runs.chosen', { count: plan.chosen.length })} items={plan.chosen} dim={false} />
          )}
          {plan.skipped && plan.skipped.length > 0 && (
            <ChoiceList label={t('ide.orchestra.runs.skipped', { count: plan.skipped.length })} items={plan.skipped} dim />
          )}
          {plan.entryAgentId && (
            <p className="break-words text-[12px] text-gray-400">
              {t('ide.orchestra.runs.entry', { name: nameOf(plan.entryAgentId) })}
            </p>
          )}
          {plan.note && (
            <p className="whitespace-pre-wrap break-words text-[12px] leading-snug text-gray-400">
              <span className="text-gray-500">{t('ide.orchestra.runs.note')} </span>{plan.note}
            </p>
          )}
        </>
      ) : run.phase !== 'conducting' ? (
        <p className="text-[12px] leading-snug text-gray-500">{t('ide.orchestra.runs.noPlan')}</p>
      ) : null}
      {members.length > 0 && (
        <p className="break-words text-[12px] leading-snug text-gray-400">
          {t('ide.orchestra.runs.members', { count: members.length, names: members.join(', ') })}
          {run.createdMemberCount !== undefined && run.createdMemberCount > 0 && (
            <span className="text-gray-500"> {t('ide.orchestra.runs.created', { count: run.createdMemberCount })}</span>
          )}
        </p>
      )}
      <p className="text-[12px] tabular-nums text-gray-600">
        {t('ide.orchestra.runs.tokens', {
          input: run.inputTokens.toLocaleString(locale),
          output: run.outputTokens.toLocaleString(locale),
        })}
      </p>
    </li>
  );
});

// ─── 뷰 ──────────────────────────────────────────────────────────────────────

export const IDEOrchestraView = memo(function IDEOrchestraView({
  agentId,
}: {
  agentId: string;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const rootPath = useIDEProjectRoot();
  const paneKey = useIDEPaneKey();
  // 스냅샷은 이 창이 보는 프로젝트의 것 — 활성 프로젝트가 아니라 **이 창의** 프로젝트다(분할 창이 서로 다른 프로젝트를 본다).
  const summary = useGraphStore((s) => selectPaneOrchestraSummary(s, paneKey));
  const control = useOrchestraControl(rootPath, agentId, summary?.settings ?? null);
  const settings = control.settings;
  const runs = summary?.runs;

  // 지휘자 엔진은 **그 에이전트를 따른다**(SSOT — 턴마다 엔진을 바꾸면 세션이 끊긴다). 로컬이면 지휘하지 않는다.
  const providerKind = useGraphStore((s) => s.agentConfigs[agentId]?.provider?.kind);
  const executionMode = useGraphStore((s) => s.agentConfigs[agentId]?.executionMode);
  const engine: 'claude' | 'codex' | null = providerKind === undefined ? 'claude' : providerKind === 'codex-cli' ? 'codex' : null;
  // 버블 사정 — 캔버스에서 만든 에이전트인가 · Auto Agent 버블인가. 원시값 하나로 구독한다(배열 find 결과 객체 ❌).
  const bubbleState = useGraphStore((s) => {
    const a = s.agents.find((x) => x.id === agentId);
    if (!a) return '';
    const auto = !!(s.autoAgentSummaries[a.path] ?? s.autoAgentSummaries[agentId]);
    return `${a.customCreated ? 1 : 0}${auto ? 1 : 0}`;
  });

  const modelRegistry = useGraphStore((s) => s.modelRegistry);
  const codexModels = useGraphStore((s) => s.codexModels?.models);
  const claudeSetup = useGraphStore((s) => s.claudeSetup);
  const claudeAuth = useGraphStore((s) => s.claudeAuth);
  const codexSetup = useGraphStore((s) => s.codexSetup);
  const codexAuth = useGraphStore((s) => s.codexAuth);
  const prepareEngine = useGraphStore((s) => s.prepareOrchestraEngine);
  const claudeModelOpts = useMemo<Opt[]>(
    () => listModelFamilies(modelRegistry).map((m) => ({ value: m, label: m })),
    [modelRegistry],
  );
  const claudeEffortOpts = useMemo<Opt[]>(
    // `default` 는 "덮어쓰지 않음"이다 — 여기서는 빈 칸이 그 뜻이라 두 번 세우지 않는다.
    () => listEffortLevels(modelRegistry).filter((v) => v !== 'default').map((v) => ({ value: v, label: v })),
    [modelRegistry],
  );
  const codexModelOpts = useMemo<Opt[]>(
    () => (codexModels ?? []).map((m) => ({ value: m.slug, label: m.displayName || m.slug })),
    [codexModels],
  );

  const states = orchestraScopeStates(settings, agentId);
  const effective = states[states.length - 1]?.effective ?? false;
  const conductingHere = (runs ?? []).filter((r) => r.agentId === agentId && !isOrchestraRunSettled(r.phase) && r.endedAt === undefined).length;
  const locked = control.saving || !rootPath;

  // 켜 둬도 이 에이전트에서는 지휘하지 않는 사정 — 서버 가로채기 조건(§5.3 #10-4)을 그대로 비춘다.
  //   버블을 아직 못 받았으면(빈 문자열) 판정하지 않는다 — 모르는 것을 "안 된다"로 적지 않는다.
  const blocked: string[] = [];
  if (engine === null) blocked.push(t('ide.orchestra.blocked.localEngine'));
  if (bubbleState !== '' && bubbleState[0] !== '1') blocked.push(t('ide.orchestra.blocked.notCustom'));
  if (bubbleState[1] === '1') blocked.push(t('ide.orchestra.blocked.autoBubble'));
  if (executionMode === 'interactive-terminal') blocked.push(t('ide.orchestra.blocked.terminal'));

  const cycle = (own: boolean | null): boolean | null => (own === null ? true : own ? false : null);

  const memberEngine = resolveOrchestraMemberEngine(settings, engine ?? 'claude');
  const preparationEngines = new Set<'claude' | 'codex'>(engine ? [engine] : []);
  if (memberEngine === 'auto') { preparationEngines.add('claude'); preparationEngines.add('codex'); }
  else preparationEngines.add(memberEngine);
  const preparations = [...preparationEngines].flatMap((kind) => {
    const preparation = orchestraEnginePreparation(kind, { claudeSetup, claudeAuth, codexSetup, codexAuth });
    return preparation ? [preparation] : [];
  });
  const permission = resolveOrchestraConductorPermission(settings);

  const toggleStrategy = useCallback((id: OrchestraStrategyId) => {
    const off = settings.disabledStrategies ?? [];
    const next = off.includes(id) ? off.filter((x) => x !== id) : [...off, id];
    control.patch({ disabledStrategies: next.length > 0 ? next : null });
  }, [settings.disabledStrategies, control]);

  const selectableTotal = ORCHESTRA_STRATEGIES.filter((s) => s.apply.selectable).length;
  const allowedCount = ORCHESTRA_STRATEGIES.filter((s) => isOrchestraStrategyAllowed(settings, s.id)).length;

  // 런 기록 — 이 프로젝트 전체, 최신부터. 지휘자 이름은 버블 표시명으로(사라진 에이전트는 id 앞 8자).
  const sortedRuns = useMemo(() => [...(runs ?? [])].sort((a, b) => b.startedAt - a.startedAt), [runs]);
  const nameIdsKey = useMemo(() => {
    const ids = new Set<string>([agentId]);
    for (const r of sortedRuns) {
      ids.add(r.agentId);
      for (const m of r.memberAgentIds) ids.add(m);
      if (r.plan?.entryAgentId) ids.add(r.plan.entryAgentId);
    }
    return [...ids].sort().join('\n');
  }, [sortedRuns, agentId]);
  const namesJson = useGraphStore((s) => {
    const ids = new Set(nameIdsKey.split('\n'));
    const out: Record<string, string> = {};
    for (const a of s.agents) if (ids.has(a.id)) out[a.id] = a.label;
    return JSON.stringify(out);
  });
  const names = useMemo(() => JSON.parse(namesJson) as Record<string, string>, [namesJson]);
  const nameOf = useCallback((id: string) => names[id] || id.slice(0, 8), [names]);

  const codexConductorModel = settings.conductorCodexModel ?? '';
  const codexMemberModel = settings.memberCodexModel ?? '';

  return (
    <div className="flex min-h-0 flex-col">
      {/* 머리글 — 절차 감지 뷰와 같은 문법(칸 이름 · 켜짐 점 · 오른쪽에 지금 지휘 중인 수). */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-1.5 pt-2">
        <span
          title={t('ide.orchestra.title')}
          className="min-w-0 flex-1 basis-20 truncate text-[12px] font-semibold uppercase tracking-wider text-gray-500"
        >
          {t('ide.orchestra.title')}
        </span>
        <span
          aria-hidden
          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${effective ? 'bg-amber-400' : 'bg-gray-600'}`}
        />
        {conductingHere > 0 && (
          <span className="flex-shrink-0 text-[12px] tabular-nums text-amber-300" title={t('ide.orchestra.activity.conducting', { count: conductingHere })}>
            {conductingHere}
          </span>
        )}
      </div>

      <ScrollFade fill className="min-h-0 flex-1">
        <div className="flex min-w-0 flex-col gap-1.5 overflow-x-hidden break-words p-2">
          <p className="px-1 text-[12px] leading-relaxed text-gray-500">{t('ide.orchestra.about')}</p>

          {/* 지금 이 에이전트에서 도는가 — 위 층이 이미 정해 스위치를 눌러도 결론이 안 바뀌는 경우를 먼저 못 박는다. */}
          <p className={`px-1 text-[12px] leading-snug ${effective ? 'text-amber-300' : 'text-gray-500'}`}>
            {effective ? t('ide.orchestra.effectiveOn') : t('ide.orchestra.effectiveOff')}
          </p>

          {/* 켜고 끄는 자리 — 2층. 누르면 켬 → 끔 → 따름 으로 돈다(절차 감지 스위치와 같은 손짓·같은 그림). */}
          <div className="rounded border border-gray-800 bg-gray-900/40 p-1">
            <div className="flex flex-col gap-0.5">
              {states.map((s) => {
                const disabled = !s.available || locked;
                return (
                  <button
                    key={s.scope}
                    type="button"
                    data-orchestra-scope={s.scope}
                    disabled={disabled}
                    onClick={() => control.setScope(s.scope, cycle(s.own))}
                    title={s.available ? undefined : t('ide.orchestra.scope.unavailable')}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                      disabled ? 'cursor-default opacity-40' : 'hover:bg-gray-800'
                    }`}
                  >
                    <ScopeGlyph own={s.own} effective={s.effective} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-gray-300">
                      {t(`ide.orchestra.scope.${s.scope}`)}
                    </span>
                    <span className={`flex-shrink-0 text-[12px] ${s.inherited ? 'text-gray-600' : s.own ? 'text-emerald-400' : 'text-gray-500'}`}>
                      {s.inherited
                        ? t('ide.orchestra.scope.inherited')
                        : s.own
                          ? t('ide.orchestra.scope.on')
                          : t('ide.orchestra.scope.off')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <p className="px-1 text-[12px] leading-relaxed text-gray-600">{t('ide.orchestra.scope.hint')}</p>

          {blocked.length > 0 && (
            <div data-orchestra-blocked className="flex flex-col gap-0.5 rounded border border-amber-500/20 bg-amber-500/5 px-1.5 py-1">
              <span className="text-[12px] text-amber-300/90">{t('ide.orchestra.blocked.lead')}</span>
              <ul className="flex flex-col gap-0.5 pl-1">
                {blocked.map((line) => (
                  <li key={line} className="text-[12px] leading-snug text-gray-400">{line}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 정직한 경고 한 줄 — 분석 1번: 머릿수마다 고정 비용이 붙는다. */}
          <div className="flex items-start gap-1.5 px-1">
            <WarnGlyph />
            <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-gray-400">{t('ide.orchestra.costWarning')}</p>
          </div>

          {control.error && (
            <p data-orchestra-error className="px-1 text-[12px] leading-snug text-rose-400">
              {t('ide.orchestra.saveFailed', { reason: control.error })}
            </p>
          )}

          {/* 지휘자 — 이 에이전트 자신. 엔진은 에이전트를 따르므로 엔진별 두 벌만 둔다. */}
          <Section title={t('ide.orchestra.conductor.title')}>
            <p className="px-0.5 text-[12px] leading-relaxed text-gray-500">{t('ide.orchestra.conductor.about')}</p>
            <EngineLabel name={t('ide.orchestra.engine.claude')} mine={engine === 'claude'} />
            <SettingSelect
              field="conductorClaudeModel"
              label={t('ide.orchestra.field.model')}
              value={settings.conductorClaudeModel ?? ''}
              options={claudeModelOpts}
              emptyLabel={t('ide.orchestra.useAgentSetting')}
              disabled={locked}
              onChange={(v) => control.patch({ conductorClaudeModel: v || null })}
            />
            <SettingSelect
              field="conductorClaudeEffort"
              label={t('ide.orchestra.field.effort')}
              value={settings.conductorClaudeEffort ?? ''}
              options={claudeEffortOpts}
              emptyLabel={t('ide.orchestra.useAgentSetting')}
              disabled={locked}
              onChange={(v) => control.patch({ conductorClaudeEffort: v || null })}
            />
            <EngineLabel name={t('ide.orchestra.engine.codex')} mine={engine === 'codex'} />
            <SettingSelect
              field="conductorCodexModel"
              label={t('ide.orchestra.field.model')}
              value={codexConductorModel}
              options={codexModelOpts}
              emptyLabel={t('ide.orchestra.useAgentSetting')}
              disabled={locked}
              onChange={(v) => control.patch({ conductorCodexModel: v || null })}
            />
            <SettingSelect
              field="conductorCodexReasoning"
              label={t('ide.orchestra.field.reasoning')}
              value={settings.conductorCodexReasoning ?? ''}
              options={codexLevelsOf(codexModels, codexConductorModel).map((l) => ({ value: l, label: l }))}
              emptyLabel={t('ide.orchestra.useAgentSetting')}
              disabled={locked}
              onChange={(v) => control.patch({ conductorCodexReasoning: v || null })}
            />
            <div className="h-px bg-gray-800" />
            <SettingSelect
              field="conductorPermission"
              label={t('ide.orchestra.field.permission')}
              value={permission}
              options={ORCHESTRA_CONDUCTOR_PERMISSIONS.map((p) => ({ value: p, label: t(`ide.orchestra.permission.${p}`) }))}
              disabled={locked}
              onChange={(v) => control.patch({ conductorPermission: v === 'inherit' ? 'inherit' : 'bypass' })}
            />
            <p className="px-0.5 text-[12px] leading-relaxed text-gray-600">
              {t(`ide.orchestra.permission.${permission}Hint`)}
            </p>
            <ToggleRow
              field="askQuestions"
              label={t('ide.orchestra.field.askQuestions')}
              hint={t('ide.orchestra.field.askQuestionsHint')}
              on={settings.askQuestions === true}
              disabled={locked}
              onToggle={() => control.patch({ askQuestions: settings.askQuestions === true ? null : true })}
            />
          </Section>

          {/* 멤버 — 지휘자가 새로 만드는 에이전트. 엔진 선택은 이쪽에만 있다. */}
          <Section title={t('ide.orchestra.member.title')}>
            <p className="px-0.5 text-[12px] leading-relaxed text-gray-500">{t('ide.orchestra.member.about')}</p>
            <SettingSelect
              field="memberEngine"
              label={t('ide.orchestra.field.engine')}
              value={settings.memberEngine ?? ''}
              options={ORCHESTRA_MEMBER_ENGINES.map((e) => ({ value: e, label: t(`ide.orchestra.member.engine.${e}`) }))}
              emptyLabel={t('ide.orchestra.member.engine.inherit', { engine: engine === 'codex' ? 'Codex' : 'Claude' })}
              disabled={locked}
              onChange={(v) => control.patch({ memberEngine: v === 'claude' || v === 'codex' || v === 'auto' ? v : null })}
            />
            {memberEngine === 'auto' && <p className="px-0.5 text-[12px] leading-relaxed text-gray-500">{t('ide.orchestra.readiness.auto')}</p>}
            {preparations.map((preparation) => {
              const engineName = preparation.engine === 'codex' ? 'Codex' : 'Claude';
              return (
                <div key={preparation.engine} className="flex flex-wrap items-center gap-1.5 rounded border border-amber-500/25 bg-amber-500/5 p-2">
                  <p className="min-w-0 flex-1 basis-36 text-[12px] leading-relaxed text-amber-300">
                    {t(`ide.orchestra.readiness.${preparation.action}`, { engine: engineName })}
                  </p>
                  <button type="button" disabled={locked} onClick={() => { void prepareEngine(preparation); }}
                    className="rounded border border-amber-500/30 px-2 py-1 text-[12px] text-amber-200 hover:bg-amber-500/10 disabled:opacity-40">
                    {preparation.action === 'refresh' ? t('ide.orchestra.readiness.recheck') : t('ide.orchestra.readiness.prepare', { engine: engineName })}
                  </button>
                </div>
              );
            })}
            {(memberEngine === 'claude' || memberEngine === 'auto') && (
              <>
                <EngineLabel name={t('ide.orchestra.engine.claude')} mine={false} />
                <SettingSelect
                  field="memberClaudeModel"
                  label={t('ide.orchestra.field.model')}
                  value={settings.memberClaudeModel ?? ''}
                  options={claudeModelOpts}
                  emptyLabel={t('ide.orchestra.conductorPicks')}
                  disabled={locked}
                  onChange={(v) => control.patch({ memberClaudeModel: v || null })}
                />
                <SettingSelect
                  field="memberClaudeEffort"
                  label={t('ide.orchestra.field.effort')}
                  value={settings.memberClaudeEffort ?? ''}
                  options={claudeEffortOpts}
                  emptyLabel={t('ide.orchestra.conductorPicks')}
                  disabled={locked}
                  onChange={(v) => control.patch({ memberClaudeEffort: v || null })}
                />
              </>
            )}
            {(memberEngine === 'codex' || memberEngine === 'auto') && (
              <>
                <EngineLabel name={t('ide.orchestra.engine.codex')} mine={false} />
                <SettingSelect
                  field="memberCodexModel"
                  label={t('ide.orchestra.field.model')}
                  value={codexMemberModel}
                  options={codexModelOpts}
                  emptyLabel={t('ide.orchestra.conductorPicks')}
                  disabled={locked}
                  onChange={(v) => control.patch({ memberCodexModel: v || null })}
                />
                <SettingSelect
                  field="memberCodexReasoning"
                  label={t('ide.orchestra.field.reasoning')}
                  value={settings.memberCodexReasoning ?? ''}
                  options={codexLevelsOf(codexModels, codexMemberModel).map((l) => ({ value: l, label: l }))}
                  emptyLabel={t('ide.orchestra.conductorPicks')}
                  disabled={locked}
                  onChange={(v) => control.patch({ memberCodexReasoning: v || null })}
                />
              </>
            )}
            <div className="h-px bg-gray-800" />
            <SettingSelect
              field="maxMembers"
              label={t('ide.orchestra.field.maxMembers')}
              value={settings.maxMembers !== undefined ? String(settings.maxMembers) : ''}
              options={Array.from({ length: ORCHESTRA_MAX_MEMBERS_LIMIT }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
              emptyLabel={t('ide.orchestra.member.maxDefault', { count: ORCHESTRA_DEFAULT_MAX_MEMBERS })}
              disabled={locked}
              onChange={(v) => control.patch({ maxMembers: v === '' ? null : Number(v) })}
            />
          </Section>

          {/* 방안 표 — 원문 13행. 지휘자는 켜 둔 것 중에서 **그 요청에 맞는 것만** 고른다(전부 자동 적용 ❌). */}
          <Section
            title={t('ide.orchestra.strategies.title')}
            aside={(
              <span className="flex-shrink-0 text-[12px] tabular-nums text-gray-500">
                {t('ide.orchestra.strategies.count', { allowed: allowedCount, total: selectableTotal })}
              </span>
            )}
          >
            <p className="px-0.5 text-[12px] leading-relaxed text-gray-500">{t('ide.orchestra.strategies.about')}</p>
            <p className="px-0.5 text-[12px] leading-snug text-gray-600">{headingOf(ORCHESTRA_ANALYSIS_TABLE_TITLE)}</p>
            <ul className="flex flex-col gap-1">
              {ORCHESTRA_STRATEGIES.map((s) => (
                <StrategyRow
                  key={s.id}
                  strategy={s}
                  allowed={isOrchestraStrategyAllowed(settings, s.id)}
                  disabled={locked}
                  onToggle={toggleStrategy}
                />
              ))}
            </ul>
            <AnalysisPanel />
          </Section>

          {/* 런 기록 — 요청마다 지휘자가 무엇을 골랐고 왜 그랬는가. */}
          <Section
            title={t('ide.orchestra.runs.title')}
            aside={sortedRuns.length > 0 ? (
              <span className="flex-shrink-0 text-[12px] tabular-nums text-gray-500">{sortedRuns.length}</span>
            ) : undefined}
          >
            {sortedRuns.length === 0 ? (
              <p className="px-0.5 text-[12px] leading-relaxed text-gray-600">{t('ide.orchestra.runs.empty')}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {sortedRuns.map((r) => (
                  <RunRow key={r.runId} run={r} mine={r.agentId === agentId} nameOf={nameOf} locale={i18n.language} />
                ))}
              </ul>
            )}
          </Section>
        </div>
      </ScrollFade>
    </div>
  );
});
