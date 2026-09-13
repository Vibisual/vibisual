import type { SubAgentStreamEvent } from '@vibisual/shared';
import { codexImageBasename, codexImagePathFromUrl, isCodexImageFile } from './codexStreamMap.js';

/** Only explicit local raster links in assistant prose; never tool output or code examples. */
export function linkedImageEvents(event: SubAgentStreamEvent, platform: NodeJS.Platform): SubAgentStreamEvent[] {
  if (event.eventType !== 'text' || event.imagePath || typeof event.content !== 'string') return [];
  const prose = event.content.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g, '').replace(/`[^`\n]*`/g, '');
  const paths = new Set<string>();
  // Angle destinations permit spaces; bare destinations permit balanced parentheses in filenames.
  const links = /!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|((?:[^\s()]|\([^()]*\))+))(?:\s+"[^"\n]*")?\s*\)/g;
  for (const match of prose.matchAll(links)) {
    const raw = match[1] ?? match[2] ?? '';
    if (!/^(?:file:\/\/\/|[A-Za-z]:[\\/]|\/(?!\/))/i.test(raw)) continue;
    const filePath = codexImagePathFromUrl(raw, platform);
    if (filePath.includes('\0') || !isCodexImageFile(filePath)) continue;
    paths.add(filePath);
  }
  return [...paths].map((imagePath, i) => ({
    ...event, id: `${event.id}:image:${i}`, content: codexImageBasename(imagePath), imagePath,
  }));
}

/** Read-time recovery also handles conversations saved before linked images were supported. */
export function restoreLinkedImages(events: SubAgentStreamEvent[], platform: NodeJS.Platform): SubAgentStreamEvent[] {
  const ids = new Set(events.map((event) => event.id));
  return events.flatMap((event) => [event, ...linkedImageEvents(event, platform).filter((image) => !ids.has(image.id))]);
}
