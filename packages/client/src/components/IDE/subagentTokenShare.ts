/**
 * §5.5 #17-51 ⑤ — 중첩 서브에이전트 머리표의 토큰 몫. 값은 §3.6-2 `subagentStatusLine` 수집기의 **세션별 마지막 틱**이다
 * (사용자가 켠 사용량 수집기와 한 묶음 · 상태 줄이 그려지는 대화형 세션에서만 온다 — 헤드리스 탭은 비어 있다).
 * 머리표 이름(③ `description`)과 행의 글자가 **같을 때만** 맞춘다. 맞는 행이 없거나 둘 이상이면 적지 않는다(지어내지 않는다).
 */
import { useEffect, useRef, useState } from 'react';
import { SUBAGENT_TOKEN_SHARE_POLL_MS } from '@vibisual/shared';

/** 수집기 행에서 쓰는 칸만(서버 `SubagentStatusLineTask` 의 부분집합). */
export interface SubagentStatusRow {
  id: string;
  description?: string;
  label?: string;
  name?: string;
  tokenCount?: number;
  contextWindowSize?: number;
}

export interface SubagentTokenShare {
  tokens: number;
  /** 문맥 창 대비(0~100 정수). 창 크기를 모르면 없다. */
  percent?: number;
}

/** 머리표 이름 → 토큰 몫. 이름이 같은 행이 정확히 하나일 때만. */
export function matchSubagentTokenShares(
  names: ReadonlyMap<string, string>,
  rows: readonly SubagentStatusRow[],
): Map<string, SubagentTokenShare> {
  const out = new Map<string, SubagentTokenShare>();
  for (const [owner, name] of names) {
    const hits = rows.filter((r) => typeof r.tokenCount === 'number' && (r.description === name || r.label === name || r.name === name));
    if (hits.length !== 1) continue;
    const row = hits[0]!;
    const share: SubagentTokenShare = { tokens: row.tokenCount as number };
    if (typeof row.contextWindowSize === 'number' && row.contextWindowSize > 0) {
      share.percent = Math.min(100, Math.round(((row.tokenCount as number) / row.contextWindowSize) * 100));
    }
    out.set(owner, share);
  }
  return out;
}

/** 중첩 줄이 없을 때 돌려주는 같은 빈 배열(참조가 흔들리지 않게). */
const NO_ROWS: readonly SubagentStatusRow[] = [];

function sameRows(a: readonly SubagentStatusRow[], b: readonly SubagentStatusRow[]): boolean {
  return a.length === b.length && a.every((r, i) => r.id === b[i]?.id && r.tokenCount === b[i]?.tokenCount
    && r.description === b[i]?.description && r.contextWindowSize === b[i]?.contextWindowSize);
}

/**
 * 그 세션의 마지막 틱 행. `enabled` 동안만(그 세션에 중첩 줄이 그려질 때) 간격을 두고 다시 묻는다.
 * 같은 내용이면 같은 배열을 돌려준다(머리표가 매 틱 다시 그려지지 않게).
 */
export function useSubagentStatusRows(sessionId: string | undefined, enabled: boolean): readonly SubagentStatusRow[] {
  const [rows, setRows] = useState<readonly SubagentStatusRow[]>([]);
  const last = useRef<readonly SubagentStatusRow[]>([]);
  useEffect(() => {
    if (!enabled || !sessionId) return undefined;
    let alive = true;
    const load = (): void => {
      void fetch(`/api/subagent-statusline/${encodeURIComponent(sessionId)}`)
        .then(async (r) => (r.ok ? ((await r.json()) as { tasks?: SubagentStatusRow[] }) : { tasks: [] }))
        .then((res) => {
          if (!alive) return;
          const next = Array.isArray(res.tasks) ? res.tasks : [];
          if (sameRows(last.current, next)) return;
          last.current = next;
          setRows(next);
        })
        .catch(() => { /* 수집기가 꺼져 있거나 앱이 바쁘다 — 적지 않는다. */ });
    };
    load();
    const timer = setInterval(load, SUBAGENT_TOKEN_SHARE_POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [sessionId, enabled]);
  return enabled ? rows : NO_ROWS;
}
