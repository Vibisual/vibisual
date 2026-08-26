/**
 * hooks/handler.mjs — Claude Code Hook bridge (pure Node.js, no dependencies)
 *
 * stdin JSON → POST localhost:4800/api/hook-event → stdout
 * Stop 이벤트 시 대기열에서 다음 명령을 꺼내 claude --resume으로 실행
 *
 * §5.3 #12-1 v1.43 — PreToolUse 는 /api/permission-check 로 동기 홀드.
 *   서버가 Vibisual 관할 + ask 모드로 판정 시 사용자 승인까지 최대 60s 대기.
 *   타임아웃·서버 unreachable 은 allow 폴백(비-Vibisual 세션 파괴 방지).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// §3.6 v2.9 — installer writes --server <url> into ~/.claude/settings.json so the packaged
// handler never needs to discover the port itself. Inline fallback: if --server is absent,
// check VIBISUAL_SERVER_URL env; otherwise default to http://127.0.0.1:4800.
// The git-marker discovery logic from lib/serverUrl.mjs is intentionally dropped — it was
// dev-only and handler.mjs is now fully self-contained.
function readArg(flag) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith(flag + '=')) return args[i].slice(flag.length + 1);
  }
  return null;
}

const BASE = (readArg('--server') ?? process.env['VIBISUAL_SERVER_URL'] ?? 'http://127.0.0.1:4800').replace(/\/+$/, '');
const SERVER_URL = `${BASE}/api/hook-event`;
const COMMANDS_URL = `${BASE}/api/commands`;
const PERMISSION_CHECK_URL = `${BASE}/api/permission-check`;
const ASK_USER_QUESTION_URL = `${BASE}/api/ask-user-question`;
// §5.10 Project Brain — 파일 접근 경고. PostToolUse Edit/Write 시 짧게(300ms) 물어보고,
//   매칭되는 실수/교훈 카드가 있으면 additionalContext 로 모델에 주입(같은 실수 반복 차단).
const BRAIN_FILE_NOTES_URL = `${BASE}/api/brain/file-notes`;
// §4 v3.60 — 사용량 수집기(statusLine). Claude Code 가 플랜 한도 사용률을 외부에 주는 유일한
//   공식 경로가 statusLine stdin JSON 이라, `--statusline` 으로 불리면 그 값만 뽑아 푸시한다.
const RATE_LIMITS_URL = `${BASE}/api/rate-limits`;
// §4 v4.89 — 서브에이전트 행 수집기(`--subagent-statusline`)가 미는 토큰 사용량. 종전에는
//   `${SERVER_URL}/api/subagent-statusline` 로 보내 `/api/hook-event/api/subagent-statusline` 이
//   되는 바람에 전량 404 로 버려졌다. 경로는 BASE 에서 조립한다.
const SUBAGENT_STATUSLINE_URL = `${BASE}/api/subagent-statusline`;

// Per-launch auth token written by the installer into the hook command (--token <hex>).
// If absent (stale settings.json from before this change), TOKEN is null and the header
// is omitted — the server will then reject with 401 and the user must restart the app
// so a fresh token is written to settings.json.
const TOKEN = readArg('--token');

function hookHeaders(extra) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (TOKEN) h['x-vibisual-hook-token'] = TOKEN;
  return h;
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', () => resolve(''));
  });
}

/** 대기열에서 1번 명령 꺼내기 */
async function popCommand(sessionId) {
  try {
    const res = await fetch(`${COMMANDS_URL}/${sessionId}/pop`, { method: 'POST', headers: hookHeaders({}) });
    const data = await res.json();
    return data.command ?? null;
  } catch {
    return null;
  }
}

/** claude --resume으로 명령 실행 */
function executeCommand(sessionId, text) {
  const child = spawn('claude', ['--resume', sessionId, '-p', text], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

/**
 * §5.3 #12-1 v1.43/v1.88/v1.96 — PreToolUse 권한 문의.
 *
 * 서버 응답 분기:
 *   - `deny`                                    → 명시적 `permissionDecision:'deny'` + reason (모델에게 차단 사유 전달)
 *   - `allow` & 관할 외(not-managed/view-only)  → `{continue:true}` (CC 기본 정책에 위임 — 메인 세션 가로채지 않음)
 *   - `allow` & 관할 안(custom agent)           → 명시적 `permissionDecision:'allow'` (reason 없음)
 *
 * 왜 allow 도 명시적이어야 하나: 커스텀 서브에이전트는 `claude -p` (print 모드) 로 떠 있고,
 * print + permissionMode='default' 의 CLI 기본 정책은 ask 가 필요한 도구를 자동 deny 한다.
 * 훅이 `{continue:true}` 만 돌려주면 "내가 안 막을게, 기본 정책 따라가" 의미라 → 자동 deny 로 떨어진다.
 *
 * 사용자가 뭘 눌렀는지 시각화는 클라이언트 측에서 `permission_resolved` WS 이벤트 수신 시
 * stream 에 합성 한 줄을 끼워 넣는 경로로 처리한다 (handler.mjs reason 은 모델 컨텍스트
 * 전용이라 UI 표시 보장이 안 됨). 따라서 allow 쪽 reason 은 비워둔다.
 *
 * 서버 unreachable / 타임아웃 / 에러는 `{continue:true}` (비-Vibisual 세션 안전장치).
 */

/** 서버가 자동 통과시킨 (= Vibisual 관할 외) reason 집합. 이 경우엔 훅이 override 하지 않는다. */
const SERVER_PASSTHROUGH_REASONS = new Set(['not-managed', 'view-only-agent']);

/**
 * §5.3 #12-2 v2.26 — AskUserQuestion 전용 분기.
 *
 * 헤드리스 `claude -p` 라 tool_result 회신 채널이 없으므로 PreToolUse 에서 deny 시키고
 * 사용자가 IDE 카드에서 고른 답을 `permissionDecisionReason` 으로 합성해 모델 transcript 에
 * 도달시킨다(=다음 turn 에서 모델이 reason 텍스트를 읽고 답을 인지).
 *
 * 서버 응답 분기:
 *   - `answer`   → deny + reason("USER ANSWERED via Vibisual: ...")
 *   - `timeout`  → deny + reason("USER DID NOT ANSWER within 60s...")
 *   - `reject` (view-only / not-managed / invalid-input) → {continue:true} (CC 기본 처리)
 *
 * 서버 unreachable / 에러 → {continue:true} (안전장치).
 */
async function checkAskUserQuestion(payload) {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 65_000);
    const res = await fetch(ASK_USER_QUESTION_URL, {
      method: 'POST',
      headers: hookHeaders({}),
      body: JSON.stringify({
        sessionId: payload.session_id,
        subAgentId: process.env.VIBISUAL_SUBAGENT_ID,
        parentAgentId: process.env.VIBISUAL_PARENT_AGENT_ID,
        toolInput: payload.tool_input ?? {},
      }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return { continue: true };
    const data = await res.json().catch(() => null);
    if (!data) return { continue: true };

    if (data.decision === 'answer') {
      const answers = Array.isArray(data.answers) ? data.answers : [];
      const lines = answers.map((a, i) => {
        const q = typeof a?.question === 'string' ? a.question : `Question ${i + 1}`;
        const labels = Array.isArray(a?.selectedLabels) ? a.selectedLabels : [];
        const labelStr = labels.map((l) => `"${String(l).replace(/"/g, '\\"')}"`).join(', ') || '(no selection)';
        const notePart = typeof a?.note === 'string' && a.note ? ` (note: ${a.note})` : '';
        return `Q${i + 1} "${q}": ${labelStr}${notePart}`;
      });
      const body = lines.length > 0 ? lines.join('\n') : '(no answers)';
      const reason = `USER ANSWERED via Vibisual:\n${body}\n\nTreat these as the user's answers to your AskUserQuestion call. The tool itself was intercepted and did NOT execute — do not retry it. Continue based on these answers.`;
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      };
    }

    if (data.decision === 'timeout') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'USER DID NOT ANSWER your AskUserQuestion within 60s in the Vibisual IDE card. Proceed with your best judgment or ask the user differently. Do not retry AskUserQuestion immediately.',
        },
      };
    }

    // reject (not-managed / view-only / invalid-input) → CC 기본 처리 위임
    return { continue: true };
  } catch {
    return { continue: true };
  }
}

/**
 * §5.10 — PostToolUse Edit/Write 파일 접근 경고. 서버가 그 파일에 연결된 un-warned 실수/교훈
 * 카드를 O(1) 조회해 있으면 {warning} 을, 없으면 204 를 준다. 300ms 안에 못 받으면 조용히 통과
 * (fail-open — 편집 흐름을 절대 막지 않는다). 반환=경고 문자열 또는 null.
 */
async function checkBrainFileNotes(payload) {
  try {
    const ti = payload && payload.tool_input;
    const filePath = ti && typeof ti.file_path === 'string' ? ti.file_path : '';
    if (!filePath || !payload.session_id) return null;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 300);
    const res = await fetch(BRAIN_FILE_NOTES_URL, {
      method: 'POST',
      headers: hookHeaders({}),
      body: JSON.stringify({ session_id: payload.session_id, file_path: filePath }),
      signal: controller.signal,
    }).finally(() => clearTimeout(tid));
    if (!res || res.status === 204 || !res.ok) return null;
    const data = await res.json().catch(() => null);
    if (data && typeof data.warning === 'string' && data.warning) return data.warning;
    return null;
  } catch {
    return null;
  }
}

async function checkPermission(payload) {
  try {
    const controller = new AbortController();
    // 서버 타임아웃(60s) 보다 살짝 길게 둬서 서버 safe-deny 가 우선 발동하도록.
    const tid = setTimeout(() => controller.abort(), 65_000);
    const res = await fetch(PERMISSION_CHECK_URL, {
      method: 'POST',
      headers: hookHeaders({}),
      body: JSON.stringify({
        sessionId: payload.session_id,
        subAgentId: process.env.VIBISUAL_SUBAGENT_ID,
        parentAgentId: process.env.VIBISUAL_PARENT_AGENT_ID,
        toolName: payload.tool_name,
        toolInput: payload.tool_input ?? {},
        cwd: payload.cwd,
      }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return { continue: true };
    const data = await res.json().catch(() => null);
    if (!data) return { continue: true };

    if (data.decision === 'deny') {
      const reason = data.reason === 'timeout'
        ? 'USER PERMISSION DECISION: DENY (auto). No response within 60s in the Vibisual approval popup, so it was auto-denied (safe default). This tool was blocked and NOT executed. Tell the user verbatim that their permission decision was recorded as "DENY (timed out, no response)", then stop and ask how they want to proceed.'
        // §4 (CLI 사양 추종) — permissionMode='dontAsk' 정책 거부. 팝업은 뜨지도 않았으므로
        //   "사용자가 Deny 를 눌렀다"고 말하면 거짓이 된다 — 정책 때문임을 그대로 알린다.
        : data.reason === 'dont-ask'
        ? 'PERMISSION POLICY: DENY. This agent runs in permission mode "dontAsk" (do not prompt; deny anything not pre-approved), so the tool was blocked WITHOUT asking the user. No one pressed anything. Tell the user which tool was blocked and that the agent\'s permission mode must be changed (or the command pre-approved) to run it. Do not retry the same tool.'
        : `USER PERMISSION DECISION: DENY. The user pressed "Deny" in the Vibisual approval popup. This tool was blocked and NOT executed.${data.reason ? ` User note: ${data.reason}.` : ''} In your reply, state this explicitly to the user — e.g. 'You selected: Deny — the command was not run.' Do not retry the tool unless the user explicitly asks.`;
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      };
    }

    if (data.decision === 'allow') {
      // 관할 외 — CC 기본 정책에 위임 (메인 Claude Code 세션을 우리가 가로채면 안 됨).
      if (SERVER_PASSTHROUGH_REASONS.has(data.reason)) {
        return { continue: true };
      }
      // 관할 안 — print 모드 default 가 자동 deny 로 떨어지지 않도록 명시적 allow.
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
        },
      };
    }

    // 알 수 없는 decision — 보수적으로 continue.
    return { continue: true };
  } catch {
    return { continue: true };
  }
}

/**
 * §4 v3.60 — statusLine 모드.
 *
 * Claude Code 는 `statusLine.command` 를 렌더마다(최대 300ms 주기) 실행하며 세션 JSON 을
 * stdin 으로 준다. 그 JSON 의 `rate_limits` 가 플랜 한도 사용률을 외부에 노출하는 **유일한
 * 공식 경로**다(JSONL 트랜스크립트·CLI 서브커맨드 어디에도 없음).
 *
 * 두 가지 일을 한다:
 *   1. 한도 값을 `/api/rate-limits` 로 푸시 (값이 바뀌었거나 최소 간격이 지났을 때만).
 *   2. stdout 으로 상태줄 한 줄을 출력 — 사용자가 원래 쓰던 statusLine 명령이 보관돼 있으면
 *      그 명령에 같은 stdin 을 먹여 출력을 그대로 흘린다(passthrough). 없으면 우리 기본 줄.
 *
 * 어떤 실패도 Claude Code 를 막지 않는다 — 항상 뭔가 한 줄 출력하고 끝낸다.
 */
const STATUSLINE_STATE_FILE = path.join(os.homedir(), '.vibisual', 'statusline-state.json');
const STATUSLINE_MIN_POST_INTERVAL_MS = 20_000;

/** 마지막 전송 값·시각. 초당 3회 POST → 전체 스냅샷 브로드캐스트 폭주를 막는 스로틀. */
function readStatusLineState() {
  try {
    return JSON.parse(fs.readFileSync(STATUSLINE_STATE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function writeStatusLineState(state) {
  try {
    fs.mkdirSync(path.dirname(STATUSLINE_STATE_FILE), { recursive: true });
    fs.writeFileSync(STATUSLINE_STATE_FILE, JSON.stringify(state), 'utf-8');
  } catch {
    // 상태 파일은 최적화용 — 못 써도 동작엔 지장 없다(매번 전송될 뿐).
  }
}

/**
 * 우리 자신인가 — 보관된 "사용자 원본" 이 실은 **우리 명령**일 때가 있다.
 *
 * `statusLine` 은 Claude Code 가 스키마를 아는 키라 그쪽이 settings.json 을 다시 쓰면 우리가
 * 넣어둔 `_vibisualManaged` 마커가 사라진다. 그 상태에서 사용자가 수집기를 다시 켜면 인스톨러가
 * **우리 명령을 사용자 원본으로 오인해 보관**하고, 그 뒤로는 이 핸들러가 자기 자신을 passthrough
 * 로 띄우는 무한 사슬이 된다(상태줄은 2초씩 멈추고 프로세스가 계속 쌓인다). 인스톨러 쪽도 함께
 * 고쳤지만, 이미 그렇게 적힌 settings.json 을 만나도 여기서 끊는다.
 */
function isOwnStatusLineCommand(command) {
  return typeof command === 'string'
    && command.includes('handler.mjs')
    && /(^|s)--(subagent-)?statusline(s|$)/.test(command);
}

/** `~/.claude/settings.json` 에 보관된 사용자 원래 statusLine 명령 (설치 시 인스톨러가 저장). */
function readPassthroughCommand() {
  try {
    const p = path.join(os.homedir(), '.claude', 'settings.json');
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const prev = parsed?.statusLine?._vibisualPrevStatusLine;
    if (typeof prev?.command !== 'string' || !prev.command) return null;
    if (isOwnStatusLineCommand(prev.command)) return null; // 자기 자신 재귀 차단
    return prev.command;
  } catch {
    return null;
  }
}

/** 보관된 사용자 명령을 같은 stdin 으로 실행하고 stdout 을 그대로 돌려준다. */
function runPassthrough(command, input) {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'ignore'] });
      let out = '';
      const done = (v) => resolve(v);
      const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } done(null); }, 2000);
      child.stdout.on('data', (c) => { out += c.toString('utf-8'); });
      child.on('error', () => { clearTimeout(timer); done(null); });
      child.on('close', () => { clearTimeout(timer); done(out.replace(/\n+$/, '')); });
      child.stdin.on('error', () => { /* 자식이 stdin 을 안 읽고 끝낼 수 있다 */ });
      child.stdin.end(input);
    } catch {
      resolve(null);
    }
  });
}

/** passthrough 가 없을 때 쓰는 기본 상태줄. 이모지 ❌ — 터미널 폭·폰트 흔들림 방지. */
function buildDefaultStatusLine(payload, five, seven) {
  const parts = [];
  const model = payload?.model?.display_name;
  if (typeof model === 'string' && model) parts.push(model);
  const dir = payload?.workspace?.current_dir;
  if (typeof dir === 'string' && dir) parts.push(path.basename(dir));
  const ctx = payload?.context_window?.used_percentage;
  if (typeof ctx === 'number') parts.push(`ctx ${Math.round(ctx)}%`);
  if (typeof five === 'number') parts.push(`5h ${Math.round(five)}%`);
  if (typeof seven === 'number') parts.push(`7d ${Math.round(seven)}%`);
  return parts.join('  ·  ');
}

async function runStatusLine(input) {
  let payload = null;
  try {
    payload = JSON.parse(input);
  } catch {
    payload = null;
  }

  const rl = payload?.rate_limits ?? null;
  const five = typeof rl?.five_hour?.used_percentage === 'number' ? rl.five_hour.used_percentage : undefined;
  const seven = typeof rl?.seven_day?.used_percentage === 'number' ? rl.seven_day.used_percentage : undefined;
  // resets_at 은 epoch **초** — Vibisual 의 RateLimitInfo.resetAt* 는 epoch ms 라 여기서 환산.
  const fiveReset = typeof rl?.five_hour?.resets_at === 'number' ? rl.five_hour.resets_at * 1000 : undefined;
  const sevenReset = typeof rl?.seven_day?.resets_at === 'number' ? rl.seven_day.resets_at * 1000 : undefined;

  // 먼저 화면부터 채운다 — 서버가 죽어 있어도 상태줄은 정상 동작해야 한다.
  const passthrough = readPassthroughCommand();
  const line = passthrough
    ? (await runPassthrough(passthrough, input)) ?? buildDefaultStatusLine(payload, five, seven)
    : buildDefaultStatusLine(payload, five, seven);
  process.stdout.write(line + '\n');

  if (five === undefined && seven === undefined) return; // Pro/Max 구독이 아니거나 첫 응답 전

  const prev = readStatusLineState();
  const changed = !prev || prev.five !== five || prev.seven !== seven;
  const stale = !prev || Date.now() - (prev.at ?? 0) >= STATUSLINE_MIN_POST_INTERVAL_MS;
  if (!changed && !stale) return;

  const body = {};
  if (five !== undefined) body.used5h = five;
  if (seven !== undefined) body.used7d = seven;
  if (fiveReset !== undefined) body.resetAt5h = fiveReset;
  if (sevenReset !== undefined) body.resetAt7d = sevenReset;

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 500);
    const res = await fetch(RATE_LIMITS_URL, {
      method: 'POST',
      headers: hookHeaders({}),
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch(() => null).finally(() => clearTimeout(tid));
    // 실제로 도달했을 때만 스로틀 상태를 기록한다. 앱이 꺼져 있던 동안의 실패를
    // "보냈다" 로 남기면 앱을 켠 뒤 최대 20초간 값이 비어 보인다.
    if (res && res.ok) writeStatusLineState({ five, seven, at: Date.now() });
  } catch {
    // 앱이 꺼져 있으면 조용히 통과 — 다음 렌더에서 다시 시도한다.
  }
}

/**
 * §4 v4.89 — `subagentStatusLine` 수집기.
 *
 * 새로고침 틱마다 보이는 서브에이전트 행 전체가 `tasks[]` 로 들어온다(행마다 status·model·
 * effort·tokenCount·contextWindowSize·cwd). 서브에이전트의 토큰 사용량이 **실시간으로** 들어오는
 * 유일한 경로라 그대로 서버에 넘긴다.
 *
 * **stdout 으로 아무것도 쓰지 않는다** — 행을 하나라도 출력하면 그 행의 렌더를 우리가 가져가게
 * 되는데, 기본 렌더를 바꿀 이유가 없다. 즉 화면은 그대로 두고 값만 걷는 순수 계측 경로다.
 */
async function runSubagentStatusLine(input) {
  if (!input) return;
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    return;
  }
  const tasks = Array.isArray(payload?.tasks) ? payload.tasks : null;
  if (!tasks || tasks.length === 0) return;

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 2000);
    await fetch(`${SUBAGENT_STATUSLINE_URL}`, {
      method: 'POST',
      headers: hookHeaders({}),
      body: JSON.stringify({ sessionId: payload.session_id, cwd: payload.cwd, tasks }),
      signal: controller.signal,
    }).catch(() => null).finally(() => clearTimeout(tid));
  } catch {
    // 앱이 꺼져 있으면 조용히 통과 — 다음 틱에서 다시 시도한다.
  }
}

async function main() {
  const input = await readStdin();

  // §4 v3.60 — statusLine 모드는 훅 이벤트가 아니라 세션 JSON 을 받는다. 완전히 별도 경로.
  if (process.argv.includes('--statusline')) {
    await runStatusLine(input);
    return;
  }

  // §4 v4.89 — 서브에이전트 행 수집기. 같은 이유로 별도 경로이며 stdout 을 쓰지 않는다.
  if (process.argv.includes('--subagent-statusline')) {
    await runSubagentStatusLine(input);
    return;
  }

  // stdin 비면 기본 continue
  if (input.length === 0) {
    process.stdout.write('{"continue":true}\n');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.stdout.write('{"continue":true}\n');
    return;
  }

  const isPreToolUse = payload.hook_event_name === 'PreToolUse';
  const isStop = payload.hook_event_name === 'Stop';
  const isPostToolUse = payload.hook_event_name === 'PostToolUse';
  // §5.11 v4.67 — 켠 플러그인의 집행(SSOT 규율 등)을 이 세션에도 싣는 유일한 통로.
  //   서버가 같은 `/api/hook-event` 응답에 additionalContext 를 실어 주므로 새 경로가 필요 없다.
  const isUserPromptSubmit = payload.hook_event_name === 'UserPromptSubmit';

  // §4 v2.64 — CMD(인터랙티브 터미널) 에이전트 소유자 태그. Vibisual 이 띄운 CMD 터미널의
  //   claude 는 env VIBISUAL_OWNER_AGENT_ID(=그 CMD 버블 agentId)를 물려받는다. 트래킹 본문에
  //   `_vibisualOwnerAgentId` 로 실으면 서버 processHookEvent 가 이 이벤트를 그 CMD 버블로
  //   귀속(별개 Hook 버블 차단). 권한 검사(permission-check/ask)는 건드리지 않는다 — 시각 귀속
  //   전용이며, 인터랙티브 세션 권한은 Claude Code 기본 정책(사람이 루프 안)에 맡긴다.
  const ownerAgentId = process.env.VIBISUAL_OWNER_AGENT_ID;
  // §4 v2.64 — termId 도 함께 실어 보낸다. 서버가 termId 별로 claude 대화 sessionId 를 기록해
  //   앱 재시작 후 `claude --resume` 으로 직전 대화를 이어받게 한다.
  const ownerTermId = process.env.VIBISUAL_OWNER_TERM_ID;
  const trackingBody = (ownerAgentId || ownerTermId)
    ? JSON.stringify({
        ...payload,
        ...(ownerAgentId ? { _vibisualOwnerAgentId: ownerAgentId } : {}),
        ...(ownerTermId ? { _vibisualOwnerTermId: ownerTermId } : {}),
      })
    : input;

  let response;
  if (isPreToolUse) {
    // §5.3 #12-2 v2.26 — AskUserQuestion 은 별도 broker 로 분기.
    if (payload.tool_name === 'AskUserQuestion') {
      response = await checkAskUserQuestion(payload);
    } else {
      // 동기 홀드 — 서버가 Vibisual 관할 + ask 모드면 사용자 승인까지 대기.
      response = await checkPermission(payload);
    }
  } else if (isUserPromptSubmit) {
    /*
     * §5.11 v4.67 — 프롬프트가 올라가기 전에 서버에 한 번 물어, 이 프로젝트에서 **켜 둔 플러그인의
     * 집행 블록**을 그 턴의 맥락에 얹는다. 그전까지 집행은 우리가 띄운 세션에만 실렸고, 사용자가
     * 자기 에디터에서 직접 돌리는 세션에는 한 글자도 안 갔다.
     *
     * 이 한 번만 stdout 을 **응답 뒤에** 쓴다(다른 이벤트는 먼저 쓰고 보낸다). 대신 짧게 끊고
     * (1초) 어떤 실패도 그냥 통과시킨다 — 서버가 꺼져 있어도 사용자의 프롬프트는 그대로 나가야 한다.
     */
    response = { continue: true };
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 1000);
      const res = await fetch(SERVER_URL, {
        method: 'POST',
        headers: hookHeaders({}),
        body: trackingBody,
        signal: controller.signal,
      }).catch(() => null).finally(() => clearTimeout(tid));
      const data = res && res.ok ? await res.json().catch(() => null) : null;
      const extra = data && data.hookSpecificOutput && data.hookSpecificOutput.additionalContext;
      if (typeof extra === 'string' && extra.trim() !== '') {
        response = {
          continue: true,
          hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: extra },
        };
      }
    } catch {
      // 서버 불통 — 종전과 똑같이 통과.
    }
    process.stdout.write(JSON.stringify(response) + '\n');
    return; // 트래킹 전송을 이미 마쳤다(위 fetch 가 그 역할을 겸한다).
  } else if (isPostToolUse && (payload.tool_name === 'Edit' || payload.tool_name === 'Write')) {
    // §5.10 — 편집 직후 그 파일의 실수/교훈 카드를 짧게 조회해 있으면 모델에 경고 주입.
    const warning = await checkBrainFileNotes(payload);
    response = warning
      ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: warning } }
      : { continue: true };
  } else {
    // 기존 fire-and-forget 경로 — 즉시 continue 응답.
    response = { continue: true };
  }
  // Write stdout BEFORE the tracking fetch so Claude Code unblocks immediately.
  process.stdout.write(JSON.stringify(response) + '\n');

  // 권한 결과와 별도로 버블맵 트래킹용 /api/hook-event 는 모든 이벤트에 대해 전송.
  //
  // Stop event: fire-and-forget — process exits after executeCommand() and the loopback
  // request completes fast enough on local network. Cancelled fetch is acceptable.
  //
  // Non-Stop non-PreToolUse: 500ms timeout is enough for loopback and avoids adding
  // 3s latency to every hook invocation. If the server is unreachable, we simply skip.
  if (isStop) {
    if (payload.session_id) {
      const cmd = await popCommand(payload.session_id);
      if (cmd) {
        executeCommand(payload.session_id, cmd.text);
      }
    }
    // Fire and forget — do not await.
    fetch(SERVER_URL, {
      method: 'POST',
      headers: hookHeaders({}),
      body: trackingBody,
    }).catch(() => {});
  } else if (!isPreToolUse) {
    // Non-PreToolUse, non-Stop: short await so the event reaches the server before exit.
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 500);
      await fetch(SERVER_URL, {
        method: 'POST',
        headers: hookHeaders({}),
        body: trackingBody,
        signal: controller.signal,
      }).catch(() => {}).finally(() => clearTimeout(tid));
    } catch {
      // ignore
    }
  } else {
    // PreToolUse path: tracking fetch runs after permission decision already written.
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 500);
      await fetch(SERVER_URL, {
        method: 'POST',
        headers: hookHeaders({}),
        body: trackingBody,
        signal: controller.signal,
      }).catch(() => {}).finally(() => clearTimeout(tid));
    } catch {
      // ignore
    }
  }
}

main().catch(() => {});
