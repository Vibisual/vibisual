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
import { useProjectImmersionStore } from '../../stores/projectImmersion.js';
import { useTitleWithBinding } from '../Shortcuts/useBindingLabel.js';
// §5.24 — 색·지름이 쓰는 척도 한 벌을 범례도 그대로 받는다(따로 조합하면 눈금만 다른 곡선을 본다).
import { useHeatScale } from '../../hooks/useHeatScale.js';
import {
  Glyph,
  CtrlButton,
  CtrlPanel,
  PlusIcon,
  MinusIcon,
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
// §5.4 #33 버블 정리 — 지팡이. 전체화면·불꽃(HeatIcon)과 실루엣이 겹치지 않아
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
 * §5.24 — 히트 범례. 색이 상대 기준임과 지금 축·곡선을 말하는 유일한 자리(그래서 컨트롤 버튼 이름은 축 중립).
 * 눈금은 색·지름과 같은 척도 한 벌에서 — 로그 척도 램프 가운데는 `max/2` 가 아니다. 값이 0 이면 램프 대신 한 줄(모두 최고온이 된다), 토글·척도 선택은 남긴다.
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
      {/* §5.24 척도 곡선 — 네이티브 select(옵션 다섯). 펼친 목록은 카드 배경을 물려받지 않는다 — 반투명 배경이 팝업 흰 바탕과 섞여 글자가 묻힌다.
         그래서 `<option>` 에 불투명 배경·밝은 글자 + `color-scheme: dark`(바탕·강조·스크롤바).
         설명은 `title`, 닫힌 손잡이에도 지금 곡선의 설명(mac 네이티브 메뉴는 툴팁이 없다). */}
      <div className="mt-1 flex items-center gap-1.5">
        <span className="text-[12px] text-gray-500">{t('canvas.heatmap.curveLabel')}</span>
        <select
          value={curve}
          onChange={onCurveChange}
          title={`${t('canvas.heatmap.curveHint')} — ${t(`canvas.heatmap.curveRule.${curve}`)}`}
          aria-label={t('canvas.heatmap.curveLabel')}
          // 손가락에는 20px 손잡이가 작다 — 굵은 포인터에서만 위아래를 넓힌다(데스크톱 모습은 그대로).
          className="cursor-pointer rounded border border-gray-700/50 bg-gray-900/40 px-1 py-0 text-[12px] text-gray-300 outline-none [color-scheme:dark] hover:border-gray-600 focus:border-blue-500 pointer-coarse:py-1.5"
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

/** §5.4 #33 (I) — 정리 기준 한 줄(활성 톤은 `AxisButton` 의 blue). 이름만으론 결과를 몰라 설명을 곁들이고, 잠겨도 줄을 숨기지 않는다. */
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
        {/* 좁은 화면에선 설명을 접되 고른 줄은 펴 둔다(`title` 은 마우스 전용). 펴진 줄이 늘 하나라 높이가 그대로다(§9). 하한 12px. */}
        <span className={`block truncate text-[12px] leading-tight text-gray-500 ${active ? '' : 'max-sm:hidden'}`}>{rule}</span>
      </span>
    </button>
  );
}

/** §5.4 #33 (I) 정리 기준 패널 — 히트맵 범례와 같은 자리·톤. 고르는 즉시 돌고 패널은 열린 채(적용 버튼 ❌). `heat` 축은 §5.24 히트맵이 쥐므로 여기서 또 고르지 않는다. */
function TidySortPanel({ disabled, onPick }: {
  disabled: boolean;
  onPick: (sort: TidySort) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const current = useGraphStore((s) => s.tidySort);
  const heatAxis = useGraphStore((s) => s.heatAxis);
  /**
   * 제목 옆 한 자리가 사정을 말한다(못 돈다 > 보는 축 > 안내 중 하나) — 줄 수가 상수라 카드 높이가 흔들리지 않는다.
   * `heat` 축은 §5.24 범례 제목 키(`읽은 횟수`/`쓴 횟수`)를 빌린다.
   */
  const hint = disabled
    ? t('canvas.controls.tidyUnavailable')
    : current === 'heat'
      ? (heatAxis === 'write' ? t('canvas.heatmap.titleWrite') : t('canvas.heatmap.title'))
      : t('canvas.tidy.panelHint');
  return (
    <div className="w-60 rounded-lg border border-white/10 bg-gray-900/60 px-2 py-1.5 shadow-md shadow-black/30 backdrop-blur-md max-sm:w-44">
      <div className="mb-1 flex items-baseline gap-2">
        {/* 제목은 이 패널을 연 버튼과 같은 키(새 키 ❌ — 로케일마다 번역이 갈린다). 못 도는 동안엔 제목이 물러나 사유가 줄을 다 쓴다
           (사유가 "정리"를 품고, 나란히면 긴 로케일에서 잘린다). */}
        {!disabled && (
          <span className="shrink-0 text-[12px] font-medium text-gray-300">{t('canvas.controls.tidy')}</span>
        )}
        {/* 남은 폭을 쓰고 넘치면 자른다 — 12px 은 한글 가독 하한이라 더 줄이지 않는다(전체 문구는 `title`). 카드 폭은 `w-60` 고정. */}
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
  /** §5.4 #33 — 버블 정리. 계산·이동은 캔버스(`BubbleMap`)가 쥐고 여기는 손잡이만 낸다((I) 기준을 함께 넘긴다). */
  onTidy: (sort: TidySort) => void;
  /** 정리 이동이 가는 중 — 연달아 눌러 애니메이션이 겹치지 않게 잠근다. */
  tidyBusy: boolean;
  /** 정리를 걸 수 없는 화면(휴지통 내부 뷰 — 그 좌표는 임시 나열이라 저장하지 않는다). */
  tidyDisabled: boolean;
}

/**
 * 캔버스 좌하단 줌/프로젝트 몰입/잠금 컨트롤.
 * React Flow 기본 <Controls> 를 대체 — 프로젝트 디자인(다크 + blue 액센트)에 맞춘
 * 고대비 플로팅 패널. 상호작용 토글은 공식 Controls 와 동일하게 store 를 갱신한다.
 */
export function CanvasControls({ onTidy, tidyBusy, tidyDisabled }: CanvasControlsProps): React.JSX.Element {
  const { t } = useTranslation();
  const { zoomIn, zoomOut } = useReactFlow();
  const store = useStoreApi();
  const isNarrow = useIsNarrowViewport();
  const isInteractive = useStore(
    (s) => s.nodesDraggable || s.nodesConnectable || s.elementsSelectable,
  );
  // 새로고침 — 활성 프로젝트 스냅샷을 서버(디스크)에서 다시 불러온다(버블/에이전트 재적재).
  const activeProject = useGraphStore((s) => s.activeProject);
  const immersive = useProjectImmersionStore((s) => activeProject !== null && s.immersiveProject === activeProject);
  const toggleImmersion = useProjectImmersionStore((s) => s.toggle);
  const immersionLabel = t(immersive ? 'canvas.controls.exitImmersiveMode' : 'canvas.controls.immersiveMode');
  const immersionTitle = useTitleWithBinding(immersionLabel, 'global.projectImmersion');
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

  // 캔버스가 잠겼으면 정리도 걸지 않는다(잠금 = 버블이 안 움직인다는 약속). 막는 건 실행이지 패널이 아니다 — 열어 볼 수 있고 이유는 패널 안 한 줄이 말한다.
  const tidyLocked = tidyDisabled || tidyBusy || !isInteractive;

  const handleZoomIn = useCallback(() => { zoomIn(); }, [zoomIn]);
  const handleZoomOut = useCallback(() => { zoomOut(); }, [zoomOut]);
  const handleToggleImmersion = useCallback(() => {
    if (activeProject !== null) toggleImmersion(activeProject);
  }, [activeProject, toggleImmersion]);
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
  /** §5.4 #33 (I) — 기준을 고르면 그 자리에서 돈다. 패널은 열린 채 남고, 고른 값은 스토어에 남아 다음에 열 때 보인다. */
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
      {/* 이 무리는 위로 자란다 — 폰에선 단추 + 범례·패널이 캔버스 키를 넘으므로 화면 높이로 묶고, 패널부터 줄여 스크롤한다(`shrink-[1000]`). 단추 무리는 마지막까지 제 키를 지킨다. */}
      <div className="flex max-h-[calc(100dvh-8rem)] flex-col items-start gap-1.5">
      {(heatmapMode || tidyPanelOpen) && (
        <div className="flex min-h-0 shrink-[1000] flex-col items-start gap-1.5 overflow-y-auto overscroll-contain">
          {heatmapMode && <HeatLegend />}
          {/* §5.4 #33 (I) — 범례와 같은 자리(컨트롤 무리 바로 위). 둘 다 켜면 정리 패널이 더 가깝게
              선다 — 방금 누른 버튼 바로 옆에 열려야 그 버튼이 연 것으로 읽힌다. */}
          {tidyPanelOpen && <TidySortPanel disabled={tidyLocked} onPick={handlePickSort} />}
        </div>
      )}
      <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain rounded-lg">
      <CtrlPanel>
        <CtrlButton label={t('canvas.controls.zoomIn')} onClick={handleZoomIn}>
          <PlusIcon />
        </CtrlButton>
        <CtrlButton label={t('canvas.controls.zoomOut')} onClick={handleZoomOut}>
          <MinusIcon />
        </CtrlButton>
        <CtrlButton
          label={immersionLabel}
          title={immersionTitle}
          onClick={handleToggleImmersion}
          active={immersive}
          disabled={activeProject === null}
        >
          {immersive ? <ExitFullscreenIcon /> : <FullscreenIcon />}
        </CtrlButton>
        {/* §5.4 #33 — 정리는 버블의 배치를 바꾼다.
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
      </div>
    </Panel>
  );
}
