import type {
  AgentQuestions, AgentReport, AgentReview, AskUserQuestionRequest,
  ChatAction, ChatCard, ChatVerbosity, PermissionRequest, SessionGoal, SubAgentStreamEvent,
} from '@vibisual/shared';
import { fmt } from './strings';
import type { ChatStrings } from './strings';

// §4 메신저 원격제어 브리지 — 카드 만들기 + 전송량 정책 (판올림 번호 발급 대기)
//
// **여기가 폰으로 나가는 것을 좁히는 유일한 지점이다.** 드라이버는 `ChatCard` 만 받고, 카드는
// 이 파일에서만 만들어진다. 정책을 두 곳에서 판정하지 않으므로 "카드만 보낸다"가 새는 구멍이
// 생기지 않는다 — 나중에 카드 종류를 더해도 `passesVerbosity` 한 곳만 보면 된다.
// (채널 on/off 까지 합친 최종 판정은 `policy.ts` 의 `canSend` 다.)
//
// 왜 좁히나: 메신저는 **제3자 서버를 우리 코드·경로가 통과하는** 경로다. 기본값에서 스트림
// 원문·파일 diff·bash 출력은 나가지 않고, 필요하면 사용자가 `/log` 로 그때만 가져간다.
//
// 문구는 **인자로 받는다**(`ChatStrings`). 모달만 12개 로케일이고 카드가 한국어면 그 사용자에게는
// 기능 전체가 읽을 수 없는 것이 되기 때문 — 언어를 고르는 것은 상위(`index.ts`)의 일이다.

/** 한 줄이 이보다 길면 자른다(카드는 훑어보는 것이지 읽는 것이 아니다). */
const LINE_MAX = 300;
/** 목록이 이보다 길면 뒤를 접는다. */
const LIST_MAX = 8;

/** 여러 줄을 한 줄로 접고 길이를 자른다. */
export function clip(text: string, max = LINE_MAX): string {
  const flat = text.replace(/\s*\n+\s*/g, ' ').trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1) + '…';
}

/** 목록을 상한까지만 담고, 남은 개수를 한 줄로 알린다. */
export function clipList(items: readonly string[], prefix: string, max = LIST_MAX): string[] {
  const out: string[] = [];
  for (const item of items.slice(0, max)) out.push(`${prefix} ${clip(item)}`);
  if (items.length > max) out.push(`${prefix} … +${items.length - max}`);
  return out;
}

/**
 * 이 카드가 지금 **전송량 정책**에서 나갈 수 있는가.
 * `cards`(기본)에서는 스트림 원문(`stream`)만 막힌다 — 나머지는 이미 사람이 읽으라고 만든 요약이다.
 * `/log` 로 사용자가 명시 요청해 만든 카드는 `text` 로 오므로 이 문에 걸리지 않는다(의도된 통로).
 *
 * **채널 on/off 는 여기서 보지 않는다** — 그건 `policy.canSend` 가 이 판정을 감싸서 함께 본다.
 */
export function passesVerbosity(kind: ChatCard['kind'], verbosity: ChatVerbosity): boolean {
  if (kind === 'stream') return verbosity === 'full';
  return true;
}

/** 권한 승인 — 이 브리지의 존재 이유. 60초 안에 사람이 답할 수 있게 버튼을 단다. */
export function permissionCard(req: PermissionRequest, actions: ChatAction[], s: ChatStrings): ChatCard {
  const lines: string[] = [fmt(s.permTool, { tool: req.toolName })];
  const summary = summarizeToolInput(req.toolName, req.toolInput);
  if (summary) lines.push(summary);
  if (req.risk && req.risk.length > 0) lines.push(fmt(s.permRisk, { risks: req.risk.join(', ') }));
  const left = Math.max(0, Math.round((req.expiresAt - Date.now()) / 1000));
  lines.push(fmt(s.permAutoIn, { seconds: left }));
  return {
    kind: 'permission',
    title: s.titlePermission,
    lines,
    actions,
    ...(req.agentLabel ? { agentLabel: req.agentLabel } : {}),
  };
}

/** 도구 입력에서 사람이 알아볼 한 줄만 뽑는다(전문을 보내지 않는다 — 그게 곧 전송량 정책이다). */
export function summarizeToolInput(toolName: string, input: Record<string, unknown>): string | null {
  const pick = (key: string): string | null => {
    const v = input[key];
    return typeof v === 'string' && v.trim() ? clip(v, 200) : null;
  };
  if (toolName === 'Bash') {
    const cmd = pick('command');
    return cmd ? `$ ${cmd}` : null;
  }
  const path = pick('file_path') ?? pick('path') ?? pick('notebook_path');
  if (path) return path;
  const url = pick('url');
  if (url) return url;
  const query = pick('query') ?? pick('pattern') ?? pick('prompt');
  return query;
}

/** AskUserQuestion — 모델이 던진 선택지. 첫 질문만 버튼으로 띄운다(카드는 한 번에 하나). */
export function askQuestionCard(req: AskUserQuestionRequest, actions: ChatAction[], s: ChatStrings): ChatCard {
  const first = req.items[0];
  const lines: string[] = [];
  if (first) {
    if (first.header) lines.push(first.header);
    lines.push(clip(first.question));
  }
  if (req.items.length > 1) lines.push(fmt(s.askFirstOf, { count: req.items.length }));
  return {
    kind: 'question',
    title: s.titleQuestion,
    lines,
    actions,
    ...(req.agentLabel ? { agentLabel: req.agentLabel } : {}),
  };
}

/** 작업 신고 — 사용자가 직접 해야 할 일이 핵심이라 그것을 먼저 놓는다. */
export function reportCard(report: AgentReport, s: ChatStrings, agentLabel?: string): ChatCard {
  const lines: string[] = [];
  if (report.note) lines.push(clip(report.note));
  if (report.userActions.length > 0) {
    lines.push(s.reportUserActions);
    lines.push(...clipList(report.userActions, '•'));
  }
  if (report.did.length > 0) {
    lines.push(s.reportDid);
    lines.push(...clipList(report.did, '·'));
  }
  if (report.nextSteps && report.nextSteps.length > 0) {
    lines.push(s.reportNext);
    lines.push(...clipList(report.nextSteps, '·', 4));
  }
  return { kind: 'report', title: s.titleReport, lines, ...(agentLabel ? { agentLabel } : {}) };
}

/** 질문 카드 — 제안 프롬프트는 그대로 답장하면 명령이 되므로 함께 싣는다. */
export function questionsCard(questions: AgentQuestions, s: ChatStrings, agentLabel?: string): ChatCard {
  const lines: string[] = [];
  if (questions.note) lines.push(clip(questions.note));
  for (const item of questions.items.slice(0, 3)) {
    lines.push(item.header ? `${item.header} — ${clip(item.question)}` : clip(item.question));
    lines.push(...clipList(item.prompts, '↩', 3));
  }
  if (questions.items.length > 3) lines.push(`… +${questions.items.length - 3}`);
  return { kind: 'question', title: s.titleQuestion, lines, ...(agentLabel ? { agentLabel } : {}) };
}

/** 검수 요청 — 무엇을 고쳤고 무엇을 확인하면 되는지. */
export function reviewCard(review: AgentReview, s: ChatStrings, agentLabel?: string): ChatCard {
  const lines: string[] = [];
  if (review.instruction) lines.push(fmt(s.reviewInstruction, { text: clip(review.instruction) }));
  if (review.changes.length > 0) {
    lines.push(s.reviewChanges);
    lines.push(...clipList(review.changes, '·'));
  }
  if (review.checkpoints.length > 0) {
    lines.push(s.reviewCheckpoints);
    lines.push(...clipList(review.checkpoints, '☐'));
  }
  return { kind: 'review', title: s.titleReview, lines, ...(agentLabel ? { agentLabel } : {}) };
}

/**
 * 세션 목표 한 장 — **지문이 바뀔 때만** 나간다(`policy.goalSignature`).
 *
 * 목표는 별도 WS 종류가 아니라 `GraphSnapshot.sessionGoals` 에 실려 온다. 그래서 스냅샷마다
 * 보내면 진행률이 곧 스팸이 되고, 아예 안 보내면 밖에 있는 사람은 `/status` 를 계속 쳐야 한다.
 * 사람이 알아차릴 변화가 있을 때 한 장 — 그 사이가 이 카드의 자리다.
 */
export function goalCard(goal: SessionGoal, s: ChatStrings, agentLabel?: string): ChatCard {
  const steps = goal.steps ?? [];
  const done = steps.filter((st) => st.status === 'done').length;
  const lines: string[] = [clip(goal.text)];
  lines.push(steps.length > 0
    ? fmt(s.goalSteps, { done, total: steps.length, percent: goal.percent })
    : fmt(s.goalPercent, { percent: goal.percent }));
  const running = steps.find((st) => st.status === 'in_progress');
  if (running) lines.push(`▸ ${clip(running.text, 160)}`);
  if (goal.note) lines.push(clip(goal.note, 160));
  return { kind: 'goal', title: s.titleGoal, lines, ...(agentLabel ? { agentLabel } : {}) };
}

/**
 * 스트림 한 줄 — `full` 에서만 나간다. 도구 결과 원문은 여기서도 싣지 않고 이름만 남긴다
 * (`full` 은 "말과 사고를 따라 읽겠다"는 뜻이지 "출력 전문을 받겠다"는 뜻이 아니다).
 */
export function streamCard(event: SubAgentStreamEvent, s: ChatStrings, agentLabel?: string): ChatCard | null {
  if (event.eventType === 'text' || event.eventType === 'thinking') {
    const body = clip(event.content, 600);
    if (!body) return null;
    return {
      kind: 'stream',
      title: event.eventType === 'thinking' ? s.titleStreamThinking : s.titleStreamText,
      lines: [body],
      ...(agentLabel ? { agentLabel } : {}),
    };
  }
  if (event.eventType === 'tool_use') {
    return {
      kind: 'stream',
      title: s.titleStreamTool,
      lines: [event.toolName ?? s.streamUnnamedTool],
      ...(agentLabel ? { agentLabel } : {}),
    };
  }
  return null;
}

/** 사용자가 부른 명령의 답(`/status`·`/log` 등) — 전송량 정책 문을 지나지 않는 의도된 통로. */
export function textCard(title: string, lines: string[], agentLabel?: string): ChatCard {
  return { kind: 'text', title, lines, ...(agentLabel ? { agentLabel } : {}) };
}

/** 카드 종류별 머리 글리프. 이모지 대신 얇은 기호만 쓴다(메신저에는 SVG 를 실을 수 없다). */
const TITLE_MARK: Record<ChatCard['kind'], string> = {
  permission: '[!]',
  question: '[?]',
  report: '[>]',
  review: '[v]',
  goal: '[=]',
  stream: '[·]',
  text: '[-]',
};

/**
 * 카드를 그 메신저에 실을 평문으로 바꾼다. 마크다운을 쓰지 않는 이유는 파일 경로·코드가
 * 그대로 섞여 들어와 서식이 깨지기 때문이다(`*`·`_` 가 든 경로가 흔하다).
 */
export function renderCard(card: ChatCard, maxChars: number): string {
  const head = card.agentLabel
    ? `${TITLE_MARK[card.kind]} ${card.title} — ${card.agentLabel}`
    : `${TITLE_MARK[card.kind]} ${card.title}`;
  const body = [head, ...card.lines].join('\n');
  return body.length <= maxChars ? body : body.slice(0, maxChars - 1) + '…';
}

/**
 * 버튼을 줄 단위로 나눈다. 두 메신저 모두 "한 줄에 몇 개" 를 스스로 정하지 않으므로
 * 우리가 나눠 줘야 `/agents` 처럼 버튼이 많은 카드가 옆으로 뭉개지지 않는다.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}
