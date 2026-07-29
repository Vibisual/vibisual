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
  BRAIN_REFLECTION_MIN_NEW_LINES,
  BRAIN_REFLECTION_EMPTY_STREAK_THRESHOLD,
  BRAIN_REFLECTION_BACKOFF_MAX_MS,
  BRAIN_REFLECTION_TEXT_MAX_CHARS,
  BRAIN_REFLECTION_TOOL_RESULT_MAX_CHARS,
  BRAIN_REFLECTION_SYSTEM_PROMPT,
  BRAIN_REFLECTION_DISALLOWED_TOOLS,
  BRAIN_SESSION_CANDIDATE_MAX,
  BRAIN_REFLECTION_PROMPT,
  type BrainCardScope,
  type BrainCardType,
} from '@vibisual/shared';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveClaudeBin } from './claudeBin.js';
import { getSessionJsonlPath } from './sessionDiscovery.js';
import { getBrainService } from './brainService.js';
import { logger } from '../logger.js';

const CLAUDE_BIN = resolveClaudeBin().binPath;

/** one-shot 리플렉션 상한 — haiku 가 이 시간 안에 못 끝내면 실패 처리(무한 대기 방지). */
const REFLECT_TIMEOUT_MS = 60_000;

const VALID_TYPES: ReadonlySet<string> = new Set(['decision', 'mistake', 'lesson', 'rule', 'fact']);

/**
 * 리플렉션 스폰 전용 작업 디렉터리(빈 폴더). 서버 프로세스 cwd(= 앱 설치 폴더)를 그대로 물려받으면
 * 그 폴더의 파일·git 상태가 프리픽스에 섞인다. 빈 폴더로 고정하면 모든 리플렉션이 같은 프리픽스를
 * 공유해 캐시가 최대로 재사용된다.
 */
const REFLECT_CWD = path.join(os.tmpdir(), 'vibisual-reflect');

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
}

/**
 * 원시 JSONL 문자열에서 대화 다이제스트를 만든다. 파일 접근이 없는 순수 함수 — 테스트가 직접 부른다.
 * 대화(user/assistant)만 남기고 thinking·base64·system-reminder·도구 페이로드를 걷어낸 뒤 tail 을 자른다.
 */
export function buildDigest(raw: string): SessionDigest {
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const parts: string[] = [];
  for (const line of lines) {
    let j: unknown;
    try { j = JSON.parse(line); } catch { continue; }
    if (!j || typeof j !== 'object') continue;
    const e = j as Record<string, unknown>;
    if (e.type !== 'user' && e.type !== 'assistant') continue;
    const msg = e.message as Record<string, unknown> | undefined;
    if (!msg) continue;
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
  return { text: kept.join('\n'), lineCount: lines.length, rawChars: raw.length };
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

/** 모델 출력에서 JSON 배열을 방어적으로 파싱. 실패 시 빈 배열. */
function parseCandidates(out: string): { type: BrainCardType; title: string; body: string; files: string[] }[] {
  const text = out.trim();
  if (!text) return [];
  // 코드펜스/설명이 섞였을 수 있으니 첫 '[' ~ 마지막 ']' 만 시도.
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let arr: unknown;
  try { arr = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out2: { type: BrainCardType; title: string; body: string; files: string[] }[] = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const type = typeof o.type === 'string' && VALID_TYPES.has(o.type) ? (o.type as BrainCardType) : 'lesson';
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    if (!title) continue;
    const body = typeof o.body === 'string' ? o.body.trim() : '';
    const files = Array.isArray(o.files) ? o.files.filter((f): f is string => typeof f === 'string') : [];
    out2.push({ type, title, body, files });
    if (out2.length >= BRAIN_SESSION_CANDIDATE_MAX) break;
  }
  return out2;
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

  const prompt = BRAIN_REFLECTION_PROMPT + digest.text;
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
    CLAUDE_BIN,
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
  child.on('error', (err) => { logger.warn('[brain-reflect] spawn error', err); finish('spawn-error'); });
  child.on('close', (code) => {
    try {
      if (code === 0) {
        const candidates = parseCandidates(outBuf);
        if (candidates.length > 0) {
          const svc = getBrainService(root);
          for (const c of candidates) {
            svc.saveCard({
              type: c.type,
              scope,
              agentId: scope === 'agent' ? agentId : undefined,
              title: c.title,
              body: c.body,
              files: c.files,
              sourceSessionId: sessionId,
              seen: false,
            });
          }
          logger.info(`[brain-reflect] saved ${candidates.length} card(s) session=${sessionId.slice(0, 8)}`);
        }
        // 수확 0 이 이어지면 그 프로젝트는 당분간 쉰다(④).
        noteOutcome(root, candidates.length);
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
