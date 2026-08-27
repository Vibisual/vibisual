import type { AuditEntry, AuditRiskKind, ProjectAuditLog } from '@vibisual/shared';

// SCENARIO.md §5.22 — 권한·감사 경계 공용 헬퍼.
//
// 헤더 방패 필(Layout/AuditPill), 타임라인 팝업(Panel/AuditTimelinePopup), 승인 카드
// (PermissionPrompt/PermissionPromptStack)가 **같은 함수**로 위험 색과 라벨 키를 정한다.
// 같은 위험이 세 화면에서 다른 색으로 보이면 그 즉시 믿을 수 없는 화면이 된다.
//
// 여기서 위험을 **다시 판정하지 않는다** — 판정은 shared `classifyToolRisk` 한 곳이고(§3.1)
// 이 파일이 하는 일은 "이미 판정된 값을 어느 색으로 그릴까" 하나뿐이다.

/** 지금 보고 있는 프로젝트의 원장. 없으면 undefined(빈 원장을 지어내지 않는다). */
export function findAuditLog(
  logs: readonly ProjectAuditLog[],
  projectName: string | null,
): ProjectAuditLog | undefined {
  if (!projectName) return undefined;
  return logs.find((l) => l.projectName === projectName);
}

/**
 * 위험 배지 색. 넷을 서로 다른 색으로 두어 배지만 보고도 종류가 갈린다.
 *
 * `outside` 에 초록계(emerald·teal·lime)를 쓰지 않는다 — 같은 줄에 앉는 결정 배지의 "허용"이
 * emerald 라 위험 배지가 **안전해 보이는** 역효과가 난다. violet 도 피한다("먼저 물었다" 배지).
 */
export function riskToneClass(kind: AuditRiskKind): string {
  switch (kind) {
    case 'delete': return 'border-rose-500/50 bg-rose-500/15 text-rose-300';
    case 'network': return 'border-sky-500/50 bg-sky-500/15 text-sky-300';
    case 'outside': return 'border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-300';
    default: return 'border-amber-500/50 bg-amber-500/15 text-amber-300';
  }
}

/** 결정 배지 색. 결정이 없는 줄(묻지 않고 지나간 호출)은 아예 배지를 그리지 않는다. */
export function decisionToneClass(decision: 'allow' | 'deny'): string {
  return decision === 'allow'
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
    : 'border-red-500/50 bg-red-500/15 text-red-300';
}

/** 위험 종류 → i18n 키. 라벨 문자열을 컴포넌트마다 새로 적지 않게 한다. */
export function riskLabelKey(kind: AuditRiskKind): string {
  return `panel.audit.risk.${kind}`;
}

/** 필터 탭 판정 — 서버가 준 줄을 거르기만 하고 다시 세지 않는다. */
export function matchesAuditFilter(entry: AuditEntry, filter: 'all' | 'risky' | 'denied'): boolean {
  if (filter === 'risky') return entry.riskKinds.length > 0;
  if (filter === 'denied') return entry.decision === 'deny';
  return true;
}

/** 타임라인 시각 표기(오늘은 시:분:초, 그 전은 날짜까지). 표시 전용. */
export function formatAuditTime(at: number, now: number = Date.now()): string {
  const d = new Date(at);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}:${ss}`;
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${mon}-${day} ${hh}:${mm}`;
}
