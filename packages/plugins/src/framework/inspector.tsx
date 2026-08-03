/**
 * §5.11 v3.93 — 점검 카드(Inspector) 골격.
 *
 * 카탈로그를 어휘 전체로 넓히기로 한 이상, **플러그인 하나의 제작 비용**이 곧 전체 진도를 결정한다.
 * 지금까지 플러그인마다 손으로 쓰던 것(배지 + 섹션 + 등급 + 행 목록)은 형태가 거의 같았으므로,
 * 여기서 한 번만 만들고 각 플러그인은 **선언(spec)** 만 남긴다 — 한 플러그인이 20~40줄로 줄어든다.
 *
 * 규율은 그대로 가져간다.
 * - 표시 전용. 설정을 바꾸지 않는다.
 * - 배지는 `badge.match` 가 true 일 때만 렌더한다 — 상시 점등은 신호를 죽인다.
 * - 데이터는 `needs` 로 선언한 것만 받는다.
 * - 문자열은 전부 `panel.plugins.<camelId>.*` 한 지붕 아래(§5.11 키 규약).
 */
import type { ReactNode } from 'react';
import type { PluginCategory } from '@vibisual/shared';
import type { PluginBubbleContext, PluginClientModule, PluginDataNeed, PluginManifest } from '../types.js';
import { PluginSection, PluginRow, PluginBadgePill, type PluginTone } from '../ui/kit.js';

export interface InspectorCheck {
  /** i18n: `panel.plugins.<camelId>.check.<key>` */
  key: string;
  value: (ctx: PluginBubbleContext) => string;
  tone?: (ctx: PluginBubbleContext) => PluginTone;
  /** 이미 번역된 문장을 돌려준다(플러그인이 ctx.t 로 만든다). */
  hint?: (ctx: PluginBubbleContext) => string | undefined;
}

export interface InspectorSpec {
  /** kebab-case 플러그인 id. */
  id: string;
  /** camelCase i18n 키 세그먼트. */
  i18nKey: string;
  name: string;
  category: PluginCategory;
  needs?: PluginDataNeed[];
  /** 이 버블에 붙을지. 기본값 = 에이전트 버블이며 설정이 있는 것. */
  match?: (ctx: PluginBubbleContext) => boolean;
  /** 등급 — i18n: `.level.<key>` */
  status: (ctx: PluginBubbleContext) => { key: string; tone: PluginTone };
  checks: InspectorCheck[];
  /** 섹션 하단 한 줄 — i18n 키를 돌려준다(`.` 로 시작하면 플러그인 지붕 아래로 해석). */
  noteKey?: (ctx: PluginBubbleContext) => string;
  badge?: {
    /** 문턱을 넘을 때만 true. 없으면 항상 표시. */
    match?: (ctx: PluginBubbleContext) => boolean;
    text: (ctx: PluginBubbleContext) => string;
    icon: ReactNode;
  };
}

function defaultMatch(ctx: PluginBubbleContext): boolean {
  return ctx.bubbleType === 'agent' && ctx.agentConfig !== undefined;
}

export function defineInspector(spec: InspectorSpec): { manifest: PluginManifest; client: PluginClientModule } {
  const K = `panel.plugins.${spec.i18nKey}`;
  const resolveKey = (raw: string): string => (raw.startsWith('.') ? `${K}${raw}` : raw);
  const match = spec.match ?? defaultMatch;

  const manifest: PluginManifest = {
    id: spec.id,
    name: spec.name,
    version: '1.0.0',
    category: spec.category,
    descriptionKey: `${K}.desc`,
    enabledByDefault: false,
    contributes: spec.badge ? ['bubbleBadge', 'panelSection'] : ['panelSection'],
    clientOnly: true,
  };

  function Section({ ctx }: { ctx: PluginBubbleContext }): React.JSX.Element {
    const { t } = ctx;
    const status = spec.status(ctx);
    return (
      <PluginSection
        title={t(`${K}.heading`)}
        status={t(`${K}.level.${status.key}`)}
        tone={status.tone}
        note={spec.noteKey ? t(resolveKey(spec.noteKey(ctx))) : t(`${K}.displayOnly`)}
      >
        {spec.checks.map((c) => (
          <PluginRow
            key={c.key}
            label={t(`${K}.check.${c.key}`)}
            value={c.value(ctx)}
            tone={c.tone?.(ctx) ?? 'neutral'}
            hint={c.hint?.(ctx)}
          />
        ))}
      </PluginSection>
    );
  }

  function Badge({ ctx }: { ctx: PluginBubbleContext }): React.JSX.Element {
    const status = spec.status(ctx);
    return (
      <PluginBadgePill tone={status.tone} title={`${ctx.t(`${K}.heading`)} · ${ctx.t(`${K}.level.${status.key}`)}`}>
        {spec.badge?.icon}
        {spec.badge?.text(ctx)}
      </PluginBadgePill>
    );
  }

  const client: PluginClientModule = {
    manifest,
    // 창이 "켜면 뭘 보게 되는가"를 그릴 때 쓴다 — 실제로 그리는 행을 그대로 넘긴다.
    usage: {
      i18nKey: spec.i18nKey,
      checkKeys: spec.checks.map((c) => `check.${c.key}`),
      badgeIsConditional: Boolean(spec.badge?.match),
    },
    ...(spec.needs ? { needs: spec.needs } : {}),
    ...(spec.badge
      ? {
          bubbleBadges: [
            {
              key: spec.i18nKey,
              match: (ctx) => match(ctx) && (spec.badge?.match?.(ctx) ?? true),
              render: (ctx) => <Badge ctx={ctx} />,
            },
          ],
        }
      : {}),
    panelSections: [
      {
        key: spec.i18nKey,
        match,
        // 등급 계산은 순수 함수라 렌더 없이 부를 수 있다 — 호스트의 정렬·접힘이 여기에 기댄다.
        severity: (ctx) => spec.status(ctx).tone,
        render: (ctx) => <Section ctx={ctx} />,
      },
    ],
  };

  return { manifest, client };
}

/** 여러 플러그인이 공유하는 작은 글리프들 — 배지마다 SVG 를 새로 그리지 않게. */
export const ICONS = {
  shield: (
    <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z" />
    </svg>
  ),
  hand: (
    <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 12V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6v-3a1.5 1.5 0 0 1 3 0" />
    </svg>
  ),
  gauge: (
    <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 18a8 8 0 1 1 16 0" /><path d="M12 18l4-5" />
    </svg>
  ),
  brain: (
    <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8V15a4 4 0 0 0 4 4h1V4H9zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8V15a4 4 0 0 1-4 4h-1V4h1z" />
    </svg>
  ),
  route: (
    <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H14a4 4 0 0 0 0-8H9" />
    </svg>
  ),
  log: (
    <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4h11l3 3v13H5z" /><path d="M8 10h8M8 14h8" />
    </svg>
  ),
} as const;
