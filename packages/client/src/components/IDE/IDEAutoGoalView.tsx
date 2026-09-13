/**
 * §5.10 (P) — **절차 감지** 뷰. IDE 활동바의 제 칸(`data-activity-view="autoGoal"`)이 여는 화면.
 *
 * 사용자 지시(2026-09-12): "이 목표와 자동 목표 뷰를 서로 나눴으면 좋겠어 그리고 이름도 절차
 * 감지로 변경." 그래서 둘을 갈랐다 — 종전에는 이 화면이 `목표` 뷰 아래 블록(`IDEAutoGoalSection`)
 * 으로 얹혀 있었는데, 한 칸에 둘을 쌓으니 ① 목표를 보러 온 사람은 스크롤 끝에서 낯선 스위치를
 * 만나고 ② 절차를 보러 온 사람은 남의 목표문·단계·기록을 지나야 도달했다. **묻는 물음이 다르면
 * 칸도 다르다** — 목표는 "지금 향하는 그 일", 이 칸은 "늘 하던 그 일"이다.
 *
 * **이름은 화면에서만 바뀐다.** 표시는 「절차 감지」(12 로케일 전부), **내부 식별자는 `autoGoal`
 * 그대로**다 — `IDEViewType 'autoGoal'` · `/api/auto-goal/*` · `.vibisual/skills/` ·
 * `ProjectCheckpoint.autoGoalSettings`. 식별자까지 바꾸면 이미 쌓인 절차가 경로를 잃고, 서버 집행·
 * 플러그인 축(`readAutoGoal`)이 함께 깨진다(§5.10 (H) 가 `brain`→「메모리」에서 세운 규율 그대로).
 *
 * **화면 규약** — 정독 뷰(#17-44 ⑧(c))가 세운 것을 그대로 따른다:
 *  - 켜고 끄는 자리는 **이 뷰 하나**이고, **꺼져 있을 때도 켜져 있을 때도 늘 보인다**
 *    (칸을 갈랐어도 스위치는 여전히 한 벌이다 — 두 자리에서 켜지면 "켰는데 왜 안 도는지"를
 *    찾을 길이 없어진다).
 *  - 목표가 없는 화면·세션을 아직 안 고른 화면에서도 선다 — 프로젝트·에이전트 두 층은 세션 없이
 *    켤 수 있고, 여기가 막다른 길이면 이 기능을 아예 켤 수 없게 된다.
 *  - 값은 전부 서버가 낸 것이고 여기서 다시 재지 않는다(§3.1).
 *  - 12px 하한(§9) · 아이콘은 stroke SVG(이모지 ❌).
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AutoGoalCandidate, AutoGoalSkillSummary } from '@vibisual/shared';
import { AutoGoalScopeRows, AutoGoalScopeSummary, useAutoGoalScope } from './autoGoalScope.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';
import { useIDEPaneValue } from './idePane.js';
import { ScrollFade } from '../ScrollFade.js';

/** 굳은 절차를 뜻하는 글리프 — 겹쳐 쌓인 판(반복해서 굳은 것). */
function SkillGlyph({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      className={className ?? 'h-3.5 w-3.5'} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
      <path d="m3 12 9 4.5L21 12M3 16.5 12 21l9-4.5" />
    </svg>
  );
}

/** 아직 굳지 않은 것을 뜻하는 글리프 — 도는 원(차오르는 중). */
function BrewGlyph({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      className={className ?? 'h-3.5 w-3.5'} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** 지우기 — 작은 x. 파괴적 동작이라 글자 대신 글리프 하나로 두고 툴팁이 설명한다. */
function RemoveGlyph(): React.JSX.Element {
  return (
    <svg
      className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/**
 * 굳어진 절차 한 줄.
 *
 * 이름 · 단계 수 · 관찰 횟수를 한 줄에 세우고, 지우기는 호버에서만 뜬다 — 좁은 칸에서 늘 보이는
 * 파괴 버튼은 목록을 읽는 것보다 먼저 눈에 들어온다.
 */
const SkillRow = memo(function SkillRow({
  skill, onRemove,
}: {
  skill: AutoGoalSkillSummary;
  onRemove: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <li className="group flex min-w-0 items-start gap-1.5 rounded px-1 py-0.5 hover:bg-gray-800/60">
      <SkillGlyph className="mt-[2px] h-3.5 w-3.5 flex-shrink-0 text-emerald-400/80" />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[12px] leading-snug text-gray-200">{skill.name}</span>
        <span className="block text-[12px] leading-snug text-gray-500">
          {t('ide.autoGoal.skillMeta', { steps: skill.steps, runs: skill.runs })}
        </span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        title={t('ide.autoGoal.removeSkill')}
        aria-label={t('ide.autoGoal.removeSkill')}
        className="mt-[2px] flex-shrink-0 rounded p-0.5 text-gray-600 opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <RemoveGlyph />
      </button>
    </li>
  );
});

/**
 * 아직 문턱을 못 넘은 후보 한 줄 — **분모가 있는 진행**.
 *
 * "2/3" 처럼 셀 수 있게 적는 이유는 #17-44 ① 이 신뢰에 대해 세운 그대로다: 분모 없는 진행률은
 * 신뢰를 못 만든다. 사용자는 이 줄을 보고 "한 번만 더 하면 굳는구나"를 안다.
 */
const CandidateRow = memo(function CandidateRow({
  candidate, minRuns, onDismiss,
}: {
  candidate: AutoGoalCandidate;
  minRuns: number;
  onDismiss: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const ratio = Math.max(0, Math.min(1, minRuns > 0 ? candidate.runs / minRuns : 0));
  return (
    <li className="group flex min-w-0 items-start gap-1.5 rounded px-1 py-0.5 hover:bg-gray-800/60">
      <BrewGlyph className="mt-[2px] h-3.5 w-3.5 flex-shrink-0 text-amber-400/80" />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[12px] leading-snug text-gray-300">{candidate.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-700/70">
            <span className="block h-full rounded-full bg-amber-400/80" style={{ width: `${ratio * 100}%` }} />
          </span>
          <span className="flex-shrink-0 text-[12px] tabular-nums text-gray-500">
            {candidate.runs}/{minRuns}
          </span>
        </span>
      </span>
      <button
        type="button"
        onClick={onDismiss}
        title={t('ide.autoGoal.dismiss')}
        aria-label={t('ide.autoGoal.dismiss')}
        className="mt-[2px] flex-shrink-0 rounded p-0.5 text-gray-600 opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <RemoveGlyph />
      </button>
    </li>
  );
});

/** 목록 한 덩어리의 머리 — 이름 + 개수. 개수가 0이면 이 머리 자체를 세우지 않는다(호출부가 판단). */
function GroupLabel({ text }: { text: string }): React.JSX.Element {
  return <span className="px-1 text-[12px] font-semibold text-gray-400">{text}</span>;
}

export const IDEAutoGoalView = memo(function IDEAutoGoalView({
  agentId,
}: {
  agentId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  /*
   * 세션 탭은 **창 단위 상태**에서 읽는다(props ❌ — 뷰 라우터는 `agentId` 하나만 넘긴다).
   * 목표·루프·검증이 같은 축(그 탭의 세션)을 읽는 자리와 같다.
   */
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  const rootPath = useIDEProjectRoot();
  const control = useAutoGoalScope(rootPath, agentId, activeSessionId);

  const state = control.state;
  const skills = state?.skills ?? [];
  // 이미 굳은 후보는 아래 목록에 다시 세우지 않는다 — 같은 절차가 두 줄로 보이면 무엇이 남은 일인지
  //   읽히지 않는다(스킬 줄이 그 절차의 결론이다).
  const brewing = (state?.candidates ?? []).filter((c) => !c.skillId);
  const minRuns = state?.minRuns ?? 0;

  return (
    <div className="flex min-h-0 flex-col">
      {/* 머리글 — 목표 뷰와 같은 문법(칸 이름 · 오른쪽에 수치). 켜짐 여부는 글자가 아니라 점 하나로
          먼저 말한다(좁은 칸에서 가장 빨리 읽힌다). `pb-1.5` 는 아래 스크롤 영역의 상단
          그라데이션이 이 줄 밑변에 달라붙지 않게 띄운 자리(목표·루프·검증 뷰와 같은 규약). */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-1.5 pt-2">
        <span
          title={t('ide.autoGoal.title')}
          className="min-w-0 flex-1 basis-20 truncate text-[12px] font-semibold uppercase tracking-wider text-gray-500"
        >
          {t('ide.autoGoal.title')}
        </span>
        <span
          aria-hidden
          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${control.effective ? 'bg-emerald-400' : 'bg-gray-600'}`}
        />
        {skills.length > 0 && (
          <span className="flex-shrink-0 text-[12px] tabular-nums text-gray-500">{skills.length}</span>
        )}
      </div>

      <ScrollFade fill className="min-h-0 flex-1">
        <div className="flex min-w-0 flex-col gap-1.5 overflow-x-hidden break-words p-2">
          {/* 이 기능이 무엇을 하는지 한 줄 — 이름만으로는 무엇을 감지한다는 것인지 읽히지 않는다. */}
          <p className="px-1 text-[12px] leading-relaxed text-gray-500">{t('ide.autoGoal.about')}</p>

          {/* 지금 도는가 — 스위치를 눌러도 결론이 안 바뀌는 경우(위 층이 이미 껐다)를 먼저 못 박는다. */}
          <AutoGoalScopeSummary on={control.effective} />

          {/* 켜고 끄는 자리 — **꺼져 있을 때도 켜져 있을 때도 늘 여기다**(#17-44 ⑧(c) 규율). */}
          <div className="rounded border border-gray-800 bg-gray-900/40 p-1">
            <AutoGoalScopeRows control={control} agentId={agentId} subAgentId={activeSessionId} />
          </div>
          <p className="px-1 text-[12px] leading-relaxed text-gray-600">{t('ide.autoGoal.scope.hint')}</p>

          {/* 굳은 절차 — 꺼져 있어도 보인다(끄기는 정지이지 삭제가 아니다). */}
          {skills.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <GroupLabel text={t('ide.autoGoal.groupSkills', { count: skills.length })} />
              <ul className="flex flex-col">
                {skills.map((s) => (
                  <SkillRow
                    key={s.id}
                    skill={s}
                    onRemove={() => control.removeSkill(s.id, s.candidateId)}
                  />
                ))}
              </ul>
            </div>
          )}

          {/* 곧 굳을 것 — 켜져 있을 때만 센다(꺼져 있으면 훑지 않으므로 목록도 비어 있다). */}
          {brewing.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <GroupLabel text={t('ide.autoGoal.groupBrewing', { count: brewing.length })} />
              <ul className="flex flex-col">
                {brewing.map((c) => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    minRuns={minRuns}
                    onDismiss={() => control.dismiss(c.id)}
                  />
                ))}
              </ul>
            </div>
          )}

          {/*
            빈 자리에 "무엇을 기다리는 칸인지"를 적는다.

            빈 목록은 "고장"으로 읽힌다(정독 #17-44 ③(e) 가 이력에서 "막은 적 없음"을 적기로 한 것과 같은
            이유). 켜져 있는데 아직 아무것도 없으면 **몇 개를 봤는지**를 말해 주는 것이 유일하게
            정직한 답이다 — 그 숫자가 늘고 있으면 기다리면 된다는 뜻이다.
          */}
          {control.effective && skills.length === 0 && brewing.length === 0 && (
            <p className="px-1 text-[12px] leading-relaxed text-gray-600">
              {state && state.observed > 0
                ? t('ide.autoGoal.watching', { observed: state.observed, runs: minRuns })
                : t('ide.autoGoal.empty')}
            </p>
          )}
        </div>
      </ScrollFade>
    </div>
  );
});
