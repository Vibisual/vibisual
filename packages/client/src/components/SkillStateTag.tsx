/**
 * §5.5 #17-33 ⑦ — 못 쓰는 스킬을 그 자리에서 고치게 하는 손잡이. 눌리는 라벨은 할 일(`설치`·`켜기`), 상태 이름은 `켜짐`·누를 수 없는 자리에서만.
 * 세 자리(Skills 사이드바 #17-4 · 기본 스킬 #12-1 · `/` 자동완성 #17-2)가 같은 말을 하게, 접기는 shared `resolveSkillPluginState`, 그리기는 여기 한 곳.
 * 남의 프로젝트에 매인 것은 끈 것과 처방이 다르다(user 범위엔 켤 설치본이 없다). `onFix` 가 없으면 표시 전용(자동완성에서 git 설치를 시작하지 않게, ⑦(e)).
 */
import { useTranslation } from 'react-i18next';

import { resolveSkillPluginState, skillFixAction, type AvailableSkill, type SkillPluginState } from '@vibisual/shared';

/** 태그가 읽는 칸만 받는다 — 목록 한 줄 전체를 요구하면 부르는 자리마다 모양이 달라진다. */
export type SkillStateTagSkill = Pick<
  AvailableSkill,
  'name' | 'source' | 'installed' | 'enabled' | 'placement' | 'pluginId' | 'pluginName'
>;

interface SkillStateTagProps {
  skill: SkillStateTagSkill;
  /** 넘기면 태그가 손잡이가 된다. 안 넘기면 표시 전용. */
  onFix?: (action: 'install' | 'enable') => void;
  /** 지금 이 스킬을 고치는 중인가. */
  busy?: boolean;
  /** 직전 시도가 실패했으면 그 사유 — **삼키지 않는다.** 눌렀는데 조용한 것이 가장 나쁘다. */
  error?: string;
  className?: string;
}

/** 눌리는 자리의 라벨 키 — 할 일(`설치`·`켜기`)을 단다. 이유는 `TITLE_KEY`, `ready` 만 `켜짐`, `unknown` 은 안 그린다. */
const LABEL_KEY: Record<Exclude<SkillPluginState, 'unknown'>, string> = {
  ready: 'common.skillState.ready',
  disabled: 'common.skillState.actionEnable',
  'other-project': 'common.skillState.actionInstall',
  'not-installed': 'common.skillState.actionInstall',
};

/** 표시만 하는 자리(`/` 자동완성)의 라벨 — 누를 수 없으니 상태를 그대로 말한다. */
const STATE_LABEL_KEY: Record<Exclude<SkillPluginState, 'unknown'>, string> = {
  ready: 'common.skillState.ready',
  disabled: 'common.skillState.disabled',
  'other-project': 'common.skillState.otherProject',
  'not-installed': 'common.skillState.notInstalled',
};

/** 상태 → 설명 키(호버). 왜 그런지와 누르면 무엇이 일어나는지를 함께 적는다. */
const TITLE_KEY: Record<Exclude<SkillPluginState, 'unknown'>, string> = {
  ready: 'common.skillState.readyTitle',
  disabled: 'common.skillState.disabledTitle',
  'other-project': 'common.skillState.otherProjectTitle',
  'not-installed': 'common.skillState.notInstalledTitle',
};

/** 실리는 것은 초록, 손봐야 하는 것은 호박. 색만으로 말하지 않고 글자도 함께 바뀐다. */
const TONE: Record<Exclude<SkillPluginState, 'unknown'>, string> = {
  ready: 'bg-emerald-500/15 text-emerald-300/90',
  disabled: 'bg-amber-500/15 text-amber-300/90',
  'other-project': 'bg-amber-500/15 text-amber-300/90',
  'not-installed': 'bg-amber-500/15 text-amber-300/90',
};

/** 한글 가독 하한 12px — 작은 칩이라고 11px 로 내리지 않는다. */
const BASE = 'flex-shrink-0 rounded px-1 py-0.5 text-[12px] font-semibold tracking-wide';

export function SkillStateTag({ skill, onFix, busy, error, className = '' }: SkillStateTagProps): JSX.Element | null {
  const { t } = useTranslation();
  const state = resolveSkillPluginState(skill);
  // CLI 에 못 물었으면 아무 말도 하지 않는다 — 멀쩡한 스킬에 "미설치" 를 잘못 붙이는 것이
  // 잠깐 조용한 것보다 나쁘다(⑦(f)).
  if (state === 'unknown') return null;

  const name = skill.pluginName ?? skill.name;

  // 직전 시도가 실패했으면 그것이 지금 말할 것이다. 사유는 호버로 끝까지 보여 준다.
  if (error) {
    return (
      <span
        className={`${BASE} bg-rose-500/15 text-rose-300/90 ${className}`}
        title={t('common.skillState.failedTitle', { name, reason: error })}
      >
        {t('common.skillState.failed')}
      </span>
    );
  }

  if (busy) {
    return (
      <span className={`${BASE} ${TONE[state]} ${className}`} title={t('common.skillState.workingTitle', { name })}>
        {t('common.skillState.working')}
      </span>
    );
  }

  const title = t(TITLE_KEY[state], { name });
  const action = skillFixAction(state);

  // 고칠 수 있고, 고칠 자리이며, CLI 에 넘길 식별자가 있을 때만 손잡이가 된다.
  // 그때 라벨은 **할 일**(`설치`·`켜기`)이고, 왜 그런지는 `title` 이 말한다.
  if (action && onFix && skill.pluginId) {
    return (
      <button
        type="button"
        draggable={false}
        onClick={(e) => { e.stopPropagation(); onFix(action); }}
        onMouseDown={(e) => e.stopPropagation()}
        onDragStart={(e) => e.preventDefault()}
        title={title}
        className={`${BASE} ${TONE[state]} transition-colors hover:bg-amber-500/30 disabled:opacity-50 ${className}`}
      >
        {t(LABEL_KEY[state])}
      </button>
    );
  }

  // 누를 수 없는 자리 — 여기서 `설치` 라고 적으면 누를 데가 없는데 시키는 꼴이 된다.
  return <span className={`${BASE} ${TONE[state]} ${className}`} title={title}>{t(STATE_LABEL_KEY[state])}</span>;
}
