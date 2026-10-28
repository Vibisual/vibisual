/** §5.11 — 도구 오·남용 패턴 판정(순수 함수). 실행된 명령에서 되돌릴 수 없는 형태를 찾는다 — 표시일 뿐 막지 않는다(막는 자리는 승인 팝업). */
import type { BashEntry } from '@vibisual/shared';

export type MisuseKind = 'destructive' | 'forcePush' | 'remoteExec' | 'permission' | 'historyRewrite';

export interface MisuseHit {
  kind: MisuseKind;
  command: string;
  timestamp: number;
}

/**
 * 패턴은 좁게 잡는다 — 넓게 잡으면 평범한 명령이 매번 걸려 경고가 배경이 된다.
 * 각 패턴은 "되돌릴 수 없거나, 외부 코드를 그대로 실행하거나, 이력을 다시 쓰는" 것만 노린다.
 */
const PATTERNS: { kind: MisuseKind; re: RegExp }[] = [
  // rm -rf / rmdir /s — 경로가 무엇이든 되돌릴 수 없다.
  { kind: 'destructive', re: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b|\brmdir\s+\/s\b|\bdel\s+\/[sq]\b/i },
  // git push --force / -f, reset --hard — 남의 이력을 덮는다.
  { kind: 'forcePush', re: /\bgit\s+push\b[^|;]*\s(--force\b|-f\b)/i },
  { kind: 'historyRewrite', re: /\bgit\s+(reset\s+--hard|filter-branch|rebase\s+.*--force)\b/i },
  // curl|wget 로 받아 곧장 셸에 먹이는 형태 — 외부 코드를 그대로 실행한다.
  { kind: 'remoteExec', re: /\b(curl|wget|iwr|Invoke-WebRequest)\b[^|;]*\|\s*(sudo\s+)?(ba|z|fi|)sh\b/i },
  // 권한을 통째로 여는 형태.
  { kind: 'permission', re: /\bchmod\s+(-R\s+)?777\b|\bicacls\b[^|;]*\/grant[^|;]*Everyone/i },
];

export function findMisuse(entries: readonly BashEntry[] | undefined): MisuseHit[] {
  const hits: MisuseHit[] = [];
  for (const entry of entries ?? []) {
    const command = entry.command ?? '';
    if (!command) continue;
    for (const { kind, re } of PATTERNS) {
      if (re.test(command)) {
        hits.push({ kind, command: command.slice(0, 160), timestamp: entry.timestamp });
        break; // 한 명령은 한 번만 센다 — 같은 줄이 두 패턴에 걸려도 중복 경고하지 않는다.
      }
    }
  }
  return hits;
}
