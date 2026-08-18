/** §5.11 v3.93 — 지시 표류 등급 — 순수 함수(테스트 대상). */
import type { PluginTone } from '../sdk/index.js';

/**
 * 규칙이 없으면 표류를 논할 것도 없다(그냥 '규칙 없음'). 규칙이 있고 세션이 길어질수록 희석 위험이 커진다.
 */
export function defineDriftLevel(hasRules: boolean, turns: number): { key: string; tone: PluginTone } {
  if (!hasRules) return { key: 'noRules', tone: 'neutral' };
  if (turns >= 40) return { key: 'high', tone: 'warn' };
  if (turns >= 25) return { key: 'rising', tone: 'warn' };
  return { key: 'fresh', tone: 'good' };
}
