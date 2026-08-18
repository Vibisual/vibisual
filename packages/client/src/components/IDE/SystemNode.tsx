/**
 * SystemNode — SDK system 메시지 subtype(task_started 등)을 왼쪽 타임라인 레일 위의
 * "뜻이 보이는 한 줄"로 표현한다. subtype 마다 전용 글리프 + 색 + 번역 라벨을 붙인다.
 *
 * 서버(parseStreamLine)가 `[subtype]` 형태로 보내는 system 이벤트를 날 텍스트 대신 노드로 렌더한다.
 * 권한 승인 결정 같은 임의 본문(emitSystemMessage)이나 짝 없는 tool_result(`[ToolName] ...`)는
 * `[word]` 단독 패턴에 매칭되지 않으므로 parseSystemSubtype 가 null 을 반환해 호출부가 텍스트로 폴백한다.
 *
 * §5.5 #17-13 ⑤-1 (v4.99) — 이 칩은 밀도 `원문` 에서만 보인다(간결/표준은 표시 단계에서 제거).
 *   그래서 "다 보여 달라"는 밀도의 뜻에 맞춰 라벨을 **항상 펼쳐** 둔다 — 종전엔 점 하나에 hover 라벨이라
 *   화면에는 뜻 없는 점만 세로로 쌓였고, 그 라벨도 번역되지 않은 하드코딩 영어였다.
 *
 * ⚠ 글리프는 24 그리드로 그려 **아주 작게 줄여** 놓으므로, stroke 굵기와 좌표 밀도를 그 배율에 맞춰야 한다.
 *   종전엔 `strokeWidth: 2` 를 12px(h-3)로 줄여 유효 굵기가 정확히 **1 CSS px** 이 되었고, 그 1px 선이
 *   Windows 표시 배율(125·150%)의 서브픽셀에 걸려 회색으로 번졌다 — 아이콘이 "해상도 낮은 이미지" 처럼
 *   보이던 직접 원인이다. 거기에 24 폭을 다 쓰는 지그재그·세 줄 문서·화살촉 둘 같은 세부가 겹쳐 뭉갰고,
 *   말줄임표는 길이 `0.01` 선분에 둥근 캡을 씌운 것이라 지름 1px 얼룩 셋으로 렌더됐다.
 *   지금은 ① 14px + strokeWidth 2.5(= 화면 1.46px)로 선을 되살리고, ② 잉크 범위를 24 그리드의 4~20 으로
 *   모으고, ③ 삼각형·사각형·점처럼 **이 크기에서 윤곽선으로는 안 읽히는 모양은 채워서** 그린다.
 */
import { useTranslation } from 'react-i18next';
import type { StreamTaskInfo, StreamTaskStatus } from '@vibisual/shared';

// §5.5 v4.92 — 판정 본체는 shared 로 옮겼다. 서버가 이 칩을 **복원 예산에서 빼는** 판정과
//   클라의 표시 필터가 같은 규칙이어야 해서다(둘이 갈라지면 한쪽만 남기고 한쪽만 그린다).
//   기존 호출부(streamItems 등)가 그대로 쓰도록 여기서 재export 한다.
// §5.5 #17-13 ⑤-3 — 작업 칩 payload 파서도 같은 자리에서 함께 내보낸다(호출부는 이 모듈만 보면 된다).
export { parseSystemSubtype, parseSystemTaskInfo } from '@vibisual/shared';

/** 한 subtype 의 표현 = 글리프 + 색 한 벌 + 번역 키. */
export interface SystemNodeStyle {
  /** 표현 계열 이름 — 화면엔 안 나오고 단위 테스트가 "무슨 모양으로 떨어졌나"를 확인하는 손잡이다. */
  family: string;
  /** 레일 위 글리프(24 viewBox stroke path). */
  glyph: React.JSX.Element;
  /** 글리프 원의 테두리·글자색(= 아이콘 색). */
  mark: string;
  /** 라벨 색 — 색을 남발하지 않도록 뜻이 강한 것만 물들인다. */
  label: string;
  /** 번역 키(`ide.systemNode.*`). 없으면 subtype 를 사람이 읽게 다듬어 쓴다. */
  labelKey: string;
}

/**
 * 모든 글리프가 쓰는 한 벌 — 크기·굵기를 여기 한 곳에서 정한다.
 *
 * `strokeWidth` 는 24 그리드 기준값이라 화면 굵기 = `strokeWidth × (렌더px / 24)` 다.
 * 14px 렌더에 2.5 면 화면에서 약 1.46px — 배율 125%(1.82 device px)·150%(2.19 device px) 어디서도
 * 선이 회색으로 사라지지 않는다. **크기를 바꾸면 이 값도 같이 손봐야 한다**(12px 로 되돌리면 다시 1.25px).
 */
const GLYPH_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'h-3.5 w-3.5',
  'aria-hidden': true,
} as const;

/** 채워서 그리는 도형(작은 크기에서 윤곽선만으론 형태가 안 읽히는 것)용 덮어쓰기. */
const FILL_PROPS = { fill: 'currentColor', stroke: 'none' } as const;

/** 시작 — 재생 삼각형(채움: 이 크기에선 속 빈 삼각형이 세 줄로 보인다). */
const GlyphStart = (
  <svg {...GLYPH_PROPS}>
    <path d="M8.5 5 19 12 8.5 19Z" {...FILL_PROPS} />
  </svg>
);
/** 완료 — 체크. */
const GlyphDone = (
  <svg {...GLYPH_PROPS}>
    <path d="m19 7-9.5 9.5L5 12" />
  </svg>
);
/** 알림 — 종. */
const GlyphBell = (
  <svg {...GLYPH_PROPS}>
    <path d="M17.5 10a5.5 5.5 0 1 0-11 0c0 5-2.5 6.5-2.5 6.5h16s-2.5-1.5-2.5-6.5" />
    <path d="M10.5 17a1.8 1.8 0 0 0 3 0" />
  </svg>
);
/** 갱신 — 연필(밑줄은 이 크기에서 연필 끝과 붙어 뭉개져 뺐다). */
const GlyphEdit = (
  <svg {...GLYPH_PROPS}>
    <path d="M16.5 4a2 2 0 0 1 3 3L7.5 19l-4 1 1-4Z" />
  </svg>
);
/** 진행 — 맥박선(진폭을 줄여 봉우리가 서로 붙지 않게). */
const GlyphPulse = (
  <svg {...GLYPH_PROPS}>
    <path d="M4 12h3.5L10 7.5l4 9 2.5-4.5H20" />
  </svg>
);
/** 사고 — 말줄임(채운 점 셋: 길이 0 선분 + 둥근 캡이던 종전 방식은 1px 얼룩으로 뭉갰다). */
const GlyphThinking = (
  <svg {...GLYPH_PROPS}>
    <circle cx="6" cy="12" r="1.7" {...FILL_PROPS} />
    <circle cx="12" cy="12" r="1.7" {...FILL_PROPS} />
    <circle cx="18" cy="12" r="1.7" {...FILL_PROPS} />
  </svg>
);
/** 컨텍스트 압축 — 가운데 선으로 모이는 화살표. */
const GlyphCompact = (
  <svg {...GLYPH_PROPS}>
    <path d="M4.5 12h15" />
    <path d="m9 6.5 3 3 3-3" />
    <path d="m9 17.5 3-3 3 3" />
  </svg>
);
/** 그 밖 — 정보 점(막대 하나로만 보이던 종전 i 를 채운 점 + 기둥으로). */
const GlyphInfo = (
  <svg {...GLYPH_PROPS}>
    <circle cx="12" cy="8" r="1.5" {...FILL_PROPS} />
    <path d="M12 11.5v6" />
  </svg>
);
/** 오류 — 경고 삼각형. */
const GlyphWarn = (
  <svg {...GLYPH_PROPS}>
    <path d="M12 4.5 21 19.5H3Z" />
    <path d="M12 10.5v3" />
    <circle cx="12" cy="16.8" r="1.1" {...FILL_PROPS} />
  </svg>
);
/** 재시도 — 회전 화살표. */
const GlyphRetry = (
  <svg {...GLYPH_PROPS}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4v4h-4" />
  </svg>
);
/** 모델 대체 — 갈라지는 두 갈래(화살촉 둘은 이 크기에서 선과 뭉쳐 갈래만 남겼다). */
const GlyphFallback = (
  <svg {...GLYPH_PROPS}>
    <path d="M4 12h4.5" />
    <path d="M8.5 12 13 7h7" />
    <path d="M8.5 12 13 17h7" />
  </svg>
);
/** 중단 — 정지 사각형(채움). */
const GlyphStop = (
  <svg {...GLYPH_PROPS}>
    <rect x="7" y="7" width="10" height="10" rx="2" {...FILL_PROPS} />
  </svg>
);
/** 권한 — 자물쇠. */
const GlyphLock = (
  <svg {...GLYPH_PROPS}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </svg>
);
/** 요약 — 문서 줄(세 줄은 이 크기에서 서로 붙어 두 줄로). */
const GlyphSummary = (
  <svg {...GLYPH_PROPS}>
    <path d="M6 4h12v16H6z" />
    <path d="M9.5 9.5h5M9.5 14h3.5" />
  </svg>
);
/** 백그라운드 작업 — 겹친 판(마름모 둘은 층 간격이 1px 도 안 돼 겹친 사각형으로). */
const GlyphLayers = (
  <svg {...GLYPH_PROPS}>
    <rect x="4" y="8" width="12" height="12" rx="2" />
    <path d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2" />
  </svg>
);
/** 명령 목록 — 터미널 꺾쇠. */
const GlyphCommand = (
  <svg {...GLYPH_PROPS}>
    <path d="m6 7.5 4.5 4.5L6 16.5" />
    <path d="M12.5 16.5H18" />
  </svg>
);
/** 기억 — 책갈피. */
const GlyphMemory = (
  <svg {...GLYPH_PROPS}>
    <path d="M7 4h10v16l-5-3.8L7 20V4Z" />
  </svg>
);
/** 훅 — 이어진 고리. */
const GlyphHook = (
  <svg {...GLYPH_PROPS}>
    <path d="M9.5 12h5" />
    <path d="M9 8.5H8a3.5 3.5 0 0 0 0 7h1" />
    <path d="M15 8.5h1a3.5 3.5 0 0 1 0 7h-1" />
  </svg>
);

/**
 * 색 한 벌 — 계열마다 테두리/아이콘 색과 라벨 색을 함께 정한다.
 * 테두리 알파는 40% 면 1px 선이 배경에 묻혀 원이 안 보였다(아이콘이 허공에 뜬 것처럼 보이던 이유) — 60% 로 올렸다.
 */
const TONE = {
  start: { mark: 'border-sky-500/60 text-sky-300', label: 'text-sky-200/80' },
  done: { mark: 'border-emerald-500/60 text-emerald-300', label: 'text-emerald-200/80' },
  notify: { mark: 'border-amber-500/60 text-amber-300', label: 'text-amber-200/80' },
  update: { mark: 'border-indigo-500/60 text-indigo-300', label: 'text-indigo-200/80' },
  think: { mark: 'border-violet-500/50 text-violet-300', label: 'text-violet-200/70' },
  compact: { mark: 'border-fuchsia-500/60 text-fuchsia-300', label: 'text-fuchsia-200/80' },
  alert: { mark: 'border-rose-500/60 text-rose-300', label: 'text-rose-200/80' },
  memory: { mark: 'border-teal-500/60 text-teal-300', label: 'text-teal-200/80' },
  quiet: { mark: 'border-gray-600 text-gray-400', label: 'text-gray-500' },
} as const;

/**
 * 이름을 아는 subtype — 색은 뜻이 있는 것에만 주고, 원문 밀도에서 가장 많이 뜨는
 * 진행·상태·목록 변경류는 무채색(`quiet`)으로 물러난다(수백 줄이 색으로 번쩍이면 그게 잡음이다).
 *
 * 실측 근거: 이 프로젝트 `sub-streams` 328파일 164,214줄 집계에서 실제로 등장한 것은
 * `thinking_tokens`(68,059) · `status`(6,479) · `task_progress`(2,282) · `task_started`(1,328) ·
 * `task_notification`(1,327) · `task_updated`(122) · `notification`(74) ·
 * `background_tasks_changed`(39) · `commands_changed`(38) · `api_retry`(11) ·
 * `model_refusal_fallback`(5) · `compact_boundary`(1) 12종이다. 나머지는 CLI 바이너리에만 있는
 * 이름이라 **패턴 규칙**(PATTERN_RULES)이 받는다 — 하나하나 번역 키를 파 두면 영영 안 뜰 줄에
 * 12 로케일이 묶인다.
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
  api_retry: { family: 'retry', glyph: GlyphRetry, ...TONE.notify, labelKey: 'ide.systemNode.apiRetry' },
  api_error: { family: 'alert', glyph: GlyphWarn, ...TONE.alert, labelKey: 'ide.systemNode.apiError' },
  model_refusal_fallback: { family: 'fallback', glyph: GlyphFallback, ...TONE.alert, labelKey: 'ide.systemNode.modelFallback' },
  model_fallback: { family: 'fallback', glyph: GlyphFallback, ...TONE.alert, labelKey: 'ide.systemNode.modelFallback' },
  interrupt: { family: 'stop', glyph: GlyphStop, ...TONE.alert, labelKey: 'ide.systemNode.interrupt' },
  permission_denied: { family: 'permission', glyph: GlyphLock, ...TONE.notify, labelKey: 'ide.systemNode.permissionDenied' },
};

/**
 * 이름을 모르는 subtype 도 **뜻이 비슷하면 같은 모양**으로 떨어진다 — CLI 바이너리에는 100여 개의
 * subtype 문자열이 있고 판올림마다 늘어나므로, 하나씩 등록하는 대신 어미·머리로 계열을 잡는다.
 * 라벨은 번역하지 않고 원문을 다듬어 쓴다(`worker_shutting_down` → `Worker Shutting Down`) —
 * 그래야 새 이름이 와도 무엇인지 글자로는 알 수 있다. 순서가 곧 우선순위다.
 */
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

/**
 * subtype → 표현 한 벌. 이름표(STYLES) → 계열 패턴(PATTERN_RULES) → 기본(정보 점) 순으로 내려간다.
 * 순수 함수라 단위 테스트로 확인한다(systemNodeStyle.test.ts).
 */
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

/**
 * §5.5 #17-13 ⑤-3 — **끝난 방식**의 표현. 시작·끝이 한 줄로 접히면 그 줄은 더 이상 "시작"이 아니라
 * 결과라서, 시작 글리프(재생·sky) 대신 이 표를 쓴다.
 */
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
 * 레일(세로 라인) + 글리프 + 라벨 한 줄. 연속 노드는 세로 라인이 맞닿아 레일처럼 이어진다.
 * 글리프 원은 불투명 배경이라 레일 선이 아이콘을 관통하지 않는다.
 *
 * 원은 20px — 14px 글리프가 18px 원(테두리 안쪽 16px)에 들어가면 여백이 1px 뿐이라 답답했다.
 * 줄의 min-height 는 22px 그대로라 세로 밀도는 변하지 않는다(원이 그 안에 들어간다).
 *
 * §5.5 #17-13 ⑤-3 — 작업 칩은 `task` payload 를 받아 **뜻이 있는 한 줄**이 된다: 라벨 자리에는
 * `작업 시작` 이라는 뜻 없는 낱말 대신 **작업 이름**(`description`)이 서고, 오른쪽에 결과·소요 시간이
 * 붙는다. payload 가 없는 옛 칩은 종전과 완전히 같은 모양이다.
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
    <div className="group/sysnode relative flex min-h-[22px] items-stretch pl-3">
      <span className="relative flex w-6 flex-shrink-0 items-center justify-center">
        <span
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gray-700/45"
          aria-hidden="true"
        />
        <span
          className={`relative z-10 flex h-5 w-5 items-center justify-center rounded-full border bg-gray-950 ${style.mark}`}
        >
          {style.glyph}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 py-0.5 pl-2">
        <span className={`truncate text-[11px] font-medium leading-none ${style.label}`}>{label}</span>
        {meta && (
          <span className="flex-shrink-0 whitespace-nowrap text-[10px] leading-none text-gray-500">{meta}</span>
        )}
      </span>
    </div>
  );
}
