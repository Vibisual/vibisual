/**
 * §5.10 (H) — **두뇌 켜기/끄기 UI.**
 *
 * 브레인은 기본 off 로 출고되고, 꺼져 있으면 캔버스에 두뇌 버블조차 뜨지 않는다(게이트 ③).
 * 그래서 **켜는 자리는 두뇌 밖에 있어야 한다** — 설정 창 `Project Brain` 탭(`BrainSettingsTab`)과
 * 캔버스 우클릭 메뉴, 이 둘이 상시 입구다.
 *
 * **첫 실행 안내 배너는 폐기됐다(사용자 결정 2026-08-26).** 예전에는 카드가 잠들어 있는 프로젝트를
 * 처음 열면 화면 아래에 "N장이 잠들어 있습니다. 켤까요?" 배너(`BrainActivationPanel`)가 떴다.
 * 사용자가 그 배너를 보고 싶지 않다고 명시해, 배너와 그것만 쓰던 `shouldPrompt`/`markPrompted`
 * 배선을 함께 걷어냈다. **되살리지 말 것** — 켜기는 위 두 입구에서만 한다.
 *
 * 판정은 서버와 같은 함수를 쓰는 `useBrainActivation` 한 곳에서만 온다.
 */
import { useTranslation } from 'react-i18next';
import type { BrainAxisId } from '@vibisual/shared';
import { useBrainActivation } from '../../hooks/useBrainActivation.js';

/** 축 설명 — 키가 없으면 여기 기본 문구가 쓰인다(i18n 동기화 전에도 읽을 수 있게). */
const AXIS_LABELS: Record<BrainAxisId, { title: string; hint: string }> = {
  skills: { title: '절차 기억', hint: '복잡한 작업의 절차를 굳혀 다음에 자동으로 건다' },
  recall: { title: '회상', hint: '카드에 없어도 과거 세션 본문에서 찾는다' },
  nudge: { title: '넛지', hint: '작업 중에 배운 것을 남기도록 가끔 찔러 준다' },
  grounding: { title: '근거 검증', hint: '저장할 때 코드와 대조해 통과하면 확인됨으로 올린다' },
  curator: { title: '큐레이터', hint: '분류가 안 된 카드·안 읽히는 카드를 모아 보여준다' },
  operator: { title: '운영자 프로필', hint: '반복해서 드러난 작업 방식을 이 기기에만 기록한다' },
};

function CheckIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function BrainIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M12 5a3 3 0 0 0-3 3 3 3 0 0 0-3 3 3 3 0 0 0 1 2.2A3 3 0 0 0 9 19h6a3 3 0 0 0 2-5.8A3 3 0 0 0 18 11a3 3 0 0 0-3-3 3 3 0 0 0-3-3Z" />
      <path d="M12 5v14" />
    </svg>
  );
}

/** 축 한 줄 — 체크박스 대신 눌러서 켜고 끄는 칩. */
function AxisRow(props: {
  id: BrainAxisId;
  enabled: boolean;
  onToggle: (next: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const meta = AXIS_LABELS[props.id];
  return (
    <button
      type="button"
      onClick={() => props.onToggle(!props.enabled)}
      className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors ${
        props.enabled ? 'bg-slate-700/40 hover:bg-slate-700/60' : 'hover:bg-slate-800/60'
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          props.enabled ? 'border-sky-400 bg-sky-500/20 text-sky-300' : 'border-slate-600 text-transparent'
        }`}
      >
        <CheckIcon />
      </span>
      <span className="min-w-0">
        <span className={`block text-xs ${props.enabled ? 'text-slate-100' : 'text-slate-400'}`}>
          {t(`brain.axis.${props.id}.title`, { defaultValue: meta.title })}
        </span>
        <span className="block text-[12px] leading-snug text-slate-500">
          {t(`brain.axis.${props.id}.hint`, { defaultValue: meta.hint })}
        </span>
      </span>
    </button>
  );
}

/** 두뇌 창 안에서 쓰는 축 설정 목록 — 켠 뒤의 조정 자리. */
export function BrainAxisSettings(): React.JSX.Element | null {
  const { t } = useTranslation();
  const brain = useBrainActivation();
  if (!brain.enabled) return null;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[12px] text-slate-400">
          {t('brain.activation.axesTitle', { defaultValue: '무엇을 켜 둘까요' })}
        </span>
        <button
          type="button"
          onClick={() => void brain.setEnabled(false)}
          className="rounded px-2 py-0.5 text-[12px] text-slate-500 hover:bg-slate-800 hover:text-slate-300"
        >
          {t('brain.activation.turnOff', { defaultValue: '두뇌 끄기' })}
        </button>
      </div>
      {brain.axes.map((a) => (
        <AxisRow key={a.id} id={a.id} enabled={a.enabled} onToggle={(next) => void brain.setAxis(a.id, next)} />
      ))}
      <p className="px-2 pt-1 text-[12px] leading-snug text-slate-500">
        {t('brain.activation.offKeepsData', { defaultValue: '꺼도 기록은 지워지지 않습니다 — 다시 켜면 그 자리에서 이어집니다.' })}
      </p>
    </div>
  );
}

/**
 * §5.10 (H) — **설정 창 `brain` 카테고리 본문.**
 *
 * `BrainAxisSettings` 와 갈리는 점은 하나다: 저건 **켠 뒤**의 조정 자리라 꺼져 있으면 스스로 사라지지만,
 * 여기는 **꺼져 있을 때 켜는 자리**라 마스터 스위치를 자기 안에 들고 있어야 한다. 두뇌가 꺼지면 버블도
 * 라이브러리도 사라지므로, 이 화면과 캔버스 우클릭이 켜기의 **상시 입구**다.
 *
 * 즉시 반영이라 Apply/dirty 대상이 아니다(§5.11 플러그인 창과 같은 문법 — 같은 창에서 켜고 끄고, 재시작 ❌).
 */
export function BrainSettingsTab(): React.JSX.Element {
  const { t } = useTranslation();
  const brain = useBrainActivation();

  if (!brain.projectPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <span className="text-slate-500"><BrainIcon /></span>
        <p className="text-sm text-gray-400">
          {t('brain.activation.noProject', { defaultValue: '열려 있는 프로젝트가 없습니다' })}
        </p>
        <p className="text-[12px] text-gray-600">
          {t('brain.activation.noProjectDesc', { defaultValue: '두뇌는 프로젝트마다 따로 켜고 끕니다 — 프로젝트를 먼저 여세요.' })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 마스터 스위치 — 이 화면의 본체. 상태를 문장으로 먼저 말하고 버튼을 오른쪽에 둔다. */}
      <div className="flex items-start justify-between gap-3 rounded border border-gray-700 bg-gray-800/40 p-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className={`mt-0.5 ${brain.enabled ? 'text-indigo-400' : 'text-gray-500'}`}><BrainIcon /></span>
          <div className="min-w-0">
            <p className="text-sm text-gray-200">
              {brain.enabled
                ? t('brain.activation.stateOn', { defaultValue: '이 프로젝트의 두뇌가 켜져 있습니다' })
                : t('brain.activation.stateOff', { defaultValue: '이 프로젝트의 두뇌가 꺼져 있습니다' })}
            </p>
            <p className="mt-0.5 break-all text-[12px] text-gray-500">{brain.projectPath}</p>
            {brain.sleepingCardCount > 0 && !brain.enabled && (
              <p className="mt-1 text-[12px] text-gray-400">
                {t('brain.activation.sleepingCount', {
                  count: brain.sleepingCardCount,
                  defaultValue: '기억 {{count}}장이 잠들어 있습니다',
                })}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void brain.setEnabled(!brain.enabled)}
          className={`shrink-0 rounded px-3 py-1.5 text-xs transition-colors ${
            brain.enabled
              ? 'border border-gray-600 text-gray-300 hover:bg-gray-700'
              : 'bg-indigo-600 text-white hover:bg-indigo-500'
          }`}
        >
          {brain.enabled
            ? t('brain.activation.turnOff', { defaultValue: '두뇌 끄기' })
            : t('brain.activation.turnOn', { defaultValue: '켜기' })}
        </button>
      </div>

      {/* 축 6개 — 켜져 있을 때만 조정할 수 있다(마스터가 꺼지면 축은 볼 것도 없이 false 다). */}
      {brain.enabled ? (
        <div className="rounded border border-gray-700 bg-gray-800/20 p-1">
          <p className="px-2 py-1 text-[12px] text-gray-400">
            {t('brain.activation.axesTitle', { defaultValue: '무엇을 켜 둘까요' })}
          </p>
          {brain.axes.map((a) => (
            <AxisRow key={a.id} id={a.id} enabled={a.enabled} onToggle={(next) => void brain.setAxis(a.id, next)} />
          ))}
        </div>
      ) : (
        <p className="text-[12px] leading-snug text-gray-500">
          {t('brain.activation.hint', {
            defaultValue: '두뇌는 기본으로 꺼져 있습니다. 켜면 작업에서 배운 절차를 모아 다음 작업에 자동으로 겁니다. 언제든 다시 끌 수 있고, 꺼도 기록은 지워지지 않습니다.',
          })}
        </p>
      )}

      <p className="text-[12px] leading-snug text-gray-500">
        {t('brain.activation.offKeepsData', { defaultValue: '꺼도 기록은 지워지지 않습니다 — 다시 켜면 그 자리에서 이어집니다.' })}
      </p>
    </div>
  );
}
