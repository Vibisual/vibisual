/**
 * SkillStateTag — §5.5 #17-33 ⑦: 스킬 한 줄이 **못 쓰는 상태면 그 자리에서 고치게** 하는 칸 하나.
 *
 * 이름은 태그지만 **주된 일은 표시가 아니라 손잡이다** (사용자 지시 — "태그를 제대로 달라는게
 * 아니라 스킬은 보이는데 못쓰는 상태라면 설치버튼을 누르거나 켜짐 버튼을 누르란소리야").
 * 그래서 눌리는 자리의 라벨은 **할 일**(`설치`·`켜기`)이고 상태 명사가 아니다 — `미설치` 는
 * 사실만 알려 줄 뿐 무엇을 하라고 말하지 않아, 읽고 나서도 어디를 눌러야 할지 다시 찾게 된다.
 * 상태 자체는 실릴 때(`켜짐`)와 누를 수 없는 자리에서만 이름으로 나온다.
 *
 * 세 자리(Skills 사이드바 #17-4 · 에이전트 설정의 기본 스킬 #12-1 · `/` 자동완성 #17-2)가 각자
 * 자기 칩을 그리고 있었고, 셋 다 `installed === false || enabled === false` 라는 **같은 식을 따로**
 * 들고 있었다. 그래서 두 가지가 함께 어긋났다:
 *
 *  1. 그 식은 **못 쓰는 것만** 말했다 — 멀쩡히 실리는 스킬은 아무 표시가 없어, 사용자는 표시가
 *     없는 줄이 "괜찮은 것" 인지 "아직 안 물어본 것" 인지 구분할 수 없었다.
 *  2. 그 식은 **남의 프로젝트에 매인 것**을 사용자가 끈 것과 같은 `꺼짐` 한 칸에 담았다. 처방이
 *     다른데(뒤쪽은 user 범위에 켤 설치본이 아예 없다) 같은 칸이라 틀린 처방이 나갔고, 눌러도
 *     아무 일이 없었다.
 *
 * 그래서 접는 일은 shared `resolveSkillPluginState` 한 곳으로 보내고, 그리는 일은 이 컴포넌트
 * 하나로 모은다. **세 자리가 같은 말을 하도록 강제하는 것이 이 파일의 존재 이유다.**
 *
 * `onFix` 를 안 넘기면 표시 전용이다 — `/` 자동완성이 그 자리다. 타이핑 중 드롭다운이 git 을 타는
 * 설치를 시작하면 그게 더 놀랍다(⑦(e)).
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

/**
 * 상태 → 라벨 키. `unknown` 은 여기 없다 — 그리지 않기 때문이다.
 *
 * **눌리는 자리는 상태 이름이 아니라 할 일 이름을 단다** (사용자 지시 — "태그를 제대로 달라는게
 * 아니라 스킬은 보이는데 못쓰는 상태라면 설치버튼을 누르거나 켜짐 버튼을 누르란소리야").
 * `미설치` 는 사실을 알려 줄 뿐 무엇을 하라고 말하지 않는다 — 사용자는 그것을 읽고도 어디를
 * 눌러야 할지 다시 찾아야 한다. `설치`·`켜기` 는 누르면 무슨 일이 나는지가 곧 라벨이다.
 * 왜 그런 상태인지(다른 프로젝트에 매였다 등)는 아래 `TITLE_KEY` 로 내려보낸다.
 *
 * `ready` 만 예외다 — 누를 것이 없으니 그때는 상태 그대로 `켜짐` 이라고 적는다.
 */
const LABEL_KEY: Record<Exclude<SkillPluginState, 'unknown'>, string> = {
  ready: 'common.skillState.ready',
  disabled: 'common.skillState.actionEnable',
  'other-project': 'common.skillState.actionInstall',
  'not-installed': 'common.skillState.actionInstall',
};

/**
 * 고칠 손잡이가 **없는** 자리(`/` 자동완성처럼 표시만 하는 곳)에서 쓸 라벨. 거기서는 누를 수
 * 없으니 `설치` 라고 적으면 거짓말이 된다 — 그 자리는 상태를 그대로 말한다.
 */
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
