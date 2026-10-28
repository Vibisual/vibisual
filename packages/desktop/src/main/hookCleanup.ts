// SCENARIO.md §3.6 「수명」 · §5.7 #24-3 ⑤ — 제거기의 정리 모드.
// Windows 제거기(`build/installer.nsh` 의 `customUnInit`)가 파일을 지우기 전에 `Vibisual.exe --vibisual-remove-hooks` 를 한 번 부른다.
// 시작 진입점(`bootstrap.ts`)이 그 인자를 보면 잠금·스플래시·본체·서버 없이 이 모듈만 동적으로 읽는다(별도 청크).
// 저장된 포트(`hook-listener.json`)를 가리키는 우리 훅을 모든 설정 홈에서 걷고, 사용량 수집기 상태 줄을 되돌리고, 코덱스 전역 훅도
// 걷는다 — 앱이 사라지면 훅이 부를 `handler.mjs` 도 사라진다. 끌 때 이미 걷었으면 파일을 쓰지 않는다.

import { join } from 'node:path';
// 서버 코어 전체(`@vibisual/server` — 모듈 200여 개)가 아니라 걷는 모듈만 읽는다(20개 안팎) — 제거기 안에서 빨리 끝나고,
//   걷기와 상관없는 모듈의 초기화가 걷기를 막지 않게.
import { removeVibisualHooksForUninstall, type HookRetireSummary } from '@vibisual/server/hook-lifetime';
import { loadHookIdentity } from './hookIdentity';

export function removeHooksForUninstall(): HookRetireSummary {
  // 저장된 포트가 없으면(한 번도 안 켰다) 우리 블록 전부를 걷는다 — 앱이 사라지는 자리다.
  const { preferredPort } = loadHookIdentity();
  const port = preferredPort > 0 ? preferredPort : null;
  // 본체(`index.ts`)와 같은 규칙: out/main/<청크> 기준 ../hooks/handler.mjs (코덱스 훅 명령이 이 경로를 담고 있다).
  const handlerPath = join(__dirname, '..', 'hooks', 'handler.mjs');
  return removeVibisualHooksForUninstall(port, handlerPath);
}
