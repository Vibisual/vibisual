import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import en from '../../i18n/locales/en.json';
import ko from '../../i18n/locales/ko.json';
import { TransportRecoveryLine } from './TransportRecoveryLine.js';
import { applyStreamDensity } from './streamDensity.js';
import type { StreamGroup, StreamSystem } from './streamItems.js';

let locale: 'en' | 'ko' = 'en';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params: Record<string, string | number> = {}): string => {
      const labels = (locale === 'ko' ? ko : en).ide.transportRecovery;
      const label = labels[key.replace('ide.transportRecovery.', '') as keyof typeof labels];
      return label.replace(/{{(\w+)}}/g, (_match: string, variable: string) => String(params[variable]));
    },
  }),
}));

const notice: StreamSystem = {
  kind: 'system', id: 'notice', timestamp: 2,
  content: 'Reconnecting... 2/5 (stream disconnected before completion)',
  transportRecovery: { notice: { kind: 'reconnecting', attempt: 2, maxAttempts: 5 }, state: 'recovering' },
};

function render(item: StreamSystem, sessionLabel?: string): string {
  return renderToStaticMarkup(<TransportRecoveryLine
    recovery={item.transportRecovery!} content={item.content} sessionLabel={sessionLabel}
  />);
}

describe('connection recovery status', () => {
  it('shows retry progress and preserves the diagnostic without a failure label', () => {
    locale = 'en';
    const html = render(notice, 'Session A');
    expect(html).toContain('Reconnecting… 2/5');
    expect(html).toContain('role="status"');
    expect(html).toContain('Session A');
    expect(html).toContain(`title="${notice.content}"`);
    expect(html).not.toContain(en.ide.cmdError.unknown);
    expect(html).not.toContain('text-red');
  });

  it('renders fallback, resumed work and an ended attempt with distinct meanings in Korean', () => {
    locale = 'ko';
    const fallback = { ...notice, transportRecovery: { notice: { kind: 'fallback' as const }, state: 'recovering' as const } };
    expect(render(fallback)).toContain('다른 방식으로 다시 연결하는 중…');
    const resumed = { ...fallback, transportRecovery: { ...fallback.transportRecovery, state: 'resumed' as const } };
    expect(render(resumed)).toContain('연결 복구됨 · 작업 재개');
    expect(render(resumed)).not.toContain('role="status"');
    const ended = { ...fallback, transportRecovery: { ...fallback.transportRecovery, state: 'ended' as const } };
    expect(render(ended)).toContain('연결 복구 시도 기록');
    expect(render(ended)).not.toContain('연결 복구됨');
    expect(render(ended)).not.toContain(ko.ide.cmdError.unknown);
  });

  it.each(['raw', 'standard', 'compact'] as const)('keeps recovery visible between tool calls in %s density', (density) => {
    const tool = (id: string): StreamGroup => ({
      kind: 'tool', id, toolName: 'Bash', input: 'echo ok', output: 'ok', timestamp: 1, isActive: false,
    });
    const items = applyStreamDensity([tool('before'), notice, tool('after')], density);
    expect(items.find(item => item.id === notice.id)).toBe(notice);
    expect(items.filter(item => item.kind === 'error')).toHaveLength(0);
  });
});
