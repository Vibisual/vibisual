/**
 * §5.13 (T-10)(V) 37-11 — **HTML 한 장 들여오기**의 순수 층: 그 파일이 바깥에서 부르는 것을 찾고, 받은 뒤 사본의 주소를 상대
 * 경로로 바꾼다.
 *
 * 찾는 것(정적 둘): ① 문서 안 — `<script src>` · `<link href>`(stylesheet·preload·modulepreload) · `<img src/srcset>`·`<source>` ·
 * SVG `href`/`xlink:href` · 인라인 `style` 과 `<style>` 의 `url()`·`@import` ② 스크립트 안 — 문자열 그대로 적힌 모듈 지정자
 * (`import … from 'https://…'`·`import('https://…')`) · import map. 실행 중에만 조립되는 주소(③)는 미리보기 무대의 CSP 위반
 * 알림(`blocked{url}`)이 따로 잡는다. 데이터 부르기(`fetch()` 로 JSON 등)는 받아도 CSP 가 막으므로 "받아도 돌지 않는 것" 으로 가른다.
 *
 * 브라우저 없이 문자열로 한다(서버가 일꾼을 깨우지 않고 바로 답한다). 거짓 양성이 있을 수 있으나 사람이 목록을 보고 고른다.
 */

export type ExternalRefKind = 'script' | 'style' | 'font' | 'image' | 'module' | 'data' | 'other';

export interface ExternalRef {
  readonly url: string;
  readonly kind: ExternalRefKind;
  /** 받아도 그대로는 돌지 않는다(데이터 부르기 — CSP `connect-src 'none'`). */
  readonly inert?: boolean;
}

const ABS = /^(?:https?:)?\/\//i;

function kindOf(url: string, hint: ExternalRefKind | null): ExternalRefKind {
  const clean = url.split(/[?#]/)[0]?.toLowerCase() ?? '';
  if (/\.(?:woff2?|ttf|otf|eot)$/.test(clean)) return 'font';
  if (/\.(?:png|jpe?g|gif|webp|avif|svg)$/.test(clean)) return 'image';
  if (/\.css$/.test(clean)) return 'style';
  if (/\.m?js$/.test(clean)) return hint === 'module' ? 'module' : 'script';
  if (/\.json$/.test(clean)) return 'data';
  return hint ?? 'other';
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = re.exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : null;
}

/** `//cdn…` 는 https 로 본다(우리 내주기 주소에서 프로토콜 상대 주소는 vibproxy 로 풀려 엉뚱한 곳을 가리킨다). */
export function absoluteUrl(raw: string): string | null {
  const v = raw.trim();
  if (!ABS.test(v)) return null;
  return v.startsWith('//') ? `https:${v}` : v;
}

/** CSS 글에서 바깥 주소(`url()`·`@import`). */
export function cssExternalRefs(css: string): ExternalRef[] {
  const out: ExternalRef[] = [];
  for (const m of css.matchAll(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi)) {
    const url = absoluteUrl(m[1] ?? '');
    if (url) out.push({ url, kind: kindOf(url, 'other') });
  }
  for (const m of css.matchAll(/@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/gi)) {
    const url = absoluteUrl(m[1] ?? '');
    if (url) out.push({ url, kind: 'style' });
  }
  return out;
}

/** HTML 한 장의 바깥 참조(같은 주소는 한 번). */
export function findExternalRefs(html: string): ExternalRef[] {
  const found = new Map<string, ExternalRef>();
  const add = (ref: ExternalRef): void => { if (!found.has(ref.url)) found.set(ref.url, ref); };
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    const src = attr(tag, 'src');
    const url = src ? absoluteUrl(src) : null;
    if (url) add({ url, kind: /type\s*=\s*["']?module/i.test(tag) ? 'module' : kindOf(url, 'script') });
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    const href = attr(tag, 'href');
    const url = href ? absoluteUrl(href) : null;
    if (!url) continue;
    if (rel.includes('stylesheet')) add({ url, kind: 'style' });
    else if (rel.includes('modulepreload')) add({ url, kind: 'module' });
    else if (rel.includes('preload') || rel.includes('icon')) add({ url, kind: kindOf(url, 'other') });
  }
  for (const tag of html.match(/<(?:img|source|image|use)\b[^>]*>/gi) ?? []) {
    for (const name of ['src', 'href', 'xlink:href']) {
      const v = attr(tag, name);
      const url = v ? absoluteUrl(v) : null;
      if (url) add({ url, kind: kindOf(url, 'image') });
    }
    const srcset = attr(tag, 'srcset');
    if (srcset) {
      for (const part of srcset.split(',')) {
        const url = absoluteUrl(part.trim().split(/\s+/)[0] ?? '');
        if (url) add({ url, kind: 'image' });
      }
    }
  }
  for (const m of html.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) for (const ref of cssExternalRefs(m[1] ?? m[2] ?? '')) add(ref);
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) for (const ref of cssExternalRefs(m[1] ?? '')) add(ref);
  // 스크립트 본문 — 모듈 지정자와 import map, 데이터 부르기.
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const head = m[1] ?? '';
    const body = m[2] ?? '';
    if (/type\s*=\s*["']?importmap/i.test(head)) {
      try {
        const map = JSON.parse(body) as { imports?: Record<string, unknown> };
        for (const v of Object.values(map.imports ?? {})) {
          const url = typeof v === 'string' ? absoluteUrl(v) : null;
          if (url) add({ url, kind: 'module' });
        }
      } catch { /* 깨진 import map — 넘어간다 */ }
      continue;
    }
    for (const mm of body.matchAll(/\bimport\s*(?:[^'"()]*?\bfrom\s*)?['"]([^'"]+)['"]/g)) {
      const url = absoluteUrl(mm[1] ?? '');
      if (url) add({ url, kind: 'module' });
    }
    for (const mm of body.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const url = absoluteUrl(mm[1] ?? '');
      if (url) add({ url, kind: 'module' });
    }
    for (const mm of body.matchAll(/\bfetch\s*\(\s*['"]([^'"]+)['"]/g)) {
      const url = absoluteUrl(mm[1] ?? '');
      if (url) add({ url, kind: 'data', inert: true });
    }
  }
  return [...found.values()];
}

/** 받은 파일에 붙일 안전한 이름 — `<sha256 앞 16자>-<안전한 이름>`. */
export function vendorFileName(url: string, sha256: string): string {
  const base = (url.split(/[?#]/)[0] ?? '').split('/').filter((s) => s !== '').pop() ?? 'file';
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  return `${sha256.slice(0, 16)}-${safe}`;
}

/** 글에서 바깥 주소들을 바꿔 쓴다(긴 주소부터 — 앞부분이 같은 주소를 잘못 바꾸지 않게). `//cdn` 꼴도 함께. */
export function rewriteUrls(text: string, mapping: ReadonlyMap<string, string>): string {
  const entries = [...mapping.entries()].sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [from, to] of entries) {
    out = out.split(from).join(to);
    if (from.startsWith('https:')) out = out.split(from.slice('https:'.length)).join(to);
  }
  return out;
}

/** `vibi:duration` 이 없으면 사본 머리에 적는다(끝없이 도는 작품은 그 길이에서 자른다). */
export function ensureDurationMeta(html: string, seconds: number): string {
  if (/<meta\b[^>]*name\s*=\s*["']vibi:duration["']/i.test(html)) return html;
  const meta = `<meta name="vibi:duration" content="${Math.max(0.1, Math.round(seconds * 100) / 100)}">`;
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + meta + html.slice(head.index + head[0].length);
  return meta + html;
}
