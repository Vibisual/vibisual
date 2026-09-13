/**
 * §5.5 #17-44 ⑧ — 정독 켬/끔 **3층 스위치**(프로젝트 · 에이전트 · 세션).
 *
 * 종전에 이 기능을 켜는 손잡이는 §5.11 플러그인 창의 `spec-driven` 토글 하나뿐이었다. 기능을 만나는
 * 자리(활동바)와 켜는 자리(모달 안 111장 목록)가 달라 **끄려면 어디로 가야 하는지가 화면에 없었고**,
 * 축이 프로젝트 하나라 "이 프로젝트는 켜되 지금 이 세션만 끄기"가 구조적으로 불가능했다.
 *
 * 이 파일은 그 스위치의 **한 벌**이다. 한때 활동바 팝오버와 정독 뷰 두 자리가 이것을 함께 썼고,
 * 지금은 팝오버가 없어져(#17-44 ⑧(c) — 활동바 클릭은 다른 항목과 똑같이 뷰를 연다) 정독 뷰의
 * 세 화면이 쓴다. **여기 말고 다른 곳에서 스위치를 다시 그리지 마라** — 두 벌이면 한쪽만 고쳐져
 * 어긋난다(#17-44 ⑤ 가 배지·목록에 대해 세운 규약과 같은 결).
 *
 * **판정은 여기서 하지 않는다.** 층을 접는 것은 shared 순수 함수(`specReadingScopeStates`)이고,
 * 서버 집행·게이트·배지가 전부 같은 함수를 부른다(§5.11 v4.65 규율).
 */
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { specReadingScopeStates } from '@vibisual/shared';
import type { SpecReadingScope, SpecReadingScopeState, SpecReadingSettings } from '@vibisual/shared';

/** 한 층에 값을 적거나(`true`/`false`) 지운다(`null` = 위 층에서 물려받기). */
export type SpecScopeWrite = (scope: SpecReadingScope, enabled: boolean | null) => void;

export interface SpecScopeControl {
  states: SpecReadingScopeState[];
  /** 세 층을 다 접은 값 — 배지·집행이 보는 것과 같다. */
  effective: boolean;
  saving: boolean;
  /** 설정을 아직 못 받았다(서버 응답 전). 그동안 스위치는 눌리지 않는다. */
  loading: boolean;
  set: SpecScopeWrite;
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
  const [settings, setSettings] = useState<SpecReadingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!rootPath) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    void fetch(`/api/spec-reading/settings?projectPath=${encodeURIComponent(rootPath)}`)
      .then((r) => r.json())
      .then((body: { ok?: boolean; settings?: SpecReadingSettings | null }) => {
        if (!alive) return;
        if (body.ok) setSettings(body.settings ?? null);
        setLoading(false);
      })
      // 못 받아도 화면은 선다 — 스위치가 "안 정함"으로 보일 뿐이고, 누르면 서버가 지금 값을 읽어 고친다.
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [rootPath]);

  const set = useCallback<SpecScopeWrite>((scope, enabled) => {
    if (!rootPath || saving) return;
    const id = scope === 'agent' ? agentId : scope === 'session' ? subAgentId : null;
    if (scope !== 'project' && !id) return;
    setSaving(true);
    void fetch('/api/spec-reading/scope', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: rootPath, scope, id, enabled }),
    })
      .then((r) => r.json())
      .then((body: { ok?: boolean; settings?: SpecReadingSettings }) => {
        // 서버가 돌려준 **저장된 값**으로 갈아 낀다 — 낙관적 갱신을 하면 서버가 접은 결과(칸 상한 등)와
        //   화면이 갈린다.
        if (body.ok && body.settings) setSettings(body.settings);
      })
      .catch(() => { /* 실패하면 화면은 그대로 — 다음 누름이 다시 시도한다 */ })
      .finally(() => setSaving(false));
  }, [rootPath, agentId, subAgentId, saving]);

  const states = specReadingScopeStates(settings, { agentId, subAgentId });
  return { states, effective: states[states.length - 1]?.effective ?? false, saving, loading, set };
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

/**
 * 세 층을 한 줄씩. **누르면 켬 → 끔 → 상속 → 켬** 으로 돈다.
 *
 * 3값을 두 개의 버튼으로 나누지 않는 이유는 40px 남짓한 팝오버 폭에서 버튼 여섯 개가 서면 무엇을
 * 누르는지 읽히지 않기 때문이다. 지금 값과 다음 값은 줄 오른쪽 글에 그대로 적는다.
 */
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
