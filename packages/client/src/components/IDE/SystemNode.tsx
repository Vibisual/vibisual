/**
 * SystemNode — SDK system 메시지 subtype(task_started 등)을 "뜻이 보이는 한 줄"로 표현한다.
 * subtype 마다 전용 글리프 + 색 + 번역 라벨을 붙인다.
 *
 * 서버(parseStreamLine)가 `[subtype]` 형태로 보내는 system 이벤트를 날 텍스트 대신 노드로 렌더한다.
 * 권한 승인 결정 같은 임의 본문(emitSystemMessage)이나 짝 없는 tool_result(`[ToolName] ...`)는
 * `[word]` 단독 패턴에 매칭되지 않으므로 parseSystemSubtype 가 null 을 반환해 호출부가 텍스트로 폴백한다.
 *
 * §5.5 #17-13 ⑤-1 (v4.99) — 이 칩은 밀도 `원문` 에서만 보인다(간결/표준은 표시 단계에서 제거).
 *   그래서 "다 보여 달라"는 밀도의 뜻에 맞춰 라벨을 **항상 펼쳐** 둔다.
 *
 * §5.5 #17-13 ⑤-6 — **표현을 다시 지었다.** 종전 모양(컬러 테두리 원 + 컬러 라벨 + 24 그리드를
 *   꽉 채운 글리프)이 화면에서 무너지던 자리는 셋이다.
 *   ① **컬러 테두리 원**이 줄마다 "스티커"로 붙어, 열두 줄이 열두 색으로 번쩍였다.
 *   ② **획끼리 붙었다** — 이웃한 두 획의 중심 간격이 획 굵기보다 좁으면 그 사이 빈 곳이 0 이 되어
 *      한 덩어리로 뭉갠다(예: 압축 글리프는 가운데 가로선과 화살촉 꼭짓점의 간격이 2.5 그리드 =
 *      1.46px 인데 획도 1.46px 이라 `✳` 얼룩이 됐다). **크기가 아니라 간격이 원인이다.**
 *   ③ **라벨까지 물들여** 글자가 형광색이 됐다.
 *   그래서 지금은 **원·레일을 걷고 글리프만 두고**(잉크 범위 제약이 풀려 형태를 크게 그릴 수 있다),
 *   **색은 글리프 하나에만** 남기고(라벨은 무채색, 경고 계열만 옅게 물든다), 글리프는 **이웃한 두 획의
 *   중심 간격 ≥ 4 그리드**(15px 렌더에서 2.5px, 획 1.375px 보다 넓다)를 지켜 다시 그렸다.
 *   이 크기에서 윤곽선으로 형태가 안 읽히는 것(삼각형·사각형·연필·자물쇠 몸통·책갈피)은 **채운다.**
 *
 * ⚠ **글리프를 고칠 때의 규칙** — `GLYPH_SIZE_PX`(15) 와 `strokeWidth`(2.2) 는 한 쌍이다.
 *   화면 획 굵기 = `strokeWidth × (GLYPH_SIZE_PX / 24)`. 크기를 바꾸면 굵기도 같이 손보고,
 *   **새 글리프는 이웃한 두 획을 4 그리드 이상 떼어 놓아야 한다** — 안 그러면 ②가 그대로 재발한다.
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
  /** 왼쪽 글리프(24 viewBox stroke path). */
  glyph: React.JSX.Element;
  /** 글리프 색 — 이 줄에서 **색이 붙는 유일한 자리**다(⑤-6). */
  mark: string;
  /** 라벨 색 — 무채색이 기본이고, 사용자가 멈춰 서야 하는 경고 계열만 옅게 물든다. */
  label: string;
  /** 번역 키(`ide.systemNode.*`). 없으면 subtype 를 사람이 읽게 다듬어 쓴다. */
  labelKey: string;
}

/**
 * 모든 글리프가 쓰는 한 벌 — 크기·굵기를 여기 한 곳에서 정한다.
 *
 * 화면 획 굵기 = `strokeWidth × (GLYPH_SIZE_PX / 24)` = 2.2 × 15/24 ≈ **1.375px**.
 * 이 값이 "이웃한 두 획을 얼마나 떼어 놓아야 하는가"의 기준이다 — 4 그리드(= 2.5px)면 사이에
 * 1.1px 의 빈 곳이 남아 두 획이 따로 읽힌다.
 */
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

/**
 * 색 한 벌 — 계열마다 **글리프 색**과 라벨 색을 함께 정한다.
 *
 * §5.5 #17-13 ⑤-6 — 색이 붙는 자리는 **글리프 하나**다. 종전엔 테두리 원·글리프·라벨 셋이 다 물들어
 * 한 줄이 통째로 형광색이 됐고, 열두 줄이 열두 색이면 그건 정보가 아니라 잡음이다. 라벨은 무채색 두 단
 * (기본 / 물러난 것)으로 고정하고, **사용자가 멈춰 서야 하는 경고 계열만** 옅게 물든다.
 *
 * 잉크는 `-300/75` 로 통일한다 — 어두운 배경과 섞이며 채도가 내려가 "네온"이 되지 않으면서도
 * 라벨(gray-300)보다 눈에 먼저 든다.
 */
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
 * 이름을 아는 subtype — 색은 뜻이 있는 것에만 주고, 원문 밀도에서 가장 많이 뜨는
 * 진행·상태·목록 변경류는 무채색(`quiet`)으로 물러난다.
 *
 * 실측 근거: 이 프로젝트 `sub-streams` 집계에서 **`system` 이벤트로 실제로 도착한** subtype 은
 * `task_started`(3,296) · `task_notification`(3,291) · `task_updated`(482) · `compact_boundary`(78) ·
 * `command_received`(32) · `permission_denied`(30) · `api_retry`(21) · `code_change_published`(7)
 * 8종이다(`thinking_tokens`·`status`·`task_progress`·`*_changed` 는 그 뒤 숨김으로 내려갔다).
 * 그중 `command_received`·`code_change_published` 둘이 이름표 밖이라 한국어 화면에 `Command Received`
 * 같은 **영어 원문**이 그대로 떴다 — ⑤-6 에서 이름표로 올렸다. 나머지 미지의 이름은 **패턴 규칙**
 * (PATTERN_RULES)이 받는다 — 하나하나 번역 키를 파 두면 영영 안 뜰 줄에 12 로케일이 묶인다.
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
 * 글리프 + 라벨 한 줄.
 *
 * §5.5 #17-13 ⑤-6 — **테두리 원과 세로 레일을 걷었다.** 원은 색 테두리 탓에 줄마다 스티커가 붙은 꼴이
 * 됐고, 안쪽 지름 18px 이 글리프의 잉크 범위를 묶어 형태를 뭉개는 원인이기도 했다. 레일은 그 원이
 * 22px 줄을 거의 다 먹어 **행 사이 2px 조각으로만 남아** 이어진 선이 아니라 점선으로 보였다 —
 * 은유만 있고 화면에는 없던 것이다. 지금은 24px 자리에 글리프만 가운데 세운다.
 * 줄 높이(22px)·왼쪽 여백은 그대로라 목록의 세로 리듬은 바뀌지 않는다.
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
  // ⑤-6 — `group/sysnode`(옛 hover 라벨의 손잡이)·`relative`(레일의 기준)는 둘 다 그 대상이 사라져 걷었다.
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
