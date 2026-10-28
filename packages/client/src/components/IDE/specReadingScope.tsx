/**
 * §5.5 #17-44 ⑧ — 정독 켬/끔 3층 스위치(프로젝트·에이전트·세션)의 한 벌 — 다른 곳에서 다시 그리지 마라(두 벌이면 한쪽만 고쳐진다).
 * 층 판정은 shared `specReadingScopeStates`(서버 집행·배지와 같은 함수).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { specReadingScopeStates } from '@vibisual/shared';
import type { SpecReadingScope, SpecReadingScopeState, SpecReadingSettings } from '@vibisual/shared';

/** 한 층에 값을 적거나(`true`/`false`) 지운다(`null` = 위 층에서 물려받기). */
export type SpecScopeWrite = (scope: SpecReadingScope, enabled: boolean | null) => void;

export interface SpecScopeControl {
  settings: SpecReadingSettings | null;
  states: SpecReadingScopeState[];
  /** 세 층을 다 접은 값 — 배지·집행이 보는 것과 같다. */
  effective: boolean;
  saving: boolean;
  /** 설정을 아직 못 받았다(서버 응답 전). 그동안 스위치는 눌리지 않는다. */
  loading: boolean;
  set: SpecScopeWrite;
  patch: (preferences: Partial<Pick<SpecReadingSettings, 'strength' | 'roots'>>) => void;
  waive: (unitId: string, waived: boolean) => void;
}

/**
 * 이 프로젝트의 정독 설정을 받아 3층 상태로 접고, 한 칸만 갈아 끼우는 창구를 연다.
 *
 * 저장은 **전량 교체 `PUT /settings` 가 아니라** 전용 창구(`POST /scope`)로 간다 — 전량으로 보내면
 * 화면이 모르는 강도·면제·뿌리가 함께 실려 나가 나머지가 기본값으로 강등된다(§4 `agent-config` 사고).
 */
export function useSpecScope(
  rootPath: string | null | undefined,
  agentId: string | null | undefined,
  subAgentId: string | null | undefined,
): SpecScopeControl {
  // Scope, strength, roots and waivers share one acknowledged settings value. Previously the view
  // kept a second copy and a strength save silently undid a scope toggle from this very screen.
  const owner = useMemo(() => ({ rootPath, version: 0, busy: false }), [rootPath]);
  const activeOwner = useRef<typeof owner | null>(owner);
  activeOwner.current = owner;
  const [state, setState] = useState({ owner, settings: null as SpecReadingSettings | null, loading: true, saving: false });
  const current = state.owner === owner ? state : { settings: null, loading: true, saving: false };
  const { settings, loading, saving } = current;

  useEffect(() => {
    activeOwner.current = owner;
    if (!rootPath) {
      setState({ owner, settings: null, loading: false, saving: false });
      return () => { if (activeOwner.current === owner) activeOwner.current = null; };
    }
    const version = ++owner.version;
    void fetch(`/api/spec-reading/settings?projectPath=${encodeURIComponent(rootPath)}`)
      .then((r) => r.json())
      .then((body: { ok?: boolean; settings?: SpecReadingSettings | null }) => {
        if (activeOwner.current !== owner || owner.version !== version) return;
        setState({ owner, settings: body.ok ? body.settings ?? null : null, loading: false, saving: false });
      })
      // 못 받아도 화면은 선다 — 스위치가 "안 정함"으로 보일 뿐이고, 누르면 서버가 지금 값을 읽어 고친다.
      .catch(() => {
        if (activeOwner.current === owner && owner.version === version) {
          setState({ owner, settings: null, loading: false, saving: false });
        }
      });
    return () => { if (activeOwner.current === owner) activeOwner.current = null; };
  }, [rootPath, owner]);

  const write = useCallback((endpoint: string, method: 'POST' | 'PATCH', body: Record<string, unknown>): void => {
    if (!rootPath || activeOwner.current !== owner || owner.busy) return;
    owner.busy = true;
    const version = ++owner.version;
    setState((prev) => ({ owner, settings: prev.owner === owner ? prev.settings : null, loading: false, saving: true }));
    void fetch(`/api/spec-reading/${endpoint}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: rootPath, ...body }),
    })
      .then((r) => r.json())
      .then((response: { ok?: boolean; settings?: SpecReadingSettings }) => {
        if (activeOwner.current !== owner || owner.version !== version || !response.ok || !response.settings) return;
        setState({ owner, settings: response.settings, loading: false, saving: true });
      })
      .catch(() => { /* Preserve the last acknowledged settings; the control can retry. */ })
      .finally(() => {
        owner.busy = false;
        if (activeOwner.current === owner && owner.version === version) setState((prev) => ({ ...prev, saving: false }));
      });
  }, [rootPath, owner]);

  const set = useCallback<SpecScopeWrite>((scope, enabled) => {
    const id = scope === 'agent' ? agentId : scope === 'session' ? subAgentId : null;
    if (scope !== 'project' && !id) return;
    write('scope', 'POST', { scope, id, enabled });
  }, [agentId, subAgentId, write]);
  const patch = useCallback((preferences: Partial<Pick<SpecReadingSettings, 'strength' | 'roots'>>): void => {
    write('settings', 'PATCH', { settings: preferences });
  }, [write]);
  const waive = useCallback((unitId: string, waived: boolean): void => {
    write('waive', 'POST', { unitId, waived });
  }, [write]);

  const states = specReadingScopeStates(settings, { agentId, subAgentId });
  return { settings, states, effective: states[states.length - 1]?.effective ?? false, saving, loading, set, patch, waive };
}

/** 켜짐·꺼짐·상속 세 모양의 글리프 — 이모지 ❌, lucide 톤 stroke SVG. */
function ScopeGlyph({ own, effective }: { own: boolean | null; effective: boolean }): React.JSX.Element {
  const tone = own === null ? 'text-gray-600' : effective ? 'text-emerald-400' : 'text-gray-500';
  const common = {
    className: `h-3.5 w-3.5 flex-shrink-0 ${tone}`,
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  // 상속은 "이 층엔 아무것도 안 적혀 있다" — 점선 대신 가로줄 하나로 그린다(빈칸은 고장으로 읽힌다).
  if (own === null) return <svg {...common}><path d="M5 12h14" /></svg>;
  if (own) return <svg {...common}><path d="M20 6 9 17l-5-5" /></svg>;
  return <svg {...common}><path d="M18 6 6 18M6 6l12 12" /></svg>;
}

/** 세 층을 한 줄씩 — 누르면 켬 → 끔 → 상속 → 켬. 지금 값과 다음 값은 줄 오른쪽 글에 적는다. */
export const SpecScopeRows = memo(function SpecScopeRows({
  control, agentId, subAgentId,
}: {
  control: SpecScopeControl;
  agentId: string | null | undefined;
  subAgentId: string | null | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  const cycle = (own: boolean | null): boolean | null => (own === null ? true : own ? false : null);
  return (
    <div className="flex flex-col gap-0.5">
      {control.states.map((s) => {
        const id = s.scope === 'agent' ? agentId : s.scope === 'session' ? subAgentId : null;
        const disabled = !s.available || control.saving || control.loading;
        return (
          <button
            key={s.scope}
            type="button"
            data-spec-scope={s.scope}
            disabled={disabled}
            onClick={() => control.set(s.scope, cycle(s.own))}
            title={s.available ? undefined : t('ide.specReading.scope.unavailable')}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
              disabled ? 'cursor-default opacity-40' : 'hover:bg-gray-800'
            }`}
          >
            <ScopeGlyph own={s.own} effective={s.effective} />
            <span className="min-w-0 flex-1 truncate text-[12px] text-gray-300">
              {t(`ide.specReading.scope.${s.scope}`)}
            </span>
            <span className={`flex-shrink-0 text-[12px] ${s.inherited ? 'text-gray-600' : s.own ? 'text-emerald-400' : 'text-gray-500'}`}>
              {s.inherited
                ? t('ide.specReading.scope.inherited')
                : s.own
                  ? t('ide.specReading.scope.on')
                  : t('ide.specReading.scope.off')}
            </span>
            {/* 잔칸이 아니라 실제로 쓰이는 id 임을 밝힌다 — 어느 세션을 켠 것인지 나중에 되짚을 수 있어야 한다. */}
            {!s.available && id === null && s.scope !== 'project' && (
              <span className="flex-shrink-0 text-[12px] text-gray-700">—</span>
            )}
          </button>
        );
      })}
    </div>
  );
});

/** 지금 이 세션에서 정독이 도는가 — 한 줄로 못 박는다(스위치를 눌러도 결론이 안 바뀌는 경우가 있다). */
export const SpecScopeSummary = memo(function SpecScopeSummary({ on }: { on: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <p className={`px-2 text-[12px] leading-snug ${on ? 'text-emerald-400' : 'text-gray-500'}`}>
      {on ? t('ide.specReading.scope.effectiveOn') : t('ide.specReading.scope.effectiveOff')}
    </p>
  );
});
