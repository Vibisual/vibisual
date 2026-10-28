/** §5.11 — 폭발 반경 판정(공용, 순수 함수). `containment`·`owasp-asi` 도 쓰므로 플러그인 폴더가 아니라 SDK 에 둔다(자립 규약). */
import type { AgentConfig } from '@vibisual/shared';
import { effectiveTools } from './trifecta.js';

export interface BlastRadiusVerdict {
  canRead: boolean;
  canWrite: boolean;
  canExecute: boolean;
  canSend: boolean;
  isolated: boolean;
  /** 0~4. 격리면 1 깎는다(0 미만으로는 안 내려간다). */
  score: number;
  level: 'small' | 'medium' | 'large';
}

export function judgeBlastRadius(config: AgentConfig | undefined): BlastRadiusVerdict {
  const tools = effectiveTools(config);
  const canRead = ['Read', 'Grep', 'Glob'].some((t) => tools.has(t));
  const canWrite = ['Write', 'Edit', 'NotebookEdit'].some((t) => tools.has(t));
  const canExecute = tools.has('Bash');
  const canSend = ['WebFetch', 'Bash'].some((t) => tools.has(t));
  const isolated = config?.isolation === 'worktree';

  const raw = [canRead, canWrite, canExecute, canSend].filter(Boolean).length;
  const score = Math.max(0, raw - (isolated ? 1 : 0));
  const level: BlastRadiusVerdict['level'] = score <= 1 ? 'small' : score <= 2 ? 'medium' : 'large';

  return { canRead, canWrite, canExecute, canSend, isolated, score, level };
}
