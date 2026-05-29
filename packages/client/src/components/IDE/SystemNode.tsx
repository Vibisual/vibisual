/**
 * SystemNode — SDK system 메시지 subtype(task_started 등)을 VS Code 확장처럼
 * 왼쪽 타임라인 레일의 "노드 점" 디자인으로 표현. 글자는 평소 숨기고 hover 시 라벨을 띄운다.
 *
 * 서버(parseStreamLine)가 `[subtype]` 형태로 보내는 system 이벤트를 날 텍스트 대신 노드로 렌더한다.
 * 권한 승인 결정 같은 임의 본문(emitSystemMessage)이나 짝 없는 tool_result(`[ToolName] ...`)는
 * `[word]` 단독 패턴에 매칭되지 않으므로 parseSystemSubtype 가 null 을 반환해 호출부가 텍스트로 폴백한다.
 */

/** `[task_started]` 처럼 소문자 subtype 단독 패턴이면 subtype 문자열을, 아니면 null. */
export function parseSystemSubtype(content: string): string | null {
  const m = /^\[([a-z0-9_]+)\]$/.exec(content.trim());
  return m ? m[1]! : null;
}

/** 자주 보이는 subtype 의 친화적 라벨. 미지의 subtype 은 underscore→공백 + 단어 첫 글자 대문자화. */
const KNOWN_LABELS: Record<string, string> = {
  task_started: 'Task started',
  task_completed: 'Task completed',
  task_notification: 'Task notification',
  compact_boundary: 'Context compacted',
};

function humanizeSubtype(subtype: string): string {
  return KNOWN_LABELS[subtype] ?? subtype.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** 왼쪽 레일 + 노드 점. 연속 노드는 세로 라인이 맞닿아 레일처럼 이어진다. */
export function SystemNode({ subtype }: { subtype: string }): React.JSX.Element {
  const label = humanizeSubtype(subtype);
  return (
    <div className="group/sysnode relative flex min-h-[22px] items-stretch pl-3">
      {/* 레일(세로 라인) + 노드 점 */}
      <span className="relative flex w-6 flex-shrink-0 items-center justify-center">
        <span
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gray-700/45"
          aria-hidden="true"
        />
        <span
          className="relative z-10 h-2 w-2 rounded-full border border-gray-600 bg-gray-900 transition-colors group-hover/sysnode:border-violet-400 group-hover/sysnode:bg-violet-500/50"
          aria-hidden="true"
        />
      </span>
      {/* hover 라벨 — absolute 라 레이아웃을 밀지 않음 */}
      <span className="pointer-events-none absolute left-10 top-1/2 z-20 -translate-y-1/2 whitespace-nowrap rounded border border-gray-700/60 bg-gray-800/95 px-1.5 py-0.5 text-[10px] font-medium text-gray-300 opacity-0 shadow-md transition-opacity group-hover/sysnode:opacity-100">
        {label}
      </span>
    </div>
  );
}
