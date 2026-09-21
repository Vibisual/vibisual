/**
 * §5.3 #10-5 — **설정 덜어내기** 뷰. IDE 활동바의 제 칸(`data-activity-view="configTrim"`)이 여는 화면.
 *
 * 사용자 지시(2026-09-21): "우리 오케스트라 만들어 둔 것처럼 프로젝트 전체·에이전트·이 세션만 이런 식으로
 * 해서 켜면, 여기에 이 세션이 동작주일 때 **배제시킨 목록**을 보여 주고 **덜어낸 목록**을 보여 주고
 * 작업하게 만들면 되겠네."
 *
 * 화면이 하는 일은 넷이다 — 켜고 끄기(3층) · 덜어낸 목록 · 배제 목록 · 규칙 끄기.
 * **판정은 여기서 하지 않는다**: 층 접기는 shared `configTrimScopeStates`, 덜어낼지 말지는 shared
 * `computeConfigTrim`(규칙 표 한 벌), 저장은 서버 두 창구(`POST /api/config-trim/scope` ·
 * `PUT /api/config-trim/settings`)다. 화면은 돌려받은 **저장된 값**으로 갈아 낀다(낙관적 갱신 ❌).
 *
 * **저장된 설정은 한 글자도 바뀌지 않는다.** 덜어내기는 그 턴의 사본에서만 일어나고, 여기 두 목록은
 * 그 사본이 어떻게 만들어졌는지를 사후에 읽는 것이다 — 그래서 켜기 전과 끈 뒤의 동작은 글자 그대로 같다.
 *
 * 화면 규약은 오케스트라 뷰와 같다 — 스위치는 늘 이 자리 · 12px 하한(§9) · 아이콘은 stroke SVG(이모지 ❌).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CONFIG_TRIM_PROTECTED, CONFIG_TRIM_RULES, configTrimScopeStates } from '@vibisual/shared';
import type {
  ConfigTrimExclusion,
  ConfigTrimRemoval,
  ConfigTrimRuleId,
  ConfigTrimRun,
  ConfigTrimScope,
  ConfigTrimSettings,
} from '@vibisual/shared';
import { useGraphStore, selectPaneConfigTrimSummary } from '../../stores/graphStore.js';
import { useIDEPaneKey, useIDEPaneValue } from './idePane.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';
import { ScopeGlyph } from './autoGoalScope.js';
import { ScrollFade } from '../ScrollFade.js';

// ─── 저장 창구 ────────────────────────────────────────────────────────────────

/** `PUT /api/config-trim/settings` 가 받는 칸은 하나뿐이다. `null` = 그 칸을 지운다. */
type ConfigTrimPatch = { disabledRules?: ConfigTrimRuleId[] | null };

interface ConfigTrimControl {
  settings: ConfigTrimSettings;
  saving: boolean;
  /** 마지막 저장이 실패한 사유(서버가 짚은 칸 이름 또는 오류 코드). 다음 저장이 시작되면 지운다. */
  error: string | null;
  setScope: (scope: ConfigTrimScope, enabled: boolean | null) => void;
  patch: (p: ConfigTrimPatch) => void;
}

/**
 * 스냅샷의 설정 + 방금 저장하고 돌려받은 설정 중 **더 새것**을 쓴다(`updatedAt`).
 * 이유는 오케스트라 뷰의 같은 훅과 글자 그대로 같다 — 저장 응답은 브로드캐스트보다 먼저 오기도 늦게
 * 오기도 하고, 한쪽만 보면 스위치가 한 박자 옛 값으로 보이거나 다른 창의 변경을 영영 못 본다.
 */
function useConfigTrimControl(
  rootPath: string | null,
  agentId: string,
  subAgentId: string | null,
  snapshotSettings: ConfigTrimSettings | null,
): ConfigTrimControl {
  const [local, setLocal] = useState<ConfigTrimSettings | null>(null);
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

  const settings = useMemo<ConfigTrimSettings>(() => {
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
          ok?: boolean; settings?: ConfigTrimSettings; error?: string; field?: string;
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

  const setScope = useCallback((scope: ConfigTrimScope, enabled: boolean | null) => {
    const id = scope === 'agent' ? agentId : scope === 'session' ? subAgentId : null;
    if (scope !== 'project' && !id) return;
    // 세션 칸은 주인을 되짚을 창구가 없어 서버가 `agentId` 를 함께 요구한다(§5.3 #10-5 REST).
    send('/api/config-trim/scope', 'POST', {
      scope, ...(id ? { id } : {}), ...(scope === 'session' ? { agentId } : {}), enabled,
    });
  }, [send, agentId, subAgentId]);

  const patch = useCallback((p: ConfigTrimPatch) => {
    send('/api/config-trim/settings', 'PUT', { patch: p });
  }, [send]);

  return { settings, saving, error, setScope, patch };
}

// ─── 조각 ────────────────────────────────────────────────────────────────────

/** 설정 칸 이름은 식별자다 — 번역하지 않고 그대로 적되, 본문 글과 섞이지 않게 고정폭으로 둔다. */
const FieldName = memo(function FieldName({ name }: { name: string }): React.JSX.Element {
  return (
    <span className="break-all font-mono text-[12px] text-gray-200" title={name}>{name}</span>
  );
});

/** 접히는 구역 한 칸 — 오케스트라 뷰의 `Section` 과 같은 얼개(제목 + 테두리). */
const Section = memo(function Section({
  title, count, tone, children,
}: {
  title: string;
  count?: number;
  tone?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded border border-gray-800 bg-gray-900/40 p-1.5">
      <div className="flex items-center gap-1.5 px-0.5">
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-wider text-gray-500">
          {title}
        </span>
        {count !== undefined && count > 0 && (
          <span className={`flex-shrink-0 text-[12px] tabular-nums ${tone ?? 'text-gray-400'}`}>{count}</span>
        )}
      </div>
      {children}
    </div>
  );
});

/** 경고 한 줄 앞에 서는 글리프(lucide `triangle-alert` 톤). */
function WarnGlyph(): React.JSX.Element {
  return (
    <svg
      className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400"
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M10.3 3.8 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

/**
 * **덜어낸 줄** — 이 턴 사본에서 실제로 지운 칸. 원래 값과 까닭을 함께 적는다.
 * 원래 값을 안 적으면 무엇이 사라졌는지 되짚을 길이 없다(저장된 설정은 그대로라 화면과 어긋나 보인다).
 */
const TrimmedRow = memo(function TrimmedRow({ item }: { item: ConfigTrimRemoval }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <li data-config-trim-removal={item.field} className="flex min-w-0 flex-col gap-0.5 rounded px-1.5 py-1 hover:bg-gray-800/60">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <FieldName name={item.field} />
        <span className="ml-auto flex-shrink-0 text-[12px] text-rose-300/90">
          {t(`ide.configTrim.reason.${item.reason}`)}
        </span>
      </div>
      <p className="min-w-0 break-all text-[12px] leading-snug text-gray-500">
        {t('ide.configTrim.before', { value: item.before })}
      </p>
      <p className="min-w-0 text-[12px] leading-snug text-gray-600">{t(`ide.configTrim.rule.${item.ruleId}`)}</p>
    </li>
  );
});

/**
 * **배제한 줄** — 덜어낼 대상에서 일부러 뺀 칸. 왜 뺐는지가 이 줄의 전부다.
 * `unknown`(판정 재료가 없음)·`rule-off`(사용자가 그 규칙을 끔)가 위로 온다 — 그 둘만이 바뀔 수 있는 것이다.
 */
const ExcludedRow = memo(function ExcludedRow({ item }: { item: ConfigTrimExclusion }): React.JSX.Element {
  const { t } = useTranslation();
  const soft = item.keep === 'unknown' || item.keep === 'rule-off';
  return (
    <li data-config-trim-exclusion={item.field} className="flex min-w-0 flex-col gap-0.5 rounded px-1.5 py-1 hover:bg-gray-800/60">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <FieldName name={item.field} />
        <span className={`ml-auto flex-shrink-0 text-[12px] ${soft ? 'text-amber-300/90' : 'text-gray-500'}`}>
          {t(`ide.configTrim.keep.${item.keep}`)}
        </span>
      </div>
      {item.ruleId && (
        <p className="min-w-0 text-[12px] leading-snug text-gray-600">{t(`ide.configTrim.rule.${item.ruleId}`)}</p>
      )}
    </li>
  );
});

/** 배제 줄 정렬 순위 — 바꿀 수 있는 것부터. */
const KEEP_ORDER: Readonly<Record<string, number>> = {
  'rule-off': 0, unknown: 1, 'user-set': 2, unsafe: 3, required: 4,
};

// ─── 뷰 ──────────────────────────────────────────────────────────────────────

export const IDEConfigTrimView = memo(function IDEConfigTrimView({
  agentId,
}: {
  agentId: string;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const rootPath = useIDEProjectRoot();
  const paneKey = useIDEPaneKey();
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  // 스냅샷은 **이 창의** 프로젝트 것이다(분할 창이 서로 다른 프로젝트를 본다).
  const summary = useGraphStore((s) => selectPaneConfigTrimSummary(s, paneKey));
  const control = useConfigTrimControl(rootPath, agentId, activeSessionId ?? null, summary?.settings ?? null);
  const settings = control.settings;
  const runs = summary?.runs;

  // 가로채기 조건은 서버와 같다 — 엔진이 claude|codex 인 턴에서만 걸린다(§5.3 #10-5).
  const providerKind = useGraphStore((s) => s.agentConfigs[agentId]?.provider?.kind);
  const executionMode = useGraphStore((s) => s.agentConfigs[agentId]?.executionMode);
  const engine: 'claude' | 'codex' | null = providerKind === undefined
    ? 'claude' : providerKind === 'codex-cli' ? 'codex' : null;

  const states = configTrimScopeStates(settings, {
    agentId, subAgentId: activeSessionId ?? undefined,
  });
  const effective = states[states.length - 1]?.effective ?? false;
  const locked = control.saving || !rootPath;
  const cycle = (own: boolean | null): boolean | null => (own === null ? true : own ? false : null);

  const blocked: string[] = [];
  if (engine === null) blocked.push(t('ide.configTrim.blocked.localEngine'));
  if (executionMode === 'interactive-terminal') blocked.push(t('ide.configTrim.blocked.terminal'));

  /*
   * 목록이 무엇을 보여 줄까 — **이 세션이 동작주인 런이 먼저**다(사용자 지시 그대로).
   * 그 세션이 아직 한 턴도 안 돌았으면 이 에이전트의 최근 런으로 떨어지고, 그때는 "이 세션 것이
   * 아니다"를 줄로 적는다 — 남의 턴 목록을 이 세션 것처럼 그리면 그게 가장 나쁜 거짓말이다.
   */
  const sortedRuns = useMemo(
    () => [...(runs ?? [])].sort((a, b) => b.startedAt - a.startedAt),
    [runs],
  );
  const sessionRun = useMemo<ConfigTrimRun | null>(
    () => (activeSessionId ? sortedRuns.find((r) => r.subAgentId === activeSessionId) ?? null : null),
    [sortedRuns, activeSessionId],
  );
  const agentRun = useMemo<ConfigTrimRun | null>(
    () => sortedRuns.find((r) => r.agentId === agentId) ?? null,
    [sortedRuns, agentId],
  );
  const shown = sessionRun ?? agentRun;
  const trimmed = shown?.trimmed ?? [];
  const excluded = useMemo(
    () => [...(shown?.excluded ?? [])].sort(
      (a, b) => (KEEP_ORDER[a.keep] ?? 9) - (KEEP_ORDER[b.keep] ?? 9) || a.field.localeCompare(b.field),
    ),
    [shown],
  );

  const off = settings.disabledRules ?? [];
  const toggleRule = useCallback((id: ConfigTrimRuleId) => {
    const cur = settings.disabledRules ?? [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    control.patch({ disabledRules: next.length > 0 ? next : null });
  }, [settings.disabledRules, control]);

  const locale = i18n.language;
  const timeOf = useCallback(
    (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    [locale],
  );

  return (
    <div className="flex min-h-0 flex-col">
      {/* 머리글 — 오케스트라·절차 감지와 같은 문법(칸 이름 · 켜짐 점 · 오른쪽에 최근 턴의 덜어낸 수). */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-1.5 pt-2">
        <span
          title={t('ide.configTrim.title')}
          className="min-w-0 flex-1 basis-20 truncate text-[12px] font-semibold uppercase tracking-wider text-gray-500"
        >
          {t('ide.configTrim.title')}
        </span>
        <span
          aria-hidden
          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${effective ? 'bg-rose-400' : 'bg-gray-600'}`}
        />
        {trimmed.length > 0 && (
          <span
            className="flex-shrink-0 text-[12px] tabular-nums text-rose-300"
            title={t('ide.configTrim.activity.trimmed', { count: trimmed.length })}
          >
            {trimmed.length}
          </span>
        )}
      </div>

      <ScrollFade fill className="min-h-0 flex-1">
        <div className="flex min-w-0 flex-col gap-1.5 overflow-x-hidden break-words p-2">
          <p className="px-1 text-[12px] leading-relaxed text-gray-500">{t('ide.configTrim.about')}</p>

          {/* 저장된 설정은 그대로라는 약속 — 이 줄이 없으면 "내 설정이 지워졌다"로 읽힌다. */}
          <p className="px-1 text-[12px] leading-relaxed text-gray-600">{t('ide.configTrim.storedSafe')}</p>

          <p className={`px-1 text-[12px] leading-snug ${effective ? 'text-rose-300' : 'text-gray-500'}`}>
            {effective ? t('ide.configTrim.effectiveOn') : t('ide.configTrim.effectiveOff')}
          </p>

          {/* 켜고 끄는 자리 — 3층. 누르면 켬 → 끔 → 따름 으로 돈다(절차 감지·오케스트라와 같은 손짓). */}
          <div className="rounded border border-gray-800 bg-gray-900/40 p-1">
            <div className="flex flex-col gap-0.5">
              {states.map((s) => {
                const disabled = !s.available || locked;
                return (
                  <button
                    key={s.scope}
                    type="button"
                    data-config-trim-scope={s.scope}
                    disabled={disabled}
                    onClick={() => control.setScope(s.scope, cycle(s.own))}
                    title={s.available ? undefined : t('ide.configTrim.scope.unavailable')}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                      disabled ? 'cursor-default opacity-40' : 'hover:bg-gray-800'
                    }`}
                  >
                    <ScopeGlyph own={s.own} effective={s.effective} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-gray-300">
                      {t(`ide.configTrim.scope.${s.scope}`)}
                    </span>
                    <span className={`flex-shrink-0 text-[12px] ${s.inherited ? 'text-gray-600' : s.own ? 'text-emerald-400' : 'text-gray-500'}`}>
                      {s.inherited
                        ? t('ide.configTrim.scope.inherited')
                        : s.own
                          ? t('ide.configTrim.scope.on')
                          : t('ide.configTrim.scope.off')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <p className="px-1 text-[12px] leading-relaxed text-gray-600">{t('ide.configTrim.scope.hint')}</p>

          {blocked.length > 0 && (
            <div data-config-trim-blocked className="flex flex-col gap-0.5 rounded border border-amber-500/20 bg-amber-500/5 px-1.5 py-1">
              <span className="text-[12px] text-amber-300/90">{t('ide.configTrim.blocked.lead')}</span>
              <ul className="flex flex-col gap-0.5 pl-1">
                {blocked.map((line) => (
                  <li key={line} className="text-[12px] leading-snug text-gray-400">{line}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 정직한 경고 — 덜어내기는 되돌릴 수 없는 판단이 아니라 **추정**이다. */}
          <div className="flex items-start gap-1.5 px-1">
            <WarnGlyph />
            <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-gray-400">{t('ide.configTrim.caution')}</p>
          </div>

          {control.error && (
            <p data-config-trim-error className="px-1 text-[12px] leading-snug text-rose-400">
              {t('ide.configTrim.saveFailed', { reason: control.error })}
            </p>
          )}

          {/* 이 목록이 누구의 턴인가 — 이 한 줄이 없으면 옆 세션의 결과를 내 것으로 읽는다. */}
          {shown
            ? (
              <p className="px-1 text-[12px] leading-snug text-gray-500">
                {sessionRun
                  ? t('ide.configTrim.source.thisSession', { time: timeOf(shown.startedAt) })
                  : t('ide.configTrim.source.otherSession', { time: timeOf(shown.startedAt) })}
              </p>
            )
            : (
              <p data-config-trim-norun className="px-1 text-[12px] leading-snug text-gray-600">
                {effective ? t('ide.configTrim.source.waiting') : t('ide.configTrim.source.turnOnFirst')}
              </p>
            )}

          {/* ① 덜어낸 목록 — 이 턴 사본에서 실제로 빠진 것. */}
          <Section title={t('ide.configTrim.trimmedPane.title')} count={trimmed.length} tone="text-rose-300">
            <p className="px-0.5 text-[12px] leading-relaxed text-gray-500">{t('ide.configTrim.trimmedPane.lead')}</p>
            {trimmed.length === 0
              ? <p className="px-0.5 py-1 text-[12px] text-gray-600">{t('ide.configTrim.trimmedPane.empty')}</p>
              : (
                <ul data-config-trim-pane="trimmed" className="flex min-w-0 flex-col">
                  {trimmed.map((item) => <TrimmedRow key={item.field} item={item} />)}
                </ul>
              )}
          </Section>

          {/* ② 배제 목록 — 일부러 손대지 않은 것. 두 목록은 **끝까지 갈라져 있다**(사용자 지시). */}
          <Section title={t('ide.configTrim.excludedPane.title')} count={excluded.length}>
            <p className="px-0.5 text-[12px] leading-relaxed text-gray-500">{t('ide.configTrim.excludedPane.lead')}</p>
            {excluded.length === 0
              ? <p className="px-0.5 py-1 text-[12px] text-gray-600">{t('ide.configTrim.excludedPane.empty')}</p>
              : (
                <ul data-config-trim-pane="excluded" className="flex min-w-0 flex-col">
                  {excluded.map((item) => <ExcludedRow key={item.field} item={item} />)}
                </ul>
              )}
          </Section>

          {/* ③ 규칙 표 — 켜고 끄는 것은 **규칙**이지 칸이 아니다. 끄면 그 칸은 배제 목록으로 내려간다. */}
          <Section
            title={t('ide.configTrim.rules.title')}
            count={CONFIG_TRIM_RULES.length - off.length}
            tone="text-gray-400"
          >
            <p className="px-0.5 text-[12px] leading-relaxed text-gray-500">{t('ide.configTrim.rules.lead')}</p>
            <ul className="flex min-w-0 flex-col">
              {CONFIG_TRIM_RULES.map((rule) => {
                const disabled = off.includes(rule.id);
                return (
                  <li key={rule.id} className="min-w-0">
                    <button
                      type="button"
                      data-config-trim-rule={rule.id}
                      disabled={locked}
                      onClick={() => toggleRule(rule.id)}
                      className={`flex w-full min-w-0 items-start gap-2 rounded px-1.5 py-1 text-left transition-colors ${
                        locked ? 'cursor-default opacity-40' : 'hover:bg-gray-800'
                      }`}
                    >
                      <ScopeGlyph own={!disabled} effective={!disabled} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex min-w-0 items-baseline gap-1.5">
                          <FieldName name={rule.field} />
                          <span className="ml-auto flex-shrink-0 text-[12px] text-gray-600">
                            {t(`ide.configTrim.reason.${rule.reason}`)}
                          </span>
                        </span>
                        <span className={`min-w-0 text-[12px] leading-snug ${disabled ? 'text-gray-600 line-through' : 'text-gray-400'}`}>
                          {t(`ide.configTrim.rule.${rule.id}`)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>

          {/* ④ 늘 지키는 칸 — 규칙이 아예 닿지 않는 자리. 여기 있는 줄은 끌 수도 켤 수도 없다. */}
          <Section title={t('ide.configTrim.protected.title')} count={CONFIG_TRIM_PROTECTED.length}>
            <p className="px-0.5 text-[12px] leading-relaxed text-gray-500">{t('ide.configTrim.protected.lead')}</p>
            <ul data-config-trim-pane="protected" className="flex min-w-0 flex-col">
              {CONFIG_TRIM_PROTECTED.map((p) => (
                <li key={p.field} className="flex min-w-0 items-baseline gap-1.5 px-1.5 py-0.5">
                  <FieldName name={p.field} />
                  <span className="ml-auto flex-shrink-0 text-[12px] text-gray-600">
                    {t(`ide.configTrim.keep.${p.keep}`)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          {/* ⑤ 이 프로젝트의 최근 턴 — 다른 세션에서 무엇이 덜어졌는지도 한자리에서 보인다. */}
          <Section title={t('ide.configTrim.runs.title')} count={sortedRuns.length}>
            {sortedRuns.length === 0
              ? <p className="px-0.5 py-1 text-[12px] text-gray-600">{t('ide.configTrim.runs.empty')}</p>
              : (
                <ul className="flex min-w-0 flex-col">
                  {sortedRuns.map((run) => (
                    <li
                      key={run.runId}
                      data-config-trim-run={run.runId}
                      className={`flex min-w-0 items-baseline gap-1.5 px-1.5 py-0.5 ${
                        run.runId === shown?.runId ? 'bg-gray-800/60' : ''
                      }`}
                    >
                      <span className="flex-shrink-0 text-[12px] tabular-nums text-gray-600">{timeOf(run.startedAt)}</span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-gray-500">
                        {run.engine}
                      </span>
                      <span className="flex-shrink-0 text-[12px] tabular-nums text-rose-300/90">
                        {t('ide.configTrim.runs.counts', { trimmed: run.trimmed.length, excluded: run.excluded.length })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </Section>
        </div>
      </ScrollFade>
    </div>
  );
});
