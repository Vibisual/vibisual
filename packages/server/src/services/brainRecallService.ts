/**
 * §5.10 v2 (C) — **회상(Recall).**
 *
 * 카드가 아니라 **과거 세션 본문**을 찾는다. 카드는 리플렉션이 "남길 만하다"고 판단한 것만 남는데,
 * 실제로 다시 필요해지는 것은 대개 그때 오간 대화 자체다("그때 이거 어떻게 고쳤더라").
 * 트랜스크립트 JSONL 은 이미 전부 갖고 있으므로 **새로 쌓을 것이 없다** — 찾는 길만 열면 된다.
 *
 * 설계 제약 둘:
 * - **네이티브 의존 ❌**(sqlite FTS5·벡터 DB 금지). Keyword Graph 를 폐기한 사유를 되밟지 않는다.
 *   한국어는 문자 bigram 커버리지로 잡는다 — 조사·어미가 붙어도 어간이 겹친다.
 * - **전량 재파싱 ❌**. 최근 세션 N개만, 파일당 tail 바이트 상한 안에서 훑는다. 상시 sweep 이
 *   트랜스크립트를 전량 재파싱해 앱이 느려졌던 전례가 있어(10초 sweep 552ms 블로킹) 같은 자리를
 *   다시 밟지 않는다. 이 경로는 **사람·에이전트가 부를 때만** 도는 on-demand 다.
 */
import fs from 'node:fs';
import {
  BRAIN_RECALL_EXCERPT_CHARS,
  BRAIN_RECALL_MAX_RESULTS,
  BRAIN_RECALL_SESSION_SCAN_MAX,
  BRAIN_BIGRAM_MIN_SCORE,
  type BrainRecallHit,
} from '@vibisual/shared';
import { charBigrams, coverage, tokenize } from './brainService.js';
import { listJsonlSessionIds } from './sessionDiscovery.js';

/** 파일 하나에서 읽을 최대 바이트. 넘으면 **뒤쪽**을 읽는다(세션 끝이 결론이 모이는 곳). */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** 80자 이상 base64 덩어리 — thinking signature·이미지. 의미 0. */
const BASE64_RUN = /[A-Za-z0-9+/]{80,}={0,2}/g;

/** 훅이 매 턴 붙이는 상용구 — 회상 결과로 나오면 잡음이다. */
const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

function stripNoise(text: string): string {
  return text.replace(SYSTEM_REMINDER, '').replace(BASE64_RUN, '…').replace(/\s+/g, ' ').trim();
}

/** 한 JSONL 라인에서 사람이 읽을 대화 텍스트만 뽑는다(도구 페이로드·thinking 제외). */
function textFromLine(line: string): { text: string; at: number } | null {
  let j: unknown;
  try { j = JSON.parse(line); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const e = j as Record<string, unknown>;
  if (e.type !== 'user' && e.type !== 'assistant') return null;
  const msg = e.message as Record<string, unknown> | undefined;
  if (!msg) return null;
  const at = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : NaN;
  const parts: string[] = [];
  const content = msg.content;
  if (typeof content === 'string') parts.push(content);
  else if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    }
  }
  const text = stripNoise(parts.join(' '));
  if (!text) return null;
  return { text, at: Number.isFinite(at) ? at : 0 };
}

/** 맞은 대목을 중심으로 발췌. 질의 어절이 처음 나오는 자리를 기준으로 앞뒤를 남긴다. */
function excerptAround(text: string, queryTokens: Set<string>): string {
  if (text.length <= BRAIN_RECALL_EXCERPT_CHARS) return text;
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of queryTokens) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return `${text.slice(0, BRAIN_RECALL_EXCERPT_CHARS)}…`;
  const half = Math.floor(BRAIN_RECALL_EXCERPT_CHARS / 2);
  const start = Math.max(0, at - half);
  const end = Math.min(text.length, start + BRAIN_RECALL_EXCERPT_CHARS);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/** 파일을 읽되 큰 파일은 뒤쪽만 — 앞쪽이 잘려 깨진 첫 줄은 JSON 파싱 실패로 자연히 버려진다. */
function readTail(file: string): string | null {
  try {
    const st = fs.statSync(file);
    if (st.size <= MAX_FILE_BYTES) return fs.readFileSync(file, 'utf8');
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(MAX_FILE_BYTES);
      fs.readSync(fd, buf, 0, MAX_FILE_BYTES, st.size - MAX_FILE_BYTES);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

export interface BrainRecallOptions {
  limit?: number;
  /** 훑을 최근 세션 수 상한. 테스트에서 줄여 쓴다. */
  sessionScanMax?: number;
}

/**
 * 과거 세션 본문에서 질의와 맞는 대목을 찾는다.
 *
 * `cwd` 는 세션 JSONL 을 찾는 기준(프로젝트 슬러그), `root` 는 결과에 실어 보낼 프로젝트 루트다.
 * 둘이 대개 같지만 워크트리에서는 갈리므로 따로 받는다.
 */
export function recallFromSessions(args: {
  root: string;
  cwd: string;
  query: string;
  options?: BrainRecallOptions;
}): BrainRecallHit[] {
  const query = (args.query ?? '').trim();
  if (!query) return [];
  const qT = tokenize(query);
  const qB = charBigrams(query);
  if (qT.size === 0 && qB.size === 0) return [];

  const scanMax = args.options?.sessionScanMax ?? BRAIN_RECALL_SESSION_SCAN_MAX;
  const limit = args.options?.limit ?? BRAIN_RECALL_MAX_RESULTS;

  // 최근에 손댄 세션부터 — 오래된 것까지 다 훑는 것이 목적이 아니다.
  const sessions = listJsonlSessionIds(args.cwd)
    .map((s) => {
      let mtime = 0;
      try { mtime = fs.statSync(s.jsonlPath).mtimeMs; } catch { /* 사라진 파일은 0 */ }
      return { ...s, mtime };
    })
    .filter((s) => s.mtime > 0)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, scanMax);

  const hits: BrainRecallHit[] = [];
  for (const s of sessions) {
    const raw = readTail(s.jsonlPath);
    if (!raw) continue;
    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.trim().length === 0) continue;
      const parsed = textFromLine(line);
      if (!parsed) continue;
      const tokenScore = coverage(qT, tokenize(parsed.text));
      // bigram 은 느슨하므로 살짝 깎아 어절 일치가 항상 우선하게 둔다(스킬 선택과 같은 규약).
      const score = Math.max(tokenScore, coverage(qB, charBigrams(parsed.text)) * 0.9);
      if (score < BRAIN_BIGRAM_MIN_SCORE) continue;
      hits.push({
        sessionId: s.sessionId,
        root: args.root,
        excerpt: excerptAround(parsed.text, qT),
        index: i,
        at: parsed.at || s.mtime,
        score,
      });
    }
  }

  // 같은 세션이 통째로 상위를 먹지 않게 세션당 1건만 남긴다 — 회상은 "어느 세션에 있었나"가 먼저다.
  const bestBySession = new Map<string, BrainRecallHit>();
  for (const h of hits) {
    const cur = bestBySession.get(h.sessionId);
    if (!cur || h.score > cur.score) bestBySession.set(h.sessionId, h);
  }
  return [...bestBySession.values()]
    .sort((a, b) => b.score - a.score || b.at - a.at)
    .slice(0, limit);
}
