/**
 * §5.5 #17-17 ⑪(i)(j)(n)·⑭·㉔ — **무대.** 에이전트의 개발 단계를 실체화해 IDE **우측 판**에 세운다.
 *
 * ㉔ **이것은 판이 아니라 그 판의 탭 하나다.** ⑪(k)·⑮ 시절 무대는 편집창과 **나란히 서는 자기 폭의
 * 패널**이었다 — 껍데기·폭 손잡이·머리줄·[닫기] 를 따로 갖고, 둘 다 열면 대화가 그만큼 두 번 좁아졌다.
 * 이제 우측에 서는 판은 하나뿐이고(`IDEEditorPane`), 무대는 그 판의 **첫 탭**이다. 그래서 이 파일에는
 * 껍데기가 없다 — 자리·폭·덮개 판정·닫기는 전부 판이 쥔다. 여기 남은 것은 **탭을 고르면 보이는 몸통**이다.
 *
 * ⑭ **한 장의 캔버스다.** 종전에는 위아래로 잘린 네 칸이었고(장면 · 진행 레일 · 지도 · 화면 골격),
 * 그 아래로 종류 서랍과 행동 팔레트가 한 줄씩 더 붙어 있었다 — 정작 블루프린트인 부분이 패널의
 * 절반도 못 가졌다. 이제 몸통은 **캔버스 하나**(`IDEGoalMapView`)이고, 장면과 진행 레일은 그 위에
 * **떠 있는 조각**(HUD)으로 남는다(정보를 지워서 자리를 만드는 것이 아니라 겹쳐서 만든다 — ⑭(b)).
 *
 * 걷어낸 세 칸이 하던 일은 하나도 버리지 않았다 — 전부 캔버스의 **우클릭 메뉴**로 옮겼다(⑭(c) ·
 * `StageCanvasMenu`). 화면 골격 칸(⑪(n)④)만은 그 자리에서 회수했다: 대부분의 단계에서 빈 안내
 * 한 줄로 `36%` 를 차지하고 앉아 있었다.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VisualKindCard, VisualKindSurface } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useIDEPaneValue } from './idePane.js';
// ⑯ — 추종 스위치는 대화 툴바의 그것과 **같은 세션 키**를 쓴다(따라가는 축이 하나이므로).
import { followSessionKey } from './editorFollow.js';
import { IDEGoalMapView } from './IDEGoalMapView.js';
import { SceneArt, StepMark, KIND_NEUTRAL, KIND_MUTED } from './StageGlyph.js';
// ㉒ — 실황 칸. 비출 것이 있을 때만 스스로 선다(무대는 조건을 묻지 않는다).
import { StageLiveSurface } from './StageLiveSurface.js';
import { focusStep, surfaceOf } from './stageSurface.js';
// ⑰(c) — "지금 도는 서브에이전트" 는 활동바·사이드바와 **같은 산식**을 쓴다(새 수집 경로 ❌).
import { countSessionTasks } from './runningSubagents.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { POPUP_DISMISS } from '../../hooks/popupDismiss.js';

/** ⑪(n) — 장면을 배경으로 깔 때의 투명도. 읽을 글자가 그 위에 서므로 그림은 **암시**여야 한다. */
const SCENE_WATERMARK_OPACITY = 0.1;

/**
 * ⑪(n)·⑭(b) — **진행 레일.** 단계 전부가 한 줄의 칸으로 선다. 이제 캔버스 **위에** 뜬다.
 *
 * 지도는 "무엇을 하는가"를 말하지만 스무 단계가 되면 화면 밖으로 나가 **"어디까지 왔나"** 를 잃는다.
 * 레일은 그 답만 남긴다 — 끝난 칸은 종류 색으로 차고, 지금 칸은 넓어지고 맥동하고, 남은 칸은 비어 있다.
 * 누르면 무대가 그 단계를 비춘다(캔버스를 훑지 않아도 되는 지름길).
 */
function StageRail({
  steps,
  kinds,
  shownId,
  onSelect,
  label,
}: {
  steps: readonly { id: string; text: string; status: string; kind?: string }[];
  kinds: Record<string, VisualKindCard>;
  shownId: string | null;
  onSelect: (id: string) => void;
  label: string;
}): React.JSX.Element | null {
  if (steps.length === 0) return null;
  return (
    <div
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-10 flex items-center gap-1 border-t border-gray-800 bg-gray-950/85 px-2 py-1.5 backdrop-blur-sm"
      aria-label={label}
    >
      {steps.map((step) => {
        const color = (step.kind ? kinds[step.kind]?.color : undefined) ?? KIND_NEUTRAL;
        const running = step.status === 'in_progress';
        const done = step.status === 'done';
        const shown = step.id === shownId;
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onSelect(step.id)}
            title={step.text}
            aria-label={step.text}
            aria-current={shown ? 'step' : undefined}
            // 지금 도는 칸이 넓다 — 눈이 먼저 가야 하는 칸이고, 좁은 무대에서도 그 칸만은 잡힌다.
            className={`h-1.5 min-w-[6px] rounded-full transition-all ${running ? 'animate-pulse' : ''} ${
              shown ? 'ring-1 ring-white/50' : ''
            }`}
            style={{
              flex: running ? 2.5 : 1,
              backgroundColor: done || running ? color : '#374151',
              opacity: done ? 0.75 : 1,
            }}
          />
        );
      })}
    </div>
  );
}

export const IDEStageView = memo(function IDEStageView(): React.JSX.Element | null {
  const { t } = useTranslation();
  const agentId = useIDEPaneValue((o) => o.agentId);
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);

  const goal = useGraphStore((s) => (activeSessionId ? s.sessionGoals[activeSessionId] : undefined));
  const visualKinds = useGraphStore((s) => s.visualKinds);
  // ⑰(c) — 이 탭이 띄운 서브에이전트 수. 나란히 놓은 행이 실제로 갈라졌는지 곁눈으로 안다.
  const runningCount = useGraphStore((s) => countSessionTasks(agentId ? s.runningSubagentTasks[agentId] : undefined, activeSessionId));

  /** ⑪(j) — 무대가 비추는 단계. `null` 이면 "도는 단계를 따라간다"(추종이 고르게 둔다). */
  const [pinnedStepId, setPinnedStepId] = useState<string | null>(null);
  /** ⑰(c) — 목표의 변천 목록이 펼쳐져 있는가(머리의 「n번째 판」 칩). */
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  useOutsidePressDismiss({
    enabled: historyOpen,
    onDismiss: () => setHistoryOpen(false),
    refs: [historyRef],
    graceMs: POPUP_DISMISS.touchOpenGraceMs,
    shouldConsider: (e) => e.button === 0 || e.button === 1,
  });
  /**
   * ⑯ — 카메라 추종은 **툴바의 [추종] 하나가 쥔다**(#17-27 ⑪ 의 그 세션별 스위치를 그대로 읽는다).
   * 무대 머리에 제 버튼을 세우면 똑같이 생긴 [추종] 이 화면에 둘이 되고, 무대를 열고 닫을 때마다
   * 그 하나가 자리를 옮겨 다니는 것으로 보인다(사용자 지시). 상태를 공유하므로 무대에서 손으로
   * 지도를 끌면 툴바의 그 버튼도 함께 꺼진다 — "따라간다"는 축이 하나이기 때문이다.
   */
  const followKey = followSessionKey(agentId ?? '', activeSessionId);
  const follow = useGraphStore((s) => s.ideEditorFollow[followKey] === true);
  const setFollow = useGraphStore((s) => s.setIdeEditorFollow);

  const steps = useMemo(() => goal?.steps ?? [], [goal]);

  // 세션을 옮기면 비추던 단계는 남의 목록의 것이다 — 붙들어 두면 빈 무대가 된다.
  //   추종은 세션마다 따로 사는 값이라 여기서 되돌리지 않는다(그 세션에서 껐으면 꺼진 채로 돌아온다).
  useEffect(() => { setPinnedStepId(null); }, [activeSessionId]);
  // ⑰(c) — 변천 목록은 그 세션의 것이라 세션을 옮기면 접는다.
  useEffect(() => { setHistoryOpen(false); }, [activeSessionId]);

  const shown = useMemo(() => {
    if (pinnedStepId) return steps.find((s) => s.id === pinnedStepId) ?? focusStep(steps);
    return focusStep(steps);
  }, [steps, pinnedStepId]);

  const kind = shown?.kind ? visualKinds[shown.kind] : undefined;
  const surface: VisualKindSurface = surfaceOf(shown, visualKinds);
  const running = shown?.status === 'in_progress';

  // ㉔ — 폭 손잡이는 여기 없다. 우측 판이 하나이므로 끄는 변도 하나이고, 그 하나는 판이 쥔다
  //   (`IDEEditorPane` 의 `handleResizeDown` — 종전 두 벌이던 손잡이·저장 폭이 한 벌로 접혔다).

  const onUserMove = useCallback(() => setFollow(followKey, false), [setFollow, followKey]);
  const onSelectStep = useCallback((id: string) => {
    setPinnedStepId(id);
    // 손으로 고른 단계는 카메라가 그리로 간다 — 고르고도 화면이 안 움직이면 눌린 줄 모른다.
    setFollow(followKey, true);
  }, [setFollow, followKey]);

  if (!agentId) return null;

  const blurb = kind?.blurb
    ?? (surface === 'none' ? t('ide.stage.surfaceBlurb.none') : t(`ide.stage.surfaceBlurb.${surface}`));
  const accent = kind?.color ?? KIND_NEUTRAL;
  const muted = !shown || shown.status === 'done';

  return (
    // ㉔ — 껍데기가 아니라 **탭 몸통**이다: 자리·폭·덮개 판정은 판이 쥐고, 여기는 그 안을 채운다.
    //   `data-ide-stage-pane` 은 그대로 둔다 — 무대가 어디에 그려지든 "여기가 무대다"를 읽는 표식이다.
    <div data-ide-stage-pane="" className="flex min-h-0 flex-1 flex-col">
      {/* 손잡이 줄 — 편집창의 그것과 **같은 자리·같은 톤**이다(탭을 옮겨도 줄이 튀지 않게).
          이름("무대")은 이제 탭이 말하므로 여기 적지 않고, [닫기] 도 탭의 × 하나로 접혔다(㉔).
          ⑯ — [추종] 은 여기 서지 않는다. 대화 툴바의 그 버튼 하나가 두 축을 함께 쥐므로,
          무대를 열고 닫아도 사용자가 찾는 자리는 늘 같은 곳이다(사용자 지시). */}
      <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-gray-800 bg-gray-900/60 px-2 py-1">
        <span className="min-w-0 flex-1 truncate text-[12px] text-gray-500" title={goal?.text ?? undefined}>
          {goal?.text ?? t('ide.stage.waiting')}
        </span>
        {/* ⑰(c) — 목표의 변천. 몇 번째 판인지 + 누르면 지난 문장들(최근 것이 위). 목표가 유동적일수록
            "어디서 왔는가"가 곧 방향이다. */}
        {goal && goal.revision > 0 && (
          <div ref={historyRef} className="relative flex-shrink-0">
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              aria-expanded={historyOpen}
              title={t('ide.stage.history.title')}
              className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[12px] transition-colors ${
                historyOpen ? 'border-violet-400/50 bg-violet-500/10 text-violet-200' : 'border-gray-700 text-gray-400 hover:text-gray-200'
              }`}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />
              </svg>
              {t('ide.stage.history.chip', { count: goal.revision })}
            </button>
            {historyOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-gray-700 bg-gray-900 p-2 shadow-xl shadow-black/40">
                <p className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-gray-500">{t('ide.stage.history.title')}</p>
                <ol className="scrollbar-thin flex max-h-48 flex-col gap-1 overflow-y-auto">
                  <li className="rounded bg-gray-800/70 px-1.5 py-1 text-[12px] leading-snug text-gray-100">
                    <span className="mr-1 text-violet-300">{t('ide.stage.history.current')}</span>
                    {goal.text}
                  </li>
                  {(goal.pastTexts ?? []).slice().reverse().map((text, i) => (
                    <li key={`${i}:${text.slice(0, 24)}`} className="px-1.5 py-1 text-[12px] leading-snug text-gray-400">
                      {text}
                    </li>
                  ))}
                  {(goal.pastTexts ?? []).length === 0 && (
                    <li className="px-1.5 py-1 text-[12px] text-gray-600">{t('ide.stage.history.empty')}</li>
                  )}
                </ol>
              </div>
            )}
          </div>
        )}
        {/* ⑰(c) — 지금 도는 서브에이전트 수. 갈라 돌리는 중이면 여기서 보인다. */}
        {runningCount > 0 && (
          <span
            className="flex flex-shrink-0 items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[12px] text-emerald-200"
            title={t('ide.stage.subagentsRunning', { count: runningCount })}
            aria-label={t('ide.stage.subagentsRunning', { count: runningCount })}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9" />
            </svg>
            {runningCount}
          </span>
        )}
      </div>

      {/* ⑭(a)(b) — **몸통은 캔버스 하나**다. 장면과 진행 레일은 그 위에 떠 있고,
          자기 칸에서만 손짓을 받아 아래 캔버스를 막지 않는다. */}
      <div
        className="relative min-h-0 flex-1"
        // ⑭(c) — 무대 안에서는 **브라우저 기본 메뉴가 뜨지 않는다.** 캔버스는 자기 메뉴를 열지만
        //   위에 뜬 조각(장면·레일)을 우클릭하면 그 자리에는 우리 메뉴도 없이 OS 메뉴만 떴다.
        onContextMenu={(e) => e.preventDefault()}
      >
        <IDEGoalMapView
          agentId={agentId}
          selectedStepId={shown?.id ?? null}
          onSelectStep={onSelectStep}
          follow={follow}
          onUserMove={onUserMove}
        />

        {/* ⑪(i)(n)·⑭(b) — 장면. 그림이 배경으로 깔리고 그 위에 종류·본문·미리 표현한 한 줄이 선다.
            [노드 추가] 손잡이(캔버스 우상단)와 겹치지 않도록 폭을 그만큼 비워 둔다. */}
        <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[calc(100%-7rem)]">
          <div className="pointer-events-auto relative flex items-center gap-2.5 overflow-hidden rounded-lg border border-gray-800 bg-gray-950/85 px-2.5 py-2 shadow-lg shadow-black/30 backdrop-blur-sm">
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: `linear-gradient(100deg, ${accent}22, transparent 62%)` }}
              aria-hidden
            />
            <div className="pointer-events-none absolute -right-3 -top-5 select-none" aria-hidden>
              <SceneArt card={kind} className="h-24 w-24" muted={muted} opacity={SCENE_WATERMARK_OPACITY} />
            </div>
            <div
              className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border"
              style={{ borderColor: `${accent}55`, backgroundColor: `${accent}14` }}
            >
              <SceneArt card={kind} className="h-7 w-7" muted={muted} />
            </div>
            <div className="relative flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-semibold" style={{ color: muted ? KIND_MUTED : accent }}>
                  {kind?.label ?? t('ide.stage.noKind')}
                </span>
                {running && (
                  <span className="flex-shrink-0 rounded bg-amber-500/15 px-1.5 py-px text-[12px] text-amber-300">
                    {t('ide.stage.running')}
                  </span>
                )}
                {shown?.confidence === 'low' && (
                  <span
                    className="flex-shrink-0 rounded border border-dashed border-gray-600 px-1 text-[12px] leading-tight text-gray-400"
                    title={t('ide.stage.block.lowConfidence')}
                  >
                    ?
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {shown && <StepMark status={shown.status} color={accent} className="h-3 w-3 flex-shrink-0" />}
                <span className="truncate text-[12px] text-gray-200">{shown?.text ?? t('ide.stage.waiting')}</span>
              </div>
              <span className="truncate text-[12px] text-gray-500">{blurb}</span>
            </div>
          </div>
        </div>

        {/* ⑪(n)·⑭(b) — 진행 레일. 글자 없이 "어디까지 왔나"만 말한다. */}
        <StageRail
          steps={steps}
          kinds={visualKinds}
          shownId={shown?.id ?? null}
          onSelect={onSelectStep}
          label={t('ide.stage.rail')}
        />
      </div>

      {/* ㉒ — **실황.** 비추는 단계가 지금 만들고 있는 것이 이 자리에 선다(소스·출력·변경분·문서·웹,
          그리고 산출물 넷은 내부 앱 화면 그대로). **비출 것이 없으면 이 컴포넌트는 `null`** 이라
          한 픽셀도 차지하지 않는다 — ⑭(a) 가 이 칸을 걷어낸 이유(빈 안내 한 줄이 36% 를 먹음)를
          정면으로 피하는 자리다. 추종 스위치는 여기서 만들지 않는다(㉒(e) — `shown` 이 이미
          추종을 따라가므로 실황도 저절로 따라간다). */}
      <StageLiveSurface steps={steps} shownStepId={shown?.id ?? null} surface={surface} />
    </div>
  );
});
