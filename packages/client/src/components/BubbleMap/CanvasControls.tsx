import { useCallback, useEffect, useState } from 'react';
import { Panel, useReactFlow, useStore, useStoreApi } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useIsNarrowViewport } from '../../hooks/useIsMobile';
import {
  HEATMAP_RAMP,
  HEATMAP_ZERO_COLOR,
  HEAT_CURVES,
  HEAT_LEGEND_TICKS,
  TIDY_SORTS,
  formatHeatCount,
  heatLegendTicks,
  normalizeHeatCurve,
} from '@vibisual/shared';
import type { TidySort } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore';
// §5.24 — 색·지름이 쓰는 척도 한 벌을 범례도 그대로 받는다(따로 조합하면 눈금만 다른 곡선을 본다).
import { useHeatScale } from '../../hooks/useHeatScale.js';
import {
  Glyph,
  CtrlButton,
  CtrlPanel,
  PlusIcon,
  MinusIcon,
  FitIcon,
} from './canvasControlKit.js';

const LockIcon = (): React.JSX.Element => (
  <Glyph>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Glyph>
);
const UnlockIcon = (): React.JSX.Element => (
  <Glyph>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </Glyph>
);
const FullscreenIcon = (): React.JSX.Element => (
  <Glyph>
    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
  </Glyph>
);
const ExitFullscreenIcon = (): React.JSX.Element => (
  <Glyph>
    <path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M3 16h3a2 2 0 0 1 2 2v3M21 16h-3a2 2 0 0 0-2 2v3" />
  </Glyph>
);
// §5.4 #33 버블 정리 — 지팡이. 조준경(FitIcon)·불꽃(HeatIcon)과 실루엣이 겹치지 않아
// 14px 에서도 무엇인지 바로 갈린다. "알아서 자리를 잡아 준다"를 한 글리프로 말하는 기호다.
const TidyIcon = (): React.JSX.Element => (
  <Glyph>
    <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M12.2 6.2 11 5M3 21l9-9" />
  </Glyph>
);

// §5.24 읽기 히트맵 — 불꽃. "열"을 한 글리프로 말하는 가장 짧은 기호다.
const HeatIcon = (): React.JSX.Element => (
  <Glyph>
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z" />
  </Glyph>
);
const RefreshIcon = ({ spinning }: { spinning?: boolean }): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`h-3.5 w-3.5 pointer-coarse:h-5 pointer-coarse:w-5 ${spinning ? 'animate-spin' : ''}`}
    aria-hidden="true"
  >
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);

// §5.24 축 토글 — 읽기(눈)·쓰기(연필). 이모지 ❌, lucide 톤 stroke SVG 만.
const ReadAxisIcon = (): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true"
  >
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const WriteAxisIcon = (): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

/** §5.24 — 범례 안의 축 버튼 하나. 활성 표기는 캔버스 컨트롤 토글과 같은 톤(blue). */
function AxisButton({ active, label, onClick, children }: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={`flex items-center gap-1 px-1.5 py-0.5 text-[12px] leading-none transition-colors pointer-coarse:px-2.5 pointer-coarse:py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-400 ${
        active
          ? 'bg-blue-500/25 font-medium text-blue-200'
          : 'text-gray-400 hover:bg-blue-500/15 hover:text-blue-200'
      }`}
    >
      {children}
      {label}
    </button>
  );
}

/**
 * §5.24 — 히트 범례. **이것이 "상대적"이라는 말을 화면에서 성립시키는 유일한 장치다** —
 * 숫자가 없으면 사용자는 색이 절대 기준인지 상대 기준인지 알 수 없다.
 *
 * **지금 무슨 축을·어느 곡선으로 보고 있는지도 여기 하나가 말한다**(축 토글 + 척도 선택).
 * 컨트롤 버튼의 이름을 축 중립으로 둔 이유가 그것이다 — 두 곳이 같은 사실을 말하면 한쪽만 고쳐진다.
 *
 * **눈금은 곡선을 따라간다.** 로그 척도에서 램프 한가운데는 `max/2` 가 아니라 훨씬 낮은 값이라,
 * 눈금 없이 곡선만 갈면 범례가 거짓말을 한다. 그래서 눈금은 색·지름이 쓰는 **척도 한 벌**에서
 * 그대로 나온다(따로 조합하면 한 프레임 어긋나 다른 곡선의 숫자가 적힌다).
 *
 * 값이 0 인(=그 축으로 아직 아무 일도 없는) 프로젝트에서는 램프 대신 한 줄만 둔다 —
 * 0 을 최대로 둔 램프는 모든 버블이 최고온으로 그려져 거짓말이 된다. **그때도 토글은 살아 있다**
 * (쓰기가 비어 있다고 읽기로 돌아갈 길이 막히면 사용자가 갇힌다). 척도 선택도 같은 이유로 남는다.
 */
function HeatLegend(): React.JSX.Element {
  const { t } = useTranslation();
  const axis = useGraphStore((s) => s.heatAxis);
  const setHeatAxis = useGraphStore((s) => s.setHeatAxis);
  const curve = useGraphStore((s) => s.heatCurve);
  const setHeatCurve = useGraphStore((s) => s.setHeatCurve);
  // 색·지름이 쓰는 **그 척도 한 벌**을 그대로 받는다(§5.24) — 범례가 따로 조합하면 눈금만 다른
  //   곡선·다른 축을 보게 된다. 이 컴포넌트는 히트맵이 켜져 있을 때만 그려지므로 값이 있다.
  const scale = useHeatScale();
  const max = scale?.max ?? 0;
  const isWrite = axis === 'write';
  const showRead = useCallback(() => setHeatAxis('read'), [setHeatAxis]);
  const showWrite = useCallback(() => setHeatAxis('write'), [setHeatAxis]);
  const onCurveChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => setHeatCurve(normalizeHeatCurve(e.target.value)),
    [setHeatCurve],
  );
  const ticks = scale ? heatLegendTicks(scale, HEAT_LEGEND_TICKS) : [];
  return (
    <div className="rounded-lg border border-white/10 bg-gray-900/60 px-2 py-1.5 shadow-md shadow-black/30 backdrop-blur-md">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium text-gray-300">
          {isWrite ? t('canvas.heatmap.titleWrite') : t('canvas.heatmap.title')}
        </span>
        <div className="flex overflow-hidden rounded-md border border-white/10 divide-x divide-white/10">
          <AxisButton active={!isWrite} label={t('canvas.heatmap.axisRead')} onClick={showRead}>
            <ReadAxisIcon />
          </AxisButton>
          <AxisButton active={isWrite} label={t('canvas.heatmap.axisWrite')} onClick={showWrite}>
            <WriteAxisIcon />
          </AxisButton>
        </div>
      </div>
      {max <= 0 ? (
        <div className="text-[12px] text-gray-500">
          {isWrite ? t('canvas.heatmap.emptyWrite') : t('canvas.heatmap.empty')}
        </div>
      ) : (
        <div className="flex items-start gap-1.5">
          <span className="text-[12px] leading-4 tabular-nums text-gray-500">0</span>
          <div className="w-36">
            {/* 램프는 런타임 상수 배열에서 오므로 Tailwind 클래스로 표현할 수 없다 —
                동적 색은 캔버스 전반과 같이 style 로 준다(버블 본체 색과 같은 예외).
                `mt-1` 은 8px 램프의 가운데를 양옆 16px 글줄의 가운데에 맞춘다. */}
            <div
              className="relative mt-1 h-2 w-full rounded-sm ring-1 ring-inset ring-white/10"
              style={{ background: `linear-gradient(to right, ${HEATMAP_ZERO_COLOR} 0%, ${HEATMAP_RAMP.join(', ')})` }}
            >
              {ticks.map((tick) => (
                <span
                  key={tick.ratio}
                  className="pointer-events-none absolute top-0 h-full w-px bg-black/50"
                  style={{ left: `${tick.ratio * 100}%` }}
                />
              ))}
            </div>
            {/* 눈금 숫자 — **곡선을 갈면 이 숫자들이 함께 움직인다.** 이것이 없으면 사용자는
                램프 한가운데가 몇 회인지 알 수 없고, 그러면 곡선을 바꾼 것이 화면에서 확인되지 않는다.
                접힌 값(`1.2k`)의 정확한 수는 `title` 에 그대로 남는다. */}
            <div className="relative mt-0.5 h-4">
              {ticks.map((tick) => (
                <span
                  key={tick.ratio}
                  className="absolute top-0 -translate-x-1/2 text-[12px] leading-4 tabular-nums text-gray-500"
                  style={{ left: `${tick.ratio * 100}%` }}
                  title={t('canvas.heatmap.max', { n: Math.round(tick.count).toLocaleString() })}
                >
                  {formatHeatCount(tick.count)}
                </span>
              ))}
            </div>
          </div>
          <span className="text-[12px] leading-4 tabular-nums text-gray-300">
            {t('canvas.heatmap.max', { n: max.toLocaleString() })}
          </span>
        </div>
      )}
      {/* §5.24 척도 곡선 — 롱테일에서 어느 곡선이 맞는지는 **지금 보고 있는 분포**가 정하므로,
          우리가 미리 고르지 않고 손잡이를 낸다. 기본값은 `DEFAULT_HEAT_CURVE`(로그).
          옵션이 다섯이라 분절 버튼 대신 네이티브 select 를 쓴다(범례 카드가 넓어지지 않게).

          **펼친 목록은 우리 카드의 배경을 물려받지 않는다.** 네이티브 팝업은 별도의 창이라 손잡이의
          반투명 배경(`bg-gray-900/40`)이 팝업의 흰 바탕과 합성돼 밝은 회색이 되고, 그 위에 얹힌
          `text-gray-300` 글자가 묻힌다(사용자 보고 "펼쳤을 때 흰색이라 잘 안 보인다"). 그래서
          ① `<option>` 에 **불투명** 배경과 밝은 글자를 직접 주고 — 손잡이 색을 진하게 바꾸는 것으로는
          팝업이 따라오지 않는다 — ② `color-scheme: dark` 로 팝업 자신의 바탕·선택 강조·스크롤바까지
          어두운 쪽을 고르게 한다(강조색은 OS 가 칠하므로 우리 클래스가 닿지 않는 유일한 자리다).

          **이름만으로는 무엇을 고르는지 알 수 없다** — "제곱근"이 지도를 어떻게 바꾸는지는 이름에
          없다. 곡선마다 설명을 `title` 로 붙이고, 닫힌 손잡이에도 **지금 고른 곡선의 설명**을 함께
          띄운다(팝업 안 툴팁을 그리지 않는 OS 에서도 설명에 닿을 길이 남는다 — mac 은 네이티브 메뉴다). */}
      <div className="mt-1 flex items-center gap-1.5">
        <span className="text-[12px] text-gray-500">{t('canvas.heatmap.curveLabel')}</span>
        <select
          value={curve}
          onChange={onCurveChange}
          title={`${t('canvas.heatmap.curveHint')} — ${t(`canvas.heatmap.curveRule.${curve}`)}`}
          aria-label={t('canvas.heatmap.curveLabel')}
          className="cursor-pointer rounded border border-gray-700/50 bg-gray-900/40 px-1 py-0 text-[12px] text-gray-300 outline-none [color-scheme:dark] hover:border-gray-600 focus:border-blue-500"
        >
          {HEAT_CURVES.map((c) => (
            <option
              key={c}
              value={c}
              title={t(`canvas.heatmap.curveRule.${c}`)}
              className="bg-gray-900 text-gray-100"
            >
              {t(`canvas.heatmap.curve.${c}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// §5.4 #33 (I) 정렬 기준 다섯 — lucide 톤 stroke SVG(이모지 ❌). 14px 에서도 서로 갈리도록
//   실루엣을 겹치지 않게 골랐다: 파형(급함) · 짝짓기(종류) · 막대(양) · 시계(시간) · 갈래(무리).
const SortStatusIcon = (): React.JSX.Element => (
  <Glyph><path d="M3 12h3l3-8 4 16 3-8h5" /></Glyph>
);
const SortKindIcon = (): React.JSX.Element => (
  <Glyph>
    <circle cx="6" cy="7" r="3" />
    <circle cx="6" cy="17" r="3" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="14" width="6" height="6" rx="1" />
  </Glyph>
);
const SortHeatIcon = (): React.JSX.Element => (
  <Glyph><path d="M4 20V5M10 20v-7M16 20v-4M21 20v-2" /></Glyph>
);
const SortRecentIcon = (): React.JSX.Element => (
  <Glyph>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </Glyph>
);
const SortLineageIcon = (): React.JSX.Element => (
  <Glyph>
    <circle cx="12" cy="5" r="2.5" />
    <circle cx="5" cy="19" r="2.5" />
    <circle cx="19" cy="19" r="2.5" />
    <path d="M12 7.5v3.5M12 11H5.8M12 11h6.2M5.5 11v5.5M18.5 11v5.5" />
  </Glyph>
);

/** 기준 → 글리프. `TIDY_SORTS` 에 줄을 더하면 여기도 한 줄 — 빠뜨리면 타입 검사가 잡는다. */
const SORT_ICONS: Record<TidySort, () => React.JSX.Element> = {
  status: SortStatusIcon,
  kind: SortKindIcon,
  heat: SortHeatIcon,
  recent: SortRecentIcon,
  lineage: SortLineageIcon,
};

/**
 * §5.4 #33 (I) — 정리 기준 한 줄. 활성 표기는 범례 축 토글(`AxisButton`)과 같은 톤(blue)이다.
 *
 * **이름만으로는 지도가 어떻게 바뀌는지 알 수 없다** — "무리끼리"가 무엇으로 무리를 짓는지는
 * 이름에 없다. 그래서 설명을 한 줄 곁들인다(§5.24 척도 선택이 곡선마다 설명을 붙인 것과 같은
 * 이유). 잠겨 있을 때도 **줄을 숨기지 않는다** — 자리가 튀면 무엇이 사라졌는지 알 수 없다.
 */
function SortRow({ sort, active, disabled, onPick }: {
  sort: TidySort;
  active: boolean;
  disabled: boolean;
  onPick: (sort: TidySort) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const Icon = SORT_ICONS[sort];
  const name = t(`canvas.tidy.sort.${sort}`);
  const rule = t(`canvas.tidy.sortRule.${sort}`);
  const handleClick = useCallback(() => onPick(sort), [onPick, sort]);
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-pressed={active}
      title={`${name} — ${rule}`}
      className={`flex w-full items-center gap-2 px-2 py-1 text-left transition-colors pointer-coarse:py-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-400 ${
        disabled
          ? 'cursor-not-allowed text-gray-600'
          : active
            ? 'bg-blue-500/25 text-blue-200'
            : 'text-gray-400 hover:bg-blue-500/15 hover:text-blue-200'
      }`}
    >
      <span className="shrink-0"><Icon /></span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[12px] leading-tight ${active ? 'font-medium' : ''}`}>{name}</span>
        {/* 좁은 화면에서는 설명을 접는다 — 다섯 줄이 두 행씩이면 컨트롤 무리와 함께 화면 밖으로
            넘친다. **지우는 것이 아니라 접는 것**이라 설명은 버튼의 `title` 에 그대로 남는다
            (§9 "폰에서는 지우지 말고 접어라"). 글자 크기는 접든 펴든 한글 가독 하한 12px 이다. */}
        <span className="block truncate text-[12px] leading-tight text-gray-500 max-sm:hidden">{rule}</span>
      </span>
    </button>
  );
}

/**
 * §5.4 #33 (I) **정리 기준 패널** — 정리 버튼이 여는 카드. §5.24 히트맵 범례와 **같은 자리·같은
 * 톤**이라, 캔버스를 다시 칠하는 손잡이와 다시 앉히는 손잡이가 한 부류로 읽힌다.
 *
 * **고르는 즉시 돈다**(적용 버튼 ❌) — 그래야 "이건 아니네"하고 바로 다른 기준을 누를 수 있다.
 * 그래서 누른 뒤에도 **패널은 닫히지 않는다.**
 *
 * `heat` 줄만 부제가 붙는다 — 그 축(읽기/쓰기)은 §5.24 히트맵이 쥐고 있어서, 여기서 축을 또
 * 고르게 하면 같은 사실을 말하는 곳이 둘이 된다(한쪽만 고쳐진다).
 */
function TidySortPanel({ disabled, onPick }: {
  disabled: boolean;
  onPick: (sort: TidySort) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const current = useGraphStore((s) => s.tidySort);
  const heatAxis = useGraphStore((s) => s.heatAxis);
  /**
   * 제목 옆 한 자리가 **이 패널의 지금 사정을 전부 말한다.** 급한 순서대로 하나만 고른다 —
   * 못 돈다는 사실이 어느 축을 보는지보다 급하고, 그 둘이 없을 때만 원래의 안내가 선다.
   *
   * 종전에는 이 셋이 각자 제 줄을 갖고 **있을 때만 나타났다.** 그래서 기준을 누를 때마다
   * 카드가 한 줄씩 자랐다 줄었다 했고(사용자 지적: "사이즈가 갑자기 커졌다 작아졌다"),
   * 잠김 문구는 목록 아래에 불쑥 나타나 어디서 온 말인지 알 수 없었다. 자리를 하나로 모으면
   * **줄 수가 상수**가 되어 카드 높이가 고정되고, 바뀌는 것은 이 한 줄의 글자뿐이다.
   *
   * `heat` 의 축은 §5.24 범례의 **제목 키를 그대로 빌려 쓴다**(`읽은 횟수`/`쓴 횟수`) —
   * 같은 사실을 위해 새 문장을 지으면 로케일마다 갈리고, 범례와 다른 말이 될 자리가 생긴다.
   */
  const hint = disabled
    ? t('canvas.controls.tidyUnavailable')
    : current === 'heat'
      ? (heatAxis === 'write' ? t('canvas.heatmap.titleWrite') : t('canvas.heatmap.title'))
      : t('canvas.tidy.panelHint');
  return (
    <div className="w-60 rounded-lg border border-white/10 bg-gray-900/60 px-2 py-1.5 shadow-md shadow-black/30 backdrop-blur-md max-sm:w-44">
      <div className="mb-1 flex items-baseline gap-2">
        {/* 제목은 **이 패널을 연 버튼과 같은 키**를 쓴다(새 키 ❌). 따로 두었더니 en 에서는 같은
            문자열인데 12개 로케일 중 7곳에서 번역이 갈려, 버튼과 그 버튼이 연 패널이 서로 다른
            말을 하고 있었다(de `Bubbles aufräumen` ↔ `Blasen aufräumen` · ja `整列` ↔ `整理`).
            docs/rules/i18n.md 「같은 원문이 여러 곳에 쓰이면 단일 키」.

            **못 도는 동안에는 제목이 물러나 사유가 줄 전체를 쓴다.** 사유 문구는 12개 로케일이
            전부 "정리"라는 동사를 품고 있어(en `Tidying` · de `Aufräumen` · ja `整列`) 제목이
            그때는 같은 말의 반복이고, 나란히 두면 긴 로케일(de·it)에서 사유 쪽이 잘려 정작
            읽어야 할 말이 사라진다. 줄 수는 그대로라 카드 높이는 흔들리지 않는다. */}
        {!disabled && (
          <span className="shrink-0 text-[12px] font-medium text-gray-300">{t('canvas.controls.tidy')}</span>
        )}
        {/* 남은 폭을 전부 쓰고, 넘치면 **글자를 줄이지 않고 자른다** — 12px 은 한글 가독 하한이라
            좁은 화면이라고 더 작게 쓸 수 없다(docs/rules/coding.md 「하한 12px」). 잘린 전체 문구는
            `title` 에 그대로 남으므로 정보가 사라지지 않는다. 폭도 카드가 고정(`w-60`)이라
            문구 길이에 따라 카드가 넓어지지 않는다. */}
        <span
          className={`min-w-0 flex-1 truncate text-[12px] ${disabled ? 'text-left text-amber-300/80' : 'text-right text-gray-500'}`}
          title={hint}
        >
          {hint}
        </span>
      </div>
      <div className="flex flex-col overflow-hidden rounded-md border border-white/10 divide-y divide-white/10">
        {TIDY_SORTS.map((s) => (
          <SortRow key={s.id} sort={s.id} active={current === s.id} disabled={disabled} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

interface CanvasControlsProps {
  /**
   * §5.4 #33 — 버블 정리. 계산·이동은 캔버스(`BubbleMap`)가 쥐고 있고 여기는 손잡이만 낸다.
   * (I) 이후 **어느 기준으로** 앉힐지를 함께 넘긴다.
   */
  onTidy: (sort: TidySort) => void;
  /** 정리 이동이 가는 중 — 연달아 눌러 애니메이션이 겹치지 않게 잠근다. */
  tidyBusy: boolean;
  /** 정리를 걸 수 없는 화면(휴지통 내부 뷰 — 그 좌표는 임시 나열이라 저장하지 않는다). */
  tidyDisabled: boolean;
}

/**
 * 캔버스 좌하단 줌/핏/잠금 컨트롤.
 * React Flow 기본 <Controls> 를 대체 — 프로젝트 디자인(다크 + blue 액센트)에 맞춘
 * 고대비 플로팅 패널. 상호작용 토글은 공식 Controls 와 동일하게 store 를 갱신한다.
 */
export function CanvasControls({ onTidy, tidyBusy, tidyDisabled }: CanvasControlsProps): React.JSX.Element {
  const { t } = useTranslation();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const store = useStoreApi();
  const isNarrow = useIsNarrowViewport();
  const isInteractive = useStore(
    (s) => s.nodesDraggable || s.nodesConnectable || s.elementsSelectable,
  );
  // 새로고침 — 활성 프로젝트 스냅샷을 서버(디스크)에서 다시 불러온다(버블/에이전트 재적재).
  const activeProject = useGraphStore((s) => s.activeProject);
  const isHydrating = useGraphStore((s) => (activeProject ? !!s.hydratingProjects[activeProject] : false));
  // §5.24 — 히트맵. 캔버스를 **보는 방식**을 바꾸는 것이라 줌·핏·잠금과 같은 줄에 선다.
  //   어느 축(읽기/쓰기)을 보는지는 범례가 말하므로 여기 버튼 이름은 축 중립이다.
  const heatmapMode = useGraphStore((s) => s.heatmapMode);
  const toggleHeatmapMode = useGraphStore((s) => s.toggleHeatmapMode);
  // §5.4 #33 (I) — 정리 버튼은 곧장 돌지 않고 **기준 고르는 패널**을 연다. 실행은 패널이 건다.
  const tidyPanelOpen = useGraphStore((s) => s.tidyPanelOpen);
  const toggleTidyPanel = useGraphStore((s) => s.toggleTidyPanel);
  const setTidySort = useGraphStore((s) => s.setTidySort);

  // 모바일 웹 접속(§4)에서만 노출되는 전체화면 토글. Fullscreen API 로 문서 루트를 확대하고,
  // fullscreenchange 를 구독해 다른 경로(ESC·시스템 제스처)로 풀려도 상태가 어긋나지 않게 한다.
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && !!document.fullscreenElement,
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = (): void => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // 캔버스가 잠겨 있으면(버블 드래그 금지) 정리도 걸지 않는다 — 잠금은 "버블이 안 움직인다"는 약속이라
  // 버튼 하나가 그 약속을 깨면 잠금이 무슨 뜻인지 알 수 없게 된다.
  //
  // §5.4 #33 (I) 이후 이것이 막는 것은 **실행**(패널의 기준 줄)이지 패널 자체가 아니다. 열어서
  // 무엇이 있는지는 볼 수 있고, 왜 못 도는지는 패널 안 한 줄이 말한다 — 잠겼다고 버튼까지 죽이면
  // 사용자는 그 기능이 사라진 것으로 읽는다(컨트롤 버튼을 숨기지 않는 것과 같은 규율).
  const tidyLocked = tidyDisabled || tidyBusy || !isInteractive;

  const handleZoomIn = useCallback(() => { zoomIn(); }, [zoomIn]);
  const handleZoomOut = useCallback(() => { zoomOut(); }, [zoomOut]);
  const handleFitView = useCallback(() => { fitView({ duration: 300 }); }, [fitView]);
  const handleToggleLock = useCallback(() => {
    store.setState({
      nodesDraggable: !isInteractive,
      nodesConnectable: !isInteractive,
      elementsSelectable: !isInteractive,
    });
  }, [store, isInteractive]);
  const handleRefresh = useCallback(() => {
    if (!activeProject) return;
    useGraphStore.getState().hydrateProject(activeProject);
  }, [activeProject]);
  /**
   * §5.4 #33 (I) — 기준을 고르면 **그 자리에서 돈다.** 패널은 열린 채 남는다(고른 것이 곧 본
   * 것이어야 바로 다시 고를 수 있다). 고른 값은 스토어에 남아 다음에 열었을 때 표시된다.
   */
  const handlePickSort = useCallback((sort: TidySort) => {
    setTidySort(sort);
    onTidy(sort);
  }, [setTidySort, onTidy]);
  const handleToggleFullscreen = useCallback(() => {
    if (typeof document === 'undefined') return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void document.documentElement.requestFullscreen?.();
    }
  }, []);

  return (
    <Panel position="bottom-left" className="!mb-12 !ml-3">
      <div className="flex flex-col items-start gap-1.5">
      {heatmapMode && <HeatLegend />}
      {/* §5.4 #33 (I) — 범례와 같은 자리(컨트롤 무리 바로 위). 둘 다 켜면 정리 패널이 더 가깝게
          선다 — 방금 누른 버튼 바로 옆에 열려야 그 버튼이 연 것으로 읽힌다. */}
      {tidyPanelOpen && <TidySortPanel disabled={tidyLocked} onPick={handlePickSort} />}
      <CtrlPanel>
        <CtrlButton label={t('canvas.controls.zoomIn')} onClick={handleZoomIn}>
          <PlusIcon />
        </CtrlButton>
        <CtrlButton label={t('canvas.controls.zoomOut')} onClick={handleZoomOut}>
          <MinusIcon />
        </CtrlButton>
        <CtrlButton label={t('canvas.controls.fitView')} onClick={handleFitView}>
          <FitIcon />
        </CtrlButton>
        {/* §5.4 #33 — 화면맞춤이 **카메라**를 옮긴다면 이쪽은 **버블**을 옮긴다. 나란히 둔다.
            (I) 이후 이 버튼은 **패널 토글**이다 — 그래서 잠긴 화면에서도 눌러 무엇이 있는지
            볼 수 있고(패널 안에서 왜 못 도는지 말한다), 실행은 패널의 기준 줄이 건다. */}
        <CtrlButton
          label={t('canvas.controls.tidy')}
          onClick={toggleTidyPanel}
          active={tidyPanelOpen}
        >
          <TidyIcon />
        </CtrlButton>
        <CtrlButton
          label={heatmapMode ? t('canvas.controls.heatmapOff') : t('canvas.controls.heatmap')}
          onClick={toggleHeatmapMode}
          active={heatmapMode}
        >
          <HeatIcon />
        </CtrlButton>
        <CtrlButton
          label={t('canvas.controls.refresh', { defaultValue: 'Reload project' })}
          onClick={handleRefresh}
        >
          <RefreshIcon spinning={isHydrating} />
        </CtrlButton>
        <CtrlButton
          label={isInteractive ? t('canvas.controls.lock') : t('canvas.controls.unlock')}
          onClick={handleToggleLock}
          active={!isInteractive}
        >
          {isInteractive ? <UnlockIcon /> : <LockIcon />}
        </CtrlButton>
        {isNarrow && (
          <CtrlButton
            label={isFullscreen ? t('canvas.controls.exitFullscreen') : t('canvas.controls.fullscreen')}
            onClick={handleToggleFullscreen}
            active={isFullscreen}
          >
            {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          </CtrlButton>
        )}
      </CtrlPanel>
      </div>
    </Panel>
  );
}
