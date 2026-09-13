/**
 * §5.10 — 자동 목표 켬/끔 **3층 스위치**(프로젝트 · 에이전트 · 세션) + 현황 창구.
 *
 * 사용자 지시는 "정독 키고 끄는 것처럼 똑같이 만들어 — 키고 끄는 적용 되고 말고 하는 부분들"이었다.
 * 그래서 손짓·글리프·3값 순환이 `specReadingScope.tsx` 와 **글자 그대로 같다**: 누르면
 * `켬 → 끔 → 물려받음` 으로 돈다.
 *
 * 이 파일은 그 스위치의 **한 벌**이다. **여기 말고 다른 곳에서 스위치를 다시 그리지 마라** —
 * 두 벌이면 한쪽만 고쳐져 어긋난다(#17-44 ⑤ 와 같은 결).
 *
 * **판정은 여기서 하지 않는다.** 층을 접는 것은 shared 순수 함수(`autoGoalScopeStates`)이고,
 * 서버 집행·프롬프트 블록·화면이 전부 같은 함수를 부른다.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { autoGoalScopeStates } from '@vibisual/shared';
import type { AutoGoalScope, AutoGoalScopeState, AutoGoalSettings, AutoGoalState } from '@vibisual/shared';

/** 한 층에 값을 적거나(`true`/`false`) 지운다(`null` = 위 층에서 물려받기). */
export type AutoGoalScopeWrite = (scope: AutoGoalScope, enabled: boolean | null) => void;

export interface AutoGoalControl {
  states: AutoGoalScopeState[];
  /** 세 층을 다 접은 값 — 집행이 보는 것과 같다. */
  effective: boolean;
  /** 지금 무엇을 보고 있는가(후보·굳은 절차·훑은 수). 아직 못 받았으면 `null`. */
  state: AutoGoalState | null;
  saving: boolean;
  /** 설정을 아직 못 받았다(서버 응답 전). 그동안 스위치는 눌리지 않는다. */
  loading: boolean;
  set: AutoGoalScopeWrite;
  /** 후보 하나를 물린다 — 다시 제안하지 않는다(관찰은 계속된다). */
  dismiss: (candidateId: string) => void;
  /** 굳은 절차 한 장을 지운다. 함께 물려 두지 않으면 다음 분석이 곧바로 다시 짓는다. */
  removeSkill: (skillId: string, candidateId?: string) => void;
}

/**
 * 이 프로젝트의 자동 목표 설정·현황을 받아 3층 상태로 접고, 한 칸만 갈아 끼우는 창구를 연다.
 *
 * 저장은 **전량 교체가 아니라** 전용 창구(`POST /scope`)로 간다 — 전량으로 보내면 화면이 모르는
 * 값(물린 후보 목록)이 함께 실려 나가 사용자가 물린 기록이 통째로 되살아난다(§4 `agent-config` 사고).
 *
 * 현황(`state`)은 **같은 응답에 실려 온다.** 켜는 순간 바로 "지금 무엇이 보이나"가 바뀌어야 하므로
 * 쓰기 응답도 현황을 다시 받아 온다 — 스위치를 눌렀는데 목록이 그대로면 켜진 건지 알 수 없다.
 */
export function useAutoGoalScope(
  rootPath: string | null | undefined,
  agentId: string | null | undefined,
  subAgentId: string | null | undefined,
): AutoGoalControl {
  const [settings, setSettings] = useState<AutoGoalSettings | null>(null);
  const [state, setState] = useState<AutoGoalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 뜬 채로 응답이 늦게 오면 언마운트 뒤 setState 가 돈다 — 그 경고를 막는 것이 아니라
  //   **닫힌 창의 상태를 되살리지 않으려는** 것이다.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(() => {
    if (!rootPath) { setLoading(false); return; }
    const q = new URLSearchParams({ projectPath: rootPath });
    if (agentId) q.set('agentId', agentId);
    if (subAgentId) q.set('subAgentId', subAgentId);
    void fetch(`/api/auto-goal/state?${q.toString()}`)
      .then((r) => r.json())
      .then((body: { ok?: boolean; state?: AutoGoalState; settings?: AutoGoalSettings | null }) => {
        if (!alive.current) return;
        if (body.ok) {
          setSettings(body.settings ?? null);
          setState(body.state ?? null);
        }
        setLoading(false);
      })
      // 못 받아도 화면은 선다 — 스위치가 "안 정함"으로 보일 뿐이고, 누르면 서버가 지금 값을 읽어 고친다.
      .catch(() => { if (alive.current) setLoading(false); });
  }, [rootPath, agentId, subAgentId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  /** 쓰기 한 벌 — 저장하고, 저장된 값으로 갈아 끼우고, 현황을 다시 받아 온다. */
  const post = useCallback((url: string, body: unknown, method = 'POST') => {
    if (!rootPath || saving) return;
    setSaving(true);
    void fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
      .then((r) => r.json())
      .then((res: { ok?: boolean; settings?: AutoGoalSettings }) => {
        // 서버가 돌려준 **저장된 값**으로 갈아 낀다 — 낙관적 갱신을 하면 서버가 접은 결과(칸 상한 등)와
        //   화면이 갈린다.
        if (alive.current && res.ok && res.settings) setSettings(res.settings);
      })
      .catch(() => { /* 실패하면 화면은 그대로 — 다음 누름이 다시 시도한다 */ })
      .finally(() => {
        if (!alive.current) return;
        setSaving(false);
        load();
      });
  }, [rootPath, saving, load]);

  const set = useCallback<AutoGoalScopeWrite>((scope, enabled) => {
    const id = scope === 'agent' ? agentId : scope === 'session' ? subAgentId : null;
    if (scope !== 'project' && !id) return;
    post('/api/auto-goal/scope', { projectPath: rootPath, scope, id, enabled });
  }, [post, rootPath, agentId, subAgentId]);

  const dismiss = useCallback((candidateId: string) => {
    post('/api/auto-goal/dismiss', { projectPath: rootPath, candidateId, dismissed: true });
  }, [post, rootPath]);

  const removeSkill = useCallback((skillId: string, candidateId?: string) => {
    if (!rootPath) return;
    const q = new URLSearchParams({ projectPath: rootPath });
    if (candidateId) q.set('candidateId', candidateId);
    post(`/api/auto-goal/skills/${encodeURIComponent(skillId)}?${q.toString()}`, undefined, 'DELETE');
  }, [post, rootPath]);

  const states = autoGoalScopeStates(settings, { agentId, subAgentId });
  return {
    states,
    effective: states[states.length - 1]?.effective ?? false,
    state,
    saving,
    loading,
    set,
    dismiss,
    removeSkill,
  };
}

/** 켜짐·꺼짐·상속 세 모양의 글리프 — 이모지 ❌, lucide 톤 stroke SVG(정독과 같은 그림). */
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

/**
 * 세 층을 한 줄씩. **누르면 켬 → 끔 → 물려받음 → 켬** 으로 돈다.
 *
 * 3값을 두 개의 버튼으로 나누지 않는 이유는 208px 사이드바에서 버튼 여섯 개가 서면 무엇을 누르는지
 * 읽히지 않기 때문이다. 지금 값과 다음 값은 줄 오른쪽 글에 그대로 적는다.
 */
export const AutoGoalScopeRows = memo(function AutoGoalScopeRows({
  control, agentId, subAgentId,
}: {
  control: AutoGoalControl;
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
            data-auto-goal-scope={s.scope}
            disabled={disabled}
            onClick={() => control.set(s.scope, cycle(s.own))}
            title={s.available ? undefined : t('ide.autoGoal.scope.unavailable')}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
              disabled ? 'cursor-default opacity-40' : 'hover:bg-gray-800'
            }`}
          >
            <ScopeGlyph own={s.own} effective={s.effective} />
            <span className="min-w-0 flex-1 truncate text-[12px] text-gray-300">
              {t(`ide.autoGoal.scope.${s.scope}`)}
            </span>
            <span className={`flex-shrink-0 text-[12px] ${s.inherited ? 'text-gray-600' : s.own ? 'text-emerald-400' : 'text-gray-500'}`}>
              {s.inherited
                ? t('ide.autoGoal.scope.inherited')
                : s.own
                  ? t('ide.autoGoal.scope.on')
                  : t('ide.autoGoal.scope.off')}
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

/** 지금 이 세션에서 자동 목표가 도는가 — 한 줄로 못 박는다(스위치를 눌러도 결론이 안 바뀌는 경우가 있다). */
export const AutoGoalScopeSummary = memo(function AutoGoalScopeSummary({ on }: { on: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <p className={`px-2 text-[12px] leading-snug ${on ? 'text-emerald-400' : 'text-gray-500'}`}>
      {on ? t('ide.autoGoal.scope.effectiveOn') : t('ide.autoGoal.scope.effectiveOff')}
    </p>
  );
});
