/**
 * §5.10 Project Brain — 세션 리플렉션(자동 기억 수집).
 *
 * 세션 종료(Stop)/idle 전환·에이전트 dismiss 시점에 그 세션 기록을 one-shot claude CLI(haiku)로
 * 훑어 **추출 트리거 4조건**(같은 실수 반복 / 시도했다 되돌림 / 같은 교정 재입력 / 다음 세션에도
 * 필요한 결정)에 걸리는 후보만 뽑아 brainService.saveCard 로 저장(중복 검사 창구 경유). 저장 위치는
 * 커스텀 에이전트 세션이면 개별(agent), 아니면 프로젝트. **호출 경로로 예외를 던지지 않는다** —
 * 실패는 로그만. feedbackDistillService 의 one-shot 스폰 선례(shell:false, 트리 kill)를 클론.
 *
 * ## v3.54 폭주 차단 — 전수 조사 결과 반영
 *
 * 실측(3일치 `~/.claude/projects` 전수 집계)에서 이 서비스 단독이 Vibisual 전체 토큰의 **76.9%** 를
 * 먹고 있었다(24h 7,254 스폰·피크 1,858회/시, 표본 수확률 0%). 원인이 넷이라 넷 다 막는다.
 *
 *   ① **트리거가 매 턴**  — Stop 은 세션 종료가 아니라 턴 종료마다 온다. 디바운스를 idle 판정 창
 *      (`BRAIN_REFLECTION_DEBOUNCE_MS`)으로 키워 SSOT 원문("세션 종료/idle 전환 시")을 회복.
 *   ② **세션당 디바운스라 무력** — 짧은 세션이 계속 새로 생기면 세션당 창은 제약이 못 된다.
 *      세션 수와 무관한 **전역 시간당 상한 + 동시 실행 상한**을 세션 창 위에 얹는다.
 *   ③ **입력이 원시 JSONL** — thinking signature 같은 base64 덩어리와 도구 페이로드가 예산의
 *      대부분을 먹었다. `buildDigest` 로 실제 대화만 남긴다(토큰↓ 품질↑ 동시 달성).
 *   ④ **수확 0인데 계속 발화** — 프로젝트 루트별 빈 결과 연속 횟수에 지수 백오프.
 *
 * 여기에 스폰 자체도 경량화한다 — 기본 시스템 프롬프트 + 도구 정의가 스폰당 약 25.7k 토큰이었는데
 * 이 작업은 텍스트를 읽고 JSON 을 뱉을 뿐이라 전부 낭비다. `--system-prompt` 로 갈아끼우고
 * `--disallowed-tools`(이름 명시 목록 — 글로브 `'*'` 는 실측상 도구를 못 걷어냈다)로 도구 정의를
 * 없애며, cwd 를 빈 전용 디렉터리로 고정해 프로젝트 CLAUDE.md·git status 가 프리픽스에 섞이지
 * 않게 한다(모든 리플렉션이 같은 프리픽스 → 캐시 재사용). 실측 스폰당 총 입력 29,013 → 8,209 토큰.
 */
import { spawn } from 'child_process';
import {
  BRAIN_REFLECTION_DEBOUNCE_MS,
  BRAIN_REFLECTION_MIN_EVENTS,
  BRAIN_REFLECTION_INPUT_MAX_CHARS,
  BRAIN_REFLECTION_MAX_PER_HOUR,
  BRAIN_REFLECTION_MAX_CONCURRENT,
  BRAIN_REFLECTION_CWD_DIRNAME,
  BRAIN_REFLECTION_MIN_NEW_LINES,
  BRAIN_REFLECTION_EMPTY_STREAK_THRESHOLD,
  BRAIN_REFLECTION_BACKOFF_MAX_MS,
  BRAIN_REFLECTION_TEXT_MAX_CHARS,
  BRAIN_REFLECTION_TOOL_RESULT_MAX_CHARS,
  BRAIN_REFLECTION_SYSTEM_PROMPT,
  BRAIN_REFLECTION_DISALLOWED_TOOLS,
  BRAIN_SESSION_CANDIDATE_MAX,
  BRAIN_REFLECTION_KNOWN_TITLE_MAX,
  BRAIN_TOPICS,
  BRAIN_TOPIC_MISC,
  BRAIN_CANONICAL_AREAS,
  BRAIN_CANONICAL_TYPES,
  buildBrainReflectionPrompt,
  BRAIN_SKILL_DRAFT_MIN_TOOL_CALLS,
  type BrainCardScope,
  type BrainCardType,
} from '@vibisual/shared';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getClaudeBin, noteClaudeSpawnFailure } from './claudeBin.js';
// 경로 대소문자 정책 SSOT — win32/darwin 만 접고 linux 는 접지 않는다.
import { pathKey } from './pathKey.js';
import { getSessionJsonlPath } from './sessionDiscovery.js';
import { brainAxisEnabledFor } from './brainActivation.js';
import { applyGrounding, applySkillGrounding } from './brainGrounding.js';
import { getBrainSkillService } from './brainSkillService.js';
import { getBrainService } from './brainService.js';
import { logger } from '../logger.js';

const CLAUDE_BIN = (): string => getClaudeBin().binPath;

/** one-shot 리플렉션 상한 — haiku 가 이 시간 안에 못 끝내면 실패 처리(무한 대기 방지). */
const REFLECT_TIMEOUT_MS = 60_000;

const VALID_TYPES: ReadonlySet<string> = new Set(['decision', 'mistake', 'lesson', 'rule', 'fact']);

/**
 * 리플렉션 스폰 전용 작업 디렉터리(빈 폴더). 서버 프로세스 cwd(= 앱 설치 폴더)를 그대로 물려받으면
 * 그 폴더의 파일·git 상태가 프리픽스에 섞인다. 빈 폴더로 고정하면 모든 리플렉션이 같은 프리픽스를
 * 공유해 캐시가 최대로 재사용된다.
 */
const REFLECT_CWD = path.join(os.tmpdir(), BRAIN_REFLECTION_CWD_DIRNAME);

/** 경로 비교용 정규화 — 구분자 통일 + 끝 슬래시 제거 + **대소문자를 실제로 무시하는 FS 에서만** 소문자.
 *  linux 에서 무조건 접으면 사용자 프로젝트가 리플렉션 전용 폴더로 오인될 수 있다. */
function normPath(p: string): string {
  return pathKey(p);
}

const REFLECT_CWD_NORM = normPath(REFLECT_CWD);

/**
 * 이 cwd 가 리플렉션 자식(`claude -p`) 전용 폴더인가 — **자가 증식 차단의 판정 기준**.
 *
 * v3.76. 자식은 전역 `~/.claude/settings.json` 의 Vibisual 훅을 그대로 실행한다(자식 트랜스크립트에
 * `attachment.type=hook_success` 로 `SessionStart:startup`·`Stop` 이 찍히는 것으로 실측 확인). CLI 의
 * `--settings` 는 계층 **병합**이라 그 훅을 지우지 못하므로, "이 폴더에서 온 훅 이벤트는 우리 자신이
 * 낸 것" 이라는 판정을 서버가 직접 쥔다.
 *
 * tmpdir 표기가 8.3 단축 경로·대소문자로 흔들릴 수 있어 전체 경로 일치뿐 아니라 **마지막 구간 일치**도
 * 인정한다(사용자 프로젝트 폴더명이 하필 `vibisual-reflect` 인 경우까지 리플렉션을 건너뛰지만, 그건
 * 기억 카드가 한 프로젝트에서 안 쌓이는 정도의 손해라 무한 스폰 재발 위험보다 가볍다).
 */
export function isBrainReflectionCwd(cwd: string | null | undefined): boolean {
  if (!cwd) return false;
  const norm = normPath(cwd);
  return norm === REFLECT_CWD_NORM || norm.endsWith(`/${BRAIN_REFLECTION_CWD_DIRNAME}`);
}

/** 세션당 디바운스 타이머(연속 Stop/idle 이 짧게 겹쳐도 1회만). */
const debounceTimers = new Map<string, NodeJS.Timeout>();

/** 세션별 마지막 리플렉션 시점의 JSONL 라인 수 — 새 내용이 충분히 쌓였을 때만 다시 돈다(②③ 중복 차단). */
const lastReflectedLines = new Map<string, number>();

/** 전역 발화 타임스탬프(슬라이딩 1시간 윈도우). 세션 수와 무관하게 총량을 묶는다. */
let recentSpawnsAt: number[] = [];

/** 현재 떠 있는 리플렉션 자식 수. */
let inFlight = 0;

/** 프로젝트 루트별 연속 "카드 0장" 횟수 — 지수 백오프의 입력. */
const emptyStreakByRoot = new Map<string, number>();

/** 프로젝트 루트별 백오프 해제 시각(ms epoch). */
const backoffUntilByRoot = new Map<string, number>();

export interface BrainReflectionInput {
  sessionId: string;
  /** 세션 JSONL 을 찾기 위한 cwd. */
  cwd: string;
  /** 카드 저장 프로젝트 루트. */
  root: string;
  /** 커스텀 에이전트 세션이면 'agent' + agentId, 아니면 'project'. */
  scope: BrainCardScope;
  agentId?: string;
}

/** 리플렉션이 실제로 돌지 못한 사유 — 로그·테스트용. */
export type ReflectionSkipReason =
  | 'no-jsonl'
  | 'too-few-events'
  | 'no-new-content'
  | 'rate-limited'
  | 'busy'
  | 'backoff'
  | 'empty-digest';

// ─── 입력 정제(③) ────────────────────────────────────────────────────────────

/** 80자 이상 이어지는 base64 스러운 덩어리 — thinking signature·이미지·해시. 의미 0, 토큰만 먹는다. */
const BASE64_RUN = /[A-Za-z0-9+/]{80,}={0,2}/g;

/** 훅이 붙이는 `<system-reminder>` 블록 — 매 턴 반복되는 상용구라 리플렉션에 무가치. */
const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

/**
 * Vibisual 이 스폰 프롬프트에 넣는 자기 안내문 머리말 — 세션 내용이 아니라 우리 상용구다.
 * 뒤에 `\b` 를 붙이지 않는다 — JS 의 `\b` 는 ASCII `\w` 기준이라 한글 뒤 공백에서는 경계가 안 잡힌다.
 */
const VIBISUAL_PREAMBLE_HEADING =
  /^#{1,3}\s*(작업 신고|사용자 질문|검수 요청|번호 목록 카드|서버 iframe 신고|Project Brain)/;

/** 머리말 블록의 끝 — 다음 최상위 제목이나 실제 지시 시작. */
const PREAMBLE_TERMINATOR = /^(Task:|---\s*$|#{1,3}\s*(Environment|Harness|Memory|Tech Stack|Commands)\b)/;

function stripNoise(text: string): string {
  return text
    .replace(SYSTEM_REMINDER, '')
    .replace(BASE64_RUN, '…')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Vibisual 자기 안내문 블록을 걷어낸다(줄 스캔 — 정규식 한 방보다 경계가 분명하다). */
function stripVibisualPreamble(text: string): string {
  if (!VIBISUAL_PREAMBLE_HEADING.test(text) && !text.includes('Vibisual IDE')) return text;
  const out: string[] = [];
  let skipping = false;
  for (const line of text.split('\n')) {
    if (VIBISUAL_PREAMBLE_HEADING.test(line)) { skipping = true; continue; }
    if (skipping) {
      if (PREAMBLE_TERMINATOR.test(line)) skipping = false;
      else continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 도구 호출을 한 줄 요약으로. 페이로드 전량은 넣지 않는다(diff·파일 본문이 예산을 다 먹었다). */
function summarizeToolUse(name: string, input: unknown): string {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const pick = (k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null);
  const detail = pick('file_path') ?? pick('path') ?? pick('command') ?? pick('pattern') ?? pick('url') ?? '';
  return detail ? `[도구] ${name}: ${clip(detail, 160)}` : `[도구] ${name}`;
}

interface DigestPart { text: string }

function partsFromContent(content: unknown, role: string): DigestPart[] {
  if (typeof content === 'string') {
    const t = stripNoise(stripVibisualPreamble(content));
    return t ? [{ text: `[${role}] ${clip(t, BRAIN_REFLECTION_TEXT_MAX_CHARS)}` }] : [];
  }
  if (!Array.isArray(content)) return [];
  const parts: DigestPart[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as Record<string, unknown>;
    switch (b.type) {
      // thinking 은 통째로 버린다 — signature 가 base64 덩어리고 결론은 text 블록에 다시 나온다.
      case 'thinking':
      case 'redacted_thinking':
        break;
      case 'text': {
        const t = stripNoise(stripVibisualPreamble(String(b.text ?? '')));
        if (t) parts.push({ text: `[${role}] ${clip(t, BRAIN_REFLECTION_TEXT_MAX_CHARS)}` });
        break;
      }
      case 'tool_use':
        parts.push({ text: summarizeToolUse(String(b.name ?? '?'), b.input) });
        break;
      case 'tool_result': {
        const isErr = b.is_error === true;
        let body = b.content;
        if (Array.isArray(body)) {
          body = body.map((x) => (x && typeof x === 'object' ? String((x as Record<string, unknown>).text ?? '') : '')).join(' ');
        }
        const t = stripNoise(String(body ?? ''));
        if (!t) break;
        // 실패한 도구 결과가 "같은 실수 반복" 판정의 핵심 신호라 정상 결과보다 길게 남긴다.
        const max = isErr ? BRAIN_REFLECTION_TOOL_RESULT_MAX_CHARS : Math.floor(BRAIN_REFLECTION_TOOL_RESULT_MAX_CHARS / 2);
        parts.push({ text: `[결과${isErr ? ' 실패' : ''}] ${clip(t, max)}` });
        break;
      }
      case 'image':
        parts.push({ text: '[이미지]' });
        break;
      default:
        break;
    }
  }
  return parts;
}

export interface SessionDigest {
  /** 모델에 넣을 다이제스트 본문(tail, 문자 상한 적용 후). */
  text: string;
  /** 원본 JSONL 의 비어있지 않은 라인 수 — min-events·델타 판정용. */
  lineCount: number;
  /** 원본 문자 수(계측용). */
  rawChars: number;
  /**
   * §5.10 v2 (B) — 이 세션의 도구 호출 수.
   * "복잡한 작업이었나"의 판정에 쓴다 — 절차로 굳힐 만한 일이었는지의 대리 지표다.
   */
  toolCalls: number;
}

/**
 * 원시 JSONL 문자열에서 대화 다이제스트를 만든다. 파일 접근이 없는 순수 함수 — 테스트가 직접 부른다.
 * 대화(user/assistant)만 남기고 thinking·base64·system-reminder·도구 페이로드를 걷어낸 뒤 tail 을 자른다.
 */
export function buildDigest(raw: string): SessionDigest {
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const parts: string[] = [];
  let toolCalls = 0;
  for (const line of lines) {
    let j: unknown;
    try { j = JSON.parse(line); } catch { continue; }
    if (!j || typeof j !== 'object') continue;
    const e = j as Record<string, unknown>;
    if (e.type !== 'user' && e.type !== 'assistant') continue;
    const msg = e.message as Record<string, unknown> | undefined;
    if (!msg) continue;
    // §5.10 v2 (B) — 도구 호출만 따로 센다. 다이제스트 본문에서는 도구 페이로드를 걷어내므로
    //   여기서 세지 않으면 "복잡한 작업이었나"를 나중에 알 길이 없다.
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block && typeof block === 'object' && (block as Record<string, unknown>).type === 'tool_use') toolCalls++;
      }
    }
    const role = e.type === 'user' ? '사용자' : 'AI';
    for (const p of partsFromContent(msg.content, role)) parts.push(p.text);
  }
  // tail 우선 — 세션 끝부분이 결론·교정이 모이는 곳이다.
  const kept: string[] = [];
  let used = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part == null) continue;
    const len = part.length + 1;
    if (used + len > BRAIN_REFLECTION_INPUT_MAX_CHARS) break;
    kept.push(part);
    used += len;
  }
  kept.reverse();
  return { text: kept.join('\n'), lineCount: lines.length, rawChars: raw.length, toolCalls };
}

function readDigest(cwd: string, sessionId: string): SessionDigest | null {
  try {
    const fp = getSessionJsonlPath(cwd, sessionId);
    if (!fp || !fs.existsSync(fp)) return null;
    return buildDigest(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

// ─── 발화량 제어(①②④) ──────────────────────────────────────────────────────

function rateLimited(now: number): boolean {
  const cutoff = now - 3_600_000;
  recentSpawnsAt = recentSpawnsAt.filter((t) => t > cutoff);
  return recentSpawnsAt.length >= BRAIN_REFLECTION_MAX_PER_HOUR;
}

/** 수확 0 연속 횟수 → 다음 발화까지의 쿨다운. 문턱 미만이면 0(백오프 없음). */
export function backoffMsForStreak(streak: number): number {
  if (streak < BRAIN_REFLECTION_EMPTY_STREAK_THRESHOLD) return 0;
  const steps = streak - BRAIN_REFLECTION_EMPTY_STREAK_THRESHOLD + 1;
  const ms = BRAIN_REFLECTION_DEBOUNCE_MS * 2 ** steps;
  return Math.min(ms, BRAIN_REFLECTION_BACKOFF_MAX_MS);
}

function noteOutcome(root: string, cardCount: number): void {
  if (cardCount > 0) {
    emptyStreakByRoot.delete(root);
    backoffUntilByRoot.delete(root);
    return;
  }
  const streak = (emptyStreakByRoot.get(root) ?? 0) + 1;
  emptyStreakByRoot.set(root, streak);
  const cool = backoffMsForStreak(streak);
  if (cool > 0) {
    backoffUntilByRoot.set(root, Date.now() + cool);
    logger.info(`[brain-reflect] backoff root=${path.basename(root)} streak=${streak} cooldown=${Math.round(cool / 60000)}min`);
  }
}

/** 발화 전 관문 전부. 통과하면 null, 막히면 사유. */
function gate(input: BrainReflectionInput, digest: SessionDigest): ReflectionSkipReason | null {
  const now = Date.now();
  if (digest.lineCount < BRAIN_REFLECTION_MIN_EVENTS) return 'too-few-events';
  if (!digest.text) return 'empty-digest';

  const last = lastReflectedLines.get(input.sessionId);
  if (last != null && digest.lineCount - last < BRAIN_REFLECTION_MIN_NEW_LINES) return 'no-new-content';

  const until = backoffUntilByRoot.get(input.root);
  if (until != null && now < until) return 'backoff';

  if (inFlight >= BRAIN_REFLECTION_MAX_CONCURRENT) return 'busy';
  if (rateLimited(now)) return 'rate-limited';
  return null;
}

/** §5.10 v3.78 — 리플렉션이 뽑아 낸 카드 후보 1건(모델 출력 스키마). */
export interface ReflectionCandidate {
  type: BrainCardType;
  title: string;
  body: string;
  files: string[];
  /** 모델이 고른 주제 slug(없거나 모르는 값이면 서버가 자동 분류). */
  topic?: string;
  /** 이 지식이 뒤집는 기존 카드 id — saveCard 가 그 카드를 닫는다(유효기간 2축). */
  contradicts?: string;
  /** §5.10 v3.81 — 진실 주소(`<area>.<subject>[.<aspect>]`). 있으면 슬롯 규칙을 탄다. */
  canonicalKey?: string;
  /** §5.10 v3.81 — 정규화된 값(짧은 단어·경로·이름일 때만). */
  value?: string;
}

/** §5.10 v3.81 — `canonicalKey` 형식 검증. area 는 관리 목록 안에 있어야 하고 2~4 마디. */
function validCanonicalKey(raw: string, type: BrainCardType): string | undefined {
  const key = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,3}$/.test(key)) return undefined;
  // 경험 계층에는 주소를 붙이지 않는다(증거는 현재 규칙이 아니다 — §H).
  if (!BRAIN_CANONICAL_TYPES.includes(type)) return undefined;
  const area = key.split('.')[0] ?? '';
  return BRAIN_CANONICAL_AREAS.includes(area) ? key : undefined;
}

/** 알려진 주제 slug 집합 — 모델이 아무 문자열이나 뱉어도 여기 없으면 버린다(자동 분류로 폴백). */
const VALID_TOPICS: ReadonlySet<string> = new Set([...BRAIN_TOPICS.map((t) => t.slug), BRAIN_TOPIC_MISC]);

/** 모델 출력에서 JSON 배열을 방어적으로 파싱. 실패 시 빈 배열. */
/**
 * §5.10 v2 (B) — 리플렉션 출력에서 **절차 초안 한 벌**을 꺼낸다.
 *
 * 카드와 같은 JSON 배열에 `type: "skill"` 로 섞여 온다(별도 호출을 만들지 않으려고 그렇게 뒀다).
 * 이름·설명·본문 셋이 다 있어야 절차다 — 하나라도 비면 버린다(빈 껍데기 스킬이 검색을 오염시킨다).
 */
export function parseSkillDraft(out: string): {
  name: string;
  description: string;
  body: string;
  files: string[];
  topic?: string;
} | null {
  const text = out.trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  let arr: unknown;
  try { arr = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    if (o.type !== 'skill') continue;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const description = typeof o.description === 'string' ? o.description.trim() : '';
    const body = typeof o.body === 'string' ? o.body.trim() : '';
    if (!name || !description || !body) continue;
    const topic = typeof o.topic === 'string' && VALID_TOPICS.has(o.topic.trim()) ? o.topic.trim() : undefined;
    return {
      name,
      description,
      body,
      files: Array.isArray(o.files) ? o.files.filter((f): f is string => typeof f === 'string') : [],
      ...(topic ? { topic } : {}),
    };
  }
  return null;
}

/**
 * §5.10 v2 (G) — 리플렉션 출력에서 **운영자 관찰 한 줄**을 꺼낸다.
 *
 * 카드와 같은 배열에 `type: "operator"` 로 섞여 온다. 제목이 없으면 관찰이 아니다.
 * 이 결과는 `scope: 'user'` 카드로 저장되며 **로컬 파일 밖으로 나가지 않는다.**
 */
export function parseOperatorNote(out: string): { title: string; body: string } | null {
  const text = out.trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  let arr: unknown;
  try { arr = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    if (o.type !== 'operator') continue;
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    if (!title) continue;
    return { title, body: typeof o.body === 'string' ? o.body.trim() : '' };
  }
  return null;
}

export function parseCandidates(out: string): ReflectionCandidate[] {
  const text = out.trim();
  if (!text) return [];
  // 코드펜스/설명이 섞였을 수 있으니 첫 '[' ~ 마지막 ']' 만 시도.
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let arr: unknown;
  try { arr = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out2: ReflectionCandidate[] = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    // §5.10 v2 (B) — 절차 초안은 카드가 아니다. `parseSkillDraft` 가 따로 가져가므로
    //   여기서 걸러 내지 않으면 아래 폴백에 걸려 lesson 카드로 둔갑한다.
    // §5.10 v2 (B)(G) — 절차 초안·운영자 관찰은 카드가 아니다. 각자 전용 파서가 가져가므로
    //   여기서 걸러 내지 않으면 아래 폴백에 걸려 lesson 카드로 둔갑한다.
    if (o.type === 'skill' || o.type === 'operator') continue;
    const type = typeof o.type === 'string' && VALID_TYPES.has(o.type) ? (o.type as BrainCardType) : 'lesson';
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    if (!title) continue;
    const body = typeof o.body === 'string' ? o.body.trim() : '';
    const files = Array.isArray(o.files) ? o.files.filter((f): f is string => typeof f === 'string') : [];
    // v3.78 — 주제/모순 지목. 형식이 어긋나면 조용히 버린다(카드 자체는 살린다).
    const topic = typeof o.topic === 'string' && VALID_TOPICS.has(o.topic.trim()) ? o.topic.trim() : undefined;
    const rawContra = typeof o.contradicts === 'string' ? o.contradicts.trim() : '';
    const contradicts = /^card-[A-Za-z0-9-]+$/.test(rawContra) ? rawContra : undefined;
    // v3.81 — 진실 주소·값. 형식이 어긋나거나 경험 계층이면 조용히 버린다(카드 자체는 살린다).
    const canonicalKey = typeof o.canonicalKey === 'string' ? validCanonicalKey(o.canonicalKey, type) : undefined;
    const value = canonicalKey && typeof o.value === 'string' && o.value.trim().length <= 80
      ? o.value.trim() : undefined;
    out2.push({
      type, title, body, files,
      ...(topic ? { topic } : {}),
      ...(contradicts ? { contradicts } : {}),
      ...(canonicalKey ? { canonicalKey } : {}),
      ...(value ? { value } : {}),
    });
    if (out2.length >= BRAIN_SESSION_CANDIDATE_MAX) break;
  }
  return out2;
}

/**
 * §5.10 v3.78 F — **관문을 추출 시점으로.** 그 층의 기존 카드 제목을 `[id] 제목` 목록으로 만든다.
 *
 * 종전에는 세션 다이제스트만 줘서 모델이 "이건 이미 안다"를 판단할 수단이 아예 없었고, 그래서 중복
 * 방어가 사후 Jaccard 하나에 몰려 있었다. 제목만이라 토큰이 싸고(카드 1장당 ~20토큰), 모델은 이걸
 * 보고 ① 중복이면 안 뽑고 ② 뒤집는 지식이면 `contradicts` 로 대상을 지목한다.
 *
 * 랭킹 상위부터 담는다 — 상한에 걸려 잘리더라도 "자주 쓰이는 기억"이 먼저 보이게.
 */
function knownTitlesFor(root: string, scope: BrainCardScope, agentId?: string): string[] {
  try {
    const svc = getBrainService(root);
    const pool = scope === 'agent' && agentId
      ? svc.listCards({ scope: 'agent', agentId })
      : svc.listCards({ scope: 'project' });
    return svc.rankCards(pool, {})
      .slice(0, BRAIN_REFLECTION_KNOWN_TITLE_MAX)
      .map((r) => `[${r.card.id}] ${r.card.title}`);
  } catch {
    return [];
  }
}

function runReflection(input: BrainReflectionInput): void {
  const { sessionId, cwd, root, scope, agentId } = input;
  const digest = readDigest(cwd, sessionId);
  if (!digest) return;

  const blocked = gate(input, digest);
  if (blocked) {
    logger.info(`[brain-reflect] SKIP session=${sessionId.slice(0, 8)} reason=${blocked}`);
    return;
  }

  lastReflectedLines.set(sessionId, digest.lineCount);
  recentSpawnsAt.push(Date.now());
  inFlight++;

  // v3.78 — 기존 카드 제목 목록을 함께 실어 "이미 아는 것"과 "뒤집는 것"을 모델이 추출 시점에 가른다.
  // §5.10 v2 (B) — 절차 초안은 축이 켜져 있고 **복잡한 작업이었을 때만** 요구한다.
  //   단순 질의응답 세션에까지 절차를 물으면 없는 절차를 지어내게 된다.
  const wantSkill = brainAxisEnabledFor(root, 'skills')
    && digest.toolCalls >= BRAIN_SKILL_DRAFT_MIN_TOOL_CALLS;
  // §5.10 v2 (E) — 근거 검증 축. 스폰 시점에 한 번 읽어 두고 완료 핸들러에서 그대로 쓴다
  //   (자식이 도는 동안 설정이 바뀌어도 한 턴 안에서는 판정이 흔들리지 않게).
  const groundingOn = brainAxisEnabledFor(root, 'grounding');
  const operatorOn = brainAxisEnabledFor(root, 'operator');
  const prompt = buildBrainReflectionPrompt({
    knownTitles: knownTitlesFor(root, scope, agentId),
    topicSlugs: [...BRAIN_TOPICS.map((t) => t.slug), BRAIN_TOPIC_MISC],
    areas: BRAIN_CANONICAL_AREAS,
    ...(wantSkill ? { wantSkill: true } : {}),
    ...(operatorOn ? { wantOperator: true } : {}),
  }) + digest.text;
  const t0 = Date.now();
  const saved = Math.max(0, digest.rawChars - digest.text.length);
  logger.info(
    `[brain-reflect] SPAWN session=${sessionId.slice(0, 8)} scope=${scope} lines=${digest.lineCount}`
    + ` digest=${digest.text.length}c (원본 ${digest.rawChars}c, -${digest.rawChars > 0 ? Math.round((saved / digest.rawChars) * 100) : 0}%)`
    + ` hour=${recentSpawnsAt.length}/${BRAIN_REFLECTION_MAX_PER_HOUR}`,
  );

  try { fs.mkdirSync(REFLECT_CWD, { recursive: true }); } catch { /* 실패해도 spawn 이 상속 cwd 로 진행 */ }

  let settled = false;
  let outBuf = '';
  const child = spawn(
    CLAUDE_BIN(),
    [
      '-p', prompt,
      '--model', 'haiku',
      '--output-format', 'text',
      // 기본 시스템 프롬프트 + 도구 정의(스폰당 ~25.7k 토큰)를 통째로 걷어낸다.
      '--system-prompt', BRAIN_REFLECTION_SYSTEM_PROMPT,
      '--disallowed-tools', BRAIN_REFLECTION_DISALLOWED_TOOLS,
      '--strict-mcp-config',
    ],
    { shell: false, windowsHide: true, cwd: REFLECT_CWD },
  );
  const finish = (reason: string): void => {
    if (settled) return;
    settled = true;
    inFlight = Math.max(0, inFlight - 1);
    clearTimeout(timer);
    if (process.platform === 'win32') {
      if (child.pid != null && child.exitCode === null) {
        try {
          const tk = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
          tk.on('error', () => { /* ignore */ });
        } catch { /* ignore */ }
      }
    } else {
      try { child.kill(); } catch { /* ignore */ }
    }
    logger.info(`[brain-reflect] DONE session=${sessionId.slice(0, 8)} dur=${Date.now() - t0}ms via=${reason}`);
  };
  const timer = setTimeout(() => finish('timeout'), REFLECT_TIMEOUT_MS);
  child.stdout?.on('data', (d: Buffer) => { outBuf += d.toString(); });
  child.on('error', (err) => { logger.warn('[brain-reflect] spawn error', err); noteClaudeSpawnFailure(err); finish('spawn-error'); });
  child.on('close', (code) => {
    try {
      if (code === 0) {
        // §5.10 v2 (B) — 절차 초안이 왔으면 스킬로 굳힌다. 카드보다 먼저 처리해서
        //   카드 저장이 실패해도 절차는 남게 둔다(둘은 서로 독립 자산이다).
        if (wantSkill) {
          const draft = parseSkillDraft(outBuf);
          if (draft) {
            try {
              const s = getBrainSkillService(root).createSkill({
                name: draft.name,
                description: draft.description,
                body: draft.body,
                files: draft.files,
                scope,
                ...(scope === 'agent' && agentId ? { agentId } : {}),
                ...(draft.topic ? { topic: draft.topic } : {}),
                sourceSessionId: sessionId,
              });
              logger.info(`[brain-reflect] 절차 초안 저장 skill=${s.id} v${s.version} session=${sessionId.slice(0, 8)}`);
              // §5.10 v2 (E) — 절차도 같은 문을 지난다. 통과하면 초안에서 실제 절차로 올라간다.
              if (groundingOn) {
                try { applySkillGrounding(root, s.id); } catch { /* 실패해도 초안으로 남는다 */ }
              }
            } catch (e) {
              logger.warn('[brain-reflect] 절차 초안 저장 실패', e as Error);
            }
          }
        }
        // §5.10 v2 (G) — 운영자 관찰. `scope: 'user'` 3층째에 `fact` 로 남는다.
        //   권위는 리플렉션 산출물이므로 `session-summary`(랭크 1) — 자동으로 verified 가 되지 않는다.
        //   사람에 대한 관찰이라 코드 대조로 올릴 수도 없고, 그게 맞다.
        if (operatorOn) {
          const note = parseOperatorNote(outBuf);
          if (note) {
            try {
              getBrainService(root).saveCard({
                type: 'fact',
                scope: 'user',
                title: note.title,
                body: note.body,
                sourceSessionId: sessionId,
                seen: false,
              });
              logger.info(`[brain-reflect] 운영자 관찰 저장 session=${sessionId.slice(0, 8)}`);
            } catch (e) {
              logger.warn('[brain-reflect] 운영자 관찰 저장 실패', e as Error);
            }
          }
        }
        const candidates = parseCandidates(outBuf);
        if (candidates.length > 0) {
          const svc = getBrainService(root);
          // v3.78 — 저장 결과를 집계한다. `same`(이미 아는 것)은 카드가 안 늘어난 것이므로 수확으로
          //   세지 않는다 — 그래야 "중복만 뽑는 세션"에 백오프가 제대로 걸린다.
          let fresh = 0;
          let superseded = 0;
          for (const c of candidates) {
            const r = svc.saveCardDetailed({
              type: c.type,
              scope,
              agentId: scope === 'agent' ? agentId : undefined,
              title: c.title,
              body: c.body,
              files: c.files,
              sourceSessionId: sessionId,
              seen: false,
              ...(c.topic ? { topic: c.topic } : {}),
              ...(c.contradicts ? { contradicts: c.contradicts } : {}),
              // v3.81 — 리플렉션 산출물의 권위는 언제나 `session-summary`(랭크 1)다.
              //   즉 **자동으로 verified 가 될 수 없다** — 사용자 확인이나 출처 대조를 거쳐야 한다(요건 9).
              authority: 'session-summary',
              ...(c.canonicalKey ? { canonicalKey: c.canonicalKey } : {}),
              ...(c.value ? { value: c.value } : {}),
            });
            if (r.outcome !== 'same') fresh++;
            if (r.outcome === 'superseded') superseded += r.closedIds.length;
            // §5.10 v2 (E) — 방금 저장한 카드를 **지금 코드와 대조**한다. 통과하면 기존 승격
            //   관문이 `repository-source` 권위로 올려 준다. 여기가 없으면 리플렉션 카드는
            //   영원히 `candidate` 로 고인다(실측 327장 중 verified 1장의 원인).
            if (groundingOn && r.outcome !== 'same') {
              try { applyGrounding(root, r.card.id); } catch { /* 실패해도 카드는 candidate 로 남는다 */ }
            }
          }
          logger.info(
            `[brain-reflect] saved ${fresh}/${candidates.length} card(s)`
            + `${superseded > 0 ? ` (옛 카드 ${superseded}장 닫음)` : ''} session=${sessionId.slice(0, 8)}`,
          );
          // 수확 0 이 이어지면 그 프로젝트는 당분간 쉰다(④).
          noteOutcome(root, fresh);
        } else {
          noteOutcome(root, 0);
        }
      }
    } catch (e) {
      logger.warn('[brain-reflect] save failed', e as Error);
    }
    finish(`close(code=${code})`);
  });
}

/**
 * 세션 리플렉션 예약(디바운스). 호출 경로로 예외를 던지지 않는다 — 전부 내부에서 흡수.
 * 같은 세션의 반복 트리거(Stop 연속·dismiss)는 BRAIN_REFLECTION_DEBOUNCE_MS 창으로 1회로 합친다.
 * 타이머는 호출마다 리셋되므로, 턴이 계속 이어지는 동안에는 발화하지 않고 **활동이 멎은 뒤**에만 돈다.
 */
export function scheduleBrainReflection(input: BrainReflectionInput): void {
  try {
    if (!input.sessionId || !input.cwd || !input.root) return;
    // v3.76 — 리플렉션 자식이 낸 Stop 으로 자기 자신을 다시 리플렉션하던 자가 증식 차단.
    // 자식 JSONL 은 12줄이라 MIN_EVENTS(8) 를 넘고, 스폰마다 sessionId 가 새로 생겨
    // lastReflectedLines(새 라인 40줄) 게이트도 무력이었다 → 디바운스 300초 + 실행 ~40초 =
    // **5분 40초 주기의 무한 체인**. 시간당 상한은 이 순환을 끊지 못하고 주기만 정해줬다.
    if (isBrainReflectionCwd(input.cwd) || isBrainReflectionCwd(input.root)) return;
    const existing = debounceTimers.get(input.sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      debounceTimers.delete(input.sessionId);
      try { runReflection(input); } catch (e) { logger.warn('[brain-reflect] run failed', e as Error); }
    }, BRAIN_REFLECTION_DEBOUNCE_MS);
    if (typeof timer.unref === 'function') timer.unref();
    debounceTimers.set(input.sessionId, timer);
  } catch (e) {
    logger.warn('[brain-reflect] schedule failed', e as Error);
  }
}

/** 테스트 전용 — 모듈 전역 상태 초기화. */
export function __resetBrainReflectionStateForTest(): void {
  for (const t of debounceTimers.values()) clearTimeout(t);
  debounceTimers.clear();
  lastReflectedLines.clear();
  emptyStreakByRoot.clear();
  backoffUntilByRoot.clear();
  recentSpawnsAt = [];
  inFlight = 0;
}
