/**
 * §5.13 (AA) 42-5·42-8 — 내보내기 화면의 작은 글자 도우미(순수 — 번역은 부르는 쪽).
 */

/** 경과·남은 시간 — `0:31` · `12:05` · `1:02:03`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** 경로의 마지막 이름(구분자는 세 OS 모두). */
export function fileNameOf(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

/** 예약 시각을 사람이 읽는 짧은 글로(그 언어의 날짜 모양 — 브라우저가 고른다). */
export function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** `datetime-local` 칸의 값(지역 시각, 초 없음). */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** `datetime-local` 칸의 값 → ms(못 읽으면 null). */
export function fromLocalInput(value: string): number | null {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
