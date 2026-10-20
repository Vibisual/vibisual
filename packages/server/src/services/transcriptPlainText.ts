/** §9 — 대화 기록의 표시용 정리. 미완성 구분자가 길게 이어져도 같은 구간을 되짚지 않는다. */
const WHITESPACE = /\s/;
const LINE_BREAK = /[\n\r\u2028\u2029]/;
const TABLE_RULE_CHAR = /[-\s|:]/;

/** 종전 /<[^>]+>/g 와 같은 범위만 걷는다. <>·닫히지 않은 태그는 그대로 남는다. */
export function stripTranscriptTags(raw: string): string {
  const parts: string[] = [];
  let copied = 0;
  let search = 0;
  while (search < raw.length) {
    const open = raw.indexOf('<', search);
    if (open < 0) break;
    const close = raw.indexOf('>', open + 1);
    if (close < 0) break;
    search = close + 1;
    if (close === open + 1) continue;
    parts.push(raw.slice(copied, open));
    copied = search;
  }
  parts.push(raw.slice(copied));
  return parts.join('');
}

/** 종전 [label](url)의 label만 남긴다. label/url이 비었거나 닫히지 않으면 원문을 보존한다. */
function stripTranscriptLinks(raw: string): string {
  const parts: string[] = [];
  let copied = 0;
  let search = 0;
  while (search < raw.length) {
    const open = raw.indexOf('[', search);
    if (open < 0) break;
    const labelEnd = raw.indexOf(']', open + 1);
    if (labelEnd < 0) break;
    search = labelEnd + 1;
    if (labelEnd === open + 1 || raw[labelEnd + 1] !== '(') continue;
    const close = raw.indexOf(')', labelEnd + 2);
    if (close < 0) break;
    if (close === labelEnd + 2) continue;
    parts.push(raw.slice(copied, open), raw.slice(open + 1, labelEnd));
    copied = close + 1;
    search = copied;
  }
  parts.push(raw.slice(copied));
  return parts.join('');
}

/** /^\s*marker/gm: 같은 공백 덩어리 안의 줄머리들을 재시도하지 않는다. marker는 sticky다. */
function stripLineMarkers(raw: string, marker: RegExp): string {
  const parts: string[] = [];
  let copied = 0;
  for (let i = 0; i < raw.length;) {
    if (i !== 0 && !LINE_BREAK.test(raw[i - 1] ?? '')) { i += 1; continue; }
    let content = i;
    while (WHITESPACE.test(raw[content] ?? '')) content += 1;
    marker.lastIndex = content;
    if (!marker.exec(raw)) { i = Math.max(i + 1, content); continue; }
    parts.push(raw.slice(copied, i));
    copied = marker.lastIndex;
    i = copied;
  }
  parts.push(raw.slice(copied));
  return parts.join('');
}

/** /^\|[-\s|:]+\|$/gm: 후보 구간의 가장 뒤에 있는 유효한 줄끝까지 걷는다(greedy 의미 보존). */
function stripTableRules(raw: string): string {
  const parts: string[] = [];
  let copied = 0;
  for (let i = 0; i < raw.length;) {
    if (raw[i] !== '|' || (i !== 0 && !LINE_BREAK.test(raw[i - 1] ?? ''))) { i += 1; continue; }
    let end = i + 1;
    let matchEnd = 0;
    while (TABLE_RULE_CHAR.test(raw[end] ?? '')) {
      if (end > i + 1 && raw[end] === '|' && (end + 1 === raw.length || LINE_BREAK.test(raw[end + 1] ?? ''))) {
        matchEnd = end + 1;
      }
      end += 1;
    }
    if (matchEnd !== 0) {
      parts.push(raw.slice(copied, i));
      copied = matchEnd;
      i = matchEnd;
    } else {
      i = end;
    }
  }
  parts.push(raw.slice(copied));
  return parts.join('');
}

/** 마크다운 장식만 걷는다. 표시 내용·순서는 종전 sessionDiscovery.stripMarkdown과 같다. */
export function stripTranscriptMarkdown(raw: string): string {
  let text = raw
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1');
  text = stripTranscriptTags(text)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1');
  text = stripTranscriptLinks(text);
  text = stripLineMarkers(text, /[-*]\s+/y);
  text = stripLineMarkers(text, /\d+\.\s+/y);
  text = stripLineMarkers(text, /-{3,}\s*$/my);
  return stripTableRules(text).replace(/\|/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
