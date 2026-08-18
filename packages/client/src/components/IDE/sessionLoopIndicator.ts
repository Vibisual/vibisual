import type { SessionLoop } from '@vibisual/shared';

/**
 * §5.5 #17-11 ⑩ v5.02 — 세션 탭의 "이 탭이 지금 반복 중" 표시 산식 한 벌.
 *
 * 활동바 아이콘(⑥·⑨)은 **지금 열어 둔 탭 하나**만 비춘다. 다른 탭에 걸어 둔 루프가 도는지는
 * 그 탭으로 옮겨 보기 전에는 알 수 없었으므로, 탭 자신이 말하게 한다. 점등 근거는 활동바와
 * 똑같이 `enabled` 하나다(끄면 그 자리에서 사라진다).
 *
 * 왜 문자열로 뽑는가: `sessionLoops` 는 `applySessionLoops` 가 스냅샷마다 **통째로 새 객체**로
 * 갈아끼우는 슬라이스라(`structuralShare` 대상 밖) 스토어에서 그대로 구독하면 탭바가 매
 * 스냅샷 다시 그려진다. 켜진 루프만 정렬된 문자열 한 줄로 뽑아 프리미티브를 구독하면,
 * 값이 실제로 바뀔 때(루프를 켜고·끄고·회차가 올라갈 때)만 리렌더한다.
 */

/** 탭 하나에 띄울 루프 표시 — 아이콘 노출 여부(= 이 값의 존재)와 툴팁에 실을 진행. */
export interface LoopIndicator {
  /** 지금까지 완료한 회차 수. */
  completed: number;
  /** `mode==='count'` 의 목표 횟수. 무한 루프면 `null`. */
  total: number | null;
}

/** 한 줄(루프 하나) 안의 칸 구분자 — subAgentId 에는 쓰이지 않는 문자. */
const FIELD_SEP = '|';
/** 루프끼리의 구분자. */
const ROW_SEP = ';';
/** 한 줄의 칸 수(subId · completed · total). */
const FIELD_COUNT = 3;

/**
 * 켜져 있는 루프만 `subId|completed|total;…` 정렬 문자열로. 없으면 빈 문자열.
 * 무한 루프의 total 칸은 비운다(파싱 시 `null`).
 */
export function serializeRunningLoops(loops: Record<string, SessionLoop> | undefined): string {
  if (!loops) return '';
  const rows: string[] = [];
  for (const [subId, loop] of Object.entries(loops)) {
    if (!loop?.enabled) continue;
    // 활동바 배지와 같은 표기 규칙 — count 는 `완료/목표`(목표 미지정이면 0), 무한은 완료 회차만.
    const total = loop.mode === 'count' ? String(loop.total ?? 0) : '';
    rows.push(`${subId}${FIELD_SEP}${loop.completed}${FIELD_SEP}${total}`);
  }
  // 스냅샷마다 키 순서가 흔들려도 같은 문자열이 나오도록 정렬(불필요한 리렌더 방지).
  rows.sort();
  return rows.join(ROW_SEP);
}

/** 위 문자열을 탭 조회용 Map 으로 되돌린다. 깨진 줄은 조용히 건너뛴다(표시 전용). */
export function parseRunningLoops(key: string): Map<string, LoopIndicator> {
  const map = new Map<string, LoopIndicator>();
  if (!key) return map;
  for (const row of key.split(ROW_SEP)) {
    if (!row) continue;
    const parts = row.split(FIELD_SEP);
    if (parts.length !== FIELD_COUNT) continue;
    const [subId, completedRaw, totalRaw] = parts;
    if (!subId) continue;
    const completed = Number.parseInt(completedRaw ?? '', 10);
    const total = totalRaw ? Number.parseInt(totalRaw, 10) : null;
    map.set(subId, {
      completed: Number.isFinite(completed) ? completed : 0,
      total: total !== null && Number.isFinite(total) ? total : null,
    });
  }
  return map;
}
