/**
 * §5.11 v4.58 — 폭발 반경 판정 (공용).
 *
 * 원래 `blast-radius/index.tsx` 안에 있었고 `containment`·`owasp-asi` 가 **그 플러그인 폴더를 직접
 * import** 하고 있었다. 플러그인 폴더를 통째로 복사해 다른 앱에 붙일 수 있어야 한다는 규약(§5.11 v4.58)
 * 에서 그것은 위반이다 — 한 폴더를 가져가면 남의 폴더가 딸려 온다. 여러 플러그인이 함께 쓰는 판정은
 * 플러그인이 아니라 **SDK** 에 있어야 한다.
 *
 * 판정 내용은 옮기기 전과 같다(순수 함수·부작용 0).
 */
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
