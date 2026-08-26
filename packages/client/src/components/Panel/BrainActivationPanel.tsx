/**
 * §5.10 v2 (H) — **두뇌 켜기/끄기.**
 *
 * 브레인은 기본 off 로 출고되고, 꺼져 있으면 캔버스에 두뇌 버블조차 뜨지 않는다(게이트 ③).
 * 그래서 **켜는 자리는 두뇌 밖에 있어야 한다** — 이 배너가 그 자리다.
 *
 * 두 얼굴을 가진다:
 * - **첫 실행 안내** — 카드가 잠들어 있는 프로젝트를 처음 열었을 때 딱 한 번. 거절해도
 *   `promptedAt` 이 남아 다시 묻지 않는다(거절을 매번 되묻는 것이 가장 나쁜 UX다).
 * - **축 설정** — 켠 뒤에는 축 6개를 개별로 끄고 켠다(리플렉션만 끄고 스킬은 쓰는 조합이 실제로 있다).
 *
 * 판정은 서버와 같은 함수를 쓰는 `useBrainActivation` 한 곳에서만 온다.
 */
import { useState } from 'react';
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

export function BrainActivationPanel(): React.JSX.Element | null {
  const { t } = useTranslation();
  const brain = useBrainActivation();
  const [dismissed, setDismissed] = useState(false);
  const [axesOpen, setAxesOpen] = useState(false);

  // 켜져 있으면 이 배너는 할 일이 없다 — 축 설정은 두뇌 창 안에서 한다.
  if (brain.enabled) return null;
  if (dismissed) return null;
  if (!brain.shouldPrompt) return null;

  const accept = (): void => {
    void brain.setEnabled(true);
    void brain.markPrompted();
    setDismissed(true);
  };
  const decline = (): void => {
    // 거절해도 기록한다 — 그래야 다시 묻지 않는다.
    void brain.markPrompted();
    setDismissed(true);
  };

  return (
    <div className="pointer-events-auto fixed bottom-4 left-1/2 z-[70] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900/95 p-3 shadow-xl backdrop-blur">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-sky-300"><BrainIcon /></span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-100">
            {t('brain.activation.sleeping', {
              count: brain.sleepingCardCount,
              defaultValue: '이 프로젝트의 두뇌에 기억 {{count}}장이 잠들어 있습니다. 켤까요?',
            })}
          </p>
          <p className="mt-1 text-[12px] leading-snug text-slate-400">
            {t('brain.activation.hint', {
              defaultValue: '두뇌는 기본으로 꺼져 있습니다. 켜면 작업에서 배운 절차를 모아 다음 작업에 자동으로 겁니다. 언제든 다시 끌 수 있고, 꺼도 기록은 지워지지 않습니다.',
            })}
          </p>

          {axesOpen && (
            <div className="mt-2 space-y-0.5 rounded border border-slate-700/70 p-1">
              {brain.axes.map((a) => (
                <AxisRow key={a.id} id={a.id} enabled={a.enabled} onToggle={(next) => void brain.setAxis(a.id, next)} />
              ))}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={accept}
              className="rounded bg-sky-600 px-2.5 py-1 text-xs text-white hover:bg-sky-500"
            >
              {t('brain.activation.turnOn', { defaultValue: '켜기' })}
            </button>
            <button
              type="button"
              onClick={decline}
              className="rounded border border-slate-600 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              {t('brain.activation.notNow', { defaultValue: '지금은 그만' })}
            </button>
            <button
              type="button"
              onClick={() => setAxesOpen((v) => !v)}
              className="rounded px-2 py-1 text-[12px] text-slate-400 hover:text-slate-200"
            >
              {axesOpen
                ? t('brain.activation.hideAxes', { defaultValue: '무엇이 켜지는지 접기' })
                : t('brain.activation.showAxes', { defaultValue: '무엇이 켜지는지 보기' })}
            </button>
          </div>
        </div>
      </div>
    </div>
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
