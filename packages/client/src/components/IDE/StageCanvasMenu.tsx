/**
 * §5.5 #17-17 ⑭(c)·⑰(a)(d) — **무대 캔버스의 우클릭 메뉴.** 걷어낸 세 칸(화면 골격·종류 서랍·행동 팔레트)이
 * 하던 일이 전부 여기로 들어왔다.
 *
 * 언리얼 블루프린트의 그 손짓 그대로다 — **빈 자리에서 우클릭**하면 검색칸이 달린 노드 목록이
 * 뜨고 고른 것이 **누른 그 자리에** 선다. **노드 위에서 우클릭**하면 그 단계의 메뉴다(비추기 ·
 * 나란히 놓기/줄에서 떼기 · 종류 바꾸기). 두 메뉴를 한 조각에 둔 이유는 하나다: 검색·키보드·닫기
 * 규약이 두 벌이 되면 그중 하나는 반드시 뒤처진다.
 *
 * ⑰(d) — 빈 자리 메뉴의 검색 한 칸이 **여섯 원천**을 함께 거른다: 직접 쓰기 · 배운 행동 · 흐름 템플릿 ·
 * **설치된 스킬**(Claude Code 가 답한 그 목록) · **자동 목표 스킬**(되풀이한 행동이 절차로
 * 승격된 것) · 종류. 목록은 부모가 기존 훅·REST 로 받아 넘긴다 — 이 조각은 그리기만 한다.
 *
 * 착지하는 문은 **이미 있는 둘뿐**이다(⑫(c) 그대로) — 새 단계·행 바꾸기는 사용자 전용 문(`PUT …/steps`),
 * 종류만 바꾸는 것은 좁은 문(`PUT …/steps/:stepId/kind`). 이 조각은 부르기만 하고 스토어를
 * 직접 만지지 않는다(그래야 "메뉴일 때만 다르게 도는" 두 번째 진실이 안 생긴다).
 *
 * 아이콘은 이모지 ❌ — 전부 우리 좌표계의 stroke path 다(CLAUDE.md UI 아이콘 규칙 · ⑪(b)).
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GoalPinSide } from './goalDropTarget.js';
import {
  GOAL_FLOW_TEMPLATES,
  type AvailableSkill,
  type AutoGoalSkillSummary,
  type GoalActionCard,
  type GoalFlowTemplate,
  type SessionGoalStep,
  type VisualKindCard,
} from '@vibisual/shared';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { POPUP_DISMISS } from '../../hooks/popupDismiss.js';
import { KindGlyph, KIND_NEUTRAL } from './StageGlyph.js';

/** 메뉴가 뜬 자리 — 화면 좌표(어디 그릴지)와 캔버스 좌표(무엇이 될지)를 함께 나른다. */
export interface StageMenuAnchor {
  screenX: number;
  screenY: number;
  flowX: number;
  flowY: number;
  /** 노드 위에서 열렸으면 그 단계 id. 빈 자리면 없다. */
  stepId?: string;
  /** ㉖(h) — **핀** 위에서 열렸으면 어느 핀인가. 있으면 이 메뉴는 그 핀의 메뉴다([끊기]). */
  pinSide?: GoalPinSide;
}

/** 메뉴 한 줄. `run` 이 그 줄의 전부다 — 실행하고 메뉴는 닫힌다. */
interface MenuRow {
  id: string;
  label: string;
  hint?: string;
  /** 왼쪽 그림. 종류 카드가 있으면 그 글리프, 없으면 아래 `path` 를 그린다. */
  card?: VisualKindCard;
  path?: string;
  color?: string;
  /** 지금 그것인가(종류 바꾸기에서 현재 종류에 표시). */
  active?: boolean;
  run: () => void;
  /** 줄 오른쪽에 붙는 손잡이(고정·휴지통·꺼내기) — 줄 자체를 누르는 것과 다른 일을 한다. */
  extra?: React.ReactNode;
}

interface MenuGroup {
  key: string;
  title: string;
  rows: MenuRow[];
  /** 줄이 하나도 없을 때 대신 적는 한 줄(빈 것과 고장 난 것을 가른다). */
  empty?: string;
}

/** 작은 손잡이 하나 — 압정·휴지통·꺼내기가 같은 크기·같은 여백으로 선다. */
function RowHandle({
  label,
  onClick,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  tone: 'amber' | 'rose' | 'emerald' | 'gray';
  children: React.ReactNode;
}): React.JSX.Element {
  const color =
    tone === 'amber' ? 'text-amber-300' : tone === 'rose' ? 'hover:text-rose-300' : tone === 'emerald' ? 'hover:text-emerald-300' : 'hover:text-gray-200';
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`flex-shrink-0 rounded p-0.5 text-gray-600 transition-colors ${color}`}
    >
      {children}
    </button>
  );
}

const PIN_PATH = 'M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z';
const TRASH_PATH = 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14';
const RESTORE_PATH = 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5';
/** 스킬 — 번개. 배운 행동의 스킬 카드와 같은 그림(같은 뜻은 같은 그림). */
const SKILL_PATH = 'M13 2L4.09 12.97a1 1 0 0 0 .77 1.63H11l-1 7.4 8.91-10.97a1 1 0 0 0-.77-1.63H12z';
/** 자동 목표 스킬 — 전구. 되풀이한 행동에서 자라난 절차. */
const AUTO_GOAL_SKILL_PATH = 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z';
/** 나란히 놓기 — 두 줄. 무대 노드·사이드바의 `∥` 표식과 같은 그림. */
const PARALLEL_ON_PATH = 'M9 4v16M15 4v16';
/** 줄에서 떼기 — 한 줄로 내려보낸다. */
const PARALLEL_OFF_PATH = 'M12 3v18M8 17l4 4 4-4';
/** ㉖(e) 선 끊기 — 이어져 있던 선이 가운데서 갈린다(가위 ❌ — 자르는 도구가 아니라 관계를 떼는 일이다). */
const CUT_WIRE_PATH = 'M12 3v5M12 16v5M8.5 10.5l7 3M15.5 10.5l-7 3';

function Stroke({ d, className = 'h-3 w-3' }: { d: string; className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={d} />
    </svg>
  );
}

export interface StageCanvasMenuProps {
  anchor: StageMenuAnchor;
  /** 노드 메뉴로 열렸으면 그 단계(빈 자리면 `null`). */
  step: SessionGoalStep | null;
  /** ⑰(a) — 그 단계가 목록의 몇 번째인가(`-1` 이면 없음). 첫 단계는 나란히 놓을 앞 단계가 없다. */
  stepIndex: number;
  kinds: Record<string, VisualKindCard>;
  actions: readonly GoalActionCard[];
  /** ⑰(d) — 이 세션에서 실제로 풀리는 설치 스킬(`ready`·`unknown` 만). */
  skills: readonly AvailableSkill[];
  /** ⑰(d) — 두뇌가 진화시킨 절차(§5.10 v2 (B)). 두뇌가 꺼져 있으면 빈 배열. */
  autoGoalSkills: readonly AutoGoalSkillSummary[];
  /** 목록을 고칠 수 있는가 — 세션·목표가 있어야 착지할 문이 열린다. */
  canEdit: boolean;
  onAddStep: () => void;
  onAddAction: (card: GoalActionCard) => void;
  onApplyFlow: (tpl: GoalFlowTemplate) => void;
  onAddKindStep: (card: VisualKindCard) => void;
  onAddSkill: (skill: AvailableSkill) => void;
  onAddAutoGoalSkill: (skill: AutoGoalSkillSummary) => void;
  onSetKind: (key: string | null) => void;
  onFocusStep: (stepId: string) => void;
  /** ⑰(a) — 앞 단계와 같은 행에 붙이거나(`true`) 뗀다(`false`). 사용자 문으로 간다(행은 차례의 일부). */
  onToggleParallel: (stepId: string, parallel: boolean) => void;
  /**
   * ㉖(e) — **그 단계에 붙은 선을 전부 끊는다**(들어오는 것도 나가는 것도). ⑱ 이 선 몸통의 판정
   * 띠를 0 으로 만든 뒤로 선을 눌러 지우는 길이 없으므로(그 결정은 유지 — 선 근처 우클릭이 노드
   * 메뉴를 못 열던 사고가 그것으로 풀렸다), 선 끝을 빈 자리에 놓는 손짓과 함께 이 칸이 두 번째
   * 길이다. **차례는 건드리지 않는다** — 끊자마자 목록이 뒤섞이면 ⑲ 가 고친 그 오염의 재발이다.
   */
  onClearWires: (stepId: string) => void;
  /** ㉖(e) — 이 단계에 붙은 선이 하나라도 있는가. 없으면 칸을 세우지 않는다(눌러도 아무 일 없는 칸 ❌). */
  stepHasWires: boolean;
  /**
   * ㉖(h) — **그 핀의 선을 끊는다.** 그은 선은 그 방향의 것만 걷히고, 차례가 그리는 선은 두 행이
   * 합쳐지며 사라진다(합쳐진 단계들은 같은 행 = 병렬). 핀 메뉴에서만 부른다.
   */
  onBreakPin: (stepId: string, side: GoalPinSide) => void;
  /** ㉖(h) — 이 핀에 끊을 것이 있는가. 없으면 칸 대신 "끊을 선이 없습니다" 한 줄이다. */
  canBreakPin: boolean;
  /**
   * ⑲(b) — **단계를 목록에서 뺀다.** ⑪(d) 는 이 문을 "끼워 넣기·삭제·순서 바꾸기"라고 적어 두고도
   * 삭제 손잡이를 한 번도 세우지 않았다. 그래서 한 번 들어온 단계는 화면에서 지울 방법이 없었고,
   * 사용자 소유로 박힌 단계는 세션도 못 지워 **영영 남았다**(⑲ 가 고친 그 오염의 다른 절반).
   */
  onDeleteStep: (stepId: string) => void;
  onPinKind: (key: string, pinned: boolean) => void;
  onTrashKind: (key: string, trashed: boolean) => void;
  onPinAction: (id: string, pinned: boolean) => void;
  onAutoLayout: () => void;
  onClose: () => void;
}

export const StageCanvasMenu = memo(function StageCanvasMenu({
  anchor,
  step,
  stepIndex,
  kinds,
  actions,
  skills,
  autoGoalSkills,
  canEdit,
  onAddStep,
  onAddAction,
  onApplyFlow,
  onAddKindStep,
  onAddSkill,
  onAddAutoGoalSkill,
  onSetKind,
  onFocusStep,
  onToggleParallel,
  onClearWires,
  stepHasWires,
  onBreakPin,
  canBreakPin,
  onDeleteStep,
  onPinKind,
  onTrashKind,
  onPinAction,
  onAutoLayout,
  onClose,
}: StageCanvasMenuProps): React.JSX.Element {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');

  // 캔버스 생성 메뉴와 **같은 닫기 규약** — 좌클릭·휠클릭만 닫기 사유고, 우클릭은 메뉴 재오픈용이라 무시한다.
  useOutsidePressDismiss({
    onDismiss: onClose,
    refs: [menuRef],
    graceMs: POPUP_DISMISS.touchOpenGraceMs,
    shouldConsider: (e) => e.button === 0 || e.button === 1,
  });

  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  /** 고르면 실행하고 닫는다 — 메뉴가 열린 채 남으면 다음 우클릭이 어디에 놓일지 알 수 없다. */
  const pick = useCallback((run: () => void) => { run(); onClose(); }, [onClose]);

  const { live, trashed } = useMemo(() => {
    const all = Object.values(kinds);
    return {
      // 씨앗 먼저, 그다음 도움된 순 — 사용자가 실제로 쓰는 것이 앞에 온다(종전 서랍과 같은 차례).
      live: all
        .filter((c) => c.status !== 'trashed')
        .sort((a, b) => Number(!!b.seed) - Number(!!a.seed) || (b.helpfulCount ?? 0) - (a.helpfulCount ?? 0)),
      trashed: all.filter((c) => c.status === 'trashed'),
    };
  }, [kinds]);

  const groups = useMemo<MenuGroup[]>(() => {
    const kindRows = (assign: boolean): MenuRow[] =>
      live.map((card) => ({
        id: `kind:${card.key}`,
        label: card.label,
        ...(card.blurb ? { hint: card.blurb } : {}),
        card,
        ...(card.color ? { color: card.color } : {}),
        active: assign && step?.kind === card.key,
        run: () => (assign ? onSetKind(step?.kind === card.key ? null : card.key) : onAddKindStep(card)),
        extra: (
          <span className="flex flex-shrink-0 items-center gap-0.5">
            <RowHandle
              label={t(card.pinned ? 'ide.stage.kinds.unpin' : 'ide.stage.kinds.pin')}
              onClick={() => onPinKind(card.key, !card.pinned)}
              tone={card.pinned ? 'amber' : 'gray'}
            >
              <Stroke d={PIN_PATH} />
            </RowHandle>
            {/* 씨앗은 버릴 수 없다 — 눌러도 아무 일 없는 손잡이는 없는 손잡이보다 나쁘다(⑪(i)). */}
            {!card.seed && (
              <RowHandle label={t('ide.stage.kinds.trash')} onClick={() => onTrashKind(card.key, true)} tone="rose">
                <Stroke d={TRASH_PATH} />
              </RowHandle>
            )}
          </span>
        ),
      }));

    // ㉖(h) — 핀 메뉴. 노드 메뉴보다 **먼저** 본다 — 핀은 노드 위에 있으므로 둘 다 `stepId` 를 들고 온다.
    if (step && anchor.pinSide) {
      const side = anchor.pinSide;
      return [{
        key: 'pin',
        title: t(side === 'in' ? 'ide.stage.menu.pinInTitle' : 'ide.stage.menu.pinOutTitle'),
        rows: canEdit && canBreakPin
          ? [{
            id: 'breakPin',
            label: t('ide.stage.menu.breakPin'),
            hint: t(side === 'in' ? 'ide.stage.menu.breakPinInHint' : 'ide.stage.menu.breakPinOutHint'),
            path: CUT_WIRE_PATH,
            run: () => onBreakPin(step.id, side),
          } satisfies MenuRow]
          : [],
        empty: canEdit ? t('ide.stage.menu.breakPinNone') : t('ide.stage.menu.readOnly'),
      }];
    }

    if (step) {
      // ── 노드 메뉴 — 이 단계에 대해 할 수 있는 일. ─────────────────────────────
      const parallelOn = stepIndex > 0 && !!step.parallel;
      const out: MenuGroup[] = [
        {
          key: 'step',
          title: t('ide.stage.menu.nodeTitle'),
          rows: [
            {
              id: 'focus',
              label: t('ide.stage.menu.focusStep'),
              hint: step.text,
              path: 'M12 5v14M5 12h14M12 12h.01',
              run: () => onFocusStep(step.id),
            },
            // ⑰(a) — 첫 단계에는 나란히 놓을 앞 단계가 없다(칸 자체를 세우지 않는다 — 눌러도 아무 일 없는 칸 ❌).
            ...(canEdit && stepIndex > 0
              ? [{
                id: 'parallel',
                label: t(parallelOn ? 'ide.stage.menu.parallelOff' : 'ide.stage.menu.parallelOn'),
                hint: t('ide.stage.menu.parallelHint'),
                path: parallelOn ? PARALLEL_OFF_PATH : PARALLEL_ON_PATH,
                active: parallelOn,
                run: () => onToggleParallel(step.id, !parallelOn),
              } satisfies MenuRow]
              : []),
            // ㉖(e)·(h)-3 — 아직 끊을 선이 있을 때만 선다(그은 선이든 차례가 그린 선이든). 끊어도
            //   차례는 그대로다 — 나란히(병렬)로 만드는 손잡이는 바로 위의 [나란히 놓기]다.
            ...(canEdit && stepHasWires
              ? [{
                id: 'clearWires',
                label: t('ide.stage.menu.clearWires'),
                hint: t('ide.stage.menu.clearWiresHint'),
                path: CUT_WIRE_PATH,
                run: () => onClearWires(step.id),
              } satisfies MenuRow]
              : []),
            ...(step.kind
              ? [{
                id: 'clearKind',
                label: t('ide.stage.menu.clearKind'),
                path: 'M18 6 6 18M6 6l12 12',
                run: () => onSetKind(null),
              } satisfies MenuRow]
              : []),
            // ⑲(b) — 지우기는 맨 아래에, 붉은 글리프로. 같은 뜻(버리기)은 종류 휴지통과 같은 그림이다.
            ...(canEdit
              ? [{
                id: 'deleteStep',
                label: t('ide.stage.menu.deleteStep'),
                hint: t('ide.stage.menu.deleteStepHint'),
                path: TRASH_PATH,
                color: '#F87171',
                run: () => onDeleteStep(step.id),
              } satisfies MenuRow]
              : []),
          ],
        },
        { key: 'kinds', title: t('ide.stage.menu.groupKinds'), rows: canEdit ? kindRows(true) : [], empty: t('ide.stage.menu.readOnly') },
      ];
      return out;
    }

    // ── 빈 자리 메뉴 — 여기에 무엇을 놓을 것인가. ───────────────────────────────
    return [
      {
        key: 'new',
        title: t('ide.stage.menu.title'),
        rows: canEdit
          ? [{
            id: 'newStep',
            label: t('ide.stage.menu.newStep'),
            hint: t('ide.stage.menu.newStepHint'),
            path: 'M12 5v14M5 12h14',
            run: onAddStep,
          }]
          : [],
        empty: t('ide.stage.menu.readOnly'),
      },
      {
        key: 'actions',
        title: t('ide.stage.menu.groupActions'),
        empty: t('ide.stage.actions.empty'),
        rows: canEdit
          ? actions.map((card) => ({
            id: `action:${card.id}`,
            label: card.label,
            hint: card.payload,
            ...(card.kind && kinds[card.kind] ? { card: kinds[card.kind] as VisualKindCard } : {}),
            path: card.source === 'skill'
              ? SKILL_PATH
              : card.source === 'command'
                ? 'M4 17l6-6-6-6M12 19h8'
                : 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
            run: () => onAddAction(card),
            extra: (
              <RowHandle
                label={t(card.pinned ? 'ide.stage.actions.unpin' : 'ide.stage.actions.pin')}
                onClick={() => onPinAction(card.id, !card.pinned)}
                tone={card.pinned ? 'amber' : 'gray'}
              >
                <Stroke d={PIN_PATH} />
              </RowHandle>
            ),
          }))
          : [],
      },
      {
        key: 'flows',
        title: t('ide.stage.flow.title'),
        rows: canEdit
          ? GOAL_FLOW_TEMPLATES.map((tpl) => ({
            id: `flow:${tpl.id}`,
            label: t(`ide.stage.flow.${tpl.id}.title`),
            hint: tpl.steps.map((s) => t(`ide.stage.flow.${tpl.id}.steps.${s.key}`)).join(' · '),
            path: tpl.glyph,
            color: tpl.color,
            run: () => onApplyFlow(tpl),
          }))
          : [],
      },
      // ⑰(d) — 설치된 스킬. 고르면 단계 본문이 `/이름` 이 된다(⑫(e) 의 "실시간 스킬로 동작 제어" 그대로).
      {
        key: 'skills',
        title: t('ide.stage.menu.groupSkills'),
        empty: t('ide.stage.menu.skillsEmpty'),
        rows: canEdit
          ? skills.map((skill) => ({
            id: `skill:${skill.source}:${skill.pluginName ?? ''}:${skill.name}`,
            label: `/${skill.name}`,
            ...(skill.description ? { hint: skill.description } : {}),
            ...(kinds[skill.name] ? { card: kinds[skill.name] as VisualKindCard } : {}),
            path: SKILL_PATH,
            run: () => onAddSkill(skill),
          }))
          : [],
      },
      // ⑲ — 자동 목표 스킬. 이 프로젝트에서 **되풀이한 행동**이 스스로 절차로 자란 것 — 고르면
      //   이름이 단계가 되고, 그 절차 파일이 켜진 자리의 프롬프트에 함께 실린다(서버 ⑲).
      {
        key: 'autoGoalSkills',
        title: t('ide.stage.menu.groupAutoGoalSkills'),
        empty: t('ide.stage.menu.autoGoalSkillsEmpty'),
        rows: canEdit
          ? autoGoalSkills.map((skill) => ({
            id: `auto-goal:${skill.id}`,
            label: skill.name,
            ...(skill.description ? { hint: skill.description } : {}),
            path: AUTO_GOAL_SKILL_PATH,
            color: '#C4B5FD',
            run: () => onAddAutoGoalSkill(skill),
          }))
          : [],
      },
      {
        key: 'kinds',
        title: t('ide.stage.menu.groupKinds'),
        rows: canEdit ? kindRows(false) : [],
      },
      {
        key: 'trash',
        title: t('ide.stage.kinds.trashed', { count: trashed.length }),
        rows: trashed.map((card) => ({
          id: `trash:${card.key}`,
          label: card.label,
          card,
          run: () => onTrashKind(card.key, false),
          extra: (
            <RowHandle label={t('ide.stage.kinds.restore')} onClick={() => onTrashKind(card.key, false)} tone="emerald">
              <Stroke d={RESTORE_PATH} />
            </RowHandle>
          ),
        })),
      },
      {
        key: 'canvas',
        title: t('ide.stage.menu.groupCanvas'),
        rows: [{
          id: 'autoLayout',
          label: t('ide.stage.menu.autoLayout'),
          hint: t('ide.stage.menu.autoLayoutHint'),
          path: 'M4 6h16M4 12h10M4 18h7',
          run: onAutoLayout,
        }],
      },
    ];
  }, [
    anchor.pinSide, step, stepIndex, live, trashed, actions, skills, autoGoalSkills, kinds, canEdit, t,
    onAddStep, onAddAction, onApplyFlow, onAddKindStep, onAddSkill, onAddAutoGoalSkill, onSetKind, onFocusStep, onToggleParallel, onClearWires, stepHasWires, onBreakPin, canBreakPin, onDeleteStep,
    onPinKind, onTrashKind, onPinAction, onAutoLayout,
  ]);

  /** 검색은 여섯 갈래를 한 번에 거른다 — 블루프린트에서 사람이 실제로 하는 일은 훑기가 아니라 좁히기다. */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups.filter((g) => g.rows.length > 0 || g.empty);
    return groups
      .map((g) => ({ ...g, rows: g.rows.filter((r) => `${r.label} ${r.hint ?? ''}`.toLowerCase().includes(q)) }))
      .filter((g) => g.rows.length > 0);
  }, [groups, query]);

  const first = shown.find((g) => g.rows.length > 0)?.rows[0];

  // 화면 밖으로 넘치지 않게 뷰포트 안으로 당긴다(캔버스 생성 메뉴와 같은 규약).
  const vw = typeof window !== 'undefined' ? window.innerWidth : 9999;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 9999;
  const left = Math.max(8, Math.min(anchor.screenX, vw - 268));
  // 아래 상한은 메뉴의 최대 높이(`max-h-[22rem]` = 352px)보다 커야 한다 — 작으면 긴 메뉴의 꼬리가
  //   화면 밖으로 나가 [자동 정렬]처럼 맨 아래 칸에 영영 닿지 못한다.
  const top = Math.max(8, Math.min(anchor.screenY, vh - 360));

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-64"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex max-h-[22rem] flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-xl shadow-black/40">
        <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-gray-800 px-2 py-1.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" aria-hidden>
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // 블루프린트와 같은 감각 — 이름을 치고 Enter 면 첫 결과가 그 자리에 선다.
              if (e.key === 'Enter' && first) { e.preventDefault(); pick(first.run); }
            }}
            placeholder={t('ide.stage.menu.search')}
            aria-label={t('ide.stage.menu.search')}
            // 우클릭으로 연 메뉴는 **곧바로 치는 것**이 목적이다 — 손이 검색칸으로 한 번 더 가야 하면
            //   블루프린트의 그 감각이 사라진다(메뉴는 우클릭으로만 열리므로 초점을 뺏지 않는다).
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-[12px] text-gray-100 outline-none placeholder:text-gray-600"
          />
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto py-1">
          {shown.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-gray-500">{t('ide.stage.menu.noMatch')}</p>
          ) : (
            shown.map((group) => (
              <div key={group.key}>
                <p className="px-3 pb-0.5 pt-1.5 text-[12px] font-semibold uppercase tracking-wider text-gray-600">
                  {group.title}
                </p>
                {group.rows.length === 0 ? (
                  <p className="px-3 pb-1 text-[12px] leading-relaxed text-gray-600">{group.empty}</p>
                ) : (
                  <ul>
                    {group.rows.map((row) => (
                      <li key={row.id}>
                        <div
                          className={`flex w-full items-center gap-2 px-3 py-1 transition-colors hover:bg-gray-800 ${
                            row.active ? 'bg-emerald-500/10' : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => pick(row.run)}
                            title={row.hint ?? row.label}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center" style={{ color: row.color ?? row.card?.color ?? KIND_NEUTRAL }}>
                              {row.card
                                ? <KindGlyph card={row.card} className="h-3.5 w-3.5" />
                                : row.path
                                  ? <Stroke d={row.path} className="h-3.5 w-3.5" />
                                  : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className={`truncate text-[12px] ${row.active ? 'text-emerald-200' : 'text-gray-200'}`}>{row.label}</span>
                              {row.hint && <span className="truncate text-[12px] leading-tight text-gray-500">{row.hint}</span>}
                            </span>
                          </button>
                          {row.extra}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});
