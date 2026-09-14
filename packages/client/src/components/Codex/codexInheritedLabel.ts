import type { TranslateFn } from '../../formatSince.js';
import type { CodexEffectiveConfig, CodexModelEntry } from '@vibisual/shared';
import { resolveCodexInherited, type CodexInheritedField, type CodexInheritedValue } from './codexModelEntry.js';

/**
 * §5.25 (G-2) — 비워 둔 칸(`''`)의 선택지 한 줄. 에이전트 설정 창과 설정 창(Agent 기본값)이 **같은
 * 함수**로 적는다 — 두 곳이 따로 적으면 한쪽만 "엔진 기본값" 같은 말로 되돌아가는 날이 온다.
 *
 * 라벨은 `값 (출처)`, 설명 줄은 그 값을 읽은 파일 경로나 근거다. 값의 이름은 같은 칸의 다른 선택지와
 * 같은 번역을 쓴다(목록에서 "캐시 검색"을 고른 것과 비워 둔 것이 같은 말로 보여야 비교가 된다).
 */

/** 칸 → 그 칸의 선택지 번역 묶음. 강도는 모델이 신고한 단계 이름을 그대로 쓴다. */
const VALUE_KEY: Record<CodexInheritedField, string | null> = {
  reasoningEffort: null,
  modelVerbosity: 'verbosity',
  webSearch: 'webSearch',
  networkAccess: 'network',
};

export function codexInheritedValueText(t: TranslateFn, field: CodexInheritedField, value: string): string {
  const group = VALUE_KEY[field];
  return group ? t(`panel.agentConfig.codex.${group}.${value}`, { defaultValue: value }) : value;
}

export function codexInheritedOption(
  t: TranslateFn,
  field: CodexInheritedField,
  resolved: CodexInheritedValue,
): { label: string; description: string } {
  switch (resolved.kind) {
    case 'layer': {
      const value = codexInheritedValueText(t, field, resolved.value);
      const source = resolved.source === 'profile'
        ? t('panel.agentConfig.codex.source.profile', { name: resolved.profile ?? '' })
        : t(`panel.agentConfig.codex.source.${resolved.source}`);
      return {
        label: t('panel.agentConfig.effective.resolved', { value, source }),
        description: resolved.source === 'profile'
          ? t('panel.agentConfig.codex.sourceTip.profile', { path: resolved.path, name: resolved.profile ?? '' })
          : t('panel.agentConfig.codex.sourceTip.layer', { path: resolved.path }),
      };
    }
    case 'model':
    case 'builtin':
    case 'delegation':
      return {
        label: t('panel.agentConfig.effective.resolved', {
          value: codexInheritedValueText(t, field, resolved.value),
          source: t(`panel.agentConfig.codex.source.${resolved.kind}`),
        }),
        description: t(`panel.agentConfig.codex.sourceTip.${resolved.kind}`),
      };
    case 'unsupported':
      return { label: t('panel.agentConfig.codex.unsupported'), description: t('panel.agentConfig.codex.unsupportedTip') };
    case 'loading':
      return { label: t('panel.options.account.checking'), description: '' };
    case 'unresolved':
      return { label: t('panel.agentConfig.effective.unknown'), description: t('panel.agentConfig.codex.unresolvedTip') };
  }
}

/** 조회 상태(`useCodexEffectiveConfig`)까지 받아 한 줄로 — 실패는 내장값이 아니라 "읽지 못함"이다. */
export function codexInheritedOptionFor(
  t: TranslateFn,
  field: CodexInheritedField,
  input: {
    config: CodexEffectiveConfig | 'failed' | null;
    model: CodexModelEntry | undefined;
    modelsLoaded: boolean;
    sandbox: string;
    delegation?: boolean;
  },
): { label: string; description: string } {
  return codexInheritedOption(t, field, input.config === 'failed'
    ? { kind: 'unresolved' }
    : resolveCodexInherited(field, { ...input, config: input.config }));
}
