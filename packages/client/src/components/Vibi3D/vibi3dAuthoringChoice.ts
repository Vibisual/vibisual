/** A tool mention alone is not permission to leave the native authoring path. */
export function requestsVibi3DBlender(request: string): boolean {
  const text = request.normalize('NFKC');
  const tool = String.raw`(?:\bblender\b|블렌더)`;
  const negative = new RegExp(String.raw`(?:\b(?:without|avoid|no|not|never|don't|do\s+not|don’t)\b[^.!?\n]{0,60}${tool}|${tool}[^.!?\n]{0,60}(?:없이|말고|말아|말아줘|쓰지|사용하지|이용하지|활용하지|하지\s*마|필요\s*없|제외|금지))`, 'i');
  if (negative.test(text)) return false;
  return new RegExp(String.raw`(?:\b(?:use|using|with|in|via)\s+(?:the\s+)?${tool}|${tool}\s*(?:로|으로|에서|를\s*(?:사용|이용|활용))|${tool}[^.!?\n]{0,40}\b(?:build|create|make|model|render|author|generate)\b)`, 'i').test(text);
}
