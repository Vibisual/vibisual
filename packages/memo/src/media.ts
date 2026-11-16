export type MemoMediaKind = 'image' | 'video' | 'audio' | 'file';
interface MediaType { kind: Exclude<MemoMediaKind, 'file'>; mime: string }
const type = (kind: MediaType['kind'], mime: string): MediaType => ({ kind, mime });
// 호스트 미디어 통로가 확장자로 형식을 정하므로, 저장 확장자와 화면의 보기 방식이 이 표 하나를 쓴다.
const TYPES: Readonly<Record<string, MediaType>> = {
  png: type('image', 'image/png'), jpg: type('image', 'image/jpeg'), jpeg: type('image', 'image/jpeg'), webp: type('image', 'image/webp'),
  gif: type('image', 'image/gif'), avif: type('image', 'image/avif'), bmp: type('image', 'image/bmp'), svg: type('image', 'image/svg+xml'),
  mp4: type('video', 'video/mp4'), m4v: type('video', 'video/mp4'), mov: type('video', 'video/quicktime'), webm: type('video', 'video/webm'),
  mkv: type('video', 'video/x-matroska'),
  mp3: type('audio', 'audio/mpeg'), m4a: type('audio', 'audio/mp4'), aac: type('audio', 'audio/aac'), wav: type('audio', 'audio/wav'),
  ogg: type('audio', 'audio/ogg'), oga: type('audio', 'audio/ogg'), opus: type('audio', 'audio/ogg'), flac: type('audio', 'audio/flac'),
};
const ALIASES: Readonly<Record<string, string>> = {
  'image/jpg': 'jpg', 'audio/mp3': 'mp3', 'audio/x-m4a': 'm4a', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/x-flac': 'flac', 'video/x-m4v': 'm4v',
};
function nameExtension(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return name.includes('.') && /^[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}
function mimeExtension(mime: string): string {
  const value = (mime.split(';')[0] ?? '').trim().toLowerCase();
  return ALIASES[value] ?? Object.keys(TYPES).find(ext => TYPES[ext]?.mime === value) ?? '';
}
/** 저장 확장자. OS 가 형식을 비워 주는 파일(.mkv 등)은 이름으로, 이름이 형식과 어긋나면 형식으로 정한다. */
export function mediaExtension(name: string, mime: string): string {
  const byName = nameExtension(name); const byMime = mimeExtension(mime);
  if (byMime && TYPES[byName]?.kind !== TYPES[byMime]?.kind) return byMime;
  return byName || byMime || 'bin';
}
export function mediaKind(name: string, mime: string): MemoMediaKind { return TYPES[mediaExtension(name, mime)]?.kind ?? 'file'; }
export function mediaMime(name: string, mime: string): string { return TYPES[mediaExtension(name, mime)]?.mime ?? (mime || 'application/octet-stream'); }
/** 표에 없는 확장자는 내용을 짐작하지 않는다. */
export function extensionMime(file: string): string { return TYPES[nameExtension(file)]?.mime ?? 'application/octet-stream'; }
