/**
 * §5.11 v4.01 — 데이터 유출(Data Exfiltration) 경로 판정 — 순수 함수.
 *
 * 에이전트 시대에는 "외부에 보낸다"의 정의가 넓어졌다 — 커밋·푸시·API 호출·이미지 URL 요청·웹훅 전부다.
 * 그리고 **외부로 나간 내용은 나중에 지워도 캐시와 색인에 남는다**. 되돌릴 수 없는 행동이라, 사후 대응이
 * 성립하지 않는 몇 안 되는 범주다.
 *
 * 여기서는 실행된 명령에서 바깥으로 나가는 형태를 찾는다. 내용을 검사하지는 않는다 —
 * 무엇이 나갔는지가 아니라 **나갈 수 있는 통로가 실제로 쓰였는지**를 보여주는 카드다.
 */
import type { BashEntry } from '@vibisual/shared';

export type EgressKind = 'push' | 'upload' | 'webhook' | 'copy' | 'secretsRead';

export interface EgressHit {
  kind: EgressKind;
  command: string;
  timestamp: number;
}

const PATTERNS: { kind: EgressKind; re: RegExp }[] = [
  { kind: 'push', re: /\bgit\s+push\b/i },
  // 본문을 실어 보내는 형태만 — 단순 GET 은 유출 통로로 세지 않는다.
  { kind: 'upload', re: /\bcurl\b[^|;]*(-d|--data|--data-binary|-F\b|--upload-file|-T\b)/i },
  { kind: 'webhook', re: /\b(hooks\.slack\.com|discord\.com\/api\/webhooks|api\.telegram\.org)\b/i },
  { kind: 'copy', re: /\b(scp|rsync|rclone)\b[^|;]*\s\S+:/i },
  // 비밀이 담긴 자리를 읽어 파이프로 넘기는 형태.
  { kind: 'secretsRead', re: /\b(cat|type)\b[^|;]*(\.env|id_rsa|credentials|\.npmrc|\.pypirc)\b/i },
];

export function findEgress(entries: readonly BashEntry[] | undefined): EgressHit[] {
  const hits: EgressHit[] = [];
  for (const entry of entries ?? []) {
    const command = entry.command ?? '';
    if (!command) continue;
    for (const { kind, re } of PATTERNS) {
      if (re.test(command)) {
        hits.push({ kind, command: command.slice(0, 160), timestamp: entry.timestamp });
        break;
      }
    }
  }
  return hits;
}
