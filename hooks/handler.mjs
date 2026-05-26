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

async function main() {
  const input = await readStdin();

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

  let response;
  if (isPreToolUse) {
    // §5.3 #12-2 v2.26 — AskUserQuestion 은 별도 broker 로 분기.
    if (payload.tool_name === 'AskUserQuestion') {
      response = await checkAskUserQuestion(payload);
    } else {
      // 동기 홀드 — 서버가 Vibisual 관할 + ask 모드면 사용자 승인까지 대기.
      response = await checkPermission(payload);
    }
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
      body: input,
    }).catch(() => {});
  } else if (!isPreToolUse) {
    // Non-PreToolUse, non-Stop: short await so the event reaches the server before exit.
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 500);
      await fetch(SERVER_URL, {
        method: 'POST',
        headers: hookHeaders({}),
        body: input,
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
        body: input,
        signal: controller.signal,
      }).catch(() => {}).finally(() => clearTimeout(tid));
    } catch {
      // ignore
    }
  }
}

main().catch(() => {});
