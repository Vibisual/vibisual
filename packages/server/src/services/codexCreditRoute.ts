import { OPENAI_CREDIT_KEY_ENV, openaiCreditConfigArgs, type PlatformName } from '@vibisual/shared';
import { withOnlyEnvKey } from './envKey.js';

/**
 * §4 OpenAI 비즈니스 크레딧 — 코덱스 턴 하나의 결제 경로. 두 전송(exec · app-server)이 같은 규칙으로 싣도록 여기 한 곳에 둔다.
 * `credits` 면 사용자 정의 제공자 덮어쓰기 + 그 env 하나에 키, `subscription` 이면 그 env 이름을 걷는다(사용자 셸에 같은 이름이 있어도 안 쓰게).
 * 경로가 없으면(기능 꺼짐) 아무것도 바꾸지 않는다.
 */
export type CodexCreditRoute = { route: 'credits'; key: string } | { route: 'subscription' };

export function codexCreditConfigArgs(credit: CodexCreditRoute | undefined): string[] {
  return credit?.route === 'credits' ? openaiCreditConfigArgs() : [];
}

export function codexCreditEnv(env: NodeJS.ProcessEnv, credit: CodexCreditRoute | undefined, platform: PlatformName): NodeJS.ProcessEnv {
  if (!credit) return env;
  return withOnlyEnvKey(env, OPENAI_CREDIT_KEY_ENV, platform, credit.route === 'credits' ? credit.key : undefined);
}
