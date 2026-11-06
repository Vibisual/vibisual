import type { PlatformName } from '@vibisual/shared';

/**
 * 스폰 env 에서 `name` 을 걷는다(`keep` 이면 그 값만 정확한 이름으로). Windows 는 env 이름의 대소문자를 안 가려 `{ ...process.env }` 의
 * 소문자 이름도 자식이 같은 변수로 읽는다 — 정확한 이름만 지우면 구독 스폰이 몰래 키를 쓴다. mac·linux 는 정확한 이름만. 플랫폼은 인자로.
 * 의존이 없는 모듈로 둔다 — 코덱스 러너가 이것 하나 때문에 크레딧 서비스·AppState 를 끌어오지 않게.
 */
export function withOnlyEnvKey(env: NodeJS.ProcessEnv, name: string, platform: PlatformName, keep?: string): NodeJS.ProcessEnv {
  const upper = name.toUpperCase();
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    const same = platform === 'win32' ? k.toUpperCase() === upper : k === name;
    if (!same) out[k] = v;
  }
  if (keep !== undefined) out[name] = keep;
  return out;
}
