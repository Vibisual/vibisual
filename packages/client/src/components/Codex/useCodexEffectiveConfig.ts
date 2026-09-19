import { useEffect, useState } from 'react';
import type { CodexEffectiveConfig } from '@vibisual/shared';

/**
 * §5.25 (G-2) — 코덱스가 겹쳐 읽을 설정 파일들(`GET /api/codex-config`). 읽기만 한다.
 *
 * `agentId` 가 있으면 그 버블의 프로젝트 폴더, 없으면 지금 프로젝트 폴더 기준이다(새 에이전트용 설정 창).
 * 묻는 중이면 `null`, 실패하면 `'failed'` — 실패를 내장값으로 채우면 파일에 적힌 값을 덮어 거짓말이 된다.
 */
export function useCodexEffectiveConfig(enabled: boolean, agentId?: string, projectPath?: string): CodexEffectiveConfig | 'failed' | null {
  const [state, setState] = useState<{ key: string; value: CodexEffectiveConfig | 'failed' } | null>(null);
  const query = new URLSearchParams();
  if (agentId) query.set('agentId', agentId);
  else if (projectPath) query.set('projectPath', projectPath);
  else if (projectPath === '') query.set('scope', 'global');
  const key = query.toString();
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch(key ? `/api/codex-config?${key}` : '/api/codex-config')
      .then((r) => (r.ok ? (r.json() as Promise<CodexEffectiveConfig>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => { if (alive) setState({ key, value: Array.isArray(data?.layers) ? data : 'failed' }); })
      .catch(() => { if (alive) setState({ key, value: 'failed' }); });
    return () => { alive = false; };
  }, [enabled, key]);
  return enabled && state?.key === key ? state.value : null;
}
