/**
 * §5.11 v3.88 — 플러그인 공용 UI 조각.
 *
 * 플러그인이 늘어날수록 "패널 섹션 껍데기"와 "버블 배지 껍데기"가 반복된다. 여기서 한 번만 정하고
 * 각 플러그인은 내용만 채운다 — 생김새가 제각각이면 카탈로그가 커질수록 화면이 누더기가 된다.
 */
import type { ReactNode } from 'react';

export type PluginTone = 'neutral' | 'good' | 'warn' | 'bad';

const TONE_TEXT: Record<PluginTone, string> = {
  neutral: 'text-gray-400',
  good: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-red-300',
};

const TONE_DOT: Record<PluginTone, string> = {
  neutral: 'bg-white/20',
  good: 'bg-emerald-400',
  warn: 'bg-amber-400',
  bad: 'bg-red-400',
};

const TONE_RING: Record<PluginTone, string> = {
  neutral: 'ring-white/15',
  good: 'ring-emerald-400/40',
  warn: 'ring-amber-400/50',
  bad: 'ring-red-400/60',
};

/** DetailPanel 섹션 껍데기 — 제목 + 우측 상태 라벨 + 본문. */
export function PluginSection(
  { title, status, tone = 'neutral', children, note }:
  { title: string; status?: string; tone?: PluginTone; children: ReactNode; note?: string },
): React.JSX.Element {
  return (
    <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title}</span>
        {status && <span className={`text-[11px] font-medium ${TONE_TEXT[tone]}`}>{status}</span>}
      </div>
      {children}
      {note && (
        <p className="mt-2 border-t border-white/[0.05] pt-2 text-[11px] leading-relaxed text-gray-400">{note}</p>
      )}
    </div>
  );
}

/** 라벨 + 값 한 줄. 값이 없으면 흐리게. */
export function PluginRow(
  { label, value, tone = 'neutral', hint }:
  { label: string; value: string; tone?: PluginTone; hint?: string },
): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className={`mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[12px] text-gray-300">{label}</span>
          <span className="shrink-0 text-[11px] text-gray-400">{value}</span>
        </div>
        {hint && <div className="mt-0.5 truncate text-[11px] text-gray-500">{hint}</div>}
      </div>
    </div>
  );
}

/** 버블 배지 껍데기 — 어두운 알약. 배지끼리 나란히 붙어도 톤이 흔들리지 않게 한 곳에서 정한다. */
export function PluginBadgePill(
  { tone = 'neutral', title, children }:
  { tone?: PluginTone; title: string; children: ReactNode },
): React.JSX.Element {
  return (
    <span
      className={`pointer-events-auto flex items-center gap-1 rounded-full bg-gray-950/85 px-1.5 py-[3px] text-[9px] font-bold leading-none ring-1 ${TONE_RING[tone]} ${TONE_TEXT[tone]}`}
      title={title}
    >
      {children}
    </span>
  );
}

/** 경과 시간을 사람 단위로. i18n 없이 숫자+단위 기호만 쓰므로 로케일 무관. */
export function formatElapsed(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
