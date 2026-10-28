/**
 * SDK system subtype(`[subtype]` 이벤트)을 글리프 + 색 + 번역 라벨 한 줄로. 꼴이 안 맞으면 `parseSystemSubtype` 가 null → 호출부가 텍스트로 폴백.
 * §5.5 #17-13 ⑤-1 — 밀도 `원문` 에서만 보여 라벨은 늘 펼친다. ⑤-6 — 원·레일 없이 글리프만, 색도 글리프에만. 작아서 윤곽으로 안 읽히는 형태는 채운다.
 * ⚠ `GLYPH_SIZE_PX`(15)·`strokeWidth`(2.2)는 한 쌍. 새 글리프는 이웃한 두 획의 중심을 4 그리드 이상 떼라 — 좁으면 획이 붙어 `✳` 얼룩이 된다.
 */
import { useTranslation } from 'react-i18next';
import type { StreamTaskInfo, StreamTaskStatus } from '@vibisual/shared';

// §5.5 — 판정 본체는 shared(서버 복원 예산 제외와 클라 표시 필터가 같은 규칙이어야 한다). 호출부용 재export(⑤-3 payload 파서 포함).
export { parseSystemSubtype, parseSystemTaskInfo } from '@vibisual/shared';

/** 한 subtype 의 표현 = 글리프 + 색 한 벌 + 번역 키. */
export interface SystemNodeStyle {
  /** 표현 계열 이름 — 화면엔 안 나오고 단위 테스트가 "무슨 모양으로 떨어졌나"를 확인하는 손잡이다. */
  family: string;
  /** 왼쪽 글리프(24 viewBox stroke path). */
  glyph: React.JSX.Element;
  /** 글리프 색 — 이 줄에서 **색이 붙는 유일한 자리**다(⑤-6). */
  mark: string;
  /** 라벨 색 — 무채색이 기본이고, 사용자가 멈춰 서야 하는 경고 계열만 옅게 물든다. */
  label: string;
  /** 번역 키(`ide.systemNode.*`). 없으면 subtype 를 사람이 읽게 다듬어 쓴다. */
  labelKey: string;
}

/** 획 = strokeWidth × 15/24 ≈ 1.375px — 4 그리드(2.5px) 떼야 두 획 사이에 빈 곳이 남는다. */
const GLYPH_SIZE_PX = 15;
const GLYPH_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'h-[15px] w-[15px]',
  'aria-hidden': true,
} as const;

/** 채워서 그리는 도형(이 크기에서 윤곽선만으론 형태가 안 읽히는 것)용 덮어쓰기. */
const FILL_PROPS = { fill: 'currentColor', stroke: 'none' } as const;

/** 시작 — 재생 삼각형(채움: 속 빈 삼각형은 이 크기에서 세 줄로 보인다). */
const GlyphStart = (
  <svg {...GLYPH_PROPS}>
    <path d="M8.5 6 18 12 8.5 18Z" {...FILL_PROPS} />
  </svg>
);
/** 완료 — 체크. */
const GlyphDone = (
  <svg {...GLYPH_PROPS}>
    <path d="M5 12.5 9.5 17 19 7" />
  </svg>
);
/** 알림 — 종. 꼭지가 없으면 "가방"으로 읽혀서 위에 짧은 기둥을 얹는다. */
const GlyphBell = (
  <svg {...GLYPH_PROPS}>
    <path d="M5.5 17.5h13" />
    <path d="M8 17.5v-5a4 4 0 0 1 8 0v5" />
    <path d="M12 6.5v2" />
  </svg>
);
/** 갱신 — 연필(채움: 윤곽선 연필은 이 크기에서 기울어진 캡슐로 뭉갠다). */
const GlyphEdit = (
  <svg {...GLYPH_PROPS}>
    <path d="M16.2 3.8 20.2 7.8 8.5 19.5 3.5 20.5 4.5 15.5Z" {...FILL_PROPS} />
  </svg>
);
/** 진행 — 맥박선(봉우리를 하나로 몰아 이웃 획과 떼어 놓는다). */
const GlyphPulse = (
  <svg {...GLYPH_PROPS}>
    <path d="M3 12h4.5L10.5 5.5 14 18.5l2.5-6.5H21" />
  </svg>
);
/** 사고 — 말줄임(채운 점 셋). */
const GlyphThinking = (
  <svg {...GLYPH_PROPS}>
    <circle cx="5.5" cy="12" r="1.9" {...FILL_PROPS} />
    <circle cx="12" cy="12" r="1.9" {...FILL_PROPS} />
    <circle cx="18.5" cy="12" r="1.9" {...FILL_PROPS} />
  </svg>
);
/**
 * 컨텍스트 압축 — 위아래에서 가운데로 모이는 화살촉 둘.
 * 가운데 가로선을 함께 두면 이 크기에서 세 획이 붙어 `✳` 가 된다 — 두 획으로 줄이고 5 그리드 벌렸다.
 */
const GlyphCompact = (
  <svg {...GLYPH_PROPS}>
    <path d="M7 4.5 12 9.5l5-5" />
    <path d="M7 19.5 12 14.5l5 5" />
  </svg>
);
/** 그 밖 — 정보 점. */
const GlyphInfo = (
  <svg {...GLYPH_PROPS}>
    <circle cx="12" cy="6.5" r="1.8" {...FILL_PROPS} />
    <path d="M12 11v7.5" />
  </svg>
);
/** 오류 — 경고 삼각형(안쪽 점은 빗변과 붙어 얼룩이 돼 뺐다 — 획 하나로 충분히 읽힌다). */
const GlyphWarn = (
  <svg {...GLYPH_PROPS}>
    <path d="M12 3.5 21.5 20H2.5Z" />
    <path d="M12 10v6" />
  </svg>
);
/** 재시도 — 회전 화살표. */
const GlyphRetry = (
  <svg {...GLYPH_PROPS}>
    <path d="M20 12a8 8 0 1 1-2.4-5.7" />
    <path d="M20.5 3.5v5h-5" />
  </svg>
);
/** 모델 대체 — 갈라지는 두 갈래. */
const GlyphFallback = (
  <svg {...GLYPH_PROPS}>
    <path d="M2.5 12h6" />
    <path d="M8.5 12 14 5.5h7" />
    <path d="M8.5 12 14 18.5h7" />
  </svg>
);
/** 중단 — 정지 사각형(채움). */
const GlyphStop = (
  <svg {...GLYPH_PROPS}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" {...FILL_PROPS} />
  </svg>
);
/** 권한 — 자물쇠(몸통을 채워야 고리와 붙지 않고 자물쇠로 읽힌다). */
const GlyphLock = (
  <svg {...GLYPH_PROPS}>
    <rect x="5" y="11" width="14" height="8.5" rx="2.5" {...FILL_PROPS} />
    <path d="M8.25 11V7.75a3.75 3.75 0 0 1 7.5 0V11" />
  </svg>
);
/** 요약 — 글줄 셋(문서 테두리는 안쪽 줄과 3.5 그리드로 붙어 네모 얼룩이 됐다 — 줄만 남긴다). */
const GlyphSummary = (
  <svg {...GLYPH_PROPS}>
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h10" />
  </svg>
);
/** 백그라운드 작업 — 겹친 판(앞 판을 채워 뒤 판과 갈라 보이게). */
const GlyphLayers = (
  <svg {...GLYPH_PROPS}>
    <path d="M8.5 3.5h12v12" />
    <rect x="3.5" y="8.5" width="12" height="12" rx="2" {...FILL_PROPS} />
  </svg>
);
/** 명령 목록 — 터미널 꺾쇠. */
const GlyphCommand = (
  <svg {...GLYPH_PROPS}>
    <path d="m5 7 5 5-5 5" />
    <path d="M13 17h6" />
  </svg>
);
/** 기억 — 책갈피(채움). */
const GlyphMemory = (
  <svg {...GLYPH_PROPS}>
    <path d="M7 4.5h10v15l-5-4-5 4Z" {...FILL_PROPS} />
  </svg>
);
/** 훅 — 이어진 고리. */
const GlyphHook = (
  <svg {...GLYPH_PROPS}>
    <path d="M9 12h6" />
    <path d="M8.5 7.5H7.5a4.5 4.5 0 0 0 0 9h1" />
    <path d="M15.5 7.5h1a4.5 4.5 0 0 1 0 9h-1" />
  </svg>
);

/** §5.5 #17-13 ⑤-6 — 색은 글리프에만(줄 전체가 물들면 열두 색의 잡음). 라벨은 무채색 두 단, 경고 계열만 옅게. 잉크 `-300/75` 는 네온이 안 되면서 라벨보다 먼저 보인다. */
const TONE = {
  start: { mark: 'text-sky-300/75', label: 'text-gray-300' },
  done: { mark: 'text-emerald-300/75', label: 'text-gray-300' },
  notify: { mark: 'text-amber-300/75', label: 'text-gray-300' },
  update: { mark: 'text-indigo-300/75', label: 'text-gray-300' },
  think: { mark: 'text-violet-300/75', label: 'text-gray-400/80' },
  compact: { mark: 'text-fuchsia-300/75', label: 'text-gray-300' },
  alert: { mark: 'text-rose-300/75', label: 'text-rose-200/80' },
  memory: { mark: 'text-teal-300/75', label: 'text-gray-300' },
  quiet: { mark: 'text-gray-400/80', label: 'text-gray-400/80' },
} as const;

/**
 * 진행·상태·목록 변경류(원문 밀도에서 가장 잦다)는 무채색(`quiet`). 실측(`sub-streams` 집계) `system` 으로 실제 오는 것은 8종:
 * task_started(3,296)·task_notification(3,291)·task_updated(482)·compact_boundary(78)·command_received(32)·permission_denied(30)·api_retry(21)·code_change_published(7).
 * 이름표에 없으면 영어 원문이 뜬다 — 그 밖은 PATTERN_RULES 가 받는다(하나씩 번역 키를 두면 안 뜰 줄에 12 로케일이 묶인다).
 */
const STYLES: Record<string, SystemNodeStyle> = {
  task_started: { family: 'start', glyph: GlyphStart, ...TONE.start, labelKey: 'ide.systemNode.taskStarted' },
  task_completed: { family: 'done', glyph: GlyphDone, ...TONE.done, labelKey: 'ide.systemNode.taskCompleted' },
  task_notification: { family: 'notify', glyph: GlyphBell, ...TONE.notify, labelKey: 'ide.systemNode.taskNotification' },
  notification: { family: 'notify', glyph: GlyphBell, ...TONE.notify, labelKey: 'ide.systemNode.notification' },
  task_updated: { family: 'update', glyph: GlyphEdit, ...TONE.update, labelKey: 'ide.systemNode.taskUpdated' },
  task_progress: { family: 'progress', glyph: GlyphPulse, ...TONE.quiet, labelKey: 'ide.systemNode.taskProgress' },
  task_summary: { family: 'summary', glyph: GlyphSummary, ...TONE.quiet, labelKey: 'ide.systemNode.taskSummary' },
  thinking_tokens: { family: 'think', glyph: GlyphThinking, ...TONE.think, labelKey: 'ide.systemNode.thinkingTokens' },
  compact_boundary: { family: 'compact', glyph: GlyphCompact, ...TONE.compact, labelKey: 'ide.systemNode.compactBoundary' },
  status: { family: 'info', glyph: GlyphInfo, ...TONE.quiet, labelKey: 'ide.systemNode.status' },
  background_tasks_changed: { family: 'layers', glyph: GlyphLayers, ...TONE.quiet, labelKey: 'ide.systemNode.backgroundTasksChanged' },
  commands_changed: { family: 'command', glyph: GlyphCommand, ...TONE.quiet, labelKey: 'ide.systemNode.commandsChanged' },
  // ⑤-6 — 실측으로 도착하는데 이름표가 없어 영어로 떴던 둘.
  command_received: { family: 'command', glyph: GlyphCommand, ...TONE.quiet, labelKey: 'ide.systemNode.commandReceived' },
  code_change_published: { family: 'done', glyph: GlyphDone, ...TONE.done, labelKey: 'ide.systemNode.codeChangePublished' },
  api_retry: { family: 'retry', glyph: GlyphRetry, ...TONE.notify, labelKey: 'ide.systemNode.apiRetry' },
  api_error: { family: 'alert', glyph: GlyphWarn, ...TONE.alert, labelKey: 'ide.systemNode.apiError' },
  model_refusal_fallback: { family: 'fallback', glyph: GlyphFallback, ...TONE.alert, labelKey: 'ide.systemNode.modelFallback' },
  model_fallback: { family: 'fallback', glyph: GlyphFallback, ...TONE.alert, labelKey: 'ide.systemNode.modelFallback' },
  interrupt: { family: 'stop', glyph: GlyphStop, ...TONE.alert, labelKey: 'ide.systemNode.interrupt' },
  permission_denied: { family: 'permission', glyph: GlyphLock, ...TONE.notify, labelKey: 'ide.systemNode.permissionDenied' },
};

/** 모르는 subtype 은 어미·머리로 계열을 잡는다(판마다 는다). 순서 = 우선순위. 라벨은 원문을 다듬어 쓴다(`worker_shutting_down` → `Worker Shutting Down`). */
const PATTERN_RULES: { test: RegExp; style: Omit<SystemNodeStyle, 'labelKey'> }[] = [
  { test: /(^error_|_error$|_failed$|_failure$|refusal)/, style: { family: 'alert', glyph: GlyphWarn, ...TONE.alert } },
  { test: /(^interrupt|shutting_down|_killed$|^stop_)/, style: { family: 'stop', glyph: GlyphStop, ...TONE.alert } },
  // 권한이 재시도보다 먼저 — `permission_retry` 는 "다시 물어본다"가 아니라 **권한** 이야기다.
  { test: /permission|^elicitation|request_user_/, style: { family: 'permission', glyph: GlyphLock, ...TONE.notify } },
  { test: /(_retry$|^api_)/, style: { family: 'retry', glyph: GlyphRetry, ...TONE.notify } },
  { test: /^model_/, style: { family: 'fallback', glyph: GlyphFallback, ...TONE.alert } },
  { test: /^memory_/, style: { family: 'memory', glyph: GlyphMemory, ...TONE.memory } },
  { test: /^hook_/, style: { family: 'hook', glyph: GlyphHook, ...TONE.quiet } },
  { test: /_summary$/, style: { family: 'summary', glyph: GlyphSummary, ...TONE.quiet } },
  { test: /^background_tasks/, style: { family: 'layers', glyph: GlyphLayers, ...TONE.quiet } },
  { test: /^commands?_|^local_command/, style: { family: 'command', glyph: GlyphCommand, ...TONE.quiet } },
  { test: /(_changed$|_updated$|^set_|^rename_|^reload_)/, style: { family: 'update', glyph: GlyphEdit, ...TONE.update } },
  { test: /(^task_started$|^turn_starting$|_started$)/, style: { family: 'start', glyph: GlyphStart, ...TONE.start } },
  { test: /(_completed$|_published$|_saved$)/, style: { family: 'done', glyph: GlyphDone, ...TONE.done } },
  { test: /notification$/, style: { family: 'notify', glyph: GlyphBell, ...TONE.notify } },
];

const FALLBACK_STYLE: SystemNodeStyle = { family: 'info', glyph: GlyphInfo, ...TONE.quiet, labelKey: '' };

/** 이름표 → 계열 패턴 → 기본(정보 점) 순(systemNodeStyle.test.ts). */
export function resolveSystemNodeStyle(subtype: string): SystemNodeStyle {
  const known = STYLES[subtype];
  if (known) return known;
  for (const rule of PATTERN_RULES) {
    if (rule.test.test(subtype)) return { ...rule.style, labelKey: '' };
  }
  return FALLBACK_STYLE;
}

/** 미지의 subtype 은 underscore→공백 + 단어 첫 글자 대문자화(번역 대상이 아니므로 원문을 다듬어 보여준다). */
export function humanizeSubtype(subtype: string): string {
  return subtype.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** §5.5 #17-13 ⑤-3 — 끝난 방식의 표현. 시작·끝이 한 줄로 접히면 그 줄은 결과라 시작 글리프 대신 이 표를 쓴다. */
const STATUS_STYLES: Record<StreamTaskStatus, SystemNodeStyle> = {
  completed: { family: 'done', glyph: GlyphDone, ...TONE.done, labelKey: 'ide.systemNode.taskCompleted' },
  failed: { family: 'alert', glyph: GlyphWarn, ...TONE.alert, labelKey: 'ide.systemNode.taskFailed' },
  stopped: { family: 'stop', glyph: GlyphStop, ...TONE.quiet, labelKey: 'ide.systemNode.taskStopped' },
};

/** 소요 시간 한 낱말의 번역 키 + 값. 1초 미만은 ms, 1분 미만은 초, 그 위는 분(소수 1자리). */
export function taskDurationLabel(ms: number | undefined): { key: string; value: string } | null {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return { key: 'ide.systemNode.durationMs', value: String(Math.round(ms)) };
  if (ms < 60_000) return { key: 'ide.systemNode.durationSec', value: (ms / 1000).toFixed(1) };
  return { key: 'ide.systemNode.durationMin', value: (ms / 60_000).toFixed(1) };
}

/**
 * §5.5 #17-13 ⑤-6 — 24px 자리에 글리프만(테두리 원은 줄마다 스티커가 되고 형태를 뭉갠다, 레일은 줄 사이 조각으로만 남는다). 줄 높이 22px 가 세로 리듬.
 * ⑤-3 — `task` payload 가 있으면 라벨 자리에 작업 이름, 오른쪽에 결과·소요 시간.
 */
export function SystemNode({ subtype, task }: { subtype: string; task?: StreamTaskInfo | null }): React.JSX.Element {
  const { t } = useTranslation();
  const statusStyle = task?.status ? STATUS_STYLES[task.status] : null;
  const style = statusStyle ?? resolveSystemNodeStyle(subtype);
  // 작업 이름 → 서브에이전트 종류 → 끝의 요약 순으로 이름을 찾는다(짝 없는 끝은 요약이 유일한 단서).
  const name = task?.description ?? task?.subagentType ?? task?.summary ?? '';
  const label = name || (style.labelKey ? t(style.labelKey) : humanizeSubtype(subtype));
  // 이름이 라벨 자리를 차지했으면 결과 낱말은 오른쪽 메타로 물러난다(둘 다 왼쪽에 두면 이름이 밀린다).
  const duration = taskDurationLabel(task?.durationMs);
  const meta = [
    name && statusStyle ? t(statusStyle.labelKey) : '',
    duration ? t(duration.key, { value: duration.value }) : '',
  ].filter(Boolean).join(' · ');
  return (
    <div className="flex min-h-[22px] items-stretch pl-3">
      <span className={`flex w-6 flex-shrink-0 items-center justify-center ${style.mark}`}>
        {style.glyph}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 py-0.5 pl-2">
        <span className={`truncate text-[12px] font-[450] leading-none ${style.label}`}>{label}</span>
        {meta && (
          <span className="flex-shrink-0 whitespace-nowrap text-[12px] leading-none text-gray-500">{meta}</span>
        )}
      </span>
    </div>
  );
}

/** 실험판·회귀 테스트가 "크기를 바꾸면 굵기도 바꿨는가"를 확인하는 손잡이. */
export const GLYPH_METRICS = { sizePx: GLYPH_SIZE_PX, strokeWidth: GLYPH_PROPS.strokeWidth } as const;
