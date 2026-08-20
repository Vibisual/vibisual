import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveTimeline, type ResolvedItem, type VideoDoc } from '@vibisual/video';

/**
 * §5.13 Vibistudio — 타임라인.
 *
 * 폭이 곧 시간이다. 아이템의 가로 길이가 실제 초에 비례하므로, TTS 음성이 길면 그
 * 아래 붙은 씬도 같이 길어 보인다 — "오디오가 시간의 주인"이라는 문서 규칙이 화면에서
 * 그대로 보이게 하는 것이 이 화면의 목적이다.
 *
 * 트랙 순서가 곧 앞뒤(그리는 순서)라 위아래 배치도 문서 순서를 그대로 따른다.
 */

const TRACK_TONE: Record<string, string> = {
  visual: 'bg-violet-500/70 border-violet-300/50',
  audio: 'bg-emerald-500/70 border-emerald-300/50',
  caption: 'bg-sky-500/70 border-sky-300/50',
};

export interface VideoTimelineProps {
  doc: VideoDoc;
  playhead: number;
  selectedItemId: string | null;
  onSeek: (t: number) => void;
  onSelectItem: (itemId: string | null) => void;
}

export function VideoTimeline({
  doc,
  playhead,
  selectedItemId,
  onSeek,
  onSelectItem,
}: VideoTimelineProps): React.JSX.Element {
  const { t } = useTranslation();
  const laneRef = useRef<HTMLDivElement>(null);

  const timeline = useMemo(() => resolveTimeline(doc), [doc]);
  // 길이가 0이면 나눗셈이 무너지므로 최소 1초로 본다(빈 문서에서도 화면이 서게).
  const duration = Math.max(timeline.duration, 1);

  const byTrack = useMemo(() => {
    const map = new Map<string, ResolvedItem[]>();
    for (const track of doc.tracks) map.set(track.id, []);
    for (const item of timeline.items) {
      const list = map.get(item.trackId);
      if (list) list.push(item);
    }
    return map;
  }, [doc.tracks, timeline.items]);

  const seekFromEvent = useCallback(
    (clientX: number): void => {
      const el = laneRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onSeek(ratio * duration);
    },
    [duration, onSeek],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      e.currentTarget.setPointerCapture(e.pointerId);
      seekFromEvent(e.clientX);
    },
    [seekFromEvent],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (e.buttons !== 1) return;
      seekFromEvent(e.clientX);
    },
    [seekFromEvent],
  );

  // 눈금 — 길이에 따라 간격을 키워 눈금이 서로 겹치지 않게 한다.
  const tickStep = duration <= 10 ? 1 : duration <= 60 ? 5 : duration <= 300 ? 30 : 60;
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let s = 0; s <= duration; s += tickStep) out.push(s);
    return out;
  }, [duration, tickStep]);

  return (
    <div className="flex flex-col gap-1 select-none">
      {/* 눈금자 + 재생 머리 */}
      <div
        ref={laneRef}
        className="relative h-7 cursor-pointer rounded bg-gray-900/70"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        role="slider"
        aria-label={t('panel.videoStudio.seek', { defaultValue: '재생 위치' })}
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={playhead}
        tabIndex={0}
      >
        {ticks.map((s) => (
          <div
            key={s}
            className="absolute top-0 h-full border-l border-white/10 pl-1 text-[12px] leading-7 text-white/40"
            style={{ left: `${(s / duration) * 100}%` }}
          >
            {s}s
          </div>
        ))}
        <div
          className="pointer-events-none absolute top-0 h-full w-0.5 bg-rose-400"
          style={{ left: `${(playhead / duration) * 100}%` }}
        />
      </div>

      {/* 트랙들 */}
      {doc.tracks.map((track) => {
        const items = byTrack.get(track.id) ?? [];
        const tone = TRACK_TONE[track.kind] ?? 'bg-slate-500/70 border-slate-300/50';
        return (
          <div key={track.id} className="flex items-stretch gap-2">
            <div className="flex w-24 shrink-0 items-center gap-1 truncate text-[12px] text-white/50">
              {track.hidden === true || track.muted === true ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5 shrink-0"
                >
                  <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.6 6.6A18.5 18.5 0 0 0 2 12s3 8 10 8a9.1 9.1 0 0 0 5.4-1.6" />
                  <path d="m2 2 20 20" />
                </svg>
              ) : null}
              <span className="truncate">{track.label ?? track.id}</span>
            </div>

            <div className="relative h-9 flex-1 rounded bg-gray-900/50">
              {items.map((item) => {
                const left = (item.start / duration) * 100;
                const width = Math.max(0.4, (item.duration / duration) * 100);
                const off = item.item.enabled === false;
                const selected = item.id === selectedItemId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectItem(selected ? null : item.id)}
                    className={`absolute top-1 h-7 overflow-hidden rounded border px-1.5 text-left text-[12px] text-white/90 transition-shadow ${tone} ${
                      off ? 'opacity-35' : ''
                    } ${selected ? 'ring-2 ring-white/80' : ''}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${item.id} · ${item.start.toFixed(2)}s ~ ${item.end.toFixed(2)}s`}
                  >
                    <span className="truncate">{item.item.label ?? item.item.sceneId ?? item.id}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {timeline.diagnostics.length > 0 ? (
        <ul className="mt-1 space-y-0.5 rounded bg-amber-500/10 p-2 text-[12px] text-amber-200">
          {timeline.diagnostics.slice(0, 6).map((d, i) => (
            <li key={`${d.code}-${i}`}>{d.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
