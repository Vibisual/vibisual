/**
 * §5.11 정독 게이트 — **읽기 영수증 원장**(서버).
 *
 * 플러그인은 파일을 볼 수 있어도 "이 세션이 그 구간을 열었는가"는 알 수 없다. 그것은 도구 호출 이력이고
 * 호스트만 갖고 있다. 이 파일이 그 이력을 모으는 자리다 — 훅의 `PostToolUse`(Read/Grep)에서 열람 구간을,
 * `UserPromptSubmit` 에서 이번 턴 프롬프트를, 편집 도구에서 건드린 경로를 받아 세션별로 쌓는다.
 *
 * **판정은 여기 없다.** 절을 자르고 지목하고 커버율을 재는 것은 전부 `@vibisual/plugins` 의 순수 함수이고,
 * 그것을 부르는 것은 파일 탐침을 가진 `pluginHost` 다. 이 파일이 판정까지 하면 프롬프트에 실린 판단과
 * 게이트가 막는 근거가 갈린다 — "화면은 초록인데 막힌다"가 만들어지는 정확한 경로다.
 *
 * **영속하지 않는다.** 원장은 그 세션 동안의 사실이라 재시작하면 처음부터 다시 쌓는 것이 맞다
 * (영속하는 것은 프로젝트 설정 하나뿐 — `ProjectCheckpoint.specReadingSettings`).
 *
 * 키는 **`SubAgent.id`** 다. `verificationRuns`(#17-35)·`sessionLoops`(#17-11)와 같은 축이라 활동바가
 * 키 하나로 셋을 읽는다. 훅 세션(CLI 세션 UUID)은 호출부가 `findSubBySessionId` 로 옮겨 담아 넘긴다.
 */
import {
  SPEC_GATE_EVENT_MAX,
  SPEC_LEDGER_FILE_MAX,
  SPEC_LEDGER_SESSION_MAX,
  SPEC_SPANS_PER_FILE_MAX,
  SPEC_PROMPT_KEEP_CHARS,
  SPEC_TOUCHED_PATH_MAX,
  SPEC_CITATION_SESSION_MAX,
} from '@vibisual/shared';
import type { SpecCitation, SpecGateEvent, SpecReadSpan } from '@vibisual/shared';
import path from 'path';
import { shapePath, spanFromGrep, spanFromRead } from '@vibisual/plugins';
import { extractTaskText } from './turnPrompt.js';
import { logger } from '../logger.js';

/**
 * 도구가 말한 경로를 **프로젝트 루트 기준 상대경로**로 바꾼다.
 *
 * 색인은 상대경로로 서 있고 훅은 절대경로를 준다 — 여기서 축을 맞추지 않으면 열람 영수증이 색인의
 * 어느 절에도 안 붙어 **모든 절이 영원히 미열람**이 된다(게이트가 성실한 쪽을 벌하는 최악의 오작동).
 * 루트 밖은 null — 이 게이트가 말하는 기획 문서가 아니다.
 * 케이스는 접지 않는다(비교는 뒤에서 `pathKey` 가 그 플랫폼 규칙대로 한다).
 */
function toProjectRelative(root: string, raw: string): string | null {
  const value = raw.trim();
  if (value === '') return null;
  if (!path.isAbsolute(value)) return shapePath(value); // 이미 상대경로면 그대로(도구는 cwd 기준으로 답한다)
  const rel = path.relative(path.resolve(root), path.resolve(value));
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return shapePath(rel);
}

/** 한 세션이 들고 있는 원장. 전부 휘발이고, 각 축에 개수 상한이 걸려 있다(§3.2.4 F′). */
interface SessionLedger {
  projectPath: string;
  /** 파일 → 열람 구간. 파일 수·파일당 구간 수 둘 다 상한이 있다. */
  spans: Map<string, SpecReadSpan[]>;
  /** 파일 → 총 줄 수. 히트맵의 축척 — 모르면 그 막대는 안 그린다. */
  fileLines: Map<string, number>;
  /** 이번 턴 프롬프트(앞부분만). 필수 절을 고르는 재료다. */
  promptText: string;
  /** 본문이 **조립 시점**에 적혔는가 — 훅이 주는 조립본(앞말 포함)으로 덮어쓰지 않기 위한 표식. */
  promptFromAssembly: boolean;
  /** 이 세션이 건드린 경로(중복 없이, 최근 것 우선). */
  touched: string[];
  /** 대조를 마친 인용들. */
  citations: SpecCitation[];
  gate: SpecGateEvent[];
  stopRetries: number;
  updatedAt: number;
}

class SpecReadingService {
  private readonly sessions = new Map<string, SessionLedger>();

  /** 이 세션의 원장(없으면 만든다). 세션 수가 상한을 넘으면 가장 오래 안 만진 것부터 버린다. */
  private ledger(subAgentId: string, projectPath: string): SessionLedger {
    const found = this.sessions.get(subAgentId);
    if (found) {
      // 워크트리를 갈아타면 같은 세션이 다른 프로젝트를 보게 된다 — 그때는 원장을 그 프로젝트로 옮긴다.
      if (projectPath && found.projectPath !== projectPath) found.projectPath = projectPath;
      return found;
    }
    if (this.sessions.size >= SPEC_LEDGER_SESSION_MAX) {
      let oldestId: string | null = null;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [id, l] of this.sessions) {
        if (l.updatedAt < oldestAt) {
          oldestAt = l.updatedAt;
          oldestId = id;
        }
      }
      if (oldestId !== null) this.sessions.delete(oldestId);
    }
    const fresh: SessionLedger = {
      projectPath,
      spans: new Map(),
      fileLines: new Map(),
      promptText: '',
      promptFromAssembly: false,
      touched: [],
      citations: [],
      gate: [],
      stopRetries: 0,
      updatedAt: Date.now(),
    };
    this.sessions.set(subAgentId, fresh);
    return fresh;
  }

  /**
   * 이번 턴 프롬프트. **턴마다 갈아 끼운다** — 지난 턴의 프롬프트로 이번 턴 절을 고르면
   * 사용자가 화제를 바꾼 뒤에도 옛 절이 계속 필수로 남는다(그것이 곧 오탐이다).
   */
  notePrompt(subAgentId: string, projectPath: string, text: string, at = Date.now(), source: 'hook' | 'assembly' = 'hook'): void {
    if (!subAgentId || typeof text !== 'string') return;
    const l = this.ledger(subAgentId, projectPath);
    l.promptText = text.slice(0, SPEC_PROMPT_KEEP_CHARS);
    l.promptFromAssembly = source === 'assembly';
    l.updatedAt = at;
  }

  /**
   * 훅 `UserPromptSubmit` 이 준 프롬프트 — **조립본이면 건드리지 않는다.**
   *
   * 우리가 띄운 세션은 조립 시점에 본문만 이미 적혀 있고(`notePrompt(…, 'assembly')`), 훅이 주는 것은
   * 그 본문 앞에 앞말(정독 블록 포함)이 붙은 조립 결과다. 그것으로 덮으면 지난 정독 블록의 제목들이
   * 이번 라우팅 재료가 된다(자기 참조). 원장의 본문이 이 프롬프트 안에 그대로 있으면 조립본이다.
   * 아니면(외부 세션·CMD·첫 스폰) 첫 스폰 꼴만 벗겨 적는다.
   */
  notePromptFromHook(subAgentId: string, projectPath: string, prompt: string, at = Date.now()): void {
    if (!subAgentId || typeof prompt !== 'string') return;
    const l = this.ledger(subAgentId, projectPath);
    if (l.promptFromAssembly && l.promptText !== '' && prompt.includes(l.promptText)) return;
    this.notePrompt(subAgentId, projectPath, extractTaskText(prompt), at, 'hook');
  }

  /** 이 세션이 건드린 경로 — 경로 축 라우팅과 `enforce` 게이트의 대상 판정에 쓴다. */
  noteTouched(subAgentId: string, projectPath: string, relPath: string, at = Date.now()): void {
    if (!subAgentId || typeof relPath !== 'string' || relPath.trim() === '') return;
    const l = this.ledger(subAgentId, projectPath);
    const rel = toProjectRelative(projectPath, relPath);
    if (rel === null) return;
    const idx = l.touched.indexOf(rel);
    if (idx >= 0) l.touched.splice(idx, 1);
    l.touched.unshift(rel);
    if (l.touched.length > SPEC_TOUCHED_PATH_MAX) l.touched.length = SPEC_TOUCHED_PATH_MAX;
    l.updatedAt = at;
  }

  /**
   * 도구 호출 하나를 열람 구간으로 옮긴다.
   *
   * `Read`·`Grep` 만 열람이다. `Glob` 은 파일 이름만 보는 것이라 열람이 아니고, 그것을 세면 "목록만
   * 훑고 다 읽었다"가 통과한다 — 이 게이트가 막으려는 바로 그 동작이다.
   */
  noteToolUse(
    subAgentId: string,
    projectPath: string,
    toolName: string,
    toolInput: Record<string, unknown> | undefined,
    toolResponse: Record<string, unknown> | undefined,
    at = Date.now(),
  ): void {
    if (!subAgentId) return;
    try {
      const spans = toolName === 'Read'
        ? readSpans(projectPath, toolInput, toolResponse, at)
        : toolName === 'Grep'
          ? grepSpans(projectPath, toolInput, toolResponse, at)
          : [];
      for (const span of spans) this.addSpan(subAgentId, projectPath, span, at);
      // 히트맵 축척 — Read 응답이 `file.totalLines` 로 파일 길이를 준다(없으면 `cat -n` 꼴의 마지막 줄 번호).
      if (toolName === 'Read') {
        const raw = relPathOf(toolInput);
        const total = readResponseFile(toolResponse).totalLines;
        if (raw !== null && total !== null) this.noteFileLines(subAgentId, projectPath, raw, total);
      }
    } catch (err) {
      // 원장 하나 때문에 훅 처리가 멈추면 안 된다 — 이 층은 관측이지 실행 경로가 아니다.
      logger.warn(`[spec] tool span failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private addSpan(subAgentId: string, projectPath: string, span: SpecReadSpan, at: number): void {
    const l = this.ledger(subAgentId, projectPath);
    const key = span.file;
    let list = l.spans.get(key);
    if (!list) {
      if (l.spans.size >= SPEC_LEDGER_FILE_MAX) {
        // 파일 수 상한 — 가장 오래 안 건드린 파일부터 버린다(Map 삽입 순서를 그대로 쓴다).
        const oldest = l.spans.keys().next();
        if (!oldest.done) {
          l.spans.delete(oldest.value);
          l.fileLines.delete(oldest.value);
        }
      }
      list = [];
      l.spans.set(key, list);
    }
    /*
     * 겹치거나 맞닿은 구간은 **합쳐서** 든다.
     *
     * 같은 절을 두 번 열면 구간이 두 줄로 쌓이는데, 그 둘은 화면에서도 판정에서도 한 줄과 같은 뜻이다.
     * 안 합치면 긴 문서를 훑는 세션 하나가 파일당 상한(200)을 금세 채우고, 그 목록이 **매 브로드캐스트마다
     * 통째로 전선을 탄다**(§9 전선 예산). 합치면 실제 열람 모양은 그대로 두면서 줄 수만 준다.
     */
    const merged = list.find(
      (s) => s.tool === span.tool && s.partial === span.partial
        && span.fromLine <= s.toLine + 1 && s.fromLine <= span.toLine + 1,
    );
    if (merged) {
      merged.fromLine = Math.min(merged.fromLine, span.fromLine);
      merged.toLine = Math.max(merged.toLine, span.toLine);
      merged.at = Math.max(merged.at, span.at);
    } else {
      list.push(span);
      if (list.length > SPEC_SPANS_PER_FILE_MAX) list.splice(0, list.length - SPEC_SPANS_PER_FILE_MAX);
    }
    l.updatedAt = at;
  }

  /** 히트맵의 축척. 총 줄 수를 모르면 그 막대는 안 그린다 — 없는 축척으로 그리면 그림이 곧 거짓이다. */
  noteFileLines(subAgentId: string, projectPath: string, relPath: string, lines: number): void {
    if (!subAgentId || !Number.isFinite(lines) || lines <= 0) return;
    const l = this.ledger(subAgentId, projectPath);
    const rel = toProjectRelative(projectPath, relPath);
    if (rel === null) return;
    l.fileLines.set(rel, Math.trunc(lines));
  }

  /** 대조를 마친 인용들을 덮어쓴다(같은 unit·같은 줄·같은 문장은 한 건으로 온다). */
  setCitations(subAgentId: string, projectPath: string, citations: readonly SpecCitation[], at = Date.now()): void {
    if (!subAgentId) return;
    const l = this.ledger(subAgentId, projectPath);
    const merged = new Map<string, SpecCitation>();
    for (const c of [...l.citations, ...citations]) {
      const key = `${c.unitId}|${c.fromLine}|${c.toLine}|${c.quote}`;
      const prev = merged.get(key);
      // 나중 판정이 이긴다 — 문서가 고쳐지면 통과했던 인용이 실패로 바뀌어야 한다.
      if (!prev || c.checkedAt >= prev.checkedAt) merged.set(key, c);
    }
    const list = [...merged.values()].sort((a, b) => a.checkedAt - b.checkedAt);
    l.citations = list.length > SPEC_CITATION_SESSION_MAX ? list.slice(list.length - SPEC_CITATION_SESSION_MAX) : list;
    l.updatedAt = at;
  }

  /** 게이트가 실제로 무엇을 했는지 한 줄. 막은 적이 없으면 빈 배열이고 화면이 "막은 적 없음"이라 적는다. */
  noteGate(subAgentId: string, projectPath: string, event: SpecGateEvent): void {
    if (!subAgentId) return;
    const l = this.ledger(subAgentId, projectPath);
    l.gate.push(event);
    if (l.gate.length > SPEC_GATE_EVENT_MAX) l.gate.splice(0, l.gate.length - SPEC_GATE_EVENT_MAX);
    l.updatedAt = event.at;
  }

  /** `Stop` 을 되돌린 횟수를 하나 올리고 그 값을 준다. 상한 판정은 부르는 쪽이 한다. */
  bumpStopRetry(subAgentId: string, projectPath: string): number {
    const l = this.ledger(subAgentId, projectPath);
    l.stopRetries += 1;
    l.updatedAt = Date.now();
    return l.stopRetries;
  }

  /** 새 턴이 시작되면 되돌림 카운터를 되돌린다 — 안 그러면 한 세션에서 한 번만 막을 수 있다. */
  resetStopRetries(subAgentId: string): void {
    const l = this.sessions.get(subAgentId);
    if (l) l.stopRetries = 0;
  }

  /** 이 세션이 보고 있는 프로젝트(원장이 없으면 null). */
  projectOf(subAgentId: string): string | null {
    return this.sessions.get(subAgentId)?.projectPath ?? null;
  }

  /**
   * 이 원장의 **판 번호**(마지막으로 바뀐 시각).
   *
   * 스냅샷이 매 16~250ms 방송되는데 그때마다 정독 상태 객체를 새로 지으면 참조가 매번 달라져
   * 증분이 걸리지 않는다(§9 전선 예산 — 키맵 슬라이스는 참조를 지켜야 이득이 난다).
   * 부르는 쪽은 이 값이 그대로면 **직전 객체를 그대로 돌려준다.**
   */
  versionOf(subAgentId: string): number {
    return this.sessions.get(subAgentId)?.updatedAt ?? 0;
  }

  /** 원장을 든 세션 전부 — 스냅샷 조립이 순회한다. */
  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * 판정을 부르는 쪽(`pluginHost`)에 넘길 **원장 그대로의 재료**.
   *
   * 여기서 절·커버율을 계산하지 않는다. 계산은 플러그인 순수 함수 하나뿐이어야 하고, 그래야 프롬프트·
   * 화면·게이트가 같은 답을 말한다.
   */
  contextFieldsFor(subAgentId: string): {
    promptText: string;
    touchedPaths: string[];
    readingSpans: Record<string, SpecReadSpan[]>;
    readingCitations: SpecCitation[];
  } | undefined {
    const l = this.sessions.get(subAgentId);
    if (!l) return undefined;
    const readingSpans: Record<string, SpecReadSpan[]> = {};
    for (const [file, list] of l.spans) readingSpans[file] = list;
    return {
      promptText: l.promptText,
      touchedPaths: [...l.touched],
      readingSpans,
      readingCitations: [...l.citations],
    };
  }

  /** 히트맵 축척·게이트 이력처럼 **판정 밖의** 표시 재료. */
  viewFieldsFor(subAgentId: string): { fileLines: Record<string, number>; gate: SpecGateEvent[]; stopRetries: number } | undefined {
    const l = this.sessions.get(subAgentId);
    if (!l) return undefined;
    const fileLines: Record<string, number> = {};
    for (const [file, n] of l.fileLines) fileLines[file] = n;
    return { fileLines, gate: [...l.gate], stopRetries: l.stopRetries };
  }

  /** 세션이 사라지면 원장도 사라진다 — 남겨 두면 죽은 세션의 숫자가 화면에 계속 뜬다. */
  forget(subAgentId: string): void {
    this.sessions.delete(subAgentId);
  }

  /** 테스트 전용 — 원장을 비운다. */
  reset(): void {
    this.sessions.clear();
  }
}

/**
 * `Read` 한 번이 연 구간.
 *
 * `offset`·`limit` 을 준 Read 는 그 구간을 정확히 연 것이고, 안 준 Read 는 도구가 앞부분만 돌려주므로
 * 긴 파일에서는 **부분 열람으로 강등**된다(판정은 플러그인의 `spanFromRead` 하나가 한다).
 */
function readSpans(
  root: string,
  input: Record<string, unknown> | undefined,
  response: Record<string, unknown> | undefined,
  at: number,
): SpecReadSpan[] {
  const raw = relPathOf(input);
  const file = raw === null ? null : toProjectRelative(root, raw);
  if (!file) return [];
  const offset = numberOf(input?.['offset']);
  const limit = numberOf(input?.['limit']);
  const info = readResponseFile(response);
  const span = spanFromRead(file, at, {
    ...(offset === null ? {} : { offset }),
    ...(limit === null ? {} : { limit }),
    ...(info.totalLines === null ? {} : { totalLines: info.totalLines }),
    // 도구가 실제로 돌려준 범위 — 통째 Read 가 상한에서 잘렸을 때 "다 읽었다"로 세지 않는 유일한 근거.
    ...(info.startLine !== null && info.numLines !== null ? { returnedFrom: info.startLine, returnedCount: info.numLines } : {}),
  });
  return [span];
}

/**
 * `Grep` 한 번이 덮은 구간들.
 *
 * 매치 줄 번호는 `output_mode: 'content'` + `-n` 일 때만 응답에 있다. 없으면 아무 구간도 만들지 않는다 —
 * 모르는 것을 "봤다"로 세면 그 순간 이 게이트의 숫자가 거짓이 된다.
 */
function grepSpans(
  root: string,
  input: Record<string, unknown> | undefined,
  response: Record<string, unknown> | undefined,
  at: number,
): SpecReadSpan[] {
  const contextLines = numberOf(input?.['-C']) ?? numberOf(input?.['context']) ?? numberOf(input?.['-A']) ?? null;
  const text = textOf(response);
  if (text === null) return [];
  // 파일 하나를 지정한 Grep 은 ripgrep 이 경로를 **빼고** `120:본문` 만 준다 — 그때의 파일은 입력의 `path` 다.
  const singlePath = typeof input?.['path'] === 'string' && (input['path'] as string).trim() !== '' ? (input['path'] as string).trim() : null;
  const out: SpecReadSpan[] = [];
  for (const line of text.split(/\r?\n/)) {
    const hit = grepLine(line, singlePath);
    if (!hit) continue;
    const file = toProjectRelative(root, hit.file);
    if (!file) continue;
    out.push(spanFromGrep(file, hit.line, at, contextLines ?? undefined));
    if (out.length >= SPEC_SPANS_PER_FILE_MAX) break;
  }
  return out;
}

/**
 * ripgrep 한 줄에서 파일·줄 번호를 읽는다.
 *
 * `docs/a.md:120:본문` · `C:\\Users\\<you>\\docs\\a.md:120:본문`(드라이브 콜론 — 종전 정규식은 `C` 에서 끊겨 Windows
 * 절대경로를 한 건도 못 읽었다) · 문맥 줄 `docs/a.md-118-앞줄` · 단일 파일 `120:본문`(경로는 입력의 `path`).
 * 경로로 보이려면 구분자나 확장자 점이 있어야 한다 — `120:45 minutes` 같은 본문을 파일 "120" 으로 읽지 않는다.
 */
function grepLine(line: string, singlePath: string | null): { file: string; line: number } | null {
  const m = /^((?:[A-Za-z]:)?[^:\n]+?):(\d+)[:-]/.exec(line);
  if (m && /[\\/.]/.test(m[1] ?? '')) {
    const n = Number(m[2]);
    return Number.isFinite(n) ? { file: m[1] ?? '', line: n } : null;
  }
  if (singlePath) {
    const s = /^(\d+)[:-]/.exec(line);
    if (s) {
      const n = Number(s[1]);
      return Number.isFinite(n) ? { file: singlePath, line: n } : null;
    }
  }
  return null;
}

function relPathOf(input: Record<string, unknown> | undefined): string | null {
  const raw = input?.['file_path'] ?? input?.['path'] ?? input?.['notebook_path'];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

function numberOf(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** 훅 `tool_response` 의 안쪽 `file` 객체(Read 도구의 실제 모양 — `{type:'text', file:{…}}`). */
function fileOf(response: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const file = response?.['file'];
  return file && typeof file === 'object' ? (file as Record<string, unknown>) : undefined;
}

function textOf(response: Record<string, unknown> | undefined): string | null {
  const raw = response?.['output'] ?? response?.['stdout'] ?? response?.['content'] ?? response?.['text'] ?? fileOf(response)?.['content'];
  return typeof raw === 'string' ? raw : null;
}

/**
 * Read 응답의 **실제 모양**에서 셋을 읽는다 — `file.totalLines`(파일 길이) · `file.startLine`·`file.numLines`
 * (실제로 돌려준 범위). 종전에는 최상위 `totalLines` 만 봐서 축척이 영영 비었고, 그래서 히트맵도
 * 통째 Read 강등도 한 번도 서지 않았다. 최상위 키는 옛 픽스처·다른 도구 모양을 위해 그대로 받는다.
 */
function readResponseFile(response: Record<string, unknown> | undefined): { totalLines: number | null; startLine: number | null; numLines: number | null } {
  const file = fileOf(response);
  const totalLines = numberOf(file?.['totalLines'] ?? response?.['totalLines'] ?? response?.['total_lines']) ?? responseLineCount(response);
  return { totalLines, startLine: numberOf(file?.['startLine']), numLines: numberOf(file?.['numLines']) };
}

/**
 * 응답 본문에서 파일의 **총 줄 수**를 읽어 낸다(축척 필드가 없을 때의 폴백).
 *
 * Read 도구는 `cat -n` 꼴로 돌려주므로 마지막 줄의 번호가 곧 "여기까지 봤다"이다. 파일이 그보다 길면
 * 잘린 것이고, 그 판정은 플러그인이 상한과 비교해 내린다.
 */
function responseLineCount(response: Record<string, unknown> | undefined): number | null {
  const text = textOf(response);
  if (text === null) return null;
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*(\d+)\t/.exec(lines[i] ?? '');
    if (m) return Number(m[1]);
  }
  return lines.length;
}

export const specReadingService = new SpecReadingService();
export { SpecReadingService };
